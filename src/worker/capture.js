// src/worker/capture.js
//
// CAPTURE_EVENT -> normalize/fingerprint/dedupe -> RECORD relay pipeline.
// See src/worker/injection.js for the per-origin toggle/permission logic.

import { computeFingerprint } from '../lib/fingerprint.js';
import { sourceFileFromStack } from '../lib/stack.js';
import { applyDedupeIncrement } from '../lib/dedupe.js';
import { isOriginEnabled } from './injection.js';
import { getClassification, queueForClassification } from './classification.js';

const IGNORE_STACK_FILES = ['main-world.js'];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CAPTURE_EVENT') return false;
  handleCaptureEvent(message, sender)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error('[web-error-monitor] failed to handle capture event', error);
      sendResponse({ ok: false, error: String(error) });
    });
  return true; // keep the message channel open for the async response
});

async function handleCaptureEvent(message, sender) {
  // Gate on enabled state here too: injection alone doesn't guarantee "off",
  // since disableOrigin only tears down the one tab it was invoked on. A
  // sibling tab on the same origin that was already injected keeps sending
  // CAPTURE_EVENT messages until it's reloaded, so drop anything from an
  // origin that isn't currently enabled. Use sender.origin (set by Chrome
  // from the actual sending frame) rather than the page-self-reported
  // message.origin field, since the latter is just window.location.origin
  // read inside the page's own content-script bridge and could be spoofed by
  // a compromised/malicious page.
  const senderOrigin = sender?.origin;
  if (!senderOrigin || !(await isOriginEnabled(senderOrigin))) {
    return;
  }

  const { payload, pageUrl } = message;
  const sourceFile = sourceFileFromStack(payload.stack, { ignoreFiles: IGNORE_STACK_FILES });
  const fingerprint = await computeFingerprint({
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    ignoreFiles: IGNORE_STACK_FILES,
    status: payload.request?.status,
  });

  const record = {
    id: crypto.randomUUID(),
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    sourceFile,
    origin: senderOrigin,
    url: pageUrl,
    timestamp: payload.timestamp,
    request: payload.request,
    fingerprint,
  };

  const count = await incrementDedupeCount(fingerprint);
  console.log(`[web-error-monitor] ${record.kind} (x${count}) fp=${fingerprint}`, record);

  const classification = await getClassification(fingerprint);
  if (!classification) {
    // Cache miss: kick off the debounced classification pipeline. This is
    // fire-and-forget — classification is inherently async (network call,
    // possible retries), so the raw error is sent to the HUD immediately
    // below with classification: null, and a later CLASSIFICATION_UPDATE
    // message (from classification.js) fills it in once it's ready.
    queueForClassification(record);
  }

  const tabId = sender.tab?.id;
  if (tabId) {
    chrome.tabs
      .sendMessage(tabId, { type: 'RECORD', record: { ...record, classification } })
      .catch(() => {
        // The HUD may not be initialized yet (e.g. this event fired before
        // content.js finished loading), or the tab may have navigated away.
        // Dropping the record silently is fine — the console.log above is
        // the durable record of this event either way.
      });
  }
}

// Module-scope mutex serializing all read-modify-write access to the
// `dedupeCounts` key in chrome.storage.session. This holds no data itself
// (the counts remain solely in chrome.storage.session, the source of truth) —
// it only orders concurrent calls so a get()...set() pair can't interleave
// with another and lose an update. Resetting to Promise.resolve() on a
// service-worker restart is harmless: there's nothing in-flight to lose.
let dedupeQueue = Promise.resolve();

// chrome.storage.session (not .local): dedupe counts are a diagnostic
// display aid, not durable data worth keeping across browser restarts.
// Session storage is in-memory and clears automatically when the browser
// closes, which caps the previous unbounded, lifetime-across-every-origin
// growth without needing an explicit reset path.
const DEDUPE_COUNT_CAP = 1000;

async function incrementDedupeCount(fingerprint) {
  const result = dedupeQueue.then(() => incrementDedupeCountUnsafe(fingerprint));
  // Swallow rejections in the chain itself so one failed call doesn't
  // permanently wedge the queue for subsequent calls; callers still see
  // the original rejection via `result`.
  dedupeQueue = result.catch(() => {});
  return result;
}

async function incrementDedupeCountUnsafe(fingerprint) {
  const { dedupeCounts = {} } = await chrome.storage.session.get('dedupeCounts');
  const updated = applyDedupeIncrement(dedupeCounts, fingerprint, DEDUPE_COUNT_CAP);
  await chrome.storage.session.set({ dedupeCounts: updated });
  return updated[fingerprint];
}
