import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, ProgressionRule, SetType } from '@fizz/schemas';

import {
  builtInDefaultRule,
  cushionReps,
  doneSoFarLines,
  earlierSetsByMuscle,
  earlierSetsP,
  earlierWorkOf,
  nextTargetsFor,
  pickLikeForLike,
  plannedSetsFromTargets,
  resolveContext,
  type ContextWorkout,
  type FatigueMuscles,
  type HistorySession,
  type NextTargetRequest,
  type WorkContext,
} from '../src/index';
import { dumbbells, exercise, GYM, id, kg, OWNER, T0_MS, TZ } from './fixtures';

/**
 * SF1–SF9 (Ben, 8 Nov; docs/training-guides/in-session-fatigue.md). The guide's Push A worked example, like-for-like
 * history over newer non-comparable history, today fresher, supersets (SF8), imported history with no known order,
 * the stale-context check, the pain hold winning (SF9) and stalls that skip other-context sessions (SF5).
 */

const DAY = 86_400_000;
const BENCH = id(9101);
const INCLINE = id(9102);
const ROW = id(9103);
const OHP = id(9104);
const BIKE = id(9105);

// The guide's assumptions (§3): bench and incline are primary for chest and front delts, secondary for triceps.
const MUSCLES = new Map<string, FatigueMuscles>([
  [BENCH, { primaryMuscles: ['chest', 'front_delts'], secondaryMuscles: ['triceps'] }],
  [INCLINE, { primaryMuscles: ['upper_chest', 'front_delts'], secondaryMuscles: ['triceps'] }],
  [ROW, { primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['biceps'] }],
  [OHP, { primaryMuscles: ['front_delts'], secondaryMuscles: ['triceps'] }],
  [BIKE, { primaryMuscles: ['quads'], measurement: 'cardio' }],
]);
const musclesOf = (exerciseId: string) => MUSCLES.get(exerciseId) ?? null;

