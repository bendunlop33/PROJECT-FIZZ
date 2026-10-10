import type {
  CommandOf,
  SessionTimingAuditEntry,
  ZonedTimestamp,
  EquipmentInstance,
  PauseInterval,
  ProcessedOperation,
  RestTimer,
  SessionAggregate,
  SessionCommand,
  SessionExercise,
  SetFlag,
  SetSide,
  SetSnapshot,
  SetValues,
  WorkoutSet,
} from '@fizz/schemas';
import { isLoadAchievable } from '../equipment';
import {
  adjustRestTimer,
  createRestTimer,
  endRestTimer,
  expireRestTimerIfDue,
  pauseRestTimer,
  resumeRestTimer,
} from '../rest';
import { deriveId, stableStringify } from '../stable';
import { toIso, toMs } from '../time';
import { isOpenEndedWorkout } from './first-run';
import { isRoundEnd, nextPendingSet } from './order';

export type SessionErrorCode =
  | 'operation_id_reused'
  | 'stale_version'
  | 'session_finished'
  | 'session_paused'
  | 'not_paused'
  | 'set_not_found'
  | 'set_not_pending'
  | 'set_not_completed'
  | 'not_latest_set'
  | 'invalid_values'
  | 'invalid_time'
  | 'session_not_finished'
  | 'convention_mismatch'
  | 'unit_mismatch'
  | 'timer_not_found'
  | 'timer_not_running'
  | 'not_timed_exercise'
  | 'work_interval_running'
  | 'work_interval_not_running'
  | 'exercise_not_found'
  | 'equipment_not_found'
  | 'equipment_incompatible';

export interface SessionError {
  code: SessionErrorCode;
  message: string;
}

export type RestEndReason = 'expired' | 'skipped' | 'ended_early' | 'cancelled';

/** Committed events. Cue, alert and coach layers subscribe; the core never awaits them. */
export type SessionEvent =
  | { type: 'SetCommitted'; setId: string; opId: string }
  | { type: 'SetCorrected'; setId: string; setVersion: number }
  | { type: 'SetUndone'; setId: string }
  | { type: 'SetsSkipped'; setIds: string[] }
  | {
      type: 'RestStarted';
      timerId: string;
      setId: string;
      kind: RestTimer['kind'];
      durationS: number;
      deadlineUtc: string;
      timerVersion: number;
    }
  | { type: 'RestAdjusted'; timerId: string; deadlineUtc: string; timerVersion: number }
  | {
      type: 'RestEnded';
      timerId: string;
      reason: RestEndReason;
      timerVersion: number;
      /** How late the expiry was observed; cue layers drop spoken cues > 5 s late. */
      lateByMs: number;
    }
  | { type: 'ActiveSetChanged'; setId: string | null }
  | { type: 'AllSetsDone' }
  | { type: 'WorkIntervalStarted'; setId: string; deadlineUtc: string }
  | { type: 'WorkIntervalEnded'; setId: string; reason: 'completed' | 'stopped' | 'cancelled'; elapsedS: number; lateByMs: number }
  | { type: 'SessionPaused' }
  | { type: 'SessionResumed' }
  | { type: 'SessionFinished' }
  | { type: 'SessionDiscarded' }
  | { type: 'SetAdded'; setId: string; sessionExerciseId: string }
  | { type: 'ExerciseAdded'; sessionExerciseId: string }
  | { type: 'SetDeleted'; setId: string }
  | { type: 'RestPlanChanged'; setIds: string[]; seconds: number }
  | { type: 'SessionTimingUpdated' }
  | { type: 'SessionRenamed'; name: string | null };

export type ReduceResult =
  | {
      ok: true;
      state: SessionAggregate;
      events: SessionEvent[];
      duplicate: boolean;
      /**
       * True on a duplicate whose effect is no longer in place, e.g. a repeated
       * log_set after that log was undone. Voice and coach tools must report
       * "not saved" in this case, never "committed" (brief §8).
       */
      superseded: boolean;
    }
  | {
      ok: false;
      error: SessionError;
      /**
       * The input state, plus any clock catch-up (timer expiry) that happened
       * before the command was rejected. Persist it when it differs from the
       * input so an expiry is never lost (review M6). The command itself is not
       * recorded, so it can be retried.
       */
      state: SessionAggregate;
      /** Clock events from that catch-up (e.g. RestEnded). Empty when nothing changed. */
      events: SessionEvent[];
    };

type Handled = { ok: true; state: SessionAggregate; events: SessionEvent[] } | { ok: false; error: SessionError };

const fail = (code: SessionErrorCode, message: string): Handled => ({ ok: false, error: { code, message } });

/**
 * Fingerprint of a command's intent. `at` and generated IDs (`restTimerId`)
 * are excluded so a retry after relaunch, which regenerates them, still matches.
 */
export function commandFingerprint(command: SessionCommand): string {
  if (command.type === 'add_exercise') {
    // Re-review minor 5: the snapshot, unit and resolved rest are derived by the
    // service and may change between a failed attempt and its retry.
    return stableStringify({ type: command.type, exerciseId: command.exercise.exerciseId, equipmentId: command.equipmentId });
  }
  return stableStringify({
    ...command,
    at: undefined,
    restTimerId: undefined,
    newSetId: undefined,
    newSessionExerciseId: undefined,
  });
}

function snapshot(set: WorkoutSet): SetSnapshot {
  return { status: set.status, setType: set.setType, side: set.side, actual: set.actual, version: set.version };
}

function replaceSet(sets: readonly WorkoutSet[], next: WorkoutSet): WorkoutSet[] {
  return sets.map((s) => (s.id === next.id ? next : s));
}

function exerciseOf(state: SessionAggregate, set: WorkoutSet): SessionExercise | undefined {
  return state.exercises.find((e) => e.id === set.sessionExerciseId);
}

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | undefined {
  if (ex.equipmentId === null) return undefined;
  return state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId);
}

function validateValues(values: SetValues, ex: SessionExercise): SessionError | null {
  if (ex.measurement === 'reps' && values.reps === null) {
    return { code: 'invalid_values', message: 'Reps are required for this exercise.' };
  }
  if (ex.measurement === 'duration' && values.durationS === null) {
    return { code: 'invalid_values', message: 'A duration is required for this exercise.' };
  }
  if (values.load === null) {
    if (ex.loadConvention === 'bodyweight') return null;
    return { code: 'invalid_values', message: 'A load is required for this exercise.' };
  }
  if (values.load.convention !== ex.loadConvention) {
    return {
      code: 'convention_mismatch',
      message: `Load convention ${values.load.convention} does not match ${ex.loadConvention}.`,
    };
  }
  if (values.load.unit !== ex.unit) {
    return { code: 'unit_mismatch', message: `Load unit ${values.load.unit} does not match ${ex.unit}; convert explicitly first.` };
  }
  return null;
}

