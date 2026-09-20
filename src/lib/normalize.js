const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID_RE = /\b0x[0-9a-f]+\b|\b[0-9a-f]{16,}\b/gi;
const LONG_QUOTED_RE = /"[^"]{41,}"|'[^']{41,}'/g;
const NUMBER_RE = /-?\b\d+(\.\d+)?\b/g;

export function normalizeMessage(message) {
  if (typeof message !== 'string') return '';
  return message
    .replace(UUID_RE, '<uuid>')
    .replace(HEX_ID_RE, '<hex>')
    .replace(LONG_QUOTED_RE, '<string>')
    .replace(NUMBER_RE, '<num>')
    .trim();
}
