// Native signing against a normal private Test daemon. No synthetic IPC,
// injected verification, time override or preselected committee.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { rpcUrl, rpc } from './native-env.mjs';
import { unit, invoke, until, confirmed, fixture, restore, votePanel } from './native-certified-utils.mjs';
import { createBackedWallet, restoreWallet, payWithReview, transferWithReview, receiveWithReview, voteFromAssignment, participationFromUi, endorseWithReview, chooseRepresentative } from './native-certified-consumer-ui.mjs';
import { processEvidenceProxy } from './process-evidence-proxy.mjs';
import { loadPrefix, savePrefix } from './onboarding-prefix.mjs';
import { importTestIdentity, resolveConfirmedVote, resolveExcludedPayment } from './native-certified-consumer-ui.mjs';

assert.equal(process.env.NATIVE_CERTIFIED_ONBOARDING, '1');
const resume = process.env.NATIVE_CONSUMER_RESUME;
if (process.env.NATIVE_CONSUMER_STAGE === 'readback') {
  assert(resume && process.env.NATIVE_RESUME_DATA_DIR, 'Readback requires retained profile and evidence');
  const prefix = JSON.parse(await readFile(join(resume, 'onboarding-prefix.json'), 'utf8'));
  await loadPrefix(join(resume, 'onboarding-prefix.json'), prefix.subject, prefix.receiver);
  const journalRoot = join(process.env.NATIVE_RESUME_DATA_DIR, 'com.burst.wallet', 'offline-payments');
  const directory = join(journalRoot, 'completed', prefix.subject);
  const completed = [];
  for (const name of await readdir(directory)) {
    if (!/^confirmed-[a-f0-9]{64}\.json$/.test(name)) continue;
    const saved = JSON.parse(await readFile(join(directory, name), 'utf8')).block;
    const hash = Buffer.from(saved.hash).toString('hex');
    assert.equal(name, `confirmed-${hash}.json`);
    assert.equal(saved.account, prefix.subject);
    completed.push({hash, block:saved});
  }
  const payments = completed.filter(row => row.block.block_type === 'Burn');
  const transfers = completed.filter(row => row.block.block_type === 'Send');
  assert.equal(payments.length, 1, 'Expected exactly the retained positive payment');
  assert.equal(transfers.length, 1, 'Expected exactly the retained positive transfer');
  const status = await rpc('verification_status', {account:prefix.subject});
  assert.equal(status.status, 'verified');
  assert.equal(status.verifier_votes.length, 7);
  assert(status.verifier_votes.every(vote => vote.vote === 'Legitimate'));
  const transfer = await rpc('block_info', {hash:transfers[0].hash});
  const pendingPath = join(journalRoot, `${prefix.subject}.json`);
  const pendingBefore = await readFile(pendingPath);
  const rejected = JSON.parse(pendingBefore).block;
  assert.equal(rejected.block_type, 'Burn');
  const headBefore = (await rpc('account_info', {account:prefix.subject})).head;
  assert.equal(await invoke('is_locked'), true, 'Restart must not restore signing authority');
  await assert.rejects(invoke('pay', {rpcUrl, expectedAccount:prefix.subject, provider:prefix.receiver, amount:'1'}), /locked|Wallet not loaded/i);
  assert.equal(await invoke('is_locked'), true);
  assert.deepEqual(await readFile(pendingPath), pendingBefore, 'Locked request must not change the reserved draft');
  assert.equal((await rpc('account_info', {account:prefix.subject})).head, headBefore);
  await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({...prefix,
    subject_backup:join(resume, 'subject.json'), receiver_backup:join(resume, 'receiver.json'),
    selection_context:status.selection_context, payment:payments[0].hash, transfer:transfers[0].hash,
    transfer_origin:transfer.origin, transfer_provenance:await rpc('trst_origins', {origin:transfer.origin}),
    rejected_payment:Buffer.from(rejected.hash).toString('hex'),
    reconciled_from:resume,
  }, null, 2), {flag:'wx'});
  console.log('PASS retained positive receipts and locked refusal: unchanged reserved draft/head; no onboarding, vote or payment repeated');
  process.exit(0);
}
const initialHash = process.env.NATIVE_CONSUMER_INITIAL_PAYMENT;
const excludedInitial = process.env.NATIVE_CONSUMER_EXCLUDED_INITIAL_PAYMENT;
const initialSuccessor = process.env.NATIVE_CONSUMER_INITIAL_SUCCESSOR;
if (initialSuccessor) {
  assert.match(initialSuccessor, /^[0-9a-f]{64}$/);
  assert(excludedInitial, 'Completed startup recovery requires the original saved hash');
}
const resumePanel = process.env.NATIVE_CONSUMER_STAGE === 'panel';
const resumePayment = process.env.NATIVE_CONSUMER_STAGE === 'payment';
const excludedPayment = process.env.NATIVE_CONSUMER_EXCLUDED_PAYMENT;
const resumeContext = process.env.NATIVE_CONSUMER_SELECTION_CONTEXT;
if (resumePanel || resumePayment) assert.match(resumeContext || '', /^[0-9a-f]{64}$/, 'Resume requires its saved selection context');
else assert(!resumeContext, 'Selection context is only valid for panel resume');
if (resumePayment) {
  assert.match(excludedPayment || '', /^[0-9a-f]{64}$/);
  assert(process.env.NATIVE_RESUME_DATA_DIR, 'Payment recovery requires its original profile');
} else assert(!excludedPayment, 'Excluded payment requires payment recovery stage');
assert(!process.env.NATIVE_CONSUMER_STAGE || resumePanel || resumePayment, 'Unknown resume stage');
assert.equal(!!resume, !!initialHash || !!excludedInitial || resumePanel || resumePayment, 'Resume requires retained backups and an explicit saved stage');
if (excludedInitial) {
  assert.match(excludedInitial, /^[0-9a-f]{64}$/);
  assert(process.env.NATIVE_RESUME_DATA_DIR, 'Excluded startup recovery requires the original journal');
  assert(!initialHash && !resumePanel, 'Excluded startup recovery cannot also resume a confirmed payment or panel');
}
if (initialHash) assert.match(initialHash, /^[0-9a-f]{64}$/);
const subjectBackup = join(resume || process.env.NATIVE_EVIDENCE, 'subject.json');
const receiverBackup = join(resume || process.env.NATIVE_EVIDENCE, 'receiver.json');
let participation;
let representativeChange;
let endorsements = [];
const prefixPath = join(resume || process.env.NATIVE_EVIDENCE, 'onboarding-prefix.json');