function checkSide(side: SetSide | null | undefined, ex: SessionExercise): SessionError | null {
  if (side === undefined) return null;
  if (ex.laterality === 'bilateral' && side !== null) {
    return { code: 'invalid_values', message: `${ex.exerciseName} is not unilateral; a side can't be recorded.` };
  }
  if (ex.laterality === 'unilateral' && side === null) {
    return { code: 'invalid_values', message: 'Unilateral sets need a side (left, right or both).' };
  }
  return null;
}

function flagsFor(values: SetValues, state: SessionAggregate, ex: SessionExercise): SetFlag[] {
  const eq = equipmentOf(state, ex);
  if (!eq || values.load === null) return [];
  return isLoadAchievable(values.load, eq) ? [] : ['off_profile_load'];
}

function baseDraft(set: WorkoutSet): SetValues {
  return set.draft ?? { load: set.planned.load, reps: null, durationS: null, rpe: null, rir: null };
}

function isTimerLive(timer: RestTimer | null): timer is RestTimer {
  return timer !== null && (timer.status === 'running' || timer.status === 'paused');
}

/**
 * Apply the passage of time: expire a rest timer or work interval whose
 * deadline has passed. Never commits a set (invariant 1). No-op while paused.
 */
function applyClock(state: SessionAggregate, nowMs: number): { state: SessionAggregate; events: SessionEvent[] } {
  if (state.session.status !== 'active' || state.session.pause !== null) return { state, events: [] };
  const events: SessionEvent[] = [];
  let next = state;

  const timer = state.restTimer;
  if (timer?.status === 'running') {
    const expired = expireRestTimerIfDue(timer, nowMs);
    if (expired !== timer) {
      next = { ...next, restTimer: expired };
      events.push({
        type: 'RestEnded',
        timerId: expired.id,
        reason: 'expired',
        timerVersion: expired.version,
        lateByMs: nowMs - toMs(expired.deadlineUtc),
      });
    }
  }

  const wi = state.workInterval;
  if (wi?.status === 'running' && toMs(wi.deadlineUtc) <= nowMs) {
    next = { ...next, workInterval: { ...wi, status: 'completed', endedAtUtc: wi.deadlineUtc } };
    const set = next.sets.find((s) => s.id === wi.setId);
    if (set?.status === 'pending') {
      // The planned duration becomes the draft. Nothing is saved (invariant 1).
      next = { ...next, sets: replaceSet(next.sets, { ...set, draft: { ...baseDraft(set), durationS: wi.durationS } }) };
    }
    events.push({
      type: 'WorkIntervalEnded',
      setId: wi.setId,
      reason: 'completed',
      elapsedS: wi.durationS,
      lateByMs: nowMs - toMs(wi.deadlineUtc),
    });
  }
  return { state: next, events };
}

function bumpVersion(state: SessionAggregate, activeSetId: string | null = state.session.activeSetId): SessionAggregate {
  return { ...state, session: { ...state.session, version: state.session.version + 1, activeSetId } };
}

function handleLogSet(state: SessionAggregate, cmd: CommandOf<'log_set'>, nowMs: number): Handled {
  if (state.session.pause !== null) return fail('session_paused', 'Resume the workout before logging.');
  if (nowMs < toMs(state.session.startedAt.utc)) {
    return fail('invalid_time', 'A set cannot be logged before the workout started.');
  }
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'This set is already logged or skipped.');
  const wi = state.workInterval;
  if (wi && wi.setId === set.id && (wi.status === 'running' || wi.status === 'paused')) {
    return fail('work_interval_running', 'Stop the work timer before logging.');
  }
  const ex = exerciseOf(state, set);
  if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
  const invalid = validateValues(cmd.values, ex) ?? checkSide(cmd.side, ex);
  if (invalid) return { ok: false, error: invalid };
  if (set.pairedWithSetId !== null && cmd.side !== undefined && cmd.side !== set.side) {
    return fail('invalid_values', `This set is the ${set.side ?? 'other'} side of an earlier set. Log it as that side, or delete it.`);
  }

  const events: SessionEvent[] = [];
  let restTimer = state.restTimer;
  if (restTimer?.status === 'running') {
    // P2: logging during rest ends that rest early.
    restTimer = endRestTimer(restTimer, 'ended_early', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'ended_early', timerVersion: restTimer.version, lateByMs: 0 });
  }

  const completed: WorkoutSet = {
    ...set,
    status: 'completed',
    side: cmd.side ?? set.side,
    actual: cmd.values,
    draft: null,
    completedAt: cmd.at,
    completedByOpId: cmd.opId,
    flags: flagsFor(cmd.values, state, ex),
    version: set.version + 1,
  };
  let sets = replaceSet(state.sets, completed);
  events.push({ type: 'SetCommitted', setId: set.id, opId: cmd.opId });

  // Review R4: a single-side log of a prescribed set adds a pending row for the
  // other side, which becomes the next set. The pair is one prescribed set, so
  // Left, Right, Left can never leave the exercise "done" with one side short.
  let companion: WorkoutSet | null = null;
  if (ex.laterality === 'unilateral' && set.pairedWithSetId === null && (completed.side === 'left' || completed.side === 'right')) {
    companion = makeCompanion(state, completed, cmd);
    if (sets.some((s) => s.id === companion?.id)) return fail('invalid_values', 'Could not add the other side: ID already used.');
    sets = [...sets, companion];
    events.push({ type: 'SetAdded', setId: companion.id, sessionExerciseId: ex.id });
  }

  const audit = [
    ...state.audit,
    {
      id: `${cmd.opId}:logged`,
      sessionId: state.session.id,
      setId: set.id,
      opId: cmd.opId,
      kind: 'logged' as const,
      atUtc: cmd.at.utc,
      before: snapshot(set),
      after: snapshot(completed),
    },
  ];

  const nextActive = companion?.id ?? nextPendingSet(set.id, state.exercises, sets);
  if (nextActive === null) {
    // Final set of a planned workout: no rest; the primary becomes Finish
    // (rest-state #14). An open-ended workout is built as Ben goes, so its
    // "final" set is only the last one so far: the rest still runs while he
    // adds a set or the next exercise (audit B1). Finish cancels it.
    if (isOpenEndedWorkout(state) && set.rest.seconds > 0) {
      restTimer = createRestTimer({
        id: cmd.restTimerId,
        sessionId: state.session.id,
        setId: set.id,
        kind: 'rest',
        durationS: set.rest.seconds,
        source: set.rest.source === 'not_recorded' ? null : set.rest.source,
        nowMs,
      });
      events.push({
        type: 'RestStarted',
        timerId: restTimer.id,
        setId: set.id,
        kind: restTimer.kind,
        durationS: restTimer.durationS,
        deadlineUtc: restTimer.deadlineUtc,
        timerVersion: restTimer.version,
      });
    }
    events.push({ type: 'ActiveSetChanged', setId: null }, { type: 'AllSetsDone' });
    const next = bumpVersion({ ...state, sets, audit, restTimer, workInterval: wi?.setId === set.id ? null : wi }, null);
    return { ok: true, state: next, events };
  }

  const exerciseHasMore = sets.some((s) => s.sessionExerciseId === ex.id && s.status === 'pending');
  let rest: { kind: RestTimer['kind']; seconds: number; source: RestTimer['source'] };
  if (!isRoundEnd(set, state.exercises, sets)) {
    rest = { kind: 'transition', seconds: ex.transitionRestS ?? 0, source: null };
  } else if (!exerciseHasMore && ex.transitionRestS !== null) {
    rest = { kind: 'transition', seconds: ex.transitionRestS, source: null };
  } else {
    rest = { kind: 'rest', seconds: set.rest.seconds, source: set.rest.source === 'not_recorded' ? null : set.rest.source };
  }

  if (rest.seconds > 0) {
    restTimer = createRestTimer({
      id: cmd.restTimerId,
      sessionId: state.session.id,
      setId: set.id,
      kind: rest.kind,
      durationS: rest.seconds,
      source: rest.source,
      nowMs,
    });
    events.push({
      type: 'RestStarted',
      timerId: restTimer.id,
      setId: set.id,
      kind: restTimer.kind,
      durationS: restTimer.durationS,
      deadlineUtc: restTimer.deadlineUtc,
      timerVersion: restTimer.version,
    });
  }
  events.push({ type: 'ActiveSetChanged', setId: nextActive });
  const next = bumpVersion({ ...state, sets, audit, restTimer, workInterval: wi?.setId === set.id ? null : wi }, nextActive);
  return { ok: true, state: next, events };
}

