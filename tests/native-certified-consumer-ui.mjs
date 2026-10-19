import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { invoke, password, until, unit } from './native-certified-utils.mjs';
import { script, wait, click, fill } from './native-ui.mjs';
import { signedBlockJson } from './offline-envelope.mjs';

async function onboarding() {
  // Fixture identities also use this process. Reset the frontend after locking
  // the native signer so the next identity is loaded through the actual form.
  await invoke('lock_wallet');
  await script(`history.replaceState({}, '', '/onboarding');
    localStorage.setItem('burst-wallet', JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [rpcUrl]);
  const response = await fetch(`${base}/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    signal: AbortSignal.timeout(45000),
  });
  assert(response.ok, 'Native refresh failed');
  await wait(`document.body.innerText.includes('Create New Wallet')`);
}

async function dashboard() {
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  assert.equal(await script(`return !!document.querySelector('[aria-label="Recovery phrase"]')`), false);
  await click('Go to Dashboard');
  await wait(`!!document.querySelector('.wallet-identity p[title]')`);
  return script(`return document.querySelector('.wallet-identity p[title]').getAttribute('title')`);
}

export async function useSigningDevice(address) {
  const before = await invoke('signing_device_status', {rpcUrl, expectedAccount:address});
  if (before.active_here) return;
  await script(`history.pushState({}, '', '/settings');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`document.body.innerText.includes('Signing device')`);
  await click('Signing device');
  await wait(`!![...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Use this device')`);
  const reviewed = await invoke('signing_device_status', {rpcUrl, expectedAccount:address});
  assert.equal(reviewed.head, before.head, 'Opening device review changed the account');
  await click('Cancel');
  assert.equal((await invoke('signing_device_status', {rpcUrl, expectedAccount:address})).head, before.head,
    'Cancelling device setup signed an action');
  await click('Signing device');
  await wait(`!![...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Use this device')`);
  await click('Use this device');
  await until(async () => {
    const failure = await script(`return document.querySelector('[role="dialog"] [role="alert"]')?.textContent`);
    assert(!failure, `Device setup remains unresolved: ${failure}`);
    return (await invoke('signing_device_status', {rpcUrl, expectedAccount:address})).active_here;
  });
  await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('This is your signing device')`);
  await click('Done');
  await script(`history.pushState({}, '', '/');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`!!document.querySelector('.wallet-identity p[title]')`);
}

export async function createBackedWallet(path) {
  await onboarding();
  await click('Create New Wallet');
  await wait(`document.body.innerText.includes('Generate Wallet')`);
  await click('Generate Wallet');
  await wait(`!!document.querySelector('[aria-label="Recovery phrase"]')`);
  assert.equal(await script(`return document.querySelector('[aria-label="Recovery phrase"]').children.length`), 24);
  assert.equal(await script(`return [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save & Continue').disabled`), true);
  // Do not extract, photograph or log disposable recovery words.
  await script(`document.querySelector('input[type="checkbox"]').click()`);
  await fill('wallet-password', password);
  await fill('wallet-confirm-password', password);
  await fill('wallet-save-path', path);
  await click('Save & Continue');
  const address = await dashboard();
  await access(path);
  await useSigningDevice(address);
  return { address };
}

export async function restoreWallet(path, address, { enroll = true } = {}) {
  await onboarding();
  assert(await script(`const summary = [...document.querySelectorAll('summary')].find(s => s.textContent.trim() === 'More ways to restore');
    if (!summary) return false; summary.click(); return summary.parentElement.open;`));
  await click('Load Keystore');
  await wait(`!!document.getElementById('wallet-keystore-path')`);
  await fill('wallet-keystore-path', path);
  await click('Load Keystore');
  await wait(`document.body.innerText.includes('Unlock Wallet')`);
  assert.equal(await invoke('is_locked'), true);
  await fill('wallet-password', password);
  await click('Unlock');
  let restored;
  try {
    restored = await dashboard();
  } catch (error) {
    // Only unlock controls/errors: never dump the page, recovery words or inputs.
    const state = await script(`return {
      path:location.pathname,
      dashboard:!!document.querySelector('.wallet-identity p[title]'),
      unlock:[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Unlock').map(b=>({disabled:b.disabled})),
      errors:[...document.querySelectorAll('[data-sonner-toast][data-type="error"]')].map(t=>t.textContent)
    }`);
    console.error('Encrypted restore state:', JSON.stringify({locked:await invoke('is_locked'), ...state}));
    throw error;
  }
  if (address !== undefined) assert.equal(restored, address, 'Restored UI identity differs from backup');
  // Recovery scenarios with an outstanding action must resolve it before a new
  // handoff. Do not turn backup restore into an implicit replacement signature.
  if (enroll && !await invoke('get_offline_payment', {expectedAccount:restored})) await useSigningDevice(restored);
  return restored;
}

export async function payWithReview(account, provider, amount, rawAmount) {
  await click('Pay');
  await wait(`!!document.getElementById('provider') && !document.querySelector('.animate-shimmer')`);
  await fill('provider', provider);
  await fill('pay-amount', amount);
  const head = (await rpc('account_info', {account})).head;
  await click('Pay');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, head, 'Review signed a payment');
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, head, 'Cancellation signed a payment');
  await click('Pay');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [provider]), true);
  // Judgment can restore rights before peers finish installing its checkpoint.
  // Wait before signing; an uncertain submission must never be retried here.
  await until(async () => ['local', 'peer_matches'].includes((await rpc('params_hash')).online_signing));
  assert.equal((await rpc('account_info', {account})).head, head, 'Waiting for signing readiness changed the payer head');
  await click('Confirm Payment');
  await wait(`(() => {
    const receipt = document.querySelector('[data-transaction-receipt]');
    const failure = document.querySelector('[role="dialog"] [role="alert"]')?.textContent;
    if (failure) throw new Error('Payment rejected: ' + failure);
    if (receipt?.textContent.includes('Confirmation pending')) {
      throw new Error('Payment confirmation is uncertain; inspect the saved journal, do not resubmit');
    }
    return receipt?.textContent.includes('Transaction confirmed');
  })()`);
  const hash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent.trim()`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  await until(async () => (await rpc('block_info', {hash})).confirmed);
  const pending = (await rpc('account_pending', {account:provider, count:100})).pending.find(row => row.hash === hash);
  assert(pending, 'Confirmed UI payment has no recipient claim');
  assert.equal(pending.amount, rawAmount);
  assert.equal(pending.source, account);
  return hash;
}

export async function resolveExcludedPayment(account, hash) {
  const pending = await invoke('get_offline_payment', {expectedAccount:account});
  assert.equal(pending?.hash, hash);
  assert.equal(pending.can_discard, false);
  const head = (await rpc('account_info', {account})).head;
  await script(`history.pushState({}, '', '/pay/offline');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`document.body.textContent.includes(${JSON.stringify(hash)})`);
  await click('Check confirmation');
  await wait(pending.can_review_payment
    ? `document.body.textContent.includes('The network advanced before this payment was applied.')`
    : `document.body.textContent.includes('This transaction was not applied. Return to its original screen to review a new action.')`);
  assert.equal(await invoke('get_offline_payment', {expectedAccount:account}), null);
  assert.equal((await rpc('account_info', {account})).head, head, 'Reconciliation signed a replacement');
}

