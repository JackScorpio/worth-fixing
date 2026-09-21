# Web Error Monitor — Phase 3b v1 (Dashboard Tabs, Cost Tracking, Jev Detail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing single-list HUD into a small dashboard: three tabs (Needs attention / All / Muted, defaulting to Needs attention), a live global session cost/token badge in the header, and an inline drill-down that shows Jev's actual classification answers instead of just the summary color dot. This is the first shippable slice of the dashboard redesign — charts (origin donut, spend-over-time bars) are explicitly deferred to a later plan.

**Architecture:** A new pure module `src/lib/usage.js` holds cost/token math and display formatting (tested with `node --test`, same pattern as `src/lib/jev.js`). A new worker module `src/worker/usage.js` appends one entry per successful Jev classification to a `chrome.storage.session` log (global across all monitored origins, resets with the browser session — same scoping as the existing `sessionCap` counter), broadcasts the running total to every open tab, and answers an on-demand summary request. `src/worker/classification.js` gains one line calling into it. The HUD (`src/hud/hud.js`, a classic script) gains tab state and a `needsAttention` predicate computed purely from data it already holds in memory (`record.classification`), plus a header badge fed by the two new message types — no new Jev-specific bucketing logic in the HUD, same principle Phase 3a already established for `displayColor`/`muted`.

**Tech Stack:** Same zero-build-step vanilla JS as the rest of the extension. No new manifest permissions or files outside `src/lib/`, `src/worker/`, and `src/hud/`.

**Spec:** [2026-09-21-web-error-monitor-phase3b-dashboard-v1-design.md](../specs/2026-09-21-web-error-monitor-phase3b-dashboard-v1-design.md)

## Global Constraints

- **Cost tracking is global** (all monitored origins, current browser session), not per-origin. Resets when the service worker restarts or the browser closes.
- **Cost formula:** `costUsd = inputTokens / 1_000_000 * 0.042`. Output tokens are free — never include `output_tokens` in the cost calculation. (Confirmed real Jev 1.13 pricing.)
- **`usage.js` (both the lib and worker versions) must never throw.** A missing/malformed `usage` field in a Jev response is a silent no-op, matching `classification.js`'s existing "never throw, degrade gracefully" contract — usage recording must never take down a classification that already succeeded.
- **No new content-script files.** Charts (which would justify a `src/hud/charts.js` split) are out of scope for this plan; all HUD changes stay in the existing `src/hud/hud.js` / `src/hud/styles.js`.
- **`needs attention` = red or amber priority, OR grey/no priority with silent-bug probability > 0.5** (excluding anything already muted). The `> 0.5` threshold matches the existing threshold in `src/lib/jev.js`'s `applySilentBugPromotion`, for consistency.
- **Drill-down is inline-expand** (extends the existing per-row expand pattern), not a separate detail view.

---

## File Structure

```
src/
├── lib/
│   ├── usage.js            # NEW: pure cost/token math + display formatting
│   └── usage.test.js       # NEW
├── worker/
│   ├── usage.js             # NEW: usageLog storage, mutex, recordUsage, getUsageSummary,
│   │                          #      GET_USAGE listener, USAGE_UPDATE broadcast
│   └── classification.js    # MODIFY: call recordUsage(json.usage) on a successful response
├── hud/
│   ├── hud.js                # MODIFY: tabs (needsAttention/all/muted) replacing the single
│   │                           #         list + muted section; cost badge; Jev-answer drill-down
│   └── styles.js             # MODIFY: tab bar, cost badge, and drill-down answer row CSS;
│                               #         remove the now-superseded muted-section CSS
├── content.js                  # MODIFY: relay USAGE_UPDATE to the HUD
worker.js                       # MODIFY: import './worker/usage.js'
```

---

### Task 1: `src/lib/usage.js` — pure cost/token math and formatting

**Files:**
- Create: `src/lib/usage.js`
- Test: `src/lib/usage.test.js`

**Interfaces:**
- Produces: `COST_PER_MILLION_INPUT_TOKENS_USD` (constant), `computeCostUsd(inputTokens)` → number, `sumInputTokens(usageLog)` → number, `formatCostUsd(costUsd)` → string, `formatTokenCount(tokens)` → string. Consumed by Task 2 (`src/worker/usage.js`).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/usage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostUsd, sumInputTokens, formatCostUsd, formatTokenCount } from './usage.js';

test('computeCostUsd is zero for zero tokens', () => {
  assert.equal(computeCostUsd(0), 0);
});

test('computeCostUsd is exactly the per-million rate at one million tokens', () => {
  assert.equal(computeCostUsd(1_000_000), 0.042);
});

test('computeCostUsd scales linearly below one million tokens', () => {
  // 620 input tokens, matching a real Jev response seen during Phase 3a
  // live testing: 620 / 1_000_000 * 0.042
  const result = computeCostUsd(620);
  assert.ok(Math.abs(result - 0.02604 / 1000) < 1e-9, `got ${result}`);
});

