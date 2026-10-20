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
  type BuilderSetup,
  type BuilderWorkout,
  type SetupIdentity,
} from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

const ids = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));
const all = (w: BuilderWorkout) => w.blocks.flatMap((b) => b.slots);
const chestGroups = [
  { group: 'Chest', count: 3 },
  { group: 'Triceps', count: 1 },
  { group: 'Abs', count: 1 },
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
    expect(restAfterRows(withDrop, info, 'normal')).toEqual([90, 90, 15, 90]);
  });
});

describe('estimateBuilderMinutes (§3.6, no switch time per Q16)', () => {
  it('matches the formula to the second', () => {
    const ctx = context();
    const bench = makeSlot('bench', { main: true }, ctx);
    const incline = makeSlot('incline_db', { main: false }, ctx);
    const fly = makeSlot('cable_fly', { main: false }, ctx);
    const crunch = makeSlot('crunch', { main: false }, ctx);
    expect(bench.rows.filter((r) => r.type === 'warmup')).toHaveLength(4);
    expect(incline.rows.filter((r) => r.type === 'warmup')).toHaveLength(1);
    const w: BuilderWorkout = { restLevel: 'normal', blocks: [{ slots: [bench], auto: false }, { slots: [incline], auto: false }, { slots: [fly, crunch], auto: true }] };
    // setup 120 + 2 × 60 between
    // bench: 4 × (30 + 60) + 60 = 420; top 45 + 210; 3 × (45 + 180) → 1350
    // incline: 1 × 90 + 60 = 150; 3 × (45 + 120) → 645
    // fly + crunch: 3 rounds × (2 × 45 + 90) → 540
    expect(estimateBuilderSeconds(w, ctx)).toBe(120 + 120 + 1350 + 645 + 540);
    expect(estimateBuilderMinutes(w, ctx)).toBe(46);
    // shortest: bench 420 + 195 + 3 × 165; incline 150 + 3 × 120; superset 3 × 150
    expect(estimateBuilderSeconds({ ...w, restLevel: 'shortest' }, ctx)).toBe(120 + 120 + 1110 + 510 + 450);
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
      { group: 'Triceps', count: 2 },
      { group: 'Abs', count: 1 },
    ]);
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 1)).toEqual([{ group: 'Chest', count: 1 }]);
    expect(scaleMix(BUILDER_DAY_MIXES.chest, 3)).toEqual([
      { group: 'Chest', count: 2 },
      { group: 'Triceps', count: 1 },
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
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 4 }, { group: 'Triceps', count: 1 }, { group: 'Abs', count: 1 }] }, pool, ctx).workout;
    return { ctx, w };
  };

  it('shorter rests first, then shortest, only as far as needed', () => {
    const { ctx, w } = sixty();
    expect(estimateBuilderMinutes(w, ctx)).toBe(66);
    const f = fitToMinutes(w, ctx, { minutes: 55, mainGroup: 'Chest', grow: false, supersets: true });
    expect(f.steps).toEqual([
      { kind: 'rest', from: 'normal', to: 'shorter' },
      { kind: 'rest', from: 'shorter', to: 'shortest' },
    ]);
    expect(f.minutes).toBeLessThanOrEqual(55);
    const g = fitToMinutes(w, ctx, { minutes: 62, mainGroup: 'Chest', grow: false, supersets: true });
    expect(g.workout.restLevel).toBe('shorter');
  });

  it('then fewer accessory sets (last exercise first, never below 2), then drops abs → other group isolation → accessory isolation → compounds; never the main lift', () => {
    const { ctx, w } = sixty();
    const f50 = fitToMinutes(w, ctx, { minutes: 50, mainGroup: 'Chest', grow: false, supersets: true });
    expect(f50.steps.filter((s) => s.kind === 'sets').map((s) => s.exerciseId)).toEqual(['crunch', 'pushdown', 'cable_fly']);
    expect(all(f50.workout).every((s) => s.main || s.rows.filter((r) => r.type !== 'warmup').length >= 2)).toBe(true);
    const drops = (m: number) => fitToMinutes(w, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: true }).steps.flatMap((s) => (s.kind === 'drop' ? [s.exerciseId] : []));
    expect(drops(45)).toEqual(['crunch']);
    expect(drops(40)).toEqual(['crunch', 'pushdown']);
    expect(drops(30)).toEqual(['crunch', 'pushdown', 'cable_fly', 'machine_press']);
    const f25 = fitToMinutes(w, ctx, { minutes: 25, mainGroup: 'Chest', grow: false, supersets: true });
    expect(ids(f25.workout)).toEqual(['bench']);
    expect(all(f25.workout)[0]?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(4);
    const f10 = fitToMinutes(w, ctx, { minutes: 10, mainGroup: 'Chest', grow: false, supersets: true });
    expect(f10.status).toBe('over');
    expect(ids(f10.workout)).toEqual(['bench']);
  });

  it('after a drop frees time, cut sets come back as far as the time allows', () => {
    const { ctx, w } = sixty();
    const f = fitToMinutes(w, ctx, { minutes: 30, mainGroup: 'Chest', grow: false, supersets: true });
    expect(ids(f.workout)).toEqual(['bench', 'incline_db']);
    expect(all(f.workout)[1]?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(3);
    expect(f.steps.some((s) => s.kind === 'sets')).toBe(false);
  });

  it('effort: an accessory whose last set is below RPE 9 is pushed to 9 before sets are cut', () => {
    const { ctx, w } = sixty();
    const easy: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.main ? s : { ...s, rows: s.rows.map((r) => (r.type === 'working' ? { ...r, rpe: 8 } : r)) })) })) };
    const f = fitToMinutes(easy, ctx, { minutes: 50, mainGroup: 'Chest', grow: false, supersets: true });
    expect(f.steps[2]?.kind).toBe('effort');
  });

  it("Ben's edited slots are never cut", () => {
    const { ctx, w } = sixty();
    const touched: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.exerciseId === 'crunch' ? { ...s, touched: true as const } : s)) })) };
    const f = fitToMinutes(touched, ctx, { minutes: 40, mainGroup: 'Chest', grow: false, supersets: true });
    expect(all(f.workout).some((s) => s.exerciseId === 'crunch')).toBe(true);
  });

  it('abs off + longer: a second arm exercise first, then sets; the plan buffer is kept', () => {
    const ctx = context();
    const b = buildFromSetup({ minutes: 60, mainLiftExerciseId: 'bench', supersets: false, groups: chestGroups }, pool, ctx).workout;
    expect(estimateBuilderMinutes(b, ctx)).toBe(60);
    const off = absOff(b, ctx, { supersets: false, armCandidates: ['oh_ext', 'hammer'] });
    expect(off.partner).toBeNull();
    expect(estimateBuilderMinutes(off.workout, ctx)).toBe(52);
    const grown = fitToMinutes(off.workout, ctx, { minutes: 60, mainGroup: 'Chest', grow: true, supersets: false, planBufferMin: 0, addCandidates: { arm: ['oh_ext', 'hammer'], mainGroup: ['machine_press'] } });
    expect(grown.steps[0]).toMatchObject({ kind: 'add', exerciseId: 'oh_ext', why: 'arm' });
    expect(grown.minutes).toBeLessThanOrEqual(60);
    expect(ids(grown.workout)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown', 'oh_ext']);
    // With 9 spare plan minutes kept as a buffer, only sets fit.
    const kept = fitToMinutes(off.workout, ctx, { minutes: 60, mainGroup: 'Chest', grow: true, supersets: false, planBufferMin: 5, addCandidates: { arm: ['oh_ext'], mainGroup: ['machine_press'] } });
    expect(kept.steps.some((s) => s.kind === 'add')).toBe(false);
    expect(kept.minutes).toBeLessThanOrEqual(55);
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
    expect(estimateBuilderMinutes(off.workout, ctx)).toBe(estimateBuilderMinutes(b, ctx));
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
