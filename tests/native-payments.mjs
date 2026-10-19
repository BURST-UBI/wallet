// Real native IPC and a disposable local Dev ledger. No secrets logged.
import assert from 'node:assert/strict';
import { base, rpcUrl, rpc } from './native-env.mjs';
import { enrollSigningDeviceWith } from './native-certified-utils.mjs';
import { invoke, enrollSigningDevice } from './native-certified-utils.mjs';
import { script, wait, click, fill } from './native-ui.mjs';
import { writeFile } from 'node:fs/promises';
async function execute(script, args = []) {
  const response = await fetch(`${base}/execute/async`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({args,script}),
  });
  const {value} = await response.json();
  assert(!value?.error, JSON.stringify(value));
  return value;
}
async function paymentsJourney() {
const receiver = await execute(`
    const rpcUrl = arguments[0];
    const done = arguments[arguments.length - 1];
    (async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const enroll = ${enrollSigningDeviceWith.toString()};
      const created = await invoke('create_wallet');
      const receiver = created.address;
      const phrase = created.recovery_phrase;
      const recipient = arguments[1]
        ? (await invoke('import_private_key', {hexKey:'01'.repeat(32)})).address
        : null;
      // This is the PUBLIC development-network key, never a real user's key.
      const genesis = await invoke('import_private_key', {hexKey:'00'.repeat(32)});
      await enroll(invoke, rpcUrl, genesis.address);
      const burns = [];
      for (let i=0; i<2; i++) {
        const payment = await invoke('pay', {rpcUrl,expectedAccount:genesis.address,provider:receiver,amount:'1000000000000000'});
        if (!payment.accepted) throw new Error('Native payment rejected');
        burns.push(payment.hash);
      }
      await invoke('import_mnemonic', {phrase});
      await enroll(invoke, rpcUrl, receiver);
      const automationSession = await invoke('begin_automation');
      let result = await invoke('maintain_wallet', {rpcUrl,expectedAccount:receiver,autoAccept:true,trustedSenders:[receiver],mergeLevel:0,automationSession});
      if (result.received !== 0 || result.held !== 2) throw new Error('Sender rule failed');
      result = await invoke('maintain_wallet', {rpcUrl,expectedAccount:receiver,autoAccept:true,trustedSenders:[genesis.address],mergeLevel:50,automationSession});
      if (result.received !== 2 || result.merged !== 0) throw new Error('Unverified auto-accept failed');
      // The new human delegates to the actual online signer before admission.
      const delegated = await invoke('change_representative', {rpcUrl,expectedAccount:receiver,rep:genesis.address});
      if (!delegated.accepted) throw new Error('Pre-admission representative choice failed');
      return {receiver,genesis:genesis.address,burns,recipient};
    })().then(done,e=>done({error:String(e)}));
`, [rpcUrl, process.env.NATIVE_RECIPIENT_POLICY === '1']);
const endorsement = await rpc('genesis_endorse', {account:receiver.receiver});
assert(endorsement.block_hash && endorsement.verified, 'Dev endorsement did not confirm verification');
const value = await execute(`
    const {receiver,genesis,recipient} = arguments[0];
    const rpcUrl = arguments[1];
    const manualMerge = arguments[2];
    const done = arguments[arguments.length - 1];
    (async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const automationSession = await invoke('begin_automation');
      for (let i=0;i<80;i++) {
        const info = await invoke('get_account_info',{rpcUrl});
        if (info.verification_state === 'verified') break;
        await new Promise(r=>setTimeout(r,250));
      }
      if (manualMerge) {
        const before = await invoke('get_trst_portfolio',{rpcUrl});
        const selected = before.batches.map(({id,amount,status,expiry_at})=>({id,amount,status,expiry_at}));
        let staleBlocked = false;
        try { await invoke('merge_trst',{rpcUrl,expectedAccount:receiver,selected:selected.map((batch,index)=>index?batch:{...batch,amount:'1'})}); }
        catch(error) { staleBlocked = /changed/.test(String(error)); }
        if (!staleBlocked) throw new Error('Changed review was not rejected');
        const unchanged = await invoke('get_trst_portfolio',{rpcUrl});
        if (JSON.stringify(unchanged.batches)!==JSON.stringify(before.batches)) throw new Error('Rejected review changed holdings');
        const combined = await invoke('merge_trst',{rpcUrl,expectedAccount:receiver,selected});
        if (!combined.accepted) throw new Error('Manual combination rejected');
        let replayBlocked = false;
        try { await invoke('merge_trst',{rpcUrl,expectedAccount:receiver,selected}); }
        catch(error) { replayBlocked = /changed/.test(String(error)); }
        if (!replayBlocked) throw new Error('Consumed selection was not rejected');
      } else {
        const result = await invoke('maintain_wallet', {rpcUrl,expectedAccount:receiver,autoAccept:true,trustedSenders:[],mergeLevel:50,automationSession});
        if (result.merged !== 2) throw new Error('Default auto-merge failed');
      }
      const portfolio = await invoke('get_trst_portfolio',{rpcUrl});
      if (portfolio.batches.length !== 1 || portfolio.total_active !== '2000000000000000') throw new Error('Merged balance incorrect');
      if (portfolio.batches[0].origin_kind !== 'merge' || !portfolio.batches[0].id) throw new Error('Merge provenance or holding identity was lost in the native adapter');
      if (arguments[4]) {
        const reference = portfolio.batches[0].reference_value_bps;
        if (!Number.isInteger(reference) || reference <= 0 || reference > 10000) throw new Error('Fresh holding lost its linear reference through real RPC/native IPC');
        if (portfolio.batches[0].expiry_at === null && reference !== 10000) throw new Error('No-expiry reference was discounted');
        if (portfolio.batches[0].amount !== portfolio.total_active) throw new Error('Reference changed the face amount');
      }
      const origins = await invoke('get_trst_origins',{rpcUrl,origin:portfolio.batches[0].origin});
      const sent = await invoke('transfer_trst',{rpcUrl,expectedAccount:receiver,to:genesis,amount:'1',origin:null});
      if (!sent.accepted) throw new Error('Native merged transfer failed');
      const paymentOrigins = await invoke('get_payment_origins',{rpcUrl,payment:sent.hash});
      if (!paymentOrigins.confirmed || paymentOrigins.provenance.origin !== portfolio.batches[0].origin) throw new Error('Transfer lost its merged payment origins');
      if (arguments[3]) {
        const before = await invoke('get_trst_portfolio', {rpcUrl});
        const selfSend = await invoke('transfer_trst', {rpcUrl,expectedAccount:receiver,to:receiver,amount:'1',origin:portfolio.batches[0].origin});
        if (!selfSend.accepted) throw new Error('Self-transfer rejected');
        const pending = await invoke('get_trst_portfolio', {rpcUrl});
        if (BigInt(pending.total_active) !== BigInt(before.total_active)-1n || BigInt(pending.total_pending) !== BigInt(before.total_pending)+1n) throw new Error('Self-send duplicated or lost pending value');
        const receipt = await invoke('receive_pending', {rpcUrl,expectedAccount:receiver,hash:selfSend.hash});
        if (!receipt.accepted) throw new Error('Self-receive rejected');
        const after = await invoke('get_trst_portfolio', {rpcUrl});
        if (after.total_active !== before.total_active || after.total_pending !== before.total_pending) throw new Error('Self-transfer changed total value');
        if (!after.batches.every(batch=>batch.origin===portfolio.batches[0].origin && batch.timestamp===portfolio.batches[0].timestamp)) throw new Error('Self-transfer changed provenance or age');
        let replayRejected = false;
        try { await invoke('receive_pending', {rpcUrl,expectedAccount:receiver,hash:selfSend.hash}); } catch { replayRejected=true; }
        if (!replayRejected) throw new Error('Self-receive replay accepted');
      }
      let recipientSend = null;
      if (arguments[5]) {
        const before = await invoke('get_trst_portfolio', {rpcUrl});
        const account = await invoke('get_account_info', {rpcUrl});
        recipientSend = await invoke('transfer_trst', {rpcUrl,expectedAccount:receiver,to:recipient,amount:'1',origin:portfolio.batches[0].origin});
        if (!recipientSend.accepted) throw new Error('Send to unverified recipient rejected');
        const after = await invoke('get_trst_portfolio', {rpcUrl});
        const updated = await invoke('get_account_info', {rpcUrl});
        if (updated.block_count !== account.block_count+1 || updated.head !== recipientSend.hash) throw new Error('Send created an extra change block');
        if (BigInt(after.total_active) !== BigInt(before.total_active)-1n) throw new Error('Incorrect sender remainder');
        const changed = before.batches.filter(batch => after.batches.find(next=>next.id===batch.id)?.amount !== batch.amount);
        if (changed.length !== 1 || BigInt(changed[0].amount) <= 1n || after.batches.length !== before.batches.length) throw new Error('Partial send replaced the remainder holding');
        const remainder = after.batches.find(batch=>batch.id===changed[0].id);
        if (!remainder || BigInt(remainder.amount) !== BigInt(changed[0].amount)-1n || remainder.origin !== changed[0].origin || remainder.timestamp !== changed[0].timestamp) throw new Error('Remainder identity, amount or provenance changed');
      }
      await invoke('lock_wallet');
      let blocked = false;
      try { await invoke('maintain_wallet', {rpcUrl,expectedAccount:receiver,autoAccept:true,trustedSenders:[],mergeLevel:50,automationSession}); } catch {blocked=true;}
      if (!blocked) throw new Error('Locked wallet signed');
      return {nativePayments:true,senderRule:true,autoAccept:true,autoMerge:!manualMerge,manualMerge,mergedTransfer:true,lock:true,mergedOrigin:portfolio.batches[0].origin,origins,paymentOrigins,recipientSend};
    })().then(done,e=>done({error:String(e)}));
  `, [receiver, rpcUrl, process.env.NATIVE_MANUAL_MERGE === '1', process.env.NATIVE_SELF_TRANSFER === '1', process.env.NATIVE_LINEAR_REFERENCE === '1', process.env.NATIVE_RECIPIENT_POLICY === '1']);
assert.equal(value?.mergedTransfer, true);
const provenance = await rpc('trst_origins',{origin:value.mergedOrigin});
assert.equal(provenance.complete,true);
assert.equal(provenance.confirmed,true);
assert.deepEqual(value.origins,provenance,'native origin inspector changed the node report');
assert.deepEqual(value.paymentOrigins.provenance,provenance,'transfer inspector replaced original creators with the sender');
assert.deepEqual(provenance.origins.map(origin=>origin.hash),[...receiver.burns].sort());
for (const origin of provenance.origins) {
  assert.equal(origin.originator,receiver.genesis,'merger was mistaken for a BRN creator');
  assert.equal(origin.confirmed,true);
  assert.equal(origin.revoked,false);
  assert.equal(origin.timestamp,(await rpc('block_info',{hash:origin.hash})).timestamp);
}
console.log(`PASS native local Dev payments, sender allow-list, unverified auto-accept, ${value.manualMerge ? 'reviewed manual merge and stale/replay guards' : 'default merge'}, merged transfer, lock`);
if (process.env.NATIVE_RECIPIENT_POLICY === '1') {
  const imported = await invoke('import_private_key', {hexKey:'01'.repeat(32)});
  assert.equal(imported.address, receiver.recipient);
  await enrollSigningDevice(imported.address);
  const received = await invoke('receive_pending', {rpcUrl,expectedAccount:imported.address,hash:value.recipientSend.hash});
  assert.equal(received.accepted,true);
  const before = await rpc('account_info',{account:imported.address});
  assert.equal(before.verification_state,'unverified');
  const holdings = await invoke('get_trst_portfolio',{rpcUrl});
  assert.equal(holdings.total_active,'1');
  await assert.rejects(()=>invoke('transfer_trst',{rpcUrl,expectedAccount:imported.address,to:receiver.genesis,amount:'1',origin:null}),/requires a verified wallet|wallet not verified/);
  const after = await rpc('account_info',{account:imported.address});
  assert.equal(after.head,before.head);
  assert.equal(after.block_count,before.block_count);
  assert.deepEqual((await invoke('get_trst_portfolio',{rpcUrl})).batches,holdings.batches);
  console.log('PASS native recipient policy: unverified Send receipt, spending refusal, unchanged rejected head, retained sender remainder ID and one Send block');
}
if (process.env.NATIVE_SELF_TRANSFER === '1') console.log('PASS native self-transfer: pending debit, exact restored balance, age/provenance and duplicate receipt refusal');
if (process.env.NATIVE_LINEAR_REFERENCE === '1') console.log('PASS native linear reference: real RPC/native field retained, valid fresh percentage and unchanged face amount');
}

