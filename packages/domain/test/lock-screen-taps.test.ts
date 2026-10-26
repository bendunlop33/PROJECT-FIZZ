import { describe, expect, it } from 'vitest';

import {
  LOCK_SCREEN_TAP_MAX_AGE_MS,
  lockScreenTapBase,
  lockScreenTapCommand,
  lockScreenTapOpId,
  lockScreenTapTarget,
  parseLockScreenTap,
  reduceSession,
  toMs,
  type LockScreenTap,
} from '../src/index';
import { at, kg, ms, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Lock Screen rest buttons (Ben, 26 Oct 2026; lock-screen-and-alerts §4.2):
 * targets, parsing and the command a tap becomes. A tap is applied only to
 * the rest it was drawn for, at the same version (rule 5), with a
 * deterministic operation ID; it never logs a set.
 */

function resting() {
  const { state } = startFixture();
  const warm = setsFor(state, BENCH)[0];
  if (!warm) throw new Error('no warm-up');
  const s = apply(state, logCmd(warm.id, values(kg(60), 10), 30));
  const t = s.restTimer;
  if (!t) throw new Error('no rest');
  return { s, t, tap: (action: LockScreenTap['action'], version = t.version): LockScreenTap => ({ action, sessionId: s.session.id, timerId: t.id, timerVersion: version }) };
}

describe('lock screen tap targets', () => {
  it('round-trip: base + action → the same tap', () => {
    const { s, t } = resting();
    const base = lockScreenTapBase(s.session.id, { timerId: t.id, timerVersion: t.version });
    expect(base).toBe(`fizz.rest|${s.session.id}|${t.id}|${String(t.version)}`);
    for (const action of ['minus15', 'plus15', 'skip'] as const) {
      expect(parseLockScreenTap(lockScreenTapTarget(base, action))).toEqual({ action, sessionId: s.session.id, timerId: t.id, timerVersion: t.version });
    }
  });

  it('anything else is not ours: other widgets, malformed, unknown actions, bad versions', () => {
    for (const bad of [
      undefined,
      42,
      '',
      '__expo_widgets_target_0',
      'fizz.rest|a|b|1',
      'fizz.rest|a|b|1|log',
      'fizz.rest|a|b|0|skip',
      'fizz.rest|a|b|1.5|skip',
      'fizz.rest|a|b|-1|skip',
      'fizz.rest||b|1|skip',
      'fizz.rest|a|b|1|skip|x',
      'other|a|b|1|skip',
      `fizz.rest|${'a'.repeat(400)}|b|1|skip`,
    ]) {
      expect(parseLockScreenTap(bad)).toBeNull();
    }
  });
});

describe('lockScreenTapCommand', () => {
  it('+15 s and −15 s become `adjust_rest` with the drawn version; Skip becomes `skip_rest`; IDs are deterministic', () => {
    const { s, t, tap } = resting();
    const now = at(40);
    const plus = lockScreenTapCommand(s, tap('plus15'), now, ms(39));
    expect(plus).toEqual({ kind: 'dispatch', command: { type: 'adjust_rest', at: now, opId: `lock:plus15:${t.id}:${String(t.version)}`, timerId: t.id, deltaS: 15, expectedTimerVersion: t.version } });
    const minus = lockScreenTapCommand(s, tap('minus15'), now, ms(39));
    expect(minus.kind === 'dispatch' && minus.command.type === 'adjust_rest' ? minus.command.deltaS : null).toBe(-15);
    const skip = lockScreenTapCommand(s, tap('skip'), now, ms(39));
    expect(skip).toEqual({ kind: 'dispatch', command: { type: 'skip_rest', at: now, opId: lockScreenTapOpId(tap('skip')), timerId: t.id, expectedTimerVersion: t.version } });
    // Never a log: only rest commands come out.
    for (const d of [plus, minus, skip]) expect(d.kind === 'dispatch' ? ['adjust_rest', 'skip_rest'].includes(d.command.type) : false).toBe(true);
  });

  it('applied through the reducer, it moves the rest by 15 s and bumps its version', () => {
    const { s, t, tap } = resting();
    const d = lockScreenTapCommand(s, tap('plus15'), at(40), ms(40));
    if (d.kind !== 'dispatch') throw new Error('ignored');
    const next = expectOk(reduceSession(s, d.command)).state;
    expect(toMs(next.restTimer?.deadlineUtc ?? '')).toBe(toMs(t.deadlineUtc) + 15_000);
    expect(next.restTimer?.version).toBe(t.version + 1);
    expect(next.sets.filter((x) => x.status === 'completed')).toHaveLength(1);
  });

  it('ignored: too old, no workout, another workout, paused, another rest, an older version, an ended rest', () => {
    const { s, t, tap } = resting();
    const reason = (d: ReturnType<typeof lockScreenTapCommand>) => (d.kind === 'ignore' ? d.reason : 'dispatch');
    expect(reason(lockScreenTapCommand(s, tap('plus15'), at(100), ms(100) - LOCK_SCREEN_TAP_MAX_AGE_MS - 1))).toBe('too_old');
    expect(reason(lockScreenTapCommand(null, tap('plus15'), at(40), ms(40)))).toBe('no_workout');
    expect(reason(lockScreenTapCommand(s, { ...tap('plus15'), sessionId: 'other' }, at(40), ms(40)))).toBe('other_workout');
    const paused = apply(s, { type: 'pause', at: at(35), opId: 'p' });
    expect(reason(lockScreenTapCommand(paused, tap('plus15'), at(40), ms(40)))).toBe('paused');
    expect(reason(lockScreenTapCommand(s, { ...tap('plus15'), timerId: 'another' }, at(40), ms(40)))).toBe('not_resting');
    expect(reason(lockScreenTapCommand(s, tap('plus15', t.version + 1), at(40), ms(40)))).toBe('stale');
    expect(reason(lockScreenTapCommand(s, tap('skip'), { ...at(0), utc: t.deadlineUtc }, toMs(t.deadlineUtc)))).toBe('rest_ended');
    const skipped = apply(s, { type: 'skip_rest', at: at(35), opId: 's', timerId: t.id });
    expect(reason(lockScreenTapCommand(skipped, tap('plus15', skipped.restTimer?.version), at(40), ms(40)))).toBe('rest_ended');
  });
});

describe('reducer: expectedTimerVersion on rest commands (rule 5)', () => {
  it('an older version is refused as stale_version; the current one, or none (in-app), is applied', () => {
    const { s, t } = resting();
    expectError(reduceSession(s, { type: 'adjust_rest', at: at(40), opId: 'a1', timerId: t.id, deltaS: 15, expectedTimerVersion: t.version + 1 }), 'stale_version');
    expectError(reduceSession(s, { type: 'skip_rest', at: at(40), opId: 's1', timerId: t.id, expectedTimerVersion: t.version + 1 }), 'stale_version');
    const moved = expectOk(reduceSession(s, { type: 'adjust_rest', at: at(40), opId: 'a2', timerId: t.id, deltaS: 15, expectedTimerVersion: t.version })).state;
    // The tap drawn before that change is now stale.
    expectError(reduceSession(moved, { type: 'skip_rest', at: at(41), opId: 's2', timerId: t.id, expectedTimerVersion: t.version }), 'stale_version');
    expectOk(reduceSession(moved, { type: 'skip_rest', at: at(41), opId: 's3', timerId: t.id }));
  });
});
