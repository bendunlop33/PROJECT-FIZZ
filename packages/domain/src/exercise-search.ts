import type { EquipmentInstance, Exercise, ExerciseEquipmentKind, MuscleGroup } from '@fizz/schemas';
import { muscleGroupOf } from '@fizz/schemas';

import { equipmentForExercise, needsNoEquipment } from './exercise-equipment';

/**
 * Exercise search and filters (exercise-library EL1, EL2, §9.3). Pure and
 * local: name, catalogue aliases and Ben's own names, one typo per word of 5+
 * letters, ranked exact name → name prefix → alias → word → typo. Works with
 * no network and no AI (rule 1). The same matcher serves the workout's
 * picker, the editor's add sheet and the Library, so Ben learns it once.
 */

/** How a query matched, best first. Lower rank = better. */
export type MatchKind = 'exact' | 'prefix' | 'alias' | 'word' | 'alias_word' | 'typo' | 'alias_typo';

const RANK: Record<MatchKind, number> = { exact: 0, prefix: 1, alias: 2, word: 3, alias_word: 4, typo: 5, alias_typo: 6 };

export interface ExerciseMatch {
  kind: MatchKind;
  rank: number;
  /** The alias that matched (`Matches "RDL"`), as written in the catalogue or by Ben; null on a name hit. */
  matchedAlias: string | null;
}

/** Lower-case, accents off, every run of non-letters/digits one space. */
export function normaliseSearchText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const wordsOf = (s: string): string[] => normaliseSearchText(s).split(' ').filter((w) => w !== '');

/** Optimal string alignment distance (Damerau: a swap of two neighbours is one edit), capped at `max + 1`. */
export function editDistance(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      if (i === 0) {
        row.push(j);
        continue;
      }
      const prev = rows[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, ((rows[i - 2] as number[])[j - 2] as number) + 1);
      row.push(v);
    }
    rows.push(row);
    if (Math.min(...row) > max) return max + 1;
  }
  return Math.min((rows[a.length] as number[])[b.length] as number, max + 1);
}

/** One query word against one target word: a prefix, else (5+ letters) one typo, also while still typing (a prefix of the same length). */
function wordHit(q: string, w: string): 'prefix' | 'typo' | null {
  if (w.startsWith(q)) return 'prefix';
  if (q.length < 5) return null;
  if (editDistance(q, w) <= 1) return 'typo';
  // `romanain dead`: compare with the start of a longer word too.
  if (w.length > q.length && editDistance(q, w.slice(0, q.length)) <= 1) return 'typo';
  return null;
}

/** Every query word hits some word of the target: `word` if all by prefix, `typo` if any needed one. */
function wordsMatch(qWords: readonly string[], target: readonly string[]): 'word' | 'typo' | null {
  let typo = false;
  for (const q of qWords) {
    let best: 'prefix' | 'typo' | null = null;
    for (const w of target) {
      const h = wordHit(q, w);
      if (h === 'prefix') {
        best = 'prefix';
        break;
      }
      if (h === 'typo') best = 'typo';
    }
    if (best === null) return null;
    if (best === 'typo') typo = true;
  }
  return typo ? 'typo' : 'word';
}

/** How `query` matches an exercise's name and aliases (EL1), or null. An empty query matches nothing here (callers list everything instead). */
export function matchExercise(query: string, name: string, aliases: readonly string[] = []): ExerciseMatch | null {
  const q = normaliseSearchText(query);
  if (q === '') return null;
  const qWords = q.split(' ');
  const n = normaliseSearchText(name);
  const compact = (s: string) => s.replace(/ /g, '');
  const hit = (kind: MatchKind, alias: string | null = null): ExerciseMatch => ({ kind, rank: RANK[kind], matchedAlias: alias });
  if (n === q || compact(n) === compact(q)) return hit('exact');
  if (n.startsWith(q)) return hit('prefix');
  for (const a of aliases) {
    const na = normaliseSearchText(a);
    if (na === q || compact(na) === compact(q) || na.startsWith(q)) return hit('alias', a);
  }
  const nameWords = n.split(' ');
  const onName = wordsMatch(qWords, nameWords);
  if (onName === 'word') return hit('word');
  let aliasTypo: string | null = null;
  for (const a of aliases) {
    const m = wordsMatch(qWords, wordsOf(a));
    if (m === 'word') return hit('alias_word', a);
    if (m === 'typo' && aliasTypo === null) aliasTypo = a;
  }
  if (onName === 'typo') return hit('typo');
  if (aliasTypo !== null) return hit('alias_typo', aliasTypo);
  return null;
}

