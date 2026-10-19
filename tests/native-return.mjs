import assert from 'node:assert/strict';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { importTestIdentity, resolveExcludedPayment, payWithReview, useSigningDevice } from './native-certified-consumer-ui.mjs';
import { enrollSigningDevice } from './native-certified-utils.mjs';

async function script(code, args = [], async = false) {
  const response = await fetch(`${base}/execute/${async ? 'async' : 'sync'}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({script:code,args}), signal: AbortSignal.timeout(45000),
  });
  const {value} = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}
async function wait(condition) {
  for (let attempt=0; attempt<200; attempt++) {
    if (await script(`return ${condition}`)) return;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  const alerts = await script(`return [...document.querySelectorAll('[role="alert"]')].map(el=>el.textContent)`);
  assert.fail(`Return UI did not reach: ${condition}; alerts: ${JSON.stringify(alerts)}`);
}
async function click(text) {
  assert(await script(`const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]);
    if(!button || button.disabled)return false;button.click();return true;`,[text]),text);
}
async function invoke(command,args) {
  return script(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,error=>done({error:String(error)}));`,[command,args],true);
}

// Public fixture keys, never user credentials. This account has never received.
const recipient = await invoke('import_private_key',{hexKey:'11'.repeat(32)});
const creator = await invoke('import_private_key',{hexKey:'00'.repeat(32)});
let payment;
if (process.env.NATIVE_RETURN_RECOVERY === '1') {
  assert.equal((await rpc('node_info')).network, 'dev');
  const hash = process.env.NATIVE_EXPECTED_EXCLUDED_PAYMENT;
  assert(/^[0-9a-f]{64}$/.test(hash || ''));
  const retained = await invoke('get_offline_payment', {expectedAccount:creator.address});
  assert.equal(retained?.hash, hash, 'Recovery must use the original signed action');
  assert.equal(retained.kind, 'Burn');
  assert.equal(retained.can_discard, false);
  assert.equal(await importTestIdentity(0), creator.address);
  await resolveExcludedPayment(creator.address, hash);
  await script(`history.pushState({}, '', '/');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
  payment = {accepted:true, hash:await payWithReview(creator.address, recipient.address, '0.000000000000000017', '17')};
  assert.notEqual(payment.hash, hash);
  console.log('PASS retained epoch-excluded Burn reconciled without signing; separately reviewed replacement confirmed');
} else {
  await enrollSigningDevice(creator.address);
  payment = await invoke('pay',{rpcUrl,expectedAccount:creator.address,provider:recipient.address,amount:'17'});
}
assert(payment.accepted);
const originalBurn = await rpc('block_info',{hash:payment.hash});
assert.equal(originalBurn.block_type,'Burn');
const senderBefore = await rpc('account_info',{account:creator.address});
await invoke('lock_wallet');
await script(`localStorage.setItem('burst-wallet',JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`,[rpcUrl]);
await fetch(`${base}/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Import Private Key');
await wait(`!!document.getElementById('wallet-private-key')`);
await script(`const input=document.getElementById('wallet-private-key');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'11'.repeat(32));
  input.dispatchEvent(new Event('input',{bubbles:true}));`);
await click('Import');
await wait(`document.body.innerText.includes('Continue without file')`);
await click('Continue without file');
await wait(`document.body.innerText.includes('Go to Dashboard')`);
await click('Go to Dashboard');
await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
const wrongWallet = await script(`const done=arguments[arguments.length-1];
  window.__TAURI_INTERNALS__.invoke('reject_pending',arguments[0]).then(()=>done('accepted'),error=>done(String(error)));`,[{rpcUrl,hash:payment.hash,expectedAccount:creator.address}],true);
assert.match(wrongWallet,/Wallet changed/);
assert.equal((await invoke('get_account_info',{rpcUrl})).block_count,0,'identity mismatch opened an account');
await click('Receive');
await wait(`[...document.querySelectorAll('main button')].some(button=>button.textContent.trim()==='Review' && !button.disabled)`);
await click('Review');
await wait(`!!document.querySelector('[role="dialog"]')`);
await click('View original creators');
await wait(`!!document.querySelector('[role="dialog"] [aria-label="Original BRN payments"] li')`);
assert(await script(`return document.querySelector('[role="dialog"] [aria-label="Original creators"]').textContent.includes(arguments[0]);`,[creator.address]));
assert.equal((await invoke('get_account_info',{rpcUrl})).block_count,0,'origin inspection changed the ledger');
await click('Hide original creators');
await click('Return payment…');
await wait(`document.querySelector('[role="dialog"]')?.innerText.includes('Return this payment?')`);
await click('Back');
await click('Cancel');
assert((await rpc('account_pending',{account:recipient.address,count:100})).pending.some(entry=>entry.hash===payment.hash));
await useSigningDevice(recipient.address);
const enrolled = await rpc('account_info',{account:recipient.address});
assert.equal(enrolled.block_count,2,'enrollment must only open and assign the signing device');
assert.equal(enrolled.trst_balance,'0','enrollment accepted funds without review');
await click('Receive');
await wait(`[...document.querySelectorAll('main button')].some(button=>button.textContent.trim()==='Review' && !button.disabled)`);
await click('Review');
await click('Return payment…');
await click('Return payment');
await wait(`document.querySelector('[data-transaction-receipt]')?.innerText.includes('Transaction confirmed')`);
const returnedHash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent.trim()`);
assert.match(returnedHash,/^[0-9a-f]{64}$/);
assert.equal((await rpc('block_info',{hash:returnedHash})).confirmed,true);
const receiverInfo = await rpc('account_info',{account:recipient.address});
assert.equal(receiverInfo.verification_state,'unverified');
assert.equal(receiverInfo.trst_balance,'0');
assert.equal(receiverInfo.block_count,3,'enrollment plus return must not add an extra open or receive');
assert.equal(receiverInfo.confirmation_height,3);
assert.equal((await rpc('block_info',{hash:returnedHash})).previous,enrolled.head);
assert(!(await rpc('account_pending',{account:recipient.address,count:100})).pending.some(entry=>entry.hash===payment.hash));
const returned = (await rpc('account_pending',{account:creator.address,count:100})).pending.find(entry=>entry.hash===returnedHash);
assert.equal(returned?.amount,'17');
assert.equal(returned.timestamp,originalBurn.timestamp,'return renewed the pending payment age');
const returnedOrigins = await invoke('get_payment_origins',{rpcUrl,payment:returnedHash});
assert.equal(returnedOrigins.confirmed,true);
assert.equal(returnedOrigins.payment,returnedHash);
assert.deepEqual(returnedOrigins.provenance.origins,[{hash:payment.hash,originator:creator.address,timestamp:originalBurn.timestamp,confirmed:true,revoked:false}]);
assert.equal((await rpc('account_info',{account:creator.address})).total_brn_burned,senderBefore.total_brn_burned,'return refunded a permanent BRN burn');
const duplicate = await script(`const done=arguments[arguments.length-1];
  window.__TAURI_INTERNALS__.invoke('reject_pending',arguments[0]).then(()=>done('accepted'),error=>done(String(error)));`,[{rpcUrl,hash:payment.hash,expectedAccount:recipient.address}],true);
assert.match(duplicate,/no longer pending/);
assert.equal((await rpc('account_info',{account:recipient.address})).head,returnedHash);
await invoke('import_private_key',{hexKey:'00'.repeat(32)});
const claimed = await invoke('receive_pending',{rpcUrl,expectedAccount:creator.address,hash:returnedHash});
assert(claimed.accepted);
assert.equal(BigInt((await rpc('account_info',{account:creator.address})).trst_balance),BigInt(senderBefore.trst_balance)+17n);
const reclaimed = (await rpc('trst_portfolio',{account:creator.address})).batches.find(batch=>batch.origin===payment.hash);
assert.equal(reclaimed?.amount,'17');
assert.equal(reclaimed.origin_kind,'burn');
assert.match(reclaimed.id,/^[0-9a-f]{64}$/);
assert.equal(reclaimed.timestamp,originalBurn.timestamp,'reclaim renewed the TRST age');
const origins = await rpc('trst_origins',{origin:reclaimed.origin});
assert.equal(origins.complete,true);
assert.equal(origins.confirmed,true);
assert.deepEqual(origins.origins,[{hash:payment.hash,originator:creator.address,timestamp:originalBurn.timestamp,confirmed:true,revoked:false}]);
await invoke('lock_wallet');
const locked = await script(`const done=arguments[arguments.length-1];
  window.__TAURI_INTERNALS__.invoke('reject_pending',arguments[0]).then(()=>done('accepted'),error=>done(String(error)));`,[{rpcUrl,hash:payment.hash,expectedAccount:creator.address}],true);
assert.equal(locked,'Wallet not loaded');
console.log('PASS native return review/cancel, unopened unverified wallet, identity/lock guards, no BRN refund, unchanged recipient balance, duplicate rejection and sender reclaim');
