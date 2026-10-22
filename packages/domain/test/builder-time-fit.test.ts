import { describe, expect, it } from 'vitest';
import {
  applyBuilderEdit,
  estimateBuilderMinutes,
  fitToMinutes,
  fitWorkoutToTime,
  slotsOf,
  stepTimeMinutes,
  timeFitChanges,
  unfitWorkout,
  workingCount,
  type BuilderSlot,
  type BuilderTimeFit,
  type BuilderWorkout,
} from '../src/index';
import { context } from './builder-v3-fixture';
import { makeSlot } from '../src/builder/slot';

/**
 * Your workout's Time control (22 Oct, Ben: "add option to reduce time"; fit-to-time.md 22 Oct revision): Today's
 * built-in fit (`fitToMinutes`, shrink only) on today's draft, fitting every step from the workout as it was before
 * the first change, so more time brings back what it cut, up to the original and never more. Shorter rests first,
 * then accessory sets (not below 2), then whole exercises (abs first, compounds last), never the main lift; no
 * supersets made, no effort pushed, no load changed (kg, per-hand dumbbells, assisted machines alike).
 */

const ctx = context();
const slot = (exerciseId: string, opts: { main?: boolean; sets?: number } = {}): BuilderSlot => makeSlot(exerciseId, { main: opts.main ?? false, workingSets: opts.sets ?? 3 }, ctx);

/** Push: bench (main), incline DB press (per hand), fly + pushdown (a builder pair), assisted pull-up, crunch. */
function push(): BuilderWorkout {
  return {
    restLevel: 'normal',
    blocks: [
      { slots: [slot('bench', { main: true, sets: 4 })], auto: false },
      { slots: [slot('incline_db')], auto: false },
      { slots: [slot('cable_fly'), slot('pushdown')], auto: true, roundRestS: 75 },
      { slots: [slot('assisted_pullup')], auto: false },
      { slots: [slot('crunch')], auto: false },
    ],
  };
}

const at = (w: BuilderWorkout, minutes: number, fit: BuilderTimeFit | null, now: number) => fitWorkoutToTime({ current: w, fit, minutes: now, to: minutes, ctx, mainGroup: 'Chest', supersets: false });
const ids = (w: BuilderWorkout) => slotsOf(w.blocks).map((s) => s.exerciseId);
const shape = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => `${s.exerciseId}×${String(workingCount(s))}`).join('+'));

