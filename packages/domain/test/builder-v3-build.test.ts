import { describe, expect, it } from 'vitest';
import {
  BUILDER_DAY_MIXES,
  absOff,
  applyAccessoryStyle,
  buildFromSetup,
  canPair,
  clampBuilderRest,
  defaultRestS,
  estimateBuilderMinutes,
  estimateBuilderSeconds,
  fitToMinutes,
  makeSlot,
  mergeSetupChange,
  recommendForSetup,
  restAfterRows,
  scaleMix,
  setWorkingCount,
  fitCarryOver,
  fitSetValue,
  applyAccessoryStyleTo,
  pairSlots,
  removeSlot,
  settleWarmups,
  slotsOf,
  subRoleGuards,
  type BuilderSetup,
  type BuilderWorkout,
  type SetupIdentity,
} from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

const ids = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));
const all = (w: BuilderWorkout) => w.blocks.flatMap((b) => b.slots);
const chestGroups = [
  { group: 'Chest', count: 3 },
  { group: 'Arms', count: 1 },
  { group: 'Core', count: 1 },
] as const;

describe('rest (§3.2, §9 Q7)', () => {
  it('defaults by set type and role; before a drop 0:15; superset round 1:30', () => {
    expect(defaultRestS('warmup', 'main', 'normal')).toBe(60);
    expect(defaultRestS('top', 'main', 'normal')).toBe(210);
    expect(defaultRestS('backoff', 'main', 'normal')).toBe(180);
    expect(defaultRestS('working', 'main', 'normal')).toBe(180);
    expect(defaultRestS('working', 'compound', 'normal')).toBe(120);
    expect(defaultRestS('working', 'isolation', 'normal')).toBe(90);
    expect(defaultRestS('before_drop', 'isolation', 'normal')).toBe(15);
    expect(defaultRestS('round', 'isolation', 'normal')).toBe(90);
  });

  it('shortest: main 3:00 → 2:00, compound 2:00 → 1:15, isolation 1:30 → 1:00, round 1:30 → 1:00', () => {
    expect(defaultRestS('working', 'main', 'shortest')).toBe(120);
    expect(defaultRestS('working', 'compound', 'shortest')).toBe(75);
    expect(defaultRestS('working', 'isolation', 'shortest')).toBe(60);
    expect(defaultRestS('round', 'isolation', 'shortest')).toBe(60);
    expect(defaultRestS('warmup', 'main', 'shortest')).toBe(60);
  });

  it('limits: before a drop 0–1:00, otherwise 0:30–6:00, 15 s steps', () => {
    expect(clampBuilderRest('before_drop', 75)).toBe(60);
    expect(clampBuilderRest('before_drop', 0)).toBe(0);
    expect(clampBuilderRest('working', 400)).toBe(360);
    expect(clampBuilderRest('working', 20)).toBe(30);
    expect(clampBuilderRest('round', 100)).toBe(105);
  });

  it('presets snap the defaults; the rest before a drop is the set before it', () => {
    expect(defaultRestS('working', 'isolation', 'normal', [60, 120])).toBe(60);
    const ctx = context();
    const s = makeSlot('cable_fly', { main: false }, ctx);
    const withDrop = { ...s, rows: [...s.rows, { type: 'drop' as const, reps: 14, load: 10, rpe: 9 }] };
    // Its WU7 warm-up rests 2 min before the first working set (WU11, rep band); then 1:30, and 0:15 before the drop.
    expect(restAfterRows(withDrop, info, 'normal')).toEqual([120, 90, 90, 15, 90]);
  });
});

describe('estimateBuilderMinutes (§3.6, no switch time per Q16)', () => {
  it('matches the formula to the second', () => {
    const ctx = context();
    const bench = makeSlot('bench', { main: true }, ctx);
    const incline = makeSlot('incline_db', { main: false }, ctx);
    const fly = makeSlot('cable_fly', { main: false }, ctx);
    const crunch = makeSlot('crunch', { main: false }, ctx);
    // Each slot on its own (WU1–WU12, not warmed): bench WU4 (bar, 40, 60, 80 %), incline WU6 (80 % × 4), fly and crunch WU7 (50 % × 8).
    expect(bench.rows.filter((r) => r.type === 'warmup')).toHaveLength(4);
    expect(incline.rows.filter((r) => r.type === 'warmup')).toHaveLength(1);
    expect(fly.rows.filter((r) => r.type === 'warmup')).toHaveLength(1);
    expect(crunch.rows.filter((r) => r.type === 'warmup')).toHaveLength(1);
    const w: BuilderWorkout = { restLevel: 'normal', blocks: [{ slots: [bench], auto: false }, { slots: [incline], auto: false }, { slots: [fly, crunch], auto: true }] };
    // setup 120 + 2 × 60 between. Warm-ups time by WU11 (23 Oct): Σ reps × 4 s + 60 s between steps, then the rest
    // before the first working set (warmupRestS: 3 min heavy band, 2 min rep band).
    // bench: 15 reps × 4 + 3 × 60 + 180 = 420; top 45 + 210; 3 × (45 + 180) → 1350
    // incline: 4 × 4 + 120 = 136; 3 × (45 + 120) → 631
    // fly + crunch: warm-ups 2 × (8 × 4 + 120) = 304; 3 rounds × (2 × 45 + 90) → 844
    expect(estimateBuilderSeconds(w, ctx)).toBe(120 + 120 + 1350 + 631 + 844);
    expect(estimateBuilderMinutes(w, ctx)).toBe(51);
    // shortest (the warm-up rests are WU11's at every level): bench 420 + 195 + 3 × 165; incline 136 + 3 × 120; superset 304 + 3 × 150
    expect(estimateBuilderSeconds({ ...w, restLevel: 'shortest' }, ctx)).toBe(120 + 120 + 1110 + 496 + 754);
    // Ben's own warm-up rest wins between steps and before the first working set: bench 15 × 4 + 4 × 90.
    const ownRest = { ...bench, restS: { ...bench.restS, warmup: 90 } };
    expect(estimateBuilderSeconds({ restLevel: 'normal', blocks: [{ slots: [ownRest], auto: false }] }, ctx) - estimateBuilderSeconds({ restLevel: 'normal', blocks: [{ slots: [bench], auto: false }] }, ctx)).toBe(60 + 4 * 90 - 420);
    // In this order (WU2): the incline press after bench, the fly after bench and the crunch beside the fly are warmed: no warm-ups.
    const settled = settleWarmups(w, ctx);
    expect(slotsOf(settled.blocks).map((sl) => sl.rows.filter((r) => r.type === 'warmup').length)).toEqual([4, 0, 0, 0]);
    expect(estimateBuilderSeconds(settled, ctx)).toBe(120 + 120 + 1350 + 495 + 540);
  });

  it('empty workout: 0', () => {
    expect(estimateBuilderMinutes({ blocks: [], restLevel: 'normal' }, context())).toBe(0);
  });
});