test('sumInputTokens is zero for an empty log', () => {
  assert.equal(sumInputTokens([]), 0);
});

test('sumInputTokens adds inputTokens across entries, ignoring other fields', () => {
  const log = [
    { timestamp: 1, inputTokens: 100 },
    { timestamp: 2, inputTokens: 250 },
  ];
  assert.equal(sumInputTokens(log), 350);
});

test('formatCostUsd shows 4 decimal places', () => {
  assert.equal(formatCostUsd(0), '$0.0000');
  assert.equal(formatCostUsd(0.021), '$0.0210');
});

test('formatCostUsd rounds the 4th decimal place', () => {
  assert.equal(formatCostUsd(0.00126), '$0.0013');
});

test('formatTokenCount shows raw numbers under 1000', () => {
  assert.equal(formatTokenCount(0), '0 tok');
  assert.equal(formatTokenCount(999), '999 tok');
});

test('formatTokenCount shows one decimal of thousands at and above 1000', () => {
  assert.equal(formatTokenCount(1000), '1.0k tok');
  assert.equal(formatTokenCount(1234), '1.2k tok');
  assert.equal(formatTokenCount(340000), '340.0k tok');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test src/lib/usage.test.js
```

Expected: FAIL — `usage.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/usage.js

export const COST_PER_MILLION_INPUT_TOKENS_USD = 0.042;

export function computeCostUsd(inputTokens) {
  return (inputTokens / 1_000_000) * COST_PER_MILLION_INPUT_TOKENS_USD;
}

export function sumInputTokens(usageLog) {
  return usageLog.reduce((total, entry) => total + entry.inputTokens, 0);
}

export function formatCostUsd(costUsd) {
  // 4 decimal places: at real Jev pricing, a single classification costs a
  // few thousandths of a cent, so 2-3 decimals would show "$0.00" for most
  // of a normal session.
  return `$${costUsd.toFixed(4)}`;
}

export function formatTokenCount(tokens) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test src/lib/usage.test.js
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full lib suite**

```bash
npm test
```

Expected: all existing tests still pass, plus the 9 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/usage.js src/lib/usage.test.js
git commit -m "Add pure Jev cost/token math and display formatting"
```

---

### Task 2: `src/worker/usage.js` — session usage log, broadcast, on-demand summary

**Files:**
- Create: `src/worker/usage.js`
- Modify: `src/worker/classification.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `computeCostUsd`, `sumInputTokens`, `formatCostUsd`, `formatTokenCount` from `src/lib/usage.js` (Task 1).
- Produces: `recordUsage(usage)` (fire-and-forget, called by `classification.js`), `getUsageSummary()` (async, returns `{ totalCostUsd, totalInputTokens, costLabel, tokenLabel }`). Also produces the `{ type: 'USAGE_UPDATE', totalCostUsd, totalInputTokens, costLabel, tokenLabel }` broadcast message and answers `{ type: 'GET_USAGE' }` requests with the same four fields — both consumed by Task 4 (`hud.js`/`content.js`).

- [ ] **Step 1: Write `src/worker/usage.js`**

```js
// src/worker/usage.js
//
// Global (all-origins), session-scoped tracking of Jev API spend. See
// docs/superpowers/specs/2026-09-21-web-error-monitor-phase3b-dashboard-v1-design.md.

import { computeCostUsd, sumInputTokens, formatCostUsd, formatTokenCount } from '../lib/usage.js';

// Module-scope mutex serializing read-modify-write access to the
// `usageLog` key in chrome.storage.session. Mirrors classification.js's
// cacheQueue/sessionCountQueue pattern: classification.js's flush() can
// resolve several classifications concurrently in one debounce batch,
// each calling recordUsage — without serializing, two calls finishing
// around the same time could both read the same stale log and the later
// write would clobber the earlier entry.
let usageQueue = Promise.resolve();

export function recordUsage(usage) {
  if (!usage || typeof usage.input_tokens !== 'number') return Promise.resolve();
  const result = usageQueue.then(() => recordUsageUnsafe(usage.input_tokens));
  // Swallow rejections in the chain itself so one failed call doesn't
  // permanently wedge the queue for subsequent calls.
  usageQueue = result.catch(() => {});
  return result;
}

async function recordUsageUnsafe(inputTokens) {
  const { usageLog = [] } = await chrome.storage.session.get('usageLog');
  usageLog.push({ timestamp: Date.now(), inputTokens });
  await chrome.storage.session.set({ usageLog });
  await broadcastUsage(usageLog);
}

export async function getUsageSummary() {
  const { usageLog = [] } = await chrome.storage.session.get('usageLog');
  return summarize(usageLog);
}

function summarize(usageLog) {
  const totalInputTokens = sumInputTokens(usageLog);
  const totalCostUsd = computeCostUsd(totalInputTokens);
  return {
    totalCostUsd,
    totalInputTokens,
    costLabel: formatCostUsd(totalCostUsd),
    tokenLabel: formatTokenCount(totalInputTokens),
  };
}

async function broadcastUsage(usageLog) {
  const summary = summarize(usageLog);
  // Unlike classification.js's notifyTabs (origin-filtered — a
  // classification only matters to tabs on that origin), cost is global:
  // every tab with the HUD installed needs to see it, regardless of which
  // origin's error actually triggered this classification.
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'USAGE_UPDATE', ...summary }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'GET_USAGE') return false;
  getUsageSummary().then(sendResponse);
  return true; // keep the channel open for the async sendResponse above
});
```

- [ ] **Step 2: Wire `recordUsage` into `src/worker/classification.js`**

Add the import. Find:

```js
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
```

Replace with:

```js
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
import { recordUsage } from './usage.js';
```

Then record usage right after a successful response is parsed. Find:

```js
    if (response.ok) {
      const json = await response.json();
      // Default to {} so a malformed/unexpected-shape 2xx response (e.g.
      // missing `answers` entirely) degrades to a null classification
      // instead of throwing — matching this pipeline's "never throw,
      // degrade to null" contract.
      const answers = json.answers || {};
      const priority = answers.priority ? parseScoreAnswer(answers.priority) : null;
      const origin = answers.origin ? parseChoiceAnswer(answers.origin) : null;
      const silentBug = answers.silent_bug ? parseNoulAnswer(answers.silent_bug) : null;
      return {
        priority,
        origin,
        silentBug,
        displayColor: computeDisplayColor(priority, silentBug),
        muted: computeMuted(origin),
        classifiedAt: Date.now(),
      };
    }
```

Replace with:

```js
    if (response.ok) {
      const json = await response.json();
      // Default to {} so a malformed/unexpected-shape 2xx response (e.g.
      // missing `answers` entirely) degrades to a null classification
      // instead of throwing — matching this pipeline's "never throw,
      // degrade to null" contract.
      const answers = json.answers || {};
      const priority = answers.priority ? parseScoreAnswer(answers.priority) : null;
      const origin = answers.origin ? parseChoiceAnswer(answers.origin) : null;
      const silentBug = answers.silent_bug ? parseNoulAnswer(answers.silent_bug) : null;
      // Fire-and-forget, same as the classification itself never blocking
      // on a cache write it doesn't need to wait for. recordUsage no-ops
      // silently if `usage` is missing/malformed (see usage.js).
      if (json.usage) recordUsage(json.usage);
      return {
        priority,
        origin,
        silentBug,
        displayColor: computeDisplayColor(priority, silentBug),
        muted: computeMuted(origin),
        classifiedAt: Date.now(),
      };
    }
```

- [ ] **Step 3: Import `usage.js` in `src/worker.js`**

Find:

```js
// src/worker.js
//
// Entry point — see src/worker/injection.js (per-origin toggle) and
// src/worker/capture.js (capture -> fingerprint -> dedupe -> RECORD relay).
import './worker/injection.js';
import './worker/capture.js';
```

Replace with:

```js
// src/worker.js
//
// Entry point — see src/worker/injection.js (per-origin toggle),
// src/worker/capture.js (capture -> fingerprint -> dedupe -> RECORD relay),
// and src/worker/usage.js (Jev spend tracking).
import './worker/injection.js';
import './worker/capture.js';
import './worker/usage.js';
```

- [ ] **Step 4: Syntax-check**

```bash
node --check src/worker/usage.js
node --check src/worker/classification.js
node --check src/worker.js
```

Expected: no output.

- [ ] **Step 5: Run the full lib suite** (regression check — this task doesn't touch `src/lib`)

```bash
npm test
```

Expected: all tests still pass (unchanged count from Task 1's total).

- [ ] **Step 6: Smoke test against a stubbed `chrome.*`**

`usage.js` has no `node --test` coverage (it's `chrome.*` glue, same reasoning as `classification.js`) — verify it directly with a throwaway Node script, the same technique already used to verify `classification.js`'s failure-handling fixes:

```js
// scratch script (not part of the repo) — stub chrome.storage.session,
// chrome.tabs, chrome.runtime, then:
import assert from 'node:assert/strict';
globalThis.chrome = { /* storage.session.get/set, tabs.query returning [],
  runtime.onMessage.addListener capturing the listener for a manual call */ };
const { recordUsage, getUsageSummary } = await import('/absolute/path/to/src/worker/usage.js');

// 1. Empty session: getUsageSummary() returns all-zero fields with the
//    exact zero-value labels from Task 1 ('$0.0000', '0 tok').
// 2. recordUsage({ input_tokens: 620 }) then getUsageSummary(): totalInputTokens
//    === 620, totalCostUsd matches computeCostUsd(620).
// 3. recordUsage(undefined) and recordUsage({}) (malformed): must not throw,
//    and must not change the total from step 2.
// 4. Two concurrent recordUsage calls (fire both without awaiting the first)
//    both land — final totalInputTokens is the sum of both, not just one
//    (proves the mutex isn't losing an update).
```

Run it (`node <scratch-script-path>`) and confirm all four checks pass before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/worker/usage.js src/worker/classification.js src/worker.js
git commit -m "Track global session Jev spend: usage log, broadcast, on-demand summary"
```

---

### Task 3: HUD tabs (Needs attention / All / Muted), replacing the single list + muted section

**Files:**
- Modify: `src/hud/hud.js`
- Modify: `src/hud/styles.js`

**Interfaces:**
- Consumes: `record.classification` shape from Phase 3a (`{ priority, origin, silentBug, displayColor, muted, classifiedAt }` or a failure marker `{ failed: true, terminal, failedAt }`, or `null`) — unchanged by this task.
- Produces: module-scope `activeTab` state and a `needsAttention(record)` predicate, both used internally; no new public `window.__webErrorMonitorHud` methods yet (Task 4 adds `updateUsage`).

- [ ] **Step 1: Remove the muted-section state, add tab state**

Find:

```js
  let hostEl = null;
  let shadowRoot = null;
  let els = null; // { pill, countRed, countAmber, countGrey, panel, list }
  let groups = new Map(); // fingerprint -> { record, count }
  let collapsed = true;
  let mutedSectionExpanded = false;
  let currentOrigin = null;
```

Replace with:

```js
  let hostEl = null;
  let shadowRoot = null;
  let els = null; // { pill, countRed, countAmber, countGrey, panel, list, tabButtons }
  let groups = new Map(); // fingerprint -> { record, count }
  let collapsed = true;
  let activeTab = 'needsAttention'; // 'needsAttention' | 'all' | 'muted'
  let currentOrigin = null;
```

- [ ] **Step 2: Add the `needsAttention` predicate next to `isMuted`**

Find:

```js
  function isMuted(record) {
    return !!record.classification?.muted;
  }
```

Replace with:

```js
  function isMuted(record) {
    return !!record.classification?.muted;
  }

  function needsAttention(record) {
    if (isMuted(record)) return false;
    const color = severityColor(record);
    if (color === 'red' || color === 'amber') return true;
    const silentProb = record.classification?.silentBug?.probability;
    return typeof silentProb === 'number' && silentProb > 0.5;
  }
```

- [ ] **Step 3: Add the tab bar to `buildDom()`**

Find:

```js
    const list = document.createElement('div');
    list.className = 'wem-list';

    panel.append(header, list);
```

Replace with:

```js
    const tabsEl = document.createElement('div');
    tabsEl.className = 'wem-tabs';
    const tabButtons = {
      needsAttention: document.createElement('button'),
      all: document.createElement('button'),
      muted: document.createElement('button'),
    };
    for (const [tab, btn] of Object.entries(tabButtons)) {
      btn.type = 'button';
      btn.className = 'wem-tab';
      btn.addEventListener('click', () => setActiveTab(tab));
      tabsEl.appendChild(btn);
    }

    const list = document.createElement('div');
    list.className = 'wem-list';

    panel.append(header, tabsEl, list);
```

And find:

```js
    els = { pill, countRed, countAmber, countGrey, panel, list };
```

Replace with:

```js
    els = { pill, countRed, countAmber, countGrey, panel, list, tabButtons };
```

- [ ] **Step 4: Add `setActiveTab`/`applyActiveTabStyle` and tab-aware counting**

Find:

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

Replace with:

```js
  const TAB_LABELS = { needsAttention: 'Needs attention', all: 'All', muted: 'Muted' };

  function setActiveTab(tab) {
    activeTab = tab;
    applyActiveTabStyle();
    renderList();
  }

  function applyActiveTabStyle() {
    if (!els) return;
    for (const [tab, btn] of Object.entries(els.tabButtons)) {
      btn.classList.toggle('wem-tab-active', tab === activeTab);
    }
  }

  function renderCounts() {
    let red = 0;
    let amber = 0;
    let grey = 0;
    let needsAttentionCount = 0;
    let mutedCount = 0;
    for (const { record } of groups.values()) {
      if (isMuted(record)) {
        mutedCount++;
        continue;
      }
      const color = severityColor(record);
      if (color === 'red') red++;
      else if (color === 'amber') amber++;
      else grey++;
      if (needsAttention(record)) needsAttentionCount++;
    }
    els.countRed.textContent = String(red);
    els.countAmber.textContent = String(amber);
    els.countGrey.textContent = String(grey);

    els.tabButtons.needsAttention.textContent = `${TAB_LABELS.needsAttention} (${needsAttentionCount})`;
    els.tabButtons.all.textContent = `${TAB_LABELS.all} (${groups.size})`;
    els.tabButtons.muted.textContent = `${TAB_LABELS.muted} (${mutedCount})`;
  }
```

- [ ] **Step 5: Replace `renderList()`/`buildMutedSection()` with tab filtering**

Find:

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
    list.hidden = !mutedSectionExpanded;
    for (const [fingerprint, entry] of mutedEntries) {
      list.appendChild(buildRow(fingerprint, entry));
    }

    toggle.addEventListener('click', () => {
      mutedSectionExpanded = !mutedSectionExpanded;
      list.hidden = !mutedSectionExpanded;
    });

    section.append(toggle, list);
    return section;
  }
```

Replace with:

```js
  function filterForActiveTab(entries) {
    if (activeTab === 'all') return entries;
    if (activeTab === 'muted') return entries.filter(([, entry]) => isMuted(entry.record));
    return entries.filter(([, entry]) => needsAttention(entry.record));
  }

  function renderList() {
    els.list.replaceChildren();
    const entries = Array.from(groups.entries()).sort(
      (a, b) => b[1].record.timestamp - a[1].record.timestamp
    );
    const visibleEntries = filterForActiveTab(entries);
    for (const [fingerprint, entry] of visibleEntries) {
      els.list.appendChild(buildRow(fingerprint, entry));
    }
  }
```

- [ ] **Step 6: Initialize tab state/labels on `init()`, reset on `teardown()`**

Find:

```js
  function init(origin) {
    if (els) return; // already initialized this page load
    currentOrigin = origin;
    buildDom();
    chrome.storage.local.get('hudState').then(({ hudState = {} }) => {
      const originState = hudState[origin];
      applyCollapsed(originState ? originState.collapsed : true);
    });
  }

  function teardown() {
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadowRoot = null;
    els = null;
    groups = new Map();
    mutedSectionExpanded = false;
    window.__webErrorMonitorHudInstalled = false;
  }
```

Replace with:

```js
  function init(origin) {
    if (els) return; // already initialized this page load
    currentOrigin = origin;
    buildDom();
    applyActiveTabStyle();
    renderCounts(); // paints "Needs attention (0)" etc. immediately, before any error arrives
    chrome.storage.local.get('hudState').then(({ hudState = {} }) => {
      const originState = hudState[origin];
      applyCollapsed(originState ? originState.collapsed : true);
    });
  }

  function teardown() {
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadowRoot = null;
    els = null;
    groups = new Map();
    activeTab = 'needsAttention';
    window.__webErrorMonitorHudInstalled = false;
  }
```

- [ ] **Step 7: Update `src/hud/styles.js`**

Find:

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

Replace with:

```css
  .wem-tabs {
    display: flex;
    gap: 4px;
    padding: 6px 10px 0 10px;
  }
  .wem-tab {
    flex: 1;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.55;
    cursor: pointer;
    font-size: 10px;
    padding: 6px 4px;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .wem-tab-active {
    opacity: 1;
    font-weight: 600;
    border-bottom-color: #7c3aed;
  }
```

- [ ] **Step 8: Syntax-check**

```bash
node --check src/hud/hud.js
node --check src/hud/styles.js
```

Expected: no output.

- [ ] **Step 9: Controller-run live smoke test (no extension loading needed, no API key needed)**

Same technique as Phase 3a's Task 4 smoke test — serve `dev/test-page.html`, inject `styles.js` + `hud.js` with a `chrome.storage` stub via the browser tool:

1. Call `hud.init(origin)`. Confirm the tab bar shows `Needs attention (0)`, `All (0)`, `Muted (0)`, with "Needs attention" visually active.
2. Call `hud.render(...)` for four synthetic records: one `classification: null` with `kind: 'console.error'` (grey, not muted), one `classification: { displayColor: 'red', muted: false }`, one `classification: { displayColor: 'grey', muted: false, silentBug: { probability: 0.8 } }`, one `classification: { muted: true }`.
3. On the default "Needs attention" tab: confirm exactly 2 rows show (the red one, and the grey-with-high-silent-bug one) — not the plain grey `null`-classification one, not the muted one.
4. Click the "All" tab: confirm all 4 rows show.
5. Click the "Muted" tab: confirm exactly 1 row shows (the muted one).
6. Confirm the pill's red/amber/grey counts still exclude the muted record (unchanged behavior from Phase 3a).

Report any mismatch before proceeding to Task 4.

- [ ] **Step 10: Commit**

```bash
git add src/hud/hud.js src/hud/styles.js
git commit -m "Replace single list + muted section with Needs attention/All/Muted tabs"
```

---

### Task 4: Cost/token badge — `GET_USAGE` on init, `USAGE_UPDATE` broadcast

**Files:**
- Modify: `src/content.js`
- Modify: `src/hud/hud.js`
- Modify: `src/hud/styles.js`

**Interfaces:**
- Consumes: `{ type: 'USAGE_UPDATE', costLabel, tokenLabel, ... }` broadcast and `{ type: 'GET_USAGE' }` response, both from Task 2 (`src/worker/usage.js`).
- Produces: `window.__webErrorMonitorHud.updateUsage(costLabel, tokenLabel)` (new public API method).

- [ ] **Step 1: Update `src/content.js`**

Find:

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

Replace with:

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
    } else if (message.type === 'USAGE_UPDATE') {
      window.__webErrorMonitorHud.updateUsage(message.costLabel, message.tokenLabel);
    }
  });
```

- [ ] **Step 2: Add the badge element and split the header into two groups in `src/hud/hud.js`**

Find:

```js
    const header = document.createElement('div');
    header.className = 'wem-panel-header';
    const title = document.createElement('span');
    title.textContent = 'Web Error Monitor';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', clear);
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.textContent = '×';
    collapseBtn.addEventListener('click', () => setCollapsed(true));
    header.append(title, clearBtn, collapseBtn);
```

Replace with:

```js
    const header = document.createElement('div');
    header.className = 'wem-panel-header';
    const title = document.createElement('span');
    title.textContent = 'Web Error Monitor';
    const usageBadge = document.createElement('span');
    usageBadge.className = 'wem-usage-badge';
    usageBadge.textContent = '$0.0000 · 0 tok';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'wem-header-left';
    headerLeft.append(title, usageBadge);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', clear);
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.textContent = '×';
    collapseBtn.addEventListener('click', () => setCollapsed(true));
    const headerRight = document.createElement('div');
    headerRight.className = 'wem-header-right';
    headerRight.append(clearBtn, collapseBtn);
    header.append(headerLeft, headerRight);
```

And find:

```js
    els = { pill, countRed, countAmber, countGrey, panel, list, tabButtons };
```

Replace with:

```js
    els = { pill, countRed, countAmber, countGrey, panel, list, tabButtons, usageBadge };
```

- [ ] **Step 3: Add `updateUsage`, request the initial summary in `init()`, expose it publicly**

Find:

```js
  function updateClassification(fingerprint, classification) {
    if (!els) return;
    const entry = groups.get(fingerprint);
    if (!entry) return; // the row may have been cleared before classification arrived
    entry.record = { ...entry.record, classification };
    renderCounts();
    renderList();
  }
```

Replace with:

```js
  function updateClassification(fingerprint, classification) {
    if (!els) return;
    const entry = groups.get(fingerprint);
    if (!entry) return; // the row may have been cleared before classification arrived
    entry.record = { ...entry.record, classification };
    renderCounts();
    renderList();
  }

  function updateUsage(costLabel, tokenLabel) {
    if (!els) return;
    els.usageBadge.textContent = `${costLabel} · ${tokenLabel}`;
  }
```

Find:

```js
  function init(origin) {
    if (els) return; // already initialized this page load
    currentOrigin = origin;
    buildDom();
    applyActiveTabStyle();
    renderCounts(); // paints "Needs attention (0)" etc. immediately, before any error arrives
    chrome.storage.local.get('hudState').then(({ hudState = {} }) => {
      const originState = hudState[origin];
      applyCollapsed(originState ? originState.collapsed : true);
    });
  }
```

Replace with:

```js
  function init(origin) {
    if (els) return; // already initialized this page load
    currentOrigin = origin;
    buildDom();
    applyActiveTabStyle();
    renderCounts(); // paints "Needs attention (0)" etc. immediately, before any error arrives
    chrome.storage.local.get('hudState').then(({ hudState = {} }) => {
      const originState = hudState[origin];
      applyCollapsed(originState ? originState.collapsed : true);
    });
    // Cost is global (all origins), so a HUD opened on any page needs the
    // running total that may already exist from other tabs — fetched once
    // here, kept current afterward by the USAGE_UPDATE broadcast.
    chrome.runtime
      .sendMessage({ type: 'GET_USAGE' })
      .then((summary) => {
        if (summary) updateUsage(summary.costLabel, summary.tokenLabel);
      })
      .catch(() => {
        // Service worker may be asleep or the extension was reloaded; the
        // badge keeps its "$0.0000 · 0 tok" initial text until the next
        // USAGE_UPDATE broadcast catches it up.
      });
  }
```

Find:

```js
  window.__webErrorMonitorHud = { init, render, clear, teardown, updateClassification };
```

Replace with:

```js
  window.__webErrorMonitorHud = { init, render, clear, teardown, updateClassification, updateUsage };
```

- [ ] **Step 4: Update `src/hud/styles.js`**

Find:

```css
  .wem-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 600;
  }
```

Replace with:

```css
  .wem-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 600;
  }
  .wem-header-left,
  .wem-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wem-usage-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 999px;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: #fff;
  }
