import { describe, expect, it } from 'vitest';
import {
  estimateBuilderMinutes,
  estimateBuilderSeconds,
  fitWorkoutToTime,
  liveTime,
  slotsOf,
  TIME_STEP_RULES,
  timeFitChanges,
  unfitWorkout,
  workingCount,
  type BuilderGroupName,
  type BuilderSlot,
  type BuilderTimeFit,
  type BuilderWorkout,
} from '../src/index';
import { makeSlot } from '../src/builder/slot';
import { context } from './builder-v3-fixture';

/**
 * (Ben, 2 Nov: "When I add or subtract time from the next up workout it jumps massively and doesn't allow me to select
 * say a 5 or 10 min workout longer") Your workout's Time `−`/`+`: every tap lands within `TIME_STEP_RULES.nearMin` (3)
 * minutes of the 5-minute step it aimed at, both ways; the next tap steps from that held length, not from an estimate
 * that overshot; a tap that would change nothing goes on to the next step that does. Sets before exercises both ways;
 * the main lift's working sets are never cut; Ben's edited slots never change.
 *
 * The harness mirrors the service and the view: the view's `liveTime` picks the step, the service fits with
 * `fitWorkoutToTime` and stores the length it fitted to (`withTimeFields`).
 */

const ctx = context();
const slot = (id: string, main = false, sets = 3, touched = false): BuilderSlot => ({ ...makeSlot(id, { main, workingSets: sets }, ctx), ...(touched ? { touched: true as const } : {}) });
const W = (ids: [string, number][]): BuilderWorkout => ({ restLevel: 'normal', blocks: ids.map(([id, n], i) => ({ slots: [slot(id, i === 0, n)], auto: false })) });
const CANDS: Partial<Record<BuilderGroupName, { mainGroup: string[]; arm: string[] }>> = {
  Chest: { mainGroup: ['machine_press', 'cable_fly', 'pec_deck', 'crossover'], arm: ['oh_ext', 'curl', 'hammer'] },
  Legs: { mainGroup: ['leg_ext', 'calf', 'hip_thrust'], arm: [] },
  Back: { mainGroup: ['lat_pulldown', 'assisted_pullup'], arm: ['curl', 'hammer'] },
};
const est = (w: BuilderWorkout) => Math.round(estimateBuilderMinutes(w, ctx));

interface Page {
  workout: BuilderWorkout;
  fit: BuilderTimeFit | null;
  /** The set-up's length (Time's, after a tap). */
  minutes: number;
  /** The length before the first Time change. */
  timeFrom?: number;
}

/** One tap as Your workout makes it: the view's step (`liveTime`), the service's fit and stored length. */
function tap(p: Page, dir: -1 | 1, g: BuilderGroupName, supersets = false, cands = CANDS[g]): { page: Page; to: number | null } {
  const from = p.timeFrom ?? p.fit?.fromMinutes ?? p.minutes;
  const full = p.fit?.fromMinutes ?? from;
  const live = liveTime({ estimate: est(p.workout), length: p.minutes, floor: Math.min(p.minutes, full), growFromEstimate: true, cutLive: p.fit !== null && p.minutes < full, filled: p.fit !== null && p.minutes > full });
  const to = dir > 0 ? live.more : live.less;
  if (to === null) return { page: p, to };
  const r = fitWorkoutToTime({ current: p.workout, fit: p.fit, minutes: from, to, ctx, mainGroup: g, supersets, step: dir, ...(cands === undefined ? {} : { addCandidates: cands }), ...(dir > 0 ? { grow: true } : {}) });
  const page: Page = { workout: r.workout, fit: r.fit, minutes: r.minutes };
  if (!(r.fit === null && r.minutes === from)) page.timeFrom = from;
  return { page, to };
}

const CASES: { name: string; w: BuilderWorkout; g: BuilderGroupName; supersets?: boolean }[] = [
  { name: 'Chest, 5 exercises (~63 min)', w: W([['bench', 4], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 3], ['crunch', 3]]), g: 'Chest' },
  { name: 'Chest, 4 exercises (~49 min)', w: W([['bench', 3], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 3]]), g: 'Chest' },
  { name: 'Chest, 4 exercises, Supersets on', w: W([['bench', 3], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 3]]), g: 'Chest', supersets: true },
  { name: 'Legs, 5 exercises (~66 min)', w: W([['squat', 4], ['rdl', 3], ['leg_press', 3], ['leg_curl', 3], ['calf', 3]]), g: 'Legs' },
  { name: 'Back, 5 exercises (~62 min)', w: W([['row', 4], ['lat_pulldown', 3], ['assisted_pullup', 3], ['curl', 3], ['crunch', 3]]), g: 'Back' },
  { name: 'Push, 3 exercises (~39 min)', w: W([['bench', 3], ['incline_db', 3], ['pushdown', 3]]), g: 'Chest' },
];