describe('fitWorkoutToTime', () => {
  const base = push();
  const full = estimateBuilderMinutes(base, ctx);

  it('a little shorter: rests first, nothing cut', () => {
    const r = at(base, full - 2, null, full);
    expect(r.fit).not.toBeNull();
    expect(r.workout.restLevel).not.toBe('normal');
    expect(shape(r.workout)).toEqual(shape(base));
    expect(r.minutes).toBe(full - 2);
  });

  it('much shorter: sets, then the abs and the other group’s isolation go first; never the main lift; no effort pushed; loads, units and conventions as they were', () => {
    const r = at(base, full - 20, null, full);
    const fit = r.fit;
    if (fit === null) throw new Error('no fit');
    expect(ids(r.workout)).toContain('bench');
    const bench = slotsOf(r.workout.blocks).find((s) => s.exerciseId === 'bench');
    expect(bench?.rows).toEqual(slotsOf(base.blocks).find((s) => s.exerciseId === 'bench')?.rows);
    expect(fit.dropped.length).toBeGreaterThan(0);
    // Abs are the first exercise to go, before any compound.
    const order = slotsOf(base.blocks);
    expect(order.find((s) => s.key === fit.dropped[0])?.exerciseId).toBe('crunch');
    expect(ids(r.workout)).toContain('incline_db');
    // Accessories never below 2 sets; no RPE pushed; every kept row's load, unit and convention unchanged.
    for (const s of slotsOf(r.workout.blocks)) {
      const was = order.find((x) => x.key === s.key);
      if (was === undefined) throw new Error('new slot');
      if (!s.main) expect(workingCount(s)).toBeGreaterThanOrEqual(Math.min(2, workingCount(was)));
      expect([s.unit, s.convention]).toEqual([was.unit, was.convention]);
      s.rows.forEach((row, i) => {
        expect(row.load).toBe(was.rows[i]?.load);
        expect(row.rpe).toBe(was.rows[i]?.rpe);
        expect(row.reps).toBe(was.rows[i]?.reps);
      });
    }
    expect(slotsOf(r.workout.blocks).find((s) => s.exerciseId === 'incline_db')?.convention).toBe('per_hand');
  });

  it('no superset is ever made (Supersets off is a hard rule, review V14): pairs only stay or shrink', () => {
    const solo: BuilderWorkout = { restLevel: 'normal', blocks: slotsOf(push().blocks).map((s) => ({ slots: [s], auto: false })) };
    const n = estimateBuilderMinutes(solo, ctx);
    for (const m of [n - 2, n - 10, n - 25, 15]) expect(at(solo, m, null, n).workout.blocks.every((b) => b.slots.length === 1)).toBe(true);
    for (const m of [full - 2, full - 10, full - 25, 15]) expect(at(base, m, null, full).workout.blocks.every((b) => b.slots.length <= 2)).toBe(true);
  });

  it('more time brings back what it cut, up to the original: at the length before the first change the workout is exactly the original; never more', () => {
    const short = at(base, full - 25, null, full);
    const mid = at(short.workout, full - 10, short.fit, short.minutes);
    // Path independent: the same as fitting the original straight to that length.
    expect(mid.workout).toEqual(at(base, full - 10, null, full).workout);
    const back = at(mid.workout, full, mid.fit, mid.minutes);
    expect(back.workout).toEqual(base);
    expect(back.fit).toBeNull();
    // Longer than it was: still the original, nothing added (rule 3: the built-in rule never invents work).
    const longer = at(short.workout, full + 30, short.fit, short.minutes);
    expect(longer.workout).toEqual(base);
    expect(longer.minutes).toBe(full + 30);
  });

  it('a dropped superset member comes back into its pair with the pair’s own `After each round`', () => {
    const short = at(base, 15, null, full);
    const keys = slotsOf(base.blocks).map((s) => s.key);
    const flyKey = keys[2] ?? '';
    const pdKey = keys[3] ?? '';
    expect(short.fit?.dropped).toEqual(expect.arrayContaining([pdKey]));
    const back = unfitWorkout(short.fit ?? { base, dropped: [] }, short.workout);
    const pair = back.blocks.find((b) => b.slots.some((s) => s.key === flyKey));
    expect(pair?.slots.map((s) => s.key)).toEqual([flyKey, pdKey]);
    expect(pair?.auto).toBe(true);
    expect(pair?.roundRestS).toBe(75);
  });

  it('Ben’s edits after a fit stay: his set edit, a slot he deleted, a slot he added; only what the fit cut comes back (a set it took from a slot he edited too)', () => {
    const short = at(base, full - 20, null, full);
    const fit = short.fit;
    if (fit === null) throw new Error('no fit');
    const incline = slotsOf(short.workout.blocks).find((s) => s.exerciseId === 'incline_db');
    const pull = slotsOf(short.workout.blocks).find((s) => s.exerciseId === 'assisted_pullup');
    if (incline === undefined || pull === undefined) throw new Error('missing');
    let w = short.workout;
    const e1 = applyBuilderEdit(w, { kind: 'edit_row', slotKey: incline.key, index: incline.rows.length - 1, patch: { kind: 'reps', reps: 12 } }, ctx);
    if (!e1.ok) throw new Error(e1.reason);
    const e2 = applyBuilderEdit(e1.workout, { kind: 'delete_exercise', slotKey: pull.key }, ctx);
    if (!e2.ok) throw new Error(e2.reason);
    const e3 = applyBuilderEdit(e2.workout, { kind: 'add_exercise', exerciseId: 'curl' }, ctx);
    if (!e3.ok) throw new Error(e3.reason);
    w = e3.workout;
    const back = at(w, full, fit, short.minutes);
    expect(ids(back.workout)).toContain('curl');
    expect(ids(back.workout)).not.toContain('assisted_pullup');
    for (const k of fit.dropped) if (k !== pull.key) expect(slotsOf(back.workout.blocks).some((s) => s.key === k)).toBe(true);
    const mine = slotsOf(back.workout.blocks).find((s) => s.key === incline.key);
    const his = slotsOf(e1.workout.blocks).find((s) => s.key === incline.key)?.rows ?? [];
    const was = slotsOf(base.blocks).find((s) => s.key === incline.key)?.rows ?? [];
    // His rows as he left them, then the original's sets the fit took (as they were).
    expect(fit.cut?.[incline.key] ?? 0).toBeGreaterThan(0);
    expect(mine?.rows).toEqual([...his, ...was.slice(his.length)]);
    expect(mine?.rows).toHaveLength(was.length);
    expect(back.workout.restLevel).toBe('normal');
  });

  it('only the main lift left and still over: says so; nothing below it', () => {
    const main: BuilderWorkout = { restLevel: 'normal', blocks: [{ slots: [slot('bench', { main: true, sets: 6 })], auto: false }] };
    const n = estimateBuilderMinutes(main, ctx);
    const r = at(main, 15, null, Math.max(n, 20));
    expect(slotsOf(r.workout.blocks)[0]?.rows).toHaveLength(slotsOf(main.blocks)[0]?.rows.length ?? -1);
    expect(r.over).toBe(n > 15);
  });
});

