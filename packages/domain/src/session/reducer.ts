import { coachEditStepOpId } from '@fizz/schemas';
import type {
  CommandOf,
  SetAuditEntry,
  SessionTimingAuditEntry,
  ZonedTimestamp,
  EquipmentInstance,
  Load,
  PlannedSet,
  PauseInterval,
  ProcessedOperation,
  RestTimer,
  SessionAggregate,
  SessionCommand,
  SessionExercise,
  SetExclusion,
  SetFlag,
  SetSide,
  SetSnapshot,
  SetValues,
  TargetProvenance,
  WorkoutSet,
} from '@fizz/schemas';
import { isLoadAchievable } from '../equipment';
import { isWeightedBodyweight, loadCheckEquipment, rowMarkedBodyweight } from '../added-weight';
import { normaliseExclusions } from '../exclusions';
import { currentGymEquipment, equipmentOfRow, rowIsAtCurrentGym } from './equipment-snapshot';
import { applyChangeGym, applyUndoChangeGym, partRootOf } from './gym-switch';
import {
  adjustRestTimer,
  createRestTimer,
  endRestTimer,
  expireRestTimerIfDue,
  mapResumable,
  pauseRestTimer,
  restoreAfterUndo,
  resumableAfterLog,
  resumeRestTimer,
  withResumable,
} from '../rest';
import { deriveId, stableStringify } from '../stable';
import { asCardioInterval, CARDIO_TIMER_CAP_S, cardioElapsedMs, cardioHasValue, resumeCardioInterval } from '../cardio';
import { toIso, toMs } from '../time';
import { carriesTodayAdjustment, coachUndoRefusal } from './coach-undo';
import { isOpenEndedWorkout } from './first-run';
import { pendingSetsOf } from './mid-swap';
import { buildExecutionOrder, effectiveOffset, isRoundEnd, joinRoundOffset, MAX_ROUND_OFFSET, nextPendingSet, supersetLinkSides } from './order';

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
  | 'equipment_incompatible'
  | 'gym_change_not_found'
  /** A coach adjustment's Undo after the gym changed (its saved targets were for the old gym). */
  | 'gym_changed'
  /** A discard whose `confirmedLoggedSets` doesn't match the logged sets it would discard. */
  | 'discard_unconfirmed'
  /** `remove_exercise` on an exercise with a logged set (correct or delete the sets instead). */
  | 'exercise_logged'
  /** `undo_op` on an operation this workout never applied. */
  | 'operation_not_found'
  /** `undo_op` on an operation that has no Undo (a log has its own `undo_log`). */
  | 'operation_not_undoable';

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
  /** A gym switch (or `[Use changes today]`) or its Undo. `changedSetIds`: targets that changed. */
  | { type: 'GymChanged'; actionId: string; fromGymId: string | null; toGymId: string; changedSetIds: string[]; undo: boolean }
  | { type: 'SessionRenamed'; name: string | null }
  /** `Count it` (or its Undo) on Progress's Time sheet (progress.md PG25a). */
  | { type: 'SessionDurationConfirmed'; confirmed: boolean }
  | { type: 'FinishByChanged'; finishByUtc: string | null }
  /** A coach adjustment changed (or its Undo restored) pending targets. Cue layers rebuild the rest-end line. */
  | { type: 'TargetsAdjusted'; actionId: string; setIds: string[]; reverted: boolean }
  /** Ben swapped an exercise mid-workout (EL4): pending sets moved to a new row. */
  | { type: 'ExerciseSwapped'; fromSessionExerciseId: string; toSessionExerciseId: string; setIds: string[] }
  /** An exercise added by mistake was removed (or its removal undone). */
  | { type: 'ExerciseRemoved'; sessionExerciseId: string; undo: boolean }
  /** `undo_op`: sets put back as they were before the operation. */
  | { type: 'SetsRestored'; opId: string; setIds: string[] }
  | { type: 'NoteChanged'; target: { kind: 'exercise'; sessionExerciseId: string } | { kind: 'set'; setId: string } }
  | { type: 'TargetRpeSet'; setIds: string[]; rpe: number | null }
  | { type: 'LoadModeChanged'; sessionExerciseId: string; mode: 'added' | 'bodyweight'; setIds: string[] }
  /** Ben edited a set not done yet (target, type, rest), or its Undo put the old one back. Cue layers rebuild the rest-end line. */
  | { type: 'PlannedSetEdited'; setId: string; undo: boolean }
  /** (Coach v3) Rows moved (`move_exercise`), or put back by its Undo. Cue layers rebuild what's next. */
  | { type: 'ExercisesMoved'; sessionExerciseIds: string[]; undo: boolean };

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
    return stableStringify({
      type: command.type,
      exerciseId: command.exercise.exerciseId,
      equipmentId: command.equipmentId,
      ...(command.afterSessionExerciseId === undefined ? {} : { after: command.afterSessionExerciseId }),
      ...(command.supersetWithSessionExerciseId === undefined ? {} : { supersetWith: command.supersetWithSessionExerciseId }),
    });
  }
  if (command.type === 'change_gym') {
    // Generated IDs (the action and continuation rows) are not part of the intent.
    return stableStringify({ ...command, at: undefined, actionId: undefined, slots: command.slots.map((x) => ({ ...x, continuationId: undefined })) });
  }
  if (command.type === 'swap_exercise') {
    // Generated IDs are not part of the intent; the row, version, exercise and equipment are.
    return stableStringify({ type: command.type, sessionExerciseId: command.sessionExerciseId, expectedVersion: command.expectedVersion, exerciseId: command.exercise.exerciseId, equipmentId: command.equipmentId });
  }
  if (command.type === 'coach_edit_today') {
    // Each step by its own intent (no times, no generated IDs); the version and the record are part of it.
    return stableStringify({ type: command.type, expectedVersion: command.expectedVersion, actionId: command.actionId, steps: command.steps.map((x) => commandFingerprint(x)) });
  }
  if (command.type === 'add_set' && command.continuation) {
    return stableStringify({ ...command, at: undefined, newSetId: undefined, continuation: { ...command.continuation, id: undefined } });
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
  const exclusions = normaliseExclusions(set.exclusions);
  return {
    status: set.status,
    setType: set.setType,
    side: set.side,
    actual: set.actual,
    ...(exclusions.length > 0 ? { exclusions } : {}),
    ...(set.planned.rpeOverride !== undefined ? { targetRpe: set.planned.rpeOverride } : {}),
    version: set.version,
  };
}

/**
 * The set with these exclusion flags (§2.13). Stored in the canonical order;
 * none = the field is absent, exactly like a set saved before flags existed,
 * so a reload compares equal.
 */
function withExclusions(set: WorkoutSet, xs: readonly SetExclusion[] | undefined): WorkoutSet {
  const n = normaliseExclusions(xs);
  const next: WorkoutSet = { ...set, exclusions: n };
  if (n.length === 0) delete next.exclusions;
  return next;
}

function replaceSet(sets: readonly WorkoutSet[], next: WorkoutSet): WorkoutSet[] {
  return sets.map((s) => (s.id === next.id ? next : s));
}

function exerciseOf(state: SessionAggregate, set: WorkoutSet): SessionExercise | undefined {
  return state.exercises.find((e) => e.id === set.sessionExerciseId);
}

/** The row's own equipment (a done set keeps the item it was logged on, also after a gym switch). */
function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | undefined {
  return equipmentOfRow(state.session.equipmentSnapshot, ex) ?? undefined;
}

/**
 * The item a row's loads are checked against: the gym's added-weight options
 * for a bodyweight exercise logged with weight, else the row's own item.
 */
function checkEquipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | undefined {
  return loadCheckEquipment(ex, equipmentOf(state, ex) ?? null, currentGymEquipment(state.session), state.session.gymId, rowMarkedBodyweight(state.sets, ex.id)) ?? undefined;
}

/** A bodyweight exercise logged with weight held or worn (on a station, or marked by the session's own record). */
function weightedRow(state: SessionAggregate, ex: SessionExercise): boolean {
  return isWeightedBodyweight(ex, equipmentOf(state, ex) ?? null, rowMarkedBodyweight(state.sets, ex.id));
}

/** The row can switch between bodyweight and added: a bodyweight row, a station, or a row marked as a bodyweight exercise. */
function switchableRow(state: SessionAggregate, ex: SessionExercise): boolean {
  if (ex.loadConvention !== 'bodyweight' && ex.loadConvention !== 'added') return false;
  const own = equipmentOf(state, ex) ?? null;
  if (own !== null) return own.kind === 'bodyweight_station';
  return ex.loadConvention === 'bodyweight' || rowMarkedBodyweight(state.sets, ex.id);
}

/** No weight added to a bodyweight exercise: nothing to check. */
function nothingAdded(load: Load, state: SessionAggregate, ex: SessionExercise): boolean {
  return load.convention === 'added' && load.value === 0 && weightedRow(state, ex);
}

/**
 * A logged set on a bodyweight exercise keeps the convention it was logged
 * with: after `+ Weight` (or back) its bodyweight or added result can still
 * be corrected as it was. Only for bodyweight exercises (review S5): a sled
 * push or a leg press with its machine missing stays `added` only.
 */
function conventionFits(load: Load, ex: SessionExercise, state: SessionAggregate): boolean {
  if (load.convention === ex.loadConvention) return true;
  const pair = (c: Load['convention']) => c === 'bodyweight' || c === 'added';
  return pair(load.convention) && switchableRow(state, ex);
}

