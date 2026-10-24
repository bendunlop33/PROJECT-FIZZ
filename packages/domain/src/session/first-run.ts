import type { EquipmentKind, Exercise, LoadConvention, PlannedSet, RuleDecision, SessionAggregate, SetType, TargetProvenance, ZonedTimestamp } from '@fizz/schemas';
import { builtInRepRange, builtInRuleName, ruleCategory, type RuleExerciseInfo } from '../default-rule';
import { fitProvenance } from '../target-provenance';

/**
 * First-run flow helpers (audit B1, B2, F5): pure rules so a brand-new user
 * gets a usable workout without history, routines or the coach.
 */

/**
 * An open-ended workout is one Ben builds as he goes (`Start workout` with
 * nothing planned): no routine, no name. A repeated or "next session"
 * workout carries a name and a plan, so it is not open-ended.
 */
export function isOpenEndedWorkout(state: Pick<SessionAggregate, 'session'>): boolean {
  return state.session.routineId === null && state.session.routineName === null;
}

/** The placeholder name of a workout Ben didn't name (a repeat or next session of an unnamed one). */
export const GENERIC_WORKOUT_NAME = 'Workout';

/**
 * The name Ben gave a workout (its routine's), or null when it has none:
 * no name, or the generic `Workout`. Screens then show a derived title
 * (`Push`) worked out when shown, never stored as if Ben chose it (review S3).
 */
export function storedWorkoutName(session: Pick<SessionAggregate['session'], 'routineName'>): string | null {
  return session.routineName !== null && session.routineName !== GENERIC_WORKOUT_NAME ? session.routineName : null;
}

/** Working sets planned for an exercise with no comparable history (audit B1). */
export const DEFAULT_WORKING_SETS = 3;

/**
 * The starting plan for an exercise with no comparable history: three
 * working sets with the built-in rule's rep range for its category and no
 * load (the app never guesses a first load; rule 6). Labelled as the
 * built-in rule, like every other built-in target (ADR 0006 fallback).
 */
