import { describe, expect, it } from 'vitest';

import type { Activity } from '@fizz/schemas';
import {
  buildMonthlyRecap,
  buildProgressHomeView,
  buildTrainingPeriodView,
  consistency,
  countSessions,
  healthStrengthSessions,
  muscleFrequency,
  periodBar,
  timeInGym,
  weekBars,
  PROGRESS_DURATION_CAP_MS,
  type MuscleInfo,
  type ProgressSession,
} from '../src/index';

/**
 * (Ben, 3 Nov) A Garmin-only strength workout (Apple Health, no linked or overlapping workout) counts as one session
 * in Progress › Training's counts and time; it adds no sets, muscles, lifts or plan days.
 */

const MIN = 60_000;
const TODAY = '2026-11-03';
let n = 0;

function session(date: string, hhmm = '17:30', opts: { imported?: boolean; minutes?: number } = {}): ProgressSession {
  n += 1;
  const startedMs = Date.parse(`${date}T${hhmm}:00.000Z`);
  const imported = opts.imported === true;
  const minutes = opts.minutes ?? 50;
  return {
    sessionId: `s${String(n)}`,
    version: 1,
    source: imported ? 'import' : 'manual',
    name: 'Push',
    gymId: null,
    startedAtUtc: new Date(startedMs).toISOString(),
    startedMs,
    tz: 'UTC',
    date,
    dateOnly: imported,
    endedAtUtc: imported ? null : new Date(startedMs + minutes * MIN).toISOString(),
    durationMs: imported ? null : minutes * MIN,
    durationConfirmed: false,
    exercises: [
      {
        sessionExerciseId: `r${String(n)}`,
        exerciseId: 'bench',
        exerciseName: 'Bench press',
        equipmentId: null,
        equipmentKind: 'barbell',
        gymId: null,
        convention: 'total',
        unit: 'kg',
        measurement: 'reps',
        laterality: 'bilateral',
        sets: Array.from({ length: 4 }, (_, i) => ({ setId: `x${String(n)}-${String(i)}`, setType: 'working' as const, side: null, load: { value: 60, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: i })),
      },
    ],
  };
}

/** A Health workout as `activitiesWithHealth` lists it (Garmin, type 50 Strength unless given). */
function health(date: string, hhmm: string, minutes: number, opts: { activityType?: number; label?: string; strength?: boolean; uuid?: string } = {}): Activity {
  n += 1;
  const startUtc = new Date(Date.parse(`${date}T${hhmm}:00.000Z`)).toISOString();
  const endUtc = new Date(Date.parse(startUtc) + minutes * MIN).toISOString();
  const uuid = opts.uuid ?? `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const activityType = opts.activityType ?? 50;
  const strength = opts.strength ?? [50, 20, 59, 11].includes(activityType);
  return {
    id: uuid,
    ownerId: 'owner',
    version: 1,
    createdAtUtc: startUtc,
    updatedAtUtc: endUtc,
    fields: { kind: strength ? 'other' : 'run', status: 'done', date, durationS: minutes * 60, distanceM: strength ? null : 5000, effort: null },
    tz: 'UTC',
    source: 'health',
    health: { uuid, activityType, label: opts.label ?? (strength ? 'Strength' : 'Run'), sourceName: 'Garmin', startUtc, endUtc, avgHeartRate: 120, maxHeartRate: 150, strength },
    deletedAtUtc: null,
    lastChange: null,
    opIds: [],
  };
}

const INFO = new Map<string, MuscleInfo>([['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }]]);

describe('healthStrengthSessions', () => {
  it('counts a strength workout with no workout that day; never a run; never one a workout overlaps', () => {
    const app = [session('2026-10-20', '17:00')];
    const alone = health('2026-10-14', '07:00', 50);
    const overlapping = health('2026-10-20', '17:10', 45);
    const sameDayApart = health('2026-10-20', '06:30', 40);
    const runAlone = health('2026-10-15', '07:00', 30, { activityType: 37 });
    const got = healthStrengthSessions({ activities: [overlapping, runAlone, sameDayApart, alone], sessions: app });
    expect(got.map((s) => s.fromHealth.activityId)).toEqual([alone.id, sameDayApart.id]);
    expect(got[0]).toMatchObject({ date: '2026-10-14', name: 'Strength', durationMs: 50 * MIN, dateOnly: false, fromHealth: { sourceName: 'Garmin', activityType: 50 } });
    expect(got[0]?.sessionId).toBe(`health:${alone.id}`);
  });

  it('a date-only import (or a workout with no end) the same day may be it: not counted', () => {
    const imported = session('2026-10-12', '00:00', { imported: true });
    const noEnd: ProgressSession = { ...session('2026-10-13', '17:00'), endedAtUtc: null, durationMs: null };
    const got = healthStrengthSessions({ activities: [health('2026-10-12', '18:00', 50), health('2026-10-13', '06:00', 50)], sessions: [imported, noEnd] });
    expect(got).toEqual([]);
  });

  it('one Ben kept apart (Unlink, Not it) is skipped; core and cross training count; planned or deleted never', () => {
    const kept = health('2026-10-01', '07:00', 40);
    const core = health('2026-10-02', '07:00', 20, { activityType: 59, label: 'Core' });
    const planned = { ...health('2026-10-03', '07:00', 30), fields: { ...health('2026-10-03', '07:00', 30).fields, status: 'planned' as const } };
    const deleted = { ...health('2026-10-04', '07:00', 30), deletedAtUtc: '2026-10-05T00:00:00.000Z' };
    const got = healthStrengthSessions({ activities: [kept, core, planned, deleted], sessions: [], excludedUuids: new Set([kept.id]) });
    expect(got.map((s) => s.name)).toEqual(['Core']);
  });

  it('over the 4 h cap: counted, but no time (never listed for Count it)', () => {
    const long = health('2026-10-05', '06:00', 5 * 60);
    const [s] = healthStrengthSessions({ activities: [long], sessions: [] });
    expect(s?.durationMs).toBeNull();
    const w = { from: '2026-10-01', to: '2026-10-31', days: 31, preset: null, previous: { from: '2026-09-01', to: '2026-09-30' } };
    const t = timeInGym(s === undefined ? [] : [s], w);
    expect(t).toMatchObject({ sessionCount: 1, timedCount: 0, totalMs: 0 });
    expect(t.excluded.noEnd).toEqual([]);
    expect(t.excluded.overCap).toEqual([]);
    expect(PROGRESS_DURATION_CAP_MS).toBe(4 * 60 * MIN);
  });
});

describe('counts and time (Progress › Training)', () => {
  const app = [session('2026-10-06'), session('2026-10-08'), session('2026-10-20', '17:00')];
  const garminOnly = health('2026-10-14', '07:00', 50);
  const overlapping = health('2026-10-20', '17:05', 50);
  const hs = healthStrengthSessions({ activities: [garminOnly, overlapping], sessions: app });

  it('weekBars and countSessions include the unlinked one, not the overlapping one; time from its duration', () => {
    const bar = periodBar({ today: TODAY, span: '3m', offset: 0, earliest: '2026-06-01' });
    const bars = weekBars([...app, ...hs], bar.full, TODAY, null);
    expect(bars.weeks.find((w) => w.monday === '2026-10-12')?.count).toBe(1);
    expect(bars.weeks.find((w) => w.monday === '2026-10-19')?.count).toBe(1);
    const w = { from: '2026-10-01', to: '2026-10-31', days: 31, preset: null, previous: { from: '2026-09-01', to: '2026-09-30' } };
    expect(countSessions([...app, ...hs], w).count).toBe(4);
    const t = timeInGym([...app, ...hs], w);
    expect(t).toMatchObject({ sessionCount: 4, timedCount: 4, totalMs: 4 * 50 * MIN });
  });

  it('Month: Sessions, Time and the month count include it; sets don’t; the tile stays its Health ring', () => {
    const bar = periodBar({ today: TODAY, span: 'month', offset: -1, earliest: '2026-09-01' });
    const input = { sessions: app, exercises: INFO, today: TODAY, bar, plan: null, aim: null, earliest: '2026-09-01', activities: [{ date: garminOnly.fields.date, row: { activityId: garminOnly.id, version: 1, title: 'Strength', when: 'Wed', detail: '50 min · Garmin', planned: false, fromHealth: 'Garmin', accessibilityLabel: 'Strength' } }] };
    const without = buildTrainingPeriodView(input);
    const withHealth = buildTrainingPeriodView({ ...input, healthSessions: hs });
    const total = (v: typeof without, k: string) => v.totals.find((t) => t.key === k)?.value;
    expect(total(without, 'sessions')).toBe('3');
    expect(total(withHealth, 'sessions')).toBe('4');
    expect(total(withHealth, 'time')).toBe(total(buildTrainingPeriodView({ ...input, sessions: [...app, session('2026-10-14', '07:00')] }), 'time'));
    expect(total(withHealth, 'sets')).toBe(total(without, 'sets'));
    expect(withHealth.month?.workouts.count).toBe(4);
    const tile = withHealth.month?.weeks.flat().find((d) => d?.date === '2026-10-14');
    expect(tile).toMatchObject({ state: 'done', marks: [{ kind: 'ring' }], open: { kind: 'activity', activityId: garminOnly.id } });
  });

  it('6M bars and A week include it', () => {
    const bar = periodBar({ today: TODAY, span: '6m', offset: 0, earliest: '2026-06-01' });
    const v = buildTrainingPeriodView({ sessions: app, healthSessions: hs, exercises: INFO, today: TODAY, bar, plan: null, aim: null, earliest: '2026-06-01' });
    expect(v.bars?.weeks.reduce((a, w) => a + w.count, 0)).toBe(4);
    const perWeek = v.totals.find((t) => t.key === 'per_week')?.value;
    const base = buildTrainingPeriodView({ sessions: app, exercises: INFO, today: TODAY, bar, plan: null, aim: null, earliest: '2026-06-01' }).totals.find((t) => t.key === 'per_week')?.value;
    expect(Number(perWeek)).toBeGreaterThan(Number(base));
  });

  it('home: activity counts and `Time from` include it; muscles and records unchanged', () => {
    const bar = periodBar({ today: TODAY, span: 'month', offset: -1, earliest: '2026-09-01' });
    const b = { window: bar.window, title: bar.title, phrase: bar.phrase };
    const imported = session('2026-10-22', '00:00', { imported: true });
    const base = buildProgressHomeView({ sessions: [...app, imported], exercises: INFO, today: TODAY, period: '1m', grouping: 'body_part', bar: b });
    const v = buildProgressHomeView({ sessions: [...app, imported], healthSessions: hs, exercises: INFO, today: TODAY, period: '1m', grouping: 'body_part', bar: b });
    if (v.dataState !== 'normal' || base.dataState !== 'normal') throw new Error('empty');
    expect(v.activity.stats[0]?.value).toBe('5');
    expect(v.activity.footnote).toBe('Time from 4 of 5 sessions');
    expect(v.muscles).toEqual(base.muscles);
    expect(v.records).toEqual(base.records);
    // Muscle sets read only the workouts: the Health one has none to give.
    expect(muscleFrequency(app, INFO, bar.window, 'body_part')).toEqual(muscleFrequency(app, INFO, bar.window, 'body_part'));
  });

  it('the monthly recap (workouts, sets, lifts) is not given them', () => {
    const r = buildMonthlyRecap({ sessions: app, exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null });
    expect(r?.stats[0]?.value).toBe('3');
  });
});

describe('Consistency', () => {
  it('counts a Health session in its week (workouts and days), never as a plan day done', () => {
    const nowMs = Date.parse('2026-11-03T12:00:00.000Z');
    const plan = { days: [{ routineId: 'r-push' }, { routineId: 'r-pull' }], appliedAtUtc: '2026-09-01T00:00:00.000Z' };
    const base = consistency({ workouts: [{ sessionId: 'a', routineId: 'r-push', startedAtUtc: '2026-11-02T17:00:00.000Z' }], nowMs, tz: 'UTC', aim: 3, plan });
    const withHealth = consistency({ workouts: [{ sessionId: 'a', routineId: 'r-push', startedAtUtc: '2026-11-02T17:00:00.000Z' }], healthSessions: [{ startedMs: Date.parse('2026-11-03T07:00:00.000Z') }, { startedMs: Date.parse('2026-10-27T07:00:00.000Z') }], nowMs, tz: 'UTC', aim: 3, plan });
    expect(base.thisWeek).toMatchObject({ workouts: 1, days: 1 });
    expect(withHealth.thisWeek).toMatchObject({ workouts: 2, days: 2, text: '2/3' });
    expect(withHealth.weeks.at(-1)).toMatchObject({ monday: '2026-10-26', workouts: 1 });
    expect(withHealth.planThisWeek).toEqual(base.planThisWeek);
  });
});
