import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPrefix, savePrefix, validatePrefix } from './onboarding-prefix.mjs';

const address = n => `brst_${String(n).repeat(60)}`;
const hash = n => String(n).repeat(64);
const sample = () => ({version:1, subject:address(1), receiver:address(3),
  representative_change:{hash:hash(1), representative:address(4)},
  participation:{account:address(5), hashes:[hash(2),hash(3)]},
  endorsements:[6,7,8].map((n,i)=>({account:address(n),hash:hash(i+4)}))});

test('resume retains every pre-vote action and cannot replace its evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'burst-onboarding-prefix-'));
  try {
    const path = join(root, 'prefix.json');
    const value = sample();
    await savePrefix(path, value);
    const bytes = await readFile(path);
    assert.deepEqual(await loadPrefix(path, value.subject, value.receiver), value);
    await assert.rejects(savePrefix(path, value), {code:'EEXIST'});
    assert.deepEqual(await readFile(path), bytes);
    await assert.rejects(loadPrefix(path, address(9), value.receiver));
    await assert.rejects(loadPrefix(path, value.subject, address(9)));
    await writeFile(join(root, 'truncated.json'), '{"version":1');
    await assert.rejects(loadPrefix(join(root, 'truncated.json'), value.subject, value.receiver));
    await assert.rejects(loadPrefix(join(root, 'missing.json'), value.subject, value.receiver));
  } finally { await rm(root, {recursive:true,force:true}); }
});

test('partial or duplicated actions cannot masquerade as complete onboarding', () => {
  for (const change of [
    value => delete value.participation,
    value => value.participation.hashes.pop(),
    value => value.endorsements.pop(),
    value => value.endorsements[1].account = value.endorsements[0].account,
    value => value.endorsements[1].hash = value.endorsements[0].hash,
    value => value.representative_change.hash = 'invalid',
    value => value.version = 2,
  ]) {
    const value = sample(); change(value);
    assert.throws(() => validatePrefix(value, address(1), address(3)));
  }
});
