import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';

// Test-only pass-through. Signed network payloads are public, but their exact
// bytes (including u128 values) must survive without a JSON parse/stringify.
export async function processEvidenceProxy(upstreamUrl, path, { dropAcceptedResponse = false, beforeProcess } = {}) {
  const endpoint = new URL(upstreamUrl);
  assert.equal(endpoint.protocol, 'http:');
  assert.equal(endpoint.hostname, '127.0.0.1');
  let sequence = 0;
  const server = createServer(async (request, response) => {
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const process = JSON.parse(body.toString()).action === 'process';
      const id = ++sequence;
      if (process) await appendFile(path, JSON.stringify({id, request:body.toString()}) + '\n', {mode:0o600});
      if (process && beforeProcess) await beforeProcess(body);
      const upstream = await fetch(upstreamUrl, {
        method:'POST', headers:{'Content-Type':'application/json'}, body,
        signal:AbortSignal.timeout(45000),
      });
      const reply = await upstream.text();
      if (process) await appendFile(path, JSON.stringify({id, status:upstream.status, response:reply}) + '\n', {mode:0o600});
      if (process && dropAcceptedResponse) {
        const parsed = JSON.parse(reply);
        if ((parsed.result ?? parsed).accepted === true) {
          response.destroy();
          return;
        }
      }
      response.writeHead(upstream.status, {'Content-Type':'application/json'}).end(reply);
    } catch {
      response.writeHead(502).end();
    }
  });
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  return {
    url:`http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
