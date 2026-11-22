/**
 * Deterministic catalogue IDs: `Exercise.id = UUIDv5(key, FIZZ_CATALOGUE_NAMESPACE)`
 * (RFC 9562 §5.5). Pure TypeScript (no node:crypto, no native module) so the
 * same function runs in Hermes and in Node tests. SHA-1 is used only as the
 * RFC's name hash, not for security.
 */

/** Fixed namespace for catalogue keys. Never change it: every catalogue ID depends on it. */
export const FIZZ_CATALOGUE_NAMESPACE = 'b8068a51-2a26-44d1-811c-44ad2dc3c8ce';

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

/** SHA-1 digest (FIPS 180-4) of a byte array. */
export function sha1(bytes: readonly number[]): Uint8Array {
  const bitLen = bytes.length * 8;
  const msg = [...bytes, 0x80];
  while (msg.length % 64 !== 56) msg.push(0);
  const hi = Math.floor(bitLen / 0x1_0000_0000);
  const lo = bitLen >>> 0;
  msg.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  msg.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80).fill(0);
  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i += 1) {
      const b = (k: number): number => msg[off + i * 4 + k] ?? 0;
      w[i] = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((h, i) => {
    out[i * 4] = h >>> 24;
    out[i * 4 + 1] = (h >>> 16) & 0xff;
    out[i * 4 + 2] = (h >>> 8) & 0xff;
    out[i * 4 + 3] = h & 0xff;
  });
  return out;
}

function parseUuid(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Not a UUID: ${uuid}`);
  const out: number[] = [];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** RFC 9562 UUIDv5 of `name` in `namespace`. */
export function uuidV5(name: string, namespace: string): string {
  const hash = sha1([...parseUuid(namespace), ...utf8(name)]);
  const bytes = Array.from(hash.slice(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The `Exercise.id` of a catalogue key. Stable forever for that key. */
export function catalogueExerciseId(key: string): string {
  return uuidV5(key, FIZZ_CATALOGUE_NAMESPACE);
}
