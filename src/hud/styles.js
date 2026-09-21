// src/hud/styles.js
window.__webErrorMonitorHudCss = `
  :host { all: initial; }
  .wem-root {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 2147483647;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    color: #e6e6e6;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .wem-pill {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(20, 20, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    color: inherit;
  }
  .wem-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .wem-dot-red { background: #e5484d; }
  .wem-dot-amber { background: #f5a623; }
  .wem-dot-grey { background: #8a8a8a; }
  .wem-panel {
    pointer-events: auto;
    margin-bottom: 8px;
    width: 400px;
    max-height: 560px;
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 20, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .wem-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 600;
  }
  .wem-header-left,
  .wem-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wem-usage-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 999px;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: #fff;
  }
  .wem-panel-header button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
  }
  .wem-list {
    overflow-y: auto;
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .wem-card {
    background: rgba(255, 255, 255, 0.04);
    border-left: 3px solid #8a8a8a;
    border-radius: 6px;
    padding: 7px 9px;
  }
  .wem-card-red { border-left-color: #e5484d; }
  .wem-card-amber { border-left-color: #f5a623; }
  .wem-card-grey { border-left-color: #8a8a8a; opacity: 0.9; }
  .wem-row-summary {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .wem-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wem-row-count {
    opacity: 0.6;
    font-size: 10px;
    margin-left: auto;
  }
  .wem-row-message {
    font-size: 12px;
    color: #f0f0f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wem-card-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .wem-row-source {
    flex: 1;
    min-width: 0;
    opacity: 0.5;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
  }
  .wem-row-fullsource {
    font-size: 10px;
    opacity: 0.6;
    word-break: break-all;
    margin: 0 0 6px;
  }
  .wem-row-detail {
    margin-top: 8px;
  }
  .wem-chip {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.3px;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .wem-chip-red { background: rgba(229, 72, 77, 0.18); color: #ff7b7f; }
  .wem-chip-amber { background: rgba(245, 166, 35, 0.18); color: #f5a623; }
  .wem-chip-grey { background: rgba(255, 255, 255, 0.08); color: #aaa; }
  .wem-chip-pending { animation: wem-pulse 1.4s ease-in-out infinite; }
  .wem-card-lowconf { border-left-style: dashed; }
  .wem-chip-lowconf {
    opacity: 0.7;
    outline: 1px dashed currentColor;
    outline-offset: -1px;
  }
  .wem-chip-origin {
    background: rgba(124, 58, 237, 0.18);
    color: #c4a6ff;
    text-transform: none;
    font-weight: 600;
  }
  .wem-chip-silent {
    background: rgba(245, 166, 35, 0.12);
    color: #f5a623;
    text-transform: none;
    font-weight: 600;
  }
  @keyframes wem-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  .wem-conf {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    color: #999;
  }
  .wem-conf b {
    display: inline-block;
    width: 40px;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .wem-conf b::after {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--w, 0%);
    background: linear-gradient(90deg, #7c3aed, #a78bfa);
    border-radius: 2px;
  }
  .wem-tabs {
    display: flex;
    gap: 4px;
    padding: 6px 10px 0 10px;
  }
  .wem-tab {
    flex: 1;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.55;
    cursor: pointer;
    font-size: 10px;
    padding: 6px 4px;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .wem-tab-active {
    opacity: 1;
    font-weight: 600;
    border-bottom-color: #7c3aed;
  }
  .wem-empty {
    padding: 20px 10px;
    text-align: center;
    opacity: 0.5;
    font-size: 11px;
  }
  .wem-chart-strip {
    display: flex;
    gap: 12px;
    align-items: center;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    padding: 10px;
    margin: 8px 10px 0;
  }
  .wem-chart-origin {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .wem-donut-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .wem-donut {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wem-donut-empty { background: rgba(255, 255, 255, 0.08); }
  .wem-donut-hole {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #141417;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wem-legend-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .wem-legend-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    color: #ccc;
    white-space: nowrap;
  }
  .wem-legend-none { opacity: 0.5; }
  .wem-legend-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .wem-chart-spend {
    flex-shrink: 0;
    width: 96px;
    display: flex;
    flex-direction: column;
  }
  .wem-spend-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 40px;
  }
  .wem-spend-bar {
    flex: 1;
    background: rgba(124, 58, 237, 0.45);
    border-radius: 2px;
    min-height: 2px;
    transition: height 0.3s ease;
  }
  .wem-spend-bar-now { background: #7c3aed; }
  .wem-chart-label {
    font-size: 9px;
    opacity: 0.6;
    margin-top: 4px;
    text-align: center;
  }
  .wem-jev-detail {
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: rgba(124, 58, 237, 0.08);
    border: 1px solid rgba(124, 58, 237, 0.25);
    border-radius: 4px;
    padding: 6px 8px;
    margin: 0 0 6px 0;
    font-size: 11px;
  }
  .wem-jev-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .wem-jev-label {
    opacity: 0.65;
  }
  .wem-jev-value {
    text-align: right;
  }
  .wem-row-full-message {
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.3);
    padding: 6px;
    border-radius: 4px;
    max-height: 160px;
    overflow-y: auto;
    font-size: 11px;
    margin: 0 0 6px 0;
  }
  .wem-row-stack {
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.3);
    padding: 6px;
    border-radius: 4px;
    max-height: 160px;
    overflow-y: auto;
    font-size: 11px;
  }
  .wem-copy-btn {
    margin-top: 4px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: inherit;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  [hidden] { display: none !important; }
`;
