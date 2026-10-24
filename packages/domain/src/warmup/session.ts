import type { EquipmentInstance, Load, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { getAchievableLoads, isBarLoaded, loadDirection } from '../equipment';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { fitWarmupCount, planWarmups, warmupProfileOf, type WarmupExerciseFacts, type WarmupProfile } from './plan';

/**
 * Warm-ups in a workout (WU1–WU12 through `planWarmups`). Pure.
 *
 * A warm-up with no load of its own (a coach-built workout's, a saved workout's, one the coach or Ben added by
 * count) takes the planner's step for its place: Start writes it on the planned set when the first working load is
 * known there (`planStartWarmups`); otherwise the workout derives the same step for display and prefill once the
 * working load is known (`plannedWarmupSteps`, never written). Warm-ups with a load (logged, typed, planned by the
 * builder) stay as they are. Only pending sets are planned: a logged set is never changed (rule 2).
 *
 * The count is the workout's (it was planned with WU2's warmed check where it was made); its loads are the
 * planner's heaviest steps for that count (`fitWarmupCount`), all achievable on the row's item and below the first
 * working load (rule 4).
 */

/** What the planner reads of a workout (a `SessionAggregate` is one). */
export interface WarmupState {
  sets: readonly WorkoutSet[];
  exercises: readonly SessionExercise[];
  session: { equipmentSnapshot: readonly EquipmentInstance[] };
}

export interface WarmupLookup {
  /** The exercise's catalogue facts (category, pattern, family); null = unknown (fallbacks from the item). */
  facts?: (exerciseId: string) => WarmupExerciseFacts | null;
  /** The workout's main lift (WU4/WU5 whatever its equipment); absent = not known (classified from the item). */
  main?: (sessionExerciseId: string) => boolean;
}

export interface PlannedWarmupStep {
  load: Load | null;
  reps: number;
}

/** The profile of a session row at its item (`warmupProfileOf` with item fallbacks when the facts are missing). */
export function sessionWarmupProfile(ex: Pick<SessionExercise, 'exerciseId' | 'id' | 'loadConvention' | 'measurement'>, eq: EquipmentInstance | null, lookup: WarmupLookup = {}, bodyweightExercise = false): WarmupProfile {
  const facts = lookup.facts?.(ex.exerciseId) ?? null;
  const kind = eq?.kind ?? null;
  return warmupProfileOf(facts ?? { measurement: ex.measurement }, {
    main: lookup.main?.(ex.id) ?? false,
    itemKind: kind,
    convention: ex.loadConvention,
    bodyweightExercise: ex.loadConvention === 'added' && (bodyweightExercise || kind === null || kind === 'bodyweight_station'),
    // No catalogue facts: a bar or plate-loaded item reads as a compound; anything else as an isolation (one step).
    fallback: { compound: kind === 'barbell' || kind === 'trap_bar' || kind === 'plate_loaded_machine' || kind === 'smith_machine', barbell: eq !== null && isBarLoaded(eq) },
  });
}

/**
 * The planner's step for each pending warm-up of one exercise that has no load of its own, by set ID; also for a
 * pending warm-up whose planned load is no longer below the first working load (that load was lowered after it was
 * planned: a pain hold, a lighter day, the coach's change), so no warm-up ever shows or prefills at or above it
 * (rule 4). `workingLoad` is what the first working set shows (its target, else what it would prefill); a logged first
 * working set uses its logged load. Empty when nothing is known, or the class takes no warm-ups.
 */
export function plannedWarmupSteps(state: WarmupState, sessionExerciseId: string, workingLoad: (set: WorkoutSet) => Load | null, lookup: WarmupLookup = {}): ReadonlyMap<string, PlannedWarmupStep> {
  const out = new Map<string, PlannedWarmupStep>();
  const ex = state.exercises.find((e) => e.id === sessionExerciseId);
  if (ex === undefined) return out;
  const own = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
  const warm = own.filter((s) => s.setType === 'warmup' && s.status !== 'skipped');
  const pendingOpen = (s: WorkoutSet): boolean => s.status === 'pending' && (s.draft?.load ?? null) === null && s.planned.durationS === null;
  const noLoad = (s: WorkoutSet): boolean => pendingOpen(s) && s.planned.load === null;
  if (!warm.some(pendingOpen)) return out;
  const work = own.find((s) => s.setType !== 'warmup' && s.status !== 'skipped');
  if (work === undefined) return out;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const profile = sessionWarmupProfile(ex, eq, lookup, work.planned.bodyweightExercise === true);
  const R = work.planned.reps?.min ?? work.actual?.reps ?? null;
  if (R === null) return out;
  const order = [...state.exercises].sort((a, b) => a.order - b.order);
  const firstOfSession = order[0]?.id === ex.id;
  if (profile.cls === 'weighted_bodyweight') {
    // WU7: bodyweight only (nothing added; shown as BW).
    const reps = planWarmups({ cls: profile.cls, reps: R, load: null, warmed: false, firstOfSession, floorStart: false, barMass: null, loads: [] })[0]?.reps;
    if (reps !== undefined) for (const s of warm) if (noLoad(s)) out.set(s.id, { load: null, reps });
    return out;
  }
  const top = work.status === 'completed' ? (work.actual?.load ?? null) : workingLoad(work);
  if (top === null || eq === null || !(top.value > 0)) return out;
  if (loadDirection(top.convention) !== 'resistance' || top.convention !== eq.loadConvention || top.unit !== ex.unit || top.unit !== eq.unit) return out;
  const open = (s: WorkoutSet): boolean => noLoad(s) || (pendingOpen(s) && s.planned.load !== null && s.planned.load.unit === top.unit && s.planned.load.convention === top.convention && s.planned.load.value >= top.value - 1e-9);
  if (!warm.some(open)) return out;
  const loads = getAchievableLoads(eq).loads;
  const full = planWarmups({ cls: profile.cls, reps: R, load: top.value, warmed: false, firstOfSession, floorStart: profile.floorStart, barMass: isBarLoaded(eq) && eq.kind === 'barbell' ? eq.barMass : null, loads });
  const steps = fitWarmupCount(full, warm.length, top.value, loads);
  // Lightest first, in set order; fewer steps than warm-ups (no room below W): the heaviest go to the last warm-ups.
  const offset = warm.length - steps.length;
  warm.forEach((s, k) => {
    const step = steps[k - offset];
    if (step === undefined || !open(s)) return;
    out.set(s.id, { load: { value: step.load, unit: top.unit, convention: top.convention }, reps: step.reps });
  });
  return out;
}

/**
 * Start (`startWorkout`): each pending warm-up with no load takes the planner's load and reps from the first
 * working set's planned load at this gym, so what Start stores is what the workout shows. Sets with no working
 * load yet are left for `plannedWarmupSteps` at display.
 */
export function planStartWarmups(state: WarmupState, lookup: WarmupLookup = {}): WorkoutSet[] {
  const steps = new Map<string, PlannedWarmupStep>();
  for (const ex of state.exercises) {
    for (const [id, step] of plannedWarmupSteps(state, ex.id, (w) => w.planned.load, lookup)) steps.set(id, step);
  }
  if (steps.size === 0) return [...state.sets];
  return state.sets.map((s) => {
    const step = steps.get(s.id);
    if (step === undefined) return s;
    return { ...s, planned: { ...s.planned, load: step.load, reps: { min: step.reps, max: step.reps } } };
  });
}
