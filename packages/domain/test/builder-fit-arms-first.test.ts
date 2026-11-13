import { describe, expect, it } from 'vitest';
import {
  armsCutFirst,
  estimateBuilderMinutes,
  fitToMinutes,
  settleWarmups,
  slotsOf,
  workingCount,
  type BuilderContext,
  type BuilderGroupName,
  type BuilderSlot,
  type BuilderWorkout,
} from '../src/index';
import { makeSlot } from '../src/builder/slot';
import { context, info } from './builder-v3-fixture';

/**
 * Rule F (Ben, 27 Oct; redesign-27oct.md §F, fit-to-time.md revision 27 Oct (2)): on a day whose main group isn't Arms,
 * the arm isolations (biceps, triceps) are cut first: trimmed, then left out, before the day's own accessories (or any
 * other accessory) lose a set. The main lift is never cut; accessory rests (and pairs) still come first.
 */

const ctx: BuilderContext = context();
const slot = (exerciseId: string, sets: number, main = false): BuilderSlot => makeSlot(exerciseId, { main, workingSets: sets }, ctx);
const day = (...blocks: BuilderSlot[][]): BuilderWorkout => settleWarmups({ restLevel: 'normal', blocks: blocks.map((slots) => ({ slots, auto: slots.length > 1 })) }, ctx);
const setsOf = (w: BuilderWorkout, id: string): number => {
  const s = slotsOf(w.blocks).find((x) => x.exerciseId === id);
  return s === undefined ? 0 : workingCount(s);
};
const fit = (w: BuilderWorkout, minutes: number, mainGroup: BuilderGroupName | null, supersets = false) => fitToMinutes(w, ctx, { minutes, mainGroup, grow: false, supersets });

describe('armsCutFirst', () => {
  it('true for a biceps or triceps isolation on a Chest, Back, Shoulders or Legs day; never on an Arms day or with no main group', () => {
    for (const g of ['Chest', 'Back', 'Shoulders', 'Legs'] as const) {
      const f = armsCutFirst(info, g);
      expect(f({ exerciseId: 'curl' }), g).toBe(true);
      expect(f({ exerciseId: 'pushdown' }), g).toBe(true);
      expect(f({ exerciseId: 'cable_fly' }), g).toBe(false);
      expect(f({ exerciseId: 'crunch' }), g).toBe(false);
      expect(f({ exerciseId: 'unknown' }), g).toBe(false);
    }
    expect(armsCutFirst(info, 'Arms')({ exerciseId: 'curl' })).toBe(false);
    expect(armsCutFirst(info, null)({ exerciseId: 'curl' })).toBe(false);
  });

  it('an arm compound (close-grip bench, dips) is weighed as before', () => {
    const withDip = (id: string) => (id === 'dip' ? { exerciseId: 'dip', name: 'Dip', group: 'Arms' as const, role: 'compound' as const, heavy: false, part: 'triceps', muscles: ['triceps'], angle: 'Triceps', barbell: false } : info(id));
    expect(armsCutFirst(withDip, 'Chest')({ exerciseId: 'dip' })).toBe(false);
  });
});

describe('fitToMinutes with rule F', () => {
  /** A Legs day: squat (main), leg press, leg curl, curl, crunch. */
  const legs = day([slot('squat', 4, true)], [slot('leg_press', 3)], [slot('leg_curl', 3)], [slot('curl', 3)], [slot('crunch', 3)]);
  /** A Push day (Chest main) with Supersets on: bench, incline DB, fly, pushdown + crunch as a pair. */
  const push = day([slot('bench', 4, true)], [slot('incline_db', 3)], [slot('cable_fly', 3)], [slot('pushdown', 3), slot('crunch', 3)]);

  for (const [name, w, group, supersets] of [
    ['Legs', legs, 'Legs', false],
    ['Push, Supersets on', push, 'Chest', true],
  ] as const)
    it(`${name}: at every length the arm isolation is trimmed and left out before any other accessory loses a set; the main lift never changes`, () => {
      const full = estimateBuilderMinutes(w, ctx);
      const arm = slotsOf(w.blocks).find((s) => info(s.exerciseId)?.group === 'Arms');
      const main = slotsOf(w.blocks).find((s) => s.main);
      let sawArmOut = false;
      let sawOthersCut = false;
      for (let m = full; m >= 15; m -= 1) {
        const r = fit(w, m, group, supersets);
        const others = slotsOf(w.blocks).filter((s) => !s.main && s !== arm);
        const othersCut = others.some((s) => setsOf(r.workout, s.exerciseId) < workingCount(s));
        const armSets = setsOf(r.workout, arm?.exerciseId ?? '');
        if (othersCut) expect(armSets, `${String(m)} min`).toBe(0);
        sawArmOut ||= armSets === 0;
        sawOthersCut ||= othersCut;
        expect(slotsOf(r.workout.blocks).find((s) => s.main)).toEqual(main);
        if (r.status !== 'over') expect(r.minutes, `${String(m)} min`).toBeLessThanOrEqual(m);
      }
      expect(sawArmOut).toBe(true);
      expect(sawOthersCut).toBe(true);
    });

  it('rests come first (27 Oct order): a little shorter, the arm isolation keeps its sets', () => {
    const r = fit(legs, estimateBuilderMinutes(legs, ctx) - 2, 'Legs');
    expect(r.steps.every((s) => s.kind === 'rest')).toBe(true);
    expect(setsOf(r.workout, 'curl')).toBe(3);
  });

  it('trimmed before it is left out: one curl set first', () => {
    const full = estimateBuilderMinutes(legs, ctx);
    let m = full;
    while (m > 15 && !fit(legs, m, 'Legs').steps.some((s) => s.kind === 'sets' || s.kind === 'drop')) m -= 1;
    const first = fit(legs, m, 'Legs').steps.filter((s) => s.kind === 'sets' || s.kind === 'drop');
    expect(first).toEqual([{ kind: 'sets', slotKey: slotsOf(legs.blocks)[3]?.key, exerciseId: 'curl', from: 3, to: 2 }]);
  });

  it('on an Arms day the rule is off: nothing is left out while trimming fits', () => {
    const arms = day([slot('curl', 4, true)], [slot('pushdown', 3)], [slot('hammer', 3)], [slot('oh_ext', 3)], [slot('crunch', 3)]);
    const full = estimateBuilderMinutes(arms, ctx);
    let trimmedOnly = 0;
    for (let m = full; m >= 15; m -= 1) {
      const r = fit(arms, m, 'Arms');
      if (r.steps.some((s) => s.kind === 'drop')) break;
      if (r.steps.some((s) => s.kind === 'sets')) trimmedOnly += 1;
    }
    expect(trimmedOnly).toBeGreaterThan(0);
  });

  it('with the warm-ups it will get (`settle`): a pair partner left alone gets its warm-up and the fit still fits', () => {
    for (let m = estimateBuilderMinutes(push, ctx); m >= 25; m -= 1) {
      const r = fitToMinutes(push, ctx, { minutes: m, mainGroup: 'Chest', grow: false, supersets: true, settle: (x) => settleWarmups(x, ctx) });
      if (r.status === 'over') continue;
      expect(estimateBuilderMinutes(settleWarmups(r.workout, ctx), ctx), `${String(m)} min`).toBeLessThanOrEqual(m);
    }
  });
});
