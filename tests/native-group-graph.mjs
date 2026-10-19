// Real native signing against the runner's fresh loopback Dev ledger.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {base,rpcUrl,rpc} from './native-env.mjs';
import {enrollSigningDevice} from './native-certified-utils.mjs';

async function invoke(command,args={}) {
  const response=await fetch(`${base}/execute/async`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,error=>done({error:String(error)}));',args:[command,args]}),
    signal:AbortSignal.timeout(45000),
  });
  const {value}=await response.json();
  assert(response.ok && !value?.error,JSON.stringify(value));
  return value;
}

const creator=await invoke('import_private_key',{hexKey:'00'.repeat(32)});
await enrollSigningDevice(creator.address);
const receiver=await invoke('import_private_key',{hexKey:'77'.repeat(32)});
await enrollSigningDevice(receiver.address);
let edges=['member'],valid=true,status=200;
const queries=[];
const server=createServer((request,response)=>{
  const path=new URL(request.url,'http://fixture.test').pathname;
  response.setHeader('Content-Type','application/json');
  if(path==='/root/trust') {response.end(JSON.stringify({version:1,groups:edges}));return;}
  const membership=/^\/(root|member)\/verify\/([^/]+)$/.exec(path);
  if(!membership) {response.writeHead(404);response.end();return;}
  queries.push({group:membership[1],creator:decodeURIComponent(membership[2])});
  response.writeHead(membership[1]==='member'?status:200);
  response.end(JSON.stringify({valid:membership[1]==='member' && valid,score:1}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}`;
const policy={mode:'any',offline_fallback:'review',max_hops:1,groups:['root','member'].map(id=>({
  id,name:id,description:'Local graph fixture',endpoint_url:`${endpoint}/${id}`,trust_directly:id==='root',
}))};
async function pay() {
  await invoke('import_private_key',{hexKey:'00'.repeat(32)});
  const payment=await invoke('pay',{rpcUrl,expectedAccount:creator.address,provider:receiver.address,amount:'1'});
  assert(payment.accepted);
  await invoke('import_private_key',{hexKey:'77'.repeat(32)});
  return payment.hash;
}
async function maintain(rules=policy) {
  const session=await invoke('begin_automation');
  try {return await invoke('maintain_wallet',{
    rpcUrl,expectedAccount:receiver.address,autoAccept:true,trustedSenders:[],mergeLevel:0,
    automationSession:session,groupPolicy:rules,
  });}
  finally {await invoke('cancel_automation',{session});}
}

try {
  const saved=await invoke('validate_group_policy',{policy});
  assert.equal(saved.max_hops,1);
  assert.equal(saved.groups[1].trust_directly,false);
  await pay();
  assert.equal((await maintain({...policy,max_hops:0})).received,0);
  assert.equal((await maintain()).received,1);
  console.log('PASS native direct-only hold and transitive receipt');

  const pending=await pay();
  edges=[];
  assert.equal((await maintain()).received,0,'removed endorsement was cached');
  edges=['member'];valid=false;
  assert.equal((await maintain()).received,0,'negative membership was accepted');
  edges=['unregistered'];valid=true;
  const unknown=await maintain({...policy,offline_fallback:'protocol'});
  assert.equal(unknown.received,0);assert.equal(unknown.protocol_fallbacks,0);
  assert((await rpc('account_pending',{account:receiver.address})).pending.some(entry=>entry.hash===pending));
  edges=['member'];
  assert.equal((await maintain()).received,1);
  console.log('PASS native live edge removal, negative membership and missing-group hold');

  await pay();status=503;
  assert.equal((await maintain()).received,0);
  const fallback=await maintain({...policy,offline_fallback:'protocol'});
  assert.equal(fallback.received,1);assert.equal(fallback.protocol_fallbacks,1);
  assert.equal((await invoke('get_account_info',{rpcUrl})).trst_balance,'3');
  assert(queries.length>0 && queries.every(query=>query.creator===creator.address));
  assert.equal((await rpc('account_pending',{account:receiver.address})).pending.length,0);
  console.log('PASS native explicit outage fallback and original-creator queries');
} finally {
  await new Promise(resolve=>server.close(resolve));
}
