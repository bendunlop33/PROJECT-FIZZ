/**
 * The workout builder's display groups, focus headings and `works` line
 * (workout-builder-v3 §2.4, §2.5, §4.7; Ben 20 Oct, §9 Q8 and Q13).
 * Coaching knowledge, pure and dependency-free like `muscle-groups.ts`.
 *
 * Display only: stored data (split days, draft set-ups, templates) keeps
 * `SplitBodyPart` names. `Legs` = Quads + Hamstrings + Glutes + Calves and
 * `Abs` = Core are derived when read. Forearms has no builder group.
 */
import { muscleGroupOf, type MUSCLE_TO_GROUP, type MuscleGroup } from './muscle-groups';
import type { SplitBodyPart } from './training-profile';

type Muscle = keyof typeof MUSCLE_TO_GROUP;

export const BUILDER_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Abs'] as const;
export type BuilderGroup = (typeof BUILDER_GROUPS)[number];

/** The stored body parts behind each builder group, in the order a Legs count is spread (§3.7). */
export const BUILDER_GROUP_PARTS = {
  Chest: ['Chest'],
  Back: ['Back'],
  Shoulders: ['Shoulders'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Biceps: ['Biceps'],
  Triceps: ['Triceps'],
  Abs: ['Core'],
} as const satisfies Record<BuilderGroup, readonly SplitBodyPart[]>;

const GROUP_TO_BUILDER = {
  Chest: 'Chest',
  Back: 'Back',
  Shoulders: 'Shoulders',
  Biceps: 'Biceps',
  Triceps: 'Triceps',
  Quads: 'Legs',
  Hamstrings: 'Legs',
  Glutes: 'Legs',
  Calves: 'Legs',
  Core: 'Abs',
  Forearms: null,
} as const satisfies Record<MuscleGroup, BuilderGroup | null>;

/** `Quads` → `Legs`, `Core` → `Abs`; `Forearms` → null (no builder group). */
export function builderGroupOfMuscleGroup(g: MuscleGroup): BuilderGroup | null {
  return GROUP_TO_BUILDER[g];
}

/** A stored split body part's builder group. */
export function builderGroupOfPart(part: SplitBodyPart): BuilderGroup {
  return GROUP_TO_BUILDER[part];
}

/** The one builder group a stored parts list belongs to (`[Quads, Calves]` → `Legs`); null when empty or spread over groups. */
export function builderGroupOfParts(parts: readonly SplitBodyPart[]): BuilderGroup | null {
  const groups = new Set(parts.map(builderGroupOfPart));
  return groups.size === 1 ? ([...groups][0] ?? null) : null;
}

/** What the builder reads from an exercise (catalogue entry or `Exercise` row). */
export interface BuilderExerciseInfo {
  primaryMuscles: readonly string[];
  secondaryMuscles?: readonly string[] | undefined;
  movementPattern?: string | undefined;
}

/** The primary muscle that decides the exercise's builder group: the first with one. */
function leadMuscle(e: BuilderExerciseInfo): { muscle: Muscle; group: BuilderGroup } | null {
  for (const m of e.primaryMuscles) {
    const g = muscleGroupOf(m);
    const b = g === null ? null : builderGroupOfMuscleGroup(g);
    if (b !== null) return { muscle: m as Muscle, group: b };
  }
  return null;
}

/** The exercise's builder group from its first primary muscle that has one (rear delts → Back, §9 Q13); null when none does. */
export function builderGroupOf(e: BuilderExerciseInfo): BuilderGroup | null {
  return leadMuscle(e)?.group ?? null;
}

/** Focus headings for Swap / Add, in display order within each group (§2.5). */
export const BUILDER_FOCI = {
  Chest: ['Upper chest', 'Mid chest'],
  Back: ['Lats', 'Mid-back', 'Rear delts', 'Lower back'],
  Shoulders: ['Front delts', 'Side delts'],
  Legs: ['Quads', 'Hamstrings & glutes', 'Calves'],
  Biceps: ['Biceps'],
  Triceps: ['Triceps'],
  Abs: ['Abs'],
} as const satisfies Record<BuilderGroup, readonly string[]>;
export type BuilderFocus = (typeof BUILDER_FOCI)[BuilderGroup][number];

const MUSCLE_FOCUS = {
  chest: 'Mid chest',
  upper_chest: 'Upper chest',
  lats: 'Lats',
  upper_back: 'Mid-back',
  traps: 'Mid-back',
  spinal_erectors: 'Lower back',
  rear_delts: 'Rear delts',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  biceps: 'Biceps',
  brachialis: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings & glutes',
  glutes: 'Hamstrings & glutes',
  adductors: 'Hamstrings & glutes',
  abductors: 'Hamstrings & glutes',
  calves: 'Calves',
  abs: 'Abs',
  obliques: 'Abs',
  core: 'Abs',
  forearms: null,
  grip: null,
} as const satisfies Record<Muscle, BuilderFocus | null>;

/**
 * The focus heading within the exercise's builder group (§2.5). From its lead
 * primary muscle, with two readings from the catalogue data: a chest press
 * listing `upper_chest` among its primaries is `Upper chest`, and a row
 * (`horizontal_pull`) led by the lats is `Mid-back`; pulldowns stay `Lats`.
 */
export function builderFocusOf(e: BuilderExerciseInfo): BuilderFocus | null {
  const lead = leadMuscle(e);
  if (lead === null) return null;
  if (lead.group === 'Chest' && e.primaryMuscles.includes('upper_chest')) return 'Upper chest';
  if (lead.muscle === 'lats' && e.movementPattern === 'horizontal_pull') return 'Mid-back';
  return MUSCLE_FOCUS[lead.muscle];
}

/**
 * Swap / Add sections: the exercises of `group` under their focus headings,
 * in `BUILDER_FOCI` order, empty headings left out, items kept in input order.
 * Exercises of another group (or none) are left out. Whether to show the
 * headings when there is only one is the screen's choice.
 */
export function builderFocusSections<T>(items: readonly T[], infoOf: (item: T) => BuilderExerciseInfo, group: BuilderGroup): { focus: BuilderFocus; items: T[] }[] {
  const byFocus = new Map<BuilderFocus, T[]>();
  for (const item of items) {
    const info = infoOf(item);
    if (builderGroupOf(info) !== group) continue;
    const f = builderFocusOf(info);
    if (f === null) continue;
    const list = byFocus.get(f) ?? [];
    list.push(item);
    byFocus.set(f, list);
  }
  const order: readonly BuilderFocus[] = BUILDER_FOCI[group];
  return order.flatMap((focus) => {
    const list = byFocus.get(focus);
    return list === undefined ? [] : [{ focus, items: list }];
  });
}

/** Gym words for the `works` line: short terms, not How to's plain phrases. */
const WORKS_WORD = {
  chest: 'chest',
  upper_chest: 'upper chest',
  lats: 'lats',
  upper_back: 'upper back',
  traps: 'traps',
  spinal_erectors: 'lower back',
  front_delts: 'front delts',
  side_delts: 'side delts',
  rear_delts: 'rear delts',
  biceps: 'biceps',
  brachialis: 'brachialis',
  triceps: 'triceps',
  quads: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  adductors: 'adductors',
  abductors: 'abductors',
  calves: 'calves',
  abs: 'abs',
  obliques: 'obliques',
  core: 'core',
  forearms: 'forearms',
  grip: 'grip',
} as const satisfies Record<Muscle, string>;

/** Helpers too general to name on a `works` line (every lift braces and grips). */
const QUIET_HELPERS: ReadonlySet<string> = new Set(['core', 'grip']);

export const WORKS_LINE_MAX = 3;

/**
 * The `works` line under an exercise (§2.4, §2.5): `Upper chest, front delts,
 * triceps`. Primary muscles, then helpers, at most `max`; `chest` is left out
 * when `upper chest` is already there, and core and grip only show when
 * primary. Words outside the vocabulary are skipped. Null when nothing is left.
 */
export function worksLine(e: BuilderExerciseInfo, max: number = WORKS_LINE_MAX): string | null {
  const words: string[] = [];
  const listed = new Set<string>();
  const upperPrimary = e.primaryMuscles.includes('upper_chest');
  const add = (m: string, primary: boolean) => {
    if (!Object.hasOwn(WORKS_WORD, m) || listed.has(m)) return;
    if (!primary && QUIET_HELPERS.has(m)) return;
    if (m === 'chest' && (upperPrimary || listed.has('upper_chest'))) return;
    listed.add(m);
    words.push(WORKS_WORD[m as Muscle]);
  };
  for (const m of e.primaryMuscles) add(m, true);
  for (const m of e.secondaryMuscles ?? []) add(m, false);
  const shown = words.slice(0, Math.max(1, max));
  if (shown.length === 0) return null;
  const text = shown.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
