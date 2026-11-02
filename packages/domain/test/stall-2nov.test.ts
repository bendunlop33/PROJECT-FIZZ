import { describe, expect, it } from 'vitest';

import { isNoProgressStall, missStall, noProgressStall, STALL_RULES, stallOffer, stallsInFortnight, type StallPoint } from '../src/index';

/**
 * (Ben, 2 Nov: approved ST1–ST3, docs/training-guides/frequency-and-volume-caps.md §3) The one shared stall
 * definition: ST1 miss stall, ST2 no-progress stall, ST3 the offer.
 */

const cmp = (a: number, b: number) => a - b;
const pt = (value: number, week: string | number, over: Partial<StallPoint<number>> = {}): StallPoint<number> => ({ value, week, ...over });

describe('ST1: the miss stall', () => {
  it('two misses ≥ 7 days apart is a stall; inside 7 days waits for a third; one miss is a note', () => {
    expect(missStall([{ date: '2026-10-08' }, { date: '2026-10-01' }])).toEqual({ stalled: true, misses: 2, spanDays: 7, waitingForThird: false });
    expect(missStall([{ date: '2026-10-07' }, { date: '2026-10-01' }])).toEqual({ stalled: false, misses: 2, spanDays: 6, waitingForThird: true });
    expect(missStall([{ date: '2026-10-05' }, { date: '2026-10-03' }, { date: '2026-10-01' }]).stalled).toBe(true);
    expect(missStall([{ date: '2026-10-01' }])).toMatchObject({ stalled: false, waitingForThird: false });
    expect(missStall([])).toMatchObject({ stalled: false, misses: 0 });
  });

  it('a rule asking for 3 misses keeps its count; inside 7 days it needs a fourth', () => {
    expect(missStall([{ date: '2026-10-15' }, { date: '2026-10-08' }], 3).stalled).toBe(false);
    expect(missStall([{ date: '2026-10-15' }, { date: '2026-10-08' }, { date: '2026-10-01' }], 3).stalled).toBe(true);
    expect(missStall([{ date: '2026-10-05' }, { date: '2026-10-03' }, { date: '2026-10-01' }], 3)).toMatchObject({ stalled: false, waitingForThird: true });
  });

  it('the thresholds are the approved ones', () => {
    expect([STALL_RULES.missSessions, STALL_RULES.missMinDays, STALL_RULES.noBestSessions, STALL_RULES.noBestWeeks]).toEqual([2, 7, 3, 3]);
  });
});

