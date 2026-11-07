import { describe, expect, it } from 'vitest';

import { ActivitySchema, type Activity, type ActivityFields, type HealthWorkoutSample } from '@fizz/schemas';

import { activitiesWithHealth, enduranceSwitch } from '../src';

/**
 * (Ben, 2 Nov) Rules 11–13 follow the endurance switch: on with a hard or long session planned in the next 7 days or
 * logged in the last 7 (Apple Health's runs included); easy sessions and a missed planned run never turn it on.
 * Made-up sessions, never Ben's. Today is Mon 2 Nov 2026 in London.
 */

const OWNER = '00000000-0000-4000-8000-000000000001';
const TZ = 'Europe/London';
const TODAY = '2026-11-02';

let n = 0;
function mine(fields: Partial<ActivityFields>, over: Partial<Activity> = {}): Activity {
  n += 1;
  return ActivitySchema.parse({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: '2026-10-27T10:00:00.000Z',
    updatedAtUtc: '2026-10-27T10:00:00.000Z',
    fields: { kind: 'run', status: 'done', date: TODAY, durationS: null, distanceM: null, effort: null, ...fields },
    tz: TZ,
    source: 'ben',
    deletedAtUtc: null,
    lastChange: null,
    opIds: [`op-${String(n)}`],
    ...over,
  });
}

const garmin = (uuid: string, startUtc: string, minutes: number, distanceM: number): HealthWorkoutSample => ({
  uuid,
  activityType: 37,
  startUtc,
  endUtc: new Date(Date.parse(startUtc) + minutes * 60_000).toISOString(),
  tz: TZ,
  durationS: minutes * 60,
  distanceM,
  avgHeartRate: 150,
  maxHeartRate: 170,
  sourceName: 'Garmin Connect',
  sourceBundleId: 'com.garmin.connect.mobile',
  externalId: null,
});
const withHealth = (own: Activity[], samples: HealthWorkoutSample[]) => activitiesWithHealth({ ownerId: OWNER, samples, links: [], own, ownBundleId: null, writtenUuids: new Set(), appSessionIds: new Set() });

describe('enduranceSwitch (rule G; rules 11–13)', () => {
  it('off with nothing logged or planned', () => {
    expect(enduranceSwitch([], TODAY)).toEqual({ on: false, session: null });
  });

  it('on with a long Garmin run read from Apple Health in the last 7 days (its own numbers: ≥ 15 km)', () => {
    const acts = withHealth([], [garmin('a0000000-0000-4000-8000-000000000001', '2026-10-31T08:00:00.000Z', 100, 18_000)]);
    expect(enduranceSwitch(acts, TODAY)).toEqual({ on: true, session: { kind: 'run', date: '2026-10-31', status: 'done', effort: 'long', from: 'Apple Health (Garmin)' } });
  });

  it('on with a hard run Ben logged, or a planned key-length run in the next 7 days', () => {
    expect(enduranceSwitch([mine({ date: '2026-10-30', effort: 'hard' })], TODAY)).toMatchObject({ on: true, session: { effort: 'hard', status: 'done', from: 'Ben' } });
    expect(enduranceSwitch([mine({ date: '2026-11-07', status: 'planned', effort: 'long' })], TODAY)).toMatchObject({ on: true, session: { date: '2026-11-07', status: 'planned', effort: 'long' } });
    // A planned run today hasn't been missed yet.
    expect(enduranceSwitch([mine({ date: TODAY, status: 'planned', effort: 'hard' })], TODAY).on).toBe(true);
    // Any endurance type with Ben's word: a hard ride, a long swim.
    expect(enduranceSwitch([mine({ kind: 'ride', date: '2026-11-01', effort: 'hard' })], TODAY).on).toBe(true);
    expect(enduranceSwitch([mine({ kind: 'swim', date: '2026-11-04', status: 'planned', effort: 'long' })], TODAY).on).toBe(true);
  });

  it('easy, moderate or no-effort sessions never turn it on; nor does a short Health run', () => {
    const easy = [
      mine({ date: '2026-11-01', effort: 'easy', distanceM: 5000 }),
      mine({ date: '2026-10-31', effort: 'moderate', durationS: 45 * 60 }),
      mine({ kind: 'ride', date: '2026-10-30', durationS: 2 * 3600 }),
      mine({ date: '2026-11-05', status: 'planned', effort: 'easy' }),
    ];
    const health = withHealth([], [garmin('a0000000-0000-4000-8000-000000000002', '2026-11-01T08:00:00.000Z', 30, 5000)]);
    expect(enduranceSwitch([...easy, ...health], TODAY)).toEqual({ on: false, session: null });
  });

  it('a missed planned run (past, nothing linked or matched) does not count; a cancelled one neither', () => {
    expect(enduranceSwitch([mine({ date: '2026-11-01', status: 'planned', effort: 'long' })], TODAY).on).toBe(false);
    expect(enduranceSwitch([mine({ date: '2026-11-04', status: 'planned', effort: 'long' }, { deletedAtUtc: '2026-11-01T10:00:00.000Z' })], TODAY).on).toBe(false);
  });

  it('a past planned run matched by a Health run is done and counts', () => {
    const plan = mine({ date: '2026-10-31', status: 'planned', effort: 'long', distanceM: 18_000 });
    const acts = withHealth([plan], [garmin('a0000000-0000-4000-8000-000000000003', '2026-10-31T08:00:00.000Z', 100, 18_000)]);
    expect(enduranceSwitch(acts, TODAY)).toMatchObject({ on: true, session: { status: 'done', from: 'Apple Health (Garmin)' } });
  });

  it('only the last 7 and next 7 days count', () => {
    expect(enduranceSwitch([mine({ date: '2026-10-25', effort: 'long' })], TODAY).on).toBe(false);
    expect(enduranceSwitch([mine({ date: '2026-10-26', effort: 'long' })], TODAY).on).toBe(true);
    expect(enduranceSwitch([mine({ date: '2026-11-09', status: 'planned', effort: 'long' })], TODAY).on).toBe(true);
    expect(enduranceSwitch([mine({ date: '2026-11-10', status: 'planned', effort: 'long' })], TODAY).on).toBe(false);
  });

  it('names the nearest session; done before planned on a tie', () => {
    const acts = [mine({ date: '2026-10-28', effort: 'hard' }), mine({ date: '2026-11-03', status: 'planned', effort: 'long' }), mine({ date: '2026-11-01', effort: 'long' })];
    expect(enduranceSwitch(acts, TODAY).session).toMatchObject({ date: '2026-11-01', status: 'done' });
  });
});
