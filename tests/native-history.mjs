import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {base, rpcUrl, rpc} from './native-env.mjs';

const expected = JSON.parse(await readFile(process.env.NATIVE_HISTORY_REFERENCE, 'utf8')).result;
assert(expected?.history.length > 25 && !expected.cursor, 'Provide complete archival history with multiple UI pages');
async function script(code, args = []) {
  const response = await fetch(`${base}/execute/sync`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({script:code, args}), signal:AbortSignal.timeout(45000),
  });
  const {value} = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}
async function wait(condition) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await script(`return ${condition}`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const diagnostic = await script(`return {path:location.pathname, entries:document.querySelectorAll('main details').length, alerts:[...document.querySelectorAll('[role="alert"]')].map(el => el.textContent)}`);
  assert.fail(`Activity screen did not reach: ${condition}; ${JSON.stringify(diagnostic)}`);
}
async function click(text) {
  assert(await script(`const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === arguments[0]);
    if (!button || button.disabled) return false; button.click(); return true;`, [text]), `Unavailable button: ${text}`);
}
const before = await rpc('account_info', {account:expected.account});
assert(before.block_count > 25 && before.block_count <= expected.history.length);
assert.equal(before.confirmation_height, before.block_count);
// The retained snapshot can precede later archival activity. Pin the comparison
// to its exact confirmed head rather than claiming those later blocks exist here.
expected.history = expected.history.slice(0, before.block_count);
assert.equal(expected.history.at(-1).hash, before.head);
await script(`localStorage.setItem('burst-wallet', JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [rpcUrl]);
await fetch(`${base}/refresh`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Import Private Key');
await wait(`!!document.querySelector('#wallet-private-key')`);
// Published disposable Test seed, never a user-owned secret.
await script(`const input = document.querySelector('#wallet-private-key');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2a'.repeat(32));
  input.dispatchEvent(new Event('input', {bubbles:true}));`);
await click('Import');
await wait(`document.body.innerText.includes('Continue without file')`);
await click('Continue without file');
await wait(`document.body.innerText.includes('Go to Dashboard')`);
await click('Go to Dashboard');
await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
assert.equal(await script(`return document.querySelector('.wallet-identity p[title]').getAttribute('title')`), expected.account);
assert(await script(`const link = document.querySelector('a[href="/history"]'); if (!link) return false; link.click(); return true;`));
const readEntries = () => script(`return [...document.querySelectorAll('main details')].map(row => {
  const fields = Object.fromEntries([...row.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  return {hash:fields.Block, account:fields.Account, block_type:fields.Operation, amount:fields['TRST balance (raw units)']};
});`);
const lastOffset = Math.floor((expected.history.length - 1) / 25) * 25;
const offsets = [];
for (let offset = 0; offset <= lastOffset; offset += 25) offsets.push(offset);
for (let offset = lastOffset - 25; offset >= 0; offset -= 25) offsets.push(offset);
for (const [index, offset] of offsets.entries()) {
  const end = Math.min(offset + 25, expected.history.length);
  await wait(`document.querySelector('[aria-label="Activity pages"] [role="status"]')?.textContent === 'Entries ${offset + 1}–${end}'`);
  assert.deepEqual(await readEntries(), expected.history.slice(offset, end).map(({hash, account, block_type, amount}) => ({hash, account, block_type, amount})));
  assert.equal(await script(`return !!document.querySelector('main [role="alert"]')`), false);
  assert.equal(await script(`return [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Previous').disabled`), offset === 0);
  assert.equal(await script(`return [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next').disabled`), offset === lastOffset);
  if (index < offsets.length - 1) await click(offsets[index + 1] > offset ? 'Next' : 'Previous');
}
const after = await rpc('account_info', {account:expected.account});
for (const field of ['head','block_count','confirmation_height','total_brn_burned','total_brn_staked','trst_balance','trst_expired','trst_revoked']) {
  assert.deepEqual(after[field], before[field], `read-only activity changed ${field}`);
}
await click('Lock wallet');
await wait(`document.body.innerText.includes('Create New Wallet')`);
console.log('PASS installed bounded Activity pages match archival history in both directions without signing');
