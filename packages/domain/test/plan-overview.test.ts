import { describe, expect, it } from 'vitest';

import type { Load, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';

import { catalogueExerciseId, goalLine, planDayDetail, planDaysDoneThisWeek, planOverview, plannedSetsThisWeek, toMs, type PlanOverviewInput } from '../src/index';
import { id, kg, TZ } from './fixtures';

/**
 * Library › Workouts › Your plan (Ben, 19 Oct): the block's day states
 * (done this week, next per Up next, to do), weeks Monday–Sunday in Ben's
 * time zone from Apply on, the goal line (none set: `Set goal`), an ended
 * or superseded plan (no block), and a plan day's lines: what Start plans
 * (kg/lb, per-hand dumbbells, assisted, cardio) and last time's sets.
 */

const plain = (s: string | null | undefined): string | null => (s == null ? null : s.replaceAll(' ', ' '));

// Thursday 8 Oct 2026, 19:00 in Auckland; this week starts Mon 5 Oct 00:00 Auckland = 4 Oct 11:00 UTC.
const NOW = toMs('2026-10-08T06:00:00.000Z');
const PUSH = id(100);
const PULL = id(101);
const LEGS = id(102);
const UPPER = id(103);
const DAYS = [
  { routineId: PUSH, name: 'Push' },
  { routineId: PULL, name: 'Pull' },
  { routineId: LEGS, name: 'Legs' },
  { routineId: UPPER, name: 'Upper' },
];
const w = (n: number, utc: string, routineId: string | null) => ({ sessionId: id(n), routineId, startedAtUtc: utc, tz: TZ });

function input(over: Partial<PlanOverviewInput> = {}): PlanOverviewInput {
  return {
    plan: { id: id(900), name: '4-day plan', status: 'applied', version: 3, appliedAtUtc: '2026-09-28T01:00:00.000Z' },
    days: DAYS,
    workouts: [
      // This week: Push Tue, Legs Thu.
      w(1, '2026-10-05T20:00:00.000Z', PUSH),
      w(2, '2026-10-07T20:00:00.000Z', LEGS),
      // Last week: Pull.
      w(3, '2026-09-30T06:00:00.000Z', PULL),
    ],
    nextRoutineId: PULL,
    training: { goal: 'strength', daysPerWeek: 4, sessionMinutes: 60 },
    sets: { planned: 25, done: 23 },
    nowMs: NOW,
    tz: TZ,
    ...over,
  };
}

describe('planOverview: the Your plan block', () => {
  it('days in plan order: ✓ done this week (weekday), the next day per Up next (numbered), to do; stats this week', () => {
    const v = planOverview(input());
    expect(v).not.toBeNull();
    expect(plain(v?.since)).toBe('Since 28 Sep');
    expect(v?.name).toBe('4-day plan');
    expect(v?.planVersion).toBe(3);
    expect(v?.goal).toEqual({ text: 'Goal: Strength · 4 days a week · 60 min', action: 'Edit' });
    expect(v?.days.map((d) => [d.n, d.name, d.state, d.next, plain(d.when)])).toEqual([
      [1, 'Push', 'done', false, 'Tue'],
      [2, 'Pull', 'next', true, 'Last 30 Sep'],
      [3, 'Legs', 'done', false, 'Thu'],
      [4, 'Upper', 'todo', false, null],
    ]);
    expect(v?.daysThisWeek).toEqual({ done: 2, of: 4, text: '2 of 4' });
    expect(v?.setsDone).toEqual({ pct: 92, text: '92%' });
    expect(plain(v?.days[1]?.accessibilityLabel)).toBe('Pull, day 2 of 4, next, last done 30 Sep');
    // Nothing is ever called missed (D19).
    expect(JSON.stringify(v)).not.toMatch(/miss/i);
  });

  it('weeks are Monday–Sunday in Ben’s time zone: Sunday 23:30 is last week, Monday 00:30 this week', () => {
    const v = planOverview(
      input({
        workouts: [w(1, '2026-10-04T10:30:00.000Z', PUSH), w(2, '2026-10-04T11:30:00.000Z', PULL)],
        nextRoutineId: LEGS,
      }),
    );
    expect(v?.days.map((d) => [d.state, plain(d.when)])).toEqual([
      ['todo', 'Last 4 Oct'],
      ['done', 'Mon'],
      ['next', null],
      ['todo', null],
    ]);
    expect(v?.daysThisWeek.text).toBe('1 of 4');
  });

  it('applied mid-week: a day done before Apply isn’t done this week; the next day done this week keeps ✓ with the Next tag', () => {
    const before = planOverview(input({ plan: { id: id(900), name: '4-day plan', status: 'applied', version: 2, appliedAtUtc: '2026-10-06T00:00:00.000Z' } }));
    expect(before?.days.map((d) => d.state)).toEqual(['todo', 'next', 'done', 'todo']);
    expect(plain(before?.days[0]?.when)).toBe('Last 6 Oct');
    const wrap = planOverview(input({ nextRoutineId: PUSH }));
    expect(wrap?.days[0]).toMatchObject({ state: 'done', next: true });
    expect(wrap?.days[1]).toMatchObject({ state: 'todo', next: false });
    // An Up next that isn't a plan day marks none.
    expect(planOverview(input({ nextRoutineId: id(555) }))?.days.some((d) => d.next)).toBe(false);
  });

  it('an ended, superseded, open or missing plan has no block; nor does a plan with no live days', () => {
    for (const status of ['ended', 'superseded', 'open', 'expired'] as const) {
      expect(planOverview(input({ plan: { id: id(900), name: '4-day plan', status, version: 4, appliedAtUtc: '2026-09-28T01:00:00.000Z' } }))).toBeNull();
    }
    expect(planOverview(input({ plan: null }))).toBeNull();
    expect(planOverview(input({ days: [] }))).toBeNull();
  });

  it('no planned sets this week: no % tile; done never shows above 100%', () => {
    expect(planOverview(input({ sets: { planned: 0, done: 0 } }))?.setsDone).toBeNull();
    expect(planOverview(input({ sets: { planned: 9, done: 12 } }))?.setsDone?.text).toBe('100%');
  });

  it('the goal line: the parts set; with no goal, `Set goal`; nothing saved, just `Set goal`', () => {
    expect(goalLine({ goal: 'muscle', sessionMinutes: 45 })).toEqual({ text: 'Goal: Muscle · 45 min', action: 'Edit' });
    expect(goalLine({ goal: 'both', daysPerWeek: 1, sessionMinutes: 30 })).toEqual({ text: 'Goal: Both · 1 day a week · 30 min', action: 'Edit' });
    expect(goalLine({ daysPerWeek: 3, sessionMinutes: 60 })).toEqual({ text: '3 days a week · 60 min', action: 'Set goal' });
    expect(goalLine(null)).toEqual({ text: null, action: 'Set goal' });
    expect(planOverview(input({ training: null }))?.goal).toEqual({ text: null, action: 'Set goal' });
  });

  it('planDaysDoneThisWeek: newest per day, a day done twice counts once; a workout saved as a day counts for it; the future doesn’t', () => {
    const days = [{ routineId: PUSH }, { routineId: PULL, createdFromSessionId: id(7) }];
    const done = planDaysDoneThisWeek({
      days,
      appliedAtUtc: '2026-09-01T00:00:00.000Z',
      workouts: [w(1, '2026-10-05T20:00:00.000Z', PUSH), w(2, '2026-10-06T20:00:00.000Z', PUSH), w(7, '2026-10-06T21:00:00.000Z', null), w(3, '2026-10-09T20:00:00.000Z', PULL)],
      nowMs: NOW,
      tz: TZ,
    });
    expect([...done.entries()]).toEqual([
      [PUSH, '2026-10-06T20:00:00.000Z'],
      [PULL, '2026-10-06T21:00:00.000Z'],
    ]);
  });
});

// ---------------------------------------------------------------------------

function ex(n: number, name: string, over: Partial<SessionExercise> = {}): SessionExercise {
  return { id: id(n), sessionId: id(1), exerciseId: id(n + 1000), exerciseName: name, measurement: 'reps', laterality: 'bilateral', equipmentId: null, loadConvention: 'total', unit: 'kg', order: n, supersetGroup: null, transitionRestS: null, progressionRuleId: null, ...over };
}

let seq = 6000;
function set(e: SessionExercise, index: number, planned: { load?: Load | null; reps?: [number, number] | null; durationS?: number | null; distanceM?: number | null; estimate?: boolean }, actual: { load?: Load | null; reps?: number | null; durationS?: number | null; distanceM?: number | null } | null, over: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: id((seq += 1)),
    sessionId: id(1),
    sessionExerciseId: e.id,
    index,
    setType: 'working',
    status: actual === null ? 'pending' : 'completed',
    side: null,
    pairedWithSetId: null,
    planned: {
      load: planned.load ?? null,
      reps: planned.reps === undefined ? { min: 8, max: 8 } : planned.reps === null ? null : { min: planned.reps[0], max: planned.reps[1] },
      durationS: planned.durationS ?? null,
      ...(planned.distanceM === undefined ? {} : { distanceM: planned.distanceM }),
      rpe: null,
      rir: null,
      ...(planned.estimate === true ? { source: 'coach' as const, provenance: { source: 'coach' as const, setAt: { utc: '2026-10-01T00:00:00.000Z', tz: TZ }, routineName: null, requestedLoad: null, basis: null, estimate: true as const, guardNotes: [] } } : {}),
    },
    rest: { seconds: 90, source: 'global_default', sourceLabel: 'Default' },
    actual: actual === null ? null : { load: actual.load ?? null, reps: actual.reps ?? null, durationS: actual.durationS ?? null, rpe: null, rir: null, ...(actual.distanceM === undefined ? {} : { distanceM: actual.distanceM }) },
    draft: null,
    completedAt: actual === null ? null : { utc: '2026-10-08T06:00:00.000Z', tz: TZ },
    completedByOpId: null,
    undoCount: 0,
    flags: [],
    edited: false,
    version: 1,
    ...over,
  };
}

