import { describe, expect, it } from 'vitest';

import { ReviewFactSchema, TrainingReviewSchema, type Activity, type BuilderMuscleInfo, type ReviewFact } from '@fizz/schemas';
import {
  buildMonthlyRecap,
  buildTrainingPeriodView,
  healthStrengthSessions,
  periodBar,
  thisWeekView,
  toMs,
  weekDataOfReview,
  weeklyFacts,
  weeklyReviewFacts,
  type MuscleInfo,
  type ProgressSession,
  type ReviewHealthSession,
  type ReviewPlan,
  type ReviewSession,
  type WeeklyReviewInput,
} from '../src/index';

/**
 * (Ben, 8 Nov) The monthly recap's Workouts and the weekly review's `week_sessions` count a Garmin-only strength
 * workout (Apple Health, no linked or overlapping workout) as Progress › Training does. Counts only: no sets, loads,
 * muscles or lifts from it, never a plan day. Stored reviews keep the facts they were made with.
 */

const MIN = 60_000;
let n = 0;

function progressSession(date: string, hhmm = '17:30', minutes = 50): ProgressSession {
  n += 1;
  const startedMs = Date.parse(`${date}T${hhmm}:00.000Z`);
  return {
    sessionId: `s${String(n)}`,
    version: 1,
    source: 'manual',
    name: 'Push',
    gymId: null,
    startedAtUtc: new Date(startedMs).toISOString(),
    startedMs,
    tz: 'UTC',
    date,
    dateOnly: false,
    endedAtUtc: new Date(startedMs + minutes * MIN).toISOString(),
    durationMs: minutes * MIN,
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
        sets: Array.from({ length: 3 }, (_, i) => ({ setId: `x${String(n)}-${String(i)}`, setType: 'working' as const, side: null, load: { value: 60, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: i })),
      },
    ],
  };
}

function healthStrength(date: string, hhmm: string, minutes: number): Activity {
  n += 1;
  const startUtc = new Date(Date.parse(`${date}T${hhmm}:00.000Z`)).toISOString();
  const endUtc = new Date(Date.parse(startUtc) + minutes * MIN).toISOString();
  const uuid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id: uuid,
    ownerId: 'owner',
    version: 1,
    createdAtUtc: startUtc,
    updatedAtUtc: endUtc,
    fields: { kind: 'other', status: 'done', date, durationS: minutes * 60, distanceM: null, effort: null },
    tz: 'UTC',
    source: 'health',
    health: { uuid, activityType: 50, label: 'Strength', sourceName: 'Garmin', startUtc, endUtc, avgHeartRate: 120, maxHeartRate: 150, strength: true },
    deletedAtUtc: null,
    lastChange: null,
    opIds: [],
  };
}

