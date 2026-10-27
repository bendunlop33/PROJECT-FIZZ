import { describe, expect, it } from 'vitest';
import {
  BUILDER_DAY_MIXES,
  DEFAULT_FIT_REST_LEVEL,
  FIT_REST_LEVEL_OPTIONS,
  REST_LEVEL_NAMES,
  buildFromSetup,
  defaultRestS,
  estimateBuilderMinutes,
  fitNoteOf,
  fitRestLevelOf,
  fitToMinutes,
  recommendForSetup,
  restAfterRows,
  roundRestOf,
  setWorkingCount,
  type BuilderContext,
  type BuilderSlot,
  type BuilderWorkout,
  type RestLevel,
} from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/**
 * (Ben, 27 Oct) Fit to time, shorter: (1) accessory rests only, down to `Rest when short on time` (default Minimum
 * rest: isolation and round 1:00, compound never below 1:30); the main lift's rests never change; (2) pairs (Supersets
 * on); (3) accessory sets 3 → 2, lowest value first, nothing left out where that fits; (4) only then leave out.
 */

const all = (w: BuilderWorkout) => w.blocks.flatMap((b) => b.slots);
const ids = (w: BuilderWorkout) => all(w).map((s) => s.exerciseId);
const working = (s: BuilderSlot) => s.rows.filter((r) => r.type !== 'warmup').length;
const mainOf = (w: BuilderWorkout) => all(w).find((s) => s.main);
const restsOf = (s: BuilderSlot | undefined, w: BuilderWorkout, ctx: BuilderContext) => (s === undefined ? [] : restAfterRows(s, ctx.info, w.restLevel, ctx.restPresetsS));
const withLevel = (ctx: BuilderContext, l: RestLevel | undefined): BuilderContext => (l === undefined ? ctx : { ...ctx, fitRestLevel: l });

/** Chest day, Supersets off: bench (main), incline DB, machine press, cable fly, pushdown, crunch. */
const chest = (supersets = false) => {
  const ctx = context();
  const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets, groups: [...BUILDER_DAY_MIXES.chest] }, pool, ctx).workout;
  return { ctx, w };
};

describe('rest levels (Ben, 27 Oct): accessories only', () => {
  it('the main lift keeps 3:30 top, 3:00 back-off, 3:00 working at every level', () => {
    for (const l of ['normal', 'shorter', 'shortest'] as const) {
      expect(defaultRestS('top', 'main', l)).toBe(210);
      expect(defaultRestS('backoff', 'main', l)).toBe(180);
      expect(defaultRestS('working', 'main', l)).toBe(180);
    }
  });

  it('compound accessory 2:00 → 1:30 and never lower; isolation and round 1:30 → 1:15 → 1:00', () => {
    expect([defaultRestS('working', 'compound', 'normal'), defaultRestS('working', 'compound', 'shorter'), defaultRestS('working', 'compound', 'shortest')]).toEqual([120, 90, 90]);
    expect([defaultRestS('working', 'isolation', 'normal'), defaultRestS('working', 'isolation', 'shorter'), defaultRestS('working', 'isolation', 'shortest')]).toEqual([90, 75, 60]);
    expect([defaultRestS('round', 'isolation', 'normal'), defaultRestS('round', 'isolation', 'shorter'), defaultRestS('round', 'isolation', 'shortest')]).toEqual([90, 75, 60]);
    // Warm-ups and before a drop never change.
    expect(defaultRestS('warmup', 'main', 'shortest')).toBe(60);
    expect(defaultRestS('before_drop', 'isolation', 'shortest')).toBe(15);
  });

  it('the setting: Standard / Medium / Minimum rest, Minimum by default', () => {
    expect(FIT_REST_LEVEL_OPTIONS.map((l) => REST_LEVEL_NAMES[l])).toEqual(['Standard rest', 'Medium rest', 'Minimum rest']);
    expect(DEFAULT_FIT_REST_LEVEL).toBe('shortest');
    expect(fitRestLevelOf(null)).toBe('shortest');
    expect(fitRestLevelOf({})).toBe('shortest');
    expect(fitRestLevelOf({ fitRestLevel: 'normal' })).toBe('normal');
  });
});

