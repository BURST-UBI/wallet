// Real WebKit/Tauri IPC checks. Never log or persist recovery material.
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base, rpcUrl } from './native-env.mjs';
const backupPath = join(await mkdtemp(join(tmpdir(), 'burst-native-backup-')), 'disposable-wallet.json');
async function execute(script, args = [], async = false) {
  const response = await fetch(`${base}/execute/${async ? 'async' : 'sync'}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({script, args}),
  });
  const result = await response.json();
  assert(!result.value?.error, JSON.stringify(result.value));
  return result.value;
}
const result = await execute(`
 const done = arguments[arguments.length - 1];
 const backupPath = arguments[0];
 const rpcUrl = arguments[1];
 (async () => {
   const invoke = window.__TAURI_INTERNALS__.invoke;
   const created = await invoke('create_wallet');
   if (created.recovery_phrase?.split(' ').length !== 24) throw new Error('Expected 24-word backup');
   const address = created.address;
   await invoke('lock_wallet');
   if (!(await invoke('is_locked'))) throw new Error('Lock failed');
   const restored = await invoke('import_mnemonic', {phrase:created.recovery_phrase});
   if (restored.address !== address) throw new Error('Mnemonic restored a different wallet');
   const account = await invoke('get_account_info', {rpcUrl});
   if (account.verification_state !== 'unverified') throw new Error('Fresh wallet has wrong state');
   const balances = await invoke('get_trst_balance', {rpcUrl});
   if (balances.active !== '0') throw new Error('Fresh wallet balance incorrect');
   let rejected = false;
   try { await invoke('pay', {rpcUrl, expectedAccount:address, provider:address, amount:'1'}); } catch { rejected = true; }
   if (!rejected) throw new Error('Unverified unfunded spend accepted');
   const password = 'Disposable native test password';
   await invoke('save_keystore', {password, path:backupPath});
   let overwriteRejected = false;
   try { await invoke('save_keystore', {password:'Different password', path:backupPath}); }
   catch { overwriteRejected = true; }
   if (!overwriteRejected) throw new Error('Existing backup was overwritten');
   await invoke('load_keystore_cmd', {path:backupPath});
   if (!(await invoke('is_locked'))) throw new Error('Loading a keystore must lock the active signer');
   let wrongPasswordRejected = false;
   try { await invoke('unlock_wallet', {password:'Wrong password'}); }
   catch { wrongPasswordRejected = true; }
   if (!wrongPasswordRejected || !(await invoke('is_locked'))) throw new Error('Wrong password did not keep wallet locked');
   const unlocked = await invoke('unlock_wallet', {password});
   if (unlocked.address !== address) throw new Error('Backup restored a different wallet');
   await invoke('lock_wallet');
   const watched = await invoke('watch_wallet', {address});
   if (!watched.watch_only || watched.address !== address || watched.recovery_phrase) throw new Error('Watch-only account did not open without recovery material');
   if (await invoke('is_locked')) throw new Error('Watch-only account cannot be inspected');
   if (await invoke('get_address') !== address) throw new Error('Watch-only address mismatch');
   await invoke('get_trst_balance', {rpcUrl});
   for (const [command, args] of [
     ['begin_automation', {}],
     ['pay', {rpcUrl, expectedAccount:address, provider:address, amount:'1'}],
     ['unlock_wallet', {password}],
     ['export_private_key', {password}],
   ]) {
     let refused = false;
     try { await invoke(command, args); } catch { refused = true; }
     if (!refused) throw new Error('Watch-only operation allowed: ' + command);
   }
   if (await invoke('offline_signing_available')) throw new Error('Watch-only session advertises offline signing');
   await invoke('lock_wallet');
   if (!(await invoke('is_locked'))) throw new Error('Watch-only close failed');
   return {mnemonicRoundtrip:true, lock:true, realRpc:true, unverifiedSpendRejected:true, encryptedBackup:true, watchOnly:true};
 })().then(done, e => done({error:String(e)}));
`, [backupPath, rpcUrl], true);
assert.deepEqual(result, {mnemonicRoundtrip:true,lock:true,realRpc:true,unverifiedSpendRejected:true,encryptedBackup:true,watchOnly:true});
if (process.platform !== 'win32') assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
console.log('PASS native mnemonic restore, encrypted backup, non-overwrite, lock, wrong-password rejection, local Dev RPC, unverified-spend rejection and view-only access');
