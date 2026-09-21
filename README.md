# Web Error Monitor

A Chrome (Manifest V3) extension that watches console and network activity
on pages you're actively developing and surfaces errors you'd otherwise
scroll past. See `BRIEF.md` for the full design.

**Status:** Phase 2 (capture + toggle + on-page HUD). Captured events now
surface directly on the page you're developing, in addition to being logged
to the background service worker's console.

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

## The HUD

Once the extension is enabled on a site, a small pill appears in the
bottom-right corner of the page. It shows severity-colored dot counts —
red for uncaught exceptions, unhandled rejections, and network errors;
amber for `console.error` calls; grey for everything else — so you can
tell at a glance whether anything needs attention without leaving the page.

Click the pill to expand a panel listing captured errors grouped by
fingerprint, each with an occurrence count. Click a row to expand it and
see the full stack trace, along with a "Copy" button that copies the
message, stack, and URL to your clipboard. A "Clear" button in the panel
header resets the currently visible list; counts also reset naturally on
navigation, since the HUD's in-memory state doesn't survive a page load.
The panel's collapsed/expanded state is remembered per site, so it stays
out of your way (or stays open) across reloads.

The HUD is now the primary way to see errors while developing. The service
worker console (below) remains a secondary view, useful mainly for
debugging the extension itself.

## Watch captured events (service worker console)

1. Go to `chrome://extensions`.
2. Find "Web Error Monitor" and click "Inspect views: service worker".
3. Trigger an error on the page — it will be logged as a normalized record
   in that DevTools console. This is most useful when debugging the
   extension's own capture and messaging logic, since it shows the raw
   records as they're received rather than how they render in the HUD.

## Manual test page

`dev/test-page.html` has one button per captured error kind. Serve it
locally and enable the extension on it:

```bash
cd dev && python3 -m http.server 8000
```

Then visit `http://localhost:8000/test-page.html`.

## Run the unit tests

Pure-logic modules under `src/lib/` have unit tests, run with Node's
built-in test runner (no dependencies to install):

```bash
npm test
```

## Setting the API key (Phase 3, not yet built)

N/A yet — Phase 2 has no network calls to a classification API and no key
handling of any kind.
