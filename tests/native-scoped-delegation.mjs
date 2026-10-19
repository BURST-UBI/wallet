// Real desktop controls, Tauri signing and disposable certified-node RPC.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {base, rpcUrl, rpc} from './native-env.mjs';
import {useSigningDevice} from './native-certified-consumer-ui.mjs';

const proposal = process.env.NATIVE_PROPOSAL;
const offline = process.env.NATIVE_GOVERNANCE_OFFLINE === '1';
assert.match(proposal, /^[a-f0-9]{64}$/);
assert.equal((await rpc('params_hash')).delegation_key_journal, true);
assert.equal((await rpc('node_info')).verified_count, 3);

async function script(code, args = [], async = false) {
  const response = await fetch(`${base}/execute/${async ? 'async' : 'sync'}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({script:code,args}), signal: AbortSignal.timeout(45000),
  });
  const {value} = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}
async function invoke(command, args = {}) {
  return script(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,error=>done({error:String(error)}));`, [command,args], true);
}
async function rejected(command, args, pattern) {
  const error = await script(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(()=>done('ACCEPTED'),error=>done(String(error)));`, [command,args], true);
  assert.match(error, pattern);
}
async function wait(condition) {
  for (let attempt=0; attempt<250; attempt++) {
    if (await script(`return ${condition}`)) return;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.fail(`Desktop condition timed out: ${condition}; alerts: ${await script(`return [...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)`)} `);
}
async function click(text, selector='button') {
  assert(await script(`const button=[...document.querySelectorAll(arguments[1])].find(b=>b.textContent.trim()===arguments[0]);
    if(!button || button.disabled)return false;button.scrollIntoView({block:'center'});button.click();return true;`, [text,selector]), `Missing enabled control: ${text}`);
}
async function fill(id, value) {
  await script(`const input=document.getElementById(arguments[0]);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[1]);
    input.dispatchEvent(new Event('input',{bubbles:true}));`, [id,value]);
}
async function identity(index) {
  await invoke('lock_wallet');
  await script(`localStorage.setItem('burst-wallet',JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [rpcUrl]);
  const response = await fetch(`${base}/refresh`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert(response.ok);
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');
  await wait(`!!document.getElementById('wallet-private-key')`);
  await fill('wallet-private-key', index.toString(16).padStart(2,'0').repeat(32));
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  await click('Go to Dashboard');
  await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
  const account = (await invoke('get_account_info', {rpcUrl})).address;
  await useSigningDevice(account);
  await script(`history.pushState({},'', '/governance');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`!!document.getElementById('delegate-address')`);
  await wait(`document.querySelector('.wallet-identity')?.textContent.includes('Verified')`);
  return account;
}
async function confirmedReview(title) {
  await wait(`!!document.querySelector('[role="dialog"]')`);
  assert((await script(`return document.querySelector('[role="dialog"]').textContent`)).includes(title));
  if (offline) {
    const actionButton=async label=>assert(await script(`const dialog=[...document.querySelectorAll('[role="dialog"]')].at(-1);const button=[...dialog.querySelectorAll('button')].find(button=>button.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.click();return true;`,[label]),label);
    await actionButton('Sign offline');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Prepare action'&&!button.disabled)`);
    await actionButton('Prepare action');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Sign and save'&&!button.disabled)`);
    const account=(await invoke('get_account_info',{rpcUrl})).address;
    const head=(await rpc('account_info',{account})).head;
    await actionButton('Sign and save');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Submit saved action'&&!button.disabled)`);
    const saved=await invoke('get_offline_payment',{expectedAccount:account});
    assert(saved?.can_discard);assert.equal((await rpc('account_info',{account})).head,head);
    await actionButton('Submit saved action');
    await wait(`document.body.innerText.includes('The network confirmed this action.')`);
    assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
    assert.equal((await rpc('block_info',{hash:saved.hash})).confirmed,true);
    await actionButton('Close');await click('Cancel','[role="dialog"] button');
    console.log(`PASS native offline scoped action: ${saved.kind}, original hash confirmed`);
  } else {
  await click('Confirm', '[role="dialog"] button');
  }
  await wait(`!document.querySelector('[role="dialog"]')`);
}
async function page(scope, incoming=false) {
  return invoke('get_scoped_delegations', {rpcUrl,incoming,scope:scope ?? null,cursor:null});
}

// These are public disposable keys, also used by the Rust representative fixture.
const recipient = (await invoke('import_private_key',{hexKey:'00'.repeat(32)})).address;
const parameter = {kind:'parameter',value:'brn_rate'};
const owner = await identity(1);
await fill('delegate-address', recipient);
const before = (await rpc('account_info',{account:owner})).head;
await click('Review delegation');
await click('Cancel', '[role="dialog"] button');
assert.equal((await rpc('account_info',{account:owner})).head,before,'cancel signed a block');
await click('Review delegation');
await confirmedReview('Review delegation');
const registered = await page(parameter);
assert.equal(registered.entries[0].generation,'1');
assert.equal(registered.entries[0].delegate,recipient);
assert(registered.entries[0].confirmed);
const reviewed = {rpcUrl,expectedAccount:owner,scope:parameter,delegate:recipient,generation:'1',expectedGenesis:registered.genesis};
const registeredHead = (await rpc('account_info',{account:owner})).head;
await rejected('set_scoped_delegation',{...reviewed,generation:'0'},/changed|confirmation/);
await rejected('set_scoped_delegation',{...reviewed,expectedGenesis:'ff'.repeat(32)},/network changed/);
await rejected('set_scoped_delegation',{...reviewed,expectedAccount:recipient},/wallet changed/i);
assert.equal((await rpc('account_info',{account:owner})).head,registeredHead,'rejected review changed the ledger');
console.log('PASS native parameter grant, cancellation, stale generation, chain and wallet checks');

const secondOwner = await identity(2);
await script(`const input=document.getElementById('delegation-kind');input.value='proposal';input.dispatchEvent(new Event('change',{bubbles:true}));`);
await fill('delegation-scope',proposal);
await fill('delegate-address',recipient);
await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Review delegation'&&!b.disabled)`);
await click('Review delegation');
await confirmedReview('Review delegation');
assert.equal((await page({kind:'proposal',value:proposal})).entries[0].generation,'1');

assert.equal(await identity(0),recipient);
await click('Find a proposal by ID','summary');
await fill('proposal-hash',proposal);
await click('Read proposal');
await wait(`!!document.querySelector('[aria-label="Voting delegation"]') && document.body.innerText.includes('Proposal details')`);
assert.equal(await script(`return document.querySelector('[aria-label="Proposal"] h2').textContent`), 'Change BRN rate to 2 BRN per second');
await click('Delegated to you');
await wait(`document.querySelectorAll('[aria-label="Voting delegation"] button').length>=8`);
const incoming = await page(null,true);
assert.equal(incoming.entries.length,2);
for (const entry of incoming.entries) {
  const scopeLabel = entry.scope.kind === 'parameter' ? 'BRN rate' : `Proposal ${proposal.slice(0,8)}…`;
  assert(await script(`const region=document.querySelector('[aria-label="Voting delegation"]');
    const label=[...region.querySelectorAll('p')].find(p=>p.textContent===arguments[0]);
    const button=[...label.parentElement.parentElement.querySelectorAll('button')].find(b=>b.textContent==='Support');
    if(!button||button.disabled)return false;button.click();return true;`,[scopeLabel]));
  await confirmedReview('Review delegated ballot');
}
const ownVote = await invoke('vote_proposal',{rpcUrl,expectedAccount:recipient,proposal,vote:'yea'});
assert(ownVote.accepted);
console.log('PASS native proposal grant, encrypted grant discovery, two UI secondary ballots and direct vote');
await script(`document.querySelector('[aria-label="Voting delegation"]').scrollIntoView({block:'end'});`);
const screenshot = await fetch(`${base}/screenshot`,{signal:AbortSignal.timeout(10000)});
const shot = await screenshot.json();
assert(screenshot.ok && typeof shot.value === 'string');
await writeFile(join(process.env.NATIVE_EVIDENCE,'scoped-ballots.png'),Buffer.from(shot.value,'base64'));

assert.equal(await identity(1),owner);
await click('Revoke for this scope');
await confirmedReview('Revoke delegation?');
const revoked = await page(parameter);
assert.equal(revoked.entries[0].generation,'2');
assert.equal(revoked.entries[0].grant,null);
assert(revoked.entries[0].confirmed);
await invoke('import_private_key',{hexKey:'00'.repeat(32)});
const recipientHead = (await rpc('account_info',{account:recipient})).head;
await rejected('vote_with_delegation',{rpcUrl,expectedAccount:recipient,entry:incoming.entries.find(e=>e.owner===owner),proposal,vote:'yea'},/changed|confirmation/);
assert.equal((await rpc('account_info',{account:recipient})).head,recipientHead);
const remaining = await page(null,true);
assert.equal(remaining.entries.length,1);
assert.equal(remaining.entries[0].owner,secondOwner);
await invoke('lock_wallet');
await rejected('set_scoped_delegation',reviewed,/locked|wallet/i);
console.log('PASS native revocation, removed recipient index, stale ballot and locked signer rejection');
