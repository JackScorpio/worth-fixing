# Web Error Monitor — Phase 1 (Capture + Toggle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that captures five kinds of page errors (uncaught exceptions, unhandled rejections, `console.error`, `console.warn`, failed network requests), normalizes and fingerprints them, and logs one deduped record per error to the background service worker's console — enabled only on origins the user explicitly toggles on via the toolbar icon. No HUD, no classification layer, no API key handling (those are later phases).

**Architecture:** Three execution contexts per BRIEF.md §3: a MAIN-world script patches console/window/fetch/XHR and emits via `window.postMessage`; an ISOLATED-world content script validates and relays those messages to the background service worker via `chrome.runtime.sendMessage`; the service worker normalizes, fingerprints (SHA-256 of kind+normalized-message+top-stack-frame+source-file), dedupes by count, and logs. Per-origin enablement uses `activeTab` for the immediate click plus `chrome.permissions.request` for a specific origin (never `<all_urls>`) so `chrome.scripting.registerContentScripts` can persist injection across reloads and browser restarts without a static `content_scripts` manifest entry.

**Tech Stack:** Vanilla JavaScript (ES modules), Manifest V3 APIs (`chrome.scripting`, `chrome.permissions`, `chrome.storage.local`, `chrome.action`), Web Crypto (`crypto.subtle`) for fingerprint hashing. Zero bundler, zero framework, zero npm dependencies. Node's built-in test runner (`node --test`) is used for the pure-logic `src/lib` modules — no test framework is installed.

**Spec:** [BRIEF.md](../../../BRIEF.md)

## Global Constraints