const founder = await fixture(42);
assert.equal(founder.address, 'brst_57zppaz3fk4m7jods1whomcyny6uw55ppcb18f15mhxaphbpjoiix1oa1qcs');
assert((await rpc('node_info')).verified_count >= 50, 'Bootstrap must already be complete');
const subject = resume ? {address:await restoreWallet(subjectBackup)} : await createBackedWallet(subjectBackup);
const receiver = resume ? {address:await restoreWallet(receiverBackup)} : await createBackedWallet(receiverBackup);
if (resumePanel || resumePayment) {
  const prefix = await loadPrefix(prefixPath, subject.address, receiver.address);
  representativeChange = prefix.representative_change;
  participation = prefix.participation;
  endorsements = prefix.endorsements;
}
if (!resumePanel && !resumePayment) {
await fixture(42);
let initial;
if (initialHash) {
  initial = await confirmed({accepted:true, hash:initialHash});
} else if (excludedInitial) {
  assert.equal(await importTestIdentity(42), founder.address);
  const pending = await invoke('get_offline_payment', {expectedAccount:founder.address});
  if (initialSuccessor) {
    assert.equal(pending, null, 'Completed recovery must not leave an unresolved action');
    const path = join(process.env.NATIVE_RESUME_DATA_DIR, 'com.burst.wallet', 'offline-payments',
      'completed', founder.address, `superseded-by-${initialSuccessor}-${excludedInitial}.json`);
    const saved = JSON.parse(await readFile(path, 'utf8')).block;
    assert.equal(Buffer.from(saved.hash).toString('hex'), excludedInitial);
    assert.equal(saved.account, founder.address);
    assert.equal(saved.block_type, 'Burn');
    const successor = await rpc('block_info', {hash:initialSuccessor});
    assert.equal(successor.confirmed, true);
    assert.equal(successor.account, founder.address);
    assert.equal(successor.previous, Buffer.from(saved.previous).toString('hex'));
    assert.notEqual(initialSuccessor, excludedInitial);
    console.log('PASS retained startup receipt matches the confirmed competing transaction');
  } else {
    assert.equal(pending?.kind, 'Burn');
    await resolveExcludedPayment(founder.address, excludedInitial);
  }
  // Reopen the dashboard before the separate review. Reconciliation itself
  // must not sign or submit a replacement.
  assert.equal(await importTestIdentity(42), founder.address);
  initial = await payWithReview(founder.address, subject.address, '0.001', (unit / 1000n).toString());
  assert.notEqual(initial, excludedInitial);
  console.log('PASS original startup payment resolved; separately reviewed replacement confirmed');
} else {
  const evidence = await processEvidenceProxy(rpcUrl, join(process.env.NATIVE_EVIDENCE, 'startup-payment.jsonl'));
  try {
    initial = await confirmed(await invoke('pay', {
      rpcUrl:evidence.url, expectedAccount:founder.address, provider:subject.address, amount:(unit / 1000n).toString(),
    }));
  } finally { await evidence.close(); }
}
const pendingInitial = (await rpc('account_pending', {account:subject.address, count:100})).pending.find(row => row.hash === initial);
assert(pendingInitial, 'Original startup payment does not belong to the restored subject');
assert.equal(pendingInitial.source, founder.address);
assert.equal(pendingInitial.amount, (unit / 1000n).toString());
await restoreWallet(subjectBackup, subject.address);
await receiveWithReview(subject.address, [initial]);
representativeChange = await chooseRepresentative(subject.address, founder.address);
assert.equal((await invoke('get_account_info', {rpcUrl})).verification_state, 'unverified');
console.log('PASS native wallet creation, encrypted restore, receive and pre-verification delegation');

participation = await participationFromUi(100);
for (let seed = 107; seed < 110; seed++) {
  endorsements.push(await endorseWithReview(seed, subject.address, '336', (336n * unit).toString()));
}
await savePrefix(prefixPath, {version:1, subject:subject.address, receiver:receiver.address,
  representative_change:representativeChange, participation, endorsements});
}
assert(!(process.env.NATIVE_EXPECTED_CONFIRMED_VOTE && process.env.NATIVE_EXPECTED_EXCLUDED_VOTE),
  'A saved vote cannot be both confirmed and excluded');
