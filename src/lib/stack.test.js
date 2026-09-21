import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topFrameLocation, sourceFileFromStack, normalizedFrameKey } from './stack.js';

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

test('normalizedFrameKey drops the query string so an HMR cache-buster does not change it', () => {
  const stackA = '    at Object.<anonymous> (http://localhost:5173/src/App.tsx?t=1758412330000:42:11)';
  const stackB = '    at Object.<anonymous> (http://localhost:5173/src/App.tsx?t=1758412999999:42:11)';
  assert.equal(
    normalizedFrameKey(topFrameLocation('Error\n' + stackA)),
    normalizedFrameKey(topFrameLocation('Error\n' + stackB))
  );
});

test('normalizedFrameKey drops line:col so an edit above the error does not change it', () => {
  const top1 = { file: 'http://localhost:5173/src/App.tsx', line: 42, col: 11 };
  const top2 = { file: 'http://localhost:5173/src/App.tsx', line: 55, col: 3 };
  assert.equal(normalizedFrameKey(top1), normalizedFrameKey(top2));
});

test('normalizedFrameKey still distinguishes different files', () => {
  const top1 = { file: 'http://localhost:5173/src/App.tsx', line: 1, col: 1 };
  const top2 = { file: 'http://localhost:5173/src/Other.tsx', line: 1, col: 1 };
  assert.notEqual(normalizedFrameKey(top1), normalizedFrameKey(top2));
});

test('normalizedFrameKey returns an empty string when there is no frame', () => {
  assert.equal(normalizedFrameKey(null), '');
});

test('topFrameLocation skips any chrome-extension:// frame, not just our own main-world.js', () => {
  // React/Redux/Vue DevTools patch console.error/console.warn too, inserting
  // their own wrapper frame (e.g. installHook.js) ahead of the real caller.
  // Without this, sourceFile points at another extension's internals instead
  // of the page's own code.
  const stackWithReactDevTools = [
    'Error',
    '    at console.overrideMethod [as error] (chrome-extension://fmkadmapgofadopljbjfkapdkoienihi/build/installHook.js:1:168574)',
    '    at HTMLButtonElement.onclick (http://localhost:8000/test-page.html:27:15)',
  ].join('\n');
  const top = topFrameLocation(stackWithReactDevTools);
  assert.equal(top.file, 'http://localhost:8000/test-page.html');
  assert.equal(top.line, 27);
});
