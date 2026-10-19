import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const mode of ['reference', 'online', 'premature']) {
test(`pinned readiness check: ${mode}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'burst-readiness-test-'));
  const account = `brst_${'1'.repeat(60)}`;
  const epoch = 'ab'.repeat(32), head = 'cd'.repeat(32);
  const path = join(directory, 'reference.json');
  await writeFile(path, JSON.stringify({payment_epoch:epoch, accounts:[{account, head}]}));
  let paramsReads = 0, blockReads = 0, nodeReads = 0;
  const server = createServer(async (request, response) => {
    let bytes = '';
    for await (const chunk of request) bytes += chunk;
    const {action} = JSON.parse(bytes);
    let result;
    if (action === 'node_info') {
      const connected = ++nodeReads > 1;
      if (nodeReads === 2) assert.equal(paramsReads, 0, 'disconnected node must not reach state checks');
      result = {network:'test', verified_count:1000, peer_count:connected ? 1 : 0};
    }
    else if (action === 'params_hash') {
      ++paramsReads;
      result = {payment_epoch:paramsReads < 3 ? '00'.repeat(32) : epoch,
        online_signing:mode === 'premature' || paramsReads >= 4 ? 'peer_matches' : 'unknown'};
    }
    else if (action === 'account_info') result = {head};
    else if (action === 'block_info') result = {account, confirmed:++blockReads > 1};
    else assert.fail(`Unexpected RPC action ${action}`);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({result}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, [new URL('./wait-certified-reference.mjs', import.meta.url).pathname,
      path, `http://127.0.0.1:${server.address().port}`, ...(mode === 'reference' ? [] : ['--online-signing'])], {stdio:['ignore','pipe','pipe']});
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    const timer = setTimeout(() => child.kill(), 10000);
    const code = await new Promise(resolve => child.once('exit', resolve));
    clearTimeout(timer);
    if (mode === 'premature') {
      assert.notEqual(code, 0, output);
      assert.match(output, /Premature signing readiness/);
      assert.equal(blockReads, 0);
    } else {
      assert.equal(code, 0, output);
      assert(blockReads >= 2, 'unconfirmed heads must not pass');
      assert(nodeReads >= 5, 'disconnected startup must not pass');
      assert(paramsReads >= 6, 'old epoch and post-read epoch must be checked');
      assert.match(output, /PASS pinned certified epoch/);
      if (mode === 'online') assert.match(output, /with online signing readiness/);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive:true});
  }
});
}
