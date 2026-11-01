import { builderGroupOfMuscleGroup, isBuilderStrength, muscleGroupOf, type BuilderMuscleInfo, type MuscleGroup, type TrainingGoal } from '@fizz/schemas';

/**
 * (Ben, 1 Nov: option C; docs/design/plan-muscles.md §2) The app's one muscle-set count. Pure.
 *
 * Every muscle number on every screen comes from `muscleSetCredits`: for each group, an exercise's sets are
 * - **direct**: in full for its *lead* group, the first primary muscle with a builder group (rear delts → Back,
 *   glutes → Glutes; forearm-only work → Forearms). This is the builder's and the weekly review's count as it was
 *   (workout-builder-v3 §3.7): a curl is direct Biceps work, a row is direct Back work.
 * - **assisted**: the rest of playbook V1's credit for the group (1 per set for another primary group, ½ for a
 *   secondary one, the higher wins), so `direct + assisted` is always exactly V1's count (Progress's old number).
 *
 * Bars, ranges and flags read `direct` only (Ben, 1 Nov: "the 6–10 range is judged against direct sets only,
 * meaning the curl and extension exercises"); `assisted` is shown alongside and decides which direct range applies
 * (`directRange`).
 */

export interface MuscleCreditInfo extends BuilderMuscleInfo {
  primaryMuscles: readonly string[];
  secondaryMuscles?: readonly string[] | undefined;
}

/** Body-part credit per set: 1 for a group among the primary muscles, ½ for one among the helpers; the higher one wins (V1, PG26). */
export function muscleGroupCredits(info: Pick<MuscleCreditInfo, 'primaryMuscles' | 'secondaryMuscles'>): Map<MuscleGroup, 1 | 0.5> {
  const out = new Map<MuscleGroup, 1 | 0.5>();
  for (const m of info.primaryMuscles) {
    const g = muscleGroupOf(m);
    if (g !== null) out.set(g, 1);
  }
  for (const m of info.secondaryMuscles ?? []) {
    const g = muscleGroupOf(m);
    if (g !== null && !out.has(g)) out.set(g, 0.5);
  }
  return out;
}

/** The muscle group the builder credits an exercise's sets to: the first primary muscle with a builder group. */
export function leadMuscleGroup(info: BuilderMuscleInfo | null | undefined): MuscleGroup | null {
  if (info == null || !isBuilderStrength(info)) return null;
  for (const m of info.primaryMuscles) {
    const g = muscleGroupOf(m);
    if (g !== null && builderGroupOfMuscleGroup(g) !== null) return g;
  }
  return null;
}

/** The group an exercise's sets count in full for: its lead group, or Forearms for forearm-only strength work. */
export function directMuscleGroup(info: BuilderMuscleInfo | null | undefined): MuscleGroup | null {
  const lead = leadMuscleGroup(info);
  if (lead !== null || info == null || !isBuilderStrength(info)) return lead;
  return info.primaryMuscles.some((m) => muscleGroupOf(m) === 'Forearms') ? 'Forearms' : null;
}

export interface MuscleSetCredit {
  /** 1 for the lead group, else 0. */
  direct: 0 | 1;
  /** V1's credit less `direct`: 0, ½ or 1. */
  assisted: 0 | 0.5 | 1;
}

/** Per set, for each group the exercise counts towards. */
export function muscleSetCredits(info: MuscleCreditInfo | null | undefined): Map<MuscleGroup, MuscleSetCredit> {
  const out = new Map<MuscleGroup, MuscleSetCredit>();
  if (info == null) return out;
  const lead = directMuscleGroup(info);
  for (const [g, v1] of muscleGroupCredits(info)) {
    const direct: 0 | 1 = g === lead ? 1 : 0;
    out.set(g, { direct, assisted: (v1 - direct) as 0 | 0.5 | 1 });
  }
  if (lead !== null && !out.has(lead)) out.set(lead, { direct: 1, assisted: 0 });
  return out;
}

export interface MuscleSets {
  direct: number;
  assisted: number;
}

export type MuscleSetTotals = Map<MuscleGroup, MuscleSets>;

