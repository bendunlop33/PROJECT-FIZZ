import { MAX_FINISHED_RESUMABLE_DEPTH, MAX_RESUMABLE_RESTS, type ResolvedRest, type RestSetting, type RestTimer, type ResumableRest, type SetType } from '@fizz/schemas';
import { toIso, toMs } from './time';

const SET_TYPE_LABEL: Record<SetType, string> = {
  warmup: 'warm-up sets',
  working: 'working sets',
  top: 'top sets',
  backoff: 'back-off sets',
  drop: 'drop sets',
};

export interface RestPresetInput {
  setType: SetType;
  exerciseName: string;
  /** Step 1: explicit set override (routine template or "this rest only"). */
  setOverrideS: number | null;
  /** Step 2: routine exercise preset for this set type. */
  routineSetTypePreset: RestSetting | null;
  /** Step 3: exercise default. */
  exerciseDefaultS: number | null;
  /** Step 4: global default from the profile. */
  globalDefault: RestSetting;
}

/**
 * Resolve the rest after a set. First match wins:
 * set override → routine set-type preset → exercise default → global default.
 * Returns the source so the editor can show where the value came from.
 */
export function resolveRestPreset(input: RestPresetInput): ResolvedRest {
  if (input.setOverrideS !== null) {
    return { seconds: input.setOverrideS, source: 'set_override', sourceLabel: 'Set override' };
  }
  if (input.routineSetTypePreset !== null) {
    const name = input.routineSetTypePreset.presetName;
    const scope = `${input.exerciseName}, ${SET_TYPE_LABEL[input.setType]}`;
    return {
      seconds: input.routineSetTypePreset.seconds,
      source: 'routine_set_type',
      sourceLabel: name === undefined ? `Routine (${scope})` : `${name} preset (${scope})`,
    };
  }
  if (input.exerciseDefaultS !== null) {
    return {
      seconds: input.exerciseDefaultS,
      source: 'exercise_default',
      sourceLabel: `${input.exerciseName} default`,
    };
  }
  const name = input.globalDefault.presetName;
  return {
    seconds: input.globalDefault.seconds,
    source: 'global_default',
    sourceLabel: name === undefined ? 'Default rest' : `${name} (default)`,
  };
}

/** Remaining time worked out from the stored deadline; never from a JS interval. */
export function restRemainingMs(timer: RestTimer, nowMs: number): number {
  if (timer.status === 'paused') return timer.remainingMsAtPause ?? 0;
  if (timer.status !== 'running') return 0;
  return Math.max(0, toMs(timer.deadlineUtc) - nowMs);
}

/** Count-up shown in "Rested 3:12" after a timer ended (0 while running). */
export function restOverrunMs(timer: RestTimer, nowMs: number): number {
  if (timer.status !== 'expired' && timer.status !== 'running') return 0;
  return Math.max(0, nowMs - toMs(timer.deadlineUtc));
}

export interface NewTimerInput {
  id: string;
  sessionId: string;
  setId: string;
  kind: RestTimer['kind'];
  durationS: number;
  source: RestTimer['source'];
  nowMs: number;
}

export function createRestTimer(input: NewTimerInput): RestTimer {
  return {
    id: input.id,
    sessionId: input.sessionId,
    setId: input.setId,
    kind: input.kind,
    durationS: input.durationS,
    source: input.source,
    startedAtUtc: toIso(input.nowMs),
    deadlineUtc: toIso(input.nowMs + input.durationS * 1000),
    status: 'running',
    remainingMsAtPause: null,
    endedAtUtc: null,
    version: 1,
  };
}

/**
 * +/- seconds on a running timer. Remaining time is clamped at zero; reaching
 * zero ends the rest as `expired` (Ended, not Skipped, so the rest-end cue
 * plays). Every change bumps the timer version so stale alerts can be replaced.
 */
export function adjustRestTimer(timer: RestTimer, deltaS: number, nowMs: number): RestTimer {
  const remaining = Math.max(0, restRemainingMs(timer, nowMs) + deltaS * 1000);
  if (remaining === 0) {
    return { ...timer, deadlineUtc: toIso(nowMs), status: 'expired', endedAtUtc: toIso(nowMs), version: timer.version + 1 };
  }
  return { ...timer, deadlineUtc: toIso(nowMs + remaining), version: timer.version + 1 };
}

export function endRestTimer(
  timer: RestTimer,
  reason: 'skipped' | 'ended_early' | 'cancelled',
  nowMs: number,
): RestTimer {
  return { ...timer, status: reason, endedAtUtc: toIso(nowMs), remainingMsAtPause: null, version: timer.version + 1 };
}

/** Marks a running timer expired if its deadline has passed. Ended time is the deadline, not now. */
export function expireRestTimerIfDue(timer: RestTimer, nowMs: number): RestTimer {
  if (timer.status !== 'running') return timer;
  const deadline = toMs(timer.deadlineUtc);
  if (deadline > nowMs) return timer;
  return { ...timer, status: 'expired', endedAtUtc: timer.deadlineUtc, version: timer.version + 1 };
}

export function pauseRestTimer(timer: RestTimer, nowMs: number): RestTimer {
  if (timer.status !== 'running') return timer;
  return { ...timer, status: 'paused', remainingMsAtPause: restRemainingMs(timer, nowMs), version: timer.version + 1 };
}

export function resumeRestTimer(timer: RestTimer, nowMs: number): RestTimer {
  if (timer.status !== 'paused') return timer;
  const remaining = timer.remainingMsAtPause ?? 0;
  return {
    ...timer,
    status: 'running',
    deadlineUtc: toIso(nowMs + remaining),
    remainingMsAtPause: null,
    version: timer.version + 1,
  };
}

