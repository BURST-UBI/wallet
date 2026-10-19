import assert from 'node:assert/strict';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { fixture, invoke } from './native-certified-utils.mjs';
import { signedBlockJson } from './offline-envelope.mjs';
import { dropProcessProxy } from './drop-process-proxy.mjs';
import { script, wait, click, fill } from './native-ui.mjs';

assert.equal((await rpc('node_info')).network, 'test');
// Importing recovery material must not advance the account before resolving it.
const owner = await fixture(42, {enroll:false});
const source = process.env.NATIVE_RECOVER_ACTION;
assert(source && process.env.NATIVE_RESULT_PATH);
const saved = await readFile(source, 'utf8');
const block = JSON.parse(signedBlockJson(saved));
const hash = Buffer.from(block.hash).toString('hex');
const expectedSuccessor = process.env.NATIVE_RECOVER_SUCCESSOR;
if (expectedSuccessor) {
  assert.match(expectedSuccessor, /^[0-9a-f]{64}$/);
  assert.notEqual(expectedSuccessor, hash);
  const successor = await rpc('block_info', {hash:expectedSuccessor});
  assert.equal(successor.confirmed, true);
  assert.equal(successor.account, block.account);
  assert.equal(successor.previous, Buffer.from(block.previous).toString('hex'));
}
assert.equal(block.account, owner.address);
assert(['GovernanceProposal', 'Burn'].includes(block.block_type));
const payment = block.block_type === 'Burn';
const directory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments');
const completed = join(directory, 'completed', owner.address);
await copyFile(source, join(directory, `${owner.address}.json`));
await copyFile(join(dirname(source), `attempted-${hash}.marker`), join(directory, `attempted-${hash}.marker`));
const pending = await invoke('get_offline_payment', {expectedAccount:owner.address});
assert.equal(pending.hash, hash);
assert.equal(pending.can_discard, false);
assert.equal(pending.kind, block.block_type);
assert.equal(pending.can_review_payment, payment);
await assert.rejects(invoke('pay', {rpcUrl, expectedAccount:owner.address, provider:owner.address, amount:'1'}), /offline|pending|Set up this signing device/i);
const device = await invoke('signing_device_status',{rpcUrl,expectedAccount:owner.address});
await assert.rejects(invoke('take_over_signing',{rpcUrl,expectedAccount:owner.address,
  reviewedHead:device.head,reviewedGrant:device.grant,reviewedParams:device.params_hash}),/offline|pending/i);
console.log('PASS restored action: exact uncertain hash retained and duplicate signing blocked');
const proxy = await dropProcessProxy(rpcUrl);
let resolution;
try {
  await invoke('lock_wallet');
  await script(`history.replaceState({}, '', '/onboarding');
    localStorage.setItem('burst-wallet', JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [proxy.url]);
  const refreshed = await fetch(`${base}/refresh`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:'{}',
    signal:AbortSignal.timeout(45000),
  });
  assert(refreshed.ok, 'Native refresh failed');
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');
  await wait(`!!document.getElementById('wallet-private-key')`);
  await fill('wallet-private-key', '2a'.repeat(32)); // Public disposable Test identity.
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  await click('Go to Dashboard');
  await wait(`!!document.querySelector('.wallet-identity p[title]')`);
  assert.equal(await script(`return document.querySelector('.wallet-identity p[title]').getAttribute('title')`), owner.address);
  await script(`history.pushState({}, '', '/pay/offline');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`document.body.innerText.includes(${JSON.stringify(payment ? hash : 'Proposal awaiting confirmation')})`);
  assert.equal(await script(`return document.querySelector('h1')?.textContent`), payment ? 'Pay offline' : 'Recover transaction');
  assert.equal(await script(`return [...document.querySelectorAll('button')].some(b => /Discard/.test(b.textContent))`), false);
  assert.equal(await script(`return [...document.querySelectorAll('button')].some(b => b.textContent === 'Review and submit')`), payment);
  assert.equal(await script(`return document.body.innerText.includes(arguments[0])`, [hash]), true);
  const screenshot = await fetch(`${base}/screenshot`, {signal:AbortSignal.timeout(45000)});
  assert(screenshot.ok, 'Native recovery screenshot failed');
  const {value:png} = await screenshot.json();
  assert.equal(typeof png, 'string');
  await writeFile(`${process.env.NATIVE_RESULT_PATH}.png`, Buffer.from(png, 'base64'), {flag:'wx',mode:0o600});
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await click('Check confirmation');
    await wait(`!!document.querySelector('[role="alert"]') || !!document.querySelector('[role="status"]')`);
    const remaining = await invoke('get_offline_payment', {expectedAccount:owner.address});
    if (!remaining) {
      const names = (await readdir(completed)).filter(name => name.endsWith(`-${hash}.json`));
      assert.equal(names.length, 1);
      resolution = {status:names[0].split('-')[0]};
      break;
    }
    assert.equal(remaining.hash, hash);
    assert.equal(remaining.can_discard, false);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(proxy.dropped, 0, 'Recovery attempted a process submission');
  assert(resolution, 'Action remains unresolved after restart');
  const messages = payment ? {
    confirmed:'Payment confirmed.',
    excluded:'The network advanced before this payment was applied. You can prepare a new payment.',
    superseded:'A different transaction was confirmed. This saved payment was not applied.',
  } : {
    confirmed:'Transaction confirmed.',
    excluded:'This transaction was not applied. Return to its original screen to review a new action.',
    superseded:'A different transaction was confirmed in its place. Review your current state before starting again.',
  };
  assert(messages[resolution.status], 'Unexpected archive disposition');
  await wait(`document.body.innerText.includes(${JSON.stringify(messages[resolution.status])})`);
  if (!payment) assert.equal(await script(`return [...document.querySelectorAll('button')].some(b => b.textContent === 'Prepare offline payment')`), false);
  if (resolution.status !== 'confirmed') {
    assert.equal(await script(`return document.body.innerText.includes('Transaction confirmed.')`), false);
  }
} finally { await proxy.close(); }
assert(['confirmed', 'excluded', 'superseded'].includes(resolution.status));
assert.equal(await invoke('get_offline_payment', {expectedAccount:owner.address}), null);
const archives = (await readdir(completed)).filter(name => name.endsWith(`-${hash}.json`));
assert.equal(archives.length, 1);
if (expectedSuccessor) {
  assert.equal(resolution.status, 'superseded');
  assert.equal(archives[0], `superseded-by-${expectedSuccessor}-${hash}.json`);
}
assert.equal(await readFile(join(completed, archives[0]), 'utf8'), saved);
await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({account:owner.address, hash, resolution}), {flag:'wx',mode:0o600});
console.log(`PASS rendered native ${block.block_type} recovery: ${resolution.status}, byte-exact archive after node/app restart, no resubmission or replacement`);
if (process.env.NATIVE_RECOVER_PAYMENT) await import('./native-recovery-followthrough.mjs');
