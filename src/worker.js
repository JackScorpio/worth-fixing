// src/worker.js
import { computeFingerprint } from './lib/fingerprint.js';
import { sourceFileFromStack } from './lib/stack.js';

const IGNORE_STACK_FILES = ['main-world.js'];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CAPTURE_EVENT') return false;
  handleCaptureEvent(message).then(() => sendResponse({ ok: true }));
  return true; // keep the message channel open for the async response
});

async function handleCaptureEvent(message) {
  const { payload, pageUrl, origin } = message;
  const sourceFile = sourceFileFromStack(payload.stack, { ignoreFiles: IGNORE_STACK_FILES });
  const fingerprint = await computeFingerprint({
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    sourceFile,
    ignoreFiles: IGNORE_STACK_FILES,
  });

  const record = {
    id: crypto.randomUUID(),
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    sourceFile,
    origin,
    url: pageUrl,
    timestamp: payload.timestamp,
    request: payload.request,
    fingerprint,
  };

  const count = await incrementDedupeCount(fingerprint);
  console.log(`[web-error-monitor] ${record.kind} (x${count}) fp=${fingerprint}`, record);
}

async function incrementDedupeCount(fingerprint) {
  const { dedupeCounts = {} } = await chrome.storage.local.get('dedupeCounts');
  dedupeCounts[fingerprint] = (dedupeCounts[fingerprint] || 0) + 1;
  await chrome.storage.local.set({ dedupeCounts });
  return dedupeCounts[fingerprint];
}
