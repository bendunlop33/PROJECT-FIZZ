import { describe, expect, it } from 'vitest';

import {
  DYNAMIC_CLIENT_ID,
  base64UrlDecode,
  base64UrlEncode,
  createAuthAttempt,
  formEncode,
  loopbackRedirectUri,
  newHostId,
  parseCallback,
  parseQuery,
  pkceChallenge,
  redactAuthorizeUrl,
  urlPath,
  type ChatGptRegistration,
} from '../src';
import { nodeCrypto } from './helpers';

const fresh: ChatGptRegistration = { hostId: 'urn:uuid:3f1c2b9e-1d2a-4c55-9a7e-0b1c2d3e4f50', clientId: null, email: null, subject: null };
const returning: ChatGptRegistration = { ...fresh, clientId: 'oaiapp_ABC123xyz', email: 'ben@example.com', subject: 'user-1' };

describe('encoding', () => {
  it('base64url matches Node for every tail length, without padding', () => {
    for (let n = 0; n < 40; n += 1) {
      const bytes = nodeCrypto.randomBytes(n);
      expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
      expect(Array.from(base64UrlDecode(base64UrlEncode(bytes)) ?? [])).toEqual(Array.from(bytes));
    }
  });

  it('rejects invalid base64url', () => {
    expect(base64UrlDecode('a$b')).toBeNull();
    expect(base64UrlDecode('abcde')).toBeNull();
  });

  it('parses queries with + and escapes; keeps the first repeated key', () => {
    expect(parseQuery('http://127.0.0.1:1455/auth/callback?scope=a+b%20c&code=x%2Fy&code=z#frag')).toEqual({ scope: 'a b c', code: 'x/y' });
    expect(parseQuery('/no-query')).toEqual({});
    expect(parseQuery('/p?bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });

  it('form-encodes reserved characters', () => {
    expect(formEncode({ redirect_uri: 'http://127.0.0.1:1455/auth/callback', scope: 'a b' })).toBe(
      'redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&scope=a%20b',
    );
  });

  it('extracts URL paths', () => {
    expect(urlPath('http://127.0.0.1:5000/auth/callback?x=1')).toBe('/auth/callback');
    expect(urlPath('/auth/callback#x')).toBe('/auth/callback');
    expect(urlPath('http://127.0.0.1:5000')).toBe('/');
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', nodeCrypto)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('host ID and redirect', () => {
  it('formats a urn:uuid host ID', () => {
    expect(newHostId('3F1C2B9E-1D2A-4C55-9A7E-0B1C2D3E4F50')).toBe('urn:uuid:3f1c2b9e-1d2a-4c55-9a7e-0b1c2d3e4f50');
    expect(() => newHostId('not-a-uuid')).toThrow(RangeError);
  });

  it('uses 127.0.0.1 and /auth/callback exactly; only the port varies', () => {
    expect(loopbackRedirectUri(1455)).toBe('http://127.0.0.1:1455/auth/callback');
    expect(loopbackRedirectUri(54321)).toBe('http://127.0.0.1:54321/auth/callback');
    expect(() => loopbackRedirectUri(0)).toThrow(RangeError);
    expect(() => loopbackRedirectUri(70000)).toThrow(RangeError);
  });
});

describe('createAuthAttempt', () => {
  it('first registration: dynamic client, agent name, host ID, full scopes, resource, S256', async () => {
    const a = await createAuthAttempt({ port: 1455, registration: fresh }, nodeCrypto);
    expect(a.url.startsWith('https://auth.openai.com/api/accounts/authorize?')).toBe(true);
    const q = parseQuery(a.url);
    expect(q.client_id).toBe(DYNAMIC_CLIENT_ID);
    expect(q.agent_name_hint).toBe('GymSmarter');
    expect(q.ext_agent_host_id).toBe(fresh.hostId);
    expect(q.response_type).toBe('code');
    expect(q.redirect_uri).toBe('http://127.0.0.1:1455/auth/callback');
    expect(q.scope).toBe('openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
    expect(q.resource).toBe('https://api.openai.com/v1');
    expect(q.code_challenge_method).toBe('S256');
    expect(q.code_challenge).toBe(await pkceChallenge(a.codeVerifier, nodeCrypto));
    expect(q.state).toBe(a.state);
    expect(q.nonce).toBe(a.nonce);
    expect(q.id_token_hint).toBeUndefined();
    expect(q.login_hint).toBeUndefined();
    expect(a.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.isNewRegistration).toBe(true);
    // No secret or API key anywhere in the request.
    expect(a.url).not.toMatch(/client_secret|api_key|sk-/);
  });

  it('reauthorization: saved client ID, no agent name, hints included', async () => {
    const a = await createAuthAttempt({ port: 54321, registration: returning, idTokenHint: 'old.id.token' }, nodeCrypto);
    const q = parseQuery(a.url);
    expect(q.client_id).toBe('oaiapp_ABC123xyz');
    expect(q.agent_name_hint).toBeUndefined();
    expect(q.ext_agent_host_id).toBe(fresh.hostId);
    expect(q.id_token_hint).toBe('old.id.token');
    expect(q.login_hint).toBe('ben@example.com');
    expect(q.redirect_uri).toBe('http://127.0.0.1:54321/auth/callback');
    expect(a.isNewRegistration).toBe(false);
  });

  it('uses fresh state, nonce and verifier on every attempt', async () => {
    const a = await createAuthAttempt({ port: 1455, registration: fresh }, nodeCrypto);
    const b = await createAuthAttempt({ port: 1455, registration: fresh }, nodeCrypto);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it('redacts state, nonce, challenge and hints for logs', async () => {
    const a = await createAuthAttempt({ port: 1455, registration: returning, idTokenHint: 'old.id.token' }, nodeCrypto);
    const r = redactAuthorizeUrl(a.url);
    expect(r).not.toContain(a.state);
    expect(r).not.toContain(a.nonce);
    expect(r).not.toContain('old.id.token');
    expect(r).not.toContain('ben%40example.com');
    expect(r).toContain('client_id=oaiapp_ABC123xyz');
  });
});

describe('parseCallback', () => {
  async function attempt(reg: ChatGptRegistration) {
    return createAuthAttempt({ port: 1455, registration: reg }, nodeCrypto);
  }
  const cb = (q: Record<string, string>, path = '/auth/callback') => `http://127.0.0.1:1455${path}?${new URLSearchParams(q).toString()}`;

  it('accepts a new registration with an issued client ID', async () => {
    const a = await attempt(fresh);
    const r = parseCallback(cb({ code: 'c1', state: a.state, client_id: 'oaiapp_NEW', scope: 'openid chatgpt.tokens.use.direct' }), a);
    expect(r).toEqual({ ok: true, value: { code: 'c1', clientId: 'oaiapp_NEW', issuedClientId: 'oaiapp_NEW', callbackScopes: ['openid', 'chatgpt.tokens.use.direct'] } });
  });

  it('rejects a state mismatch before anything else, even on an error callback', async () => {
    const a = await attempt(fresh);
    const r = parseCallback(cb({ error: 'access_denied', state: 'other' }), a);
    expect(r.ok ? null : r.error.kind).toBe('state_mismatch');
  });

  it('reports declined consent without exchanging', async () => {
    const a = await attempt(fresh);
    const r = parseCallback(cb({ error: 'access_denied', state: a.state }), a);
    expect(r.ok ? null : r.error.kind).toBe('access_denied');
  });

  it('treats a new registration without an issued client ID as incomplete', async () => {
    const a = await attempt(fresh);
    expect(parseCallback(cb({ code: 'c', state: a.state }), a)).toMatchObject({ ok: false, error: { kind: 'registration_incomplete' } });
    expect(parseCallback(cb({ code: 'c', state: a.state, client_id: DYNAMIC_CLIENT_ID }), a)).toMatchObject({ ok: false, error: { kind: 'registration_incomplete' } });
  });

  it('reauthorization keeps the saved client ID and rejects a different one', async () => {
    const a = await attempt(returning);
    expect(parseCallback(cb({ code: 'c', state: a.state }), a)).toMatchObject({ ok: true, value: { clientId: 'oaiapp_ABC123xyz', issuedClientId: null } });
    expect(parseCallback(cb({ code: 'c', state: a.state, client_id: 'oaiapp_OTHER' }), a)).toMatchObject({ ok: false, error: { kind: 'client_id_mismatch' } });
  });

  it('rejects a missing code and a wrong path', async () => {
    const a = await attempt(fresh);
    expect(parseCallback(cb({ state: a.state, client_id: 'oaiapp_X' }), a)).toMatchObject({ ok: false, error: { kind: 'missing_code' } });
    expect(parseCallback(cb({ code: 'c', state: a.state }, '/callback'), a)).toMatchObject({ ok: false, error: { kind: 'protocol' } });
  });
});
