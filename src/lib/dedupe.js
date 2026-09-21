export function applyDedupeIncrement(dedupeCounts, fingerprint, cap) {
  const counts = { ...dedupeCounts };
  if (!(fingerprint in counts)) {
    const keys = Object.keys(counts);
    if (keys.length >= cap) {
      // Object key order is insertion order for string keys, so the first
      // key is the oldest-inserted one.
      delete counts[keys[0]];
    }
  }
  counts[fingerprint] = (counts[fingerprint] || 0) + 1;
  return counts;
}
