import { describe, expect, it } from 'vitest';
import type { CoachTarget, NextSessionTarget, PainFlag, SessionAggregate, SessionExercise } from '@fizz/schemas';
import { classifyNextSessionChange, pctText, validateNextSessionTargets, type NextSessionBasis } from '../src/index';
import { assisted, barbell, dumbbells, id, kg, lb, OWNER } from './fixtures';

const t = (load: number | null, min: number, max: number, convention: 'total' | 'per_hand' | 'assistance' = 'total', unit: 'kg' | 'lb' = 'kg'): CoachTarget => ({
  load: load === null ? null : unit === 'kg' ? kg(load, convention) : lb(load, convention),
  reps: { min, max },
});
const ctx = { benAskedForMoreSets: false };

describe('classifyNextSessionChange (CA8, coach-adjustments check 27)', () => {
  const bar = barbell();
  it('one achievable step is small; two steps are bigger', () => {
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(97.5, 6, 8), 3, bar, ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(102.5, 6, 8), 3, bar, ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(90, 6, 8), 3, bar, ctx)).toMatchObject({ size: 'bigger', reasons: ['The load moves more than one step.'] });
  });

  it('coarse dumbbells: 10 → 12 kg each is the next step (+20%), small, and shows its %', () => {
    const db = dumbbells({ loads: [8, 10, 12, 14] });
    expect(classifyNextSessionChange(t(10, 8, 10, 'per_hand'), 3, t(12, 8, 10, 'per_hand'), 3, db, ctx).size).toBe('small');
    expect(pctText(20)).toBe('+20%');
    expect(pctText(-2.5)).toBe('−2.5%');
  });

  it('reps by at most 2 at either end; sets by at most one, +1 only when Ben asked (D1)', () => {
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 12), 3, bar, ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 12, 15), 3, bar, ctx).size).toBe('bigger');
    expect(classifyNextSessionChange(t(100, 8, 10), 4, t(100, 8, 10), 3, bar, ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 10), 4, bar, ctx)).toMatchObject({ size: 'small', setsAfter: 3, droppedExtraSet: true });
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 10), 4, bar, { benAskedForMoreSets: true })).toMatchObject({ size: 'small', setsAfter: 4, droppedExtraSet: false });
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 10), 5, bar, ctx).size).toBe('bigger');
  });

  it('assisted: one step less assistance is small; no equipment means a load change is bigger; a unit change is bigger', () => {
    expect(classifyNextSessionChange(t(30, 6, 8, 'assistance'), 3, t(25, 6, 8, 'assistance'), 3, assisted(), ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(102.5, 6, 8), 3, null, ctx).size).toBe('bigger');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(225, 6, 8, 'total', 'lb'), 3, bar, ctx).size).toBe('bigger');
  });
});

function exercise(n: number, name: string, convention: SessionExercise['loadConvention'], equipmentId: string | null): SessionExercise {
  return { id: id(9000 + n), sessionId: id(8000), exerciseId: id(7000 + n), exerciseName: name, measurement: 'reps', laterality: 'bilateral', equipmentId, loadConvention: convention, unit: 'kg', order: n, supersetGroup: null, progressionRuleId: null, notes: null } as unknown as SessionExercise;
}

const BENCH = exercise(1, 'Bench press', 'total', barbell().id);
const CURL = exercise(2, 'Dumbbell curl', 'per_hand', dumbbells().id);
const bases: NextSessionBasis[] = [
  { exercise: BENCH, equipment: barbell(), last: t(100, 6, 8), lastSets: 3, builtIn: { target: t(102.5, 6, 8), sets: 3 } },
  { exercise: CURL, equipment: dumbbells(), last: t(15, 8, 10, 'per_hand'), lastSets: 3, builtIn: { target: t(15, 9, 11, 'per_hand'), sets: 3 } },
];
const source = { session: { id: id(8000) } } as unknown as SessionAggregate;
const ask = (exerciseId: string, target: CoachTarget, sets: number | null = null): NextSessionTarget => ({ exerciseId, target, sets, reason: 'Set 2 was RPE 10.' });

describe('validateNextSessionTargets (rule 4 snap and cap, rule 9 pain, D21)', () => {
  it('snaps to the bar, keeps the built-in comparison, measures the %', () => {
    const r = validateNextSessionTargets({ source, bases, targets: [ask(BENCH.exerciseId, t(98, 6, 8))], painFlags: [], gymName: 'Main Gym', ctx });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ after: t(97.5, 6, 8), builtIn: t(102.5, 6, 8), size: 'small', pctChange: -2.5, sets: null });
    expect(r.rows[0]?.guardNotes[0]?.text.replace(/\u00a0/g, ' ')).toBe('Rounded to 97.5 kg');
  });

  it('per-hand dumbbells are capped at the rack’s max (a bigger change); never past it', () => {
    const r = validateNextSessionTargets({ source, bases, targets: [ask(CURL.exerciseId, t(35, 8, 10, 'per_hand'))], painFlags: [], gymName: 'Main Gym', ctx });
    expect(r.rows[0]?.after.load).toEqual(kg(30, 'per_hand'));
    expect(r.rows[0]?.size).toBe('bigger');
    expect(r.rows[0]?.guardNotes.map((n) => n.kind)).toEqual(['capped']);
  });

  it('a pain flag drops any increase (load, reps or sets) but keeps a decrease', () => {
    const flag = { exerciseId: BENCH.exerciseId, status: 'active', area: 'shoulder', ownerId: OWNER } as unknown as PainFlag;
    const up = validateNextSessionTargets({ source, bases, targets: [ask(BENCH.exerciseId, t(102.5, 6, 8))], painFlags: [flag], gymName: null, ctx });
    expect(up.rows).toEqual([]);
    expect(up.dropped.map((n) => n.text)).toEqual(['Not increasing Bench press: you flagged shoulder pain.']);
    const down = validateNextSessionTargets({ source, bases, targets: [ask(BENCH.exerciseId, t(97.5, 6, 8))], painFlags: [flag], gymName: null, ctx });
    expect(down.rows).toHaveLength(1);
  });

  it('a wrong convention, an unknown exercise and a target equal to the built-in rule save nothing', () => {
    const r = validateNextSessionTargets({
      source,
      bases,
      targets: [ask(BENCH.exerciseId, t(50, 6, 8, 'per_hand')), ask(id(1), t(10, 8, 10)), ask(CURL.exerciseId, t(15, 9, 11, 'per_hand'))],
      painFlags: [],
      gymName: null,
      ctx,
    });
    expect(r.rows).toEqual([]);
    expect(r.dropped.map((n) => n.kind)).toEqual(['convention_mismatch', 'unknown_target']);
  });

  it('an extra set Ben didn’t ask for is dropped with a note; the rest of the change stays', () => {
    const r = validateNextSessionTargets({ source, bases, targets: [ask(BENCH.exerciseId, t(97.5, 6, 8), 4)], painFlags: [], gymName: null, ctx });
    expect(r.rows[0]).toMatchObject({ sets: 3, size: 'small' });
    expect(r.rows[0]?.guardNotes.map((n) => n.kind)).toContain('too_many_sets');
  });
});
