/**
 * Typed failures for the ChatGPT-plan route, mapped from
 * https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
 * (checked 2026-10-09).
 *
 * Rules carried by the mapping:
 * - Plan-usage errors stop inference. Nothing here suggests or performs a
 *   switch to a paid route (CLAUDE.md rule 7).
 * - `not_eligible` must not be retried and must not loop OAuth.
 * - `usage_limit` pauses the coach; no reset time is inferred.
 * - Only a confirmed-unusable refresh token clears credentials; network and
 *   5xx failures keep them.
 */

import { numberField, objectField, parseJsonObject, stringField } from '../http';

export type FailureKind =
  // Plan-usage (Responses) errors with documented codes
  | 'usage_limit' // subscription_sharing_usage_limit_exceeded (429)
  | 'not_eligible' // subscription_sharing_user_not_eligible (403)
  | 'unavailable' // subscription_sharing_usage_unavailable / user_unavailable / direct-admission 503
  | 'unsupported_capability' // subscription_sharing_unsupported_capability (400)
  | 'route_not_supported' // subscription_sharing_route_not_supported (403)
  | 'invalid_user' // subscription_sharing_invalid_user (401)
  | 'scope_not_authorized' // chatpass_v2_scope_not_authorized / chatpass_v2_invalid_authorization_context (403)
  // Direct-admission failures without a structured code ({"detail": "..."})
  | 'region' // 403 whose diagnostic text mentions region/country (heuristic: no stable code exists)
  | 'policy_forbidden' // other 403
  | 'unauthorized' // other 401
  | 'rate_limited' // other 429
  | 'bad_request' // other 4xx
  | 'server' // other 5xx
  // OAuth
  | 'access_denied' // consent declined (callback error=access_denied)
  | 'oauth_error' // other callback error
  | 'state_mismatch'
  | 'missing_code'
  | 'registration_incomplete' // new registration callback without an issued client_id
  | 'client_id_mismatch' // reauthorization callback returned a different client
  | 'invalid_grant' // code exchange rejected: discard code, start fresh
  | 'refresh_unusable' // refresh token expired/revoked/reused: clear tokens, sign in again
  | 'invalid_client'
  | 'scope_missing' // signed in, but chatgpt.tokens.use.direct not granted
  | 'id_token_invalid'
  // Transport / protocol
  | 'network'
  | 'timeout'
  | 'stream_interrupted' // stream ended without response.completed
  | 'incomplete' // response.incomplete
  | 'response_failed' // response.failed with an unlisted code
  | 'protocol'; // unexpected response shape

/** What the UI should offer. Never "switch to a paid route" automatically. */
export type Recovery = 'manage_usage' | 'sign_in_again' | 'retry_later' | 'fix_request' | 'explain_only' | 'try_again';

export interface ProviderFailure {
  kind: FailureKind;
  /** Diagnostic text (server message or our description). Never contains tokens. */
  message: string;
  recovery: Recovery;
  /** True only where the docs allow bounded retry. */
  retryable: boolean;
  status?: number;
  code?: string;
  param?: string;
  requestId?: string;
}

const RECOVERY: Record<FailureKind, { recovery: Recovery; retryable: boolean }> = {
  usage_limit: { recovery: 'manage_usage', retryable: false },
  not_eligible: { recovery: 'explain_only', retryable: false },
  unavailable: { recovery: 'retry_later', retryable: true },
  unsupported_capability: { recovery: 'fix_request', retryable: false },
  route_not_supported: { recovery: 'fix_request', retryable: false },
  invalid_user: { recovery: 'sign_in_again', retryable: false },
  scope_not_authorized: { recovery: 'explain_only', retryable: false },
  region: { recovery: 'explain_only', retryable: false },
  policy_forbidden: { recovery: 'explain_only', retryable: false },
  unauthorized: { recovery: 'sign_in_again', retryable: false },
  rate_limited: { recovery: 'retry_later', retryable: true },
  bad_request: { recovery: 'fix_request', retryable: false },
  server: { recovery: 'retry_later', retryable: true },
  access_denied: { recovery: 'try_again', retryable: false },
  oauth_error: { recovery: 'try_again', retryable: false },
  state_mismatch: { recovery: 'try_again', retryable: false },
  missing_code: { recovery: 'try_again', retryable: false },
  registration_incomplete: { recovery: 'try_again', retryable: false },
  client_id_mismatch: { recovery: 'try_again', retryable: false },
  invalid_grant: { recovery: 'try_again', retryable: false },
  refresh_unusable: { recovery: 'sign_in_again', retryable: false },
  invalid_client: { recovery: 'explain_only', retryable: false },
  scope_missing: { recovery: 'try_again', retryable: false },
  id_token_invalid: { recovery: 'try_again', retryable: false },
  network: { recovery: 'retry_later', retryable: true },
  timeout: { recovery: 'retry_later', retryable: true },
  stream_interrupted: { recovery: 'retry_later', retryable: true },
  incomplete: { recovery: 'try_again', retryable: false },
  response_failed: { recovery: 'try_again', retryable: false },
  protocol: { recovery: 'explain_only', retryable: false },
};

