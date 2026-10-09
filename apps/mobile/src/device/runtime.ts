import * as Application from 'expo-application';
import { getCalendars, getLocales } from 'expo-localization';

import type { AppInfo } from '@fizz/persistence';
import type { ZonedTimestamp } from '@fizz/schemas';

import { isoUtc, nowMs } from '../clock';

/** The phone's IANA time zone (falls back to Intl). */
export function deviceTimeZone(): string {
  return getCalendars().at(0)?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Now, as UTC plus the zone it should be read in (CLAUDE.md conventions). */
export function nowZoned(): ZonedTimestamp {
  return { utc: isoUtc(nowMs()), tz: deviceTimeZone() };
}

/** `metric` / `us` / `uk`, for the unit default (onboarding.md §2.2). */
export function measurementSystem(): string | null {
  return getLocales().at(0)?.measurementSystem ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Record IDs (UUID v4). Prefers the native generator expo-modules-core installs
 * on `globalThis.expo` (Foundation's UUID on iOS); Hermes has no
 * `crypto.randomUUID`. If that global is missing (to verify on the device),
 * falls back to Math.random: IDs only need to be unique for one person's
 * records, not unpredictable, so this never blocks opening the app.
 */
export function newUuid(): string {
  const native = (globalThis as { expo?: { uuidv4?: () => string } }).expo?.uuidv4;
  if (typeof native === 'function') {
    const id = native().toLowerCase();
    if (UUID.test(id)) return id;
  }
  return fallbackUuid();
}

function fallbackUuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)] ?? '8';
    else out += hex[Math.floor(Math.random() * 16)] ?? '0';
  }
  return out;
}

export function appInfo(): AppInfo {
  return {
    name: 'GymSmarter',
    version: Application.nativeApplicationVersion ?? '0.0.0',
    build: Application.nativeBuildVersion ?? null,
  };
}
