import { describe, expect, it } from 'vitest';
import type { CoachTarget, NextSessionTarget, PainFlag, SessionAggregate, SessionExercise } from '@fizz/schemas';
import { classifyNextSessionChange, isStallReset, nextSessionBases, nextTargetFitsSource, nextTargetSourceBasis, pctText, STALL_RESET_REASON, EXTRA_SET_REASON, validateNextSessionTargets, type NextSessionBasis } from '../src/index';
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

  it('reps by at most 2 at either end; sets by at most one; an unasked +1 is bigger (offered, Ben 23 Oct)', () => {
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 12), 3, bar, ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 12, 15), 3, bar, ctx).size).toBe('bigger');
    expect(classifyNextSessionChange(t(100, 8, 10), 4, t(100, 8, 10), 3, bar, ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 10), 4, bar, ctx)).toEqual({ size: 'bigger', reasons: [EXTRA_SET_REASON], setsAfter: 4 });
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 10), 4, bar, { benAskedForMoreSets: true })).toEqual({ size: 'small', reasons: [], setsAfter: 4 });
    expect(classifyNextSessionChange(t(100, 8, 10), 3, t(100, 8, 10), 5, bar, ctx).size).toBe('bigger');
  });

  it('assisted: one step less assistance is small; no equipment means a load change is bigger; a unit change is bigger', () => {
    expect(classifyNextSessionChange(t(30, 6, 8, 'assistance'), 3, t(25, 6, 8, 'assistance'), 3, assisted(), ctx).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(102.5, 6, 8), 3, null, ctx).size).toBe('bigger');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(225, 6, 8, 'total', 'lb'), 3, bar, ctx).size).toBe('bigger');
  });
});

describe('stall resets are always bigger (playbook rule 8; CA8; Ben, 23 Oct, D2)', () => {
  const bar = barbell();
  const stalled = { benAskedForMoreSets: false, stalled: true };
  it('on a stalled lift, one step lighter or a rep-scheme change is a reset: bigger, with its reason', () => {
    // Small anywhere else…
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(97.5, 6, 8), 3, bar, ctx).size).toBe('small');
    // …a reset on a stalled lift.
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(97.5, 6, 8), 3, bar, stalled)).toMatchObject({ size: 'bigger', reasons: [STALL_RESET_REASON] });
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(100, 4, 6), 3, bar, stalled)).toMatchObject({ size: 'bigger', reasons: [STALL_RESET_REASON] });
    // A 10% reset is bigger for both reasons.
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(90, 6, 8), 3, bar, stalled).reasons).toEqual([STALL_RESET_REASON, 'The load moves more than one step.']);
  });

  it('holding, one set fewer, or one step heavier on a stalled lift isn’t a reset (CA8 as before)', () => {
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(100, 6, 8), 3, bar, stalled).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(100, 6, 8), 2, bar, stalled).size).toBe('small');
    expect(classifyNextSessionChange(t(100, 6, 8), 3, t(102.5, 6, 8), 3, bar, stalled).size).toBe('small');
  });

  it('assisted: more assistance is easier (a reset); less assistance isn’t; per-hand dumbbells and lb by their own unit', () => {
    expect(isStallReset(t(30, 6, 8, 'assistance'), t(35, 6, 8, 'assistance'), true)).toBe(true);
    expect(isStallReset(t(30, 6, 8, 'assistance'), t(25, 6, 8, 'assistance'), true)).toBe(false);
    expect(isStallReset(t(12, 8, 10, 'per_hand'), t(10, 8, 10, 'per_hand'), true)).toBe(true);
    expect(isStallReset(t(225, 5, 5, 'total', 'lb'), t(215, 5, 5, 'total', 'lb'), true)).toBe(true);
    expect(isStallReset(t(12, 8, 10, 'per_hand'), t(10, 8, 10, 'per_hand'), false)).toBe(false);
    const db = dumbbells({ loads: [8, 10, 12, 14] });
    expect(classifyNextSessionChange(t(12, 8, 10, 'per_hand'), 3, t(10, 8, 10, 'per_hand'), 3, db, { benAskedForMoreSets: false, stalled: true }).size).toBe('bigger');
    expect(classifyNextSessionChange(t(30, 6, 8, 'assistance'), 3, t(35, 6, 8, 'assistance'), 3, assisted(), { benAskedForMoreSets: false, stalled: true }).size).toBe('bigger');
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

  it('Ben, 23 Oct (v5offers SP1): an extra set Ben didn’t ask for is offered (bigger, with the set), never dropped; the same change with only the extra set is kept too', () => {
    const r = validateNextSessionTargets({ source, bases, targets: [ask(BENCH.exerciseId, t(97.5, 6, 8), 4)], painFlags: [], gymName: null, ctx });
    expect(r.rows[0]).toMatchObject({ sets: 4, size: 'bigger', reasons: [EXTRA_SET_REASON] });
    expect(r.rows[0]?.guardNotes.map((n) => n.kind)).not.toContain('too_many_sets');
    const only = validateNextSessionTargets({ source, bases, targets: [ask(BENCH.exerciseId, bases[0]?.builtIn?.target ?? t(0, 1, 1), 4)], painFlags: [], gymName: null, ctx });
    expect(only.rows[0]).toMatchObject({ sets: 4, size: 'bigger', reasons: [EXTRA_SET_REASON] });
  });
});