// Dumbbell rack in 2 kg steps per dumbbell.
const RACK: EquipmentInstance = dumbbells({ loads: Array.from({ length: 16 }, (_, i) => 10 + i * 2) });
const INCLINE_EX = exercise(9102, 'Incline dumbbell press', { primaryMuscles: ['upper_chest', 'front_delts'], secondaryMuscles: ['triceps'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound' });
// The incline slot's range is 8–10 (HT9).
const DEFAULT = builtInDefaultRule(OWNER, 'kg', 3, 'compound');
const RULE: ProgressionRule = DEFAULT.method === 'double_progression' ? { ...DEFAULT, repRange: { min: 8, max: 10 } } : DEFAULT;

const FIRST: WorkContext = { earlier: [], supersetWith: [] };
const AFTER_BENCH: WorkContext = { earlier: [{ exerciseId: BENCH, sets: 3 }], supersetWith: [] };

function exposure(n: number, daysAgo: number, load: number, reps: number[], context: WorkContext | undefined, opts: { rpe?: number; imported?: boolean } = {}): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: new Date(T0_MS - daysAgo * DAY).toISOString(),
    equipmentId: opts.imported === true ? null : RACK.id,
    gymId: opts.imported === true ? null : GYM,
    imported: opts.imported === true,
    sets: reps.map((r) => ({ setType: 'working' as SetType, side: null, load: kg(load, 'per_hand'), reps: r, rpe: opts.rpe ?? 8, rir: null })),
    tz: TZ,
    ...(context !== undefined ? { context } : {}),
  };
}

function request(history: HistorySession[], today: WorkContext | null | undefined, over: Partial<NextTargetRequest> = {}): NextTargetRequest {
  return {
    ownerId: OWNER,
    exerciseId: INCLINE,
    exerciseName: INCLINE_EX.name,
    measurement: 'reps',
    unit: 'kg',
    convention: 'per_hand',
    equipment: RACK,
    exercise: INCLINE_EX,
    rule: RULE,
    workingSets: 3,
    history,
    painFlags: [],
    sessionPain: { active: false, reportedAtUtc: null },
    ...(today !== undefined ? { fatigue: { today, musclesOf } } : {}),
    ...over,
  };
}

const plan = (r: ReturnType<typeof nextTargetsFor>) => r.result.sets.filter((s) => s.setType !== 'warmup').map((s) => [s.load?.value ?? null, s.reps.min, s.reps.max]);

describe('SF1: earlier sets by muscle', () => {
  it('counts 1 where the muscle was primary and ½ where it helped; P is the highest across its own primaries', () => {
    const by = earlierSetsByMuscle([{ exerciseId: BENCH, sets: 3 }, { exerciseId: ROW, sets: 3 }], musclesOf);
    expect(by.get('Chest')).toEqual({ direct: 3, secondary: 0 });
    expect(by.get('Shoulders')).toEqual({ direct: 3, secondary: 0 });
    expect(by.get('Triceps')).toEqual({ direct: 0, secondary: 3 });
    expect(by.get('Back')).toEqual({ direct: 3, secondary: 0 });
    // Triceps' 1.5 isn't an incline primary: P = 3.
    expect(earlierSetsP(musclesOf(INCLINE), by)).toEqual({ p: 3, muscle: 'Chest' });
    expect(doneSoFarLines(by)).toEqual(['Back: 3 sets direct', 'Chest: 3 sets direct', 'Shoulders: 3 sets direct', 'Biceps: 3 sets secondary', 'Triceps: 3 sets secondary']);
  });

  it('no catalogue muscles: P unknown', () => {
    expect(resolveContext(AFTER_BENCH, id(9999), musclesOf).p).toBeNull();
    expect(earlierSetsP({ primaryMuscles: [] }, new Map())).toBeNull();
  });

  const row = (n: number, exerciseId: string, order: number, extra: Partial<ContextWorkout['exercises'][number]> = {}) => ({ id: id(n), exerciseId, order, supersetGroup: null, measurement: 'reps' as const, ...extra });
  const set = (row: number, minute: number | null, over: Partial<ContextWorkout['sets'][number]> = {}): ContextWorkout['sets'][number] => ({
    sessionExerciseId: id(row),
    setType: 'working',
    status: minute === null ? 'pending' : 'completed',
    side: null,
    completedAt: minute === null ? null : { utc: new Date(T0_MS + minute * 60_000).toISOString(), tz: TZ },
    actual: minute === null ? null : { load: kg(60, 'total'), reps: 8, durationS: null, rpe: 8, rir: null },
    ...over,
  });

  it('reads the logged order: warm-ups, drop sets, easy sets, cardio and sets after its first set never count', () => {
    const w: ContextWorkout = {
      session: { source: 'manual' },
      exercises: [row(1, BIKE, 0, { measurement: 'cardio' }), row(2, BENCH, 1), row(3, INCLINE, 2), row(4, OHP, 3)],
      sets: [
        set(1, 0),
        set(2, 5, { setType: 'warmup' }),
        set(2, 8),
        set(2, 11),
        set(2, 14, { setType: 'drop' }),
        set(2, 15, { actual: { load: kg(40, 'total'), reps: 12, durationS: null, rpe: 5, rir: null } }),
        set(3, 20),
        set(3, 23),
        // OHP done after incline started: not before it.
        set(4, 30),
      ],
    };
    expect(earlierWorkOf(w, INCLINE)).toEqual({ earlier: [{ exerciseId: BENCH, sets: 2 }], supersetWith: [] });
    // Bench itself: nothing before it but cardio.
    expect(earlierWorkOf(w, BENCH)).toEqual({ earlier: [], supersetWith: [] });
  });

  it('a left or right side set counts ½; planned sets on earlier rows count for today (SF6); imports have no context', () => {
    const w: ContextWorkout = {
      session: { source: 'manual' },
      exercises: [row(1, BENCH, 0), row(2, OHP, 1), row(3, INCLINE, 2)],
      sets: [set(1, 1, { side: 'left' }), set(1, 2, { side: 'right' }), set(1, 3), set(2, null), set(2, null), set(3, null)],
    };
    expect(earlierWorkOf(w, INCLINE)).toEqual({ earlier: [{ exerciseId: BENCH, sets: 2 }], supersetWith: [] });
    expect(earlierWorkOf(w, INCLINE, { planned: true })).toEqual({ earlier: [{ exerciseId: BENCH, sets: 2 }, { exerciseId: OHP, sets: 2 }].sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : 1)), supersetWith: [] });
    expect(earlierWorkOf({ ...w, session: { source: 'import' } }, INCLINE)).toBeNull();
  });

  it('superset partners are part of the context (SF8)', () => {
    const w: ContextWorkout = {
      session: { source: 'manual' },
      exercises: [row(1, BENCH, 0, { supersetGroup: 'A' }), row(2, INCLINE, 1, { supersetGroup: 'A' }), row(3, ROW, 2)],
      sets: [set(1, 1), set(2, 2), set(1, 3), set(2, 4)],
    };
    // Partner sets count as they were logged: one bench set before incline's first.
    expect(earlierWorkOf(w, INCLINE)).toEqual({ earlier: [{ exerciseId: BENCH, sets: 1 }], supersetWith: [BENCH] });
    expect(resolveContext(earlierWorkOf(w, INCLINE), INCLINE, musclesOf).sameMuscleSuperset).toBe(true);
    // An antagonist pair is not a same-muscle superset.
    expect(resolveContext({ earlier: [], supersetWith: [ROW] }, INCLINE, musclesOf).sameMuscleSuperset).toBe(false);
  });
});

