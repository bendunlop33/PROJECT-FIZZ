/**
 * Product "Coach connection" (ai-connection.md §2.1–2.6, §3.1, ADR 0018 §8,
 * slice C5): connect the ChatGPT plan, choose a model, read an honest status.
 *
 * Built from the same pieces as the S1 sign-in test that passed on Ben's
 * iPhone (build 83): host ID, loopback listener + system sheet, PKCE code
 * exchange, ID-token claim checks, the `chatgpt.tokens.use.direct` scope gate,
 * the Keychain vault and GET /v1/models. Unlike the test it sends no
 * Responses call and forces no refresh: "Nothing is used from your plan yet."
 *
 * Rules kept here:
 * - ChatGPT plan only. There is no API-key route, so no error can switch to a
 *   paid route (CLAUDE.md rule 7; ADR 0018 §8 "No paid route in v1").
 * - No scope → nothing stored (tokens revoked), status `no_scope`.
 * - `not_eligible` is remembered and stops further calls until Ben taps
 *   something; nothing retries or loops OAuth (acceptance 5).
 * - The model is Ben's choice. A chosen model that disappears gives
 *   `model_gone`; another model is never picked silently (AC6).
 * - Settings hold no secrets (model slug, first-use flag, last sticky
 *   failure). Credentials stay in the vault.
 */

import { err, ok, parseJsonObject, type CryptoPort, type FetchLike, type Result } from '../http';
import { createAuthAttempt, newHostId, parseCallback, type ChatGptRegistration } from './authorize';
import { CALLBACK_PATH, PREFERRED_CALLBACK_PORT } from './constants';
import { TokenRefresher, parseRegistration, parseTokens, serializeRegistration, serializeTokens, type ChatGptVault } from './credentials';
import { failure, type FailureKind, type ProviderFailure } from './errors';
import { listModels, type ModelOption } from './models';
import { SIGN_IN_TIMEOUT_MS, disconnect as disconnectTokens, revokeDiscarded, type LoopbackPort } from './sign-in-test';
import { exchangeCode, hasPlanUsageScope, validateIdTokenClaims, type ChatGptTokenSet } from './tokens';

/** The model the app was tested with on Ben's iPhone (S1, 10 Oct 2026). Marked `tested with GymSmarter` only if listed. */
export const TESTED_MODEL_SLUG = 'gpt-6.1-sol';

// ---------- Settings (non-secret) ----------

/** A failure that keeps the coach paused until Ben acts. Transient ones (network, 5xx, timeout) are never stored. */
export type StickyFailureKind = 'usage_limit' | 'not_eligible' | 'region' | 'scope_not_authorized' | 'expired';

export interface CoachConnectionSettings {
  /** The model Ben chose (or that was preselected for him at sign-in); null until a list was read. */
  modelSlug: string | null;
  modelName: string | null;
  /** The first-use notice ("You're using your ChatGPT plan") was dismissed. Shown once ever (OpenAI UI guidelines). */
  firstUseSeen: boolean;
  lastFailure: { kind: StickyFailureKind; atMs: number } | null;
}

export const DEFAULT_CONNECTION_SETTINGS: CoachConnectionSettings = { modelSlug: null, modelName: null, firstUseSeen: false, lastFailure: null };

const SETTINGS_VERSION = 1;
const STICKY: ReadonlySet<string> = new Set<StickyFailureKind>(['usage_limit', 'not_eligible', 'region', 'scope_not_authorized', 'expired']);

export function serializeConnectionSettings(s: CoachConnectionSettings): string {
  return JSON.stringify({ v: SETTINGS_VERSION, ...s });
}