function validateValues(values: SetValues, ex: SessionExercise, state: SessionAggregate): SessionError | null {
  if (ex.measurement === 'reps' && values.reps === null) {
    return { code: 'invalid_values', message: 'Reps are required for this exercise.' };
  }
  if (ex.measurement === 'duration' && values.durationS === null) {
    return { code: 'invalid_values', message: 'A duration is required for this exercise.' };
  }
  if (ex.measurement === 'distance' && (values.distanceM === null || values.distanceM === undefined)) {
    return { code: 'invalid_values', message: 'A distance is required for this exercise.' };
  }
  if (ex.measurement === 'cardio' && !cardioHasValue(values)) {
    return { code: 'invalid_values', message: 'A time or a distance is required for this exercise.' };
  }
  if (values.load === null) {
    if (ex.loadConvention === 'bodyweight') return null;
    return { code: 'invalid_values', message: 'A load is required for this exercise.' };
  }
  if (!conventionFits(values.load, ex, state)) {
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
  if (values.load === null || values.load.convention === 'bodyweight') return [];
  const own = equipmentOf(state, ex) ?? null;
  const weighted = values.load.convention === 'added' && isWeightedBodyweight({ loadConvention: 'added' }, own, rowMarkedBodyweight(state.sets, ex.id));
  const eq = weighted ? loadCheckEquipment({ loadConvention: 'added', unit: ex.unit }, own, currentGymEquipment(state.session), state.session.gymId, true) : own;
  if (weighted && values.load.value === 0) return [];
  if (weighted && !eq) return ['off_profile_load'];
  if (!eq) return [];
  return isLoadAchievable(values.load, eq) ? [] : ['off_profile_load'];
}

function baseDraft(set: WorkoutSet): SetValues {
  return set.draft ?? { load: set.planned.load, reps: null, durationS: null, rpe: null, rir: null };
}

/** A result as stored: no `distanceM` key unless there is a distance (the stored row has no column value for "none"). */
export function withoutEmptyDistance(values: SetValues): SetValues {
  if (values.distanceM !== null && values.distanceM !== undefined) return values;
  const out: SetValues = { ...values };
  delete out.distanceM;
  return out;
}

function isTimerLive(timer: RestTimer | null): timer is RestTimer {
  return timer !== null && (timer.status === 'running' || timer.status === 'paused');
}

/** The live work interval of a cardio set as `asCardioInterval` reads it; the state unchanged otherwise. */
function withCardioInterval(state: SessionAggregate): SessionAggregate {
  const wi = state.workInterval;
  if (wi === null || (wi.status !== 'running' && wi.status !== 'paused' && wi.status !== 'stopped') || wi.durationS >= CARDIO_TIMER_CAP_S) return state;
  const set = state.sets.find((s) => s.id === wi.setId);
  if (set === undefined || exerciseOf(state, set)?.measurement !== 'cardio') return state;
  return { ...state, workInterval: asCardioInterval(wi) };
}

/**
 * Apply the passage of time: expire a rest timer or work interval whose
 * deadline has passed. Never commits a set (invariant 1). No-op while paused.
 */
function applyClock(stored: SessionAggregate, nowMs: number): { state: SessionAggregate; events: SessionEvent[] } {
  if (stored.session.status !== 'active') return { state: stored, events: [] };
  // A cardio timer stored before migration 20 (the air bike's, run to its old 10-minute target) runs on to the cardio cap (review S7).
  const state = withCardioInterval(stored);
  if (state.session.pause !== null) return { state, events: [] };
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
  const ex = exerciseOf(state, set);
  if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
  const wi = state.workInterval;
  const timing = wi !== null && wi.setId === set.id && (wi.status === 'running' || wi.status === 'paused');
  if (timing && ex.measurement !== 'cardio') {
    return fail('work_interval_running', 'Stop the work timer before logging.');
  }
  // Cardio (19 Oct): ✓ while its timer runs ends it and logs the time on it, with the distance typed in.
  // The set's timer goes with the log, as after Stop.
  const values: SetValues = timing ? { ...cmd.values, durationS: Math.round(cardioElapsedMs(wi, nowMs) / 1000) } : cmd.values;
  const invalid = validateValues(values, ex, state) ?? checkSide(cmd.side, ex);
  if (invalid) return { ok: false, error: invalid };
  if (set.pairedWithSetId !== null && cmd.side !== undefined && cmd.side !== set.side) {
    return fail('invalid_values', `This set is the ${set.side ?? 'other'} side of an earlier set. Log it as that side, or delete it.`);
  }

  const events: SessionEvent[] = [];
  // Unticking this set puts back the rest it ends here, deadline and all (workout-table-v3 §3).
  const resumable = resumableAfterLog(state.restTimer, set.id, nowMs);
  let restTimer = state.restTimer;
  if (restTimer?.status === 'running') {
    // P2: logging during rest ends that rest early.
    restTimer = endRestTimer(restTimer, 'ended_early', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'ended_early', timerVersion: restTimer.version, lateByMs: 0 });
  }

  // "100 for 8, spotted" logs and marks in one commit (§2.13).
  const completed: WorkoutSet = withExclusions(
    {
      ...set,
      status: 'completed',
      side: cmd.side ?? set.side,
      actual: withoutEmptyDistance(values),
      draft: null,
      completedAt: cmd.at,
      completedByOpId: cmd.opId,
      flags: flagsFor(values, state, ex),
      version: set.version + 1,
    },
    cmd.exclusions,
  );
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
    if (restTimer !== null) restTimer = withResumable(restTimer, resumable);
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
  if (restTimer !== null) restTimer = withResumable(restTimer, resumable);
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
    planned: withoutEditRecords(logged.planned),
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
    // The draft stays on the tombstone so an Undo brings it back (review gaps N6).
    const deleted: WorkoutSet = { ...s, status: 'deleted', version: s.version + 1 };
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
  const { setType, side, exclusions, targetRpe, ...valuePatch } = cmd.patch;
  const badSide = checkSide(side, ex);
  if (badSide) return { ok: false, error: badSide };
  // Ben's own target RPE for the logged set (CHANGELOG 2026-10-11 (b) "Edit set"): only a working set has one.
  // It is offered during the workout only (`buildSetEditView`); a finished workout keeps its targets (review r2 N2).
  if (targetRpe !== undefined && state.session.status !== 'active') return fail('session_finished', 'This workout is finished.');
  const finalType = setType ?? set.setType;
  const noTarget = finalType === 'warmup' || finalType === 'drop';
  if (targetRpe != null && noTarget) return fail('invalid_values', 'Warm-up and drop sets have no target effort.');
  // A set changed to a warm-up or drop has no target: its override goes in the same correction (review r2 N4).
  const clearOverride = noTarget && set.planned.rpeOverride !== undefined;
  const actual: SetValues = { ...set.actual };
  let valuesTouched = setType !== undefined || side !== undefined;
  for (const key of Object.keys(valuePatch) as (keyof SetValues)[]) {
    const v = valuePatch[key];
    if (v === undefined) continue;
    Object.assign(actual, { [key]: v });
    valuesTouched = true;
  }
  const invalid = validateValues(actual, ex, state);
  if (invalid) return { ok: false, error: invalid };

  // §2.13: exclusions replace the whole list. Marking a set changes no
  // values, so on its own it doesn't add the `Edited` tag; its words show instead.
  const corrected: WorkoutSet = withExclusions(
    {
      ...set,
      actual: withoutEmptyDistance(actual),
      ...(clearOverride ? { planned: withRpeOverride(set.planned, undefined) } : targetRpe === undefined ? {} : { planned: withRpeOverride(set.planned, targetRpe ?? undefined) }),
      setType: setType ?? set.setType,
      side: side ?? set.side,
      flags: flagsFor(actual, state, ex),
      edited: set.edited || valuesTouched,
      version: set.version + 1,
    },
    exclusions === undefined ? set.exclusions : exclusions,
  );
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
  // A pending set carries no exclusions: undoing the log removes them with it.
  const restored: WorkoutSet = {
    ...withExclusions(set, []),
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
  // Unticking never resets the rest (workout-table-v3 §3, Ben 20 Oct): the rest
  // this log replaced comes back with its original deadline, or finished at its
  // original end if it has run out (the "Rested" count-up carries on; no alert).
  const back = restTimer === null ? null : restoreAfterUndo(restTimer.resumeOnUndo ?? [], set.id, nowMs);
  if (restTimer !== null && back !== null) {
    restTimer = back.restored;
    if (restTimer.status === 'running' || restTimer.status === 'paused') {
      events.push({
        type: 'RestStarted',
        timerId: restTimer.id,
        setId: restTimer.setId,
        kind: restTimer.kind,
        durationS: restTimer.durationS,
        deadlineUtc: restTimer.deadlineUtc,
        timerVersion: restTimer.version,
      });
    }
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
  // A running (or paused) work timer stays on its set: Log would otherwise log another set while it runs (wo-v3 logic S3).
  const wi = state.workInterval;
  if (wi !== null && wi.setId !== set.id && (wi.status === 'running' || wi.status === 'paused')) return fail('work_interval_running', 'Stop the work timer first.');
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
  if (ex?.measurement !== 'duration' && ex?.measurement !== 'cardio') return fail('not_timed_exercise', 'Work timers are for timed exercises only.');
  const wi = state.workInterval;
  if (wi && (wi.status === 'running' || wi.status === 'paused')) {
    return fail('work_interval_running', 'A work timer is already running.');
  }
  // Cardio after Stop (review S6): Start resumes the same timer, so ✓ logs both segments; it never restarts at 0.
  const resumed = ex.measurement === 'cardio' && wi?.setId === set.id ? resumeCardioInterval(wi, nowMs) : null;
  if (ex.measurement === 'cardio' && wi?.setId === set.id && wi.status === 'completed') return fail('invalid_values', 'This timer reached its 4-hour limit.');
  const events: SessionEvent[] = [];
  let restTimer = state.restTimer;
  if (restTimer?.status === 'running') {
    restTimer = endRestTimer(restTimer, 'ended_early', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'ended_early', timerVersion: restTimer.version, lateByMs: 0 });
  }
  // Starting work ends rest for good: an Undo after this restores no earlier rest.
  if (restTimer !== null) restTimer = withResumable(restTimer, []);
  // Cardio counts up: its timer runs to the cap, whatever was asked, and ✓ or Stop ends it (19 Oct).
  const durationS = ex.measurement === 'cardio' ? CARDIO_TIMER_CAP_S : cmd.durationS;
  const workInterval = resumed ?? {
    setId: set.id,
    durationS,
    startedAtUtc: toIso(nowMs),
    deadlineUtc: toIso(nowMs + durationS * 1000),
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
  const set = state.sets.find((s) => s.id === wi.setId);
  const cardio = set !== undefined && exerciseOf(state, set)?.measurement === 'cardio';
  const elapsedS = cardio
    ? Math.round(cardioElapsedMs({ ...wi, status: 'stopped', endedAtUtc: toIso(endMs) }, endMs) / 1000)
    : Math.max(0, Math.min(wi.durationS, Math.round((endMs - toMs(wi.startedAtUtc) - wi.pausedMs) / 1000)));
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
  // Rests kept for Undo pause with it, so they keep time as if never replaced.
  const restTimer = state.restTimer ? mapResumable(pauseRestTimer(state.restTimer, nowMs), (t) => pauseRestTimer(t, nowMs), nowMs, true) : null;
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
  const restTimer = state.restTimer ? mapResumable(resumeRestTimer(state.restTimer, nowMs), (t) => resumeRestTimer(t, nowMs), nowMs, false) : null;
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
  // (19 Oct) A start chosen on the Finish sheet: never after the first logged set or in the future.
  const startedAt = cmd.startedAt ?? state.session.startedAt;
  const startMs = toMs(startedAt.utc);
  if (cmd.startedAt !== undefined) {
    const startError = checkStartTime(state, startMs, nowMs);
    if (startError) return { ok: false, error: startError };
    // The same check as `update_session_timing` (review N5).
    if (state.session.pause !== null && startMs > toMs(state.session.pause.pausedAtUtc)) {
      return fail('invalid_time', 'The start time is after the workout was paused.');
    }
  }
  const timeError = checkEndTime(state, endMs, nowMs, startMs);
  if (timeError) return { ok: false, error: timeError };
  const startChanged = cmd.startedAt !== undefined && cmd.startedAt.utc !== state.session.startedAt.utc;
  const timingAudit = [
    ...state.timingAudit,
    ...(startChanged && cmd.startedAt !== undefined ? [timingEntry(state, cmd.opId, 'startedAt', 'finish', cmd.at, state.session.startedAt, cmd.startedAt)] : []),
    ...(cmd.endedAt !== null && cmd.endedAt.utc !== cmd.at.utc ? [timingEntry(state, cmd.opId, 'endedAt', 'finish', cmd.at, cmd.at, cmd.endedAt)] : []),
  ];
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
  // Nothing to put back once the workout is over (no undo of a log after Finish or Discard).
  if (restTimer !== null) restTimer = withResumable(restTimer, []);
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
      startedAt,
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

/** A start time must not lie after the first logged set or in the future. */
function checkStartTime(state: SessionAggregate, startMs: number, nowMs: number): SessionError | null {
  if (startMs > nowMs) return { code: 'invalid_time', message: 'The start time is in the future.' };
  const done = completedTimes(state);
  if (done.length > 0 && startMs > Math.min(...done)) return { code: 'invalid_time', message: 'The start time is after the first logged set.' };
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
  const startError = checkStartTime(state, startMs, nowMs);
  if (startError) return { ok: false, error: startError };
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
  // `Insert set after` (14 Oct): straight after that set (after its other side), copying it.
  let after: WorkoutSet | null = null;
  if (cmd.afterSetId !== undefined) {
    const picked = live.find((s) => s.id === cmd.afterSetId);
    if (!picked) return fail('set_not_found', 'That set isn’t in this exercise any more.');
    after = picked.pairedWithSetId === null ? picked : (live.find((s) => s.id === picked.pairedWithSetId) ?? picked);
  }
  const template = after ?? (cmd.setType === null ? (live[live.length - 1] ?? last) : live.filter((s) => s.setType === cmd.setType).at(-1));
  if (!template) {
    return fail('set_not_found', `${ex.exerciseName} has no ${cmd.setType ?? ''} set to copy its target and rest from.`);
  }
  // After a gym switch a set is never added on another gym's equipment (gym-switch §4.3, rule 4).
  const atCurrentGym = rowIsAtCurrentGym(state.session, ex);
  if (!atCurrentGym && !cmd.continuation) return fail('equipment_not_found', `${ex.exerciseName}'s equipment isn't at this gym. Add the set from the workout screen.`);
  let exercises = state.exercises;
  let rowId = ex.id;
  // A copy is a new target: another set's Undo records stay with that set. Marked as added in the workout,
  // so plan vs done counts it as done, never as planned (review plans-19oct S1).
  let planned: WorkoutSet['planned'] = { ...withoutEditRecords(template.planned), addedInWorkout: true };
  let index = after === null ? last.index + 1 : after.index + 1;
  let sets = state.sets;
  if (after !== null && atCurrentGym) {
    // Later sets move down one place; only their position changes (never a value or version).
    const from = index;
    sets = sets.map((s) => (s.sessionExerciseId === ex.id && s.index >= from ? { ...s, index: s.index + 1 } : s));
  }
  const c = cmd.continuation;
  if (c && !atCurrentGym) {
    if (state.exercises.some((e) => e.id === c.id)) return fail('invalid_values', 'That exercise ID is already used.');
    const eq = c.equipmentId === null ? null : (currentGymEquipment(state.session).find((e) => e.id === c.equipmentId) ?? null);
    if (c.equipmentId !== null && (!eq || eq.availability !== 'available')) return fail('equipment_not_found', 'That equipment is not at this gym.');
    if (eq && (eq.unit !== c.unit || eq.loadConvention !== c.loadConvention)) return fail('invalid_values', `Targets on ${eq.name} must be in ${eq.unit} (${eq.loadConvention}).`);
    const l = c.planned.load;
    if (l !== null && (l.unit !== c.unit || l.convention !== c.loadConvention || (eq !== null && !isLoadAchievable(l, eq)))) {
      return fail('invalid_values', 'The new set’s target can’t be made on that equipment.');
    }
    const row: SessionExercise = { ...ex, id: c.id, equipmentId: c.equipmentId, unit: c.unit, loadConvention: c.loadConvention, continuesFromId: ex.id };
    delete row.equipmentVersion;
    const sorted = [...state.exercises].sort((a, b) => a.order - b.order);
    const at = sorted.findIndex((e) => e.id === ex.id);
    sorted.splice(at + 1, 0, row);
    exercises = sorted.map((e, i) => (e.order === i ? e : { ...e, order: i }));
    rowId = row.id;
    planned = { ...c.planned, addedInWorkout: true };
    index = 0;
    sets = state.sets;
  }
  const added: WorkoutSet = {
    id: cmd.newSetId,
    sessionId: state.session.id,
    sessionExerciseId: rowId,
    index,
    setType: template.setType,
    status: 'pending',
    // A new unilateral set starts as "both sides"; it can be logged per side.
    side: template.side === null ? null : 'both',
    pairedWithSetId: null,
    planned,
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
  const events: SessionEvent[] = [{ type: 'SetAdded', setId: added.id, sessionExerciseId: rowId }];
  const activeSetId = activateIfIdle(state, added.id, events);
  return { ok: true, state: bumpVersion({ ...state, exercises, sets: [...sets, added] }, activeSetId), events };
}

/** A target copied to a new set: without another set's coach or edit Undo record. */
function withoutEditRecords(planned: WorkoutSet['planned']): WorkoutSet['planned'] {
  if (planned.edit === undefined && planned.coach === undefined) return planned;
  const copy = { ...planned };
  delete copy.edit;
  delete copy.coach;
  return copy;
}

const NO_TARGET_TYPES: ReadonlySet<WorkoutSet['setType']> = new Set(['warmup', 'drop']);

/**
 * `edit_planned_set` (14 Oct, "I should be able to edit anything on the
 * sets"): Ben's own target, type and rest for a set not done yet. A logged
 * set is corrected instead (rule 2). Versioned on the set (rule 5); the load
 * must be one the set's equipment can make (rule 4). Everything replaced is
 * kept on the set for Undo.
 */
function handleEditPlannedSet(state: SessionAggregate, cmd: CommandOf<'edit_planned_set'>): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', set.status === 'completed' ? 'This set is logged: correct it instead.' : 'This set was skipped.');
  if (set.version !== cmd.expectedSetVersion) return fail('stale_version', 'This set changed since it was shown.');
  const ex = exerciseOf(state, set);
  if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
  if (isWorkLive(state, [set.id])) return fail('work_interval_running', 'Stop the work timer before editing this set.');
  const p = cmd.patch;
  if (p.reps != null && ex.measurement !== 'reps') return fail('invalid_values', `${ex.exerciseName} isn’t counted in reps.`);
  if (p.durationS != null && ex.measurement !== 'duration' && ex.measurement !== 'cardio') return fail('invalid_values', `${ex.exerciseName} isn’t timed.`);
  if (p.distanceM != null && ex.measurement !== 'distance' && ex.measurement !== 'cardio') return fail('invalid_values', `${ex.exerciseName} has no distance.`);
  if (p.load != null) {
    if (p.load.convention !== ex.loadConvention) return fail('convention_mismatch', `Load convention ${p.load.convention} does not match ${ex.loadConvention}.`);
    if (p.load.unit !== ex.unit) return fail('unit_mismatch', `Load unit ${p.load.unit} does not match ${ex.unit}; convert explicitly first.`);
    const eq = nothingAdded(p.load, state, ex) ? undefined : checkEquipmentOf(state, ex);
    if (eq && !isLoadAchievable(p.load, eq)) return fail('invalid_values', `${eq.name} can’t make that load.`);
  }
  const setType = p.setType ?? set.setType;
  const noTarget = NO_TARGET_TYPES.has(setType);
  if (p.targetRpe != null && noTarget) return fail('invalid_values', 'Warm-up and drop sets have no target effort.');

  const valuesTouched = p.load !== undefined || p.reps !== undefined || p.durationS !== undefined || p.distanceM !== undefined;
  let planned: WorkoutSet['planned'] = { ...set.planned };
  delete planned.edit;
  if (valuesTouched) {
    // Ben's own target now: the coach's or the rule's marker, its fit note and its `Why?` no longer describe it.
    delete planned.coach;
    delete planned.source;
    delete planned.provenance;
    delete planned.snap;
    if (p.load !== undefined) planned.load = p.load;
    if (p.reps !== undefined) planned.reps = p.reps;
    if (p.durationS !== undefined) planned.durationS = p.durationS;
    if (p.distanceM !== undefined) planned.distanceM = p.distanceM;
  }
  if (noTarget) planned = withRpeOverride(planned, undefined);
  else if (p.targetRpe !== undefined) planned = withRpeOverride(planned, p.targetRpe ?? undefined);
  const rest = p.restS === undefined ? set.rest : { seconds: p.restS, source: 'set_override' as const, sourceLabel: 'This set' };

  // An earlier edit's record stays in `before`, so undoing this one gives that one its Undo back (review S5).
  const beforePlanned = { ...set.planned };
  const version = set.version + 1;
  const edited: WorkoutSet = {
    ...set,
    setType,
    rest,
    // The unsaved draft held the old target; the new one prefills Log.
    draft: valuesTouched ? null : set.draft,
    planned: { ...planned, edit: { opId: cmd.opId, version, before: { planned: beforePlanned, setType: set.setType, rest: set.rest, draft: set.draft } } },
    version,
  };
  if (stableStringify([edited.planned.load, edited.planned.reps, edited.planned.durationS, edited.planned.distanceM, edited.planned.rpeOverride, edited.setType, edited.rest.seconds]) === stableStringify([set.planned.load, set.planned.reps, set.planned.durationS, set.planned.distanceM, set.planned.rpeOverride, set.setType, set.rest.seconds])) {
    return { ok: true, state, events: [] };
  }
  const events: SessionEvent[] = [{ type: 'PlannedSetEdited', setId: set.id, undo: false }];
  if (p.restS !== undefined) events.push({ type: 'RestPlanChanged', setIds: [set.id], seconds: p.restS });
  return { ok: true, state: bumpVersion({ ...state, sets: replaceSet(state.sets, edited) }), events };
}

function handleAddExercise(state: SessionAggregate, cmd: CommandOf<'add_exercise'>): Handled {
  if (state.exercises.some((e) => e.id === cmd.newSessionExerciseId) || state.sets.some((s) => s.id === cmd.newSetId)) {
    return fail('invalid_values', 'That exercise or set ID is already used.');
  }
  let equipment: EquipmentInstance | undefined;
  if (cmd.equipmentId !== null) {
    // Only the current gym's items (after a switch the snapshot also holds the earlier gym's).
    equipment = currentGymEquipment(state.session).find((e) => e.id === cmd.equipmentId);
    if (!equipment || equipment.availability === 'retired') {
      return fail('equipment_not_found', 'That equipment is not part of this gym.');
    }
    if (!cmd.exercise.compatibleEquipment.includes(equipment.kind)) {
      return fail('equipment_incompatible', `${cmd.exercise.name} can't be done on ${equipment.name}.`);
    }
  }
  const place = placeAddedRow(state, cmd);
  if (!place.ok) return place.handled;
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
    supersetGroup: place.group,
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
  const grouped =
    place.partnerId === null || place.group === null
      ? state.exercises
      : state.exercises.map((e) => {
          if (e.id !== place.partnerId || e.supersetGroup !== null) return e;
          const anchor: SessionExercise = { ...e, supersetGroup: place.group };
          delete anchor.roundOffset;
          return anchor;
        });
  // (19 Oct) A row paired mid-workout starts in the group's current round, not a round already done.
  if (place.group !== null) {
    const offset = joinRoundOffset(grouped.filter((e) => e.removed === undefined && e.supersetGroup === place.group), [...state.sets, ...added], ex);
    if (offset > 0) ex.roundOffset = offset;
  }
  const exercises = place.afterId === null ? [...grouped, ex] : insertRowAfter(grouped, place.afterId, ex);
  const next = { ...state, exercises, sets: [...state.sets, ...added] };
  return { ok: true, state: bumpVersion(next, activeSetId), events };
}

const GROUP_LETTERS: readonly string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Where an added row goes (12 Oct, coach `add_exercise_today`): at the end,
 * straight after a live row (after its whole superset when it has one), or
 * in a superset with a live row that still has a pending set (its group, or
 * a new letter for both), after the group's last member.
 */
function placeAddedRow(
  state: SessionAggregate,
  cmd: CommandOf<'add_exercise'>,
): { ok: true; afterId: string | null; group: string | null; partnerId: string | null } | { ok: false; handled: Handled } {
  const live = state.exercises.filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order);
  const lastOfGroup = (row: SessionExercise): string => (row.supersetGroup === null ? row.id : (live.filter((e) => e.supersetGroup === row.supersetGroup).at(-1)?.id ?? row.id));
  if (cmd.supersetWithSessionExerciseId !== undefined) {
    const partner = live.find((e) => e.id === cmd.supersetWithSessionExerciseId);
    if (!partner) return { ok: false, handled: fail('exercise_not_found', 'Exercise not found in this workout.') };
    if (!state.sets.some((s) => s.sessionExerciseId === partner.id && s.status === 'pending')) {
      return { ok: false, handled: fail('invalid_values', `${partner.exerciseName} is done, so it can't be in a superset now.`) };
    }
    if (partner.supersetGroup !== null) return { ok: true, afterId: lastOfGroup(partner), group: partner.supersetGroup, partnerId: partner.id };
    const used = new Set(state.exercises.map((e) => e.supersetGroup));
    const letter = GROUP_LETTERS.find((l) => !used.has(l));
    if (letter === undefined) return { ok: false, handled: fail('invalid_values', 'No superset letter left in this workout.') };
    return { ok: true, afterId: partner.id, group: letter, partnerId: partner.id };
  }
  if (cmd.afterSessionExerciseId !== undefined) {
    const row = live.find((e) => e.id === cmd.afterSessionExerciseId);
    if (!row) return { ok: false, handled: fail('exercise_not_found', 'Exercise not found in this workout.') };
    return { ok: true, afterId: lastOfGroup(row), group: null, partnerId: null };
  }
  return { ok: true, afterId: null, group: null, partnerId: null };
}

function handleDeleteSet(state: SessionAggregate, cmd: CommandOf<'delete_set'>): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
  if (set.version !== cmd.expectedSetVersion) return fail('stale_version', 'This set changed since it was shown.');
  if (isWorkLive(state, [set.id])) return fail('work_interval_running', 'Stop the work timer before deleting this set.');
  // A pending set's typed draft stays on the tombstone, so Undo brings it back (review gaps N6).
  const deleted: WorkoutSet = { ...set, status: 'deleted', version: set.version + 1 };
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
  // Review failure-tests M3: the confirmation is part of the command, so a caller that skips
  // `discardConfirmation` can't discard logged sets (no Undo for a discard).
  const logged = state.sets.filter((s) => s.status === 'completed').length;
  if (cmd.confirmedLoggedSets !== logged) {
    return fail(
      'discard_unconfirmed',
      `${String(logged)} logged ${logged === 1 ? 'set' : 'sets'} would be discarded, but ${String(cmd.confirmedLoggedSets)} ${cmd.confirmedLoggedSets === 1 ? 'was' : 'were'} confirmed. Review and try again.`,
    );
  }
  const events: SessionEvent[] = [];
  let restTimer = state.restTimer;
  if (isTimerLive(restTimer)) {
    restTimer = endRestTimer(restTimer, 'cancelled', nowMs);
    events.push({ type: 'RestEnded', timerId: restTimer.id, reason: 'cancelled', timerVersion: restTimer.version, lateByMs: 0 });
  }
  // Nothing to put back once the workout is over (no undo of a log after Finish or Discard).
  if (restTimer !== null) restTimer = withResumable(restTimer, []);
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
      ? { seconds: cmd.seconds, source: 'set_override' as const, sourceLabel: 'This set', byOpId: cmd.opId }
      : { seconds: cmd.seconds, source: 'exercise_default' as const, sourceLabel: `${ex.exerciseName} default (yours)`, byOpId: cmd.opId };
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
    events: [{ type: 'SessionRenamed', name }],  };
}