- **Manifest V3.** (BRIEF §2)
- **Vanilla JS + CSS only, zero build step, zero bundler, zero framework.** Files run as-is when loaded unpacked. (BRIEF §2)
- **No new npm dependencies and no build step without asking first.** This plan adds one dev-only `package.json` with `"type": "module"` and a `test` script that runs Node's *built-in* test runner — no packages are installed. Flagged explicitly per BRIEF's instruction to ask before adding a dependency or build step; it is neither, but call it out before Task 1 runs.
- **Never modifies the target web app.** Nothing is imported into any frontend project; the extension operates purely at the browser level. (BRIEF §2)
- **No `chrome.debugger` / Chrome DevTools Protocol**, anywhere. (BRIEF §2)
- **Off by default everywhere; enabled per-origin only by a toolbar-icon click.** No static `content_scripts` match list. No `<all_urls>` host permission — per-origin permission is requested dynamically via `chrome.permissions.request`. (BRIEF §4)
- **Network capture is metadata-only.** Never capture request/response bodies, headers, cookies, or auth tokens. Only failures and non-2xx responses. (BRIEF §5)
- **Recursion guard on the console patch** — capture originals before patching; use a module-level flag. (BRIEF §8.1)
- **Synthesize a stack inside the `console.error`/`console.warn` patch** (`new Error().stack`) and drop frames belonging to the patch file itself. (BRIEF §8.2)
- **`fetch` wrapping must return the original `Response` untouched** and must not `.clone()` unless a body is actually needed (it isn't, in Phase 1). (BRIEF §8.3)
- **All service-worker state lives in `chrome.storage.local`, never module-scope variables** — MV3 workers are killed after ~30s idle and must assume a restart between any two messages. (BRIEF §8.4)
- **`postMessage` hygiene:** tag every message with a namespaced `source` field, and validate `event.source === window` plus the tag before trusting anything from the page. (BRIEF §8.5)
- **Use manifest-declared script injection (`files:` on `executeScript`/`registerContentScripts`), never inline `<script>` injection** — this is what makes the MAIN-world declaration CSP-safe. (BRIEF §8.6)
- **`localhost` needs an explicit, specific host-permission request** — it is not covered implicitly by other patterns. (BRIEF §8.7)
- **Expose and wire up a teardown path** that restores all patched originals when an origin is toggled off. (BRIEF §8.8)
- **Do not attempt source-map resolution in Phase 1.** (BRIEF §8.9)
- **No HUD, no Jev/classification code, no API key handling, no options page** — those are Phase 2/3. (BRIEF §9)

---

## File Structure

```
web-error-monitor/
├── manifest.json
├── package.json                  # { "type": "module" }, no dependencies, one test script
├── .gitignore
├── README.md
├── icons/
│   ├── icon-off-16.png / -48.png / -128.png
│   └── icon-on-16.png  / -48.png / -128.png
├── scripts/
│   └── generate-icons.mjs        # one-time dev tool, builds the placeholder PNGs above
├── dev/
│   └── test-page.html            # manual test harness (buttons trigger each error kind)
├── src/
│   ├── main-world.js             # MAIN world: patches console/window/fetch/XHR
│   ├── content.js                # ISOLATED world: postMessage <-> runtime.sendMessage bridge
│   ├── worker.js                 # background service worker: capture handling + toggle logic
│   └── lib/
│       ├── normalize.js          # normalizeMessage(message)
│       ├── normalize.test.js
│       ├── stack.js              # extractFrames/topFrameLocation/sourceFileFromStack
│       ├── stack.test.js
│       ├── fingerprint.js        # sha256Hex/computeFingerprint
│       └── fingerprint.test.js
```

`src/lib/*` contains only pure functions (no `chrome.*`, no DOM) so they can be unit-tested with `node --test` and imported unmodified by the service worker (which declares `"type": "module"`). `main-world.js` and `content.js` are self-contained IIFEs with no imports, since they run as raw injected files, not modules.

---

### Task 1: Repo scaffold, manifest, icons, git init

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `scripts/generate-icons.mjs`
- Create: `icons/icon-off-16.png`, `icons/icon-off-48.png`, `icons/icon-off-128.png`, `icons/icon-on-16.png`, `icons/icon-on-48.png`, `icons/icon-on-128.png` (generated, not hand-written)

**Interfaces:**
- Produces: the on-disk file layout every later task edits into; the exact `manifest.json` permission set (`storage`, `scripting`, `activeTab`; `optional_host_permissions: ["*://*/*"]`) that Task 9's toggle logic relies on.

- [ ] **Step 1: Initialize git**

```bash
cd /Users/jzhang/Documents/Projects/web-error-monitor
git init
```

- [ ] **Step 2: Write `.gitignore`**

```
.DS_Store
*.key
.env
.env.*
```

- [ ] **Step 3: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Web Error Monitor",
  "version": "0.1.0",
  "description": "Watches console and network activity for errors during local development.",
  "permissions": ["storage", "scripting", "activeTab"],
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
  }
}
```

- [ ] **Step 4: Write `package.json`** (dev-only test runner config, zero dependencies)

```json
{
  "name": "web-error-monitor",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test src/lib"
  }
}
```

- [ ] **Step 5: Write the icon generator script**

```js
// scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function solidColorPng(size, [r, g, b, a]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: truecolor + alpha
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const rowLength = size * 4;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowLength + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }

  const idat = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIZES = [16, 48, 128];
const VARIANTS = {
  off: [117, 117, 117, 255],
  on: [46, 125, 50, 255],
};

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });

for (const [variant, color] of Object.entries(VARIANTS)) {
  for (const size of SIZES) {
    const png = solidColorPng(size, color);
    const path = new URL(`../icons/icon-${variant}-${size}.png`, import.meta.url);
    writeFileSync(path, png);
    console.log(`wrote ${path.pathname}`);
  }
}
```

- [ ] **Step 6: Run the generator and verify output**

```bash
node scripts/generate-icons.mjs
ls -la icons/
```

Expected: 6 files listed (`icon-off-16.png` ... `icon-on-128.png`), each with nonzero size.

- [ ] **Step 7: Write `README.md`**

```markdown
# Web Error Monitor

A Chrome (Manifest V3) extension that watches console and network activity
on pages you're actively developing and surfaces errors you'd otherwise
scroll past. See `BRIEF.md` for the full design.