```

- [ ] **Step 5: Syntax-check**

```bash
node --check src/content.js
node --check src/hud/hud.js
node --check src/hud/styles.js
```

Expected: no output.

- [ ] **Step 6: Controller-run live smoke test**

Serve `dev/test-page.html`, inject `styles.js` + `hud.js` with a `chrome.storage` stub **and** a `chrome.runtime.sendMessage` stub that resolves `{ type: 'GET_USAGE' }` requests with `{ totalCostUsd: 0.0021, totalInputTokens: 5000, costLabel: '$0.0021', tokenLabel: '5.0k tok' }`:

1. Call `hud.init(origin)`. Confirm the badge shows `$0.0021 · 5.0k tok` shortly after init (the async `GET_USAGE` round trip).
2. Call `hud.updateUsage('$0.0099', '12.0k tok')` directly (simulating a `USAGE_UPDATE` broadcast having arrived via `content.js`). Confirm the badge text updates to `$0.0099 · 12.0k tok`.

Report any mismatch before proceeding to Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/content.js src/hud/hud.js src/hud/styles.js
git commit -m "Add live global session cost/token badge to the HUD header"
```

---

### Task 5: Inline drill-down — Jev's actual answers per row

**Files:**
- Modify: `src/hud/hud.js`
- Modify: `src/hud/styles.js`

