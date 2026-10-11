/**
 * Device wiring for the product Coach connection (ADR 0020 C5). The same
 * Keychain items, fetch, crypto and loopback module as the S1 test that
 * passed on Ben's iPhone, so a sign-in from either screen is the same
 * connection. Model choice and pauses live in a small non-secret file in the
 * app's container: never in SQLite or a GymSmarter backup, never a credential.
 */

import { disconnectChatGpt, type ConnectionPorts, type SettingsStore } from '@fizz/providers';

import type { CredentialPort } from '../backup/data-domain-service';
import { containerTextFile } from '../device/files';
import { createDeviceLoopback, createDevicePorts, wipeKeychain, type DeviceLoopback } from './chatgpt-test-ports';

export const SETTINGS_FILE = 'coach-connection.json';

let shared: { ports: ConnectionPorts; loopback: DeviceLoopback } | null = null;

/** One set of ports per app run (one loopback listener at a time). */
export function coachConnectionPorts(): { ports: ConnectionPorts; loopback: DeviceLoopback } {
  if (shared !== null) return shared;
  const loopback = createDeviceLoopback();
  const file = containerTextFile(SETTINGS_FILE);
  const settings: SettingsStore = { load: () => file.read(), save: (s) => file.write(s) };
  shared = { ports: { ...createDevicePorts(loopback), settings }, loopback };
  return shared;
}

/**
 * `Delete my data` (data-import-export §4.5 step 1): sign out of ChatGPT
 * (revoke online where possible; offline is fine), then delete every
 * Keychain item, including the registration (it holds the account email).
 */
export function deviceCredentials(): CredentialPort {
  return {
    async signOut() {
      const { ports } = coachConnectionPorts();
      if ((await ports.vault.loadTokens()) === null) return { revoked: false, hadSession: false };
      const r = await disconnectChatGpt(ports);
      return { revoked: r.revoked, hadSession: true };
    },
    wipe: wipeKeychain,
  };
}