export function defaultStartingPlan(
  exercise: RuleExerciseInfo | null,
  equipmentKind: EquipmentKind | null,
  convention: LoadConvention,
  sets = DEFAULT_WORKING_SETS,
  why?: StartingPlanWhy,
): { setType: SetType; planned: PlannedSet }[] {
  const category = ruleCategory(exercise, equipmentKind, convention);
  const reps = builtInRepRange(category);
  const count = Math.max(1, Math.min(10, Math.round(sets)));
  const provenance = why === undefined ? undefined : startingPlanProvenance(why, builtInRuleName(category), count, reps);
  return Array.from({ length: count }, () => ({
    setType: 'working' as const,
    planned: { load: null, reps: { ...reps }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' as const, ...(provenance ? { provenance } : {}) },
  }));
}

/**
 * When the starting plan was made, and the rule's decision when it ran but
 * couldn't plan (pain hold with no load, unsupported). With it, each set
 * records rule provenance, so `Why?` never says `Not recorded` for a target
 * this version made (active-workout §2.12, review B1.1).
 */
export interface StartingPlanWhy {
  at: ZonedTimestamp;
  decision?: RuleDecision;
}

function startingPlanProvenance(why: StartingPlanWhy, ruleName: string, count: number, reps: { min: number; max: number }): TargetProvenance {
  return fitProvenance({
    source: 'rule',
    setAt: why.at,
    routineName: null,
    requestedLoad: null,
    basis: null,
    rule: {
      name: ruleName,
      decision: why.decision ?? 'insufficient_data',
      // Fixed app text; true whether or not there was history (the plan never has a load).
      summary: `${String(count)} × ${String(reps.min)}–${String(reps.max)} · load: your choice`,
      facts: [],
    },
    guardNotes: [],
  });
}

export type MuscleRegion = 'push' | 'pull' | 'legs' | 'core';

const PUSH_MUSCLES = new Set(['chest', 'upper_chest', 'lower_chest', 'front_delts', 'side_delts', 'triceps', 'shoulders', 'delts', 'serratus']);
const PULL_MUSCLES = new Set(['lats', 'upper_back', 'mid_back', 'traps', 'rear_delts', 'biceps', 'forearms', 'brachialis', 'rhomboids', 'rotator_cuff', 'neck']);
const LEG_MUSCLES = new Set(['quads', 'glutes', 'hamstrings', 'calves', 'adductors', 'abductors', 'hip_flexors', 'spinal_erectors', 'lower_back', 'tibialis']);
const CORE_MUSCLES = new Set(['abs', 'core', 'obliques', 'rectus_abdominis', 'transverse_abdominis']);
const PATTERN_REGION: Readonly<Record<string, MuscleRegion>> = {
  horizontal_push: 'push',
  vertical_push: 'push',
  horizontal_pull: 'pull',
  vertical_pull: 'pull',
  squat: 'legs',
  hinge: 'legs',
  lunge: 'legs',
  calves: 'legs',
  knee_extension: 'legs',
  knee_flexion: 'legs',
  core: 'core',
  carry: 'core',
};

type TitleInfo = Pick<Exercise, 'movementPattern' | 'primaryMuscles'>;

/** The body region an exercise mostly trains: primary muscles first, then its movement pattern. */
export function muscleRegion(ex: TitleInfo): MuscleRegion | null {
  const first = ex.primaryMuscles[0];
  if (first !== undefined) {
    if (PUSH_MUSCLES.has(first)) return 'push';
    if (PULL_MUSCLES.has(first)) return 'pull';
    if (LEG_MUSCLES.has(first)) return 'legs';
    if (CORE_MUSCLES.has(first)) return 'core';
  }
  return PATTERN_REGION[ex.movementPattern] ?? null;
}

/**
 * A plain name for a workout from what's in it (audit F5): `Push`, `Pull`,
 * `Legs`, `Upper body`, `Full body`, `Core`, else `Workout`. Never claims a
 * routine that doesn't exist; it describes the exercises.
 */
export function deriveWorkoutTitle(exercises: readonly TitleInfo[]): string {
  const regions = new Set(exercises.map(muscleRegion).filter((r): r is MuscleRegion => r !== null && r !== 'core'));
  if (regions.size === 0) return exercises.some((e) => muscleRegion(e) === 'core') ? 'Core' : 'Workout';
  if (regions.size === 1) {
    const only = [...regions][0];
    return only === 'push' ? 'Push' : only === 'pull' ? 'Pull' : 'Legs';
  }
  if (!regions.has('legs')) return 'Upper body';
  return 'Full body';
}

const MUSCLE_WORD: Readonly<Record<string, string>> = {
  chest: 'Chest',
  upper_chest: 'Chest',
  lower_chest: 'Chest',
  front_delts: 'Shoulders',
  side_delts: 'Shoulders',
  shoulders: 'Shoulders',
  delts: 'Shoulders',
  rotator_cuff: 'Shoulders',
  serratus: 'Chest',
  neck: 'Neck',
  triceps: 'Triceps',
  biceps: 'Biceps',
  lats: 'Back',
  upper_back: 'Back',
  mid_back: 'Back',
  traps: 'Back',
  rhomboids: 'Back',
  rear_delts: 'Back', // Ben, 20 Oct (§9 Q13): rear delts count as Back everywhere.
  quads: 'Quads',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
  tibialis: 'Shins',
  hip_flexors: 'Hip flexors',
  spinal_erectors: 'Lower back',
  lower_back: 'Lower back',
  abs: 'Core',
  core: 'Core',
  obliques: 'Core',
};

/** `['Chest', 'Shoulders', 'Triceps']`: up to `max` muscle words in the order they first appear (the first is the main one). */
export function muscleWords(exercises: readonly Pick<Exercise, 'primaryMuscles'>[], max = 3): string[] {
  const words: string[] = [];
  for (const e of exercises) {
    for (const m of e.primaryMuscles) {
      const w = MUSCLE_WORD[m];
      if (w !== undefined && !words.includes(w)) words.push(w);
    }
  }
  return words.slice(0, max);
}

/** `Chest · Shoulders · Triceps`: up to `max` muscle words in the order they first appear. */
export function muscleSummary(exercises: readonly Pick<Exercise, 'primaryMuscles'>[], max = 3): string | null {
  const words = muscleWords(exercises, max);
  return words.length === 0 ? null : words.join(' · ');
}