**Interfaces:**
- Consumes: `record.classification.{priority,origin,silentBug}` shapes from Phase 3a — `priority = { score, legend, probabilities, confidence }`, `origin = { choice, probabilities, confidence }`, `silentBug = { probability }` (each may be `null`); a failure marker has `classification.failed === true` instead of these fields.
- Produces: nothing new consumed elsewhere — this is the last piece of the row detail UI.

- [ ] **Step 1: Add `buildJevDetail` and call it from `buildRow`**

Find:

```js
    const detail = document.createElement('div');
    detail.className = 'wem-row-detail';
    detail.hidden = !expanded;
    const detailChildren = [];
    // The row summary truncates the message to MAX_MESSAGE_LENGTH. Many
    // real console.warn/console.error calls log a message plus a data
    // object (e.g. `console.warn('Unknown type', {status, uuid, ...})`),
    // and stringifyArgs (main-world.js) concatenates all of that into one
    // long message string — truncation can hide the actual diagnostic
    // payload entirely, with no other place in the UI to see it. Show the
    // full message on expand whenever it was actually truncated; skip it
    // when the summary already shows the whole thing, to avoid repeating
    // short messages twice.
    if (record.message && record.message.length > MAX_MESSAGE_LENGTH) {
      const fullMessage = document.createElement('pre');
      fullMessage.className = 'wem-row-full-message';
      fullMessage.textContent = record.message;
      detailChildren.push(fullMessage);
    }
    const stack = document.createElement('pre');
```