describe('recommendBuilderGroups / scaleMix (§3.7)', () => {
  it('scales the day mix (largest remainder, first group keeps one, max 4 per group with the rest spilled on)', () => {
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 6)).toEqual(BUILDER_DAY_MIXES.chest);
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 5)).toEqual(chestGroups);
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 7)).toEqual([
      { group: 'Chest', count: 4 },
      { group: 'Arms', count: 2 },
      { group: 'Core', count: 1 },
    ]);
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 1)).toEqual([{ group: 'Chest', count: 1 }]);
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 3)).toEqual([
      { group: 'Chest', count: 2 },
      { group: 'Arms', count: 1 },
    ]);
  });

  it('Chest, 60 min, supersets on: ≤ 7 exercises, ≤ 4 per group, main first, abs last, no abs + heavy pair, fits', () => {
    const ctx = context();
    const rec = recommendForSetup(BUILDER_DAY_MIXES.chest, { minutes: 60, mainLiftExerciseId: 'bench', supersets: true }, pool, ctx);
    expect(rec.count).toBeLessThanOrEqual(7);
    expect(rec.groups.every((g) => g.count <= 4)).toBe(true);
    const b = buildFromSetup({ minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: rec.groups }, pool, ctx);
    const slots = all(b.workout);
    expect(slots).toHaveLength(rec.count);
    expect(slots[0]?.exerciseId).toBe('bench');
    expect(slots[slots.length - 1]?.exerciseId).toBe('crunch');
    for (const blk of b.workout.blocks) {
      expect(blk.slots.length).toBeLessThanOrEqual(2);
      if (blk.slots.length === 2) {
        const [x, y] = blk.slots;
        if (x !== undefined && y !== undefined) expect(canPair(x, y, info).ok).toBe(true);
      }
    }
    expect(b.fit.minutes).toBeLessThanOrEqual(60);
    expect(ids(b.workout)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+crunch']);
  });

  it('20 min Chest gives the main lift alone, over 20 min', () => {
    const ctx = context();
    const rec = recommendForSetup(BUILDER_DAY_MIXES.chest, { minutes: 20, mainLiftExerciseId: 'bench', supersets: true }, pool, ctx);
    expect(rec).toEqual({ count: 1, groups: [{ group: 'Chest', count: 1 }] });
    const b = buildFromSetup({ minutes: 20, mainLiftExerciseId: 'bench', supersets: true, groups: rec.groups }, pool, ctx);
    expect(ids(b.workout)).toEqual(['bench']);
    expect(b.fit.status).toBe('over');
    expect(b.fit.minutes).toBe(21);
    // Main-lift sets and loads never change for time.
    expect(all(b.workout)[0]?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(4);
  });

  it('legs spread over quads, hamstrings/glutes, quads…; only the chosen parts on a custom day', () => {
    const ctx = context();
    const b = buildFromSetup({ minutes: 120, mainLiftExerciseId: 'squat', supersets: false, groups: [{ group: 'Legs', count: 4 }] }, pool, ctx);
    expect(all(b.workout).map((s) => info(s.exerciseId)?.part)).toEqual(['quads', 'hamstrings_glutes', 'quads', 'hamstrings_glutes']);
    const hams = buildFromSetup({ minutes: 120, mainLiftExerciseId: null, supersets: false, groups: [{ group: 'Legs', count: 3 }], legParts: ['hamstrings_glutes'] }, pool, ctx);
    expect(all(hams.workout).every((s) => info(s.exerciseId)?.part === 'hamstrings_glutes')).toBe(true);
  });

  it('Accessories: Focused = 2 × 3 sets, Varied = 3 × 2 sets at different angles', () => {
    expect(applyAccessoryStyle(chestGroups, 'Chest', true, 'focused')[0]).toEqual({ group: 'Chest', count: 3 });
    const ctx = context();
    const focused = buildFromSetup({ minutes: 120, mainLiftExerciseId: 'bench', supersets: false, groups: chestGroups, accessories: 'focused' }, pool, ctx);
    const chestAcc = (w: BuilderWorkout) => all(w).filter((s) => !s.main && info(s.exerciseId)?.group === 'Chest');
    expect(chestAcc(focused.workout).map((s) => s.rows.filter((r) => r.type !== 'warmup').length)).toEqual([3, 3]);
    const varied = buildFromSetup({ minutes: 120, mainLiftExerciseId: 'bench', supersets: false, groups: chestGroups, accessories: 'varied' }, pool, ctx);
    const acc = chestAcc(varied.workout);
    expect(acc.map((s) => s.rows.filter((r) => r.type !== 'warmup').length)).toEqual([2, 2, 2]);
    const angles = acc.map((s) => info(s.exerciseId)?.angle);
    // Angles other than the main lift's first (Upper, Lower), then the pool's next.
    expect(angles).toEqual(['Upper chest', 'Lower chest', 'Mid chest']);
  });
});

