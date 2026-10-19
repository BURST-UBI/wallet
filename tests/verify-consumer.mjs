import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [path, ...urls] = process.argv.slice(2);
assert(path && urls.length, 'Provide the native onboarding report and node URLs');
const report = JSON.parse(await readFile(path, 'utf8'));
for (const url of urls) {
  const endpoint = new URL(url);
  assert.equal(endpoint.hostname, '127.0.0.1');
  assert.equal(endpoint.protocol, 'http:');
  const rpc = async (action, params = {}) => {
    const response = await fetch(url, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({action, ...params}), signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    assert(response.ok && !body.error,
      `RPC ${action}${params.hash ? ` ${params.hash}` : ''} failed (HTTP ${response.status}): ${JSON.stringify(body.error ?? null)}`);
    return body.result ?? body;
  };
  assert.equal((await rpc('node_info')).network, 'test');
  const deadline = Date.now() + 60000;
  let failure;
  while (Date.now() < deadline) {
    try {
      for (const hash of [report.payment, report.transfer]) {
        const block = await rpc('block_info', {hash});
        assert.equal(block.confirmed, true);
        assert.equal(block.account, report.subject);
      }
      const status = await rpc('verification_status', {account:report.subject});
      assert.equal(status.status, 'verified');
      assert.equal(status.selection_context, report.selection_context);
      if (report.representative_change) {
        const block = await rpc('block_info', {hash:report.representative_change.hash});
        assert.equal(block.confirmed, true);
        assert.equal(block.account, report.subject);
        assert.equal(block.block_type, 'ChangeRepresentative');
        assert.equal(block.representative, report.representative_change.representative);
        assert.equal((await rpc('account_info', {account:report.subject})).representative,
          report.representative_change.representative);
      }
      if (report.participation) {
        assert.equal(report.participation.hashes.length, 2);
        for (const [index, hash] of report.participation.hashes.entries()) {
          const block = await rpc('block_info', {hash});
          assert.equal(block.confirmed, true);
          assert.equal(block.account, report.participation.account);
          assert.equal(block.block_type, index === 0 ? 'VerifierOptOut' : 'VerifierOptIn');
        }
        assert.equal((await rpc('verification_status', {account:report.participation.account})).verifier_opted_in, true);
        assert.equal(report.endorsements.length, 3);
        for (const endorsement of report.endorsements) {
          const block = await rpc('block_info', {hash:endorsement.hash});
          assert.equal(block.confirmed, true);
          assert.equal(block.account, endorsement.account);
          assert.equal(block.block_type, 'Endorse');
          assert(status.endorsers.includes(endorsement.account));
        }
      }
      const portfolio = await rpc('trst_portfolio', {account:report.receiver});
      if (report.transfer_origin) {
        assert.equal((await rpc('block_info', {hash:report.transfer})).origin, report.transfer_origin);
        assert.deepEqual(await rpc('trst_origins', {origin:report.transfer_origin}), report.transfer_provenance);
        const received = portfolio.batches.filter(batch => batch.origin === report.transfer_origin && batch.status === 'active');
        assert.equal(received.reduce((total, batch) => total + BigInt(batch.amount), 0n), 1000000000000000n);
      }
      assert.equal(portfolio.total_active, '1001000000000000000');
      for (const field of ['expired', 'revoked', 'pending']) assert.equal(portfolio[`total_${field}`], '0');
      const account = await rpc('account_info', {account:report.receiver});
      assert.equal((await rpc('block_info', {hash:account.head})).confirmed, true);
      failure = null;
      break;
    } catch (error) { failure = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (failure) throw failure;
  console.log(`PASS verified subject, certified context, confirmed payments and exact received balance on ${url}`);
}
