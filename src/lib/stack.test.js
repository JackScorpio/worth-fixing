import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topFrameLocation, sourceFileFromStack } from './stack.js';

const SAMPLE_STACK = [
  'Error: boom',
  '    at Object.<anonymous> (http://localhost:8000/dev/test-page.html:12:11)',
  '    at HTMLButtonElement.onclick (http://localhost:8000/dev/test-page.html:12:5)',
].join('\n');

test('topFrameLocation finds the first frame with a location', () => {
  const top = topFrameLocation(SAMPLE_STACK);
  assert.equal(top.file, 'http://localhost:8000/dev/test-page.html');
  assert.equal(top.line, 12);
  assert.equal(top.col, 11);
});

test('topFrameLocation skips frames from an ignored file', () => {
  const stackWithPatch = [
    'Error',
    '    at emit (chrome-extension://abc/src/main-world.js:40:3)',
    '    at Object.<anonymous> (http://localhost:8000/app.js:5:1)',
  ].join('\n');
  const top = topFrameLocation(stackWithPatch, { ignoreFiles: ['main-world.js'] });
  assert.equal(top.file, 'http://localhost:8000/app.js');
});

test('sourceFileFromStack strips the origin and keeps path:line:col', () => {
  assert.equal(sourceFileFromStack(SAMPLE_STACK), 'dev/test-page.html:12:11');
});

test('returns null when the stack has no parsable frames', () => {
  assert.equal(topFrameLocation(''), null);
  assert.equal(topFrameLocation(null), null);
  assert.equal(sourceFileFromStack(null), null);
});