describe('fitToMinutes (§2.0.2 control 3)', () => {
  const sixty = () => {
    const ctx = context();
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] }, pool, ctx).workout;
    return { ctx, w };
  };

  it('shorter rests first, then shortest, only as far as needed', () => {
    const { ctx, w } = sixty();
    // (WU1–WU12) Warm-ups by place: bench's ladder; the chest accessories after it none; the pushdown and crunch one each.
    expect(estimateBuilderMinutes(w, ctx)).toBe(63);
    const f = fitToMinutes(w, ctx, { minutes: 55, mainGroup: 'Chest', grow: false, supersets: true });
    expect(f.steps).toEqual([
      { kind: 'rest', from: 'normal', to: 'shorter' },
      { kind: 'rest', from: 'shorter', to: 'shortest' },
    ]);
    expect(f.minutes).toBeLessThanOrEqual(55);
    const g = fitToMinutes(w, ctx, { minutes: 62, mainGroup: 'Chest', grow: false, supersets: true });
    expect(g.workout.restLevel).toBe('shorter');
  });

  /** The same day with Supersets off: every exercise a single (bench, incline DB, machine press, fly, pushdown, crunch). */
  const solo = () => {
    const ctx = context();
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] }, pool, ctx).workout;
    return { ctx, w };
  };
  const cuts = (r: { steps: readonly { kind: string }[] }) => r.steps.filter((x) => x.kind === 'sets' || x.kind === 'drop');

  it('then the least training lost (D9, SP2; review todaylean B1): never the main lift, never below 2 sets', () => {
    const { ctx, w } = solo();
    expect(estimateBuilderMinutes(w, ctx)).toBe(71);
    const f = (m: number) => fitToMinutes(w, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: false });
    // 55: a fly set and a pushdown set (3.5 lost), not the whole pushdown (4.5).
    expect(ids(f(55).workout)).toEqual(['bench', 'incline_db', 'machine_press', 'cable_fly', 'pushdown', 'crunch']);
    expect(cuts(f(55)).map((c) => c.kind)).toEqual(['sets', 'sets']);
    // 40: the warmed chest compounds (no warm-ups of their own, WU2) keep more training than fly + pushdown + crunch.
    expect(ids(f(40).workout)).toEqual(['bench', 'incline_db', 'machine_press', 'cable_fly']);
    for (const m of [55, 50, 45, 40, 35, 30, 25]) {
      const r = f(m);
      expect(r.status).toBe('fitted');
      expect(r.minutes).toBeLessThanOrEqual(m);
      expect(all(r.workout)[0]).toEqual(all(w)[0]);
      expect(all(r.workout).every((s) => s.main || s.rows.filter((x) => x.type !== 'warmup').length >= 2)).toBe(true);
    }
    // 25: two fly sets still fit after the main lift (the old one-cut-at-a-time fit kept the main lift alone).
    expect(ids(f(25).workout)).toEqual(['bench', 'cable_fly']);
    const f10 = f(10);
    expect(f10.status).toBe('over');
    expect(ids(f10.workout)).toEqual(['bench']);
    expect(all(f10.workout)[0]?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(4);
  });

  it('cuts are listed in workout order: at 55 a fly set and a pushdown set', () => {
    const { ctx, w } = solo();
    const r = fitToMinutes(w, ctx, { minutes: 55, mainGroup: 'Chest', grow: false, supersets: false });
    expect(cuts(r)).toEqual([
      { kind: 'sets', slotKey: all(w)[3]?.key, exerciseId: 'cable_fly', from: 3, to: 2 },
      { kind: 'sets', slotKey: all(w)[4]?.key, exerciseId: 'pushdown', from: 3, to: 2 },
    ]);
  });

  it('only as far as needed: no set it cut could come back and still fit', () => {
    for (const make of [sixty, solo]) {
      const { ctx, w } = make();
      for (const m of [58, 52, 47, 41, 36, 31, 26]) {
        const r = fitToMinutes(w, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: false });
        for (const st of r.steps) {
          if (st.kind !== 'sets') continue;
          const s = all(r.workout).find((x) => x.key === st.slotKey);
          if (s === undefined) throw new Error('cut slot gone');
          const back: BuilderWorkout = { ...r.workout, blocks: r.workout.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.key === s.key ? setWorkingCount(x, st.to + 1) : x)) })) };
          expect(estimateBuilderSeconds(back, ctx)).toBeGreaterThan(m * 60 + 29);
        }
      }
    }
  });

  it('Supersets on: pairing is a free saving before any cut; Supersets off: nothing is ever paired; a slot Ben edited is never paired', () => {
    const { ctx, w } = solo();
    const on = fitToMinutes(w, ctx, { minutes: 55, mainGroup: 'Chest', grow: false, supersets: true });
    expect(on.steps.map((x) => x.kind)).toEqual(['rest', 'rest', 'pair']);
    expect(ids(on.workout)).toEqual(['bench', 'incline_db', 'machine_press', 'cable_fly', 'pushdown+crunch']);
    expect(on.workout.blocks.find((b) => b.slots.length > 1)?.auto).toBe(true);
    for (const m of [60, 50, 40, 30]) expect(fitToMinutes(w, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: false }).workout.blocks.every((b) => b.slots.length === 1)).toBe(true);
    const edited: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.exerciseId === 'crunch' ? { ...x, touched: true as const } : x)) })) };
    const t = fitToMinutes(edited, ctx, { minutes: 55, mainGroup: 'Chest', grow: false, supersets: true });
    expect(t.workout.blocks.some((b) => b.slots.length > 1 && b.slots.some((x) => x.exerciseId === 'crunch'))).toBe(false);
  });

  it('sweep (design review S2): one minute at a time from the full length to 15, less time never keeps more training (FIT_SET_VALUE), never touches the main lift, never pairs with Supersets off, and keeps every accessory at 2+ sets', () => {
    const days: { main: string; mainGroup: 'Chest' | 'Legs' | 'Back'; groups: { group: 'Chest' | 'Legs' | 'Back' | 'Arms' | 'Core'; count: number }[] }[] = [
      { main: 'bench', mainGroup: 'Chest', groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] },
      { main: 'bench', mainGroup: 'Chest', groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 3 }, { group: 'Core', count: 1 }] },
      { main: 'squat', mainGroup: 'Legs', groups: [{ group: 'Legs', count: 5 }, { group: 'Core', count: 1 }] },
      { main: 'squat', mainGroup: 'Legs', groups: [{ group: 'Legs', count: 4 }, { group: 'Core', count: 2 }] },
      { main: 'row', mainGroup: 'Back', groups: [{ group: 'Back', count: 3 }, { group: 'Arms', count: 2 }, { group: 'Core', count: 1 }] },
    ];
    const work = (s: { rows: readonly { type: string }[] }) => s.rows.filter((r) => r.type !== 'warmup').length;
    for (const d of days) {
      for (const supersets of [true, false]) {
        const ctx = context();
        const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: d.main, supersets, groups: d.groups }, pool, ctx).workout;
        const main = all(w).find((s) => s.main);
        let kept = Infinity;
        for (let m = estimateBuilderMinutes(w, ctx); m >= 15; m -= 1) {
          const r = fitToMinutes(w, ctx, { minutes: m, mainGroup: d.mainGroup, grow: false, supersets });
          const value = all(r.workout)
            .filter((s) => !s.main)
            .reduce((n, s) => n + work(s) * fitSetValue(s.exerciseId, info, d.mainGroup), 0);
          expect(value, `${d.main} ${String(m)} min, supersets ${String(supersets)}`).toBeLessThanOrEqual(kept + 1e-9);
          kept = value;
          expect(all(r.workout).find((s) => s.main)).toEqual(main);
          expect(all(r.workout).filter((s) => !s.main).every((s) => work(s) >= 2)).toBe(true);
          if (!supersets) expect(r.workout.blocks.every((b) => b.slots.length === 1)).toBe(true);
          if (r.status !== 'over') expect(r.minutes).toBeLessThanOrEqual(m);
        }
      }
    }
  });

  describe('review todaylean B1: the least training lost, only as far as needed', () => {
    const days: { main: string; mainGroup: 'Chest' | 'Legs' | 'Back'; groups: { group: 'Chest' | 'Legs' | 'Back' | 'Arms' | 'Core'; count: number }[] }[] = [
      { main: 'bench', mainGroup: 'Chest', groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] },
      { main: 'bench', mainGroup: 'Chest', groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 3 }, { group: 'Core', count: 1 }] },
      { main: 'squat', mainGroup: 'Legs', groups: [{ group: 'Legs', count: 5 }, { group: 'Core', count: 1 }] },
      { main: 'squat', mainGroup: 'Legs', groups: [{ group: 'Legs', count: 4 }, { group: 'Core', count: 2 }] },
      { main: 'row', mainGroup: 'Back', groups: [{ group: 'Back', count: 3 }, { group: 'Arms', count: 2 }, { group: 'Core', count: 1 }] },
    ];
    const work = (s: { rows: readonly { type: string }[] }) => s.rows.filter((r) => r.type !== 'warmup').length;
    /** The workout the cut works on (the fit's free savings made), each accessory at `counts` sets (0: left out). */
    const withCounts = (base: BuilderWorkout, counts: ReadonlyMap<string, number>): BuilderWorkout => {
      let x = base;
      for (const s of all(base)) {
        const k = counts.get(s.key);
        if (k === undefined || k === work(s)) continue;
        x = k === 0 ? removeSlot(x, s.key) : { ...x, blocks: x.blocks.map((b) => ({ ...b, slots: b.slots.map((y) => (y.key === s.key ? setWorkingCount(y, k) : y)) })) };
      }
      return x;
    };
    const cases = function* () {
      for (const d of days) {
        for (const supersets of [true, false]) {
          const ctx = context();
          const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: d.main, supersets, groups: d.groups }, pool, ctx).workout;
          const value = (x: BuilderWorkout) => all(x).filter((s) => !s.main).reduce((n, s) => n + work(s) * fitSetValue(s.exerciseId, info, d.mainGroup), 0);
          for (let m = estimateBuilderMinutes(w, ctx); m >= 15; m -= 1) {
            const r = fitToMinutes(w, ctx, { minutes: m, mainGroup: d.mainGroup, grow: false, supersets });
            if (!r.steps.some((s) => s.kind === 'sets' || s.kind === 'drop')) continue;
            // The cut starts from shortest rests and, with Supersets on, the pairs it made.
            const rested: BuilderWorkout = { ...w, restLevel: 'shortest' };
            const base = r.steps.some((s) => s.kind === 'pair') ? { ...rested, blocks: pairSlots(rested.blocks, ctx.info, { skip: (s) => s.touched === true }) } : rested;
            const label = `${d.main} ${String(d.groups.length)} groups, ${String(m)} min, supersets ${String(supersets)}`;
            yield { ctx, base, r, m, value, label, mainGroup: d.mainGroup };
          }
        }
      }
    };

    it('nothing it left out (at 2 sets) and no set it cut can come back while the workout still fits, at every minute of every day shape', () => {
      let checked = 0;
      for (const { ctx, base, r, m, label } of cases()) {
        if (r.status !== 'fitted') continue;
        const counts = new Map(all(base).filter((s) => !s.main).map((s) => [s.key, work(all(r.workout).find((x) => x.key === s.key) ?? { rows: [] })]));
        expect(estimateBuilderSeconds(withCounts(base, counts), ctx), label).toBe(estimateBuilderSeconds(r.workout, ctx));
        for (const s of all(base)) {
          const k = counts.get(s.key);
          if (k === undefined || k >= work(s)) continue;
          const back = new Map(counts).set(s.key, k === 0 ? Math.min(2, work(s)) : k + 1);
          expect(estimateBuilderSeconds(withCounts(base, back), ctx), `${label}: ${s.exerciseId} back`).toBeGreaterThan(m * 60 + 29);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(100);
    });

    it('brute force on the small fixture: no achievable fit keeps more training (FIT_SET_VALUE) at the same Time (with sub-role coverage first, Ben 24 Oct)', () => {
      let guarded = 0;
      for (const { ctx, base, r, m, value, label, mainGroup } of cases()) {
        if (r.status !== 'fitted') continue;
        const acc = all(base).filter((s) => !s.main);
        // (Ben, 24 Oct) The guarded exercises (a Back day's vertical pull and row) first: whole, then at 2+ sets with their
        // sets weighed before the rest, then the later sub-roles given up one at a time, then no guard.
        const guards = subRoleGuards(base, ctx.info, mainGroup).map((g) => g.slotKey);
        const levels: (Map<string, 'full' | 'kept'> | null)[] = guards.length === 0 ? [null] : [new Map(guards.map((k) => [k, 'full'])), ...guards.map((_, i) => new Map(guards.slice(0, guards.length - i).map((k) => [k, 'kept' as const]))), null];
        if (guards.length > 0) guarded += 1;
        const guardValue = (x: BuilderWorkout, keys: readonly string[]) => all(x).filter((s) => keys.includes(s.key)).reduce((n, s) => n + work(s) * fitSetValue(s.exerciseId, info, mainGroup), 0);
        const top: { best: { g: number; v: number } | null } = { best: null };
        let level: Map<string, 'full' | 'kept'> | null = null;
        for (const lv of levels) {
          const walk = (i: number, counts: Map<string, number>): void => {
            const s = acc[i];
            if (s === undefined) {
              const x = withCounts(base, counts);
              if (estimateBuilderSeconds(x, ctx) > m * 60 + 29) return;
              const g = lv === null ? 0 : guardValue(x, [...lv.keys()]);
              const v = value(x);
              const b = top.best;
              if (b === null || g > b.g + 1e-9 || (Math.abs(g - b.g) <= 1e-9 && v > b.v)) top.best = { g, v };
              return;
            }
            const n = work(s);
            const mode = lv?.get(s.key);
            if (mode === 'full') {
              walk(i + 1, new Map(counts).set(s.key, n));
              return;
            }
            if (mode !== 'kept') walk(i + 1, new Map(counts).set(s.key, 0));
            for (let k = Math.min(2, n); k <= n; k += 1) walk(i + 1, new Map(counts).set(s.key, k));
          };
          walk(0, new Map());
          if (top.best !== null) {
            level = lv;
            break;
          }
        }
        const found = top.best;
        if (found === null) continue;
        const keys = level === null ? [] : [...level.keys()];
        expect(guardValue(r.workout, keys), `${label}: sub-role coverage`).toBeGreaterThanOrEqual(found.g - 1e-9);
        if (Math.abs(guardValue(r.workout, keys) - found.g) <= 1e-9) expect(value(r.workout), label).toBeGreaterThanOrEqual(found.v - 1e-9);
      }
      expect(guarded).toBeGreaterThan(0);
    });

    it('the examples the review found: Chest with Supersets on at 35 min uses ~35 min; off at 27 min keeps more than the main lift', () => {
      const ctx = context();
      const groups = days[0]?.groups ?? [];
      const on = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: true, groups }, pool, ctx).workout;
      const r35 = fitToMinutes(on, ctx, { minutes: 35, mainGroup: 'Chest', grow: false, supersets: true });
      expect(r35.minutes).toBeGreaterThanOrEqual(34);
      const off = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups }, pool, ctx).workout;
      const r27 = fitToMinutes(off, ctx, { minutes: 27, mainGroup: 'Chest', grow: false, supersets: false });
      expect(ids(r27.workout).length).toBeGreaterThan(1);
      expect(r27.minutes).toBeLessThanOrEqual(27);
    });
  });

  it('no effort is pushed for time unless asked (the workout’s +N min offer): then accessory last sets go to RPE 9 after the free savings, before any cut', () => {
    const { ctx, w } = sixty();
    const easy: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.main ? s : { ...s, rows: s.rows.map((r) => (r.type === 'working' ? { ...r, rpe: 8 } : r)) })) })) };
    const quiet = fitToMinutes(easy, ctx, { minutes: 50, mainGroup: 'Chest', grow: false, supersets: true });
    expect(quiet.steps.some((s) => s.kind === 'effort')).toBe(false);
    const asked = fitToMinutes(easy, ctx, { minutes: 50, mainGroup: 'Chest', grow: false, supersets: true, pushEffort: true });
    const kinds = asked.steps.map((s) => s.kind);
    expect(kinds.indexOf('effort')).toBe(2);
    expect(kinds.slice(3).every((k) => k === 'sets' || k === 'drop')).toBe(true);
  });

  it("Ben's edited slots are never cut", () => {
    const { ctx, w } = sixty();
    const touched: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.exerciseId === 'crunch' ? { ...s, touched: true as const } : s)) })) };
    const f = fitToMinutes(touched, ctx, { minutes: 40, mainGroup: 'Chest', grow: false, supersets: true });
    expect(all(f.workout).some((s) => s.exerciseId === 'crunch')).toBe(true);
  });

  it('abs off + longer: a second arm exercise first (the other arm part first, D5), then sets; the plan buffer is kept', () => {
    const ctx = context();
    // 62 min (WU1–WU12: the pushdown and crunch carry a warm-up each, so the day is 62 at normal rests).
    const b = buildFromSetup({ minutes: 62, mainLiftExerciseId: 'bench', supersets: false, groups: chestGroups }, pool, ctx).workout;
    expect(estimateBuilderMinutes(b, ctx)).toBe(62);
    const off = absOff(b, ctx, { supersets: false, armCandidates: ['oh_ext', 'hammer'] });
    expect(off.partner).toBeNull();
    expect(estimateBuilderMinutes(off.workout, ctx)).toBe(52);
    const grown = fitToMinutes(off.workout, ctx, { minutes: 62, mainGroup: 'Chest', grow: true, supersets: false, planBufferMin: 0, addCandidates: { arm: ['oh_ext', 'hammer'], mainGroup: ['machine_press'] } });
    // Arms is biceps + triceps (D5): the pushdown gets a curl before a second triceps exercise.
    expect(grown.steps[0]).toMatchObject({ kind: 'add', exerciseId: 'hammer', why: 'arm' });
    expect(grown.minutes).toBeLessThanOrEqual(62);
    expect(ids(grown.workout)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown', 'hammer']);
    // Only triceps left to add: the second arm exercise is one.
    const tri = fitToMinutes(off.workout, ctx, { minutes: 62, mainGroup: 'Chest', grow: true, supersets: false, planBufferMin: 0, addCandidates: { arm: ['oh_ext'], mainGroup: [] } });
    expect(tri.steps[0]).toMatchObject({ kind: 'add', exerciseId: 'oh_ext', why: 'arm' });
    // With spare plan minutes kept as a buffer, only sets fit.
    const kept = fitToMinutes(off.workout, ctx, { minutes: 62, mainGroup: 'Chest', grow: true, supersets: false, planBufferMin: 5, addCandidates: { arm: ['oh_ext'], mainGroup: ['machine_press'] } });
    expect(kept.steps.some((s) => s.kind === 'add')).toBe(false);
    expect(kept.minutes).toBeLessThanOrEqual(57);
  });

  it('longer: +1 set on accessories up to 4, never on the main lift', () => {
    const ctx = context();
    const b = buildFromSetup({ minutes: 60, mainLiftExerciseId: 'bench', supersets: false, groups: chestGroups }, pool, ctx).workout;
    const g = fitToMinutes(b, ctx, { minutes: 180, mainGroup: 'Chest', grow: true, supersets: false });
    expect(all(g.workout).filter((s) => !s.main).every((s) => s.rows.filter((r) => r.type !== 'warmup').length === 4)).toBe(true);
    expect(all(g.workout)[0]?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(4);
  });

  it('abs off with supersets on: the arm exercise gets an arm partner in the same slot, time about the same', () => {
    const ctx = context();
    const b = buildFromSetup({ minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: chestGroups }, pool, ctx).workout;
    expect(ids(b)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+crunch']);
    const off = absOff(b, ctx, { supersets: true, armCandidates: ['oh_ext', 'curl'] });
    expect(ids(off.workout)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+curl']);
    expect(off.partner?.exerciseId).toBe('curl');
    // As saved (warm-ups for each slot's place: the curl is a superset partner, so warmed, WU2), the same time.
    expect(estimateBuilderMinutes(settleWarmups(off.workout, ctx), ctx)).toBe(estimateBuilderMinutes(b, ctx));
  });
});

describe('mergeSetupChange (§2.3, Q4 old)', () => {
  const setup = (over: Partial<BuilderSetup & SetupIdentity> = {}): BuilderSetup & SetupIdentity => ({ dayId: 'chest', mainLiftExerciseId: 'bench', variationId: null, minutes: 60, supersets: true, groups: chestGroups, ...over });
  const start = () => {
    const ctx = context();
    const w = buildFromSetup(setup(), pool, ctx).workout;
    // Ben swapped Cable fly for Cable crossover.
    const swapped: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.exerciseId === 'cable_fly' ? { ...makeSlot('crossover', { main: false }, ctx), touched: true as const } : s)) })) };
    return { ctx, w: swapped };
  };

  it('day, main lift or variation → rebuild', () => {
    const { ctx, w } = start();
    expect(mergeSetupChange(setup(), setup({ dayId: 'back' }), w, pool, ctx)).toEqual({ kind: 'rebuild', reason: 'day' });
    expect(mergeSetupChange(setup(), setup({ mainLiftExerciseId: 'incline_bb' }), w, pool, ctx)).toEqual({ kind: 'rebuild', reason: 'main_lift' });
    expect(mergeSetupChange(setup(), setup({ variationId: 'v1' }), w, pool, ctx)).toEqual({ kind: 'rebuild', reason: 'variation' });
  });

  it('a length change keeps an earlier swap', () => {
    const { ctx, w } = start();
    const r = mergeSetupChange(setup(), setup({ minutes: 35 }), w, pool, ctx);
    expect(r.kind).toBe('merged');
    if (r.kind !== 'merged') return;
    expect(all(r.workout).some((s) => s.exerciseId === 'crossover' && s.touched === true)).toBe(true);
    expect(r.fit?.minutes ?? 99).toBeLessThanOrEqual(35);
  });

  it("a group change adds or removes only that group's exercises, untouched ones first", () => {
    const { ctx, w } = start();
    const more = mergeSetupChange(setup(), setup({ groups: [{ group: 'Chest', count: 4 }, chestGroups[1], chestGroups[2]] }), w, pool, ctx);
    expect(more.kind === 'merged' && more.changes).toEqual([{ kind: 'group_added', group: 'Chest', slotKey: expect.any(String) as string, exerciseId: 'cable_fly' }]);
    const fewer = mergeSetupChange(setup(), setup({ groups: [{ group: 'Chest', count: 2 }, chestGroups[1], chestGroups[2]] }), w, pool, ctx);
    expect(fewer.kind === 'merged' && fewer.changes.map((c) => c.kind === 'group_removed' && c.exerciseId)).toEqual(['incline_db']);
    if (fewer.kind === 'merged') expect(all(fewer.workout).some((s) => s.exerciseId === 'crossover')).toBe(true);
  });

  it("Supersets off splits only the builder's pairs", () => {
    const { ctx, w } = start();
    const own: BuilderWorkout = { ...w, blocks: [...w.blocks.slice(0, 1), { slots: [all(w)[1], all(w)[2]].filter((s) => s !== undefined), auto: false }, ...w.blocks.slice(3)] };
    expect(ids(own)).toEqual(['bench', 'incline_db+crossover', 'pushdown+crunch']);
    const r = mergeSetupChange(setup(), setup({ supersets: false }), own, pool, ctx);
    expect(r.kind === 'merged' && ids(r.workout)).toEqual(['bench', 'incline_db+crossover', 'pushdown', 'crunch']);
  });

  it('no change: unchanged', () => {
    const { ctx, w } = start();
    expect(mergeSetupChange(setup(), setup(), w, pool, ctx)).toEqual({ kind: 'unchanged', workout: w });
  });

  it('set count helper keeps the top set when trimming the main lift', () => {
    const ctx = context();
    const s = makeSlot('bench', { main: true }, ctx);
    expect(setWorkingCount(s, 2).rows.filter((r) => r.type !== 'warmup').map((r) => r.type)).toEqual(['top', 'backoff']);
  });
});

