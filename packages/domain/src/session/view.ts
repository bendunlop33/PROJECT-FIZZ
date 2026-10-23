import type { Load, SessionAggregate, SessionExercise, SetExclusion, SetValues, WorkoutSession, WorkoutSet } from '@fizz/schemas';
import { restOverrunMs, restRemainingMs } from '../rest';
import { toMs } from '../time';
import { carriedLoad, type CarryOptions } from './carry';
import { draftAsValues } from './pending-values';
import { warmupRampLoads } from './warmup-ramp';

/**
 * Derived phase (flow §3.1). "Result saved" is not a stored phase: the commit
 * is a single transaction, and the 1 s guard after it is purely UI.
 */
export type SessionPhase =
  | { kind: 'finished' }
  | { kind: 'paused'; timerRemainingMs: number | null; workRemainingMs: number | null }
  | { kind: 'working'; setId: string; remainingMs: number }
  | { kind: 'resting'; timerId: string; remainingMs: number; nextSetId: string | null }
  | {
      kind: 'ready';
      setId: string;
      /** Set when a rest just ended (expired or skipped) and the next set is waiting. */
      restEnded: { timerId: string; endedAtUtc: string | null; restedMs: number; skipped: boolean } | null;
    }
  /** No live sets at all (empty workout, or every set deleted): offer Add exercise / Add set. */
  | { kind: 'empty' }
  | { kind: 'all_done' };

export function getSessionPhase(state: SessionAggregate, nowMs: number): SessionPhase {
  const { session, restTimer, workInterval } = state;
  if (session.status !== 'active') return { kind: 'finished' };
  if (session.pause !== null) {
    return {
      kind: 'paused',
      timerRemainingMs: restTimer?.status === 'paused' ? restTimer.remainingMsAtPause : null,
      workRemainingMs: workInterval?.status === 'paused' ? workInterval.remainingMsAtPause : null,
    };
  }
  if (!state.sets.some((s) => s.status !== 'deleted')) return { kind: 'empty' };
  if (workInterval?.status === 'running') {
    const remainingMs = Math.max(0, toMs(workInterval.deadlineUtc) - nowMs);
    if (remainingMs > 0) return { kind: 'working', setId: workInterval.setId, remainingMs };
  }
  if (restTimer?.status === 'running' && restRemainingMs(restTimer, nowMs) > 0) {
    return { kind: 'resting', timerId: restTimer.id, remainingMs: restRemainingMs(restTimer, nowMs), nextSetId: session.activeSetId };
  }
  if (session.activeSetId === null) return { kind: 'all_done' };

  let restEnded: Extract<SessionPhase, { kind: 'ready' }>['restEnded'] = null;
  if (restTimer && (restTimer.status === 'running' || restTimer.status === 'expired')) {
    restEnded = {
      timerId: restTimer.id,
      endedAtUtc: restTimer.status === 'expired' ? restTimer.endedAtUtc : restTimer.deadlineUtc,
      restedMs: restTimer.durationS * 1000 + restOverrunMs(restTimer, nowMs),
      skipped: false,
    };
  } else if (restTimer?.status === 'skipped') {
    restEnded = { timerId: restTimer.id, endedAtUtc: restTimer.endedAtUtc, restedMs: 0, skipped: true };
  }
  return { kind: 'ready', setId: session.activeSetId, restEnded };
}

/**
 * Paused time inside `[startMs, endMs]`: each closed pause (and the open one,
 * up to `nowMs`) counts only for the part that overlaps the window. Pauses
 * fully outside it are ignored; partial overlaps are clipped (review R1).
 */
export function pausedMsWithin(state: SessionAggregate, startMs: number, endMs: number, nowMs: number): number {
  const { session } = state;
  const intervals = session.pauses.map((p) => [toMs(p.startUtc), toMs(p.endUtc)] as const);
  if (session.pause !== null) intervals.push([toMs(session.pause.pausedAtUtc), Math.max(nowMs, toMs(session.pause.pausedAtUtc))]);
  let total = 0;
  for (const [a, b] of intervals) total += Math.max(0, Math.min(b, endMs) - Math.max(a, startMs));
  return total;
}

/**
 * Active workout duration: wall time from start to end (or now) minus the
 * paused time inside that window. A corrected start or end time therefore
 * never subtracts a pause that happened outside the corrected window.
 */
export function getActiveDurationMs(state: SessionAggregate, nowMs: number): number {
  const { session } = state;
  const start = toMs(session.startedAt.utc);
  const end = session.endedAt ? toMs(session.endedAt.utc) : nowMs;
  if (end <= start) return 0;
  return Math.max(0, end - start - pausedMsWithin(state, start, end, nowMs));
}

/**
 * The calendar date of a workout with no time of day (an imported FitNotes
 * workout), or null for a workout with real times. Such a workout is shown
 * with this date only: no start or end time and no duration anywhere, since
 * its `startedAt` is only an ordering anchor (rule 6; review B2).
 */
export function dateOnlyOf(session: Pick<WorkoutSession, 'localDate'>): string | null {
  return session.localDate ?? null;
}

/**
 * How long a workout took, for Today and the summary; null for a date-only
 * workout, which has no times to measure (review B2).
 */
export function workoutDurationMs(state: SessionAggregate, nowMs: number): number | null {
  return dateOnlyOf(state.session) === null ? getActiveDurationMs(state, nowMs) : null;
}

