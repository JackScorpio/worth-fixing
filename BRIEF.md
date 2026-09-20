# BRIEF — Console & Network Error Monitor (Chrome Extension)

> **Instructions for Claude Code:** Read this whole file first. Then build
> **Phase 1 only** and stop. Do not implement the Jev classification layer
> until I explicitly ask. Ask me before adding any dependency or build step.

---

## 1. Goal

A Chrome extension that watches the console and network activity of a page I'm
developing, and surfaces errors I would otherwise scroll past. Small HUD pinned
to the bottom-right corner of the page.

The problem it solves: during manual testing I don't keep DevTools open, and
quiet errors slip by — React state warnings, key warnings, failed background
fetches. They don't break the visible UI, so I ignore them, but they're often
real bugs. I want something that taps me on the shoulder.

Later (Phase 3) each error gets classified by the TypeSafe **Jev** API for
priority and origin, so framework noise collapses out of the way and real app
bugs stand out.

**Primary user: me, one developer.** Not a product. Optimise for "works on my
machine, fast to iterate" over generality.

---

## 2. Constraints & non-goals

- **Manifest V3.**
- **Vanilla JS/TS + CSS. No React, no bundler, no framework** unless I approve
  it. This must stay loadable as an unpacked folder with zero build step.
- **Never modifies the target web app.** Nothing is imported into my frontend
  project. The extension is browser-level and works on any origin I enable it
  for, including production sites I don't own the source of.
- **Do NOT use `chrome.debugger` / CDP.** Only one debugger client can attach
  at a time, so it conflicts with DevTools being open. Disqualifying for a tool
  used while actively developing.
- **The API key must never be in the repo or the bundle.** Options page only,
  stored in `chrome.storage.local`.
- Not published to the Web Store for now. Loaded unpacked. (May later go
  "unlisted" so I can install it on a second machine — so don't hardcode
  anything machine-specific.)

---

## 3. Architecture

Three execution contexts. The split is forced by Chrome's isolation model:
console patching must happen in the page's own JS context (MAIN world), but
only the ISOLATED world can talk to the extension.

```
┌─ MAIN world (injected at document_start) ───────────────┐
│  Patches:                                               │
│    console.error / console.warn                         │
│    window.onerror                                       │
│    window.onunhandledrejection                          │
│    window.fetch                                         │
│    XMLHttpRequest                                       │
│  Emits events via window.postMessage                    │
└───────────────────────────┬─────────────────────────────┘
                            │ window.postMessage
                            ▼
┌─ Content script (ISOLATED world) ───────────────────────┐
│  Bridge: validates + forwards messages                  │
│  Renders the HUD inside a shadow root                   │
└───────────────────────────┬─────────────────────────────┘
                            │ chrome.runtime.sendMessage
                            ▼
┌─ Service worker (background) ───────────────────────────┐
│  Fingerprint + dedupe                                   │
│  Classification cache (chrome.storage.local)            │
│  Debounced flush → api.typesafe.ai   [Phase 3]          │
│  Holds the API key — the page never sees it             │
└─────────────────────────────────────────────────────────┘
```

**MAIN world injection** is declared with `"world": "MAIN"` and
`"run_at": "document_start"` so we catch errors that fire before the app mounts.

---

## 4. Per-site toggle (important)

The extension must be **off everywhere by default** and enabled per-origin by
clicking the toolbar icon.

- Use `activeTab` + `chrome.scripting.executeScript` for programmatic
  injection. Do **not** use a static `content_scripts` match list, and do not
  request `<all_urls>` host permissions.
- Clicking the toolbar icon toggles the current origin on/off.
- Persist the set of enabled origins in `chrome.storage.local` (key:
  `enabledOrigins`) so it survives browser restarts and applies automatically
  on subsequent visits to that origin.
- Reflect state in the toolbar badge (e.g. "ON" / blank) and icon variant.

Rationale: I browse plenty of sites I don't own. I don't want their console
noise in my HUD, and in Phase 3 I definitely don't want their page data going
to a third-party API.

---

## 5. What gets captured

Each captured event is normalised into:

```js
{
  id,                 // uuid
  kind,               // "console.error" | "console.warn" | "uncaught"
                      // | "unhandledrejection" | "network"
  message,            // string, stringified args for console.*
  stack,              // string | null
  sourceFile,         // best-effort from stack
  origin,             // page origin
  url,                // full page url
  timestamp,
  // network only:
  request: { method, url, status, statusText, durationMs },
  fingerprint         // see below
}
```

### Fingerprint

`sha256(kind + normalisedMessage + topStackFrame + sourceFile)`, truncated.

