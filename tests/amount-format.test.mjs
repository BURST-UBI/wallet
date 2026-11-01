import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount } from '../src/lib/utils.ts';
import { computeBrn } from '../src/lib/brn.ts';

test('positive amounts below display precision are not shown as zero', () => {
  for (const raw of ['1', '7', '999999999999']) {
    assert.equal(formatAmount(raw), '<0.000001');
  }
  assert.equal(formatAmount('1000000000000'), '0.000001');
  assert.equal(formatAmount('0'), '0.000000');
});

test('review amounts retain all 18 decimals and the full u128 range', () => {
  assert.equal(formatAmount('7', 18), '0.000000000000000007');
  assert.equal(formatAmount('1000000000000000001', 18), '1.000000000000000001');
  assert.equal(formatAmount('340282366920938463463374607431768211455', 18), '340282366920938463463.374607431768211455');
  assert.equal(formatAmount('1234567890123456789'), '1.234567');
});

test('whole-unit and custom precision displays distinguish zero from small positives', () => {
  assert.equal(formatAmount('0', 0), '0');
  assert.equal(formatAmount('1', 0), '<1');
  assert.equal(formatAmount('1000000000000000000', 0), '1');
  assert.equal(formatAmount('7', 2), '<0.01');
  assert.equal(formatAmount('0007'), '<0.000001');
  for (const decimals of [-1, 19, 1.5, NaN]) {
    assert.throws(() => formatAmount('1', decimals), RangeError);
  }
});

test('accrual uses raw units even when a burn is below display precision', () => {
  assert.equal(formatAmount(computeBrn({ verified_at: 0, total_burned: '1', total_staked: '0', accrual_active: true, accrual_stopped_at: null, as_of: 1, rate_history: [{rate: '0', start: 0, end: null}] }, 1)), '0.000000');
});