if (process.env.NATIVE_EXPECTED_EXCLUDED_VOTE) {
  assert(resumePanel, 'Excluded vote recovery requires the saved selection context');
  const hash = process.env.NATIVE_EXPECTED_EXCLUDED_VOTE;
  assert.match(hash, /^[0-9a-f]{64}$/);
  const voter = await importTestIdentity(100);
  await resolveExcludedPayment(voter, hash);
  console.log('PASS saved vote excluded without signing a replacement; a new vote still requires review');
}
if (process.env.NATIVE_EXPECTED_CONFIRMED_VOTE) {
  assert(resumePanel, 'Confirmed vote recovery requires the saved selection context');
  const voter = await importTestIdentity(100);
  await resolveConfirmedVote(voter, process.env.NATIVE_EXPECTED_CONFIRMED_VOTE);
}
const context = resumePayment ? resumeContext : await votePanel(subject.address, null, 1, voteFromAssignment, resumeContext);
await until(async () => (await rpc('verification_status', {account:subject.address})).status === 'verified', 180);
if (resumePayment) {
  const verified = await rpc('verification_status', {account:subject.address});
  assert.equal(verified.selection_context, context);
  assert.equal(verified.verifier_votes.length, 7);
  assert(verified.verifier_votes.every(vote => vote.vote === 'Legitimate'));
}
await restoreWallet(subjectBackup, subject.address);
assert.equal((await invoke('get_account_info', {rpcUrl})).verification_state, 'verified');
if (resumePayment) {
  const pending = await invoke('get_offline_payment', {expectedAccount:subject.address});
  assert.equal(pending?.kind, 'Burn');
  assert.equal(pending?.hash, excludedPayment);
  await resolveExcludedPayment(subject.address, excludedPayment);
  await restoreWallet(subjectBackup, subject.address);
  console.log('PASS exact excluded payment resolved through UI; existing verification and votes were not repeated');
}
await until(async () => BigInt(await invoke('get_brn_balance', {rpcUrl})) >= unit);
const payment = await payWithReview(subject.address, receiver.address, '1', unit.toString());
if (resumePayment) assert.notEqual(payment, excludedPayment, 'Recovery must not resubmit the excluded payment');
const transferred = await transferWithReview(subject.address, receiver.address, '0.001', (unit / 1000n).toString());
const transfer = transferred.hash;
await restoreWallet(receiverBackup, receiver.address);
await receiveWithReview(receiver.address, [payment, transfer]);
assert.equal((await invoke('get_trst_balance', {rpcUrl})).active, (unit + unit / 1000n).toString());
const positiveReport = {subject:subject.address, receiver:receiver.address,
  subject_backup:subjectBackup, receiver_backup:receiverBackup,
  selection_context:context, payment, transfer, participation, endorsements,
  representative_change:representativeChange, transfer_origin:transferred.origin,
  transfer_provenance:transferred.provenance};
