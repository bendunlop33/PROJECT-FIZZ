/**
 * Spike S1 (docs/research/ai-access-and-voice.md): "Sign in with ChatGPT"
 * end-to-end on the phone, one honest step at a time.
 *
 * Pure orchestration over injected ports (fetch, crypto, loopback listener
 * + system auth sheet, Keychain vault, clock). Each step reports what really
 * happened; later steps are `skipped` after a failure, never faked.
 *
 * Hard rules kept here:
 * - No API key anywhere and no fallback to any other route.
 * - Without `chatgpt.tokens.use.direct` no tokens are stored and no
 *   inference is attempted (design ai-connection.md acceptance 3).
 * - `not_eligible` ends the run; nothing retries or loops OAuth.
 * - Step details never contain tokens, codes, state, nonce or verifier.
 */

import type { CryptoPort, FetchLike } from '../http';
import { createAuthAttempt, newHostId, parseCallback, type AuthAttempt } from './authorize';
import { CALLBACK_PATH, PLAN_USAGE_SCOPE, PREFERRED_CALLBACK_PORT } from './constants';
import {
  TokenRefresher,
  parseRegistration,
  parseTokens,
  serializeRegistration,
  serializeTokens,
  type ChatGptVault,
} from './credentials';
import { failure, type ProviderFailure } from './errors';
import { listModels, pickModel, type ModelOption } from './models';
import { streamResponse } from './responses';
import { exchangeCode, hasPlanUsageScope, revokeRefreshToken, validateIdTokenClaims, type ChatGptTokenSet } from './tokens';

// ---------- Ports ----------

export type AuthSessionOutcome =
  | { kind: 'callback'; url: string }
  /** The sheet or the iOS "wants to use … to sign in" alert was cancelled. */
  | { kind: 'cancelled' }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string };

export interface ListenerInfo {
  port: number;
}

/** A listener diagnostic. Never carries the callback's query string. */
export interface ListenerLogEntry {
  atMs: number;
  kind: 'ready' | 'connection' | 'request' | 'callback' | 'not_found' | 'error' | 'stopped';
  detail: string;
}

/** In-app loopback listener plus the system auth sheet (native module in the app). */
export interface LoopbackPort {
  /** Null when usable; otherwise why not (e.g. "native module not in this build"). */
  unavailableReason(): string | null;
  startListener(path: string, preferredPort: number): Promise<ListenerInfo>;
  /**
   * Opens the system auth sheet and resolves when the listener receives the
   * callback (the sheet is then closed by the app), the sheet is cancelled,
   * or the timeout passes.
   */
  openAuthSession(url: string, timeoutMs: number): Promise<AuthSessionOutcome>;
  stopListener(): Promise<void>;
  /** Listener diagnostics since start. */
  listenerLog(): readonly ListenerLogEntry[];
}

export interface SignInTestPorts {
  fetch: FetchLike;
  crypto: CryptoPort;
  loopback: LoopbackPort;
  vault: ChatGptVault;
  nowMs: () => number;
  /** A fresh UUID v4 for the host ID (only when none is saved). */
  newUuid: () => string;
}

// ---------- Steps ----------

export type StepId =
  | 'host_id'
  | 'listener'
  | 'browser'
  | 'callback'
  | 'registration'
  | 'token_exchange'
  | 'id_token'
  | 'scopes'
  | 'store'
  | 'models'
  | 'responses'
  | 'refresh';

export type StepStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped' | 'unavailable';

export interface StepResult {
  id: StepId;
  title: string;
  status: StepStatus;
  summary: string;
  details: string[];
  durationMs: number | null;
  failure?: ProviderFailure;
}

