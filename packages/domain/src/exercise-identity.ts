import type { Exercise, PainFlag } from '@fizz/schemas';
import { painFlagCovering } from './pain-flags';

/**
 * (Review coach-add S2) The same movement under another exercise ID: a
 * FitNotes-imported custom "Lateral Raise" and the catalogue's "Lateral
 * raise", or Ben's saved row and the catalogue entry it came from. Same ID,
 * same catalogue key, or the same name once case, punctuation and a plural
 * "s" are ignored. Never a similar movement (coach-memory CM5: the app
 * doesn't decide which joints are involved).
 */
export function movementNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

type Identity = Pick<Exercise, 'id' | 'name'> & { catalogueKey?: string | null | undefined };

export function sameMovement(a: Identity, b: Identity): boolean {
  if (a.id === b.id) return true;
  if (a.catalogueKey != null && a.catalogueKey === b.catalogueKey) return true;
  return movementNameKey(a.name) === movementNameKey(b.name);
}

/** The IDs in `pool` that are the same movement as `exercise` (itself included). */
export function sameMovementIds(exercise: Identity, pool: readonly Identity[]): string[] {
  return [exercise.id, ...pool.filter((o) => o.id !== exercise.id && sameMovement(o, exercise)).map((o) => o.id)];
}

/** Does a row (its exercise ID and name snapshot) stand for this movement? */
export function rowIsMovement(row: { exerciseId: string; exerciseName: string }, exercise: Identity, ids: readonly string[]): boolean {
  return ids.includes(row.exerciseId) || movementNameKey(row.exerciseName) === movementNameKey(exercise.name);
}

/**
 * The active pain flag on this movement under any of its IDs or its name
 * (rule 9: pain stops that movement, not one row ID). `painFlagCovering`'s
 * order: the one whose check is due first, else the oldest.
 */
export function painFlagForMovement(flags: readonly PainFlag[], exercise: Identity, ids: readonly string[], nowMs: number, tz: string): PainFlag | null {
  const matching = flags.filter((f) => f.status === 'active' && rowIsMovement(f, exercise, ids)).map((f) => ({ ...f, exerciseId: exercise.id }));
  const hit = painFlagCovering(matching, exercise.id, nowMs, tz)?.flag ?? null;
  return hit === null ? null : (flags.find((f) => f.id === hit.id) ?? null);
}

/**
 * A matcher for "is this exercise the same movement as one of these rows or
 * flags?" over a whole list at once (the coach's `addable` list): by ID, by
 * the catalogue key of the row's exercise in `pool`, or by name.
 */
export function movementMatcher(pool: readonly Identity[], seeds: readonly { exerciseId: string; exerciseName: string }[]): (e: Identity) => boolean {
  const ids = new Set(seeds.map((s) => s.exerciseId));
  const names = new Set(seeds.map((s) => movementNameKey(s.exerciseName)));
  const keys = new Set<string>();
  for (const e of pool) {
    if (!ids.has(e.id)) continue;
    if (e.catalogueKey != null) keys.add(e.catalogueKey);
    names.add(movementNameKey(e.name));
  }
  return (e) => ids.has(e.id) || (e.catalogueKey != null && keys.has(e.catalogueKey)) || names.has(movementNameKey(e.name));
}