describe('timeFitChanges', () => {
  it('lists the rest level, sets fewer and what it left out; a slot Ben touched since still lists the sets the fit took', () => {
    const base = push();
    const full = estimateBuilderMinutes(base, ctx);
    const short = at(base, full - 20, null, full);
    const fit = short.fit;
    if (fit === null) throw new Error('no fit');
    const changes = timeFitChanges(fit, short.workout);
    expect(changes[0]).toMatchObject({ kind: 'rest', from: 'normal' });
    expect(changes.flatMap((c) => (c.kind === 'drop' ? [c.slotKey] : []))).toEqual(slotsOf(base.blocks).map((s) => s.key).filter((k) => fit.dropped.includes(k)));
    const cut = changes.find((c) => c.kind === 'sets');
    if (cut?.kind === 'sets') {
      const s = slotsOf(short.workout.blocks).find((x) => x.key === cut.slotKey);
      const touched = { ...short.workout, blocks: short.workout.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.key === s?.key ? { ...x, touched: true as const } : x)) })) };
      expect(timeFitChanges(fit, touched).find((c) => c.kind === 'sets' && c.slotKey === cut.slotKey)).toEqual(cut);
    }
    // With the original back there is nothing to list.
    expect(timeFitChanges({ ...fit, dropped: [] }, base)).toEqual([]);
  });
});

