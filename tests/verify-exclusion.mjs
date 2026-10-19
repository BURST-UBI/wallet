import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [path, ...urls] = process.argv.slice(2);
assert(path && urls.length);
const report = JSON.parse(await readFile(path, 'utf8'));
const deadline = Date.now() + 180000;
for (const url of urls) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const rpc = async (action, params = {}) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }), signal: AbortSignal.timeout(45000) });
    const value = await response.json();
    assert(response.ok && !value.error, JSON.stringify(value));
    return value.result ?? value;
  };
  let payment, lastError;
  while (Date.now() < deadline) {
    try {
      payment = await rpc('block_info', { hash: report.payment });
      if (payment.confirmed) break;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(payment?.confirmed, `Payment did not recover on ${url}: ${lastError?.message || 'not confirmed'}`);
  assert.equal((await rpc('node_info')).network, 'test');
  assert.equal(payment.confirmed, true);
  assert.equal(payment.account, report.account);
  if (report.enrollment_opening) {
    assert.equal(report.opening, true);
    assert.equal(report.previous, '0'.repeat(64));
    assert.equal(payment.block_type, 'Receive');
    assert.equal(payment.link, report.incoming);
    const handoff = await rpc('block_info', {hash:payment.previous});
    assert.equal(handoff.confirmed, true);
    assert.equal(handoff.account, report.account);
    assert.equal(handoff.block_type, 'ChangeSigner');
    assert.equal(handoff.active_signing_grant, payment.previous);
    assert.equal(payment.active_signing_grant, payment.previous);
    const opened = await rpc('block_info', {hash:handoff.previous});
    assert.equal(opened.confirmed, true);
    assert.equal(opened.account, report.account);
    assert.equal(opened.block_type, 'Open');
    assert.equal(opened.previous, report.previous);
    assert.equal(opened.active_signing_grant, '0'.repeat(64));
    assert.notEqual(handoff.previous, report.draft);
    const account = await rpc('account_info', {account:report.account});
    assert.equal(account.confirmed_open, handoff.previous);
    assert.equal(account.head, report.payment);
    assert.equal(account.block_count, 3);
    assert.equal(account.trst_balance, '1');
    assert.equal(account.total_brn_burned, '0');
    const pending = await rpc('account_pending', {account:report.account, count:100});
    assert(!pending.pending.some(entry => entry.hash === report.incoming));
  } else if (report.opening) {
    assert.equal(payment.previous, report.previous);
    assert.equal(report.previous, '0'.repeat(64));
    assert.equal(payment.block_type, 'Open');
    assert.equal(payment.link, report.incoming);
    const account = await rpc('account_info', {account:report.account});
    assert.equal(account.confirmed_open, report.payment);
    assert.equal(account.block_count, 1);
    assert.equal(account.trst_balance, '1');
    assert.equal(account.total_brn_burned, '0');
    const pending = await rpc('account_pending', {account:report.account, count:100});
    assert(!pending.pending.some(entry => entry.hash === report.incoming));
  } else {
  assert.equal(payment.previous, report.previous);
  const anchor = await rpc('block_info', { hash: report.previous });
  assert.equal(BigInt(payment.brn_balance) - BigInt(anchor.brn_balance), 1n,
    'Recovery spent more than the explicitly authorized replacement payment');
  assert.equal(anchor.confirmed_successor, report.payment);
  assert.notEqual(anchor.confirmed_successor, report.draft);
  }
  const proposal = await rpc('governance_proposal_info', { hash: report.proposal });
  assert.equal(proposal.phase, 'Activated');
  assert.equal(proposal.phase_projected, false);
  assert.equal(proposal.param, 'MinVerifierBrnBalance');
  const params = await rpc('protocol_params');
  assert.equal(params.governable_parameters.find(p => p.name === 'min_verifier_brn_balance').current, proposal.proposed_value);
  assert.equal(params.brn_rate, '100000000000000000000', 'Test accrual changed unexpectedly');
}
console.log('PASS exclusion recovery receipt and canonical successor on all supplied Test nodes');