export async function resolveConfirmedVote(account, hash) {
  const pending = await invoke('get_offline_payment', {expectedAccount:account});
  assert.equal(pending?.hash, hash);
  assert.equal(pending.kind, 'VerificationVote');
  assert.equal(pending.can_discard, false);
  assert(process.env.XDG_DATA_HOME, 'Vote recovery requires the retained native profile');
  const saved = JSON.parse(signedBlockJson(await readFile(join(process.env.XDG_DATA_HOME,
    'com.burst.wallet', 'offline-payments', `${account}.json`), 'utf8')));
  assert.equal(Buffer.from(saved.hash).toString('hex'), hash);
  assert.equal(saved.account, account);
  assert.equal(saved.block_type, 'VerificationVote');
  const previous = Buffer.from(saved.previous).toString('hex');
  assert.match(previous, /^[0-9a-f]{64}$/);
  // Poll the canonical slot, not sparse historical bodies for an uncertain hash.
  await until(async () => {
    const slot = await rpc('confirmed_account_slot', {account, previous});
    assert.equal(slot.account, account);
    assert.equal(slot.previous, previous);
    if (slot.successor == null) return false;
    assert.equal(slot.successor, hash, 'Another action won the saved vote slot; preserve the journal');
    return true;
  }, 60);
  const confirmed = await rpc('block_info', {hash});
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.account, account);
  assert.equal(confirmed.previous, previous);
  const head = (await rpc('account_info', {account})).head;
  await script(`history.pushState({}, '', '/pay/offline');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`document.body.textContent.includes(${JSON.stringify(hash)})`);
  await click('Check confirmation');
  await wait(`document.body.textContent.includes('Transaction confirmed.')`);
  assert.equal(await invoke('get_offline_payment', {expectedAccount:account}), null);
  assert.equal((await rpc('account_info', {account})).head, head, 'Confirmation check signed another action');
  console.log(`PASS saved vote confirmed without resubmission: ${hash}`);
}

export async function resolveExcludedReceipt(account, hash, payment) {
  const pending = await invoke('get_offline_payment', {expectedAccount:account});
  assert.equal(pending?.hash, hash);
  assert.equal(pending.kind, 'Receive');
  assert.equal(pending.can_discard, false);
  assert(process.env.XDG_DATA_HOME, 'Recovery requires the preserved native profile');
  const directory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments');
  const draft = JSON.parse(await readFile(join(directory, `${account}.json`), 'utf8'));
  assert.equal(Buffer.from(draft.block.hash).toString('hex'), hash);
  const before = await rpc('account_info', {account});
  const claims = await rpc('account_pending', {account, count:100});
  assert(claims.pending.some(row => row.hash === payment));
  await click('Receive');
  await wait(`!![...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Check saved transaction')`);
  assert(await script(`const link = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Check saved transaction');
    if (!link) return false; link.click(); return true;`));
  await wait(`document.body.textContent.includes(${JSON.stringify(hash)})`);
  assert.equal(await script(`return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Review and submit')`), false);
  await click('Check confirmation');
  await wait(`document.body.textContent.includes('This transaction was not applied. Return to its original screen to review a new action.')`);
  assert.equal(await invoke('get_offline_payment', {expectedAccount:account}), null);
  const completed = join(directory, 'completed', account);
  const archives = (await readdir(completed)).filter(name => name.startsWith('excluded-by-epoch-') && name.endsWith(`-${hash}.json`));
  assert.equal(archives.length, 1, 'Exclusion must retain a unique recovery receipt');
  assert.deepEqual(JSON.parse(await readFile(join(completed, archives[0]), 'utf8')), draft,
    'Archived receipt must retain the signed block and ancestry');
  assert.equal((await rpc('account_info', {account})).head, before.head);
  assert.deepEqual(await rpc('account_pending', {account, count:100}), claims,
    'Reconciliation must not consume or replace the original claim');
  assert(await script(`const link = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Return to receiving');
    if (!link) return false; link.click(); return true;`));
  await wait(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Review' && !b.disabled)`);
}

export async function chooseRepresentative(account, representative) {
  const before = await rpc('account_info', {account});
  assert.equal(before.verification_state, 'unverified');
  await script(`history.pushState({}, '', '/settings');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`!!document.getElementById('representative-address')`);
  await fill('representative-address', 'invalid-address');
  await click('Change Representative');
  await wait(`document.body.textContent.includes('Address must start with brst_')`);
  assert.equal((await rpc('account_info', {account})).head, before.head,
    'Invalid representative input signed a block');
  await fill('representative-address', representative);
  await click('Change Representative');
  await until(async () => {
    const error = await script(`return [...document.querySelectorAll('[data-sonner-toast]')]
      .find(toast => /Failed to change representative|Change rejected/.test(toast.textContent))?.textContent`);
    assert(!error, `Representative change failed: ${error}`);
    return script(`return document.getElementById('representative-address')?.value === ''`);
  });
  const after = await rpc('account_info', {account});
  assert.notEqual(after.head, before.head);
  assert.equal(after.representative, representative);
  assert.equal(after.verification_state, 'unverified');
  const block = await rpc('block_info', {hash:after.head});
  assert.equal(block.confirmed, true);
  assert.equal(block.account, account);
  assert.equal(block.previous, before.head, 'Representative form published more than one block');
  assert.equal(block.block_type, 'ChangeRepresentative');
  assert.equal(block.representative, representative);
  return {hash:after.head, representative};
}

export async function transferWithReview(account, recipient, amount, rawAmount) {
  const portfolio = await rpc('trst_portfolio', {account});
  const sources = new Map();
  for (const batch of portfolio.batches.filter(batch => batch.status === 'active')) {
    sources.set(batch.origin, (sources.get(batch.origin) ?? 0n) + BigInt(batch.amount));
  }
  const origin = [...sources.entries()].sort(([a], [b]) => a.localeCompare(b))
    .find(([, available]) => available >= BigInt(rawAmount))?.[0];
  assert(origin, 'Test wallet lacks an origin covering the transfer');
  const provenance = await rpc('trst_origins', {origin});
  await script(`history.pushState({}, '', '/transfer');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`!!document.getElementById('recipient') && !document.querySelector('.animate-shimmer')`);
  await fill('recipient', recipient);
  const head = (await rpc('account_info', {account})).head;
  await fill('transfer-amount', (BigInt(portfolio.total_active) / unit + 1n).toString());
  await click('Transfer TRST');
  await wait(`!!document.getElementById('payment-error')`);
  assert.equal(await script(`return !!document.querySelector('[role="dialog"]')`), false);
  assert.equal((await rpc('account_info', {account})).head, head, 'Unfunded transfer signed a block');
  await fill('transfer-amount', amount);
  await click('Transfer TRST');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [recipient]), true);
  assert.equal(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [`${amount} TRST`]), true);
  assert.equal((await rpc('account_info', {account})).head, head, 'Transfer review signed a block');
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, head, 'Transfer cancellation signed a block');
  await click('Transfer TRST');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Confirm Transfer');
  await until(async () => {
    const outcome = await script(`return {
      confirmed:document.querySelector('[data-transaction-receipt]')?.textContent.includes('Transaction confirmed'),
      uncertain:document.querySelector('[data-transaction-receipt]')?.textContent.includes('Confirmation pending'),
      error:document.querySelector('[role="dialog"] [role="alert"]')?.textContent};`);
    assert(!outcome.error, `Native transfer rejected: ${outcome.error}`);
    assert(!outcome.uncertain, 'Native transfer remains uncertain; do not resubmit');
    return outcome.confirmed;
  });
  const hash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent.trim()`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const block = await rpc('block_info', {hash});
  assert.equal(block.confirmed, true);
  assert.equal(block.account, account);
  assert.equal(block.previous, head);
  assert.equal(block.origin, origin);
  const pending = (await rpc('account_pending', {account:recipient, count:100})).pending.find(row => row.hash === hash);
  assert(pending, 'Confirmed transfer has no recipient claim');
  assert.equal(pending.amount, rawAmount);
  assert.equal(pending.source, account);
  assert.deepEqual(await rpc('trst_origins', {origin}), provenance, 'Transfer changed its original provenance or age');
  console.log('PASS native TRST transfer review, unsigned cancellation, exact recipient claim and preserved provenance');
  return {hash, origin, provenance};
}

export async function receiveWithReview(account, hashes) {
  if (!(await script(`return location.pathname === '/receive'`))) await click('Receive');
  await wait(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Review')`);
  const pendingHashes = async () => (await rpc('account_pending', {account, count:100})).pending.map(row => row.hash).sort();
  assert.deepEqual(await pendingHashes(), [...hashes].sort());
  const review = hashes.length === 1 ? 'Review' : 'Review all payments';
  await click(review);
  await wait(`!!document.querySelector('[role="dialog"]')`);
  for (const hash of hashes) {
    assert.equal(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [hash]), true);
  }
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.deepEqual(await pendingHashes(), [...hashes].sort(), 'Cancelled review consumed a payment');
  await click(review);
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click(hashes.length === 1 ? 'Receive' : 'Receive all');
  await wait(`[...document.querySelectorAll('[role="dialog"] p')].filter(p => p.textContent.trim() === 'Received').length === ${hashes.length}`);
  await click('Done');
  await until(async () => (await pendingHashes()).length === 0);
  await until(async () => {
    const {head} = await rpc('account_info', {account});
    return (await rpc('block_info', {hash:head})).confirmed;
  });
}

