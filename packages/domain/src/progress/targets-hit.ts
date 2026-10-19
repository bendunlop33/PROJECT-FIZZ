import type { RoutineExercise } from '@fizz/schemas';
import { mainFlags } from '../session/routines';

/**
 * `Targets hit 5 of last 6` (Ben, 20 Oct: "Let's only show targets hit on
 * main lift if turned on in settings"): shown only with the setting on, and
 * only for a main lift. Pure.
 */

export interface MainLiftSources {
  /** Each split day's main lift in Profile (Ben's, else the recommended one); null: none. */
  dayMainLifts: readonly (string | null | undefined)[];
  /** His live workouts (plan days included): an exercise marked `Main` in one is a main lift. */
  routines: readonly { exercises: readonly Pick<RoutineExercise, 'exerciseId' | 'main'>[] }[];
  /** For a workout saved before `Main` was stored: the rule decides (`mainFlags`). */
  isCompound: (exerciseId: string) => boolean;
}

/** Every main lift: a split day's main lift, or `Main` in a workout. */
export function mainLiftIds(src: MainLiftSources): Set<string> {
  const out = new Set<string>();
  for (const id of src.dayMainLifts) if (id != null) out.add(id);
  for (const r of src.routines) {
    const flags = mainFlags(r.exercises, src.isCompound);
    r.exercises.forEach((e, i) => {
      if (flags[i] === true) out.add(e.exerciseId);
    });
  }
  return out;
}

/** Whether an exercise is a main lift (a split day's main lift, or `Main` in a workout). */
export function isMainLift(exerciseId: string, src: MainLiftSources | ReadonlySet<string>): boolean {
  return ('dayMainLifts' in src ? mainLiftIds(src) : src).has(exerciseId);
}

/** Whether `Targets hit` shows for an exercise: the setting on and a main lift. */
export function showsTargetsHit(opts: { on: boolean; main: boolean }): boolean {
  return opts.on && opts.main;
}

/** The `Targets hit` line to show (`showsTargetsHit`), else null. */
export function targetsHitShown(hitText: string | null, opts: { on: boolean; main: boolean }): string | null {
  return showsTargetsHit(opts) ? hitText : null;
}