describe('Time ± lands within 3 minutes of each 5-minute step (Ben, 2 Nov)', () => {
  for (const c of CASES) {
    it(`${c.name}: up 5 taps, down to 30, up again; every tap moves and lands near its step`, () => {
      let p: Page = { workout: c.w, fit: null, minutes: est(c.w) };
      const mainSets = workingCount(slotsOf(c.w.blocks)[0] ?? { rows: [] });
      const run = (dir: -1 | 1, n: number, stop?: (m: number) => boolean) => {
        for (let i = 0; i < n && !(stop?.(est(p.workout)) ?? false); i += 1) {
          const before = est(p.workout);
          const r = tap(p, dir, c.g, c.supersets);
          expect(r.to).not.toBeNull();
          p = r.page;
          const now = est(p.workout);
          // Every tap moves the workout the way it was asked.
          if (dir > 0) expect(now).toBeGreaterThan(before);
          else expect(now).toBeLessThan(before);
          // It lands within 3 minutes of the length it fitted to (a 5-minute step).
          expect(p.minutes % 5).toBe(0);
          expect(Math.abs(now - p.minutes)).toBeLessThanOrEqual(TIME_STEP_RULES.nearMin);
          // The main lift keeps its working sets on a cut (it only grows on `+`).
          const main = slotsOf(p.workout.blocks).find((s) => s.main);
          expect(workingCount(main ?? { rows: [] })).toBeGreaterThanOrEqual(mainSets);
          for (const s of slotsOf(p.workout.blocks)) if (!s.main) expect(workingCount(s)).toBeGreaterThanOrEqual(2);
        }
      };
      run(1, 5);
      run(-1, 20, (m) => m <= 32);
      run(1, 5);
    });
  }

  it('the sample workout: 45 → 50 → 55 → 60, then 60 → 55 → 50 → 45 → 40, each within 3 minutes', () => {
    // A 45-minute Push day: bench 3, incline DB 3, cable fly 3, pushdown 2 (Ben's Time held at 45).
    const w = W([['bench', 3], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 2]]);
    expect(est(w)).toBeGreaterThanOrEqual(43);
    expect(est(w)).toBeLessThanOrEqual(47);
    let p: Page = { workout: w, fit: null, minutes: 45 };
    const lengths: number[] = [];
    const shown: number[] = [];
    for (const dir of [1, 1, 1, -1, -1, -1, -1] as const) {
      p = tap(p, dir, 'Chest').page;
      lengths.push(p.minutes);
      shown.push(est(p.workout));
    }
    expect(lengths).toEqual([50, 55, 60, 55, 50, 45, 40]);
    for (const [i, m] of shown.entries()) expect(Math.abs(m - (lengths[i] ?? 0))).toBeLessThanOrEqual(3);
  });

  it('steps from the length Ben chose, not from an estimate that overshot it', () => {
    // Landed at 57 for 55: `+` goes to 60 and `−` to 50 (from 55), not 65 or 55 again.
    expect(liveTime({ estimate: 57, length: 55, growFromEstimate: true })).toMatchObject({ minutes: 57, over: false, less: 50, more: 60 });
    expect(liveTime({ estimate: 53, length: 55, growFromEstimate: true })).toMatchObject({ less: 50, more: 60 });
    // Ben's own edit moved it well past the length: steps from the estimate, and it reads over.
    expect(liveTime({ estimate: 64, length: 55, growFromEstimate: true })).toMatchObject({ over: true, more: 65 });
    // A fill `+` made (length above the length before Time): `−` steps 5 down, not back below the original.
    expect(liveTime({ estimate: 89, length: 90, floor: 63, growFromEstimate: true, filled: true }).less).toBe(85);
  });

  it('`+` adds a set to the existing accessories before it adds an exercise; an added exercise gives back raised sets to land near', () => {
    const w = W([['bench', 4], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 3], ['crunch', 3]]);
    let p: Page = { workout: w, fit: null, minutes: est(w) };
    p = tap(p, 1, 'Chest').page;
    // One tap: one more set, no exercise.
    expect(slotsOf(p.workout.blocks)).toHaveLength(5);
    expect(slotsOf(p.workout.blocks).reduce((n, s) => n + workingCount(s), 0)).toBe(17);
    for (let i = 0; i < 3; i += 1) p = tap(p, 1, 'Chest').page;
    // Sets ran out (accessories at 4, the main lift at 5): an exercise, landing within 3 minutes of its step.
    expect(slotsOf(p.workout.blocks)).toHaveLength(6);
    expect(Math.abs(est(p.workout) - p.minutes)).toBeLessThanOrEqual(3);
    // The fit's record lists what changed against the original (the note), and Undo puts the original back.
    expect(p.fit).not.toBeNull();
    const changes = timeFitChanges(p.fit as BuilderTimeFit, p.workout);
    expect(changes.some((c) => c.kind === 'add')).toBe(true);
    const back = fitWorkoutToTime({ current: p.workout, fit: p.fit, minutes: p.timeFrom ?? 63, to: p.fit?.fromMinutes ?? 63, ctx, mainGroup: 'Chest', supersets: false });
    expect(slotsOf(back.workout.blocks).map((s) => `${s.exerciseId}×${String(workingCount(s))}`)).toEqual(slotsOf(w.blocks).map((s) => `${s.exerciseId}×${String(workingCount(s))}`));
  });

  it('`−` trims accessory sets before it leaves an exercise out (rule F still cuts an arm isolation first)', () => {
    const w = W([['bench', 4], ['incline_db', 4], ['cable_fly', 4], ['crunch', 4]]);
    const p = tap({ workout: w, fit: null, minutes: est(w) }, -1, 'Chest').page;
    expect(slotsOf(p.workout.blocks)).toHaveLength(4);
    expect(Math.abs(est(p.workout) - p.minutes)).toBeLessThanOrEqual(3);
    // What it cut comes back with the next `+` (from the original), never more than the original.
    const q = tap(p, 1, 'Chest').page;
    expect(est(q.workout)).toBeGreaterThan(est(p.workout));
    for (const s of slotsOf(q.workout.blocks)) expect(workingCount(s)).toBeLessThanOrEqual(4 + (s.main ? 1 : 0));
  });

  it('a slot Ben edited is never cut or grown by a tap', () => {
    const w: BuilderWorkout = { restLevel: 'normal', blocks: [['bench', true, 4], ['incline_db', false, 3], ['cable_fly', false, 3], ['pushdown', false, 3]].map(([id, main, n], i) => ({ slots: [slot(id as string, main as boolean, n as number, i === 1)], auto: false })) };
    let p: Page = { workout: w, fit: null, minutes: est(w) };
    for (const dir of [-1, -1, 1, 1, 1, 1] as const) {
      p = tap(p, dir, 'Chest').page;
      const mine = slotsOf(p.workout.blocks).find((s) => s.exerciseId === 'incline_db');
      expect(workingCount(mine ?? { rows: [] })).toBe(3);
    }
  });

  it('never a no-op tap: a step that would change nothing goes on to the next step that does', () => {
    // Only bench and crunch: 25 can't drop crunch to fit (crunch×2 lands 28), so `−` to 20 takes it out.
    const w = W([['bench', 4], ['crunch', 3]]);
    const p0: Page = { workout: w, fit: null, minutes: est(w) };
    const down = tap(p0, -1, 'Chest').page;
    expect(est(down.workout)).toBeLessThan(est(w));
    // And `+` from there brings it back, the nearest it can (one exercise is the smallest step), never a no-op.
    const up = tap(down, 1, 'Chest').page;
    expect(est(up.workout)).toBeGreaterThan(est(down.workout));
  });

  it('nothing smaller to add (sets at their caps from the plan): the smallest exercise, 2 sets; the plan’s sets are not taken for it', () => {
    const w = W([['bench', 5], ['incline_db', 4], ['cable_fly', 4], ['pushdown', 4]]);
    const p = tap({ workout: w, fit: null, minutes: est(w) }, 1, 'Chest').page;
    const slots = slotsOf(p.workout.blocks);
    expect(slots).toHaveLength(5);
    const added = slots.find((s) => !slotsOf(w.blocks).some((x) => x.key === s.key));
    expect(workingCount(added ?? { rows: [] })).toBe(2);
    for (const s of slotsOf(w.blocks)) expect(workingCount(slots.find((x) => x.key === s.key) ?? { rows: [] })).toBe(workingCount(s));
  });

  it('sets `+` raised are given back (4 → 3) when an exercise it adds would land past the window', () => {
    // Accessories raised to 4 and the main lift to 5 by earlier taps; the next `+` adds an exercise.
    const w = W([['bench', 4], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 3], ['crunch', 3]]);
    let p: Page = { workout: w, fit: null, minutes: est(w) };
    for (let i = 0; i < 4; i += 1) p = tap(p, 1, 'Chest').page;
    expect(slotsOf(p.workout.blocks)).toHaveLength(6);
    expect(estimateBuilderSeconds(p.workout, ctx) / 60).toBeLessThanOrEqual(p.minutes + TIME_STEP_RULES.nearMin + 0.5);
    // Never below the original's count.
    for (const s of slotsOf(w.blocks)) expect(workingCount(slotsOf(p.workout.blocks).find((x) => x.key === s.key) ?? { rows: [] })).toBeGreaterThanOrEqual(workingCount(s));
  });

  it('Undo (a length set outright, no tap) still puts the original back exactly', () => {
    const w = W([['bench', 4], ['incline_db', 3], ['cable_fly', 3], ['pushdown', 3], ['crunch', 3]]);
    let p: Page = { workout: w, fit: null, minutes: est(w) };
    for (const dir of [-1, -1, -1] as const) p = tap(p, dir, 'Chest').page;
    const from = p.timeFrom ?? est(w);
    const back = fitWorkoutToTime({ current: p.workout, fit: p.fit, minutes: from, to: from, ctx, mainGroup: 'Chest', supersets: false });
    expect(back.fit).toBeNull();
    expect(back.workout).toEqual(unfitWorkout(p.fit as BuilderTimeFit, p.workout));
  });
});