export async function importTestIdentity(seed) {
  await onboarding();
  assert(await script(`const summary = [...document.querySelectorAll('summary')].find(s => s.textContent.trim() === 'More ways to restore');
    if (!summary) return false; summary.click(); return summary.parentElement.open;`));
  await click('Import Private Key');
  await wait(`!!document.getElementById('wallet-private-key')`);
  // Public disposable identities, never keys from a user's wallet.
  await fill('wallet-private-key', seed.toString(16).padStart(2, '0').repeat(32));
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  const account = await dashboard();
  if (!await invoke('get_offline_payment', {expectedAccount:account})) await useSigningDevice(account);
  return account;
}

async function verificationPage() {
  assert(await script(`const link = document.querySelector('a[href="/verification"]');
    if (!link) return false; link.click(); return true;`));
}

async function confirmedUiAction(account, blockType) {
  await until(async () => {
    const outcome = await script(`return {
      confirmed:document.querySelector('[data-transaction-receipt]')?.textContent.includes('Transaction confirmed'),
      uncertain:document.querySelector('[data-transaction-receipt]')?.textContent.includes('Confirmation pending'),
      error:document.querySelector('[role="alert"]')?.textContent};`);
    assert(!outcome.error, `Native ${blockType} rejected: ${outcome.error}`);
    assert(!outcome.uncertain, `Native ${blockType} remains uncertain; do not resubmit`);
    return outcome.confirmed;
  });
  const hash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent.trim()`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const block = await rpc('block_info', {hash});
  assert.equal(block.confirmed, true);
  assert.equal(block.account, account);
  assert.equal(block.block_type, blockType);
  return hash;
}

export async function participationFromUi(seed) {
  const account = await importTestIdentity(seed);
  await verificationPage();
  const hashes = [];
  for (const optedIn of [false, true]) {
    const label = optedIn ? 'Volunteer to verify' : 'Stop new assignments';
    await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`);
    await click(label);
    hashes.push(await confirmedUiAction(account, optedIn ? 'VerifierOptIn' : 'VerifierOptOut'));
    await until(async () => (await rpc('verification_status', {account})).verifier_opted_in === optedIn);
    await click('Start another');
    await wait(`!document.querySelector('[data-transaction-receipt]')`);
  }
  console.log('PASS native UI verifier opt-out and opt-in with confirmed participation state');
  return {account, hashes};
}

