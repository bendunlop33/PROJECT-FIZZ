/**
 * Deterministic JSON-like serialisation: object keys sorted, `undefined`
 * fields dropped. Used for operation fingerprints and cache keys.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Deterministic UUID (version 8, RFC 9562 "custom") derived from a seed. Used
 * for rows the reducer itself creates, such as the other-side companion of a
 * unilateral set, so a retried command derives the same ID. Not a secure hash.
 */
export function deriveId(seed: string): string {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((offset, lane) => {
    let h = (offset ^ Math.imul(lane + 1, 0x27d4eb2d)) >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    return h >>> 0;
  });
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
