// The exact token/context-size ceiling for `state` is not published in
// TypeSafe's live docs as of this writing. Truncate defensively anyway
// (BRIEF's own instruction) rather than send an unbounded stack trace.
const MAX_STATE_CHARS = 20000;

export function truncateState(text, maxChars = MAX_STATE_CHARS) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function buildJevRequest({ state, model, questions }) {
  return { state, model, questions };
}

export function parseNoulAnswer(answer) {
  return { probability: answer.noul };
}

export function parseChoiceAnswer(answer) {
  return { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence };
}

export function parseScoreAnswer(answer) {
  return {
    score: answer.score,
    legend: answer.legend,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
  };
}

export function isConfident(confidence, threshold = 0.5) {
  return typeof confidence === 'number' && confidence >= threshold;
}

const SCORE_BAND_COLORS = ['grey', 'amber', 'red'];

export function bucketPriorityColor(scoreAnswer) {
  if (!scoreAnswer || typeof scoreAnswer.score !== 'number') return null;

  const levelKeys = scoreAnswer.legend
    ? Object.keys(scoreAnswer.legend)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
    : [];

  if (levelKeys.length >= 2) {
    const min = Math.min(...levelKeys);
    const max = Math.max(...levelKeys);
    const fraction = max === min ? 0 : (scoreAnswer.score - min) / (max - min);
    const index = Math.max(0, Math.min(SCORE_BAND_COLORS.length - 1, Math.floor(fraction * SCORE_BAND_COLORS.length)));
    return SCORE_BAND_COLORS[index];
  }

  // No usable legend range: fall back to assuming a 0-2 scale, matching
  // our 3-criteria priority question (see classification.js's QUESTIONS).
  const index = Math.max(0, Math.min(SCORE_BAND_COLORS.length - 1, Math.round(scoreAnswer.score)));
  return SCORE_BAND_COLORS[index];
}

const PROMOTION_ORDER = ['grey', 'amber', 'red'];

export function applySilentBugPromotion(color, silentBugProbability) {
  if (color == null) return color;
  if (typeof silentBugProbability !== 'number' || silentBugProbability <= 0.5) return color;
  const index = PROMOTION_ORDER.indexOf(color);
  if (index === -1) return color;
  return PROMOTION_ORDER[Math.min(index + 1, PROMOTION_ORDER.length - 1)];
}

const CRASH_KINDS = new Set(['uncaught', 'unhandledrejection']);
const MUTED_ORIGINS = new Set(['framework_noise', 'browser_extension']);

// Maps Jev's answers to what the HUD shows. Jev's verdict is followed
// whenever it gave one; confidence is surfaced (lowConfidence) rather than
// used to discard the answer. The one exception is a genuine crash that
// Jev only tentatively calls ignorable/noise — that keeps its kind-based
// display (displayColor null -> the HUD's red fallback) until Jev is sure.
export function decideDisplay({ kind, priority = null, origin = null, silentBug = null }) {
  const priorityUnsure = !!priority && !isConfident(priority.confidence);
  let displayColor = priority ? bucketPriorityColor(priority) : null;
  displayColor = applySilentBugPromotion(displayColor, silentBug ? silentBug.probability : undefined);
  if (displayColor === 'grey' && priorityUnsure && CRASH_KINDS.has(kind)) displayColor = null;

  const originUnsure = !!origin && !isConfident(origin.confidence);
  let muted = !!origin && MUTED_ORIGINS.has(origin.choice);
  if (muted && originUnsure && CRASH_KINDS.has(kind)) muted = false;

  return { displayColor, muted, lowConfidence: priorityUnsure || (muted && originUnsure) };
}
