// src/lib/jev.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateState,
  buildJevRequest,
  isConfident,
  bucketPriorityColor,
  applySilentBugPromotion,
} from './jev.js';

test('truncateState leaves short text untouched', () => {
  assert.equal(truncateState('short'), 'short');
});

test('truncateState truncates long text with a marker', () => {
  const long = 'x'.repeat(25000);
  const result = truncateState(long);
  assert.ok(result.length < long.length);
  assert.ok(result.endsWith('[truncated]'));
});

test('buildJevRequest passes state/model/questions through unchanged', () => {
  const req = buildJevRequest({ state: 's', model: 'jev-1.13.0', questions: { q: {} } });
  assert.deepEqual(req, { state: 's', model: 'jev-1.13.0', questions: { q: {} } });
});

test('isConfident is true at and above the threshold', () => {
  assert.equal(isConfident(0.5), true);
  assert.equal(isConfident(0.51), true);
  assert.equal(isConfident(0.49), false);
});

test('isConfident treats a missing/non-numeric confidence as not confident', () => {
  assert.equal(isConfident(undefined), false);
  assert.equal(isConfident(null), false);
});

test('bucketPriorityColor uses the legend range when present', () => {
  const grey = bucketPriorityColor({ score: 0, legend: { 0: 'low', 1: 'mid', 2: 'high' } });
  const amber = bucketPriorityColor({ score: 1, legend: { 0: 'low', 1: 'mid', 2: 'high' } });
  const red = bucketPriorityColor({ score: 2, legend: { 0: 'low', 1: 'mid', 2: 'high' } });
  assert.equal(grey, 'grey');
  assert.equal(amber, 'amber');
  assert.equal(red, 'red');
});

test('bucketPriorityColor falls back to a 0-2 range without a usable legend', () => {
  assert.equal(bucketPriorityColor({ score: 0 }), 'grey');
  assert.equal(bucketPriorityColor({ score: 1 }), 'amber');
  assert.equal(bucketPriorityColor({ score: 2 }), 'red');
});

test('bucketPriorityColor returns null for a missing score', () => {
  assert.equal(bucketPriorityColor(null), null);
  assert.equal(bucketPriorityColor({}), null);
});

test('applySilentBugPromotion bumps grey to amber and amber to red', () => {
  assert.equal(applySilentBugPromotion('grey', 0.9), 'amber');
  assert.equal(applySilentBugPromotion('amber', 0.9), 'red');
});

test('applySilentBugPromotion caps at red', () => {
  assert.equal(applySilentBugPromotion('red', 0.9), 'red');
});

test('applySilentBugPromotion does not promote below the 0.5 probability', () => {
  assert.equal(applySilentBugPromotion('grey', 0.4), 'grey');
});

test('applySilentBugPromotion passes through a null color unchanged', () => {
  assert.equal(applySilentBugPromotion(null, 0.9), null);
});
