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
    } catch {
      // Instrumentation must never break the host page: if postMessage (or
      // anything above) throws, swallow it silently and let the caller's
      // original behavior proceed exactly as if emit() had succeeded.
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
    try {
      const err = new Error();
      const lines = (err.stack || '').split('\n');
      const filtered = lines.filter((line, i) => i === 0 || !line.includes('main-world.js'));
      return filtered.join('\n');
    } catch {
      // Dev tooling this extension targets (Vite/HMR, Zone.js, Sentry-style
      // long-stack-trace libraries) commonly patches Error.prepareStackTrace
      // or Error.prototype.stack. This now runs synchronously ahead of the
      // real fetch()/XMLHttpRequest.send() call, so a throw here must never
      // propagate — it would make the wrapped fetch() throw synchronously,
      // violating its contract, and prevent the real network call from ever
      // firing.
      return '';
    }
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
    // Captured here, synchronously at the call site, not inside the .then()/
    // .catch() below: by the time those async callbacks run, the real
    // caller's stack is gone (only microtask frames remain), which used to
    // make every network event's sourceFile null.
    const callSiteStack = captureStack();
    return originals.fetch.apply(window, args).then(
      (response) => {
        // Opaque responses (mode: 'no-cors', e.g. analytics beacons, third-
        // party fonts) and opaque redirects always report status 0 and
        // ok: false even on success — they are not failures.
        if (!response.ok && response.type !== 'opaque' && response.type !== 'opaqueredirect') {
          emit('network', {
            message: `${method} ${url} -> ${response.status}`,
            stack: callSiteStack,
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
          stack: error.stack || callSiteStack,
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
    this.__webErrorMonitor = { method, url, start: 0, stack: null };
    return originals.xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const meta = this.__webErrorMonitor;
    if (meta) {
      meta.start = performance.now();
      // Captured here, synchronously at send() time, for the same reason as
      // the fetch call site above — the loadend listener below only runs
      // once the request finishes, well after this stack is gone.
      meta.stack = captureStack();
    }
    this.addEventListener(
      'loadend',
      () => {
        if (!meta) return;
        const isFailure = this.status === 0 || this.status >= 400;
        if (isFailure) {
          emit('network', {
            message: `${meta.method} ${meta.url} -> ${this.status || 'network error'}`,
            stack: meta.stack,
            request: {
              method: meta.method,
              url: meta.url,
              status: this.status,
              statusText: this.statusText,
              durationMs: Math.round(performance.now() - meta.start),
            },
          });
        }
      },
      { once: true }
    );
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
