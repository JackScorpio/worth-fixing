// src/lib/jev.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateState,
  buildJevRequest,
  isConfident,
  bucketPriorityColor,
  applySilentBugPromotion,
  decideDisplay,
} from './jev.js';

const LEGEND = { 0: 'ignore', 1: 'fix before merge', 2: 'fix now' };

test('decideDisplay follows a confident priority', () => {
  const result = decideDisplay({ kind: 'network', priority: { score: 1.9, legend: LEGEND, confidence: 0.88 } });
  assert.equal(result.displayColor, 'red');
  assert.equal(result.lowConfidence, false);
});

test('decideDisplay follows a low-confidence "ignore" for non-crash kinds, but flags it', () => {
  const result = decideDisplay({ kind: 'network', priority: { score: 0.3, legend: LEGEND, confidence: 0.26 } });
  assert.equal(result.displayColor, 'grey');
  assert.equal(result.lowConfidence, true);
});

test('decideDisplay keeps a genuine crash on kind-based display when Jev is unsure it is ignorable', () => {
  const result = decideDisplay({ kind: 'uncaught', priority: { score: 0.3, legend: LEGEND, confidence: 0.26 } });
  assert.equal(result.displayColor, null);
  assert.equal(result.lowConfidence, true);
});

test('decideDisplay still promotes for silent-bug risk', () => {
  const result = decideDisplay({
    kind: 'console.warn',
    priority: { score: 0.2, legend: LEGEND, confidence: 0.9 },
    silentBug: { probability: 0.8 },
  });
  assert.equal(result.displayColor, 'amber');
});

test('decideDisplay mutes framework/extension noise even at low origin confidence, flagged', () => {
  const result = decideDisplay({ kind: 'console.warn', origin: { choice: 'browser_extension', confidence: 0.3 } });
  assert.equal(result.muted, true);
  assert.equal(result.lowConfidence, true);
});

test('decideDisplay does not mute a genuine crash on a low-confidence origin', () => {
  const result = decideDisplay({ kind: 'uncaught', origin: { choice: 'browser_extension', confidence: 0.3 } });
  assert.equal(result.muted, false);
});

test('decideDisplay with no answers falls back entirely', () => {
  assert.deepEqual(decideDisplay({ kind: 'network' }), { displayColor: null, muted: false, lowConfidence: false });
});

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
