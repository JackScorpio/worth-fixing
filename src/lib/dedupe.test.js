import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDedupeIncrement } from './dedupe.js';

test('increments a new fingerprint to 1', () => {
  const result = applyDedupeIncrement({}, 'abc123', 1000);
  assert.equal(result.abc123, 1);
});

test('increments an existing fingerprint', () => {
  const result = applyDedupeIncrement({ abc123: 4 }, 'abc123', 1000);
  assert.equal(result.abc123, 5);
});

test('does not mutate the input map', () => {
  const input = { abc123: 1 };
  applyDedupeIncrement(input, 'abc123', 1000);
  assert.equal(input.abc123, 1, 'the original map passed in must be untouched');
});

test('evicts the oldest-inserted entry once the cap is reached', () => {
  const input = { first: 1, second: 1, third: 1 };
  const result = applyDedupeIncrement(input, 'fourth', 3);
  assert.deepEqual(Object.keys(result), ['second', 'third', 'fourth']);
  assert.equal(result.fourth, 1);
});

test('does not evict when incrementing an already-tracked fingerprint at the cap', () => {
  const input = { first: 1, second: 1, third: 1 };
  const result = applyDedupeIncrement(input, 'second', 3);
  assert.deepEqual(Object.keys(result), ['first', 'second', 'third']);
  assert.equal(result.second, 2);
});

test('stays under the cap when below it', () => {
  const input = { first: 1 };
  const result = applyDedupeIncrement(input, 'second', 3);
  assert.deepEqual(Object.keys(result), ['first', 'second']);
});
