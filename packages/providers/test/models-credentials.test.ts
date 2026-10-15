import { describe, expect, it } from 'vitest';

import {
  OPENAI_MODELS_URL,
  OPENAI_TOKEN_ENDPOINT,
  TokenRefresher,
  listModels,
  needsRefresh,
  parseModelList,
  parseRegistration,
  parseTokens,
  pickModel,
  serializeRegistration,
  serializeTokens,
  type ChatGptTokenSet,
} from '../src';
import { FakeClock, MemoryVault, fakeFetch, jsonResponse } from './helpers';

describe('models', () => {
  it('keeps visibility "list" entries in server order (documented models[] shape)', () => {
    const parsed = parseModelList(
      JSON.stringify({
        models: [
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
          { slug: 'internal', display_name: 'Internal', visibility: 'hide' },
          { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list' },
          { display_name: 'no slug', visibility: 'list' },
        ],
      }),
    );
    expect(parsed).toEqual({
      models: [
        { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' },
        { slug: 'gpt-6-luna', displayName: 'GPT-6 Luna' },
      ],
      hiddenCount: 1,
      shape: 'models',
    });
  });

  it('accepts the standard data[] shape and reports it', () => {
    expect(parseModelList(JSON.stringify({ data: [{ id: 'gpt-x' }] }))).toEqual({ models: [{ slug: 'gpt-x', displayName: 'gpt-x' }], hiddenCount: 0, shape: 'data' });
    expect(parseModelList('{"nothing":1}')).toBeNull();
  });

  it('calls GET /v1/models with the bearer token and maps errors', async () => {
    const { fetch, calls } = fakeFetch({
      [OPENAI_MODELS_URL]: [() => jsonResponse(200, { models: [] }), () => jsonResponse(403, { error: { code: 'subscription_sharing_user_not_eligible', message: 'no' } })],
    });
    expect(await listModels('AT', { fetch })).toMatchObject({ ok: true, value: { models: [] } });
    expect(calls[0]?.init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer AT' } });
    expect(await listModels('AT', { fetch })).toMatchObject({ ok: false, error: { kind: 'not_eligible' } });
  });

  it('picks the tested model if listed, otherwise the first', () => {
    const list = [
      { slug: 'a', displayName: 'A' },
      { slug: 'b', displayName: 'B' },
    ];
    expect(pickModel(list, 'b')?.slug).toBe('b');
    expect(pickModel(list, 'gone')?.slug).toBe('a');
    expect(pickModel([], null)).toBeNull();
  });
});

function tokens(over: Partial<ChatGptTokenSet> = {}): ChatGptTokenSet {
  return {
    clientId: 'oaiapp_X',
    accessToken: 'AT-1',
    refreshToken: 'RT-1',
    idToken: 'ID-1',
    tokenType: 'Bearer',
    expiresAtMs: 2_000_000,
    earliestRefreshAtMs: null,
    scopes: ['chatgpt.tokens.use.direct'],
    savedAtMs: 1_000_000,
    ...over,
  };
}

describe('credential records', () => {
  it('round-trip, and corrupt or foreign data reads as absent', () => {
    expect(parseTokens(serializeTokens(tokens()))).toEqual(tokens());
    expect(parseTokens('not json')).toBeNull();
    expect(parseTokens(JSON.stringify({ v: 99, accessToken: 'x' }))).toBeNull();
    expect(parseTokens(null)).toBeNull();
    const reg = { hostId: 'urn:uuid:x', clientId: 'oaiapp_X', email: null, subject: 's' };
    expect(parseRegistration(serializeRegistration(reg))).toEqual(reg);
    expect(parseRegistration(JSON.stringify({ v: 1, hostId: '' }))).toBeNull();
  });

  it('needs a refresh within the skew before expiry', () => {
    expect(needsRefresh(tokens({ expiresAtMs: 10_000_000 }), 10_000_000 - 5 * 60_000 - 1)).toBe(false);
    expect(needsRefresh(tokens({ expiresAtMs: 10_000_000 }), 10_000_000 - 5 * 60_000)).toBe(true);
  });
});

describe('TokenRefresher', () => {
  const rotated = { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600, scope: 'chatgpt.tokens.use.direct' };

  it('does not refresh a fresh token', async () => {
    const clock = new FakeClock(1_000_000);
    const vault = new MemoryVault();
    vault.tokens = serializeTokens(tokens({ expiresAtMs: clock.ms + 3_600_000 }));
    const { fetch, calls } = fakeFetch({});
    const r = await new TokenRefresher(vault, { fetch, nowMs: clock.now }).ensureFresh();
    expect(r).toMatchObject({ ok: true, value: { refreshed: false } });
    expect(calls).toHaveLength(0);
  });

  it('refreshes near expiry and stores the rotated set as one write', async () => {
    const clock = new FakeClock(1_999_000);
    const vault = new MemoryVault();
    vault.tokens = serializeTokens(tokens());
    const { fetch } = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, rotated) });
    const r = await new TokenRefresher(vault, { fetch, nowMs: clock.now }).ensureFresh();
    expect(r).toMatchObject({ ok: true, value: { refreshed: true, rotated: true } });
    expect(vault.writes).toEqual(['tokens']);
    expect(parseTokens(vault.tokens)).toMatchObject({ accessToken: 'AT-2', refreshToken: 'RT-2' });
  });

  it('concurrent callers share one refresh, so a rotating token is never sent twice', async () => {
    const clock = new FakeClock(1_999_000);
    const vault = new MemoryVault();
    vault.tokens = serializeTokens(tokens());
    const { fetch, calls } = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, rotated) });
    const refresher = new TokenRefresher(vault, { fetch, nowMs: clock.now });
    const [a, b, c] = await Promise.all([refresher.ensureFresh(), refresher.ensureFresh(), refresher.ensureFresh(true)]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('separate refreshers on one vault (models, Responses, Refresh now) share one refresh (review S7)', async () => {
    const clock = new FakeClock(1_999_000);
    const vault = new MemoryVault();
    vault.tokens = serializeTokens(tokens());
    const { fetch, calls } = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, rotated) });
    const make = () => new TokenRefresher(vault, { fetch, nowMs: clock.now });
    const [a, b, c] = await Promise.all([make().ensureFresh(), make().ensureFresh(true), make().ensureFresh(true)]);
    expect(calls.filter((x) => x.form.grant_type === 'refresh_token')).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    // Another vault isn't blocked by this one.
    const other = new MemoryVault();
    other.tokens = serializeTokens(tokens());
    expect(await new TokenRefresher(other, { fetch, nowMs: clock.now }).ensureFresh(true)).toMatchObject({ ok: true, value: { refreshed: true } });
  });

  it('after a restart, the next refresh sends the rotated token, never the old one', async () => {
    const clock = new FakeClock(1_999_000);
    const vault = new MemoryVault();
    vault.tokens = serializeTokens(tokens());
    const first = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, rotated) });
    await new TokenRefresher(vault, { fetch: first.fetch, nowMs: clock.now }).ensureFresh(true);
    // "Restart": a new refresher reads only what the vault holds.
    const second = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(200, { ...rotated, access_token: 'AT-3', refresh_token: 'RT-3' }) });
    await new TokenRefresher(vault, { fetch: second.fetch, nowMs: clock.now }).ensureFresh(true);
    expect(second.calls[0]?.form.refresh_token).toBe('RT-2');
    expect(parseTokens(vault.tokens)?.refreshToken).toBe('RT-3');
  });

  it('clears tokens (keeps registration) only when the refresh token is unusable', async () => {
    const clock = new FakeClock(1_999_000);
    const vault = new MemoryVault();
    vault.registration = serializeRegistration({ hostId: 'urn:uuid:h', clientId: 'oaiapp_X', email: null, subject: null });
    vault.tokens = serializeTokens(tokens());
    const down = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(503, 'unavailable') });
    expect(await new TokenRefresher(vault, { fetch: down.fetch, nowMs: clock.now }).ensureFresh()).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(vault.tokens).not.toBeNull();
    const revoked = fakeFetch({ [OPENAI_TOKEN_ENDPOINT]: () => jsonResponse(400, { error: 'refresh_token_invalidated' }) });
    expect(await new TokenRefresher(vault, { fetch: revoked.fetch, nowMs: clock.now }).ensureFresh()).toMatchObject({ ok: false, error: { kind: 'refresh_unusable' } });
    expect(vault.tokens).toBeNull();
    expect(vault.registration).not.toBeNull();
  });

  it('reports not signed in when there are no tokens', async () => {
    const r = await new TokenRefresher(new MemoryVault(), { fetch: fakeFetch({}).fetch, nowMs: () => 0 }).ensureFresh();
    expect(r).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
  });
});
