import { describe, expect, it } from 'vitest';

import { healthCapability, isMissingEntitlement, restingHrSamplesFrom, sleepSamplesFrom, weightSamplesFrom, workoutSamplesFrom, type HealthNativeWorkout, type HealthPort } from '../src';

const OWN = 'com.projectfizz.fizz';
const port = (status: Awaited<ReturnType<HealthPort['capability']>>['status'] | 'throws'): HealthPort => ({
  bundleId: OWN,
  capability: () => (status === 'throws' ? Promise.reject(new Error('boom')) : Promise.resolve({ status, message: '' })),
  requestAuthorization: () => Promise.resolve({ ok: true, message: '' }),
  workoutShareStatus: () => Promise.resolve('notDetermined'),
  saveWorkout: () => Promise.resolve({ uuid: '', adopted: false }),
  deleteWorkout: () => Promise.resolve(0),
  deleteAllOwnWorkouts: () => Promise.resolve(0),
  readWorkouts: () => Promise.resolve([]),
  readBodyMass: () => Promise.resolve([]),
  readRestingHeartRate: () => Promise.resolve([]),
  readSleep: () => Promise.resolve([]),
});

describe('healthCapability (a runtime flag, ADR 0004/0035)', () => {
  it('hides itself when the module, the build switch or the entitlement is missing', async () => {
    expect(await healthCapability(null)).toBe('not_on_this_install');
    expect(await healthCapability(port('available'), false)).toBe('not_on_this_install');
    expect(await healthCapability(port('missing_entitlement'))).toBe('not_on_this_install');
    expect(await healthCapability(port('unknown'))).toBe('not_on_this_install');
    expect(await healthCapability(port('throws'))).toBe('not_on_this_install');
    expect(await healthCapability(port('unsupported'))).toBe('unsupported');
    expect(await healthCapability(port('available'))).toBe('available');
  });

  it('knows HealthKit’s missing-entitlement error', () => {
    expect(isMissingEntitlement('Missing com.apple.developer.healthkit entitlement.')).toBe(true);
    expect(isMissingEntitlement('Authorization not determined')).toBe(false);
  });
});

const row = (p: Partial<HealthNativeWorkout> = {}): HealthNativeWorkout => ({
  uuid: 'A0000000-0000-4000-8000-000000000001',
  activityType: 37,
  startMs: Date.UTC(2026, 9, 25, 8),
  endMs: Date.UTC(2026, 9, 25, 9, 40),
  durationS: 6000,
  distanceM: 18000,
  avgHeartRate: 148,
  maxHeartRate: 400,
  sourceName: 'Garmin Connect\n',
  sourceBundleId: 'com.garmin.connect.mobile',
  externalId: null,
  timeZone: null,
  ...p,
});

describe('mapping Health’s rows', () => {
  it('maps a Garmin run; drops our own writes and malformed rows', () => {
    const out = workoutSamplesFrom([row(), row({ uuid: 'B0000000-0000-4000-8000-000000000002', sourceBundleId: OWN }), row({ uuid: 'nope' }), row({ uuid: 'C0000000-0000-4000-8000-000000000003', endMs: 0 })], OWN, 'Europe/London');
    expect(out).toEqual([
      {
        uuid: 'a0000000-0000-4000-8000-000000000001',
        activityType: 37,
        startUtc: '2026-10-25T08:00:00.000Z',
        endUtc: '2026-10-25T09:40:00.000Z',
        tz: 'Europe/London',
        durationS: 6000,
        distanceM: 18000,
        avgHeartRate: 148,
        maxHeartRate: null,
        activeKcal: null,
        sourceName: 'Garmin Connect',
        sourceBundleId: 'com.garmin.connect.mobile',
        externalId: null,
      },
    ]);
  });

  it('uses the sample’s own zone when it has a valid one', () => {
    expect(workoutSamplesFrom([row({ timeZone: 'America/New_York' })], OWN, 'Europe/London')[0]?.tz).toBe('America/New_York');
    expect(workoutSamplesFrom([row({ timeZone: 'Not/AZone' })], OWN, 'Europe/London')[0]?.tz).toBe('Europe/London');
  });

  it('maps bodyweights in kg and drops impossible ones', () => {
    const out = weightSamplesFrom(
      [
        { uuid: 'D0000000-0000-4000-8000-000000000004', kg: 81.6234, atMs: Date.UTC(2026, 9, 26, 6), sourceName: 'Withings', sourceBundleId: 'com.withings' },
        { uuid: 'E0000000-0000-4000-8000-000000000005', kg: 0, atMs: Date.UTC(2026, 9, 26, 6), sourceName: 'x', sourceBundleId: 'x' },
      ],
      OWN,
      'Europe/London',
    );
    expect(out).toEqual([{ uuid: 'd0000000-0000-4000-8000-000000000004', kg: 81.623, atUtc: '2026-10-26T06:00:00.000Z', tz: 'Europe/London', sourceName: 'Withings', sourceBundleId: 'com.withings' }]);
  });
});

describe('resting heart rate and sleep (Q8)', () => {
  it('maps raw values and stages; drops bad ones', () => {
    expect(restingHrSamplesFrom([{ uuid: 'F0000000-0000-4000-8000-000000000006', bpm: 52, atMs: Date.UTC(2026, 9, 26, 6), sourceName: 'Garmin Connect', sourceBundleId: 'g' }, { uuid: 'F0000000-0000-4000-8000-000000000007', bpm: 5, atMs: 0, sourceName: 'x', sourceBundleId: 'x' }], OWN, 'Europe/London')).toHaveLength(1);
    const sleep = sleepSamplesFrom(
      [
        { uuid: 'F0000000-0000-4000-8000-000000000008', value: 4, startMs: Date.UTC(2026, 9, 26, 1), endMs: Date.UTC(2026, 9, 26, 2), sourceName: 'Apple Watch', sourceBundleId: 'w' },
        { uuid: 'F0000000-0000-4000-8000-000000000009', value: 9, startMs: Date.UTC(2026, 9, 26, 1), endMs: Date.UTC(2026, 9, 26, 2), sourceName: 'Apple Watch', sourceBundleId: 'w' },
      ],
      OWN,
      'Europe/London',
    );
    expect(sleep.map((x) => x.stage)).toEqual(['deep']);
  });
});
