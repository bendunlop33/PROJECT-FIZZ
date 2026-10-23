/**
 * The workout builder's display groups, focus headings and `works` line
 * (workout-builder-v3 §2.4, §2.5, §4.7; Ben 20 Oct, §9 Q8 and Q13).
 * Coaching knowledge, pure and dependency-free like `muscle-groups.ts`.
 *
 * D5 (Ben, 22–23 Oct): the broad picking groups `Chest`, `Back`, `Shoulders`,
 * `Legs`, `Arms`, `Core`. Display only: stored data (split days, draft
 * set-ups, templates) keeps `SplitBodyPart` names, so `Legs` = Quads +
 * Hamstrings + Glutes + Calves and `Arms` = Biceps + Triceps are derived when
 * read. Forearms count in no group, but forearm-only exercises are found
 * under `Arms` › `Forearms` in Swap / Add (Arms takes forearms when picking).
 * Group keys stored before D5 (`Biceps`, `Triceps`, `Abs`) read through
 * `builderGroupOfKey`.
 */
import type { Measurement } from './exercise';
import { muscleGroupOf, type MUSCLE_TO_GROUP, type MuscleGroup } from './muscle-groups';
import type { SplitBodyPart } from './training-profile';

type Muscle = keyof typeof MUSCLE_TO_GROUP;

export const BUILDER_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core'] as const;
export type BuilderGroup = (typeof BUILDER_GROUPS)[number];

/** Builder group keys stored before D5 (carry-over items, older drafts) and the group each is now. */
export const LEGACY_BUILDER_GROUPS = { Biceps: 'Arms', Triceps: 'Arms', Abs: 'Core' } as const satisfies Record<string, BuilderGroup>;

/** A stored or spoken group key as today's group (`Biceps` → `Arms`, `Abs` → `Core`); null for anything else. */
export function builderGroupOfKey(key: unknown): BuilderGroup | null {
  if (typeof key !== 'string') return null;
  if ((BUILDER_GROUPS as readonly string[]).includes(key)) return key as BuilderGroup;
  return Object.hasOwn(LEGACY_BUILDER_GROUPS, key) ? LEGACY_BUILDER_GROUPS[key as keyof typeof LEGACY_BUILDER_GROUPS] : null;
}