export const STEP_TITLES: Record<StepId, string> = {
  host_id: 'Host ID for this phone',
  listener: 'Loopback listener on 127.0.0.1',
  browser: 'ChatGPT sign-in sheet',
  callback: 'Redirect received by the app',
  registration: 'App registration (issued client ID)',
  token_exchange: 'Token exchange',
  id_token: 'ID token checks',
  scopes: `Granted scopes (needs ${PLAN_USAGE_SCOPE})`,
  store: 'Saved in the Keychain',
  models: 'Models for this account (GET /v1/models)',
  responses: 'Streamed reply ("Reply with OK")',
  refresh: 'Token refresh (rotation)',
};

export const STEP_ORDER: readonly StepId[] = [
  'host_id',
  'listener',
  'browser',
  'callback',
  'registration',
  'token_exchange',
  'id_token',
  'scopes',
  'store',
  'models',
  'responses',
  'refresh',
];

export function pendingSteps(): StepResult[] {
  return STEP_ORDER.map((id) => ({ id, title: STEP_TITLES[id], status: 'pending', summary: 'Not run', details: [], durationMs: null }));
}

export type RunOutcome = 'connected' | 'connected_with_issues' | 'not_connected' | 'cancelled';

export interface SignInTestRun {
  steps: StepResult[];
  outcome: RunOutcome;
  model: ModelOption | null;
  models: ModelOption[];
  listenerLog: ListenerLogEntry[];
  startedAtMs: number;
  finishedAtMs: number;
}

export interface RunOptions {
  /** Sheet + listener limit (design `timing.signInTimeout`, 5 min). */
  signInTimeoutMs?: number;
  preferredModel?: string | null;
  onStep?: (step: StepResult) => void;
}

export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const TEST_PROMPT = 'Reply with OK';
const TEST_INSTRUCTIONS = 'This is a connection test. Reply with exactly: OK';

