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
