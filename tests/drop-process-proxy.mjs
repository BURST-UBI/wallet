import { createServer } from 'node:http';

export async function dropProcessProxy(rpcUrl) {
  let dropped = 0;
  const server = createServer(async (request, response) => {
    let action = 'unparsed';
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = Buffer.concat(chunks);
      action = JSON.parse(payload.toString()).action;
      if (action === 'process') {
        dropped++;
        response.destroy();
        return;
      }
      const upstream = await fetch(rpcUrl, {method:'POST', headers:{'Content-Type':'application/json'},
        body:payload, signal:AbortSignal.timeout(45000)});
      response.writeHead(upstream.status, {'Content-Type':'application/json'});
      response.end(await upstream.text());
    } catch (error) {
      console.error('Drop-process proxy failed', action, error.name, error.message);
      response.writeHead(502).end();
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {
    url:`http://127.0.0.1:${server.address().port}`,
    get dropped() { return dropped; },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    },
  };
}