/**
 * The pending other-side row for a set logged as `left` or `right` (review R4).
 * `index` only keeps indexes unique; the execution order places the row
 * straight after its partner (`buildExecutionOrder`, review T1).
 */
function makeCompanion(state: SessionAggregate, logged: WorkoutSet, cmd: CommandOf<'log_set'>): WorkoutSet {
  const index = Math.max(...state.sets.filter((s) => s.sessionExerciseId === logged.sessionExerciseId).map((s) => s.index)) + 1;
  return {
    id: deriveId(`companion:${logged.id}:${cmd.opId}`),
    sessionId: state.session.id,
    sessionExerciseId: logged.sessionExerciseId,
    index,
    setType: logged.setType,
    status: 'pending',
    side: logged.side === 'left' ? 'right' : 'left',
    pairedWithSetId: logged.id,
    planned: logged.planned,
    rest: logged.rest,
    actual: null,
    // Same values as the side just logged; effort is never prefilled.
    draft: { ...cmd.values, rpe: null, rir: null },
    completedAt: null,
    completedByOpId: null,
    undoCount: 0,
    flags: [],
    edited: false,
    version: 1,
  };
}

/** Tombstone the still-pending other-side rows of `setId` (when its log is undone or it is deleted). */
function dropPendingCompanions(
  state: SessionAggregate,
  sets: WorkoutSet[],
  setId: string,
  cmd: { opId: string; at: ZonedTimestamp },
  audit: SessionAggregate['audit'],
  events: SessionEvent[],
): WorkoutSet[] {
  return sets.map((s) => {
    if (s.pairedWithSetId !== setId || s.status !== 'pending') return s;
    const deleted: WorkoutSet = { ...s, status: 'deleted', draft: null, version: s.version + 1 };
    audit.push({
      id: `${cmd.opId}:deleted:${s.id}`,
      sessionId: state.session.id,
      setId: s.id,
      opId: cmd.opId,
      kind: 'deleted',
      atUtc: cmd.at.utc,
      before: snapshot(s),
      after: snapshot(deleted),
    });
    events.push({ type: 'SetDeleted', setId: s.id });
    return deleted;
  });
}

function handleCorrectSet(state: SessionAggregate, cmd: CommandOf<'correct_set'>): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'completed' || set.actual === null) {
    return fail('set_not_completed', 'Only logged sets can be corrected; edit the draft instead.');
  }
  if (set.version !== cmd.expectedSetVersion) {
    return fail('stale_version', 'This set changed since it was shown. Reload and try again.');
  }
  const ex = exerciseOf(state, set);
  if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
  const { setType, side, ...valuePatch } = cmd.patch;
  const badSide = checkSide(side, ex);
  if (badSide) return { ok: false, error: badSide };
  const actual: SetValues = { ...set.actual };
  for (const key of Object.keys(valuePatch) as (keyof SetValues)[]) {
    const v = valuePatch[key];
    if (v !== undefined) Object.assign(actual, { [key]: v });
  }
  const invalid = validateValues(actual, ex);
  if (invalid) return { ok: false, error: invalid };

  const corrected: WorkoutSet = {
    ...set,
    actual,
    setType: setType ?? set.setType,
    side: side ?? set.side,
    flags: flagsFor(actual, state, ex),
    edited: true,
    version: set.version + 1,
  };
  const audit = [
    ...state.audit,
    {
      id: `${cmd.opId}:corrected`,
      sessionId: state.session.id,
      setId: set.id,
      opId: cmd.opId,
      kind: 'corrected' as const,
      atUtc: cmd.at.utc,
      before: snapshot(set),
      after: snapshot(corrected),
    },
  ];
  // Invariant 5: the rest timer is untouched by corrections.
  const next = bumpVersion({ ...state, sets: replaceSet(state.sets, corrected), audit });
  return { ok: true, state: next, events: [{ type: 'SetCorrected', setId: set.id, setVersion: corrected.version }] };
}

/**
 * The set whose log is the most recent commit still in effect, by commit
 * order (audit append order), not by the client-supplied `at` (review M3).
 */
export function latestCommittedSetId(state: SessionAggregate): string | null {
  for (let i = state.audit.length - 1; i >= 0; i -= 1) {
    const entry = state.audit[i];
    // Deleting a logged set ends the undo window (re-review minor 3): "Undo"
    // must not reach past the delete and revert an older set.
    if (entry?.kind === 'deleted' && entry.before?.status === 'completed') return null;
    if (entry?.kind !== 'logged') continue;
    const set = state.sets.find((s) => s.id === entry.setId);
    if (set?.status === 'completed' && set.completedByOpId === entry.opId) return set.id;
  }
  return null;
}

