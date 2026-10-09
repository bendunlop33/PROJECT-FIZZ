/**
 * Documented values for "Sign in with ChatGPT" plan usage (open-source/local
 * flow). Sources, checked 2026-10-09:
 * - https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 * - https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
 * - https://auth.openai.com/.well-known/openid-configuration (revocation endpoint)
 * - https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
 *
 * No secret lives here: this flow is a public PKCE client with no client
 * secret and no API key.
 */

export const OPENAI_ISSUER = 'https://auth.openai.com';
export const OPENAI_AUTHORIZE_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
export const OPENAI_TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
/** From the discovery document; the docs say to read it from there. */
export const OPENAI_DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
/** Value seen in the discovery document on 2026-10-09, used only if discovery can't be read. */
export const OPENAI_REVOCATION_ENDPOINT_FALLBACK = 'https://auth.openai.com/api/accounts/oauth/revoke';

export const OPENAI_API_BASE = 'https://api.openai.com/v1';
/** OAuth `resource` for plan usage; also the access token's audience. */
export const OPENAI_RESOURCE = 'https://api.openai.com/v1';
export const OPENAI_MODELS_URL = `${OPENAI_API_BASE}/models`;
/** The only inference endpoint this route may use (never ChatGPT backend-api). */
export const OPENAI_RESPONSES_URL = `${OPENAI_API_BASE}/responses`;

/** First-time registration entry point. Never saved or used for token exchange. */
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';

/** Grants inference on the user's plan. Without it, no inference may be attempted. */
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';
export const REQUESTED_SCOPES: readonly string[] = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  PLAN_USAGE_SCOPE,
];

/** Loopback redirect: scheme, host and path are fixed; only the port may vary. Never `localhost`. */
export const LOOPBACK_HOST = '127.0.0.1';
export const CALLBACK_PATH = '/auth/callback';
/** The port in OpenAI's example. Tried first; any free port is allowed. */
export const PREFERRED_CALLBACK_PORT = 1455;

/** The app's real name, sent as `agent_name_hint` on first registration only. */
export const AGENT_NAME = 'Fizz';

/** Access tokens last 1 h; refresh this long before expiry. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function loopbackRedirectUri(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`Invalid loopback port: ${String(port)}`);
  return `http://${LOOPBACK_HOST}:${String(port)}${CALLBACK_PATH}`;
}
