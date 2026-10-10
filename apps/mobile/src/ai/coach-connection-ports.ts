/**
 * Device wiring for the product Coach connection (ADR 0020 C5). The same
 * Keychain items, fetch, crypto and loopback module as the S1 test that
 * passed on Ben's iPhone, so a sign-in from either screen is the same
 * connection. Model choice and pauses live in a small non-secret file in the
 * app's container: never in SQLite or a GymSmarter backup, never a credential.
 */

import type { ConnectionPorts, SettingsStore } from '@fizz/providers';

import { containerTextFile } from '../device/files';
import { createDeviceLoopback, createDevicePorts, type DeviceLoopback } from './chatgpt-test-ports';

const SETTINGS_FILE = 'coach-connection.json';

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