function handleUndoLog(state: SessionAggregate, cmd: CommandOf<'undo_log'>, nowMs: number): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'completed') return fail('set_not_completed', 'This set is not logged.');
  if (set.version !== cmd.expectedSetVersion) {
    return fail('stale_version', 'This set changed since the undo was offered.');
  }
  if (latestCommittedSetId(state) !== set.id) {
    return fail('not_latest_set', 'Only the most recent set can be undone; correct or delete older sets instead.');
  }
  // Re-review minor 8: Undo makes this set active, which would leave a work
  // timer running on another set. Stop it first.
  const wi = state.workInterval;
  if (wi !== null && wi.setId !== set.id && (wi.status === 'running' || wi.status === 'paused')) {
    return fail('work_interval_running', 'Stop the work timer before undoing.');
  }
  // Restore the side the set had before this log (e.g. `both` before "Left").
  const logged = [...state.audit].reverse().find((e) => e.kind === 'logged' && e.setId === set.id && e.opId === set.completedByOpId);
  const restored: WorkoutSet = {
    ...set,
    side: logged?.before?.side ?? set.side,
    status: 'pending',
    draft: set.actual,
    actual: null,
    completedAt: null,
    completedByOpId: null,
    undoCount: set.undoCount + 1,
    flags: [],
    edited: false,
    version: set.version + 1,
  };
  const events: SessionEvent[] = [{ type: 'SetUndone', setId: set.id }];
  let restTimer = state.restTimer;
  if (isTimerLive(restTimer) && restTimer.setId === set.id) {
    restTimer = endRestTimer(restTimer, 'cancelled', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'cancelled', timerVersion: restTimer.version, lateByMs: 0 });
  }
  const audit: SessionAggregate['audit'] = [
    ...state.audit,
    {
      id: `${cmd.opId}:undone`,
      sessionId: state.session.id,
      setId: set.id,
      opId: cmd.opId,
      kind: 'undone' as const,
      atUtc: cmd.at.utc,
      before: snapshot(set),
      after: snapshot(restored),
    },
  ];
  // The other-side row this log created goes with it (review R4).
  const sets = dropPendingCompanions(state, replaceSet(state.sets, restored), set.id, cmd, audit, events);
  events.push({ type: 'ActiveSetChanged', setId: set.id });
  const next = bumpVersion({ ...state, sets, audit, restTimer }, set.id);
  return { ok: true, state: next, events };
}

function handleSetActiveSet(state: SessionAggregate, cmd: CommandOf<'set_active_set'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed; reload.');
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'Only a pending set can become active.');
  if (state.session.activeSetId === set.id) return { ok: true, state, events: [] };
  return { ok: true, state: bumpVersion(state, set.id), events: [{ type: 'ActiveSetChanged', setId: set.id }] };
}

function liveTimer(state: SessionAggregate, timerId: string): RestTimer | SessionError {
  if (state.session.pause !== null) return { code: 'session_paused', message: 'Rest controls are disabled while paused.' };
  const timer = state.restTimer;
  if (timer?.id !== timerId) return { code: 'timer_not_found', message: 'That rest timer is no longer current.' };
  if (timer.status !== 'running') return { code: 'timer_not_running', message: 'Rest has already ended.' };
  return timer;
}

function handleAdjustRest(state: SessionAggregate, cmd: CommandOf<'adjust_rest'>, nowMs: number): Handled {
  const timer = liveTimer(state, cmd.timerId);
  if ('code' in timer) return { ok: false, error: timer };
  const adjusted = adjustRestTimer(timer, cmd.deltaS, nowMs);
  const events: SessionEvent[] = [
    { type: 'RestAdjusted', timerId: adjusted.id, deadlineUtc: adjusted.deadlineUtc, timerVersion: adjusted.version },
  ];
  if (adjusted.status === 'expired') {
    events.push({ type: 'RestEnded', timerId: adjusted.id, reason: 'expired', timerVersion: adjusted.version, lateByMs: 0 });
  }
  return { ok: true, state: { ...state, restTimer: adjusted }, events };
}

function handleSkipRest(state: SessionAggregate, cmd: CommandOf<'skip_rest'>, nowMs: number): Handled {
  const timer = liveTimer(state, cmd.timerId);
  if ('code' in timer) return { ok: false, error: timer };
  const skipped = endRestTimer(timer, 'skipped', nowMs);
  return {
    ok: true,
    state: { ...state, restTimer: skipped },
    events: [{ type: 'RestEnded', timerId: skipped.id, reason: 'skipped', timerVersion: skipped.version, lateByMs: 0 }],
  };
}

function handleStartWork(state: SessionAggregate, cmd: CommandOf<'start_work_interval'>, nowMs: number): Handled {
  if (state.session.pause !== null) return fail('session_paused', 'Resume the workout first.');
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'This set is already logged or skipped.');
  const ex = exerciseOf(state, set);
  if (ex?.measurement !== 'duration') return fail('not_timed_exercise', 'Work timers are for timed exercises only.');
  const wi = state.workInterval;
  if (wi && (wi.status === 'running' || wi.status === 'paused')) {
    return fail('work_interval_running', 'A work timer is already running.');
  }
  const events: SessionEvent[] = [];
  let restTimer = state.restTimer;
  if (restTimer?.status === 'running') {
    restTimer = endRestTimer(restTimer, 'ended_early', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'ended_early', timerVersion: restTimer.version, lateByMs: 0 });
  }
  const workInterval = {
    setId: set.id,
    durationS: cmd.durationS,
    startedAtUtc: toIso(nowMs),
    deadlineUtc: toIso(nowMs + cmd.durationS * 1000),
    status: 'running' as const,
    remainingMsAtPause: null,
    pausedMs: 0,
    endedAtUtc: null,
  };
  events.push({ type: 'WorkIntervalStarted', setId: set.id, deadlineUtc: workInterval.deadlineUtc });
  let next: SessionAggregate = { ...state, restTimer, workInterval };
  if (state.session.activeSetId !== set.id) {
    next = bumpVersion(next, set.id);
    events.push({ type: 'ActiveSetChanged', setId: set.id });
  }
  return { ok: true, state: next, events };
}

/**
 * Stop a work interval. Allowed while the session is paused (review R2,
 * ADR 0003): the interval then ends at the moment the pause began, so paused
 * time never counts as work. This keeps the stale-card Stop → Finish path open.
 */
function handleStopWork(state: SessionAggregate, cmd: CommandOf<'stop_work_interval'>, nowMs: number): Handled {
  const wi = state.workInterval;
  if (wi?.setId === cmd.setId && wi.status === 'completed') {
    // The deadline passed just before Stop landed (review M6): the timer already
    // ended and filled the planned duration as the draft. Stop is a no-op.
    return { ok: true, state, events: [] };
  }
  const pause = state.session.pause;
  const expected = pause === null ? 'running' : 'paused';
  if (wi?.setId !== cmd.setId || wi.status !== expected) {
    return fail('work_interval_not_running', 'No work timer is running for this set.');
  }
  const endMs = pause === null ? nowMs : toMs(pause.pausedAtUtc);
  const elapsedS = Math.max(0, Math.min(wi.durationS, Math.round((endMs - toMs(wi.startedAtUtc) - wi.pausedMs) / 1000)));
  const set = state.sets.find((s) => s.id === wi.setId);
  let sets = state.sets;
  if (set?.status === 'pending') {
    sets = replaceSet(sets, { ...set, draft: { ...baseDraft(set), durationS: elapsedS } });
  }
  return {
    ok: true,
    state: { ...state, sets, workInterval: { ...wi, status: 'stopped', remainingMsAtPause: null, endedAtUtc: toIso(endMs) } },
    events: [{ type: 'WorkIntervalEnded', setId: wi.setId, reason: 'stopped', elapsedS, lateByMs: 0 }],
  };
}

