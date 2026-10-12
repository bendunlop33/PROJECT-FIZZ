import { describe, expect, it } from 'vitest';

import { buildLockScreenContent, clockText, lockScreenTargetWords, STALE_SESSION_MS, toMs } from '../src/index';
import { at, kg, ms, TZ, values } from './fixtures';
import { apply, BENCH, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * Lock Screen Live Activity content (lock-screen-and-alerts.md §2.1, §5):
 * one activity per workout, Ready / Resting / Working / Paused, from
 * committed state only, with the countdown's end instant and `Until hh:mm`.
 */

const plain = (s: string) => s.replace(/\u00a0/g, ' ');

function afterWarmup() {
  const { state } = startFixture();
  const [warm] = setsFor(state, BENCH);
  if (!warm) throw new Error('no warm-up');
  return apply(state, logCmd(warm.id, values(kg(60), 10), 30));
}

describe('buildLockScreenContent', () => {
  it('a fresh workout is Ready with the first set and its target', () => {
    const { state } = startFixture();
    const c = buildLockScreenContent(state, ms(1), TZ);
    expect(c).toMatchObject({ state: 'ready', title: 'Ready · Push A', countdown: null, staleAtMs: null, side: 'Set 1' });
    expect(plain(c?.line1 ?? '')).toBe('Bench press · Set 1 of 3');
    expect(plain(c?.line2 ?? '')).toBe('Target 60 kg × 10');
  });

  it('logging a set starts Resting: countdown to the deadline, Until hh:mm, the next set and its target', () => {
    const s = afterWarmup();
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    const c = buildLockScreenContent(s, ms(31), TZ);
    expect(c?.state).toBe('resting');
    expect(c?.title).toBe('Rest');
    expect(c?.countdown).toEqual({ startMs: toMs(s.restTimer?.startedAtUtc ?? ''), endMs: deadline });
    expect(c?.staleAtMs).toBe(deadline);
    expect(plain(c?.line1 ?? '')).toBe(`Until ${clockText(deadline, TZ)} · Bench press · Set 2 of 3 next`);
    expect(plain(c?.line2 ?? '')).toBe('Target 100 kg × 6–8');
    expect(c?.a11y).toBe(`Rest, until ${clockText(deadline, TZ)}. Next: Bench press, set 2 of 3, target 100 kilograms, 6 to 8 reps.`);
  });

  it('the Until time is the owner’s local clock time (another zone, another hour)', () => {
    const s = afterWarmup();
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    const london = buildLockScreenContent(s, ms(31), 'Europe/London');
    expect(london?.line1.startsWith(`Until ${clockText(deadline, 'Europe/London')}`)).toBe(true);
    expect(clockText(deadline, 'Europe/London')).not.toBe(clockText(deadline, TZ));
  });

  it('rest before a different exercise names it: `Until hh:mm · Next: Seated row`', () => {
    let s = afterWarmup();
    const [, w1, w2] = setsFor(s, BENCH);
    if (!w1 || !w2) throw new Error('no sets');
    s = apply(s, logCmd(w1.id, values(kg(100), 8), 200));
    s = apply(s, logCmd(w2.id, values(kg(100), 8), 400));
    const c = buildLockScreenContent(s, ms(401), TZ);
    expect(c?.state).toBe('resting');
    const row = setsFor(s, ROW)[0];
    expect(s.session.activeSetId).toBe(row?.id);
    expect(plain(c?.line1 ?? '')).toMatch(/^Until \d\d:\d\d · Next: /);
    expect(plain(c?.line2 ?? '')).toBe('Target 50 kg stack × 10–12');
  });

  it('an adjusted rest moves the countdown and the Until time', () => {
    const s = afterWarmup();
    const timerId = s.restTimer?.id ?? '';
    const before = buildLockScreenContent(s, ms(31), TZ);
    const longer = apply(s, { type: 'adjust_rest', at: at(35), opId: 'plus30', timerId, deltaS: 30 });
    const after = buildLockScreenContent(longer, ms(36), TZ);
    expect((after?.countdown?.endMs ?? 0) - (before?.countdown?.endMs ?? 0)).toBe(30_000);
    expect(after?.line1.startsWith(`Until ${clockText(after.countdown?.endMs ?? 0, TZ)}`)).toBe(true);
  });

  it('skip rest and an expired rest are Ready again (no countdown left on the Lock Screen)', () => {
    const s = afterWarmup();
    const skipped = apply(s, { type: 'skip_rest', at: at(40), opId: 'skip', timerId: s.restTimer?.id ?? '' });
    expect(buildLockScreenContent(skipped, ms(41), TZ)).toMatchObject({ state: 'ready', countdown: null, side: 'Set 2' });
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    expect(buildLockScreenContent(s, deadline + 1, TZ)).toMatchObject({ state: 'ready', countdown: null });
  });

  it('pausing during rest shows Paused with the rest left, static (no countdown)', () => {
    const s = afterWarmup();
    const paused = apply(s, { type: 'pause', at: at(50), opId: 'p1' });
    const c = buildLockScreenContent(paused, ms(55), TZ);
    expect(c).toMatchObject({ state: 'paused', title: 'Paused · Push A', countdown: null, staleAtMs: null, side: '0:40' });
    expect(c?.line1).toBe('Rest 0:40 left when you resume');
    expect(c?.a11y).toBe('Workout paused. Rest 0:40 left when you resume.');
  });

  it('paused with no rest running: `Ready for set n`', () => {
    const { state } = startFixture();
    const paused = apply(state, { type: 'pause', at: at(5), opId: 'p0' });
    expect(buildLockScreenContent(paused, ms(6), TZ)).toMatchObject({ state: 'paused', line1: 'Ready for set 1', side: '' });
  });

  it('a timed set counts down as Working with its target', () => {
    let s = startFixture().state;
    const hang = setsFor(s, HANG)[0];
    if (!hang) throw new Error('no hang');
    s = apply(s, { type: 'start_work_interval', at: at(30), opId: 'hang-go', setId: hang.id, durationS: 45 });
    const c = buildLockScreenContent(s, ms(31), TZ);
    expect(c?.state).toBe('working');
    expect(c?.countdown).toEqual({ startMs: ms(30), endMs: ms(75) });
    expect(c?.line1).toBe(`Until ${clockText(ms(75), TZ)} · Target 0:45`);
    expect(c?.title.startsWith('Work · ')).toBe(true);
  });

  it('nothing shows for no workout, a finished or discarded one, or a stale one (≥ 6 h idle)', () => {
    expect(buildLockScreenContent(null, ms(0), TZ)).toBeNull();
    const s = afterWarmup();
    const finished = apply(s, { type: 'finish', at: at(60), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    expect(buildLockScreenContent(finished, ms(61), TZ)).toBeNull();
    const discarded = apply(s, { type: 'discard', at: at(60), opId: 'disc', expectedVersion: s.session.version, confirmedLoggedSets: 1 });
    expect(buildLockScreenContent(discarded, ms(61), TZ)).toBeNull();
    expect(buildLockScreenContent(s, toMs(s.session.lastActivityAtUtc) + STALE_SESSION_MS, TZ)).toBeNull();
  });
});

describe('lockScreenTargetWords', () => {
  it('reads units in full and the word target', () => {
    expect(lockScreenTargetWords('Target 100\u00a0kg\u00a0×\u00a06–8')).toBe('target 100 kilograms, 6 to 8 reps');
    expect(lockScreenTargetWords('Coach target 95\u00a0kg\u00a0×\u00a08')).toBe('coach target 95 kilograms, 8 reps');
    expect(lockScreenTargetWords('Target 45\u00a0lb each\u00a0×\u00a010')).toBe('target 45 pounds each, 10 reps');
    expect(lockScreenTargetWords('Target 8–10\u00a0reps')).toBe('target 8 to 10 reps');
  });
});