/** `Count it` on Progress (progress.md PG25a): only a finished workout with real times; no set or time changes. */
function handleConfirmDuration(state: SessionAggregate, cmd: CommandOf<'confirm_session_duration'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed; reload.');
  if (state.session.status !== 'finished') return fail('session_not_finished', 'Only a finished workout’s time can be counted.');
  if (state.session.localDate !== undefined) return fail('invalid_time', 'This imported workout has a date only, so there is no time to count.');
  const confirmed = state.session.durationConfirmedAt !== undefined;
  if (confirmed === cmd.confirmed) return { ok: true, state, events: [] };
  const session = { ...state.session, version: state.session.version + 1 };
  if (cmd.confirmed) session.durationConfirmedAt = cmd.at;
  else delete session.durationConfirmedAt;
  return { ok: true, state: { ...state, session }, events: [{ type: 'SessionDurationConfirmed', confirmed: cmd.confirmed }] };
}

/** Latest `Finish by` the wheel offers (now + 3 h, §2.15.3). */
const FINISH_BY_MAX_MS = 3 * 3600_000;

function handleSetFinishBy(state: SessionAggregate, cmd: CommandOf<'set_finish_by'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed since this was opened.');
  const rest = { ...state.session };
  delete rest.finishBy;
  if (cmd.finishBy === null) {
    if (state.session.finishBy === undefined) return { ok: true, state, events: [] };
    return { ok: true, state: bumpVersion({ ...state, session: rest }), events: [{ type: 'FinishByChanged', finishByUtc: null }] };
  }
  const by = toMs(cmd.finishBy.utc);
  if (by <= nowMs) return fail('invalid_time', 'That time has passed. Pick a later one.');
  if (by > nowMs + FINISH_BY_MAX_MS) return fail('invalid_time', 'Pick a time within the next 3 hours.');
  if (state.session.finishBy?.utc === cmd.finishBy.utc) return { ok: true, state, events: [] };
  return {
    ok: true,
    state: bumpVersion({ ...state, session: { ...rest, finishBy: cmd.finishBy } }),
    events: [{ type: 'FinishByChanged', finishByUtc: cmd.finishBy.utc }],
  };
}

