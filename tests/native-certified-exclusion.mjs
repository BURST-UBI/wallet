// Real native commands and normal Test nodes. The only fault injection is a
// dropped process request; epoch closure must come from ordinary governance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rpc, rpcUrl } from './native-env.mjs';
import { invoke, until, confirmed, fixture, enrollSigningDevice } from './native-certified-utils.mjs';
import { signedBlockJson } from './offline-envelope.mjs';
import { dropProcessProxy } from './drop-process-proxy.mjs';

async function finishPayment(report, state) {
  await writeFile(`${report}.resolved`, JSON.stringify(state), {flag:'wx',mode:0o600});
  // Epoch activation and peer agreement are separate boundaries. No payment
  // is signed or retried while waiting for the existing admission prerequisite.
  await until(async () => {
    const context = await rpc('params_hash');
    return context.payment_epoch === state.installed_epoch && context.online_signing === 'peer_matches';
  }, 180);
  if (state.opening) await enrollSigningDevice(state.account);
  const payment = await confirmed(state.opening
    ? await invoke('receive_pending', {rpcUrl, expectedAccount:state.account, hash:state.incoming})
    : await invoke('pay', {rpcUrl, expectedAccount:state.account, provider:state.receiver, amount:'1'}));
  assert.notEqual(payment, state.draft);
  await writeFile(report, JSON.stringify({...state,payment,enrollment_opening:state.opening === true}), {flag:'wx',mode:0o600});
  console.log('PASS native closed-epoch recovery followthrough: separately reviewed payment confirmed after signing readiness');
}

