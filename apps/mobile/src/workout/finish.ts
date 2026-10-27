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

/**
 * (Ben, 27 Oct; redesign-27oct.md §E1) The Finish sheet's one line: `15 of 16 sets · 1 not done` (`16 of 16 sets`
 * when every set is done; `Nothing logged` before the first set). The sets not done are marked skipped by Finish.
 */
export function finishLine(m: Pick<FinishModel, 'done' | 'total' | 'willSkip' | 'nothingLogged'>): string {
  if (m.nothingLogged) return 'Nothing logged';
  const sets = `${String(m.done)} of ${String(m.total)} sets`;
  return m.willSkip > 0 ? `${sets} · ${String(m.willSkip)} not done` : sets;
}

/** Spoken: `15 of 16 sets done, 1 not done`. */
export function finishLineSpoken(m: Pick<FinishModel, 'done' | 'total' | 'willSkip' | 'nothingLogged'>): string {
  if (m.nothingLogged) return 'Nothing logged';
  const sets = `${String(m.done)} of ${String(m.total)} sets done`;
  return m.willSkip > 0 ? `${sets}, ${String(m.willSkip)} not done` : sets;
}
