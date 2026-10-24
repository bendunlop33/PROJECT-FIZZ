import { noYield, type Slicer } from './slice';

/**
 * SHA-256 of a string's UTF-8 bytes, as lowercase hex. Pure TypeScript so it
 * runs unchanged on Hermes and Node (no `node:crypto`, no native module).
 * Used as a corruption check on backup files, not for security.
 *
 * Streaming (backup review B1): text is UTF-8 encoded straight into one
 * 64-byte block, so a 20 MB backup never becomes a 20 M-entry byte array,
 * and `Sha256Stream` can be fed piece by piece, cloned, and paused between
 * slices so the JS thread stays free.
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** Characters hashed between pauses in `sha256HexAsync` (a few ms of work). */
const SLICE_CHARS = 1 << 15;

/** UTF-8 encode, treating a lone surrogate as U+FFFD (as TextEncoder does). */
export function utf8Bytes(text: string): Uint8Array {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i += 1;
    } else n += 3; // BMP, or a lone surrogate as U+FFFD
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < text.length; i += 1) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && (next & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else c = 0xfffd;
    }
    if (c < 0x80) out[p++] = c;
    else if (c < 0x800) {
      out[p++] = 0xc0 | (c >> 6);
      out[p++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      out[p++] = 0xe0 | (c >> 12);
      out[p++] = 0x80 | ((c >> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    } else {
      out[p++] = 0xf0 | (c >> 18);
      out[p++] = 0x80 | ((c >> 12) & 0x3f);
      out[p++] = 0x80 | ((c >> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    }
  }
  return out;
}

/** Incremental SHA-256 over UTF-8 text. `update` may split text anywhere, even inside a surrogate pair. */
export class Sha256Stream {
  private readonly h = new Int32Array(INIT);
  private readonly buf = new Uint8Array(64);
  private readonly w = new Int32Array(64);
  private pos = 0;
  /** Bytes hashed so far. */
  private bytes = 0;
  /** A high surrogate at the end of the last `update`, waiting for its pair. */
  private pendingHigh = -1;
  private done = false;

  /** A copy with the same state: hash a shared prefix once, then finish two ways. */
  clone(): Sha256Stream {
    const c = new Sha256Stream();
    c.h.set(this.h);
    c.buf.set(this.buf);
    c.pos = this.pos;
    c.bytes = this.bytes;
    c.pendingHigh = this.pendingHigh;
    c.done = this.done;
    return c;
  }

  update(text: string, start = 0, end = text.length): this {
    if (this.done) throw new Error('sha256: already finished');
    let i = start;
    if (this.pendingHigh >= 0 && i < end) {
      const high = this.pendingHigh;
      const next = text.charCodeAt(i);
      this.pendingHigh = -1;
      if ((next & 0xfc00) === 0xdc00) {
        this.codePoint(0x10000 + ((high - 0xd800) << 10) + (next - 0xdc00));
        i += 1;
      } else this.codePoint(0xfffd);
    }
    const buf = this.buf;
    let pos = this.pos;
    let ascii = 0;
    for (; i < end; i += 1) {
      const c = text.charCodeAt(i);
      if (c < 0x80) {
        buf[pos++] = c;
        ascii += 1;
        if (pos === 64) {
          this.compress();
          pos = 0;
        }
        continue;
      }
      this.pos = pos;
      if (c >= 0xd800 && c <= 0xdbff) {
        if (i + 1 >= end) {
          this.pendingHigh = c;
        } else {
          const next = text.charCodeAt(i + 1);
          if ((next & 0xfc00) === 0xdc00) {
            this.codePoint(0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00));
            i += 1;
          } else this.codePoint(0xfffd);
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) this.codePoint(0xfffd);
      else this.codePoint(c);
      pos = this.pos;
    }
    this.pos = pos;
    this.bytes += ascii;
    return this;
  }

  digestHex(): string {
    if (this.done) throw new Error('sha256: already finished');
    if (this.pendingHigh >= 0) {
      this.pendingHigh = -1;
      this.codePoint(0xfffd);
    }
    this.done = true;
    const bitHigh = Math.floor(this.bytes / 0x20000000);
    const bitLow = (this.bytes * 8) >>> 0;
    this.byte(0x80);
    while (this.pos !== 56) this.byte(0);
    for (const word of [bitHigh, bitLow]) {
      this.byte(word >>> 24);
      this.byte((word >>> 16) & 0xff);
      this.byte((word >>> 8) & 0xff);
      this.byte(word & 0xff);
    }
    let out = '';
    for (let i = 0; i < 8; i += 1) out += ((this.h[i] ?? 0) >>> 0).toString(16).padStart(8, '0');
    return out;
  }

  private byte(b: number): void {
    this.buf[this.pos] = b;
    this.pos += 1;
    if (this.pos === 64) {
      this.compress();
      this.pos = 0;
    }
  }

  private codePoint(c: number): void {
    if (c < 0x80) {
      this.byte(c);
      this.bytes += 1;
    } else if (c < 0x800) {
      this.byte(0xc0 | (c >> 6));
      this.byte(0x80 | (c & 0x3f));
      this.bytes += 2;
    } else if (c < 0x10000) {
      this.byte(0xe0 | (c >> 12));
      this.byte(0x80 | ((c >> 6) & 0x3f));
      this.byte(0x80 | (c & 0x3f));
      this.bytes += 3;
    } else {
      this.byte(0xf0 | (c >> 18));
      this.byte(0x80 | ((c >> 12) & 0x3f));
      this.byte(0x80 | ((c >> 6) & 0x3f));
      this.byte(0x80 | (c & 0x3f));
      this.bytes += 4;
    }
  }

  private compress(): void {
    const w = this.w;
    const buf = this.buf;
    const h = this.h;
    for (let i = 0, j = 0; i < 16; i += 1, j += 4) {
      w[i] = ((buf[j] ?? 0) << 24) | ((buf[j + 1] ?? 0) << 16) | ((buf[j + 2] ?? 0) << 8) | (buf[j + 3] ?? 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] ?? 0;
      const y = w[i - 2] ?? 0;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = ((h[0] ?? 0) + a) | 0;
    h[1] = ((h[1] ?? 0) + b) | 0;
    h[2] = ((h[2] ?? 0) + c) | 0;
    h[3] = ((h[3] ?? 0) + d) | 0;
    h[4] = ((h[4] ?? 0) + e) | 0;
    h[5] = ((h[5] ?? 0) + f) | 0;
    h[6] = ((h[6] ?? 0) + g) | 0;
    h[7] = ((h[7] ?? 0) + hh) | 0;
  }
}

/** Synchronous: fine for small text. Backup-sized text uses `sha256HexAsync`. */
export function sha256Hex(text: string): string {
  return new Sha256Stream().update(text).digestHex();
}

/** The same hash, in slices with `slice()` between them so the JS thread stays responsive. */
export async function sha256HexAsync(text: string, slice: Slicer = noYield): Promise<string> {
  const s = new Sha256Stream();
  for (let i = 0; i < text.length; i += SLICE_CHARS) {
    s.update(text, i, Math.min(text.length, i + SLICE_CHARS));
    await slice();
  }
  return s.digestHex();
}
