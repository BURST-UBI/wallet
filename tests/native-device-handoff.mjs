import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {rpcUrl, rpc} from './native-env.mjs';
import {invoke, enrollSigningDevice, until} from './native-certified-utils.mjs';
import {processEvidenceProxy} from './process-evidence-proxy.mjs';
import {signedBlockJson} from './offline-envelope.mjs';

const phase = process.env.NATIVE_DEVICE_PHASE;
assert(['prepare','takeover','recover','stale','contest'].includes(phase));
const evidence = process.env.NATIVE_DEVICE_EVIDENCE || process.env.NATIVE_EVIDENCE;
assert.equal(await invoke('is_locked'), true, 'A new native process retained unlocked keys');
// The disposable Dev founder is a public fixture, never a user key.
const {address:account} = await invoke('import_private_key', {hexKey:'00'.repeat(32)});
const directory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments');
const journal = join(directory, `${account}.json`);
const binding = join(directory, 'devices', `${account}.json`);
const status = () => invoke('signing_device_status', {rpcUrl,expectedAccount:account});
const persist = (name, value) => writeFile(join(evidence,name), JSON.stringify(value), {flag:'wx',mode:0o600});
const load = async name => JSON.parse(await readFile(join(evidence,name),'utf8'));

if (phase === 'prepare') {
  await enrollSigningDevice(account);
  const active = await status();
  assert.equal(active.active_here,true);
  const context = await invoke('prepare_offline_payment',{rpcUrl,expectedAccount:account});
  const hash = await invoke('sign_offline_payment',{context,expectedAccount:account,provider:account,amount:'1'});
  const saved = await readFile(journal,'utf8');
  assert.equal((await rpc('account_info',{account})).head,active.head,'Saving an offline draft submitted it');
  await persist('device-a.json',{account,active,hash,saved,binding:await readFile(binding,'utf8'),data:process.env.XDG_DATA_HOME});
  console.log('PASS device A enrolled and saved an unsent exact-byte draft without changing its head');
} else if (phase === 'takeover') {
  const first = await load('device-a.json');
  assert.notEqual(process.env.XDG_DATA_HOME,first.data,'Second device reused the first profile');
  assert.equal(account,first.account,'Restoring root material changed identity');
  assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
  await assert.rejects(readFile(binding),{code:'ENOENT'});
  const review = await status();
  assert.equal(review.active_here,false,'Root-key restoration silently adopted device authority');
  assert.equal(review.grant,first.active.grant);
  await assert.rejects(invoke('pay',{rpcUrl,expectedAccount:account,provider:account,amount:'1'}),/Set up this signing device/);
  const before = await rpc('account_info',{account});
  const proxy = await processEvidenceProxy(rpcUrl,join(evidence,'takeover-process.jsonl'),{dropAcceptedResponse:true});
  try {
    await assert.rejects(invoke('take_over_signing',{rpcUrl:proxy.url,expectedAccount:account,
      reviewedHead:review.head,reviewedGrant:review.grant,reviewedParams:review.params_hash}),/submission response unavailable/);
  } finally {await proxy.close();}
  const pending = await invoke('get_offline_payment',{expectedAccount:account});
  assert.equal(pending.kind,'ChangeSigner');
  assert.equal(pending.can_discard,false);
  await until(async () => (await rpc('block_info',{hash:pending.hash})).confirmed);
  const after = await rpc('account_info',{account});
  assert.equal(after.head,pending.hash);
  for (const field of ['trst_balance','total_brn_burned','representative','verification_state']) assert.equal(after[field],before[field],field);
  await assert.rejects(readFile(binding),{code:'ENOENT'},'Uncertain response published a local role');
  await persist('device-b.json',{account,pending,saved:await readFile(journal,'utf8'),data:process.env.XDG_DATA_HOME});
  console.log('PASS separate profile refused automatic signing; accepted takeover response loss retained its journal and preserved identity/balances');
} else if (phase === 'recover') {
  const second = await load('device-b.json');
  assert.equal(process.env.XDG_DATA_HOME,second.data);
  assert.equal(await readFile(journal,'utf8'),second.saved,'Restart rewrote the uncertain handoff');
  assert.equal((await status()).active_here,false);
  const result = await invoke('resolve_offline_payment',{rpcUrl,expectedAccount:account,expectedHash:second.pending.hash});
  assert.equal(result.status,'confirmed');
  assert.equal((await status()).active_here,true);
  assert.equal((await status()).grant,second.pending.hash);
  assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
  assert.equal((await rpc('account_info',{account})).head,second.pending.hash,'Recovery signed a replacement');
  console.log('PASS locked restart recovered the exact confirmed handoff and durably activated device B without signing again');
} else if (phase === 'stale') {
  const first = await load('device-a.json'), second = await load('device-b.json');
  assert.equal(process.env.XDG_DATA_HOME,first.data);
  assert.equal(await readFile(journal,'utf8'),first.saved);
  assert.equal(await readFile(binding,'utf8'),first.binding,'Returning to device A silently refreshed its grant');
  assert.equal((await status()).active_here,false);
  const response = await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'process',block:signedBlockJson(first.saved)}),signal:AbortSignal.timeout(45000)});
  const reply = await response.json();
  assert(reply.error || (reply.result ?? reply).accepted === false,'Network accepted the old device draft');
  assert.equal((await rpc('account_info',{account})).head,second.pending.hash);
  const result = await invoke('resolve_offline_payment',{rpcUrl,expectedAccount:account,expectedHash:first.hash});
  assert.equal(result.status,'superseded');
  assert.equal(result.confirmed_successor,second.pending.hash);
  assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
  await assert.rejects(invoke('pay',{rpcUrl,expectedAccount:account,provider:account,amount:'1'}),/signing.*device|device.*signing|grant/i);
  assert.equal((await rpc('account_info',{account})).head,second.pending.hash,'Stale device signed a replacement');
  assert.equal(await readFile(binding,'utf8'),first.binding);
  console.log('PASS old profile retained its old role, stale draft was refused, canonical handoff resolved the draft, and ordinary signing stayed blocked');
} else {
  const report = process.env.NATIVE_RESULT_PATH;
  assert(report, 'Concurrent takeover requires its own result path');
  const review = await status();
  assert.equal(review.active_here,false);
  const before = await rpc('account_info',{account});
  let candidate;
  const proxy = await processEvidenceProxy(rpcUrl,`${report}.process.jsonl`,{
    beforeProcess:async bytes => {
      assert(!candidate,'Takeover submitted more than one block');
      const body = JSON.parse(bytes.toString());
      candidate = typeof body.block === 'string' ? JSON.parse(body.block) : body.block;
      assert.equal(candidate.block_type,'ChangeSigner');
      candidate = {...candidate, ...Object.fromEntries(['hash','previous','signing_grant'].map(field => {
        assert(Array.isArray(candidate[field]) && candidate[field].length===32, `Invalid signed ${field}`);
        return [field,Buffer.from(candidate[field]).toString('hex')];
      }))};
      assert.equal(candidate.previous,review.head);
      assert.equal(candidate.signing_grant,review.grant);
      await writeFile(`${report}.ready`,JSON.stringify({account,hash:candidate.hash,
        previous:candidate.previous,grant:candidate.signing_grant}),{flag:'wx',mode:0o600});
      await until(async () => {
        try {return JSON.parse(await readFile(`${report}.release`,'utf8')) === true;}
        catch(error){if(error.code==='ENOENT')return false;throw error;}
      },30);
    },
  });
  let submissionError = null;
  try {
    await invoke('take_over_signing',{rpcUrl:proxy.url,expectedAccount:account,
      reviewedHead:review.head,reviewedGrant:review.grant,reviewedParams:review.params_hash});
  } catch(error) {submissionError=String(error);}
  finally {await proxy.close();}
  assert(candidate,'Takeover failed before submitting its reviewed block');
  const winner = await until(async () => {
    const info = await rpc('account_info',{account});
    if(info.head===before.head)return false;
    return (await rpc('block_info',{hash:info.head})).confirmed ? info : false;
  });
  for(const field of ['trst_balance','total_brn_burned','representative','verification_state']) assert.equal(winner[field],before[field],field);
  const pending = await invoke('get_offline_payment',{expectedAccount:account});
  if(pending) {
    assert.equal(pending.hash,candidate.hash);
    const resolution = await invoke('resolve_offline_payment',{rpcUrl,expectedAccount:account,expectedHash:candidate.hash});
    assert.equal(resolution.status,winner.head===candidate.hash?'confirmed':'superseded');
  }
  assert.equal(await invoke('get_offline_payment',{expectedAccount:account}),null);
  const active = await status();
  assert.equal(active.active_here,winner.head===candidate.hash,'Both competing devices became active');
  assert.equal(active.grant,winner.head);
  if(!active.active_here)await assert.rejects(invoke('pay',{rpcUrl,expectedAccount:account,provider:account,amount:'1'}),/signing.*device|device.*signing|grant/i);
  assert.equal((await rpc('account_info',{account})).head,winner.head,'Recovery authored a replacement');
  await writeFile(report,JSON.stringify({account,candidate:candidate.hash,winner:winner.head,
    active:active.active_here,submissionError,data:process.env.XDG_DATA_HOME}),{flag:'wx',mode:0o600});
  console.log('PASS concurrent takeover resolved one canonical grant; only its owning profile can sign and the losing reservation is recovered');
}
