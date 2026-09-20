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
    sourceFile: 'app.js:10:2',
  };
  const fp1 = await computeFingerprint(event);
  const fp2 = await computeFingerprint({ ...event, message: event.message.replace('3', '9') });
  assert.equal(fp1, fp2, 'numeric noise should normalize to the same fingerprint');
  assert.equal(fp1.length, 16);
});

test('computeFingerprint differs when the error kind differs', async () => {
  const base = { message: 'boom', stack: '', sourceFile: '' };
  const fp1 = await computeFingerprint({ ...base, kind: 'console.error' });
  const fp2 = await computeFingerprint({ ...base, kind: 'console.warn' });
  assert.notEqual(fp1, fp2);
});
