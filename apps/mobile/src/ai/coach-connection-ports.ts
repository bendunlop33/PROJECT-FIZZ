/**
 * Device wiring for the product Coach connection (ADR 0020 C5). The same
 * Keychain items, fetch, crypto and loopback module as the S1 test that
 * passed on Ben's iPhone, so a sign-in from either screen is the same
 * connection. Model choice and pauses live in a small non-secret file in the
 * app's container: never in SQLite or a GymSmarter backup, never a credential.
 */

import type { ConnectionPorts, SettingsStore } from '@fizz/providers';

import type { CredentialPort } from '../backup/data-domain-service';
import { containerTextFile } from '../device/files';
import { COACH_SETTINGS_FILE } from '../device/personal-files';
import { createDeviceLoopback, createDevicePorts, type DeviceLoopback } from './chatgpt-test-ports';
import { createCredentialPort } from './credential-port';
import { wipeKeychain } from './keychain';

export const SETTINGS_FILE = COACH_SETTINGS_FILE;

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
 * `Delete my data` (data-import-export §4.5 step 1): the sign-in is removed
 * from this phone first; the online revoke runs after (offline is fine).
 */
export function deviceCredentials(): CredentialPort {
  // The ports (and the loopback module) are made only when Delete runs.
  return {
    signOut: () => createCredentialPort(coachConnectionPorts().ports, wipeKeychain).signOut(),
    wipe: wipeKeychain,
  };
}
