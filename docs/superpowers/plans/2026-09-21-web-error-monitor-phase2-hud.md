# Web Error Monitor — Phase 2 (HUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render captured errors in a shadow-root HUD pinned to the bottom-right of the page — a collapsed pill showing severity counts, and an expandable panel listing errors grouped by fingerprint with an occurrence count, full-stack detail, copy-to-clipboard, and a clear button. No classification yet (Phase 3) — severity is the `kind`-based heuristic BRIEF §6 specifies for this phase.

**Architecture:** The worker (already fingerprinting/deduping every `CAPTURE_EVENT` since Phase 1) also relays the finished record down to the originating tab's content script via `chrome.tabs.sendMessage`, tagged `{type: 'RECORD', record}`. The content script's isolated-world content-script bundle grows two more files — `src/hud/styles.js` and `src/hud/hud.js` — sharing the isolated-world global scope with `content.js` (content scripts are classic scripts, not ES modules, so this is plain global-scope sharing, not an import). `hud.js` owns a shadow-root UI, keeps its own in-memory per-fingerprint grouping (fresh every page load, matching BRIEF §6's "count resets on navigation"), and persists only the collapsed/expanded boolean to `chrome.storage.local` per origin. The record's `classification` field is added now as an always-`null` placeholder so Phase 3 can populate it later without reshaping anything this phase builds — the HUD's severity logic already falls back to the `kind` heuristic when `classification` is absent, which is also the intended Phase-3 fallback rule (BRIEF §7: low-confidence classification shows the raw error, not a label).

**Tech Stack:** Same as Phase 1 — vanilla JS, zero build step, zero new dependencies, zero new manifest permissions (clipboard writes via `navigator.clipboard.writeText` from a user-gesture click handler need no extra permission; the HUD's own CSS is a JS string constant injected into a `<style>` tag inside the shadow root, avoiding the manifest/`web_accessible_resources` complexity of a real `.css` file). `src/hud/hud.js` renders via raw DOM APIs (no framework) and cannot be unit-tested with Node (no DOM there) — verified instead via a controller-run live-browser smoke test (page-context script injection, no extension loading required) plus the final manual end-to-end pass in real Chrome.

**Spec:** [BRIEF.md](../../../BRIEF.md) §6 (HUD), plus the design confirmed in conversation: record gets an always-`null`-for-now `classification` field; HUD's own in-memory grouping (not the worker's `dedupeCounts`, which remains a separate session-scoped diagnostic counter feeding only the service-worker console log) drives the displayed occurrence counts; collapsed/expanded state persists to `chrome.storage.local` keyed by origin.

## Global Constraints

- **No build step, no bundler, no framework, no new npm dependency, no new manifest permission.** (BRIEF §2, carried from Phase 1)
- **Shadow root must use `attachShadow({mode: 'closed'})`** on a container appended to `document.documentElement` — non-negotiable, prevents the monitored page's CSS/JS from touching the HUD and vice versa. (BRIEF §6)
- **Fixed position, bottom-right, high z-index; `pointer-events` scoped so the HUD never blocks the page when collapsed** — the wrapping element is `pointer-events: none`, with the pill/panel individually re-enabling `pointer-events: auto`. (BRIEF §6)
- **Collapsed state is a small pill with counts by severity** (red/amber/grey dots), example shape `3 ● 7 ● 22 ●`. Severity heuristic for this phase: red = `uncaught` + `unhandledrejection` + `network` (every captured `network` event is already a failure, per Phase 1's main-world.js), amber = `console.error`, grey = `console.warn`. (BRIEF §6)
- **Expanded state: scrollable list, newest first, grouped by fingerprint with an occurrence count badge.** Each row shows truncated message, source file, and count; clicking a row reveals the full stack and a **Copy** button that puts message + stack + url on the clipboard. (BRIEF §6)
- **A clear button, and a count that resets on navigation but keeps the classification cache.** The HUD's own grouping/count is in-memory and naturally resets every page load (a fresh content-script instance); "Clear" just empties that in-memory state early. This is intentionally a *different* counter from the worker's `dedupeCounts` (session-scoped, persists across reloads within a browsing session, used only for the Phase-1 console diagnostic log line) — the two serve different purposes and must not be conflated.
- **Persist collapsed/expanded state per origin**, surviving reloads and browser restarts (`chrome.storage.local`, not `.session`).
- **Visually quiet: dark, semi-transparent, small type.** Must not distract from the page under test.
- **No Jev/classification network calls, no API key handling, no options page** — Phase 3 only. The `classification` field on the record exists as a placeholder (`null`) so Phase 3 can populate it without reshaping the record or the HUD's rendering logic.
- **`content.js`'s existing re-injection guard (`window.__webErrorMonitorBridgeInstalled`) and the isolated-world global-sharing model are unchanged** — `hud.js` needs and gets its own equivalent guard (`window.__webErrorMonitorHudInstalled`), mirroring the pattern `main-world.js` and `content.js` already use.

---

## File Structure

```
src/
├── hud/
│   ├── styles.js     # window.__webErrorMonitorHudCss — CSS text constant, no logic
│   └── hud.js         # window.__webErrorMonitorHud = { init, render, clear, teardown }
├── content.js          # MODIFY: init the HUD on injection, relay RECORD/TEARDOWN to it
└── worker.js           # MODIFY: classification stub + send RECORD; update the two
                         #         registerContentScripts/executeScript file lists
```

`hud/styles.js` and `hud/hud.js` are plain classic scripts (no `export`/`import` — content scripts can't be ES modules) that share the isolated-world global scope with `content.js` when Chrome injects all three together, in this exact order, per registration.

---

### Task 1: HUD module — `src/hud/styles.js` and `src/hud/hud.js`

**Files:**
- Create: `src/hud/styles.js`
- Create: `src/hud/hud.js`

**Interfaces:**
- Consumes: nothing (no imports — classic scripts).
- Produces: `window.__webErrorMonitorHudCss` (string, set by `styles.js`); `window.__webErrorMonitorHud = { init(origin), render(record), clear(), teardown() }` (set by `hud.js`, which reads `window.__webErrorMonitorHudCss`). `record` passed to `render` has the shape `{ id, kind, message, stack, sourceFile, origin, url, timestamp, request, fingerprint, classification }` (from BRIEF §5 plus the new `classification` field — always `null` in this phase). Consumed by Task 3 (`content.js`).

- [ ] **Step 1: Write `src/hud/styles.js`**

```js
// src/hud/styles.js
window.__webErrorMonitorHudCss = `
  :host { all: initial; }
  .wem-root {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 2147483647;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    color: #e6e6e6;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .wem-pill {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(20, 20, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  .wem-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .wem-dot-red { background: #e5484d; }
  .wem-dot-amber { background: #f5a623; }
  .wem-dot-grey { background: #8a8a8a; }
  .wem-panel {
    pointer-events: auto;
    margin-bottom: 8px;
    width: 360px;
    max-height: 420px;
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 20, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .wem-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 600;
  }
  .wem-panel-header button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
  }
  .wem-list {
    overflow-y: auto;
  }
  .wem-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding: 6px 10px;
  }
  .wem-row-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .wem-row-message {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wem-row-count {
    opacity: 0.7;
  }
  .wem-row-source {
    opacity: 0.5;
    font-size: 11px;
    margin-top: 2px;
    margin-left: 14px;
  }
  .wem-row-detail {
    margin-top: 6px;
  }
  .wem-row-stack {
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.3);
    padding: 6px;
    border-radius: 4px;
    max-height: 160px;
    overflow-y: auto;
    font-size: 11px;
  }
  .wem-copy-btn {
    margin-top: 4px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: inherit;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  [hidden] { display: none !important; }
`;
```

- [ ] **Step 2: Write `src/hud/hud.js`**

```js
// src/hud/hud.js
(() => {
  if (window.__webErrorMonitorHudInstalled) return;
  window.__webErrorMonitorHudInstalled = true;

  const MAX_MESSAGE_LENGTH = 80;

  let hostEl = null;
  let shadowRoot = null;
  let els = null; // { pill, countRed, countAmber, countGrey, panel, list }
  let groups = new Map(); // fingerprint -> { record, count }
  let collapsed = true;
  let currentOrigin = null;

  function truncate(message) {
    if (!message) return '';
    return message.length > MAX_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
      : message;
  }

  function severityColor(kind) {
    if (kind === 'uncaught' || kind === 'unhandledrejection' || kind === 'network') return 'red';
    if (kind === 'console.error') return 'amber';
    return 'grey';
  }

  function buildDom() {
    hostEl = document.createElement('div');
    hostEl.style.all = 'initial';
    shadowRoot = hostEl.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = window.__webErrorMonitorHudCss || '';
    shadowRoot.appendChild(style);

    const root = document.createElement('div');
    root.className = 'wem-root';

    const panel = document.createElement('div');
    panel.className = 'wem-panel';
    panel.hidden = true;

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

    const list = document.createElement('div');
    list.className = 'wem-list';

    panel.append(header, list);

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'wem-pill';
    pill.setAttribute('aria-expanded', 'false');
    const dotRed = document.createElement('span');
    dotRed.className = 'wem-dot wem-dot-red';
    const countRed = document.createElement('span');
    countRed.textContent = '0';
    const dotAmber = document.createElement('span');
    dotAmber.className = 'wem-dot wem-dot-amber';
    const countAmber = document.createElement('span');
    countAmber.textContent = '0';
    const dotGrey = document.createElement('span');
    dotGrey.className = 'wem-dot wem-dot-grey';
    const countGrey = document.createElement('span');
    countGrey.textContent = '0';
    pill.append(dotRed, countRed, dotAmber, countAmber, dotGrey, countGrey);
    pill.addEventListener('click', () => setCollapsed(!collapsed));

    root.append(panel, pill);
    shadowRoot.appendChild(root);
    document.documentElement.appendChild(hostEl);

    els = { pill, countRed, countAmber, countGrey, panel, list };
  }

  function applyCollapsed(value) {
    collapsed = value;
    els.panel.hidden = collapsed;
    els.pill.setAttribute('aria-expanded', String(!collapsed));
  }

  function setCollapsed(value) {
    applyCollapsed(value);
    if (!currentOrigin) return;
    chrome.storage.local.get('hudState').then(({ hudState = {} }) => {
      hudState[currentOrigin] = { collapsed: value };
      chrome.storage.local.set({ hudState });
    });
  }

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

  function buildRow(fingerprint, record, count) {
    const row = document.createElement('div');
    row.className = 'wem-row';
    row.dataset.fingerprint = fingerprint;

    const summary = document.createElement('div');
    summary.className = 'wem-row-summary';
    const dot = document.createElement('span');
    dot.className = `wem-dot wem-dot-${severityColor(record.kind)}`;
    const message = document.createElement('span');
    message.className = 'wem-row-message';
    message.textContent = truncate(record.message);
    const countEl = document.createElement('span');
    countEl.className = 'wem-row-count';
    countEl.textContent = `×${count}`;
    summary.append(dot, message, countEl);

    const source = document.createElement('div');
    source.className = 'wem-row-source';
    source.textContent = record.sourceFile || '';

    const detail = document.createElement('div');
    detail.className = 'wem-row-detail';
    detail.hidden = true;
    const stack = document.createElement('pre');
    stack.className = 'wem-row-stack';
    stack.textContent = record.stack || '(no stack available)';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'wem-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const text = `${record.message}\n\n${record.stack || ''}\n\n${record.url}`;
      navigator.clipboard.writeText(text).catch(() => {});
    });
    detail.append(stack, copyBtn);

    summary.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
    });

    row.append(summary, source, detail);
    return row;
  }

  function renderList() {
    els.list.replaceChildren();
    const entries = Array.from(groups.entries()).sort(
      (a, b) => b[1].record.timestamp - a[1].record.timestamp
    );
    for (const [fingerprint, { record, count }] of entries) {
      els.list.appendChild(buildRow(fingerprint, record, count));
    }
  }

  function render(record) {
    if (!els) return;
    const existing = groups.get(record.fingerprint);
    groups.set(record.fingerprint, {
      record,
      count: (existing ? existing.count : 0) + 1,
    });
    renderCounts();
    renderList();
  }

  function clear() {
    groups = new Map();
    renderCounts();
    renderList();
  }

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
    window.__webErrorMonitorHudInstalled = false;
  }

  window.__webErrorMonitorHud = { init, render, clear, teardown };
})();
```

- [ ] **Step 3: Syntax-check both files**

```bash
node --check src/hud/styles.js
node --check src/hud/hud.js
```

Expected: no output. Neither file can run standalone under Node (both use `document`/`chrome`, browser-only) — that's expected, not a bug.

- [ ] **Step 4: Controller-run live smoke test (no extension loading needed)**

This step is performed by whoever is driving the browser tooling, not by an implementer subagent without browser access — mirrors how Phase 1's `main-world.js` was smoke-tested via page-context script injection before the full extension existed.

1. Serve any static page (e.g. `dev/test-page.html` via `python3 -m http.server 8000` from `dev/`) and open it in a real browser tab.
2. Inject the contents of `src/hud/styles.js`, then `src/hud/hud.js`, in that order (e.g. via DevTools Console/Snippets, or an equivalent page-context JS execution tool).
3. Run `window.__webErrorMonitorHud.init(window.location.origin)` — confirm a small dark pill appears bottom-right showing `0 0 0`.
4. Run `window.__webErrorMonitorHud.render({kind: 'uncaught', message: 'Boom', stack: 'Error: Boom\n    at foo (bar.js:1:1)', sourceFile: 'bar.js:1:1', url: location.href, timestamp: Date.now(), fingerprint: 'abc123'})` twice — confirm the red count shows `2` in the pill (still one row, since it's the same fingerprint) — wait, once for the pill to show a nonzero red dot, and confirm clicking the pill expands the panel showing one row with `×2`.
5. Click the row — confirm the stack and a Copy button appear; click Copy and confirm no console error (clipboard write may silently no-op outside a full user-gesture context in some tooling — that's fine, just confirm nothing throws).
6. Click the panel's Clear button — confirm the row disappears and the pill counts reset to `0`.
7. Run `window.__webErrorMonitorHud.teardown()` — confirm the pill disappears entirely from the page.

Report any mismatch from the above before proceeding to Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/hud/styles.js src/hud/hud.js
git commit -m "Add HUD module: shadow-root panel, severity pill, grouping by fingerprint"
```

---

### Task 2: `src/worker.js` — classification stub and RECORD relay

**Files:**
- Modify: `src/worker.js`

**Interfaces:**
- Produces: sends `chrome.tabs.sendMessage(tabId, { type: 'RECORD', record })` where `record` is the existing Phase-1 record shape plus `classification: null`. Consumed by Task 3 (`content.js`).

- [ ] **Step 1: Add the classification stub and send the record to the tab**

In `src/worker.js`, inside `handleCaptureEvent`, after the existing dedupe-count/console.log lines, add:

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

(The closing `}` shown above is `handleCaptureEvent`'s own closing brace — `getClassification` is a new, separate top-level function defined right after it.)

- [ ] **Step 2: Syntax-check**

```bash
node --check src/worker.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/worker.js
git commit -m "Relay captured records to the tab's HUD; add classification stub"
```

---

### Task 3: Wire the HUD into `content.js` and the injection file lists

**Files:**
- Modify: `src/content.js`
- Modify: `src/worker.js` (the two file lists inside `enableOrigin`)

**Interfaces:**
- Consumes: `window.__webErrorMonitorHud` from Task 1; the `{type: 'RECORD', record}` message from Task 2.

- [ ] **Step 1: Update `src/content.js`**

Replace the file's contents with:

```js
// src/content.js
(() => {
  // Guard against double-injection: chrome.scripting.executeScript can be
  // called again for the same tab (e.g. disable -> re-enable without a page
  // reload, or the stale-cache race in worker.js's enableOrigin), but a
  // content script's isolated-world listeners can't be un-installed once
  // attached. Without this guard, a second injection would leave two live
  // `message` listeners forwarding every page event to the worker, double
  // logging it and double-incrementing its dedupe count. All content scripts
  // from this extension injected into one frame share a single isolated-world
  // global, so this flag persists across re-injections and can't collide with
  // main-world.js's `window.__webErrorMonitorInstalled` (a different, MAIN-world,
  // `window`) or with anything the page itself does.
  if (window.__webErrorMonitorBridgeInstalled) return;
  window.__webErrorMonitorBridgeInstalled = true;

  const TAG = '__web_error_monitor__';

  window.__webErrorMonitorHud.init(window.location.origin);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== TAG) return;
    if (event.data.type !== 'CAPTURE_EVENT') return;

    chrome.runtime
      .sendMessage({
        type: 'CAPTURE_EVENT',
        payload: event.data.payload,
        pageUrl: window.location.href,
        origin: window.location.origin,
      })
      .catch(() => {
        // Service worker may be asleep or the extension was reloaded; drop silently.
      });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'TEARDOWN') {
      window.postMessage({ source: TAG, type: 'TEARDOWN' }, window.location.origin);
      window.__webErrorMonitorHud.teardown();
    } else if (message.type === 'RECORD') {
      window.__webErrorMonitorHud.render(message.record);
    }
  });
})();
```

- [ ] **Step 2: Update the two file lists in `src/worker.js`'s `enableOrigin`**

Find the `chrome.scripting.registerContentScripts([...])` call and change the second entry's `js` array from:

```js
        {
          id: contentId,
          matches: [pattern],
          js: ['src/content.js'],
          runAt: 'document_start',
        },
```

to:

```js
        {
          id: contentId,
          matches: [pattern],
          js: ['src/hud/styles.js', 'src/hud/hud.js', 'src/content.js'],
          runAt: 'document_start',
        },
```

Then find the immediate-injection `executeScript` call for the content bundle and change:

```js
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
```

to:

```js
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/hud/styles.js', 'src/hud/hud.js', 'src/content.js'],
      });
