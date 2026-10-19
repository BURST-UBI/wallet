// Embedded WebKit -> native durable signing -> disposable Dev node.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { enrollSigningDevice, until } from './native-certified-utils.mjs';
import { script, wait, click, fill } from './native-ui.mjs';
async function invoke(command, args = {}) {
  return script(`const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
      .then(value => done({value}), error => done({failure:String(error)}));`, [command, args], true);
}
async function confirmed(hash) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await rpc('block_info', {hash})).confirmed) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Block did not confirm: ${hash}`);
}
async function actionButton(label) {
  assert(await script(`const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
    const button = [...(dialog ?? document).querySelectorAll('button')].find(button => button.textContent.trim() === arguments[0]);
    if (!button || button.disabled) return false; button.click(); return true;`,[label]), `Unavailable action button: ${label}`);
}
let requests = 0;
let submitted = 0;
let lostReceipt = false;
let indexedLookups = 0;
const sparseRecovery = process.env.NATIVE_OFFLINE_SPARSE_RECOVERY === '1';
const proxy = createServer(async (request, response) => {
  requests++;
  try {
    const parts = [];
    for await (const part of request) parts.push(part);
    const payload = Buffer.concat(parts);
    const action = JSON.parse(payload.toString()).action;
    if (action === 'confirmed_account_slot') indexedLookups++;
    if (sparseRecovery && phase === 'reconcile' && action === 'block_info') {
      response.writeHead(200, {'Content-Type':'application/json'});
      response.end(JSON.stringify({error:'block not found: historical body unavailable'}));
      return;
    }
    if (action === 'process') submitted++;
    const upstream = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: payload, signal: AbortSignal.timeout(45000) });
    const body = await upstream.text();
    if (action === 'process' && (phase === 'recover' || (online && phase === 'prepare'))) {
      const receipt = JSON.parse(body);
      assert.equal((receipt.result ?? receipt).accepted, true, 'Fault must occur after acceptance');
      lostReceipt = true;
      response.destroy();
      return;
    }
    response.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    response.end(body);
  } catch { response.writeHead(502).end(); }
});
async function listen(port) {
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(port, '127.0.0.1', resolve); });
}
async function disconnect() {
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
}
const phase = process.env.NATIVE_OFFLINE_PHASE;
const online = process.env.NATIVE_ONLINE_PAYMENT_RECOVERY === '1';
const receiving = process.env.NATIVE_OFFLINE_RECEIVE === '1';
const identityAction = process.env.NATIVE_OFFLINE_ACTION === 'endorse';
const proposalAction = process.env.NATIVE_OFFLINE_ACTION === 'proposal';
const challengeAction = process.env.NATIVE_OFFLINE_ACTION === 'challenge';
const participationAction = process.env.NATIVE_OFFLINE_ACTION === 'participation';
const panelAction = process.env.NATIVE_OFFLINE_ACTION === 'panel';
const trstAction = ['transfer','merge','reject'].includes(process.env.NATIVE_OFFLINE_ACTION) ? process.env.NATIVE_OFFLINE_ACTION : null;
const savedAction = identityAction || proposalAction || challengeAction || participationAction || panelAction || !!trstAction;
const actionKind = panelAction ? 'VerificationVote' : trstAction ? {transfer:'Send',merge:'Merge',reject:'RejectReceive'}[trstAction] : challengeAction ? 'Challenge' : participationAction ? 'VerifierOptIn' : proposalAction ? 'GovernanceProposal' : 'Endorse';
assert(!savedAction || (!receiving && !online), 'Saved action requires the offline fixture');
const existingReceipt = process.env.NATIVE_OFFLINE_EXISTING_RECEIPT === '1';
assert(!existingReceipt || receiving);
// Fixed public Dev fixture key, not a user's signing key.
const fixtureKey = panelAction ? '01'.repeat(32) : receiving || trstAction ? '51'.repeat(32) : '00'.repeat(32);
assert(['prepare', 'recover', 'reconcile'].includes(phase));
const manifestPath = join(process.env.NATIVE_EVIDENCE, 'offline-payment.json');
let manifest;
try {
  if (phase === 'prepare') {
  await listen(0);
  const port = proxy.address().port;
  const offlineRpc = `http://127.0.0.1:${port}`;
  const challengeBaseline=challengeAction && process.env.NATIVE_OFFLINE_BASELINE
    ? JSON.parse(await readFile(join(process.env.NATIVE_OFFLINE_BASELINE,'offline-payment.json'),'utf8')) : null;
  const receiver = challengeBaseline ? challengeBaseline.receiver : panelAction ? process.env.NATIVE_PANEL_TARGET : challengeAction
    ? (await invoke('import_private_key',{hexKey:'51'.repeat(32)})).value.address : receiving || trstAction
    ? (await invoke('import_private_key', {hexKey:fixtureKey})).value.address
    : (await invoke('create_wallet')).value.address;
  let incoming;
  let originalOpening;
  let trstTarget;
  let trstBefore;
  let challengeStake;
  if (challengeAction) {
    if (process.env.NATIVE_CHALLENGE_SETUP) {
      assert.equal((await rpc('verification_status',{account:receiver})).phase,'verified');
      assert.equal((await rpc('node_info')).verified_count,2);
    } else if (challengeBaseline) {
      assert.equal((await rpc('verification_status',{account:receiver})).phase,'verified');
      const old=JSON.parse(challengeBaseline.journal);
      const oldEpoch=Buffer.from(old.block.payment_epoch).toString('hex');
      await until(async () => (await rpc('params_hash')).payment_epoch !== oldEpoch);
      await assert.rejects(rpc('block_info',{hash:challengeBaseline.pending.hash}),/block not found/i);
    } else {
      await enrollSigningDevice(receiver);
      const priorEpoch=(await rpc('params_hash')).payment_epoch;
      const endorsed=await rpc('genesis_endorse',{account:receiver});
      assert(endorsed.verified && endorsed.block_hash);await confirmed(endorsed.block_hash);
      await until(async()=>{const ready=await rpc('params_hash');return ready.payment_epoch!==priorEpoch && ['local','peer_matches'].includes(ready.online_signing);});
    }
    challengeStake=(await rpc('protocol_params')).challenge_stake_amount;
    assert(BigInt(challengeStake)>0n);
  }
  if (trstAction) {
    await enrollSigningDevice(receiver);
    const founder = (await invoke('import_private_key',{hexKey:'00'.repeat(32)})).value;
    await enrollSigningDevice(founder.address);
    trstTarget = founder.address;
    const payments = [];
    for (let index=0; index<(trstAction==='merge'?2:1); index++) {
      const paid = await invoke('pay',{rpcUrl,expectedAccount:founder.address,provider:receiver,amount:'3'});
      assert(!paid.failure,paid.failure);await confirmed(paid.value.hash);payments.push(paid.value.hash);
    }
    incoming = payments[0];
    await invoke('import_private_key',{hexKey:fixtureKey});
    if (trstAction!=='reject') {
      for (const hash of payments) {
        const received = await invoke('receive_pending',{rpcUrl,expectedAccount:receiver,hash});
        assert(!received.failure,received.failure);await confirmed(received.value.hash);
      }
      const endorsed = await rpc('genesis_endorse',{account:receiver});
      assert(endorsed.verified && endorsed.block_hash);
      await confirmed(endorsed.block_hash);
    }
    trstBefore = await rpc('trst_portfolio',{account:receiver});
  }
  if (receiving) {
    await enrollSigningDevice(receiver);
    const founder = (await invoke('import_private_key', {hexKey:'00'.repeat(32)})).value;
    await enrollSigningDevice(founder.address);
    if (existingReceipt) {
      const initial = await invoke('pay', {rpcUrl, expectedAccount:founder.address, provider:receiver, amount:'2'});
      assert(!initial.failure, initial.failure);
      await confirmed(initial.value.hash);
      await invoke('import_private_key', {hexKey:fixtureKey});
      const opened = await invoke('receive_pending', {rpcUrl, expectedAccount:receiver, hash:initial.value.hash});
      assert(!opened.failure, opened.failure);
      originalOpening = opened.value.hash;
      await confirmed(originalOpening);
      assert.equal((await rpc('account_info',{account:receiver})).trst_balance,'2');
      await invoke('import_private_key', {hexKey:'00'.repeat(32)});
    }
    const payment = await invoke('pay', {rpcUrl, expectedAccount:founder.address, provider:receiver, amount:'1'});
    assert(!payment.failure, payment.failure);
    incoming = payment.value.hash;
    await confirmed(incoming);
  }
  await invoke('lock_wallet');
  await script(`localStorage.setItem('burst-wallet', JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`, [offlineRpc]);
  await fetch(`${base}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');
  await wait(`!!document.querySelector('#wallet-private-key')`);
  await fill('wallet-private-key', fixtureKey);
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  await click('Go to Dashboard');
  await wait(receiving ? `document.body.innerText.includes('Wallet data unavailable') || !!document.querySelector('[aria-label="Wallet balances"]')` : `!!document.querySelector('[aria-label="Wallet balances"]')`);
  const account = receiving || trstAction ? receiver : await script(`return document.querySelector('.wallet-identity p[title]').getAttribute('title')`);
  // Enrollment precedes disconnection and bypasses only the fault-injection
  // proxy, not native review, journal or network confirmation.
  await enrollSigningDevice(account);
  const before = await rpc('account_info', { account });
  if (participationAction) assert.equal((await rpc('verification_status',{account})).verifier_opted_in,false,'Fresh Dev founder must start opted out');
  if (online) {
    await click('Pay');
    await wait(`!!document.getElementById('provider') && !document.querySelector('.animate-shimmer')`);
    await fill('provider', receiver);
    await fill('pay-amount', '0.000000000000000001');
    await click('Pay');
    await wait(`!!document.querySelector('[role="dialog"]')`);
    await click('Cancel');
    assert.equal((await invoke('get_offline_payment', {expectedAccount:account})).value, null);
    assert.equal((await rpc('account_info', {account})).head, before.head);
    await click('Pay');
    await wait(`!!document.querySelector('[role="dialog"]')`);
    await click('Confirm Payment');
    await wait(`document.querySelector('[data-transaction-receipt]')?.textContent.includes('Confirmation pending')`);
    assert(lostReceipt, 'Online fault must occur after node acceptance');
    assert.equal(submitted, 1);
    const pending = (await invoke('get_offline_payment', {expectedAccount:account})).value;
    assert(pending && !pending.can_discard, 'Online payment did not retain a durable attempted draft');
    const blocked = await invoke('pay', {rpcUrl:offlineRpc, expectedAccount:account, provider:receiver, amount:'1'});
    assert.match(blocked.failure, /offline|pending/i);
    const discarded = await invoke('discard_offline_payment', {expectedAccount:account, expectedHash:pending.hash});
    assert.match(discarded.failure, /may already be submitted/);
    manifest = {port, offlineRpc, receiver, account, pending};
    manifest.journal = await readFile(join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments', `${account}.json`), 'utf8');
    await writeFile(manifestPath, JSON.stringify(manifest), {mode:0o600});
    console.log('PASS online payment UI: cancellation unsigned, exact draft saved, accepted response lost, duplicate signing and discard blocked');
  } else if (savedAction) {
    if (panelAction) {
      await script(`history.pushState({},'', '/verification');dispatchEvent(new PopStateEvent('popstate'));`);
      await wait(`!!document.querySelector('button[aria-label=${JSON.stringify(`Review ${receiver}`)}]')`);
      await click(`Review ${receiver}`);
      await wait(`!!document.querySelector('input[name="identity-decision"]')`);
      await script(`document.querySelectorAll('input[name="identity-decision"]')[arguments[0]-1].click()`,[Number(process.env.NATIVE_PANEL_VOTE)]);
      await click('Review vote');
    } else if (participationAction) {
      await script(`history.pushState({},'', '/verification');dispatchEvent(new PopStateEvent('popstate'));`);
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Volunteer to verify'&&!button.disabled)`);
    } else if (challengeAction) {
      await script(`history.pushState({},'', '/verification');dispatchEvent(new PopStateEvent('popstate'));`);
      await wait(`!!document.getElementById('challenge-address')`);
      await script(`document.getElementById('challenge-address').closest('details').open=true`);
      await fill('challenge-address',receiver);
      const raw=BigInt(challengeStake), unit=1000000000000000000n;
      const fraction=(raw%unit).toString().padStart(18,'0').replace(/0+$/,'');
      await fill('challenge-stake',(raw/unit).toString()+(fraction?'.'+fraction:''));
      await click('Challenge');
    } else if (trstAction==='transfer') {
      await click('Transfer');
      await wait(`!!document.getElementById('recipient')`);
      await fill('recipient',trstTarget);
      await fill('transfer-amount','0.000000000000000001');
      await click('Transfer TRST');
    } else if (trstAction==='merge') {
      await script(`history.pushState({},'', '/portfolio');dispatchEvent(new PopStateEvent('popstate'));`);
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Combine batches'&&!button.disabled)`);
      await click('Combine batches');
      await wait(`document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length===2`);
      assert(await script(`const inputs=[...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')];if(inputs.some(input=>input.disabled))return false;inputs.forEach(input=>input.click());return true;`));
      await actionButton('Review');
    } else if (trstAction==='reject') {
      await click('Receive');
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Review')`);
      await click('Review');
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Return payment…')`);
      await click('Return payment…');
    } else if (proposalAction) {
      await script(`history.pushState({},'', '/governance');dispatchEvent(new PopStateEvent('popstate'));`);
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Propose a change'&&!button.disabled)`);
      await click('Propose a change');
      await script(`const input=document.getElementById('governance-parameter');input.value='brn_rate';input.dispatchEvent(new Event('change',{bubbles:true}));`);
      await fill('governance-new-value','2.000000000000000001');
      await click('Review proposal');
    } else {
    await script(`history.pushState({},'', '/verification');dispatchEvent(new PopStateEvent('popstate'));`);
    await wait(`!!document.getElementById('endorse-address')`);
    await script(`document.getElementById('endorse-address').closest('details').open = true`);
    await fill('endorse-address', receiver);
    await fill('endorse-amount', '0.000000000000000001');
    await click('Endorse');
    }
    if (!participationAction) await wait(`!!document.querySelector('[role="dialog"]')`);
    await actionButton('Sign offline');
    await wait(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Prepare action')`);
    await actionButton('Prepare action');
    await wait(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Sign and save'&&!button.disabled)`);
    if (proposalAction) assert(await script(`return [...document.querySelectorAll('[role="dialog"]')].at(-1).textContent.includes('2000000000000000001')`),'Review lost exact proposed value');
    if (panelAction) {
      const review=await script(`return [...document.querySelectorAll('[role="dialog"]')].at(-1).textContent`);
      assert(review.includes(receiver)&&review.includes(process.env.NATIVE_PANEL_CONTEXT));
      assert(review.includes(Number(process.env.NATIVE_PANEL_VOTE)===1?'Legitimate':'Illegitimate'));
    }
    await disconnect();
    const disconnectedRequests = requests;
    await actionButton('Close');
    assert.equal((await invoke('get_offline_payment', {expectedAccount:account})).value,null);
    await actionButton('Sign offline');
    await wait(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Sign and save')`);
    await actionButton('Sign and save');
    await wait(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Submit saved action'&&!button.disabled)`);
    assert.equal(requests,disconnectedRequests,'Offline action signing requested the network');
    assert.equal((await rpc('account_info',{account})).head,before.head,'Offline action signing submitted a block');
    const pending = (await invoke('get_offline_payment',{expectedAccount:account})).value;
    assert.equal(pending.kind,actionKind);assert(pending.can_discard);
    manifest = {port,offlineRpc,receiver,account,pending,before,identityAction,proposalAction,challengeAction,participationAction,challengeStake,trstAction,trstTarget,trstBefore,incoming};
    manifest.journal = await readFile(join(process.env.XDG_DATA_HOME,'com.burst.wallet','offline-payments',`${account}.json`),'utf8');
    await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600});
    console.log(`PASS native offline ${process.env.NATIVE_OFFLINE_ACTION}: existing review UI, cancel unsigned, disconnected exact signature and durable journal`);
  } else {
  if (receiving) {
    await script(`history.pushState({},'',arguments[0]);dispatchEvent(new PopStateEvent('popstate'));`, [`/pay/offline?receive=${incoming}`]);
  } else {
    await click('Pay');
    await wait(`!!document.querySelector('a[href="/pay/offline"]')`);
    await script(`document.querySelector('a[href="/pay/offline"]').click()`);
  }
  const prepareLabel = receiving ? 'Prepare offline receipt' : 'Prepare offline payment';
  const reviewLabel = receiving ? 'Review offline receipt' : 'Review offline payment';
  await wait(`!![...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(prepareLabel)} && !b.disabled)`);
  await click(prepareLabel);
  await wait(receiving ? `document.body.innerText.includes('0.000000000000000001 TRST')` : `!!document.querySelector('#offline-provider')`);
  await disconnect();
  const disconnectedRequests = requests;
  if (!receiving) {
    await fill('offline-provider', receiver);
    await fill('offline-amount', '0.000000000000000001');
  }
  await click(reviewLabel);
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Cancel');
  assert.equal((await invoke('get_offline_payment', { expectedAccount: account })).value, null);
  await click(reviewLabel);
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Sign and save');
  await wait(`document.body.innerText.includes('Signed payment, not submitted')`);
  assert.equal(requests, disconnectedRequests, 'Signing required the disconnected RPC');
  if (receiving) {
    assert((await rpc('account_pending',{account,count:100})).pending.some(p=>p.hash===incoming), 'Offline signing consumed the payment');
  } else {
    assert.equal((await rpc('account_info', { account })).head, before.head, 'Offline signing submitted a block');
  }
  const pending = (await invoke('get_offline_payment', { expectedAccount: account })).value;
  assert(pending.can_discard);
  const blocked = await invoke('pay', { rpcUrl: offlineRpc, expectedAccount: account, provider: receiver, amount: '1' });
  assert.match(blocked.failure, /offline|pending/i, 'Pending draft did not reserve account signing');
  manifest = { port, offlineRpc, receiver, account, pending, incoming, originalOpening, before };
  manifest.journal = await readFile(join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments', `${account}.json`), 'utf8');
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  console.log('PASS native offline preparation: disconnected form signing, cancel and account reservation; saved draft ready for process restart');
  }
  } else {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { port, receiver, account, pending } = manifest;
  // The harness has closed the native application and launched a new process
  // with the same private profile. No key or review state survived in memory.
  const locked = await invoke('get_offline_payment', { expectedAccount: account });
  assert.match(locked.failure, /Wallet not loaded/);
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');
  await wait(`!!document.querySelector('#wallet-private-key')`);
  await fill('wallet-private-key', fixtureKey);
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  await click('Go to Dashboard');
  await wait(`document.body.innerText.includes('Wallet data unavailable')`);
  await click('Review saved transaction');
  const actionName = panelAction ? 'Verification vote' : trstAction ? {transfer:'TRST transfer',merge:'TRST merge',reject:'Payment return'}[trstAction] : challengeAction ? 'Challenge or appeal' : participationAction ? 'Verifier participation' : proposalAction ? 'Proposal' : 'Endorsement';
  await wait(`document.body.innerText.includes(${JSON.stringify(savedAction ? `${actionName} ${phase === 'reconcile' ? 'awaiting confirmation' : 'saved, not submitted'}` : phase === 'reconcile' ? 'Payment awaiting reconciliation' : 'Signed payment, not submitted')})`);
  assert.equal((await invoke('get_offline_payment', { expectedAccount: account })).value.hash, pending.hash);
  await listen(port);
  if (phase === 'recover') {
  await click(savedAction ? 'Review saved action' : 'Review and submit');
  if (challengeAction || participationAction || panelAction) {
    await wait(`[...document.querySelectorAll('[role="dialog"] button')].some(button=>button.textContent.trim()==='Submit saved action'&&!button.disabled)`);
    if (challengeAction) assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`,[receiver]));
    if (panelAction) assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`,[process.env.NATIVE_PANEL_CONTEXT]));
  } else if (trstAction) {
    await wait(`[...document.querySelectorAll('[role="dialog"] button')].some(button=>button.textContent.trim()==='Submit saved action'&&!button.disabled)`);
    const text = await script(`return document.querySelector('[role="dialog"]').textContent`);
    if (trstAction==='transfer') {
      assert(text.includes(manifest.trstTarget));
      assert(text.includes('0.000000000000000001 TRST'));
      assert(text.includes(manifest.trstBefore.batches[0].origin));
    } else if (trstAction==='merge') {
      for (const batch of manifest.trstBefore.batches) assert(text.includes(batch.id));
    } else assert(text.includes(manifest.incoming));
  } else if (proposalAction) {
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('2000000000000000001')`);
    assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes('brn_rate')`));
  } else {
  await wait(`document.querySelector('[role="dialog"]')?.textContent.includes(${JSON.stringify('0.000000000000000001 '+(receiving?'TRST':'BRN'))})`);
  assert.equal(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [receiving ? manifest.incoming : receiver]), true);
  }
  await click(savedAction ? 'Submit saved action' : 'Submit payment');
  await wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('submission response unavailable')`);
  assert(lostReceipt, 'No accepted receipt was dropped');
  assert.equal(submitted, 1, 'Uncertain submission must not be retried automatically');
  const uncertain = (await invoke('get_offline_payment', { expectedAccount: account })).value;
  assert.equal(uncertain.hash, pending.hash);
  assert.equal(uncertain.can_discard, false);
  const discarded = await invoke('discard_offline_payment', { expectedAccount: account, expectedHash: pending.hash });
  assert.match(discarded.failure, /may already be submitted/);
  assert.equal((await invoke('get_offline_payment', { expectedAccount: account })).value.hash, pending.hash);
  console.log('PASS native ambiguous receipt: actual node acceptance, response loss, one submission, durable uncertain status and discard refusal');
  } else {
  if (sparseRecovery) {
    const unavailable = await fetch(manifest.offlineRpc, {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'block_info',hash:pending.hash})});
    assert.match((await unavailable.json()).error,/historical body unavailable/);
  }
  await click('Check confirmation');
  await wait(`document.body.innerText.includes(${JSON.stringify(savedAction ? 'Transaction confirmed.' : 'Payment confirmed.')})`);
  assert.equal((await rpc('block_info', { hash: pending.hash })).confirmed, true);
  assert.equal((await invoke('get_offline_payment', { expectedAccount: account })).value, null);
  const journalDirectory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments');
  assert.equal(await readFile(join(journalDirectory, 'completed', account, `confirmed-by-${pending.hash}-${pending.hash}.json`), 'utf8'), manifest.journal);
  for (const name of [`${account}.json`, `attempted-${pending.hash}.marker`]) {
    await assert.rejects(readFile(join(journalDirectory, name)), {code:'ENOENT'});
  }
  if (savedAction) {
    const action = await rpc('block_info',{hash:pending.hash});
    assert.equal(action.block_type,actionKind);
    assert.equal(action.previous,manifest.before.head);
    const after = await rpc('account_info',{account});
    if (panelAction) {
      const status=await rpc('verification_status',{account:receiver});
      const vote=status.verifier_votes.find(entry=>entry.verifier===account);
      assert.equal(vote?.vote,Number(process.env.NATIVE_PANEL_VOTE)===1?'Legitimate':'Illegitimate');
      assert.equal(action.origin,process.env.NATIVE_PANEL_CONTEXT);
      assert.equal(BigInt(after.total_brn_staked)-BigInt(manifest.before.total_brn_staked),BigInt(process.env.NATIVE_PANEL_STAKE));
      const signed=await rpc('block_info',{hash:pending.hash,include_signed_block:true});
      assert(signed.signed_block);
      await writeFile(process.env.NATIVE_RESULT_PATH,signed.signed_block,{mode:0o600,flag:'wx'});
    } else if (challengeAction) {
      assert.equal(BigInt(after.total_brn_staked)-BigInt(manifest.before.total_brn_staked),BigInt(manifest.challengeStake));
      assert.equal(action.target_head,'0'.repeat(64),'Initial challenge must not target an appeal verdict');
      assert.equal((await rpc('verification_status',{account:receiver})).phase,'challenged');
    } else if (participationAction) {
      assert.equal((await rpc('verification_status',{account})).verifier_opted_in,true);
      assert.equal(after.total_brn_burned,manifest.before.total_brn_burned);
      assert.equal(after.total_brn_staked,manifest.before.total_brn_staked);
    } else if (trstAction) {
      const portfolio = await rpc('trst_portfolio',{account});
      assert.equal(after.total_brn_burned,manifest.before.total_brn_burned);
      if (trstAction==='transfer') {
        assert.equal(BigInt(portfolio.total_active),BigInt(manifest.trstBefore.total_active)-1n);
        assert.equal(portfolio.batches[0].origin,manifest.trstBefore.batches[0].origin);
        assert.equal(portfolio.batches[0].timestamp,manifest.trstBefore.batches[0].timestamp);
        const pendingSend=(await rpc('account_pending',{account:manifest.trstTarget,count:100})).pending.find(p=>p.hash===pending.hash);
        assert.equal(pendingSend.amount,'1');assert.equal(pendingSend.source,account);
      } else if (trstAction==='merge') {
        assert.equal(portfolio.total_active,manifest.trstBefore.total_active);
        assert.equal(portfolio.batches.length,1);
        assert.equal(portfolio.batches[0].timestamp,Math.min(...manifest.trstBefore.batches.map(batch=>batch.timestamp)));
        const provenance=await rpc('trst_origins',{origin:portfolio.batches[0].origin});
        assert.equal(provenance.confirmed,true);assert.equal(provenance.complete,true);
        assert.deepEqual(provenance.origins.map(origin=>origin.hash).sort(),manifest.trstBefore.batches.map(batch=>batch.origin).sort());
      } else {
        assert.equal(portfolio.total_active,manifest.trstBefore.total_active);
        assert(!(await rpc('account_pending',{account,count:100})).pending.some(p=>p.hash===manifest.incoming));
        const credit=(await rpc('account_pending',{account:manifest.trstTarget,count:100})).pending.find(p=>p.hash===pending.hash);
        assert(credit,'Payment rejection did not create a return credit');assert.equal(credit.amount,'3');
      }
    } else if (proposalAction) {
      const proposal = await rpc('governance_proposal_info',{hash:pending.hash});
      assert.equal(proposal.proposed_value,'2000000000000000001');
      assert.equal(proposal.param,'BrnRate');
    } else assert.equal(BigInt(after.total_brn_burned),BigInt(manifest.before.total_brn_burned)+1n);
    assert.equal(BigInt(after.block_count),BigInt(manifest.before.block_count)+1n);
  } else if (receiving) {
    const info = await rpc('account_info', {account});
    assert.equal(info.confirmed_open,manifest.before.confirmed_open);
    assert.equal(info.trst_balance,existingReceipt ? '3' : '1');
    const receipt = await rpc('block_info', {hash:pending.hash});
    // The first TRST receipt now follows explicit device enrollment's empty
    // Open + ChangeSigner. It must not open again or change device authority.
    assert.equal(receipt.block_type,'Receive');
    assert.equal(receipt.previous,manifest.before.head);
    if (existingReceipt) assert.equal(receipt.previous,manifest.originalOpening);
    assert.equal(BigInt(info.block_count), BigInt(manifest.before.block_count) + 1n);
    assert(!(await rpc('account_pending',{account,count:100})).pending.some(p=>p.hash===manifest.incoming));
  } else {
    const received = (await rpc('account_pending', { account: receiver, count: 100 })).pending.find(p => p.hash === pending.hash);
    assert.equal(received.amount, '1');
    assert.equal(received.source, account);
  }
  assert.equal(submitted, 0, 'Confirmation recovery resubmitted a payment');
  if (sparseRecovery) assert(indexedLookups > 0, 'Recovery did not use the confirmed canonical index');
  console.log('PASS native ambiguous recovery: second app restart, original signed action confirmed, reservation released without signing or resubmission');
  if (participationAction) {
    const beforeOut=await rpc('account_info',{account});
    await script(`history.pushState({},'', '/verification');dispatchEvent(new PopStateEvent('popstate'));`);
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Stop new assignments'&&!button.disabled)`);
    await actionButton('Sign offline');await actionButton('Prepare action');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Sign and save'&&!button.disabled)`);
    await actionButton('Sign and save');
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Submit saved action'&&!button.disabled)`);
    const out=(await invoke('get_offline_payment',{expectedAccount:account})).value;
    assert.equal(out.kind,'VerifierOptOut');assert.notEqual(out.hash,pending.hash);
    assert.equal((await rpc('account_info',{account})).head,beforeOut.head);
    await actionButton('Submit saved action');
    await wait(`document.body.innerText.includes('The network confirmed this action.')`);
    assert.equal((await rpc('verification_status',{account})).verifier_opted_in,false);
    const afterOut=await rpc('account_info',{account});
    assert.equal(afterOut.head,out.hash);
    assert.equal(BigInt(afterOut.block_count),BigInt(beforeOut.block_count)+1n);
    assert.equal(afterOut.total_brn_burned,beforeOut.total_brn_burned);
    assert.equal(afterOut.total_brn_staked,beforeOut.total_brn_staked);
    assert.equal((await invoke('get_offline_payment',{expectedAccount:account})).value,null);
    console.log('PASS native offline participation: opt-in recovery followed by separately reviewed opt-out, exact state and unchanged balances');
  }
  if (online && process.env.NATIVE_RETENTION_OVERFLOW === '1') {
    assert.equal((await rpc('node_info')).network, 'dev');
    const before = await rpc('account_info', {account});
    const completed = join(journalDirectory, 'completed', account);
    const hashes = new Set([pending.hash]);
    for (let index = 0; index < 105; index++) {
      const result = await invoke('pay', {rpcUrl, expectedAccount:account, provider:receiver, amount:'1'});
      assert(!result.failure, result.failure);
      assert(result.value.accepted);
      assert(!hashes.has(result.value.hash), 'Repeated signed payment hash');
      hashes.add(result.value.hash);
      const receipts = await readdir(completed);
      assert.equal(receipts.length, Math.min(index + 2, 100));
      const newest = JSON.parse(await readFile(join(completed, `confirmed-${result.value.hash}.json`), 'utf8'));
      assert.equal(Buffer.from(newest.block.hash).toString('hex'), result.value.hash);
      assert.equal((await invoke('get_offline_payment', {expectedAccount:account})).value, null);
      assert.deepEqual((await readdir(journalDirectory)).filter(name => name.endsWith('.marker')), []);
    }
    for (const name of await readdir(completed)) {
      const receipt = JSON.parse(await readFile(join(completed, name), 'utf8'));
      assert(hashes.has(Buffer.from(receipt.block.hash).toString('hex')));
      assert.equal(receipt.block.account, account);
    }
    const after = await rpc('account_info', {account});
    assert.equal(BigInt(after.block_count), BigInt(before.block_count) + 105n);
    assert.equal(BigInt(after.total_brn_burned), BigInt(before.total_brn_burned) + 105n);
    assert.equal(after.confirmation_height, after.block_count);
    console.log('PASS installed retention: 105 additional confirmed payments, 100 receipts, no unresolved draft or orphan markers, exact ledger count and burn delta');
  }
  }
  }
} finally {
  if (proxy.listening) await disconnect();
}
