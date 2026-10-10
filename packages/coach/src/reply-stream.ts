/**
 * Reading the `reply` function's `message` while its arguments stream (ADR
 * 0019 C6, coach-sheet §3 `Streaming`). The arguments arrive as pieces of a
 * JSON object (`{"message":"Set 2 was…","offer":null}`); this returns the
 * decoded part of `message` received so far, so the sheet can show each
 * finished sentence as it arrives instead of waiting for the whole reply.
 *
 * Pure. Keys may come in any order; any other key is skipped. A partial
 * escape at the end (`\u00`) is held back until it is complete. Every
 * sentence still goes through the backstop (`createReplyFilter`) before it is
 * shown, exactly as a complete reply does.
 */

const WS = /\s/;

interface Cursor {
  s: string;
  i: number;
}

function skipWs(c: Cursor): void {
  while (c.i < c.s.length && WS.test(c.s.charAt(c.i))) c.i += 1;
}

/**
 * Decode a JSON string starting just after its opening quote. Returns the
 * decoded text so far and whether the closing quote was seen.
 */
function readString(c: Cursor): { text: string; closed: boolean } {
  let out = '';
  while (c.i < c.s.length) {
    const ch = c.s.charAt(c.i);
    if (ch === '"') {
      c.i += 1;
      return { text: out, closed: true };
    }
    if (ch !== '\\') {
      out += ch;
      c.i += 1;
      continue;
    }
    const next = c.s.charAt(c.i + 1);
    if (next === '') return { text: out, closed: false };
    if (next === 'u') {
      const hex = c.s.slice(c.i + 2, c.i + 6);
      if (hex.length < 4) return { text: out, closed: false };
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { text: out, closed: false };
      out += String.fromCharCode(parseInt(hex, 16));
      c.i += 6;
      continue;
    }
    const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    const v = simple[next];
    if (v === undefined) return { text: out, closed: false };
    out += v;
    c.i += 2;
  }
  return { text: out, closed: false };
}

/** Skip one JSON value. Returns false when the input ends first. */
function skipValue(c: Cursor): boolean {
  skipWs(c);
  const ch = c.s.charAt(c.i);
  if (ch === '') return false;
  if (ch === '"') {
    c.i += 1;
    return readString(c).closed;
  }
  if (ch === '{' || ch === '[') {
    let depth = 0;
    while (c.i < c.s.length) {
      const x = c.s.charAt(c.i);
      if (x === '"') {
        c.i += 1;
        if (!readString(c).closed) return false;
        continue;
      }
      if (x === '{' || x === '[') depth += 1;
      if (x === '}' || x === ']') {
        depth -= 1;
        if (depth === 0) {
          c.i += 1;
          return true;
        }
      }
      c.i += 1;
    }
    return false;
  }
  // number, true, false, null: up to the next delimiter
  while (c.i < c.s.length && !/[,}\]\s]/.test(c.s.charAt(c.i))) c.i += 1;
  return c.i < c.s.length;
}

export interface PartialMessage {
  /** The decoded `message` so far ('' when it has started but is empty). */
  text: string;
  /** The closing quote of `message` has arrived. */
  complete: boolean;
}

/** The `message` field of a (possibly incomplete) `reply` arguments object, or null if it hasn't started. */
export function partialReplyMessage(raw: string): PartialMessage | null {
  const c: Cursor = { s: raw, i: 0 };
  skipWs(c);
  if (c.s.charAt(c.i) !== '{') return null;
  c.i += 1;
  for (;;) {
    skipWs(c);
    const ch = c.s.charAt(c.i);
    if (ch === ',') {
      c.i += 1;
      continue;
    }
    if (ch !== '"') return null;
    c.i += 1;
    const key = readString(c);
    if (!key.closed) return null;
    skipWs(c);
    if (c.s.charAt(c.i) !== ':') return null;
    c.i += 1;
    skipWs(c);
    if (key.text === 'message') {
      if (c.s.charAt(c.i) !== '"') return null;
      c.i += 1;
      const r = readString(c);
      return { text: r.text, complete: r.closed };
    }
    if (!skipValue(c)) return null;
  }
}

/**
 * Feeds argument pieces and hands back only the new message text each time.
 * Never goes backwards: if a later piece would change text already handed
 * out (it can't for valid JSON), nothing more is handed out.
 */
export class ReplyMessageStream {
  private raw = '';
  private sent = '';
  private broken = false;

  push(delta: string): string {
    this.raw += delta;
    if (this.broken) return '';
    const m = partialReplyMessage(this.raw);
    if (m === null || m.text.length <= this.sent.length) return '';
    if (!m.text.startsWith(this.sent)) {
      this.broken = true;
      return '';
    }
    const fresh = m.text.slice(this.sent.length);
    this.sent = m.text;
    return fresh;
  }

  /** Everything handed out so far. */
  get streamed(): string {
    return this.sent;
  }
}
