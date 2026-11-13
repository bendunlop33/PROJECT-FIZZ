/**
 * Authorization request and loopback callback handling for "Sign in with
 * ChatGPT" (public client, PKCE S256, fresh state and nonce per attempt).
 * Source: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 */

import { base64UrlEncode, err, formEncode, ok, parseQuery, urlPath, utf8Encode, type CryptoPort, type Result } from '../http';
import {
  AGENT_NAME,
  CALLBACK_PATH,
  DYNAMIC_CLIENT_ID,
  OPENAI_AUTHORIZE_ENDPOINT,
  OPENAI_RESOURCE,
  REQUESTED_SCOPES,
  loopbackRedirectUri,
} from './constants';
import { failure, type ProviderFailure } from './errors';

/** RFC 7636: 32 random bytes → a 43-character verifier. */
const VERIFIER_BYTES = 32;
const STATE_BYTES = 24;
const NONCE_BYTES = 24;

/** The persisted, non-secret registration for this phone (host) and account. */
export interface ChatGptRegistration {
  /** Opaque, stable per host (`urn:uuid:…`); chosen before the first sign-in. */
  hostId: string;
  /** Issued client ID (`oaiapp_…`) from the first registration; null until then. */
  clientId: string | null;
  /** From the validated ID token; for login_hint and display only. */
  email: string | null;
  subject: string | null;
}

/** Everything one authorization attempt needs to keep until its callback. Held in memory only. */
export interface AuthAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  /** Client ID sent in this attempt (`dynamic_agent_client` on first registration). */
  requestClientId: string;
  isNewRegistration: boolean;
  url: string;
}

export interface AttemptOptions {
  port: number;
  registration: ChatGptRegistration;
  /** Retained ID token from this account's last sign-in, if any (reauthorization only). */
  idTokenHint?: string | null;
}

export function newHostId(uuid: string): string {
  const id = uuid.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new RangeError('Host ID needs a UUID');
  return `urn:uuid:${id}`;
}

export async function pkceChallenge(verifier: string, crypto: CryptoPort): Promise<string> {
  return base64UrlEncode(await crypto.sha256(utf8Encode(verifier)));
}

/** Builds a fresh attempt: new state, nonce and PKCE verifier every time. */
export async function createAuthAttempt(options: AttemptOptions, crypto: CryptoPort): Promise<AuthAttempt> {
  const state = base64UrlEncode(crypto.randomBytes(STATE_BYTES));
  const nonce = base64UrlEncode(crypto.randomBytes(NONCE_BYTES));
  const codeVerifier = base64UrlEncode(crypto.randomBytes(VERIFIER_BYTES));
  const codeChallenge = await pkceChallenge(codeVerifier, crypto);
  const redirectUri = loopbackRedirectUri(options.port);
  const { registration } = options;
  const isNewRegistration = registration.clientId === null;
  const requestClientId = registration.clientId ?? DYNAMIC_CLIENT_ID;

  const params: Record<string, string> = { client_id: requestClientId };
  // agent_name_hint only on initial dynamic registration.
  if (isNewRegistration) params.agent_name_hint = AGENT_NAME;
  params.ext_agent_host_id = registration.hostId;
  if (!isNewRegistration) {
    if (options.idTokenHint) params.id_token_hint = options.idTokenHint;
    if (registration.email) params.login_hint = registration.email;
  }
  params.response_type = 'code';
  params.redirect_uri = redirectUri;
  params.scope = REQUESTED_SCOPES.join(' ');
  params.resource = OPENAI_RESOURCE;
  params.state = state;
  params.nonce = nonce;
  params.code_challenge_method = 'S256';
  params.code_challenge = codeChallenge;

  return {
    state,
    nonce,
    codeVerifier,
    codeChallenge,
    redirectUri,
    requestClientId,
    isNewRegistration,
    url: `${OPENAI_AUTHORIZE_ENDPOINT}?${formEncode(params)}`,
  };
}

/** The authorize URL with secrets-adjacent values removed, for logs and exports. */
export function redactAuthorizeUrl(url: string): string {
  return url
    .replace(/([?&](?:state|nonce|code_challenge|id_token_hint|login_hint)=)[^&]*/g, '$1[redacted]')
    .replace(/([?&]ext_agent_host_id=)[^&]*/g, '$1[host id]');
}

export interface CallbackResult {
  code: string;
  /** The client to exchange with: issued ID (new registration) or the saved one. */
  clientId: string;
  /** Issued client ID if the callback carried one. */
  issuedClientId: string | null;
  /** `scope` as returned on the callback, if present (informational; the token response decides). */
  callbackScopes: string[] | null;
}

/**
 * Validates the loopback callback against the pending attempt. State is
 * checked first, including on error callbacks.
 */
export function parseCallback(callbackUrl: string, attempt: AuthAttempt): Result<CallbackResult, ProviderFailure> {
  if (urlPath(callbackUrl) !== CALLBACK_PATH) {
    return err(failure('protocol', `Callback arrived on an unexpected path (${urlPath(callbackUrl)})`));
  }
  const q = parseQuery(callbackUrl);
  if (q.state !== attempt.state) {
    return err(failure('state_mismatch', 'The sign-in reply did not match this attempt (state mismatch). Nothing was used.'));
  }
  if (q.error !== undefined) {
    const description = q.error_description ? `: ${q.error_description}` : '';
    if (q.error === 'access_denied') return err(failure('access_denied', `Access was declined${description}`, { code: q.error }));
    return err(failure('oauth_error', `Sign-in returned ${q.error}${description}`, { code: q.error }));
  }
  const code = q.code;
  if (code === undefined || code === '') return err(failure('missing_code', 'The sign-in reply had no authorization code'));

  const returned = q.client_id && q.client_id !== '' ? q.client_id : null;
  let clientId: string;
  if (attempt.isNewRegistration) {
    if (returned === null || returned === DYNAMIC_CLIENT_ID) {
      return err(failure('registration_incomplete', 'New registration did not return an issued client ID'));
    }
    clientId = returned;
  } else {
    if (returned !== null && returned !== attempt.requestClientId) {
      return err(failure('client_id_mismatch', 'The sign-in reply named a different app registration; it was rejected'));
    }
    clientId = attempt.requestClientId;
  }
  return ok({
    code,
    clientId,
    issuedClientId: returned,
    callbackScopes: q.scope === undefined ? null : splitScopes(q.scope),
  });
}

export function splitScopes(scope: string): string[] {
  return scope
    .split(/[\s+]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
