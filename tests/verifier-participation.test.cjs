// Synthetic IPC interaction checks, not proof of native signing or consensus.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openGovernance } = require('./browser-wallet.cjs');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH }); });
after(async () => { await browser?.close(); });
const target = 'brst_' + '3'.repeat(60);

async function fixture(options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width || 1000, height: 850 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => console.error('Browser error:', error.message));
  await page.addInitScript(options => {
    window.isTauri = true;
    window.calls = [];
    const account = 'brst_' + '1'.repeat(60);
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.calls.push({ command, args });
      switch (command) {
        case 'import_private_key': return { address: account, verification_state: 'verified' };
        case 'get_node_info': return { block_count: 7, network: 'test', faucet_enabled: false };
        case 'get_account_info': return { address: account, verification_state: 'verified', brn_balance: '0', block_count: 7 };
        case 'get_verification_status':
          if (window.statusUnavailable) throw Error('Status temporarily unavailable');
          return { state: 'verified', endorsement_count: 0, endorsement_threshold: 3, endorsers: [], verifier_votes: [], challenge_active: false, selection_available: true, verifier_opted_in: options.unknown ? null : false };
        case 'get_verification_review': return { target: args.target, phase: 'voting', selection_context: 'a'.repeat(64), enabled: true, selected: options.selected !== false, voted: !!options.voted, stake: '500000000000000000001', params_hash: 'b'.repeat(64) };
        case 'get_verifier_assignments': return { targets: options.assigned ? ['brst_' + '3'.repeat(60)] : [], cursor: null };
        case 'cast_verification_vote': case 'set_verifier_participation':
          if (options.interruptVote && command === 'cast_verification_vote') {
            window.statusUnavailable = options.statusFailure !== false;
            await new Promise(resolve => { window.finishVote = resolve; });
            if (options.uncertain) throw Error('confirmation pending for ' + 'c'.repeat(64));
          }
          await new Promise(resolve => setTimeout(resolve, 100));
          return { accepted: true, hash: 'c'.repeat(64) };
        case 'get_governance_proposals': return { proposals: [] };
        case 'get_constitution_context': return { enabled: false, document: { version: '0', articles: [] }, revision: 'fixture', endorsement_cost: '1' };
        case 'get_scoped_delegations': return { enabled: false, network: 'Test', genesis: 'c'.repeat(64), parameters: [], entries: [], cursor: null };
        case 'begin_automation': return '1';
        case 'cancel_automation': return null;
        case 'get_pending': return { blocks: [] };
        case 'get_brn_components': return { verified_at: 0, total_burned: '0', total_staked: '0', accrual_active: false, accrual_stopped_at: 1, as_of: 1, rate_history: [{ rate: '0', start: 0, end: null }] };
        case 'get_trst_balance': return { active: '0', expired: '0', revoked: '0' };
        default: throw new Error('Unexpected command: ' + command);
      }
    } };
  }, options);
  await openGovernance(page);
  await page.evaluate(() => { history.pushState({}, '', '/verification'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('heading', { name: 'Verification', exact: true }).waitFor();
  return page;
}

async function lookup(page) {
  await page.getByText('Review an identity', { exact: true }).click();
  await page.getByLabel('Wallet to review', { exact: true }).fill(target);
  await page.getByLabel('Wallet to review', { exact: true }).press('Enter');
}

test('volunteering signs once and unknown membership cannot be toggled', async () => {
  for (const unknown of [false, true]) {
    const page = await fixture({ unknown });
    try {
      const button = page.getByRole('button', { name: 'Volunteer to verify', exact: true });
      if (unknown) { assert.equal(await button.count(), 0); continue; }
      await button.click();
      await page.getByRole('heading', { name: 'Transaction confirmed', exact: true }).waitFor();
      assert.equal(await button.isDisabled(), true);
      const calls = await page.evaluate(() => window.calls.filter(c => c.command === 'set_verifier_participation'));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].args.optedIn, true);
      assert.equal(calls[0].args.expectedAccount, 'brst_' + '1'.repeat(60));
    } finally { await page.close(); }
  }
});

