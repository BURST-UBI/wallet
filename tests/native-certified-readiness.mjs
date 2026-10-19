import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rpc } from './native-env.mjs';
import { invoke, unit } from './native-certified-utils.mjs';
import { createBackedWallet, importTestIdentity, payWithReview, restoreWallet, receiveWithReview } from './native-certified-consumer-ui.mjs';
import { processEvidenceProxy } from './process-evidence-proxy.mjs';

assert.equal(process.env.NATIVE_CERTIFIED_ONBOARDING, '1');
const unready = new URL(process.env.NATIVE_UNREADY_RPC_URL);
assert.equal(unready.protocol, 'http:');
assert.equal(unready.hostname, '127.0.0.1');
async function unreadyRpc(action) {
  const response = await fetch(unready, {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action}), signal:AbortSignal.timeout(5000)});
  const body = await response.json();
  assert(response.ok && !body.error, JSON.stringify(body));
  return body.result ?? body;
}
assert.equal((await unreadyRpc('node_info')).network, 'test');
assert(['unknown', 'catching_up', 'peer_differs'].includes((await unreadyRpc('params_hash')).online_signing));
assert.equal((await rpc('params_hash')).online_signing, 'peer_matches');
const backup = join(process.env.NATIVE_EVIDENCE, 'readiness-recipient.json');
const recipient = await createBackedWallet(backup);
const account = await importTestIdentity(42);
const evidencePath = join(process.env.NATIVE_EVIDENCE, 'unready-process.jsonl');
const proxy = await processEvidenceProxy(unready.href, evidencePath);
try {
  assert.equal(await invoke('get_offline_payment', {expectedAccount:account}), null);
  await assert.rejects(invoke('pay', {rpcUrl:proxy.url, expectedAccount:account,
    provider:recipient.address, amount:(unit / 1000n).toString()}), /synchronization is not ready/);
  assert.equal(await invoke('get_offline_payment', {expectedAccount:account}), null,
    'Unready signing must not create an unresolved payment');
  let requests = '';
  try { requests = await readFile(evidencePath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(requests, '', 'Unready signing reached process submission');
} finally { await proxy.close(); }
assert(['unknown', 'catching_up', 'peer_differs'].includes((await unreadyRpc('params_hash')).online_signing));
const payment = await payWithReview(account, recipient.address, '0.001', (unit / 1000n).toString());
await restoreWallet(backup, recipient.address);
await receiveWithReview(recipient.address, [payment]);
assert.equal((await invoke('get_trst_balance', {rpcUrl:process.env.NODE_RPC_URL})).active, (unit / 1000n).toString());
await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({account, recipient:recipient.address, payment,
  unready_submission:false, confirmed_receive:true}, null, 2));
console.log('PASS installed wallet refuses unready signing without submission or journal, then confirms reviewed payment and receive through a synchronized node');