describe('SF2/SF3: the Push A worked example', () => {
  // Incline has only ever come first: 30 kg × 9, 9, 9 at RPE 8 (P = 0).
  const history = [exposure(1, 7, 30, [9, 9, 9], FIRST)];
  // Today: bench 3 working sets, then a row (no chest or delt overlap), then incline.
  const today: WorkContext = { earlier: [{ exerciseId: BENCH, sets: 3 }, { exerciseId: ROW, sets: 3 }], supersetWith: [] };

  it('without SF the fresh-first history plans 30 × 8–10 aiming for more reps', () => {
    const r = nextTargetsFor(request(history, undefined));
    expect(r.result.decision).toBe('hold');
    expect(plan(r)).toEqual([0, 1, 2].map(() => [30, 8, 10]));
    expect(r.result.earlierWork).toBeUndefined();
  });

  it('after 3 bench sets: 30 kg × 8, 8, 8 est., no load step, the one-line Why', () => {
    const r = nextTargetsFor(request(history, today));
    expect(r.result.decision).toBe('hold');
    expect(plan(r)).toEqual([0, 1, 2].map(() => [30, 8, 8]));
    expect(r.result.explanation.summary).toBe('After 3 chest sets today; last time first: 30 × 9 → 8 est.');
    expect(r.result.earlierWork).toMatchObject({ todayP: 3, basis: 'cushion', reference: { sessionId: id(1), p: 0 }, cushion: { reps: 1, stepDown: false, lastReps: 9, aim: 8 } });
    const planned = plannedSetsFromTargets(r.result, { history, equipment: RACK, at: { utc: new Date(T0_MS).toISOString(), tz: TZ } });
    expect(planned?.every((p) => p.planned.provenance?.estimate === true && p.planned.source === 'built_in_rule')).toBe(true);
  });

  it('bench 3 + overhead press 3: P 6 → 2 fewer = 7, below 8, so one achievable step down: 28 kg × 8 est.', () => {
    const r = nextTargetsFor(request(history, { earlier: [{ exerciseId: BENCH, sets: 3 }, { exerciseId: OHP, sets: 3 }], supersetWith: [] }));
    expect(plan(r)).toEqual([0, 1, 2].map(() => [28, 8, 8]));
    expect(r.result.earlierWork?.cushion).toEqual({ reps: 2, stepDown: true, lastReps: 9, aim: 8 });
  });

  it('a step down never goes past the rack: at the lightest dumbbell the load stays', () => {
    const r = nextTargetsFor(request([exposure(1, 7, 10, [9, 9, 9], FIRST)], { earlier: [{ exerciseId: BENCH, sets: 3 }, { exerciseId: OHP, sets: 3 }], supersetWith: [] }));
    expect(plan(r)).toEqual([0, 1, 2].map(() => [10, 8, 8]));
  });

  it('after Ben logs 30 × 9, 9, 8 after bench, the next Push A reads that like for like (no est.)', () => {
    const next = [...history, exposure(2, 0, 30, [9, 9, 8], AFTER_BENCH)];
    const r = nextTargetsFor(request(next, today));
    expect(r.result.earlierWork?.basis).toBe('comparable');
    expect(r.result.earlierWork?.reference?.sessionId).toBe(id(2));
    expect(r.result.basedOnSessionIds).toEqual([id(2)]);
    expect(plan(r)).toEqual([0, 1, 2].map(() => [30, 8, 10]));
    expect(plannedSetsFromTargets(r.result)?.some((p) => p.planned.provenance?.estimate === true)).toBe(false);
  });

  it('a day incline comes first (SF6: moved to first) still reads the fresh-first history, normally', () => {
    const next = [...history, exposure(2, 1, 30, [9, 9, 8], AFTER_BENCH)];
    const r = nextTargetsFor(request(next, FIRST));
    expect(r.result.earlierWork?.reference?.sessionId).toBe(id(1));
    expect(plan(r)).toEqual([0, 1, 2].map(() => [30, 8, 10]));
  });
});