test('selected vote keeps exact stake/context, keyboard cancellation, and mobile layout', async () => {
  const page = await fixture({ width: 390, assigned: true });
  try {
    await page.getByRole('button', { name: `Review ${target}`, exact: true }).click();
    await page.getByLabel('Legitimate', { exact: true }).check();
    await page.getByRole('button', { name: 'Review vote', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Review vote', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'Review vote', exact: true }).press('Enter');
    await page.getByRole('dialog').screenshot({ path: '/tmp/burst-verifier-vote-mobile.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Record vote', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Transaction confirmed', exact: true }).waitFor();
    const calls = await page.evaluate(() => window.calls.filter(c => c.command === 'cast_verification_vote'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.vote, 1);
    assert.equal(calls[0].args.reviewed.stake, '500000000000000000001');
    assert.equal(calls[0].args.reviewed.selection_context, 'a'.repeat(64));
  } finally { await page.close(); }
});

test('unselected or already voted wallets cannot submit', async () => {
  for (const options of [{ selected: false }, { voted: true }]) {
    const page = await fixture(options);
    try {
      await lookup(page);
      await page.getByText(options.voted ? 'You’ve already voted in this round.' : 'You’re not selected for this panel.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Review vote', exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.calls.some(c => c.command === 'cast_verification_vote')), false);
    } finally { await page.close(); }
  }
});

for (const uncertain of [false, true]) test(`vote ${uncertain ? 'recovery' : 'confirmation'} remains visible when status polling fails`, async () => {
  const page = await fixture({ assigned: true, interruptVote: true, uncertain });
  try {
    await page.getByRole('button', { name: `Review ${target}`, exact: true }).click();
    await page.getByLabel('Legitimate', { exact: true }).check();
    await page.getByRole('button', { name: 'Review vote', exact: true }).click();
    await page.getByRole('button', { name: 'Record vote', exact: true }).click();
    await page.getByText('Verification status unavailable', { exact: true }).waitFor({ timeout: 15000 });
    await page.evaluate(() => window.finishVote());
    await page.getByRole('heading', { name: uncertain ? 'Confirmation pending' : 'Transaction confirmed', exact: true }).waitFor();
    assert.equal(await page.locator('section[aria-label="Review an identity"]').count(), 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    if (uncertain) await page.getByRole('link', { name: 'Review saved transaction', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Review vote', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.command === 'cast_verification_vote').length), 1);
    await page.evaluate(() => { window.statusUnavailable = false; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('button', { name: `Review ${target}`, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: `Review ${target}`, exact: true }).isDisabled(), true);
    assert.equal(await page.locator('section[aria-label="Review an identity"]').count(), 1);
  } finally { await page.close(); }
});

test('successful status polling does not duplicate an in-flight vote panel or dialog', async () => {
  const page = await fixture({ assigned: true, interruptVote: true, statusFailure: false });
  try {
    await page.getByRole('button', { name: `Review ${target}`, exact: true }).click();
    await page.getByLabel('Legitimate', { exact: true }).check();
    await page.getByRole('button', { name: 'Review vote', exact: true }).click();
    const statusReads = await page.evaluate(() => window.calls.filter(call => call.command === 'get_verification_status').length);
    await page.getByRole('button', { name: 'Record vote', exact: true }).click();
    await page.waitForFunction(count => window.calls.filter(call => call.command === 'get_verification_status').length > count, statusReads);
    await page.evaluate(() => window.finishVote());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Transaction confirmed', exact: true }).waitFor();
    assert.equal(await page.locator('section[aria-label="Review an identity"]').count(), 1);
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'cast_verification_vote').length), 1);
  } finally { await page.close(); }
});
