import { describe, expect, it } from 'vitest';
import {
  applyBuilderEdit,
  fitToMinutes,
  fitWorkoutToTime,
  isFillRecord,
  replayedFitSteps,
  slotsOf,
  timeFitChanges,
  timeFitFromStored,
  timeFitToStored,
  todayTimeFit,
  unfitWorkout,
  workingCount,
  type BuilderSlot,
  type BuilderWorkout,
} from '../src/index';
import { context } from './builder-v3-fixture';
import { makeSlot } from '../src/builder/slot';

/**
 * Review todaylean B3 (23 Oct): Today's card filled above the plan's length (Time 90 on a 60-minute day) is recorded
 * as Time's: the plan day's draft is the base and the plan's length `fromMinutes`, with what the fill added and the
 * sets it raised. So the workout without Time (Start's prompt, the plan) and Time at or below the plan's length never
 * carry the fill, Ben's own edits stay his, and the record survives the stored round trip.
 */

const ctx = context();
const slot = (exerciseId: string, opts: { main?: boolean; sets?: number } = {}): BuilderSlot => makeSlot(exerciseId, { main: opts.main ?? false, workingSets: opts.sets ?? 3 }, ctx);
const shape = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => `${s.exerciseId}×${String(workingCount(s))}`).join('+'));

/** A short Push plan day: bench (main), incline DB, pushdown. */
function plan(): BuilderWorkout {
  return { restLevel: 'normal', blocks: [{ slots: [slot('bench', { main: true })], auto: false }, { slots: [slot('incline_db')], auto: false }, { slots: [slot('pushdown')], auto: false }] };
}

function filled(minutes = 90) {
  const base = plan();
  const r = fitToMinutes(base, ctx, { minutes, mainGroup: 'Chest', grow: true, supersets: false, addCandidates: { arm: ['curl'], mainGroup: ['cable_fly'] } });
  const fit = todayTimeFit(base, r.steps, 60, ctx, minutes);
  if (fit === null) throw new Error('no record');
  return { base, workout: r.workout, steps: r.steps, fit };
}

describe('todayTimeFit: a filled card', () => {
  it('keeps the plan day as base, the plan length as fromMinutes, what the fill added and raised, and its Time', () => {
    const { base, workout, fit } = filled();
    expect(slotsOf(workout.blocks).length).toBeGreaterThan(slotsOf(base.blocks).length);
    expect(isFillRecord(fit)).toBe(true);
    expect(fit.base).toBe(base);
    expect(fit.fromMinutes).toBe(60);
    expect(fit.filledTo).toBe(90);
    expect(fit.dropped).toEqual([]);
    expect(fit.cut).toBeUndefined();
    const added = new Set((fit.added ?? []).map((a) => a.slotKey));
    expect([...added].sort()).toEqual(slotsOf(workout.blocks).filter((s) => !slotsOf(base.blocks).some((b) => b.key === s.key)).map((s) => s.key).sort());
    for (const [k, n] of Object.entries(fit.raised ?? {})) {
      const was = slotsOf(base.blocks).find((s) => s.key === k);
      const now = slotsOf(workout.blocks).find((s) => s.key === k);
      expect(workingCount(now ?? { rows: [] }) - workingCount(was ?? { rows: [] })).toBe(n);
    }
    // (Ben, 28 Oct) The main lift is raised only once every accessory is at 4 (up to 5).
    const mainKey = slotsOf(base.blocks)[0]?.key ?? '';
    if (Object.keys(fit.raised ?? {}).includes(mainKey)) {
      for (const s of slotsOf(base.blocks)) if (!s.main) expect(workingCount(slotsOf(workout.blocks).find((x) => x.key === s.key) ?? { rows: [] })).toBe(4);
      expect(workingCount(slotsOf(workout.blocks).find((x) => x.key === mainKey) ?? { rows: [] })).toBeLessThanOrEqual(5);
    }
  });

  it('a card that fits as it is has no record; a cut one has no fill fields', () => {
    const base = plan();
    expect(todayTimeFit(base, [], 60, ctx, 60)).toBeNull();
    const r = fitToMinutes(base, ctx, { minutes: 15, mainGroup: 'Chest', grow: true, supersets: false });
    const cut = todayTimeFit(base, r.steps, 60, ctx, 15);
    expect(cut).not.toBeNull();
    expect(isFillRecord(cut)).toBe(false);
    expect(cut?.added).toBeUndefined();
  });
});

