import assert from 'node:assert/strict';

// Extract the serialized block without rounding its raw u128 balances in JS.
export function signedBlockJson(saved) {
  const header = saved.match(/^\{"version":([1234]),"block":/);
  assert(header && saved.endsWith('}'), 'Unexpected native draft encoding');
  const end = Number(header[1]) >= 3 ? saved.indexOf(',"ancestry":', header[0].length) : saved.length - 1;
  assert(end > header[0].length, 'Missing native recovery ancestry');
  const block = saved.slice(header[0].length, end);
  assert(block.startsWith('{') && block.endsWith('}'), 'Invalid native block envelope');
  return block;
}