function handlePause(state: SessionAggregate, nowMs: number): Handled {
  if (state.session.pause !== null) return fail('session_paused', 'The workout is already paused.');
  const restTimer = state.restTimer ? pauseRestTimer(state.restTimer, nowMs) : null;
  let workInterval = state.workInterval;
  if (workInterval?.status === 'running') {
    workInterval = {
      ...workInterval,
      status: 'paused',
      remainingMsAtPause: Math.max(0, toMs(workInterval.deadlineUtc) - nowMs),
    };
  }
  return {
    ok: true,
    state: { ...state, restTimer, workInterval, session: { ...state.session, pause: { pausedAtUtc: toIso(nowMs) } } },
    events: [{ type: 'SessionPaused' }],
  };
}

/** The closed pauses, plus the open pause (if any) closed at `nowMs`. */
function closePause(state: SessionAggregate, nowMs: number): PauseInterval[] {
  const pause = state.session.pause;
  if (pause === null) return state.session.pauses;
  const startMs = toMs(pause.pausedAtUtc);
  return [...state.session.pauses, { startUtc: pause.pausedAtUtc, endUtc: toIso(Math.max(startMs, nowMs)) }];
}

function handleResume(state: SessionAggregate, nowMs: number): Handled {
  const pause = state.session.pause;
  if (pause === null) return fail('not_paused', 'The workout is not paused.');
  const pausedFor = Math.max(0, nowMs - toMs(pause.pausedAtUtc));
  const restTimer = state.restTimer ? resumeRestTimer(state.restTimer, nowMs) : null;
  let workInterval = state.workInterval;
  if (workInterval?.status === 'paused') {
    workInterval = {
      ...workInterval,
      status: 'running',
      deadlineUtc: toIso(nowMs + (workInterval.remainingMsAtPause ?? 0)),
      remainingMsAtPause: null,
      pausedMs: workInterval.pausedMs + pausedFor,
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      restTimer,
      workInterval,
      session: { ...state.session, pause: null, pauses: closePause(state, nowMs) },
    },
    events: [{ type: 'SessionResumed' }],
  };
}

function handleFinish(state: SessionAggregate, cmd: CommandOf<'finish'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) {
    return fail('stale_version', 'The workout changed since Finish was opened. Review and try again.');
  }
  const wiNow = state.workInterval;
  if (wiNow && (wiNow.status === 'running' || wiNow.status === 'paused')) {
    // ADR 0003 S4: never discard a running work interval. Stop it, then Log or leave it.
    return fail('work_interval_running', 'Stop the work timer before finishing.');
  }
  const endedAt = cmd.endedAt ?? cmd.at;
  const endMs = toMs(endedAt.utc);
  const timeError = checkEndTime(state, endMs, nowMs);
  if (timeError) return { ok: false, error: timeError };
  const timingAudit =
    cmd.endedAt !== null && cmd.endedAt.utc !== cmd.at.utc
      ? [...state.timingAudit, timingEntry(state, cmd.opId, 'endedAt', 'finish', cmd.at, cmd.at, cmd.endedAt)]
      : state.timingAudit;
  const events: SessionEvent[] = [];
  const skippedIds: string[] = [];
  const audit = [...state.audit];
  const sets = state.sets.map((s) => {
    if (s.status !== 'pending') return s;
    const skipped: WorkoutSet = { ...s, status: 'skipped', version: s.version + 1 };
    skippedIds.push(s.id);
    audit.push({
      id: `${cmd.opId}:skipped:${s.id}`,
      sessionId: state.session.id,
      setId: s.id,
      opId: cmd.opId,
      kind: 'skipped',
      atUtc: cmd.at.utc,
      before: snapshot(s),
      after: snapshot(skipped),
    });
    return skipped;
  });
  if (skippedIds.length > 0) events.push({ type: 'SetsSkipped', setIds: skippedIds });

  let restTimer = state.restTimer;
  if (isTimerLive(restTimer)) {
    restTimer = endRestTimer(restTimer, 'cancelled', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'cancelled', timerVersion: restTimer.version, lateByMs: 0 });
  }
  // An open pause is closed at the tap time and stored unclipped; duration
  // counts only the part inside [startedAt, endedAt] (review R1).
  const pauses = closePause(state, nowMs);

  events.push({ type: 'SessionFinished' });
  const next: SessionAggregate = {
    ...state,
    sets,
    audit,
    timingAudit,
    restTimer,
    session: {
      ...state.session,
      status: 'finished',
      endedAt,
      pause: null,
      pauses,
      activeSetId: null,
      version: state.session.version + 1,
    },
  };
  return { ok: true, state: next, events };
}

function completedTimes(state: SessionAggregate): number[] {
  return state.sets.flatMap((s) => (s.status === 'completed' && s.completedAt ? [toMs(s.completedAt.utc)] : []));
}

/** End time must not precede the start or the last completed set, nor lie in the future (review M7). */
function checkEndTime(state: SessionAggregate, endMs: number, nowMs: number, startMs = toMs(state.session.startedAt.utc)): SessionError | null {
  if (endMs < startMs) return { code: 'invalid_time', message: 'The end time is before the workout started.' };
  const done = completedTimes(state);
  if (done.length > 0 && endMs < Math.max(...done)) {
    return { code: 'invalid_time', message: 'The end time is before the last logged set.' };
  }
  if (endMs > nowMs) return { code: 'invalid_time', message: 'The end time is in the future.' };
  return null;
}

function timingEntry(
  state: SessionAggregate,
  opId: string,
  field: SessionTimingAuditEntry['field'],
  source: SessionTimingAuditEntry['source'],
  at: ZonedTimestamp,
  before: ZonedTimestamp | null,
  after: ZonedTimestamp,
): SessionTimingAuditEntry {
  return { id: `${opId}:${field}`, sessionId: state.session.id, opId, field, source, atUtc: at.utc, before, after };
}

function handleUpdateTiming(state: SessionAggregate, cmd: CommandOf<'update_session_timing'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed; reload.');
  const { session } = state;
  if (cmd.endedAt !== null && session.status !== 'finished') {
    return fail('session_not_finished', 'The end time can only be edited after Finish.');
  }
  const startedAt = cmd.startedAt ?? session.startedAt;
  const startMs = toMs(startedAt.utc);
  if (startMs > nowMs) return fail('invalid_time', 'The start time is in the future.');
  const done = completedTimes(state);
  if (done.length > 0 && startMs > Math.min(...done)) {
    return fail('invalid_time', 'The start time is after the first logged set.');
  }
  if (session.pause !== null && startMs > toMs(session.pause.pausedAtUtc)) {
    return fail('invalid_time', 'The start time is after the workout was paused.');
  }
  const endedAt = cmd.endedAt ?? session.endedAt;
  if (endedAt !== null) {
    const timeError = checkEndTime(state, toMs(endedAt.utc), nowMs, startMs);
    if (timeError) return { ok: false, error: timeError };
  }
  const entries: SessionTimingAuditEntry[] = [];
  if (cmd.startedAt !== null && cmd.startedAt.utc !== session.startedAt.utc) {
    entries.push(timingEntry(state, cmd.opId, 'startedAt', 'correction', cmd.at, session.startedAt, cmd.startedAt));
  }
  if (cmd.endedAt !== null && cmd.endedAt.utc !== session.endedAt?.utc) {
    entries.push(timingEntry(state, cmd.opId, 'endedAt', 'correction', cmd.at, session.endedAt, cmd.endedAt));
  }
  if (entries.length === 0) return { ok: true, state, events: [] };
  const next: SessionAggregate = {
    ...state,
    timingAudit: [...state.timingAudit, ...entries],
    session: { ...session, startedAt, endedAt, version: session.version + 1 },
  };
  return { ok: true, state: next, events: [{ type: 'SessionTimingUpdated' }] };
}

