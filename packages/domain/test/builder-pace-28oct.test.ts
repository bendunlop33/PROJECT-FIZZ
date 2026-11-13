import { describe, expect, it } from 'vitest';
import { estimateBuilderSeconds, fitToMinutes, learnPace, makeSlot, PACE_DEFAULT, PACE_RULES, paceGaps, type BuilderWorkout, type PaceWorkout } from '../src/index';
import { context } from './builder-v3-fixture';

/**
 * (Ben, 28 Oct) The time estimate learns Ben's real pace from his own logged timestamps: seconds per set, rest overrun
 * vs the planned rest, and the changeover between exercises; blended with the defaults until 3 timed workouts, capped,
 * imports and past logs left out, outliers dropped. Used by the one estimate (`estimateBuilderSeconds`).
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28, 18, 0, 0);

/**
 * A workout as Ben logs it: `exercises` rows of `sets` each; each set takes `setS` and is followed by `rest × scale`
 * (planned `rest`); `changeS` between exercises (after the last set's rest).
 */
function logged(daysAgo: number, o: { setS: number; scale: number; changeS: number; rests?: number[]; sets?: number; exercises?: number; source?: 'manual' | 'import'; pastLog?: boolean; pauseAfterMs?: number }): PaceWorkout {
  const start = NOW - daysAgo * DAY;
  let t = start;
  const sets: PaceWorkout['sets'][number][] = [];
  const rests = o.rests ?? [120];
  for (let e = 0; e < (o.exercises ?? 3); e += 1) {
    const rest = rests[e % rests.length] ?? 120;
    for (let k = 0; k < (o.sets ?? 3); k += 1) {
      t += o.setS * 1000;
      sets.push({ rowId: `row-${String(e)}`, completedAtMs: t, restS: rest });
      if (k < (o.sets ?? 3) - 1) t += rest * o.scale * 1000;
    }
    t += (rest * o.scale + o.changeS) * 1000;
  }
  return { source: o.source ?? 'manual', pastLog: o.pastLog ?? false, startedAtMs: start, pauses: [], sets };
}

