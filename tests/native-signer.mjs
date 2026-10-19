// Real native command dispatch. Public fixture keys; no user wallet or signing.
import assert from 'node:assert/strict';
import {base} from './native-env.mjs';

async function invoke(command, args) {
  const response = await fetch(`${base}/execute/async`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({args:[command,args],script:`const done=arguments[arguments.length-1];
      window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({failure:String(error)}));`}),
    signal:AbortSignal.timeout(10000),
  });
  const {value} = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}

const other = (await invoke('import_private_key',{hexKey:'22'.repeat(32)})).value.address;
const signer = (await invoke('import_private_key',{hexKey:'00'.repeat(32)})).value.address;
const hash = 'ab'.repeat(32);
const actions = [
  ['pay',{provider:other,amount:'1'}],
  ['transfer_trst',{to:other,amount:'1',origin:null}],
  ['receive_pending',{hash}],
  ['reject_pending',{hash}],
  ['endorse_wallet',{target:other,amount:'1'}],
  ['challenge_wallet',{target:other,stake:'1',reason:'fraud'}],
  ['vote_proposal',{proposal:hash,vote:'yea'}],
  ['change_representative',{rep:other}],
  ['delegate_vote',{delegateTo:other}],
  ['revoke_delegation',{}],
  ['appeal_wallet',{reviewed:{account:other,enabled:true,challenge_active:false,required_stake:'1',
    outcome:{hash,checkpoint:'cd'.repeat(32),reason:'Fraud',legitimate:false,completed_at:1}}}],
];
for (const [command,args] of actions) {
  const params = {...args,rpcUrl:'invalid URL'};
  const missing = await invoke(command,params);
  assert.match(missing.failure ?? '',/expectedAccount/,`${command} allowed an omitted signer`);
  const changed = await invoke(command,{...params,expectedAccount:other});
  assert.match(changed.failure ?? '',/wallet changed/i,`${command} did not check the signer before RPC`);
}
const session = (await invoke('begin_automation')).value;
assert.equal(typeof session, 'string');
assert.equal((await invoke('lock_wallet')).failure, undefined);
assert.equal((await invoke('is_locked')).value, true);
const maintenance = await invoke('maintain_wallet',{
  rpcUrl:'invalid URL',expectedAccount:signer,autoAccept:true,trustedSenders:[],
  mergeLevel:0,automationSession:session,groupPolicy:null,
});
assert.match(maintenance.failure ?? '',/Automation settings changed/,'Lock did not cancel its automation session');
for (const [command,args] of actions) {
  const locked = await invoke(command,{...args,rpcUrl:'invalid URL',expectedAccount:signer});
  assert.match(locked.failure ?? '',/Wallet not loaded/,`${command} did not reject a locked signer before RPC`);
}
const restored = await invoke('import_private_key',{hexKey:'00'.repeat(32)});
assert.equal(restored.value.address, signer);
assert.equal((await invoke('is_locked')).value, false);
const resumed = (await invoke('begin_automation')).value;
assert(BigInt(resumed) > BigInt(session), 'Restoring a signer reused the cancelled session');
assert.equal((await invoke('lock_wallet')).failure, undefined);
assert.equal((await invoke('is_locked')).value, true);
console.log(`PASS native signer binding: ${actions.length} commands reject missing, changed and locked signers before RPC; locking cancels automation; fixture restore unlocks with a fresh session`);
