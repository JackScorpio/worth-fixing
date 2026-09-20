import { normalizeMessage } from './normalize.js';
import { topFrameLocation } from './stack.js';

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeFingerprint({ kind, message, stack, sourceFile, ignoreFiles }) {
  const normalizedMessage = normalizeMessage(message);
  const top = topFrameLocation(stack, { ignoreFiles });
  const topStackFrame = top ? top.raw : '';
  const input = `${kind}|${normalizedMessage}|${topStackFrame}|${sourceFile ?? ''}`;
  const hash = await sha256Hex(input);
  return hash.slice(0, 16);
}
