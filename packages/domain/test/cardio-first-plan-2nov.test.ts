import { describe, expect, it } from 'vitest';
import { WarmupPrefsSchema } from '@fizz/schemas';
import {
  buildFromSetup,
  cardioFirstKey,
  estimateBuilderSeconds,
  findSetRecord,
  fitToMinutes,
  muscleSetCredits,
  oneExerciseChange,
  planAddPreview,
  warmupPrefsOf,
  type BuilderContext,
  type BuilderExtraInfo,
  type BuilderWorkout,
} from '../src/index';
import { context, pool } from './builder-v3-fixture';
import { exercise, id, routineExercise } from './fixtures';

/**
 * (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days"; then "no i am talking
 * about the ability to add that with the coach for the plan") Cardio first is a plan add: the cardio goes into the plan
 * days the coach names, first, as one timed bout. Here: the add at a place with minutes, cardio never a muscle set or a
 * record, the retired `Cardio first` rules still parse but do nothing, and a time fit trims accessories before it.
 */

const BIKE = exercise(9001, 'Exercise bike', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['quads'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'exercise-bike' });
const ROWER = exercise(9002, 'Rowing machine', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['upper_back'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'rowing-erg' });
const SQUAT = exercise(9010, 'Back squat', { movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], mechanic: 'compound' });
const RDL = exercise(9011, 'Romanian deadlift', { movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], mechanic: 'compound' });
const CURL = exercise(9013, 'Dumbbell curl', { movementPattern: 'curl', primaryMuscles: ['biceps'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation' });
const ALL = new Map([BIKE, ROWER, SQUAT, RDL, CURL].map((e) => [e.id, e]));

describe('plan add at a place with minutes (oneExerciseChange, planAddPreview)', () => {
  const rows = [routineExercise(801, { exerciseId: SQUAT.id, order: 0 }), routineExercise(802, { exerciseId: RDL.id, order: 1 })];
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

  it('planAddPreview places it first in every named day, versioned per day', () => {
    const days = [
      { routineId: id(1), name: 'Legs A', version: 3, rows },
      { routineId: id(2), name: 'Legs B', version: 5, rows: [routineExercise(811, { exerciseId: RDL.id, order: 0 }), routineExercise(812, { exerciseId: SQUAT.id, order: 1 })] },
    ];
    const first = planAddPreview(days, { add: BIKE.id, dayNames: ['Legs A', 'legs b'], after: null, position: 'first', rowIdOf: (r) => `${r}-new` });
    expect(first.kind === 'ok' && first.days.map((d) => [d.routineName, d.versionBefore, d.first])).toEqual([
      ['Legs A', 3, true],
      ['Legs B', 5, true],
    ]);
  });
});

describe('cardio is never a muscle set or a record', () => {
  it('no muscle-set credit; no New best', () => {
    expect(muscleSetCredits({ name: BIKE.name, primaryMuscles: BIKE.primaryMuscles, measurement: 'cardio', movementPattern: 'conditioning' } as never).size).toBe(0);
    expect(findSetRecord({ exerciseName: BIKE.name, gymName: null, equipmentId: null, convention: 'bodyweight', measurement: 'cardio', set: { setType: 'working', load: null, reps: null }, history: [] } as never)).toBeNull();
  });
});

describe('the retired Cardio first rules', () => {
  it('a profile stored with them still parses; nothing reads them', () => {
    const stored = { simpleLoads: false, general: [{ days: 'legs', exerciseId: BIKE.id, minutes: 8 }, { days: 'other', exerciseId: ROWER.id, minutes: 4 }] };
    expect(WarmupPrefsSchema.safeParse(stored).success).toBe(true);
    expect(warmupPrefsOf({ warmups: WarmupPrefsSchema.parse(stored) })).toEqual({ simpleLoads: false, perExercise: {} });
  });
});

describe('time: a fit trims accessories before the cardio a day starts with', () => {
  const extra = (exerciseId: string): BuilderExtraInfo | null => (exerciseId === 'bike' ? { exerciseId, name: 'Exercise bike', measurement: 'cardio', repRange: null } : null);
  const ctx: BuilderContext = { ...context(), extra };
  const legDay = (): BuilderWorkout => {
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'squat', supersets: false, groups: [{ group: 'Legs', count: 4 }] }, pool, context()).workout;
    const first = w.blocks[0]?.slots[0];
    if (first === undefined) throw new Error('no slot');
    return { ...w, blocks: [{ slots: [{ ...first, key: 'bike#1', exerciseId: 'bike', main: false, rows: [{ type: 'working' as const, reps: 0, load: null, rpe: null, durationS: 480 }] }], auto: false }, ...w.blocks] };
  };
  const hasBike = (w: BuilderWorkout) => w.blocks.some((b) => b.slots.some((s) => s.exerciseId === 'bike'));

  it('the cardio a day starts with is found (extras, or a groupless all-timed slot); none when it isn’t first', () => {
    expect(cardioFirstKey(legDay(), ctx)).toBe('bike#1');
    expect(cardioFirstKey(legDay(), context())).toBe('bike#1');
    const w = legDay();
    const moved: BuilderWorkout = { ...w, blocks: [...w.blocks.slice(1), ...w.blocks.slice(0, 1)] };
    expect(cardioFirstKey(moved, ctx)).toBeNull();
  });

  it('counted in the estimate like any exercise; a shorter length keeps it and trims or drops accessories', () => {
    const full = estimateBuilderSeconds(legDay(), ctx);
    expect(full).toBeGreaterThan(8 * 60);
    const target = Math.round(full / 60) - 12;
    const fitted = fitToMinutes(legDay(), ctx, { minutes: target, supersets: false, mainGroup: 'Legs', grow: false });
    expect(fitted.status).not.toBe('over');
    expect(hasBike(fitted.workout)).toBe(true);
    expect(fitted.workout.blocks[0]?.slots[0]?.exerciseId).toBe('bike');
    expect(estimateBuilderSeconds(fitted.workout, ctx)).toBeLessThanOrEqual(target * 60 + 29);
  });

  it('only when nothing else can go does the fit leave it out', () => {
    const fitted = fitToMinutes(legDay(), ctx, { minutes: 15, supersets: false, mainGroup: 'Legs', grow: false });
    // The main lift is never cut; at 15 minutes the bike's 8 can't stay with it, so it goes last.
    const left = fitted.workout.blocks.flatMap((b) => b.slots);
    expect(left.map((s) => s.exerciseId)).toContain('squat');
    // Left out only with every other accessory gone too.
    if (!hasBike(fitted.workout)) expect(left.filter((s) => !s.main).map((s) => s.exerciseId)).toEqual([]);
    else expect(left[0]?.exerciseId).toBe('bike');
  });
});
