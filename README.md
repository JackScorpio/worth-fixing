# Web Error Monitor

A Chrome (Manifest V3) extension that watches console and network activity on
sites you're developing, then uses [TypeSafe](https://typesafe.ai)'s Jev model
to tell you which errors actually deserve your attention.

Browser consoles show everything at the same volume — a crash that breaks
checkout looks identical to a third-party analytics beacon failing. This
extension captures errors as they happen, asks Jev to judge each one, and
surfaces the result as an on-page dashboard: what's urgent, where it came
from, how confident the model is, and what the classification is costing you.

**Status:** working and in daily use. Not published to the Chrome Web Store —
load it unpacked (below).

---

## Requirements

- Google Chrome (or any Chromium browser with MV3 support)
- A [TypeSafe API key](https://typesafe.ai) — each person needs their own
- Node.js 20+ — only to run the unit tests; the extension itself has no build
  step and no dependencies

## Install

1. Clone this repo.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repo's root folder.
5. Pin the extension to your toolbar.

To update later: `git pull`, then hit the reload icon on the extension's card
in `chrome://extensions`.

> If **Load unpacked** is greyed out, your Chrome is managed by policy and
> developer mode is disabled — you'll need IT to allow it.

## Set your API key

Right-click the toolbar icon → **Options** (or `chrome://extensions` →
**Details** → **Extension options**). Paste your key, click **Test key** to
confirm it works, then **Save**.

The key is stored in `chrome.storage.local` on your machine only. It is never
committed, never bundled, and never sent anywhere except `api.typesafe.ai`.

You can also set a **session classification cap** here (default 200) — a hard
ceiling on how many API calls the extension will make before it stops
classifying for that browser session. It keeps a runaway page from quietly
spending money.

## Turn it on for a site

Click the toolbar icon while on the tab you want to watch. Chrome will ask you
to approve access **to that specific site** — that's deliberate; the extension
never requests access to all sites up front. Click again to turn it off.

The on/off state is remembered per origin, so a site you've enabled stays
enabled across reloads and browser restarts.

## Reading the HUD

A small pill appears bottom-right showing red / amber / grey counts. Click it
to open the dashboard.

**Header** — a live badge showing what Jev has cost you this browser session,
in dollars and input tokens. It's global across every site you're monitoring
and resets when the service worker restarts.

**Charts** — a donut breaking down where errors came from (app code, backend,
third-party, framework noise, browser extension), and a bar chart of spend
over the last six hours.

**Tabs**

| Tab | What's in it |
| --- | --- |
| **Needs attention** (default) | Red or amber priority, plus anything Jev flags as a likely silent bug. Excludes muted. |
| **All** | Everything captured, including muted. |
| **Muted** | Errors Jev attributes to framework noise or another browser extension. |

**Error cards**, sorted worst-first:

- A **priority chip** using Jev's own wording — *fix now*, *worth fixing before merge*, *safe to ignore*
- A **confidence meter** showing how sure Jev is about that priority
- An **origin chip** — app code, backend, third-party, …
- A **⚠ silent NN%** flag when Jev thinks the error could corrupt state with no
  visible symptom — the case worth catching early
- `filename:line` for the source, with the full path available on expand

A **dashed border** means Jev answered with low confidence (< 50%). The
verdict is still used for placement and color, but the dashes tell you it's a
soft call. One exception: a genuine crash (`uncaught` / `unhandledrejection`)
that Jev only tentatively rates as ignorable stays red and un-muted until Jev
is confident — a shaky guess can't bury a real crash.

Click any card to expand it: full message, Jev's complete answers with
confidence percentages, the stack trace, and a **Copy** button that puts the
message, stack, and URL on your clipboard.

## What gets sent to Jev

For each distinct error, one request to `https://api.typesafe.ai/v1/systemone`
containing:

| Field | Value |
| --- | --- |
| `message` | the error message |
| `stack` | the stack trace |
| `source_file` | file, line, and column |
| `kind` | `uncaught`, `unhandledrejection`, `network`, `console.error`, `console.warn` |
| `page_url` | the URL of the page the error happened on |

These are sent **as-is, unredacted**. Error messages, stack traces, and URLs
routinely contain user IDs, emails, and tokens in query strings — so be
deliberate about which sites you enable this on, especially anything with
production data. Nothing is sent for sites you haven't explicitly enabled, and
nothing is sent anywhere other than TypeSafe.

## What it costs

Jev charges **$0.042 per million input tokens** — output tokens are free. A
typical classification is a few hundred tokens, so a busy session runs a
fraction of a cent. Three mechanisms keep it that way:

1. **Classify once, ever.** Results are cached by error fingerprint in
   `chrome.storage.local`. The same error recurring — on reload, in another
   tab, tomorrow — never costs a second call.
2. **Quiet-flush debounce.** Requests fire about a second after errors stop
   arriving, so a burst doesn't become a burst of API calls.
3. **Session cap.** Configurable in options, 200 by default. On hitting it the
   extension keeps capturing and displaying errors; it just stops classifying.

Failures are cached too, with a cooldown, so a bad key or malformed request
can't turn into a retry loop.

---

## Development

No build step — the files you edit are the files Chrome runs. After changing
anything under `src/`, reload the extension in `chrome://extensions` (and
reload the page for content-script changes).

### Layout

```
src/
├── main-world.js       patches console/fetch/XHR in the page's own JS context
├── content.js          isolated-world bridge: page <-> service worker
├── worker.js           service worker entry point
├── worker/
│   ├── injection.js    per-origin toggle, permissions, toolbar icon/badge
│   ├── capture.js      capture -> normalize -> fingerprint -> dedupe -> relay
│   ├── classification.js  Jev calls: cache, debounce, session cap, retry/backoff
│   └── usage.js        session spend tracking and broadcast
├── lib/                pure logic, unit-tested (see below)
├── hud/                on-page dashboard (classic scripts, no modules)
└── options/            API key + session cap page
```

`src/lib/` holds everything that can be tested without a browser —
fingerprinting, message normalization, stack parsing, dedupe, Jev
request/response handling, cost math. Anything touching `chrome.*` lives
outside it.

### Tests

```bash
npm test
```

Node's built-in runner, no dependencies to install. It covers `src/lib/` only;
the `chrome.*` layers are verified by hand (below).

New logic in `src/lib/` should be test-first — write the failing test, watch it
fail, then implement.

### Manual testing

`dev/test-page.html` has one button per error kind (uncaught throw, promise
rejection, 404 fetch, `console.error`, `console.warn`):

```bash
cd dev && python3 -m http.server 8000
```

Then enable the extension on `http://localhost:8000/test-page.html`.

`dev/hud-harness.html` renders the HUD on its own with a stubbed `chrome` API
and sample classified errors — the fast way to iterate on the dashboard
without triggering real errors or spending tokens. Serve the **repo root**:

```bash
python3 -m http.server 8001
```

Then open `http://localhost:8001/dev/hud-harness.html`.

### Icons

```bash
node scripts/generate-icons.mjs
```

Regenerates all six PNGs from code — no image editor needed.

### Conventions

- `src/hud/*.js` and `src/content.js` are **classic content scripts** — they
  can't use `import`. They share state through `window.__webErrorMonitor*`
  globals, and anything needing `src/lib/` logic has it precomputed by the
  service worker and passed over in a message.
- Reads and writes to shared `chrome.storage` keys are serialized through a
  promise-chain mutex (see `cacheQueue` in `worker/classification.js`); follow
  that pattern for any new shared key.
- The classification pipeline never throws — every failure path degrades to
  "unclassified" and leaves the raw error visible.

### Background reading

`BRIEF.md` is the original design brief and still describes the architecture
accurately. `docs/superpowers/` holds the specs and implementation plans for
each phase.

## Contributing

Issues and pull requests welcome. Please run `npm test` before opening a PR,
and add tests for anything new in `src/lib/`. For UI changes, a before/after
screenshot from `dev/hud-harness.html` makes review much easier.