describe('learnPace', () => {
  it('no timed workouts: exactly the defaults (45 s a set, rests as planned, 60 s between)', () => {
    expect(learnPace([], NOW)).toEqual(PACE_DEFAULT);
    expect(PACE_DEFAULT).toMatchObject({ setS: 45, restScale: 1, betweenS: 60 });
  });

  it('3 timed workouts with rests of different lengths: his seconds per set, rest overrun and changeover', () => {
    const ws = [1, 3, 5].map((d) => logged(d, { setS: 55, scale: 1.2, changeS: 90, rests: [90, 180] }));
    const p = learnPace(ws, NOW);
    expect(p.workouts).toBe(3);
    expect(p.setS).toBeCloseTo(55, 0);
    expect(p.restScale).toBeCloseTo(1.2, 2);
    expect(p.betweenS).toBeCloseTo(90, -1);
  });

  it('one rest length only: seconds per set stays 45, the overrun is still learned', () => {
    const p = learnPace([1, 2, 3].map((d) => logged(d, { setS: 45, scale: 1.3, changeS: 60, rests: [120] })), NOW);
    expect(p.setS).toBe(45);
    expect(p.restScale).toBeCloseTo(1.3, 2);
  });

  it('blends with the defaults until 3 timed workouts', () => {
    const one = learnPace([logged(1, { setS: 45, scale: 1.3, changeS: 60, sets: 4, exercises: 3 })], NOW);
    // n = 1: a third of the way from 1 to 1.3.
    expect(one.restScale).toBeCloseTo(1.1, 2);
    expect(one.workouts).toBe(1);
    const two = learnPace([1, 2].map((d) => logged(d, { setS: 45, scale: 1.3, changeS: 60, sets: 4 })), NOW);
    expect(two.restScale).toBeCloseTo(1.2, 2);
  });

  it('capped: a very slow or very fast pace stays within the bounds', () => {
    const slow = learnPace([1, 2, 3].map((d) => logged(d, { setS: 45, scale: 2.5, changeS: 600, rests: [120] })), NOW);
    expect(slow.restScale).toBe(PACE_RULES.restScale.max);
    expect(slow.betweenS).toBe(PACE_RULES.betweenS.max);
    const fast = learnPace([1, 2, 3].map((d) => logged(d, { setS: 45, scale: 0.5, changeS: 5, rests: [120] })), NOW);
    expect(fast.restScale).toBe(PACE_RULES.restScale.min);
    expect(fast.betweenS).toBe(PACE_RULES.betweenS.min);
  });

  it('imports (no times) and past logs never count; workouts older than 60 days don’t either', () => {
    const own = [1, 2, 3].map((d) => logged(d, { setS: 45, scale: 1.3, changeS: 60 }));
    const noise = [logged(1, { setS: 45, scale: 2, changeS: 300, source: 'import' }), logged(2, { setS: 45, scale: 2, changeS: 300, pastLog: true }), logged(70, { setS: 45, scale: 2, changeS: 300 })];
    expect(learnPace([...own, ...noise], NOW)).toEqual(learnPace(own, NOW));
    expect(learnPace(noise, NOW)).toEqual(PACE_DEFAULT);
  });

  it('outliers are left out: sets logged in a batch (gaps under 20 s), a gap far past its rest, a 20+ minute changeover', () => {
    const w = logged(1, { setS: 45, scale: 1, changeS: 60 });
    const batch: PaceWorkout = { ...w, sets: w.sets.map((s, i) => ({ ...s, completedAtMs: w.startedAtMs + i * 5000 })) };
    expect(paceGaps(batch)).toBeNull();
    const long: PaceWorkout = { ...w, sets: [...w.sets, { rowId: 'row-2', completedAtMs: (w.sets.at(-1)?.completedAtMs ?? 0) + 30 * 60_000, restS: 120 }, { rowId: 'row-9', completedAtMs: (w.sets.at(-1)?.completedAtMs ?? 0) + 60 * 60_000, restS: 120 }] };
    const g = paceGaps(long);
    expect(g?.within.every((x) => x.gapS < 3 * x.restS + 300)).toBe(true);
    expect(g?.change.every((x) => x.gapS <= PACE_RULES.maxChangeS)).toBe(true);
  });

  it('paused time is taken out of the gaps', () => {
    const w = logged(1, { setS: 45, scale: 1, changeS: 60, sets: 2, exercises: 1 });
    const a = w.sets[0]?.completedAtMs ?? 0;
    const b = w.sets[1]?.completedAtMs ?? 0;
    const paused: PaceWorkout = { ...w, sets: [w.sets[0] ?? { rowId: 'x', completedAtMs: a, restS: 120 }, { ...(w.sets[1] ?? { rowId: 'x', restS: 120 }), completedAtMs: b + 600_000 }], pauses: [{ fromMs: a + 10_000, toMs: a + 610_000 }] };
    expect(paceGaps(paused)?.within[0]?.gapS).toBeCloseTo(paceGaps(w)?.within[0]?.gapS ?? 0, 5);
  });
});

describe('the one estimate uses Ben’s pace', () => {
  const base = context();
  const w: BuilderWorkout = {
    restLevel: 'normal',
    blocks: [
      { slots: [makeSlot('bench', { main: true, workingSets: 3 }, base)], auto: false },
      { slots: [makeSlot('incline_db', { main: false, workingSets: 3 }, base)], auto: false },
      { slots: [makeSlot('cable_fly', { main: false, workingSets: 3 }, base)], auto: false },
    ],
  };

  it('no pace: exactly as before; Ben’s slower pace makes the same workout longer, a faster one shorter', () => {
    const plain = estimateBuilderSeconds(w, base);
    expect(estimateBuilderSeconds(w, { ...base, pace: PACE_DEFAULT })).toBe(plain);
    const slow = estimateBuilderSeconds(w, { ...base, pace: { setS: 55, restScale: 1.2, betweenS: 90, workouts: 3 } });
    const fast = estimateBuilderSeconds(w, { ...base, pace: { setS: 40, restScale: 0.9, betweenS: 45, workouts: 3 } });
    expect(slow).toBeGreaterThan(plain);
    expect(fast).toBeLessThan(plain);
  });

  it('the time fit cuts to Ben’s pace: at his slower pace the same length keeps less', () => {
    const slowCtx = { ...base, pace: { setS: 55, restScale: 1.3, betweenS: 90, workouts: 3 } };
    const minutes = Math.round(estimateBuilderSeconds(w, base) / 60);
    expect(fitToMinutes(w, base, { minutes, mainGroup: 'Chest', grow: false, supersets: false }).steps).toEqual([]);
    const fitted = fitToMinutes(w, slowCtx, { minutes, mainGroup: 'Chest', grow: false, supersets: false });
    expect(fitted.steps.length).toBeGreaterThan(0);
    expect(estimateBuilderSeconds(fitted.workout, slowCtx)).toBeLessThanOrEqual(minutes * 60 + 29);
  });
});
