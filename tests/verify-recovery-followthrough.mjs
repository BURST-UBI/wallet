import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [path, ...urls] = process.argv.slice(2);
assert(path && urls.length);
const report = JSON.parse(await readFile(path, 'utf8'));
for (const url of urls) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const rpc = async (action, args = {}) => {
    const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,...args}), signal:AbortSignal.timeout(45000)});
    const value = await response.json();
    assert(response.ok && !value.error, JSON.stringify(value));
    return value.result ?? value;
  };
  assert.equal((await rpc('node_info')).network, 'test');
  for (const hash of [report.proposal, report.payment]) {
    const deadline = Date.now() + 90000;
    let confirmed = false;
    while (Date.now() < deadline) {
      try { confirmed = (await rpc('block_info', {hash})).confirmed; } catch {}
      if (confirmed) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(confirmed, `${hash} not confirmed on ${url}`);
  }
  const payment = await rpc('block_info', {hash:report.payment});
  const previous = await rpc('block_info', {hash:report.previous});
  assert.equal(payment.account, report.account);
  assert.equal(payment.previous, report.previous);
  assert.equal(previous.confirmed_successor, report.payment);
  assert.notEqual(previous.confirmed_successor, report.draft);
  assert.equal(BigInt(payment.brn_balance) - BigInt(previous.brn_balance), 1n);
  assert.equal((await rpc('block_info', {hash:report.proposal})).block_type, 'GovernanceProposal');
}
console.log('PASS recovered proposal and exactly one reviewed payment confirmed on all supplied nodes');
