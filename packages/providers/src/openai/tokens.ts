/**
 * Token endpoint calls (code exchange, refresh with rotation, revocation)
 * and ID-token claim validation.
 * Sources: .../sign-in, .../token-reference, .../profiles-and-sessions (2026-10-09).
 */

import {
  base64UrlDecode,
  err,
  formEncode,
  numberField,
  ok,
  parseJsonObject,
  readTextSafely,
  stringField,
  utf8Decode,
  type FetchLike,
  type Result,
} from '../http';
import { splitScopes } from './authorize';
import {
  OPENAI_DISCOVERY_URL,
  OPENAI_ISSUER,
  OPENAI_RESOURCE,
  OPENAI_REVOCATION_ENDPOINT_FALLBACK,
  OPENAI_TOKEN_ENDPOINT,
  PLAN_USAGE_SCOPE,
} from './constants';
import { failure, mapThrown, mapTokenError, type ProviderFailure } from './errors';

/** The credential set saved in the Keychain. Replaced as a whole on refresh. */
export interface ChatGptTokenSet {
  /** Issued client ID these tokens belong to (never `dynamic_agent_client`). */
  clientId: string;
  accessToken: string;
  /** Rotates on every refresh. Null only if offline_access wasn't granted. */
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  expiresAtMs: number;
  /** `earliest_refresh_at` from the token response, if sent. */
  earliestRefreshAtMs: number | null;
  scopes: string[];
  savedAtMs: number;
}

export interface TokenCallOptions {
  fetch: FetchLike;
  nowMs: () => number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function hasPlanUsageScope(scopes: readonly string[]): boolean {
  return scopes.includes(PLAN_USAGE_SCOPE);
}

/** Authorization-code exchange with PKCE. No client secret. */
export async function exchangeCode(
  input: { clientId: string; code: string; codeVerifier: string; redirectUri: string },
  options: TokenCallOptions,
): Promise<Result<ChatGptTokenSet, ProviderFailure>> {
  const body = formEncode({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    resource: OPENAI_RESOURCE,
  });
  return tokenRequest(body, 'authorization_code', input.clientId, null, options);
}

/**
 * Refresh grant. Uses the issued client ID saved with the token set and
 * omits `scope` to keep the grant. The caller must store the whole returned
 * set (new access token, expiry, scopes and the rotated refresh token).
 */
export async function refreshTokens(current: ChatGptTokenSet, options: TokenCallOptions): Promise<Result<ChatGptTokenSet, ProviderFailure>> {
  if (current.refreshToken === null) {
    return err(failure('refresh_unusable', 'No refresh token was granted; sign in again'));
  }
  const body = formEncode({
    grant_type: 'refresh_token',
    client_id: current.clientId,
    refresh_token: current.refreshToken,
    resource: OPENAI_RESOURCE,
  });
  return tokenRequest(body, 'refresh_token', current.clientId, current, options);
}

async function tokenRequest(
  body: string,
  grant: 'authorization_code' | 'refresh_token',
  clientId: string,
  previous: ChatGptTokenSet | null,
  options: TokenCallOptions,
): Promise<Result<ChatGptTokenSet, ProviderFailure>> {
  const sent = await timedFetch(
    OPENAI_TOKEN_ENDPOINT,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body },
    options,
  );
  if (!sent.ok) return sent;
  const response = sent.value;
  const text = await readTextSafely(response);
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) return err(mapTokenError(response.status, text, grant, requestId));
  return parseTokenResponse(text, clientId, previous, options.nowMs());
}

/**
 * Parses a 200 token response. On refresh, a missing `refresh_token` keeps
 * the previous one and a missing `scope` keeps the previous scopes, so the
 * saved set is never left without them.
 */
export function parseTokenResponse(
  text: string,
  clientId: string,
  previous: ChatGptTokenSet | null,
  nowMs: number,
): Result<ChatGptTokenSet, ProviderFailure> {
  const json = parseJsonObject(text);
  const accessToken = stringField(json, 'access_token');
  if (json === null || accessToken === undefined || accessToken === '') {
    return err(failure('protocol', 'Token response had no access token'));
  }
  const expiresIn = numberField(json, 'expires_in') ?? 3600;
  const earliest = numberField(json, 'earliest_refresh_at');
  const scope = stringField(json, 'scope');
  return ok({
    clientId,
    accessToken,
    refreshToken: stringField(json, 'refresh_token') ?? previous?.refreshToken ?? null,
    idToken: stringField(json, 'id_token') ?? previous?.idToken ?? null,
    tokenType: stringField(json, 'token_type') ?? 'Bearer',
    expiresAtMs: nowMs + expiresIn * 1000,
    // Unix seconds per the docs' other timestamps; a value that already looks like ms is kept.
    earliestRefreshAtMs: earliest === undefined ? null : earliest > 1e12 ? earliest : earliest * 1000,
    scopes: scope === undefined ? (previous?.scopes ?? []) : splitScopes(scope),
    savedAtMs: nowMs,
  });
}

