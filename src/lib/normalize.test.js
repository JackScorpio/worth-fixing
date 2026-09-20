import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage } from './normalize.js';

test('replaces numbers with a placeholder', () => {
  assert.equal(normalizeMessage('Failed after 3 retries'), 'Failed after <num> retries');
});

test('replaces uuids with a placeholder', () => {
  const msg = 'User 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found';
  assert.equal(normalizeMessage(msg), 'User <uuid> not found');
});

test('replaces hex-looking ids with a placeholder', () => {
  assert.equal(normalizeMessage('Ref 0x1a2b3c4d failed'), 'Ref <hex> failed');
});

test('replaces long quoted strings but leaves short ones alone', () => {
  const long = '"' + 'x'.repeat(50) + '"';
  assert.equal(normalizeMessage(`Bad payload ${long}`), 'Bad payload <string>');
  assert.equal(normalizeMessage('Bad key "short"'), 'Bad key "short"');
});

test('non-string input normalizes to an empty string', () => {
  assert.equal(normalizeMessage(undefined), '');
});