/**
 * Search a list by name (and `aliases`, when the items carry them): every
 * match, best first (EL1), then A–Z. An empty query returns everything A–Z.
 * Replaces the build's prefix-only search; same signature for its callers.
 */
export function searchExercises<T extends { name: string; aliases?: readonly string[] }>(list: readonly T[], query: string): T[] {
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (normaliseSearchText(query) === '') return sorted;
  return sorted
    .flatMap((e) => {
      const m = matchExercise(query, e.name, e.aliases ?? []);
      return m === null ? [] : [{ e, m }];
    })
    .sort((a, b) => a.m.rank - b.m.rank || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e);
}

// ---------------------------------------------------------------------------
// Filters (§2.3)

/** The `Equipment` filter's six kinds (§2.3). */
export const EQUIPMENT_FILTERS = ['barbell', 'dumbbells', 'cable_stack', 'plate_loaded', 'bodyweight', 'assisted'] as const;
export type EquipmentFilter = (typeof EQUIPMENT_FILTERS)[number];

export const EQUIPMENT_FILTER_LABEL: Record<EquipmentFilter, string> = {
  barbell: 'Barbell',
  dumbbells: 'Dumbbells',
  cable_stack: 'Cable / stack',
  plate_loaded: 'Plate-loaded',
  bodyweight: 'Bodyweight',
  assisted: 'Assisted',
};

const FILTER_KINDS: Record<EquipmentFilter, readonly ExerciseEquipmentKind[]> = {
  barbell: ['barbell', 'ez_bar', 'trap_bar'],
  dumbbells: ['dumbbells'],
  cable_stack: ['weight_stack'],
  plate_loaded: ['plate_loaded_machine'],
  bodyweight: ['bodyweight_station'],
  assisted: ['assisted_stack'],
};

/** The `Movement` filter (§2.3), in sheet order. Values are the catalogue's movement patterns. */
export const MOVEMENT_FILTERS = ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'squat', 'hinge', 'lunge', 'carry', 'core', 'arms', 'calves', 'conditioning'] as const;
export type MovementFilter = (typeof MOVEMENT_FILTERS)[number];

export const MOVEMENT_FILTER_LABEL: Record<MovementFilter, string> = {
  horizontal_push: 'Horizontal push',
  vertical_push: 'Vertical push',
  horizontal_pull: 'Horizontal pull',
  vertical_pull: 'Vertical pull',
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Lunge / single leg',
  carry: 'Carry',
  core: 'Core',
  arms: 'Arms',
  calves: 'Calves',
  conditioning: 'Conditioning',
};

export interface ExerciseFilters {
  /** Primary muscles in any of these groups. Empty = any. */
  muscles: readonly MuscleGroup[];
  /** Movement pattern is one of these. Empty = any. */
  movements: readonly MovementFilter[];
  /** Done with any of these kinds. Empty = any. */
  equipment: readonly EquipmentFilter[];
  /** `At <gym>` (EL2): leave out what this gym can't do; they are counted, never silently missing. */
  atGym: boolean;
}

export const NO_FILTERS: ExerciseFilters = { muscles: [], movements: [], equipment: [], atGym: false };

/** How many filters are on (for `Clear filters`). `At <gym>` counts. */
export function activeFilterCount(f: ExerciseFilters): number {
  return f.muscles.length + f.movements.length + f.equipment.length + (f.atGym ? 1 : 0);
}

