import { describe, expect, it } from 'vitest';

import type { LoadConvention, SessionAggregate } from '@fizz/schemas';
import { buildLockScreenContent, lastTimeOfSet, workingOrdinal, type ComparableSet } from '../src/index';
import { kg, lb, ms, TZ, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Last time for the next set (Ben, 26 Oct 2026; lock-screen-and-alerts §2.1,
 * §2.2): the same working set of the last comparable session, as recorded.
 * Never a guess: no matching set, a warm-up, or a load in another unit or
 * convention shows nothing.
 */

const plain = (s: string) => s.replace(/\u00a0/g, ' ');

const history = (...sets: [number, number][]): ComparableSet[] => sets.map(([load, reps], index) => ({ index, values: values(kg(load), reps) }));

function benchSets(state: SessionAggregate) {
  const [warm, w1, w2] = setsFor(state, BENCH);
  if (!warm || !w1 || !w2) throw new Error('fixture: bench has a warm-up and two working sets');
  return { warm, w1, w2 };
}

/** The bench row with another load convention (per-hand dumbbells, an assisted machine). */
function withConvention(state: SessionAggregate, convention: LoadConvention): SessionAggregate {
  return { ...state, exercises: state.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, loadConvention: convention } : e)) };
}

describe('workingOrdinal / lastTimeOfSet', () => {
  const { state } = startFixture();
  const { warm, w1, w2 } = benchSets(state);

  it('numbers working sets from 0, as last time’s sets are; a warm-up has none', () => {
    expect(workingOrdinal(state, warm.id)).toBeNull();
    expect(workingOrdinal(state, w1.id)).toBe(0);
    expect(workingOrdinal(state, w2.id)).toBe(1);
  });

  it('the same working set last time, as recorded: `100 kg × 7` for the second working set', () => {
    const h = history([100, 8], [100, 7]);
    expect(plain(lastTimeOfSet(state, w1.id, h)?.text ?? '')).toBe('100 kg × 8');
    expect(plain(lastTimeOfSet(state, w2.id, h)?.text ?? '')).toBe('100 kg × 7');
  });

  it('nothing when last time had fewer sets, for a warm-up, or before history is read', () => {
    expect(lastTimeOfSet(state, w2.id, history([100, 8]))).toBeNull();
    expect(lastTimeOfSet(state, warm.id, history([100, 8], [100, 7]))).toBeNull();
    expect(lastTimeOfSet(state, w1.id, undefined)).toBeNull();
    expect(lastTimeOfSet(state, w1.id, [])).toBeNull();
    expect(lastTimeOfSet(state, 'no-such-set', history([100, 8]))).toBeNull();
  });

  it('kg/lb: history in pounds is never shown on a kilogram row (and the reverse)', () => {
    expect(lastTimeOfSet(state, w1.id, [{ index: 0, values: values(lb(225), 5) }])).toBeNull();
  });

  it('per-hand dumbbells read `each`; history logged as a total on a per-hand row is not shown', () => {
    const db = withConvention(state, 'per_hand');
    expect(plain(lastTimeOfSet(db, w1.id, [{ index: 0, values: values(kg(22.5, 'per_hand'), 10) }])?.text ?? '')).toBe('22.5 kg each × 10');
    expect(lastTimeOfSet(db, w1.id, [{ index: 0, values: values(kg(45), 10) }])).toBeNull();
  });

  it('an assisted machine reads `Assist 20 kg × 8` (assistance, not load)', () => {
    const assisted = withConvention(state, 'assistance');
    expect(plain(lastTimeOfSet(assisted, w1.id, [{ index: 0, values: values(kg(20, 'assistance'), 8) }])?.text ?? '')).toBe('Assist 20 kg × 8');
  });

  it('a flagged set keeps its words (`· spotted`), as the in-app `Last` line', () => {
    const h: ComparableSet[] = [{ index: 0, values: values(kg(100), 8), exclusions: ['spotted'] }];
    expect(plain(lastTimeOfSet(state, w1.id, h)?.text ?? '')).toBe('100 kg × 8 · spotted');
  });
});

describe('buildLockScreenContent with last time', () => {
  const { state } = startFixture();
  const { warm, w1 } = benchSets(state);
  const resting = apply(state, logCmd(warm.id, values(kg(60), 10), 30));
  const lookup = (exId: string) => (exId === w1.sessionExerciseId ? history([100, 8], [100, 7]) : undefined);

  it('Resting: `Last 100 kg × 8` under the next set’s target, read aloud after it; and the rest the buttons act on', () => {
    const c = buildLockScreenContent(resting, ms(31), TZ, { lastComparable: lookup });
    expect(c?.state).toBe('resting');
    expect(plain(c?.line2 ?? '')).toBe('Target 100 kg × 6–8');
    expect(plain(c?.line3 ?? '')).toBe('Last 100 kg × 8');
    expect(c?.a11y.endsWith('target 100 kilograms, 6 to 8 reps. Last time 100 kilograms, 8 reps.')).toBe(true);
    expect(c?.rest).toEqual({ timerId: resting.restTimer?.id, timerVersion: resting.restTimer?.version });
  });

  it('without history (not read yet, or none) the line is empty and nothing else changes', () => {
    const without = buildLockScreenContent(resting, ms(31), TZ);
    const withNone = buildLockScreenContent(resting, ms(31), TZ, { lastComparable: () => undefined });
    expect(without?.line3).toBe('');
    expect(withNone).toEqual(without);
  });

  it('Ready for a working set shows it too; Ready for a warm-up does not', () => {
    expect(buildLockScreenContent(state, ms(1), TZ, { lastComparable: lookup })?.line3).toBe('');
    const skipped = apply(resting, { type: 'skip_rest', at: { utc: new Date(ms(40)).toISOString(), tz: TZ }, opId: 'skip', timerId: resting.restTimer?.id ?? '' });
    const c = buildLockScreenContent(skipped, ms(41), TZ, { lastComparable: lookup });
    expect(c?.state).toBe('ready');
    expect(plain(c?.line3 ?? '')).toBe('Last 100 kg × 8');
    expect(c?.rest).toBeNull();
  });

  it('Paused: no buttons (the rest isn’t running), no last line', () => {
    const paused = apply(resting, { type: 'pause', at: { utc: new Date(ms(40)).toISOString(), tz: TZ }, opId: 'p' });
    const c = buildLockScreenContent(paused, ms(41), TZ, { lastComparable: lookup });
    expect(c?.state).toBe('paused');
    expect(c?.rest).toBeNull();
    expect(c?.line3).toBe('');
  });
});