/** Adds `sets` sets of an exercise to `into` (direct and assisted, in halves where ½). */
export function addMuscleSets(into: MuscleSetTotals, info: MuscleCreditInfo | null | undefined, sets: number): MuscleSetTotals {
  if (sets <= 0) return into;
  for (const [g, c] of muscleSetCredits(info)) {
    const t = into.get(g) ?? { direct: 0, assisted: 0 };
    into.set(g, { direct: t.direct + c.direct * sets, assisted: t.assisted + c.assisted * sets });
  }
  return into;
}

/** The totals of a list of `{ info, sets }` rows. */
export function muscleSetTotals(rows: readonly { info: MuscleCreditInfo | null | undefined; sets: number }[]): MuscleSetTotals {
  const out: MuscleSetTotals = new Map();
  for (const r of rows) addMuscleSets(out, r.info, r.sets);
  return out;
}

// ---------------------------------------------------------------------------
// Ranges (playbook-v1 rule 1 / volume-by-frequency V4, as amended by Ben, 1 Nov)

/** The goal a range is read for: the training profile's goal, or a builder plan's focus (`fitness` is General fitness). */
export type VolumeGoal = TrainingGoal | 'fitness';

/** Assisted sets a week from which a group's direct range is the covered one (Ben, 1 Nov). */
export const ASSISTED_COVERS = 6;

/**
 * Direct working sets per group per week (approved rule 1 / V4, amended by Ben 1 Nov). Muscle: 6–10, 10–20 for a
 * priority group; 4–8 when the group already gets ≥ 6 assisted sets a week ("if they're trained a bit with other
 * muscles then clearly we could have fewer sets eg 4"). Strength (other groups) and General fitness: 4–10.
 * `both` (Muscle and strength) reads the muscle band, as the weekly review always has (WEEKLY_SET_RANGE).
 */
export const MUSCLE_SET_RANGES = {
  muscle: { min: 6, max: 10 },
  covered: { min: 4, max: 8 },
  priority: { min: 10, max: 20 },
  strength: { min: 4, max: 10 },
  fitness: { min: 4, max: 10 },
} as const;

export type MuscleRangeWhy = 'goal' | 'covered' | 'priority';

export interface MuscleRange {
  min: number;
  max: number;
  why: MuscleRangeWhy;
}

/** The direct range that applies to a group this week; null with no goal (no range is shown, playbook "No goal set"). */
export function directRange(goal: VolumeGoal | null, opts: { priority: boolean; assisted: number }): MuscleRange | null {
  if (goal === null) return null;
  if (goal === 'strength') return { ...MUSCLE_SET_RANGES.strength, why: 'goal' };
  if (goal === 'fitness') return { ...MUSCLE_SET_RANGES.fitness, why: 'goal' };
  if (opts.priority) return { ...MUSCLE_SET_RANGES.priority, why: 'priority' };
  if (opts.assisted >= ASSISTED_COVERS) return { ...MUSCLE_SET_RANGES.covered, why: 'covered' };
  return { ...MUSCLE_SET_RANGES.muscle, why: 'goal' };
}

export type MuscleStatus = 'below' | 'in' | 'above';

export function muscleStatus(direct: number, range: Pick<MuscleRange, 'min' | 'max'>): MuscleStatus {
  return direct < range.min ? 'below' : direct > range.max ? 'above' : 'in';
}

/** The groups a plan's bars show (the 10 groups Ben listed; Forearms isn't a weekly-volume group, D5). */
export const PLAN_MUSCLE_GROUPS: readonly MuscleGroup[] = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Glutes', 'Triceps', 'Biceps', 'Calves', 'Core'];

/** A builder plan's priority picks as muscle groups (`Arms` → Biceps, Triceps; `Legs` → the four leg groups). */
export function priorityGroupsOf(priorities: readonly string[]): Set<MuscleGroup> {
  const out = new Set<MuscleGroup>();
  for (const p of priorities) {
    if (p === 'Arms') for (const g of ['Biceps', 'Triceps'] as const) out.add(g);
    else if (p === 'Legs') for (const g of ['Quads', 'Hamstrings', 'Glutes', 'Calves'] as const) out.add(g);
    else if (p === 'Chest' || p === 'Back' || p === 'Shoulders' || p === 'Core') out.add(p);
  }
  return out;
}

/** A builder plan's focus as a volume goal (Balanced reads as Muscle and strength). */
export function volumeGoalOfFocus(focus: 'strength' | 'muscle' | 'balanced' | 'fitness'): VolumeGoal {
  return focus === 'balanced' ? 'both' : focus;
}