Replace with:

```js
    const detail = document.createElement('div');
    detail.className = 'wem-row-detail';
    detail.hidden = !expanded;
    const detailChildren = [];
    // The row summary truncates the message to MAX_MESSAGE_LENGTH. Many
    // real console.warn/console.error calls log a message plus a data
    // object (e.g. `console.warn('Unknown type', {status, uuid, ...})`),
    // and stringifyArgs (main-world.js) concatenates all of that into one
    // long message string — truncation can hide the actual diagnostic
    // payload entirely, with no other place in the UI to see it. Show the
    // full message on expand whenever it was actually truncated; skip it
    // when the summary already shows the whole thing, to avoid repeating
    // short messages twice.
    if (record.message && record.message.length > MAX_MESSAGE_LENGTH) {
      const fullMessage = document.createElement('pre');
      fullMessage.className = 'wem-row-full-message';
      fullMessage.textContent = record.message;
      detailChildren.push(fullMessage);
    }
    const jevDetail = buildJevDetail(record.classification);
    if (jevDetail) detailChildren.push(jevDetail);
    const stack = document.createElement('pre');
```

- [ ] **Step 2: Write `buildJevDetail`, placed above `buildRow`**

Find:

```js
  function buildRow(fingerprint, entry) {
```

Replace with:

