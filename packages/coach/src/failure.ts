import type { ModelFailureDetail } from './model-port';

/**
 * (21 Oct, Ben's Build B report: "Coach unavailable. Nothing changed." with no way to tell why)
 * A provider failure as it is kept on the failed turn and shown behind `Why?`. Diagnostic only:
 * anything token-like is removed and the message is trimmed before it is saved (rule 7: no
 * credentials in plain storage). Pure.
 */

/** Longest message kept. */
export const FAILURE_MESSAGE_MAX = 200;

const SECRETS: readonly RegExp[] = [
  // `Bearer …`, `Authorization: …`
  /\b(?:bearer|authorization:?)\s+[^\s)"',]+/gi,
  // JWTs (access and ID tokens)
  /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g,
  // API-key shapes
  /\b(?:sk|rk|pk)-[\w-]{8,}/g,
  // `access_token=…`, `refresh_token: …`, `code=…`
  /\b(?:access_token|refresh_token|id_token|token|code|client_secret)["']?\s*[:=]\s*["']?[^\s"',&]+/gi,
  // Email addresses
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

/** Any other long opaque run with letters and digits (a token we don't know the shape of); error codes have no digits. */
const OPAQUE = /[A-Za-z0-9_\-+/=]{32,}/g;

/** The message with token-like text replaced by `…` and trimmed to `FAILURE_MESSAGE_MAX`. Null when nothing is left. */
export function scrubFailureMessage(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return null;
  let out = message.replace(/\s+/g, ' ').trim();
  for (const re of SECRETS) out = out.replace(re, '…');
  out = out.replace(OPAQUE, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? '…' : run));
  out = out.trim();
  if (out.length > FAILURE_MESSAGE_MAX) out = `${out.slice(0, FAILURE_MESSAGE_MAX - 1)}…`;
  return out === '' || out === '…' ? null : out;
}

/** A failure ready to store: every field bounded, the message scrubbed. */
export function cleanFailure(f: ModelFailureDetail): ModelFailureDetail {
  const message = scrubFailureMessage(f.message);
  const code = f.code === undefined ? undefined : f.code.replace(/[^\w.:-]/g, '').slice(0, 120) || undefined;
  const requestId = f.requestId === undefined ? undefined : f.requestId.replace(/[^\w.:-]/g, '').slice(0, 120) || undefined;
  return {
    kind: (f.kind.replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown'),
    ...(f.status !== undefined && Number.isInteger(f.status) && f.status >= 100 && f.status <= 599 ? { status: f.status } : {}),
    ...(code === undefined ? {} : { code }),
    ...(message === null ? {} : { message: message.slice(0, 240) }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/** `HTTP 400 · invalid_request_error · Invalid schema for function 'edit_today' · request req_123`. */
export function failureWhy(f: { kind: string; status?: number | undefined; code?: string | undefined; message?: string | undefined; requestId?: string | undefined }): string {
  const parts = [f.status === undefined ? null : `HTTP ${String(f.status)}`, f.code ?? f.kind, f.message ?? null, f.requestId === undefined ? null : `request ${f.requestId}`].filter((x): x is string => x !== null && x !== '');
  return parts.join(' · ');
}
