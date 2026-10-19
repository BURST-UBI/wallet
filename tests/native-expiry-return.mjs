import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { enrollSigningDevice } from './native-certified-utils.mjs';

const source = process.env.NATIVE_RETURN_SOURCE;
assert.match(source || '', /^[0-9a-f]{64}$/);
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
  assert.fail(`Return UI did not reach ${condition}; alerts: ${await script(`return [...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)`)} `);
}
async function click(text, selector = 'button') {
  assert(await script(`const button=[...document.querySelectorAll(arguments[1])].find(e=>e.textContent.trim()===arguments[0]);if(!button||button.disabled)return false;button.scrollIntoView({block:'center'});button.focus();button.click();return true;`, [text, selector]), text);
}

await script(`localStorage.setItem('burst-wallet',JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [rpcUrl]);
assert((await fetch(`${base}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).ok);
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Import Private Key');
await wait(`!!document.getElementById('wallet-private-key')`);
// Public disposable Dev genesis key, not a user's wallet.
await script(`const input=document.getElementById('wallet-private-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'00'.repeat(32));input.dispatchEvent(new Event('input',{bubbles:true}));`);
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
const burn = await rpc('block_info', { hash: source });
const beforePortfolio = await rpc('trst_portfolio', { account: owner });
const pending = await rpc('account_pending', { account: owner, count: 100 });
const receipt = pending.pending.find(entry => entry.hash === source);
assert.equal(receipt?.return_credit, true);
assert.equal(receipt.amount, '7');
const args = { rpcUrl, expectedAccount: owner, hash: source };
await reject('receive_pending', { ...args, expectedAccount: source }, /wallet changed/i);
await reject('reject_pending', args, /receive the credit/i);
assert.equal((await rpc('account_info', { account: owner })).head, initial.head);

await click('Receive');
await wait(`[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='Review'&&!b.disabled)`);
assert(await script(`return document.querySelector('main').textContent.includes('Returned funds')`));
assert(await script(`return document.querySelector('main').textContent.includes('<0.000001 TRST')`));
const listScreenshot = await fetch(`${base}/screenshot`);
const listShot = await listScreenshot.json();
assert(listScreenshot.ok);
await writeFile(join(process.env.NATIVE_EVIDENCE, 'expiry-return-list.png'), Buffer.from(listShot.value, 'base64'));
await click('Review');
await wait(`!!document.querySelector('[role="dialog"]')`);
const review = await script(`return document.querySelector('[role="dialog"]').textContent`);
assert(review.includes('Claim returned funds') && review.includes(source) && review.includes('0.000000000000000007'));
assert(review.includes('Expiry and revocation still apply'));
assert(!review.includes('Return payment…'));
await click('View original creators');
await wait(`!!document.querySelector('[role="dialog"] [aria-label="Original BRN payments"] li')`);
assert(await script(`return document.querySelector('[role="dialog"] [aria-label="Original creators"]').textContent.includes(arguments[0]);`, [owner]));
const screenshot = await fetch(`${base}/screenshot`);
const shot = await screenshot.json();
assert(screenshot.ok);
await writeFile(join(process.env.NATIVE_EVIDENCE, 'expiry-return-review.png'), Buffer.from(shot.value, 'base64'));
await click('Cancel', '[role="dialog"] button');
await wait(`!document.querySelector('[role="dialog"]')`);
assert.equal((await rpc('account_info', { account: owner })).head, initial.head, 'review or cancellation signed a claim');
await wait(`document.activeElement?.textContent==='Review'`);
await click('Review');
await wait(`!!document.querySelector('[role="dialog"]')`);
assert(await script(`const button=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='Claim');if(!button||button.disabled)return false;button.click();button.click();return true;`));
await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Returned funds claimed.')`);
const after = await rpc('account_info', { account: owner });
assert.match(after.head, /^[0-9a-f]{64}$/);
assert.equal(Number(after.block_count), Number(initial.block_count) + 1, 'duplicate return claim');
assert.equal(BigInt(after.trst_balance), BigInt(initial.trst_balance) + 7n);
assert.equal(after.total_brn_burned, initial.total_brn_burned, 'return refunded the BRN burn');
const block = await rpc('block_info', { hash: after.head });
assert.equal(block.confirmed, true);
assert.equal(block.block_type, 'Receive');
const afterPortfolio = await rpc('trst_portfolio', { account: owner });
assert.deepEqual(afterPortfolio.batches, beforePortfolio.batches, 'claim created another holding or changed its origin/age');
assert(afterPortfolio.batches.some(batch => batch.origin === source && batch.timestamp === burn.timestamp));
assert(!(await rpc('account_pending', { account: owner, count: 100 })).pending.some(entry => entry.hash === source));
await reject('receive_pending', args, /not pending for this wallet/i);
assert.equal((await rpc('account_info', { account: owner })).head, after.head);
await click('Done', '[role="dialog"] button');
await wait(`!document.querySelector('[role="dialog"]')`);
await invoke('lock_wallet');
await reject('receive_pending', args, /Wallet not loaded/);
await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({ hash: after.head, accepted: true }));
console.log('PASS native expired return: exact amount, provenance review, cancel/focus, signer/lock guards, double-click claim, confirmed receipt, unchanged holdings/origin/age and no BRN refund');
