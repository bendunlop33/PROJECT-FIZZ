import { describe, expect, it } from 'vitest';

import type { Load, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';

import { consistency, exercisePlanRow, exerciseTargetHistory, PLAN_VERDICT_WORD, plannedRepsOf, plannedVsDone, toIso, toMs } from '../src/index';
import { id, kg, TZ } from './fixtures';

/**
 * The plan tracker v1 (Ben, 19 Oct; research proposals 1–3): planned vs
 * done per exercise with one word (never colour alone), the consistency
 * card against the days-a-week aim (none: counts only; never "missed"),
 * plan days done this week, and targets hit per exercise. Numbers only from
 * what was planned and logged.
 */

function ex(n: number, name: string, over: Partial<SessionExercise> = {}): SessionExercise {
  return { id: id(n), sessionId: id(1), exerciseId: id(n + 1000), exerciseName: name, measurement: 'reps', laterality: 'bilateral', equipmentId: null, loadConvention: 'total', unit: 'kg', order: n, supersetGroup: null, transitionRestS: null, progressionRuleId: null, ...over };
}

let next = 5000;
function set(e: SessionExercise, index: number, planned: { load?: Load | null; reps?: [number, number] | null; durationS?: number | null }, actual: { load?: Load | null; reps?: number | null; durationS?: number | null } | null, over: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: id((next += 1)),
    sessionId: id(1),
    sessionExerciseId: e.id,
    index,
    setType: 'working',
    status: actual === null ? 'skipped' : 'completed',
    side: null,
    pairedWithSetId: null,
    planned: { load: planned.load ?? null, reps: planned.reps === undefined ? { min: 8, max: 8 } : planned.reps === null ? null : { min: planned.reps[0], max: planned.reps[1] }, durationS: planned.durationS ?? null, rpe: null, rir: null },
    rest: { seconds: 90, source: 'global_default', sourceLabel: 'Default' },
    actual: actual === null ? null : { load: actual.load ?? null, reps: actual.reps ?? null, durationS: actual.durationS ?? null, rpe: null, rir: null },
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

describe('planned reps (Progress v3: `Mon – 92%`, Summary `156 of 170 planned reps`; reviews progress-v3 S2/S4, S6, S7)', () => {
  const bench = ex(110, 'Bench press');
  const row = ex(120, 'Cable row', { loadConvention: 'stack' });
  const curl = ex(130, 'Curl', { loadConvention: 'per_hand' });

  it('warm-ups out; a skipped planned set counts 0; an added set counts done only; one taken out before Start is out; a companion isn’t counted twice; a single target (min = max) counts as planned, a range its low end', () => {
    const a = set(row, 0, { reps: [8, 12] }, { reps: 10 });
    const sets = [
      set(bench, 0, { reps: [10, 10] }, { reps: 10 }, { setType: 'warmup' }),
      set(bench, 1, { reps: [10, 10] }, { reps: 10 }),
      set(bench, 2, { reps: [10, 10] }, null),
      set(bench, 3, { reps: [10, 10] }, { reps: 12 }, { planned: { load: null, reps: { min: 10, max: 10 }, durationS: null, rpe: null, rir: null, addedInWorkout: true } }),
      set(bench, 4, { reps: [10, 10] }, null, { skippedBy: 'before_start' }),
      a,
      set(row, 0, { reps: [8, 12] }, { reps: 10 }, { pairedWithSetId: a.id }),
      set(curl, 0, { reps: [8, 12] }, null),
    ];
    // Planned: bench 10 + 10 (skipped), row 8, curl 8 = 36. Done: 10 + 12 (added) + 10 = 32.
    expect(plannedRepsOf({ sets })).toEqual({ planned: 36, done: 32 });
    const r = plannedVsDone({ exercises: [bench, row, curl], sets });
    expect(r?.reps).toEqual({ planned: 36, done: 32, text: '32 of 36 planned reps', short: 'Short: Bench press · Skipped: Curl' });
  });

  it('extras can lift the % past 100, but the skipped exercise is still named', () => {
    const sets = [set(bench, 0, {}, { reps: 8 }), set(bench, 1, {}, { reps: 8 }), set(bench, 2, {}, { reps: 8 }, { planned: { load: null, reps: { min: 8, max: 8 }, durationS: null, rpe: null, rir: null, addedInWorkout: true } }), set(curl, 0, { reps: [8, 8] }, null)];
    const r = plannedVsDone({ exercises: [bench, curl], sets });
    expect(r?.reps).toMatchObject({ planned: 24, done: 24, short: 'Skipped: Curl' });
  });

  it('nothing planned in reps: no line', () => {
    expect(plannedRepsOf({ sets: [set(bench, 0, { reps: null, durationS: 45 }, { durationS: 45 })] })).toEqual({ planned: null, done: 0 });
  });
});

describe('plannedVsDone: the Summary’s plan vs done (proposal 1)', () => {
  const bench = ex(10, 'Bench press');
  const row = ex(20, 'Cable row', { loadConvention: 'stack' });
  const plank = ex(30, 'Plank', { measurement: 'duration', loadConvention: 'bodyweight' });
  const pull = ex(40, 'Assisted pull-up', { loadConvention: 'assistance' });

  it('`3/3 sets · 8, 8, 7 of 8` is Short; every set in range is Hit; above the range is Over', () => {
    const sets = [
      set(bench, 0, { load: kg(100) }, { load: kg(100), reps: 8 }),
      set(bench, 1, { load: kg(100) }, { load: kg(100), reps: 8 }),
      set(bench, 2, { load: kg(100) }, { load: kg(100), reps: 7 }),
      set(row, 0, { load: kg(60, 'stack'), reps: [8, 10] }, { load: kg(60, 'stack'), reps: 9 }),
      set(row, 1, { load: kg(60, 'stack'), reps: [8, 10] }, { load: kg(60, 'stack'), reps: 10 }),
      set(plank, 0, { reps: null, durationS: 45 }, { durationS: 60 }),
    ];
    const r = plannedVsDone({ exercises: [bench, row, plank], sets });
    expect(r?.rows.map((x) => [x.name, x.text, PLAN_VERDICT_WORD[x.verdict]])).toEqual([
      ['Bench press', '3/3 sets · 8, 8, 7 of 8', 'Short'],
      ['Cable row', '2/2 sets · 9, 10 of 8–10', 'Hit'],
      ['Plank', '1/1 sets · 1:00 of 0:45', 'Over'],
    ]);
    expect(r?.header).toBe('6/6 planned sets');
  });

  it('a skipped set is Short and not done; a lighter load is Short, a heavier one Over; more assistance is lighter', () => {
    const r = plannedVsDone({
      exercises: [bench, row, pull],
      sets: [
        set(bench, 0, { load: kg(100) }, { load: kg(100), reps: 8 }),
        set(bench, 1, { load: kg(100) }, null),
        set(row, 0, { load: kg(60, 'stack') }, { load: kg(65, 'stack'), reps: 8 }),
        set(pull, 0, { load: kg(30, 'assistance') }, { load: kg(35, 'assistance'), reps: 8 }),
      ],
    });
    expect(r?.rows.map((x) => [x.text, x.verdict])).toEqual([
      ['1/2 sets · 8 of 8', 'short'],
      ['1/1 sets · 8 of 8 · 60\u00a0kg\u00a0stack planned', 'over'],
      ['1/1 sets · 8 of 8 · Assist 30\u00a0kg planned', 'short'],
    ]);
    expect(r?.rows.map((x) => x.short)).toEqual(['1/2 · of 8 · 1 skipped', '1/1 · of 8 · 60\u00a0kg\u00a0stack planned', '1/1 · of 8 · Assist 30\u00a0kg planned']);
    expect(r?.header).toBe('3/4 planned sets');
  });

  it('every rep hit at a lighter load is Short and says the planned load, so the line never contradicts itself (design pass, 20 Oct)', () => {
    const sets = [0, 1, 2].map((i) => set(bench, i, { load: kg(100) }, { load: kg(90), reps: 8 }));
    const r = exercisePlanRow(bench, sets);
    expect(r).toMatchObject({ verdict: 'short', plannedLoad: '100\u00a0kg', text: '3/3 sets · 8, 8, 8 of 8 · 100\u00a0kg planned', short: '3/3 · of 8 · 100\u00a0kg planned' });
    // A rep miss gives the verdict: no planned load is added.
    const miss = exercisePlanRow(bench, [set(bench, 0, { load: kg(100) }, { load: kg(100), reps: 6 })]);
    expect(miss).toMatchObject({ verdict: 'short', plannedLoad: null, short: '1/1 · of 8' });
    // Per-hand dumbbells say `each`; lb stays lb.
    const db = ex(50, 'DB press', { loadConvention: 'per_hand', unit: 'lb' });
    const lb = (v: number) => ({ value: v, unit: 'lb' as const, convention: 'per_hand' as const });
    expect(exercisePlanRow(db, [set(db, 0, { load: lb(50) }, { load: lb(45), reps: 8 })])?.plannedLoad).toBe('50\u00a0lb\u00a0each');
    // Hit: nothing extra.
    expect(exercisePlanRow(bench, [set(bench, 0, { load: kg(100) }, { load: kg(100), reps: 8 })])).toMatchObject({ plannedLoad: null, short: '1/1 · of 8' });
  });

  it('a set taken out before the start isn’t planned; an extra set is Over; warm-ups and other-side companions don’t count; kg vs lb isn’t compared', () => {
    const r = exercisePlanRow(bench, [
      set(bench, 0, { load: kg(100) }, { load: kg(100), reps: 8 }),
      set(bench, 1, { load: kg(100) }, null, { skippedBy: 'before_start' }),
      set(bench, 2, { load: kg(100) }, { load: kg(100), reps: 8 }, { setType: 'warmup' }),
      set(bench, 3, { load: kg(100) }, { load: { value: 200, unit: 'lb', convention: 'total' }, reps: 8 }),
      set(bench, 4, { load: kg(100) }, { load: kg(100), reps: 8 }, { pairedWithSetId: id(1) }),
    ]);
    expect(r).toMatchObject({ plannedSets: 2, doneSets: 2, verdict: 'hit', text: '2/2 sets · 8, 8 of 8' });
    const extra = exercisePlanRow(bench, [set(bench, 0, { load: kg(100) }, { load: kg(100), reps: 8 }), set(bench, 1, { reps: null }, { load: kg(100), reps: 8 })]);
    expect(extra).toMatchObject({ plannedSets: 1, doneSets: 2, verdict: 'over', text: '2/1 sets · 8, 8 of 8' });
  });

  it('a set Ben added in the workout copies a planned target but isn’t planned: `4/3 sets` is Over and the header stays at the plan (review S1)', () => {
    const planned = { load: kg(100) };
    const added = set(bench, 3, planned, { load: kg(100), reps: 8 });
    const sets = [
      set(bench, 0, planned, { load: kg(100), reps: 8 }),
      set(bench, 1, planned, { load: kg(100), reps: 8 }),
      set(bench, 2, planned, { load: kg(100), reps: 8 }),
      { ...added, planned: { ...added.planned, addedInWorkout: true as const } },
    ];
    const r = plannedVsDone({ exercises: [bench], sets });
    expect(r?.rows[0]).toMatchObject({ plannedSets: 3, doneSets: 4, verdict: 'over', text: '4/3 sets · 8, 8, 8, 8 of 8' });
    expect(r?.header).toBe('3/3 planned sets');
  });

  it('nothing planned (an empty start, an import): no rows', () => {
    expect(plannedVsDone({ exercises: [bench], sets: [set(bench, 0, { reps: null }, { load: kg(100), reps: 8 })] })).toBeNull();
    expect(plannedVsDone({ exercises: [{ ...bench, removed: { opId: 'x', at: { utc: '2026-10-08T06:00:00.000Z', tz: TZ }, by: 'remove' } }], sets: [set(bench, 0, {}, { reps: 8 })] })).toBeNull();
  });
});

describe('consistency: the last 8 weeks against the aim (proposal 2)', () => {
  // Thursday 8 Oct 2026, 19:00 in Auckland.
  const nowMs = toMs('2026-10-08T06:00:00.000Z');
  const w = (n: number, utc: string, routineId: string | null = null) => ({ sessionId: id(n), routineId, startedAtUtc: utc });

  it('workouts per local Monday–Sunday week, this week apart; with an aim, `2/3` and weeks at the aim', () => {
    const v = consistency({
      workouts: [
        // This week (from Mon 5 Oct, Auckland).
        w(1, '2026-10-05T06:00:00.000Z'),
        w(2, '2026-10-07T06:00:00.000Z'),
        // Last week: Sunday 4 Oct 22:00 Auckland is 09:00 UTC that day.
        w(3, '2026-10-04T09:00:00.000Z'),
        w(4, '2026-09-29T06:00:00.000Z'),
        w(5, '2026-09-30T06:00:00.000Z'),
        // Nine weeks ago: outside the window.
        w(6, '2026-08-05T06:00:00.000Z'),
      ],
      nowMs,
      tz: TZ,
      aim: 3,
      plan: null,
    });
    expect(v.thisWeek).toMatchObject({ monday: '2026-10-05', workouts: 2, text: '2/3', atAim: false });
    expect(v.weeks).toHaveLength(8);
    expect(v.weeks.at(-1)).toMatchObject({ monday: '2026-09-28', workouts: 3, text: '3/3', atAim: true });
    expect(v.weeks[0]?.monday).toBe('2026-08-10');
    expect(v.atAimText).toBe('Weeks at your aim: 1 of 8');
    expect(v.planThisWeek).toBeNull();
    // Nothing is ever called missed.
    expect(JSON.stringify(v)).not.toMatch(/miss/i);
  });

  it('the aim is days a week: two workouts on one local day are one day; workouts are still counted (review S2)', () => {
    const v = consistency({
      workouts: [
        // Tue 29 Sep, morning and evening in Auckland; Wed 30 Sep.
        w(1, '2026-09-28T19:00:00.000Z'),
        w(2, '2026-09-29T07:00:00.000Z'),
        w(3, '2026-09-29T19:00:00.000Z'),
      ],
      nowMs,
      tz: TZ,
      aim: 3,
      plan: null,
    });
    expect(v.weeks.at(-1)).toMatchObject({ monday: '2026-09-28', workouts: 3, days: 2, text: '2/3', atAim: false });
    expect(v.atAimText).toBe('Weeks at your aim: 0 of 8');
  });

  it('no aim: counts only', () => {
    const v = consistency({ workouts: [w(1, '2026-10-05T06:00:00.000Z')], nowMs, tz: TZ, aim: null, plan: null });
    expect(v.thisWeek).toMatchObject({ text: '1', atAim: null });
    expect(v.atAimText).toBeNull();
  });

  it('with a plan: distinct plan days done this week since Apply, `3 of 4` (a day done twice counts once)', () => {
    const days = [{ routineId: id(100) }, { routineId: id(101) }, { routineId: id(102) }, { routineId: id(103), createdFromSessionId: id(9) }];
    const v = consistency({
      workouts: [
        w(1, '2026-10-05T06:00:00.000Z', id(100)),
        w(2, '2026-10-06T06:00:00.000Z', id(101)),
        w(3, '2026-10-07T06:00:00.000Z', id(100)),
        w(9, '2026-10-07T08:00:00.000Z'),
        // Last week: not this week's.
        w(4, '2026-09-30T06:00:00.000Z', id(102)),
      ],
      nowMs,
      tz: TZ,
      aim: 4,
      plan: { days, appliedAtUtc: '2026-09-20T00:00:00.000Z' },
    });
    expect(v.planThisWeek).toEqual({ done: 3, of: 4, text: '3 of 4' });
    // (Ben, 28 Oct) Applied mid-week: that week's workouts before Apply count too (by the same rules).
    const later = consistency({ workouts: [w(1, '2026-10-05T06:00:00.000Z', id(100)), w(2, '2026-10-07T06:00:00.000Z', id(101))], nowMs, tz: TZ, aim: 4, plan: { days, appliedAtUtc: '2026-10-06T00:00:00.000Z' } });
    expect(later.planThisWeek?.text).toBe('2 of 4');
  });
});

describe('exerciseTargetHistory: target vs actual per session, targets hit (proposal 3)', () => {
  const benchOf = (n: number) => ex(10, 'Bench press', { id: id(n), exerciseId: id(1010) });
  function workout(n: number, daysAgo: number, reps: (number | null)[], planned = true): Pick<SessionAggregate, 'session' | 'exercises' | 'sets'> {
    const e = benchOf(n);
    return {
      session: { id: id(n), startedAt: { utc: toIso(toMs('2026-10-08T06:00:00.000Z') - daysAgo * 86_400_000), tz: TZ } } as SessionAggregate['session'],
      exercises: [e],
      sets: reps.map((r, i) => set(e, i, planned ? { load: kg(100), reps: [6, 8] } : { reps: null }, r === null ? null : { load: kg(100), reps: r })),
    };
  }

  it('newest first; `Targets hit 5 of last 6` counts Hit and Over; a session with no target shows what was done and doesn’t count', () => {
    const sessions = [
      workout(201, 1, [8, 8, 8]),
      workout(202, 4, [9, 8, 8]),
      workout(203, 7, [6, 5, 6]),
      workout(204, 10, [7, 7, 7]),
      workout(205, 13, [8, 7, 6]),
      workout(206, 16, [6, 6, 6]),
      workout(207, 19, [6, null, 6]),
      workout(208, 2, [8, 8], false),
    ];
    const h = exerciseTargetHistory(sessions, id(1010));
    expect(h.rows.map((r) => [r.target, r.actual, r.verdict])).toEqual([
      ['3 × 6–8', '8, 8, 8', 'hit'],
      [null, '8, 8', null],
      ['3 × 6–8', '9, 8, 8', 'over'],
      ['3 × 6–8', '6, 5, 6', 'short'],
      ['3 × 6–8', '7, 7, 7', 'hit'],
      ['3 × 6–8', '8, 7, 6', 'hit'],
      ['3 × 6–8', '6, 6, 6', 'hit'],
      ['3 × 6–8', '6, 6', 'short'],
    ]);
    expect(h.hitText).toBe('Targets hit 5 of last 6');
    expect(exerciseTargetHistory([workout(208, 2, [8], false)], id(1010)).hitText).toBeNull();
    expect(exerciseTargetHistory(sessions, id(999)).rows).toEqual([]);
  });

  it('review S1: the same exercise twice (weighted 3 × 12 and a 0 kg copy 3 × 20) is one row per copy, never merged; parts after a gym switch stay one row', () => {
    const main = ex(10, 'Seated calf raise', { id: id(301), exerciseId: id(1010), loadConvention: 'added' });
    const copy = ex(11, 'Seated calf raise', { id: id(302), exerciseId: id(1010), loadConvention: 'added', order: 11 });
    const part = ex(12, 'Seated calf raise', { id: id(303), exerciseId: id(1010), loadConvention: 'added', order: 12, continuesFromId: id(301) });
    const w = (load: number) => ({ value: load, unit: 'kg' as const, convention: 'added' as const });
    const a: Pick<SessionAggregate, 'session' | 'exercises' | 'sets'> = {
      session: { id: id(300), startedAt: { utc: '2026-10-08T06:00:00.000Z', tz: TZ } } as SessionAggregate['session'],
      exercises: [main, copy, part],
      sets: [
        ...[0, 1].map((i) => set(main, i, { load: w(40), reps: [12, 12] }, { load: w(40), reps: 12 })),
        set(part, 0, { load: w(40), reps: [12, 12] }, { load: w(40), reps: 12 }),
        ...[0, 1, 2].map((i) => set(copy, i, { load: w(0), reps: [20, 20] }, { load: w(0), reps: 20 })),
      ],
    };
    const h = exerciseTargetHistory([a], id(1010));
    expect(h.rows.map((r) => [r.sessionExerciseId, r.target, r.verdict])).toEqual([
      [id(301), '3 × 12', 'hit'],
      [id(302), '3 × 20', 'hit'],
    ]);
    expect(h.rows.every((r) => r.sessionId === id(300))).toBe(true);
  });
});