**Status:** Phase 1 (capture + toggle). No HUD yet — captured events are
logged to the background service worker's console only.

## Load it unpacked

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this project's root folder.
4. Pin the extension to the toolbar if you want quick access.

## Toggle capture on a site

Click the toolbar icon while on the tab you want to watch. Chrome will ask
you to approve access to that specific site — this is expected, and is how
the extension avoids requesting access to every site up front. Click the
icon again to turn it off. The on/off state persists per-origin across
reloads and browser restarts.

## Watch captured events

1. Go to `chrome://extensions`.
2. Find "Web Error Monitor" and click "Inspect views: service worker".
3. Trigger an error on the page — it will be logged as a normalized record
   in that DevTools console.

## Manual test page

`dev/test-page.html` has one button per captured error kind. Serve it
locally and enable the extension on it:

\`\`\`bash
cd dev && python3 -m http.server 8000
\`\`\`

Then visit `http://localhost:8000/test-page.html`.

## Run the unit tests

Pure-logic modules under `src/lib/` have unit tests, run with Node's
built-in test runner (no dependencies to install):

\`\`\`bash
npm test
\`\`\`

## Setting the API key (Phase 3, not yet built)

N/A yet — Phase 1 has no network calls to a classification API and no key
handling of any kind.
```

- [ ] **Step 8: Commit**

```bash
git add manifest.json package.json .gitignore README.md scripts/generate-icons.mjs icons/
git commit -m "Scaffold manifest, icons, and repo layout"
```

---

### Task 2: Manual test harness page

**Files:**
- Create: `dev/test-page.html`

**Interfaces:**
- Produces: a static page with five buttons (`#btn-throw`, `#btn-reject`, `#btn-fetch-fail`, `#btn-console-error`, `#btn-console-warn`) — Task 10's manual verification script clicks these by id.

- [ ] **Step 1: Write the test page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Web Error Monitor — manual test page</title>
</head>
<body>
  <h1>Web Error Monitor — manual test page</h1>
  <p>Enable the extension on this origin, then click each button once.</p>
  <button id="btn-throw">Throw uncaught error</button>
  <button id="btn-reject">Reject a promise</button>
  <button id="btn-fetch-fail">Fetch a 404</button>
  <button id="btn-console-error">console.error</button>
  <button id="btn-console-warn">console.warn</button>

  <script>
    document.getElementById('btn-throw').onclick = () => {
      throw new Error('Boom: uncaught test error');
    };
    document.getElementById('btn-reject').onclick = () => {
      Promise.reject(new Error('Boom: rejected promise'));
    };
    document.getElementById('btn-fetch-fail').onclick = () => {
      fetch('/this-route-does-not-exist-404');
    };
    document.getElementById('btn-console-error').onclick = () => {
      console.error('Boom: console.error test', { some: 'data' });
    };
    document.getElementById('btn-console-warn').onclick = () => {
      console.warn('Boom: console.warn test');
    };
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify it stands alone**

```bash
cd dev && python3 -m http.server 8000 &
sleep 1
curl -s http://localhost:8000/test-page.html | grep -c "btn-throw"
kill %1
```

Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add dev/test-page.html
git commit -m "Add manual test harness page"
```

---

### Task 3: `src/lib/normalize.js` — message normalization

**Files:**
- Create: `src/lib/normalize.js`
- Test: `src/lib/normalize.test.js`

**Interfaces:**
- Produces: `normalizeMessage(message: string | unknown): string` — strips numbers, UUIDs, hex-looking ids, and long quoted strings so the same logical error normalizes identically across reloads. Consumed by Task 5 (`fingerprint.js`).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/normalize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage } from './normalize.js';

test('replaces numbers with a placeholder', () => {
  assert.equal(normalizeMessage('Failed after 3 retries'), 'Failed after <num> retries');
});

test('replaces uuids with a placeholder', () => {
  const msg = 'User 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found';
  assert.equal(normalizeMessage(msg), 'User <uuid> not found');
});

test('replaces hex-looking ids with a placeholder', () => {
  assert.equal(normalizeMessage('Ref 0x1a2b3c4d failed'), 'Ref <hex> failed');
});

test('replaces long quoted strings but leaves short ones alone', () => {
  const long = '"' + 'x'.repeat(50) + '"';
  assert.equal(normalizeMessage(`Bad payload ${long}`), 'Bad payload <string>');
  assert.equal(normalizeMessage('Bad key "short"'), 'Bad key "short"');
});

test('non-string input normalizes to an empty string', () => {
  assert.equal(normalizeMessage(undefined), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test src/lib/normalize.test.js
```

