import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostUsd, sumInputTokens, formatCostUsd, formatTokenCount } from './usage.js';

test('computeCostUsd is zero for zero tokens', () => {
  assert.equal(computeCostUsd(0), 0);
});

test('computeCostUsd is exactly the per-million rate at one million tokens', () => {
  assert.equal(computeCostUsd(1_000_000), 0.042);
});

test('computeCostUsd scales linearly below one million tokens', () => {
  // 620 input tokens, matching a real Jev response seen during Phase 3a
  // live testing: 620 / 1_000_000 * 0.042
  const result = computeCostUsd(620);
  assert.ok(Math.abs(result - 0.02604 / 1000) < 1e-9, `got ${result}`);
});

test('sumInputTokens is zero for an empty log', () => {
  assert.equal(sumInputTokens([]), 0);
});

test('sumInputTokens adds inputTokens across entries, ignoring other fields', () => {
  const log = [
    { timestamp: 1, inputTokens: 100 },
    { timestamp: 2, inputTokens: 250 },
  ];
  assert.equal(sumInputTokens(log), 350);
});

test('formatCostUsd shows 4 decimal places', () => {
  assert.equal(formatCostUsd(0), '$0.0000');
  assert.equal(formatCostUsd(0.021), '$0.0210');
});

test('formatCostUsd rounds the 4th decimal place', () => {
  assert.equal(formatCostUsd(0.00126), '$0.0013');
});

test('formatTokenCount shows raw numbers under 1000', () => {
  assert.equal(formatTokenCount(0), '0 tok');
  assert.equal(formatTokenCount(999), '999 tok');
});

test('formatTokenCount shows one decimal of thousands at and above 1000', () => {
  assert.equal(formatTokenCount(1000), '1.0k tok');
  assert.equal(formatTokenCount(1234), '1.2k tok');
  assert.equal(formatTokenCount(340000), '340.0k tok');
});