/** Unreadable or missing settings read as the defaults (nothing chosen, nothing paused). */
export function parseConnectionSettings(text: string | null): CoachConnectionSettings {
  if (text === null) return DEFAULT_CONNECTION_SETTINGS;
  const j = parseJsonObject(text);
  if (j?.v !== SETTINGS_VERSION) return DEFAULT_CONNECTION_SETTINGS;
  const slug = typeof j.modelSlug === 'string' && j.modelSlug !== '' ? j.modelSlug : null;
  const lf = typeof j.lastFailure === 'object' && j.lastFailure !== null ? (j.lastFailure as Record<string, unknown>) : null;
  const lastFailure =
    lf !== null && typeof lf.kind === 'string' && STICKY.has(lf.kind) && typeof lf.atMs === 'number' ? { kind: lf.kind as StickyFailureKind, atMs: lf.atMs } : null;
  return {
    modelSlug: slug,
    modelName: slug !== null && typeof j.modelName === 'string' && j.modelName !== '' ? j.modelName : slug,
    firstUseSeen: j.firstUseSeen === true,
    lastFailure,
  };
}

/** Which provider failures pause the coach until Ben acts. Everything else is shown on the turn and forgotten. */
const STICKY_BY_KIND: Partial<Record<FailureKind, StickyFailureKind>> = {
  usage_limit: 'usage_limit',
  not_eligible: 'not_eligible',
  region: 'region',
  scope_not_authorized: 'scope_not_authorized',
  refresh_unusable: 'expired',
  unauthorized: 'expired',
  invalid_user: 'expired',
};

export function stickyKindOf(kind: FailureKind): StickyFailureKind | null {
  return STICKY_BY_KIND[kind] ?? null;
}

// ---------- Status (getAiCapabilities, text part) ----------

/**
 * ai-connection §6 `text.status` for the ChatGPT-plan route, plus `no_model`
 * (connected, but no model list has been read yet, e.g. tokens from the S1
 * developer test). `unavailable` is never a stored status: it's a per-request
 * outcome. `offline` needs a network signal the app doesn't have yet (ADR
 * 0018 §8, `expo-network` Needs Ben), so it only appears when one is passed.
 */
export type TextCoachStatus = 'ok' | 'not_connected' | 'expired' | 'limit' | 'not_eligible' | 'no_scope' | 'region' | 'model_gone' | 'no_model' | 'offline';

export interface TextCoachState {
  status: TextCoachStatus;
  route: 'chatgpt_plan' | null;
  email: string | null;
  model: ModelOption | null;
}

export interface TextCoachInput {
  tokens: ChatGptTokenSet | null;
  registration: ChatGptRegistration | null;
  settings: CoachConnectionSettings;
  /** The account's models from the latest GET /v1/models, or null if not read in this run. */
  listedModels: readonly ModelOption[] | null;
  network?: 'online' | 'offline' | 'unknown';
}

/** Pure. Order: credentials, then sticky failures, then model, then network. */
export function textCoachState(input: TextCoachInput): TextCoachState {
  const { tokens, settings } = input;
  const email = input.registration?.email ?? null;
  const model = settings.modelSlug === null ? null : { slug: settings.modelSlug, displayName: settings.modelName ?? settings.modelSlug };
  const sticky = settings.lastFailure?.kind ?? null;
  const out = (status: TextCoachStatus): TextCoachState => ({ status, route: status === 'not_connected' ? null : 'chatgpt_plan', email, model });

  if (tokens === null) {
    if (sticky === 'expired') return out('expired');
    if (sticky === 'not_eligible') return out('not_eligible');
    if (sticky === 'region') return out('region');
    return out('not_connected');
  }
  if (!hasPlanUsageScope(tokens.scopes)) return out('no_scope');
  switch (sticky) {
    case 'expired':
      return out('expired');
    case 'not_eligible':
      return out('not_eligible');
    case 'region':
      return out('region');
    case 'scope_not_authorized':
      return out('no_scope');
    case 'usage_limit':
      return out('limit');
    case null:
      break;
  }
  if (settings.modelSlug === null) return out('no_model');
  if (input.listedModels !== null && !input.listedModels.some((m) => m.slug === settings.modelSlug)) return out('model_gone');
  if (input.network === 'offline') return out('offline');
  return out('ok');
}

// ---------- Ports ----------

