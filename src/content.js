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
