import { describe, expect, it } from 'vitest';

import type { Load, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';

import { consistency, exercisePlanRow, exerciseTargetHistory, PLAN_VERDICT_WORD, plannedVsDone, toIso, toMs } from '../src/index';
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
      ['1/1 sets · 8 of 8', 'over'],
      ['1/1 sets · 8 of 8', 'short'],
    ]);
    expect(r?.header).toBe('3/4 planned sets');
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
    expect(r.rows[0]).toMatchObject({ plannedSets: 3, doneSets: 4, verdict: 'over', text: '4/3 sets · 8, 8, 8, 8 of 8' });
    expect(r.header).toBe('3/3 planned sets');
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
    // Applied mid-week: workouts before Apply don't count.
    const later = consistency({ workouts: [w(1, '2026-10-05T06:00:00.000Z', id(100)), w(2, '2026-10-07T06:00:00.000Z', id(101))], nowMs, tz: TZ, aim: 4, plan: { days, appliedAtUtc: '2026-10-06T00:00:00.000Z' } });
    expect(later.planThisWeek?.text).toBe('1 of 4');
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
});