export interface SettingsStore {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
}

export interface ConnectionPorts {
  fetch: FetchLike;
  crypto: CryptoPort;
  loopback: LoopbackPort;
  vault: ChatGptVault;
  settings: SettingsStore;
  nowMs: () => number;
  newUuid: () => string;
}

export async function loadConnectionSettings(store: SettingsStore): Promise<CoachConnectionSettings> {
  try {
    return parseConnectionSettings(await store.load());
  } catch {
    return DEFAULT_CONNECTION_SETTINGS;
  }
}

async function updateSettings(store: SettingsStore, change: (s: CoachConnectionSettings) => CoachConnectionSettings): Promise<CoachConnectionSettings> {
  const next = change(await loadConnectionSettings(store));
  await store.save(serializeConnectionSettings(next));
  return next;
}

/** Reads the state without any network call (Keychain + settings file). */
export async function readTextCoachState(
  ports: Pick<ConnectionPorts, 'vault' | 'settings'>,
  extra: { listedModels?: readonly ModelOption[] | null; network?: 'online' | 'offline' | 'unknown' } = {},
): Promise<TextCoachState> {
  const [registration, tokens, settings] = await Promise.all([
    ports.vault.loadRegistration().then(parseRegistration),
    ports.vault.loadTokens().then(parseTokens),
    loadConnectionSettings(ports.settings),
  ]);
  return textCoachState({ tokens, registration, settings, listedModels: extra.listedModels ?? null, ...(extra.network === undefined ? {} : { network: extra.network }) });
}

/** Remembers a failure from any coach request if it should pause the coach; transient failures are ignored. */
export async function recordProviderFailure(store: SettingsStore, f: ProviderFailure, nowMs: number): Promise<void> {
  const kind = stickyKindOf(f.kind);
  if (kind === null) return;
  await updateSettings(store, (s) => ({ ...s, lastFailure: { kind, atMs: nowMs } }));
}

/** Ben's `Check again` after a limit, or a later successful call: the pause is lifted. */
export async function clearProviderFailure(store: SettingsStore): Promise<void> {
  await updateSettings(store, (s) => (s.lastFailure === null ? s : { ...s, lastFailure: null }));
}

export async function markFirstUseSeen(store: SettingsStore): Promise<void> {
  await updateSettings(store, (s) => ({ ...s, firstUseSeen: true }));
}

/**
 * `selectModel` (ai-connection §6): only a model from the latest list can be
 * chosen. Takes effect from the next message; never mid-turn.
 */
export async function selectModel(store: SettingsStore, listed: readonly ModelOption[], slug: string): Promise<Result<ModelOption, 'not_listed'>> {
  const found = listed.find((m) => m.slug === slug);
  if (found === undefined) return err('not_listed');
  await updateSettings(store, (s) => ({ ...s, modelSlug: found.slug, modelName: found.displayName }));
  return ok(found);
}

/**
 * AC6 preselection. First connection (no earlier choice): the tested model if
 * listed, else the first. With an earlier choice: that model if still listed,
 * else null. The coach then reads `model_gone` and pauses with `Choose
 * model`; another model is never picked silently (review B3).
 */
export function preselectModel(listed: readonly ModelOption[], previousSlug: string | null): ModelOption | null {
  if (previousSlug !== null) return listed.find((m) => m.slug === previousSlug) ?? null;
  return listed.find((m) => m.slug === TESTED_MODEL_SLUG) ?? listed[0] ?? null;
}

// ---------- Models ----------

export type ModelsOutcome = { ok: true; models: ModelOption[] } | { ok: false; failure: ProviderFailure };

/**
 * `listAvailableModels`: GET /v1/models (no plan usage). A failure that should
 * pause the coach is remembered; a refresh token found unusable clears the
 * tokens (TokenRefresher) and reads as `expired`.
 */