export type FilterableExercise = Pick<Exercise, 'movementPattern' | 'primaryMuscles' | 'compatibleEquipment' | 'defaultLoadConvention'>;

/** The exercise's `Equipment` filter kinds. A bodyweight exercise (no station needed) is `Bodyweight`. */
export function equipmentFiltersOf(e: Pick<Exercise, 'compatibleEquipment' | 'defaultLoadConvention'>): EquipmentFilter[] {
  const out = EQUIPMENT_FILTERS.filter((f) => FILTER_KINDS[f].some((k) => e.compatibleEquipment.includes(k)));
  if (e.defaultLoadConvention === 'bodyweight' && !out.includes('bodyweight')) out.push('bodyweight');
  return out;
}

/** The muscle groups of the exercise's primary muscles, in its own order, once each. */
export function muscleGroupsOf(e: Pick<Exercise, 'primaryMuscles'>): MuscleGroup[] {
  const out: MuscleGroup[] = [];
  for (const m of e.primaryMuscles) {
    const g = muscleGroupOf(m);
    if (g !== null && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Muscle, movement and equipment filters (not `At <gym>`). Within a filter any choice matches; across filters all must. */
export function passesFilters(e: FilterableExercise, f: ExerciseFilters): boolean {
  if (f.muscles.length > 0 && !muscleGroupsOf(e).some((g) => f.muscles.includes(g))) return false;
  if (f.movements.length > 0 && !f.movements.some((m) => m === e.movementPattern)) return false;
  if (f.equipment.length > 0 && !equipmentFiltersOf(e).some((k) => f.equipment.includes(k))) return false;
  return true;
}

export type GymAvailability = 'available' | 'not_at_gym' | 'unknown';

/**
 * Whether the selected gym can do it: an available item it can be logged on,
 * or no equipment needed. `unknown` with no gym selected (nothing is checked).
 */
export function gymAvailability(e: Pick<Exercise, 'compatibleEquipment' | 'defaultLoadConvention'>, gym: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[] | null): GymAvailability {
  if (gym === null) return 'unknown';
  if (needsNoEquipment(e) || e.compatibleEquipment.length === 0) return 'available';
  return equipmentForExercise(e, gym).length > 0 ? 'available' : 'not_at_gym';
}

export interface SearchableEntry {
  exercise: FilterableExercise & Pick<Exercise, 'id' | 'name'>;
  /** Catalogue aliases and Ben's own names for it. */
  aliases: readonly string[];
}

export interface ExerciseSearchRow<T extends SearchableEntry> {
  entry: T;
  /** Null without a query. */
  match: ExerciseMatch | null;
  availability: GymAvailability;
}

/**
 * `searchExercises` with filters (§6, §9.10): rows that pass the filters and
 * match the query (all of them without one), best match first then A–Z, and
 * how many `At <gym>` left out (`12 more not at Main Gym. Show ›`). A pain
 * flag never hides a row (EL9).
 */
export function searchExerciseRows<T extends SearchableEntry>(
  entries: readonly T[],
  query: string,
  filters: ExerciseFilters,
  gym: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[] | null,
): { rows: ExerciseSearchRow<T>[]; hiddenByGymCount: number } {
  const searching = normaliseSearchText(query) !== '';
  const rows: ExerciseSearchRow<T>[] = [];
  let hiddenByGymCount = 0;
  for (const entry of entries) {
    if (!passesFilters(entry.exercise, filters)) continue;
    const match = searching ? matchExercise(query, entry.exercise.name, entry.aliases) : null;
    if (searching && match === null) continue;
    const availability = gymAvailability(entry.exercise, gym);
    if (filters.atGym && availability === 'not_at_gym') {
      hiddenByGymCount += 1;
      continue;
    }
    rows.push({ entry, match, availability });
  }
  rows.sort((a, b) => (a.match?.rank ?? 0) - (b.match?.rank ?? 0) || a.entry.exercise.name.localeCompare(b.entry.exercise.name));
  return { rows, hiddenByGymCount };
}
