import type { Load, WorkoutSet } from '@fizz/schemas';
import { plannedWarmupSteps, type PlannedWarmupStep, type WarmupLookup, type WarmupState } from '../warmup/session';

/**
 * A warm-up with no load of its own (23 Oct, Ben: the workout showed `—` on
 * every warm-up, and the open warm-up prefilled the working weight): the load
 * and reps it shows and prefills are the shared warm-up planner's
 * (`plannedWarmupSteps`, WU1–WU12), the same steps the builder and Start store,
 * so what is shown and what is stored agree. Worked out here, never written.
 * Warm-ups that already have a load (logged, typed or planned) stay as they
 * are. Pure.
 *
 * `workingLoad` is what the first working set shows (its target, else what
 * it would prefill); null when nothing is known, and then no warm-up load.
 */
export function warmupRampSteps(state: WarmupState, sessionExerciseId: string, workingLoad: (set: WorkoutSet) => Load | null, lookup: WarmupLookup = {}): ReadonlyMap<string, PlannedWarmupStep> {
  return plannedWarmupSteps(state, sessionExerciseId, workingLoad, lookup);
}

/** The warm-up set IDs with a derived load (`warmupRampSteps`' loads). */
export function warmupRampLoads(state: WarmupState, sessionExerciseId: string, workingLoad: (set: WorkoutSet) => Load | null, lookup: WarmupLookup = {}): ReadonlyMap<string, Load> {
  const out = new Map<string, Load>();
  for (const [id, step] of warmupRampSteps(state, sessionExerciseId, workingLoad, lookup)) if (step.load !== null) out.set(id, step.load);
  return out;
}