export async function refreshAvailableModels(ports: Pick<ConnectionPorts, 'fetch' | 'vault' | 'settings' | 'nowMs'>): Promise<ModelsOutcome> {
  const fresh = await new TokenRefresher(ports.vault, { fetch: ports.fetch, nowMs: ports.nowMs }).ensureFresh();
  if (!fresh.ok) {
    if (fresh.error.kind === 'refresh_unusable') await recordProviderFailure(ports.settings, fresh.error, ports.nowMs());
    return { ok: false, failure: fresh.error };
  }
  const listed = await listModels(fresh.value.tokens.accessToken, { fetch: ports.fetch });
  if (!listed.ok) {
    await recordProviderFailure(ports.settings, listed.error, ports.nowMs());
    return { ok: false, failure: listed.error };
  }
  return { ok: true, models: listed.value.models };
}

// ---------- Connect ----------

export type ConnectPhase =
  /** The system sheet is open (ai-connection §2.3). */
  | { kind: 'waiting' }
  /** §2.4: each step shown only while it runs. */
  | { kind: 'checking'; step: 'signed_in' | 'access' | 'models'; email: string | null };

export type ConnectOutcome =
  | { kind: 'connected'; email: string | null; models: ModelOption[]; selected: ModelOption | null; modelsFailure: ProviderFailure | null; firstUse: boolean }
  /** The build has no loopback module. */
  | { kind: 'sign_in_unavailable'; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'timed_out' }
  /** The sheet ended without the callback reaching the listener (e.g. Ben switched apps). */
  | { kind: 'didnt_return'; detail: string }
  /** Signed in, but `chatgpt.tokens.use.direct` wasn't granted. Nothing stored. */
  | { kind: 'no_scope' }
  /** A different ChatGPT account than the one this phone registered. Nothing replaced. */
  | { kind: 'different_account' }
  | { kind: 'failed'; failure: ProviderFailure };

export interface ConnectOptions {
  onPhase?: (phase: ConnectPhase) => void;
  signInTimeoutMs?: number;
}

/**
 * `beginAiConnection` + `completeAiConnection` in one call. Never throws.
 * The listener is always stopped. Tokens are stored only after every check
 * passed; a failure before that leaves the previous credentials untouched.
 */
