import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rpcUrl, rpc } from './native-env.mjs';
import { invoke, until, enrollSigningDevice } from './native-certified-utils.mjs';
import { script, wait, click, fill } from './native-ui.mjs';
import { dropProcessProxy } from './drop-process-proxy.mjs';

const report = process.env.NATIVE_RESULT_PATH;
const phase = process.env.NATIVE_OFFLINE_PHASE;
assert(report && ['prepare','reconcile'].includes(phase));
let manifest;
if (phase === 'reconcile') {
  manifest = JSON.parse(await readFile(`${report}.prepared`, 'utf8'));
  await until(async () => {
    try { return JSON.parse(await readFile(`${report}.ready`, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 90);
}
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Import Private Key');
await wait(`!!document.querySelector('#wallet-private-key')`);
await fill('wallet-private-key', '00'.repeat(32)); // Public disposable Dev founder.
await click('Import');
await wait(`document.body.innerText.includes('Continue without file')`);
await click('Continue without file');
await wait(`document.body.innerText.includes('Go to Dashboard')`);
await click('Go to Dashboard');
const account = await invoke('get_address');
const path = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments', `${account}.json`);
if (phase === 'prepare') {
  await enrollSigningDevice(account);
  await writeFile(`${report}.enrolled`, JSON.stringify({account}), {flag:'wx',mode:0o600});
  await until(async () => {
    try { return JSON.parse(await readFile(`${report}.branch-ready`, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 90);
}
await script(`history.pushState({},'','/pay/offline');dispatchEvent(new PopStateEvent('popstate'));`);
if (phase === 'prepare') {
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Prepare offline payment'&&!b.disabled)`);
  await click('Prepare offline payment');
  await wait(`!!document.querySelector('#offline-provider')`);
  await fill('offline-provider', account);
  await fill('offline-amount', '0.000000000000000001');
  await click('Review offline payment');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Sign and save');
  await wait(`document.body.innerText.includes('Signed payment, not submitted')`);
  const pending = await invoke('get_offline_payment', {expectedAccount:account});
  const saved = await readFile(path, 'utf8');
  const envelope = JSON.parse(saved);
  assert(envelope.ancestry.length > 0, 'Native preparation did not preserve the losing predecessor');
  const proxy = await dropProcessProxy(rpcUrl);
  try {
    await assert.rejects(invoke('submit_offline_payment',{rpcUrl:proxy.url,expectedAccount:account,expectedHash:pending.hash}), /submission response unavailable/);
    assert.equal(proxy.dropped,1);
  } finally { await proxy.close(); }
  assert.equal((await invoke('get_offline_payment',{expectedAccount:account})).can_discard,false);
  await assert.rejects(invoke('discard_offline_payment',{expectedAccount:account,expectedHash:pending.hash}), /may already be submitted/);
  await assert.rejects(invoke('prepare_offline_payment',{rpcUrl,expectedAccount:account}), /offline|pending/i);
  await writeFile(`${report}.prepared`, JSON.stringify({account,hash:pending.hash,saved}), {flag:'wx',mode:0o600});
  console.log('PASS native fork preparation: UI signed predecessor evidence; dropped native submission remains reserved and cannot be discarded');
} else {
  assert.equal(account,manifest.account);
  assert.equal(await readFile(path,'utf8'),manifest.saved);
  assert.equal((await invoke('get_offline_payment',{expectedAccount:account})).can_discard,false);
  const ready = JSON.parse(await readFile(`${report}.ready`,'utf8'));
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Check confirmation'&&!b.disabled)`);
  await click('Check confirmation');
  await wait(`document.body.innerText.includes('A different transaction was confirmed.')`);
  assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
  const archive = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments', 'completed', account, `superseded-by-${ready.winner}-${manifest.hash}.json`);
  assert.equal(await readFile(archive,'utf8'),manifest.saved);
  assert.equal((await rpc('block_info',{hash:ready.winner})).confirmed,true);
  await assert.rejects(rpc('block_info',{hash:manifest.hash}), /not found/);
  assert(await invoke('prepare_offline_payment',{rpcUrl,expectedAccount:account}));
  await writeFile(report,JSON.stringify({account,hash:manifest.hash,winner:ready.winner,resolved:true}),{flag:'wx',mode:0o600});
  console.log('PASS native fork recovery: app and node restarted; UI resolved confirmed conflict, preserved receipt and released signing without resubmission');
}