function handleSaveDraft(state: SessionAggregate, cmd: CommandOf<'save_draft'>): Handled {
  const set = state.sets.find((s) => s.id === cmd.setId);
  if (!set) return fail('set_not_found', 'Set not found.');
  if (set.status !== 'pending') return fail('set_not_pending', 'Drafts are only for sets not yet logged.');
  // The side chosen before logging is kept on the pending set, so it survives a minimise or restart.
  if (cmd.side !== undefined) {
    const ex = exerciseOf(state, set);
    if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
    const badSide = checkSide(cmd.side, ex);
    if (badSide) return { ok: false, error: badSide };
    if (set.pairedWithSetId !== null && cmd.side !== set.side) {
      return fail('invalid_values', `This set is the ${set.side ?? 'other'} side of an earlier set. Log it as that side, or delete it.`);
    }
  }
  return { ok: true, state: { ...state, sets: replaceSet(state.sets, { ...set, draft: cmd.values, ...(cmd.side !== undefined ? { side: cmd.side } : {}) }) }, events: [] };
}

/**
 * `adjust_pending_targets` (ADR 0020 §4): the coach's validated change to
 * today's pending sets. Version-gated (rule 5); only pending sets change
 * (rule 2); the target each set had is kept in `planned.coach.before`.
 * Drafts are left alone: a set with no saved draft follows its new target,
 * and one Ben edited keeps his edit (coach-adjustments §4.3).
 */
function handleAdjustPendingTargets(state: SessionAggregate, cmd: CommandOf<'adjust_pending_targets'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'Your workout moved on.');
  const byId = new Map(state.sets.map((s) => [s.id, s]));
  const touched = [...cmd.changes.map((c) => c.setId), ...cmd.removeSetIds, ...cmd.addSets.map((a) => a.copyFromSetId)];
  for (const id of touched) {
    const set = byId.get(id);
    if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
  }
  for (const id of [...cmd.changes.map((c) => c.setId), ...cmd.removeSetIds]) {
    if (byId.get(id)?.status !== 'pending') return fail('set_not_pending', 'Only sets not done yet can change.');
  }
  if (isWorkLive(state, [...cmd.changes.map((c) => c.setId), ...cmd.removeSetIds])) return fail('work_interval_running', 'Stop the work timer first.');
  const targetsToCheck = [...cmd.changes.map((c) => ({ setId: c.setId, target: c.target })), ...cmd.addSets.map((a) => ({ setId: a.copyFromSetId, target: a.target }))];
  for (const c of targetsToCheck) {
    const set = byId.get(c.setId);
    const ex = set ? exerciseOf(state, set) : undefined;
    if (!set || !ex) return fail('exercise_not_found', 'Exercise not found in this workout.');
    const load = c.target.load;
    if (load === null) continue;
    if (load.convention !== ex.loadConvention || load.unit !== ex.unit) {
      return fail(load.unit !== ex.unit ? 'unit_mismatch' : 'convention_mismatch', `The target doesn't match ${ex.exerciseName}'s ${ex.unit} ${ex.loadConvention} load.`);
    }
    // Rule 4, as for a gym switch: the load must be makeable on the row's current item, and an
    // exercise that had equipment and has none left (or whose item is gone) can't carry one.
    if (load.convention === 'bodyweight' || nothingAdded(load, state, ex)) continue;
    const eq = checkEquipmentOf(state, ex);
    if (eq === undefined) {
      const hadEquipment = ex.equipmentId !== null || (set.planned.snap?.intendedOn?.equipmentId ?? null) !== null;
      if (hadEquipment) return fail('invalid_values', 'There’s no equipment here to check that load against.');
    } else if (!isLoadAchievable(load, eq)) {
      return fail('invalid_values', `That load can’t be made on ${eq.name}.`);
    }
  }
  if (cmd.addSets.some((a) => byId.has(a.newSetId))) return fail('invalid_values', 'That set ID is already used.');

  // `Why?` on a coach target (§2.12): set by the coach today, its reason in quotes, the same `Last time` as before.
  // The built-in rule's change (CA6 revised) says so: `Built-in rule · <day>` and its own words, never `Coach`.
  const coachProvenance = (set: WorkoutSet): TargetProvenance =>
    cmd.rule !== undefined
      ? {
          source: 'rule',
          setAt: cmd.at,
          routineName: state.session.routineName,
          requestedLoad: null,
          basis: set.planned.provenance?.basis ?? null,
          rule: cmd.rule,
          guardNotes: [],
        }
      : {
          source: 'coach',
          setAt: cmd.at,
          routineName: state.session.routineName,
          requestedLoad: null,
          basis: set.planned.provenance?.basis ?? null,
          coach: { actionId: cmd.actionId, scope: 'today', reason: cmd.reason ?? null },
          guardNotes: [],
        };
  const gymChanges = state.session.gymChanges?.length ?? 0;
  const coachTarget = (set: WorkoutSet, target: { load: WorkoutSet['planned']['load']; reps: WorkoutSet['planned']['reps']; rpe?: number | null | undefined }): WorkoutSet['planned'] => ({
    ...set.planned,
    load: target.load,
    reps: target.reps,
    // The coach's target RPE, when it gave one (Ben's own `rpeOverride` stays and still wins).
    ...(target.rpe != null ? { rpe: target.rpe } : {}),
    source: cmd.rule !== undefined ? 'built_in_rule' : 'coach',
    provenance: coachProvenance(set),
    coach: { actionId: cmd.actionId, before: set.planned, gymChanges },
  });
  const changed = new Map<string, WorkoutSet>();
  for (const c of cmd.changes) {
    const set = byId.get(c.setId);
    if (set) changed.set(set.id, { ...set, planned: coachTarget(set, c.target), version: set.version + 1 });
  }
  const audit: SessionAggregate['audit'] = [...state.audit];
  const events: SessionEvent[] = [];
  for (const id of cmd.removeSetIds) {
    const set = byId.get(id);
    if (!set) continue;
    // The removed set remembers which action removed it, so that action's Undo can put it back.
    const removed: WorkoutSet = { ...set, status: 'deleted', draft: null, planned: { ...set.planned, coach: { actionId: cmd.actionId, before: set.planned, gymChanges } }, version: set.version + 1 };
    changed.set(id, removed);
    audit.push({ id: `${cmd.opId}:deleted:${id}`, sessionId: state.session.id, setId: id, opId: cmd.opId, kind: 'deleted', atUtc: cmd.at.utc, before: snapshot(set), after: snapshot(removed) });
    events.push({ type: 'SetDeleted', setId: id });
  }
  let sets = state.sets.map((s) => changed.get(s.id) ?? s);
  let lastIndex = new Map<string, number>();
  for (const s of sets) lastIndex.set(s.sessionExerciseId, Math.max(lastIndex.get(s.sessionExerciseId) ?? -1, s.index));
  for (const a of cmd.addSets) {
    const template = byId.get(a.copyFromSetId);
    if (!template) continue;
    const index = (lastIndex.get(template.sessionExerciseId) ?? template.index) + 1;
    lastIndex = new Map(lastIndex).set(template.sessionExerciseId, index);
    const added: WorkoutSet = {
      id: a.newSetId,
      sessionId: state.session.id,
      sessionExerciseId: template.sessionExerciseId,
      index,
      setType: template.setType,
      status: 'pending',
      side: template.side === null ? null : 'both',
      pairedWithSetId: null,
      planned: coachTarget(template, a.target),
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
    sets = [...sets, added];
    events.push({ type: 'SetAdded', setId: added.id, sessionExerciseId: added.sessionExerciseId });
  }
  const setIds = [...cmd.changes.map((c) => c.setId), ...cmd.removeSetIds, ...cmd.addSets.map((a) => a.newSetId)];
  if (setIds.length === 0) return { ok: true, state, events: [] };
  events.push({ type: 'TargetsAdjusted', actionId: cmd.actionId, setIds, reverted: false });
  const activeSetId = repointActive(state, sets, events);
  return { ok: true, state: bumpVersion({ ...state, sets, audit }, activeSetId), events };
}

/**
 * `revert_target_adjustment`: Undo of one coach adjustment. Only sets that
 * still carry this action's target (pending, `planned.coach.actionId`) go
 * back; a set logged since, or changed again by a later adjustment, stays
 * as it is. Removed sets come back if still removed; added sets are removed
 * if still pending. Refused once the gym changed after the adjustment: its
 * saved targets (and removed sets' rows) were for the old gym's equipment
 * (rule 4; ADR 0020 §4.3).
 */
function handleRevertTargetAdjustment(state: SessionAggregate, cmd: CommandOf<'revert_target_adjustment'>): Handled {
  if (coachUndoRefusal(state, cmd.actionId) === 'gym_changed') return fail('gym_changed', 'The gym changed.');
  const removed = new Set(cmd.removedSetIds);
  const added = new Set(cmd.addedSetIds);
  const ownTarget = (s: WorkoutSet): boolean => carriesTodayAdjustment(s.planned, cmd.actionId);
  const changed = new Map<string, WorkoutSet>();
  const audit: SessionAggregate['audit'] = [...state.audit];
  const events: SessionEvent[] = [];
  for (const s of state.sets) {
    const before = s.planned.coach?.before;
    if (before === undefined || s.planned.coach?.actionId !== cmd.actionId) continue;
    if (added.has(s.id)) {
      if (s.status !== 'pending') continue;
      const gone: WorkoutSet = { ...s, status: 'deleted', draft: null, version: s.version + 1 };
      changed.set(s.id, gone);
      audit.push({ id: `${cmd.opId}:deleted:${s.id}`, sessionId: state.session.id, setId: s.id, opId: cmd.opId, kind: 'deleted', atUtc: cmd.at.utc, before: snapshot(s), after: snapshot(gone) });
      events.push({ type: 'SetDeleted', setId: s.id });
    } else if (removed.has(s.id)) {
      if (s.status !== 'deleted') continue;
      changed.set(s.id, { ...s, status: 'pending', planned: before, version: s.version + 1 });
    } else if (s.status === 'pending' && ownTarget(s)) {
      // Ben's own target RPE is his, not the adjustment's: Undo keeps what he set since (or cleared).
      changed.set(s.id, { ...s, planned: withRpeOverride(before, s.planned.rpeOverride), version: s.version + 1 });
    }
  }
  if (changed.size === 0) return { ok: true, state, events: [] };
  const sets = state.sets.map((s) => changed.get(s.id) ?? s);
  events.push({ type: 'TargetsAdjusted', actionId: cmd.actionId, setIds: [...changed.keys()], reverted: true });
  const activeSetId = repointActive(state, sets, events);
  return { ok: true, state: bumpVersion({ ...state, sets, audit }, activeSetId), events };
}

function handleChangeGym(state: SessionAggregate, cmd: CommandOf<'change_gym'>): Handled {
  const r = applyChangeGym(state, cmd);
  if (!r.ok) return fail(r.code, r.message);
  // Rest, the work timer, pause and the active set are never touched (§4.3 step 6).
  return { ok: true, state: r.state, events: [{ type: 'GymChanged', actionId: r.entry.actionId, fromGymId: r.entry.fromGymId, toGymId: r.entry.toGymId, changedSetIds: r.entry.changedSetIds, undo: false }] };
}

function handleUndoChangeGym(state: SessionAggregate, cmd: CommandOf<'undo_change_gym'>): Handled {
  const r = applyUndoChangeGym(state, cmd);
  if (!r.ok) return fail(r.code, r.message);
  return { ok: true, state: r.state, events: [{ type: 'GymChanged', actionId: r.entry.actionId, fromGymId: r.entry.fromGymId, toGymId: r.entry.toGymId, changedSetIds: r.entry.changedSetIds, undo: true }] };
}

// ---------------------------------------------------------------------------
// Workout gaps (backlog §4.1, 11 Oct): swap, remove, Undo of an operation, notes.

/** Rows still in the workout: not removed (an exercise added by mistake, or emptied by a swap). */
export function liveExercises<T extends Pick<SessionExercise, 'removed'>>(exercises: readonly T[]): T[] {
  return exercises.filter((e) => e.removed === undefined);
}

function auditEntry(state: SessionAggregate, cmd: { opId: string; at: ZonedTimestamp }, kind: SetAuditEntry['kind'], before: WorkoutSet, after: WorkoutSet, suffix: string): SetAuditEntry {
  return { id: `${cmd.opId}:${suffix}:${before.id}`, sessionId: state.session.id, setId: before.id, opId: cmd.opId, kind, atUtc: cmd.at.utc, before: snapshot(before), after: snapshot(after) };
}

/** Insert `row` straight after `afterId` and renumber `order` 0..n-1. */
function insertRowAfter(exercises: readonly SessionExercise[], afterId: string, row: SessionExercise): SessionExercise[] {
  const sorted = [...exercises].sort((a, b) => a.order - b.order);
  const at = sorted.findIndex((e) => e.id === afterId);
  sorted.splice(at + 1, 0, row);
  return sorted.map((e, i) => (e.order === i ? e : { ...e, order: i }));
}

/**
 * `swap_exercise` (EL4, B3): Ben's own swap applies at once. Only pending
 * sets move; done and skipped sets stay where they are (rule 2). Every new
 * target must be makeable on the new row's item (rule 4).
 */