```js
  // Renders Jev's actual per-question answers (not just the summary color
  // dot) for the row's expanded detail. Returns null when there's nothing
  // to show — not yet classified, or a negatively-cached failure marker
  // (see src/worker/classification.js's cacheFailure) which has no
  // priority/origin/silentBug fields to render.
  function buildJevDetail(classification) {
    if (!classification || classification.failed) return null;
    const rows = [];
    if (classification.priority) {
      const { score, legend, confidence } = classification.priority;
      const label = legend && legend[Math.round(score)] ? legend[Math.round(score)] : `score ${score}`;
      rows.push(['Priority', `${label} (${Math.round((confidence ?? 0) * 100)}% confidence)`]);
    }
    if (classification.origin) {
      const { choice, confidence } = classification.origin;
      rows.push(['Origin', `${choice.replace(/_/g, ' ')} (${Math.round((confidence ?? 0) * 100)}% confidence)`]);
    }
    if (classification.silentBug) {
      rows.push(['Silent bug risk', `${Math.round(classification.silentBug.probability * 100)}%`]);
    }
    if (rows.length === 0) return null;

    const container = document.createElement('div');
    container.className = 'wem-jev-detail';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'wem-jev-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'wem-jev-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'wem-jev-value';
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      container.appendChild(row);
    }
    return container;
  }

  function buildRow(fingerprint, entry) {
```

