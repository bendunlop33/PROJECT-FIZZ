/**
 * Credential storage contract and refresh orchestration.
 *
 * The vault is implemented by the app on the iOS Keychain
 * (expo-secure-store, WHEN_UNLOCKED_THIS_DEVICE_ONLY): never SQLite, never
 * plain files, never a backup (CLAUDE.md rule 7, design AC7). Two items:
 * - registration (host ID, issued client ID, email): kept on Disconnect so
 *   a later sign-in reuses the same client and host (docs: sign out keeps the
 *   account/client mapping and the host ID);
 * - tokens: one item, so access token, expiry, scopes and the rotated
 *   refresh token are always replaced together.
 */

import { err, ok, parseJsonObject, type Result } from '../http';
import type { ChatGptRegistration } from './authorize';
import { REFRESH_SKEW_MS } from './constants';
import { failure, type ProviderFailure } from './errors';
import { refreshTokens, type ChatGptTokenSet, type TokenCallOptions } from './tokens';

export interface ChatGptVault {
  loadRegistration(): Promise<string | null>;
  saveRegistration(serialized: string): Promise<void>;
  loadTokens(): Promise<string | null>;
  saveTokens(serialized: string): Promise<void>;
  deleteTokens(): Promise<void>;
}

const REGISTRATION_VERSION = 1;
const TOKENS_VERSION = 1;

export function serializeRegistration(r: ChatGptRegistration): string {
  return JSON.stringify({ v: REGISTRATION_VERSION, ...r });
}

export function parseRegistration(text: string | null): ChatGptRegistration | null {
  if (text === null) return null;
  const j = parseJsonObject(text);
  if (j?.v !== REGISTRATION_VERSION || typeof j.hostId !== 'string' || j.hostId === '') return null;
  return {
    hostId: j.hostId,
    clientId: typeof j.clientId === 'string' && j.clientId !== '' ? j.clientId : null,
    email: typeof j.email === 'string' ? j.email : null,
    subject: typeof j.subject === 'string' ? j.subject : null,
  };
}

export function serializeTokens(t: ChatGptTokenSet): string {
  return JSON.stringify({ v: TOKENS_VERSION, ...t });
}

export function parseTokens(text: string | null): ChatGptTokenSet | null {
  if (text === null) return null;
  const j = parseJsonObject(text);
  if (j?.v !== TOKENS_VERSION) return null;
  const str = (k: string) => (typeof j[k] === 'string' ? j[k] : null);
  const num = (k: string) => (typeof j[k] === 'number' ? j[k] : null);
  const clientId = str('clientId');
  const accessToken = str('accessToken');
  const expiresAtMs = num('expiresAtMs');
  const savedAtMs = num('savedAtMs');
  if (clientId === null || accessToken === null || expiresAtMs === null || savedAtMs === null) return null;
  const scopes = Array.isArray(j.scopes) ? j.scopes.filter((s): s is string => typeof s === 'string') : [];
  return {
    clientId,
    accessToken,
    refreshToken: str('refreshToken'),
    idToken: str('idToken'),
    tokenType: str('tokenType') ?? 'Bearer',
    expiresAtMs,
    earliestRefreshAtMs: num('earliestRefreshAtMs'),
    scopes,
    savedAtMs,
  };
}

export function needsRefresh(tokens: ChatGptTokenSet, nowMs: number, skewMs = REFRESH_SKEW_MS): boolean {
  return tokens.expiresAtMs - skewMs <= nowMs;
}

export interface RefreshOutcome {
  tokens: ChatGptTokenSet;
  refreshed: boolean;
  /** True when the server sent a new refresh token (rotation). */
  rotated: boolean;
}

/**
 * Serializes refreshes: concurrent callers share one in-flight refresh, so
 * a rotating refresh token is never sent twice (`refresh_token_reused`).
 * After a confirmed-unusable refresh token the tokens are deleted (the
 * registration stays); network and 5xx failures keep them.
 */
export class TokenRefresher {
  private inFlight: Promise<Result<RefreshOutcome, ProviderFailure>> | null = null;

  constructor(
    private readonly vault: ChatGptVault,
    private readonly options: TokenCallOptions,
  ) {}

  /** A usable access token, refreshing first if it is near expiry (or if `force`). */
  async ensureFresh(force = false): Promise<Result<RefreshOutcome, ProviderFailure>> {
    if (this.inFlight !== null) return this.inFlight;
    const run = this.run(force);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  private async run(force: boolean): Promise<Result<RefreshOutcome, ProviderFailure>> {
    const current = parseTokens(await this.vault.loadTokens());
    if (current === null) return err(failure('unauthorized', 'Not signed in to ChatGPT on this phone'));
    if (!force && !needsRefresh(current, this.options.nowMs())) return ok({ tokens: current, refreshed: false, rotated: false });
    const result = await refreshTokens(current, this.options);
    if (!result.ok) {
      if (result.error.kind === 'refresh_unusable') await this.vault.deleteTokens();
      return result;
    }
    // Store the replacement set as one write before anyone uses it.
    await this.vault.saveTokens(serializeTokens(result.value));
    return ok({
      tokens: result.value,
      refreshed: true,
      rotated: result.value.refreshToken !== null && result.value.refreshToken !== current.refreshToken,
    });
  }
}
