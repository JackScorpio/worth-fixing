import { normalizeMessage } from './normalize.js';
import { topFrameLocation, normalizedFrameKey } from './stack.js';

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeFingerprint({ kind, message, stack, ignoreFiles, status }) {
  const normalizedMessage = normalizeMessage(message);
  const top = topFrameLocation(stack, { ignoreFiles });
  const frameKey = normalizedFrameKey(top);
  const statusPart = status ?? '';
  const input = `${kind}|${normalizedMessage}|${frameKey}|${statusPart}`;
  const hash = await sha256Hex(input);
  return hash.slice(0, 16);
}