function handleSwapExercise(state: SessionAggregate, cmd: CommandOf<'swap_exercise'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed since Swap was opened.');
  const ex = state.exercises.find((e) => e.id === cmd.sessionExerciseId);
  if (!ex || ex.removed !== undefined) return fail('exercise_not_found', 'Exercise not found in this workout.');
  // The other side of a half-logged left/right pair stays on this row (review gaps S1).
  const pending = pendingSetsOf(state, ex.id);
  if (pending.length === 0) return fail('set_not_pending', `Nothing left to swap: ${ex.exerciseName} is done.`);
  if (isWorkLive(state, pending.map((s) => s.id))) return fail('work_interval_running', 'Stop the work timer before swapping.');
  const from = cmd.sets.map((x) => x.fromSetId);
  if (from.length !== pending.length || pending.some((s, i) => from[i] !== s.id)) return fail('stale_version', 'The workout changed since Swap was opened.');
  const newIds = cmd.sets.map((x) => x.newSetId);
  if (state.exercises.some((e) => e.id === cmd.newSessionExerciseId) || new Set(newIds).size !== newIds.length || state.sets.some((s) => newIds.includes(s.id))) {
    return fail('invalid_values', 'That exercise or set ID is already used.');
  }
  let equipment: EquipmentInstance | undefined;
  if (cmd.equipmentId !== null) {
    equipment = currentGymEquipment(state.session).find((e) => e.id === cmd.equipmentId);
    if (!equipment || equipment.availability === 'retired') return fail('equipment_not_found', 'That equipment is not part of this gym.');
    if (!cmd.exercise.compatibleEquipment.includes(equipment.kind)) return fail('equipment_incompatible', `${cmd.exercise.name} can't be done on ${equipment.name}.`);
  }
  const convention = equipment?.loadConvention ?? cmd.exercise.defaultLoadConvention;
  const unit = equipment?.unit ?? cmd.unit;
  if (cmd.loadConvention !== convention || cmd.unit !== unit) return fail('convention_mismatch', `Targets on ${equipment?.name ?? cmd.exercise.name} must be in ${unit} (${convention}).`);
  for (const x of cmd.sets) {
    const l = x.planned.load;
    if (l === null) continue;
    if (l.unit !== unit || l.convention !== convention) return fail('invalid_values', `A target must be in ${unit} (${convention}); convert explicitly first.`);
    if (equipment && l.convention !== 'bodyweight' && !isLoadAchievable(l, equipment)) return fail('invalid_values', `That load can’t be made on ${equipment.name}.`);
  }
  const row: SessionExercise = {
    id: cmd.newSessionExerciseId,
    sessionId: state.session.id,
    exerciseId: cmd.exercise.exerciseId,
    exerciseName: cmd.exercise.name,
    measurement: cmd.exercise.measurement,
    laterality: cmd.exercise.laterality,
    equipmentId: equipment?.id ?? null,
    loadConvention: convention,
    unit,
    order: ex.order + 1,
    supersetGroup: ex.supersetGroup,
    transitionRestS: ex.transitionRestS,
    progressionRuleId: null,
    swappedFrom: { sessionExerciseId: ex.id, opId: cmd.opId },
  };
  const audit = [...state.audit];
  const events: SessionEvent[] = [];
  const gone = new Map<string, WorkoutSet>();
  for (const p of pending) {
    const deleted: WorkoutSet = { ...p, status: 'deleted', version: p.version + 1 }; // draft kept for Undo (N6)
    gone.set(p.id, deleted);
    audit.push(auditEntry(state, cmd, 'deleted', p, deleted, 'deleted'));
    events.push({ type: 'SetDeleted', setId: p.id });
  }
  const added: WorkoutSet[] = cmd.sets.map((x, index) => {
    const src = pending[index] ?? pending[0];
    return {
      id: x.newSetId,
      sessionId: state.session.id,
      sessionExerciseId: row.id,
      index,
      setType: src?.setType ?? 'working',
      status: 'pending',
      side: cmd.exercise.laterality === 'unilateral' ? 'both' : null,
      pairedWithSetId: null,
      // The substitute's target RPE is its own (plan, coach or rule), as for an added exercise: never Ben's override.
      planned: withRpeOverride(x.planned, undefined),
      rest: src?.rest ?? { seconds: 0, source: 'global_default', sourceLabel: '' },
      actual: null,
      draft: null,
      completedAt: null,
      completedByOpId: null,
      undoCount: 0,
      flags: [],
      edited: false,
      version: 1,
    };
  });
  const sets = [...state.sets.map((s) => gone.get(s.id) ?? s), ...added];
  // A row with nothing left on it (nothing done or skipped) leaves the workout; Undo brings it back.
  const leftOn = sets.some((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted');
  const oldRow: SessionExercise = leftOn ? ex : { ...ex, removed: { opId: cmd.opId, at: cmd.at, by: 'swap' } };
  const exercises = insertRowAfter(state.exercises.map((e) => (e.id === ex.id ? oldRow : e)), ex.id, row);
  events.push({ type: 'ExerciseAdded', sessionExerciseId: row.id }, ...added.map((a): SessionEvent => ({ type: 'SetAdded', setId: a.id, sessionExerciseId: row.id })));
  events.push({ type: 'ExerciseSwapped', fromSessionExerciseId: ex.id, toSessionExerciseId: row.id, setIds: added.map((a) => a.id) });
  // The active set moves with its slot.
  const activeAt = pending.findIndex((p) => p.id === state.session.activeSetId);
  let activeSetId = state.session.activeSetId;
  if (activeAt >= 0) {
    activeSetId = added[activeAt]?.id ?? null;
    events.push({ type: 'ActiveSetChanged', setId: activeSetId });
  }
  return { ok: true, state: bumpVersion({ ...state, exercises, sets, audit }, activeSetId), events };
}

/** `remove_exercise` (exercise-library §4.6): only while nothing on it is logged. */
function handleRemoveExercise(state: SessionAggregate, cmd: CommandOf<'remove_exercise'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed. Try again.');
  const ex = state.exercises.find((e) => e.id === cmd.sessionExerciseId);
  if (!ex || ex.removed !== undefined) return fail('exercise_not_found', 'Exercise not found in this workout.');
  if (ex.continuesFromId !== undefined || state.exercises.some((e) => e.continuesFromId === ex.id && e.removed === undefined)) {
    return fail('invalid_values', `${ex.exerciseName} has sets at another gym. Skip it instead.`);
  }
  const own = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted');
  if (own.some((s) => s.status === 'completed')) return fail('exercise_logged', `${ex.exerciseName} has a logged set. Skip it instead.`);
  if (isWorkLive(state, own.map((s) => s.id))) return fail('work_interval_running', 'Stop the work timer first.');
  const audit = [...state.audit];
  const events: SessionEvent[] = [];
  const gone = new Map<string, WorkoutSet>();
  for (const p of own) {
    const deleted: WorkoutSet = { ...p, status: 'deleted', version: p.version + 1 }; // draft kept for Undo (N6)
    gone.set(p.id, deleted);
    audit.push(auditEntry(state, cmd, 'deleted', p, deleted, 'deleted'));
    events.push({ type: 'SetDeleted', setId: p.id });
  }
  const sets = state.sets.map((s) => gone.get(s.id) ?? s);
  const exercises = state.exercises.map((e) => (e.id === ex.id ? { ...e, removed: { opId: cmd.opId, at: cmd.at, by: 'remove' as const } } : e));
  events.push({ type: 'ExerciseRemoved', sessionExerciseId: ex.id, undo: false });
  const activeSetId = repointActive(state, sets, events);
  return { ok: true, state: bumpVersion({ ...state, exercises, sets, audit }, activeSetId), events };
}

const STALE_UNDO = 'Can’t undo: it changed since.';

/**
 * Put back the sets an operation's audit entries of `kind` changed, each to
 * the status it had before, only while each is exactly as the operation
 * left it. Null when one changed since (the whole Undo is refused).
 */
function restoreAudited(state: SessionAggregate, targetOpId: string, kind: 'deleted' | 'skipped', cmd: { opId: string; at: ZonedTimestamp }, only?: ReadonlySet<string>): { sets: Map<string, WorkoutSet>; audit: SetAuditEntry[] } | null {
  const entries = state.audit.filter((e) => e.opId === targetOpId && e.kind === kind && (only === undefined || only.has(e.setId)));
  const sets = new Map<string, WorkoutSet>();
  const audit: SetAuditEntry[] = [];
  for (const e of entries) {
    const set = state.sets.find((s) => s.id === e.setId);
    if (!set || !e.before || !e.after || set.status !== e.after.status || set.version !== e.after.version) return null;
    const back: WorkoutSet = { ...set, status: e.before.status, version: set.version + 1 };
    if (kind === 'skipped') delete back.skippedBy;
    sets.set(set.id, back);
    audit.push(auditEntry(state, cmd, 'undone', set, back, 'restored'));
  }
  return sets.size === 0 ? null : { sets, audit };
}

/** After an Undo: a workout with nothing active picks up the first restored pending set. */
function activeAfterRestore(state: SessionAggregate, sets: WorkoutSet[], restored: readonly string[], events: SessionEvent[]): string | null {
  const current = state.session.activeSetId;
  if (current !== null && sets.find((s) => s.id === current)?.status === 'pending') return current;
  const order = buildExecutionOrder(state.exercises, sets);
  const first = order.find((id) => restored.includes(id) && sets.find((s) => s.id === id)?.status === 'pending') ?? null;
  const next = first ?? repointActive(state, sets, []);
  if (next !== current) events.push({ type: 'ActiveSetChanged', setId: next });
  return next;
}

/** Was the set `Edited` before this correction? Any earlier value correction says so. */
function editedBefore(state: SessionAggregate, setId: string, entryIndex: number): boolean {
  return state.audit.slice(0, entryIndex).some((e) => {
    if (e.setId !== setId || e.kind !== 'corrected' || !e.before || !e.after) return false;
    return stableStringify([e.before.actual, e.before.setType, e.before.side]) !== stableStringify([e.after.actual, e.after.setType, e.after.side]);
  });
}

/** `undo_op`: copy D4 (delete set, skip exercise, corrections), remove exercise and swap. */
function handleUndoOp(state: SessionAggregate, cmd: CommandOf<'undo_op'>, nowMs: number): Handled {
  const prior = state.processedOps[cmd.targetOpId];
  if (!prior) return fail('operation_not_found', 'Nothing to undo.');
  if (prior.commandType === 'fit_today_to_time') return undoFitToday(state, cmd, nowMs);
  const events: SessionEvent[] = [];
  switch (prior.commandType) {
    case 'delete_set':
    case 'skip_exercise': {
      const r = restoreAudited(state, cmd.targetOpId, prior.commandType === 'delete_set' ? 'deleted' : 'skipped', cmd);
      if (r === null) return fail('stale_version', STALE_UNDO);
      const sets = state.sets.map((s) => r.sets.get(s.id) ?? s);
      const ids = [...r.sets.keys()];
      events.push({ type: 'SetsRestored', opId: cmd.targetOpId, setIds: ids });
      const activeSetId = activeAfterRestore(state, sets, ids, events);
      return { ok: true, state: bumpVersion({ ...state, sets, audit: [...state.audit, ...r.audit] }, activeSetId), events };
    }
    case 'correct_set': {
      const at = state.audit.findIndex((e) => e.opId === cmd.targetOpId && e.kind === 'corrected');
      const entry = state.audit[at];
      const set = entry ? state.sets.find((s) => s.id === entry.setId) : undefined;
      if (!entry?.before || !entry.after || !set || set.status !== 'completed' || set.version !== entry.after.version || entry.before.actual === null) return fail('stale_version', STALE_UNDO);
      const ex = exerciseOf(state, set);
      if (!ex) return fail('set_not_found', 'Exercise for this set not found.');
      // Ben's target RPE, when the correction changed it (Edit set's `Target RPE`), goes back too.
      const planned = entry.before.targetRpe !== entry.after.targetRpe ? withRpeOverride(set.planned, entry.before.targetRpe) : set.planned;
      const back: WorkoutSet = withExclusions(
        { ...set, actual: entry.before.actual, planned, setType: entry.before.setType, side: entry.before.side, flags: flagsFor(entry.before.actual, state, ex), edited: editedBefore(state, set.id, at), version: set.version + 1 },
        entry.before.exclusions ?? [],
      );
      const audit = [...state.audit, auditEntry(state, cmd, 'corrected', set, back, 'corrected')];
      return { ok: true, state: bumpVersion({ ...state, sets: replaceSet(state.sets, back), audit }), events: [{ type: 'SetCorrected', setId: set.id, setVersion: back.version }] };
    }
    case 'remove_exercise': {
      const ex = state.exercises.find((e) => e.removed?.opId === cmd.targetOpId);
      if (!ex) return fail('stale_version', STALE_UNDO);
      const r = restoreAudited(state, cmd.targetOpId, 'deleted', cmd);
      const sets = r === null ? state.sets : state.sets.map((s) => r.sets.get(s.id) ?? s);
      const kept = { ...ex };
      delete kept.removed;
      const exercises = state.exercises.map((e) => (e.id === ex.id ? kept : e));
      const ids = r === null ? [] : [...r.sets.keys()];
      events.push({ type: 'ExerciseRemoved', sessionExerciseId: ex.id, undo: true }, { type: 'SetsRestored', opId: cmd.targetOpId, setIds: ids });
      const activeSetId = activeAfterRestore({ ...state, exercises }, sets, ids, events);
      return { ok: true, state: bumpVersion({ ...state, exercises, sets, audit: [...state.audit, ...(r?.audit ?? [])] }, activeSetId), events };
    }
    case 'add_exercise': {
      // 12 Oct (coach `add_exercise_today`): the added row comes out again, only while nothing on it was
      // logged or skipped (rule 2: a done set is never touched). A member left alone in its superset is ungrouped.
      const ex = state.exercises.find((e) => e.id === prior.createdIds?.[0]);
      if (!ex || ex.removed !== undefined) return fail('stale_version', STALE_UNDO);
      if (state.exercises.some((e) => e.continuesFromId === ex.id && e.removed === undefined)) return fail('stale_version', STALE_UNDO);
      const own = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted');
      if (own.some((s) => s.status !== 'pending')) return fail('stale_version', `Can’t undo: ${ex.exerciseName} has a set done.`);
      if (isWorkLive(state, own.map((s) => s.id))) return fail('work_interval_running', 'Stop the work timer first.');
      const audit = [...state.audit];
      const gone = new Map<string, WorkoutSet>();
      for (const p of own) {
        const deleted: WorkoutSet = { ...p, status: 'deleted', version: p.version + 1 };
        gone.set(p.id, deleted);
        audit.push(auditEntry(state, cmd, 'deleted', p, deleted, 'deleted'));
        events.push({ type: 'SetDeleted', setId: p.id });
      }
      const sets = state.sets.map((s) => gone.get(s.id) ?? s);
      const alone = ex.supersetGroup === null ? [] : state.exercises.filter((e) => e.id !== ex.id && e.removed === undefined && e.supersetGroup === ex.supersetGroup);
      const exercises = state.exercises.map((e) => {
        if (e.id === ex.id) {
          // Nothing brings an undone add back, so its superset letter is free again (review N3: no `B` with no `A`).
          const gone: SessionExercise = { ...e, supersetGroup: null, removed: { opId: cmd.opId, at: cmd.at, by: 'remove' as const } };
          delete gone.roundOffset;
          return gone;
        }
        if (alone.length === 1 && e.id === alone[0]?.id) return { ...e, supersetGroup: null };
        return e;
      });
      events.push({ type: 'ExerciseRemoved', sessionExerciseId: ex.id, undo: false });
      const activeSetId = repointActive(state, sets, events);
      return { ok: true, state: bumpVersion({ ...state, exercises, sets, audit }, activeSetId), events };
    }
    case 'swap_exercise': {
      const row = state.exercises.find((e) => e.swappedFrom?.opId === cmd.targetOpId);
      const original = row ? state.exercises.find((e) => e.id === row.swappedFrom?.sessionExerciseId) : undefined;
      if (!row || !original || row.removed !== undefined) return fail('stale_version', STALE_UNDO);
      // The i-th new set took the i-th old one's place. Sets logged on the new exercise stay (they're real).
      const newSets = state.sets.filter((s) => s.sessionExerciseId === row.id).sort((a, b) => a.index - b.index);
      const oldIds = state.audit.filter((e) => e.opId === cmd.targetOpId && e.kind === 'deleted').map((e) => e.setId);
      const stillPending = newSets.map((s, i) => ({ s, oldId: oldIds[i] })).filter((x) => x.s.status === 'pending' && x.oldId !== undefined);
      if (stillPending.length === 0) return fail('stale_version', `Nothing left to swap back: ${row.exerciseName} is done.`);
      if (isWorkLive(state, stillPending.map((x) => x.s.id))) return fail('work_interval_running', 'Stop the work timer first.');
      const r = restoreAudited(state, cmd.targetOpId, 'deleted', cmd, new Set(stillPending.map((x) => x.oldId ?? '')));
      if (r === null) return fail('stale_version', STALE_UNDO);
      const changed = new Map(r.sets);
      const audit = [...state.audit, ...r.audit];
      for (const { s } of stillPending) {
        const deleted: WorkoutSet = { ...s, status: 'deleted', draft: null, version: s.version + 1 };
        changed.set(s.id, deleted);
        audit.push(auditEntry(state, cmd, 'deleted', s, deleted, 'deleted'));
        events.push({ type: 'SetDeleted', setId: s.id });
      }
      const sets = state.sets.map((s) => changed.get(s.id) ?? s);
      const rowLive = sets.some((s) => s.sessionExerciseId === row.id && s.status !== 'deleted');
      const back = { ...original };
      delete back.removed;
      const exercises = state.exercises.map((e) => {
        if (e.id === original.id) return back;
        if (e.id === row.id && !rowLive) return { ...e, removed: { opId: cmd.opId, at: cmd.at, by: 'swap' as const } };
        return e;
      });
      const ids = [...r.sets.keys()];
      events.push({ type: 'ExerciseSwapped', fromSessionExerciseId: row.id, toSessionExerciseId: original.id, setIds: ids }, { type: 'SetsRestored', opId: cmd.targetOpId, setIds: ids });
      // The slot the active set was in goes back with it.
      const activeAt = stillPending.findIndex((x) => x.s.id === state.session.activeSetId);
      let activeSetId: string | null;
      if (activeAt >= 0) {
        activeSetId = stillPending[activeAt]?.oldId ?? null;
        events.push({ type: 'ActiveSetChanged', setId: activeSetId });
      } else activeSetId = activeAfterRestore({ ...state, exercises }, sets, ids, events);
      return { ok: true, state: bumpVersion({ ...state, exercises, sets, audit }, activeSetId), events };
    }
    case 'edit_planned_set': {
      // Only while the set is still pending and exactly as the edit left it (rule 5).
      const set = state.sets.find((s) => s.planned.edit?.opId === cmd.targetOpId);
      const edit = set?.planned.edit;
      if (!set || !edit || set.status !== 'pending' || set.version !== edit.version) return fail('stale_version', STALE_UNDO);
      if (isWorkLive(state, [set.id])) return fail('work_interval_running', 'Stop the work timer first.');
      // The earlier edit (if this one came straight after it) can be undone again: the set is exactly as it left it.
      const planned = { ...edit.before.planned };
      const earlier = planned.edit;
      if (earlier !== undefined) {
        if (earlier.version === edit.version - 1) planned.edit = { ...earlier, version: set.version + 1 };
        else delete planned.edit;
      }
      const back: WorkoutSet = { ...set, planned, setType: edit.before.setType, rest: edit.before.rest, draft: edit.before.draft, version: set.version + 1 };
      return { ok: true, state: bumpVersion({ ...state, sets: replaceSet(state.sets, back) }), events: [{ type: 'PlannedSetEdited', setId: set.id, undo: true }] };
    }
    case 'move_exercise':
      return undoMove(state, prior);
    case 'link_superset':
      return undoLinkSuperset(state, prior);
    case 'split_superset':
      return undoSplitSuperset(state, prior);
    case 'add_set': {
      // `Set 4 added` [Undo]: the added set goes again, only while it's still pending (a logged set is real).
      const set = state.sets.find((s) => s.id === prior.createdIds?.[0]);
      if (!set || set.status !== 'pending') return fail('stale_version', STALE_UNDO);
      if (isWorkLive(state, [set.id])) return fail('work_interval_running', 'Stop the work timer first.');
      const deleted: WorkoutSet = { ...set, status: 'deleted', version: set.version + 1 };
      const audit = [...state.audit, auditEntry(state, cmd, 'deleted', set, deleted, 'deleted')];
      events.push({ type: 'SetDeleted', setId: set.id });
      const sets = dropPendingCompanions(state, replaceSet(state.sets, deleted), set.id, cmd, audit, events);
      const activeSetId = repointActive(state, sets, events);
      return { ok: true, state: bumpVersion({ ...state, sets, audit }, activeSetId), events };
    }
    default:
      return fail('operation_not_undoable', 'That can’t be undone here.');
  }
}

/** `set_note`: Ben's own words on an exercise or a set; never a value, target or rest. */
function handleSetNote(state: SessionAggregate, cmd: CommandOf<'set_note'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed. Try again.');
  const note = cmd.note === null ? null : cmd.note.trim();
  const apply = <T extends { note?: string | undefined }>(row: T): T => {
    const next: T = { ...row };
    if (note === null || note === '') delete next.note;
    else next.note = note;
    return next;
  };
  if (cmd.target.kind === 'exercise') {
    const id = cmd.target.sessionExerciseId;
    const ex = state.exercises.find((e) => e.id === id);
    if (!ex || ex.removed !== undefined) return fail('exercise_not_found', 'Exercise not found in this workout.');
    if ((ex.note ?? null) === note) return { ok: true, state, events: [] };
    return { ok: true, state: bumpVersion({ ...state, exercises: state.exercises.map((e) => (e.id === id ? apply(e) : e)) }), events: [{ type: 'NoteChanged', target: cmd.target }] };
  }
  const id = cmd.target.setId;
  const set = state.sets.find((s) => s.id === id);
  if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
  if ((set.note ?? null) === note) return { ok: true, state, events: [] };
  // The note isn't part of the result: the set's own version (corrections, Undo) is unchanged.
  return { ok: true, state: bumpVersion({ ...state, sets: replaceSet(state.sets, apply(set)) }), events: [{ type: 'NoteChanged', target: cmd.target }] };
}

/** `planned` with Ben's target RPE set to `rpe` (undefined: none, the key removed). */
function withRpeOverride(planned: WorkoutSet['planned'], rpe: number | undefined): WorkoutSet['planned'] {
  const copy = { ...planned };
  delete copy.rpeOverride;
  return rpe === undefined ? copy : { ...copy, rpeOverride: rpe };
}

/**
 * `set_target_rpe` (CHANGELOG 2026-10-11, Ben): his own target RPE for a
 * set, an exercise or today. Pending working sets only (rule 2: a logged set
 * keeps the plan it was judged against); version-gated (rule 5).
 */
function handleSetTargetRpe(state: SessionAggregate, cmd: CommandOf<'set_target_rpe'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'Your workout moved on.');
  const takesTarget = (s: WorkoutSet): boolean => s.status === 'pending' && s.setType !== 'warmup' && s.setType !== 'drop';
  let inScope: WorkoutSet[];
  const scope = cmd.scope;
  if (scope.kind === 'set') {
    const set = state.sets.find((s) => s.id === scope.setId);
    if (!set || set.status === 'deleted') return fail('set_not_found', 'Set not found.');
    if (set.status !== 'pending') return fail('set_not_pending', 'Only sets not done yet can change.');
    if (!takesTarget(set)) return fail('invalid_values', 'Warm-up and drop sets have no target effort.');
    inScope = [set];
  } else if (scope.kind === 'exercise') {
    if (!state.exercises.some((e) => e.id === scope.sessionExerciseId)) return fail('exercise_not_found', 'Exercise not found in this workout.');
    const root = partRootOf(state.exercises, scope.sessionExerciseId);
    inScope = state.sets.filter((s) => takesTarget(s) && partRootOf(state.exercises, s.sessionExerciseId) === root);
  } else {
    inScope = state.sets.filter(takesTarget);
  }
  const want = cmd.rpe ?? undefined;
  const changed = new Map<string, WorkoutSet>();
  for (const set of inScope) {
    if (set.planned.rpeOverride === want) continue;
    changed.set(set.id, { ...set, planned: withRpeOverride(set.planned, want), version: set.version + 1 });
  }
  if (changed.size === 0) return { ok: true, state, events: [] };
  const sets = state.sets.map((s) => changed.get(s.id) ?? s);
  return { ok: true, state: bumpVersion({ ...state, sets }), events: [{ type: 'TargetRpeSet', setIds: [...changed.keys()], rpe: cmd.rpe }] };
}

/**
 * `set_load_mode` (Ben, 18 Oct): a bodyweight exercise logged with weight
 * held or worn (`added`), or back to bodyweight, for the rest of today. Only
 * sets not done yet change: a load target in the other convention is set
 * aside (`planned.otherMode`, never carried across: an added target is not a
 * bodyweight one) and put back, with its Undo records, when Ben switches
 * back while the set still has no load target (review S1). An unsaved load in
 * the other convention is cleared. Every pending set is stamped as a
 * bodyweight exercise so later checks use the gym's dumbbells and plates
 * (review B1). Logged sets keep what they were logged as (rule 2).
 * Version-gated (rule 5).
 */
function handleSetLoadMode(state: SessionAggregate, cmd: CommandOf<'set_load_mode'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed. Try again.');
  const ex = state.exercises.find((e) => e.id === cmd.sessionExerciseId);
  if (!ex || ex.removed !== undefined) return fail('exercise_not_found', 'Exercise not found in this workout.');
  if (!switchableRow(state, ex)) return fail('convention_mismatch', `${ex.exerciseName} is loaded on ${equipmentOf(state, ex)?.name ?? 'its equipment'}.`);
  if (ex.loadConvention === cmd.mode) return { ok: true, state, events: [] };
  const other = (l: Load | null | undefined): boolean => l != null && l.convention !== cmd.mode;
  const changed: string[] = [];
  const sets = state.sets.map((s) => {
    if (s.sessionExerciseId !== ex.id || s.status !== 'pending') return s;
    const version = s.version + 1;
    const current: PlannedSet = { ...s.planned };
    const stashed = current.otherMode;
    delete current.otherMode;
    let planned: PlannedSet;
    if (other(current.load)) {
      // Set aside, with its Undo records, for the way back.
      planned = { ...withoutEditRecords(current), load: null, otherMode: current };
    } else if (current.load === null && stashed !== undefined && stashed.load?.convention === cmd.mode) {
      planned = { ...stashed };
      if (planned.edit !== undefined) planned.edit = { ...planned.edit, version };
    } else {
      planned = current;
    }
    planned.bodyweightExercise = true;
    const draftOther = other(s.draft?.load);
    const draft = s.draft && draftOther ? { ...s.draft, load: null } : s.draft;
    if (planned.load !== s.planned.load || draftOther) changed.push(s.id);
    return { ...s, planned, draft, version };
  });
  const exercises = state.exercises.map((e) => (e.id === ex.id ? { ...e, loadConvention: cmd.mode } : e));
  return { ok: true, state: bumpVersion({ ...state, exercises, sets }), events: [{ type: 'LoadModeChanged', sessionExerciseId: ex.id, mode: cmd.mode, setIds: changed }] };
}

// ---------------------------------------------------------------------------
// Coach v3 (ADR 0027, 18 Oct): move a row, and the coach's edit of today as one operation.

const byOrder = (a: SessionExercise, b: SessionExercise): number => a.order - b.order;

/** Every row's ID in workout order (removed rows keep their place). */
function rowOrder(exercises: readonly SessionExercise[]): string[] {
  return [...exercises].sort(byOrder).map((e) => e.id);
}

/**
 * `move_exercise`: a live row (with its whole superset) straight after another live row (after
 * its whole superset), or first. Only a row with a set not done yet; no set changes (rule 2).
 */
function handleMoveExercise(state: SessionAggregate, cmd: CommandOf<'move_exercise'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed. Try again.');
  const live = liveExercises(state.exercises).sort(byOrder);
  const row = live.find((e) => e.id === cmd.sessionExerciseId);
  if (!row) return fail('exercise_not_found', 'Exercise not found in this workout.');
  const parted = (e: SessionExercise): boolean => e.continuesFromId !== undefined || live.some((x) => x.continuesFromId === e.id);
  const block = row.supersetGroup === null ? [row] : live.filter((e) => e.supersetGroup === row.supersetGroup);
  if (block.some(parted)) return fail('invalid_values', `${row.exerciseName} has sets at another gym.`);
  const blockIds = new Set(block.map((e) => e.id));
  if (!state.sets.some((x) => blockIds.has(x.sessionExerciseId) && x.status === 'pending')) return fail('set_not_pending', `${row.exerciseName} is done.`);
  let anchorId: string | null = null;
  if (cmd.afterSessionExerciseId !== null) {
    const after = live.find((e) => e.id === cmd.afterSessionExerciseId);
    if (!after) return fail('exercise_not_found', 'Exercise not found in this workout.');
    if (blockIds.has(after.id)) return fail('invalid_values', `${row.exerciseName} can’t go after itself.`);
    anchorId = after.supersetGroup === null ? after.id : (live.filter((e) => e.supersetGroup === after.supersetGroup).at(-1)?.id ?? after.id);
  }
  const sorted = [...state.exercises].sort(byOrder);
  const rest = sorted.filter((e) => !blockIds.has(e.id));
  const moving = sorted.filter((e) => blockIds.has(e.id));
  const firstLive = rest.findIndex((e) => e.removed === undefined);
  const at = anchorId === null ? Math.max(0, firstLive) : rest.findIndex((e) => e.id === anchorId) + 1;
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (next.every((e, i) => e.id === sorted[i]?.id)) return { ok: true, state, events: [] };
  const pos = new Map(next.map((e, i) => [e.id, i]));
  const exercises = state.exercises.map((e) => (e.order === pos.get(e.id) ? e : { ...e, order: pos.get(e.id) ?? e.order }));
  return { ok: true, state: bumpVersion({ ...state, exercises }), events: [{ type: 'ExercisesMoved', sessionExerciseIds: [...blockIds], undo: false }] };
}

/** Undo of a move: the old order back, only while the rows are still in the order the move left. */
function undoMove(state: SessionAggregate, prior: ProcessedOperation): Handled {
  const ids = prior.createdIds ?? [];
  const n = ids.length / 2;
  const before = ids.slice(0, n);
  const after = ids.slice(n);
  if (n === 0 || stableStringify(rowOrder(state.exercises)) !== stableStringify(after)) return fail('stale_version', STALE_UNDO);
  const pos = new Map(before.map((id, i) => [id, i]));
  const moved = state.exercises.filter((e) => pos.get(e.id) !== after.indexOf(e.id)).map((e) => e.id);
  const exercises = state.exercises.map((e) => ({ ...e, order: pos.get(e.id) ?? e.order }));
  return { ok: true, state: bumpVersion({ ...state, exercises }), events: [{ type: 'ExercisesMoved', sessionExerciseIds: moved, undo: true }] };
}

/** A row split across gyms (a continuation, or one with a continuation): its order follows its parts. */
function partedRow(live: readonly SessionExercise[], e: SessionExercise): boolean {
  return e.continuesFromId !== undefined || live.some((x) => x.continuesFromId === e.id);
}

/**
 * `link_superset` (Ben, 19 Oct, `Superset with…`): the two rows (or a row and the superset it joins)
 * become one superset (a new letter when neither is in one; two different supersets are refused).
 * Which row was named first never matters (review B1): the side further along (more rounds done; on
 * a tie the superset already there, else the earlier row) stays where it is, and the other side
 * moves to straight after it and sits out the rounds the leading side has done (`roundOffset`), so
 * the exercise in progress keeps going and the sets alternate from its current round.
 * Both rows need a set not done yet. No set changes (rule 2).
 */
function handleLinkSuperset(state: SessionAggregate, cmd: CommandOf<'link_superset'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed. Try again.');
  const live = liveExercises(state.exercises).sort(byOrder);
  const a = live.find((e) => e.id === cmd.sessionExerciseId);
  const b = live.find((e) => e.id === cmd.withSessionExerciseId);
  if (!a || !b) return fail('exercise_not_found', 'Exercise not found in this workout.');
  if (a.id === b.id) return fail('invalid_values', 'Pick another exercise.');
  if (a.supersetGroup !== null && a.supersetGroup === b.supersetGroup) return { ok: true, state, events: [] };
  if (a.supersetGroup !== null && b.supersetGroup !== null) return fail('invalid_values', `${a.exerciseName} is already in a superset.`);
  for (const row of [a, b]) {
    if (!state.sets.some((x) => x.sessionExerciseId === row.id && x.status === 'pending')) return fail('set_not_pending', `${row.exerciseName} is done.`);
    if (partedRow(live, row)) return fail('invalid_values', `${row.exerciseName} has sets at another gym.`);
  }
  const { lead, lag, shift } = supersetLinkSides(state.exercises, state.sets, a, b);
  if (lag.some((m) => effectiveOffset(m) + shift > MAX_ROUND_OFFSET)) return fail('invalid_values', 'Too many rounds done to pair these.');
  let group = a.supersetGroup ?? b.supersetGroup;
  if (group === null) {
    const used = new Set(state.exercises.map((e) => e.supersetGroup));
    group = GROUP_LETTERS.find((l) => !used.has(l)) ?? null;
    if (group === null) return fail('invalid_values', 'No superset letter left in this workout.');
  }
  const g = group;
  const lagIds = new Set(lag.map((m) => m.id));
  const leadIds = new Set(lead.map((m) => m.id));
  const last = lead.at(-1) ?? lead[0];
  const sorted = [...state.exercises].sort(byOrder);
  const rest = sorted.filter((e) => !lagIds.has(e.id));
  const at = rest.findIndex((e) => e.id === last?.id) + 1;
  const next = [...rest.slice(0, at), ...sorted.filter((e) => lagIds.has(e.id)), ...rest.slice(at)];
  const pos = new Map(next.map((e, i) => [e.id, i]));
  const withOffset = (e: SessionExercise, offset: number, order: number): SessionExercise => {
    const row: SessionExercise = { ...e, order, supersetGroup: g, roundOffset: offset };
    if (offset === 0) delete row.roundOffset;
    return row;
  };
  const exercises = state.exercises.map((e) => {
    const order = pos.get(e.id) ?? e.order;
    if (leadIds.has(e.id)) return withOffset(e, effectiveOffset(e), order);
    if (lagIds.has(e.id)) return withOffset(e, effectiveOffset(e) + shift, order);
    return e.order === order ? e : { ...e, order };
  });
  return { ok: true, state: bumpVersion({ ...state, exercises }), events: [{ type: 'ExercisesMoved', sessionExerciseIds: [...lagIds, ...leadIds], undo: false }] };
}

/** `split_superset` (Ben, 19 Oct, `Remove superset`): every member back to a single exercise, order kept. No set changes. */
function handleSplitSuperset(state: SessionAggregate, cmd: CommandOf<'split_superset'>): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'The workout changed. Try again.');
  const row = liveExercises(state.exercises).find((e) => e.id === cmd.sessionExerciseId);
  if (!row) return fail('exercise_not_found', 'Exercise not found in this workout.');
  if (row.supersetGroup === null) return { ok: true, state, events: [] };
  const group = row.supersetGroup;
  const members = state.exercises.filter((e) => e.supersetGroup === group).map((e) => e.id);
  const exercises = state.exercises.map((e) => (e.supersetGroup === group ? { ...e, supersetGroup: null } : e));
  return { ok: true, state: bumpVersion({ ...state, exercises }), events: [{ type: 'ExercisesMoved', sessionExerciseIds: members, undo: false }] };
}

