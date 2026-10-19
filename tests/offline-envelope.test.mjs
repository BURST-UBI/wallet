import assert from 'node:assert/strict';
import test from 'node:test';
import { signedBlockJson } from './offline-envelope.mjs';

test('native draft extraction preserves raw u128 tokens across supported envelopes', () => {
  const block = '{"hash":[1,2,3],"brn_balance":340282366920938463463374607431768211455,"trst_balance":1000000000000000001}';
  for (const version of [1,2,3,4]) {
    const saved = `{"version":${version},"block":${block}${version >= 3 ? `,"ancestry":[${block}]` : ''}${version === 4 ? ',"proposal_content":[0,255,1]' : ''}}`;
    assert.equal(signedBlockJson(saved),block);
  }
  assert.throws(()=>signedBlockJson(`{"version":5,"block":${block}}`));
  assert.throws(()=>signedBlockJson(`{"version":4,"block":${block}}`));
  assert.throws(()=>signedBlockJson(`{"version":3,"block":${block}}`));
});
