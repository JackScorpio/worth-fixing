import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFingerprint, sha256Hex } from './fingerprint.js';

test('sha256Hex is deterministic and hex-encoded', async () => {
  const a = await sha256Hex('hello');
  const b = await sha256Hex('hello');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('computeFingerprint is stable when only numeric noise changes', async () => {
  const event = {
    kind: 'console.error',
    message: "Cannot read properties of undefined (reading 'map') at retry 3",
    stack: '    at Object.<anonymous> (http://localhost:8000/app.js:10:2)',
  };
  const fp1 = await computeFingerprint(event);
  const fp2 = await computeFingerprint({ ...event, message: event.message.replace('3', '9') });
  assert.equal(fp1, fp2, 'numeric noise should normalize to the same fingerprint');
  assert.equal(fp1.length, 16);
});

test('computeFingerprint differs when the error kind differs', async () => {
  const base = { message: 'boom', stack: '' };
  const fp1 = await computeFingerprint({ ...base, kind: 'console.error' });
  const fp2 = await computeFingerprint({ ...base, kind: 'console.warn' });
  assert.notEqual(fp1, fp2);
});

test('computeFingerprint is stable when only the stack line:col shifts', async () => {
  const base = { kind: 'console.error', message: 'boom' };
  const fp1 = await computeFingerprint({
    ...base,
    stack: 'Error: boom\n    at Object.<anonymous> (http://localhost:5173/src/App.tsx:42:11)',
  });
  const fp2 = await computeFingerprint({
    ...base,
    stack: 'Error: boom\n    at Object.<anonymous> (http://localhost:5173/src/App.tsx:55:3)',
  });
  assert.equal(fp1, fp2, 'editing a line above the error should not change the fingerprint');
});

test('computeFingerprint is stable across an HMR cache-busting query string', async () => {
  const base = { kind: 'console.error', message: 'boom' };
  const fp1 = await computeFingerprint({
    ...base,
    stack: 'Error: boom\n    at Object.<anonymous> (http://localhost:5173/src/App.tsx?t=1:42:11)',
  });
  const fp2 = await computeFingerprint({
    ...base,
    stack: 'Error: boom\n    at Object.<anonymous> (http://localhost:5173/src/App.tsx?t=2:42:11)',
  });
  assert.equal(fp1, fp2, 'an HMR reload should not change the fingerprint');
});

test('computeFingerprint differs by HTTP status for otherwise-identical network events', async () => {
  const base = {
    kind: 'network',
    message: 'GET /api/orders -> 404',
    stack: '',
  };
  const fp404 = await computeFingerprint({ ...base, status: 404 });
  const fp500 = await computeFingerprint({ ...base, status: 500 });
  assert.notEqual(fp404, fp500, 'a 404 and a 500 on the same URL should not collide');
});
