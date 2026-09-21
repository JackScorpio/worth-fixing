# Web Error Monitor — Phase 3a (Jev Classification Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up real Jev classification end-to-end — options page for the API key, the classification pipeline (fingerprint cache, quiet-flush debounce, session cap, retry/backoff), and just enough HUD awareness to show it working (classification-driven severity color, a muted section for framework noise, silent-bug promotion). The full dashboard redesign is a separate follow-up (Phase 3b) — this plan's HUD changes are additive to the existing pill+list design, not a rewrite.

**Architecture:** The worker stays the sole place that ever sees the API key (BRIEF §2/§3 — never in the repo, never sent to the page). `src/worker/capture.js` already computes a fingerprint per event; this plan adds `src/worker/classification.js`, which checks a `chrome.storage.local` cache keyed by fingerprint first (classify once, ever — BRIEF §7's dominant cost control), and for cache misses, buffers the fingerprint in an in-memory debounce queue that flushes ~1s after the last new arrival, firing one Jev request per distinct fingerprint concurrently (not merged into a single HTTP call — Jev's question primitives answer one state at a time, so "one batch" here means "fired together after quieting down," not "merged into one request"). A `chrome.storage.session` counter enforces the session cap. The pure request-building/response-parsing/confidence-gating/color-bucketing logic lives in `src/lib/jev.js` (ES module, unit-tested like the rest of `src/lib`) so `src/worker/classification.js` stays thin glue around `fetch`. The worker precomputes a final `displayColor` and `muted` boolean into the cached/sent classification object, so `src/hud/hud.js` (a classic script, can't import `src/lib/jev.js`) never needs any Jev-specific bucketing logic of its own — it just reads two plain fields with a `null`/`kind`-heuristic fallback, exactly like it already falls back today.

**Tech Stack:** Same zero-build-step vanilla JS. One new manifest permission (`host_permissions: ["https://api.typesafe.ai/*"]`, required for the worker's `fetch` calls to a third-party origin) and one new page (`src/options/options.html`, a normal top-level extension page — unlike content scripts, extension pages fully support `<script type="module">`, so `options.js` can import `src/lib/jev.js` directly).

**Spec:** [BRIEF.md](../../../BRIEF.md) §7 (Jev classification layer). Verified against the live TypeSafe docs during design (via the `typesafe:typesafe-ai` skill) on 2026-09-21: the endpoint, `Authorization: Bearer`, request/response shapes, and `jev-1.13.0` as a currently-valid pinned version (pinning is the vendor's own explicitly recommended practice for calibrated confidence thresholds — BRIEF's guidance to pin rather than use `jev-latest` is current and correct) all check out. `silent_bug` is a `noul` question and **has no confidence value** (confirmed against the live confidence docs) — BRIEF's confidence-gating rule only ever applied to `origin`/`priority` (both `choice`/`score`), so this is a confirmation, not a correction. The exact token/context-size ceiling for `state` is not published in the live docs as of this check — the plan still truncates defensively (BRIEF's own instruction), just without pinning an unverifiable exact number.

## Global Constraints

- **The API key must never be in the repo or the bundle.** Options page only, stored in `chrome.storage.local`. (BRIEF §2)
- **Pin `model: "jev-1.13.0"`, never `jev-latest`.** Verified current against live docs. (BRIEF §7)
- **State is text only, no images.** Truncate long stacks before sending (defensive; exact size ceiling unpublished). (BRIEF §7)
- **Confidence gates display, not just priority.** If `origin.confidence` or `priority.confidence` is below ~0.5, treat the classification as unusable for that purpose — the HUD must fall back to the raw `kind`-based display rather than show a low-confidence label. `silent_bug` (a `noul`) has no confidence field at all — never attempt to read one. (BRIEF §6/§7, confirmed against live docs)
- **Log the full `probabilities`/distribution and `confidence` alongside the verdict in `chrome.storage.local`, not just the final label.** (BRIEF §7)
- **Three cost/rate-control mechanisms, in priority order:** (1) fingerprint cache — classify once, ever; (2) quiet-flush debounce (~1s after the last new arrival); (3) session cap (default 200 classifications/session, configurable) — on hitting it, keep capturing/showing raw errors, stop calling the API. (BRIEF §7)
- **Error handling:** `401` → surface as invalid-key state, don't keep retrying with a known-bad key; `422` → log the offending response, don't retry; `429`/`529` → exponential backoff, degrade to unclassified display rather than dropping the underlying error. (BRIEF §7)
- **`origin: framework_noise | browser_extension` should collapse out of the way by default** rather than clutter the main list. (BRIEF §1/§7)
- **`silent_bug: true` should promote a row's visible priority** even at a moderate score — that's the tool's core reason for existing. (BRIEF §1/§5/§7)
- **No dashboard redesign in this plan.** The existing pill/list/row-detail structure from Phase 2 stays; this plan only makes its severity coloring and grouping classification-aware. (Scope boundary agreed in conversation — Phase 3b is the dashboard.)

---

## File Structure

```
src/
├── lib/
│   ├── jev.js             # pure: request building, response parsing, confidence gating,
│   │                       #       priority->color bucketing, silent-bug promotion
│   └── jev.test.js
├── options/
│   ├── options.html      # API key + session cap form, "Test key" button
│   ├── options.css
│   └── options.js        # imports src/lib/jev.js (ES module — options pages support this)
├── worker/
│   ├── classification.js  # NEW: cache, debounce, session cap, retry/backoff, fetch
│   └── capture.js         # MODIFY: call getClassification/queueForClassification from
│                            #         classification.js instead of the old inline stub
├── hud/
│   ├── hud.js              # MODIFY: classification-aware color, muted section,
│   │                        #         handle CLASSIFICATION_UPDATE
│   └── styles.js           # MODIFY: styling for the muted section
├── content.js               # MODIFY: relay CLASSIFICATION_UPDATE to the HUD
manifest.json                 # MODIFY: host_permissions + options_page
```

---

### Task 1: `src/lib/jev.js` — pure request/response/confidence logic

**Files:**
- Create: `src/lib/jev.js`
- Test: `src/lib/jev.test.js`

**Interfaces:**
- Produces: `truncateState(text, maxChars?)`, `buildJevRequest({state, model, questions})`, `parseNoulAnswer(answer)`, `parseChoiceAnswer(answer)`, `parseScoreAnswer(answer)`, `isConfident(confidence, threshold?)`, `bucketPriorityColor(scoreAnswer)` → `'red'|'amber'|'grey'|null`, `applySilentBugPromotion(color, silentBugProbability)` → possibly-bumped color. Consumed by Task 2 (`options.js`, `buildJevRequest` only) and Task 3 (`classification.js`, all of them).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/jev.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateState,
  buildJevRequest,
  isConfident,
  bucketPriorityColor,
  applySilentBugPromotion,
} from './jev.js';

