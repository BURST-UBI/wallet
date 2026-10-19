import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { rpcUrl, rpc } from './native-env.mjs';
import { unit, invoke, until, fixture, votePanel } from './native-certified-utils.mjs';
import { challengeWithReview, appealWithReview, voteFromAssignment, restoreWallet, payWithReview, receiveWithReview, resolveExcludedPayment, resolveExcludedReceipt, importTestIdentity } from './native-certified-consumer-ui.mjs';
import { script, wait, click } from './native-ui.mjs';

assert.equal(process.env.NATIVE_CERTIFIED_ONBOARDING, '1');
const previous = JSON.parse(await readFile(process.env.NATIVE_ONBOARDING_REPORT, 'utf8'));
const {subject, receiver} = previous;
const subjectBackup = process.env.NATIVE_SUBJECT_BACKUP || previous.subject_backup;
const receiverBackup = process.env.NATIVE_RECEIVER_BACKUP || previous.receiver_backup;
assert(subjectBackup && receiverBackup, 'Provide the encrypted backups from native onboarding');
if (process.env.NATIVE_REVOCATION_NOTICE_ONLY === '1') {
  const before = await rpc('trst_portfolio', {account:receiver});
  const account = await rpc('account_info', {account:receiver});
  assert.equal(before.total_revoked, (2n * unit).toString());
  assert.equal(before.total_active, (unit / 1000n).toString());
  assert.equal((await rpc('verification_status', {account:subject})).status, 'revoked');
  await restoreWallet(receiverBackup, receiver, {enroll:false});
  await wait(`document.querySelector('[aria-label="TRST revocation notice"]')?.textContent.includes('2.000000 TRST revoked.')`);
  await click('Review affected origins');
  await wait(`document.getElementById('revoked-origins')?.textContent.includes(${JSON.stringify(subject)})`);
  const text = await script(`return document.getElementById('revoked-origins').textContent`);
  assert(text.includes('Exact revoked amount: 2.000000000000000000 TRST'));
  assert(text.includes('Revoked origin'));
  const portfolio = await invoke('get_trst_portfolio', {rpcUrl, expectedAccount:receiver});
  assert.equal(portfolio.total_revoked, before.total_revoked);
  assert.equal(portfolio.total_active, before.total_active);
  assert.equal(await script(`return document.querySelectorAll('[aria-label="TRST revocation notice"]').length`), 1);
  assert.equal((await rpc('account_info', {account:receiver})).head, account.head, 'Reading a notice must not sign an action');
  await invoke('lock_wallet');
  await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({subject,receiver,revoked:portfolio.total_revoked,active:portfolio.total_active,unchanged_head:account.head},null,2));
  console.log('PASS installed revocation notice: real revoked holdings, exact amount, origin address and flag, preserved clean balance, no signing');
} else {
const founder = await fixture(42);
assert.equal(founder.address, 'brst_57zppaz3fk4m7jods1whomcyny6uw55ppcb18f15mhxaphbpjoiix1oa1qcs');
const resumedContext = process.env.NATIVE_RESUME_APPEAL_CONTEXT;
const resumedChallenge = process.env.NATIVE_RESUME_CHALLENGE_REPORT
  ? JSON.parse(await readFile(process.env.NATIVE_RESUME_CHALLENGE_REPORT, 'utf8')) : null;
const resumedReceipt = process.env.NATIVE_RESUME_RECEIPT_REPORT
  ? JSON.parse(await readFile(process.env.NATIVE_RESUME_RECEIPT_REPORT, 'utf8')) : null;
const resumedChallengedPayment = process.env.NATIVE_RESUME_CHALLENGED_PAYMENT_REPORT
  ? JSON.parse(await readFile(process.env.NATIVE_RESUME_CHALLENGED_PAYMENT_REPORT, 'utf8')) : null;
const resumedAppealPanel = process.env.NATIVE_RESUME_APPEAL_PANEL_REPORT
  ? JSON.parse(await readFile(process.env.NATIVE_RESUME_APPEAL_PANEL_REPORT, 'utf8')) : null;
assert([resumedContext, resumedChallenge, resumedReceipt, resumedAppealPanel, resumedChallengedPayment].filter(Boolean).length <= 1, 'Choose one lifecycle resume point');
let challenge = null;
let appeal = null;
let appealContext = resumedContext;
const progress = {subject, receiver, subject_backup:subjectBackup, receiver_backup:receiverBackup};
async function recordProgress(update) {
  Object.assign(progress, update);
  await writeFile(`${process.env.NATIVE_RESULT_PATH}.progress.json`, JSON.stringify(progress, null, 2));
}
if (resumedAppealPanel) {
  assert.equal(resumedAppealPanel.subject, subject);
  assert.equal(resumedAppealPanel.receiver, receiver);
  assert(resumedAppealPanel.challenge && resumedAppealPanel.appeal && resumedAppealPanel.challenge_context);
  const context = process.env.NATIVE_RESUME_APPEAL_PANEL_CONTEXT;
  assert.match(context ?? '', /^[0-9a-f]{64}$/);
  const current = await rpc('verification_status', {account:subject});
  assert.equal(current.status, 'revoked');
  assert.equal(current.selection_context, context);
  assert(current.verifier_votes.every(vote => vote.vote === 'Legitimate'));
  for (const hash of [resumedAppealPanel.challenge, resumedAppealPanel.appeal, resumedAppealPanel.during_challenge_payment]) {
    assert.equal((await rpc('block_info', {hash})).confirmed, true);
  }
  challenge = resumedAppealPanel.challenge;
  appeal = resumedAppealPanel.appeal;
  await recordProgress(resumedAppealPanel);
  if (process.env.NATIVE_EXPECTED_EXCLUDED_VOTE) {
    const account = await importTestIdentity(100);
    const pending = await invoke('get_offline_payment', {expectedAccount:account});
    assert.equal(pending?.kind, 'VerificationVote');
    assert.equal(pending?.hash, process.env.NATIVE_EXPECTED_EXCLUDED_VOTE);
    await resolveExcludedPayment(account, pending.hash);
    await recordProgress({excluded_vote:pending.hash, vote_reconciled:true});
  }
  appealContext = await votePanel(subject, resumedAppealPanel.challenge_context, 1, voteFromAssignment, context);
  await recordProgress({appeal_context:appealContext});
} else if (resumedContext) {
  if (process.env.NATIVE_RESUME_APPEAL_REPORT) {
    const saved = JSON.parse(await readFile(process.env.NATIVE_RESUME_APPEAL_REPORT, 'utf8'));
    assert.equal(saved.subject, subject);
    assert.equal(saved.receiver, receiver);
    assert.equal(saved.appeal_context, resumedContext);
    assert(saved.challenge && saved.appeal);
    challenge = saved.challenge;
    appeal = saved.appeal;
    await recordProgress(saved);
  }
  const current = await rpc('verification_status', {account:subject});
  assert.equal(current.selection_context, resumedContext);
  assert.equal(current.verifier_votes.length, 7);
  assert(current.verifier_votes.every(vote => vote.vote === 'Legitimate'));
  console.log('PASS resuming the already signed appeal panel without resubmission');
} else {
let challengeContext;
if (resumedChallenge) {
  assert.equal(resumedChallenge.subject, subject);
  assert.equal(resumedChallenge.receiver, receiver);
  const savedContext = process.env.NATIVE_RESUME_CHALLENGE_CONTEXT || resumedChallenge.challenge_context;
  assert.match(savedContext ?? '', /^[0-9a-f]{64}$/);
  assert(resumedChallenge.challenge && resumedChallenge.during_challenge_payment);
  const current = await rpc('verification_status', {account:subject});
  assert.equal(current.selection_context, savedContext);
  assert(current.verifier_votes.length <= 7);
  assert(current.verifier_votes.every(vote => vote.vote === 'Illegitimate'));
  assert(['verified', 'revoked'].includes(current.status));
  for (const hash of [resumedChallenge.challenge, resumedChallenge.during_challenge_payment]) {
    assert.equal((await rpc('block_info', {hash})).confirmed, true, 'Saved lifecycle action must remain confirmed');
  }
  challenge = resumedChallenge.challenge;
  challengeContext = savedContext;
  await recordProgress(resumedChallenge);
  const portfolio = await rpc('trst_portfolio', {account:receiver});
  assert.equal(BigInt(portfolio.total_active) + BigInt(portfolio.total_revoked), 2n * unit + unit / 1000n);
  assert.equal(portfolio.total_pending, '0', 'Receive the recorded payment before resuming the panel');
  if (process.env.NATIVE_EXPECTED_EXCLUDED_VOTE) {
    const account = await importTestIdentity(100);
    const pending = await invoke('get_offline_payment', {expectedAccount:account});
    assert.equal(pending?.kind, 'VerificationVote');
    assert.equal(pending?.hash, process.env.NATIVE_EXPECTED_EXCLUDED_VOTE);
    await resolveExcludedPayment(account, pending.hash);
    await recordProgress({excluded_vote:pending.hash, vote_reconciled:true});
  }
  if (current.verifier_votes.length < 7) {
    await votePanel(subject, previous.selection_context, 2, voteFromAssignment, savedContext);
  }
  await recordProgress({challenge_context:challengeContext});
  console.log('PASS resumed challenge panel without repeating the challenge, payments or confirmed votes');
} else if (resumedChallengedPayment) {
  assert.equal(resumedChallengedPayment.subject, subject);
  assert.equal(resumedChallengedPayment.receiver, receiver);
  assert(resumedChallengedPayment.challenge);
  assert(!resumedChallengedPayment.during_challenge_payment && !resumedChallengedPayment.challenge_context);
  const hash = process.env.NATIVE_EXPECTED_EXCLUDED_PAYMENT;
  assert.match(hash ?? '', /^[0-9a-f]{64}$/);
  assert(process.env.NATIVE_RESUME_DATA_DIR, 'Use the original profile containing the signed attempt');
  const current = await rpc('verification_status', {account:subject});
  assert.equal(current.status, 'verified');
  assert.equal(current.challenge_active, true);
  assert.equal(current.verifier_votes.length, 0, 'Do not repeat an already started panel');
  const portfolio = await rpc('trst_portfolio', {account:receiver});
  assert.equal(portfolio.total_active, (unit + unit / 1000n).toString());
  assert.equal(portfolio.total_pending, '0');
  assert.equal(portfolio.total_revoked, '0');
  assert.equal((await rpc('block_info', {hash:resumedChallengedPayment.challenge})).confirmed, true);
  challenge = resumedChallengedPayment.challenge;
  await recordProgress(resumedChallengedPayment);
  await restoreWallet(subjectBackup, subject);
  const pending = await invoke('get_offline_payment', {expectedAccount:subject});
  if (resumedChallengedPayment.excluded_challenged_payment === hash) {
    assert.equal(pending, null, 'Recorded recovery must not leave an unresolved action');
    const completed = join(process.env.NATIVE_RESUME_DATA_DIR, 'com.burst.wallet', 'offline-payments', 'completed', subject);
    const names = (await readdir(completed)).filter(name => name.startsWith('excluded-by-epoch-') && name.endsWith(`-${hash}.json`));
    assert.equal(names.length, 1, 'Recorded exclusion needs its exact archived journal');
    const archived = JSON.parse(await readFile(join(completed, names[0]), 'utf8')).block;
    assert.equal(Buffer.from(archived.hash).toString('hex'), hash);
    assert.equal(archived.account, subject);
    assert.equal(archived.block_type, 'Burn');
    const exclusion = await rpc('payment_exclusion', {account:subject,
      previous:Buffer.from(archived.previous).toString('hex'), payment_epoch:Buffer.from(archived.payment_epoch).toString('hex')});
    assert.equal(exclusion.excluded, true, 'Archived recovery must remain certified excluded');
    console.log('PASS retained exact excluded receipt; no repeated recovery or signature');
  } else {
    assert.equal(pending?.hash, hash);
    assert.equal(pending.can_review_payment, true);
    await resolveExcludedPayment(subject, hash);
    await recordProgress({excluded_challenged_payment:hash});
    await restoreWallet(subjectBackup, subject);
  }
  const payment = await payWithReview(subject, receiver, '1', unit.toString());
  assert.notEqual(payment, hash);
  await recordProgress({during_challenge_payment:payment});
  await restoreWallet(receiverBackup, receiver);
  await receiveWithReview(receiver, [payment]);
  challengeContext = await votePanel(subject, previous.selection_context, 2, voteFromAssignment);
  await recordProgress({challenge_context:challengeContext});
  console.log('PASS reconciled excluded challenged payment and reviewed a new payment without repeating the challenge');
} else if (resumedReceipt) {
  assert.equal(resumedReceipt.subject, subject);
  assert.equal(resumedReceipt.receiver, receiver);
  assert(resumedReceipt.challenge && resumedReceipt.during_challenge_payment);
  assert(!resumedReceipt.challenge_context, 'Use the panel resume point after voting');
  assert.match(process.env.NATIVE_EXPECTED_RECEIPT_HASH ?? '', /^[0-9a-f]{64}$/);
  const current = await rpc('verification_status', {account:subject});
  assert.equal(current.status, 'verified');
  assert.equal(current.verifier_votes.length, 0, 'Do not repeat an already started panel');
  for (const hash of [resumedReceipt.challenge, resumedReceipt.during_challenge_payment]) {
    assert.equal((await rpc('block_info', {hash})).confirmed, true);
  }
  challenge = resumedReceipt.challenge;
  await recordProgress(resumedReceipt);
  await restoreWallet(receiverBackup, receiver);
  if (resumedReceipt.receipt_reconciled) {
    assert.equal(resumedReceipt.excluded_receipt, process.env.NATIVE_EXPECTED_RECEIPT_HASH);
    assert.equal(await invoke('get_offline_payment', {expectedAccount:receiver}), null);
    const directory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments', 'completed', receiver);
    const archives = (await readdir(directory)).filter(name => name.startsWith('excluded-by-epoch-') && name.endsWith(`-${resumedReceipt.excluded_receipt}.json`));
    assert.equal(archives.length, 1);
    const archive = JSON.parse(await readFile(join(directory, archives[0]), 'utf8'));
    assert.equal(Buffer.from(archive.block.hash).toString('hex'), resumedReceipt.excluded_receipt);
    console.log('PASS retained excluded receipt; no repeated reconciliation');
  } else {
    await resolveExcludedReceipt(receiver, process.env.NATIVE_EXPECTED_RECEIPT_HASH, resumedReceipt.during_challenge_payment);
  }
  await recordProgress({excluded_receipt:process.env.NATIVE_EXPECTED_RECEIPT_HASH, receipt_reconciled:true});
  await receiveWithReview(receiver, [resumedReceipt.during_challenge_payment]);
  challengeContext = await votePanel(subject, previous.selection_context, 2, voteFromAssignment);
  await recordProgress({challenge_context:challengeContext});
} else {
assert.equal((await rpc('verification_status', {account:subject})).status, 'verified');
const parameters = await rpc('protocol_params');
challenge = await challengeWithReview(42, subject, parameters.challenge_stake_amount);
await recordProgress({challenge});
// Decision 17.3 preserves normal operations until the judgment, not a freeze.
await restoreWallet(subjectBackup, subject);
assert.equal((await invoke('get_account_info', {rpcUrl})).verification_state, 'verified');
const duringChallenge = await payWithReview(subject, receiver, '1', unit.toString());
await recordProgress({during_challenge_payment:duringChallenge});
await restoreWallet(receiverBackup, receiver);
await receiveWithReview(receiver, [duringChallenge]);
challengeContext = await votePanel(subject, previous.selection_context, 2, voteFromAssignment);
await recordProgress({challenge_context:challengeContext});
}
await until(async () => (await rpc('verification_status', {account:subject})).status === 'revoked', 180);
await restoreWallet(receiverBackup, receiver);
const revoked = await invoke('get_trst_balance', {rpcUrl});
assert.equal(revoked.active, (unit / 1000n).toString(), 'Unrelated founder-origin TRST must survive');
assert.equal(revoked.revoked, (2n * unit).toString(), 'Both subject-origin payments must be revoked');
await restoreWallet(subjectBackup, subject);
await assert.rejects(invoke('pay', {rpcUrl, expectedAccount:subject, provider:receiver, amount:'1'}));
console.log('PASS native challenge, spending while challenged, certified revocation and origin-specific TRST invalidation');

await fixture(42);
const reviewed = await until(async () => {
  const value = await invoke('get_appeal_review', {rpcUrl, target:subject});
  return value.enabled && !value.challenge_active && value.outcome ? value : false;
});
assert.equal(reviewed.outcome.reason, 'Fraud');
assert.equal(reviewed.outcome.legitimate, false);
appeal = await appealWithReview(42, subject, reviewed);
await recordProgress({appeal, appealed_outcome:reviewed.outcome});
assert.equal((await rpc('account_info', {account:subject})).verification_state, 'revoked', 'An appeal cannot restore rights before judgment');
appealContext = await votePanel(subject, challengeContext, 1, voteFromAssignment);
await recordProgress({appeal_context:appealContext});
}
await until(async () => (await rpc('verification_status', {account:subject})).status === 'verified', 180);
await restoreWallet(receiverBackup, receiver);
const restored = await invoke('get_trst_balance', {rpcUrl});
assert.equal(restored.active, (2n * unit + unit / 1000n).toString());
assert.equal(restored.revoked, '0');
await restoreWallet(subjectBackup, subject);
await until(async () => BigInt(await invoke('get_brn_balance', {rpcUrl})) >= unit);
const unresolved = await invoke('get_offline_payment', {expectedAccount:subject});
if (process.env.NATIVE_EXPECTED_REJECTED_PAYMENT) {
  assert.equal(unresolved?.hash, process.env.NATIVE_EXPECTED_REJECTED_PAYMENT);
}
if (unresolved) {
  await recordProgress({rejected_payment:unresolved.hash});
  await resolveExcludedPayment(subject, unresolved.hash);
  await recordProgress({rejected_payment_resolved:true});
  console.log('PASS UI reconciliation of the revoked-state attempt without resubmitting it');
  await restoreWallet(subjectBackup, subject);
}
const payment = await payWithReview(subject, receiver, '1', unit.toString());
await recordProgress({restored_payment:payment});
await restoreWallet(receiverBackup, receiver);
await receiveWithReview(receiver, [payment]);
const receive = (await rpc('account_info', {account:receiver})).head;
const receiverBalance = await invoke('get_trst_balance', {rpcUrl});
assert.equal(receiverBalance.active, (3n * unit + unit / 1000n).toString());
await invoke('lock_wallet');
await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({subject, receiver, challenge, appeal,
  resumed_appeal:!!resumedContext,
  selection_context:appealContext, subject_status:await rpc('verification_status', {account:subject}),
  payment, receive, receiver_balance:receiverBalance}, null, 2));
console.log('PASS native certified appeal reversal, restored originated TRST and restored-wallet payment/receive');
}
