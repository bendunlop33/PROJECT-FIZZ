import { describe, expect, it } from 'vitest';
import type { CoachTarget, NextSessionTarget, PainFlag, SessionAggregate, SessionExercise } from '@fizz/schemas';
import {
  calculateNextTargets,
  getAchievableLoads,
  isInStallResetBand,
  stallResetLoad,
  stallResetPercent,
  validateNextSessionTargets,
  type HistorySession,
  type NextSessionBasis,
  type NextTargetsInput,
} from '../src/index';
import { assisted, barbell, doubleProgression, dumbbells, id, kg, lb, OWNER, stack } from './fixtures';
import type { EquipmentInstance, Load } from '@fizz/schemas';

/**
 * (Ben, 23 Oct; ADR 0006 amendment) The stall reset stays in playbook rule 8's 5–10% band: the achievable load
 * nearest a 10% cut within it, or, with nothing in the band (coarse kit), one step easier.
 */
describe('stallResetLoad (pure)', () => {
  const loads = (eq: EquipmentInstance) => getAchievableLoads(eq).loads;

  it('barbell, 2.5 kg steps: 60 → 55 (−8.3%), not 52.5 (−12.5%); 100 → 90; 140 → 127.5', () => {
    const bar = loads(barbell());
    expect(stallResetLoad(60, bar, 'resistance')).toBe(55);
    expect(stallResetLoad(100, bar, 'resistance')).toBe(90);
    expect(stallResetLoad(140, bar, 'resistance')).toBe(127.5);
  });

  it('lb barbell with 5 lb steps: 135 → 125 (−7.4%; 121.5 isn’t achievable)', () => {
    const lbBar = loads(barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] }));
    expect(stallResetLoad(135, lbBar, 'resistance')).toBe(125);
  });

  it('coarse per-hand dumbbells: nothing in the band, so one step down, never two', () => {
    const db = loads(dumbbells({ loads: [8, 10, 12, 14] }));
    // 12 → band 10.8–11.4: none; one step down is 10 (−16.7%), not 8.
    expect(stallResetLoad(12, db, 'resistance')).toBe(10);
    const fine = loads(dumbbells());
    // 20 each (2.5 kg steps) → band 18–19: none → 17.5; 30 each → band 27–28.5 → 27.5.
    expect(stallResetLoad(20, fine, 'resistance')).toBe(17.5);
    expect(stallResetLoad(30, fine, 'resistance')).toBe(27.5);
  });

  it('weight stack: 50 → 45 (−10%); 40 → 35 on 5 kg plates (nothing in 36–38); 40 → 37.5 with a 2.5 kg add-on', () => {
    expect(stallResetLoad(50, loads(stack()), 'resistance')).toBe(45);
    expect(stallResetLoad(40, loads(stack()), 'resistance')).toBe(35);
    const half = loads(stack({ stackLoads: [30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50] }));
    expect(stallResetLoad(40, half, 'resistance')).toBe(37.5);
    expect(stallResetLoad(50, half, 'resistance')).toBe(45);
  });

  it('assisted: easier is more assistance; 20 → 25 on 5 kg steps (nothing in 21–22); 30 → 33 on 1 kg steps', () => {
    expect(stallResetLoad(20, loads(assisted()), 'assistance')).toBe(25);
    expect(stallResetLoad(30, [28, 29, 30, 31, 32, 33, 34, 35], 'assistance')).toBe(33);
  });

  it('no equipment: the exact 10% cut; nothing easier: null; equipment max respected (never a heavier load)', () => {
    expect(stallResetLoad(60, null, 'resistance')).toBe(54);
    expect(stallResetLoad(5, loads(stack()), 'resistance')).toBeNull();
    expect(stallResetLoad(40, loads(assisted()), 'assistance')).toBeNull();
    // Above the stack's max (an old load), the reset is still an achievable load, never extrapolated.
    expect(stallResetLoad(60, loads(stack()), 'resistance')).toBe(50);
  });

  it('a rule asking for more than 10% or less than 5% is held to the band', () => {
    expect(stallResetPercent(20)).toBe(10);
    expect(stallResetPercent(2)).toBe(5);
    expect(stallResetLoad(60, loads(barbell()), 'resistance', 20)).toBe(55);
    // Target 5% (57); 57.5 is −4.2%, outside the band, so 55.
    expect(stallResetLoad(60, loads(barbell()), 'resistance', 5)).toBe(55);
    expect(isInStallResetBand(60, 55, 'resistance')).toBe(true);
    expect(isInStallResetBand(60, 52.5, 'resistance')).toBe(false);
    expect(isInStallResetBand(60, 57.5, 'resistance')).toBe(false);
  });
});