/**
 * Undo of `link_superset`: the old order back and the rows that joined out of the group (a member left
 * on its own is ungrouped), only while the rows are still in the order the link left and still grouped.
 * Record: the order before, the order after, then the rows that had no group before.
 */
function undoLinkSuperset(state: SessionAggregate, prior: ProcessedOperation): Handled {
  const ids = prior.createdIds ?? [];
  const n = state.exercises.length;
  const before = ids.slice(0, n);
  const after = ids.slice(n, 2 * n);
  const joined = new Set(ids.slice(2 * n));
  if (n === 0 || ids.length < 2 * n || stableStringify(rowOrder(state.exercises)) !== stableStringify(after)) return fail('stale_version', STALE_UNDO);
  const rows = state.exercises.filter((e) => joined.has(e.id));
  if (rows.length === 0 || rows.some((e) => e.removed !== undefined || e.supersetGroup === null)) return fail('stale_version', STALE_UNDO);
  const group = rows[0]?.supersetGroup ?? null;
  if (rows.some((e) => e.supersetGroup !== group)) return fail('stale_version', STALE_UNDO);
  const pos = new Map(before.map((id, i) => [id, i]));
  const left = state.exercises.filter((e) => e.supersetGroup === group && e.removed === undefined && !joined.has(e.id));
  // A superset that sat out rounds to follow a row further along drops the shift the link gave it
  // (an even shift of every member changes no order, so the smallest offset goes back to 0).
  const drop = left.length > 1 ? Math.min(...left.map((e) => e.roundOffset ?? 0)) : 0;
  const exercises = state.exercises.map((e) => {
    const order = pos.get(e.id) ?? e.order;
    const ungroup = joined.has(e.id) || (left.length === 1 && left[0]?.id === e.id);
    const row: SessionExercise = { ...e, order, supersetGroup: ungroup ? null : e.supersetGroup };
    if (ungroup) delete row.roundOffset;
    else if (drop > 0 && left.some((x) => x.id === e.id)) {
      const offset = (e.roundOffset ?? 0) - drop;
      if (offset > 0) row.roundOffset = offset;
      else delete row.roundOffset;
    }
    return row;
  });
  return { ok: true, state: bumpVersion({ ...state, exercises }), events: [{ type: 'ExercisesMoved', sessionExerciseIds: [...joined], undo: true }] };
}