export async function endorseWithReview(seed, target, amount, rawAmount) {
  const account = await importTestIdentity(seed);
  await verificationPage();
  await wait(`[...document.querySelectorAll('summary')].some(s => s.textContent.trim() === 'Vouch for someone')`);
  assert(await script(`const summary = [...document.querySelectorAll('summary')].find(s => s.textContent.trim() === 'Vouch for someone');
    summary.click(); return summary.parentElement.open;`));
  await fill('endorse-address', target);
  await fill('endorse-amount', amount);
  const before = await rpc('account_info', {account});
  await click('Endorse');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  for (const value of [target, `${amount} BRN`, 'Your BRN will be permanently burned.']) {
    assert.equal(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [value]), true);
  }
  assert.equal((await rpc('account_info', {account})).head, before.head, 'Endorsement review signed a block');
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, before.head, 'Endorsement cancellation signed a block');
  await click('Endorse');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Burn & Endorse');
  const hash = await confirmedUiAction(account, 'Endorse');
  const after = await rpc('account_info', {account});
  assert.equal(BigInt(after.total_brn_burned) - BigInt(before.total_brn_burned), BigInt(rawAmount));
  assert((await rpc('verification_status', {account:target})).endorsers.includes(account));
  console.log('PASS native endorsement review, unsigned cancellation and exact permanent BRN burn');
  return {account, hash};
}