Expected: FAIL — `normalize.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/normalize.js
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID_RE = /\b0x[0-9a-f]+\b|\b[0-9a-f]{16,}\b/gi;
const LONG_QUOTED_RE = /"[^"]{41,}"|'[^']{41,}'/g;
const NUMBER_RE = /-?\b\d+(\.\d+)?\b/g;

export function normalizeMessage(message) {
  if (typeof message !== 'string') return '';
  return message
    .replace(UUID_RE, '<uuid>')
    .replace(HEX_ID_RE, '<hex>')
    .replace(LONG_QUOTED_RE, '<string>')
    .replace(NUMBER_RE, '<num>')
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test src/lib/normalize.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize.js src/lib/normalize.test.js
git commit -m "Add message normalization for fingerprinting"
```

---

### Task 4: `src/lib/stack.js` — stack-frame parsing

**Files:**
- Create: `src/lib/stack.js`
- Test: `src/lib/stack.test.js`

**Interfaces:**
- Produces: `extractFrames(stack: string|null): string[]`, `topFrameLocation(stack, { ignoreFiles?: string[] }): { raw, file, line, col } | null`, `sourceFileFromStack(stack, { ignoreFiles?: string[] }): string | null`. Consumed by Task 5 (`fingerprint.js`) and Task 8 (`worker.js`, for the record's `sourceFile` field).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/stack.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topFrameLocation, sourceFileFromStack } from './stack.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test src/lib/stack.test.js
```

Expected: FAIL — `stack.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/stack.js
const FRAME_LOCATION_RE =
  /((?:https?:|file:|chrome-extension:)?\/\/[^\s()]+|[^\s()]+\.[jt]sx?):(\d+):(\d+)/;

export function extractFrames(stack) {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1) // drop the "Error" / "Error: message" header line
    .map((line) => line.trim())
    .filter(Boolean);
}

export function topFrameLocation(stack, { ignoreFiles = [] } = {}) {
  const frames = extractFrames(stack);
  for (const frame of frames) {
    const match = frame.match(FRAME_LOCATION_RE);
    if (!match) continue;
    const [, file, line, col] = match;
    if (ignoreFiles.some((ignored) => file.includes(ignored))) continue;
    return { raw: frame, file, line: Number(line), col: Number(col) };
  }
  return null;
}

