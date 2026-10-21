import type { Load, PlannedSet, PlannedSetEdit, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { isLoadAchievable, loadDirection, roundToAvailableLoad } from '../equipment';
import { loadCheckEquipment, rowMarkedBodyweight } from '../added-weight';
import { toMs } from '../time';
import { currentGymEquipment, equipmentOfRow } from './equipment-snapshot';
import { pendingOwnValues, shownPlanned, shownTargetShort, showsBensValues } from './pending-values';
import type { targetShort } from '../display';

/**
 * Last set carries (Ben, 21 Oct 2026; active-workout.md §4.2 rule 2a): when
 * Ben logs a set at a weight other than its target (set 2 at 105 kg against
 * 100), the later pending sets of that exercise in the same set-type group
 * start at his logged weight. It's a prefill, never a write: the stored
 * target (plan adherence, progression history) keeps the original value,
 * and Undo is retyping.
 *
 * A pending set takes the carried load only when all of these hold:
 * - it's a working, top or back-off set (warm-ups and drop sets never carry
 *   and never receive), and the logged set is the same type, earlier in the
 *   same row (same gym part, so the same kit);
 * - its load target is the one it started with: Ben never set its load
 *   (`edit_planned_set`), and no coach or rule change came after the log
 *   (a newer target wins);
 * - the logged set's load differs from its target before any load Ben set
 *   on it himself (`loadBeforeBensEdits`, review CS2);
 * - same unit and convention throughout;
 * - not heavier while the movement has a pain flag (rule 9);
 * - the row's equipment can make it, rounded toward easier, never past its max (rule 4).
 * His own draft on the set wins over all of it (`pendingOwnValues`).
 */

const sameLoad = (a: Load | null, b: Load | null): boolean => (a === null ? b === null : b !== null && a.value === b.value && a.unit === b.unit && a.convention === b.convention);

const NEVER_CARRIES: ReadonlySet<WorkoutSet['setType']> = new Set(['warmup', 'drop']);

/** An `edit_planned_set` record set the load (its `fields`; an older record without them: the load moved). */
const editSetLoad = (e: PlannedSetEdit, after: PlannedSet): boolean => (e.fields !== undefined ? e.fields.includes('load') : !sameLoad(e.before.planned.load, after.load));

/** Ben set this pending set's load himself (`edit_planned_set`), at any point in its edit chain. */
export function benSetLoad(p: PlannedSet): boolean {
  let cur: PlannedSet = p;
  for (let e: PlannedSetEdit | undefined = cur.edit; e !== undefined; e = cur.edit) {
    if (editSetLoad(e, cur)) return true;
    cur = e.before.planned;
  }
  return false;
}

/**
 * The load target a set had before Ben set its load himself (review CS2,
 * 21 Oct): his own target on the logged set is his choice, not the plan, so
 * set 2 raised to 105 in Edit set or the pop-up and logged at 105 carries
 * like set 2 logged at 105 against 100. No edit of his: the target as is.
 */
function loadBeforeBensEdits(p: PlannedSet): Load | null {
  let base: Load | null = p.load;
  let cur: PlannedSet = p;
  for (let e: PlannedSetEdit | undefined = cur.edit; e !== undefined; e = cur.edit) {
    if (editSetLoad(e, cur)) base = e.before.planned.load;
    cur = e.before.planned;
  }
  return base;
}

/** Something in the session already says this movement hurts: a set logged with `pain`, or a target held or halted for pain. */
function painInSession(state: Pick<SessionAggregate, 'sets' | 'exercises'>, set: WorkoutSet, exerciseId: string): boolean {
  const p = set.planned;
  if (p.snap?.painHeld === true || p.provenance?.held === true || p.provenance?.rule?.decision === 'halted_pain') return true;
  // Any part of the movement (after a gym switch too).
  const rows = new Set(state.exercises.filter((e) => e.exerciseId === exerciseId).map((e) => e.id));
  return state.sets.some((s) => rows.has(s.sessionExerciseId) && s.status === 'completed' && (s.exclusions ?? []).includes('pain'));
}

/** `a` is harder than `b` (heavier; less assistance on an assisted machine). */
function harder(a: Load, b: Load): boolean {
  return loadDirection(a.convention) === 'resistance' ? a.value > b.value : a.value < b.value;
}

export interface CarryOptions {
  /** Catalogue exercise IDs with an active pain flag. Omitted: only what the session itself records. */
  painFlagged?: ReadonlySet<string> | undefined;
}

/**
 * The load a pending set shows and prefills from Ben's last logged set of
 * this exercise this session, or null when nothing carries (see above).
 * `set` may be a copy with a newer target than the one in `state`.
 */
export function carriedLoad(state: Pick<SessionAggregate, 'sets' | 'exercises' | 'session'>, set: WorkoutSet, opts: CarryOptions = {}): Load | null {
  if (set.status !== 'pending' || NEVER_CARRIES.has(set.setType)) return null;
  const ex: SessionExercise | undefined = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (!ex || ex.loadConvention === 'bodyweight') return null;
  const p = set.planned;
  const target = p.load;
  if (target === null || target.unit !== ex.unit || target.convention !== ex.loadConvention) return null;
  if (benSetLoad(p)) return null;

  const logged = state.sets
    .filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.setType === set.setType && s.index < set.index && s.status === 'completed' && s.actual !== null && s.completedAt !== null)
    .sort((a, b) => toMs(b.completedAt?.utc ?? '') - toMs(a.completedAt?.utc ?? ''))[0];
  const from = logged?.actual?.load ?? null;
  const fromTarget = logged === undefined ? null : loadBeforeBensEdits(logged.planned);
  if (!logged || from === null || fromTarget === null) return null;
  if (from.unit !== ex.unit || from.convention !== ex.loadConvention || fromTarget.unit !== ex.unit || fromTarget.convention !== ex.loadConvention) return null;
  // Logged as planned: nothing of his to carry.
  if (sameLoad(from, fromTarget)) return null;

  // A coach or rule target set after his log is newer and wins; one set before it is older than his log.
  if (p.coach !== undefined) {
    const setAt = p.provenance?.setAt.utc;
    if (setAt === undefined || toMs(setAt) >= toMs(logged.completedAt?.utc ?? '')) return null;
  }

  let load: Load = from;
  const eq = loadCheckEquipment(ex, equipmentOfRow(state.session.equipmentSnapshot, ex), currentGymEquipment(state.session), state.session.gymId, rowMarkedBodyweight(state.sets, ex.id));
  if (eq !== null && !isLoadAchievable(load, eq)) {
    const r = roundToAvailableLoad(load, eq, 'easier');
    if (!r.ok || r.load.unit !== ex.unit || r.load.convention !== ex.loadConvention || harder(r.load, from)) return null;
    load = r.load;
  }
  if (sameLoad(load, target)) return null;
  if (harder(load, target) && ((opts.painFlagged?.has(ex.exerciseId) ?? false) || painInSession(state, set, ex.exerciseId))) return null;
  return load;
}

