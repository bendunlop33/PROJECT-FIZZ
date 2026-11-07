import { describe, expect, it } from 'vitest';

import {
  OPENAI_TOKEN_ENDPOINT,
  decodeJwtPayload,
  exchangeCode,
  parseTokenResponse,
  refreshTokens,
  revokeRefreshToken,
  validateIdTokenClaims,
  type ChatGptTokenSet,
} from '../src';
import { FakeClock, fakeFetch, jsonResponse, makeJwt, textResponse } from './helpers';

const tokenBody = {
  access_token: 'AT-1',
  refresh_token: 'RT-1',
  id_token: 'ID-1',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  earliest_refresh_at: 1_790_000_600,
};

function tokenSet(over: Partial<ChatGptTokenSet> = {}): ChatGptTokenSet {
  return {
    clientId: 'oaiapp_X',
    accessToken: 'AT-1',
    refreshToken: 'RT-1',
    idToken: 'ID-1',
    tokenType: 'Bearer',
    expiresAtMs: 0,
    earliestRefreshAtMs: null,
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
    savedAtMs: 0,
    ...over,
  };
}

describe('exchangeCode', () => {
  it('posts a PKCE authorization_code grant with the issued client, same redirect and resource, no secret', async () => {
    const clock = new FakeClock();
    const { fetch, calls } = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, tokenBody) });
    const r = await exchangeCode(
      { clientId: 'oaiapp_X', code: 'CODE', codeVerifier: 'VERIFIER', redirectUri: 'http://127.0.0.1:1455/auth/callback' },
      { fetch, nowMs: clock.now },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.form).toEqual({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_X',
      code: 'CODE',
      code_verifier: 'VERIFIER',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
    });
    expect(calls[0]?.init.body).not.toMatch(/client_secret/);
    expect(r).toEqual({
      ok: true,
      value: {
        clientId: 'oaiapp_X',
        accessToken: 'AT-1',
        refreshToken: 'RT-1',
        idToken: 'ID-1',
        tokenType: 'Bearer',
        expiresAtMs: clock.ms + 3_600_000,
        earliestRefreshAtMs: 1_790_000_600_000,
        scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
        savedAtMs: clock.ms,
      },
    });
  });

  it('maps invalid_grant and network failure', async () => {
    const clock = new FakeClock();
    const bad = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(400, { error: 'invalid_grant' }) });
    const input = { clientId: 'c', code: 'x', codeVerifier: 'v', redirectUri: 'http://127.0.0.1:1/auth/callback' };
    expect(await exchangeCode(input, { fetch: bad.fetch, nowMs: clock.now })).toMatchObject({ ok: false, error: { kind: 'invalid_grant' } });
    const down = await exchangeCode(input, { fetch: () => Promise.reject(new Error('The Internet connection appears to be offline.')), nowMs: clock.now });
    expect(down).toMatchObject({ ok: false, error: { kind: 'network', retryable: true } });
  });

  it('times out a hung request', async () => {
    const clock = new FakeClock();
    const hung = (_url: string, init: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const r = await exchangeCode({ clientId: 'c', code: 'x', codeVerifier: 'v', redirectUri: 'http://127.0.0.1:1/auth/callback' }, { fetch: hung, nowMs: clock.now, timeoutMs: 10 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('rejects a 200 without an access token', () => {
    expect(parseTokenResponse('{}', 'c', null, 0)).toMatchObject({ ok: false, error: { kind: 'protocol' } });
    expect(parseTokenResponse('not json', 'c', null, 0)).toMatchObject({ ok: false, error: { kind: 'protocol' } });
  });
});

describe('refreshTokens', () => {
  it('uses the issued client ID and refresh token, omits scope, and returns the rotated set', async () => {
    const clock = new FakeClock();
    const { fetch, calls } = fakeFetch({
      [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' }),
    });
    const r = await refreshTokens(tokenSet(), { fetch, nowMs: clock.now });
    expect(calls[0]?.form).toEqual({ grant_type: 'refresh_token', client_id: 'oaiapp_X', refresh_token: 'RT-1', resource: 'https://api.openai.com/v1' });
    expect(r).toMatchObject({ ok: true, value: { accessToken: 'AT-2', refreshToken: 'RT-2', idToken: 'ID-1', expiresAtMs: clock.ms + 3_600_000 } });
  });

  it('keeps the old refresh token and scopes if the response omits them', async () => {
    const clock = new FakeClock();
    const { fetch } = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, { access_token: 'AT-2', expires_in: 60 }) });
    const r = await refreshTokens(tokenSet(), { fetch, nowMs: clock.now });
    expect(r).toMatchObject({ ok: true, value: { refreshToken: 'RT-1', scopes: ['openid', 'chatgpt.tokens.use.direct'] } });
  });

  it('reports refresh_token_reused as unusable, and a missing refresh token without calling the server', async () => {
    const clock = new FakeClock();
    const { fetch, calls } = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(400, { error: 'refresh_token_reused' }) });
    expect(await refreshTokens(tokenSet(), { fetch, nowMs: clock.now })).toMatchObject({ ok: false, error: { kind: 'refresh_unusable' } });
    expect(await refreshTokens(tokenSet({ refreshToken: null }), { fetch, nowMs: clock.now })).toMatchObject({ ok: false, error: { kind: 'refresh_unusable' } });
    expect(calls).toHaveLength(1);
  });
});

