// Real WebKit form -> Tauri signer -> confirmed Dev ledger -> receipt.
import assert from 'node:assert/strict';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { useSigningDevice } from './native-certified-consumer-ui.mjs';

async function script(code, args = [], async = false) {
  const response = await fetch(`${base}/execute/${async ? 'async' : 'sync'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: code, args }), signal: AbortSignal.timeout(45000),
  });
  const { value } = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}
async function wait(condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await script(`return ${condition}`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Native payment UI did not reach: ${condition}`);
}
async function click(text) {
  assert(await script(`const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === arguments[0]);
    if (!button || button.disabled) return false; button.click(); return true;`, [text]), `Unavailable button: ${text}`);
}
async function fill(id, value) {
  assert(await script(`const input = document.getElementById(arguments[0]); if (!input || input.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, arguments[1]);
    input.dispatchEvent(new Event('input', { bubbles: true })); return true;`, [id, value]), `Unavailable input: ${id}`);
}

const receiver = await script(`const done = arguments[arguments.length - 1];
  (async () => {
    const created = await window.__TAURI_INTERNALS__.invoke('create_wallet');
    await window.__TAURI_INTERNALS__.invoke('lock_wallet');
    return created.address;
  })().then(done, error => done({ error: String(error) }));`, [], true);
// Keep the account head stable while checking that review/cancel cannot sign.
await script(`localStorage.setItem('burst-wallet', JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [rpcUrl]);
await fetch(`${base}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Import Private Key');
await wait(`!!document.querySelector('#wallet-private-key')`);
// Public disposable Dev genesis key. Never use a user's key in this test.
await fill('wallet-private-key', '00'.repeat(32));
await click('Import');
await wait(`document.body.innerText.includes('Continue without file')`);
await click('Continue without file');
await wait(`document.body.innerText.includes('Go to Dashboard')`);
await click('Go to Dashboard');
await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
const creator = await script(`return document.querySelector('.wallet-identity p[title]').getAttribute('title')`);
await useSigningDevice(creator);
const before = await rpc('account_info', { account: creator });
await click('Pay');
await wait(`!!document.querySelector('#provider') && !document.querySelector('#provider').disabled`);
await fill('provider', receiver);
await fill('pay-amount', '0.000000000000000001');
await click('Pay');
await wait(`!!document.querySelector('[role="dialog"]')`);
assert.equal((await rpc('account_info', { account: creator })).head, before.head, 'review signed a payment');
await click('Cancel');
await wait(`!document.querySelector('[role="dialog"]')`);
assert.equal((await rpc('account_info', { account: creator })).head, before.head, 'cancellation signed a payment');
await click('Pay');
await wait(`!!document.querySelector('[role="dialog"]')`);
await click('Confirm Payment');
await wait(`document.querySelector('[data-transaction-receipt]')?.textContent.includes('Transaction confirmed')`);
const hash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent.trim()`);
assert.match(hash, /^[0-9a-f]{64}$/);
assert.equal((await rpc('block_info', { hash })).confirmed, true);
const pending = await rpc('account_pending', { account: receiver, count: 100 });
const payment = pending.pending.find(item => item.hash === hash);
assert(payment, 'receipt has no matching receiver pending entry');
assert.equal(payment.amount, '1', '18-decimal form amount changed before signing');
assert.equal(payment.source, creator);
assert.equal(await script(`return document.activeElement === document.querySelector('[data-transaction-receipt]')`), true);
await click('Lock wallet');
await wait(`document.body.innerText.includes('Create New Wallet')`);
assert.equal(await script(`const done = arguments[arguments.length - 1];
  window.__TAURI_INTERNALS__.invoke('is_locked').then(done, error => done({error:String(error)}));`, [], true),
  true, 'Lock button navigated away without locking the native signer');
console.log('PASS native payment form, review/cancel without signing, exact raw-unit amount, confirmed ledger receipt, focus and UI-to-native lock');
