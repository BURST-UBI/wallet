import assert from 'node:assert/strict';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rpc, rpcUrl } from './native-env.mjs';
import { confirmed, fixture, invoke } from './native-certified-utils.mjs';
import { signedBlockJson } from './offline-envelope.mjs';

assert.equal((await rpc('node_info')).network, 'test');
const owner = await fixture(42);
assert.equal(await invoke('get_offline_payment', {expectedAccount:owner.address}), null);
const reviewed = await invoke('get_constitution_context', {rpcUrl});
const params = await rpc('protocol_params');
const current = params.governable_parameters.find(p => p.name === 'min_verifier_brn_balance').current;
const proposal = await confirmed(await invoke('propose_parameter', {
  rpcUrl, expectedAccount:owner.address, expectedRevision:reviewed.revision,
  parameter:'min_verifier_brn_balance', newValue:current === '1' ? '2' : '1',
}));
const oldProposal = JSON.parse(await readFile(process.env.NATIVE_RESULT_PATH, 'utf8'));
assert.notEqual(proposal, oldProposal.hash);
console.log('PASS separately reviewed proposal confirms after certified exclusion');

const sender = await fixture(100);
const source = process.env.NATIVE_RECOVER_PAYMENT;
const saved = await readFile(source, 'utf8');
const signed = signedBlockJson(saved);
const block = JSON.parse(signed);
assert.equal(block.account, sender.address);
assert.equal(block.block_type, 'Burn');
const draft = Buffer.from(block.hash).toString('hex');
const before = await rpc('account_info', {account:sender.address});
assert.equal(before.head, Buffer.from(block.previous).toString('hex'));
const directory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments');
assert.equal(await invoke('get_offline_payment', {expectedAccount:sender.address}), null);
await copyFile(source, join(directory, `${sender.address}.json`));
await copyFile(join(dirname(source), `attempted-${draft}.marker`), join(directory, `attempted-${draft}.marker`));
const pending = await invoke('get_offline_payment', {expectedAccount:sender.address});
assert.equal(pending.hash, draft);
assert.equal(pending.can_discard, false);
await assert.rejects(invoke('pay', {rpcUrl, expectedAccount:sender.address, provider:owner.address, amount:'1'}), /offline|pending/i);
const resolution = await invoke('resolve_offline_payment', {rpcUrl, expectedAccount:sender.address, expectedHash:draft});
assert.equal(resolution.status, 'excluded');
assert.equal(resolution.confirmed_successor, null);
assert.equal(await invoke('get_offline_payment', {expectedAccount:sender.address}), null);
const completed = join(directory, 'completed', sender.address);
const archives = (await readdir(completed)).filter(name => name.endsWith(`-${draft}.json`));
assert.equal(archives.length, 1);
assert.equal(await readFile(join(completed, archives[0]), 'utf8'), saved);
// A separate user-authorized payment follows resolution; no automatic retry.
const payment = await confirmed(await invoke('pay', {
  rpcUrl, expectedAccount:sender.address, provider:owner.address, amount:'1',
}));
assert.notEqual(payment, draft);
await writeFile(`${process.env.NATIVE_RESULT_PATH}.followthrough`, JSON.stringify({
  proposal, old_proposal:oldProposal.hash, account:sender.address, receiver:owner.address,
  draft, payment, previous:before.head,
}), {flag:'wx', mode:0o600});
console.log('PASS retained dropped payment excluded, byte-exact archive, separately reviewed payment confirmed');