- [ ] **Step 3: Add CSS in `src/hud/styles.js`**

Find:

```css
  .wem-row-full-message {
```

Replace with:

```css
  .wem-jev-detail {
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: rgba(124, 58, 237, 0.08);
    border: 1px solid rgba(124, 58, 237, 0.25);
    border-radius: 4px;
    padding: 6px 8px;
    margin: 0 0 6px 0;
    font-size: 11px;
  }
  .wem-jev-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .wem-jev-label {
    opacity: 0.65;
  }
  .wem-jev-value {
    text-align: right;
  }
  .wem-row-full-message {
```

- [ ] **Step 4: Syntax-check**

```bash
node --check src/hud/hud.js
node --check src/hud/styles.js
```

Expected: no output.

- [ ] **Step 5: Controller-run live smoke test**

Serve `dev/test-page.html`, inject `styles.js` + `hud.js` with a `chrome.storage`/`chrome.runtime` stub:

1. Call `hud.init(origin)`, then `hud.render(...)` for a record with a full classification:
   ```js
   classification: {
     priority: { score: 1.04, legend: { 0: 'Cosmetic', 1: 'Real issue', 2: 'Breaks UI' }, confidence: 0.33 },
     origin: { choice: 'app_code', confidence: 0.64 },
     silentBug: { probability: 0.17 },
     displayColor: null,
     muted: false,
   }
   ```
