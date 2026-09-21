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