let n = 900;
function session(day: number, equipmentId: string, load: Load, reps: number[]): HistorySession {
  n += 1;
  return {
    sessionId: id(n),
    performedAtUtc: `2026-10-${String(day).padStart(2, '0')}T06:00:00.000Z`,
    equipmentId,
    gymId: null,
    imported: false,
    sets: reps.map((r) => ({ setType: 'working', side: null, load, reps: r, rpe: null, rir: null })),
  };
}
function input(eq: EquipmentInstance, load: Load, over: Partial<NextTargetsInput> = {}): NextTargetsInput {
  return {
    exerciseName: 'Lift',
    measurement: 'reps',
    history: [session(1, eq.id, load, [5, 5, 4]), session(4, eq.id, load, [5, 4, 4])],
    rule: doubleProgression(),
    equipment: eq,
    unit: load.unit,
    convention: eq.loadConvention,
    pain: { active: false, reportedAtUtc: null },
    ...over,
  };
}

describe('the built-in rule’s stall reset uses the band (calculateNextTargets)', () => {
  it('barbell 60 kg: offers 55 kg, and plans 55 kg once Ben applies it', () => {
    const offer = calculateNextTargets(input(barbell(), kg(60)));
    expect(offer.resetOffer).toEqual(kg(60 - 5));
    expect(offer.explanation.summary).toBe('Repeat 60 kg for 6–8 reps, or reset to 55 kg.');
    const applied = calculateNextTargets(input(barbell(), kg(60), { acceptReset: true }));
    expect([applied.decision, applied.sets[0]?.load]).toEqual(['reduce_load', kg(55)]);
  });

  it('coarse per-hand dumbbells 12 kg each: one step down to 10 kg each', () => {
    const db = dumbbells({ loads: [8, 10, 12, 14] });
    expect(calculateNextTargets(input(db, kg(12, 'per_hand'))).resetOffer).toEqual(kg(10, 'per_hand'));
  });

  it('stack 40 kg on 5 kg plates: 35; stack 50: 45', () => {
    expect(calculateNextTargets(input(stack(), kg(40, 'stack'))).resetOffer).toEqual(kg(35, 'stack'));
    expect(calculateNextTargets(input(stack(), kg(50, 'stack'))).resetOffer).toEqual(kg(45, 'stack'));
  });
});

