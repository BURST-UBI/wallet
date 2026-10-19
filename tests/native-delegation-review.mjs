// Review and cancel only: the retained proposal must not be resubmitted.
import assert from 'node:assert/strict';
import {rpc} from './native-env.mjs';
import {script, wait, click, fill} from './native-ui.mjs';
import {governanceIdentity, readProposal, waitForDelegationReview} from './native-certified-governance-ui.mjs';

assert.equal(process.env.NATIVE_CERTIFIED_ONBOARDING, '1');
const proposal = process.env.NATIVE_PROPOSAL;
const delegate = process.env.NATIVE_DELEGATE;
assert.match(proposal, /^[a-f0-9]{64}$/);
assert.match(delegate, /^brst_[13456789abcdefghijkmnopqrstuwxyz]{60}$/);
if (process.env.NATIVE_REVIEW_SWITCH_IDENTITY === '1') {
  assert.equal(await governanceIdentity(42), delegate);
  await readProposal(proposal);
}
const account = await governanceIdentity(120);
const before = (await rpc('account_info', {account})).head;
await click('Your delegates');
await script(`const select = document.getElementById('delegation-kind');
  select.value = 'proposal'; select.dispatchEvent(new Event('change', {bubbles:true}));`);
await fill('delegation-scope', proposal);
await fill('delegate-address', delegate);
await wait(`[...document.querySelectorAll('[aria-label="Voting delegation"] button')].some(b => b.textContent.trim() === 'Review delegation' && !b.disabled)`);
await click('Review delegation');
try {
  await waitForDelegationReview();
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
} finally {
  assert.equal((await rpc('account_info', {account})).head, before, 'Review-only diagnostic changed the account');
}
console.log('PASS native delegation review and cancellation without signing');