/**
 * Operation ID for logging this set's current draft. Deterministic, so it
 * survives a force-close: tapping Log again after a crash reuses it and the
 * set is committed once. A new attempt after Undo gets a new ID.
 */
export function draftOperationId(set: WorkoutSet): string {
  return `log:${set.id}:${set.undoCount}`;
}

/** `last_set`: the target with the load Ben's last logged set of this exercise carries (`carriedLoad`, 21 Oct). */
export type DraftSource = 'draft' | 'target' | 'last_set' | 'this_session' | 'last_session' | 'none';

export interface ComparableSet {
  index: number;
  values: SetValues;
  /** Ben's exclusion flags on that set (§2.13): `Last (1 Oct): 100 kg × 8 · spotted`. Copying still copies the values. */
  exclusions?: readonly SetExclusion[];
}

function compatibleLoad(load: Load | null, ex: SessionExercise): Load | null {
  if (load === null) return null;
  return load.unit === ex.unit && load.convention === ex.loadConvention ? load : null;
}

const EMPTY: SetValues = { load: null, reps: null, durationS: null, rpe: null, rir: null };

/**
 * Draft prefill (active-workout.md §4.2), first match wins:
 * saved draft → target (top of rep range; its load replaced by the load
 * Ben's last logged set carries, rule 2a) → last set of this exercise this
 * session → matching set of the last comparable session → empty.
 * A warm-up with no load target takes the ramp up to the working load
 * (`warmupRampLoads`); its history is only this session's warm-ups.
 * Effort is never prefilled.
 */
export function prefillDraft(
  state: SessionAggregate,
  setId: string,
  lastComparable: readonly ComparableSet[] = [],
  opts: CarryOptions = {},
): { values: SetValues; source: DraftSource } {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return { values: EMPTY, source: 'none' };
  // A load saved as the carry follows the carry: after it ends (Undo of that log) the target (CS1).
  if (set.draft) return { values: draftAsValues(set.draft, set.planned, set.draft.loadCarried === true ? carriedLoad(state, set, opts) : null), source: 'draft' };
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);

  const warmup = set.setType === 'warmup';
  const done = state.sets
    // A warm-up never falls back to a working set's values (23 Oct: every warm-up prefilled the working weight).
    .filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.status === 'completed' && s.actual && s.completedAt && (!warmup || s.setType === 'warmup'))
    .sort((a, b) => toMs(b.completedAt?.utc ?? '') - toMs(a.completedAt?.utc ?? ''));
  const lastHere = done[0]?.actual ?? null;
  const comparable = warmup ? null : ((lastComparable.find((c) => c.index === set.index) ?? lastComparable[lastComparable.length - 1])?.values ?? null);
  // History in another unit or convention is never copied in as-is (review B1).
  const lastThere = comparable && ex ? { ...comparable, load: compatibleLoad(comparable.load, ex) } : comparable;
  // A warm-up's load: its own target, else the ramp to the working load (`warmupRampLoads`), else this session's last warm-up.
  const fallback = warmup ? lastHere : (lastHere ?? lastThere);
  const ramp = warmup && set.planned.load === null ? (warmupRampLoads(state, set.sessionExerciseId, (w) => prefillDraft(state, w.id, lastComparable, opts).values.load).get(set.id) ?? null) : null;

  const p = set.planned;
  const plannedDistance = p.distanceM ?? null;
  if (p.load !== null || p.reps !== null || p.durationS !== null || plannedDistance !== null) {
    // Target fields win; any field the target leaves open falls back to history.
    const distanceM = plannedDistance ?? fallback?.distanceM ?? null;
    const carry = carriedLoad(state, set, opts);
    return {
      values: {
        ...EMPTY,
        load: carry ?? p.load ?? ramp ?? fallback?.load ?? null,
        reps: p.reps?.max ?? fallback?.reps ?? null,
        durationS: p.durationS ?? fallback?.durationS ?? null,
        ...(distanceM !== null ? { distanceM } : {}),
      },
      source: carry !== null ? 'last_set' : 'target',
    };
  }
  if (ramp !== null) return { values: { ...EMPTY, load: ramp, reps: fallback?.reps ?? null }, source: 'target' };
  if (lastHere) return { values: { ...lastHere, rpe: null, rir: null }, source: 'this_session' };
  if (lastThere) return { values: { ...lastThere, rpe: null, rir: null }, source: 'last_session' };
  return { values: EMPTY, source: 'none' };
}

export interface SetPair {
  partnerSetId: string;
  /** `first_side`: this set was logged as one side; `other_side`: this is the row added for the other side. */
  role: 'first_side' | 'other_side';
}

/**
 * The live left/right pair a unilateral set belongs to, for the "pair" badge
 * (review R4, third review follow-up 2). Null when either side is deleted:
 * `pairedWithSetId` is kept on a logged other-side row as provenance, but a
 * row whose partner was deleted is shown as a standalone set, never as a pair.
 */
export function getSetPair(state: SessionAggregate, setId: string): SetPair | null {
  const set = state.sets.find((s) => s.id === setId);
  if (!set || set.status === 'deleted') return null;
  if (set.pairedWithSetId !== null) {
    const partner = state.sets.find((s) => s.id === set.pairedWithSetId);
    return partner && partner.status !== 'deleted' ? { partnerSetId: partner.id, role: 'other_side' } : null;
  }
  const other = state.sets.find((s) => s.pairedWithSetId === set.id && s.status !== 'deleted');
  return other ? { partnerSetId: other.id, role: 'first_side' } : null;
}
