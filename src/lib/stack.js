const FRAME_LOCATION_RE =
  /((?:https?:|file:|chrome-extension:)?\/\/[^\s()]+|[^\s()]+\.[jt]sx?):(\d+):(\d+)/;

export function extractFrames(stack) {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1) // drop the "Error" / "Error: message" header line
    .map((line) => line.trim())
    .filter(Boolean);
}

export function topFrameLocation(stack, { ignoreFiles = [] } = {}) {
  const frames = extractFrames(stack);
  for (const frame of frames) {
    const match = frame.match(FRAME_LOCATION_RE);
    if (!match) continue;
    const [, file, line, col] = match;
    if (ignoreFiles.some((ignored) => file.includes(ignored))) continue;
    return { raw: frame, file, line: Number(line), col: Number(col) };
  }
  return null;
}

export function normalizedFrameKey(top) {
  if (!top) return '';
  return top.file.split('?')[0];
}

export function sourceFileFromStack(stack, options) {
  const top = topFrameLocation(stack, options);
  if (!top) return null;
  const cleanFile = top.file.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
  return `${cleanFile}:${top.line}:${top.col}`;
}
