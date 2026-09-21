// src/worker/usage.js
//
// Global (all-origins), session-scoped tracking of Jev API spend. See
// docs/superpowers/specs/2026-09-21-web-error-monitor-phase3b-dashboard-v1-design.md.

import {
  computeCostUsd,
  sumInputTokens,
  formatCostUsd,
  formatTokenCount,
  bucketUsageByHour,
} from '../lib/usage.js';

// Module-scope mutex serializing read-modify-write access to the
// `usageLog` key in chrome.storage.session. Mirrors classification.js's
// cacheQueue/sessionCountQueue pattern: classification.js's flush() can
// resolve several classifications concurrently in one debounce batch,
// each calling recordUsage — without serializing, two calls finishing
// around the same time could both read the same stale log and the later
// write would clobber the earlier entry.
let usageQueue = Promise.resolve();

export function recordUsage(usage) {
  if (!usage || typeof usage.input_tokens !== 'number') return Promise.resolve();
  const result = usageQueue.then(() => recordUsageUnsafe(usage.input_tokens));
  // Swallow rejections in the chain itself so one failed call doesn't
  // permanently wedge the queue for subsequent calls.
  usageQueue = result.catch(() => {});
  return result;
}

async function recordUsageUnsafe(inputTokens) {
  const { usageLog = [] } = await chrome.storage.session.get('usageLog');
  usageLog.push({ timestamp: Date.now(), inputTokens });
  await chrome.storage.session.set({ usageLog });
  await broadcastUsage(usageLog);
}

export async function getUsageSummary() {
  const { usageLog = [] } = await chrome.storage.session.get('usageLog');
  return summarize(usageLog);
}

function summarize(usageLog) {
  const totalInputTokens = sumInputTokens(usageLog);
  const totalCostUsd = computeCostUsd(totalInputTokens);
  return {
    totalCostUsd,
    totalInputTokens,
    costLabel: formatCostUsd(totalCostUsd),
    tokenLabel: formatTokenCount(totalInputTokens),
    hourlyBuckets: bucketUsageByHour(usageLog),
  };
}

async function broadcastUsage(usageLog) {
  const summary = summarize(usageLog);
  // Unlike classification.js's notifyTabs (origin-filtered — a
  // classification only matters to tabs on that origin), cost is global:
  // every tab with the HUD installed needs to see it, regardless of which
  // origin's error actually triggered this classification.
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'USAGE_UPDATE', ...summary }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'GET_USAGE') return false;
  getUsageSummary()
    .then(sendResponse)
    .catch((error) => {
      console.error('[web-error-monitor] failed to read usage summary', error);
      sendResponse(summarize([]));
    });
  return true; // keep the channel open for the async sendResponse above
});