type Agg = Pick<SessionAggregate, 'session' | 'exercises' | 'sets'>;
const session = (n: number, utc: string, routineId: string | null = null): SessionAggregate['session'] => ({ id: id(n), startedAt: { utc, tz: TZ }, routineId, equipmentSnapshot: [] }) as unknown as SessionAggregate['session'];

describe('plannedSetsThisWeek: logged planned sets of planned sets in the plan’s workouts this week', () => {
  it('only plan days since Monday and Apply; a set Ben added doesn’t change it (review S1)', () => {
    const bench = ex(10, 'Bench press');
    const mk = (n: number, utc: string, routineId: string | null, reps: (number | null)[]): Agg => ({
      session: session(n, utc, routineId),
      exercises: [bench],
      sets: reps.map((r, i) => set(bench, i, { load: kg(100), reps: [6, 8] }, r === null ? null : { load: kg(100), reps: r }, r === null ? { status: 'skipped' } : {})),
    });
    const added = mk(4, '2026-10-07T20:00:00.000Z', LEGS, [8, 8, 8, 8]);
    const lastSet = added.sets[3] as WorkoutSet;
    added.sets[3] = { ...lastSet, planned: { ...lastSet.planned, addedInWorkout: true } };
    const sessions = [
      mk(1, '2026-10-05T20:00:00.000Z', PUSH, [8, 8, null]),
      // Last week, and a workout that isn't a plan day: not counted.
      mk(2, '2026-09-30T20:00:00.000Z', PULL, [8, 8, 8]),
      mk(3, '2026-10-06T20:00:00.000Z', id(555), [8, 8, 8]),
      added,
    ];
    expect(plannedSetsThisWeek({ sessions, days: DAYS, appliedAtUtc: '2026-09-01T00:00:00.000Z', nowMs: NOW, tz: TZ })).toEqual({ planned: 6, done: 5 });
    expect(plannedSetsThisWeek({ sessions, days: DAYS, appliedAtUtc: '2026-10-07T00:00:00.000Z', nowMs: NOW, tz: TZ })).toEqual({ planned: 3, done: 3 });
    expect(plannedSetsThisWeek({ sessions: [], days: DAYS, appliedAtUtc: '2026-09-01T00:00:00.000Z', nowMs: NOW, tz: TZ })).toEqual({ planned: 0, done: 0 });
  });
});

