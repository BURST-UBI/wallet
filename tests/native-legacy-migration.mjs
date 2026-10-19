import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile, stat, utimes} from 'node:fs/promises';
import {join} from 'node:path';

export async function seedLegacyProfile(data, evidence) {
  const source = process.env.NATIVE_LEGACY_SOURCE;
  assert(source, 'Provide the disposable installed-retention fixture');
  const manifest = JSON.parse(await readFile(join(source, 'offline-payment.json'), 'utf8'));
  const {account, pending, journal} = manifest;
  assert.equal(JSON.parse(journal).block.account, account);
  const directory = join(data, 'com.burst.wallet', 'offline-payments');
  await mkdir(directory, {recursive:true, mode:0o700});
  const receipts = join(source, 'data', 'com.burst.wallet', 'offline-payments', 'completed', account);
  const names = await readdir(receipts);
  assert.equal(names.length, 100);
  const expected = [];
  for (const name of names) {
    assert.match(name, /^confirmed-[0-9a-f]{64}\.json$/);
    const bytes = await readFile(join(receipts, name), 'utf8');
    const block = JSON.parse(bytes).block;
    const hash = Buffer.from(block.hash).toString('hex');
    assert.equal(name, `confirmed-${hash}.json`);
    assert.equal(block.account, account);
    const metadata = await stat(join(receipts, name));
    await writeFile(join(directory, name), bytes, {flag:'wx',mode:0o600});
    await utimes(join(directory, name), metadata.atime, metadata.mtime);
    await writeFile(join(directory, `attempted-${hash}.marker`), '1\n', {flag:'wx',mode:0o600});
    expected.push({name, bytes, mtimeMs:(await stat(join(directory,name))).mtimeMs});
  }
  await writeFile(join(directory, `${account}.json`), journal, {flag:'wx',mode:0o600});
  await writeFile(join(directory, `attempted-${pending.hash}.marker`), '1\n', {flag:'wx',mode:0o600});
  await writeFile(join(directory, 'unknown.json'), journal, {flag:'wx',mode:0o600});
  await writeFile(join(evidence, 'legacy-expected.json'), JSON.stringify({account,pending,journal,expected}), {flag:'wx',mode:0o600});
}

async function checkMigration() {
  const {invoke} = await import('./native-certified-utils.mjs');
  const {account,pending,journal,expected} = JSON.parse(await readFile(join(process.env.NATIVE_EVIDENCE,'legacy-expected.json'),'utf8'));
  const directory = join(process.env.XDG_DATA_HOME, 'com.burst.wallet', 'offline-payments');
  const completed = join(directory, 'completed', account);
  assert.deepEqual((await readdir(completed)).sort(), expected.map(item=>item.name).sort());
  for (const receipt of expected) {
    assert.equal(await readFile(join(completed,receipt.name),'utf8'),receipt.bytes);
    assert.equal((await stat(join(completed,receipt.name))).mtimeMs,receipt.mtimeMs);
    await assert.rejects(readFile(join(directory,receipt.name)),{code:'ENOENT'});
  }
  assert.equal(await readFile(join(directory,`${account}.json`),'utf8'),journal);
  assert.equal(await readFile(join(directory,'unknown.json'),'utf8'),journal);
  assert.deepEqual((await readdir(directory)).filter(name=>name.endsWith('.marker')),[`attempted-${pending.hash}.marker`]);
  const wallet = await invoke('import_private_key',{hexKey:'00'.repeat(32)});
  assert.equal(wallet.address,account);
  const active = await invoke('get_offline_payment',{expectedAccount:account});
  assert.equal(active.hash,pending.hash);
  assert.equal(active.can_discard,false);
  await assert.rejects(invoke('discard_offline_payment',{expectedAccount:account,expectedHash:pending.hash}),/may already be submitted/);
  console.log('PASS installed legacy migration/reopen: 100 exact receipts and timestamps, only unresolved marker retained, active draft still reserved');
}

if (process.env.WEBDRIVER_SESSION) await checkMigration();