2. Click the row to expand it. Confirm the detail shows three lines: `Priority: Real issue (33% confidence)`, `Origin: app code (64% confidence)`, `Silent bug risk: 17%`.
3. Render a second record with `classification: { failed: true, terminal: true, failedAt: Date.now() }` and expand it. Confirm no Jev-detail block appears (just the existing stack/copy content), and nothing throws.
4. Render a third record with `classification: null` (not yet classified) and expand it. Confirm the same — no Jev-detail block, no error.

Report any mismatch before proceeding to Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/hud/hud.js src/hud/styles.js
git commit -m "Show Jev's actual classification answers in the row drill-down"
```

---

### Task 6: Manual end-to-end verification with a real Jev API key

**Files:** none (verification only; may produce fixup commits if something's broken)

- [ ] **Step 1: Reload the unpacked extension**

`chrome://extensions` → reload "Web Error Monitor". Confirm no manifest/load errors (this plan adds no manifest changes, so this is mainly a sanity check that the new files load cleanly).

- [ ] **Step 2: Verify the default tab and empty-state badge**

Serve and enable the extension on `dev/test-page.html`. Open the HUD before triggering anything. Confirm it opens on the "Needs attention" tab (all counts 0) and the header badge shows `$0.0000 · 0 tok`.

- [ ] **Step 3: Trigger real classifications and watch the badge move**

Your real Jev API key should already be saved from Phase 3a's Task 5 — if not, enter it via the options page first. Trigger a few different error kinds on the test page. Watch the service worker console for the existing `[web-error-monitor]` capture/classification logs. Confirm the header badge's cost and token numbers increase after each successful classification (not immediately on error capture — only once the ~1s debounced Jev call actually completes).

- [ ] **Step 4: Verify tab filtering with real classifications**

Once a few errors have real classifications: confirm red/amber-classified errors (and any grey one Jev flags with high silent-bug risk) appear under "Needs attention"; confirm every captured error appears under "All"; confirm anything Jev classifies as `framework_noise`/`browser_extension` origin appears only under "Muted", not under "Needs attention" or mixed into "All" incorrectly (it should still appear in "All" — only "Needs attention" excludes muted entries).

- [ ] **Step 5: Verify the drill-down shows real Jev answers**

Expand a classified row. Confirm the Priority/Origin/Silent bug risk lines match what's actually visible in the Network tab's response body for that classification (cross-check the raw `answers` JSON against what's rendered).

- [ ] **Step 6: Verify the badge is global across tabs**

Open `dev/test-page.html` in a second tab (same or different origin, both enabled), open its HUD, and confirm its badge shows the **same running total** as the first tab's — not a separate per-tab count. Trigger a new classification in the second tab and confirm the first tab's badge (if still open) updates too via the `USAGE_UPDATE` broadcast.

- [ ] **Step 7: Verify the session reset boundary**

Reload the extension from `chrome://extensions` (this restarts the service worker, clearing `chrome.storage.session`). Open the HUD again and confirm the badge resets to `$0.0000 · 0 tok` — proof the cost tracking is session-scoped as designed, not accidentally persisted forever.

- [ ] **Step 8: Run the full automated test suite one more time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Final commit**

```bash
git add -A
git status
git commit -m "Complete Phase 3b v1: dashboard tabs, cost tracking, Jev detail drill-down" --allow-empty
```

---

## Definition of Done

Opening the HUD on an enabled origin defaults to the "Needs attention" tab; a header badge shows the running Jev spend/token count for the current browser session, shared globally across every monitored origin's tab and reset only when the service worker restarts; switching to "All" or "Muted" shows the expected filtered set; expanding any classified row shows Jev's actual priority/origin/silent-bug answers, not just the summary color dot; none of this breaks Phase 3a's existing capture/classification/muting behavior. Chart visuals (origin donut, spend-over-time bars) remain deferred to a follow-up plan.
