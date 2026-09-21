export const COST_PER_MILLION_INPUT_TOKENS_USD = 0.042;

export function computeCostUsd(inputTokens) {
  return (inputTokens / 1_000_000) * COST_PER_MILLION_INPUT_TOKENS_USD;
}

export function sumInputTokens(usageLog) {
  return usageLog.reduce((total, entry) => total + entry.inputTokens, 0);
}

export function formatCostUsd(costUsd) {
  // 4 decimal places: at real Jev pricing, a single classification costs a
  // few thousandths of a cent, so 2-3 decimals would show "$0.00" for most
  // of a normal session.
  return `$${costUsd.toFixed(4)}`;
}

export function formatTokenCount(tokens) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}

const HOUR_MS = 60 * 60 * 1000;

// Cost per clock-hour bucket over the trailing window, oldest bucket first
// (so the array reads left-to-right like a chart). Entries outside the
// window — or timestamped in the future by clock skew — are dropped.
export function bucketUsageByHour(usageLog, hours = 6, now = Date.now()) {
  const buckets = new Array(hours).fill(0);
  for (const entry of usageLog) {
    const age = now - entry.timestamp;
    if (age < 0 || age >= hours * HOUR_MS) continue;
    const index = hours - 1 - Math.floor(age / HOUR_MS);
    buckets[index] += computeCostUsd(entry.inputTokens);
  }
  return buckets;
}