```

(File order matters: `hud.js` must run before `content.js` so `window.__webErrorMonitorHud` exists when `content.js`'s top-level `init(...)` call runs; `styles.js` must run before `hud.js` so `window.__webErrorMonitorHudCss` exists when `hud.js` builds its `<style>` tag.)

- [ ] **Step 3: Syntax-check both files**

```bash
node --check src/content.js
node --check src/worker.js
```

Expected: no output.

- [ ] **Step 4: Run the full lib test suite** (regression check — this task doesn't touch `src/lib`, but confirm nothing else broke)

```bash
npm test
```

Expected: all tests still passing.

- [ ] **Step 5: Commit**

```bash
git add src/content.js src/worker.js
git commit -m "Wire the HUD into content.js and the per-origin injection file lists"
```

---

### Task 4: Manual end-to-end verification in real Chrome

**Files:** none (verification only; may produce fixup commits if something's broken)

- [ ] **Step 1: Reload the unpacked extension**

`chrome://extensions` → click the reload icon on "Web Error Monitor".

- [ ] **Step 2: Serve and open the test page**

```bash
cd dev && python3 -m http.server 8000
```

Visit `http://localhost:8000/test-page.html`.

- [ ] **Step 3: Enable and verify the pill appears**

Click the toolbar icon, approve the permission prompt. Confirm a small dark pill appears bottom-right of the page showing `0 0 0`.