test('truncateState leaves short text untouched', () => {
  assert.equal(truncateState('short'), 'short');
});

test('truncateState truncates long text with a marker', () => {
  const long = 'x'.repeat(25000);
  const result = truncateState(long);
  assert.ok(result.length < long.length);
  assert.ok(result.endsWith('[truncated]'));
});

test('buildJevRequest passes state/model/questions through unchanged', () => {
  const req = buildJevRequest({ state: 's', model: 'jev-1.13.0', questions: { q: {} } });
  assert.deepEqual(req, { state: 's', model: 'jev-1.13.0', questions: { q: {} } });
});

test('isConfident is true at and above the threshold', () => {
  assert.equal(isConfident(0.5), true);
  assert.equal(isConfident(0.51), true);
  assert.equal(isConfident(0.49), false);
});

test('isConfident treats a missing/non-numeric confidence as not confident', () => {
  assert.equal(isConfident(undefined), false);
  assert.equal(isConfident(null), false);
});

test('bucketPriorityColor uses the legend range when present', () => {
  const grey = bucketPriorityColor({ score: 0, legend: { 0: 'low', 1: 'mid', 2: 'high' } });
  const amber = bucketPriorityColor({ score: 1, legend: { 0: 'low', 1: 'mid', 2: 'high' } });
  const red = bucketPriorityColor({ score: 2, legend: { 0: 'low', 1: 'mid', 2: 'high' } });
  assert.equal(grey, 'grey');
  assert.equal(amber, 'amber');
  assert.equal(red, 'red');
});

