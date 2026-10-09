/**
 * Catalogue loader for the app. The bundled JSON is validated at build time
 * (`catalogue:validate`, in `npm run check`) and again here, so a bad entry is
 * skipped and reported instead of crashing launch.
 *
 * Exercise rows: `id = UUIDv5(key)`, `source: 'catalogue'`, `ownerId: null`,
 * `version: 1`. Seeding them into SQLite (and the "Coaching knowledge"
 * namespace, rule 10) is the app's job and not done here.
 */
import type { Exercise, UtcTimestamp } from '@fizz/schemas';
import { CatalogueEntrySchema, type CatalogueEntry } from './entry-schema';
import { BUNDLED_EXERCISE_FILES } from './generated/exercise-files';
import { catalogueExerciseId } from './uuid';

export interface CatalogueLoadIssue {
  index: number;
  key: string | null;
  message: string;
}

export interface Catalogue {
  readonly entries: readonly CatalogueEntry[];
  byKey(key: string): CatalogueEntry | undefined;
  byId(id: string): CatalogueEntry | undefined;
}

export interface CatalogueLoadResult {
  catalogue: Catalogue;
  issues: CatalogueLoadIssue[];
}

function keyOf(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null && 'key' in raw && typeof raw.key === 'string') return raw.key;
  return null;
}

export function loadCatalogue(raw: readonly unknown[]): CatalogueLoadResult {
  const issues: CatalogueLoadIssue[] = [];
  const entries: CatalogueEntry[] = [];
  const keyed = new Map<string, CatalogueEntry>();
  const ided = new Map<string, CatalogueEntry>();
  raw.forEach((item, index) => {
    const parsed = CatalogueEntrySchema.safeParse(item);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      issues.push({ index, key: keyOf(item), message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid entry' });
      return;
    }
    const entry = parsed.data;
    if (keyed.has(entry.key)) {
      issues.push({ index, key: entry.key, message: 'Duplicate key; the first entry wins' });
      return;
    }
    entries.push(entry);
    keyed.set(entry.key, entry);
    ided.set(catalogueExerciseId(entry.key), entry);
  });
  return {
    catalogue: { entries, byKey: (k) => keyed.get(k), byId: (id) => ided.get(id) },
    issues,
  };
}

let bundled: CatalogueLoadResult | undefined;

/** The catalogue shipped with the app (memoised). */
export function bundledCatalogue(): CatalogueLoadResult {
  bundled ??= loadCatalogue(BUNDLED_EXERCISE_FILES);
  return bundled;
}

/** One entry, validated on demand (`missing`: no bundled file has that key). */
export type EntryLoad = { ok: true; entry: CatalogueEntry } | { ok: false; reason: 'missing' } | { ok: false; reason: 'invalid'; message: string };

/**
 * Per-entry access without validating the whole catalogue. Parsing all 133
 * entries takes ~50 ms cold in V8 and several times that on Hermes, which is
 * too slow for a picker that only needs to know which rows have a how-to.
 * `tierHint` reads the raw `tier` field without validation: it is only a
 * hint for showing a button (the build validates every file, and `entry`
 * validates before anything is shown).
 */
export interface LazyCatalogue {
  readonly keys: ReadonlySet<string>;
  tierHint(key: string): 'rich' | 'basic' | null;
  entry(key: string): EntryLoad;
}

export function createLazyCatalogue(raw: readonly unknown[]): LazyCatalogue {
  const byKey = new Map<string, unknown>();
  for (const item of raw) {
    const key = keyOf(item);
    if (key !== null && !byKey.has(key)) byKey.set(key, item);
  }
  const memo = new Map<string, EntryLoad>();
  return {
    keys: new Set(byKey.keys()),
    tierHint(key) {
      const item = byKey.get(key);
      if (typeof item !== 'object' || item === null || !('tier' in item)) return null;
      return item.tier === 'rich' ? 'rich' : item.tier === 'basic' ? 'basic' : null;
    },
    entry(key) {
      const hit = memo.get(key);
      if (hit) return hit;
      const item = byKey.get(key);
      let result: EntryLoad;
      if (item === undefined) {
        result = { ok: false, reason: 'missing' };
      } else {
        const parsed = CatalogueEntrySchema.safeParse(item);
        const first = parsed.success ? undefined : parsed.error.issues[0];
        result = parsed.success ? { ok: true, entry: parsed.data } : { ok: false, reason: 'invalid', message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid entry' };
      }
      memo.set(key, result);
      return result;
    },
  };
}

let lazyBundled: LazyCatalogue | undefined;

/** The shipped catalogue, validated one entry at a time (memoised). */
export function lazyBundledCatalogue(): LazyCatalogue {
  lazyBundled ??= createLazyCatalogue(BUNDLED_EXERCISE_FILES);
  return lazyBundled;
}

export type ExerciseRowResult =
  | { ok: true; exercise: Exercise }
  | { ok: false; reason: 'distance_not_loggable'; message: string };

/**
 * The `Exercise` row for a catalogue entry. `at` is the catalogue release
 * time used for both audit timestamps, so reseeding the same release is a
 * no-op. Distance exercises have no row until sets can record a distance.
 */
export function toExerciseRow(entry: CatalogueEntry, at: UtcTimestamp): ExerciseRowResult {
  if (entry.measurement === 'distance') {
    return {
      ok: false,
      reason: 'distance_not_loggable',
      message: `${entry.name} is measured by distance, which sets can't record yet.`,
    };
  }
  const exercise: Exercise = {
    id: catalogueExerciseId(entry.key),
    ownerId: null,
    source: 'catalogue',
    name: entry.name,
    movementPattern: entry.movementPattern,
    primaryMuscles: [...entry.primaryMuscles],
    secondaryMuscles: [...entry.secondaryMuscles],
    catalogueKey: entry.key,
    family: entry.family,
    mechanic: entry.mechanic,
    measurement: entry.measurement,
    laterality: entry.laterality,
    compatibleEquipment: [...entry.compatibleEquipment],
    defaultLoadConvention: entry.defaultLoadConvention,
    version: 1,
    createdAtUtc: at,
    updatedAtUtc: at,
  };
  if (entry.defaultRestS !== undefined) exercise.defaultRestS = entry.defaultRestS;
  return { ok: true, exercise };
}
