import type { Load, PlannedSet, SessionExercise, SetValues, WorkoutSet } from '@fizz/schemas';
import { targetShort } from '../display';

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

/**
 * The fields of a pending set's saved draft that differ from what it shows
 * without one: Ben's own values. Empty for any other set. `carry`: the load
 * his last logged set carries onto this set (`carriedLoad`, 21 Oct); his
 * draft load is his own when it differs from that (so retyping the plan's
 * 100 over a carried 105 sticks), else when it differs from the target.
 */
export function pendingOwnValues(set: Pick<WorkoutSet, 'status' | 'draft' | 'planned'>, ex: Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>, carry: Load | null = null): PendingOwnValues {
  const d: SetValues | null = set.draft;
  if (set.status !== 'pending' || d === null) return {};
  const p = set.planned;
  const own: PendingOwnValues = {};
  const load = d.load;
  if (ex.loadConvention !== 'bodyweight' && load !== null && load.unit === ex.unit && load.convention === ex.loadConvention && !sameLoad(load, carry ?? p.load)) {
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
 * The target a pending row draws: the stored target with the load his last
 * logged set carries (`carry`, 21 Oct) and then Ben's own draft values laid
 * over it (`pendingOwnValues`). His reps read as one number (`9`), not a
 * range. The stored target itself is unchanged.
 */
export function shownPlanned(set: Pick<WorkoutSet, 'status' | 'draft' | 'planned'>, ex: Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>, carry: Load | null = null): PlannedSet {
  const own = pendingOwnValues(set, ex, carry);
  const carried = set.status === 'pending' && carry !== null ? carry : null;
  if (Object.keys(own).length === 0 && carried === null) return set.planned;
  const load = own.load ?? carried;
  return {
    ...set.planned,
    ...(load !== null ? { load } : {}),
    ...(own.reps !== undefined ? { reps: { min: own.reps, max: own.reps } } : {}),
    ...(own.durationS !== undefined ? { durationS: own.durationS } : {}),
    ...(own.distanceM !== undefined ? { distanceM: own.distanceM } : {}),
  };
}

/**
 * `targetShort` for what a pending row shows (B2, 21 Oct): Ben's own draft
 * values over the target, worded `Your edit 105 kg × 6–8` (never `Target` or
 * `Coach target` for a value he typed). A load carried from his last logged
 * set is his too, worded the same. Neither: the target as is.
 */
export function shownTargetShort(
  set: Pick<WorkoutSet, 'status' | 'draft' | 'planned'>,
  ex: Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>,
  o: Parameters<typeof targetShort>[1],
  carry: Load | null = null,
): string | null {
  if (!showsBensValues(set, ex, carry)) return targetShort(set.planned, o);
  const p = { ...shownPlanned(set, ex, carry) };
  delete p.source;
  const t = targetShort(p, o);
  return t === null ? null : t.replace(/^Target /, 'Your edit ');
}

/** The row shows a value of Ben's (his draft, or a load carried from his last logged set) rather than the target. */
export function showsBensValues(set: Pick<WorkoutSet, 'status' | 'draft' | 'planned'>, ex: Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>, carry: Load | null = null): boolean {
  return shownPlanned(set, ex, carry) !== set.planned;
}

/** The value fields of a target that `edit_planned_set` changed (`before` → `after`). */
export type TargetValueField = 'load' | 'reps' | 'durationS' | 'distanceM';

export function changedTargetFields(before: Pick<PlannedSet, 'load' | 'reps' | 'durationS' | 'distanceM'>, after: Pick<PlannedSet, 'load' | 'reps' | 'durationS' | 'distanceM'>): TargetValueField[] {
  const out: TargetValueField[] = [];
  if (!sameLoad(before.load, after.load)) out.push('load');
  if ((before.reps?.min ?? null) !== (after.reps?.min ?? null) || (before.reps?.max ?? null) !== (after.reps?.max ?? null)) out.push('reps');
  if (before.durationS !== after.durationS) out.push('durationS');
  if ((before.distanceM ?? null) !== (after.distanceM ?? null)) out.push('distanceM');
  return out;
}

/**
 * Ben's draft values after a new target for some fields (B1, 21 Oct): only
 * the fields the new target changed take its values (the load, the top of
 * the rep range, the time, the distance); every other field he typed stays.
 * So a reps change in the pop-up never drops his typed weight, and a typed
 * weight never drops his reps. Pure; `values` is never mutated.
 */
export function draftWithNewTarget(values: SetValues, planned: Pick<PlannedSet, 'load' | 'reps' | 'durationS' | 'distanceM'>, fields: readonly TargetValueField[]): SetValues {
  const next: SetValues = { ...values };
  for (const f of fields) {
    if (f === 'load') next.load = planned.load;
    else if (f === 'reps') next.reps = planned.reps?.max ?? null;
    else if (f === 'durationS') next.durationS = planned.durationS;
    else next.distanceM = planned.distanceM ?? null;
  }
  return next;
}