test('bucketPriorityColor falls back to a 0-2 range without a usable legend', () => {
  assert.equal(bucketPriorityColor({ score: 0 }), 'grey');
  assert.equal(bucketPriorityColor({ score: 1 }), 'amber');
  assert.equal(bucketPriorityColor({ score: 2 }), 'red');
});

test('bucketPriorityColor returns null for a missing score', () => {
  assert.equal(bucketPriorityColor(null), null);
  assert.equal(bucketPriorityColor({}), null);
});

test('applySilentBugPromotion bumps grey to amber and amber to red', () => {
  assert.equal(applySilentBugPromotion('grey', 0.9), 'amber');
  assert.equal(applySilentBugPromotion('amber', 0.9), 'red');
});

test('applySilentBugPromotion caps at red', () => {
  assert.equal(applySilentBugPromotion('red', 0.9), 'red');
});

test('applySilentBugPromotion does not promote below the 0.5 probability', () => {
  assert.equal(applySilentBugPromotion('grey', 0.4), 'grey');
});

test('applySilentBugPromotion passes through a null color unchanged', () => {
  assert.equal(applySilentBugPromotion(null, 0.9), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test src/lib/jev.test.js
```

Expected: FAIL — `jev.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/jev.js

// The exact token/context-size ceiling for `state` is not published in
// TypeSafe's live docs as of this writing. Truncate defensively anyway
// (BRIEF's own instruction) rather than send an unbounded stack trace.
const MAX_STATE_CHARS = 20000;

export function truncateState(text, maxChars = MAX_STATE_CHARS) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function buildJevRequest({ state, model, questions }) {
  return { state, model, questions };
}

export function parseNoulAnswer(answer) {
  return { probability: answer.noul };
}

export function parseChoiceAnswer(answer) {
  return { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence };
}

export function parseScoreAnswer(answer) {
  return {
    score: answer.score,
    legend: answer.legend,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
  };
}

export function isConfident(confidence, threshold = 0.5) {
  return typeof confidence === 'number' && confidence >= threshold;
}

const SCORE_BAND_COLORS = ['grey', 'amber', 'red'];

export function bucketPriorityColor(scoreAnswer) {
  if (!scoreAnswer || typeof scoreAnswer.score !== 'number') return null;

  const levelKeys = scoreAnswer.legend
    ? Object.keys(scoreAnswer.legend)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
    : [];

  if (levelKeys.length >= 2) {
    const min = Math.min(...levelKeys);
    const max = Math.max(...levelKeys);
    const fraction = max === min ? 0 : (scoreAnswer.score - min) / (max - min);
    const index = Math.max(0, Math.min(SCORE_BAND_COLORS.length - 1, Math.floor(fraction * SCORE_BAND_COLORS.length)));
    return SCORE_BAND_COLORS[index];
  }

  // No usable legend range: fall back to assuming a 0-2 scale, matching
  // our 3-criteria priority question (see classification.js's QUESTIONS).
  const index = Math.max(0, Math.min(SCORE_BAND_COLORS.length - 1, Math.round(scoreAnswer.score)));
  return SCORE_BAND_COLORS[index];
}

const PROMOTION_ORDER = ['grey', 'amber', 'red'];

export function applySilentBugPromotion(color, silentBugProbability) {
  if (color == null) return color;
  if (typeof silentBugProbability !== 'number' || silentBugProbability <= 0.5) return color;
  const index = PROMOTION_ORDER.indexOf(color);
  if (index === -1) return color;
  return PROMOTION_ORDER[Math.min(index + 1, PROMOTION_ORDER.length - 1)];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test src/lib/jev.test.js
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full lib suite**

```bash
npm test
```

Expected: all tests pass (25 existing + 12 new = 37).

- [ ] **Step 6: Commit**

```bash
git add src/lib/jev.js src/lib/jev.test.js
git commit -m "Add pure Jev request/response/confidence-gating logic"
```

---

### Task 2: Options page + manifest permissions

**Files:**
- Modify: `manifest.json`
- Create: `src/options/options.html`
- Create: `src/options/options.css`
- Create: `src/options/options.js`

**Interfaces:**
- Consumes: `buildJevRequest` from `src/lib/jev.js` (Task 1).
- Produces: `chrome.storage.local` keys `jevApiKey` (string) and `sessionCap` (number, default 200).

- [ ] **Step 1: Update `manifest.json`**

Add `host_permissions` (new) and `options_page` (new). The full file becomes:

```json
{
  "manifest_version": 3,
  "name": "Web Error Monitor",
  "version": "0.1.0",
  "description": "Watches console and network activity for errors during local development.",
  "permissions": ["storage", "scripting", "activeTab"],
  "host_permissions": ["https://api.typesafe.ai/*"],
  "optional_host_permissions": ["*://*/*"],
  "background": {
    "service_worker": "src/worker.js",
    "type": "module"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-off-16.png",
      "48": "icons/icon-off-48.png",
      "128": "icons/icon-off-128.png"
    },
    "default_title": "Web Error Monitor (off for this site)"
  },
  "icons": {
    "16": "icons/icon-off-16.png",
    "48": "icons/icon-off-48.png",
    "128": "icons/icon-off-128.png"
  },
  "options_page": "src/options/options.html"
}
```

- [ ] **Step 2: Write `src/options/options.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Web Error Monitor — Settings</title>
  <link rel="stylesheet" href="options.css" />
</head>
<body>
  <h1>Web Error Monitor</h1>
  <p>
    Jev classification (Phase 3). Your API key is stored only in this
    browser's local extension storage — never in the repo, never sent
    anywhere except <code>api.typesafe.ai</code>.
  </p>

  <form id="settings-form">
    <label for="api-key">Jev API key</label>
    <input type="password" id="api-key" autocomplete="off" placeholder="sk-..." />

    <label for="session-cap">Session classification cap</label>
    <input type="number" id="session-cap" min="1" step="1" />

    <div class="actions">
      <button type="submit">Save</button>
      <button type="button" id="test-key-btn">Test key</button>
    </div>
    <p id="status" role="status"></p>
  </form>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `src/options/options.css`**

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-width: 480px;
  margin: 40px auto;
  padding: 0 16px;
  color: #1a1a1a;
}
h1 {
  font-size: 18px;
}
p {
  color: #555;
  font-size: 13px;
  line-height: 1.5;
}
label {
  display: block;
  margin-top: 16px;
  font-weight: 600;
  font-size: 13px;
}
input {
  width: 100%;
  padding: 8px;
  margin-top: 4px;
  box-sizing: border-box;
  font-size: 13px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
button {
  padding: 8px 16px;
  font-size: 13px;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: #f5f5f5;
  cursor: pointer;
}
button[type="submit"] {
  background: #2e7d32;
  color: white;
  border-color: #2e7d32;
}
#status {
  margin-top: 12px;
  font-size: 13px;
  color: #2e7d32;
  min-height: 18px;
}
```

- [ ] **Step 4: Write `src/options/options.js`**

```js
// src/options/options.js
import { buildJevRequest } from '../lib/jev.js';

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-1.13.0';
const DEFAULT_SESSION_CAP = 200;

const form = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key');
const sessionCapInput = document.getElementById('session-cap');
const testBtn = document.getElementById('test-key-btn');
const status = document.getElementById('status');

async function load() {
  const { jevApiKey, sessionCap } = await chrome.storage.local.get(['jevApiKey', 'sessionCap']);
  apiKeyInput.value = jevApiKey || '';
  sessionCapInput.value = sessionCap || DEFAULT_SESSION_CAP;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const jevApiKey = apiKeyInput.value.trim();
  const sessionCap = Number(sessionCapInput.value) || DEFAULT_SESSION_CAP;
  await chrome.storage.local.set({ jevApiKey, sessionCap, jevKeyInvalid: false });
  status.textContent = 'Saved.';
});

testBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    status.textContent = 'Enter a key first.';
    return;
  }
  status.textContent = 'Testing...';
  try {
    const body = buildJevRequest({
      state: 'ping',
      model: JEV_MODEL,
      questions: {
        ping: {
          type: 'noul',
          instructions: 'Does the state say "ping"?',
          criteria: { true: 'the state is exactly "ping"', false: 'the state is anything else' },
        },
      },
    });
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      status.textContent = 'Invalid API key.';
      return;
    }
    if (!response.ok) {
      status.textContent = `Unexpected response: ${response.status}`;
      return;
    }
    status.textContent = 'Key works.';
  } catch (error) {
    status.textContent = `Request failed: ${error.message}`;
  }
});

load();
```

- [ ] **Step 5: Syntax-check**

```bash
node --check src/options/options.js
```

Expected: no output. (`options.html`/`.css` have no automated check; visually verified in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add manifest.json src/options/
git commit -m "Add options page for the Jev API key and session cap"
```

---

### Task 3: `src/worker/classification.js` — cache, debounce, session cap, retry/backoff

**Files:**
- Create: `src/worker/classification.js`
- Modify: `src/worker/capture.js`

**Interfaces:**
- Consumes: everything from `src/lib/jev.js` (Task 1).
- Produces: `getClassification(fingerprint)` (async, returns cached classification or `null`), `queueForClassification(record)` (fire-and-forget, kicks off the debounced pipeline for a cache-miss). Consumed by `capture.js` in this same task. Also produces the `{type: 'CLASSIFICATION_UPDATE', fingerprint, classification}` message sent via `chrome.tabs.sendMessage`, consumed by Task 4 (`content.js`).
- The `classification` object shape (both cached and sent): `{ priority, origin, silentBug, displayColor, muted, classifiedAt }` where `priority`/`origin`/`silentBug` are the parsed Answer shapes from `src/lib/jev.js`, and `displayColor`/`muted` are precomputed by this file so the HUD (a classic script, can't import `src/lib/jev.js`) never needs Jev-specific bucketing logic.

- [ ] **Step 1: Write `src/worker/classification.js`**

```js
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
```

- [ ] **Step 2: Update `src/worker/capture.js`**

Remove the old inline stub and wire in the real pipeline. Change the import block from:

```js
import { computeFingerprint } from '../lib/fingerprint.js';
import { sourceFileFromStack } from '../lib/stack.js';
import { applyDedupeIncrement } from '../lib/dedupe.js';
import { isOriginEnabled } from './injection.js';
```

to:

```js
import { computeFingerprint } from '../lib/fingerprint.js';
import { sourceFileFromStack } from '../lib/stack.js';
import { applyDedupeIncrement } from '../lib/dedupe.js';
import { isOriginEnabled } from './injection.js';
import { getClassification, queueForClassification } from './classification.js';
```

Then replace the tail of `handleCaptureEvent` — find:

```js
  const count = await incrementDedupeCount(fingerprint);
  console.log(`[web-error-monitor] ${record.kind} (x${count}) fp=${fingerprint}`, record);

  const classification = await getClassification(fingerprint);
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

async function getClassification(fingerprint) {
  // Phase 3 will look this up in a chrome.storage.local `classifications`
  // cache keyed by fingerprint (BRIEF §7: "classified exactly once, ever").
  // No classification exists yet — always null. The HUD already knows how
  // to render a record with no classification via its kind-based severity
  // fallback, so this is a placeholder that needs no caller changes when
  // Phase 3 fills it in.
  return null;
}
```

and replace it with:

```js
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
```

(Everything else in `capture.js` — the dedupe mutex, `incrementDedupeCount`, `DEDUPE_COUNT_CAP` — is unchanged.)

- [ ] **Step 3: Syntax-check**

```bash
node --check src/worker/classification.js
node --check src/worker/capture.js
```

Expected: no output.

- [ ] **Step 4: Run the full lib suite** (regression check — this task doesn't touch `src/lib`)

```bash
npm test
```

Expected: all 37 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/worker/classification.js src/worker/capture.js
git commit -m "Add Jev classification pipeline: cache, debounce, session cap, retry/backoff"
```

---

### Task 4: HUD — classification-aware color, muted section, CLASSIFICATION_UPDATE

**Files:**
- Modify: `src/content.js`
- Modify: `src/hud/hud.js`
- Modify: `src/hud/styles.js`

**Interfaces:**
- Consumes: `{type: 'CLASSIFICATION_UPDATE', fingerprint, classification}` from Task 3.
- Produces: `window.__webErrorMonitorHud.updateClassification(fingerprint, classification)` (new public API method).

- [ ] **Step 1: Update `src/content.js`**

Add a `CLASSIFICATION_UPDATE` branch to the existing `onMessage` listener. Change:

```js
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'TEARDOWN') {
      window.postMessage({ source: TAG, type: 'TEARDOWN' }, window.location.origin);
      window.__webErrorMonitorHud.teardown();
    } else if (message.type === 'RECORD') {
      window.__webErrorMonitorHud.render(message.record);
    }
  });
```

to:

```js
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'TEARDOWN') {
      window.postMessage({ source: TAG, type: 'TEARDOWN' }, window.location.origin);
      window.__webErrorMonitorHud.teardown();
    } else if (message.type === 'RECORD') {
      window.__webErrorMonitorHud.render(message.record);
    } else if (message.type === 'CLASSIFICATION_UPDATE') {
      window.__webErrorMonitorHud.updateClassification(message.fingerprint, message.classification);
    }
  });
```

- [ ] **Step 2: Update `src/hud/hud.js`**

Three changes: (a) severity color reads `classification.displayColor` first, falling back to the existing `kind`-based heuristic when absent; (b) rows split into a main list and a collapsed "Muted" section based on `classification.muted`; (c) a new `updateClassification` method.

Rename the existing `severityColor` function to make room for the classification-aware wrapper, and add the new logic. Change:

```js
  function severityColor(kind) {
    if (kind === 'uncaught' || kind === 'unhandledrejection' || kind === 'network') return 'red';
    if (kind === 'console.error') return 'amber';
    return 'grey';
  }
```

to:

```js
  function kindColor(kind) {
    if (kind === 'uncaught' || kind === 'unhandledrejection' || kind === 'network') return 'red';
    if (kind === 'console.error') return 'amber';
    return 'grey';
  }

  // classification.displayColor is precomputed worker-side (src/worker/classification.js)
  // from the raw Jev answers — this file never does Jev-specific bucketing itself,
  // since it's a classic script and can't import src/lib/jev.js's ES module exports.
  function severityColor(record) {
    return record.classification?.displayColor || kindColor(record.kind);
  }

  function isMuted(record) {
    return !!record.classification?.muted;
  }
```

Every existing call site of `severityColor(record.kind)` or `severityColor(kind)` must change to pass the whole `record` instead of just `record.kind`. There are two such call sites in the current file — in `renderCounts()` and in `buildRow()`. Update `renderCounts()` from:

```js
  function renderCounts() {
    let red = 0;
    let amber = 0;
    let grey = 0;
    for (const { record } of groups.values()) {
      const color = severityColor(record.kind);
      if (color === 'red') red++;
      else if (color === 'amber') amber++;
      else grey++;
    }
    els.countRed.textContent = String(red);
    els.countAmber.textContent = String(amber);
    els.countGrey.textContent = String(grey);
  }
```

to (also excluding muted entries from the counts, since they're meant to collapse out of the way):

```js
  function renderCounts() {
    let red = 0;
    let amber = 0;
    let grey = 0;
    for (const { record } of groups.values()) {
      if (isMuted(record)) continue;
      const color = severityColor(record);
      if (color === 'red') red++;
      else if (color === 'amber') amber++;
      else grey++;
    }
    els.countRed.textContent = String(red);
    els.countAmber.textContent = String(amber);
    els.countGrey.textContent = String(grey);
  }
```

Update `buildRow()`'s dot-color line from:

```js
    const dot = document.createElement('span');
    dot.className = `wem-dot wem-dot-${severityColor(record.kind)}`;
```

to:

```js
    const dot = document.createElement('span');
    dot.className = `wem-dot wem-dot-${severityColor(record)}`;
```

Now split `renderList()` into a main list and a muted section. Replace:

```js
  function renderList() {
    els.list.replaceChildren();
    const entries = Array.from(groups.entries()).sort(
      (a, b) => b[1].record.timestamp - a[1].record.timestamp
    );
    for (const [fingerprint, entry] of entries) {
      els.list.appendChild(buildRow(fingerprint, entry));
    }
  }
```

with:

```js
  function renderList() {
    els.list.replaceChildren();
    const entries = Array.from(groups.entries()).sort(
      (a, b) => b[1].record.timestamp - a[1].record.timestamp
    );
    const mainEntries = entries.filter(([, entry]) => !isMuted(entry.record));
    const mutedEntries = entries.filter(([, entry]) => isMuted(entry.record));

    for (const [fingerprint, entry] of mainEntries) {
      els.list.appendChild(buildRow(fingerprint, entry));
    }

    if (mutedEntries.length > 0) {
      els.list.appendChild(buildMutedSection(mutedEntries));
    }
  }

  function buildMutedSection(mutedEntries) {
    const section = document.createElement('div');
    section.className = 'wem-muted-section';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wem-muted-toggle';
    toggle.textContent = `Muted (framework noise) ×${mutedEntries.length}`;

    const list = document.createElement('div');
    list.className = 'wem-muted-list';
    list.hidden = true;
    for (const [fingerprint, entry] of mutedEntries) {
      list.appendChild(buildRow(fingerprint, entry));
    }

    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
    });

    section.append(toggle, list);
    return section;
  }
```

Now add `updateClassification` next to the existing `render`/`clear` functions. Change:

```js
  function render(record) {
    if (!els) return;
    const existing = groups.get(record.fingerprint);
    groups.set(record.fingerprint, {
      record,
      count: (existing ? existing.count : 0) + 1,
      expanded: existing ? existing.expanded : false,
    });
    renderCounts();
    renderList();
  }
```

to (unchanged, but add the new function directly after it):

```js
  function render(record) {
    if (!els) return;
    const existing = groups.get(record.fingerprint);
    groups.set(record.fingerprint, {
      record,
      count: (existing ? existing.count : 0) + 1,
      expanded: existing ? existing.expanded : false,
    });
    renderCounts();
    renderList();
  }

  function updateClassification(fingerprint, classification) {
    if (!els) return;
    const entry = groups.get(fingerprint);
    if (!entry) return; // the row may have been cleared before classification arrived
    entry.record = { ...entry.record, classification };
    renderCounts();
    renderList();
  }
```

Finally, expose it in the public API. Change:

```js
  window.__webErrorMonitorHud = { init, render, clear, teardown };
```

to:

```js
  window.__webErrorMonitorHud = { init, render, clear, teardown, updateClassification };
```

- [ ] **Step 3: Update `src/hud/styles.js`**

Add styling for the muted section, matching the existing quiet/dark aesthetic. Add after the existing `.wem-row-detail` rule:

```css
  .wem-muted-section {
    margin-top: 4px;
  }
  .wem-muted-toggle {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 11px;
    padding: 6px 10px;
  }
  .wem-muted-list {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
```

- [ ] **Step 4: Syntax-check**

```bash
node --check src/content.js
node --check src/hud/hud.js
node --check src/hud/styles.js
```

Expected: no output.

- [ ] **Step 5: Controller-run live smoke test (no extension loading needed, no real API key needed)**

Mirrors Phase 2 Task 1's smoke test approach — page-context injection with a `chrome.storage` stub, feeding `render()`/`updateClassification()` synthetic data (no live Jev call involved, so no API key needed for this step):

1. Serve `dev/test-page.html`, inject `styles.js` + `hud.js` with a `chrome.storage.local`/`.session` stub (as in prior smoke tests).
2. Call `hud.init(origin)`, then `hud.render({...})` for two records: one with `classification: null` (should show kind-based color, main list) and one with `classification: {displayColor: 'red', muted: false}` (should show red regardless of kind).
3. Call `hud.render({...})` for a third record with `classification: {muted: true}` — confirm it does NOT appear in the main list or the pill's counts, and instead appears under a "Muted (framework noise) ×1" toggle that expands on click.
4. Call `hud.updateClassification(fingerprintOfRecord1, {displayColor: 'amber', muted: false})` — confirm that row's dot color updates to amber without needing a fresh `render()` call.

Report any mismatch before proceeding to Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/content.js src/hud/hud.js src/hud/styles.js
git commit -m "Make the HUD classification-aware: color, muted section, live updates"
```

---

### Task 5: Manual end-to-end verification with a real Jev API key

**Files:** none (verification only; may produce fixup commits if something's broken)

This task needs your real Jev API key entered through the options page — never share it in chat; enter it directly in the browser.

- [ ] **Step 1: Reload the unpacked extension**

`chrome://extensions` → reload "Web Error Monitor". Confirm no manifest errors (the new `host_permissions` and `options_page` entries should load cleanly).

- [ ] **Step 2: Open the options page and enter your key**

Right-click the toolbar icon → "Options" (or `chrome://extensions` → "Details" → "Extension options"). Enter your Jev API key, click "Test key" — confirm it reports success. Adjust the session cap if you want something other than 200 for testing. Click "Save".

- [ ] **Step 3: Trigger real classifications**

Serve and enable the extension on `dev/test-page.html` (or better, a real app you have open, to get realistic errors). Trigger a few different error kinds. Watch the service worker console (`chrome://extensions` → "Inspect views: service worker") for `[web-error-monitor]` logs — you should see the existing capture logs, and within ~1-2 seconds after each new (uncached) fingerprint, no errors from the classification path.

- [ ] **Step 4: Verify classification reaches the HUD**

Confirm the HUD's dot colors update after that ~1s delay for at least one triggered error (going from the initial kind-based color to whatever Jev's `priority` classification produced). If BRIEF's assumed 0-2 score range from Task 1 turns out to be wrong once you see real `legend`/`score` values in the service worker console's logged responses, note the actual shape here — `bucketPriorityColor`'s legend-based branch should already handle it correctly, but confirm.

- [ ] **Step 5: Verify the muted section**

Trigger a framework-noise-shaped warning (e.g., a React key warning, an HMR message, or anything Jev would plausibly classify as `framework_noise`/`browser_extension`) and confirm it lands in the collapsed "Muted" section rather than the main list.

- [ ] **Step 6: Verify the fingerprint cache**

Reload the page and re-trigger the same error. Confirm the HUD shows the classified color **immediately** this time (no ~1s delay) — proof the cache hit skipped a second Jev call. Cross-check in the service worker console: no new classification-related log line for that fingerprint on the second trigger.

- [ ] **Step 7: Verify 401 handling**

Temporarily change the saved API key to something invalid (via the options page), trigger a new (uncached) error, and confirm the service worker console logs the 401 message rather than crashing or retrying forever. Restore the real key afterward.

- [ ] **Step 8: Run the full automated test suite one more time**

```bash
npm test
```

Expected: all 37 tests pass.

- [ ] **Step 9: Final commit**

```bash
git add -A
git status
git commit -m "Complete Phase 3a: Jev classification pipeline" --allow-empty
```

---

## Definition of Done

Entering a real Jev API key via the options page and triggering errors on an enabled origin results in: raw errors appearing immediately in the HUD (as before), classification arriving asynchronously and updating the row's color, `framework_noise`/`browser_extension`-classified errors collapsing into a muted section, repeat occurrences of an already-classified fingerprint skipping a second API call, and 401/422/429/529 responses degrading gracefully rather than crashing the pipeline or spamming retries. No dashboard redesign — that's Phase 3b.