describe('fit value and the week’s carry-over (fit-to-time 22 Oct revision)', () => {
  it('values a working set: compound accessory 3, isolation 2, abs 2.5, another group’s isolation or no group 1.5', () => {
    expect(fitSetValue('incline_db', info, 'Chest')).toBe(3);
    expect(fitSetValue('lat_pulldown', info, 'Chest')).toBe(3);
    expect(fitSetValue('cable_fly', info, 'Chest')).toBe(2);
    expect(fitSetValue('crunch', info, 'Chest')).toBe(2.5);
    expect(fitSetValue('pushdown', info, 'Chest')).toBe(1.5);
    expect(fitSetValue('rowing_machine', info, 'Chest')).toBe(1.5);
    // No main group known: every isolation is the day's own.
    expect(fitSetValue('pushdown', info, null)).toBe(2);
  });

  it('carry-over: the group that lost most (2 or more), capped at 4; a tie goes to the day’s main group; the main lift never counts', () => {
    const ctx = context();
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] }, pool, ctx).workout;
    const at = (m: number) => fitToMinutes(w, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: false }).workout;
    // 50: a fly set and the whole pushdown went: 3 triceps sets.
    expect(fitCarryOver(w, at(50), info, 'Chest')).toEqual({ group: 'Arms', sets: 3 });
    // 55: a set each from fly and pushdown: no group lost 2.
    expect(fitCarryOver(w, at(55), info, 'Chest')).toBeNull();
    // Fly and pushdown gone (3 sets each): the tie goes to Chest.
    const gone = (keys: readonly string[]): BuilderWorkout => ({ ...w, blocks: w.blocks.flatMap((b) => { const slots = b.slots.filter((x) => !keys.includes(x.exerciseId)); return slots.length === 0 ? [] : [{ ...b, slots }]; }) });
    expect(fitCarryOver(w, gone(['cable_fly', 'pushdown']), info, 'Chest')).toEqual({ group: 'Chest', sets: 3 });
    // 25: nine chest sets went; at most 4 are offered.
    expect(fitCarryOver(w, at(25), info, 'Chest')).toEqual({ group: 'Chest', sets: 4 });
    // Nothing cut, or one set: nothing to carry.
    expect(fitCarryOver(w, w, info, 'Chest')).toBeNull();
    const fly = all(w).find((s) => s.exerciseId === 'cable_fly');
    if (fly === undefined) throw new Error('no fly');
    const oneSet: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === fly.key ? setWorkingCount(s, 2) : s)) })) };
    expect(fitCarryOver(w, oneSet, info, 'Chest')).toBeNull();
    // Fewer main-lift sets never count (the fit never cuts them; this is the guard).
    const bench = all(w)[0];
    if (bench === undefined) throw new Error('no bench');
    const lessMain: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === bench.key ? setWorkingCount(s, 1) : s)) })) };
    expect(fitCarryOver(w, lessMain, info, 'Chest')).toBeNull();
  });
});

