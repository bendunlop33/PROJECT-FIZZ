import type {
  CommandOf,
  EquipmentInstance,
  ProcessedOperation,
  RestTimer,
  SessionAggregate,
  SessionCommand,
  SessionExercise,
  SetFlag,
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
import { stableStringify } from '../stable';
import { toIso, toMs } from '../time';
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
  | 'convention_mismatch'
  | 'unit_mismatch'
  | 'timer_not_found'
  | 'timer_not_running'
  | 'not_timed_exercise'
  | 'work_interval_running'
  | 'work_interval_not_running';

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
  | { type: 'SessionFinished' };

export type ReduceResult =
  | { ok: true; state: SessionAggregate; events: SessionEvent[]; duplicate: boolean }
  | { ok: false; error: SessionError; state: SessionAggregate };

type Handled = { ok: true; state: SessionAggregate; events: SessionEvent[] } | { ok: false; error: SessionError };

const fail = (code: SessionErrorCode, message: string): Handled => ({ ok: false, error: { code, message } });

/**
 * Fingerprint of a command's intent. `at` and generated IDs (`restTimerId`)
 * are excluded so a retry after relaunch, which regenerates them, still matches.
 */
export function commandFingerprint(command: SessionCommand): string {
  return stableStringify({ ...command, at: undefined, restTimerId: undefined });
}

function snapshot(set: WorkoutSet): SetSnapshot {
  return { status: set.status, setType: set.setType, actual: set.actual, version: set.version };
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
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'This set is already logged or skipped.');
  const wi = state.workInterval;
  if (wi && wi.setId === set.id && (wi.status === 'running' || wi.status === 'paused')) {
    return fail('work_interval_running', 'Stop the work timer before logging.');
  }
  const ex = exerciseOf(state, set);
  if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
  const invalid = validateValues(cmd.values, ex);
  if (invalid) return { ok: false, error: invalid };

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
    actual: cmd.values,
    draft: null,
    completedAt: cmd.at,
    completedByOpId: cmd.opId,
    flags: flagsFor(cmd.values, state, ex),
    version: set.version + 1,
  };
  const sets = replaceSet(state.sets, completed);
  events.push({ type: 'SetCommitted', setId: set.id, opId: cmd.opId });

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

  const nextActive = nextPendingSet(set.id, state.exercises, sets);
  if (nextActive === null) {
    // Final set of the workout: no rest; the primary becomes Finish.
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
    rest = { kind: 'rest', seconds: set.rest.seconds, source: set.rest.source };
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
  const { setType, ...valuePatch } = cmd.patch;
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

function latestCompletedSet(state: SessionAggregate): WorkoutSet | undefined {
  let latest: { set: WorkoutSet; ms: number; auditIndex: number } | undefined;
  for (const set of state.sets) {
    if (set.status !== 'completed' || set.completedAt === null) continue;
    const ms = toMs(set.completedAt.utc);
    let auditIndex = -1;
    state.audit.forEach((a, i) => {
      if (a.setId === set.id && a.kind === 'logged') auditIndex = i;
    });
    if (!latest || ms > latest.ms || (ms === latest.ms && auditIndex > latest.auditIndex)) {
      latest = { set, ms, auditIndex };
    }
  }
  return latest?.set;
}

function handleUndoLog(state: SessionAggregate, cmd: CommandOf<'undo_log'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) {
    return fail('stale_version', 'The workout changed since this undo was offered.');
  }
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'completed') return fail('set_not_completed', 'This set is not logged.');
  if (latestCompletedSet(state)?.id !== set.id) {
    return fail('not_latest_set', 'Only the most recent set can be undone; correct or delete older sets instead.');
  }
  const restored: WorkoutSet = {
    ...set,
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
  events.push({ type: 'ActiveSetChanged', setId: set.id });
  const audit = [
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
  const next = bumpVersion({ ...state, sets: replaceSet(state.sets, restored), audit, restTimer }, set.id);
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

function handleStopWork(state: SessionAggregate, cmd: CommandOf<'stop_work_interval'>, nowMs: number): Handled {
  if (state.session.pause !== null) return fail('session_paused', 'Resume the workout first.');
  const wi = state.workInterval;
  if (wi?.setId !== cmd.setId || wi.status !== 'running') {
    return fail('work_interval_not_running', 'No work timer is running for this set.');
  }
  const elapsedS = Math.max(0, Math.round((nowMs - toMs(wi.startedAtUtc) - wi.pausedMs) / 1000));
  const set = state.sets.find((s) => s.id === wi.setId);
  let sets = state.sets;
  if (set?.status === 'pending') {
    sets = replaceSet(sets, { ...set, draft: { ...baseDraft(set), durationS: elapsedS } });
  }
  return {
    ok: true,
    state: { ...state, sets, workInterval: { ...wi, status: 'stopped', endedAtUtc: toIso(nowMs) } },
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
      session: { ...state.session, pause: null, pausedTotalMs: state.session.pausedTotalMs + pausedFor },
    },
    events: [{ type: 'SessionResumed' }],
  };
}

function handleFinish(state: SessionAggregate, cmd: CommandOf<'finish'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) {
    return fail('stale_version', 'The workout changed since Finish was opened. Review and try again.');
  }
  const endedAt = cmd.endedAt ?? cmd.at;
  const endMs = toMs(endedAt.utc);
  if (endMs < toMs(state.session.startedAt.utc)) {
    return fail('invalid_values', 'The end time is before the workout started.');
  }
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
  let workInterval = state.workInterval;
  if (workInterval && (workInterval.status === 'running' || workInterval.status === 'paused')) {
    workInterval = { ...workInterval, status: 'cancelled', endedAtUtc: toIso(nowMs) };
    events.push({ type: 'WorkIntervalEnded', setId: workInterval.setId, reason: 'cancelled', elapsedS: 0, lateByMs: 0 });
  }
  let pausedTotalMs = state.session.pausedTotalMs;
  const pause = state.session.pause;
  if (pause !== null) pausedTotalMs += Math.max(0, Math.min(endMs, nowMs) - toMs(pause.pausedAtUtc));

  events.push({ type: 'SessionFinished' });
  const next: SessionAggregate = {
    ...state,
    sets,
    audit,
    restTimer,
    workInterval,
    session: {
      ...state.session,
      status: 'finished',
      endedAt,
      pause: null,
      pausedTotalMs,
      activeSetId: null,
      version: state.session.version + 1,
    },
  };
  return { ok: true, state: next, events };
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
    case 'tick':
      return { ok: true, state, events: [] };
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
 * - A finished session accepts only corrections (and ticks, which are no-ops).
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
        };
      }
      return { ok: true, state, events: [], duplicate: true };
    }
  }

  if (state.session.status !== 'active' && command.type !== 'correct_set') {
    if (command.type === 'tick') return { ok: true, state, events: [], duplicate: false };
    return { ok: false, error: { code: 'session_finished', message: 'This workout is finished.' }, state };
  }

  const clocked = applyClock(state, nowMs);
  const handled = dispatch(clocked.state, command, nowMs);
  if (!handled.ok) return { ok: false, error: handled.error, state };

  const events = [...clocked.events, ...handled.events];
  const changed = handled.state !== state;
  if (!changed) return { ok: true, state, events, duplicate: false };

  let next: SessionAggregate = { ...handled.state, revision: state.revision + 1 };
  if ('opId' in command) {
    const record: ProcessedOperation = {
      opId: command.opId,
      commandType: command.type,
      fingerprint: commandFingerprint(command),
      atUtc: command.at.utc,
    };
    next = { ...next, processedOps: { ...next.processedOps, [command.opId]: record } };
  }
  if (command.type !== 'tick') {
    next = { ...next, session: { ...next.session, lastActivityAtUtc: command.at.utc } };
  }
  return { ok: true, state: next, events, duplicate: false };
}
