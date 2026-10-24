import { describe, expect, it } from 'vitest';

import { serializeTokens, type ChatGptVault, type FetchLike, type FetchResponseLike } from '@fizz/providers';

import { createCredentialPort } from '../src/ai/credential-port';

/**
 * Delete my data's ChatGPT sign-out (review S3): the sign-in is removed from
 * the phone before the online revoke starts, and the revoke only talks to
 * the network, so a slow answer can't write a file back after Delete.
 */

function vault(withTokens: boolean) {
  const store: { tokens: string | null; registration: string | null } = {
    tokens: withTokens
      ? serializeTokens({
          clientId: 'oaiapp_X',
          accessToken: 'a',
          refreshToken: 'r',
          idToken: null,
          tokenType: 'Bearer',
          expiresAtMs: 2,
          earliestRefreshAtMs: null,
          scopes: [],
          savedAtMs: 1,
        })
      : null,
    registration: '{"v":1}',
  };
  const v: ChatGptVault = {
    loadRegistration: () => Promise.resolve(store.registration),
    saveRegistration: (s) => {
      store.registration = s;
      return Promise.resolve();
    },
    loadTokens: () => Promise.resolve(store.tokens),
    saveTokens: (s) => {
      store.tokens = s;
      return Promise.resolve();
    },
    deleteTokens: () => {
      store.tokens = null;
      return Promise.resolve();
    },
  };
  return { v, store };
}

const response = (status: number): FetchResponseLike => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, body: null, text: () => Promise.resolve('') });

describe('createCredentialPort', () => {
  it('removes the tokens first; the revoke answers later and writes nothing', async () => {
    const { v, store } = vault(true);
    const calls: string[] = [];
    const slow: FetchLike = (url, init) =>
      new Promise((resolve) => {
        calls.push(`${init.method} ${url}`);
        setTimeout(() => {
          resolve(init.method === 'GET' ? response(404) : response(200));
        }, 30);
      });
    const port = createCredentialPort({ fetch: slow, vault: v, nowMs: () => 0 }, () => Promise.resolve());
    const out = await port.signOut();
    // Gone from the phone before any network call answered.
    expect(store.tokens).toBeNull();
    expect(out.revokeOnline).not.toBeNull();
    expect(await out.revokeOnline?.()).toBe(true);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(true);
    expect(store.tokens).toBeNull();
  });

  it('with no sign-in there is nothing to revoke', async () => {
    const { v } = vault(false);
    const port = createCredentialPort({ fetch: () => Promise.reject(new Error('no network')), vault: v, nowMs: () => 0 }, () => Promise.resolve());
    expect(await port.signOut()).toEqual({ revokeOnline: null });
  });

  it('offline: the revoke reports false, the sign-in is still off the phone', async () => {
    const { v, store } = vault(true);
    const port = createCredentialPort({ fetch: () => Promise.reject(new Error('offline')), vault: v, nowMs: () => 0 }, () => Promise.resolve());
    const out = await port.signOut();
    expect(store.tokens).toBeNull();
    expect(await out.revokeOnline?.().catch(() => false)).toBe(false);
  });
});
