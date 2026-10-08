import type { SessionAggregate, SetValues, WorkoutSet } from '@fizz/schemas';
import { restOverrunMs, restRemainingMs } from '../rest';
import { toMs } from '../time';

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

/** Active workout duration: wall time minus paused time. */
export function getActiveDurationMs(state: SessionAggregate, nowMs: number): number {
  const { session } = state;
  const end = session.endedAt ? toMs(session.endedAt.utc) : nowMs;
  const currentPause = session.pause ? Math.max(0, nowMs - toMs(session.pause.pausedAtUtc)) : 0;
  return Math.max(0, end - toMs(session.startedAt.utc) - session.pausedTotalMs - currentPause);
}

/**
 * Operation ID for logging this set's current draft. Deterministic, so it
 * survives a force-close: tapping Log again after a crash reuses it and the
 * set is committed once. A new attempt after Undo gets a new ID.
 */
export function draftOperationId(set: WorkoutSet): string {
  return `log:${set.id}:${set.undoCount}`;
}

export type DraftSource = 'draft' | 'target' | 'this_session' | 'last_session' | 'none';

export interface ComparableSet {
  index: number;
  values: SetValues;
}

const EMPTY: SetValues = { load: null, reps: null, durationS: null, rpe: null, rir: null };

/**
 * Draft prefill (active-workout.md §4.2), first match wins:
 * saved draft → target (top of rep range) → last set of this exercise this
 * session → matching set of the last comparable session → empty.
 * Effort is never prefilled.
 */
export function prefillDraft(
  state: SessionAggregate,
  setId: string,
  lastComparable: readonly ComparableSet[] = [],
): { values: SetValues; source: DraftSource } {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return { values: EMPTY, source: 'none' };
  if (set.draft) return { values: set.draft, source: 'draft' };

  const done = state.sets
    .filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.status === 'completed' && s.actual && s.completedAt)
    .sort((a, b) => toMs(b.completedAt?.utc ?? '') - toMs(a.completedAt?.utc ?? ''));
  const lastHere = done[0]?.actual ?? null;
  const lastThere =
    (lastComparable.find((c) => c.index === set.index) ?? lastComparable[lastComparable.length - 1])?.values ?? null;
  const fallback = lastHere ?? lastThere;

  const p = set.planned;
  if (p.load !== null || p.reps !== null || p.durationS !== null) {
    // Target fields win; any field the target leaves open falls back to history.
    return {
      values: {
        ...EMPTY,
        load: p.load ?? fallback?.load ?? null,
        reps: p.reps?.max ?? fallback?.reps ?? null,
        durationS: p.durationS ?? fallback?.durationS ?? null,
      },
      source: 'target',
    };
  }
  if (lastHere) return { values: { ...lastHere, rpe: null, rir: null }, source: 'this_session' };
  if (lastThere) return { values: { ...lastThere, rpe: null, rir: null }, source: 'last_session' };
  return { values: EMPTY, source: 'none' };
}
