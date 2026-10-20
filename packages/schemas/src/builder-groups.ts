/**
 * The workout builder's display groups, focus headings and `works` line
 * (workout-builder-v3 §2.4, §2.5, §4.7; Ben 20 Oct, §9 Q8 and Q13).
 * Coaching knowledge, pure and dependency-free like `muscle-groups.ts`.
 *
 * Display only: stored data (split days, draft set-ups, templates) keeps
 * `SplitBodyPart` names. `Legs` = Quads + Hamstrings + Glutes + Calves and
 * `Abs` = Core are derived when read. Forearms has no builder group.
 */
import type { Measurement } from './exercise';
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

/**
 * The muscle data the builder reads from an exercise (catalogue entry or
 * `Exercise` row). Named `BuilderMuscleInfo` so it is not confused with the
 * rules stream's `BuilderMuscleInfo` in `@fizz/domain`.
 */
export interface BuilderMuscleInfo {
  primaryMuscles: readonly string[];
  secondaryMuscles?: readonly string[] | undefined;
  movementPattern?: string | undefined;
  measurement?: Measurement | undefined;
}

/** Movement patterns that are never in a builder group: conditioning, cardio machines and loaded carries. */
const NON_STRENGTH_PATTERNS: ReadonlySet<string> = new Set(['conditioning', 'carry']);

/**
 * Whether the exercise can be in a builder group at all. Conditioning and
 * carries (by `movementPattern`) and anything measured as `cardio` are not,
 * so Swap, Add and the recommendation never offer a treadmill under Quads.
 * Timed or distance strength work (plank, walking lunge) stays in.
 */
export function isBuilderStrength(e: BuilderMuscleInfo): boolean {
  if (e.movementPattern !== undefined && NON_STRENGTH_PATTERNS.has(e.movementPattern)) return false;
  return e.measurement !== 'cardio';
}

/** The primary muscle that decides the exercise's builder group: the first with one. Null for non-strength exercises. */
function leadMuscle(e: BuilderMuscleInfo): { muscle: Muscle; group: BuilderGroup } | null {
  if (!isBuilderStrength(e)) return null;
  for (const m of e.primaryMuscles) {
    const g = muscleGroupOf(m);
    const b = g === null ? null : builderGroupOfMuscleGroup(g);
    if (b !== null) return { muscle: m as Muscle, group: b };
  }
  return null;
}

/** The exercise's builder group from its first primary muscle that has one (rear delts → Back, §9 Q13); null when none does or for conditioning, cardio and carries. */
export function builderGroupOf(e: BuilderMuscleInfo): BuilderGroup | null {
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
 * An `Exercise` row without `movementPattern` (custom or imported) led by the
 * lats lands under `Lats`.
 */
export function builderFocusOf(e: BuilderMuscleInfo): BuilderFocus | null {
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
export function builderFocusSections<T>(items: readonly T[], infoOf: (item: T) => BuilderMuscleInfo, group: BuilderGroup): { focus: BuilderFocus; items: T[] }[] {
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
  brachialis: 'biceps',
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
const QUIET_HELPERS: ReadonlySet<string> = new Set(['core', 'grip', 'forearms']);

export const WORKS_LINE_MAX = 3;

/**
 * The `works` line under an exercise (§2.4, §2.5): `Upper chest, front delts,
 * triceps`. Primary muscles, then helpers, at most `max` (values below 1 are
 * treated as 1); `chest` is left out when `upper chest` is already there,
 * brachialis reads as `biceps` (once), and core, grip and forearms only show
 * when primary. Words outside the vocabulary are skipped. Null when nothing
 * is left.
 */
export function worksLine(e: BuilderMuscleInfo, max: number = WORKS_LINE_MAX): string | null {
  const words: string[] = [];
  const listed = new Set<string>();
  const said = new Set<string>();
  const upperPrimary = e.primaryMuscles.includes('upper_chest');
  const add = (m: string, primary: boolean) => {
    if (!Object.hasOwn(WORKS_WORD, m) || listed.has(m)) return;
    if (!primary && QUIET_HELPERS.has(m)) return;
    if (m === 'chest' && (upperPrimary || listed.has('upper_chest'))) return;
    listed.add(m);
    const word = WORKS_WORD[m as Muscle];
    if (said.has(word)) return;
    said.add(word);
    words.push(word);
  };
  for (const m of e.primaryMuscles) add(m, true);
  for (const m of e.secondaryMuscles ?? []) add(m, false);
  const shown = words.slice(0, Math.max(1, Math.floor(max)));
  if (shown.length === 0) return null;
  const text = shown.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