/** The stored body parts behind each builder group, in the order a Legs count is spread (§3.7). Arms = Biceps + Triceps (D5). */
export const BUILDER_GROUP_PARTS = {
  Chest: ['Chest'],
  Back: ['Back'],
  Shoulders: ['Shoulders'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Arms: ['Biceps', 'Triceps'],
  Core: ['Core'],
} as const satisfies Record<BuilderGroup, readonly SplitBodyPart[]>;

const GROUP_TO_BUILDER = {
  Chest: 'Chest',
  Back: 'Back',
  Shoulders: 'Shoulders',
  Biceps: 'Arms',
  Triceps: 'Arms',
  Quads: 'Legs',
  Hamstrings: 'Legs',
  Glutes: 'Legs',
  Calves: 'Legs',
  Core: 'Core',
  Forearms: null,
} as const satisfies Record<MuscleGroup, BuilderGroup | null>;

/** `Quads` → `Legs`, `Biceps` → `Arms`; `Forearms` → null (it counts in no group). */
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

/**
 * Forearms count in no builder group, but an exercise led by them (wrist
 * curl, dead hang) is still found in Swap / Add: under `Arms` (D5, Ben
 * 22–23 Oct: Arms takes forearms when picking).
 */
const FOREARM_PICK_GROUP: BuilderGroup = 'Arms';

/**
 * The primary muscle that decides the exercise's builder group: the first
 * with one; a forearm-only exercise falls back to its first forearm or grip
 * word (`FOREARM_PICK_GROUP`). Null for non-strength exercises.
 */
function leadMuscle(e: BuilderMuscleInfo): { muscle: Muscle; group: BuilderGroup } | null {
  if (!isBuilderStrength(e)) return null;
  for (const m of e.primaryMuscles) {
    const g = muscleGroupOf(m);
    const b = g === null ? null : builderGroupOfMuscleGroup(g);
    if (b !== null) return { muscle: m as Muscle, group: b };
  }
  for (const m of e.primaryMuscles) if (muscleGroupOf(m) === 'Forearms') return { muscle: m as Muscle, group: FOREARM_PICK_GROUP };
  return null;
}

/** The exercise's builder group from its first primary muscle that has one (rear delts → Back, §9 Q13; forearm-only → the arms group); null when none does or for conditioning, cardio and carries. */
export function builderGroupOf(e: BuilderMuscleInfo): BuilderGroup | null {
  return leadMuscle(e)?.group ?? null;
}

/** Focus headings for Swap / Add, in display order within each group (§2.5). */
export const BUILDER_FOCI = {
  Chest: ['Upper chest', 'Mid chest', 'Serratus'],
  Back: ['Lats', 'Mid-back', 'Rear delts', 'Lower back', 'Neck'],
  Shoulders: ['Front delts', 'Side delts', 'Rotator cuff'],
  Legs: ['Quads', 'Hamstrings & glutes', 'Calves', 'Shins'],
  Arms: ['Biceps', 'Triceps', 'Forearms'],
  Core: ['Abs'],
} as const satisfies Record<BuilderGroup, readonly string[]>;
export type BuilderFocus = (typeof BUILDER_FOCI)[BuilderGroup][number];

/**
 * Prehab and small-part foci (catalogue expansion, Ben 23 Oct): offered in
 * Swap / Add under their group, never picked by the builder on its own
 * (a cuff rotation is not a shoulder accessory, a tibialis raise not a calf
 * raise, a wrist curl not a biceps curl).
 */
export const BUILDER_BROWSE_ONLY_FOCI: ReadonlySet<BuilderFocus> = new Set<BuilderFocus>(['Serratus', 'Neck', 'Rotator cuff', 'Shins', 'Forearms']);

/** Whether a focus heading (or a builder info `angle`) is Swap / Add only. */
export function isBrowseOnlyFocus(f: string): boolean {
  return (BUILDER_BROWSE_ONLY_FOCI as ReadonlySet<string>).has(f);
}

/** Whether the builder may pick this exercise by itself for its group (a browse-only focus is Swap / Add only). */
export function isBuilderAutoPick(e: BuilderMuscleInfo): boolean {
  const f = builderFocusOf(e);
  return f !== null && !BUILDER_BROWSE_ONLY_FOCI.has(f);
}

/**
 * Whether a focus's sets count toward its builder group (review counts).
 * Forearms count in no group (D5's counting list has no forearms row), so a
 * wrist curl's sets are never shown as biceps sets.
 */
export function builderFocusCounts(f: BuilderFocus | null): boolean {
  return f !== null && f !== 'Forearms';
}

const MUSCLE_FOCUS = {
  chest: 'Mid chest',
  upper_chest: 'Upper chest',
  lats: 'Lats',
  serratus: 'Serratus',
  upper_back: 'Mid-back',
  traps: 'Mid-back',
  spinal_erectors: 'Lower back',
  rear_delts: 'Rear delts',
  neck: 'Neck',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rotator_cuff: 'Rotator cuff',
  biceps: 'Biceps',
  brachialis: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings & glutes',
  glutes: 'Hamstrings & glutes',
  adductors: 'Hamstrings & glutes',
  abductors: 'Hamstrings & glutes',
  calves: 'Calves',
  tibialis: 'Shins',
  abs: 'Abs',
  obliques: 'Abs',
  core: 'Abs',
  hip_flexors: 'Abs',
  forearms: 'Forearms',
  grip: 'Forearms',
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
  neck: 'neck',
  serratus: 'serratus',
  rotator_cuff: 'rotator cuff',
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
  tibialis: 'shins',
  abs: 'abs',
  obliques: 'obliques',
  core: 'core',
  hip_flexors: 'hip flexors',
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
