import type { Load, PlannedSet, SessionExercise, SetValues, WorkoutSet } from '@fizz/schemas';

/**
 * A pending set as Ben left it (21 Oct, "If I change the weights from pre
 * set then it keeps flicking back to before"). A value Ben typed on the open
 * row is kept as the set's saved draft; once another row opens, every view of
 * this row (table cells, the Focus list, the exercise pop-up) must still show
 * his value, not the preset target. Pure: no target is worked out here, the
 * draft's fields that differ from the stored target are laid over it.
 *
 * A draft field equal to what the target prefills (the load, the top of the
 * rep range, the planned time or distance) isn't an edit, so a load-only edit
 * keeps the row's `6–8` reps. A draft load in another unit or convention is
 * never shown (rule: kg/lb and convention explicit).
 */
export interface PendingOwnValues {
  load?: Load;
  reps?: number;
  durationS?: number;
  distanceM?: number;
}

const sameLoad = (a: Load | null, b: Load | null): boolean => (a === null ? b === null : b !== null && a.value === b.value && a.unit === b.unit && a.convention === b.convention);

/** The fields of a pending set's saved draft that differ from its target: Ben's own values. Empty for any other set. */
export function pendingOwnValues(set: Pick<WorkoutSet, 'status' | 'draft' | 'planned'>, ex: Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>): PendingOwnValues {
  const d: SetValues | null = set.draft;
  if (set.status !== 'pending' || d === null) return {};
  const p = set.planned;
  const own: PendingOwnValues = {};
  const load = d.load;
  if (ex.loadConvention !== 'bodyweight' && load !== null && load.unit === ex.unit && load.convention === ex.loadConvention && !sameLoad(load, p.load)) {
    // `added` with nothing entered is the bodyweight row's own `BW`, not an edit.
    if (!(load.convention === 'added' && load.value === 0 && p.load === null)) own.load = load;
  }
  if (ex.measurement === 'reps' && d.reps !== null && d.reps !== (p.reps?.max ?? null)) own.reps = d.reps;
  if ((ex.measurement === 'duration' || ex.measurement === 'cardio') && d.durationS !== null && d.durationS !== p.durationS) own.durationS = d.durationS;
  const distance = d.distanceM ?? null;
  if ((ex.measurement === 'distance' || ex.measurement === 'cardio') && distance !== null && distance !== (p.distanceM ?? null)) own.distanceM = distance;
  return own;
}

/**
 * The target a pending row draws: the stored target with Ben's own draft
 * values laid over it (`pendingOwnValues`). His reps read as one number
 * (`9`), not a range. The stored target itself is unchanged.
 */
export function shownPlanned(set: Pick<WorkoutSet, 'status' | 'draft' | 'planned'>, ex: Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>): PlannedSet {
  const own = pendingOwnValues(set, ex);
  if (Object.keys(own).length === 0) return set.planned;
  return {
    ...set.planned,
    ...(own.load !== undefined ? { load: own.load } : {}),
    ...(own.reps !== undefined ? { reps: { min: own.reps, max: own.reps } } : {}),
    ...(own.durationS !== undefined ? { durationS: own.durationS } : {}),
    ...(own.distanceM !== undefined ? { distanceM: own.distanceM } : {}),
  };
}
