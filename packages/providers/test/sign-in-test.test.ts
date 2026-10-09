import { describe, expect, it } from 'vitest';

import {
  OPENAI_MODELS_URL,
  OPENAI_RESPONSES_URL,
  OPENAI_TOKEN_ENDPOINT,
  disconnect,
  formatSignInReport,
  parseQuery,
  parseRegistration,
  parseTokens,
  readConnection,
  runRefreshStep,
  runSignInTest,
  serializeRegistration,
  serializeTokens,
  type AuthSessionOutcome,
  type SignInTestPorts,
  type StepId,
  type StepResult,
} from '../src';
import {
  FakeClock,
  FakeLoopback,
  MemoryVault,
  callbackFor,
  fakeFetch,
  jsonResponse,
  makeJwt,
  nodeCrypto,
  sse,
  streamResponseOf,
  textResponse,
  type Handler,
} from './helpers';

const FULL_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const SECRETS = ['AUTH-CODE-SECRET', 'ACCESS-SECRET-1', 'REFRESH-SECRET-1', 'ACCESS-SECRET-2', 'REFRESH-SECRET-2'];

interface World {
  clock: FakeClock;
  vault: MemoryVault;
  loopback: FakeLoopback;
  ports: SignInTestPorts;
  calls: ReturnType<typeof fakeFetch>['calls'];
}

