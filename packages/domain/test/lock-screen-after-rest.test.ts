import { describe, expect, it } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';
import { buildLockScreenContent, clockText, toMs, type ComparableSet } from '../src/index';
import { at, kg, ms, TZ, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Rest end with GymSmarter suspended (Ben, 27 Oct 2026; lock-screen-and-alerts
 * §2.1): the Resting content carries the Ready content for the moment the rest
 * runs out, written when the rest starts, so the widget can show the next set
 * once iOS marks the activity stale (stale date = the rest's end) with no app
 * code running. It must be exactly what the app writes itself at that moment.
 */

const plain = (s: string) => s.replace(/ /g, ' ');

function afterWarmup(state = startFixture().state, load = kg(60)): SessionAggregate {
  const [warm] = setsFor(state, BENCH);
  if (!warm) throw new Error('no warm-up');
  return apply(state, logCmd(warm.id, values(load, 10), 30));
}

describe('LockScreenContent.afterRest', () => {
  it('a running rest carries the next set as Ready: title, set, target, compact side', () => {
    const s = afterWarmup();
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    const c = buildLockScreenContent(s, ms(31), TZ);
    expect(c?.state).toBe('resting');
    expect(c?.staleAtMs).toBe(deadline);
    const after = c?.afterRest;
    expect(after).not.toBeNull();
    expect(after?.title).toBe('Ready · Push A');
    expect(plain(after?.line1 ?? '')).toBe('Bench press · Set 2 of 3');
    expect(plain(after?.line2 ?? '')).toBe('Target 100 kg × 6–8');
    expect(after?.side).toBe('Set 2');
    expect(after?.a11y).toBe('Ready, Push A. Bench press · Set 2 of 3. Target 100 kilograms, 6 to 8 reps.');
  });

  it('is exactly what the app shows at the rest’s end, so the app’s own update changes nothing visible', () => {
    const s = afterWarmup();
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    const during = buildLockScreenContent(s, ms(31), TZ);
    for (const t of [deadline, deadline + 500, deadline + 60_000]) {
      const at = buildLockScreenContent(s, t, TZ);
      expect(at?.state).toBe('ready');
      expect(during?.afterRest).toEqual({ title: at?.title, line1: at?.line1, line2: at?.line2, line3: at?.line3, side: at?.side, a11y: at?.a11y });
    }
  });

  it('includes last time for the next set when history has been read', () => {
    const s = afterWarmup();
    const history: ComparableSet[] = [{ index: 0, values: values(kg(100), 7) }];
    const c = buildLockScreenContent(s, ms(31), TZ, { lastComparable: () => history });
    expect(plain(c?.afterRest?.line3 ?? '')).toBe('Last 100 kg × 7');
    expect(c?.afterRest?.a11y).toMatch(/Last time 100 kilograms, 7 reps\.$/);
  });

  it('per-hand dumbbells say `each`', () => {
    const { state } = startFixture();
    const db: SessionAggregate = {
      ...state,
      exercises: state.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, loadConvention: 'per_hand' } : e)),
      sets: state.sets.map((x) => (setsFor(state, BENCH).some((b) => b.id === x.id) && x.planned.load !== null ? { ...x, planned: { ...x.planned, load: kg(22.5, 'per_hand') } } : x)),
    };
    const s = afterWarmup(db, kg(10, 'per_hand'));
    expect(plain(buildLockScreenContent(s, ms(31), TZ)?.afterRest?.line2 ?? '')).toBe('Target 22.5 kg each × 6–8');

  });

  it('follows a rest moved by +15 s / −15 s: same next set, stale date at the new end', () => {
    const s = afterWarmup();
    const timerId = s.restTimer?.id ?? '';
    const longer = apply(s, { type: 'adjust_rest', at: at(40), opId: 'p15', timerId, deltaS: 15 });
    const c = buildLockScreenContent(longer, ms(41), TZ);
    expect(c?.staleAtMs).toBe(toMs(longer.restTimer?.deadlineUtc ?? ''));
    expect(c?.staleAtMs).toBe(toMs(s.restTimer?.deadlineUtc ?? '') + 15_000);
    expect(plain(c?.afterRest?.line1 ?? '')).toBe('Bench press · Set 2 of 3');
    expect(plain(c?.line1 ?? '')).toBe(`Until ${clockText(c?.staleAtMs ?? 0, TZ)} · Bench press · Set 2 of 3 next`);
  });

  it('only a running rest has it: Ready, Paused and a timed set have none', () => {
    const { state } = startFixture();
    expect(buildLockScreenContent(state, ms(1), TZ)?.afterRest).toBeNull();
    const s = afterWarmup();
    const paused = apply(s, { type: 'pause', at: at(40), opId: 'p' });
    expect(buildLockScreenContent(paused, ms(41), TZ)?.state).toBe('paused');
    expect(buildLockScreenContent(paused, ms(41), TZ)?.afterRest).toBeNull();
    const skipped = apply(s, { type: 'skip_rest', at: at(40), opId: 's', timerId: s.restTimer?.id ?? '' });
    expect(buildLockScreenContent(skipped, ms(41), TZ)?.afterRest).toBeNull();
  });
});