describe('planDayDetail: a plan day’s lines', () => {
  const row = ex(10, 'Barbell row');
  const db = ex(20, 'Chest-supported row', { loadConvention: 'per_hand' });
  const assist = ex(30, 'Assisted pull-up', { loadConvention: 'assistance' });
  const fly = ex(40, 'Rear-delt fly', { loadConvention: 'per_hand' });
  const rower = ex(50, 'Rowing machine', { measurement: 'cardio', loadConvention: 'bodyweight', exerciseId: catalogueExerciseId('rowing-erg') });
  const curl = ex(60, 'EZ-bar curl');
  const planned: Agg = {
    session: session(500, '2026-10-08T06:00:00.000Z'),
    exercises: [row, db, assist, fly, rower, curl],
    sets: [
      set(row, 0, { load: kg(40), reps: [5, 5] }, null, { setType: 'warmup' }),
      ...[0, 1, 2].map((i) => set(row, i + 1, { load: kg(85), reps: [6, 8] }, null)),
      ...[0, 1, 2].map((i) => set(db, i, { load: kg(22.5, 'per_hand'), reps: [10, 12] }, null)),
      ...[0, 1].map((i) => set(assist, i, { load: kg(30, 'assistance'), reps: [8, 8] }, null)),
      ...[0, 1].map((i) => set(fly, i, { load: kg(7.5, 'per_hand'), reps: [12, 15], estimate: true }, null)),
      set(rower, 0, { reps: null, durationS: 600 }, null),
      set(curl, 0, { load: kg(30), reps: [8, 10] }, null),
      set(curl, 1, { load: kg(30), reps: [8, 10] }, null, { skippedBy: 'before_start', status: 'skipped' }),
    ],
  };
  const past = (n: number, utc: string, e: SessionExercise, sets: (sx: SessionExercise) => WorkoutSet[]): Agg => {
    const sx = { ...e, id: id(n + 50) };
    return { session: session(n, utc), exercises: [sx], sets: sets(sx) };
  };
  const histories = new Map<string, Agg[]>([
    [
      row.exerciseId,
      [
        past(301, '2026-10-01T06:00:00.000Z', row, (sx) => [set(sx, 0, { load: kg(80), reps: [6, 8] }, { load: kg(80), reps: 7 })]),
        past(302, '2026-10-07T06:00:00.000Z', row, (sx) => [set(sx, 0, { load: kg(80), reps: [10, 12] }, { load: kg(80), reps: 12 }), set(sx, 1, { load: kg(80), reps: [10, 12] }, { load: kg(80), reps: 12 }), set(sx, 2, { load: kg(80) }, { load: kg(75), reps: 10 })]),
      ],
    ],
    [db.exerciseId, [past(303, '2026-10-02T06:00:00.000Z', db, (sx) => [12, 12, 11].map((r, i) => set(sx, i, { reps: null }, { load: kg(20, 'per_hand'), reps: r })))]],
    [assist.exerciseId, [past(304, '2026-10-02T06:00:00.000Z', assist, (sx) => [8, 8].map((r, i) => set(sx, i, { reps: null }, { load: kg(35, 'assistance'), reps: r })))]],
    [rower.exerciseId, [past(305, '2026-10-02T06:00:00.000Z', rower, (sx) => [set(sx, 0, { reps: null, durationS: 600 }, { durationS: 600, distanceM: 2450 })])]],
    [curl.exerciseId, [past(306, '2026-10-02T06:00:00.000Z', curl, (sx) => [8, 8].map((r, i) => set(sx, i, { reps: null }, { load: { value: 60, unit: 'lb', convention: 'total' }, reps: r })))]],
  ]);
  const detail = planDayDetail({ dayN: 2, of: 4, gymName: 'Main gym', aboutMinutes: 60, planned, history: (exerciseId) => histories.get(exerciseId) ?? [] });

  it('the header: day of days, gym, about how long (parts not known are left out)', () => {
    expect(detail.header).toBe('Day 2 of 4 · Main gym · about 60 min');
    expect(planDayDetail({ dayN: 1, of: 3, gymName: null, aboutMinutes: null, planned, history: () => [] }).header).toBe('Day 1 of 3');
  });

  it('each exercise: working sets × target · load (warm-ups and sets taken out before the start aren’t counted); kg, per-hand, assisted, cardio', () => {
    expect(detail.rows.map((r) => [r.name, plain(r.line)])).toEqual([
      ['Barbell row', '3 × 6–8 · 85 kg'],
      ['Chest-supported row', '3 × 10–12 · 22.5 kg each'],
      ['Assisted pull-up', '2 × 8 · Assist 30 kg'],
      ['Rear-delt fly', '2 × 12–15 · 7.5 kg each'],
      ['Rowing machine', '1 × 10:00'],
      ['EZ-bar curl', '1 × 8–10 · 30 kg'],
    ]);
  });

  it('a top set reads on its own; mixed working sets show only what they share (review planview S6)', () => {
    const squat = ex(70, 'Back squat');
    const press = ex(80, 'Overhead press');
    const mixed: Agg = {
      session: session(510, '2026-10-08T06:00:00.000Z'),
      exercises: [squat, press],
      sets: [
        set(squat, 0, { load: kg(95), reps: [6, 8] }, null, { setType: 'top' }),
        ...[1, 2, 3].map((i) => set(squat, i, { load: kg(85), reps: [6, 8] }, null)),
        set(press, 0, { load: kg(50), reps: [5, 5] }, null),
        set(press, 1, { load: kg(45), reps: [8, 10] }, null),
      ],
    };
    const lines = planDayDetail({ dayN: 1, of: 4, gymName: null, aboutMinutes: null, planned: mixed, history: () => [] }).rows.map((r) => plain(r.line));
    expect(lines).toEqual(['95 kg top, 3 × 6–8 · 85 kg', '2 sets']);
  });

  it('last time from his newest workout with it, with targets hit; lb shown where the plan is kg; est. with no history; cardio with pace', () => {
    expect(detail.rows.map((r) => plain(r.sub))).toEqual([
      'Last 7 Oct: 80 × 12, 12, 75 × 10 · Targets hit 1 of last 2',
      'Last 2 Oct: 20 × 12, 12, 11',
      'Last 2 Oct: Assist 35 × 8, 8',
      'est.',
      'Last 2 Oct: 10:00 · 2,450 m · 2:02 /500 m · Targets hit 1 of last 1',
      'Last 2 Oct: 60 lb × 8, 8',
    ]);
    expect(plain(detail.rows[3]?.accessibilityLabel)).toBe('Rear-delt fly, 2 × 12–15 · 7.5 kg each, estimated load');
  });
});
