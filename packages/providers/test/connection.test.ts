import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONNECTION_SETTINGS,
  OPENAI_MODELS_URL,
  OPENAI_RESPONSES_URL,
  OPENAI_TOKEN_ENDPOINT,
  TESTED_MODEL_SLUG,
  clearProviderFailure,
  connectChatGpt,
  disconnectChatGpt,
  failure,
  loadConnectionSettings,
  markFirstUseSeen,
  parseConnectionSettings,
  parseQuery,
  parseRegistration,
  parseTokens,
  preselectModel,
  readTextCoachState,
  recordProviderFailure,
  refreshAvailableModels,
  selectModel,
  serializeConnectionSettings,
  serializeRegistration,
  serializeTokens,
  textCoachState,
  type AuthSessionOutcome,
  type ChatGptTokenSet,
  type ConnectPhase,
  type ConnectionPorts,
  type SettingsStore,
} from '../src';
import { FakeClock, FakeLoopback, MemoryVault, TEST_DISCOVERY, TEST_JWKS, TEST_JWKS_URL, callbackFor, fakeFetch, jsonResponse, makeJwt, nodeCrypto, type Handler } from './helpers';

const FULL_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const MODELS = {
  models: [
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list' },
    { slug: 'internal', display_name: 'Hidden', visibility: 'hide' },
  ],
};

class MemorySettings implements SettingsStore {
  text: string | null = null;
  load() {
    return Promise.resolve(this.text);
  }
  save(s: string) {
    this.text = s;
    return Promise.resolve();
  }
}

function world(opts: { browser?: (url: string) => AuthSessionOutcome; scope?: string; models?: Handler | Handler[]; subject?: string; unavailable?: string } = {}) {
  const clock = new FakeClock();
  const vault = new MemoryVault();
  const settings = new MemorySettings();
  const loopback = new FakeLoopback(
    opts.browser ?? ((url) => ({ kind: 'callback', url: callbackFor(url, { client_id: 'oaiapp_ISSUED', scope: FULL_SCOPE }) })),
    opts.unavailable === undefined ? {} : { unavailable: opts.unavailable },
  );
  const nonce = () => parseQuery(loopback.openedUrls.at(-1) ?? '').nonce ?? '';
  const { fetch, calls } = fakeFetch({
    [OPENAI_TOKEN_ENDPOINT]: (call) =>
      call.form.grant_type === 'authorization_code'
        ? jsonResponse(200, {
            access_token: 'ACCESS-1',
            refresh_token: 'REFRESH-1',
            id_token: makeJwt({ iss: 'https://auth.openai.com', aud: call.form.client_id, exp: clock.ms / 1000 + 3600, nonce: nonce(), sub: opts.subject ?? 'user-1', email: 'ben@example.com' }),
            expires_in: 3600,
            scope: opts.scope ?? FULL_SCOPE,
          })
        : jsonResponse(400, { error: 'invalid_grant' }),
    [OPENAI_MODELS_URL]: opts.models ?? (() => jsonResponse(200, MODELS)),
    'https://auth.openai.com/.well-known/openid-configuration': () => jsonResponse(200, TEST_DISCOVERY),
    [TEST_JWKS_URL]: () => jsonResponse(200, TEST_JWKS),
    'https://auth.openai.com/api/accounts/oauth/revoke': () => jsonResponse(200, ''),
  });
  const ports: ConnectionPorts = { fetch, crypto: nodeCrypto, loopback, vault, settings, nowMs: clock.now, newUuid: () => '123e4567-e89b-42d3-a456-426614174000' };
  return { clock, vault, settings, loopback, ports, calls };
}

function tokens(over: Partial<ChatGptTokenSet> = {}): ChatGptTokenSet {
  return { clientId: 'oaiapp_X', accessToken: 'A', refreshToken: 'R', idToken: null, tokenType: 'Bearer', expiresAtMs: 2e12, earliestRefreshAtMs: null, scopes: FULL_SCOPE.split(' '), savedAtMs: 0, ...over };
}