describe('Accessories style on Your workout (D3: Today’s Accessories moved there)', () => {
  const ctx = context();
  const setup = (accessories: 'focused' | 'varied'): BuilderSetup & SetupIdentity => ({ minutes: 120, mainLiftExerciseId: 'bench', supersets: false, groups: chestGroups, accessories, dayId: 'chest', variationId: null });
  const chestAcc = (w: BuilderWorkout) => all(w).filter((s) => !s.main && info(s.exerciseId)?.group === 'Chest');
  const sets = (s: { rows: readonly { type: string }[] }) => s.rows.filter((r) => r.type !== 'warmup').length;

  it('Focused → Varied: three main-group accessories at 2 sets, the new one at another angle; the main lift and other groups untouched', () => {
    const focused = buildFromSetup(setup('focused'), pool, ctx, { trim: false }).workout;
    expect(chestAcc(focused).map(sets)).toEqual([3, 3]);
    const r = mergeSetupChange(setup('focused'), setup('varied'), focused, pool, ctx);
    if (r.kind !== 'merged') throw new Error(r.kind);
    expect(r.changes).toEqual([{ kind: 'accessories', style: 'varied' }]);
    const acc = chestAcc(r.workout);
    expect(acc.map(sets)).toEqual([2, 2, 2]);
    expect(new Set(acc.map((s) => info(s.exerciseId)?.angle)).size).toBe(3);
    expect(all(r.workout)[0]).toEqual(all(focused)[0]);
    const others = (w: BuilderWorkout) => all(w).filter((s) => !s.main && info(s.exerciseId)?.group !== 'Chest');
    expect(others(r.workout)).toEqual(others(focused));
  });

  it('Varied → Focused: one goes (one Ben didn’t edit, from the end); an accessory Ben edited keeps his sets', () => {
    const varied = buildFromSetup(setup('varied'), pool, ctx, { trim: false }).workout;
    const acc = chestAcc(varied);
    const mine = acc[acc.length - 1];
    if (mine === undefined) throw new Error('no accessory');
    const edited: BuilderWorkout = { ...varied, blocks: varied.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === mine.key ? { ...setWorkingCount(s, 4), touched: true as const } : s)) })) };
    const r = mergeSetupChange(setup('varied'), setup('focused'), edited, pool, ctx);
    if (r.kind !== 'merged') throw new Error(r.kind);
    const after = chestAcc(r.workout);
    expect(after).toHaveLength(2);
    expect(after.find((s) => s.key === mine.key)?.rows.filter((x) => x.type !== 'warmup')).toHaveLength(4);
    expect(after.filter((s) => s.key !== mine.key).map(sets)).toEqual([3]);
  });

  it('the same style again changes nothing; a Set up with no style never gets one', () => {
    const focused = buildFromSetup(setup('focused'), pool, ctx, { trim: false }).workout;
    expect(mergeSetupChange(setup('focused'), setup('focused'), focused, pool, ctx).kind).toBe('unchanged');
    const plain = { ...setup('focused') };
    delete plain.accessories;
    expect(mergeSetupChange(plain, { ...plain, supersets: true }, focused, pool, ctx).kind).toBe('merged');
    expect(applyAccessoryStyleTo(focused, 'focused', 'Chest', pool, ctx).added).toEqual([]);
  });
});