export function sourceFileFromStack(stack, options) {
  const top = topFrameLocation(stack, options);
  if (!top) return null;
  const cleanFile = top.file.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
  return `${cleanFile}:${top.line}:${top.col}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test src/lib/stack.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stack.js src/lib/stack.test.js
git commit -m "Add stack-frame parsing for fingerprinting and source attribution"
```

---

### Task 5: `src/lib/fingerprint.js` — fingerprint hashing

**Files:**
- Create: `src/lib/fingerprint.js`
- Test: `src/lib/fingerprint.test.js`

**Interfaces:**
- Consumes: `normalizeMessage` from `./normalize.js` (Task 3), `topFrameLocation` from `./stack.js` (Task 4).
- Produces: `sha256Hex(text: string): Promise<string>`, `computeFingerprint({ kind, message, stack, sourceFile, ignoreFiles? }): Promise<string>` — a 16-hex-char id, stable across reloads for the same logical error. Consumed by Task 8 (`worker.js`).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/fingerprint.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test src/lib/fingerprint.test.js
```

Expected: FAIL — `fingerprint.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/fingerprint.js
import { normalizeMessage } from './normalize.js';
import { topFrameLocation } from './stack.js';

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeFingerprint({ kind, message, stack, sourceFile, ignoreFiles }) {
  const normalizedMessage = normalizeMessage(message);
  const top = topFrameLocation(stack, { ignoreFiles });
  const topStackFrame = top ? top.raw : '';
  const input = `${kind}|${normalizedMessage}|${topStackFrame}|${sourceFile ?? ''}`;
  const hash = await sha256Hex(input);
  return hash.slice(0, 16);
}
```

This relies on the global `crypto.subtle` (Web Crypto), available both in the browser service worker and in Node 20+ with no import.

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test src/lib/fingerprint.test.js
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full lib test suite**

```bash
npm test
```

Expected: all `src/lib` tests pass (12 tests total across the three files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/fingerprint.js src/lib/fingerprint.test.js
git commit -m "Add fingerprint hashing"
```

---

### Task 6: `src/main-world.js` — MAIN-world patches

**Files:**
- Create: `src/main-world.js`

**Interfaces:**
- Produces: on `window`, posts `{ source: '__web_error_monitor__', type: 'CAPTURE_EVENT', payload: { kind, message, stack, url, timestamp, request? } }` via `window.postMessage(..., window.location.origin)`, and listens for `{ source: '__web_error_monitor__', type: 'TEARDOWN' }` to restore originals. Consumed by Task 7 (`content.js`).
- `kind` is one of `"console.error" | "console.warn" | "uncaught" | "unhandledrejection" | "network"` (BRIEF §5).

- [ ] **Step 1: Write the implementation**

```js
// src/main-world.js
(() => {
  if (window.__webErrorMonitorInstalled) return;
  window.__webErrorMonitorInstalled = true;

  const TAG = '__web_error_monitor__';
  const originals = {
    consoleError: console.error,
    consoleWarn: console.warn,
    fetch: window.fetch,
    xhrOpen: XMLHttpRequest.prototype.open,
    xhrSend: XMLHttpRequest.prototype.send,
  };

  let isCapturing = false;

  function emit(kind, data) {
    if (isCapturing) return; // recursion guard
    isCapturing = true;
    try {
      window.postMessage(
        {
          source: TAG,
          type: 'CAPTURE_EVENT',
          payload: {
            kind,
            message: data.message ?? '',
            stack: data.stack ?? null,
            url: window.location.href,
            timestamp: Date.now(),
            request: data.request,
          },
        },
        window.location.origin
      );
    } finally {
      isCapturing = false;
    }
  }

  function stringifyArgs(args) {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
  }

  function captureStack() {
    const err = new Error();
    const lines = (err.stack || '').split('\n');
    const filtered = lines.filter((line, i) => i === 0 || !line.includes('main-world.js'));
    return filtered.join('\n');
  }

  console.error = function (...args) {
    emit('console.error', { message: stringifyArgs(args), stack: captureStack() });
    return originals.consoleError.apply(console, args);
  };

  console.warn = function (...args) {
    emit('console.warn', { message: stringifyArgs(args), stack: captureStack() });
    return originals.consoleWarn.apply(console, args);
  };

  const onError = (event) => {
    emit('uncaught', {
      message: event.message || String(event.error),
      stack: event.error && event.error.stack ? event.error.stack : null,
    });
  };
  window.addEventListener('error', onError);

  const onRejection = (event) => {
    const reason = event.reason;
    emit('unhandledrejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
    });
  };
  window.addEventListener('unhandledrejection', onRejection);

  window.fetch = function (...args) {
    const [resource, init] = args;
    const method = (init && init.method) || 'GET';
    const url = typeof resource === 'string' ? resource : resource?.url || String(resource);
    const start = performance.now();
    return originals.fetch.apply(window, args).then(
      (response) => {
        if (!response.ok) {
          emit('network', {
            message: `${method} ${url} -> ${response.status}`,
            stack: captureStack(),
            request: {
              method,
              url,
              status: response.status,
              statusText: response.statusText,
              durationMs: Math.round(performance.now() - start),
            },
          });
        }
        return response;
      },
      (error) => {
        emit('network', {
          message: `${method} ${url} -> ${error.message}`,
          stack: error.stack || captureStack(),
          request: {
            method,
            url,
            status: 0,
            statusText: error.message,
            durationMs: Math.round(performance.now() - start),
          },
        });
        throw error;
      }
    );
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__webErrorMonitor = { method, url, start: 0 };
    return originals.xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const meta = this.__webErrorMonitor;
    if (meta) meta.start = performance.now();
    this.addEventListener('loadend', () => {
      if (!meta) return;
      const isFailure = this.status === 0 || this.status >= 400;
      if (isFailure) {
        emit('network', {
          message: `${meta.method} ${meta.url} -> ${this.status || 'network error'}`,
          stack: captureStack(),
          request: {
            method: meta.method,
            url: meta.url,
            status: this.status,
            statusText: this.statusText,
            durationMs: Math.round(performance.now() - meta.start),
          },
        });
      }
    });
    return originals.xhrSend.apply(this, args);
  };

  function teardown() {
    console.error = originals.consoleError;
    console.warn = originals.consoleWarn;
    window.fetch = originals.fetch;
    XMLHttpRequest.prototype.open = originals.xhrOpen;
    XMLHttpRequest.prototype.send = originals.xhrSend;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('message', onWindowMessage);
    window.__webErrorMonitorInstalled = false;
  }

  function onWindowMessage(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== TAG) return;
    if (event.data.type === 'TEARDOWN') teardown();
  }
  window.addEventListener('message', onWindowMessage);
})();
```

- [ ] **Step 2: Syntax-check it**

```bash
node --check src/main-world.js
```

Expected: no output (valid syntax). This only checks parsing — it does not execute `chrome.*`/DOM code, which requires a real page (verified in Task 10).

- [ ] **Step 3: Manual smoke test via a DevTools snippet**

1. Serve and open `dev/test-page.html` (see Task 2).
2. Open DevTools → Sources → Snippets → New snippet, paste the contents of `src/main-world.js`, run it (Cmd+Enter).
3. In the DevTools Console, run `window.addEventListener('message', e => console.log(e.data))`.
4. Click each button on the test page once.
5. Confirm a `CAPTURE_EVENT` message logs for each click, with a `kind` matching the button (`uncaught`, `unhandledrejection`, `network`, `console.error`, `console.warn`).

This is a page-only smoke test (no extension APIs involved) confirming the patches work before wiring the extension plumbing around them.

- [ ] **Step 4: Commit**

```bash
git add src/main-world.js
git commit -m "Add MAIN-world console/window/fetch/XHR patches"
```

---

### Task 7: `src/content.js` — isolated-world bridge

**Files:**
- Create: `src/content.js`

**Interfaces:**
- Consumes: `window.postMessage` events tagged `__web_error_monitor__` from Task 6.
- Produces: `chrome.runtime.sendMessage({ type: 'CAPTURE_EVENT', payload, pageUrl, origin })` — consumed by Task 8 (`worker.js`). Also relays a `TEARDOWN` runtime message (sent by Task 9's toggle logic) back into the page as a `window.postMessage`.

- [ ] **Step 1: Write the implementation**

```js
// src/content.js
(() => {
  const TAG = '__web_error_monitor__';

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
    if (message && message.type === 'TEARDOWN') {
      window.postMessage({ source: TAG, type: 'TEARDOWN' }, window.location.origin);
    }
  });
})();
```

- [ ] **Step 2: Syntax-check it**

```bash
node --check src/content.js
```

Expected: no output. `chrome.*` behavior is verified end-to-end in Task 10 — it cannot run standalone since `chrome.runtime` only exists inside a loaded extension's content-script context.

- [ ] **Step 3: Commit**

```bash
git add src/content.js
git commit -m "Add isolated-world content script bridge"
```

---

### Task 8: `src/worker.js` — capture handling (normalize, fingerprint, dedupe, log)

**Files:**
- Create: `src/worker.js`

**Interfaces:**
- Consumes: `computeFingerprint` from `./lib/fingerprint.js` (Task 5), `sourceFileFromStack` from `./lib/stack.js` (Task 4), the `CAPTURE_EVENT` runtime message shape from Task 7.
- Produces: a `chrome.runtime.onMessage` listener; `chrome.storage.local` key `dedupeCounts: Record<fingerprint, number>`. Task 9 adds the toggle logic to this same file.

- [ ] **Step 1: Write the implementation**

```js
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
```

- [ ] **Step 2: Syntax-check it**

```bash
node --check src/worker.js
```

Expected: no output. Full behavior (message arrives, record logs) is verified in Task 10 once Task 9 adds the toggle logic this depends on being loaded.

- [ ] **Step 3: Commit**

```bash
git add src/worker.js
git commit -m "Add worker capture handling: normalize, fingerprint, dedupe, log"
```

---

### Task 9: `src/worker.js` — per-origin toggle logic

**Files:**
- Modify: `src/worker.js` (append to the file from Task 8)

**Interfaces:**
- Consumes: `chrome.permissions`, `chrome.scripting.registerContentScripts`/`unregisterContentScripts`, `chrome.action`, `chrome.storage.local` key `enabledOrigins: Record<origin, boolean>` (new key, alongside Task 8's `dedupeCounts`).
- Produces: `chrome.action.onClicked` toggle behavior; badge/icon state kept in sync via `chrome.tabs.onActivated`/`onUpdated`.

- [ ] **Step 1: Append the toggle logic**

```js
// appended to src/worker.js
const SCRIPT_ID_PREFIX = 'web-error-monitor';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return; // chrome:// pages, etc. can't be targeted
  }

  const enabled = await isOriginEnabled(origin);
  if (enabled) {
    await disableOrigin(origin, tab.id);
  } else {
    await enableOrigin(origin, tab.id);
  }
});

async function isOriginEnabled(origin) {
  const { enabledOrigins = {} } = await chrome.storage.local.get('enabledOrigins');
  return !!enabledOrigins[origin];
}

async function setOriginEnabled(origin, value) {
  const { enabledOrigins = {} } = await chrome.storage.local.get('enabledOrigins');
  enabledOrigins[origin] = value;
  await chrome.storage.local.set({ enabledOrigins });
}

function originPattern(origin) {
  return `${origin}/*`;
}

async function enableOrigin(origin, tabId) {
  const pattern = originPattern(origin);
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return;

  await chrome.scripting.registerContentScripts([
    {
      id: `${SCRIPT_ID_PREFIX}-main-${origin}`,
      matches: [pattern],
      js: ['src/main-world.js'],
      world: 'MAIN',
      runAt: 'document_start',
    },
    {
      id: `${SCRIPT_ID_PREFIX}-content-${origin}`,
      matches: [pattern],
      js: ['src/content.js'],
      runAt: 'document_start',
    },
  ]);

  await setOriginEnabled(origin, true);
  await refreshBadgeForTab(tabId, `${origin}/`);

  // The page already loaded before permission was granted, so inject once
  // immediately in addition to the persistent registration above.
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['src/main-world.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
}

async function disableOrigin(origin, tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'TEARDOWN' }).catch(() => {});

  await chrome.scripting
    .unregisterContentScripts({
      ids: [`${SCRIPT_ID_PREFIX}-main-${origin}`, `${SCRIPT_ID_PREFIX}-content-${origin}`],
    })
    .catch(() => {});

  await chrome.permissions.remove({ origins: [originPattern(origin)] }).catch(() => {});
  await setOriginEnabled(origin, false);
  await refreshBadgeForTab(tabId, `${origin}/`);
}

async function refreshBadgeForTab(tabId, url) {
  let enabled = false;
  if (url) {
    try {
      enabled = await isOriginEnabled(new URL(url).origin);
    } catch {
      enabled = false;
    }
  }
  await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2e7d32' });
  await chrome.action.setIcon({
    tabId,
    path: enabled
      ? { 16: 'icons/icon-on-16.png', 48: 'icons/icon-on-48.png', 128: 'icons/icon-on-128.png' }
      : { 16: 'icons/icon-off-16.png', 48: 'icons/icon-off-48.png', 128: 'icons/icon-off-128.png' },
  });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await refreshBadgeForTab(tabId, tab?.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  await refreshBadgeForTab(tabId, tab.url);
});
```

`refreshBadgeForTab` treats a missing/unreadable `url` as "not enabled," so a tab that navigates to an origin we don't have permission for correctly falls back to the off badge/icon instead of showing a stale "ON" from whatever the tab last displayed.

- [ ] **Step 2: Syntax-check the whole file**

```bash
node --check src/worker.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/worker.js
git commit -m "Add per-origin toggle: permissions, persistent injection, badge/icon"
```

---

### Task 10: End-to-end manual verification against BRIEF's acceptance criteria

**Files:** none (verification only; may produce fixup commits if something's broken)

- [ ] **Step 1: Serve the test page**

```bash
cd dev && python3 -m http.server 8000
```

- [ ] **Step 2: Load the extension unpacked**

1. Open `chrome://extensions`, enable Developer mode.
2. "Load unpacked" → select the project root (`/Users/jzhang/Documents/Projects/web-error-monitor`).
3. Confirm it loads with no manifest errors and the off-state (grey) icon shows in the toolbar.

- [ ] **Step 3: Verify off-by-default on a non-enabled origin**

1. Visit `http://localhost:8000/test-page.html` without clicking the toolbar icon.
2. Open the service worker console (`chrome://extensions` → "Inspect views: service worker").
3. Click every button on the test page.
4. Expected: **no** `[web-error-monitor]` log lines appear.

- [ ] **Step 4: Enable and verify each capture kind**

1. Click the toolbar icon on the `localhost:8000` tab.
2. Expected: a Chrome permission prompt for `http://localhost:8000/*` appears — approve it.
3. Expected: badge shows "ON", icon turns green.
4. In the service worker console, click each of the 5 buttons once.
5. Expected: exactly one `[web-error-monitor] <kind> (x1) fp=<16-hex-chars>` line per click, kinds matching `uncaught`, `unhandledrejection`, `network`, `console.error`, `console.warn`.

- [ ] **Step 5: Verify fingerprint stability across reload**

1. Reload `http://localhost:8000/test-page.html`.
2. Click "Throw uncaught error" again.
3. Expected: the logged fingerprint is **identical** to the one from Step 4, and the count is `x2`.

- [ ] **Step 6: Verify toggling off stops capture immediately**

1. Click the toolbar icon again to disable.
2. Expected: badge clears, icon turns grey.
3. Click every button on the still-open page (no reload).
4. Expected: **no** new log lines — confirms the `TEARDOWN` path actually restored the originals rather than requiring a reload.

- [ ] **Step 7: Verify persistence across navigation**

1. Re-enable the toolbar icon on `localhost:8000`.
2. Navigate to a second page on the same origin (e.g. append `?x=1` to the URL) without clicking the icon again.
3. Trigger `console.error` on the reloaded page.
4. Expected: it's still captured — confirms `registerContentScripts` is persisting injection, not just the one-shot `executeScript` call.

- [ ] **Step 8: Run the full automated test suite one more time**

```bash
npm test
```

Expected: all `src/lib` tests still pass.

- [ ] **Step 9: Final commit**

```bash
git add -A
git status
git commit -m "Complete Phase 1: capture + per-origin toggle" --allow-empty
```

(Use `--allow-empty` only if Steps 1–8 required no code changes; otherwise the preceding `git add` will have staged real fixes.)

---

## Definition of Done

All of BRIEF.md §9 Phase 1's acceptance criteria pass per Task 10: each of the five error kinds produces exactly one normalized record in the service worker console when triggered on an enabled origin, fingerprints are stable across reloads, toggling off stops capture without a page reload, and a non-enabled origin captures nothing. No HUD, no Jev classification code, and no API key handling exist anywhere in the tree.
