import { describe, expect, it } from 'vitest';
import type { GeneralWarmupRule, SessionAggregate } from '@fizz/schemas';
import {
  applyTrainingChange,
  buildFromSetup,
  cardioExerciseFor,
  estimateBuilderSeconds,
  fitToMinutes,
  generalWarmupForSession,
  generalWarmupLine,
  generalWarmupRuleFor,
  generalWarmupsEveryDay,
  leadBuilderGroup,
  mergeGeneralWarmups,
  muscleSetCredits,
  oneExerciseChange,
  planAddPreview,
  sessionDayType,
  findSetRecord,
  newTrainingProfile,
  startWorkout,
  warmupPrefsAfter,
  warmupPrefsOf,
  warmupPrefsRevert,
  withGeneralWarmup,
  workoutDayType,
  type BuilderContext,
  type BuilderExtraInfo,
} from '../src/index';
import { context, pool } from './builder-v3-fixture';
import { at, exercise, GYM, id, idGen, kg, lb, profile, routine, routineExercise, template } from './fixtures';

/**
 * (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days") General (cardio)
 * warm-ups: leg-day detection, the rule a workout gets, the insertion at Start, its time in the estimate and fit, and the
 * plan add at a place with minutes.
 */

const BIKE = exercise(9001, 'Exercise bike', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['quads'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'exercise-bike' });
const ROWER = exercise(9002, 'Rowing machine', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['upper_back'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'rowing-erg' });
const AIR = exercise(9003, 'Air bike', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['quads'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'air-bike' });
const SQUAT = exercise(9010, 'Back squat', { movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], mechanic: 'compound' });
const RDL = exercise(9011, 'Romanian deadlift', { movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], mechanic: 'compound' });
const BENCH = exercise(9012, 'Bench press', { movementPattern: 'push', primaryMuscles: ['chest', 'triceps'], mechanic: 'compound' });
const CURL = exercise(9013, 'Dumbbell curl', { movementPattern: 'curl', primaryMuscles: ['biceps'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation' });
const CRUNCH = exercise(9014, 'Cable crunch', { movementPattern: 'core', primaryMuscles: ['abs'], mechanic: 'isolation' });
const ALL = new Map([BIKE, ROWER, AIR, SQUAT, RDL, BENCH, CURL, CRUNCH].map((e) => [e.id, e]));

const LEGS_RULE: GeneralWarmupRule = { days: 'legs', exerciseId: BIKE.id, minutes: 8 };
const OTHER_RULE: GeneralWarmupRule = { days: 'other', exerciseId: ROWER.id, minutes: 4 };
const RULES: GeneralWarmupRule[] = [LEGS_RULE, OTHER_RULE];

/** A just-planned workout of these exercises, `sets` working sets each, in kg or lb. */
function planned(rows: readonly { e: typeof SQUAT; sets: number; warmups?: number }[], unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  let n = 500;
  const rex = rows.map((r, order) =>
    routineExercise(400 + order, {
      exerciseId: r.e.id,
      order,
      setTemplates: [
        ...Array.from({ length: r.warmups ?? 0 }, () => template((n += 1), { setType: 'warmup', targetReps: { min: 5, max: 5 } })),
        ...Array.from({ length: r.sets }, () =>
          r.e.measurement === 'cardio'
            ? template((n += 1), { targetReps: null, targetDurationS: 600 })
            : template((n += 1), { targetLoad: unit === 'kg' ? kg(60, r.e.defaultLoadConvention) : lb(135, r.e.defaultLoadConvention), targetReps: { min: 8, max: 10 } }),
        ),
      ],
    }),
  );
  return startWorkout({ opId: 'start', owner: profile({ preferredUnit: unit }), gymId: GYM, routine: routine(rex), exercises: ALL, gymEquipment: [], at: at(0), newId: idGen(60_000) }).aggregate;
}

const factsOf = (exerciseId: string) => ALL.get(exerciseId) ?? null;
const names = (a: SessionAggregate) => [...a.exercises].sort((x, y) => x.order - y.order).map((e) => e.exerciseName);

describe('leg days (workoutDayType)', () => {
  it('lead group decides: squat + RDL is legs, bench + curl is other', () => {
    expect(workoutDayType([{ group: 'Legs', sets: 4 }, { group: 'Legs', sets: 3 }])).toBe('legs');
    expect(workoutDayType([{ group: 'Chest', sets: 4 }, { group: 'Arms', sets: 3 }])).toBe('other');
  });

  it('mixed days: the majority of working sets; a tie goes by the first strength lift; core counts for neither', () => {
    // Upper/lower full body, 6 lower vs 9 upper: other.
    expect(workoutDayType([{ group: 'Legs', sets: 3 }, { group: 'Chest', sets: 3 }, { group: 'Back', sets: 3 }, { group: 'Legs', sets: 3 }, { group: 'Arms', sets: 3 }])).toBe('other');
    // Tie, squat first: legs. Tie, bench first: other.
    expect(workoutDayType([{ group: 'Legs', sets: 3 }, { group: 'Chest', sets: 3 }])).toBe('legs');
    expect(workoutDayType([{ group: 'Chest', sets: 3 }, { group: 'Legs', sets: 3 }])).toBe('other');
    // Lots of abs on a leg day don't make it another day; a core-first tie goes by the first non-core lift.
    expect(workoutDayType([{ group: 'Core', sets: 9 }, { group: 'Legs', sets: 3 }, { group: 'Shoulders', sets: 3 }])).toBe('legs');
    // Only core: another day. No strength work at all (empty, cardio only): null.
    expect(workoutDayType([{ group: 'Core', sets: 3 }])).toBe('other');
    expect(workoutDayType([{ group: null, sets: 1 }])).toBeNull();
    expect(workoutDayType([])).toBeNull();
  });

  it('lead builder group: first primary muscle with a group; cardio has none', () => {
    expect(leadBuilderGroup(SQUAT)).toBe('Legs');
    expect(leadBuilderGroup(BENCH)).toBe('Chest');
    expect(leadBuilderGroup(BIKE)).toBeNull();
  });

  it('the rule for a day: its own, else every day, else none', () => {
    expect(generalWarmupRuleFor(RULES, 'legs')?.exerciseId).toBe(BIKE.id);
    expect(generalWarmupRuleFor(RULES, 'other')?.exerciseId).toBe(ROWER.id);
    expect(generalWarmupRuleFor([{ days: 'all', exerciseId: ROWER.id, minutes: 5 }, { days: 'legs', exerciseId: BIKE.id, minutes: 8 }], 'other')?.exerciseId).toBe(ROWER.id);
    expect(generalWarmupRuleFor([{ days: 'legs', exerciseId: BIKE.id, minutes: 8 }], 'other')).toBeNull();
    expect(generalWarmupRuleFor(RULES, null)).toBeNull();
  });
});

describe('Start puts the general warm-up first (withGeneralWarmup)', () => {
  it('leg day: Exercise bike 8:00 first, one pending cardio set, active; push day: rower 4:00', () => {
    const legs = planned([{ e: SQUAT, sets: 3, warmups: 2 }, { e: RDL, sets: 3 }]);
    expect(sessionDayType(legs, factsOf)).toBe('legs');
    const rule = generalWarmupForSession(legs, RULES, factsOf);
    expect(rule?.exerciseId).toBe(BIKE.id);
    const out = withGeneralWarmup(legs, { rule: rule ?? LEGS_RULE, exercise: BIKE, owner: profile(), newId: idGen(70_000) });
    expect(names(out)).toEqual(['Exercise bike', 'Back squat', 'Romanian deadlift']);
    const head = [...out.exercises].sort((x, y) => x.order - y.order)[0];
    const set = out.sets.filter((s) => s.sessionExerciseId === head?.id);
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({ setType: 'working', status: 'pending', planned: { load: null, reps: null, durationS: 480 } });
    expect(out.session.activeSetId).toBe(set[0]?.id);
    // Nothing else changed: same sets, same targets.
    expect(out.sets.filter((s) => s.sessionExerciseId !== head?.id)).toEqual(legs.sets);

    const push = planned([{ e: BENCH, sets: 4 }, { e: CURL, sets: 3 }]);
    const pr = generalWarmupForSession(push, RULES, factsOf);
    expect(pr?.exerciseId).toBe(ROWER.id);
    const pushOut = withGeneralWarmup(push, { rule: pr ?? OTHER_RULE, exercise: ROWER, owner: profile(), newId: idGen(71_000) });
    expect(names(pushOut)[0]).toBe('Rowing machine');
    expect(pushOut.sets.find((s) => s.planned.durationS === 240)).toBeDefined();
  });

  it('lb owner: the cardio row takes his unit; nothing has a load', () => {
    const push = planned([{ e: BENCH, sets: 3 }, { e: CURL, sets: 2 }], 'lb');
    const out = withGeneralWarmup(push, { rule: OTHER_RULE, exercise: ROWER, owner: profile({ preferredUnit: 'lb' }), newId: idGen(72_000) });
    const head = [...out.exercises].sort((x, y) => x.order - y.order)[0];
    expect(head?.unit).toBe('lb');
    expect(out.sets.find((s) => s.sessionExerciseId === head?.id)?.planned.load).toBeNull();
  });

  it('no warm-up: already starts with cardio (a repeat of one that had it), already has it, no strength work, no rule', () => {
    const withBike = withGeneralWarmup(planned([{ e: SQUAT, sets: 3 }]), { rule: LEGS_RULE, exercise: BIKE, owner: profile(), newId: idGen(73_000) });
    expect(generalWarmupForSession(withBike, RULES, factsOf)).toBeNull();
    expect(generalWarmupForSession(planned([{ e: SQUAT, sets: 3 }, { e: BIKE, sets: 1 }]), RULES, factsOf)).toBeNull();
    expect(generalWarmupForSession(planned([{ e: ROWER, sets: 1 }]), RULES, factsOf)).toBeNull();
    expect(generalWarmupForSession(planned([{ e: SQUAT, sets: 3 }]), [], factsOf)).toBeNull();
    expect(generalWarmupForSession(planned([{ e: SQUAT, sets: 3 }]), undefined, factsOf)).toBeNull();
  });

  it('never on a workout with a set done (rule 2), never a non-cardio exercise', () => {
    const a = planned([{ e: SQUAT, sets: 2 }]);
    const done: SessionAggregate = { ...a, sets: a.sets.map((s, i) => (i === 0 ? { ...s, status: 'completed' } : s)) };
    expect(withGeneralWarmup(done, { rule: LEGS_RULE, exercise: BIKE, owner: profile(), newId: idGen(74_000) })).toBe(done);
    expect(withGeneralWarmup(a, { rule: { days: 'legs', exerciseId: SQUAT.id, minutes: 8 }, exercise: SQUAT, owner: profile(), newId: idGen(74_100) })).toBe(a);
  });

  it('never a muscle set, a PB or volume: cardio has no lead group and no record', () => {
    expect(muscleSetCredits({ name: BIKE.name, primaryMuscles: BIKE.primaryMuscles, measurement: 'cardio', movementPattern: 'conditioning' } as never).size).toBe(0);
    expect(findSetRecord({ exerciseName: BIKE.name, gymName: null, equipmentId: null, convention: 'bodyweight', measurement: 'cardio', set: { setType: 'working', load: null, reps: null }, history: [] } as never)).toBeNull();
  });
});

describe('prefs: stored, merged, Undo', () => {
  it('the coach’s entries merge by kind of day; `all` replaces legs and other; minutes 0 turns one off', () => {
    const both = mergeGeneralWarmups(undefined, [{ days: 'legs', exerciseId: BIKE.id, minutes: 8 }, { days: 'other', exerciseId: ROWER.id, minutes: 4 }]);
    expect(both).toEqual(RULES);
    expect(mergeGeneralWarmups(both, [{ days: 'legs', exerciseId: BIKE.id, minutes: 10 }])).toEqual([{ days: 'legs', exerciseId: BIKE.id, minutes: 10 }, RULES[1]]);
    expect(mergeGeneralWarmups(both, [{ days: 'all', exerciseId: ROWER.id, minutes: 5 }])).toEqual([{ days: 'all', exerciseId: ROWER.id, minutes: 5 }]);
    expect(mergeGeneralWarmups(both, [{ days: 'other', exerciseId: null, minutes: 0 }])).toEqual([RULES[0]]);
    // Minutes kept within 1–30.
    expect(mergeGeneralWarmups(undefined, [{ days: 'legs', exerciseId: BIKE.id, minutes: 90 }])[0]?.minutes).toBe(30);
  });

  it('Same every day on and off', () => {
    expect(generalWarmupsEveryDay(RULES, true)).toEqual([{ days: 'all', exerciseId: BIKE.id, minutes: 8 }]);
    expect(generalWarmupsEveryDay([{ days: 'all', exerciseId: ROWER.id, minutes: 5 }], false)).toEqual([
      { days: 'legs', exerciseId: ROWER.id, minutes: 5 },
      { days: 'other', exerciseId: ROWER.id, minutes: 5 },
    ]);
  });

  it('a profile change stores them with the other warm-up settings; Undo puts the old ones back; one per kind of day', () => {
    const p0 = { warmups: { simpleLoads: false } };
    const after = warmupPrefsAfter(p0.warmups, { kind: 'warmup_prefs', general: RULES });
    expect(after).toEqual({ simpleLoads: false, general: RULES });
    expect(warmupPrefsOf({ warmups: after ?? undefined }).general).toEqual(RULES);
    expect(warmupPrefsAfter(after, { kind: 'warmup_prefs', simpleLoads: true })).toEqual({ general: RULES });
    const revert = warmupPrefsRevert(p0.warmups, after);
    expect(warmupPrefsAfter(after, revert)).toEqual({ simpleLoads: false });
    expect(warmupPrefsAfter(after, { kind: 'warmup_prefs', general: null })).toEqual({ simpleLoads: false });
  });

  it('the training profile refuses two rules for the same kind of day; a good change is one versioned write', () => {
    const tp = newTrainingProfile({ id: id(3), ownerId: id(1), atUtc: at(0).utc });
    const w = (opId: string) => ({ opId, expectedVersion: tp.version, atUtc: at(0).utc, nowYear: 2026, today: '2026-10-08' });
    const bad = applyTrainingChange(tp, { kind: 'warmup_prefs', general: [LEGS_RULE, { ...LEGS_RULE, minutes: 3 }] }, w('op-bad'));
    expect(bad).toMatchObject({ ok: false, error: 'invalid' });
    const good = applyTrainingChange(tp, { kind: 'warmup_prefs', general: RULES }, w('op-good'));
    if (!good.ok) throw new Error(good.error);
    expect(good.profile.warmups).toEqual({ general: RULES });
    expect(good.profile.version).toBe(tp.version + 1);
    // Stale version: refused (rule 5).
    expect(applyTrainingChange(good.profile, { kind: 'warmup_prefs', general: null }, w('op-stale'))).toMatchObject({ ok: false, error: 'stale' });
  });

  it('Profile’s line and the cardio word Ben uses', () => {
    expect(generalWarmupLine(RULES, (x) => ALL.get(x)?.name ?? '?')).toBe('Leg days · Exercise bike 8 min · Other days · Rowing machine 4 min');
    expect(generalWarmupLine([{ days: 'all', exerciseId: ROWER.id, minutes: 5 }], (x) => ALL.get(x)?.name ?? '?')).toBe('Rowing machine 5 min');
    expect(generalWarmupLine(undefined, () => '?')).toBe('Off');
    const list = [...ALL.values()];
    expect(cardioExerciseFor('bike', list)?.id).toBe(BIKE.id);
    expect(cardioExerciseFor('air bike', list)?.id).toBe(AIR.id);
    expect(cardioExerciseFor('rowing', list)?.id).toBe(ROWER.id);
    expect(cardioExerciseFor('rowing-erg', list)?.id).toBe(ROWER.id);
    expect(cardioExerciseFor('squat', list)).toBeNull();
  });
});

describe('time: the estimate and the fit count it', () => {
  const extra = (exerciseId: string): BuilderExtraInfo | null => (exerciseId === 'bike' || exerciseId === 'rower' ? { exerciseId, name: exerciseId, measurement: 'cardio', repRange: null } : null);
  const rules: GeneralWarmupRule[] = [
    { days: 'legs', exerciseId: 'bike', minutes: 8 },
    { days: 'other', exerciseId: 'rower', minutes: 4 },
  ];
  const plain = context();
  const withRules: BuilderContext = { ...plain, extra, warmupPrefs: { simpleLoads: true, perExercise: {}, general: rules } };
  const legDay = () => buildFromSetup({ minutes: 999, mainLiftExerciseId: 'squat', supersets: false, groups: [{ group: 'Legs', count: 4 }] }, pool, plain).workout;
  const chestDay = () => buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 1 }] }, pool, plain).workout;

  it('leg day +8 min and a changeover; chest day +4 min', () => {
    expect(estimateBuilderSeconds(legDay(), withRules) - estimateBuilderSeconds(legDay(), plain)).toBe(8 * 60 + 60);
    expect(estimateBuilderSeconds(chestDay(), withRules) - estimateBuilderSeconds(chestDay(), plain)).toBe(4 * 60 + 60);
  });

  it('a workout that already starts with the bike (the coach put it first) is not counted twice', () => {
    const w = legDay();
    const first = w.blocks[0]?.slots[0];
    if (first === undefined) throw new Error('no slot');
    const bikeFirst = { ...w, blocks: [{ slots: [{ ...first, key: 'bike#1', exerciseId: 'bike', rows: [{ type: 'working' as const, reps: 0, load: null, rpe: null, durationS: 480 }] }], auto: false }, ...w.blocks] };
    expect(estimateBuilderSeconds(bikeFirst, withRules) - estimateBuilderSeconds(bikeFirst, plain)).toBe(0);
  });

  it('fit-to-time makes room for it: the fitted leg day is shorter by about the warm-up, and the warm-up is never cut', () => {
    const full = estimateBuilderSeconds(legDay(), plain);
    // A length the plain day has to shrink to, and both can reach.
    const target = Math.round(full / 60) - 2;
    const fitted = fitToMinutes(legDay(), withRules, { minutes: target, supersets: false, mainGroup: 'Legs', grow: false });
    const without = fitToMinutes(legDay(), plain, { minutes: target, supersets: false, mainGroup: 'Legs', grow: false });
    // Both land at the time asked (the warm-up's 9 minutes inside it), so the one with it keeps less lifting.
    expect(estimateBuilderSeconds(fitted.workout, withRules)).toBeLessThanOrEqual(target * 60 + 29);
    expect(estimateBuilderSeconds(fitted.workout, plain)).toBeLessThan(estimateBuilderSeconds(without.workout, plain));
    // It is still there after the fit (not a slot the fit can cut): the estimate still has its 9 minutes.
    expect(estimateBuilderSeconds(fitted.workout, withRules) - estimateBuilderSeconds(fitted.workout, plain)).toBe(9 * 60);
  });
});