describe('the coach’s stall reset goes no deeper than the band (validateNextSessionTargets)', () => {
  const bench = { id: id(9101), sessionId: id(8000), exerciseId: id(7101), exerciseName: 'Bench press', measurement: 'reps', laterality: 'bilateral', equipmentId: barbell().id, loadConvention: 'total', unit: 'kg', order: 1 } as unknown as SessionExercise;
  const t = (load: number, min = 6, max = 8): CoachTarget => ({ load: kg(load), reps: { min, max } });
  const basis = (stalled: boolean, eq: EquipmentInstance = barbell(), last: CoachTarget = t(60)): NextSessionBasis => ({ exercise: bench, equipment: eq, last, lastSets: 3, builtIn: { target: last, sets: 3 }, ...(stalled ? { stalled: true } : {}) });
  const source = { session: { id: id(8000) } } as unknown as SessionAggregate;
  const ask = (target: CoachTarget): NextSessionTarget => ({ exerciseId: bench.exerciseId, target, sets: null, reason: 'Stalled twice.' });
  const ctx = { benAskedForMoreSets: false };

  it('60 → 50 on a stalled lift becomes 55, with a note; 55 and a lighter 57.5 (with a rep-scheme change) stand', () => {
    const deep = validateNextSessionTargets({ source, bases: [basis(true)], targets: [ask(t(50))], painFlags: [], gymName: null, ctx });
    expect(deep.rows[0]?.after.load).toEqual(kg(55));
    expect(deep.rows[0]?.guardNotes.map((x) => x.kind)).toEqual(['reset_band']);
    expect(deep.rows[0]?.guardNotes[0]?.text.replace(/\u00a0/g, ' ')).toBe('Reset limited to 55 kg');
    expect(deep.rows[0]?.pctChange).toBe(-8.3);
    const inBand = validateNextSessionTargets({ source, bases: [basis(true)], targets: [ask(t(55))], painFlags: [], gymName: null, ctx });
    expect([inBand.rows[0]?.after.load, inBand.rows[0]?.guardNotes]).toEqual([kg(55), []]);
    const lighter = validateNextSessionTargets({ source, bases: [basis(true)], targets: [ask(t(57.5, 4, 6))], painFlags: [], gymName: null, ctx });
    expect(lighter.rows[0]?.after).toEqual(t(57.5, 4, 6));
  });

  it('not stalled, or a pain flag on it: the coach’s cut is left as asked', () => {
    const free = validateNextSessionTargets({ source, bases: [basis(false)], targets: [ask(t(50))], painFlags: [], gymName: null, ctx });
    expect(free.rows[0]?.after.load).toEqual(kg(50));
    const flag = { exerciseId: bench.exerciseId, status: 'active', area: 'shoulder', ownerId: OWNER } as unknown as PainFlag;
    const pain = validateNextSessionTargets({ source, bases: [basis(true)], targets: [ask(t(50))], painFlags: [flag], gymName: null, ctx });
    expect(pain.rows[0]?.after.load).toEqual(kg(50));
  });

  it('coarse dumbbells: one step down stands; two steps comes back to one', () => {
    const db = dumbbells({ loads: [8, 10, 12, 14] });
    const curl = { ...bench, loadConvention: 'per_hand', equipmentId: db.id } as unknown as SessionExercise;
    const last: CoachTarget = { load: kg(12, 'per_hand'), reps: { min: 8, max: 10 } };
    const b: NextSessionBasis = { exercise: curl, equipment: db, last, lastSets: 3, builtIn: { target: last, sets: 3 }, stalled: true };
    const at = (v: number): NextSessionTarget => ({ exerciseId: curl.exerciseId, target: { load: kg(v, 'per_hand'), reps: { min: 8, max: 10 } }, sets: null, reason: 'Stalled.' });
    expect(validateNextSessionTargets({ source, bases: [b], targets: [at(10)], painFlags: [], gymName: null, ctx }).rows[0]?.after.load).toEqual(kg(10, 'per_hand'));
    expect(validateNextSessionTargets({ source, bases: [b], targets: [at(8)], painFlags: [], gymName: null, ctx }).rows[0]?.after.load).toEqual(kg(10, 'per_hand'));
  });

  it('lb and assisted: by their own unit and direction', () => {
    const lbBar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
    const lbLast: CoachTarget = { load: lb(135), reps: { min: 5, max: 5 } };
    const lbRow = validateNextSessionTargets({ source, bases: [{ ...basis(true, lbBar, lbLast) }], targets: [{ exerciseId: bench.exerciseId, target: { load: lb(115), reps: { min: 5, max: 5 } }, sets: null, reason: 'x' }], painFlags: [], gymName: null, ctx });
    expect(lbRow.rows[0]?.after.load).toEqual(lb(125));
    const m = assisted();
    const pull = { ...bench, loadConvention: 'assistance', equipmentId: m.id } as unknown as SessionExercise;
    const aLast: CoachTarget = { load: kg(20, 'assistance'), reps: { min: 6, max: 8 } };
    const aRow = validateNextSessionTargets({ source, bases: [{ exercise: pull, equipment: m, last: aLast, lastSets: 3, builtIn: { target: aLast, sets: 3 }, stalled: true }], targets: [{ exerciseId: pull.exerciseId, target: { load: kg(35, 'assistance'), reps: { min: 6, max: 8 } }, sets: null, reason: 'x' }], painFlags: [], gymName: null, ctx });
    expect(aRow.rows[0]?.after.load).toEqual(kg(25, 'assistance'));
  });
});