describe('SF2: like for like', () => {
  it('picks the older after-bench session over a newer fresh-first one', () => {
    // 10 days ago after bench: 28 × 10, 10, 10 (all at the top: a load step). 3 days ago first: 32 × 9.
    const history = [exposure(1, 10, 28, [10, 10, 10], AFTER_BENCH), exposure(2, 3, 32, [9, 9, 9], FIRST)];
    const plain = nextTargetsFor(request(history, undefined));
    expect(plan(plain)[0]?.[0]).toBe(32);
    const r = nextTargetsFor(request(history, AFTER_BENCH));
    expect(r.result.decision).toBe('increase_load');
    expect(plan(r)[0]?.[0]).toBe(30);
    expect(r.result.basedOnSessionIds).toEqual([id(1)]);
  });

  it('within 2 sets is comparable; 3 apart is not', () => {
    const near = pickLikeForLike({ p: 2, sameMuscleSuperset: false, muscle: 'Chest' }, [{ sessionId: 'a', performedAtUtc: '2026-11-01T10:00:00.000Z', context: { p: 0, sameMuscleSuperset: false, muscle: null } }]);
    expect(near.kind).toBe('comparable');
    const far = pickLikeForLike({ p: 3, sameMuscleSuperset: false, muscle: 'Chest' }, [{ sessionId: 'a', performedAtUtc: '2026-11-01T10:00:00.000Z', context: { p: 0, sameMuscleSuperset: false, muscle: null } }]);
    expect(far).toMatchObject({ kind: 'other', cushion: 1 });
    expect(cushionReps(5, 0)).toBe(2);
    expect(cushionReps(1, 0)).toBe(0);
  });

  it('today fresher than the only history: no upward adjustment, the rule as is (no est.)', () => {
    const history = [exposure(1, 7, 30, [9, 9, 9], AFTER_BENCH)];
    const r = nextTargetsFor(request(history, { earlier: [], supersetWith: [] }));
    expect(r.result.earlierWork?.basis).toBe('other');
    expect(plan(r)).toEqual(plan(nextTargetsFor(request(history, undefined))));
  });

  it('stale like-for-like (28+ days older than a newer other context): SF3 from the newer one when its load is lower', () => {
    // 40 days ago after bench: 30 × 10s (a step to 32). 5 days ago first: 30 × 9s → SF3 30 × 8 est.
    const history = [exposure(1, 40, 30, [10, 10, 10], AFTER_BENCH), exposure(2, 5, 30, [9, 9, 9], FIRST)];
    const r = nextTargetsFor(request(history, AFTER_BENCH));
    expect(plan(r)).toEqual([0, 1, 2].map(() => [30, 8, 8]));
    expect(r.result.earlierWork).toMatchObject({ basis: 'cushion', staleLower: true });
  });

  it('SF9: a pain flag holds at the most recent exposure in any context', () => {
    const history = [exposure(1, 10, 28, [10, 10, 10], AFTER_BENCH), exposure(2, 3, 32, [9, 9, 9], FIRST)];
    const r = nextTargetsFor(request(history, AFTER_BENCH, { sessionPain: { active: true, reportedAtUtc: new Date(T0_MS).toISOString() } }));
    expect(r.result.decision).toBe('halted_pain');
    expect(plan(r)[0]?.[0]).toBe(32);
    expect(r.result.earlierWork).toBeUndefined();
  });
});

