// src/worker.js
import { computeFingerprint } from './lib/fingerprint.js';
import { sourceFileFromStack } from './lib/stack.js';

const IGNORE_STACK_FILES = ['main-world.js'];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CAPTURE_EVENT') return false;
  handleCaptureEvent(message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error('[web-error-monitor] failed to handle capture event', error);
      sendResponse({ ok: false, error: String(error) });
    });
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

// Module-scope mutex serializing all read-modify-write access to the
// `dedupeCounts` key in chrome.storage.local. This holds no data itself
// (the counts remain solely in chrome.storage.local, the source of truth) —
// it only orders concurrent calls so a get()...set() pair can't interleave
// with another and lose an update. Resetting to Promise.resolve() on a
// service-worker restart is harmless: there's nothing in-flight to lose.
let dedupeQueue = Promise.resolve();

async function incrementDedupeCount(fingerprint) {
  const result = dedupeQueue.then(() => incrementDedupeCountUnsafe(fingerprint));
  // Swallow rejections in the chain itself so one failed call doesn't
  // permanently wedge the queue for subsequent calls; callers still see
  // the original rejection via `result`.
  dedupeQueue = result.catch(() => {});
  return result;
}

async function incrementDedupeCountUnsafe(fingerprint) {
  const { dedupeCounts = {} } = await chrome.storage.local.get('dedupeCounts');
  dedupeCounts[fingerprint] = (dedupeCounts[fingerprint] || 0) + 1;
  await chrome.storage.local.set({ dedupeCounts });
  return dedupeCounts[fingerprint];
}
