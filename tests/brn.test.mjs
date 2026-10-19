import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBrn, parseAmount, incomeStatus } from '../src/lib/brn.ts';

const state = { verified_at: 10, total_burned: '3', total_staked: '7', accrual_active: true, accrual_stopped_at: null, as_of: 10,
  rate_history: [{ rate: '10', start: 0, end: 20 }, { rate: '20', start: 20, end: null }] };
test('BRN integrates historical rates and subtracts both burns and stakes', () => {
  assert.equal(computeBrn(state, 30), '290');
  assert.equal(computeBrn(state, 15), '40');
});
test('zero rate stops future accrual without destroying previously earned BRN', () => {
  const stoppedRate = { ...state, rate_history: [state.rate_history[0], { rate: '0', start: 20, end: null }] };
  assert.equal(computeBrn(stoppedRate, 1_000_000), '90');
});
test('inactive accrual freezes at its stop, not at a moving local clock', () => {
  assert.equal(computeBrn({ ...state, accrual_active: false, accrual_stopped_at: 25 }, 1000), '190');
});
test('re-verification preserves historical earnings across a rate change during a pause', () => {
  const resumed = { ...state, paused_intervals:[{start:15,end:25}] };
  assert.equal(computeBrn(resumed, 30), '140');
  assert.equal(computeBrn(resumed, 22), '40');
});
test('amount conversion preserves all 18 decimals without floating point', () => {
  assert.equal(parseAmount('1.000000000000000001'), '1000000000000000001');
  assert.equal(parseAmount('0.000000000000000001'), '1');
  for (const input of ['0', '-1', '1e18', 'NaN', '0.0000000000000000001', '340282366920938463464']) assert.throws(() => parseAmount(input));
});
test('BRN overflow is reported, not silently rounded or clamped to u128', () => {
  assert.throws(() => computeBrn({ ...state, rate_history: [{ rate: ((1n << 128n) - 1n).toString(), start: 0, end: null }] }, 100));
});

test('burns and stakes cannot hide accrual overflow before deduction', () => {
  const max = (1n << 128n) - 1n;
  const boundary = {...state, verified_at:0, total_burned:'0', total_staked:'0', rate_history:[{rate:max.toString(),start:0,end:null}]};
  assert.equal(computeBrn(boundary,1),max.toString());
  assert.equal(computeBrn({...boundary,total_burned:max.toString()},1),'0');
  for (const field of ['total_burned','total_staked']) {
    assert.throws(()=>computeBrn({...boundary,[field]:max.toString()},2),/accrual exceeds/);
    assert.throws(()=>computeBrn({...boundary,[field]:'1',rate_history:[
      {rate:max.toString(),start:0,end:1},{rate:'1',start:1,end:null},
    ]},2),/accrual exceeds/);
  }
});

test('income copy follows the current rate without promising permanent accrual', () => {
  assert.deepEqual(incomeStatus(state, 19), {state:'active',daily:'864000'});
  assert.deepEqual(incomeStatus(state, 20), {state:'active',daily:'1728000'});
  assert.deepEqual(incomeStatus({...state,accrual_active:false}, 30), {state:'paused',daily:null});
  assert.deepEqual(incomeStatus({...state,rate_history:[{rate:'0',start:0,end:null}]}, 30), {state:'off',daily:'0'});
  assert.deepEqual(incomeStatus(null, 30), {state:'unknown',daily:null});
  assert.deepEqual(incomeStatus({...state,rate_history:[{rate:'1',start:40,end:null}]}, 30), {state:'unknown',daily:null});
  assert.deepEqual(incomeStatus({...state,rate_history:[{rate:'invalid',start:0,end:null}]}, 30), {state:'unknown',daily:null});
});
