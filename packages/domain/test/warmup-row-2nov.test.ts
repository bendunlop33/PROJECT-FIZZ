import { describe, expect, it } from 'vitest';
import type { Exercise, RoutineExercise, WorkoutDraft } from '@fizz/schemas';
import {
  draftAsRoutine,
  estimateBuilderSeconds,
  fromDraftPlan,
  oneExerciseChange,
  planDayFromTemplates,
  startWorkout,
  toDraftPlan,
  workoutFromTemplate,
  type BuilderContext,
  type BuilderExtraInfo,
  type BuilderWorkout,
} from '../src/index';
import { context, info } from './builder-v3-fixture';
import { at, exercise, GYM, id, idGen, profile, routine, routineExercise } from './fixtures';

/**
 * (Ben, 2 Nov: "yes if i ask for it. to be clear the warm-up could be any cardio exercise") A row-level `warmup` mark
 * on a cardio or timed row Ben asked for as a warm-up. Its sets stay working sets. It survives the plan day's edit,
 * Your workout (template → builder → draft → routine) and Start; a lift is never marked; a swap to a lift drops it;
 * the time estimate is the same with or without it (counted once, as the timed set it is).
 */

const BIKE = exercise(9101, 'Exercise bike', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['quads'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'exercise-bike' });
const STAIRS = exercise(9102, 'Stair climber', { measurement: 'cardio', movementPattern: 'conditioning', primaryMuscles: ['quads'], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', catalogueKey: 'stair-climber' });
const SQUAT = exercise(9110, 'Back squat', { movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], mechanic: 'compound' });
const CURL = exercise(9113, 'Dumbbell curl', { movementPattern: 'curl', primaryMuscles: ['biceps'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation' });
const ALL = new Map<string, Exercise>([BIKE, STAIRS, SQUAT, CURL].map((e) => [e.id, e]));
const measurementOf = (x: string) => ALL.get(x)?.measurement ?? 'reps';
const rows = [routineExercise(901, { exerciseId: SQUAT.id, order: 0 })];

describe('the plan day row', () => {
  it('a cardio add Ben asked for as a warm-up is marked, first, with working sets only', () => {
    const out = oneExerciseChange(rows, { kind: 'add', rowId: id(990), fromExerciseId: null, toExerciseId: STAIRS.id, afterRowId: null, first: true, sets: 1, durationS: 300, warmup: true }, measurementOf);
    expect(out.map((r) => [r.exerciseId, r.warmup])).toEqual([
      [STAIRS.id, true],
      [SQUAT.id, undefined],
    ]);
    expect(out[0]?.setTemplates.map((t) => [t.setType, t.targetDurationS])).toEqual([['working', 300]]);
  });

  it('without the flag, and on a lift, nothing is marked', () => {
    const plain = oneExerciseChange(rows, { kind: 'add', rowId: id(991), fromExerciseId: null, toExerciseId: BIKE.id, afterRowId: null, sets: 1, durationS: 600 }, measurementOf);
    expect(plain.some((r) => r.warmup === true)).toBe(false);
    const lift = oneExerciseChange(rows, { kind: 'add', rowId: id(992), fromExerciseId: null, toExerciseId: CURL.id, afterRowId: null, first: true, sets: 2, warmup: true }, measurementOf);
    expect(lift.some((r) => r.warmup === true)).toBe(false);
  });

  it('a swap keeps the mark for cardio coming in, drops it for a lift', () => {
    const marked = oneExerciseChange(rows, { kind: 'add', rowId: id(993), fromExerciseId: null, toExerciseId: BIKE.id, afterRowId: null, first: true, sets: 1, durationS: 480, warmup: true }, measurementOf);
    const toStairs = oneExerciseChange(marked, { kind: 'swap', rowId: id(993), fromExerciseId: BIKE.id, toExerciseId: STAIRS.id }, measurementOf);
    expect(toStairs[0]?.warmup).toBe(true);
    const toCurl = oneExerciseChange(marked, { kind: 'swap', rowId: id(993), fromExerciseId: BIKE.id, toExerciseId: CURL.id }, measurementOf);
    expect(toCurl[0]?.exerciseId).toBe(CURL.id);
    expect(toCurl[0]?.warmup).toBeUndefined();
  });

  it('the plan day’s meta reads Warm-up on that row only', () => {
    const day = oneExerciseChange(rows, { kind: 'add', rowId: id(994), fromExerciseId: null, toExerciseId: BIKE.id, afterRowId: null, first: true, sets: 1, durationS: 480, warmup: true }, measurementOf);
    const d = planDayFromTemplates({ dayN: 1, of: 3, gymName: null, routine: { exercises: day }, exerciseOf: (x) => ALL.get(x) ?? null, unit: 'kg', history: () => [], targetsHit: () => false });
    expect(d.rows.map((r) => [r.name, r.line, r.sub])).toEqual([
      ['Exercise bike', '8 min', 'Warm-up'],
      ['Back squat', expect.any(String), null],
    ]);
  });
});

describe('carried from the plan day to the workout', () => {
  it('Start copies it to the session row', () => {
    const r = routine([routineExercise(920, { exerciseId: BIKE.id, order: 0, warmup: true, setTemplates: [{ id: id(9201), setType: 'working', targetLoad: null, targetReps: null, targetDurationS: 480, targetRpe: null, targetRir: null, restOverrideS: null }] }), routineExercise(921, { exerciseId: SQUAT.id, order: 1 })]);
    const a = startWorkout({ opId: 'warm-start', owner: profile(), gymId: GYM, routine: r, exercises: ALL, gymEquipment: [], at: at(0), newId: idGen(92_000) }).aggregate;
    const sorted = [...a.exercises].sort((x, y) => x.order - y.order);
    expect(sorted.map((e) => [e.exerciseId, e.warmup])).toEqual([
      [BIKE.id, true],
      [SQUAT.id, undefined],
    ]);
    expect(a.sets.filter((s) => s.sessionExerciseId === sorted[0]?.id).map((s) => [s.setType, s.planned.durationS])).toEqual([['working', 480]]);
  });

  it('a lift row carrying the mark (a swap in Ben’s own editor) is never marked at Start or on the plan day', () => {
    const r = routine([routineExercise(925, { exerciseId: CURL.id, order: 0, warmup: true })]);
    const a = startWorkout({ opId: 'warm-lift', owner: profile(), gymId: GYM, routine: r, exercises: ALL, gymEquipment: [], at: at(0), newId: idGen(92_500) }).aggregate;
    expect(a.exercises[0]?.warmup).toBeUndefined();
    const d = planDayFromTemplates({ dayN: 1, of: 1, gymName: null, routine: r, exerciseOf: (x) => ALL.get(x) ?? null, unit: 'kg', history: () => [], targetsHit: () => false });
    expect(d.rows[0]?.sub).toBeNull();
  });

  const extra = (x: string): BuilderExtraInfo | null => (x === 'bike' ? { exerciseId: x, name: 'Exercise bike', measurement: 'cardio', repRange: null } : null);
  const ctx: BuilderContext = { ...context(), extra };

  it('Your workout opens the timed row with its work time and mark; the draft codec and Start keep both', () => {
    const w = workoutFromTemplate(
      [
        { exerciseId: 'bike', main: false, workingSets: 1, group: null, workS: 480, warmup: true },
        { exerciseId: 'squat', main: true, workingSets: 3, group: null },
      ],
      ctx,
    );
    const bike = w.blocks[0]?.slots[0];
    expect([bike?.exerciseId, bike?.warmup, bike?.rows.map((r) => r.durationS)]).toEqual(['bike', true, [480]]);
    expect(w.blocks[1]?.slots[0]?.warmup).toBeUndefined();
    const plan = toDraftPlan(w, { info, catalogueIdOf: (x) => x, checkedOnOf: () => null });
    expect(plan.slots.map((s) => s.warmup)).toEqual([true, undefined]);
    expect(fromDraftPlan(plan).blocks[0]?.slots[0]?.warmup).toBe(true);
    const draft = { id: id(930), ownerId: id(1), name: 'Legs A', createdAt: at(0), updatedAtUtc: at(0).utc, version: 1 } as Pick<WorkoutDraft, 'id' | 'ownerId' | 'name' | 'createdAt' | 'updatedAtUtc' | 'version'>;
    const asRoutine = draftAsRoutine(draft, { n: 1, createdAt: at(0), plan } as never);
    expect(asRoutine.exercises.map((e: RoutineExercise) => [e.exerciseId, e.warmup])).toEqual([
      ['bike', true],
      ['squat', undefined],
    ]);
  });

  it('a lift in the template is never opened as a warm-up row', () => {
    const w = workoutFromTemplate([{ exerciseId: 'squat', main: true, workingSets: 3, group: null, warmup: true }], ctx);
    expect(w.blocks[0]?.slots[0]?.warmup).toBeUndefined();
  });

  it('time: the warm-up cardio counts once, exactly as the same unmarked cardio (no extra warm-up allowance)', () => {
    const build = (warmup: boolean): BuilderWorkout => workoutFromTemplate([{ exerciseId: 'bike', main: false, workingSets: 1, group: null, workS: 480, warmup }, { exerciseId: 'squat', main: true, workingSets: 3, group: null }], ctx);
    const marked = estimateBuilderSeconds(build(true), ctx);
    expect(marked).toBe(estimateBuilderSeconds(build(false), ctx));
    const noBike = workoutFromTemplate([{ exerciseId: 'squat', main: true, workingSets: 3, group: null }], ctx);
    // The 8 minutes are in it (plus a set's change-over), never counted twice.
    expect(marked - estimateBuilderSeconds(noBike, ctx)).toBeGreaterThanOrEqual(480);
    expect(marked - estimateBuilderSeconds(noBike, ctx)).toBeLessThan(480 + 240);
  });
});
