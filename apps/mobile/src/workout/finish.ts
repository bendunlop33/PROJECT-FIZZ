import { toMs } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

/**
 * Finish sheet model (active-workout §4.8, today.md §4). Pure.
 * - End time defaults to now, or to the last set + 3 min when the last set was
 *   more than 20 min ago (a forgotten Finish).
 * - The picker allows only times between the last logged set (or the start)
 *   and now; `finish` checks the same bounds again.
 */

const FORGOTTEN_AFTER_MS = 20 * 60 * 1000;
const PAD_MS = 3 * 60 * 1000;

export interface FinishModel {
  done: number;
  total: number;
  /** Pending sets that Finish marks skipped. */
  willSkip: number;
  nothingLogged: boolean;
  minEndMs: number;
  maxEndMs: number;
  defaultEndMs: number;
  forgotten: boolean;
  workTimerRunning: boolean;
}

export function finishModel(state: SessionAggregate, nowMs: number): FinishModel {
  const live = state.sets.filter((s) => s.status !== 'deleted');
  const done = live.filter((s) => s.status === 'completed');
  const last = Math.max(toMs(state.session.startedAt.utc), ...done.map((s) => toMs(s.completedAt?.utc ?? state.session.startedAt.utc)));
  const forgotten = done.length > 0 && nowMs - last > FORGOTTEN_AFTER_MS;
  const wi = state.workInterval;
  return {
    done: done.length,
    total: live.length,
    willSkip: live.filter((s) => s.status === 'pending').length,
    nothingLogged: done.length === 0,
    minEndMs: last,
    maxEndMs: nowMs,
    defaultEndMs: forgotten ? Math.min(nowMs, last + PAD_MS) : nowMs,
    forgotten,
    workTimerRunning: wi !== null && (wi.status === 'running' || wi.status === 'paused'),
  };
}

/** Move a time by whole minutes, kept inside [min, max]. */
export function stepTime(ms: number, minutes: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, Math.max(minMs, ms + minutes * 60_000));
}

/** The start-time bounds for `Edit workout times` before Finish: not after the first set, not in the future. */
export function startTimeBounds(state: SessionAggregate, nowMs: number): { minMs: number; maxMs: number } {
  const done = state.sets.filter((s) => s.status === 'completed' && s.completedAt).map((s) => toMs(s.completedAt?.utc ?? ''));
  const pauseStart = state.session.pause ? toMs(state.session.pause.pausedAtUtc) : Infinity;
  const maxMs = Math.min(nowMs, pauseStart, ...done);
  // Up to 12 h earlier than recorded is plenty for a forgotten Start.
  return { minMs: toMs(state.session.startedAt.utc) - 12 * 3600_000, maxMs };
}
