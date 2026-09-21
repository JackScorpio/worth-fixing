// src/hud/hud.js
(() => {
  if (window.__webErrorMonitorHudInstalled) return;
  window.__webErrorMonitorHudInstalled = true;

  const MAX_MESSAGE_LENGTH = 80;

  let hostEl = null;
  let shadowRoot = null;
  let els = null; // { pill, countRed, countAmber, countGrey, panel, list, tabButtons }
  let groups = new Map(); // fingerprint -> { record, count }
  let collapsed = true;
  let activeTab = 'needsAttention'; // 'needsAttention' | 'all' | 'muted'
  let currentOrigin = null;

  function truncate(message) {
    if (!message) return '';
    return message.length > MAX_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
      : message;
  }

  function kindColor(kind) {
    if (kind === 'uncaught' || kind === 'unhandledrejection' || kind === 'network') return 'red';
    if (kind === 'console.error') return 'amber';
    return 'grey';
  }

  // classification.displayColor is precomputed worker-side (src/worker/classification.js)
  // from the raw Jev answers — this file never does Jev-specific bucketing itself,
  // since it's a classic script and can't import src/lib/jev.js's ES module exports.
  function severityColor(record) {
    return record.classification?.displayColor || kindColor(record.kind);
  }

  function isMuted(record) {
    return !!record.classification?.muted;
  }

  function needsAttention(record) {
    if (isMuted(record)) return false;
    const color = severityColor(record);
    if (color === 'red' || color === 'amber') return true;
    const silentProb = record.classification?.silentBug?.probability;
    return typeof silentProb === 'number' && silentProb > 0.5;
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
    const usageBadge = document.createElement('span');
    usageBadge.className = 'wem-usage-badge';
    usageBadge.textContent = '$0.0000 · 0 tok';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'wem-header-left';
    headerLeft.append(title, usageBadge);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', clear);
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.textContent = '×';
    collapseBtn.addEventListener('click', () => setCollapsed(true));
    const headerRight = document.createElement('div');
    headerRight.className = 'wem-header-right';
    headerRight.append(clearBtn, collapseBtn);
    header.append(headerLeft, headerRight);

    const tabsEl = document.createElement('div');
    tabsEl.className = 'wem-tabs';
    const tabButtons = {
      needsAttention: document.createElement('button'),
      all: document.createElement('button'),
      muted: document.createElement('button'),
    };
    for (const [tab, btn] of Object.entries(tabButtons)) {
      btn.type = 'button';
      btn.className = 'wem-tab';
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => setActiveTab(tab));
      tabsEl.appendChild(btn);
    }

    const list = document.createElement('div');
    list.className = 'wem-list';

    panel.append(header, tabsEl, list);

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

    els = { pill, countRed, countAmber, countGrey, panel, list, tabButtons, usageBadge };
  }

  function applyCollapsed(value) {
    if (!els) return;
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

  const TAB_LABELS = { needsAttention: 'Needs attention', all: 'All', muted: 'Muted' };

  function setActiveTab(tab) {
    activeTab = tab;
    applyActiveTabStyle();
    renderList();
  }

  function applyActiveTabStyle() {
    if (!els) return;
    for (const [tab, btn] of Object.entries(els.tabButtons)) {
      const isActive = tab === activeTab;
      btn.classList.toggle('wem-tab-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    }
  }

  function renderCounts() {
    let red = 0;
    let amber = 0;
    let grey = 0;
    let needsAttentionCount = 0;
    let mutedCount = 0;
    for (const { record } of groups.values()) {
      if (isMuted(record)) {
        mutedCount++;
        continue;
      }
      const color = severityColor(record);
      if (color === 'red') red++;
      else if (color === 'amber') amber++;
      else grey++;
      if (needsAttention(record)) needsAttentionCount++;
    }
    els.countRed.textContent = String(red);
    els.countAmber.textContent = String(amber);
    els.countGrey.textContent = String(grey);

    els.tabButtons.needsAttention.textContent = `${TAB_LABELS.needsAttention} (${needsAttentionCount})`;
    els.tabButtons.all.textContent = `${TAB_LABELS.all} (${groups.size})`;
    els.tabButtons.muted.textContent = `${TAB_LABELS.muted} (${mutedCount})`;
  }

  // Renders Jev's actual per-question answers (not just the summary color
  // dot) for the row's expanded detail. Returns null when there's nothing
  // to show — not yet classified, or a negatively-cached failure marker
  // (see src/worker/classification.js's cacheFailure) which has no
  // priority/origin/silentBug fields to render.
  function buildJevDetail(classification) {
    if (!classification || classification.failed) return null;
    const rows = [];
    if (classification.priority) {
      const { score, legend, confidence } = classification.priority;
      const label = legend && legend[Math.round(score)] ? legend[Math.round(score)] : `score ${score}`;
      rows.push(['Priority', `${label} (${Math.round((confidence ?? 0) * 100)}% confidence)`]);
    }
    if (classification.origin) {
      const { choice, confidence } = classification.origin;
      const choiceLabel = typeof choice === 'string' ? choice.replace(/_/g, ' ') : String(choice ?? 'unknown');
      rows.push(['Origin', `${choiceLabel} (${Math.round((confidence ?? 0) * 100)}% confidence)`]);
    }
    if (classification.silentBug) {
      rows.push(['Silent bug risk', `${Math.round(classification.silentBug.probability * 100)}%`]);
    }
    if (rows.length === 0) return null;

    const container = document.createElement('div');
    container.className = 'wem-jev-detail';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'wem-jev-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'wem-jev-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'wem-jev-value';
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      container.appendChild(row);
    }
    return container;
  }

  function buildRow(fingerprint, entry) {
    const { record, count, expanded } = entry;
    const row = document.createElement('div');
    row.className = 'wem-row';
    row.dataset.fingerprint = fingerprint;

    const summary = document.createElement('div');
    summary.className = 'wem-row-summary';
    const dot = document.createElement('span');
    dot.className = `wem-dot wem-dot-${severityColor(record)}`;
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
    const detailChildren = [];
    // The row summary truncates the message to MAX_MESSAGE_LENGTH. Many
    // real console.warn/console.error calls log a message plus a data
    // object (e.g. `console.warn('Unknown type', {status, uuid, ...})`),
    // and stringifyArgs (main-world.js) concatenates all of that into one
    // long message string — truncation can hide the actual diagnostic
    // payload entirely, with no other place in the UI to see it. Show the
    // full message on expand whenever it was actually truncated; skip it
    // when the summary already shows the whole thing, to avoid repeating
    // short messages twice.
    if (record.message && record.message.length > MAX_MESSAGE_LENGTH) {
      const fullMessage = document.createElement('pre');
      fullMessage.className = 'wem-row-full-message';
      fullMessage.textContent = record.message;
      detailChildren.push(fullMessage);
    }
    const jevDetail = buildJevDetail(record.classification);
    if (jevDetail) detailChildren.push(jevDetail);
    const stack = document.createElement('pre');
    stack.className = 'wem-row-stack';
    stack.textContent = record.stack || '(no stack available)';
    detailChildren.push(stack);
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'wem-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const text = `${record.message}\n\n${record.stack || ''}\n\n${record.url}`;
      navigator.clipboard.writeText(text).catch(() => {});
    });
    detailChildren.push(copyBtn);
    detail.append(...detailChildren);

    summary.addEventListener('click', () => {
      entry.expanded = !entry.expanded;
      detail.hidden = !entry.expanded;
    });

    row.append(summary, source, detail);
    return row;
  }

  function filterForActiveTab(entries) {
    if (activeTab === 'all') return entries;
    if (activeTab === 'muted') return entries.filter(([, entry]) => isMuted(entry.record));
    return entries.filter(([, entry]) => needsAttention(entry.record));
  }

  const EMPTY_TAB_MESSAGES = {
    needsAttention: 'Nothing needs attention right now.',
    all: 'No errors captured yet.',
    muted: 'Nothing muted yet.',
  };

  function renderList() {
    els.list.replaceChildren();
    const entries = Array.from(groups.entries()).sort(
      (a, b) => b[1].record.timestamp - a[1].record.timestamp
    );
    const visibleEntries = filterForActiveTab(entries);
    if (visibleEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wem-empty';
      empty.textContent = EMPTY_TAB_MESSAGES[activeTab] || 'Nothing here.';
      els.list.appendChild(empty);
      return;
    }
    for (const [fingerprint, entry] of visibleEntries) {
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

  function updateClassification(fingerprint, classification) {
    if (!els) return;
    const entry = groups.get(fingerprint);
    if (!entry) return; // the row may have been cleared before classification arrived
    entry.record = { ...entry.record, classification };
    renderCounts();
    renderList();
  }

  function updateUsage(costLabel, tokenLabel) {
    if (!els) return;
    els.usageBadge.textContent = `${costLabel} · ${tokenLabel}`;
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
    applyActiveTabStyle();
    renderCounts(); // paints "Needs attention (0)" etc. immediately, before any error arrives
    chrome.storage.local.get('hudState').then(({ hudState = {} }) => {
      const originState = hudState[origin];
      applyCollapsed(originState ? originState.collapsed : true);
    });
    // Cost is global (all origins), so a HUD opened on any page needs the
    // running total that may already exist from other tabs — fetched once
    // here, kept current afterward by the USAGE_UPDATE broadcast.
    chrome.runtime
      .sendMessage({ type: 'GET_USAGE' })
      .then((summary) => {
        if (summary) updateUsage(summary.costLabel, summary.tokenLabel);
      })
      .catch(() => {
        // Service worker may be asleep or the extension was reloaded; the
        // badge keeps its "$0.0000 · 0 tok" initial text until the next
        // USAGE_UPDATE broadcast catches it up.
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
    activeTab = 'needsAttention';
    window.__webErrorMonitorHudInstalled = false;
  }

  window.__webErrorMonitorHud = { init, render, clear, teardown, updateClassification, updateUsage };
})();