- [ ] **Step 4: Trigger each error kind and verify severity coloring**

Click each of the 5 test buttons once. Expected pill state: red count `3` (uncaught, unhandledrejection, network), amber count `1` (console.error), grey count `1` (console.warn).

- [ ] **Step 5: Verify the expanded panel**

Click the pill. Confirm a panel opens listing 5 rows, newest first, each showing a truncated message, source file, and `×1` count badge.

- [ ] **Step 6: Verify grouping and the occurrence count badge**

Click "Throw uncaught error" again (without reloading). Confirm the row count for that one still-listed fingerprint becomes `×2` — no new row is added, and the pill's red count stays `3` (a repeat of an existing fingerprint, not a new group).

- [ ] **Step 7: Verify row expansion and Copy**

Click a row. Confirm the full stack and a Copy button appear. Click Copy, then paste somewhere to confirm the clipboard contains the message, stack, and URL.

- [ ] **Step 8: Verify Clear**

Click Clear. Confirm the list empties and the pill resets to `0 0 0`.

- [ ] **Step 9: Verify collapsed/expanded persistence**

Expand the panel, then reload the page (same origin, still enabled). Confirm the panel is still expanded on load (state persisted). Collapse it, reload again, confirm it now starts collapsed.

- [ ] **Step 10: Verify disabling removes the HUD**

Click the toolbar icon to disable. Confirm the pill disappears from the page entirely (not just stops updating).

- [ ] **Step 11: Run the full automated test suite one more time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 12: Final commit**

```bash
git add -A
git status
git commit -m "Complete Phase 2: HUD" --allow-empty
```

---

## Definition of Done

BRIEF.md §6's HUD requirements are all observable in real Chrome per Task 4: collapsed pill with severity-colored counts, expandable grouped-by-fingerprint list with occurrence badges, row-level stack detail with a working Copy button, a Clear button, and collapsed/expanded state that persists per origin across reloads and disabling removes the HUD from the page. No Jev/classification code, no API key handling, no options page anywhere in the diff — the `classification` field exists only as a `null` placeholder.