describe('ID token claims', () => {
  const now = 1_790_000_000_000;
  const base = { iss: 'https://auth.openai.com', aud: 'oaiapp_X', exp: now / 1000 + 3600, nonce: 'N', sub: 'user-1', email: 'ben@example.com' };
  const check = (claims: Record<string, unknown>, nonce: string | null = 'N') => validateIdTokenClaims(makeJwt(claims), { clientId: 'oaiapp_X', nonce, nowMs: now });

  it('accepts matching issuer, audience, expiry and nonce', () => {
    expect(check(base)).toEqual({ ok: true, value: { subject: 'user-1', email: 'ben@example.com', issuer: 'https://auth.openai.com', expiresAtMs: base.exp * 1000 } });
    expect(check({ ...base, aud: ['other', 'oaiapp_X'] }).ok).toBe(true);
  });

  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'dynamic_agent_client' }],
    ['expiry', { exp: now / 1000 - 3600 }],
    ['nonce', { nonce: 'other' }],
    ['subject', { sub: '' }],
  ])('rejects a wrong %s', (_label, over) => {
    expect(check({ ...base, ...over })).toMatchObject({ ok: false, error: { kind: 'id_token_invalid' } });
  });

  it('rejects malformed tokens', () => {
    expect(validateIdTokenClaims('nope', { clientId: 'oaiapp_X', nonce: null, nowMs: now }).ok).toBe(false);
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
  });
});

describe('revokeRefreshToken', () => {
  it('uses the discovery revocation endpoint and treats an empty 200 as confirmed', async () => {
    const clock = new FakeClock();
    const { fetch, calls } = fakeFetch({
      'https://auth.openai.com/.well-known/openid-configuration': () => jsonResponse(200, { revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' }),
      'https://auth.openai.com/api/accounts/oauth/revoke': () => textResponse(200, ''),
    });
    const r = await revokeRefreshToken(tokenSet(), { fetch, nowMs: clock.now });
    expect(r).toEqual({ confirmed: true, endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke', endpointSource: 'discovery' });
    expect(calls[1]?.form).toEqual({ token: 'RT-1', token_type_hint: 'refresh_token', client_id: 'oaiapp_X' });
  });

  it('falls back to the known endpoint when discovery fails, and reports an unconfirmed revocation', async () => {
    const clock = new FakeClock();
    const { fetch } = fakeFetch({
      'https://auth.openai.com/.well-known/openid-configuration': () => textResponse(503, ''),
      'https://auth.openai.com/api/accounts/oauth/revoke': () => textResponse(500, 'oops'),
    });
    const r = await revokeRefreshToken(tokenSet(), { fetch, nowMs: clock.now });
    expect(r).toMatchObject({ confirmed: false, endpointSource: 'fallback', failure: { kind: 'server' } });
  });
});