function isWorkLive(state: SessionAggregate, setIds: readonly string[]): boolean {
  const wi = state.workInterval;
  return wi !== null && setIds.includes(wi.setId) && (wi.status === 'running' || wi.status === 'paused');
}

/** Re-point the active set if it is no longer pending. */
function repointActive(
  state: SessionAggregate,
  sets: WorkoutSet[],
  events: SessionEvent[],
): string | null {
  const current = state.session.activeSetId;
  const stillPending = current !== null && sets.find((s) => s.id === current)?.status === 'pending';
  if (stillPending) return current;
  // Order from the sets before this change, so a deleted active set still has a
  // position and the successor is the next set after it, not an earlier one.
  const next = nextPendingSet(current, state.exercises, sets, state.sets);
  if (next !== current) {
    events.push({ type: 'ActiveSetChanged', setId: next });
    if (next === null) events.push({ type: 'AllSetsDone' });
  }
  return next;
}

/** A newly added pending set becomes active when nothing else is (empty workout, or all done). */
function activateIfIdle(state: SessionAggregate, setId: string, events: SessionEvent[]): string | null {
  if (state.session.activeSetId !== null) return state.session.activeSetId;
  events.push({ type: 'ActiveSetChanged', setId });
  return setId;
}

function handleAddSet(state: SessionAggregate, cmd: CommandOf<'add_set'>): Handled {
  const ex = state.exercises.find((e) => e.id === cmd.sessionExerciseId);
  if (!ex) return fail('exercise_not_found', 'Exercise not found in this workout.');
  if (state.sets.some((s) => s.id === cmd.newSetId)) return fail('invalid_values', 'That set ID is already used.');
  const own = state.sets.filter((s) => s.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index);
  const last = own[own.length - 1];
  if (!last) return fail('set_not_found', 'This exercise has no set to copy.');
  // Copy the last live set of the requested type (re-review minor 2): a warm-up
  // added after working sets must not inherit the working load and rest.
  const live = own.filter((s) => s.status !== 'deleted');
  const template = cmd.setType === null ? (live[live.length - 1] ?? last) : live.filter((s) => s.setType === cmd.setType).at(-1);
  if (!template) {
    return fail('set_not_found', `${ex.exerciseName} has no ${cmd.setType ?? ''} set to copy its target and rest from.`);
  }
  const added: WorkoutSet = {
    id: cmd.newSetId,
    sessionId: state.session.id,
    sessionExerciseId: ex.id,
    index: last.index + 1,
    setType: template.setType,
    status: 'pending',
    // A new unilateral set starts as "both sides"; it can be logged per side.
    side: template.side === null ? null : 'both',
    pairedWithSetId: null,
    planned: template.planned,
    rest: template.rest,
    actual: null,
    draft: null,
    completedAt: null,
    completedByOpId: null,
    undoCount: 0,
    flags: [],
    edited: false,
    version: 1,
  };
  const events: SessionEvent[] = [{ type: 'SetAdded', setId: added.id, sessionExerciseId: ex.id }];
  const activeSetId = activateIfIdle(state, added.id, events);
  return { ok: true, state: bumpVersion({ ...state, sets: [...state.sets, added] }, activeSetId), events };
}

function handleAddExercise(state: SessionAggregate, cmd: CommandOf<'add_exercise'>): Handled {
  if (state.exercises.some((e) => e.id === cmd.newSessionExerciseId) || state.sets.some((s) => s.id === cmd.newSetId)) {
    return fail('invalid_values', 'That exercise or set ID is already used.');
  }
  let equipment: EquipmentInstance | undefined;
  if (cmd.equipmentId !== null) {
    equipment = state.session.equipmentSnapshot.find((e) => e.id === cmd.equipmentId);
    if (!equipment || equipment.availability === 'retired') {
      return fail('equipment_not_found', 'That equipment is not part of this gym.');
    }
    if (!cmd.exercise.compatibleEquipment.includes(equipment.kind)) {
      return fail('equipment_incompatible', `${cmd.exercise.name} can't be done on ${equipment.name}.`);
    }
  }
  const order = Math.max(-1, ...state.exercises.map((e) => e.order)) + 1;
  const ex: SessionExercise = {
    id: cmd.newSessionExerciseId,
    sessionId: state.session.id,
    exerciseId: cmd.exercise.exerciseId,
    exerciseName: cmd.exercise.name,
    measurement: cmd.exercise.measurement,
    laterality: cmd.exercise.laterality,
    equipmentId: equipment?.id ?? null,
    loadConvention: equipment?.loadConvention ?? cmd.exercise.defaultLoadConvention,
    unit: equipment?.unit ?? cmd.unit,
    order,
    supersetGroup: null,
    transitionRestS: null,
    progressionRuleId: null,
  };
  const plan = cmd.plan ?? [{ id: cmd.newSetId, setType: 'working' as const, planned: { load: null, reps: null, durationS: null, rpe: null, rir: null } }];
  if (plan[0]?.id !== cmd.newSetId) return fail('invalid_values', 'The first planned set must use the new set ID.');
  const planIds = new Set(plan.map((p) => p.id));
  if (planIds.size !== plan.length || state.sets.some((s) => planIds.has(s.id))) return fail('invalid_values', 'That set ID is already used.');
  for (const p of plan) {
    const load = p.planned.load;
    if (load !== null && (load.convention !== ex.loadConvention || load.unit !== ex.unit)) {
      return fail('invalid_values', `A planned load must be in ${ex.unit} (${ex.loadConvention}); convert explicitly first.`);
    }
  }
  const added: WorkoutSet[] = plan.map((p, index) => ({
    id: p.id,
    sessionId: state.session.id,
    sessionExerciseId: ex.id,
    index,
    setType: p.setType,
    status: 'pending',
    side: cmd.exercise.laterality === 'unilateral' ? 'both' : null,
    pairedWithSetId: null,
    planned: p.planned,
    rest: cmd.rest,
    actual: null,
    draft: null,
    completedAt: null,
    completedByOpId: null,
    undoCount: 0,
    flags: [],
    edited: false,
    version: 1,
  }));
  const events: SessionEvent[] = [
    { type: 'ExerciseAdded', sessionExerciseId: ex.id },
    ...added.map((s): SessionEvent => ({ type: 'SetAdded', setId: s.id, sessionExerciseId: ex.id })),
  ];
  const activeSetId = activateIfIdle(state, cmd.newSetId, events);
  const next = { ...state, exercises: [...state.exercises, ex], sets: [...state.sets, ...added] };
  return { ok: true, state: bumpVersion(next, activeSetId), events };
}