describe('fitToMinutes, shorter (Ben, 27 Oct)', () => {
  it('main lift rests are the same after any fit, at every length and every setting', () => {
    const { ctx, w } = chest();
    const before = restsOf(mainOf(w), w, ctx);
    for (const level of [undefined, 'normal', 'shorter', 'shortest'] as const)
      for (const m of [65, 60, 55, 50, 45, 40, 30, 20]) {
        const f = fitToMinutes(w, withLevel(ctx, level), { minutes: m, mainGroup: 'Chest', grow: false, supersets: false });
        const main = mainOf(f.workout);
        expect(restsOf(main, f.workout, ctx), `${String(level)} ${String(m)}`).toEqual(before);
        expect(main?.rows).toEqual(mainOf(w)?.rows);
      }
  });

  it('Minimum rest (default): isolation reaches 1:00, a compound accessory stops at 1:30', () => {
    const { ctx, w } = chest();
    const f = fitToMinutes(w, ctx, { minutes: estimateBuilderMinutes({ ...w, restLevel: 'shortest' }, ctx), mainGroup: 'Chest', grow: false, supersets: false });
    expect(f.workout.restLevel).toBe('shortest');
    expect(f.steps.every((s) => s.kind === 'rest')).toBe(true);
    const slot = (id: string) => all(f.workout).find((s) => s.exerciseId === id);
    const workRest = (id: string) => {
      const s = slot(id);
      const rests = restsOf(s, f.workout, ctx);
      return s === undefined ? [] : s.rows.flatMap((r, i) => (r.type === 'working' ? [rests[i]] : []));
    };
    expect(new Set(workRest('cable_fly'))).toEqual(new Set([60]));
    expect(new Set(workRest('incline_db'))).toEqual(new Set([90]));
    expect(new Set(workRest('machine_press'))).toEqual(new Set([90]));
  });

  it('a superset round goes to 1:00 at Minimum rest, 1:15 at Medium', () => {
    const { w } = chest(true);
    const pair = w.blocks.find((b) => b.slots.length > 1);
    expect(pair).toBeDefined();
    if (pair === undefined) return;
    expect(roundRestOf(pair, 'shortest')).toBe(60);
    expect(roundRestOf(pair, 'shorter')).toBe(75);
  });

  it('Standard rest: no rest step; straight to sets (rule F: the arm isolation\'s first)', () => {
    const { ctx, w } = chest();
    const f = fitToMinutes(w, withLevel(ctx, 'normal'), { minutes: estimateBuilderMinutes(w, ctx) - 3, mainGroup: 'Chest', grow: false, supersets: false });
    expect(f.workout.restLevel).toBe('normal');
    expect(f.steps.some((s) => s.kind === 'rest')).toBe(false);
    expect(f.steps.flatMap((s) => (s.kind === 'sets' || s.kind === 'drop' ? [s.exerciseId] : []))).toEqual(['pushdown']);
    expect(f.status).toBe('fitted');
  });

  it('Medium rest: one rest step, then sets; never Minimum', () => {
    const { ctx, w } = chest();
    const f = fitToMinutes(w, withLevel(ctx, 'shorter'), { minutes: estimateBuilderMinutes(w, ctx) - 6, mainGroup: 'Chest', grow: false, supersets: false });
    expect(f.steps.filter((s) => s.kind === 'rest')).toEqual([{ kind: 'rest', from: 'normal', to: 'shorter' }]);
    expect(f.workout.restLevel).toBe('shorter');
    expect(f.steps.some((s) => s.kind === 'sets')).toBe(true);
  });

  it('Minimum rest: Medium, then Minimum, then sets', () => {
    const { ctx, w } = chest();
    const f = fitToMinutes(w, ctx, { minutes: estimateBuilderMinutes(w, ctx) - 8, mainGroup: 'Chest', grow: false, supersets: false });
    expect(f.steps.filter((s) => s.kind === 'rest')).toEqual([
      { kind: 'rest', from: 'normal', to: 'shorter' },
      { kind: 'rest', from: 'shorter', to: 'shortest' },
    ]);
  });

  it('less rest allowed never leaves out more exercises (this day, 70 → 40 min)', () => {
    const { ctx, w } = chest();
    for (const m of [70, 65, 60, 55, 50, 45, 40]) {
      const kept = (['normal', 'shorter', 'shortest'] as const).map((l) => all(fitToMinutes(w, withLevel(ctx, l), { minutes: m, mainGroup: 'Chest', grow: false, supersets: false }).workout).length);
      expect(kept[1] ?? 0, String(m)).toBeGreaterThanOrEqual(kept[0] ?? 0);
      expect(kept[2] ?? 0, String(m)).toBeGreaterThanOrEqual(kept[1] ?? 0);
    }
  });

  it('trimming to 2 sets is preferred over leaving an exercise out wherever it fits (rule F: but an arm isolation goes first)', () => {
    const { ctx, w } = chest();
    // Each accessory at 2 sets: the shortest trim-only form.
    let trimmedAll = w;
    for (const s of all(w)) if (!s.main && working(s) > 2) trimmedAll = { ...trimmedAll, blocks: trimmedAll.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.key === s.key ? setWorkingCount(x, 2) : x)) })) };
    const floor = estimateBuilderMinutes({ ...trimmedAll, restLevel: 'shortest' }, ctx);
    for (let m = floor; m <= estimateBuilderMinutes(w, ctx); m += 1) {
      const f = fitToMinutes(w, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: false });
      // (Rule F, Ben 27 Oct) Only the arm isolation may be left out before the chest and abs lose a set.
      expect(ids(f.workout).filter((id) => id !== 'pushdown'), String(m)).toEqual(ids(w).filter((id) => id !== 'pushdown'));
      expect(f.steps.flatMap((s) => (s.kind === 'drop' ? [s.exerciseId] : [])), String(m)).toEqual(ids(f.workout).includes('pushdown') ? [] : ['pushdown']);
      expect(f.minutes).toBeLessThanOrEqual(m);
    }
    // Below that something has to go.
    const short = fitToMinutes(w, ctx, { minutes: floor - 3, mainGroup: 'Chest', grow: false, supersets: false });
    expect(short.steps.some((s) => s.kind === 'drop')).toBe(true);
  });

  it('the lowest-value sets go first: an isolation or abs set before a compound accessory set (the arm isolation first, rule F)', () => {
    const { ctx, w } = chest();
    // Just past Minimum rest: one set comes off.
    const atMin = estimateBuilderMinutes({ ...w, restLevel: 'shortest' }, ctx);
    const f = fitToMinutes(w, ctx, { minutes: atMin - 1, mainGroup: 'Chest', grow: false, supersets: false });
    const cut = f.steps.flatMap((s) => (s.kind === 'sets' ? [s.exerciseId] : []));
    expect(cut.length).toBeGreaterThan(0);
    for (const id of cut) expect(info(id)?.role).toBe('isolation');
    expect(cut).toEqual(['pushdown']);
  });

  // The fixture has no shoulder exercises, so the default Push mix is the Chest day's (bench, chest, triceps, abs).
  for (const [mix, main, group] of [
    ['chest', 'bench', 'Chest'],
    ['pull', 'row', 'Back'],
  ] as const)
    it(`a default ${mix} day built for 60 min, set to 45: the arm isolation left out first (rule F), nothing else left out or trimmed, ${main}'s sets and rests intact`, () => {
      const ctx = context();
      const setup = { minutes: 60, mainLiftExerciseId: main, supersets: false } as const;
      const groups = recommendForSetup(BUILDER_DAY_MIXES[mix], setup, pool, ctx).groups;
      const w = buildFromSetup({ ...setup, minutes: 999, groups }, pool, ctx).workout;
      expect(estimateBuilderMinutes(w, ctx)).toBeGreaterThan(45);
      const f = fitToMinutes(w, ctx, { minutes: 45, mainGroup: group, grow: false, supersets: false });
      expect(f.status).toBe('fitted');
      expect(f.minutes).toBeLessThanOrEqual(45);
      const arm = (id: string) => info(id)?.group === 'Arms';
      expect(ids(f.workout)).toEqual(ids(w).filter((id) => !arm(id)));
      expect(f.steps.flatMap((s) => (s.kind === 'drop' ? [s.exerciseId] : []))).toEqual(ids(w).filter(arm));
      // The day's main group and abs keep every set: the arm isolation went first.
      expect(f.steps.filter((s) => s.kind === 'sets' && !arm(s.exerciseId))).toEqual([]);
      expect(all(f.workout).every((s) => s.main || working(s) >= 2)).toBe(true);
      const lift = mainOf(f.workout);
      expect(lift?.exerciseId).toBe(main);
      expect(lift?.rows).toEqual(mainOf(w)?.rows);
      expect(restsOf(lift, f.workout, ctx)).toEqual(restsOf(mainOf(w), w, ctx));
      expect(fitNoteOf(f.steps, (id) => info(id)?.name ?? id, (k) => k).lines[0]).toBe('Minimum rest');
    });

  it('grow puts rests back to Standard first', () => {
    const { ctx, w } = chest();
    const shorter = fitToMinutes(w, ctx, { minutes: estimateBuilderMinutes(w, ctx) - 4, mainGroup: 'Chest', grow: false, supersets: false }).workout;
    const g = fitToMinutes(shorter, ctx, { minutes: 120, mainGroup: 'Chest', grow: true, supersets: false });
    expect(g.steps[0]).toEqual({ kind: 'rest', from: shorter.restLevel, to: 'normal' });
    expect(fitNoteOf(g.steps, (id) => id, (k) => k).lines[0]).toBe('Standard rest');
  });
});