describe('a stalled lift on the Summary: the coach’s reset is a suggestion, never saved by default (D2)', () => {
  const stalledBench: NextSessionBasis = { exercise: BENCH, equipment: barbell(), last: t(100, 6, 8), lastSets: 3, builtIn: { target: t(97.5, 6, 8), sets: 3 }, stalled: true };
  it('one step lighter with new reps is bigger (Apply); the same target as the built-in rule stays the rule’s; the other lift is unaffected', () => {
    const r = validateNextSessionTargets({ source, bases: [stalledBench, bases[1] as NextSessionBasis], targets: [ask(BENCH.exerciseId, t(97.5, 5, 7)), ask(CURL.exerciseId, t(15, 9, 11, 'per_hand'))], painFlags: [], gymName: null, ctx });
    expect(r.rows.find((x) => x.exerciseId === BENCH.exerciseId)).toMatchObject({ size: 'bigger', reasons: [STALL_RESET_REASON], after: t(97.5, 5, 7) });
    // Curl isn't stalled, but its target is the built-in rule's own: nothing for the coach to change.
    expect(r.rows.find((x) => x.exerciseId === CURL.exerciseId)).toBeUndefined();
    const same = validateNextSessionTargets({ source, bases: [stalledBench], targets: [ask(BENCH.exerciseId, t(97.5, 6, 8))], painFlags: [], gymName: null, ctx });
    expect(same.rows).toEqual([]);
  });

  it('nextSessionBases marks a lift stalled when the built-in rule finds repeated misses, reduced or at the lightest load', () => {
    const agg = {
      session: { id: id(8000), equipmentSnapshot: [], gymChanges: [] },
      exercises: [{ ...BENCH, exerciseOrder: 0 }],
      sets: [0, 1, 2].map((i) => ({ id: id(8100 + i), sessionExerciseId: BENCH.id, setType: 'working', pairedWithSetId: null, status: 'completed', order: i, version: 1, planned: { load: kg(100), reps: { min: 6, max: 8 }, durationS: null, rpe: 8, rir: null }, actual: { load: kg(100), reps: 4 } })),
    } as unknown as SessionAggregate;
    const plan = (decision: string, stalled?: true) => new Map([[BENCH.exerciseId, [0, 1, 2].map(() => ({ setType: 'working', planned: { load: kg(97.5), reps: { min: 6, max: 8 }, provenance: { rule: { decision, ...(stalled === undefined ? {} : { stalled }) } } } }))]]);
    expect(nextSessionBases(agg, plan('reduce_load'))[0]?.stalled).toBe(true);
    // One miss (a bad day): not stalled.
    expect(nextSessionBases(agg, plan('hold_after_miss'))[0]?.stalled).toBeUndefined();
    // The streak reached at the lightest load (no easier one): still stalled (review v5offers 6).
    const lightest = nextSessionBases(agg, plan('hold_after_miss', true))[0];
    expect(lightest?.stalled).toBe(true);
    // A rep-scheme change on it (within ±2, CA8-small otherwise) is a reset: bigger, a suggestion with Apply.
    if (lightest === undefined) throw new Error('no basis');
    const r = validateNextSessionTargets({ source, bases: [{ ...lightest, exercise: BENCH, equipment: barbell(), last: t(100, 6, 8), lastSets: 3, builtIn: { target: t(100, 6, 8), sets: 3 } }], targets: [ask(BENCH.exerciseId, t(100, 4, 6))], painFlags: [], gymName: null, ctx });
    expect(r.rows[0]).toMatchObject({ size: 'bigger', reasons: [STALL_RESET_REASON], after: t(100, 4, 6) });
  });
});

describe('nextTargetFitsSource (a rename doesn’t make the coach’s targets stale; a correction does)', () => {
  const set = (id: string, version: number) => ({ id, status: 'completed', version }) as unknown as SessionAggregate['sets'][number];
  it('the basis follows the sets only; rows saved before it existed fall back to the session version', () => {
    const basis = nextTargetSourceBasis({ sets: [set('a', 2), set('b', 2)] });
    expect(nextTargetSourceBasis({ sets: [set('b', 2), set('a', 2)] })).toBe(basis);
    expect(nextTargetSourceBasis({ sets: [set('a', 3), set('b', 2)] })).not.toBe(basis);
    expect(nextTargetFitsSource({ sourceVersion: 5, sourceBasis: basis }, { version: 6, basis })).toBe(true);
    expect(nextTargetFitsSource({ sourceVersion: 5, sourceBasis: basis }, { version: 5, basis: 'other' })).toBe(false);
    expect(nextTargetFitsSource({ sourceVersion: 5 }, { version: 5, basis })).toBe(true);
    expect(nextTargetFitsSource({ sourceVersion: 5 }, { version: 6, basis })).toBe(false);
  });
});
