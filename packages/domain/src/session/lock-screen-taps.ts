import type { SessionAggregate, SessionCommand, ZonedTimestamp } from '@fizz/schemas';

import { toMs } from '../time';

/**
 * Lock Screen rest buttons (Ben, 26 Oct 2026; lock-screen-and-alerts §2.1,
 * §4.2): `−15 s`, `+15 s` and `Skip` on the workout's Live Activity. Pure.
 *
 * Each button carries a target string naming the workout, the rest timer and
 * the timer version it was drawn for. A tap becomes the same `adjust_rest` /
 * `skip_rest` command the in-app buttons send, through the same write path,
 * with:
 * - a deterministic operation ID per (action, timer, version), so a tap
 *   delivered twice (event and queue, or a retry after a relaunch) is applied
 *   once (rule 5);
 * - `expectedTimerVersion`, so a tap on an older picture of the rest (the
 *   rest already moved by another tap, Log, Undo or a coach change) is
 *   refused, never applied to newer state (rule 5).
 * Nothing here logs a set: the Lock Screen's `Log` (Ben, 27 Oct) is its own
 * target and command (`lock-screen-log.ts`).
 */

export type LockScreenTapAction = 'minus15' | 'plus15' | 'skip';

export interface LockScreenTap {
  action: LockScreenTapAction;
  sessionId: string;
  timerId: string;
  timerVersion: number;
}

/** First field of every Lock Screen rest-button target. */
export const LOCK_SCREEN_TAP_PREFIX = 'fizz.rest';

/** A queued tap older than this is dropped: the rest it was for has likely moved on (cold launch takes seconds, not minutes). */
export const LOCK_SCREEN_TAP_MAX_AGE_MS = 60_000;

/** The rest change per tap, in seconds. */
export const LOCK_SCREEN_REST_STEP_S = 15;

const ACTIONS: readonly LockScreenTapAction[] = ['minus15', 'plus15', 'skip'];

/**
 * `fizz.rest|<sessionId>|<timerId>|<version>`: the widget appends `|minus15`,
 * `|plus15` or `|skip` itself (it is serialised alone and can't call helpers).
 */
export function lockScreenTapBase(sessionId: string, rest: { timerId: string; timerVersion: number }): string {
  return [LOCK_SCREEN_TAP_PREFIX, sessionId, rest.timerId, String(rest.timerVersion)].join('|');
}

export function lockScreenTapTarget(base: string, action: LockScreenTapAction): string {
  return `${base}|${action}`;
}

/** A button target back into a tap; null for anything else (another widget's button, a malformed string). */
export function parseLockScreenTap(target: unknown): LockScreenTap | null {
  if (typeof target !== 'string' || target.length > 300) return null;
  const parts = target.split('|');
  if (parts.length !== 5) return null;
  const [prefix, sessionId, timerId, version, action] = parts;
  if (prefix !== LOCK_SCREEN_TAP_PREFIX || !sessionId || !timerId || version === undefined || action === undefined) return null;
  if (!/^[1-9]\d{0,8}$/.test(version)) return null;
  if (!(ACTIONS as readonly string[]).includes(action)) return null;
  return { action: action as LockScreenTapAction, sessionId, timerId, timerVersion: Number(version) };
}

/** Deterministic per (action, timer, version): the same tap delivered twice is one write. */
export function lockScreenTapOpId(tap: LockScreenTap): string {
  return `lock:${tap.action}:${tap.timerId}:${String(tap.timerVersion)}`;
}

export type LockScreenTapIgnored = 'too_old' | 'no_workout' | 'other_workout' | 'paused' | 'not_resting' | 'rest_ended' | 'stale';

export type LockScreenTapDecision = { kind: 'dispatch'; command: SessionCommand } | { kind: 'ignore'; reason: LockScreenTapIgnored };

/**
 * What a tap does to the workout in progress at `at`. A tap is only applied
 * to the rest it was drawn for, while that rest is still running at the same
 * version; anything else is ignored (the Live Activity is then redrawn from
 * the true state by the normal reconcile). The reducer checks the version
 * again (`expectedTimerVersion`), so a change between this read and the
 * write is refused there too.
 */
export function lockScreenTapCommand(state: SessionAggregate | null, tap: LockScreenTap, at: ZonedTimestamp, tappedAtMs: number): LockScreenTapDecision {
  const nowMs = toMs(at.utc);
  if (nowMs - tappedAtMs > LOCK_SCREEN_TAP_MAX_AGE_MS) return { kind: 'ignore', reason: 'too_old' };
  if (state === null || state.session.status !== 'active') return { kind: 'ignore', reason: 'no_workout' };
  if (state.session.id !== tap.sessionId) return { kind: 'ignore', reason: 'other_workout' };
  if (state.session.pause !== null) return { kind: 'ignore', reason: 'paused' };
  const t = state.restTimer;
  if (t?.id !== tap.timerId) return { kind: 'ignore', reason: 'not_resting' };
  if (t.version !== tap.timerVersion) return { kind: 'ignore', reason: 'stale' };
  if (t.status !== 'running' || toMs(t.deadlineUtc) <= nowMs) return { kind: 'ignore', reason: 'rest_ended' };
  const opId = lockScreenTapOpId(tap);
  if (tap.action === 'skip') return { kind: 'dispatch', command: { type: 'skip_rest', at, opId, timerId: t.id, expectedTimerVersion: t.version } };
  const deltaS = tap.action === 'plus15' ? LOCK_SCREEN_REST_STEP_S : -LOCK_SCREEN_REST_STEP_S;
  return { kind: 'dispatch', command: { type: 'adjust_rest', at, opId, timerId: t.id, deltaS, expectedTimerVersion: t.version } };
}
