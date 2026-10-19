import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {enrollSigningDeviceWith} from './device-enrollment.mjs';

async function fixture(run) {
  const server=createServer((_request,response)=>response.end(JSON.stringify({result:{online_signing:'peer_matches'}})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
const state={head:'original',grant:'grant',params_hash:'rules',active_here:false};
const unready=new Error('node synchronization is not ready');

test('optional readiness reader waits without signing while checkpoint catch-up is reported',async()=>{
  let reads=0,attempts=0;
  const invoke=async command=>{
    if(command==='signing_device_status')return {...state,active_here:attempts===1};
    assert.equal(command,'take_over_signing');attempts++;
  };
  await enrollSigningDeviceWith(invoke,'ipc-only-fixture','fixture',async()=>({online_signing:++reads===1?'catching_up':'peer_matches'}));
  assert.equal(reads,2);assert.equal(attempts,1);
});

test('fixture retries pre-sign readiness only with unchanged account and no journal',async()=>fixture(async url=>{
  let attempts=0;
  const invoke=async command=>{
    if(command==='get_offline_payment')return null;
    if(command==='signing_device_status')return {...state,active_here:attempts===2};
    assert.equal(command,'take_over_signing');
    if(++attempts===1)throw unready;
  };
  await enrollSigningDeviceWith(invoke,url,'fixture');
  assert.equal(attempts,2);
}));
for(const boundary of ['pending','changed-head','other-error']) {
  test(`fixture does not retry ${boundary}`,async()=>fixture(async url=>{
    let attempts=0;
    const invoke=async command=>{
      if(command==='get_offline_payment')return boundary==='pending'?{hash:'reserved'}:null;
      if(command==='signing_device_status')return {...state,head:attempts&&boundary==='changed-head'?'opened':state.head};
      assert.equal(command,'take_over_signing');
      attempts++;
      throw boundary==='other-error'?new Error('transport uncertain'):unready;
    };
    await assert.rejects(enrollSigningDeviceWith(invoke,url,'fixture'));
    assert.equal(attempts,1);
  }));
}