async function expiredMergeJourney() {
  assert(process.env.NATIVE_RESULT_PATH);
  await script(`localStorage.setItem('burst-wallet',JSON.stringify({state:{rpcUrl:arguments[0],autoAccept:false,mergeLevel:0},version:0}));`,[rpcUrl]);
  assert((await fetch(`${base}/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).ok);
  await wait(`document.body.innerText.includes('Create New Wallet')`);
  await click('Import Private Key');
  await wait(`!!document.getElementById('wallet-private-key')`);
  // Public disposable Dev key, never the public testnet creator's key.
  await fill('wallet-private-key','00'.repeat(32));
  await click('Import');
  await wait(`document.body.innerText.includes('Continue without file')`);
  await click('Continue without file');
  await wait(`document.body.innerText.includes('Go to Dashboard')`);
  await click('Go to Dashboard');
  await wait(`!!document.querySelector('[aria-label="Wallet balances"]')`);
  const {address}=await invoke('get_account_info',{rpcUrl});
  await enrollSigningDevice(address);
  const before=await rpc('trst_portfolio',{account:address});
  assert.equal(before.total_active,'0');assert.equal(before.total_expired,'18');
  assert.equal(before.batches.length,2);assert(before.batches.every(batch=>batch.status==='expired'));
  const initial=await rpc('account_info',{account:address});
  await script(`history.pushState({},'', '/portfolio');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Combine batches'&&!button.disabled)`);
  async function review() {
    await click('Combine batches');
    await wait(`document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length===2`);
    assert(await script(`const inputs=[...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')];if(inputs.some(input=>input.disabled))return false;inputs.forEach(input=>input.click());return true;`));
    await click('Review');
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Review combination')`);
    const text=await script(`return document.querySelector('[role="dialog"]').textContent`);
    assert(text.includes('0.000000000000000018 TRST')&&text.includes('not spendable TRST'));
  }
  await review();
  assert(await script(`const button=document.querySelector('[role="dialog"] button:has(.sr-only)');if(!button)return false;button.click();return true;`));
  await wait(`!document.querySelector('[role="dialog"]')`);
  await wait(`document.activeElement?.textContent.trim()==='Combine batches'`);
  assert.equal((await rpc('account_info',{account:address})).head,initial.head);
  await review();
  assert(await script(`const button=[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Confirm combination');if(!button||button.disabled)return false;button.click();button.click();return true;`));
  await wait(`document.querySelector('[data-transaction-receipt]')?.textContent.includes('Transaction confirmed')`);
  const after=await rpc('account_info',{account:address});
  assert.equal(Number(after.block_count),Number(initial.block_count)+1);
  const block=await rpc('block_info',{hash:after.head});
  assert.equal(block.confirmed,true);assert.equal(block.block_type,'Merge');
  const portfolio=await rpc('trst_portfolio',{account:address});
  assert.equal(portfolio.total_active,'0');assert.equal(portfolio.total_expired,'18');
  assert.equal(portfolio.batches.length,1);assert.equal(portfolio.batches[0].status,'expired');
  assert.equal(portfolio.batches[0].timestamp,Math.min(...before.batches.map(batch=>batch.timestamp)));
  const origins=await rpc('trst_origins',{origin:portfolio.batches[0].origin});
  assert.equal(origins.complete,true);assert.equal(origins.confirmed,true);
  assert.deepEqual(origins.origins.map(origin=>origin.hash).sort(),before.batches.map(batch=>batch.origin).sort());
  await assert.rejects(()=>invoke('transfer_trst',{rpcUrl,expectedAccount:address,to:address,amount:'1',origin:portfolio.batches[0].origin}),/insufficient active TRST/);
  assert.equal((await rpc('account_info',{account:address})).head,after.head);
  await writeFile(process.env.NATIVE_RESULT_PATH,JSON.stringify({address,hash:after.head,portfolio,origins}));
  console.log('PASS installed expired merge: review, cancel/focus, duplicate-click guard, confirmed merge, exact amount/age/provenance and non-spendability');
}

if(process.env.NATIVE_EXPIRED_MERGE==='1') await expiredMergeJourney();
else await paymentsJourney();
