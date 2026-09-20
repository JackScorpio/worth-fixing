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

N/A yet — Phase 1 has no network calls to a classification API and no key
handling of any kind.
