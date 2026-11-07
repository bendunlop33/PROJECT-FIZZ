import { parseTokens, revokeRefreshToken, type ConnectionPorts } from '@fizz/providers';

import type { CredentialPort } from '../backup/data-domain-service';

/**
 * `Delete my data` (data-import-export §4.5 step 1): end the ChatGPT sign-in
 * on this phone first, then hand back the online revoke. The revoke only
 * talks to the network, so one that answers after Delete stopped waiting
 * can't write any file back (review S3). Then every Keychain item is
 * deleted by key, including the registration (it holds the account email).
 */
export function createCredentialPort(ports: Pick<ConnectionPorts, 'fetch' | 'vault' | 'nowMs'>, wipe: () => Promise<void>): CredentialPort {
  return {
    async signOut() {
      const tokens = parseTokens(await ports.vault.loadTokens());
      await ports.vault.deleteTokens();
      if (tokens === null || tokens.refreshToken === null) return { revokeOnline: null };
      return {
        revokeOnline: async () => (await revokeRefreshToken(tokens, { fetch: ports.fetch, nowMs: ports.nowMs })).confirmed,
      };
    },
    wipe,
  };
}
