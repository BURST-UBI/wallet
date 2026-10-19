import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { enrollSigningDevice } from './native-certified-utils.mjs';

async function script(code,args=[],async=false) {
  const response=await fetch(`${base}/execute/${async?'async':'sync'}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:code,args}),
    signal:AbortSignal.timeout(45000),
  });
  const {value}=await response.json();
  assert(response.ok && !value?.error,JSON.stringify(value));
  return value;
}
async function invoke(command,args) {
  return script(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,error=>done({error:String(error)}));`,[command,args],true);
}
async function rejected(command,args) {
  return script(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(()=>done('accepted'),error=>done(String(error)));`,[command,args],true);
}

// Public fixture keys and disposable balances only.
const recipient=await invoke('import_private_key',{hexKey:'33'.repeat(32)});
const creator=await invoke('import_private_key',{hexKey:'00'.repeat(32)});
await enrollSigningDevice(creator.address);
const payment=await invoke('pay',{rpcUrl,expectedAccount:creator.address,provider:recipient.address,amount:'13'});
assert(payment.accepted);
const secondPayment=await invoke('pay',{rpcUrl,expectedAccount:creator.address,provider:recipient.address,amount:'13'});
assert(secondPayment.accepted);
await invoke('import_private_key',{hexKey:'33'.repeat(32)});
assert.equal((await invoke('get_account_info',{rpcUrl})).block_count,0);
await enrollSigningDevice(recipient.address);
const enrolled=await invoke('get_account_info',{rpcUrl});
assert.equal(enrolled.block_count,2,'enrollment must only open and assign the signing device');
assert.equal(enrolled.trst_balance,'0','enrollment must not accept pending funds');
const args={rpcUrl,expectedAccount:recipient.address,autoAccept:true,trustedSenders:[],mergeLevel:0};

const first=await invoke('begin_automation');
const second=await invoke('begin_automation');
await invoke('cancel_automation',{session:first});
assert.match(await rejected('maintain_wallet',{...args,automationSession:first}),/Automation settings changed/);
const idle=await invoke('maintain_wallet',{...args,autoAccept:false,automationSession:second});
assert.equal(idle.received,0,'cancelling an old session invalidated the new session');
await invoke('cancel_automation',{session:second});
assert.match(await rejected('maintain_wallet',{...args,automationSession:second}),/Automation settings changed/);
assert.notEqual(await rejected('maintain_wallet',args),'accepted','maintenance without a session was allowed');

let release;
let requested;
let gate;
let blockedRead;
let pendingReads;
let processCalls=0;
const proxy=createServer(async (request,response)=>{
  try {
    let body='';
    for await (const chunk of request) {
      body+=chunk;
      assert(body.length<65536);
    }
    const action=JSON.parse(body).action;
    if (action==='process') processCalls++;
    if (action==='account_pending' && ++pendingReads===blockedRead) {
      requested(); await gate;
    }
    const upstream=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(10000)});
    response.writeHead(upstream.status,{'Content-Type':'application/json'});
    response.end(await upstream.text());
  } catch(error) {response.writeHead(500);response.end(JSON.stringify({error:String(error)}));}
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const proxyUrl=`http://127.0.0.1:${proxy.address().port}`;
let session;
try {
  for (const blockAt of [1,2]) {
  blockedRead=blockAt; pendingReads=0; processCalls=0;
  gate=new Promise(resolve=>{release=resolve;});
  const readStarted=new Promise(resolve=>{requested=resolve;});
  session=await invoke('begin_automation');
  await script(`window.cancelledMaintenance=null;
    window.__TAURI_INTERNALS__.invoke('maintain_wallet',arguments[0]).then(value=>{window.cancelledMaintenance={value};},error=>{window.cancelledMaintenance={failure:String(error)};});
    return true;`,[{...args,rpcUrl:proxyUrl,automationSession:session}]);
  let timer;
  try {
    await Promise.race([readStarted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Pending read did not start')),10000);})]);
  } finally {clearTimeout(timer);}
  await invoke('cancel_automation',{session});
  release();
  let result;
  for (let i=0;i<100;i++) {
    result=await script('return window.cancelledMaintenance;');
    if (result) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.match(result?.failure??'',/Automation settings changed/);
  const info=await invoke('get_account_info',{rpcUrl});
  const remaining=(await rpc('account_pending',{account:recipient.address,count:100})).pending;
  if (blockAt===1) {
    assert.equal(processCalls,0,'cancelled maintenance started a payment after its delayed list read');
    assert.equal(info.block_count,enrolled.block_count);
    assert.equal(info.head,enrolled.head,'cancelled maintenance changed the enrolled account');
    assert.equal(remaining.length,2);
  } else {
    assert(processCalls>0,'the already-started payment did not finish');
    assert.equal(info.trst_balance,'13','cancelled maintenance accepted another payment after finishing the first');
    assert.equal(remaining.length,1);
  }
  assert(remaining.every(entry=>[payment.hash,secondPayment.hash].includes(entry.hash)));
  }
} finally {
  release();
  if (session) await invoke('cancel_automation',{session});
  proxy.closeAllConnections();
  await new Promise(resolve=>proxy.close(resolve));
  await invoke('lock_wallet');
}
console.log('PASS native scoped automation sessions, stale/missing-session rejection, cancellation before signing and no further payments after an already-started receive finishes');