`normalisedMessage` strips obvious variable parts before hashing: numbers,
UUIDs, hex ids, quoted strings longer than ~40 chars. The goal is that the same
logical error across reloads produces the same fingerprint.

The fingerprint is the backbone of the whole design — it drives dedupe in the
HUD *and* the classification cache in Phase 3.

### Network capture

Wrap `fetch` and `XMLHttpRequest`. Record only failures and non-2xx responses
by default.

**Metadata only.** Do not capture request or response bodies, headers, cookies,
or auth tokens. Body capture may be added later as an explicit opt-in setting,
off by default — my dev environment has real tokens in flight, and I may point
this at production.

---

## 6. HUD

- Rendered by the content script into a **shadow root** (`attachShadow({mode:
  'closed'})`) on a container appended to `document.documentElement`. This is
  non-negotiable — without it my app's CSS and the HUD's CSS corrupt each
  other.
- Fixed position, bottom-right, high z-index, `pointer-events` scoped so it
  never blocks the page when collapsed.
- **Collapsed state:** a small pill with counts by severity, e.g. `3 ● 7 ● 22 ●`
  (red / amber / grey). In Phase 1, before classification exists, use:
  red = uncaught + unhandledrejection + network failures, amber =
  `console.error`, grey = `console.warn`.
- **Expanded state:** scrollable list, newest first, grouped by fingerprint with
  an occurrence count badge. Each row shows message (truncated), source file,
  and count.
- Clicking a row expands it to show the full stack, with a **"Copy" button**
  that puts message + stack + url on the clipboard.
- A **clear** button, and a count that resets on navigation but keeps the
  classification cache.
- Persist collapsed/expanded state per origin.
- Keep it visually quiet. Dark, semi-transparent, small type. It sits on top of
  the UI I'm testing, so it must not distract.

---

## 7. Jev classification layer — **PHASE 3, do not build yet**

Documented here so the earlier phases are structured to accommodate it.

### API shape

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Request: `{ state, model, questions }` — `state` is a string, object, or array;
`questions` is a map of ids I choose. Answers come back under the same ids.

Use `"model": "jev-1.13.0"` — pin the version, don't use the `jev-latest`
alias, because I'll be tuning confidence thresholds against a specific version.

Three question types: `noul` (yes/no → probability), `choice` (one of N →
chosen option + full distribution + confidence), `score` (ordered levels →
weighted value + distribution + confidence).

### Question set

Jev ingests the `state` once and evaluates all questions against it in
parallel, so extra questions are nearly free. Ask all of these in **one**
request per error:

```json
{
  "state": {
    "message": "Cannot read properties of undefined (reading 'map')",
    "stack": "...",
    "source_file": "src/components/OrderList.tsx",
    "kind": "uncaught",
    "page_url": "http://localhost:3000/orders",
    "recent_console": ["...", "..."],
    "related_requests": [{ "url": "/api/orders", "status": 500 }]
  },
  "model": "jev-1.13.0",
  "questions": {
    "priority": {
      "type": "score",
      "instructions": "How urgently should the developer fix this?",
      "criteria": [
        "Cosmetic or informational, safe to ignore",
        "Real issue but non-blocking, worth fixing before merge",
        "Breaks user-visible functionality, fix now"
      ]
    },
    "origin": {
      "type": "choice",
      "instructions": "Where does this error originate?",
      "criteria": {
        "app_code": "The developer's own application code",
        "third_party": "A vendored library or external script",
        "framework_noise": "Dev-mode warning from React, Vite, or HMR tooling",
        "browser_extension": "Injected by another browser extension",
        "backend": "The frontend surfacing a server-side failure"
      }
    },
    "silent_bug": {
      "type": "noul",
      "instructions": "Is this the kind of error that causes a real bug without any visible symptom in the UI?",
      "criteria": {
        "true": "Likely to corrupt state, drop data, or misbehave invisibly",
        "false": "Either harmless, or would be obvious from looking at the page"
      }
    }
  }
}
```

`origin` is the question that earns its keep — a dev console is mostly
framework chatter, and the value of this tool is pulling my three real bugs out
of that. `framework_noise` and `browser_extension` collapse into a muted
section by default.

`silent_bug` maps directly to the reason I'm building this: the errors I'd
otherwise never notice should be promoted in the HUD even at moderate priority.

### Using the answers

- Severity colour comes from `priority.score` bucketed into three bands.
- **Confidence gates display, not just priority.** If `origin.confidence` or
  `priority.confidence` is below ~0.5, show the raw error with no label rather
  than a wrong label. A confidently wrong classification is worse than none
  when I'm debugging. Start conservative and tune against real data.
