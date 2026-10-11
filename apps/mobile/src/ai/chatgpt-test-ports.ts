/**
 * Device adapters for spike S1 (ChatGPT sign-in test). The logic lives in
 * @fizz/providers; this file only wires it to the phone:
 * - fetch: expo/fetch (streams response bodies on iOS);
 * - crypto: expo-crypto (system CSPRNG and SHA-256; never Math.random);
 * - vault: expo-secure-store, Keychain, WHEN_UNLOCKED_THIS_DEVICE_ONLY, its own
 *   keychain service. Never SQLite or files, so never in a Fizz backup;
 * - loopback: the LoopbackAuth native module (127.0.0.1 listener + system sheet).
 *
 * There is deliberately no API-key path here (CLAUDE.md rule 7).
 */

import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';

import type { AuthSessionOutcome, CryptoPort, FetchLike, ListenerLogEntry, LoopbackPort, SignInTestPorts } from '@fizz/providers';

import LoopbackAuth, { type NativeListenerLogEntry } from '../../modules/loopback-auth';
import { nowMs } from '../clock';
import { newUuid } from '../device/runtime';
import { keychainVault } from './keychain';

export { keychainVault };

const deviceCrypto: CryptoPort = {
  randomBytes: (count) => Crypto.getRandomBytes(count),
  // Copy into a plain ArrayBuffer-backed view (digest's BufferSource type excludes SharedArrayBuffer).
  sha256: async (data) => new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, Uint8Array.from(data))),
};

const deviceFetch: FetchLike = async (url, init) => {
  const response = await expoFetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
  return response;
};

const LOG_KINDS: ReadonlySet<string> = new Set(['ready', 'sheet', 'connection', 'request', 'callback', 'not_found', 'error', 'stopped']);

function toEntry(e: NativeListenerLogEntry): ListenerLogEntry {
  const kind = LOG_KINDS.has(e.kind) ? (e.kind as ListenerLogEntry['kind']) : 'error';
  return { atMs: e.atMs, kind, detail: kind === e.kind ? e.detail : `${e.kind}: ${e.detail}` };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The loopback port; `cancel()` closes an open sheet (the run then reports "cancelled"). */
export interface DeviceLoopback extends LoopbackPort {
  cancel(): Promise<void>;
}

export function createDeviceLoopback(): DeviceLoopback {
  let log: ListenerLogEntry[] = [];
  const refreshLog = async () => {
    if (LoopbackAuth === null) return;
    try {
      log = (await LoopbackAuth.getLog()).map(toEntry);
    } catch {
      // Keep the last copy; the log is diagnostics only.
    }
  };
  return {
    unavailableReason: () => (LoopbackAuth === null ? 'This build has no loopback sign-in module (install a build made after this change)' : null),
    async startListener(path, preferredPort) {
      if (LoopbackAuth === null) throw new Error('Loopback module missing');
      log = [];
      try {
        return await LoopbackAuth.startListener(path, preferredPort);
      } finally {
        await refreshLog();
      }
    },
    async openAuthSession(url, timeoutMs): Promise<AuthSessionOutcome> {
      if (LoopbackAuth === null) return { kind: 'error', message: 'Loopback module missing' };
      try {
        // Not ephemeral: the sheet can reuse a ChatGPT login already in Safari.
        const r = await LoopbackAuth.openAuthSession(url, timeoutMs, false);
        switch (r.outcome) {
          case 'callback':
            return { kind: 'callback', url: r.url };
          case 'cancelled':
            return { kind: 'cancelled' };
          case 'timeout':
            return { kind: 'timeout' };
          case 'error':
            return { kind: 'error', message: r.message };
        }
      } catch (e) {
        return { kind: 'error', message: errorText(e) };
      } finally {
        await refreshLog();
      }
    },
    async stopListener() {
      if (LoopbackAuth === null) return;
      await LoopbackAuth.stopListener();
      await refreshLog();
    },
    listenerLog: () => log,
    async cancel() {
      await LoopbackAuth?.cancelAuthSession();
    },
  };
}

export function createDevicePorts(loopback: DeviceLoopback): SignInTestPorts {
  return { fetch: deviceFetch, crypto: deviceCrypto, loopback, vault: keychainVault, nowMs, newUuid };
}
