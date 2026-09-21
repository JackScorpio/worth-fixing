// src/worker/classification.js
//
// Fingerprint-keyed classification cache, quiet-flush debounce, session
// cap, and the actual Jev API calls (retry/backoff, error handling).
// See BRIEF.md §7 for the full design this implements.

import {
  buildJevRequest,
  truncateState,
  parseNoulAnswer,
  parseChoiceAnswer,
  parseScoreAnswer,
  isConfident,
  bucketPriorityColor,
  applySilentBugPromotion,
} from '../lib/jev.js';

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-1.13.0';
const DEFAULT_SESSION_CAP = 200;
const QUIET_FLUSH_DELAY_MS = 1000;
const MAX_RETRY_ATTEMPTS = 3;

const QUESTIONS = {
  priority: {
    type: 'score',
    instructions: 'How urgently should the developer fix this?',
    criteria: [
      'Cosmetic or informational, safe to ignore',
      'Real issue but non-blocking, worth fixing before merge',
      'Breaks user-visible functionality, fix now',
    ],
  },
  origin: {
    type: 'choice',
    instructions: 'Where does this error originate?',
    criteria: {
      app_code: "The developer's own application code",
      third_party: 'A vendored library or external script',
      framework_noise: 'Dev-mode warning from React, Vite, or HMR tooling',
      browser_extension: 'Injected by another browser extension',
      backend: 'The frontend surfacing a server-side failure',
    },
  },
  silent_bug: {
    type: 'noul',
    instructions: 'Is this the kind of error that causes a real bug without any visible symptom in the UI?',
    criteria: {
      true: 'Likely to corrupt state, drop data, or misbehave invisibly',
      false: 'Either harmless, or would be obvious from looking at the page',
    },
  },
};

// Not yet buffering recent console history or related network requests
// (BRIEF §7's optional `recent_console`/`related_requests` state fields) —
// out of scope for this pass; message/stack/sourceFile/kind/page_url is
// enough to get real classification working end to end.
function buildState(record) {
  return {
    message: truncateState(record.message),
    stack: truncateState(record.stack),
    source_file: record.sourceFile,
    kind: record.kind,
    page_url: record.url,
  };
}

export async function getClassification(fingerprint) {
  const { classifications = {} } = await chrome.storage.local.get('classifications');
  return classifications[fingerprint] || null;
}

async function cacheClassification(fingerprint, classification) {
  const { classifications = {} } = await chrome.storage.local.get('classifications');
  classifications[fingerprint] = classification;
  await chrome.storage.local.set({ classifications });
}

async function isSessionCapReached() {
  const { sessionCap = DEFAULT_SESSION_CAP } = await chrome.storage.local.get('sessionCap');
  const { classificationCount = 0 } = await chrome.storage.session.get('classificationCount');
  return classificationCount >= sessionCap;
}

async function incrementSessionCount() {
  const { classificationCount = 0 } = await chrome.storage.session.get('classificationCount');
  await chrome.storage.session.set({ classificationCount: classificationCount + 1 });
}

async function notifyTabs(origin, fingerprint, classification) {
  const pattern = `${origin}/*`;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: pattern });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs
      .sendMessage(tab.id, { type: 'CLASSIFICATION_UPDATE', fingerprint, classification })
      .catch(() => {});
  }
}

function computeDisplayColor(priority, silentBug) {
  if (!priority || !isConfident(priority.confidence)) return null;
  const baseColor = bucketPriorityColor(priority);
  return applySilentBugPromotion(baseColor, silentBug ? silentBug.probability : undefined);
}

function computeMuted(origin) {
  if (!origin || !isConfident(origin.confidence)) return false;
  return origin.choice === 'framework_noise' || origin.choice === 'browser_extension';
}

async function classifyWithRetry(record) {
  const { jevApiKey } = await chrome.storage.local.get('jevApiKey');
  if (!jevApiKey) {
    console.warn('[web-error-monitor] no Jev API key configured; skipping classification');
    return null;
  }

  const requestBody = buildJevRequest({ state: buildState(record), model: JEV_MODEL, questions: QUESTIONS });

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jevApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      console.error('[web-error-monitor] Jev request failed to send', error);
      return null;
    }

    if (response.ok) {
      const json = await response.json();
      const priority = json.answers.priority ? parseScoreAnswer(json.answers.priority) : null;
      const origin = json.answers.origin ? parseChoiceAnswer(json.answers.origin) : null;
      const silentBug = json.answers.silent_bug ? parseNoulAnswer(json.answers.silent_bug) : null;
      return {
        priority,
        origin,
        silentBug,
        displayColor: computeDisplayColor(priority, silentBug),
        muted: computeMuted(origin),
        classifiedAt: Date.now(),
      };
    }

    if (response.status === 401) {
      console.error('[web-error-monitor] Jev API key rejected (401) — open the options page to fix it');
      await chrome.storage.local.set({ jevKeyInvalid: true });
      return null;
    }

    if (response.status === 422) {
      const body = await response.text().catch(() => '');
      console.error('[web-error-monitor] Jev request failed validation (422), not retrying', body);
      return null;
    }

    if (response.status === 429 || response.status === 529) {
      const delayMs = 500 * 2 ** attempt;
      console.warn(`[web-error-monitor] Jev rate-limited (${response.status}), retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    console.error(`[web-error-monitor] unexpected Jev response status ${response.status}`);
    return null;
  }

  console.error('[web-error-monitor] Jev request exhausted retries, degrading to unclassified');
  return null;
}

async function classifyAndNotify(fingerprint, record) {
  if (await isSessionCapReached()) {
    console.warn(`[web-error-monitor] session classification cap reached, skipping ${fingerprint}`);
    return;
  }
  await incrementSessionCount();

  const classification = await classifyWithRetry(record);
  if (!classification) return;

  await cacheClassification(fingerprint, classification);
  await notifyTabs(record.origin, fingerprint, classification);
}

let pendingFingerprints = new Map(); // fingerprint -> record
const inFlightFingerprints = new Set();
let flushTimer = null;

async function flush() {
  flushTimer = null;
  const entries = Array.from(pendingFingerprints.entries());
  pendingFingerprints = new Map();
  for (const [fingerprint] of entries) inFlightFingerprints.add(fingerprint);
  await Promise.all(entries.map(([fingerprint, record]) => classifyAndNotify(fingerprint, record)));
  for (const [fingerprint] of entries) inFlightFingerprints.delete(fingerprint);
}

export function queueForClassification(record) {
  if (inFlightFingerprints.has(record.fingerprint)) return;
  pendingFingerprints.set(record.fingerprint, record);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, QUIET_FLUSH_DELAY_MS);
}
