// src/hud/charts.js
//
// Pure DOM builders for the HUD's chart strip. Classic content script (no
// imports) — receives already-computed numbers and returns elements; owns
// no state and touches no chrome.* API. Loaded before hud.js (see
// src/worker/injection.js's registerContentScripts list).
(() => {
  if (window.__webErrorMonitorCharts) return;

  const ORIGIN_COLORS = {
    app_code: '#7c3aed',
    backend: '#f5a623',
    third_party: '#4f46e5',
    framework_noise: '#8a8a8a',
    browser_extension: '#5b6b7a',
  };
  const ORIGIN_LABELS = {
    app_code: 'App code',
    backend: 'Backend',
    third_party: 'Third-party',
    framework_noise: 'Framework noise',
    browser_extension: 'Browser ext.',
  };

  function buildOriginChart(originCounts) {
    const entries = Object.entries(originCounts).filter(([, n]) => n > 0);
    const total = entries.reduce((sum, [, n]) => sum + n, 0);

    const wrap = document.createElement('div');
    wrap.className = 'wem-chart-origin';

    const donutCol = document.createElement('div');
    donutCol.className = 'wem-donut-col';
    const donut = document.createElement('div');
    donut.className = 'wem-donut';
    if (total > 0) {
      let cumulative = 0;
      const stops = entries.map(([key, n]) => {
        const start = (cumulative / total) * 100;
        cumulative += n;
        const end = (cumulative / total) * 100;
        return `${ORIGIN_COLORS[key] || '#8a8a8a'} ${start}% ${end}%`;
      });
      donut.style.background = `conic-gradient(${stops.join(', ')})`;
    } else {
      donut.classList.add('wem-donut-empty');
    }
    const hole = document.createElement('div');
    hole.className = 'wem-donut-hole';
    hole.textContent = String(total);
    donut.appendChild(hole);
    const donutLabel = document.createElement('div');
    donutLabel.className = 'wem-chart-label';
    donutLabel.textContent = 'by origin';
    donutCol.append(donut, donutLabel);

    const legend = document.createElement('div');
    legend.className = 'wem-legend-col';
    if (total === 0) {
      const none = document.createElement('div');
      none.className = 'wem-legend-row wem-legend-none';
      none.textContent = 'no classified errors yet';
      legend.appendChild(none);
    }
    for (const [key, n] of entries) {
      const row = document.createElement('div');
      row.className = 'wem-legend-row';
      const dot = document.createElement('span');
      dot.className = 'wem-legend-dot';
      dot.style.background = ORIGIN_COLORS[key] || '#8a8a8a';
      const text = document.createElement('span');
      text.textContent = `${ORIGIN_LABELS[key] || key.replace(/_/g, ' ')} · ${Math.round((n / total) * 100)}%`;
      row.append(dot, text);
      legend.appendChild(row);
    }

    wrap.append(donutCol, legend);
    return wrap;
  }

  function buildSpendChart(hourlyBuckets) {
    const buckets = Array.isArray(hourlyBuckets) && hourlyBuckets.length ? hourlyBuckets : [0, 0, 0, 0, 0, 0];
    const max = Math.max(...buckets);

    const wrap = document.createElement('div');
    wrap.className = 'wem-chart-spend';
    const bars = document.createElement('div');
    bars.className = 'wem-spend-bars';
    buckets.forEach((value, i) => {
      const bar = document.createElement('div');
      bar.className = 'wem-spend-bar';
      const pct = max > 0 && value > 0 ? Math.max(8, Math.round((value / max) * 100)) : 4;
      bar.style.height = `${pct}%`;
      if (i === buckets.length - 1) bar.classList.add('wem-spend-bar-now');
      if (value > 0) bar.title = `$${value.toFixed(4)}`;
      bars.appendChild(bar);
    });
    const label = document.createElement('div');
    label.className = 'wem-chart-label';
    label.textContent = `spend, last ${buckets.length}h`;
    wrap.append(bars, label);
    return wrap;
  }

  window.__webErrorMonitorCharts = { buildOriginChart, buildSpendChart };
})();