/** Undo of `split_superset`: the members grouped again (a free letter), only while none is in a superset or moved since. */
function undoSplitSuperset(state: SessionAggregate, prior: ProcessedOperation): Handled {
  const ids = prior.createdIds ?? [];
  const n = state.exercises.length;
  const order = ids.slice(0, n);
  const members = new Set(ids.slice(n));
  if (n === 0 || members.size < 2 || stableStringify(rowOrder(state.exercises)) !== stableStringify(order)) return fail('stale_version', STALE_UNDO);
  const rows = state.exercises.filter((e) => members.has(e.id));
  if (rows.length !== members.size || rows.some((e) => e.supersetGroup !== null)) return fail('stale_version', STALE_UNDO);
  const used = new Set(state.exercises.map((e) => e.supersetGroup));
  const letter = GROUP_LETTERS.find((l) => !used.has(l));
  if (letter === undefined) return fail('stale_version', STALE_UNDO);
  const exercises = state.exercises.map((e) => (members.has(e.id) ? { ...e, supersetGroup: letter } : e));
  return { ok: true, state: bumpVersion({ ...state, exercises }), events: [{ type: 'ExercisesMoved', sessionExerciseIds: [...members], undo: true }] };
}

/** The rows a link put in a superset that had none before. */
function linkedRows(before: SessionAggregate, after: SessionAggregate): string[] {
  return after.exercises.filter((e) => e.supersetGroup !== null && before.exercises.find((b) => b.id === e.id)?.supersetGroup === null).map((e) => e.id);
}

