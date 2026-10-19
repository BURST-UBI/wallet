import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {base,rpcUrl,rpc} from './native-env.mjs';
import {enrollSigningDevice} from './native-certified-utils.mjs';
const parameter = process.env.NATIVE_PARAMETER === '1';
const offline = process.env.NATIVE_GOVERNANCE_OFFLINE === '1';

assert.equal((await rpc('node_info')).verified_count,3);
assert.equal((await rpc('params_hash')).full_governance_content,true);
async function script(code,args=[],async=false) {
  const response=await fetch(`${base}/execute/${async?'async':'sync'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:code,args}),signal:AbortSignal.timeout(45000)});
  const {value}=await response.json();assert(response.ok&&!value?.error,JSON.stringify(value));return value;
}
async function invoke(command,args={}) {
  return script(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,error=>done({error:String(error)}));`,[command,args],true);
}
async function reject(command,args,pattern) {
  const error=await script(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(()=>done('ACCEPTED'),error=>done(String(error)));`,[command,args],true);
  assert.match(error,pattern);
}
async function wait(condition) {
  for(let attempt=0;attempt<350;attempt++) {
    if(await script(`return ${condition}`)) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail(`Desktop did not reach ${condition}; alerts: ${await script(`return [...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)`)} `);
}
async function click(text,selector='button') {
  assert(await script(`const button=[...document.querySelectorAll(arguments[1])].find(e=>e.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.scrollIntoView({block:'center'});button.click();return true;`,[text,selector]),text);
}
async function fill(id,value) {
  await script(`const input=document.getElementById(arguments[0]);const prototype=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,arguments[1]);input.dispatchEvent(new Event('input',{bubbles:true}));`,[id,value]);
}
async function select(id,value) {
  await script(`const input=document.getElementById(arguments[0]);input.value=arguments[1];input.dispatchEvent(new Event('change',{bubbles:true}));`,[id,value]);
}
async function identity(index) {
  await invoke('lock_wallet');
  await script(`localStorage.setItem('burst-wallet',JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`,[rpcUrl]);
  const response=await fetch(`${base}/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert(response.ok);
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');await wait(`!!document.getElementById('wallet-private-key')`);
  await fill('wallet-private-key',index.toString(16).padStart(2,'0').repeat(32));await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);await click('Go to Dashboard');
  await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
  const address = (await invoke('get_account_info',{rpcUrl})).address;
  await enrollSigningDevice(address);
  await script(`history.pushState({},'','/governance');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`!!document.getElementById('delegate-address') && [...document.querySelectorAll('button')].some(b=>b.textContent==='New amendment'&&!b.disabled)`);
  return address;
}
async function confirm(button) {
  await wait(`!!document.querySelector('[role="dialog"]')`);
  if (offline) {
    const actionButton = async label => {
      assert(await script(`const dialog=[...document.querySelectorAll('[role="dialog"]')].at(-1);const button=[...dialog.querySelectorAll('button')].find(button=>button.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.click();return true;`,[label]),label);
    };
    await actionButton('Sign offline');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Prepare action'&&!button.disabled)`);
    await actionButton('Prepare action');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Sign and save'&&!button.disabled)`);
    await actionButton('Sign and save');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Submit saved action'&&!button.disabled)`);
    const account=(await invoke('get_account_info',{rpcUrl})).address;
    const pending=await invoke('get_offline_payment',{expectedAccount:account});
    assert(pending?.hash && pending.can_discard,'Offline action must be saved before submission');
    await actionButton('Submit saved action');
    await wait(`document.body.innerText.includes('The network confirmed this action.')`);
    assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
    assert.equal((await rpc('block_info',{hash:pending.hash})).confirmed,true);
    await actionButton('Close');
    await click(button.startsWith('Publish')?'Back to editing':'Cancel','[role="dialog"] button');
    await wait(`!document.querySelector('[role="dialog"]')`);
    if (button.startsWith('Publish')) {
      if (parameter) await click('Close parameter editor');
      await read(pending.hash);
    }
    console.log(`PASS native offline governance action: ${button}, original ${pending.kind} confirmed`);
    return;
  }
  await click(button,'[role="dialog"] button');
  await wait(`!document.querySelector('[role="dialog"]')`);
}
async function read(proposal) {
  if (await script(`return !!document.querySelector('[aria-label="Proposal"]')`)) await click('All proposals');
  await wait(`!!document.getElementById('proposal-hash')`);
  await script(`document.getElementById('proposal-hash').closest('details').open=true`);
  await fill('proposal-hash',proposal);await click('Read proposal');
  await wait(`!!document.querySelector('[aria-label="Proposal"] .balance-details dd')`);
}

const owner=await identity(0);
const context=await invoke('get_constitution_context',{rpcUrl});
const draft={title:'共同の憲法 🌍',operations:[
  {ModifyArticle:{article_number:'1',new_text:'人は平等です 🌍'}},
  {RepealArticle:{article_number:'2'}},
  {AddArticle:{title:'共同の権利',text:'Every verified person has one vote. 🌍'}},
]};
let withdrawn=null;
let head=(await rpc('account_info',{account:owner})).head;
if(parameter) {
  const args={rpcUrl,expectedAccount:owner,expectedRevision:context.revision,parameter:'brn_rate',newValue:'2000000000000000001'};
  assert(context.parameters.some(row=>row.name==='brn_rate'&&row.current==='1000000000000000000'));
  await reject('propose_parameter',{...args,expectedRevision:'stale'},/rules changed/);
  await reject('propose_parameter',{...args,expectedAccount:'another wallet'},/wallet changed/i);
  await reject('propose_parameter',{...args,newValue:'340282366920938463463374607431768211456'},/too large/i);
  await reject('propose_parameter',{...args,parameter:'trst_expiry_secs',newValue:'18446744073709551616'},/storage range/);
  await reject('propose_parameter',{...args,parameter:'governance_promotion_duration_secs',newValue:'1'},/legacy/);
  assert.equal((await rpc('account_info',{account:owner})).head,head);
  await click('Propose a change');await select('governance-parameter','brn_rate');
  await fill('governance-new-value','3');await click('Review proposal');await confirm('Publish proposal');
  await wait(`!!document.querySelector('[aria-label="Proposal"] .balance-details dd')`);
  withdrawn=await script(`return document.querySelector('[aria-label="Proposal"] .balance-details dd').textContent`);
  await click('Endorse proposal');await confirm('Burn BRN and endorse');
  head=(await rpc('account_info',{account:owner})).head;
  const spent=(await rpc('block_info',{hash:head})).brn_balance;
  const withdrawal={rpcUrl,expectedAccount:owner,expectedRevision:context.revision,proposal:withdrawn};
  await reject('withdraw_governance_proposal',{...withdrawal,expectedAccount:'another wallet'},/wallet changed/i);
  await reject('withdraw_governance_proposal',{...withdrawal,expectedRevision:'stale'},/rules changed/);
  await click('Withdraw proposal');
  assert((await script(`return document.querySelector('[role="dialog"]').textContent`)).includes('not refunded'));
  const withdrawalScreenshot=await fetch(`${base}/screenshot`);const withdrawalShot=await withdrawalScreenshot.json();assert(withdrawalScreenshot.ok);
  await writeFile(join(process.env.NATIVE_EVIDENCE,'withdrawal-review.png'),Buffer.from(withdrawalShot.value,'base64'));
  await click('Cancel','[role="dialog"] button');
  assert.equal((await rpc('account_info',{account:owner})).head,head,'cancel withdrew the proposal');
  await click('Withdraw proposal');await confirm('Withdraw proposal');
  assert.equal((await rpc('governance_proposal_info',{hash:withdrawn})).phase,'Withdrawn');
  head=(await rpc('account_info',{account:owner})).head;
  assert.equal((await rpc('block_info',{hash:head})).brn_balance,spent,'withdrawal refunded the endorsement');
  await reject('withdraw_governance_proposal',withdrawal,/no longer be withdrawn/);
  assert.equal((await rpc('account_info',{account:owner})).head,head,'repeat withdrawal changed the ledger');
  console.log('PASS native owner withdrawal, cancellation, stale review rejection and no endorsement refund');
  await click('Propose a change');await select('governance-parameter','brn_rate');
  await fill('governance-new-value','2.000000000000000001');await click('Review proposal');
  await click('Back to editing','[role="dialog"] button');
  assert.equal((await rpc('account_info',{account:owner})).head,head,'cancel published a proposal');
  await click('Review proposal');
  assert((await script(`return document.querySelector('[role="dialog"]').textContent`)).includes('2.000000000000000001 BRN per second'));
  const screenshot=await fetch(`${base}/screenshot`);const shot=await screenshot.json();assert(screenshot.ok);
  await writeFile(join(process.env.NATIVE_EVIDENCE,'parameter-review.png'),Buffer.from(shot.value,'base64'));
  await confirm('Publish proposal');
} else {
await reject('propose_constitution',{rpcUrl,expectedAccount:owner,expectedRevision:'stale',draft},/rules changed/);
await reject('propose_constitution',{rpcUrl,expectedAccount:'another wallet',expectedRevision:context.revision,draft},/wallet changed/i);
await reject('propose_constitution',{rpcUrl,expectedAccount:owner,expectedRevision:context.revision,draft:{title:'Too long',operations:[{AddArticle:{title:'Limit',text:'🌍'.repeat(50001)}}]}},/50000 characters/);
assert.equal((await rpc('account_info',{account:owner})).head,head);
await click('New amendment');await fill('amendment-title',draft.title);
await select('amendment-kind-0','modify');await select('amendment-article-0','1');await fill('amendment-text-0','人は平等です 🌍');
await click('Add change');await select('amendment-kind-1','repeal');await select('amendment-article-1','2');
await click('Add change');await fill('amendment-article-title-2','共同の権利');await fill('amendment-text-2','Every verified person has one vote. 🌍');
await click('Review amendment');await click('Back to editing','[role="dialog"] button');
assert.equal((await rpc('account_info',{account:owner})).head,head,'cancel published a proposal');
await click('Review amendment');
assert.equal(await script(`return document.querySelectorAll('[role="dialog"] [aria-label="Amendment changes"] li').length`),3);
const screenshot=await fetch(`${base}/screenshot`);const shot=await screenshot.json();assert(screenshot.ok);
await writeFile(join(process.env.NATIVE_EVIDENCE,'constitution-review.png'),Buffer.from(shot.value,'base64'));
await confirm('Publish amendment');
}
await wait(`!!document.querySelector('[aria-label="Proposal"] .balance-details dd')`);
const proposal=await script(`return document.querySelector('[aria-label="Proposal"] .balance-details dd').textContent`);
assert.match(proposal,/^[a-f0-9]{64}$/);
const published=await invoke('get_governance_proposal_info',{rpcUrl,hash:proposal});
if(parameter) assert.equal(published.proposed_value,'2000000000000000001');
else assert.deepEqual(published.amendment_operations,draft.operations);
await click('Endorse proposal');
assert((await script(`return document.querySelector('[role="dialog"]').textContent`)).includes('0.000000000000000001 BRN'));
await confirm('Burn BRN and endorse');
console.log('PASS native exact '+(parameter?'parameter':'typed amendment')+', stale/wrong-wallet/oversize rejection, cancellation and reviewed endorsement burn');

const delegator=await identity(1);
await select('delegation-kind','proposal');await fill('delegation-scope',proposal);await fill('delegate-address',owner);
await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Review delegation'&&!b.disabled)`);
await click('Review delegation');await confirm('Confirm');
assert.equal(await identity(0),owner);
await read(proposal);
await wait(`[...document.querySelectorAll('[aria-label="Proposal"] button')].some(b=>b.textContent==='Support'&&!b.disabled)`);
if(parameter) {
  assert.equal(await script(`return [...document.querySelectorAll('[aria-label="Proposal"] button')].some(b=>b.textContent==='Withdraw proposal')`),false);
  await reject('withdraw_governance_proposal',{rpcUrl,expectedAccount:owner,expectedRevision:context.revision,proposal},/no longer be withdrawn/);
}
await click('Support','[aria-label="Proposal"] button');await confirm('Confirm vote');
await click('Delegated to you');
await wait(`[...document.querySelectorAll('[aria-label="Voting delegation"] button')].some(b=>b.textContent==='Support'&&!b.disabled)`);
await click('Support','[aria-label="Voting delegation"] button');
if(!parameter) assert.equal(await script(`return document.querySelectorAll('[role="dialog"] [aria-label="Amendment changes"] li').length`),3);
await confirm('Confirm');
const incoming=await invoke('get_scoped_delegations',{rpcUrl,incoming:true,scope:null,cursor:null});
assert.equal(incoming.entries[0].owner,delegator);
await invoke('lock_wallet');
if(parameter) await reject('withdraw_governance_proposal',{rpcUrl,expectedAccount:owner,expectedRevision:context.revision,proposal:withdrawn},/locked|wallet/i);
if(parameter) await reject('propose_parameter',{rpcUrl,expectedAccount:owner,expectedRevision:context.revision,parameter:'brn_rate',newValue:'2'},/locked|wallet/i);
else await reject('propose_constitution',{rpcUrl,expectedAccount:owner,expectedRevision:context.revision,draft},/locked|wallet/i);
await writeFile(process.env.NATIVE_RESULT_PATH,JSON.stringify({proposal,withdrawn}));
console.log('PASS native ordinary and secondary-key votes on '+(parameter?'an exact parameter change':'a full constitutional diff'));
