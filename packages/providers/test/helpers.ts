import { createHash, randomBytes } from 'node:crypto';

import type { ChatGptVault, CryptoPort, FetchInitLike, FetchLike, FetchResponseLike, ListenerLogEntry, LoopbackPort, AuthSessionOutcome } from '../src';
import { base64UrlEncode, parseJsonObject, parseQuery, utf8Encode } from '../src';

export const nodeCrypto: CryptoPort = {
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
  sha256: (data) => Promise.resolve(new Uint8Array(createHash('sha256').update(data).digest())),
};

export interface RecordedCall {
  url: string;
  init: FetchInitLike;
  form: Record<string, string>;
  json: Record<string, unknown> | null;
}

export type Handler = (call: RecordedCall) => FetchResponseLike | Promise<FetchResponseLike>;

/** A fetch that routes by URL prefix and records every call. Unrouted URLs throw. */
export function fakeFetch(routes: Record<string, Handler | Handler[]>): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, Handler[]>();
  for (const [prefix, h] of Object.entries(routes)) queues.set(prefix, Array.isArray(h) ? [...h] : [h]);
  const fetch: FetchLike = (url, init) => {
    const body = init.body ?? '';
    const json = init.headers['Content-Type'] === 'application/json' ? parseJsonObject(body) : null;
    const call: RecordedCall = { url, init, form: init.headers['Content-Type']?.startsWith('application/x-www-form-urlencoded') ? parseQuery(`?${body}`) : {}, json };
    calls.push(call);
    const key = [...queues.keys()].filter((p) => url.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return Promise.reject(new Error(`unrouted ${url}`));
    const queue = queues.get(key) ?? [];
    // The last handler repeats once the queue is down to one.
    const handler = queue.length > 1 ? queue.shift() : queue[0];
    if (handler === undefined) return Promise.reject(new Error(`no handler ${url}`));
    return Promise.resolve(handler(call));
  };
  return { fetch, calls };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponseLike {
  return textResponse(status, typeof body === 'string' ? body : JSON.stringify(body), headers);
}

export function textResponse(status: number, text: string, headers: Record<string, string> = {}): FetchResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    body: null,
    text: () => Promise.resolve(text),
  };
}

/** A streamed response delivering the given chunks (split anywhere). */
export function streamResponseOf(chunks: readonly string[], status = 200, headers: Record<string, string> = {}): FetchResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    body: stream,
    text: () => Promise.reject(new Error('body is streamed')),
  };
}

export function sse(events: readonly Record<string, unknown>[]): string {
  return events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

export function makeJwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => base64UrlEncode(utf8Encode(JSON.stringify(o)));
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claims)}.c2lnbmF0dXJl`;
}

export class MemoryVault implements ChatGptVault {
  registration: string | null = null;
  tokens: string | null = null;
  writes: string[] = [];

  loadRegistration() {
    return Promise.resolve(this.registration);
  }
  saveRegistration(s: string) {
    this.writes.push('registration');
    this.registration = s;
    return Promise.resolve();
  }
  loadTokens() {
    return Promise.resolve(this.tokens);
  }
  saveTokens(s: string) {
    this.writes.push('tokens');
    this.tokens = s;
    return Promise.resolve();
  }
  deleteTokens() {
    this.writes.push('delete-tokens');
    this.tokens = null;
    return Promise.resolve();
  }
}

export class FakeClock {
  constructor(public ms = 1_790_000_000_000) {}
  now = () => this.ms;
  advance(ms: number) {
    this.ms += ms;
  }
}

/**
 * A loopback fake. `respond(url)` decides what the "browser" does with the
 * authorize URL: return the callback URL, or another outcome.
 */
export class FakeLoopback implements LoopbackPort {
  started = 0;
  stopped = 0;
  openedUrls: string[] = [];
  log: ListenerLogEntry[] = [];
  constructor(
    private readonly respond: (authUrl: string, port: number) => AuthSessionOutcome,
    private readonly opts: { unavailable?: string; port?: number; startError?: string } = {},
  ) {}
  unavailableReason() {
    return this.opts.unavailable ?? null;
  }
  startListener() {
    if (this.opts.startError !== undefined) return Promise.reject(new Error(this.opts.startError));
    this.started += 1;
    this.log.push({ atMs: 0, kind: 'ready', detail: 'listening' });
    return Promise.resolve({ port: this.opts.port ?? 1455 });
  }
  openAuthSession(url: string) {
    this.openedUrls.push(url);
    const outcome = this.respond(url, this.opts.port ?? 1455);
    if (outcome.kind === 'callback') {
      this.log.push({ atMs: 5, kind: 'connection', detail: 'from 127.0.0.1' }, { atMs: 6, kind: 'callback', detail: 'GET /auth/callback' });
    }
    return Promise.resolve(outcome);
  }
  stopListener() {
    this.stopped += 1;
    return Promise.resolve();
  }
  listenerLog() {
    return this.log;
  }
}

/** Builds the callback URL the authorization server would redirect to. */
export function callbackFor(authUrl: string, extra: Record<string, string> = {}): string {
  const q = parseQuery(authUrl);
  const params = new URLSearchParams({ code: 'AUTH-CODE-SECRET', state: q.state ?? '', ...extra });
  return `${q.redirect_uri ?? ''}?${params.toString()}`;
}