function handleDeleteSet(state: SessionAggregate, cmd: CommandOf<'delete_set'>): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
  if (set.version !== cmd.expectedSetVersion) return fail('stale_version', 'This set changed since it was shown.');
  if (isWorkLive(state, [set.id])) return fail('work_interval_running', 'Stop the work timer before deleting this set.');
  const deleted: WorkoutSet = { ...set, status: 'deleted', draft: null, version: set.version + 1 };
  const audit: SessionAggregate['audit'] = [
    ...state.audit,
    {
      id: `${cmd.opId}:deleted`,
      sessionId: state.session.id,
      setId: set.id,
      opId: cmd.opId,
      kind: 'deleted' as const,
      atUtc: cmd.at.utc,
      before: snapshot(set),
      after: snapshot(deleted),
    },
  ];
  const events: SessionEvent[] = [{ type: 'SetDeleted', setId: set.id }];
  // A pending other-side row belongs to the deleted set: the pair is one prescribed set (review R4).
  const sets = dropPendingCompanions(state, replaceSet(state.sets, deleted), set.id, cmd, audit, events);
  // The rest timer is left alone, as for corrections (invariant 5).
  const activeSetId = repointActive(state, sets, events);
  return { ok: true, state: bumpVersion({ ...state, sets, audit }, activeSetId), events };
}

function handleSkipExercise(state: SessionAggregate, cmd: CommandOf<'skip_exercise'>): Handled {
  const ex = state.exercises.find((e) => e.id === cmd.sessionExerciseId);
  if (!ex) return fail('exercise_not_found', 'Exercise not found in this workout.');
  const pending = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status === 'pending');
  if (pending.length === 0) return { ok: true, state, events: [] };
  if (isWorkLive(state, pending.map((s) => s.id))) {
    return fail('work_interval_running', 'Stop the work timer before skipping this exercise.');
  }
  const audit = [...state.audit];
  const skippedIds = new Set(pending.map((s) => s.id));
  const sets = state.sets.map((s) => {
    if (!skippedIds.has(s.id)) return s;
    const skipped: WorkoutSet = { ...s, status: 'skipped', version: s.version + 1 };
    audit.push({
      id: `${cmd.opId}:skipped:${s.id}`,
      sessionId: state.session.id,
      setId: s.id,
      opId: cmd.opId,
      kind: 'skipped',
      atUtc: cmd.at.utc,
      before: snapshot(s),
      after: snapshot(skipped),
    });
    return skipped;
  });
  const events: SessionEvent[] = [{ type: 'SetsSkipped', setIds: [...skippedIds] }];
  const activeSetId = repointActive(state, sets, events);
  return { ok: true, state: bumpVersion({ ...state, sets, audit }, activeSetId), events };
}

function handleDiscard(state: SessionAggregate, cmd: CommandOf<'discard'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) {
    return fail('stale_version', 'The workout changed since Discard was opened. Review and try again.');
  }
  const events: SessionEvent[] = [];
  let restTimer = state.restTimer;
  if (isTimerLive(restTimer)) {
    restTimer = endRestTimer(restTimer, 'cancelled', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'cancelled', timerVersion: restTimer.version, lateByMs: 0 });
  }
  let workInterval = state.workInterval;
  if (workInterval && (workInterval.status === 'running' || workInterval.status === 'paused')) {
    // Explicit, confirmed discard of the whole workout: nothing is being kept.
    workInterval = { ...workInterval, status: 'cancelled', endedAtUtc: toIso(nowMs) };
    events.push({ type: 'WorkIntervalEnded', setId: workInterval.setId, reason: 'cancelled', elapsedS: 0, lateByMs: 0 });
  }
  events.push({ type: 'SessionDiscarded' });
  const next: SessionAggregate = {
    ...state,
    restTimer,
    workInterval,
    session: {
      ...state.session,
      status: 'discarded',
      endedAt: cmd.at,
      pause: null,
      pauses: closePause(state, nowMs),
      activeSetId: null,
      version: state.session.version + 1,
    },
  };
  return { ok: true, state: next, events };
}

function handleSetRestAfter(state: SessionAggregate, cmd: CommandOf<'set_rest_after'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed since this was opened.');
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'Rest can only be changed for sets not done yet.');
  const ex = exerciseOf(state, set);
  if (!ex) return fail('exercise_not_found', 'Exercise not found in this workout.');
  const rest =
    cmd.scope === 'set'
      ? { seconds: cmd.seconds, source: 'set_override' as const, sourceLabel: 'This set' }
      : { seconds: cmd.seconds, source: 'exercise_default' as const, sourceLabel: `${ex.exerciseName} default (yours)` };
  // Only sets not done yet; completed sets and the running timer are never touched.
  const targets = cmd.scope === 'set' ? [set] : state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status === 'pending');
  const ids = new Set(targets.map((s) => s.id));
  const sets = state.sets.map((s) => (ids.has(s.id) ? { ...s, rest, version: s.version + 1 } : s));
  return { ok: true, state: bumpVersion({ ...state, sets }), events: [{ type: 'RestPlanChanged', setIds: [...ids], seconds: cmd.seconds }] };
}

/**
 * `rename_session` (premium-feel §2.6): the workout's own name. The routine
 * it came from keeps its name. An open-ended workout in progress can't be
 * named yet: a name is what marks a planned workout, so naming it would
 * change how its last set rests (audit B1). It can be named after Finish.
 */
function handleRenameSession(state: SessionAggregate, cmd: CommandOf<'rename_session'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed; reload.');
  const name = cmd.name === null ? null : cmd.name.trim();
  if (state.session.status === 'active' && (isOpenEndedWorkout(state) || name === null)) {
    return fail('session_not_finished', 'You can name this workout after you finish it.');
  }
  if (state.session.routineName === name) return { ok: true, state, events: [] };
  return {
    ok: true,
    state: { ...state, session: { ...state.session, routineName: name, version: state.session.version + 1 } },
    events: [{ type: 'SessionRenamed', name }],
  };
}

function handleSaveDraft(state: SessionAggregate, cmd: CommandOf<'save_draft'>): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'Drafts are only for sets not yet logged.');
  return { ok: true, state: { ...state, sets: replaceSet(state.sets, { ...set, draft: cmd.values }) }, events: [] };
}