describe('connectChatGpt (ai-connection §2.3–2.5)', () => {
  it('connects, stores tokens, preselects the tested model and shows first use once', async () => {
    const w = world();
    const phases: ConnectPhase[] = [];
    const r = await connectChatGpt(w.ports, { onPhase: (p) => phases.push(p) });
    expect(r).toMatchObject({ kind: 'connected', email: 'ben@example.com', selected: { slug: TESTED_MODEL_SLUG }, firstUse: true, modelsFailure: null });
    if (r.kind === 'connected') expect(r.models.map((m) => m.slug)).toEqual(['gpt-6-luna', 'gpt-6.1-sol']);
    expect(phases.map((p) => (p.kind === 'waiting' ? 'waiting' : p.step))).toEqual(['waiting', 'signed_in', 'access', 'models']);
    expect(parseTokens(w.vault.tokens)?.accessToken).toBe('ACCESS-1');
    expect(parseRegistration(w.vault.registration)).toMatchObject({ clientId: 'oaiapp_ISSUED', email: 'ben@example.com', subject: 'user-1' });
    expect(w.loopback.stopped).toBe(1);
    // "Nothing is used from your plan yet": no Responses call, no refresh.
    expect(w.calls.some((c) => c.url.startsWith(OPENAI_RESPONSES_URL))).toBe(false);
    expect(w.calls.filter((c) => c.url === OPENAI_TOKEN_ENDPOINT).map((c) => c.form.grant_type)).toEqual(['authorization_code']);
    expect((await readTextCoachState(w.ports)).status).toBe('ok');
  });

  it('keeps Ben’s earlier model choice when it is still listed, and first use stays seen', async () => {
    const w = world();
    w.settings.text = serializeConnectionSettings({ ...DEFAULT_CONNECTION_SETTINGS, modelSlug: 'gpt-6-luna', modelName: 'GPT-6-Luna', firstUseSeen: true });
    const r = await connectChatGpt(w.ports);
    expect(r).toMatchObject({ kind: 'connected', selected: { slug: 'gpt-6-luna' }, firstUse: false });
  });

  it('signing in again never switches a chosen model that is no longer listed: the coach reads model_gone (AC6, review B3)', async () => {
    const w = world();
    w.settings.text = serializeConnectionSettings({ ...DEFAULT_CONNECTION_SETTINGS, modelSlug: 'gpt-6-astra', modelName: 'GPT-6-Astra', firstUseSeen: true });
    const r = await connectChatGpt(w.ports);
    expect(r).toMatchObject({ kind: 'connected', selected: null, firstUse: false });
    const s = await loadConnectionSettings(w.settings);
    expect(s).toMatchObject({ modelSlug: 'gpt-6-astra', modelName: 'GPT-6-Astra' });
    if (r.kind !== 'connected') throw new Error('expected connected');
    expect((await readTextCoachState(w.ports, { listedModels: r.models })).status).toBe('model_gone');
  });

  it('an ID token that fails the JWKS signature check is not trusted: nothing stored, grant revoked (review S5)', async () => {
    const w = world();
    // Discovery that lists no JWKS: the check can't pass, so the sign-in fails honestly.
    const { fetch } = fakeFetch({
      'https://auth.openai.com/.well-known/openid-configuration': () => jsonResponse(200, { revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' }),
    });
    const ports = { ...w.ports, fetch: (url: string, init: Parameters<typeof fetch>[1]) => (url.includes('.well-known') ? fetch(url, init) : w.ports.fetch(url, init)) };
    const r = await connectChatGpt(ports);
    expect(r).toMatchObject({ kind: 'failed', failure: { kind: 'protocol', message: 'Couldn’t fetch OpenAI’s signing keys to check the sign-in (Discovery document has no usable jwks_uri). Nothing was saved; try again later.' } });
    expect(w.vault.tokens).toBeNull();
    expect(parseRegistration(w.vault.registration)?.subject).toBeNull();
    expect(w.calls.some((c) => c.url.includes('/oauth/revoke'))).toBe(true);
  });

  it('without chatgpt.tokens.use.direct stores no tokens and revokes the grant', async () => {
    const w = world({ scope: 'openid profile email offline_access' });
    expect(await connectChatGpt(w.ports)).toEqual({ kind: 'no_scope' });
    expect(w.vault.tokens).toBeNull();
    expect(w.calls.some((c) => c.url.includes('/oauth/revoke'))).toBe(true);
    expect(w.calls.some((c) => c.url.startsWith(OPENAI_MODELS_URL))).toBe(false);
    expect((await readTextCoachState(w.ports)).status).toBe('not_connected');
  });

  it('maps cancel, timeout, sheet errors and declined consent without storing anything', async () => {
    for (const [browser, kind] of [
      [() => ({ kind: 'cancelled' }), 'cancelled'],
      [() => ({ kind: 'timeout' }), 'timed_out'],
      [() => ({ kind: 'error', message: 'app switched' }), 'didnt_return'],
      [(url: string) => ({ kind: 'callback', url: callbackFor(url, { error: 'access_denied' }).replace(/code=[^&]*&?/, '') }), 'cancelled'],
    ] as const) {
      const w = world({ browser: browser as (url: string) => AuthSessionOutcome });
      expect((await connectChatGpt(w.ports)).kind).toBe(kind);
      expect(w.vault.tokens).toBeNull();
      expect(w.loopback.stopped).toBe(1);
    }
  });

  it('reports a build without the loopback module honestly and opens nothing', async () => {
    const w = world({ unavailable: 'Not in this build' });
    expect(await connectChatGpt(w.ports)).toEqual({ kind: 'sign_in_unavailable', reason: 'Not in this build' });
    expect(w.loopback.openedUrls).toEqual([]);
  });

  it('not eligible on the model list: tokens removed, remembered, no further calls', async () => {
    const w = world({ models: () => jsonResponse(403, { error: { code: 'subscription_sharing_user_not_eligible', message: 'no' } }) });
    const r = await connectChatGpt(w.ports);
    expect(r).toMatchObject({ kind: 'failed', failure: { kind: 'not_eligible' } });
    expect(w.vault.tokens).toBeNull();
    expect((await readTextCoachState(w.ports)).status).toBe('not_eligible');
    const before = w.calls.length;
    await readTextCoachState(w.ports);
    expect(w.calls.length).toBe(before);
  });

  it('a model-list network failure keeps the connection and says the list is missing', async () => {
    const w = world({ models: () => jsonResponse(503, { detail: 'busy' }) });
    const r = await connectChatGpt(w.ports);
    expect(r).toMatchObject({ kind: 'connected', models: [], selected: null, modelsFailure: { kind: 'unavailable' } });
    expect((await readTextCoachState(w.ports)).status).toBe('no_model');
  });

  it('refuses a different ChatGPT account than this phone’s registration', async () => {
    const w = world({ subject: 'someone-else' });
    w.vault.registration = serializeRegistration({ hostId: 'urn:uuid:123e4567-e89b-42d3-a456-426614174000', clientId: 'oaiapp_ISSUED', email: 'ben@example.com', subject: 'user-1' });
    expect(await connectChatGpt(w.ports)).toEqual({ kind: 'different_account' });
    expect(w.vault.tokens).toBeNull();
  });

  it('a new sign-in lifts an earlier pause', async () => {
    const w = world();
    await recordProviderFailure(w.settings, failure('refresh_unusable', 'gone'), 1);
    expect((await readTextCoachState(w.ports)).status).toBe('expired');
    await connectChatGpt(w.ports);
    expect((await loadConnectionSettings(w.settings)).lastFailure).toBeNull();
  });
});

describe('textCoachState (getAiCapabilities text status)', () => {
  const settings = { ...DEFAULT_CONNECTION_SETTINGS, modelSlug: 'gpt-6.1-sol', modelName: 'GPT-6.1-Sol' };
  const base = { tokens: tokens(), registration: null, settings, listedModels: null };

  it('is ok with tokens, scope and a chosen model', () => {
    expect(textCoachState(base)).toMatchObject({ status: 'ok', route: 'chatgpt_plan', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } });
  });

  it('names each paused state; none of them offers another route', () => {
    const at = (kind: 'usage_limit' | 'not_eligible' | 'region' | 'scope_not_authorized' | 'expired') => textCoachState({ ...base, settings: { ...settings, lastFailure: { kind, atMs: 1 } } }).status;
    expect(at('usage_limit')).toBe('limit');
    expect(at('not_eligible')).toBe('not_eligible');
    expect(at('region')).toBe('region');
    expect(at('scope_not_authorized')).toBe('no_scope');
    expect(at('expired')).toBe('expired');
  });

  it('without tokens: expired after a dead refresh token, otherwise not connected', () => {
    expect(textCoachState({ ...base, tokens: null })).toMatchObject({ status: 'not_connected', route: null });
    expect(textCoachState({ ...base, tokens: null, settings: { ...settings, lastFailure: { kind: 'expired', atMs: 1 } } }).status).toBe('expired');
    expect(textCoachState({ ...base, tokens: null, settings: { ...settings, lastFailure: { kind: 'usage_limit', atMs: 1 } } }).status).toBe('not_connected');
  });

  it('tokens without the plan scope read as no_scope', () => {
    expect(textCoachState({ ...base, tokens: tokens({ scopes: ['openid'] }) }).status).toBe('no_scope');
  });

  it('a chosen model missing from the list is model_gone, never replaced (AC6)', () => {
    expect(textCoachState({ ...base, listedModels: [{ slug: 'gpt-6-luna', displayName: 'GPT-6-Luna' }] })).toMatchObject({ status: 'model_gone', model: { slug: 'gpt-6.1-sol' } });
    expect(textCoachState({ ...base, settings: { ...settings, modelSlug: null } }).status).toBe('no_model');
  });

  it('offline only when a network signal says so', () => {
    expect(textCoachState({ ...base, network: 'offline' }).status).toBe('offline');
    expect(textCoachState({ ...base, network: 'unknown' }).status).toBe('ok');
  });
});

describe('settings, failures and models', () => {
  it('parses damaged or foreign settings as defaults and drops unknown failure kinds', () => {
    expect(parseConnectionSettings(null)).toEqual(DEFAULT_CONNECTION_SETTINGS);
    expect(parseConnectionSettings('{')).toEqual(DEFAULT_CONNECTION_SETTINGS);
    expect(parseConnectionSettings(JSON.stringify({ v: 1, modelSlug: 'm', lastFailure: { kind: 'network', atMs: 1 } }))).toMatchObject({ modelSlug: 'm', modelName: 'm', lastFailure: null });
  });

  it('remembers only failures that pause the coach; Check again clears them', async () => {
    const s = new MemorySettings();
    for (const kind of ['network', 'timeout', 'server', 'unavailable', 'stream_interrupted', 'rate_limited'] as const) await recordProviderFailure(s, failure(kind, 'x'), 1);
    expect((await loadConnectionSettings(s)).lastFailure).toBeNull();
    await recordProviderFailure(s, failure('usage_limit', 'x'), 5);
    expect((await loadConnectionSettings(s)).lastFailure).toEqual({ kind: 'usage_limit', atMs: 5 });
    await clearProviderFailure(s);
    expect((await loadConnectionSettings(s)).lastFailure).toBeNull();
  });

  it('concurrent settings updates are serialised: neither change is lost (review S6)', async () => {
    let text: string | null = null;
    // A slow store: each read and write yields, so unserialised updates would interleave.
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const slow: SettingsStore = {
      load: async () => { await tick(); return text; },
      save: async (t) => { await tick(); text = t; },
    };
    const listed = [{ slug: 'gpt-6-luna', displayName: 'GPT-6-Luna' }];
    await Promise.all([recordProviderFailure(slow, failure('usage_limit', 'x'), 5), selectModel(slow, listed, 'gpt-6-luna'), markFirstUseSeen(slow)]);
    expect(await loadConnectionSettings(slow)).toMatchObject({ modelSlug: 'gpt-6-luna', firstUseSeen: true, lastFailure: { kind: 'usage_limit', atMs: 5 } });
  });

  it('selectModel accepts only a listed model', async () => {
    const s = new MemorySettings();
    const listed = [{ slug: 'gpt-6-luna', displayName: 'GPT-6-Luna' }];
    expect(await selectModel(s, listed, 'gpt-9')).toEqual({ ok: false, error: 'not_listed' });
    expect(await selectModel(s, listed, 'gpt-6-luna')).toMatchObject({ ok: true });
    expect((await loadConnectionSettings(s)).modelSlug).toBe('gpt-6-luna');
  });

  it('preselects the earlier choice; on a first connection the tested model, then the first; never a silent switch (AC6)', () => {
    const list = [
      { slug: 'a', displayName: 'A' },
      { slug: TESTED_MODEL_SLUG, displayName: 'Sol' },
    ];
    expect(preselectModel(list, 'a')?.slug).toBe('a');
    expect(preselectModel(list, 'gone')).toBeNull();
    expect(preselectModel(list, null)?.slug).toBe(TESTED_MODEL_SLUG);
    expect(preselectModel([{ slug: 'b', displayName: 'B' }], null)?.slug).toBe('b');
    expect(preselectModel([], null)).toBeNull();
  });

  it('refreshAvailableModels lists models and marks a dead refresh token as expired', async () => {
    const w = world();
    w.vault.tokens = serializeTokens(tokens({ clientId: 'oaiapp_ISSUED' }));
    expect(await refreshAvailableModels(w.ports)).toMatchObject({ ok: true, models: [{ slug: 'gpt-6-luna' }, { slug: 'gpt-6.1-sol' }] });

    w.vault.tokens = serializeTokens(tokens({ clientId: 'oaiapp_ISSUED', expiresAtMs: 0 }));
    expect(await refreshAvailableModels(w.ports)).toMatchObject({ ok: false, failure: { kind: 'refresh_unusable' } });
    expect(w.vault.tokens).toBeNull();
    expect((await readTextCoachState(w.ports)).status).toBe('expired');
  });

  it('disconnect deletes tokens, keeps the registration and the model choice, and clears pauses', async () => {
    const w = world();
    await connectChatGpt(w.ports);
    await recordProviderFailure(w.settings, failure('usage_limit', 'x'), 1);
    await disconnectChatGpt(w.ports);
    expect(w.vault.tokens).toBeNull();
    expect(parseRegistration(w.vault.registration)?.clientId).toBe('oaiapp_ISSUED');
    const s = await loadConnectionSettings(w.settings);
    expect(s).toMatchObject({ modelSlug: TESTED_MODEL_SLUG, lastFailure: null });
    expect((await readTextCoachState(w.ports)).status).toBe('not_connected');
  });
});