export async function voteFromAssignment(seed, target, panel, vote) {
  assert(vote === 1 || vote === 2, 'This journey requires a staked identity decision');
  const decision = vote === 1 ? 'Legitimate' : 'Illegitimate';
  const account = await importTestIdentity(seed);
  assert(panel.selected_verifiers.includes(account));
  await verificationPage();
  await wait(`!!document.querySelector('button[aria-label=${JSON.stringify(`Review ${target}`)}]')`);
  await click(`Review ${target}`);
  await wait(`!!document.querySelector('input[name="identity-decision"]')`);
  const reviewed = await invoke('get_verification_review', {rpcUrl, target});
  assert(reviewed.enabled && reviewed.selected && !reviewed.voted);
  assert.equal(reviewed.selection_context, panel.selection_context);
  assert.equal(reviewed.stake, (500n * unit).toString());
  const head = (await rpc('account_info', {account})).head;
  await script(`document.querySelectorAll('input[name="identity-decision"]')[arguments[0] - 1].click()`, [vote]);
  await click('Review vote');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  const details = await script(`return [...document.querySelectorAll('[role="dialog"] dl > div')].map(row =>
    [row.querySelector('dt').textContent, row.querySelector('dd').textContent]);`);
  assert.deepEqual(Object.fromEntries(details), {Wallet:target, Decision:decision, 'Stake at risk':'500.000000000000000000 BRN'});
  assert.equal((await rpc('account_info', {account})).head, head, 'Vote review signed a block');
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, head, 'Vote cancellation signed a block');
  assert.equal((await invoke('get_verification_review', {rpcUrl, target})).voted, false);
  await click('Review vote');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  // A selected panel can arrive before peers finish installing its checkpoint.
  // Wait before the first submission; never retry a possibly signed vote here.
  await until(async () => (await rpc('params_hash')).online_signing === 'peer_matches');
  const currentReview = await invoke('get_verification_review', {rpcUrl, target});
  assert(currentReview.enabled && currentReview.selected && !currentReview.voted);
  assert.equal(currentReview.selection_context, panel.selection_context);
  assert.equal((await rpc('account_info', {account})).head, head, 'Waiting for signing readiness changed the voter head');
  await click('Record vote');
  let lastOutcome;
  try {
  await until(async () => {
    const outcome = await script(`const panel = document.querySelector('section[aria-label="Review an identity"]');
      return {panelPresent:!!panel, dialogPresent:!!document.querySelector('[role="dialog"]'),
        recording:!![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Recording…'),
        confirmed:document.querySelector('[data-transaction-receipt]')?.textContent.includes('Transaction confirmed'),
        uncertain:document.querySelector('[data-transaction-receipt]')?.textContent.includes('Confirmation pending'),
        uiError:document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? panel?.querySelector('[role="alert"]')?.textContent};`);
    lastOutcome = outcome;
    assert(!outcome.uiError, `Native vote rejected: ${outcome.uiError}`);
    return outcome.confirmed || outcome.uncertain;
  });
  } catch (error) {
    console.error('Native vote UI state:', JSON.stringify(lastOutcome));
    try {
      const params = await rpc('params_hash');
      console.error('Readiness sampled after vote failure:', JSON.stringify({
        sampled_at: new Date().toISOString(), online_signing: params.online_signing,
        payment_epoch: params.payment_epoch,
      }));
    } catch (diagnosticError) {
      console.error('Readiness sample unavailable:', diagnosticError.message);
    }
    throw error;
  }
  const hash = await script(`return document.querySelector('[data-transaction-receipt] details p').textContent.trim()`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  if (lastOutcome.uncertain) {
    assert(await script(`const link = document.querySelector('[data-transaction-receipt] a[href="/pay/offline"]');
      if (!link) return false; link.click(); return true;`));
    await resolveConfirmedVote(account, hash);
  }
  const block = await rpc('block_info', {hash});
  assert.equal(block.confirmed, true);
  assert.equal(block.account, account);
  assert.equal(block.previous, head);
  assert.equal((await invoke('get_verification_review', {rpcUrl, target})).voted, true);
  console.log('PASS assigned identity review, exact stake, unsigned cancellation and confirmed native UI vote');
}

