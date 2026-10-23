import { describe, expect, it } from 'vitest';
import {
  applyBuilderEdit,
  estimateBuilderMinutes,
  fitToMinutes,
  fitWorkoutToTime,
  heldSets,
  slotsOf,
  stepTimeMinutes,
  timeFitChanges,
  unfitWorkout,
  withOriginalRows,
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
 * then (Supersets on only) pairs, then the least training lost (sets, never below 2, or whole exercises), never the main
 * lift; no effort pushed, no load changed (kg, per-hand dumbbells, assisted machines alike).
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

  it('much shorter: the cheapest cuts (22 Oct revision); never the main lift; no effort pushed; loads, units and conventions as they were', () => {
    const r = at(base, full - 20, null, full);
    const fit = r.fit;
    if (fit === null) throw new Error('no fit');
    expect(ids(r.workout)).toContain('bench');
    const bench = slotsOf(r.workout.blocks).find((s) => s.exerciseId === 'bench');
    expect(bench?.rows).toEqual(slotsOf(base.blocks).find((s) => s.exerciseId === 'bench')?.rows);
    expect(fit.dropped.length).toBeGreaterThan(0);
    expect(r.minutes).toBe(full - 20);
    expect(estimateBuilderMinutes(r.workout, ctx)).toBeLessThanOrEqual(full - 20);
    // Accessories never below 2 sets; no RPE pushed; every kept row's load, unit and convention unchanged.
    const order = slotsOf(base.blocks);
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
    // A little shorter, the abs (2.5 a set, Ben's choice) go before the compounds; a minute longer, sets go instead
    // (a fly, a pushdown and a crunch set lose 6, the crunch 7.5: the least training lost).
    const crunchKey = order.find((s) => s.exerciseId === 'crunch')?.key;
    expect(at(base, full - 16, null, full).fit?.dropped).toEqual([crunchKey]);
    expect(at(base, full - 15, null, full).fit?.dropped).toEqual([]);
    expect(slotsOf(at(base, full - 16, null, full).workout.blocks).find((s) => s.exerciseId === 'assisted_pullup')?.convention).toBe('assistance');
    expect(slotsOf(at(base, full - 16, null, full).workout.blocks).find((s) => s.exerciseId === 'incline_db')?.convention).toBe('per_hand');
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
    // 11 minutes shorter: rests, then one crunch set (the least lost when one cut is enough).
    const short = at(base, full - 11, null, full);
    const fit = short.fit;
    if (fit === null) throw new Error('no fit');
    const cutKey = Object.keys(fit.cut ?? {})[0] ?? '';
    const edited = slotsOf(short.workout.blocks).find((s) => s.key === cutKey);
    const pull = slotsOf(short.workout.blocks).find((s) => s.exerciseId === 'assisted_pullup');
    if (edited === undefined || pull === undefined) throw new Error('missing');
    expect(edited.exerciseId).toBe('crunch');
    let w = short.workout;
    const e1 = applyBuilderEdit(w, { kind: 'edit_row', slotKey: edited.key, index: edited.rows.length - 1, patch: { kind: 'reps', reps: 12 } }, ctx);
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
    const mine = slotsOf(back.workout.blocks).find((s) => s.key === edited.key);
    const his = slotsOf(e1.workout.blocks).find((s) => s.key === edited.key)?.rows ?? [];
    const was = slotsOf(base.blocks).find((s) => s.key === edited.key)?.rows ?? [];
    // His rows as he left them, then the original's sets the fit took (as they were).
    expect(fit.cut?.[edited.key] ?? 0).toBeGreaterThan(0);
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

describe('review R1: less time never makes an exercise Ben edited after a fit longer', () => {
  /** bench (main) ×4, incline ×4, fly ×4, pushdown ×4, lateral-like curl ×4 (the reviewer's probe shape). */
  const five = (): BuilderWorkout => ({
    restLevel: 'normal',
    blocks: [slot('bench', { main: true, sets: 4 }), slot('incline_db', { sets: 4 }), slot('cable_fly', { sets: 4 }), slot('pushdown', { sets: 4 }), slot('curl', { sets: 4 })].map((x) => ({ slots: [x], auto: false })),
  });
  const base = five();
  const full = estimateBuilderMinutes(base, ctx);
  const of = (w: BuilderWorkout, key: string) => slotsOf(w.blocks).find((s) => s.key === key);
  const firstCut = () => {
    // The first Time step that cuts a set (the last exercise goes first).
    for (let m = full - 1; m >= 15; m -= 1) {
      const r = at(base, m, null, full);
      const cutKey = Object.keys(r.fit?.cut ?? {})[0];
      if (r.fit !== null && cutKey !== undefined) return { r, fit: r.fit, key: cutKey, m };
    }
    throw new Error('no cut');
  };

  it('an RPE edit on a cut exercise, then Time down twice: its count never rises, his RPE stays, the detail still lists its cut; the full length (Undo) brings it all back', () => {
    const { r, fit, key, m } = firstCut();
    const cutTo = workingCount(of(r.workout, key) ?? slot('curl'));
    const e = applyBuilderEdit(r.workout, { kind: 'edit_row', slotKey: key, index: 0, patch: { kind: 'rpe', rpe: 7 } }, ctx);
    if (!e.ok) throw new Error(e.reason);
    let w = e.workout;
    let live: BuilderTimeFit | null = fit;
    for (const to of [m - 5, m - 10]) {
      const down = at(w, to, live, full);
      const mine = of(down.workout, key);
      expect(workingCount(mine ?? slot('curl'))).toBe(cutTo);
      expect(mine?.rows).toEqual(of(e.workout, key)?.rows);
      expect(down.fit).not.toBeNull();
      expect(timeFitChanges(down.fit ?? fit, down.workout)).toContainEqual({ kind: 'sets', slotKey: key, exerciseId: 'curl', from: 4, to: cutTo });
      // The others are cut harder only because less time was asked for, never to pay for his slot.
      for (const s of slotsOf(down.workout.blocks)) if (s.key !== key) expect(workingCount(s)).toBeLessThanOrEqual(workingCount(of(w, s.key) ?? s));
      w = down.workout;
      live = down.fit;
    }
    const back = at(w, full, live, full);
    expect(back.fit).toBeNull();
    expect(workingCount(of(back.workout, key) ?? slot('curl'))).toBe(4);
    expect(of(back.workout, key)?.rows[0]?.rpe).toBe(7);
    expect(of(back.workout, key)?.rows.slice(1)).toEqual(of(base, key)?.rows.slice(1));
    for (const s of slotsOf(base.blocks)) if (s.key !== key) expect(of(back.workout, s.key)?.rows).toEqual(s.rows);
  });

  it('a set Ben removed himself after the cut: Time down keeps his count; the full length gives back only what the fit took', () => {
    const { r, fit, key, m } = firstCut();
    const mine = of(r.workout, key);
    if (mine === undefined) throw new Error('no slot');
    const del = applyBuilderEdit(r.workout, { kind: 'delete_set', slotKey: key, index: mine.rows.length - 1 }, ctx);
    if (!del.ok) throw new Error(del.reason);
    const his = workingCount(of(del.workout, key) ?? mine);
    const down = at(del.workout, m - 5, fit, full);
    expect(workingCount(of(down.workout, key) ?? mine)).toBe(his);
    const back = at(down.workout, full, down.fit, full);
    expect(workingCount(of(back.workout, key) ?? mine)).toBe(his + (fit.cut?.[key] ?? 0));
  });

  it('more time, still short of the original: his exercise stays as he left it and its cut stays listed (the record isn’t lost when nothing else needs cutting)', () => {
    const { r, fit, key, m } = firstCut();
    const e = applyBuilderEdit(r.workout, { kind: 'edit_row', slotKey: key, index: 0, patch: { kind: 'rpe', rpe: 7 } }, ctx);
    if (!e.ok) throw new Error(e.reason);
    const deeper = at(e.workout, m - 10, fit, full);
    const up = at(deeper.workout, m, deeper.fit, full);
    expect(up.fit).not.toBeNull();
    expect(of(up.workout, key)?.rows).toEqual(of(e.workout, key)?.rows);
    expect(timeFitChanges(up.fit ?? fit, up.workout).some((c) => c.kind === 'sets' && c.slotKey === key)).toBe(true);
    // At `full - 0.5` worth of time but under the original length: nothing else cut, his cut still held.
    const nearly = at(up.workout, full - 1, up.fit, full);
    expect(of(nearly.workout, key)?.rows).toEqual(of(e.workout, key)?.rows);
    expect(nearly.fit?.cut?.[key]).toBe(fit.cut?.[key]);
  });

  it('`withOriginalRows`: a copy changed only by adding or pairing takes back the original’s rows and rests', () => {
    const { r, fit, key } = firstCut();
    const e = applyBuilderEdit(r.workout, { kind: 'edit_row', slotKey: key, index: 0, patch: { kind: 'rpe', rpe: 7 } }, ctx);
    if (!e.ok) throw new Error(e.reason);
    const original = unfitWorkout(fit, e.workout);
    const work = unfitWorkout(fit, e.workout, { hold: true });
    expect(heldSets(original, work)).toEqual({ [key]: fit.cut?.[key] });
    const added = applyBuilderEdit(work, { kind: 'add_exercise', exerciseId: 'crunch' }, ctx);
    if (!added.ok) throw new Error(added.reason);
    const back = withOriginalRows(original, added.workout);
    expect(of(back, key)?.rows).toEqual(of(original, key)?.rows);
    expect(ids(back)).toContain('crunch');
    expect(back.restLevel).toBe(original.restLevel);
  });
});

describe('Time with Supersets on (D9, 22 Oct revision): pairs are a free saving only when on', () => {
  const pairOf = (w: BuilderWorkout) => w.blocks.filter((b) => b.slots.length > 1).map((b) => b.slots.map((s) => s.key));
  it('Supersets on: singles may be paired before any cut, as builder pairs; Ben’s own pairs only stay or shrink; Supersets off: never', () => {
    const solo: BuilderWorkout = { restLevel: 'normal', blocks: slotsOf(push().blocks).map((s) => ({ slots: [s], auto: false })) };
    const n = estimateBuilderMinutes(solo, ctx);
    const fitAt = (w: BuilderWorkout, m: number, from: number, supersets: boolean) => fitWorkoutToTime({ current: w, fit: null, minutes: from, to: m, ctx, mainGroup: 'Chest', supersets });
    for (const m of [n - 2, n - 10, n - 25, 15]) expect(fitAt(solo, m, n, false).workout.blocks.every((b) => b.slots.length === 1)).toBe(true);
    const on = fitAt(solo, n - 15, n, true);
    expect(on.fit?.paired?.length ?? 0).toBeGreaterThan(0);
    for (const b of on.workout.blocks) if (b.slots.length > 1) expect(b.auto).toBe(true);
    expect(timeFitChanges(on.fit ?? { base: solo, fromMinutes: n, dropped: [] }, on.workout).some((c) => c.kind === 'pair')).toBe(true);
    // More time takes the pairs apart again: the original exactly.
    const back = fitWorkoutToTime({ current: on.workout, fit: on.fit, minutes: n, to: n, ctx, mainGroup: 'Chest', supersets: true });
    expect(back.workout).toEqual(solo);
    expect(unfitWorkout(on.fit ?? { base: solo, dropped: [] }, on.workout).blocks.every((b) => b.slots.length === 1)).toBe(true);
    // A workout with Ben's own pair: it stays or shrinks; any new pair is a builder pair.
    const own: BuilderWorkout = { ...push(), blocks: push().blocks.map((b) => (b.slots.length > 1 ? { ...b, auto: false } : b)) };
    const p = estimateBuilderMinutes(own, ctx);
    for (const m of [p - 2, p - 10, p - 25, 15]) {
      const r = fitAt(own, m, p, true);
      for (const b of r.workout.blocks) if (b.slots.length > 1 && !b.auto) expect(pairOf(own)).toContainEqual(b.slots.map((s) => s.key));
    }
  });
});

describe('a timed or cardio exercise under Time (review R3)', () => {
  const timed = (key: string, exerciseId: string, rows: BuilderSlot['rows']): BuilderSlot => ({ ...slot('crunch'), key, exerciseId, rows });
  const plank = timed('plank', 'crunch', [0, 1, 2].map(() => ({ type: 'working' as const, reps: 1, load: null, rpe: null, durationS: 60 })));
  const ride = timed('ride', 'rowing_machine', [{ type: 'working', reps: 1, load: null, rpe: null, durationS: 600, distanceM: 2000 }]);
  const of = (w: BuilderWorkout) => [slot('bench', { main: true, sets: 4 }), slot('incline_db', { sets: 3 }), ...w.blocks.flatMap((b) => b.slots)].map((x) => ({ slots: [x], auto: false }));
  /** Every kept row is the saved one (time, distance, RPE, load); the full length gives the saved workout back. */
  const asSaved = (w: BuilderWorkout, minutes: number, n: number) => {
    const r = at(w, minutes, null, n);
    for (const s of slotsOf(r.workout.blocks)) {
      const was = slotsOf(w.blocks).find((x) => x.key === s.key);
      s.rows.forEach((row, i) => {
        expect([row.durationS, row.distanceM, row.rpe, row.load]).toEqual([was?.rows[i]?.durationS, was?.rows[i]?.distanceM, was?.rows[i]?.rpe, was?.rows[i]?.load]);
      });
    }
    expect(at(r.workout, n, r.fit, n).workout).toEqual(w);
    return r;
  };

  it('a timed set (a plank, last): trimmed like any accessory (not below 2), each kept set still 1:00, and more time brings the third back', () => {
    const w: BuilderWorkout = { restLevel: 'normal', blocks: of({ restLevel: 'normal', blocks: [{ slots: [plank], auto: false }] }) };
    const n = estimateBuilderMinutes(w, ctx);
    let trimmed = false;
    for (let m = n - 1; m >= 15; m -= 1) {
      const r = asSaved(w, m, n);
      const p = slotsOf(r.workout.blocks).find((s) => s.key === 'plank');
      if (p !== undefined && workingCount(p) < 3) {
        trimmed = true;
        expect(workingCount(p)).toBeGreaterThanOrEqual(2);
        expect(r.fit?.cut?.plank).toBe(3 - workingCount(p));
      }
    }
    expect(trimmed).toBe(true);
  });

  it('cardio (a 10:00 · 2,000 m row, no builder group): left out first on Your workout, and back exactly as saved with more time', () => {
    const w: BuilderWorkout = { restLevel: 'normal', blocks: of({ restLevel: 'normal', blocks: [{ slots: [ride], auto: false }, { slots: [{ ...slot('cable_fly'), key: 'fly' }], auto: false }] }) };
    const n = estimateBuilderMinutes(w, ctx);
    let firstDrop: string | undefined;
    for (let m = n - 1; m >= 15 && firstDrop === undefined; m -= 1) firstDrop = asSaved(w, m, n).fit?.dropped[0];
    expect(firstDrop).toBe('ride');
  });
});

describe('keepEffort: kept sets keep their own RPE (review R3)', () => {
  it('a default-effort accessory cut to fewer sets keeps 8s (no RPE 9 bump); Ben’s own RPE on his exercise stays through steps down and the full length', () => {
    const flat = (exerciseId: string, rpes: number[]): BuilderSlot => {
      const s = slot(exerciseId, { sets: rpes.length });
      let k = 0;
      return { ...s, rows: s.rows.map((r) => (r.type === 'warmup' ? r : { ...r, rpe: rpes[k++] ?? r.rpe })) };
    };
    const w: BuilderWorkout = { restLevel: 'normal', blocks: [slot('bench', { main: true, sets: 4 }), flat('incline_db', [8, 8, 8, 8]), flat('cable_fly', [7, 7.5, 8, 8.5]), flat('pushdown', [8, 8, 8, 8])].map((x) => ({ slots: [x], auto: false })) };
    const n = estimateBuilderMinutes(w, ctx);
    const rpes = (x: BuilderWorkout, id: string) => slotsOf(x.blocks).find((s) => s.exerciseId === id)?.rows.filter((r) => r.type !== 'warmup').map((r) => r.rpe);
    for (let m = n - 1; m >= n - 12; m -= 1) {
      const r = at(w, m, null, n);
      for (const id of ['incline_db', 'cable_fly', 'pushdown']) {
        const now = rpes(r.workout, id);
        if (now !== undefined) expect(now).toEqual(rpes(w, id)?.slice(0, now.length));
      }
    }
    // Ben's own RPE on the exercise the fit cut, through two steps down and back.
    let m0 = n - 1;
    while (m0 > 15 && Object.keys(at(w, m0, null, n).fit?.cut ?? {}).length === 0) m0 -= 1;
    const cut = at(w, m0, null, n);
    const key = Object.keys(cut.fit?.cut ?? {})[0];
    const target = slotsOf(cut.workout.blocks).find((s) => s.key === key);
    if (cut.fit === null || target === undefined) throw new Error('no cut');
    const at0 = target.rows.findIndex((r) => r.type !== 'warmup');
    const e = applyBuilderEdit(cut.workout, { kind: 'edit_row', slotKey: target.key, index: at0, patch: { kind: 'rpe', rpe: 6.5 } }, ctx);
    if (!e.ok) throw new Error(e.reason);
    const d1 = at(e.workout, m0 - 5, cut.fit, n);
    const d2 = at(d1.workout, m0 - 10, d1.fit, n);
    const back = at(d2.workout, n, d2.fit, n);
    for (const x of [d1.workout, d2.workout, back.workout]) expect(slotsOf(x.blocks).find((s) => s.key === key)?.rows[at0]?.rpe).toBe(6.5);
  });
});

describe('review N3: an exercise the fit left out that Ben added back himself', () => {
  it('doesn’t come back a second time, and the detail stops listing it as dropped', () => {
    const base = push();
    const full = estimateBuilderMinutes(base, ctx);
    const short = at(base, full - 16, null, full);
    const fit = short.fit;
    const crunchKey = slotsOf(base.blocks).find((s) => s.exerciseId === 'crunch')?.key ?? '';
    if (fit === null || !fit.dropped.includes(crunchKey)) throw new Error('crunch not dropped');
    const added = applyBuilderEdit(short.workout, { kind: 'add_exercise', exerciseId: 'crunch' }, ctx);
    if (!added.ok) throw new Error(added.reason);
    expect(timeFitChanges(fit, added.workout).some((c) => c.kind === 'drop' && c.exerciseId === 'crunch')).toBe(false);
    const back = at(added.workout, full, fit, full);
    expect(ids(back.workout).filter((x) => x === 'crunch')).toHaveLength(1);
    // An exercise listed twice in the original, one copy dropped: that copy still comes back.
    const twice: BuilderWorkout = { restLevel: 'normal', blocks: [slot('bench', { main: true, sets: 4 }), slot('incline_db'), { ...slot('crunch'), key: 'crunch-2' }, slot('crunch')].map((x) => ({ slots: [x], auto: false })) };
    const t = estimateBuilderMinutes(twice, ctx);
    const cutTwice = at(twice, 15, null, t);
    const left = (cutTwice.fit?.dropped ?? []).filter((k) => slotsOf(twice.blocks).find((s) => s.key === k)?.exerciseId === 'crunch');
    if (left.length === 1) expect(ids(at(cutTwice.workout, t, cutTwice.fit, t).workout).filter((x) => x === 'crunch')).toHaveLength(2);
  });
});

describe('one shared fit for Today and Your workout (22 Oct revision, D9)', () => {
  it('an exercise with no builder group is an extra (1.5 a set): cut first by Today’s fit and Your workout’s Time alike', () => {
    const w: BuilderWorkout = {
      restLevel: 'normal',
      blocks: [slot('bench', { main: true, sets: 4 }), slot('incline_db', { sets: 3 }), slot('cable_fly', { sets: 3 }), slot('pushdown', { sets: 3 }), { ...slot('pushdown', { sets: 3 }), key: 'ride', exerciseId: 'rowing_machine' }].map((x) => ({ slots: [x], auto: false })),
    };
    const n = estimateBuilderMinutes(w, ctx);
    const today = fitToMinutes(w, ctx, { minutes: n - 16, mainGroup: 'Chest', grow: false, supersets: false });
    const yours = fitToMinutes(w, ctx, { minutes: n - 16, mainGroup: 'Chest', grow: false, supersets: false, pushEffort: false });
    expect(yours).toEqual(today);
    const cuts = today.steps.filter((x) => x.kind === 'sets' || x.kind === 'drop');
    expect(cuts).toEqual([{ kind: 'drop', slotKey: 'ride', exerciseId: 'rowing_machine' }]);
    // A little shorter, a set off the ride first.
    const less = fitToMinutes(w, ctx, { minutes: n - 12, mainGroup: 'Chest', grow: false, supersets: false });
    expect(less.steps.filter((x) => x.kind === 'sets' || x.kind === 'drop').map((x) => ('slotKey' in x ? x.slotKey : ''))).toEqual(['ride']);
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
