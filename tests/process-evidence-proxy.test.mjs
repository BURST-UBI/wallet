import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processEvidenceProxy } from './process-evidence-proxy.mjs';

test('takeover barrier holds exact process bytes while read-only RPC stays available', async () => {
  const requests = [];
  const server = createServer(async (request,response) => {
    const chunks=[];
    for await(const chunk of request)chunks.push(chunk);
    requests.push(Buffer.concat(chunks).toString());
    response.end('{"result":{"accepted":true}}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const path=join(await mkdtemp(join(tmpdir(),'burst-process-barrier-')),'request.jsonl');
  const entered=Promise.withResolvers(),release=Promise.withResolvers();
  const payload='{"action":"process","block":"public signed fixture"}';
  const proxy=await processEvidenceProxy(`http://127.0.0.1:${server.address().port}`,path,{
    beforeProcess:async bytes=>{assert.equal(bytes.toString(),payload);entered.resolve();await release.promise;},
  });
  try {
    const sending=fetch(proxy.url,{method:'POST',body:payload});
    await entered.promise;
    assert.deepEqual(requests,[],'Signed action escaped its barrier');
    const read='{"action":"account_info"}';
    assert.equal((await fetch(proxy.url,{method:'POST',body:read})).status,200);
    assert.deepEqual(requests,[read]);
    release.resolve();
    assert.equal((await sending).status,200);
    assert.deepEqual(requests,[read,payload]);
  } finally {
    release.resolve();await proxy.close();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('forwards exact request/reply bytes and records only process traffic', async () => {
  const requests = [];
  const reply = '{"result":{"accepted":true,"amount":340282366920938463463374607431768211455}}';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(Buffer.concat(chunks).toString());
    response.writeHead(200, {'Content-Type':'application/json'}).end(reply);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const path = join(await mkdtemp(join(tmpdir(), 'burst-process-evidence-')), 'request.jsonl');
  const proxy = await processEvidenceProxy(`http://127.0.0.1:${server.address().port}`, path);
  try {
    const read = '{"action":"account_info","account":"public-fixture"}';
    const payload = '{"action":"process","block":"{\\"balance\\":340282366920938463463374607431768211455}"}';
    for (const body of [read, payload]) {
      const response = await fetch(proxy.url, {method:'POST', body});
      assert.equal(await response.text(), reply);
    }
    assert.deepEqual(requests, [read, payload]);
    const records = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(records, [{id:2,request:payload}, {id:2,status:200,response:reply}]);
    const tooLarge = await fetch(proxy.url, {method:'POST',body:'x'.repeat(1024*1024+1)});
    assert.equal(tooLarge.status, 413);
    assert.equal(requests.length, 2);
  } finally {
    await proxy.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('response-loss mode records upstream acceptance but preserves rejection responses', async () => {
  let accepted = false;
  const server = createServer((_request,response) => {
    response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({result:{accepted}}));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const path = join(await mkdtemp(join(tmpdir(),'burst-process-loss-')),'request.jsonl');
  const proxy = await processEvidenceProxy(`http://127.0.0.1:${server.address().port}`,path,{dropAcceptedResponse:true});
  try {
    const options = {method:'POST',body:JSON.stringify({action:'process',block:'public fixture'})};
    assert.equal((await (await fetch(proxy.url,options)).json()).result.accepted,false);
    accepted = true;
    await assert.rejects(fetch(proxy.url,options));
    const records = (await readFile(path,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.length,4);
    assert.equal(JSON.parse(records[3].response).result.accepted,true);
    assert.equal(records[2].request,options.body);
  } finally {
    await proxy.close();server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
