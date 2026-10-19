import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Operator-pinned acceptance baseline, not a peer-advertised readiness oracle.
const [referencePath, url, mode] = process.argv.slice(2);
assert(mode === undefined || mode === '--online-signing');
const requireOnline = mode === '--online-signing';
assert(referencePath && url, 'Provide a pinned reference JSON and local RPC URL');
const endpoint = new URL(url);
assert.equal(endpoint.hostname, '127.0.0.1');
assert.equal(endpoint.protocol, 'http:');
const reference = JSON.parse(await readFile(referencePath, 'utf8'));
assert.match(reference.payment_epoch, /^[0-9a-f]{64}$/);
assert(Array.isArray(reference.accounts) && reference.accounts.length > 0);
for (const account of reference.accounts) {
  assert.match(account.account, /^brst_[a-z0-9]{60}$/);
  assert.match(account.head, /^[0-9a-f]{64}$/);
}
async function rpc(action, args = {}) {
  const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action, ...args}), signal:AbortSignal.timeout(5000)});
  const body = await response.json();
  assert(response.ok && !body.error, JSON.stringify(body));
  return body.result ?? body;
}
const started = Date.now();
const deadline = started + 180000;
let observation = 'no response';
let lastStatus;
while (Date.now() < deadline) {
  let readinessViolation;
  try {
    const node = await rpc('node_info');
    assert.equal(node.network, 'test');
    assert(Number.isInteger(node.peer_count) && node.peer_count > 0,
      'Pinned state is available, but the observer has no connected peer');
    const before = await rpc('params_hash');
    if (requireOnline) {
      const status = `${before.online_signing}:${before.payment_epoch}`;
      if (status !== lastStatus) console.log(`SYNC ${status}`);
      lastStatus = status;
    }
    observation = `epoch ${before.payment_epoch}`;
    if (requireOnline && before.online_signing === 'peer_matches' && before.payment_epoch !== reference.payment_epoch) {
      readinessViolation = `Premature signing readiness at ${before.payment_epoch}; pinned epoch is ${reference.payment_epoch}`;
    }
    if (before.payment_epoch === reference.payment_epoch && (!requireOnline || before.online_signing === 'peer_matches')) {
      let matches = true;
      for (const expected of reference.accounts) {
        const account = await rpc('account_info', {account:expected.account});
        const block = await rpc('block_info', {hash:expected.head});
        if (account.head !== expected.head || !block.confirmed || block.account !== expected.account) {
          matches = false;
          observation = `account ${expected.account} has not reached its pinned confirmed head`;
          break;
        }
      }
      const after = await rpc('params_hash');
      if (matches && after.payment_epoch === reference.payment_epoch && (!requireOnline || after.online_signing === 'peer_matches')) {
        console.log(`PASS pinned certified epoch and confirmed account heads${requireOnline ? ' with online signing readiness' : ''} in ${Date.now() - started}ms`);
        process.exit(0);
      }
    }
  } catch (error) {
    observation = error.message;
  }
  assert(!readinessViolation, readinessViolation);
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.fail(`Pinned reference not reached within 180 seconds: ${observation}`);
