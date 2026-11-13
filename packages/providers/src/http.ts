/**
 * Minimal transport and encoding primitives for provider adapters.
 *
 * The package is pure TypeScript: no React Native, Expo or DOM imports. The
 * app injects `fetch` (expo/fetch on iOS, which can stream response bodies),
 * randomness and hashing. Tests inject fakes.
 */

/** The parts of a fetch Response the adapters use. */
export interface FetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  /** Streamed body; null if the runtime can't stream (then `text()` is used). */
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export interface FetchInitLike {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

/** Cryptographic primitives, injected (expo-crypto in the app, node:crypto in tests). */
export interface CryptoPort {
  /** Cryptographically secure random bytes. Never Math.random. */
  randomBytes(count: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

// ---------- Encoding ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** RFC 4648 §5 base64url without padding (PKCE, state, nonce). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += (B64[(n >> 18) & 63] ?? '') + (B64[(n >> 12) & 63] ?? '') + (B64[(n >> 6) & 63] ?? '') + (B64[n & 63] ?? '');
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += (B64[(n >> 18) & 63] ?? '') + (B64[(n >> 12) & 63] ?? '');
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += (B64[(n >> 18) & 63] ?? '') + (B64[(n >> 12) & 63] ?? '') + (B64[(n >> 6) & 63] ?? '');
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

/** Decodes base64url (or base64), padded or not. Returns null on invalid input. */
export function base64UrlDecode(text: string): Uint8Array | null {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (clean.length % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** application/x-www-form-urlencoded and URL query encoding (keys in insertion order). */
export function formEncode(params: Readonly<Record<string, string>>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Parses the query string of a URL (`+` is a space, as in form encoding).
 * Repeated keys keep the first value. Malformed escapes are kept verbatim.
 */
export function parseQuery(url: string): Record<string, string> {
  const q = url.indexOf('?');
  if (q < 0) return {};
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    const key = safeDecode(rawKey);
    if (!(key in out)) out[key] = safeDecode(rawValue);
  }
  return out;
}

function safeDecode(s: string): string {
  const spaced = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** The path of an absolute or origin-relative URL, without query or fragment. */
export function urlPath(url: string): string {
  const noScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/, '');
  const end = noScheme.search(/[?#]/);
  const path = end < 0 ? noScheme : noScheme.slice(0, end);
  return path === '' ? '/' : path;
}

/** Reads a body as text whether or not the runtime streams it. Never throws. */
export async function readTextSafely(response: FetchResponseLike): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function stringField(obj: Readonly<Record<string, unknown>> | null | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === 'string' ? v : undefined;
}

export function numberField(obj: Readonly<Record<string, unknown>> | null | undefined, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function objectField(obj: Readonly<Record<string, unknown>> | null | undefined, key: string): Record<string, unknown> | undefined {
  const v = obj?.[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