function world(opts: {
  browser?: (url: string) => AuthSessionOutcome;
  scope?: string;
  issuedClientId?: string;
  routes?: Record<string, Handler | Handler[]>;
  earliestRefreshInS?: number | null;
  loopback?: { unavailable?: string; startError?: string; port?: number };
  email?: string;
  subject?: string;
} = {}): World {
  const clock = new FakeClock();
  const vault = new MemoryVault();
  const issued = opts.issuedClientId ?? 'oaiapp_ISSUED123';
  const loopback = new FakeLoopback(opts.browser ?? ((url) => ({ kind: 'callback', url: callbackFor(url, { client_id: issued, scope: FULL_SCOPE }) })), opts.loopback);
  const nonce = () => parseQuery(loopback.openedUrls.at(-1) ?? '').nonce ?? '';
  const idToken = (aud: string) => makeJwt({ iss: 'https://auth.openai.com', aud, exp: clock.ms / 1000 + 3600, nonce: nonce(), sub: opts.subject ?? 'user-1', email: opts.email ?? 'ben@example.com' });
  const earliest = opts.earliestRefreshInS === undefined ? null : opts.earliestRefreshInS;
  const tokenHandler: Handler = (call) => {
    if (call.form.grant_type === 'authorization_code') {
      return jsonResponse(200, {
        access_token: 'ACCESS-SECRET-1',
        refresh_token: 'REFRESH-SECRET-1',
        id_token: idToken(call.form.client_id ?? ''),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: opts.scope ?? FULL_SCOPE,
        ...(earliest === null ? {} : { earliest_refresh_at: clock.ms / 1000 + earliest }),
      });
    }
    return jsonResponse(200, { access_token: 'ACCESS-SECRET-2', refresh_token: 'REFRESH-SECRET-2', expires_in: 3600, scope: opts.scope ?? FULL_SCOPE });
  };
  const { fetch, calls } = fakeFetch({
    [OPENAI_TOKEN_ENDPOINT]: tokenHandler,
    [OPENAI_MODELS_URL]: () => jsonResponse(200, { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' }] }, { 'x-request-id': 'req_m' }),
    [OPENAI_RESPONSES_URL]: () =>
      streamResponseOf([
        sse([
          { type: 'response.output_text.delta', delta: 'OK' },
          { type: 'response.completed', response: { id: 'resp_1', model: 'gpt-6.1-sol', usage: { input_tokens: 20, output_tokens: 2, total_tokens: 22 } } },
        ]),
      ]),
    'https://auth.openai.com/.well-known/openid-configuration': () => jsonResponse(200, { revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' }),
    'https://auth.openai.com/api/accounts/oauth/revoke': () => textResponse(200, ''),
    ...opts.routes,
  });
  let n = 0;
  const ports: SignInTestPorts = {
    fetch,
    crypto: nodeCrypto,
    loopback,
    vault,
    nowMs: () => {
      clock.advance(1);
      return clock.ms;
    },
    newUuid: () => `3f1c2b9e-1d2a-4c55-9a7e-0b1c2d3e4f5${String(n++ % 10)}`,
  };
  return { clock, vault, loopback, ports, calls };
}

function statusOf(steps: readonly StepResult[]): Record<StepId, string> {
  return Object.fromEntries(steps.map((s) => [s.id, s.status])) as Record<StepId, string>;
}

const urlsCalled = (w: World) => w.calls.map((c) => c.url);

describe('runSignInTest', () => {
  it('first sign-in passes every step, saves host and issued client IDs and stores tokens in the vault', async () => {
    const w = world();
    const seen: StepResult[] = [];
    const run = await runSignInTest(w.ports, { onStep: (s) => seen.push(s) });
    expect(statusOf(run.steps)).toEqual({
      host_id: 'pass',
      listener: 'pass',
      browser: 'pass',
      callback: 'pass',
      registration: 'pass',
      token_exchange: 'pass',
      id_token: 'pass',
      scopes: 'pass',
      store: 'pass',
      models: 'pass',
      responses: 'pass',
      refresh: 'pass',
    });
    expect(run.outcome).toBe('connected');
    expect(run.model?.slug).toBe('gpt-6.1-sol');
    expect(seen.some((s) => s.status === 'running')).toBe(true);

    const reg = parseRegistration(w.vault.registration);
    expect(reg).toEqual({ hostId: 'urn:uuid:3f1c2b9e-1d2a-4c55-9a7e-0b1c2d3e4f50', clientId: 'oaiapp_ISSUED123', email: 'ben@example.com', subject: 'user-1' });
    // Host ID persisted before the browser opened.
    expect(w.vault.writes[0]).toBe('registration');
    // Refresh rotated the stored set.
    expect(parseTokens(w.vault.tokens)).toMatchObject({ clientId: 'oaiapp_ISSUED123', accessToken: 'ACCESS-SECRET-2', refreshToken: 'REFRESH-SECRET-2' });
    // Token exchange used the issued client ID, never dynamic_agent_client.
    const exchange = w.calls.find((c) => c.form.grant_type === 'authorization_code');
    expect(exchange?.form.client_id).toBe('oaiapp_ISSUED123');
    // The Responses call obeyed the plan rules.
    const resp = w.calls.find((c) => c.url === OPENAI_RESPONSES_URL);
    expect(resp?.json).toMatchObject({ store: false, stream: true });
    expect(resp?.json).not.toHaveProperty('temperature');
    expect(resp?.json).not.toHaveProperty('max_output_tokens');
    expect(w.loopback.stopped).toBe(1);
  });

  it('a second sign-in reuses the host ID and issued client ID (no new registration)', async () => {
    const w = world();
    await runSignInTest(w.ports);
    const firstReg = w.vault.registration;
    await runSignInTest(w.ports);
    const q = parseQuery(w.loopback.openedUrls[1] ?? '');
    expect(q.client_id).toBe('oaiapp_ISSUED123');
    expect(q.agent_name_hint).toBeUndefined();
    expect(q.ext_agent_host_id).toBe(parseRegistration(firstReg)?.hostId);
    expect(q.id_token_hint).toBeDefined();
    expect(parseRegistration(w.vault.registration)?.hostId).toBe(parseRegistration(firstReg)?.hostId);
  });

  it('without chatgpt.tokens.use.direct: stores no tokens and makes no inference calls', async () => {
    const w = world({ scope: 'openid profile email offline_access' });
    const run = await runSignInTest(w.ports);
    expect(statusOf(run.steps)).toMatchObject({ id_token: 'pass', scopes: 'fail', store: 'skipped', models: 'skipped', responses: 'skipped', refresh: 'skipped' });
    expect(run.steps.find((s) => s.id === 'scopes')?.summary).toBe("Signed in, but ChatGPT didn't allow coach replies for this app.");
    expect(w.vault.tokens).toBeNull();
    expect(urlsCalled(w)).not.toContain(OPENAI_MODELS_URL);
    expect(urlsCalled(w)).not.toContain(OPENAI_RESPONSES_URL);
    expect(run.outcome).toBe('not_connected');
    // The grant that isn't kept is revoked (review S7).
    expect(w.calls.find((c) => c.url.endsWith('/oauth/revoke'))?.form).toEqual({ token: 'REFRESH-SECRET-1', token_type_hint: 'refresh_token', client_id: 'oaiapp_ISSUED123' });
    expect(run.steps.find((s) => s.id === 'scopes')?.details).toContain('The granted refresh token was revoked.');
  });

  it('cancel in the sheet stores nothing, makes no token call and stops the listener', async () => {
    const w = world({ browser: () => ({ kind: 'cancelled' }) });
    const run = await runSignInTest(w.ports);
    expect(run.outcome).toBe('cancelled');
    expect(run.steps.find((s) => s.id === 'browser')?.summary).toBe('Sign-in cancelled. Nothing was connected.');
    expect(statusOf(run.steps).callback).toBe('skipped');
    expect(w.vault.tokens).toBeNull();
    expect(w.calls).toHaveLength(0);
    expect(w.loopback.stopped).toBe(1);
  });

  it('timeout and sheet errors are reported honestly', async () => {
    const t = await runSignInTest(world({ browser: () => ({ kind: 'timeout' }) }).ports);
    expect(t.steps.find((s) => s.id === 'browser')?.summary).toBe('Sign-in took too long. Nothing was connected.');
    const e = await runSignInTest(world({ browser: () => ({ kind: 'error', message: 'boom' }) }).ports);
    expect(e.steps.find((s) => s.id === 'browser')?.summary).toBe("The sign-in page didn't return to Fizz: boom");
  });

  it('a missing native module is "unavailable", not a failure, and nothing else runs', async () => {
    const w = world({ loopback: { unavailable: 'Loopback module not in this build' } });
    const run = await runSignInTest(w.ports);
    expect(statusOf(run.steps)).toMatchObject({ host_id: 'pass', listener: 'unavailable', browser: 'skipped' });
    expect(w.loopback.openedUrls).toHaveLength(0);
  });

  it('a listener that cannot bind fails the listener step', async () => {
    const run = await runSignInTest(world({ loopback: { startError: 'Address already in use' } }).ports);
    expect(run.steps.find((s) => s.id === 'listener')).toMatchObject({ status: 'fail', summary: 'Listener could not start: Address already in use' });
  });

  it('a listener that never becomes ready fails the step after the start timeout and is stopped (review S7)', async () => {
    const w = world();
    let stopped = 0;
    w.ports.loopback = {
      unavailableReason: () => null,
      startListener: () => new Promise(() => undefined),
      openAuthSession: () => Promise.resolve({ kind: 'cancelled' }),
      stopListener: () => {
        stopped += 1;
        return Promise.resolve();
      },
      listenerLog: () => [],
    };
    const run = await runSignInTest(w.ports, { listenerStartTimeoutMs: 20 });
    expect(run.steps.find((s) => s.id === 'listener')).toMatchObject({ status: 'fail', summary: "Listener didn't start in time" });
    expect(statusOf(run.steps).browser).toBe('skipped');
    expect(stopped).toBe(1);
    expect(w.calls).toHaveLength(0);
  });

  it('a forged callback (wrong state) is rejected before any token call', async () => {
    const w = world({ browser: (url) => ({ kind: 'callback', url: callbackFor(url, { state: 'forged', client_id: 'oaiapp_EVIL' }) }) });
    const run = await runSignInTest(w.ports);
    expect(run.steps.find((s) => s.id === 'callback')?.failure?.kind).toBe('state_mismatch');
    expect(w.calls).toHaveLength(0);
    expect(parseRegistration(w.vault.registration)?.clientId).toBeNull();
  });

  it('not eligible on the models call: stops, no Responses call, no second OAuth, tokens kept', async () => {
    const w = world({ routes: { [OPENAI_MODELS_URL]: () => jsonResponse(403, { error: { code: 'subscription_sharing_user_not_eligible', message: 'no' } }) } });
    const run = await runSignInTest(w.ports);
    expect(statusOf(run.steps)).toMatchObject({ store: 'pass', models: 'fail', responses: 'skipped', refresh: 'skipped' });
    expect(run.steps.find((s) => s.id === 'models')?.summary).toBe("This ChatGPT account can't be used by other apps. Not retried.");
    expect(urlsCalled(w)).not.toContain(OPENAI_RESPONSES_URL);
    expect(w.loopback.openedUrls).toHaveLength(1);
    expect(run.outcome).toBe('connected_with_issues');
  });

  it('usage limit on the Responses call pauses: Manage usage, no retry, no other route', async () => {
    const w = world({
      routes: { [OPENAI_RESPONSES_URL]: () => jsonResponse(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } }) },
    });
    const run = await runSignInTest(w.ports);
    const step = run.steps.find((s) => s.id === 'responses');
    expect(step?.failure).toMatchObject({ kind: 'usage_limit', recovery: 'manage_usage' });
    expect(urlsCalled(w).filter((u) => u === OPENAI_RESPONSES_URL)).toHaveLength(1);
    expect(statusOf(run.steps).refresh).toBe('skipped');
  });

  it('refresh waits for earliest_refresh_at instead of risking the new session', async () => {
    const w = world({ earliestRefreshInS: 600 });
    const run = await runSignInTest(w.ports);
    expect(run.steps.find((s) => s.id === 'refresh')).toMatchObject({ status: 'skipped' });
    expect(w.calls.filter((c) => c.form.grant_type === 'refresh_token')).toHaveLength(0);
    w.clock.advance(601_000);
    expect(await runRefreshStep(w.ports, undefined, { respectEarliestRefresh: true })).toBe(true);
    expect(parseTokens(w.vault.tokens)?.refreshToken).toBe('REFRESH-SECRET-2');
  });

  it('a different account on reauthorization is refused and credentials are not replaced', async () => {
    const w = world({ subject: 'someone-else' });
    w.vault.registration = serializeRegistration({ hostId: 'urn:uuid:3f1c2b9e-1d2a-4c55-9a7e-0b1c2d3e4f50', clientId: 'oaiapp_ISSUED123', email: null, subject: 'user-1' });
    const oldTokens = serializeTokens({ clientId: 'oaiapp_ISSUED123', accessToken: 'OLD', refreshToken: 'OLDR', idToken: null, tokenType: 'Bearer', expiresAtMs: 0, earliestRefreshAtMs: null, scopes: [], savedAtMs: 0 });
    w.vault.tokens = oldTokens;
    const run = await runSignInTest(w.ports);
    expect(statusOf(run.steps).id_token).toBe('fail');
    expect(w.vault.tokens).toBe(oldTokens);
    // The other account's new grant is revoked, never the saved one (review S7).
    const revokes = w.calls.filter((c) => c.url.endsWith('/oauth/revoke'));
    expect(revokes.map((c) => c.form.token)).toEqual(['REFRESH-SECRET-1']);
    expect(run.steps.find((s) => s.id === 'id_token')?.details).toContain('The granted refresh token was revoked.');
  });

  it('a revocation that fails is said plainly and never blocks the result', async () => {
    const w = world({ scope: 'openid profile email offline_access', routes: { 'https://auth.openai.com/api/accounts/oauth/revoke': () => Promise.reject(new Error('offline')) } });
    const run = await runSignInTest(w.ports);
    expect(statusOf(run.steps).scopes).toBe('fail');
    expect(run.steps.find((s) => s.id === 'scopes')?.details.some((d) => d.startsWith("Revoking the granted refresh token wasn't confirmed"))).toBe(true);
    expect(w.vault.tokens).toBeNull();
  });

  it('the export has every step, masks the email and contains no token, code or state', async () => {
    const w = world();
    const run = await runSignInTest(w.ports);
    const report = formatSignInReport(run.steps, run.listenerLog, { appVersion: '0.1.0', buildNumber: '9', osVersion: '26.6', exportedAtIso: '2026-10-09T10:00:00.000Z', timeZone: 'Europe/London' });
    for (const s of run.steps) expect(report).toContain(s.title);
    expect(report).toContain('b***@example.com');
    expect(report).not.toContain('ben@example.com');
    for (const secret of SECRETS) expect(report).not.toContain(secret);
    const q = parseQuery(w.loopback.openedUrls[0] ?? '');
    expect(report).not.toContain(q.state ?? 'x');
    expect(report).not.toContain(q.nonce ?? 'x');
    expect(report).not.toContain(q.code_challenge ?? 'x');
    expect(report).toContain('Listener log:');
    // Step objects themselves never carry secrets either.
    const allText = JSON.stringify(run.steps);
    for (const secret of SECRETS) expect(allText).not.toContain(secret);
  });
});

describe('disconnect and status', () => {
  it('revokes, deletes the tokens and keeps the registration', async () => {
    const w = world();
    await runSignInTest(w.ports);
    const before = await readConnection(w.ports);
    expect(before).toMatchObject({ signedIn: true, planUsage: true, email: 'ben@example.com', clientId: 'oaiapp_…D123' });
    const result = await disconnect(w.ports);
    expect(result).toMatchObject({ revoked: true, summary: 'ChatGPT disconnected' });
    const revokeCall = w.calls.find((c) => c.url.endsWith('/oauth/revoke'));
    expect(revokeCall?.form).toEqual({ token: 'REFRESH-SECRET-2', token_type_hint: 'refresh_token', client_id: 'oaiapp_ISSUED123' });
    expect(w.vault.tokens).toBeNull();
    expect(parseRegistration(w.vault.registration)?.clientId).toBe('oaiapp_ISSUED123');
    expect(await readConnection(w.ports)).toMatchObject({ signedIn: false, planUsage: false, hostIdSaved: true });
  });

  it('still deletes local tokens when revocation fails, and says so', async () => {
    const w = world({ routes: { 'https://auth.openai.com/api/accounts/oauth/revoke': () => Promise.reject(new Error('offline')) } });
    await runSignInTest(w.ports);
    const result = await disconnect(w.ports);
    expect(result.revoked).toBe(false);
    expect(result.summary).toBe('Disconnected on this phone; remote revocation was not confirmed');
    expect(w.vault.tokens).toBeNull();
  });
});