describe('ST2: no new best for ≥ 3 sessions and ≥ 3 weeks', () => {
  it('weekly lift: best, then 3 weeks without one → stalled', () => {
    expect(noProgressStall([pt(100, 1), pt(100, 2), pt(100, 3)], cmp).state).toBe('too_early');
    const s = noProgressStall([pt(100, 1), pt(100, 2), pt(95, 3), pt(100, 4)], cmp);
    expect(s).toMatchObject({ state: 'stalled', bestIndex: 0, sessionsWithoutBest: 3, weeksWithoutBest: 3, run: [1, 2, 3] });
  });

  it('a lift trained twice a week needs 3 weeks, not just 3 sessions', () => {
    const twice = [pt(100, 'w1'), pt(100, 'w1'), pt(100, 'w2'), pt(100, 'w2'), pt(100, 'w3')];
    expect(noProgressStall(twice, cmp)).toMatchObject({ state: 'too_early', sessionsWithoutBest: 4, weeksWithoutBest: 2 });
    expect(noProgressStall([...twice, pt(100, 'w4')], cmp).state).toBe('stalled');
  });

  it('a lift trained every other week needs 3 sessions, not just 3 weeks', () => {
    expect(noProgressStall([pt(100, 1), pt(100, 3), pt(100, 5)], cmp).state).toBe('too_early');
    expect(noProgressStall([pt(100, 1), pt(100, 3), pt(100, 5), pt(100, 7)], cmp).state).toBe('stalled');
  });

  it('a new best resets the run', () => {
    expect(noProgressStall([pt(100, 1), pt(100, 2), pt(100, 3), pt(102.5, 4), pt(100, 5)], cmp)).toMatchObject({ state: 'too_early', bestIndex: 3, run: [4] });
    expect(noProgressStall([pt(100, 1), pt(102.5, 2)], cmp).state).toBe('progressing');
  });

  it('skipped points (deload, lead-in, return ramp, pain) neither count nor break the run', () => {
    const pts = [pt(100, 1), pt(100, 2), pt(80, 3, { skip: true }), pt(100, 4)];
    expect(noProgressStall(pts, cmp)).toMatchObject({ state: 'too_early', sessionsWithoutBest: 2 });
    expect(noProgressStall([...pts, pt(100, 5)], cmp).state).toBe('stalled');
    // A skipped point is never the first best either.
    expect(noProgressStall([pt(120, 0, { skip: true }), pt(100, 1), pt(100, 2), pt(100, 3), pt(100, 4)], cmp).bestIndex).toBe(1);
  });

  it('held at a machine max or rep cap: a ceiling, never a stall', () => {
    expect(noProgressStall([pt(100, 1), pt(100, 2), pt(100, 3), pt(100, 4, { ceiling: true })], cmp).state).toBe('ceiling');
  });

  it('a block week standing for 2 sessions counts both', () => {
    expect(noProgressStall([pt(100, 1), pt(100, 2, { sessions: 2 }), pt(100, 3)], cmp)).toMatchObject({ sessionsWithoutBest: 3, weeksWithoutBest: 2, state: 'too_early' });
  });

  it('Maintain: holding never stalls; only a drop for ≥ 3 sessions and weeks', () => {
    expect(noProgressStall([pt(100, 1), pt(100, 2), pt(100, 3), pt(100, 4)], cmp, { maintain: true }).state).toBe('progressing');
    expect(noProgressStall([pt(100, 1), pt(95, 2), pt(95, 3), pt(90, 4)], cmp, { maintain: true }).state).toBe('stalled');
    expect(noProgressStall([pt(100, 1), pt(95, 2), pt(100, 3), pt(95, 4)], cmp, { maintain: true }).state).toBe('too_early');
  });

  it('isNoProgressStall is the threshold both callers read', () => {
    expect([isNoProgressStall(3, 3), isNoProgressStall(2, 5), isNoProgressStall(5, 2)]).toEqual([true, false, false]);
  });
});

describe('ST3: one offer, never applied', () => {
  const base = { pain: false, repSchemeTried: false, otherStallsInFortnight: 0, current: 60, achievable: [40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 62.5], direction: 'resistance' as const };

  it('rep scheme first, then a 5–10% reset snapped to an achievable load', () => {
    expect(stallOffer(base)).toEqual({ kind: 'rep_scheme' });
    expect(stallOffer({ ...base, repSchemeTried: true })).toEqual({ kind: 'reset', load: 55 });
  });

  it('kg/lb and conventions: per-hand dumbbells step one rack down; an assisted machine adds assistance; never off the kit', () => {
    expect(stallOffer({ ...base, repSchemeTried: true, current: 12, achievable: [8, 10, 12, 14] })).toEqual({ kind: 'reset', load: 10 });
    expect(stallOffer({ ...base, repSchemeTried: true, current: 20, achievable: [5, 10, 15, 20, 25, 30], direction: 'assistance' })).toEqual({ kind: 'reset', load: 25 });
    expect(stallOffer({ ...base, repSchemeTried: true, current: 135, achievable: [115, 120, 125, 130, 135] })).toEqual({ kind: 'reset', load: 125 });
    // Nothing easier on the kit: no reset offer.
    expect(stallOffer({ ...base, repSchemeTried: true, current: 5, achievable: [5, 7.5] })).toBeNull();
  });

  it('2+ lifts stalled in a fortnight, or performance falling, → the deload offer instead', () => {
    expect(stallOffer({ ...base, otherStallsInFortnight: 1 })).toEqual({ kind: 'deload' });
    expect(stallOffer({ ...base, performanceFalling: true })).toEqual({ kind: 'deload' });
    expect(stallsInFortnight('2026-11-02', ['2026-10-19', '2026-10-20', '2026-11-10', '2026-11-16'])).toBe(2);
  });

  it('a pain flag: no offer at all (rule 9)', () => {
    expect(stallOffer({ ...base, pain: true })).toBeNull();
    expect(stallOffer({ ...base, pain: true, otherStallsInFortnight: 3 })).toBeNull();
  });
});