/** Runs S1 end to end. Never throws: unexpected errors become a failed step. */
export async function runSignInTest(ports: SignInTestPorts, options: RunOptions = {}): Promise<SignInTestRun> {
  const startedAtMs = ports.nowMs();
  const steps = new Map<StepId, StepResult>(pendingSteps().map((s) => [s.id, s]));
  const emit = (s: StepResult) => {
    steps.set(s.id, s);
    options.onStep?.(s);
  };
  const recorder = new StepRecorder(ports.nowMs, emit);
  let listenerLog: ListenerLogEntry[] = [];
  let model: ModelOption | null = null;
  let models: ModelOption[] = [];
  let outcome: RunOutcome = 'not_connected';

  const finish = (): SignInTestRun => {
    for (const id of STEP_ORDER) {
      const s = steps.get(id);
      if (s !== undefined && (s.status === 'pending' || s.status === 'running')) {
        emit({ ...s, status: 'skipped', summary: s.status === 'running' ? 'Stopped' : 'Not run (an earlier step did not pass)' });
      }
    }
    return { steps: STEP_ORDER.map((id) => steps.get(id)).filter((s): s is StepResult => s !== undefined), outcome, model, models, listenerLog, startedAtMs, finishedAtMs: ports.nowMs() };
  };

  try {
    // 1. Host ID: chosen and persisted before the first sign-in, then reused.
    recorder.start('host_id');
    let registration = parseRegistration(await ports.vault.loadRegistration());
    if (registration === null) {
      registration = { hostId: newHostId(ports.newUuid()), clientId: null, email: null, subject: null };
      await ports.vault.saveRegistration(serializeRegistration(registration));
      recorder.pass('host_id', 'New host ID created and saved', [`Format: urn:uuid (${maskTail(registration.hostId, 4)})`]);
    } else {
      recorder.pass('host_id', 'Saved host ID reused', [
        `Format: ${registration.hostId.startsWith('urn:uuid:') ? 'urn:uuid' : 'other'} (${maskTail(registration.hostId, 4)})`,
        registration.clientId === null ? 'No issued client ID yet: first registration' : `Issued client ID on file: ${maskClientId(registration.clientId)}`,
      ]);
    }

    // 2. Listener
    recorder.start('listener');
    const unavailable = ports.loopback.unavailableReason();
    if (unavailable !== null) {
      recorder.end('listener', 'unavailable', unavailable, ['A new iOS build with the loopback module is needed']);
      return finish();
    }
    let port: number;
    try {
      port = (await ports.loopback.startListener(CALLBACK_PATH, PREFERRED_CALLBACK_PORT)).port;
    } catch (e) {
      recorder.end('listener', 'fail', `Listener could not start: ${errorText(e)}`, []);
      return finish();
    }
    recorder.pass('listener', `Listening on 127.0.0.1:${String(port)}`, [
      port === PREFERRED_CALLBACK_PORT ? 'Preferred port 1455 (OpenAI example) was free' : `Port 1455 unavailable; using ${String(port)}`,
      `Redirect URI: http://127.0.0.1:${String(port)}${CALLBACK_PATH}`,
    ]);

    try {
      // 3. Browser sheet
      const previousTokens = parseTokens(await ports.vault.loadTokens());
      // id_token_hint only from tokens of the same registration (never mix registrations).
      const idTokenHint = previousTokens !== null && previousTokens.clientId === registration.clientId ? previousTokens.idToken : null;
      const attempt = await createAuthAttempt({ port, registration, idTokenHint }, ports.crypto);
      recorder.start('browser');
      const session = await ports.loopback.openAuthSession(attempt.url, options.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
      listenerLog = [...ports.loopback.listenerLog()];
      const sawConnection = listenerLog.some((l) => l.kind === 'connection');
      const listenerLine = sawConnection ? 'The listener did receive a connection (see listener log)' : 'The listener received no connection';
      const kindLine = attempt.isNewRegistration ? 'First registration (client_id=dynamic_agent_client)' : `Reauthorization with ${maskClientId(attempt.requestClientId)}`;
      switch (session.kind) {
        case 'callback':
          recorder.pass('browser', 'Sheet returned to the app through the loopback listener', [kindLine, listenerLine]);
          break;
        case 'cancelled':
          outcome = 'cancelled';
          recorder.end('browser', 'fail', 'Sign-in cancelled. Nothing was connected.', [
            kindLine,
            listenerLine,
            'If the sheet showed a page saying 127.0.0.1 could not be reached before you cancelled, the loopback approach failed on this iPhone (S1 fail).',
          ]);
          return finish();
        case 'timeout':
          recorder.end('browser', 'fail', 'Sign-in took too long. Nothing was connected.', [kindLine, listenerLine]);
          return finish();
        case 'error':
          recorder.end('browser', 'fail', `The sign-in page didn't return to Fizz: ${session.message}`, [kindLine, listenerLine]);
          return finish();
      }

      // 4. Callback
      recorder.start('callback');
      const callback = parseCallback(session.url, attempt);
      if (!callback.ok) {
        recorder.failWith('callback', callback.error);
        return finish();
      }
      recorder.pass('callback', 'Callback on /auth/callback with matching state', [
        callback.value.callbackScopes === null ? 'No scope on the callback' : `Callback scope: ${callback.value.callbackScopes.join(' ')}`,
      ]);

      // 5. Registration: keep the issued client ID even if a later step fails.
      recorder.start('registration');
      if (attempt.isNewRegistration) {
        registration = { ...registration, clientId: callback.value.clientId };
        await ports.vault.saveRegistration(serializeRegistration(registration));
        recorder.pass('registration', `Issued client ID saved: ${maskClientId(callback.value.clientId)}`, ['Reused for later sign-ins on this phone']);
      } else {
        recorder.pass('registration', `Existing registration used: ${maskClientId(callback.value.clientId)}`, [
          callback.value.issuedClientId === null ? 'Callback omitted client_id (allowed on reauthorization)' : 'Callback client_id matched',
        ]);
      }

      // 6. Token exchange
      const tokens = await exchangeStep(recorder, ports, attempt, callback.value.code, callback.value.clientId);
      if (tokens === null) return finish();

      // 7. ID token
      recorder.start('id_token');
      if (tokens.idToken === null) {
        recorder.end('id_token', 'fail', 'No ID token in the token response', []);
        return finish();
      }
      const claims = validateIdTokenClaims(tokens.idToken, { clientId: callback.value.clientId, nonce: attempt.nonce, nowMs: ports.nowMs() });
      if (!claims.ok) {
        recorder.failWith('id_token', claims.error);
        return finish();
      }
      if (registration.subject !== null && registration.subject !== claims.value.subject) {
        recorder.end('id_token', 'fail', 'Signed in as a different ChatGPT account than the saved registration; nothing replaced', []);
        return finish();
      }
      recorder.pass('id_token', `Signed in as ${claims.value.email === null ? '(no email claim)' : claims.value.email}`, [
        'Checked: issuer, audience = issued client ID, expiry, nonce',
        'Not checked: RS256 signature against JWKS (token came directly from the token endpoint over TLS; open item, ADR 0012)',
      ]);

      // 8. Scopes: without plan usage, store nothing and stop.
      recorder.start('scopes');
      if (!hasPlanUsageScope(tokens.scopes)) {
        recorder.end(
          'scopes',
          'fail',
          "Signed in, but ChatGPT didn't allow coach replies for this app.",
          [`Granted: ${tokens.scopes.join(' ') || '(none listed)'}`, 'No tokens were stored.'],
          failure('scope_missing', `${PLAN_USAGE_SCOPE} was not granted`),
        );
        return finish();
      }
      recorder.pass('scopes', `${PLAN_USAGE_SCOPE} granted`, [`Granted: ${tokens.scopes.join(' ')}`]);

      // 9. Store
      recorder.start('store');
      await ports.vault.saveTokens(serializeTokens(tokens));
      registration = { ...registration, email: claims.value.email, subject: claims.value.subject };
      await ports.vault.saveRegistration(serializeRegistration(registration));
      const readBack = parseTokens(await ports.vault.loadTokens());
      if (readBack?.accessToken !== tokens.accessToken) {
        recorder.end('store', 'fail', 'Tokens did not read back from the Keychain', []);
        return finish();
      }
      recorder.pass('store', 'Tokens saved in the Keychain and read back', [
        'Accessibility: WHEN_UNLOCKED_THIS_DEVICE_ONLY (not migrated by backups, not in Fizz backups)',
        `Access token expires in ${formatDuration(tokens.expiresAtMs - ports.nowMs())}`,
        tokens.refreshToken === null ? 'No refresh token granted' : 'Refresh token present',
        tokens.earliestRefreshAtMs === null ? 'No earliest_refresh_at sent' : `earliest_refresh_at in ${formatDuration(tokens.earliestRefreshAtMs - ports.nowMs())}`,
      ]);
      outcome = 'connected';

      // 10–12: the checks that need a connection; failures here keep the connection.
      const modelsStep = await runModelsStep(ports, recorder);
      models = modelsStep.models;
      if (modelsStep.models.length > 0) {
        model = pickModel(modelsStep.models, options.preferredModel ?? null);
      }
      if (modelsStep.stop) {
        outcome = 'connected_with_issues';
        return finish();
      }
      if (model === null) {
        recorder.end('responses', 'skipped', 'No model to call', []);
      } else {
        const reply = await runResponsesStep(ports, model, recorder);
        if (reply !== true) outcome = 'connected_with_issues';
        if (reply === 'stop') return finish();
      }
      const refreshed = await runRefreshStep(ports, recorder, { respectEarliestRefresh: true });
      if (!refreshed) outcome = 'connected_with_issues';
      return finish();
    } finally {
      await ports.loopback.stopListener().catch(() => undefined);
    }
  } catch (e) {
    const running = [...steps.values()].find((s) => s.status === 'running');
    if (running !== undefined) recorder.end(running.id, 'fail', `Unexpected error: ${errorText(e)}`, []);
    return finish();
  }
}

async function exchangeStep(recorder: StepRecorder, ports: SignInTestPorts, attempt: AuthAttempt, code: string, clientId: string): Promise<ChatGptTokenSet | null> {
  recorder.start('token_exchange');
  const exchanged = await exchangeCode(
    { clientId, code, codeVerifier: attempt.codeVerifier, redirectUri: attempt.redirectUri },
    { fetch: ports.fetch, nowMs: ports.nowMs },
  );
  if (!exchanged.ok) {
    recorder.failWith('token_exchange', exchanged.error);
    return null;
  }
  recorder.pass('token_exchange', 'Code exchanged with PKCE (no client secret)', [
    `Access token lifetime: ${formatDuration(exchanged.value.expiresAtMs - ports.nowMs())}`,
  ]);
  return exchanged.value;
}

// ---------- Re-runnable steps (also used by the screen's buttons) ----------

/** GET /v1/models. `stop` is true when the failure means later calls are pointless. */
export async function runModelsStep(ports: Pick<SignInTestPorts, 'fetch' | 'vault' | 'nowMs'>, recorder?: StepRecorder): Promise<{ models: ModelOption[]; stop: boolean; step: StepResult }> {
  const rec = recorder ?? new StepRecorder(ports.nowMs, () => undefined);
  rec.start('models');
  const fresh = await new TokenRefresher(ports.vault, { fetch: ports.fetch, nowMs: ports.nowMs }).ensureFresh();
  if (!fresh.ok) return { models: [], stop: true, step: rec.failWith('models', fresh.error) };
  const listed = await listModels(fresh.value.tokens.accessToken, { fetch: ports.fetch });
  if (!listed.ok) return { models: [], stop: stopsInference(listed.error), step: rec.failWith('models', listed.error) };
  const { models, hiddenCount, shape, requestId } = listed.value;
  if (models.length === 0) {
    return { models, stop: true, step: rec.end('models', 'fail', 'The account returned no models to show', [`Hidden entries: ${String(hiddenCount)}`, `Response shape: ${shape}`]) };
  }
  const step = rec.pass('models', `${String(models.length)} model${models.length === 1 ? '' : 's'} available`, [
    ...models.map((m) => `${m.displayName} (${m.slug})`),
    `Hidden entries: ${String(hiddenCount)}`,
    `Response shape: ${shape === 'models' ? 'models[] (as documented)' : 'data[] (standard API shape, not the documented one)'}`,
    ...(requestId === null ? [] : [`Request ID: ${requestId}`]),
  ]);
  return { models, stop: false, step };
}

/**
 * One tiny streamed call. Returns true on success, false on a failure that
 * still allows other checks, 'stop' when the plan route must pause.
 */
export async function runResponsesStep(
  ports: Pick<SignInTestPorts, 'fetch' | 'vault' | 'nowMs'>,
  model: ModelOption,
  recorder?: StepRecorder,
  onTextDelta?: (delta: string) => void,
): Promise<boolean | 'stop'> {
  const rec = recorder ?? new StepRecorder(ports.nowMs, () => undefined);
  rec.start('responses');
  const fresh = await new TokenRefresher(ports.vault, { fetch: ports.fetch, nowMs: ports.nowMs }).ensureFresh();
  if (!fresh.ok) {
    rec.failWith('responses', fresh.error);
    return 'stop';
  }
  const result = await streamResponse(
    { model: model.slug, instructions: TEST_INSTRUCTIONS, input: [{ type: 'message', role: 'user', content: TEST_PROMPT }] },
    { fetch: ports.fetch, accessToken: fresh.value.tokens.accessToken, nowMs: ports.nowMs, ...(onTextDelta === undefined ? {} : { onTextDelta }) },
  );
  if (!result.ok) {
    const f = result.error;
    rec.failWith('responses', f, [
      `Model: ${model.displayName} (${model.slug})`,
      ...(f.partialText === '' ? [] : [`Text before the failure: ${quote(f.partialText)}`]),
      `After ${formatMs(f.totalMs)}`,
    ]);
    return stopsInference(f) ? 'stop' : false;
  }
  const r = result.value;
  rec.pass('responses', `Reply: ${quote(r.text)}${r.text.trim().replace(/[.!]$/, '') === 'OK' ? '' : ' (not exactly OK, but the stream completed)'}`, [
    `Model: ${model.displayName} (${r.model ?? model.slug})`,
    `First text after ${r.firstTokenMs === null ? 'n/a' : formatMs(r.firstTokenMs)}; completed after ${formatMs(r.totalMs)}`,
    r.usage === null ? 'No usage reported' : `Usage: ${String(r.usage.inputTokens ?? '?')} in, ${String(r.usage.outputTokens ?? '?')} out`,
    'Sent with store:false, stream:true; no temperature or max_output_tokens',
    ...(r.requestId === null ? [] : [`Request ID: ${r.requestId}`]),
  ]);
  return true;
}

/**
 * Forced refresh to prove rotation (S4 part). With `respectEarliestRefresh`,
 * it doesn't run before the server's `earliest_refresh_at`, so the test never
 * risks the new session.
 */
export async function runRefreshStep(
  ports: Pick<SignInTestPorts, 'fetch' | 'vault' | 'nowMs'>,
  recorder?: StepRecorder,
  options: { respectEarliestRefresh: boolean } = { respectEarliestRefresh: false },
): Promise<boolean> {
  const rec = recorder ?? new StepRecorder(ports.nowMs, () => undefined);
  rec.start('refresh');
  const before = parseTokens(await ports.vault.loadTokens());
  if (before === null) {
    rec.end('refresh', 'fail', 'Not signed in: no tokens in the Keychain', []);
    return false;
  }
  if (options.respectEarliestRefresh && before.earliestRefreshAtMs !== null && before.earliestRefreshAtMs > ports.nowMs()) {
    rec.end('refresh', 'skipped', `Not run yet: the server asked not to refresh for ${formatDuration(before.earliestRefreshAtMs - ports.nowMs())}`, [
      'Tap "Refresh now" after that (or after the 1-hour expiry for S4).',
    ]);
    return true;
  }
  const result = await new TokenRefresher(ports.vault, { fetch: ports.fetch, nowMs: ports.nowMs }).ensureFresh(true);
  if (!result.ok) {
    rec.failWith('refresh', result.error, result.error.kind === 'refresh_unusable' ? ['Tokens were cleared; sign in again (registration kept)'] : ['Tokens were kept']);
    return false;
  }
  const after = result.value.tokens;
  rec.pass('refresh', result.value.rotated ? 'Refreshed; refresh token rotated and saved' : 'Refreshed; the server did not send a new refresh token', [
    `New access token ${after.accessToken === before.accessToken ? 'is the SAME as before' : 'differs from the old one'}`,
    `Expires in ${formatDuration(after.expiresAtMs - ports.nowMs())}`,
    `Scopes ${sameSet(after.scopes, before.scopes) ? 'unchanged' : `changed: ${after.scopes.join(' ')}`}`,
    'Saved as one Keychain item (access, expiry, scopes, refresh token together)',
  ]);
  return true;
}

export interface DisconnectResult {
  revoked: boolean;
  summary: string;
  details: string[];
}

/**
 * Sign out: revoke the refresh token where possible, then delete the tokens
 * whatever happens. The registration (host ID, issued client ID) is kept.
 */
export async function disconnect(ports: Pick<SignInTestPorts, 'fetch' | 'vault' | 'nowMs'>): Promise<DisconnectResult> {
  const tokens = parseTokens(await ports.vault.loadTokens());
  if (tokens === null) {
    await ports.vault.deleteTokens();
    return { revoked: false, summary: 'Nothing to disconnect: no tokens were stored', details: [] };
  }
  const revoke = await revokeRefreshToken(tokens, { fetch: ports.fetch, nowMs: ports.nowMs });
  await ports.vault.deleteTokens();
  const remaining = await ports.vault.loadTokens();
  const details = [
    `Revocation endpoint from ${revoke.endpointSource === 'discovery' ? 'the discovery document' : 'the fallback constant'}`,
    remaining === null ? 'Tokens deleted from the Keychain' : 'WARNING: tokens are still in the Keychain',
    'Host ID and issued client ID kept for the next sign-in',
  ];
  if (revoke.confirmed) return { revoked: true, summary: 'ChatGPT disconnected', details };
  return {
    revoked: false,
    summary: 'Disconnected on this phone; remote revocation was not confirmed',
    details: [...details, `Revocation: ${revoke.failure?.message ?? 'unknown'}`, 'You can also disconnect Fizz in ChatGPT Settings.'],
  };
}

/** Status without secrets, for the screen header. */
export interface ConnectionSnapshot {
  hostIdSaved: boolean;
  clientId: string | null;
  email: string | null;
  signedIn: boolean;
  planUsage: boolean;
  expiresInMs: number | null;
}

export async function readConnection(ports: Pick<SignInTestPorts, 'vault' | 'nowMs'>): Promise<ConnectionSnapshot> {
  const registration = parseRegistration(await ports.vault.loadRegistration());
  const tokens = parseTokens(await ports.vault.loadTokens());
  return {
    hostIdSaved: registration !== null,
    clientId: registration?.clientId === null || registration === null ? null : maskClientId(registration.clientId),
    email: registration?.email ?? null,
    signedIn: tokens !== null,
    planUsage: tokens !== null && hasPlanUsageScope(tokens.scopes),
    expiresInMs: tokens === null ? null : tokens.expiresAtMs - ports.nowMs(),
  };
}

// ---------- Reporting ----------

export interface ReportContext {
  appVersion: string;
  buildNumber: string;
  osVersion: string;
  exportedAtIso: string;
  timeZone: string;
}

const STATUS_WORD: Record<StepStatus, string> = {
  pending: 'NOT RUN',
  running: 'RUNNING',
  pass: 'PASS',
  fail: 'FAIL',
  skipped: 'SKIPPED',
  unavailable: 'UNAVAILABLE',
};

/** Plain-text export. Emails are masked; tokens and codes never reach steps. */
export function formatSignInReport(steps: readonly StepResult[], listenerLog: readonly ListenerLogEntry[], ctx: ReportContext): string {
  const lines = [
    'Fizz spike S1: ChatGPT sign-in test',
    `Exported: ${ctx.exportedAtIso} (device time zone ${ctx.timeZone})`,
    `App ${ctx.appVersion} (build ${ctx.buildNumber}), iOS ${ctx.osVersion}`,
    '',
  ];
  for (const s of steps) {
    lines.push(`[${STATUS_WORD[s.status]}] ${s.title}${s.durationMs === null ? '' : ` (${formatMs(s.durationMs)})`}`);
    lines.push(`  ${maskEmails(s.summary)}`);
    for (const d of s.details) lines.push(`  - ${maskEmails(d)}`);
    if (s.failure !== undefined) {
      const f = s.failure;
      lines.push(
        `  - error: kind=${f.kind}${f.status === undefined ? '' : ` status=${String(f.status)}`}${f.code === undefined ? '' : ` code=${f.code}`}${f.param === undefined ? '' : ` param=${f.param}`}${f.requestId === undefined ? '' : ` request=${f.requestId}`} recovery=${f.recovery}`,
      );
    }
  }
  lines.push('', 'Listener log:');
  if (listenerLog.length === 0) lines.push('  (empty)');
  const t0 = listenerLog[0]?.atMs ?? 0;
  for (const l of listenerLog) lines.push(`  +${formatMs(l.atMs - t0)} ${l.kind}: ${l.detail}`);
  return lines.join('\n');
}

// ---------- Helpers ----------

export class StepRecorder {
  private readonly startedAt = new Map<StepId, number>();

  constructor(
    private readonly nowMs: () => number,
    private readonly emit: (s: StepResult) => void,
  ) {}

  start(id: StepId): void {
    this.startedAt.set(id, this.nowMs());
    this.emit({ id, title: STEP_TITLES[id], status: 'running', summary: 'Running…', details: [], durationMs: null });
  }

  end(id: StepId, status: StepStatus, summary: string, details: string[], failureInfo?: ProviderFailure): StepResult {
    const began = this.startedAt.get(id);
    const step: StepResult = {
      id,
      title: STEP_TITLES[id],
      status,
      summary,
      details,
      durationMs: began === undefined ? null : this.nowMs() - began,
      ...(failureInfo === undefined ? {} : { failure: failureInfo }),
    };
    this.emit(step);
    return step;
  }

  pass(id: StepId, summary: string, details: string[]): StepResult {
    return this.end(id, 'pass', summary, details);
  }

  failWith(id: StepId, f: ProviderFailure, extra: string[] = []): StepResult {
    return this.end(id, 'fail', describeFailure(f), extra, f);
  }
}

/** Design copy (ai-connection.md §3.1/§5) for each failure kind. */
export function describeFailure(f: ProviderFailure): string {
  switch (f.kind) {
    case 'usage_limit':
      return 'ChatGPT usage limit reached. The coach is paused; open Manage usage in ChatGPT. (No reset time is known.)';
    case 'not_eligible':
      return "This ChatGPT account can't be used by other apps. Not retried.";
    case 'unavailable':
      return "ChatGPT usage isn't available right now. Try again later.";
    case 'region':
      return "ChatGPT plan use in other apps isn't available in your region.";
    case 'policy_forbidden':
      return `A ChatGPT policy check refused the request: ${f.message}`;
    case 'scope_missing':
      return "Signed in, but ChatGPT didn't allow coach replies for this app.";
    case 'access_denied':
      return 'Access was declined on the ChatGPT page. Nothing was connected.';
    case 'refresh_unusable':
    case 'invalid_user':
    case 'unauthorized':
      return `ChatGPT disconnected. Sign in again. (${f.message})`;
    case 'state_mismatch':
    case 'missing_code':
    case 'registration_incomplete':
    case 'client_id_mismatch':
    case 'invalid_grant':
    case 'invalid_client':
    case 'id_token_invalid':
    case 'oauth_error':
    case 'unsupported_capability':
    case 'route_not_supported':
    case 'scope_not_authorized':
    case 'rate_limited':
    case 'bad_request':
    case 'server':
    case 'network':
    case 'timeout':
    case 'stream_interrupted':
    case 'incomplete':
    case 'response_failed':
    case 'protocol':
      return f.message;
  }
}

/** Failures after which no further plan request should be sent in this run. */
function stopsInference(f: ProviderFailure): boolean {
  return ['usage_limit', 'not_eligible', 'region', 'policy_forbidden', 'scope_not_authorized', 'invalid_user', 'unauthorized', 'refresh_unusable'].includes(f.kind);
}

export function maskClientId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 7)}…${id.slice(-4)}`;
}

function maskTail(s: string, keep: number): string {
  return `…${s.slice(-keep)}`;
}

export function maskEmails(text: string): string {
  return text.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2');
}

function quote(s: string): string {
  const t = s.length > 120 ? `${s.slice(0, 120)}…` : s;
  return `"${t}"`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now (already passed)';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${String(Math.round(ms / 1000))} s`;
  if (minutes < 120) return `${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${String(hours)} h` : `${String(Math.round(hours / 24))} days`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

