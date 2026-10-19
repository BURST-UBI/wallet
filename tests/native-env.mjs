import assert from 'node:assert/strict';

export const rpcUrl = process.env.NODE_RPC_URL;
assert(rpcUrl, 'Set NODE_RPC_URL to the disposable local Dev node');
const endpoint = new URL(rpcUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Native write tests require a loopback node');
assert(process.env.WEBDRIVER_SESSION, 'Run tests/native-session.mjs to create an isolated native session');
export const base = `${process.env.WEBDRIVER_URL || 'http://127.0.0.1:4444'}/session/${process.env.WEBDRIVER_SESSION}`;

export async function rpc(action, params = {}) {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, action }), signal: AbortSignal.timeout(45000),
  });
  assert(response.ok, `RPC HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.error, String(body.error));
  return body.result ?? body;
}

const network = process.env.NATIVE_CERTIFIED_ONBOARDING === '1' || process.env.NATIVE_HISTORY_ONLY === '1' ? 'test' : 'dev';
assert.equal((await rpc('node_info')).network, network, `Native write tests require disposable ${network}`);
if (network === 'test') {
  assert.equal((await rpc('protocol_params')).brn_rate, '100000000000000000000',
    'Certified onboarding requires the explicitly governed disposable Test ledger');
}