describe('SF8: supersets', () => {
  const SUPER_BENCH: WorkContext = { earlier: [{ exerciseId: BENCH, sets: 3 }], supersetWith: [BENCH] };

  it('a same-muscle superset with no such history: SF3 with P counted as if done straight', () => {
    const r = nextTargetsFor(request([exposure(1, 7, 30, [9, 9, 9], FIRST)], SUPER_BENCH));
    expect(plan(r)).toEqual([0, 1, 2].map(() => [30, 8, 8]));
  });

  it('compares only with the same kind: an older superset exposure over a newer straight one at the same P', () => {
    const history = [exposure(1, 14, 26, [10, 10, 10], { earlier: [{ exerciseId: BENCH, sets: 3 }], supersetWith: [BENCH] }), exposure(2, 3, 30, [9, 9, 9], AFTER_BENCH)];
    const r = nextTargetsFor(request(history, SUPER_BENCH));
    expect(r.result.basedOnSessionIds).toEqual([id(1)]);
    expect(plan(r)[0]?.[0]).toBe(28);
    // Straight today: the straight exposure.
    expect(nextTargetsFor(request(history, AFTER_BENCH)).result.basedOnSessionIds).toEqual([id(2)]);
  });

  it('an antagonist pair (bench + row) stays comparable with straight sets', () => {
    const history = [exposure(1, 3, 30, [9, 9, 9], AFTER_BENCH)];
    const r = nextTargetsFor(request(history, { earlier: [{ exerciseId: BENCH, sets: 3 }], supersetWith: [ROW] }));
    expect(r.result.earlierWork?.basis).toBe('comparable');
  });
});

describe('Imported history: order unknown', () => {
  it('only imported history: SF does nothing (never blocks a target)', () => {
    const history = [exposure(1, 7, 30, [9, 9, 9], undefined, { imported: true })];
    const r = nextTargetsFor(request(history, AFTER_BENCH));
    expect(r.result.earlierWork).toBeUndefined();
    expect(plan(r)).toEqual(plan(nextTargetsFor(request(history, undefined))));
  });

  it('a known-context exposure wins over newer imported ones', () => {
    const history = [exposure(1, 20, 28, [10, 10, 10], AFTER_BENCH), exposure(2, 2, 34, [9, 9, 9], undefined, { imported: true })];
    const r = nextTargetsFor(request(history, AFTER_BENCH));
    expect(r.result.basedOnSessionIds).toEqual([id(1)]);
  });
});

describe('SF5: stalls compare like with like', () => {
  it('misses in another context are skipped by the miss stall', () => {
    // After bench 20 days ago: 30 × 9s. Done first 14 and 1 days ago: 30 × 5s (misses, 13 days apart: a stall on their own).
    const history = [exposure(1, 20, 30, [9, 9, 9], AFTER_BENCH), exposure(2, 14, 30, [5, 5, 5], FIRST), exposure(3, 1, 30, [5, 5, 5], FIRST)];
    const plain = nextTargetsFor(request(history, FIRST));
    expect(plain.result.stalled).toBe(true);
    const r = nextTargetsFor(request(history, AFTER_BENCH));
    expect(r.result.stalled).toBeUndefined();
    expect(r.result.basedOnSessionIds).toEqual([id(1)]);
    expect(r.result.decision).toBe('hold');
  });
});
