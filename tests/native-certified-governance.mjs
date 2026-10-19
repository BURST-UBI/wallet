import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { rpcUrl, rpc } from './native-env.mjs';
import { invoke, until, confirmed, fixture } from './native-certified-utils.mjs';
import {governanceIdentity, publishParameter, publishArticle, readProposal, supportSelectedProposal,
  setProposalDelegate, supportDelegatedProposal} from './native-certified-governance-ui.mjs';
import {restoreWallet} from './native-certified-consumer-ui.mjs';
import {script, wait, click} from './native-ui.mjs';

assert.equal(process.env.NATIVE_CERTIFIED_ONBOARDING, '1');
if (process.env.NATIVE_GOVERNANCE_READBACK) {
  const saved = JSON.parse(await readFile(process.env.NATIVE_GOVERNANCE_READBACK, 'utf8'));
  const lifecycle = JSON.parse(await readFile(process.env.NATIVE_ONBOARDING_REPORT, 'utf8'));
  const {subject, subject_backup:backup} = lifecycle;
  assert(backup && subject, 'Readback requires the retained test wallet backup');
  assert.match(saved.proposal, /^[0-9a-f]{64}$/);
  assert.match(saved.native_constitution.proposal, /^[0-9a-f]{64}$/);
  const before = await rpc('account_info', {account:subject});
  const status = await rpc('verification_status', {account:subject});
  assert.equal(status.status, 'verified', 'The retained appeal must have restored verification');
  await restoreWallet(backup, subject, {enroll:false});
  await script(`history.pushState({}, '', '/governance');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`document.body.innerText.includes('Find a proposal by ID')`);
  for (const hash of [saved.proposal, saved.native_constitution.proposal]) {
    await readProposal(hash);
    await wait(`document.querySelector('[aria-label="Proposal"] .balance-details')?.textContent.includes('Activated')`);
    const proposal = await invoke('get_governance_proposal_info', {rpcUrl, hash});
    assert.equal(proposal.phase, 'Activated');
    assert.equal(proposal.phase_projected, false);
    if (hash === saved.native_constitution.proposal) {
      assert.equal(proposal.votes_yea, saved.native_constitution.votes_yea);
    }
    await click('All proposals');
    await wait(`document.body.innerText.includes('Find a proposal by ID')`);
  }
  const context = await invoke('get_constitution_context', {rpcUrl, expectedAccount:subject});
  assert.deepEqual(context.document, {...saved.native_constitution.document,
    version:String(saved.native_constitution.document.version)});
  const params = await rpc('protocol_params');
  for (const [name, expected] of Object.entries(saved.expected_parameters)) {
    assert.equal(params.governable_parameters.find(row => row.name === name)?.current, expected);
  }
  await script(`history.pushState({}, '', '/verification');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`document.body.innerText.includes('Verified')`);
  assert.equal((await rpc('account_info', {account:subject})).head, before.head,
    'Readback must not enroll a signing device or submit an action');
  await invoke('lock_wallet');
  await writeFile(process.env.NATIVE_RESULT_PATH, JSON.stringify({
    subject, unchanged_head:before.head, numeric:saved.proposal,
    amendment:saved.native_constitution.proposal, restored_status:status.status,
    constitution_version:context.document.version,
  }, null, 2), {flag:'wx'});
  console.log('PASS installed governance readback: certified outcomes, constitution, parameter values, restored verification and no signing');
} else {
const verifiedCount = (await rpc('node_info')).verified_count;
// Founder + 49 helpers + the native consumer. The former extra CLI consumer
// was duplicate setup, not a governance prerequisite; quorum stays computed.
assert(verifiedCount >= 51, 'Certified governance requires completed native onboarding');
const report = process.env.NATIVE_RESULT_PATH;
const resumePath = process.env.NATIVE_GOVERNANCE_RESUME_ADOPTED;
const resumed = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : null;
if (resumed) {
  assert.match(resumed.numeric, /^[0-9a-f]{64}$/);
  assert.match(resumed.amendment, /^[0-9a-f]{64}$/);
  assert(Array.isArray(resumed.votes) && resumed.votes.length > 0);
  assert.equal(new Set(resumed.votes).size, resumed.votes.length);
}
const progress = resumed ?? { numeric:null, amendment:null, votes:[] };
await writeFile(`${report}.progress`, JSON.stringify(progress), {flag:'wx'});
async function save() { await writeFile(`${report}.progress`, JSON.stringify(progress, null, 2)); }
async function phase(hash, wanted) {
  let last;
  let observed;
  try {
  return await until(async () => {
    const info = await rpc('governance_proposal_info', {hash});
    last = {hash, wanted, phase:info.phase, projected:info.phase_projected,
      created_at:info.created_at, phase_deadline:info.phase_deadline,
      votes_yea:info.votes_yea, votes_nay:info.votes_nay, votes_abstain:info.votes_abstain};
    const state = JSON.stringify(last);
    if (state !== observed) {
      console.log('Governance phase:', JSON.stringify({sampled_at:new Date().toISOString(), ...last}));
      observed = state;
    }
    assert(!['Rejected','Withdrawn','Expired'].includes(info.phase), `Proposal ended: ${JSON.stringify(info)}`);
    return info.phase === wanted && (wanted !== 'Activated' || info.phase_projected === false) ? info : false;
  }, 240);
  } catch (error) {
    console.error('Last governance phase:', JSON.stringify({sampled_at:new Date().toISOString(), ...last}));
    throw error;
  }
}
const owner = {address:await governanceIdentity(42)};
if (process.env.NATIVE_PREVIOUS_AMENDMENT) {
  const previous = await until(async () => {
    const value = await rpc('governance_proposal_info', {hash:process.env.NATIVE_PREVIOUS_AMENDMENT});
    return value.phase_projected === false ? value : false;
  }, 180);
  assert.equal(previous.proposer, owner.address);
  assert.equal(previous.phase_projected, false, 'Previous amendment is not certified closed');
  assert(['Rejected', 'Expired', 'Withdrawn'].includes(previous.phase), 'Do not replace an in-flight or adopted amendment');
  assert.equal(previous.votes_yea, 0);
  assert.equal(previous.votes_nay, 0);
  assert.equal(previous.votes_abstain, 0);
  console.log('Previous unvoted amendment is certified closed; starting a fresh amendment attempt');
}
const context = await invoke('get_constitution_context', {rpcUrl});
assert(context.enabled);
const currentAge = context.parameters.find(row => row.name === 'min_verification_age_secs').current;
const currentWindow = context.parameters.find(row => row.name === 'governance_exploration_duration_secs').current;
const resumedNumeric = resumed?.numeric ?? process.env.NATIVE_GOVERNANCE_RESUME_NUMERIC;
if (resumedNumeric) assert.match(resumedNumeric, /^[0-9a-f]{64}$/);
const existingNumeric = resumedNumeric ? await rpc('governance_proposal_info', {hash:resumedNumeric}) : null;
if (existingNumeric) {
  assert.equal(existingNumeric.proposer, owner.address);
  assert(['MinVerificationAgeSecs', 'GovernanceExplorationDurationSecs'].includes(existingNumeric.param));
  assert(existingNumeric.param === 'MinVerificationAgeSecs'
    ? ['1', '2'].includes(existingNumeric.proposed_value) : existingNumeric.proposed_value === '180');
  await readProposal(resumedNumeric);
}
const parameter = existingNumeric
  ? (existingNumeric.param === 'MinVerificationAgeSecs' ? 'min_verification_age_secs' : 'governance_exploration_duration_secs')
  : (Number(currentWindow) < 180 ? 'governance_exploration_duration_secs' : 'min_verification_age_secs');
const newValue = existingNumeric?.proposed_value
  ?? (parameter === 'governance_exploration_duration_secs' ? '180' : currentAge === '1' ? '2' : '1');
const numeric = resumedNumeric ?? await publishParameter(owner.address, parameter, newValue);
progress.numeric = numeric;
await save();
const numericAlreadyActivated = existingNumeric?.phase === 'Activated'
  && existingNumeric.phase_projected === false;
if (!resumed && !numericAlreadyActivated) {
  await phase(numeric, 'Exploration');
  await supportSelectedProposal(owner.address, numeric);
}
await phase(numeric, 'Activated');
const params = await rpc('protocol_params');
assert.equal(params.governable_parameters.find(row => row.name === parameter).current, newValue);
console.log(resumed || numericAlreadyActivated ? 'PASS resumed numeric proposal remains certified and active'
  : 'PASS native UI numeric proposal and vote, unsigned cancellation and certified parameter activation');

const reviewed = await invoke('get_constitution_context', {rpcUrl});
const text = '共同の権利 🌍\n'.repeat(4000);
assert([...text].length < 50000);
const expectedVersion = Number(reviewed.document.version) + (resumed ? 0 : 1);
const articleTitle = `共同の権利 ${expectedVersion}`;
const draft = {title:'共同の憲法', operations:[{AddArticle:{title:articleTitle, text}}]};
const amendment = resumed?.amendment ?? await publishArticle(owner.address, draft);
progress.amendment = amendment;
await save();
const published = await invoke('get_governance_proposal_info', {rpcUrl, hash:amendment});
assert.equal(published.proposer, owner.address);
assert.deepEqual(published.amendment_operations, draft.operations);

const delegator = {address:await governanceIdentity(120)};
const scope = {kind:'proposal', value:amendment};
const quorumBps = Number(params.governable_parameters.find(row => row.name === 'consti_quorum_bps').current);
const directCount = Math.max(20, Math.ceil(verifiedCount * quorumBps / 10000) - 1);
const expectedVotes = resumed ? progress.votes.length : directCount + 1;
if (resumed) {
  const certified = await phase(amendment, 'Activated');
  assert.equal(certified.votes_yea, expectedVotes, 'Progress record must match the certified tally');
  assert(progress.votes.includes(delegator.address));
} else {
  const before = await invoke('get_scoped_delegations', {rpcUrl, incoming:false, scope, cursor:null});
  assert.equal(before.entries.length, 0);
  await setProposalDelegate(delegator.address, amendment, owner.address);
  const registered = await invoke('get_scoped_delegations', {rpcUrl, incoming:false, scope, cursor:null});
  assert.equal(registered.entries[0].generation, '1');
  assert.equal(registered.entries[0].delegate, owner.address);
  assert.equal(registered.entries[0].confirmed, true);
  await governanceIdentity(42);
  const incoming = await invoke('get_scoped_delegations', {rpcUrl, incoming:true, scope:null, cursor:null});
  const entry = incoming.entries.find(value => value.owner === delegator.address && value.scope.value === amendment);
  assert(entry?.confirmed);
  await phase(amendment, 'Exploration');
  await supportDelegatedProposal(owner.address, entry, published);
  progress.votes.push(delegator.address);
  await save();
  const directSeeds = Array.from({length:49}, (_, index) => 100 + index).filter(seed => seed !== 120).slice(0, directCount);
  assert.equal(directSeeds.length, directCount, 'Fixture lacks enough distinct voters for the governed quorum');
  for (const seed of directSeeds) {
    const voter = await fixture(seed);
    await confirmed(await invoke('vote_proposal', {rpcUrl, expectedAccount:voter.address, proposal:amendment, vote:'yea'}));
    progress.votes.push(voter.address);
    await save();
  }
}
const outcome = await phase(amendment, 'Activated');
assert.equal(outcome.votes_yea, expectedVotes);
assert.equal(outcome.votes_nay, 0);
const document = await rpc('consti');
assert.equal(document.version, expectedVersion);
const article = document.articles.find(value => value.title === articleTitle);
assert.equal(article?.text, text);
await governanceIdentity(120);
const delegated = await invoke('get_scoped_delegations', {rpcUrl, incoming:false, scope, cursor:null});
assert.equal(delegated.entries.length, 1);
assert.equal(delegated.entries[0].confirmed, true);
if (delegated.entries[0].delegate !== null) {
  assert.equal(delegated.entries[0].delegate, owner.address);
  await setProposalDelegate(delegator.address, amendment, null);
}
const revoked = await invoke('get_scoped_delegations', {rpcUrl, incoming:false, scope, cursor:null});
assert.equal(revoked.entries[0].delegate, null);
assert.equal(revoked.entries[0].confirmed, true);
assert.equal((await rpc('governance_proposal_info', {hash:amendment})).votes_yea, expectedVotes,
  'Post-count delegation revocation must not rewrite the certified tally');
await invoke('lock_wallet');
await writeFile(report, JSON.stringify({proposal:numeric, test_accrual:true,
  expected_parameters:{[parameter]:newValue,
    min_verification_age_secs:params.governable_parameters.find(row => row.name === 'min_verification_age_secs').current,
    min_verifier_brn_balance:params.governable_parameters.find(row => row.name === 'min_verifier_brn_balance').current},
  native_constitution:{proposal:amendment, document, votes_yea:expectedVotes,
    delegation_query:{account:delegator.address, direction:'outgoing', scope, cursor:null},
    delegation:revoked.entries[0]}}, null, 2), {flag:'wx'});
console.log(resumed ? 'PASS resumed exact multilingual amendment, certified tally and post-count delegation revocation'
  : 'PASS native multilingual amendment, delegated and direct ballots, certified adoption and post-count delegation revocation');
}
