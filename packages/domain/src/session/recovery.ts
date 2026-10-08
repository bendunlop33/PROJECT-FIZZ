import type { SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
import { toMs } from '../time';
import { reduceSession, type SessionEvent } from './reducer';

/** Unfinished sessions older than this open on Today with a Finish-or-Resume card (P6). */
export const STALE_SESSION_MS = 6 * 60 * 60 * 1000;

export type RecoveryNotice =
  | { kind: 'restored' }
  | { kind: 'stale_workout'; lastActivityAtUtc: string }
  | { kind: 'rest_ended_while_closed'; endedAtUtc: string }
  | { kind: 'work_timer_ended_while_closed'; setId: string }
  | { kind: 'unsaved_edit_restored'; setId: string };

export interface RecoveryResult {
  state: SessionAggregate;
  /** Open straight into the workout (< 6 h since last activity), else show Today. */
  openInto: 'active_workout' | 'today';
  notices: RecoveryNotice[];
  /**
   * Events from catching up with the clock. These happened while the app was
   * closed, so no spoken cue should be played for them (flow §4.2).
   */
  missedEvents: SessionEvent[];
}

/**
 * Restore an unfinished session on cold start. Pure: timers are recomputed
 * from their stored deadlines, never reset to the full preset, and nothing is
 * committed. The caller persists `state` if its revision changed.
 */
export function recoverSession(stored: SessionAggregate, at: ZonedTimestamp): RecoveryResult {
  const nowMs = toMs(at.utc);
  const ticked = reduceSession(stored, { type: 'tick', at });
  const state = ticked.ok ? ticked.state : stored;
  const missedEvents = ticked.ok ? ticked.events : [];

  const stale = nowMs - toMs(stored.session.lastActivityAtUtc) >= STALE_SESSION_MS;
  const notices: RecoveryNotice[] = [
    stale ? { kind: 'stale_workout', lastActivityAtUtc: stored.session.lastActivityAtUtc } : { kind: 'restored' },
  ];
  for (const e of missedEvents) {
    if (e.type === 'RestEnded' && e.reason === 'expired' && state.restTimer?.endedAtUtc) {
      notices.push({ kind: 'rest_ended_while_closed', endedAtUtc: state.restTimer.endedAtUtc });
    }
    if (e.type === 'WorkIntervalEnded' && e.reason === 'completed') {
      notices.push({ kind: 'work_timer_ended_while_closed', setId: e.setId });
    }
  }
  const active = state.sets.find((s) => s.id === state.session.activeSetId);
  const timerFilled = notices.some((n) => n.kind === 'work_timer_ended_while_closed' && n.setId === active?.id);
  if (active?.draft && !timerFilled) notices.push({ kind: 'unsaved_edit_restored', setId: active.id });

  return {
    state,
    openInto: state.session.status === 'active' && !stale ? 'active_workout' : 'today',
    notices,
    missedEvents,
  };
}
