import type { PlanDraft, Routine, RoutineExercise } from '@fizz/schemas';
import { planRoutines } from '../session/coach-plan';
import { mainFlags, rotationRoutines } from '../session/routines';

/**
 * `Targets hit 5 of last 6` (Ben, 20 Oct: "Let's only show targets hit on
 * main lift if turned on in settings"): shown only with the setting on, and
 * only for a main lift. Pure.
 */

type MainExercise = Pick<RoutineExercise, 'exerciseId' | 'main' | 'order'>;

export interface MainLiftSources {
  /** Each split day's main lift in Profile (Ben's, else the recommended one); null: none. */
  dayMainLifts: readonly (string | null | undefined)[];
  /** The workouts that count (`mainLiftRoutines`): an exercise marked `Main` in one is a main lift. */
  routines: readonly { exercises: readonly MainExercise[] }[];
  /** For a workout saved before `Main` was stored: the rule decides (`mainFlags`). */
  isCompound: (exerciseId: string) => boolean;
}

/**
 * One workout's main lifts: `Main` as stored, else the rule (compounds in the
 * first two places, else the first), read in `order` (review S2).
 */
export function routineMainLiftIds(exercises: readonly MainExercise[], isCompound: (exerciseId: string) => boolean): Set<string> {
  const sorted = [...exercises].sort((a, b) => a.order - b.order);
  const flags = mainFlags(sorted, isCompound);
  const out = new Set<string>();
  sorted.forEach((e, i) => {
    if (flags[i] === true) out.add(e.exerciseId);
  });
  return out;
}

/**
 * The workouts whose `Main` flags count (review S1): those in the rotation and
 * the applied plan's days. A workout out of rotation or left from an ended
 * plan doesn't make a main lift.
 */
export function mainLiftRoutines<R extends Pick<Routine, 'id' | 'createdAtUtc' | 'deletedAtUtc' | 'inRotation' | 'rotationAtUtc' | 'createdFromPlan'>>(
  live: readonly R[],
  applied: Pick<PlanDraft, 'id' | 'status' | 'applied'> | null,
): R[] {
  const out = new Map<string, R>();
  for (const r of rotationRoutines(live)) out.set(r.id, r);
  for (const r of planRoutines(applied, live)) out.set(r.id, r);
  return [...out.values()];
}

/** Every main lift: a split day's main lift, or `Main` in a workout that counts. */
export function mainLiftIds(src: MainLiftSources): Set<string> {
  const out = new Set<string>();
  for (const id of src.dayMainLifts) if (id != null) out.add(id);
  for (const r of src.routines) for (const id of routineMainLiftIds(r.exercises, src.isCompound)) out.add(id);
  return out;
}

/** Whether an exercise is one of the main lifts (`mainLiftIds`, or a plan day's own, `routineMainLiftIds`). */
export function isMainLift(exerciseId: string, mains: ReadonlySet<string>): boolean {
  return mains.has(exerciseId);
}

/** Whether `Targets hit` shows for an exercise: the setting on and a main lift. */
export function showsTargetsHit(opts: { on: boolean; main: boolean }): boolean {
  return opts.on && opts.main;
}

/** The `Targets hit` line to show (`showsTargetsHit`), else null. */
export function targetsHitShown(hitText: string | null, opts: { on: boolean; main: boolean }): string | null {
  return showsTargetsHit(opts) ? hitText : null;
}
