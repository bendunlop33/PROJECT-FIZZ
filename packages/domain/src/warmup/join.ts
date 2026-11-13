import type { EquipmentInstance, LoadConvention, Measurement, PlanWarmups, PlannedSet, SetType, WeightUnit, WorkoutSet } from '@fizz/schemas';
import { getAchievableLoads, isBarLoaded, loadDirection } from '../equipment';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { isWarmed, planSessionWarmupsAs, planWarmups, warmupTimeS, type WarmupExerciseFacts, type WarmupProfile } from './plan';
import { sessionWarmupProfile, type WarmupLookup, type WarmupState } from './session';
import { simpleWarmupLoadsIf } from './simple';

/**
 * (Ben, 8 Nov, live Pull B: barbell rows added after pull-ups got "not much of a warm up") Warm-ups for an exercise
 * that joins a running workout: `＋ Add exercise`, the library's Add, the coach's add, and a swap. The shared planner
 * (WU1–WU12 with SW1, PH1, PL1) at the exercise's place in the workout, as Start plans a planned exercise. Pure.
 *
 * - WU2 warmed: a working set logged earlier today with the same primary muscle group or movement pattern (the
 *   swapped-out row's logged sets count: Ben did them), or a superset partner already started; a heavy bar or
 *   plate-loaded lift only by the same movement pattern (Ben, 9 Nov: rows after pull-ups are cold).
 * - WU6's extra light step: only when nothing else in the workout is done or still ahead of it.
 * - WU11: within what is left of the 10-minute allowance after the workout's other warm-ups (logged or planned);
 *   the plan's Warm-ups setting (`short`, `none`) applies as at Start.
 * - W is the first working set's planned load on the row's item (rule 4: every warm-up achievable, below W).
 *
 * Never touches a logged set (rule 2): the result is only the new row's pending warm-ups.
 */

export interface JoinWarmupContext {
  /** Catalogue facts for the workout's exercises, the main lift, Ben's warm-up preferences. */
  lookup: WarmupLookup;
  /** The plan's Warm-ups setting (`pbWarmupsOf`); absent = `full`. */
  mode?: PlanWarmups;
}

export interface JoinWarmupInput {
  /** The workout before the change. */
  state: WarmupState;
  exercise: { id: string; measurement: Measurement; facts?: WarmupExerciseFacts | null };
  /** The item the new row logs on (null: none). */
  equipment: EquipmentInstance | null;
  convention: LoadConvention;
  unit: WeightUnit;
  /** A bodyweight exercise with weight added (dips + 20 kg). */
  bodyweightExercise?: boolean;
  /** The new row is the workout's main lift (WU4/WU5 whatever its equipment). */
  main?: boolean;
  /** Added as this row's superset partner. */
  supersetWith?: string | null;
  /** A swap: the row it replaces (its pending warm-ups go with it). */
  replacing?: string | null;
  ctx?: JoinWarmupContext | undefined;
}

const JOINING = '__joining__';
const EPS = 1e-9;

const workingDone = (s: WorkoutSet): boolean => s.status === 'completed' && s.setType !== 'warmup';