function displayAmount(raw) {
  const value = BigInt(raw);
  const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '');
  return `${value / unit}${fraction ? `.${fraction}` : ''}`;
}

async function reviewedIdentityAction(account, review, confirm, details, type) {
  const before = (await rpc('account_info', {account})).head;
  await click(review);
  await wait(`!!document.querySelector('[role="dialog"]')`);
  for (const text of details) {
    assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [text]),
      `${type} review omitted the target, decision, stake or consequences`);
  }
  assert.equal((await rpc('account_info', {account})).head, before);
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, before, `${type} cancellation signed a block`);
  await click(review);
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click(confirm);
  const hash = await confirmedUiAction(account, type);
  assert.equal((await rpc('block_info', {hash})).previous, before, `${type} form signed more than one block`);
  return hash;
}

export async function challengeWithReview(seed, target, rawStake) {
  const account = await importTestIdentity(seed);
  await verificationPage();
  await wait(`[...document.querySelectorAll('summary')].some(s => s.textContent.trim() === 'Report a wallet')`);
  await script(`[...document.querySelectorAll('summary')].find(s => s.textContent.trim() === 'Report a wallet').click()`);
  await fill('challenge-address', target);
  const stake = displayAmount(rawStake);
  await fill('challenge-stake', stake);
  assert.equal(await script(`return document.getElementById('challenge-reason').value`), 'fraud');
  const hash = await reviewedIdentityAction(account, 'Challenge', 'Submit Challenge',
    [target, `${stake} BRN`, 'Fraud review.', 'TRST originating from this wallet is revoked.'], 'Challenge');
  assert.equal((await rpc('block_info', {hash})).target_head, '0'.repeat(64));
  return hash;
}

export async function appealWithReview(seed, target, reviewed) {
  const account = await importTestIdentity(seed);
  await verificationPage();
  await wait(`!!document.querySelector('[aria-label="Appeal a decision"] summary')`);
  await script(`document.querySelector('[aria-label="Appeal a decision"] summary').click()`);
  await fill('appeal-address', target);
  await click('Find decision');
  await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Review appeal' && !b.disabled)`);
  const hash = await reviewedIdentityAction(account, 'Review appeal', 'Stake and appeal',
    [target, reviewed.outcome.hash, `${displayAmount(reviewed.required_stake)} BRN at risk`,
      'Fraud confirmed', 'Restoration does not make expired TRST spendable or erase independent revocations.'], 'Challenge');
  assert.equal((await rpc('block_info', {hash})).target_head, reviewed.outcome.hash);
  return hash;
}