/** The rows a split took out of their superset. */
function splitRows(before: SessionAggregate, after: SessionAggregate): string[] {
  return before.exercises.filter((e) => e.supersetGroup !== null && after.exercises.find((x) => x.id === e.id)?.supersetGroup === null).map((e) => e.id);
}

/** The processed-operation record of a command applied from `before` to `after`. */
function processedRecord(command: SessionCommand & { opId: string }, before: SessionAggregate, after: SessionAggregate): ProcessedOperation {
  const createdIds =
    command.type === 'add_set'
      ? [command.newSetId]
      : command.type === 'add_exercise'
        ? [command.newSessionExerciseId]
        : command.type === 'move_exercise'
          ? [...rowOrder(before.exercises), ...rowOrder(after.exercises)]
          : command.type === 'link_superset'
            ? [...rowOrder(before.exercises), ...rowOrder(after.exercises), ...linkedRows(before, after)]
            : command.type === 'split_superset'
              ? [...rowOrder(after.exercises), ...splitRows(before, after)]
          : command.type === 'adjust_pending_targets' && command.addSets.length > 0
            ? command.addSets.map((a) => a.newSetId)
            : null;
  return {
    opId: command.opId,
    commandType: command.type,
    fingerprint: commandFingerprint(command),
    atUtc: command.at.utc,
    ...(createdIds === null ? {} : { createdIds }),
  };
}

/** A step of a coach edit at the version the edit has reached (its own guards still check everything else). */
function atVersion(step: CommandOf<'coach_edit_today'>['steps'][number], version: number, at: ZonedTimestamp): SessionCommand & { opId: string } {
  switch (step.type) {
    case 'adjust_pending_targets':
    case 'swap_exercise':
    case 'remove_exercise':
    case 'move_exercise':
    case 'link_superset':
    case 'split_superset':
      return { ...step, at, expectedVersion: version };
    case 'add_exercise':
    case 'skip_exercise':
      return { ...step, at };
  }
}

/** Run `commands` in order on `state`, each recorded as its own operation; the first refusal refuses all. One version bump. */
function runAll(state: SessionAggregate, commands: (s: SessionAggregate, i: number) => (SessionCommand & { opId: string }) | SessionError | null, nowMs: number): Handled {
  let s = state;
  const events: SessionEvent[] = [];
  for (let i = 0; ; i += 1) {
    const command = commands(s, i);
    if (command === null) break;
    if ('code' in command) return { ok: false, error: command };
    if (s.processedOps[command.opId] !== undefined) return fail('operation_id_reused', 'This operation ID was already used for a different action.');
    const h = dispatch(s, command, nowMs);
    if (!h.ok) return h;
    s = { ...h.state, processedOps: { ...h.state.processedOps, [command.opId]: processedRecord(command, s, h.state) } };
    events.push(...h.events);
  }
  if (s === state) return { ok: true, state, events };
  return { ok: true, state: { ...s, session: { ...s.session, version: state.session.version + 1 } }, events };
}

/** `coach_edit_today`: every step, in order, or none (rule 5: refused once the workout moved on). */
function handleCoachEditToday(state: SessionAggregate, cmd: CommandOf<'coach_edit_today'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'Your workout moved on.');
  for (const [i, step] of cmd.steps.entries()) {
    if (step.opId !== coachEditStepOpId(cmd.opId, i)) return fail('invalid_values', 'A step of the change doesn’t belong to it.');
    if (step.type === 'adjust_pending_targets' && step.actionId !== cmd.actionId) return fail('invalid_values', 'A step of the change doesn’t belong to it.');
  }
  return runAll(state, (s, i) => {
    const step = cmd.steps[i];
    return step === undefined ? null : atVersion(step, s.session.version, cmd.at);
  }, nowMs);
}

/** The steps a coach edit recorded, in order. */
function editSteps(state: SessionAggregate, opId: string): ProcessedOperation[] {
  const out: ProcessedOperation[] = [];
  for (let i = 0; ; i += 1) {
    const p = state.processedOps[coachEditStepOpId(opId, i)];
    if (p === undefined) return out;
    out.push(p);
  }
}

/**
 * `fit_today_to_time` (workout-table-v3 §5): every step, in order, or none.
 * Refused once the workout moved on since the offer (rule 5).
 */
function handleFitTodayToTime(state: SessionAggregate, cmd: CommandOf<'fit_today_to_time'>, nowMs: number): Handled {
  if (state.session.version !== cmd.expectedVersion) return fail('stale_version', 'Your workout moved on.');
  for (const [i, step] of cmd.steps.entries()) {
    if (step.opId !== coachEditStepOpId(cmd.opId, i)) return fail('invalid_values', 'A step of the change doesn’t belong to it.');
  }
  return runAll(state, (_s, i) => {
    const step = cmd.steps[i];
    return step === undefined ? null : { ...step, at: cmd.at };
  }, nowMs);
}

/**
 * Undo of a time fit: each step's own Undo, last step first, all or none.
 * A rest or RPE change on a set Ben has logged (or edited) since stays as it
 * is (rule 2); sets taken out and exercises skipped come back.
 */
function undoFitToday(state: SessionAggregate, cmd: CommandOf<'undo_op'>, nowMs: number): Handled {
  const undos = editSteps(state, cmd.targetOpId)
    .reverse()
    .filter((step) => {
      if (step.commandType !== 'edit_planned_set') return true;
      const set = state.sets.find((s) => s.planned.edit?.opId === step.opId);
      return set?.status === 'pending' && set.version === set.planned.edit?.version;
    });
  if (undos.length === 0) return fail('stale_version', STALE_UNDO);
  return runAll(state, (_s, i) => {
    const step = undos[i];
    return step === undefined ? null : { type: 'undo_op', at: cmd.at, opId: coachEditStepOpId(cmd.opId, i), targetOpId: step.opId };
  }, nowMs);
}

/** `revert_coach_edit`: each step's own Undo, last step first, all or none. */
function handleRevertCoachEdit(state: SessionAggregate, cmd: CommandOf<'revert_coach_edit'>, nowMs: number): Handled {
  const prior = state.processedOps[cmd.targetOpId];
  if (prior?.commandType !== 'coach_edit_today') return fail('operation_not_found', 'Nothing to undo.');
  const steps = editSteps(state, cmd.targetOpId).reverse();
  return runAll(state, (s, i) => {
    const step = steps[i];
    if (step === undefined) return null;
    const opId = coachEditStepOpId(cmd.opId, i);
    if (step.commandType !== 'adjust_pending_targets') return { type: 'undo_op', at: cmd.at, opId, targetOpId: step.opId };
    // The sets it removed are in its audit; the ones it added, in its record.
    const removedSetIds = s.audit.filter((e) => e.opId === step.opId && e.kind === 'deleted').map((e) => e.setId);
    return { type: 'revert_target_adjustment', at: cmd.at, opId, actionId: cmd.actionId, removedSetIds, addedSetIds: step.createdIds ?? [] };
  }, nowMs);
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
    case 'change_gym':
      return handleChangeGym(state, command);
    case 'undo_change_gym':
      return handleUndoChangeGym(state, command);
    case 'rename_session':
      return handleRenameSession(state, command);
    case 'confirm_session_duration':
      return handleConfirmDuration(state, command);
    case 'set_finish_by':
      return handleSetFinishBy(state, command, nowMs);
    case 'adjust_pending_targets':
      return handleAdjustPendingTargets(state, command);
    case 'revert_target_adjustment':
      return handleRevertTargetAdjustment(state, command);
    case 'swap_exercise':
      return handleSwapExercise(state, command);
    case 'remove_exercise':
      return handleRemoveExercise(state, command);
    case 'undo_op':
      return handleUndoOp(state, command, nowMs);
    case 'set_note':
      return handleSetNote(state, command);
    case 'set_target_rpe':
      return handleSetTargetRpe(state, command);
    case 'edit_planned_set':
      return handleEditPlannedSet(state, command);
    case 'set_load_mode':
      return handleSetLoadMode(state, command);
    case 'move_exercise':
      return handleMoveExercise(state, command);
    case 'link_superset':
      return handleLinkSuperset(state, command);
    case 'split_superset':
      return handleSplitSuperset(state, command);
    case 'coach_edit_today':
      return handleCoachEditToday(state, command, nowMs);
    case 'revert_coach_edit':
      return handleRevertCoachEdit(state, command, nowMs);
    case 'fit_today_to_time':
      return handleFitTodayToTime(state, command, nowMs);
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
    case 'change_gym': {
      // The switch was undone since.
      const entry = state.session.gymChanges?.find((c) => c.opId === command.opId && c.kind === 'change');
      return entry === undefined || (state.session.gymChanges ?? []).some((c) => c.kind === 'undo' && c.undoOf === entry.actionId);
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
    case 'adjust_pending_targets':
      // Undone, or every set it set has since been logged or changed again, or the gym changed since.
      return coachUndoRefusal(state, command.actionId) !== null || !state.sets.some((s) => s.status === 'pending' && carriesTodayAdjustment(s.planned, command.actionId));
    case 'swap_exercise':
      // Undone since: the new row was taken out again.
      return state.exercises.find((e) => e.swappedFrom?.opId === command.opId)?.removed !== undefined;
    case 'remove_exercise':
      return state.exercises.find((e) => e.id === command.sessionExerciseId)?.removed?.opId !== command.opId;
    case 'add_exercise':
      // Taken out since (its Undo, or Remove).
      return state.exercises.find((e) => e.id === command.newSessionExerciseId)?.removed !== undefined;
    case 'set_note': {
      const now = command.target.kind === 'exercise' ? state.exercises.find((e) => e.id === (command.target.kind === 'exercise' ? command.target.sessionExerciseId : ''))?.note : state.sets.find((x) => x.id === (command.target.kind === 'set' ? command.target.setId : ''))?.note;
      return (now ?? null) !== (command.note === null ? null : command.note.trim());
    }
    case 'set_target_rpe':
      // A later override (or clear) replaced this one on the set.
      return command.scope.kind === 'set' && state.sets.find((s) => s.id === (command.scope.kind === 'set' ? command.scope.setId : ''))?.planned.rpeOverride !== (command.rpe ?? undefined);
    case 'edit_planned_set':
      // A later edit or its Undo replaced it.
      return state.sets.find((s) => s.id === command.setId)?.planned.edit?.opId !== command.opId;
    case 'set_load_mode':
      // Switched back since.
      return state.exercises.find((e) => e.id === command.sessionExerciseId)?.loadConvention !== command.mode;
    case 'move_exercise': {
      // Moved again (or put back) since.
      const ids = state.processedOps[command.opId]?.createdIds ?? [];
      return stableStringify(rowOrder(state.exercises)) !== stableStringify(ids.slice(ids.length / 2));
    }
    case 'link_superset': {
      // Taken apart since (its Undo, a split, a removal).
      const g = (id: string) => state.exercises.find((e) => e.id === id && e.removed === undefined)?.supersetGroup ?? null;
      return g(command.sessionExerciseId) === null || g(command.sessionExerciseId) !== g(command.withSessionExerciseId);
    }
    case 'split_superset': {
      // Grouped again since (its Undo).
      const ids = state.processedOps[command.opId]?.createdIds ?? [];
      return ids.slice(state.exercises.length).some((id) => state.exercises.find((e) => e.id === id)?.supersetGroup !== null);
    }
    case 'coach_edit_today':
    case 'fit_today_to_time':
      // Any step no longer in place (undone, or overtaken).
      return command.steps.some((step) => isSuperseded(state, { ...step, at: command.at }));
    case 'undo_op':
    case 'revert_target_adjustment':
    case 'revert_coach_edit':
    case 'undo_change_gym':
    case 'finish':
    case 'discard':
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
    case 'confirm_session_duration':
      // A later Count it or Undo replaced this one.
      return (state.session.durationConfirmedAt !== undefined) !== command.confirmed;
    case 'set_finish_by':
      // A later Finish by (or Not set) replaced this one.
      return (state.session.finishBy?.utc ?? null) !== (command.finishBy?.utc ?? null);
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
    // Notes, and Undo of a correction, are allowed after Finish too.
    const undoesCorrection = command.type === 'undo_op' && state.processedOps[command.targetOpId]?.commandType === 'correct_set';
    const allowed =
      state.session.status === 'finished' &&
      (command.type === 'correct_set' || command.type === 'update_session_timing' || command.type === 'rename_session' || command.type === 'confirm_session_duration' || command.type === 'set_note' || undoesCorrection);
    if (!allowed) {
      const message =
        state.session.status === 'finished'
          ? 'This workout is finished.'
          : state.session.status === 'reverted'
            ? 'This workout was hidden when its import was undone.'
            : state.session.status === 'deleted'
              ? 'This workout was deleted.'
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
    const record = processedRecord(command, clocked.state, handled.state);
    next = { ...next, processedOps: { ...next.processedOps, [command.opId]: record } };
  }
  if (command.type !== 'tick') {
    next = { ...next, session: { ...next.session, lastActivityAtUtc: command.at.utc } };
  }
  return { ok: true, state: next, events, duplicate: false, superseded: false };
}
