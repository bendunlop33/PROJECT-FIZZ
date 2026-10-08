import { expect } from 'vitest';
import type { Exercise, SessionAggregate, SessionCommand, SetValues, WorkoutSet } from '@fizz/schemas';
import { reduceSession, startWorkout, type ReduceResult, type StartWorkoutInput } from '../src/index';
import {
  at,
  barbell,
  exercise,
  GYM,
  id,
  idGen,
  kg,
  profile,
  routine,
  routineExercise,
  stack,
  template,
} from './fixtures';

export const BENCH = id(200);
export const ROW = id(201);
export const FACE = id(202);
export const HANG = id(203);

export const exercises = new Map<string, Exercise>([
  [BENCH, exercise(200, 'Bench press', { defaultRestS: 120 })],
  [ROW, exercise(201, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [FACE, exercise(202, 'Face pull', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [
    HANG,
    exercise(203, 'Dead hang', {
      measurement: 'duration',
      compatibleEquipment: ['bodyweight_station'],
      defaultLoadConvention: 'bodyweight',
    }),
  ],
]);

export interface FixtureOptions {
  supersetTransitionS?: number | null;
  benchTransitionS?: number | null;
  benchTarget?: number;
}

/**
 * Push A: Bench (1 warm-up + 2 working), superset A (Cable row ×2, Face pull ×2),
 * Dead hang ×1 (timed). Execution order: W, B1, B2, R1, F1, R2, F2, H1.
 */
export function startFixture(opts: FixtureOptions = {}): { state: SessionAggregate; input: StartWorkoutInput } {
  const r = routine([
    routineExercise(500, {
      exerciseId: BENCH,
      equipmentId: barbell().id,
      order: 0,
      setTemplates: [
        template(5001, { setType: 'warmup', targetLoad: kg(60), targetReps: { min: 10, max: 10 } }),
        template(5002, { targetLoad: kg(opts.benchTarget ?? 100) }),
        template(5003, { targetLoad: kg(opts.benchTarget ?? 100) }),
      ],
      restBySetType: { warmup: { seconds: 60, presetName: 'Warm-up' }, working: { seconds: 180, presetName: 'Heavy' } },
      transitionRestS: opts.benchTransitionS ?? null,
    }),
    routineExercise(501, {
      exerciseId: ROW,
      equipmentId: stack().id,
      order: 1,
      supersetGroup: 'A',
      setTemplates: [
        template(5011, { targetLoad: kg(50, 'stack'), targetReps: { min: 10, max: 12 } }),
        template(5012, { targetLoad: kg(50, 'stack'), targetReps: { min: 10, max: 12 } }),
      ],
      transitionRestS: opts.supersetTransitionS ?? null,
    }),
    routineExercise(502, {
      exerciseId: FACE,
      equipmentId: stack().id,
      order: 2,
      supersetGroup: 'A',
      setTemplates: [
        template(5021, { targetLoad: kg(20, 'stack'), targetReps: { min: 12, max: 15 } }),
        template(5022, { targetLoad: kg(20, 'stack'), targetReps: { min: 12, max: 15 } }),
      ],
    }),
    routineExercise(503, {
      exerciseId: HANG,
      order: 3,
      setTemplates: [template(5031, { targetReps: null, targetDurationS: 45 })],
    }),
  ]);
  const input: StartWorkoutInput = {
    opId: 'start-1',
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises,
    gymEquipment: [barbell(), stack()],
    at: at(0),
    newId: idGen(),
  };
  return { state: startWorkout(input).aggregate, input };
}

export function expectOk(result: ReduceResult): Extract<ReduceResult, { ok: true }> {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`);
  return result;
}

export function apply(state: SessionAggregate, cmd: SessionCommand): SessionAggregate {
  return expectOk(reduceSession(state, cmd)).state;
}

export function expectError(result: ReduceResult, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

/** Sets in execution order, by exercise. */
export function setsFor(state: SessionAggregate, exerciseId: string): WorkoutSet[] {
  const ex = state.exercises.find((e) => e.exerciseId === exerciseId);
  return state.sets.filter((s) => s.sessionExerciseId === ex?.id).sort((a, b) => a.index - b.index);
}

let timerCounter = 90_000;
export function logCmd(setId: string, values: SetValues, seconds: number, opId = `op-${setId}-${seconds}`): SessionCommand {
  timerCounter += 1;
  return { type: 'log_set', at: at(seconds), opId, setId, values, restTimerId: id(timerCounter) };
}
