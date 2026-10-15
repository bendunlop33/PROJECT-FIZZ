import type { ResolvedRest, RestSetting, RestTimer, SetType } from '@fizz/schemas';
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