// ---------- ID token ----------

export interface IdTokenClaims {
  subject: string;
  email: string | null;
  issuer: string;
  expiresAtMs: number;
}

/**
 * Checks the ID token's claims: issuer, audience (the issued client ID),
 * expiry and the attempt's nonce.
 *
 * The RS256 signature is NOT verified here (no JWKS/RSA in this pure
 * package yet). The token comes straight from the token endpoint over TLS,
 * which OIDC Core §3.1.3.7 allows in place of a signature check for this
 * code flow; OpenAI's guide still asks for JWKS verification, so that is an
 * open item before the coach ships (ADR 0012).
 */
export function validateIdTokenClaims(
  idToken: string,
  expected: { clientId: string; nonce: string | null; nowMs: number; clockSkewMs?: number },
): Result<IdTokenClaims, ProviderFailure> {
  const claims = decodeJwtPayload(idToken);
  if (claims === null) return err(failure('id_token_invalid', 'ID token could not be read'));
  const iss = stringField(claims, 'iss');
  if (iss !== OPENAI_ISSUER) return err(failure('id_token_invalid', `ID token issuer is not ${OPENAI_ISSUER}`));
  const aud = claims.aud;
  const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud.filter((a): a is string => typeof a === 'string') : [];
  if (!audiences.includes(expected.clientId)) return err(failure('id_token_invalid', 'ID token audience is not this app registration'));
  const exp = numberField(claims, 'exp');
  const skew = expected.clockSkewMs ?? 120_000;
  if (exp === undefined || exp * 1000 + skew < expected.nowMs) return err(failure('id_token_invalid', 'ID token has expired'));
  if (expected.nonce !== null && stringField(claims, 'nonce') !== expected.nonce) {
    return err(failure('id_token_invalid', 'ID token nonce does not match this attempt'));
  }
  const sub = stringField(claims, 'sub');
  if (sub === undefined || sub === '') return err(failure('id_token_invalid', 'ID token has no subject'));
  return ok({ subject: sub, email: stringField(claims, 'email') ?? null, issuer: iss, expiresAtMs: exp * 1000 });
}

/** Decodes a JWT payload without verifying it. Returns null when malformed. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const bytes = base64UrlDecode(parts[1] ?? '');
  if (bytes === null) return null;
  try {
    return parseJsonObject(utf8Decode(bytes));
  } catch {
    return null;
  }
}

// ---------- Revocation ----------

export interface RevokeOutcome {
  /** True only on the documented empty HTTP 200. */
  confirmed: boolean;
  endpoint: string;
  endpointSource: 'discovery' | 'fallback';
  failure?: ProviderFailure;
}

/**
 * Revokes the renewable session (refresh token). The caller clears local
 * tokens either way, and tells Ben when remote revocation wasn't confirmed.
 */
export async function revokeRefreshToken(tokens: ChatGptTokenSet, options: TokenCallOptions): Promise<RevokeOutcome> {
  const { endpoint, source } = await revocationEndpoint(options);
  if (tokens.refreshToken === null) {
    return { confirmed: false, endpoint, endpointSource: source, failure: failure('refresh_unusable', 'No refresh token to revoke') };
  }
  const sent = await timedFetch(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: tokens.clientId }),
    },
    options,
  );
  if (!sent.ok) return { confirmed: false, endpoint, endpointSource: source, failure: sent.error };
  const response = sent.value;
  const text = await readTextSafely(response);
  if (response.status === 200) return { confirmed: true, endpoint, endpointSource: source };
  return { confirmed: false, endpoint, endpointSource: source, failure: mapTokenError(response.status, text, 'refresh_token', response.headers.get('x-request-id')) };
}

async function revocationEndpoint(options: TokenCallOptions): Promise<{ endpoint: string; source: 'discovery' | 'fallback' }> {
  const sent = await timedFetch(OPENAI_DISCOVERY_URL, { method: 'GET', headers: { Accept: 'application/json' } }, options);
  if (sent.ok && sent.value.ok) {
    const endpoint = stringField(parseJsonObject(await readTextSafely(sent.value)), 'revocation_endpoint');
    if (endpoint?.startsWith('https://')) return { endpoint, source: 'discovery' };
  }
  return { endpoint: OPENAI_REVOCATION_ENDPOINT_FALLBACK, source: 'fallback' };
}

// ---------- Shared ----------

/** fetch with a timeout; maps throws to typed failures. */
export async function timedFetch(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  options: { fetch: FetchLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<Result<Awaited<ReturnType<FetchLike>>, ProviderFailure>> {
  const controller = new AbortController();
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onOuterAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onOuterAbort);
  try {
    return ok(await options.fetch(url, { ...init, signal: controller.signal }));
  } catch (e) {
    return err(mapThrown(e, state.timedOut));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