describe('plan add at a place with minutes (oneExerciseChange, planAddPreview)', () => {
  const rows = [
    routineExercise(801, { exerciseId: SQUAT.id, order: 0 }),
    routineExercise(802, { exerciseId: RDL.id, order: 1 }),
  ];
  const measurementOf = (x: string) => ALL.get(x)?.measurement ?? 'reps';

  it('first, with 8 minutes: one cardio set of 8:00, before every row', () => {
    const out = oneExerciseChange(rows, { kind: 'add', rowId: id(899), fromExerciseId: null, toExerciseId: BIKE.id, afterRowId: null, first: true, sets: 1, durationS: 480 }, measurementOf);
    expect(out.map((r) => r.exerciseId)).toEqual([BIKE.id, SQUAT.id, RDL.id]);
    expect(out.map((r) => r.order)).toEqual([0, 1, 2]);
    expect(out[0]?.setTemplates).toHaveLength(1);
    expect(out[0]?.setTemplates[0]).toMatchObject({ targetReps: null, targetDurationS: 480, targetLoad: null });
  });

  it('straight before a named row, with a distance; after a row; at the end', () => {
    const before = oneExerciseChange(rows, { kind: 'add', rowId: id(898), fromExerciseId: null, toExerciseId: ROWER.id, beforeRowId: id(802), sets: 1, distanceM: 2000 }, measurementOf);
    expect(before.map((r) => r.exerciseId)).toEqual([SQUAT.id, ROWER.id, RDL.id]);
    expect(before[1]?.setTemplates[0]).toMatchObject({ targetDistanceM: 2000, targetDurationS: null });
    const end = oneExerciseChange(rows, { kind: 'add', rowId: id(897), fromExerciseId: null, toExerciseId: CURL.id, afterRowId: null, sets: 2, reps: { min: 10, max: 12 } }, measurementOf);
    expect(end.map((r) => r.exerciseId)).toEqual([SQUAT.id, RDL.id, CURL.id]);
  });

  it('planAddPreview places it first in every day, or before an exercise where the day has it (first when it leads)', () => {
    const days = [
      { routineId: id(1), name: 'Legs A', version: 3, rows: rows },
      { routineId: id(2), name: 'Legs B', version: 5, rows: [routineExercise(811, { exerciseId: RDL.id, order: 0 }), routineExercise(812, { exerciseId: SQUAT.id, order: 1 })] },
    ];
    const first = planAddPreview(days, { add: BIKE.id, dayNames: ['Legs A', 'legs b'], after: null, position: 'first', rowIdOf: (r) => `${r}-new` });
    expect(first.kind === 'ok' && first.days.map((d) => [d.routineName, d.versionBefore, d.first])).toEqual([['Legs A', 3, true], ['Legs B', 5, true]]);
    const before = planAddPreview(days, { add: BIKE.id, dayNames: ['Legs A', 'Legs B'], after: null, position: 'before', before: RDL.id, rowIdOf: (r) => `${r}-new` });
    if (before.kind !== 'ok') throw new Error(before.kind);
    expect(before.days[0]).toMatchObject({ beforeRowId: id(802), afterRowId: id(801) });
    expect(before.days[1]).toMatchObject({ first: true });
  });
});

describe('the cardio set count in a fixture with crunches: core-only days', () => {
  it('a core-only workout gets the other-days rule', () => {
    const a = planned([{ e: CRUNCH, sets: 3 }]);
    expect(generalWarmupForSession(a, RULES, factsOf)?.exerciseId).toBe(ROWER.id);
  });
});
