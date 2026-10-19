import assert from 'node:assert/strict';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { enrollSigningDeviceWith } from './device-enrollment.mjs';
export { enrollSigningDeviceWith } from './device-enrollment.mjs';

export const unit = 1000000000000000000n;
export const password = 'Disposable certified onboarding backup';
export async function invoke(command, args = {}) {
  const response = await fetch(`${base}/execute/async`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: [command, args], script: `
      const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
        .then(value => done({value}), error => done({failure:String(error)}));` }),
    signal: AbortSignal.timeout(90000),
  });
  const { value } = await response.json();
  assert(response.ok && !value?.error, 'Native command transport failed');
  if (value.failure) throw new Error(value.failure);
  return value.value;
}
export async function until(check, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.fail('Certified native journey timed out');
}
export async function confirmed(result) {
  assert(result.accepted && result.hash, 'Native transaction was not accepted');
  await until(async () => (await rpc('block_info', {hash: result.hash})).confirmed);
  return result.hash;
}
export async function fixture(seed, {enroll = true} = {}) {
  const wallet = await invoke('import_private_key', {hexKey:seed.toString(16).padStart(2, '0').repeat(32)});
  if (enroll) await enrollSigningDevice(wallet.address);
  return wallet;
}

// Explicit setup for disposable fixture signers. Never rewrite a local binding
// or discard an uncertain action to make the fixture writable.
export async function enrollSigningDevice(address) {
  return enrollSigningDeviceWith(invoke, rpcUrl, address, () => rpc('params_hash'));
}

export async function restore(path, address) {
  await invoke('load_keystore_cmd', {path});
  assert.equal(await invoke('is_locked'), true);
  assert.equal((await invoke('unlock_wallet', {password})).address, address);
}
export async function votePanel(target, previousContext, vote, castFromUi, resumeContext = null) {
  const decision = {1:'Legitimate', 2:'Illegitimate', 3:'Neither'}[vote];
  assert(decision, 'Unknown verification decision');
  const panel = await until(async () => {
    const value = await rpc('verification_status', {account:target});
    return value.selected_verifiers.length === 7 && value.selection_context
      && value.selection_context !== previousContext ? value : false;
  }, 240);
  if (resumeContext) assert.equal(panel.selection_context, resumeContext, 'Saved committee changed; do not resume votes');
  for (let seed = 100; seed < 107; seed++) {
    if (resumeContext) {
      const helper = await fixture(seed);
      assert(panel.selected_verifiers.includes(helper.address));
      const recorded = panel.verifier_votes.filter(row => row.verifier === helper.address);
      assert(recorded.length <= 1, 'Duplicate recorded verifier');
      if (recorded.length) {
        assert.equal(recorded[0].vote, decision);
        const reviewed = await invoke('get_verification_review', {rpcUrl, target});
        assert.equal(reviewed.selection_context, resumeContext);
        assert.equal(reviewed.voted, true);
        const account = await rpc('account_info', {account:helper.address});
        const block = await rpc('block_info', {hash:account.head});
        assert.equal(block.confirmed, true, 'Previously submitted vote is not confirmed; do not resubmit');
        assert.equal(block.account, helper.address);
        assert.equal(block.block_type, 'VerificationVote');
        assert.equal(block.origin, resumeContext);
        assert.equal(block.transaction, vote.toString(16).padStart(2, '0') + '00'.repeat(31));
        assert.equal(block.timestamp, recorded[0].timestamp);
        console.log(`REUSED confirmed vote ${account.head}; no new signature`);
        continue;
      }
    }
    if (castFromUi) {
      await castFromUi(seed, target, panel, vote);
      continue;
    }
    const helper = await fixture(seed);
    assert(panel.selected_verifiers.includes(helper.address));
    const assignments = await invoke('get_verifier_assignments', {rpcUrl, cursor:null});
    assert(assignments.targets.includes(target));
    const reviewed = await invoke('get_verification_review', {rpcUrl, target});
    assert(reviewed.enabled && reviewed.selected && !reviewed.voted);
    assert.equal(reviewed.selection_context, panel.selection_context);
    assert.equal(reviewed.stake, (500n * unit).toString());
    await confirmed(await invoke('cast_verification_vote', {rpcUrl, expectedAccount:helper.address, reviewed, vote}));
  }
  return panel.selection_context;
}
