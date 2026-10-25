import { describe, expect, it } from 'vitest';
import {
  BUILDER_SUB_ROLES,
  estimateBuilderMinutes,
  fitToMinutes,
  settleWarmups,
  slotsOf,
  subRoleGuards,
  workingCount,
  type BuilderContext,
  type BuilderExerciseInfo,
  type BuilderSlot,
  type BuilderWorkout,
} from '../src/index';
import { makeSlot } from '../src/builder/slot';
import { context, info as fixtureInfo } from './builder-v3-fixture';

/**
 * (Ben, 24 Oct) Time's fit keeps sub-role coverage: on a Back day a vertical pull and a row stay while anything else
 * can go; then they keep their place with fewer sets; still too long, the row goes before the vertical pull; only then
 * is coverage given up. Generic over `BUILDER_SUB_ROLES` (only Back defines main sub-roles today).
 */

const extra: Record<string, Omit<BuilderExerciseInfo, 'exerciseId'>> = {
  deadlift: { name: 'Deadlift', group: 'Back', role: 'compound', heavy: true, angle: 'Lower back', muscles: ['lower back', 'glutes', 'hamstrings'], barbell: true, part: 'Back' },
  cable_row: { name: 'Seated cable row', group: 'Back', role: 'compound', heavy: false, angle: 'Mid-back', muscles: ['mid-back', 'lats', 'biceps'], barbell: false, part: 'Back' },
  db_row: { name: 'One-arm dumbbell row', group: 'Back', role: 'compound', heavy: false, angle: 'Mid-back', muscles: ['mid-back', 'lats', 'biceps'], barbell: false, part: 'Back' },
  face_pull: { name: 'Face pull', group: 'Back', role: 'isolation', heavy: false, angle: 'Rear delts', muscles: ['rear delts', 'mid-back'], barbell: false, part: 'Back' },
  shrug: { name: 'Dumbbell shrug', group: 'Back', role: 'isolation', heavy: false, angle: 'Mid-back', muscles: ['traps'], barbell: false, part: 'Back' },
};

const base = context();
const ctx: BuilderContext = {
  ...base,
  info: (id) => {
    const e = extra[id];
    return e === undefined ? fixtureInfo(id) : { ...e, exerciseId: id };
  },
};
const slot = (exerciseId: string, sets: number, main = false): BuilderSlot => makeSlot(exerciseId, { main, workingSets: sets }, ctx);

/** A Back day: deadlift (main), lat pulldown, seated cable row, face pull, shrug, curl. */
function backDay(over: { pull?: string; row?: string; extraRow?: boolean } = {}): BuilderWorkout {
  return settleWarmups(
    {
      restLevel: 'normal',
      blocks: [
        { slots: [slot('deadlift', 4, true)], auto: false },
        { slots: [slot(over.pull ?? 'lat_pulldown', 4)], auto: false },
        { slots: [slot(over.row ?? 'cable_row', 4)], auto: false },
        ...(over.extraRow ? [{ slots: [slot('db_row', 3)], auto: false }] : []),
        { slots: [slot('face_pull', 3)], auto: false },
        { slots: [slot('shrug', 3)], auto: false },
        { slots: [slot('curl', 3)], auto: false },
      ],
    },
    ctx,
  );
}

const fit = (w: BuilderWorkout, minutes: number, mainGroup: 'Back' | 'Chest' = 'Back') => fitToMinutes(w, ctx, { minutes, mainGroup, grow: false, supersets: false });
const setsOf = (w: BuilderWorkout, id: string): number => {
  const s = slotsOf(w.blocks).find((x) => x.exerciseId === id);
  return s === undefined ? 0 : workingCount(s);
};
const others = ['face_pull', 'shrug', 'curl'];

