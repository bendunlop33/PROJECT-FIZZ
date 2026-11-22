import { describe, expect, it } from 'vitest';

import { mapApiError, mapStreamError, mapThrown, mapTokenError } from '../src';

const apiErr = (code: string, message = 'm', param?: string) => JSON.stringify({ error: { code, message, param: param ?? null, type: 'x' } });

describe('mapApiError (documented plan-usage codes)', () => {
  it.each([
    [429, 'subscription_sharing_usage_limit_exceeded', 'usage_limit', 'manage_usage', false],
    [403, 'subscription_sharing_user_not_eligible', 'not_eligible', 'explain_only', false],
    [503, 'subscription_sharing_usage_unavailable', 'unavailable', 'retry_later', true],
    [503, 'subscription_sharing_user_unavailable', 'unavailable', 'retry_later', true],
    [400, 'subscription_sharing_unsupported_capability', 'unsupported_capability', 'fix_request', false],
    [403, 'subscription_sharing_route_not_supported', 'route_not_supported', 'fix_request', false],
    [401, 'subscription_sharing_invalid_user', 'invalid_user', 'sign_in_again', false],
    [403, 'chatpass_v2_scope_not_authorized', 'scope_not_authorized', 'explain_only', false],
    [403, 'chatpass_v2_invalid_authorization_context', 'scope_not_authorized', 'explain_only', false],
  ] as const)('%i %s → %s', (status, code, kind, recovery, retryable) => {
    const f = mapApiError(status, apiErr(code), 'req_1');
    expect(f).toMatchObject({ kind, recovery, retryable, status, code, requestId: 'req_1' });
  });

  it('keeps error.param', () => {
    expect(mapApiError(400, apiErr('subscription_sharing_unsupported_capability', 'no', 'temperature')).param).toBe('temperature');
  });

  it('direct-admission {detail} bodies: region text → region, other 403 → policy', () => {
    expect(mapApiError(403, JSON.stringify({ detail: 'Not available in your country or region' })).kind).toBe('region');
    expect(mapApiError(403, JSON.stringify({ detail: 'Forbidden' })).kind).toBe('policy_forbidden');
    expect(mapApiError(401, JSON.stringify({ detail: 'bad identity' }))).toMatchObject({ kind: 'unauthorized', recovery: 'sign_in_again', message: 'bad identity' });
    expect(mapApiError(503, JSON.stringify({ detail: 'disabled' }))).toMatchObject({ kind: 'unavailable', retryable: true });
  });

  it('unknown codes fall back to the HTTP status; non-JSON bodies are diagnostic text', () => {
    expect(mapApiError(429, apiErr('rate_limit_exceeded')).kind).toBe('rate_limited');
    expect(mapApiError(500, '<html>oops</html>')).toMatchObject({ kind: 'server', message: '<html>oops</html>' });
    expect(mapApiError(404, '')).toMatchObject({ kind: 'bad_request', message: 'HTTP 404' });
  });
});

describe('mapTokenError', () => {
  it.each(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])(
    'refresh %s is unusable (sign in again)',
    (code) => {
      expect(mapTokenError(400, JSON.stringify({ error: code }), 'refresh_token')).toMatchObject({ kind: 'refresh_unusable', recovery: 'sign_in_again' });
    },
  );

  it('code exchange invalid_grant means start a fresh authorization', () => {
    expect(mapTokenError(400, JSON.stringify({ error: 'invalid_grant', error_description: 'code used' }), 'authorization_code')).toMatchObject({
      kind: 'invalid_grant',
      message: 'code used',
    });
  });

  it('invalid_client and nested error shapes', () => {
    expect(mapTokenError(401, JSON.stringify({ error: 'invalid_client' }), 'refresh_token').kind).toBe('invalid_client');
    expect(mapTokenError(400, JSON.stringify({ error: { code: 'refresh_token_reused', message: 'reused' } }), 'refresh_token').kind).toBe('refresh_unusable');
  });

  it('5xx and network failures keep credentials (not unusable)', () => {
    expect(mapTokenError(502, 'bad gateway', 'refresh_token')).toMatchObject({ kind: 'server', retryable: true });
    expect(mapThrown(new Error('offline'), false)).toMatchObject({ kind: 'network', retryable: true });
    expect(mapThrown(new Error('aborted'), true).kind).toBe('timeout');
  });
});

describe('mapStreamError', () => {
  it('maps a usage-limit failure that arrives after streaming began', () => {
    expect(mapStreamError({ code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' }, 'response_failed')).toMatchObject({
      kind: 'usage_limit',
      recovery: 'manage_usage',
    });
    expect(mapStreamError({ code: 'server_error', message: 'x' }, 'response_failed').kind).toBe('response_failed');
    expect(mapStreamError(undefined, 'response_failed').message).toBe('The response failed');
  });
});