- Log the full `probabilities` map and `confidence` alongside the verdict in
  `chrome.storage.local`, not just the final label — that log is what lets me
  tune thresholds later.

### Cost & rate control

Pricing is $0.042 per million **input** tokens, output free. A thousand
classified errors a day at ~500 tokens each is well under a cent. **Cost is not
the constraint — noise and latency are.** Three mechanisms, in priority order:

1. **Fingerprint cache.** Key classifications by fingerprint in
   `chrome.storage.local`. The same React warning firing 200 times across
   reloads is classified exactly once, ever. This does most of the work.
2. **Quiet-flush debounce.** Buffer new (uncached) errors and flush ~1s after
   the last one arrives, so a render cascade of 30 related errors becomes one
   batch rather than 30 requests.
3. **Session cap.** A configurable ceiling (default 200 classifications per
   browser session). On hitting it, keep capturing and showing raw errors but
   stop calling the API, and surface that state in the HUD.

Also: `state` is text only — no images. Context limit is 64k tokens per
request, 32k for `state` plus the longest single question. Truncate long stacks
before sending.

### Error handling

`401` invalid key → surface in HUD, prompt to open options. `422` → log the
offending field, don't retry. `429` / `529` → exponential backoff, and degrade
to raw unclassified display rather than dropping the error. Rate limits on this
API are explicitly adjusting without notice, so the fallback path matters.

---

## 8. Gotchas — read these before writing code

1. **Recursion guard on the console patch.** Any internal logging will re-enter
   `console.error`. Use a module-level flag, or capture the original references
   before patching and use those internally.
2. **Stacks from `console.error`.** The args often carry no stack. Synthesise
   one with `new Error().stack` inside the patch and drop the top frames that
   belong to the patch itself.
3. **`fetch` wrapping must not break the page.** Return the original `Response`
   untouched. Only `.clone()` if you actually need the body, and by default you
   don't.
4. **Service worker lifetime.** MV3 workers are killed after ~30s idle. Keep
   **all** state in `chrome.storage`, never in module-scope variables. Assume
   the worker restarts between any two messages.
5. **`postMessage` hygiene.** Tag every message with a namespaced type and
   validate `event.source === window` plus the tag in the content script. The
   page can post anything.
6. **CSP.** Some sites have strict CSP that affects injected scripts. The MAIN
   world declaration in the manifest handles this correctly; inline `<script>`
   injection does not. Use the manifest approach.
7. **`localhost` needs explicit host permission** — it isn't covered by the
   usual patterns.
8. **Don't patch anything before capturing the originals**, and expose a
   teardown that restores them when the origin is toggled off.
9. **Source maps.** On production/minified sites, stacks look like
   `t.default is not a function` at `main.a3f9c2.js:1:48211`. Don't try to
   resolve them in Phase 1. Note it in the UI so I know the file attribution is
   unreliable there.

---

## 9. Build phases

### Phase 1 — capture + toggle  ← **BUILD THIS ONLY**

- Manifest, icons, folder structure.
- Toolbar icon toggles injection for the current origin; persisted in
  `chrome.storage.local`; badge reflects state.
- MAIN-world patches for all five sources.
- postMessage bridge to the content script, `chrome.runtime.sendMessage` to the
  worker.
- Worker normalises, fingerprints, dedupes, and logs to its own console.
- **No HUD yet. No Jev. No API key handling.**

**Acceptance:** with the extension enabled on `localhost`, I trigger each of —
a thrown error, a rejected promise, a failed `fetch`, a `console.error`, a
`console.warn` — and see exactly one normalised record each in the service
worker console, with a stable fingerprint across page reloads. Toggling off
stops capture. A non-enabled origin captures nothing.

### Phase 2 — HUD

Shadow-root panel, collapsed/expanded, grouping by fingerprint with counts,
copy button, clear. Severity by `kind` heuristic only. **This alone should
already be useful — I want to run it for a day before Phase 3.**

### Phase 3 — Jev layer

Options page for the API key, classification call, fingerprint cache, quiet
flush, session cap, confidence gating, muted section for framework noise.

### Phase 4 — optional, later

Source-map resolution, per-project rule overrides, export session as a bug
report, opt-in body capture.

---

## 10. Repo conventions

- Flat and obvious: `manifest.json`, `src/main-world.js`, `src/content.js`,
  `src/worker.js`, `src/hud/`, `src/options/`, `src/lib/`.
- `.gitignore` must exclude anything key-shaped. No `.env`. No key in
  `manifest.json`.
- Short `README.md`: how to load unpacked, how to toggle, how to set the key.