function dispatch(state: SessionAggregate, command: SessionCommand, nowMs: number): Handled {
  switch (command.type) {
    case 'log_set':
      return handleLogSet(state, command, nowMs);
    case 'correct_set':
      return handleCorrectSet(state, command);
    case 'undo_log':
      return handleUndoLog(state, command, nowMs);
    case 'set_active_set':
      return handleSetActiveSet(state, command);
    case 'adjust_rest':
      return handleAdjustRest(state, command, nowMs);
    case 'skip_rest':
      return handleSkipRest(state, command, nowMs);
    case 'start_work_interval':
      return handleStartWork(state, command, nowMs);
    case 'stop_work_interval':
      return handleStopWork(state, command, nowMs);
    case 'pause':
      return handlePause(state, nowMs);
    case 'resume':
      return handleResume(state, nowMs);
    case 'finish':
      return handleFinish(state, command, nowMs);
    case 'save_draft':
      return handleSaveDraft(state, command);
    case 'update_session_timing':
      return handleUpdateTiming(state, command, nowMs);
    case 'add_set':
      return handleAddSet(state, command);
    case 'add_exercise':
      return handleAddExercise(state, command);
    case 'delete_set':
      return handleDeleteSet(state, command);
    case 'skip_exercise':
      return handleSkipExercise(state, command);
    case 'discard':
      return handleDiscard(state, command, nowMs);
    case 'set_rest_after':
      return handleSetRestAfter(state, command);
    case 'rename_session':
      return handleRenameSession(state, command);
    case 'tick':
      return { ok: true, state, events: [] };
  }
}

/**
 * A duplicate whose effect is no longer in place (review M3, re-review minor 4,
 * third review follow-up 4). Voice and coach tools report "not saved" or
 * "since changed" for these instead of repeating a stale confirmation.
 *
 * Not tracked, by design (always false):
 * - `finish`, `discard`: terminal; nothing can revert them.
 * - `add_exercise`: an exercise can't be removed, so the addition stays in place.
 * - `set_active_set`, `adjust_rest`, `skip_rest`, `start_work_interval`,
 *   `stop_work_interval`, `pause`, `resume`: transient navigation and timer
 *   state that moves on by itself (the next log changes the active set, a rest
 *   expires). "Superseded" would be true almost always and carry no meaning;
 *   callers read the current phase from the returned state instead.
 */
function isSuperseded(state: SessionAggregate, command: SessionCommand): boolean {
  switch (command.type) {
    case 'log_set': {
      const set = state.sets.find((s) => s.id === command.setId);
      return set?.status !== 'completed' || set.completedByOpId !== command.opId;
    }
    case 'undo_log':
      // The undo put the set back to pending; it has since been logged again (or deleted).
      return state.sets.find((s) => s.id === command.setId)?.status !== 'pending';
    case 'delete_set':
      return state.sets.find((s) => s.id === command.setId)?.status !== 'deleted';
    case 'correct_set': {
      // A later correction, undo or delete changed the set after this correction.
      const entry = state.audit.find((e) => e.opId === command.opId && e.kind === 'corrected');
      const set = state.sets.find((s) => s.id === command.setId);
      if (!entry?.after || set?.status !== 'completed') return true;
      return set.version !== entry.after.version;
    }
    case 'skip_exercise':
      // A skipped set has since been deleted.
      return state.audit
        .filter((e) => e.opId === command.opId && e.kind === 'skipped')
        .some((e) => state.sets.find((s) => s.id === e.setId)?.status !== 'skipped');
    case 'add_set': {
      const created = state.processedOps[command.opId]?.createdIds ?? [];
      return created.some((id) => state.sets.find((s) => s.id === id)?.status === 'deleted');
    }
    case 'update_session_timing':
      // A later timing edit replaced a value this one set.
      return state.timingAudit
        .filter((e) => e.opId === command.opId)
        .some((e) => {
          const current = e.field === 'startedAt' ? state.session.startedAt : state.session.endedAt;
          return current?.utc !== e.after.utc;
        });
    case 'rename_session':
      // A later rename (or its undo) replaced this name.
      return state.session.routineName !== (command.name === null ? null : command.name.trim());
    case 'finish':
    case 'discard':
    case 'add_exercise':
    case 'set_active_set':
    case 'adjust_rest':
    case 'skip_rest':
    case 'start_work_interval':
    case 'stop_work_interval':
    case 'pause':
    case 'resume':
    case 'save_draft':
    case 'set_rest_after':
    case 'tick':
      return false;
  }
}

/**
 * The active-session state machine (flow-first-milestone.md §3). Pure: the
 * same state and command always give the same result.
 *
 * - Commands with an `opId` apply at most once. A repeat with the same intent
 *   returns `duplicate: true` and changes nothing; a different command reusing
 *   the ID is rejected.
 * - Version-checked commands reject stale input instead of applying it to newer state.
 * - Time only expires timers; it never commits a set.
 * - A finished session accepts only corrections and timing edits (and ticks,
 *   which are no-ops). A discarded session accepts nothing.
 */
export function reduceSession(state: SessionAggregate, command: SessionCommand): ReduceResult {
  const nowMs = toMs(command.at.utc);

  if ('opId' in command) {
    const prior = state.processedOps[command.opId];
    if (prior) {
      if (prior.commandType !== command.type || prior.fingerprint !== commandFingerprint(command)) {
        return {
          ok: false,
          error: { code: 'operation_id_reused', message: 'This operation ID was already used for a different action.' },
          state,
          events: [],
        };
      }
      return { ok: true, state, events: [], duplicate: true, superseded: isSuperseded(state, command) };
    }
  }

  if (state.session.status !== 'active') {
    if (command.type === 'tick') return { ok: true, state, events: [], duplicate: false, superseded: false };
    // A finished workout accepts only corrections and timing edits; a discarded one accepts nothing.
    const allowed =
      state.session.status === 'finished' && (command.type === 'correct_set' || command.type === 'update_session_timing' || command.type === 'rename_session');
    if (!allowed) {
      const message =
        state.session.status === 'finished'
          ? 'This workout is finished.'
          : state.session.status === 'reverted'
            ? 'This workout was hidden when its import was undone.'
            : 'This workout was discarded.';
      return { ok: false, error: { code: 'session_finished', message }, state, events: [] };
    }
    // Imported workouts have a date and no time (FitNotes files carry none); there is no time to correct.
    if (command.type === 'update_session_timing' && state.session.localDate !== undefined) {
      return { ok: false, error: { code: 'session_finished', message: 'This imported workout has a date only, so there are no times to edit.' }, state, events: [] };
    }
  }

  const clocked = applyClock(state, nowMs);
  const handled = dispatch(clocked.state, command, nowMs);
  if (!handled.ok) {
    const caughtUp = clocked.state === state ? state : { ...clocked.state, revision: state.revision + 1 };
    return { ok: false, error: handled.error, state: caughtUp, events: clocked.events };
  }

  const events = [...clocked.events, ...handled.events];
  const changed = handled.state !== state;
  if (!changed) return { ok: true, state, events, duplicate: false, superseded: false };

  let next: SessionAggregate = { ...handled.state, revision: state.revision + 1 };
  if ('opId' in command) {
    const record: ProcessedOperation = {
      opId: command.opId,
      commandType: command.type,
      fingerprint: commandFingerprint(command),
      atUtc: command.at.utc,
      ...(command.type === 'add_set' ? { createdIds: [command.newSetId] } : {}),
    };
    next = { ...next, processedOps: { ...next.processedOps, [command.opId]: record } };
  }
  if (command.type !== 'tick') {
    next = { ...next, session: { ...next.session, lastActivityAtUtc: command.at.utc } };
  }
  return { ok: true, state: next, events, duplicate: false, superseded: false };
}