/*
 * Unticking a set never resets the rest (workout-table-v3 §3, Ben 20 Oct).
 * A log that replaces a rest keeps it on the timer that follows
 * (`resumeOnUndo`, persisted with the timer, so it survives a force-close);
 * undoing that log puts it back as it would be now: still running to its
 * original deadline, or finished (expired or skipped, its original end), so
 * the "Rested" count-up carries on from when it ended.
 */

const isFinished = (e: ResumableRest): boolean => e.timer.status === 'expired' || e.timer.status === 'skipped';

/**
 * `stack` bounded: the newest `MAX_RESUMABLE_RESTS`, and a finished entry
 * only within the top `MAX_FINISHED_RESUMABLE_DEPTH` (review rest-undo-sp1
 * S1). A dropped entry only means undoing that older log puts no rest back.
 */
export function boundResumable(stack: readonly ResumableRest[]): ResumableRest[] {
  const newest = stack.slice(-MAX_RESUMABLE_RESTS);
  const top = newest.length - MAX_FINISHED_RESUMABLE_DEPTH;
  return newest.filter((e, i) => i >= top || !isFinished(e));
}

/** `timer` with `stack` as its rests to put back on undo (the field is absent when empty). */
export function withResumable(timer: RestTimer, stack: readonly ResumableRest[]): RestTimer {
  const rest: RestTimer = { ...timer };
  delete rest.resumeOnUndo;
  const bounded = boundResumable(stack);
  return bounded.length === 0 ? rest : { ...rest, resumeOnUndo: bounded };
}

/** A kept running rest whose deadline has passed is finished: `expired`, ended at its deadline. */
function settleResumable(timer: ResumableRest['timer'], nowMs: number): ResumableRest['timer'] {
  if (timer.status !== 'running' || toMs(timer.deadlineUtc) > nowMs) return timer;
  return { ...timer, status: 'expired', endedAtUtc: timer.deadlineUtc, remainingMsAtPause: null };
}

/**
 * Kept rests as they are at `nowMs`: one that has run out is marked expired
 * (ended at its deadline), so undo still shows "Rested" from then. The stack
 * stays bounded by `withResumable` (`boundResumable`).
 */
export function pruneResumable(stack: readonly ResumableRest[], nowMs: number): ResumableRest[] {
  return stack.map((e) => ({ ...e, timer: settleResumable(e.timer, nowMs) }));
}

/**
 * The rests to put back on undo after a log of `bySetId`, given the rest
 * timer before that log: what it already carried, plus itself when it was
 * running, paused, expired or skipped, so undoing this log restores it
 * (a finished one as finished). A rest that ended any other way (a log
 * during it, a cancel) has nothing to put back.
 */
export function resumableAfterLog(previous: RestTimer | null, bySetId: string, nowMs: number): ResumableRest[] {
  if (previous === null) return [];
  const carried = pruneResumable(previous.resumeOnUndo ?? [], nowMs);
  const status = previous.status;
  if (status !== 'running' && status !== 'paused' && status !== 'expired' && status !== 'skipped') return carried;
  const core: RestTimer = { ...previous };
  delete core.resumeOnUndo;
  delete core.restoredFinished;
  return [...carried, { afterUndoOfSetId: bySetId, timer: settleResumable({ ...core, status }, nowMs) }];
}

/**
 * Pause or resume the kept rests with the workout, so they keep time as if
 * never replaced. Only running and paused ones change; a finished one (or one
 * that has just run out, settled first) stays finished.
 */
export function mapResumable(timer: RestTimer, f: (t: RestTimer) => RestTimer, nowMs: number, prune: boolean): RestTimer {
  const stack = timer.resumeOnUndo;
  if (stack === undefined) return timer;
  const mapped = (prune ? pruneResumable(stack, nowMs) : stack).map((e) => {
    if (e.timer.status !== 'running' && e.timer.status !== 'paused') return e;
    const t = f(e.timer);
    return { ...e, timer: { ...t, status: t.status === 'paused' ? ('paused' as const) : ('running' as const) } };
  });
  return withResumable(timer, mapped);
}

export interface RestoredRest {
  /** The rest put back: running to its original deadline, paused, or finished (expired or skipped) at its original end. */
  restored: RestTimer;
  /** What remains on the stack after this undo. */
  rest: ResumableRest[];
}

/**
 * Undo of `setId`'s log: the rest that log replaced, if any is on top of
 * `stack`. A running rest keeps its absolute deadline; a paused one (the
 * workout is paused) keeps its remaining time. One that has finished (before
 * the log, or since) comes back finished with its original end, so the
 * "Rested" count-up continues and no alert or countdown starts. Its version
 * moves past the `ended_early` the log gave it, so alerts keyed by version
 * reschedule.
 */
export function restoreAfterUndo(stack: readonly ResumableRest[], setId: string, nowMs: number): RestoredRest | null {
  const top = stack.at(-1);
  if (top?.afterUndoOfSetId !== setId) return null;
  const rest = stack.slice(0, -1);
  const timer = settleResumable(top.timer, nowMs);
  const live = timer.status === 'running' || timer.status === 'paused';
  const back: RestTimer = live
    ? { ...timer, endedAtUtc: null, version: timer.version + 2 }
    : // Marked on the timer, so its end cue stays quiet also after a relaunch (review rest-undo-sp1 B1).
      { ...timer, version: timer.version + 2, restoredFinished: true };
  return { restored: withResumable(back, rest), rest };
}