type CarryState = Pick<SessionAggregate, 'sets' | 'exercises' | 'session'>;

/**
 * Ben has values of his own on this pending set's draft, judged where his
 * pain flags aren't known (the reducer, and the screen's reconcile; review
 * CS4). The carry differs with and without a flag (a heavier one is blocked
 * on a flagged movement), so a draft counts as his when it is his against
 * either: a typed 105 on a flagged bench (no carry shown) and a typed 100 over
 * a carried 105 both stay. A draft equal to an unshown carry is kept too; that
 * does no harm.
 */
export function hasOwnValuesAnyFlags(state: CarryState, set: WorkoutSet): boolean {
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (ex === undefined) return false;
  const unflagged = carriedLoad(state, set);
  const flagged = carriedLoad(state, set, { painFlagged: new Set([ex.exerciseId]) });
  return Object.keys(pendingOwnValues(set, ex, unflagged)).length > 0 || Object.keys(pendingOwnValues(set, ex, flagged)).length > 0;
}
type Row = Pick<SessionExercise, 'unit' | 'loadConvention' | 'measurement'>;

/**
 * What a pending row shows, in every view (table, Focus, pop-up, Edit set,
 * rest `Next`, lock screen, voice): `shownPlanned` with the carried load.
 * One path, so no surface draws the plan while another draws Ben's weight.
 */
export function shownPlannedIn(state: CarryState, set: WorkoutSet, ex: Row, opts: CarryOptions = {}): PlannedSet {
  return shownPlanned(set, ex, carriedLoad(state, set, opts));
}

/** `shownTargetShort` with the carried load (`Your edit 105 kg × 6–8`). */
export function shownTargetShortIn(state: CarryState, set: WorkoutSet, ex: Row, o: Parameters<typeof targetShort>[1], opts: CarryOptions = {}): string | null {
  return shownTargetShort(set, ex, o, carriedLoad(state, set, opts));
}

/** `showsBensValues` with the carried load. */
export function showsBensValuesIn(state: CarryState, set: WorkoutSet, ex: Row, opts: CarryOptions = {}): boolean {
  return showsBensValues(set, ex, carriedLoad(state, set, opts));
}

/** `pendingOwnValues` against what the row shows without a draft (the carried load, else the target). */
export function pendingOwnValuesIn(state: CarryState, set: WorkoutSet, ex: Row, opts: CarryOptions = {}): ReturnType<typeof pendingOwnValues> {
  return pendingOwnValues(set, ex, carriedLoad(state, set, opts));
}

/** Catalogue exercise IDs with an active pain flag, from a view input's two sources. */
export function painFlaggedOf(input: { painFlagged?: ReadonlySet<string> | undefined; painFlags?: readonly { exerciseId: string; status: string }[] | undefined }): ReadonlySet<string> {
  return new Set([...(input.painFlagged ?? []), ...(input.painFlags ?? []).filter((f) => f.status === 'active').map((f) => f.exerciseId)]);
}