export async function connectChatGpt(ports: ConnectionPorts, options: ConnectOptions = {}): Promise<ConnectOutcome> {
  try {
    const unavailable = ports.loopback.unavailableReason();
    if (unavailable !== null) return { kind: 'sign_in_unavailable', reason: unavailable };

    let registration = parseRegistration(await ports.vault.loadRegistration());
    if (registration === null) {
      registration = { hostId: newHostId(ports.newUuid()), clientId: null, email: null, subject: null };
      await ports.vault.saveRegistration(serializeRegistration(registration));
    }

    let port: number;
    try {
      port = (await ports.loopback.startListener(CALLBACK_PATH, PREFERRED_CALLBACK_PORT)).port;
    } catch (e) {
      await ports.loopback.stopListener().catch(() => undefined);
      return { kind: 'failed', failure: failure('protocol', `The sign-in listener couldn't start: ${errorText(e)}`) };
    }

    try {
      const previous = parseTokens(await ports.vault.loadTokens());
      const idTokenHint = previous !== null && previous.clientId === registration.clientId ? previous.idToken : null;
      const attempt = await createAuthAttempt({ port, registration, idTokenHint }, ports.crypto);
      options.onPhase?.({ kind: 'waiting' });
      const session = await ports.loopback.openAuthSession(attempt.url, options.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
      if (session.kind === 'cancelled') return { kind: 'cancelled' };
      if (session.kind === 'timeout') return { kind: 'timed_out' };
      if (session.kind === 'error') return { kind: 'didnt_return', detail: session.message };

      const callback = parseCallback(session.url, attempt);
      if (!callback.ok) {
        return callback.error.kind === 'access_denied' ? { kind: 'cancelled' } : { kind: 'failed', failure: callback.error };
      }
      if (attempt.isNewRegistration) {
        // Keep the issued client ID even if a later check fails (S1 behaviour).
        registration = { ...registration, clientId: callback.value.clientId };
        await ports.vault.saveRegistration(serializeRegistration(registration));
      }

      const exchanged = await exchangeCode(
        { clientId: callback.value.clientId, code: callback.value.code, codeVerifier: attempt.codeVerifier, redirectUri: attempt.redirectUri },
        { fetch: ports.fetch, nowMs: ports.nowMs },
      );
      if (!exchanged.ok) return { kind: 'failed', failure: exchanged.error };
      const tokens = exchanged.value;
      if (tokens.idToken === null) return { kind: 'failed', failure: failure('id_token_invalid', 'No ID token in the token response') };
      const claims = validateIdTokenClaims(tokens.idToken, { clientId: callback.value.clientId, nonce: attempt.nonce, nowMs: ports.nowMs() });
      if (!claims.ok) return { kind: 'failed', failure: claims.error };
      if (registration.subject !== null && registration.subject !== claims.value.subject) {
        await revokeDiscarded(tokens, ports);
        return { kind: 'different_account' };
      }
      const email = claims.value.email;
      options.onPhase?.({ kind: 'checking', step: 'signed_in', email });

      options.onPhase?.({ kind: 'checking', step: 'access', email });
      if (!hasPlanUsageScope(tokens.scopes)) {
        await revokeDiscarded(tokens, ports);
        return { kind: 'no_scope' };
      }

      await ports.vault.saveTokens(serializeTokens(tokens));
      registration = { ...registration, email, subject: claims.value.subject };
      await ports.vault.saveRegistration(serializeRegistration(registration));
      // A new sign-in lifts any earlier pause (expired, limit…): Ben acted.
      let settings = await updateSettings(ports.settings, (s) => ({ ...s, lastFailure: null }));

      options.onPhase?.({ kind: 'checking', step: 'models', email });
      const listed = await listModels(tokens.accessToken, { fetch: ports.fetch });
      if (!listed.ok) {
        const sticky = stickyKindOf(listed.error.kind);
        if (sticky === 'not_eligible' || sticky === 'region' || sticky === 'scope_not_authorized') {
          // The account can't use the plan from apps: don't keep credentials that can't be used.
          await revokeDiscarded(tokens, ports);
          await ports.vault.deleteTokens();
          await recordProviderFailure(ports.settings, listed.error, ports.nowMs());
          return { kind: 'failed', failure: listed.error };
        }
        await recordProviderFailure(ports.settings, listed.error, ports.nowMs());
        return { kind: 'connected', email, models: [], selected: settings.modelSlug === null ? null : { slug: settings.modelSlug, displayName: settings.modelName ?? settings.modelSlug }, modelsFailure: listed.error, firstUse: !settings.firstUseSeen };
      }
      const models = listed.value.models;
      const selected = preselectModel(models, settings.modelSlug);
      // Only a first connection writes a choice; an earlier choice that's no longer listed is kept so the state reads `model_gone`.
      if (selected !== null) settings = await updateSettings(ports.settings, (s) => (s.modelSlug === null ? { ...s, modelSlug: selected.slug, modelName: selected.displayName } : s));
      return { kind: 'connected', email, models, selected, modelsFailure: null, firstUse: !settings.firstUseSeen };
    } finally {
      await ports.loopback.stopListener().catch(() => undefined);
    }
  } catch (e) {
    return { kind: 'failed', failure: failure('protocol', `Unexpected error: ${errorText(e)}`) };
  }
}

/**
 * `disconnectAiConnection`: revoke where possible, delete the tokens, keep
 * the registration (host ID, issued client ID) and the model choice. Any
 * pause is cleared: the state is simply "Not connected".
 */
export async function disconnectChatGpt(ports: Pick<ConnectionPorts, 'fetch' | 'vault' | 'settings' | 'nowMs'>): Promise<{ revoked: boolean }> {
  const r = await disconnectTokens(ports);
  await clearProviderFailure(ports.settings);
  return { revoked: r.revoked };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