describe('time fit keeps sub-role coverage (Ben, 24 Oct)', () => {
  const w = backDay();
  const full = estimateBuilderMinutes(w, ctx);

  it('the guards: one exercise per main sub-role of the day’s main group, the vertical pull first', () => {
    expect(BUILDER_SUB_ROLES.Back?.filter((r) => r.main).map((r) => r.role)).toEqual(['Lats', 'Mid-back']);
    expect(subRoleGuards(w, ctx.info, 'Back').map((g) => [g.role, g.slotKey.split('#')[0]])).toEqual([
      ['Lats', 'lat_pulldown'],
      ['Mid-back', 'cable_row'],
    ]);
    // Rear delts and traps are not main sub-roles; a day whose main group has none has no guards.
    expect(subRoleGuards(w, ctx.info, 'Chest')).toEqual([]);
    expect(subRoleGuards(w, ctx.info, null)).toEqual([]);
  });

  it('a sub-role the main lift (never cut) already covers needs no guard; a second row is not guarded', () => {
    const rowMain = settleWarmups({ restLevel: 'normal', blocks: [{ slots: [slot('row', 4, true)], auto: false }, { slots: [slot('lat_pulldown', 4)], auto: false }, { slots: [slot('cable_row', 3)], auto: false }] }, ctx);
    expect(subRoleGuards(rowMain, ctx.info, 'Back').map((g) => g.role)).toEqual(['Lats']);
    const two = backDay({ extraRow: true });
    expect(subRoleGuards(two, ctx.info, 'Back').filter((g) => g.role === 'Mid-back').map((g) => g.slotKey.split('#')[0])).toEqual(['cable_row']);
  });

  it('at every shorter length: other exercises go before a set of the vertical pull or the row is cut; the row goes before the vertical pull', () => {
    let sawSetsCut = false;
    let sawRowDropped = false;
    for (let m = full; m >= 15; m -= 1) {
      const r = fit(w, m);
      const pull = setsOf(r.workout, 'lat_pulldown');
      const row = setsOf(r.workout, 'cable_row');
      // The main lift is never cut.
      expect(setsOf(r.workout, 'deadlift'), `${String(m)} min`).toBe(4);
      if (pull > 0 && (pull < 4 || row < 4)) {
        // While coverage holds, a guarded exercise lost sets (or the row went) only once every other one is gone.
        for (const o of others) expect(setsOf(r.workout, o), `${String(m)} min: ${o}`).toBe(0);
        sawSetsCut = true;
      }
      // Row before vertical pull: the pulldown stays whenever it fits at 2 sets (19 min here); the row goes first.
      if (row === 0 && pull > 0) sawRowDropped = true;
      if (pull === 0) expect(m, `${String(m)} min: the vertical pull was dropped while it still fits`).toBeLessThan(19);
      if (row === 0) expect(m, `${String(m)} min: the row was dropped while both still fit at 2 sets`).toBeLessThan(24);
      if (r.status !== 'over') expect(estimateBuilderMinutes(r.workout, ctx)).toBeLessThanOrEqual(m);
    }
    expect(sawSetsCut).toBe(true);
    expect(sawRowDropped).toBe(true);
    // Shorter than even the vertical pull at 2 sets: coverage is given up, and the plain least-lost fit applies.
    const tiny = fit(w, 18);
    expect(setsOf(tiny.workout, 'lat_pulldown')).toBe(0);
  });

  it('the example ladder (Back day, 67 min): others first, then the row’s and the pull’s sets, then the row, then coverage', () => {
    const shape = (m: number) => slotsOf(fit(w, m).workout.blocks).map((s) => `${s.exerciseId}×${String(workingCount(s))}`).join(' ');
    expect(shape(32)).toBe('deadlift×4 lat_pulldown×4 cable_row×4');
    expect(shape(28)).toBe('deadlift×4 lat_pulldown×4 cable_row×2');
    expect(shape(24)).toBe('deadlift×4 lat_pulldown×2 cable_row×2');
    expect(shape(23)).toBe('deadlift×4 lat_pulldown×4');
    expect(shape(19)).toBe('deadlift×4 lat_pulldown×2');
  });

  it('kept at fewer sets, never below 2; the row goes only when both at 2 sets don’t fit', () => {
    const bothAtTwo = fit(w, 24);
    expect([setsOf(bothAtTwo.workout, 'lat_pulldown'), setsOf(bothAtTwo.workout, 'cable_row')]).toEqual([2, 2]);
    for (let m = full; m >= 15; m -= 1) {
      const r = fit(w, m);
      const pull = setsOf(r.workout, 'lat_pulldown');
      const row = setsOf(r.workout, 'cable_row');
      if (pull > 0) expect(pull).toBeGreaterThanOrEqual(2);
      if (row > 0) expect(row).toBeGreaterThanOrEqual(2);
      if (m >= 24) expect(Math.min(pull, row), `${String(m)} min`).toBeGreaterThanOrEqual(2);
    }
  });

  it('a second row isn’t guarded: it goes before any set of the guarded pair', () => {
    const two = backDay({ extraRow: true });
    const fullTwo = estimateBuilderMinutes(two, ctx);
    for (let m = fullTwo; m >= 15; m -= 1) {
      const r = fit(two, m);
      if (setsOf(r.workout, 'lat_pulldown') < 4 || setsOf(r.workout, 'cable_row') < 4) expect(setsOf(r.workout, 'db_row'), `${String(m)} min`).toBe(0);
    }
  });

  it('loads, units and conventions of what is kept are untouched (per-hand dumbbells and stacks alike)', () => {
    const r = fit(w, full - 15);
    const before = new Map(slotsOf(w.blocks).map((s) => [s.key, s]));
    for (const s of slotsOf(r.workout.blocks)) {
      const was = before.get(s.key);
      expect(was).toBeDefined();
      const kept = s.rows.filter((x) => x.type === 'working');
      const orig = was?.rows.filter((x) => x.type === 'working') ?? [];
      kept.forEach((row, i) => {
        expect(row.load).toEqual(orig[i]?.load);
      });
    }
  });

  it('days whose main group has no main sub-roles fit as before (no guard)', () => {
    const chest = settleWarmups({ restLevel: 'normal', blocks: [{ slots: [slot('bench', 4, true)], auto: false }, { slots: [slot('lat_pulldown', 3)], auto: false }, { slots: [slot('cable_row', 3)], auto: false }, { slots: [slot('cable_fly', 3)], auto: false }] }, ctx);
    const total = estimateBuilderMinutes(chest, ctx);
    // With Chest the main group, nothing is guarded: the fit is the plain least-lost one, which may drop a back compound.
    expect(subRoleGuards(chest, ctx.info, 'Chest')).toEqual([]);
    const r = fit(chest, total - 12, 'Chest');
    expect(r.status).not.toBe('fits');
  });
});
