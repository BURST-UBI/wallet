import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {enrollSigningDevice} from './native-certified-utils.mjs';
import {base,rpcUrl,rpc} from './native-env.mjs';

async function script(code,args=[],async=false) {
  const response=await fetch(`${base}/execute/${async?'async':'sync'}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:code,args}),signal:AbortSignal.timeout(45000),
  });
  const {value}=await response.json();assert(response.ok && !value?.error,JSON.stringify(value));return value;
}
async function invoke(command,args) {
  return script(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,error=>done({error:String(error)}));`,[command,args],true);
}
async function wait(condition) {
  for(let attempt=0;attempt<200;attempt++) {
    if(await script(`return ${condition}`)) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail(`Native pending UI did not reach: ${condition}`);
}
async function click(text) {
  assert(await script(`const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===arguments[0]);if(!button || button.disabled)return false;button.click();return true;`,[text]),`Unavailable button: ${text}`);
}
async function maintain(account,policy,options={}) {
  const session=await invoke('begin_automation');
  try {return await invoke('maintain_wallet',{rpcUrl,expectedAccount:account,autoAccept:true,trustedSenders:[],mergeLevel:0,automationSession:session,groupPolicy:policy,...options});}
  finally {await invoke('cancel_automation',{session});}
}
const protocol={mode:'protocol',groups:[],offline_fallback:'protocol'};
const genesis=await invoke('import_private_key',{hexKey:'00'.repeat(32)});
await enrollSigningDevice(genesis.address);
const merger=await invoke('import_private_key',{hexKey:'44'.repeat(32)});
await enrollSigningDevice(merger.address);
const receiver=await invoke('import_private_key',{hexKey:'55'.repeat(32)});
await enrollSigningDevice(receiver.address);
const queued=await invoke('import_private_key',{hexKey:'66'.repeat(32)});
await enrollSigningDevice(queued.address);
await invoke('import_private_key',{hexKey:'00'.repeat(32)});
for(let i=0;i<2;i++) assert((await invoke('pay',{rpcUrl,expectedAccount:genesis.address,provider:merger.address,amount:'1000'})).accepted);
await invoke('import_private_key',{hexKey:'44'.repeat(32)});
assert.equal((await maintain(merger.address,protocol)).received,2);
await invoke('change_representative',{rpcUrl,expectedAccount:merger.address,rep:genesis.address});
assert((await rpc('genesis_endorse',{account:merger.address})).verified);
assert.equal((await maintain(merger.address,protocol,{autoAccept:false,mergeLevel:50})).merged,2);
for(const amount of ['13','17']) assert((await invoke('transfer_trst',{rpcUrl,expectedAccount:merger.address,to:receiver.address,amount,origin:null})).accepted);
await invoke('import_private_key',{hexKey:'55'.repeat(32)});

let status=200, malformed=false, allowed=genesis.address, release, requested;
let gate=null;
const queries=[];
let directoryReads=0;
let vouches=true;
let endpoint;
let publishedDirectory;
const info=(id)=>({id,name:id==='trusted'?'Trusted community':'Negative community',description:'Public native fixture',endpoint_url:`${endpoint}/${id}`,member_count:1});
const server=createServer(async(request,response)=>{
  const path=new URL(request.url,endpoint).pathname;
  if(path==='/directory.json') {directoryReads++;response.setHeader('Content-Type','application/json');response.end(publishedDirectory ?? JSON.stringify({version:1,groups:[info('trusted'),info('negative')]}));return;}
  if(path==='/negative/trust') {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({version:1,groups:vouches?['trusted']:[]}));return;}
  const match=/^\/(trusted|negative)\/verify\/([^/]+)$/.exec(path);
  if(!match) {response.writeHead(404);response.end();return;}
  const creator=decodeURIComponent(match[2]);queries.push({group:match[1],creator});
  if(gate) {requested();await gate;}
  response.writeHead(status,{'Content-Type':'application/json'});
  response.end(JSON.stringify(malformed?{}:{valid:match[1]==='trusted' && creator===allowed,score:1,since:1700000000}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
endpoint=`http://127.0.0.1:${server.address().port}`;
try {
  if(process.env.NATIVE_DIRECTORY_EXPORTER) {
    assert(process.env.NATIVE_EVIDENCE);
    const draft=join(process.env.NATIVE_EVIDENCE,'directory-draft.json');
    const output=join(process.env.NATIVE_EVIDENCE,'directory.json');
    await writeFile(draft,JSON.stringify({version:1,groups:[info('trusted'),info('negative')]}),{flag:'wx',mode:0o600});
    await promisify(execFile)(process.env.NATIVE_DIRECTORY_EXPORTER,[draft,output],{timeout:10000});
    publishedDirectory=await readFile(output);
    assert.deepEqual(JSON.parse(publishedDirectory).groups.map(group=>group.id),['negative','trusted']);
  }
  const groups=await invoke('load_group_directory',{url:`${endpoint}/directory.json`});
  assert.equal(directoryReads,1);assert.equal(groups.length,2);assert.equal(queries.length,0,'listing a group contacted its membership endpoint');
  const all=await invoke('validate_group_policy',{policy:{mode:'all',groups,offline_fallback:'protocol'}});
  const before=(await invoke('get_account_info',{rpcUrl})).block_count;
  const rejected=await maintain(receiver.address,all);
  assert.equal(rejected.received,0);assert.equal(rejected.held,2);
  assert.equal((await invoke('get_account_info',{rpcUrl})).block_count,before);
  const any={...all,mode:'any'};
  const accepted=await maintain(receiver.address,any);
  assert.equal(accepted.received,2);assert.equal(accepted.protocol_fallbacks,0);
  assert.equal((await invoke('get_account_info',{rpcUrl})).trst_balance,'30');
  assert(queries.every(query=>query.creator===genesis.address),'merged payment checked its sender instead of original creators');
  assert.equal(queries.length,8,'distinct burn origins by the same creator were not deduplicated per payment');

  async function directPayment() {
    await invoke('import_private_key',{hexKey:'00'.repeat(32)});
    const payment=await invoke('pay',{rpcUrl,expectedAccount:genesis.address,provider:receiver.address,amount:'1'});
    await invoke('import_private_key',{hexKey:'55'.repeat(32)});return payment;
  }
  const through={mode:'any',offline_fallback:'review',max_hops:1,groups:groups.map(group=>({...group,trust_directly:group.id==='negative'}))};
  await invoke('validate_group_policy',{policy:through});
  await directPayment();
  assert.equal((await maintain(receiver.address,{...through,max_hops:0})).received,0,'direct-only rules followed an endorsement');
  assert.equal((await maintain(receiver.address,through)).received,1,'endorsed membership did not permit the pending payment');
  await directPayment();vouches=false;
  assert.equal((await maintain(receiver.address,through)).received,0,'a removed endorsement was cached');
  vouches=true;
  assert.equal((await maintain(receiver.address,through)).received,1);

  await directPayment();
  const selected={mode:'any',groups:[groups.find(group=>group.id==='trusted')],offline_fallback:'review'};
  status=503;
  assert.equal((await maintain(receiver.address,selected)).received,0);
  const fallback=await maintain(receiver.address,{...selected,offline_fallback:'protocol'});
  assert.equal(fallback.received,1);assert.equal(fallback.protocol_fallbacks,1);

  const manual=await directPayment();status=200;malformed=true;
  const invalid=await maintain(receiver.address,{...selected,offline_fallback:'protocol'});
  assert.equal(invalid.received,0);assert.equal(invalid.protocol_fallbacks,0);assert.equal(invalid.held,1);
  malformed=false;allowed='not-this-creator';
  assert.equal((await maintain(receiver.address,selected)).received,0);
  const queriesBeforeManual=queries.length;
  assert((await invoke('receive_pending',{rpcUrl,expectedAccount:receiver.address,hash:manual.hash})).accepted);
  assert.equal(queries.length,queriesBeforeManual,'manual acceptance secretly required a group check');

  for(const action of ['receive_pending','lock_wallet']) {
  const cancelledPayment=await directPayment();allowed=genesis.address;
  gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{requested=resolve;});
  const session=await invoke('begin_automation');
  await script(`window.groupMaintenance=null;window.__TAURI_INTERNALS__.invoke('maintain_wallet',arguments[0]).then(value=>{window.groupMaintenance={value};},error=>{window.groupMaintenance={failure:String(error)};});return true;`,[
    {rpcUrl,expectedAccount:receiver.address,autoAccept:true,trustedSenders:[],mergeLevel:0,automationSession:session,groupPolicy:selected},
  ]);
  let timer;
  try {await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Group query did not start')),10000);})]);}
  finally {clearTimeout(timer);}
  const headBefore=(await rpc('account_info',{account:receiver.address})).head;
  const actionStart=Date.now();
  const actionResult=await invoke(action,{rpcUrl,expectedAccount:receiver.address,hash:cancelledPayment.hash});
  assert(Date.now()-actionStart<5000,`${action} waited for the held group response`);
  release();gate=null;
  const cancelled=await script('return window.groupMaintenance;');
  assert.match(cancelled?.failure??'',/Automation settings changed/);
  const headAfter=(await rpc('account_info',{account:receiver.address})).head;
  const stillPending=(await rpc('account_pending',{account:receiver.address,count:100})).pending.some(entry=>entry.hash===cancelledPayment.hash);
  if(action==='lock_wallet') {assert.equal(headAfter,headBefore);assert(stillPending);}
  else {assert(actionResult.accepted);assert.notEqual(headAfter,headBefore);assert(!stillPending);}
  }

  // The first page is held. The next pass must reach the smaller ninth payment.
  await invoke('import_private_key',{hexKey:'00'.repeat(32)});
  for(let i=0;i<8;i++) assert((await invoke('pay',{rpcUrl,expectedAccount:genesis.address,provider:queued.address,amount:'100'})).accepted);
  await invoke('import_private_key',{hexKey:'44'.repeat(32)});
  const later=await invoke('pay',{rpcUrl,expectedAccount:merger.address,provider:queued.address,amount:'1'});assert(later.accepted);
  await invoke('import_private_key',{hexKey:'66'.repeat(32)});allowed=merger.address;
  const firstPage=await maintain(queued.address,selected);
  assert.equal(firstPage.held,8);assert.equal(firstPage.received,0);
  const nextPage=await maintain(queued.address,selected);
  assert.equal(nextPage.received,1,'held payments starved the next page');
  assert.equal((await invoke('get_account_info',{rpcUrl})).trst_balance,'1');
  assert.equal((await rpc('account_pending',{account:queued.address,count:100})).pending.length,8);
  await invoke('import_private_key',{hexKey:'00'.repeat(32)});
  for(let i=0;i<13;i++) assert((await invoke('pay',{rpcUrl,expectedAccount:genesis.address,provider:queued.address,amount:String(101+i)})).accepted);
  await invoke('import_private_key',{hexKey:'66'.repeat(32)});
  const pageOne=await invoke('get_pending',{rpcUrl,expectedAccount:queued.address});
  assert.equal(pageOne.blocks.length,20);assert(pageOne.cursor);
  const pageTwo=await invoke('get_pending',{rpcUrl,expectedAccount:queued.address,cursor:pageOne.cursor});
  assert.equal(pageTwo.blocks.length,1);assert.equal(pageTwo.cursor,null);
  assert.equal(new Set([...pageOne.blocks,...pageTwo.blocks].map(entry=>entry.hash)).size,21);
  const last=pageTwo.blocks[0];
  const exact=await rpc('account_pending',{account:queued.address,count:1,hash:last.hash});
  assert.equal(exact.pending.length,1);assert.equal(exact.pending[0].hash,last.hash);assert.equal(exact.cursor,undefined);
  assert.equal((await rpc('account_pending',{account:receiver.address,hash:last.hash})).pending.length,0);
  assert.equal((await rpc('account_pending',{account:queued.address,hash:last.hash,threshold:String(BigInt(last.amount)+1n)})).pending.length,0);
  await assert.rejects(rpc('account_pending',{account:queued.address,hash:'invalid'}));
  await assert.rejects(invoke('get_pending',{rpcUrl,expectedAccount:receiver.address}),/Wallet changed/);
  await invoke('lock_wallet');
  await script(`const saved=JSON.parse(localStorage.getItem('burst-wallet'));saved.state.autoAccept=false;saved.state.mergeLevel=0;localStorage.setItem('burst-wallet',JSON.stringify(saved));`);
  await fetch(`${base}/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');
  await wait(`!!document.getElementById('wallet-private-key')`);
  await script(`const input=document.getElementById('wallet-private-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'66'.repeat(32));input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  await click('Go to Dashboard');
  await wait(`document.body.innerText.includes('20+ payments to accept')`);
  await click('Receive');
  await wait(`[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Review').length===20`);
  await click('Next');
  await wait(`[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Review').length===1`);
  await click('Review');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0]);`,[last.hash]));
  await click('Receive');
  await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Received 1 payment.')`);
  await click('Done');
  await wait(`[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Review').length===20 && !document.querySelector('[aria-label="Pending payment pages"]')`);
  const refreshed=await invoke('get_pending',{rpcUrl,expectedAccount:queued.address});
  assert.equal(refreshed.blocks.length,20);assert.equal(refreshed.cursor,null);
  assert(!refreshed.blocks.some(entry=>entry.hash===last.hash));
  if(publishedDirectory) {
    const savedPolicy=()=>script(`return JSON.parse(localStorage.getItem('burst-wallet')).state.groupPolicy;`);
    const original=await savedPolicy();
    assert(await script(`const link=document.querySelector('a[href="/settings"]');if(!link)return false;link.click();return true;`));
    await wait(`!![...document.querySelectorAll('summary')].find(item=>item.textContent.includes('Group checks'))`);
    await script(`document.querySelectorAll('summary').forEach(item=>{if(item.textContent.includes('Group checks'))item.click();});`);
    await script(`const label=[...document.querySelectorAll('label')].find(item=>item.textContent==='Automatic receive checks');const select=document.getElementById(label.htmlFor);select.value='any';select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await wait(`!![...document.querySelectorAll('label')].find(item=>item.textContent==='Group directory URL')`);
    await script(`const label=[...document.querySelectorAll('label')].find(item=>item.textContent==='Group directory URL');const input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[0]);input.dispatchEvent(new Event('input',{bubbles:true}));`,[`${endpoint}/directory.json`]);
    const beforeQueries=queries.length;
    await click('Load directory');
    await wait(`!!document.querySelector('[aria-label="Select Trusted community"]')`);
    assert.deepEqual(await savedPolicy(),original,'loading changed the saved trust policy');
    assert.equal(queries.length,beforeQueries,'loading disclosed a creator to a membership endpoint');
    await script(`document.querySelector('[aria-label="Select Trusted community"]').click();`);
    assert.deepEqual(await savedPolicy(),original,'selection saved without review');
    await click('Save group rules');
    await wait(`JSON.parse(localStorage.getItem('burst-wallet')).state.groupPolicy?.groups?.length===1`);
    const selected=await savedPolicy();
    assert.equal(selected.mode,'any');
    assert.equal(selected.groups[0].id,'trusted');
    assert.equal(selected.groups[0].endpoint_url,`${endpoint}/trusted`);
    assert.equal(queries.length,beforeQueries);
    console.log('PASS operator-exported directory loaded in installed Settings, explicit selection/save and pinned endpoint; discovery sends no membership queries');
  }
  console.log('PASS native bounded manual pending pages, exact source lookup, account/threshold isolation and real UI page-two review/receive with first-page refresh');
  console.log('PASS native group directory, original creators behind merged transfers, any/all rules, live outage fallback, malformed/negative holds, manual acceptance priority, lock cancellation and pending-page fairness');
} finally {
  if(release) release();gate=null;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await invoke('lock_wallet');
}