const INFO = new Map<string, MuscleInfo>([['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }]]);

describe('monthly recap: Garmin-only strength sessions (Ben, 8 Nov)', () => {
  const app = [progressSession('2026-09-15'), progressSession('2026-10-06'), progressSession('2026-10-20', '17:00')];
  const garminOnly = healthStrength('2026-10-14', '07:00', 50);
  const overlapping = healthStrength('2026-10-20', '17:05', 50);
  const hs = healthStrengthSessions({ activities: [garminOnly, overlapping], sessions: app });

  it('Workouts and Time count the unlinked one, never the overlapping one twice, as Training does', () => {
    expect(hs.map((h) => h.fromHealth.activityId)).toEqual([garminOnly.id]);
    const base = buildMonthlyRecap({ sessions: app, exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null });
    const r = buildMonthlyRecap({ sessions: app, exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null, healthSessions: hs });
    expect(base?.stats[0]).toMatchObject({ label: 'Workouts', value: '2', previous: '1' });
    expect(r?.stats[0]).toMatchObject({ label: 'Workouts', value: '3', previous: '1' });
    expect(r?.stats[1]?.value).toBe(buildMonthlyRecap({ sessions: [...app, progressSession('2026-10-14', '07:00')], exercises: INFO, today: '2026-11-02', lifts: [], unit: 'kg', planWeeks: null })?.stats[1]?.value);
    expect(r?.line.startsWith('3')).toBe(true);
    // The same count as Progress › Training's Sessions for October.
    const bar = periodBar({ today: '2026-11-02', span: 'month', offset: -1, earliest: '2026-09-01' });
    const training = buildTrainingPeriodView({ sessions: app, healthSessions: hs, exercises: INFO, today: '2026-11-02', bar, plan: null, aim: null, earliest: '2026-09-01' });
    expect(training.totals.find((t) => t.key === 'sessions')?.value).toBe(r?.stats[0]?.value);
  });

  it('muscles, records and lifts are unchanged by it', () => {
    const base = buildMonthlyRecap({ sessions: app, exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null });
    const r = buildMonthlyRecap({ sessions: app, exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null, healthSessions: hs });
    expect(r?.muscles).toEqual(base?.muscles);
    expect(r?.records).toEqual(base?.records);
    expect(r?.lifts).toEqual(base?.lifts);
  });

  it('a month with only a Garmin strength session has a recap of one workout, with no muscles or lifts', () => {
    const only = healthStrengthSessions({ activities: [healthStrength('2026-10-14', '07:00', 50)], sessions: [] });
    expect(buildMonthlyRecap({ sessions: [], exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null })).toBeNull();
    const r = buildMonthlyRecap({ sessions: [], exercises: INFO, today: '2026-11-02', lifts: ['bench'], unit: 'kg', planWeeks: null, healthSessions: only });
    expect(r?.stats[0]?.value).toBe('1');
    expect(r?.muscles).toEqual([]);
    expect(r?.lifts).toEqual([]);
  });
});

// ---- the weekly review

const TZ = 'Europe/London';
const MONDAY = '2026-10-12';
const NOW = toMs('2026-10-19T09:00:00.000Z');
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
const BENCH = id(1);
const INFO_REVIEW: Record<string, BuilderMuscleInfo> = { [BENCH]: { primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] } };
const PUSH_DAY = id(50);
const PULL_DAY = id(51);

function sess(date: string, more: Partial<ReviewSession> = {}): ReviewSession {
  n += 1;
  const startedAtUtc = `${date}T17:00:00.000Z`;
  return {
    sessionId: id(200 + n),
    name: 'Push',
    date,
    startedMs: toMs(startedAtUtc),
    startedAtUtc,
    routineId: null,
    template: null,
    feel: null,
    plannedReps: null,
    doneReps: 0,
    exercises: [{ exerciseId: BENCH, name: 'Bench press', equipmentKind: null, sets: [{ setType: 'working', load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, rpe: null, targetRpe: null, counts: true }], plannedWorking: 1 }],
    ...more,
  };
}
const garmin = (date: string): ReviewHealthSession => ({ date, startedMs: toMs(`${date}T06:30:00.000Z`), name: 'Strength' });

function input(more: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput {
  return { monday: MONDAY, nowMs: NOW, tz: TZ, sessions: [], plans: [], aim: null, goal: null, info: (x) => INFO_REVIEW[x] ?? null, lifts: [BENCH], liftTargets: [], activities: [], templates: [], painFlagged: new Set(), unit: 'kg', ...more };
}

const plan: ReviewPlan = {
  planId: id(60),
  appliedAtUtc: '2026-09-01T08:00:00.000Z',
  untilUtc: null,
  days: [
    { routineId: PUSH_DAY, name: 'Push', bodyParts: ['Chest', 'Triceps'] },
    { routineId: PULL_DAY, name: 'Pull', bodyParts: ['Back', 'Biceps'] },
  ],
  pausedDates: new Set(),
};

describe('weekly review: Garmin-only strength sessions (Ben, 8 Nov)', () => {
  const sessions = [sess('2026-10-13'), sess('2026-10-06')];

  it('with an aim: counted as a workout and a day trained; the stored `week_sessions` fact carries it', () => {
    const base = weeklyFacts(input({ sessions, aim: 3 }));
    const f = weeklyFacts(input({ sessions, aim: 3, healthSessions: [garmin('2026-10-15'), garmin('2026-10-07')] }));
    expect(base.week).toMatchObject({ done: 1, planned: 3, workouts: 1 });
    expect(f.week).toMatchObject({ done: 2, planned: 3, workouts: 2 });
    expect(f.weeks.find((w) => w.monday === '2026-10-05')).toMatchObject({ done: 2, workouts: 2 });
    expect(f.days.map((d) => [d.name, d.date])).toEqual([
      ['Push', '2026-10-13'],
      ['Strength', '2026-10-15'],
    ]);
    const facts = weeklyReviewFacts(f);
    for (const x of facts) expect(ReviewFactSchema.safeParse(x).success).toBe(true);
    expect(facts.find((x) => x.kind === 'week_sessions' && x.weekMonday === MONDAY)).toMatchObject({ done: 2, planned: 3, workouts: 2 });
  });

  it('the same day as a workout: one day trained, two workouts (as Consistency counts it)', () => {
    const f = weeklyFacts(input({ sessions, aim: 3, healthSessions: [garmin('2026-10-13')] }));
    expect(f.week).toMatchObject({ done: 1, workouts: 2 });
  });

  it('no plan, no aim: counted as a workout', () => {
    const f = weeklyFacts(input({ sessions, healthSessions: [garmin('2026-10-15')] }));
    expect(f.week).toMatchObject({ done: 2, planned: null, workouts: 2 });
  });

  it('with a plan: a workout, never a plan day done; nothing named missed is ticked by it', () => {
    const planned = [sess('2026-10-13', { routineId: PUSH_DAY })];
    const base = weeklyFacts(input({ sessions: planned, plans: [plan] }));
    const f = weeklyFacts(input({ sessions: planned, plans: [plan], healthSessions: [garmin('2026-10-15')] }));
    expect(f.week).toMatchObject({ done: base.week.done, planned: base.week.planned, workouts: base.week.workouts + 1 });
    expect(f.days).toEqual(base.days);
    expect(f.missed).toEqual(base.missed);
  });

  it('none after now, none outside the week', () => {
    const f = weeklyFacts(input({ sessions, aim: 3, healthSessions: [garmin('2026-10-20'), garmin('2026-10-11')] }));
    expect(f.week).toMatchObject({ done: 1, workouts: 1 });
  });

  it('lifts, sets per muscle, RPE and stalls are unchanged by it', () => {
    const base = weeklyFacts(input({ sessions, aim: 3 }));
    const f = weeklyFacts(input({ sessions, aim: 3, healthSessions: [garmin('2026-10-15')] }));
    expect(f.lifts).toEqual(base.lifts);
    expect(f.groups).toEqual(base.groups);
    expect(f.rpe).toEqual(base.rpe);
    expect(f.stalled).toEqual(base.stalled);
  });

  it('This week (Progress v3): a done chip for it, nothing to open', () => {
    const v = thisWeekView(input({ sessions, aim: 3, healthSessions: [garmin('2026-10-15')] }), { today: '2026-10-18' });
    expect(v.sessions).toBe('2 of 3');
    expect(v.chips.filter((c) => c.state === 'done').map((c) => [c.name, c.sessionId])).toEqual([
      ['Push', sessions[0]?.sessionId],
      ['Strength', null],
    ]);
  });

  it('a review stored before 8 Nov still loads, with the counts it was made with (no rewrite)', () => {
    const old: ReviewFact[] = [
      { kind: 'sessions_vs_plan', done: 1, planned: 3 },
      { kind: 'week_sessions', weekMonday: MONDAY, done: 1, planned: 3, workouts: 1, runs: 0 },
      { kind: 'week_day', name: 'Push', done: true, localDate: '2026-10-13' },
    ];
    const review = TrainingReviewSchema.parse({
      id: id(99),
      ownerId: id(80),
      version: 1,
      createdAtUtc: '2026-10-19T09:00:00.000Z',
      updatedAtUtc: '2026-10-19T09:00:00.000Z',
      subject: { kind: 'weekly', weekMonday: MONDAY },
      inputsHash: 'h',
      facts: old,
      coach: { status: 'offline' },
      status: 'current',
      supersededById: null,
      opIds: ['o'],
      createdAt: { utc: '2026-10-19T09:00:00.000Z', tz: TZ },
      proposals: [],
    });
    const d = weekDataOfReview(review, () => 'Exercise');
    expect(d?.weeks).toEqual([{ monday: MONDAY, done: 1, planned: 3, workouts: 1, runs: 0 }]);
  });
});