export function failure(
  kind: FailureKind,
  message: string,
  extra: { status?: number | undefined; code?: string | undefined; param?: string | undefined; requestId?: string | undefined } = {},
): ProviderFailure {
  const out: ProviderFailure = { kind, message, ...RECOVERY[kind] };
  if (extra.status !== undefined) out.status = extra.status;
  if (extra.code !== undefined) out.code = extra.code;
  if (extra.param !== undefined) out.param = extra.param;
  if (extra.requestId !== undefined) out.requestId = extra.requestId;
  return out;
}

/** Documented plan-usage codes → kind. Codes not listed fall back to HTTP status. */
const CODE_KIND: Readonly<Record<string, FailureKind>> = {
  subscription_sharing_usage_limit_exceeded: 'usage_limit',
  subscription_sharing_user_not_eligible: 'not_eligible',
  subscription_sharing_usage_unavailable: 'unavailable',
  subscription_sharing_user_unavailable: 'unavailable',
  subscription_sharing_unsupported_capability: 'unsupported_capability',
  subscription_sharing_route_not_supported: 'route_not_supported',
  subscription_sharing_invalid_user: 'invalid_user',
  chatpass_v2_scope_not_authorized: 'scope_not_authorized',
  chatpass_v2_invalid_authorization_context: 'scope_not_authorized',
};

export function kindForCode(code: string | undefined): FailureKind | undefined {
  return code === undefined ? undefined : CODE_KIND[code];
}

const REGION_TEXT = /\b(region|country|countries|territor(y|ies)|location|geograph)/i;

function kindForStatus(status: number, diagnostic: string): FailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return REGION_TEXT.test(diagnostic) ? 'region' : 'policy_forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'protocol';
}

/**
 * Maps a non-2xx API response (models, responses) to a failure. Handles the
 * structured `{error:{code,message,param}}` shape and the direct-admission
 * `{detail:"..."}` shape, whose text is diagnostic only.
 */
export function mapApiError(status: number, bodyText: string, requestId?: string | null): ProviderFailure {
  const body = parseJsonObject(bodyText);
  const errorObj = objectField(body, 'error');
  const code = stringField(errorObj, 'code') ?? (typeof body?.error === 'string' ? body.error : undefined);
  const param = stringField(errorObj, 'param');
  const message = stringField(errorObj, 'message') ?? stringField(body, 'detail') ?? stringField(body, 'error_description') ?? truncate(bodyText, 300);
  const kind = kindForCode(code) ?? kindForStatus(status, message);
  return failure(kind, message === '' ? `HTTP ${String(status)}` : message, {
    status,
    code,
    param,
    requestId: requestId ?? undefined,
  });
}

/** Refresh-token error codes the docs call unusable (clear tokens, sign in again). */
const UNUSABLE_REFRESH_CODES = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

/**
 * Maps a token-endpoint error. OAuth errors use `{error, error_description}`;
 * some may use the API `{error:{code}}` shape, so both are read.
 */
export function mapTokenError(status: number, bodyText: string, grant: 'authorization_code' | 'refresh_token', requestId?: string | null): ProviderFailure {
  const body = parseJsonObject(bodyText);
  const nested = objectField(body, 'error');
  const code = typeof body?.error === 'string' ? body.error : (stringField(nested, 'code') ?? stringField(nested, 'type'));
  const message = stringField(body, 'error_description') ?? stringField(nested, 'message') ?? truncate(bodyText, 300);
  const extra = { status, code, requestId: requestId ?? undefined };
  if (code === 'invalid_client') return failure('invalid_client', message || 'invalid_client', extra);
  if (grant === 'refresh_token' && code !== undefined && UNUSABLE_REFRESH_CODES.has(code)) {
    return failure('refresh_unusable', message || code, extra);
  }
  if (grant === 'authorization_code' && code === 'invalid_grant') return failure('invalid_grant', message || code, extra);
  const viaCode = kindForCode(code);
  if (viaCode !== undefined) return failure(viaCode, message || (code ?? ''), extra);
  return failure(kindForStatus(status, message), message === '' ? `HTTP ${String(status)}` : message, extra);
}

/** Maps a thrown fetch error (network down, abort). */
export function mapThrown(error: unknown, timedOut: boolean): ProviderFailure {
  if (timedOut) return failure('timeout', 'The request took too long and was stopped');
  const message = error instanceof Error ? error.message : String(error);
  return failure('network', message === '' ? 'Network request failed' : message);
}

/**
 * Maps an in-stream failure (`response.failed`, `error` event). A usage-limit
 * error can arrive here after streaming began.
 */
export function mapStreamError(errorObj: Record<string, unknown> | undefined, fallback: FailureKind): ProviderFailure {
  const code = stringField(errorObj, 'code');
  const message = stringField(errorObj, 'message') ?? code ?? 'The response failed';
  const status = numberField(errorObj, 'status');
  return failure(kindForCode(code) ?? fallback, message, { code, param: stringField(errorObj, 'param'), status });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
