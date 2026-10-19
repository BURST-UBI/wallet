import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { enrollSigningDevice } from './native-certified-utils.mjs';

const target = process.env.NATIVE_APPEAL_TARGET;
const reason = process.env.NATIVE_APPEAL_REASON;
assert(['true', 'false'].includes(process.env.NATIVE_APPEAL_LEGITIMATE));
const legitimate = process.env.NATIVE_APPEAL_LEGITIMATE === 'true';
const offline = process.env.NATIVE_IDENTITY_OFFLINE === '1';
assert.match(target || '', /^brst_[a-z0-9]{60}$/);
assert(['Fraud', 'Inactivity'].includes(reason));
assert(process.env.NATIVE_RESULT_PATH);

async function script(code, args = [], async = false) {
  const response = await fetch(`${base}/execute/${async ? 'async' : 'sync'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: code, args }), signal: AbortSignal.timeout(45000),
  });
  const { value } = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}
async function invoke(command, args = {}) {
  return script(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({rejected:String(error)}));`, [command, args], true);
}
async function reject(command, args, pattern) {
  const reply = await invoke(command, args);
  assert.match(reply.rejected || 'ACCEPTED', pattern);
}
async function wait(condition) {
  for (let attempt = 0; attempt < 350; attempt++) {
    if (await script(`return ${condition}`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Desktop did not reach ${condition}; alerts: ${await script(`return [...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)`)} `);
}
async function click(text, selector = 'button') {
  assert(await script(`const button=[...document.querySelectorAll(arguments[1])].find(e=>e.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.scrollIntoView({block:'center'});button.click();return true;`, [text, selector]), text);
}
async function fill(id, value) {
  await script(`const input=document.getElementById(arguments[0]);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[1]);input.dispatchEvent(new Event('input',{bubbles:true}));`, [id, value]);
}

await script(`localStorage.setItem('burst-wallet',JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [rpcUrl]);
assert((await fetch(`${base}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).ok);
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Import Private Key');
await wait(`!!document.getElementById('wallet-private-key')`);
await fill('wallet-private-key', '00'.repeat(32));
await click('Import');
await wait(`document.body.innerText.includes('Continue without file')`);
await click('Continue without file');
await wait(`document.body.innerText.includes('Go to Dashboard')`);
await click('Go to Dashboard');
await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
const account = (await invoke('get_account_info', { rpcUrl })).value;
assert(account?.address);
const owner = account.address;
await enrollSigningDevice(owner);
const initial = await rpc('account_info', { account: owner });
const targetBefore = await rpc('account_info', { account: target });
assert.equal(targetBefore.verification_state, legitimate ? 'verified' : reason === 'Fraud' ? 'revoked' : 'deactivated');
const review = (await invoke('get_appeal_review', { rpcUrl, target })).value;
assert(review?.enabled && review.outcome && !review.challenge_active);
assert.equal(review.outcome.reason, reason);
assert.equal(review.outcome.legitimate, legitimate);
const args = { rpcUrl, expectedAccount: owner, reviewed: review };
await reject('appeal_wallet', { ...args, expectedAccount: target }, /wallet changed/i);
await reject('appeal_wallet', { ...args, reviewed: { ...review, required_stake: (BigInt(review.required_stake) + 1n).toString() } }, /outcome or stake changed/i);
await reject('appeal_wallet', { ...args, reviewed: { ...review, outcome: { ...review.outcome, hash: 'a'.repeat(64) } } }, /outcome or stake changed/i);
assert.equal((await rpc('account_info', { account: owner })).head, initial.head);

await script(`history.pushState({},'','/verification');dispatchEvent(new PopStateEvent('popstate'));`);
await wait(`!!document.getElementById('appeal-address')`);
await click('Appeal a decision', 'summary');
await fill('appeal-address', target);
await click('Find decision');
await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Review appeal'&&!b.disabled)`);
await click('Review appeal');
await wait(`!!document.querySelector('[role="dialog"]')`);
const dialog = await script(`return document.querySelector('[role="dialog"]').textContent`);
assert(dialog.includes(target) && dialog.includes(`${reason} ${legitimate ? 'dismissed' : 'confirmed'}`) && dialog.includes('BRN at risk'));
if (legitimate) {
  assert(dialog.includes(reason === 'Fraud' ? 'wallet is revoked along with its originated TRST' : 'income and transaction rights pause'));
} else {
  assert(dialog.includes('expired TRST') && dialog.includes('independent revocations'));
}
const screenshot = await fetch(`${base}/screenshot`);
const shot = await screenshot.json();
assert(screenshot.ok);
await writeFile(join(process.env.NATIVE_EVIDENCE, 'appeal-review.png'), Buffer.from(shot.value, 'base64'));
await click('Cancel', '[role="dialog"] button');
await wait(`!document.querySelector('[role="dialog"]')`);
assert.equal((await rpc('account_info', { account: owner })).head, initial.head, 'cancel staked BRN');
await wait(`document.activeElement?.textContent==='Review appeal'`);
await click('Review appeal');
await wait(`!!document.querySelector('[role="dialog"]')`);
let hash;
if (offline) {
  const actionButton = async label => {
    assert(await script(`const dialog=[...document.querySelectorAll('[role="dialog"]')].at(-1);const button=[...dialog.querySelectorAll('button')].find(button=>button.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.click();return true;`,[label]),label);
  };
  await actionButton('Sign offline');
  await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Prepare action'&&!button.disabled)`);
  await actionButton('Prepare action');
  await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Sign and save'&&!button.disabled)`);
  const preparedText=await script(`return [...document.querySelectorAll('[role="dialog"]')].at(-1).textContent`);
  assert(preparedText.includes(target)&&preparedText.includes(review.outcome.hash));
  await actionButton('Sign and save');
  await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Submit saved action'&&!button.disabled)`);
  const saved=(await invoke('get_offline_payment',{expectedAccount:owner})).value;
  assert.equal(saved.kind,'Challenge');assert(saved.can_discard);hash=saved.hash;
  assert.equal((await rpc('account_info',{account:owner})).head,initial.head);
  await actionButton('Submit saved action');
  await wait(`document.body.innerText.includes('The network confirmed this action.')`);
  assert.equal((await invoke('get_offline_payment',{expectedAccount:owner})).value,null);
  console.log('PASS native offline appeal: exact prior verdict review, saved original action, unchanged head before submission and confirmed original hash');
} else {
// Two clicks in one task exercise the synchronous duplicate-submission guard.
assert(await script(`const button=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='Stake and appeal');if(!button||button.disabled)return false;button.click();button.click();return true;`));
await wait(`!!document.querySelector('[data-transaction-receipt]') && document.querySelector('[data-transaction-receipt]').textContent.includes('Transaction confirmed')`);
hash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent`);
}
assert.match(hash, /^[a-f0-9]{64}$/);
const after = await rpc('account_info', { account: owner });
assert.equal(after.head, hash);
assert.equal(Number(after.block_count), Number(initial.block_count) + 1, 'duplicate appeal block');
assert.equal((await rpc('account_info', { account: target })).verification_state, targetBefore.verification_state, 'admission prematurely reversed the verdict');
assert.equal(BigInt(after.total_brn_staked) - BigInt(initial.total_brn_staked), BigInt(review.required_stake));
assert.equal((await invoke('get_appeal_review', { rpcUrl, target })).value.challenge_active, true);
await reject('appeal_wallet', args, /review is already active/i);
assert.equal((await rpc('account_info', { account: owner })).head, hash);
await invoke('lock_wallet');
await reject('appeal_wallet', args, /^appeal not submitted: Wallet not loaded$/);
await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({ hash, accepted: true }));
console.log(`PASS native appeal: reviewed signer/outcome/stake, cancellation and focus, ${offline ? 'saved original action' : 'double-click guard'}, confirmed admission, unchanged verdict, active-review and locked-wallet rejection`);
