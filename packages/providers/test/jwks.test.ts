import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { OPENAI_DISCOVERY_URL, base64UrlEncode, fetchOpenAiJwks, parseJwks, utf8Encode, verifyIdTokenSignature, verifyJwtSignature } from '../src';
import { TEST_DISCOVERY, TEST_JWKS, TEST_JWKS_URL, fakeFetch, jsonResponse, makeJwt, nodeCrypto, textResponse } from './helpers';

const CLAIMS = { iss: 'https://auth.openai.com', sub: 'user-1', aud: 'oaiapp_X', exp: 2e9 };
const KEYS = parseJwks(JSON.stringify(TEST_JWKS));
const nowMs = () => 0;

describe('ID token RS256 check against the JWKS (ADR 0012, review S5)', () => {
  it('accepts a token signed by the published key', async () => {
    expect(KEYS).toHaveLength(1);
    expect(KEYS[0]?.k).toBe(256);
    expect(await verifyJwtSignature(makeJwt(CLAIMS), KEYS, nodeCrypto)).toEqual({ ok: true, value: undefined });
  });

  it('rejects a token signed by another key, a tampered payload and an unknown kid', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(await verifyJwtSignature(makeJwt(CLAIMS, { privateKey: stranger.privateKey }), KEYS, nodeCrypto)).toMatchObject({ ok: false, error: { kind: 'id_token_invalid' } });

    const [h, , s] = makeJwt(CLAIMS).split('.');
    const forged = base64UrlEncode(utf8Encode(JSON.stringify({ ...CLAIMS, sub: 'attacker' })));
    expect(await verifyJwtSignature(`${h ?? ''}.${forged}.${s ?? ''}`, KEYS, nodeCrypto)).toMatchObject({ ok: false, error: { kind: 'id_token_invalid' } });

    expect(await verifyJwtSignature(makeJwt(CLAIMS, { kid: 'other' }), KEYS, nodeCrypto)).toMatchObject({ ok: false, error: { message: 'No OpenAI signing key matches the ID token' } });
  });

  it('only RS256: alg none or HS256 never verifies', async () => {
    const enc = (o: unknown) => base64UrlEncode(utf8Encode(JSON.stringify(o)));
    const none = `${enc({ alg: 'none', kid: 'test-key-1' })}.${enc(CLAIMS)}.`;
    expect(await verifyJwtSignature(none, KEYS, nodeCrypto)).toMatchObject({ ok: false, error: { message: 'ID token algorithm is none, not RS256' } });
    const hs = makeJwt(CLAIMS, { alg: 'HS256' });
    expect(await verifyJwtSignature(hs, KEYS, nodeCrypto)).toMatchObject({ ok: false });
  });

  it('skips non-RSA, encryption and short keys in the JWKS', () => {
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' });
    const jwks = { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }, { ...TEST_JWKS.keys[0], use: 'enc' }, { ...weak, kid: 'weak' }, TEST_JWKS.keys[0]] };
    expect(parseJwks(JSON.stringify(jwks)).map((k) => k.kid)).toEqual(['test-key-1']);
    expect(parseJwks('not json')).toEqual([]);
  });

  it('reads the JWKS URI from discovery; no jwks_uri or an empty JWKS fails honestly', async () => {
    const good = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => jsonResponse(200, TEST_DISCOVERY), [TEST_JWKS_URL]: () => jsonResponse(200, TEST_JWKS) });
    expect(await verifyIdTokenSignature(makeJwt(CLAIMS), { fetch: good.fetch, nowMs, crypto: nodeCrypto })).toEqual({ ok: true, value: undefined });
    expect(good.calls.map((c) => c.url)).toEqual([OPENAI_DISCOVERY_URL, TEST_JWKS_URL]);

    const noUri = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => jsonResponse(200, { issuer: 'x' }) });
    expect(await fetchOpenAiJwks({ fetch: noUri.fetch, nowMs })).toMatchObject({ ok: false, error: { kind: 'protocol', message: 'Discovery document has no usable jwks_uri' } });

    const elsewhere = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => jsonResponse(200, { jwks_uri: 'https://evil.example/jwks' }) });
    expect(await fetchOpenAiJwks({ fetch: elsewhere.fetch, nowMs })).toMatchObject({ ok: false });

    const empty = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => jsonResponse(200, TEST_DISCOVERY), [TEST_JWKS_URL]: () => jsonResponse(200, { keys: [] }) });
    expect(await fetchOpenAiJwks({ fetch: empty.fetch, nowMs })).toMatchObject({ ok: false, error: { message: 'JWKS has no RSA signing keys' } });

    const down = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => textResponse(503, '') });
    expect(await fetchOpenAiJwks({ fetch: down.fetch, nowMs })).toMatchObject({ ok: false });
  });

  it('offline or unreachable keys read differently from a signature mismatch (review r2 S1)', async () => {
    const offline = fakeFetch({});
    const r = await verifyIdTokenSignature(makeJwt(CLAIMS), { fetch: offline.fetch, nowMs, crypto: nodeCrypto });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).not.toBe('id_token_invalid');
    expect(r.error.message).toMatch(/^Couldn’t fetch OpenAI’s signing keys to check the sign-in \(.*\)\. Nothing was saved; try again when you’re online\.$/);

    const down = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => textResponse(503, '') });
    const d = await verifyIdTokenSignature(makeJwt(CLAIMS), { fetch: down.fetch, nowMs, crypto: nodeCrypto });
    expect(d).toMatchObject({ ok: false, error: { kind: 'protocol' } });

    const good = fakeFetch({ [OPENAI_DISCOVERY_URL]: () => jsonResponse(200, TEST_DISCOVERY), [TEST_JWKS_URL]: () => jsonResponse(200, TEST_JWKS) });
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const bad = await verifyIdTokenSignature(makeJwt(CLAIMS, { privateKey: stranger.privateKey }), { fetch: good.fetch, nowMs, crypto: nodeCrypto });
    expect(bad).toMatchObject({ ok: false, error: { kind: 'id_token_invalid' } });
    if (bad.ok) return;
    expect(bad.error.message).toMatch(/^ID token signature does not match/);
  });
});
