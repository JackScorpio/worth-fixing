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

  function buildRow(fingerprint, entry) {
    const { record, count, expanded } = entry;
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
    detail.hidden = !expanded;
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
      entry.expanded = !entry.expanded;
      detail.hidden = !entry.expanded;
    });

    row.append(summary, source, detail);
    return row;
  }

  function renderList() {
    els.list.replaceChildren();
    const entries = Array.from(groups.entries()).sort(
      (a, b) => b[1].record.timestamp - a[1].record.timestamp
    );
    for (const [fingerprint, entry] of entries) {
      els.list.appendChild(buildRow(fingerprint, entry));
    }
  }

  function render(record) {
    if (!els) return;
    const existing = groups.get(record.fingerprint);
    groups.set(record.fingerprint, {
      record,
      count: (existing ? existing.count : 0) + 1,
      expanded: existing ? existing.expanded : false,
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