describe('a slot Ben edits after the fit cut it (22 Oct review)', () => {
  /** bench (main) ×4, incline ×4, fly ×4, pushdown ×4: as the reviewer's probe. */
  const four = (): BuilderWorkout => ({
    restLevel: 'normal',
    blocks: [slot('bench', { main: true, sets: 4 }), slot('incline_db', { sets: 4 }), slot('cable_fly', { sets: 4 }), slot('pushdown', { sets: 4 })].map((x) => ({ slots: [x], auto: false })),
  });
  const base = four();
  const full = estimateBuilderMinutes(base, ctx);
  const pushdownOf = (w: BuilderWorkout) => slotsOf(w.blocks).find((s) => s.exerciseId === 'pushdown');

  it('an RPE edit doesn’t lock the cut in: the detail still lists it, and more time (or Undo) brings the set back with his RPE kept', () => {
    const short = at(base, full - 12, null, full);
    const fit = short.fit;
    const pd = pushdownOf(short.workout);
    if (fit === null || pd === undefined) throw new Error('no fit');
    expect(workingCount(pd)).toBe(3);
    expect(fit.cut).toEqual({ [pd.key]: 1 });
    const e = applyBuilderEdit(short.workout, { kind: 'edit_row', slotKey: pd.key, index: 0, patch: { kind: 'rpe', rpe: 7 } }, ctx);
    if (!e.ok) throw new Error(e.reason);
    expect(timeFitChanges(fit, e.workout)).toContainEqual({ kind: 'sets', slotKey: pd.key, exerciseId: 'pushdown', from: 4, to: 3 });
    const back = at(e.workout, full, fit, full);
    const mine = pushdownOf(back.workout);
    expect(workingCount(mine ?? pd)).toBe(4);
    expect(mine?.rows[0]?.rpe).toBe(7);
    expect(mine?.rows.slice(1)).toEqual(slotsOf(base.blocks).find((s) => s.key === pd.key)?.rows.slice(1));
    expect(back.fit).toBeNull();
  });

  it('never past the original: a set Ben added back himself isn’t added again; one he removed himself stays removed', () => {
    const short = at(base, full - 12, null, full);
    const fit = short.fit;
    const pd = pushdownOf(short.workout);
    if (fit === null || pd === undefined) throw new Error('no fit');
    const added = applyBuilderEdit(short.workout, { kind: 'add_set', slotKey: pd.key }, ctx);
    if (!added.ok) throw new Error(added.reason);
    expect(workingCount(pushdownOf(unfitWorkout(fit, added.workout)) ?? pd)).toBe(4);
    expect(timeFitChanges(fit, added.workout).some((c) => c.kind === 'sets' && c.slotKey === pd.key)).toBe(false);
    const removed = applyBuilderEdit(short.workout, { kind: 'delete_set', slotKey: pd.key, index: pd.rows.length - 1 }, ctx);
    if (!removed.ok) throw new Error(removed.reason);
    expect(workingCount(pushdownOf(unfitWorkout(fit, removed.workout)) ?? pd)).toBe(3);
  });

  it('a fit stored before `cut` was recorded reads as before (his slot as he left it)', () => {
    const short = at(base, full - 12, null, full);
    const fit = short.fit;
    const pd = pushdownOf(short.workout);
    if (fit === null || pd === undefined) throw new Error('no fit');
    const e = applyBuilderEdit(short.workout, { kind: 'edit_row', slotKey: pd.key, index: 0, patch: { kind: 'rpe', rpe: 7 } }, ctx);
    if (!e.ok) throw new Error(e.reason);
    const old = { base: fit.base, fromMinutes: fit.fromMinutes, dropped: fit.dropped };
    expect(workingCount(pushdownOf(unfitWorkout(old, e.workout)) ?? pd)).toBe(3);
  });
});

describe('Today’s card fit is unchanged by Your workout’s Time (22 Oct review)', () => {
  it('an exercise with no builder group goes first only for Your workout’s Time (`noGroupFirst`); Today’s fit reads it as before', () => {
    const w: BuilderWorkout = {
      restLevel: 'normal',
      blocks: [slot('bench', { main: true, sets: 4 }), slot('incline_db', { sets: 3 }), slot('cable_fly', { sets: 3 }), slot('pushdown', { sets: 3 }), { ...slot('pushdown', { sets: 3 }), key: 'ride', exerciseId: 'rowing_machine' }].map((x) => ({ slots: [x], auto: false })),
    };
    const n = estimateBuilderMinutes(w, ctx);
    const today = fitToMinutes(w, ctx, { minutes: n - 20, mainGroup: 'Chest', grow: false, supersets: false });
    const yours = fitToMinutes(w, ctx, { minutes: n - 20, mainGroup: 'Chest', grow: false, supersets: false, pushEffort: false, noGroupFirst: true });
    const drops = (r: typeof today) => r.steps.flatMap((x) => (x.kind === 'drop' ? [x.slotKey] : []));
    expect(drops(yours)[0]).toBe('ride');
    // Today's card: the no-group exercise is read as the default (an isolation), not first.
    expect(drops(today)[0]).not.toBe('ride');
  });
});

describe('stepTimeMinutes', () => {
  it('5-minute steps as Today’s, from any length: down to the 5 below, up to the 5 above, 15–180', () => {
    expect([stepTimeMinutes(47, -1), stepTimeMinutes(47, 1)]).toEqual([45, 50]);
    expect([stepTimeMinutes(45, -1), stepTimeMinutes(45, 1)]).toEqual([40, 50]);
    expect([stepTimeMinutes(15, -1), stepTimeMinutes(180, 1)]).toEqual([15, 180]);
    expect(stepTimeMinutes(17, -1)).toBe(15);
  });
});