describe('unfitWorkout on a fill record', () => {
  it('gives back the plan day: the fill’s exercises and sets go, rests back to the plan’s', () => {
    const { base, workout, fit } = filled();
    expect(shape(unfitWorkout(fit, workout))).toEqual(shape(base));
    expect(shape(unfitWorkout(fit, workout, { hold: true }))).toEqual(shape(base));
    expect(unfitWorkout(fit, workout).restLevel).toBe(base.restLevel);
  });

  it('Ben’s own edits stay his: an extra main-lift set, a fill exercise he edited; the fill’s sets on his edited slot go', () => {
    const { base, workout, fit } = filled();
    const main = slotsOf(workout.blocks)[0];
    const raisedKey = Object.keys(fit.raised ?? {})[0];
    const addedKey = fit.added?.[0]?.slotKey;
    if (main === undefined || raisedKey === undefined || addedKey === undefined) throw new Error('fixture: needs a raised and an added slot');
    let w = workout;
    for (const op of [
      { kind: 'add_set', slotKey: main.key },
      { kind: 'add_set', slotKey: raisedKey },
      { kind: 'add_set', slotKey: addedKey },
    ] as const) {
      const r = applyBuilderEdit(w, op, ctx);
      if (!r.ok) throw new Error(r.reason);
      w = r.workout;
    }
    const back = unfitWorkout(fit, w);
    const count = (k: string) => workingCount(slotsOf(back.blocks).find((s) => s.key === k) ?? { rows: [] });
    // His extra set on the main lift stays; the fill's raise of it goes.
    expect(count(main.key)).toBe(workingCount(slotsOf(base.blocks)[0] ?? { rows: [] }) + 1);
    // The plan's 3, the fill's +1 gone, his +1 kept.
    const planCount = workingCount(slotsOf(base.blocks).find((s) => s.key === raisedKey) ?? { rows: [] });
    expect(count(raisedKey)).toBe(planCount + 1);
    // The fill's exercise he edited is his now.
    expect(slotsOf(back.blocks).some((s) => s.key === addedKey)).toBe(true);
    // An untouched fill exercise goes.
    for (const a of fit.added ?? []) if (a.slotKey !== addedKey) expect(slotsOf(back.blocks).some((s) => s.key === a.slotKey)).toBe(false);
  });

  it('a slot Ben cut below the plan’s count keeps his count (the fill never raises him back)', () => {
    const { workout, fit } = filled();
    const raisedKey = Object.keys(fit.raised ?? {})[0];
    if (raisedKey === undefined) throw new Error('fixture: needs a raised slot');
    let w = workout;
    for (let i = 0; i < 2; i += 1) {
      const rows = slotsOf(w.blocks).find((s) => s.key === raisedKey)?.rows ?? [];
      const r = applyBuilderEdit(w, { kind: 'delete_set', slotKey: raisedKey, index: rows.length - 1 }, ctx);
      if (!r.ok) throw new Error(r.reason);
      w = r.workout;
    }
    const mine = workingCount(slotsOf(w.blocks).find((s) => s.key === raisedKey) ?? { rows: [] });
    expect(workingCount(slotsOf(unfitWorkout(fit, w).blocks).find((s) => s.key === raisedKey) ?? { rows: [] })).toBe(mine);
  });
});

describe('timeFitChanges on a fill record', () => {
  it('lists the fill (added exercises, raised sets) as Today’s card does, nothing cut', () => {
    const { workout, fit, steps } = filled();
    const changes = timeFitChanges(fit, workout);
    const addKeys = (xs: typeof steps) => xs.flatMap((c) => (c.kind === 'add' ? [c.slotKey] : [])).sort();
    expect(addKeys(changes)).toEqual(addKeys(steps));
    expect(addKeys(changes).length).toBeGreaterThan(0);
    for (const c of changes) if (c.kind === 'sets') expect(c.to).toBeGreaterThan(c.from);
    expect(changes.some((c) => c.kind === 'drop')).toBe(false);
  });
});

describe('fitWorkoutToTime on a fill record', () => {
  const to = (w: BuilderWorkout, fit: ReturnType<typeof filled>['fit'], minutes: number) => fitWorkoutToTime({ current: w, fit, minutes: fit.fromMinutes, to: minutes, ctx, mainGroup: 'Chest', supersets: false });

  it('at or above the Time it filled to: the fill stays as it is', () => {
    const { workout, fit } = filled();
    for (const m of [90, 120]) {
      const r = to(workout, fit, m);
      expect(shape(r.workout)).toEqual(shape(workout));
      expect(r.fit).toBe(fit);
    }
  });

  it('at the plan’s length: the plan day, no record; shorter: fitted from the plan day, never naming the fill', () => {
    const { base, workout, fit } = filled();
    const at60 = to(workout, fit, 60);
    expect(shape(at60.workout)).toEqual(shape(base));
    expect(at60.fit).toBeNull();
    const at20 = to(workout, fit, 20);
    const direct = fitWorkoutToTime({ current: base, fit: null, minutes: 60, to: 20, ctx, mainGroup: 'Chest', supersets: false });
    expect(shape(at20.workout)).toEqual(shape(direct.workout));
    const planKeys = new Set(slotsOf(base.blocks).map((s) => s.key));
    for (const c of timeFitChanges(at20.fit ?? fit, at20.workout)) if (c.kind === 'drop' || c.kind === 'sets') expect(planKeys.has(c.slotKey)).toBe(true);
  });
});

describe('the stored record (timeFit) round trip', () => {
  it('keeps added, raised and filledTo', () => {
    const { fit } = filled();
    const codec = { info: ctx.info, catalogueIdOf: (id: string) => id, checkedOnOf: () => null };
    const back = timeFitFromStored(timeFitToStored(fit, codec));
    expect(back.added).toEqual(fit.added);
    expect(back.raised).toEqual(fit.raised);
    expect(back.filledTo).toBe(90);
    expect(back.fromMinutes).toBe(60);
    expect(shape(back.base)).toEqual(shape(fit.base));
  });
});

describe('replayedFitSteps keeps what the fill added', () => {
  it('an add step stays Time’s (its slot isn’t in the draft before the fill)', () => {
    const { base, steps } = filled();
    expect(replayedFitSteps(steps, base).filter((s) => s.kind === 'add')).toEqual(steps.filter((s) => s.kind === 'add'));
  });
});