/** The new row's warm-up sets for its first working set `first` (lightest first); none when the class takes none or W is unknown. */
export function joinWarmups(input: JoinWarmupInput, first: Pick<PlannedSet, 'load' | 'reps'> | null): PlannedSet[] {
  const R = first?.reps?.min ?? null;
  if (first === null || R === null || !(R > 0) || input.exercise.measurement !== 'reps') return [];
  const base = input.ctx?.lookup ?? {};
  const lookup: WarmupLookup = {
    ...base,
    facts: (id) => (id === input.exercise.id ? (input.exercise.facts ?? base.facts?.(id) ?? null) : (base.facts?.(id) ?? null)),
  };
  const s = input.state;
  const eq = input.equipment;
  const profile = sessionWarmupProfile(
    { id: JOINING, exerciseId: input.exercise.id, loadConvention: input.convention, measurement: input.exercise.measurement },
    eq,
    { ...lookup, main: () => input.main === true },
    input.bodyweightExercise === true,
  );
  if (profile.cls === 'none' || profile.cls === 'bodyweight') return [];

  // WU2: what Ben has done today.
  const live = s.exercises.filter((e) => e.removed === undefined);
  const earlier: WarmupProfile[] = [];
  for (const row of s.exercises) {
    if (!s.sets.some((x) => x.sessionExerciseId === row.id && workingDone(x))) continue;
    earlier.push(sessionWarmupProfile(row, equipmentOfRow(s.session.equipmentSnapshot, row), lookup));
  }
  const partner = input.supersetWith ?? null;
  const partnerStarted = partner !== null && s.sets.some((x) => x.sessionExerciseId === partner && x.status === 'completed');
  const warmed = isWarmed(profile, earlier, partnerStarted);
  // WU6: the session's first exercise: nothing else done, and nothing else ahead of it.
  const others = live.filter((e) => e.id !== input.replacing);
  const replaced = input.replacing == null ? undefined : live.find((e) => e.id === input.replacing);
  const anyDone = s.sets.some((x) => x.status === 'completed');
  const firstOfSession = !anyDone && (others.length === 0 || (replaced !== undefined && others.every((e) => e.order > replaced.order)));

  // WU11: the other warm-ups' time counts against the allowance (the replaced row's pending ones go).
  const fixedS = live.reduce((n, row) => {
    const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.setType === 'warmup' && x.status !== 'deleted' && x.status !== 'skipped' && !(row.id === input.replacing && x.status === 'pending'));
    return n + warmupTimeS(own.map((x) => ({ load: (x.actual?.load ?? x.planned.load)?.value ?? 0, reps: x.actual?.reps ?? x.planned.reps?.min ?? 0 })));
  }, 0);

  if (profile.cls === 'weighted_bodyweight') {
    // WU7: bodyweight only (nothing added; shown as BW).
    const steps = planWarmups({ cls: profile.cls, reps: R, load: null, warmed, firstOfSession, floorStart: false, barMass: null, loads: [] });
    return (input.ctx?.mode ?? 'full') === 'none' ? [] : steps.map((x) => warmupSet(null, x.reps));
  }
  const top = first.load;
  if (top === null || eq === null || !(top.value > 0)) return [];
  if (loadDirection(top.convention) !== 'resistance' || top.convention !== eq.loadConvention || top.unit !== eq.unit || top.unit !== input.unit || top.convention !== input.convention) return [];
  const loads = getAchievableLoads(eq).loads;
  const simple = simpleWarmupLoadsIf(eq, lookup.prefs?.simpleLoads !== false);
  const planned = planSessionWarmupsAs(
    [{ cls: profile.cls, reps: R, load: top.value, warmed, firstOfSession, floorStart: profile.floorStart, barMass: isBarLoaded(eq) && eq.kind === 'barbell' ? eq.barMass : null, loads, simple, fixedS }],
    input.ctx?.mode ?? 'full',
  );
  return (planned.steps[0] ?? []).filter((x) => x.load < top.value - EPS).map((x) => warmupSet({ value: x.load, unit: top.unit, convention: top.convention }, x.reps));
}

function warmupSet(load: PlannedSet['load'], reps: number): PlannedSet {
  return { load, reps: { min: reps, max: reps }, durationS: null, rpe: null, rir: null };
}

/**
 * A new row's plan with its warm-ups from `joinWarmups`: any warm-ups the plan came with (the builder's, planned as if
 * the exercise were cold and alone) give way to the planner's for its place. A plan with no working set is unchanged.
 */
export function withJoinWarmups(plan: readonly { setType: SetType; planned: PlannedSet }[] | null | undefined, input: JoinWarmupInput): { setType: SetType; planned: PlannedSet }[] | null {
  if (plan === null || plan === undefined) return null;
  const working = plan.filter((p) => p.setType !== 'warmup');
  const first = working[0];
  if (first === undefined) return [...plan];
  const warm = joinWarmups(input, first.planned).map((planned) => ({ setType: 'warmup' as const, planned }));
  return [...warm, ...working];
}