async function main() {
assert.equal(process.env.NATIVE_CERTIFIED_ONBOARDING, '1');
const report = process.env.NATIVE_RESULT_PATH;
const phase = process.env.NATIVE_EXCLUSION_PHASE || 'all';
assert(['all', 'prepare', 'recover', 'followthrough'].includes(phase));
const baseline = phase === 'followthrough' ? process.env.NATIVE_EXCLUSION_BASE_REPORT : report;
assert(baseline);
const resumed = ['recover','followthrough'].includes(phase) ? JSON.parse(await readFile(`${baseline}.prepared`, 'utf8')) : null;
if (resumed) assert.equal(await invoke('is_locked'), true, 'Restarted native app retained an unlocked signer');
else await writeFile(`${report}.progress`, '{}', { flag: 'wx', mode: 0o600 });
const owner = await fixture(42);
const online = process.env.NATIVE_ONLINE_EXCLUSION === '1';
const opening = process.env.NATIVE_OPENING_EXCLUSION === '1';
assert(!opening || !online, 'Opening exclusion exercises the first enrollment Open');
const senderSeed = opening ? 213 : 100;
const sender = await fixture(senderSeed, {enroll:!opening && !resumed});
if (resumed) assert.deepEqual([resumed.owner, resumed.sender, resumed.online, resumed.opening], [owner.address, sender.address, online, opening]);
let incoming = resumed?.incoming;
if (opening && !resumed) {
  await assert.rejects(rpc('account_info', { account: sender.address }), /not found/i);
  await fixture(42);
  incoming = await confirmed(await invoke('pay', {rpcUrl, expectedAccount:owner.address, provider:sender.address, amount:'1'}));
  await fixture(senderSeed, {enroll:false});
}
const accountState = async () => {
  if (!opening) return rpc('account_info', {account:sender.address});
  await assert.rejects(rpc('account_info', {account:sender.address}), /not found/i);
  const ownerState = await rpc('account_info', {account:owner.address});
  return {head:'0'.repeat(64), payment_epoch:ownerState.payment_epoch};
};
const before = resumed?.before || await accountState();
if (!opening) assert.equal(before.verification_state, 'verified');
let draft = resumed?.draft;
if (phase === 'followthrough') {
  const progress = JSON.parse(await readFile(`${baseline}.progress`, 'utf8'));
  assert.deepEqual([progress.account,progress.draft,progress.previous,progress.epoch],
    [sender.address,draft,before.head,before.payment_epoch]);
  const completed = join(process.env.XDG_DATA_HOME,'com.burst.wallet','offline-payments','completed',sender.address);
  const names = (await readdir(completed)).filter(name => name.endsWith(`-${draft}.json`));
  assert.equal(names.length,1);
  assert.match(names[0], /^excluded-by-epoch-[a-f0-9]{64}-[a-f0-9]{64}\.json$/);
  const archived = await readFile(join(completed,names[0]),'utf8');
  assert.equal(createHash('sha256').update(archived).digest('hex'),resumed.savedHash);
  assert.equal(Buffer.from(JSON.parse(signedBlockJson(archived)).hash).toString('hex'),draft);
  assert.equal(await invoke('get_offline_payment',{expectedAccount:sender.address}),null);
  const after = await accountState();
  assert.equal(after.head,before.head,'An intervening transaction requires another review');
  assert.notEqual(after.payment_epoch,before.payment_epoch);
  assert.notEqual(names[0].slice('excluded-by-epoch-'.length, 'excluded-by-epoch-'.length + 64),before.payment_epoch);
  assert.equal((await rpc('governance_proposal_info',{hash:progress.proposal})).phase,'Activated');
  console.log('PASS retained exclusion revalidated: exact archived draft, unchanged account slot and activated governance');
  await finishPayment(report,{account:sender.address,receiver:owner.address,draft,proposal:progress.proposal,
    previous:before.head,closed_epoch:before.payment_epoch,installed_epoch:after.payment_epoch,
    opening,incoming,continued_from:baseline});
  return;
}
if (!resumed) {
if (!opening && !online) {
  const context = await invoke('prepare_offline_payment', { rpcUrl, expectedAccount: sender.address });
  draft = await invoke('sign_offline_payment', { context, expectedAccount: sender.address, provider: owner.address, amount: '1' });
}
const proxy = await dropProcessProxy(rpcUrl);
try {
  if (opening) {
    const review = await invoke('signing_device_status',{rpcUrl,expectedAccount:sender.address});
    assert.equal(review.head,'0'.repeat(64));
    await assert.rejects(invoke('take_over_signing',{rpcUrl:proxy.url,expectedAccount:sender.address,
      reviewedHead:review.head,reviewedGrant:review.grant,reviewedParams:review.params_hash}),/submission response unavailable/);
    const pending = await invoke('get_offline_payment',{expectedAccount:sender.address});
    assert.equal(pending.kind,'Open');
    draft = pending.hash;
  } else if (online) {
    await assert.rejects(invoke('pay', { rpcUrl: proxy.url, expectedAccount: sender.address,
      provider: owner.address, amount: '1' }), /submission response unavailable/);
    draft = (await invoke('get_offline_payment', { expectedAccount: sender.address })).hash;
  } else {
    await assert.rejects(invoke('submit_offline_payment', { rpcUrl: proxy.url,
      expectedAccount: sender.address, expectedHash: draft }), /submission response unavailable/);
  }
  assert.equal(proxy.dropped, 1);
} finally {
  await proxy.close();
}
}
const saved = await readFile(join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments', `${sender.address}.json`), 'utf8');
const savedHash = createHash('sha256').update(saved).digest('hex');
if (resumed) assert.equal(savedHash, resumed.savedHash, 'Restart changed the uncertain signed draft');
// Preserve the original raw u128 JSON tokens. Only the byte-array hash is read
// through JavaScript numbers; never stringify parsed block balances.
const signedBlock = signedBlockJson(saved);
assert.equal(Buffer.from(JSON.parse(signedBlock).hash).toString('hex'), draft);
assert.equal((await invoke('get_offline_payment', { expectedAccount: sender.address })).can_discard, false);
await assert.rejects(invoke('resolve_offline_payment', { rpcUrl, expectedAccount: sender.address, expectedHash: draft }), /unresolved/);
assert.equal((await accountState()).head, before.head);
if (opening) {
  const review = await invoke('signing_device_status',{rpcUrl,expectedAccount:sender.address});
  await assert.rejects(invoke('take_over_signing',{rpcUrl,expectedAccount:sender.address,
    reviewedHead:review.head,reviewedGrant:review.grant,reviewedParams:review.params_hash}),/offline|pending/i);
} else {
  await assert.rejects(invoke('pay', {rpcUrl,expectedAccount:sender.address,provider:owner.address,amount:'1'}),/offline|pending/i);
}
if (phase === 'prepare') {
  await writeFile(`${report}.prepared`, JSON.stringify({owner:owner.address,sender:sender.address,online,opening,incoming,draft,savedHash,
    before:{head:before.head,payment_epoch:before.payment_epoch,verification_state:before.verification_state}}), {flag:'wx',mode:0o600});
  console.log('PASS uncertain action prepared for native app restart; exact draft recorded and duplicate signing blocked');
  return;
}
if (resumed) console.log('PASS native app restart: signer locked, byte-exact uncertain draft retained and duplicate signing blocked');
await fixture(42);
const reviewed = await invoke('get_constitution_context', { rpcUrl });
const params = await rpc('protocol_params');
const current = params.governable_parameters.find(p => p.name === 'min_verifier_brn_balance').current;
const newValue = current === '1' ? '2' : '1';
const proposal = await confirmed(await invoke('propose_parameter', { rpcUrl, expectedAccount: owner.address,
  expectedRevision: reviewed.revision, parameter: 'min_verifier_brn_balance', newValue }));
await writeFile(`${report}.progress`, JSON.stringify({ account: sender.address, draft, proposal, previous: before.head, epoch: before.payment_epoch, opening, incoming }));
await until(async () => (await rpc('governance_proposal_info', { hash: proposal })).phase === 'Exploration', 240);
let recoveredVote = null;
try {
  await confirmed(await invoke('vote_proposal', { rpcUrl, expectedAccount: owner.address, proposal, vote: 'yea' }));
} catch (error) {
  const hash = /confirmation pending for ([a-f0-9]{64})/.exec(error.message)?.[1];
  if (!online || !hash) throw error;
  const pending = await invoke('get_offline_payment', { expectedAccount: owner.address });
  assert.equal(pending.hash, hash, 'Uncertain governance vote was not journaled');
  assert.equal(pending.can_discard, false);
  await assert.rejects(invoke('vote_proposal', { rpcUrl, expectedAccount: owner.address, proposal, vote: 'yea' }), /offline|pending/i);
  const resolution = await invoke('resolve_offline_payment', { rpcUrl, expectedAccount: owner.address, expectedHash: hash });
  assert(['confirmed', 'excluded'].includes(resolution.status), 'Unexpected governance conflict needs a separate review');
  recoveredVote = { hash, status: resolution.status };
  if (resolution.status === 'excluded') {
    // This is an explicit second user decision after proven exclusion, not an
    // automatic retry in the wallet. Recheck that the reviewed ballot is open.
    assert.equal((await rpc('governance_proposal_info', { hash: proposal })).phase, 'Exploration');
    const replacement = await confirmed(await invoke('vote_proposal', { rpcUrl, expectedAccount: owner.address, proposal, vote: 'yea' }));
    assert.notEqual(replacement, hash);
    recoveredVote.replacement = replacement;
  }
  console.log('PASS native governance vote recovery: durable uncertain action, duplicate refused, exact outcome resolved before any reviewed replacement');
}
await until(async () => (await rpc('governance_proposal_info', { hash: proposal })).phase === 'Activated', 240);
const after = await accountState();
assert.notEqual(after.payment_epoch, before.payment_epoch);
assert.equal(after.head, before.head, 'Governance changed the reserved account slot');
const rejected = await rpc('process', { block: signedBlock });
assert.equal(rejected.accepted, false, 'Closed-epoch draft was admitted');
assert.match(rejected.detail, /epoch/i);
await fixture(senderSeed, {enroll:false});
const result = await invoke('resolve_offline_payment', { rpcUrl, expectedAccount: sender.address, expectedHash: draft });
assert.equal(result.status, 'excluded');
assert.equal(result.confirmed_successor, null);
assert.equal(await invoke('get_offline_payment', { expectedAccount: sender.address }), null);
await finishPayment(report,{account:sender.address,receiver:owner.address,draft,proposal,
  previous:before.head,closed_epoch:before.payment_epoch,installed_epoch:after.payment_epoch,opening,incoming,
  recovered_vote:recoveredVote});
console.log(`PASS native ${opening ? 'enrollment opening' : online ? 'online' : 'offline'} closed-epoch recovery: uncertain draft retained, certified governance closure, original block rejected, native exclusion, archived draft and fresh confirmed payment`);
}
await main();
