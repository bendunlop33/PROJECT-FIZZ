import type { SessionAggregate } from '@fizz/schemas';
import { toMs } from '../time';
import { estimatePendingWork, paceSamplesOf, recentPaceSamples, resolvePace, roundTimeLeftMinutes, TIME_LEFT, type PaceSource } from './time-left';

/**
 * `about N min` for a workout not started yet (Up next, the routine sheet,
 * the Workout overview). One estimator (backlog §4.1 loose end): this is
 * `estimatePendingWork` from `time-left.ts`, the same code behind the
 * workout's `Time left` line, with no rest running and Ben's pace from his
 * recent finished workouts (else the labelled defaults). Always shown as an
 * estimate. Never uses check-ins, coach output or any readiness guess.
 */

export const PACE_DEFAULT_SET_S = TIME_LEFT.defaultSetSeconds;
export const PACE_DEFAULT_CHANGEOVER_S = TIME_LEFT.defaultChangeoverSeconds;
export const PACE_MIN_SAMPLES = TIME_LEFT.minSamplesSession;
export const PACE_MAX_GAP_MS = TIME_LEFT.maxGapMs;

export type { PaceSource };

export interface DurationEstimate {
  /** Rounded: 10 min or more to the nearest 5, under 10 to the nearest minute (at least 1). 0 when nothing is left. */
  minutes: number;
  seconds: number;
  pace: { source: PaceSource; secondsPerSet: number; changeoverSeconds: number; samples: number };
  plannedRestSeconds: number;
  pendingSets: number;
  pendingExercises: number;
}

/** `roundTimeLeftMinutes`, but never `about 0 min` while anything is left. */
export function roundEstimateMinutes(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, roundTimeLeftMinutes(seconds));
}

/** `recent`: Ben's last few finished workouts (5 in the spec); their pace is used when this one has too little. */
export function estimateRemainingDuration(state: SessionAggregate, opts: { recent?: readonly SessionAggregate[] } = {}): DurationEstimate {
  const nowMs = toMs(state.session.lastActivityAtUtc);
  const pace = resolvePace(paceSamplesOf(state, nowMs), recentPaceSamples(opts.recent ?? []));
  const work = estimatePendingWork(state, pace);
  const seconds = work?.seconds ?? 0;
  return {
    minutes: roundEstimateMinutes(seconds),
    seconds,
    pace: {
      source: pace.source === 'default' && pace.changeoverSource !== 'default' ? pace.changeoverSource : pace.source,
      secondsPerSet: pace.secondsPerSet,
      changeoverSeconds: pace.changeoverSeconds,
      samples: pace.samples,
    },
    plannedRestSeconds: work?.plannedRestSeconds ?? 0,
    pendingSets: work?.pendingSets ?? 0,
    pendingExercises: work?.pendingExercises ?? 0,
  };
}