await writeFile(`${process.env.NATIVE_RESULT_PATH}.positive.json`, JSON.stringify(positiveReport, null, 2), {flag:'wx'});
await restore(subjectBackup, subject.address);
assert.equal(await invoke('get_offline_payment', {expectedAccount:subject.address}), null);
await assert.rejects(invoke('pay', {rpcUrl:'http://127.0.0.1:1', expectedAccount:subject.address, provider:receiver.address, amount:'1'}), /connection|request|connect/i);
assert.equal(await invoke('get_offline_payment', {expectedAccount:subject.address}), null,
  'Disconnected preflight must not create a signed reservation');
await assert.rejects(invoke('pay', {rpcUrl, expectedAccount:subject.address, provider:receiver.address, amount:(2n ** 127n).toString()}));
const rejectedPayment = await invoke('get_offline_payment', {expectedAccount:subject.address});
if (rejectedPayment) assert.equal(rejectedPayment.kind, 'Burn');
await invoke('lock_wallet');
assert.equal(await invoke('is_locked'), true);
await assert.rejects(invoke('pay', {rpcUrl, expectedAccount:subject.address, provider:receiver.address, amount:'1'}), /locked|Wallet not loaded/i);
await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({...positiveReport, rejected_payment:rejectedPayment?.hash ?? null}, null, 2));
console.log(resumePayment
  ? 'PASS resumed certified payment recovery, separately reviewed payment, TRST transfer/receive and rejected unfunded/disconnected/locked spending; earlier onboarding and votes were not repeated'
  : resumePanel
  ? 'PASS resumed native panel, reviewed votes, verification, restored signing, accrual, payment, TRST transfer/receive and rejected unfunded/disconnected/locked spending; earlier funding and endorsements were not repeated'
  : 'PASS native representative selection, paid endorsements, participation, assignments, reviewed votes, verification, restored signing, accrual, payment, TRST transfer/receive and rejected unfunded/disconnected/locked spending');
