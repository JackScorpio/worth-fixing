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
    width: 360px;
    max-height: 420px;
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
  }
  .wem-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding: 6px 10px;
  }
  .wem-row-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .wem-row-message {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wem-row-count {
    opacity: 0.7;
  }
  .wem-row-source {
    opacity: 0.5;
    font-size: 11px;
    margin-top: 2px;
    margin-left: 14px;
  }
  .wem-row-detail {
    margin-top: 6px;
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
