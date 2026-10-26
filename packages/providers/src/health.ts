/**
 * Apple Health as a provider (Ben, 27 Oct; ADR 0035; apple-health.md §8). HealthKit is a runtime capability
 * (ADR 0004): `healthCapability` says whether this install can use it, and every caller hides Apple Health when it
 * can't. The phone binds `HealthPort` to the app's small Swift module (apps/mobile/modules/health-store); tests bind
 * a fake. Pure mapping: Health's rows become the app's sample shapes (`HealthWorkoutSample`, `HealthWeightSample`
 * in @fizz/schemas, validated again when stored), the app's own writes are dropped, and text from Health is data
 * only (rule 8).
 */

export type HealthType = 'workout' | 'bodyMass' | 'heartRate' | 'distanceWalkingRunning' | 'distanceCycling' | 'distanceSwimming';

export interface HealthNativeCapability {
  status: 'available' | 'unsupported' | 'missing_entitlement' | 'unknown';
  message: string;
}

export interface HealthNativeWorkout {
  uuid: string;
  activityType: number;
  startMs: number;
  endMs: number;
  durationS: number;
  distanceM: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  sourceName: string;
  sourceBundleId: string;
  externalId: string | null;
  timeZone: string | null;
}

export interface HealthNativeBodyMass {
  uuid: string;
  kg: number;
  atMs: number;
  sourceName: string;
  sourceBundleId: string;
}

export interface HealthSaveRequest {
  activityType: number;
  startMs: number;
  endMs: number;
  pauses: { startMs: number; endMs: number }[];
  syncIdentifier: string;
  syncVersion: number;
  externalId: string;
  timeZone: string;
}

/** What the app needs of HealthKit. Every call may reject; callers keep what they had. */
export interface HealthPort {
  /** This app's bundle ID (its own writes are never read back). */
  readonly bundleId: string;
  capability(): Promise<HealthNativeCapability>;
  requestAuthorization(share: HealthType[], read: HealthType[]): Promise<{ ok: boolean; message: string }>;
  workoutShareStatus(): Promise<'notDetermined' | 'denied' | 'authorized'>;
  saveWorkout(input: HealthSaveRequest): Promise<{ uuid: string; adopted: boolean }>;
  deleteWorkout(uuid: string): Promise<number>;
  deleteAllOwnWorkouts(): Promise<number>;
  readWorkouts(sinceMs: number, untilMs: number, heartRate: boolean): Promise<HealthNativeWorkout[]>;
  readBodyMass(sinceMs: number): Promise<HealthNativeBodyMass[]>;
}

/**
 * Whether Apple Health can be used on this install (apple-health.md §4):
 * - `available`: the module is in the build and HealthKit answered;
 * - `not_on_this_install`: the build has no module, or the signing dropped the HealthKit entitlement (SideStore);
 * - `unsupported`: no Health on this device.
 * An unexpected error is `not_on_this_install` too: the feature hides rather than half-works.
 */
export type HealthCapability = 'available' | 'not_on_this_install' | 'unsupported';

export async function healthCapability(port: HealthPort | null, buildIncludesHealth = true): Promise<HealthCapability> {
  if (port === null || !buildIncludesHealth) return 'not_on_this_install';
  const c = await port.capability().catch((): HealthNativeCapability => ({ status: 'unknown', message: '' }));
  if (c.status === 'available') return 'available';
  if (c.status === 'unsupported') return 'unsupported';
  return 'not_on_this_install';
}

/** HealthKit's error when the signing dropped the entitlement. */
export function isMissingEntitlement(message: string): boolean {
  return message.toLowerCase().includes('entitlement');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function cleanText(s: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function iso(ms: number): string {
  // eslint-disable-next-line no-restricted-globals -- pure format of a given instant, not a clock read
  return new Date(ms).toISOString();
}

function isOwn(bundleId: string, ownBundleId: string): boolean {
  return ownBundleId !== '' && (bundleId === ownBundleId || bundleId.startsWith(`${ownBundleId}.`));
}

function validZone(tz: string | null, fallback: string): string {
  if (tz === null || tz === '') return fallback;
  try {
    // eslint-disable-next-line no-restricted-globals -- validating a zone name, not reading the clock
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

const finite = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * Health's workouts as the app's samples: the app's own (its bundle) left out, UUIDs lowercased, numbers checked,
 * heart rate only when in a human range, the local zone from the sample's own metadata if it has one, else Ben's.
 */
export function workoutSamplesFrom(rows: readonly HealthNativeWorkout[], ownBundleId: string, tz: string) {
  const out = [];
  for (const r of rows) {
    const uuid = String(r.uuid).toLowerCase();
    const start = finite(r.startMs);
    const end = finite(r.endMs);
    if (!UUID.test(uuid) || start === null || end === null || end < start || isOwn(r.sourceBundleId, ownBundleId)) continue;
    const hr = (n: number | null) => (n !== null && n >= 15 && n <= 300 ? n : null);
    const distance = finite(r.distanceM);
    out.push({
      uuid,
      activityType: Math.max(0, Math.min(100_000, Math.round(finite(r.activityType) ?? 3000))),
      startUtc: iso(start),
      endUtc: iso(end),
      tz: validZone(r.timeZone, tz),
      durationS: Math.max(0, Math.min(7 * 86_400, finite(r.durationS) ?? (end - start) / 1000)),
      distanceM: distance !== null && distance >= 0 && distance <= 10_000_000 ? distance : null,
      avgHeartRate: hr(finite(r.avgHeartRate)),
      maxHeartRate: hr(finite(r.maxHeartRate)),
      sourceName: cleanText(r.sourceName, 60),
      sourceBundleId: cleanText(r.sourceBundleId, 200),
      externalId: r.externalId === null ? null : cleanText(r.externalId, 200) || null,
    });
  }
  return out;
}

/** Health's bodyweights as the app's samples (kg, 1–700), the app's own left out (it never writes any). */
export function weightSamplesFrom(rows: readonly HealthNativeBodyMass[], ownBundleId: string, tz: string) {
  const out = [];
  for (const r of rows) {
    const uuid = String(r.uuid).toLowerCase();
    const kg = finite(r.kg);
    const at = finite(r.atMs);
    if (!UUID.test(uuid) || kg === null || kg <= 0 || kg > 700 || at === null || isOwn(r.sourceBundleId, ownBundleId)) continue;
    out.push({ uuid, kg: Math.round(kg * 1000) / 1000, atUtc: iso(at), tz, sourceName: cleanText(r.sourceName, 60), sourceBundleId: cleanText(r.sourceBundleId, 200) });
  }
  return out;
}
