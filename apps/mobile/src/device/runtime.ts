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
 * Record IDs (UUID v4). Uses the native generator expo-modules-core installs
 * on `globalThis.expo` (Foundation's UUID on iOS). Hermes has no
 * `crypto.randomUUID`.
 */
export function newUuid(): string {
  const native = (globalThis as { expo?: { uuidv4?: () => string } }).expo?.uuidv4;
  if (typeof native !== 'function') throw new Error('Native UUID generator is not available in this build');
  const id = native().toLowerCase();
  if (!UUID.test(id)) throw new Error(`Native UUID generator returned an unexpected value: ${id}`);
  return id;
}

export function appInfo(): AppInfo {
  return {
    name: 'Fizz',
    version: Application.nativeApplicationVersion ?? '0.0.0',
    build: Application.nativeBuildVersion ?? null,
  };
}
