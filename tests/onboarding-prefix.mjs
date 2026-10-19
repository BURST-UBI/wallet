import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const hash = value => assert.match(value ?? '', /^[0-9a-f]{64}$/);
const account = value => assert.match(value ?? '', /^brst_[13456789abcdefghijkmnopqrstuwxyz]{60}$/);

export function validatePrefix(value, subject, receiver) {
  assert.equal(value.version, 1);
  assert.equal(value.subject, subject, 'Saved onboarding subject differs from restored wallet');
  assert.equal(value.receiver, receiver, 'Saved onboarding receiver differs from restored wallet');
  account(subject);
  account(receiver);
  assert.notEqual(subject, receiver);
  hash(value.representative_change?.hash);
  account(value.representative_change.representative);
  account(value.participation?.account);
  assert.equal(value.participation.hashes.length, 2);
  value.participation.hashes.forEach(hash);
  assert.equal(value.endorsements.length, 3);
  for (const endorsement of value.endorsements) {
    account(endorsement.account);
    hash(endorsement.hash);
  }
  assert.equal(new Set(value.endorsements.map(row => row.account)).size, 3);
  const hashes = [value.representative_change.hash, ...value.participation.hashes,
    ...value.endorsements.map(row => row.hash)];
  assert.equal(new Set(hashes).size, hashes.length, 'Onboarding actions must be distinct');
  return value;
}

export async function savePrefix(path, value) {
  validatePrefix(value, value.subject, value.receiver);
  // Never replace evidence from an earlier attempt. An interrupted write must
  // fail validation on resume, not silently omit already completed actions.
  await writeFile(path, JSON.stringify(value, null, 2), {flag:'wx', mode:0o600});
}

export async function loadPrefix(path, subject, receiver) {
  return validatePrefix(JSON.parse(await readFile(path, 'utf8')), subject, receiver);
}
