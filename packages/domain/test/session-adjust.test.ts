import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Load, LoadConvention, PainFlag, SessionAggregate, SessionExercise, SetType, WeightUnit, WorkoutSet } from '@fizz/schemas';
import {
  BUILT_IN_SESSION_RULE,
  carriesTodayAdjustment,
  evaluateCoachTrigger,
  evaluateSessionAdjustment,
  isIncrease,
  reduceSession,
  repsShort,
  type CoachTriggerKind,
  type SessionAdjustment,
} from '../src/index';
import { assisted, at, barbell, dumbbells, GYM, id, kg, lb, OWNER, stack, T0 } from './fixtures';

/**
 * Build 108 (Ben: "I did way fewer reps than stated and nothing changed"):
 * the trigger now fires on any rep below a range's floor (F1), and with the
 * coach unreachable the built-in rule offers a concrete, conservative change
 * to the remaining sets (F2, CA6 revised). Pure: no AI, no network.
 */

const SESSION = id(9100);
const nb = (s: string | null | undefined): string => (s ?? '').replaceAll(' ', ' ');

interface Spec {
  eq: EquipmentInstance | null;
  convention: LoadConvention;
  unit?: WeightUnit;
  load: Load | null;
  reps: [number, number] | null;
  /** What set 1 logged; the rest are pending. */
  logged: { reps: number | null; rpe?: number | null };
  sets?: number;
  types?: SetType[];
}

function workout(sp: Spec, version = 9): SessionAggregate {
  const ex: SessionExercise = {
    id: id(1),
    sessionId: SESSION,
    exerciseId: id(1001),
    exerciseName: 'Bench press',
    measurement: 'reps',
    laterality: 'bilateral',
    equipmentId: sp.eq?.id ?? null,
    loadConvention: sp.convention,
    unit: sp.unit ?? 'kg',
    order: 0,
    supersetGroup: null,
    transitionRestS: null,
    progressionRuleId: null,
  };
  const n = sp.sets ?? 3;
  const sets: WorkoutSet[] = Array.from({ length: n }, (_, i) => {
    const done = i === 0;
    return {
      id: id(10 + i),
      sessionId: SESSION,
      sessionExerciseId: ex.id,
      index: i,
      setType: sp.types?.[i] ?? 'working',
      status: done ? 'completed' : 'pending',
      side: null,
      pairedWithSetId: null,
      planned: { load: sp.load, reps: sp.reps === null ? null : { min: sp.reps[0], max: sp.reps[1] }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' },
      rest: { seconds: 120, source: 'global_default', sourceLabel: 'Default' },
      actual: done ? { load: sp.load, reps: sp.logged.reps, durationS: null, rpe: sp.logged.rpe ?? null, rir: null } : null,
      draft: null,
      completedAt: done ? at(60) : null,
      completedByOpId: done ? 'log-1' : null,
      undoCount: 0,
      flags: [],
      edited: false,
      version: done ? 2 : 1,
    };
  });
  return {
    session: {
      id: SESSION,
      ownerId: OWNER,
      routineId: null,
      routineName: 'Push A',
      gymId: GYM,
      startOperationId: 'start',
      status: 'active',
      source: 'manual',
      startedAt: at(0),
      endedAt: null,
      version,
      activeSetId: id(11),
      equipmentSnapshot: sp.eq ? [sp.eq] : [],
      pause: null,
      pauses: [],
      lastActivityAtUtc: T0,
      checkIn: null,
    },
    exercises: [ex],
    sets,
    restTimer: null,
    workInterval: null,
    audit: [],
    timingAudit: [],
    processedOps: {},
    revision: 3,
  };
}

function flag(): PainFlag {
  return {
    id: id(7001),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: T0,
    updatedAtUtc: T0,
    exerciseId: id(1001),
    exerciseName: 'Bench press',
    area: 'shoulder',
    source: 'workout',
    checkInId: null,
    reportedAt: at(30),
    status: 'active',
    clearedAtUtc: null,
    createdByOpId: 'pain-op',
  };
}

function evaluate(sp: Spec, kind?: CoachTriggerKind, over: { painFlags?: PainFlag[]; sessionPainUnspecified?: boolean; aggregate?: SessionAggregate } = {}): SessionAdjustment | null {
  const agg = over.aggregate ?? workout(sp);
  const set = agg.sets[0];
  if (set === undefined) throw new Error('fixture');
  const t = evaluateCoachTrigger(set, 1);
  const trigger = kind === undefined ? t : { kind, setId: set.id, fact: t?.fact ?? 'fact' };
  if (trigger === null) return null;
  return evaluateSessionAdjustment({ aggregate: agg, trigger, painFlags: over.painFlags ?? [], sessionPainUnspecified: over.sessionPainUnspecified ?? false, gymName: 'Main Gym' });
}

function targets(a: SessionAdjustment | null) {
  if (a === null) throw new Error('expected an adjustment');
  return a.plan.flatMap((e) => e.changes.map((c) => ({ set: c.setNumber, load: c.after?.load?.value ?? null, unit: c.after?.load?.unit ?? null, reps: c.after?.reps ?? null })));
}

const BAR = barbell();
const DB = dumbbells();
const STACK = stack();
const ASSIST = assisted();
const LB_BAR = barbell({
  id: id(110),
  unit: 'lb',
  barMass: 45,
  plates: [
    { mass: 45, count: 6 },
    { mass: 25, count: 2 },
    { mass: 10, count: 2 },
    { mass: 5, count: 2 },
    { mass: 2.5, count: 2 },
  ],
});

describe('F1: reps short means what Ben was shown (rule T, CA5 revised)', () => {
  it('a range fires on any rep below its floor; a single number needs a 2-rep miss', () => {
    expect(repsShort({ min: 3, max: 6 }, 2)).toBe(true);
    expect(repsShort({ min: 3, max: 6 }, 3)).toBe(false);
    expect(repsShort({ min: 8, max: 10 }, 7)).toBe(true);
    expect(repsShort({ min: 8, max: 8 }, 7)).toBe(false);
    expect(repsShort({ min: 8, max: 8 }, 6)).toBe(true);
    expect(repsShort({ min: 0, max: 0 }, 0)).toBe(false);
  });

  it('Ben’s case: 2 reps against the built-in 3–6 (button showed × 6) now fires, with `rep` singular for 1', () => {
    const agg = workout({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } });
    expect(evaluateCoachTrigger(agg.sets[0] ?? (() => { throw new Error('x'); })(), 1)).toMatchObject({ kind: 'reps_short', fact: '2 reps on set 1 (target 3–6)' });
    const one = workout({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 1 } });
    expect(evaluateCoachTrigger(one.sets[0] ?? (() => { throw new Error('x'); })(), 2)?.fact).toBe('1 rep on set 2 (target 3–6)');
  });

  it('still never on warm-ups, drop sets, planned all-out sets, or sets with no rep target or a timed target', () => {
    const base = workout({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 0 } });
    const s = base.sets[0];
    if (s === undefined) throw new Error('fixture');
    expect(evaluateCoachTrigger({ ...s, setType: 'warmup' }, 1)).toBeNull();
    expect(evaluateCoachTrigger({ ...s, setType: 'drop' }, 1)).toBeNull();
    expect(evaluateCoachTrigger({ ...s, planned: { ...s.planned, rpe: 10 } }, 1)).toBeNull();
    expect(evaluateCoachTrigger({ ...s, planned: { ...s.planned, reps: null } }, 1)).toBeNull();
    const timed: WorkoutSet = { ...s, planned: { ...s.planned, reps: null, durationS: 60 }, actual: { load: null, reps: null, durationS: 20, rpe: null, rir: null } };
    expect(evaluateCoachTrigger(timed, 1)).toBeNull();
    expect(evaluateCoachTrigger({ ...s, setType: 'top' }, 1)?.kind).toBe('reps_short');
    expect(evaluateCoachTrigger({ ...s, setType: 'backoff' }, 1)?.kind).toBe('reps_short');
  });
});

describe('F2: the built-in rule’s change to today’s remaining sets (CA6 revised)', () => {
  it('Ben’s case: 62.5 kg × 3–6, 2 reps → the next achievable load at least 5% lighter, same reps, for every remaining set', () => {
    const a = evaluate({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } });
    expect(targets(a)).toEqual([
      { set: 2, load: 57.5, unit: 'kg', reps: { min: 3, max: 6 } },
      { set: 3, load: 57.5, unit: 'kg', reps: { min: 3, max: 6 } },
    ]);
    expect(nb(a?.change)).toBe('Next sets: 57.5 kg × 3–6');
    expect(a).toMatchObject({ intent: 'too_hard', sessionExerciseId: id(1), args: { baseVersion: 9 } });
    expect(a?.rule).toMatchObject({ decision: 'reduce_load', name: 'Too hard: lighter or fewer reps (playbook rule 5)', facts: ['2 reps on set 1 (target 3–6)'] });
    expect(a?.reason).toBe('2 reps on set 1 (target 3–6). Lighter load for the remaining sets (8%).');
  });

  it('uses rule 5’s most conservative step: 5% (D22 minimum), rounded down to an achievable load', () => {
    expect(BUILT_IN_SESSION_RULE).toMatchObject({ loadDropPct: 5, maxLoadDropPct: 10, maxLoadRisePct: 5, repsUp: 1 });
    expect(targets(evaluate({ eq: BAR, convention: 'total', load: kg(100), reps: [6, 8], logged: { reps: 8, rpe: 10 } }))[0]).toMatchObject({ load: 95, reps: { min: 6, max: 8 } });
  });

  it('never raises after a miss: every change is easier than the plan', () => {
    const agg = workout({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } });
    const a = evaluate({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } });
    for (const c of a?.plan.flatMap((e) => e.changes) ?? []) {
      expect(isIncrease(c.before, c.after ?? { load: null, reps: null }, 'total')).toBe(false);
    }
    expect(agg.sets.filter((s) => s.status === 'completed')).toHaveLength(1);
    expect(a?.plan.flatMap((e) => e.changes).map((c) => c.setId)).not.toContain(id(10));
  });

  it('per-hand dumbbells: 25 kg each → 22.5 kg each (10%); 22.5 → 20 would be 11%, so the same load with the reps he managed', () => {
    expect(nb(evaluate({ eq: DB, convention: 'per_hand', load: kg(25, 'per_hand'), reps: [8, 10], logged: { reps: 6 } })?.change)).toBe('Next sets: 22.5 kg each × 8–10');
    const a = evaluate({ eq: DB, convention: 'per_hand', load: kg(22.5, 'per_hand'), reps: [8, 10], logged: { reps: 6 } });
    expect(nb(a?.change)).toBe('Next sets: 22.5 kg each × 6');
    expect(a?.rule.decision).toBe('hold_after_miss');
  });

  it('a stack whose next plate is > 10% lighter keeps the load and cuts reps; RPE 10 with reps met cuts one rep', () => {
    expect(nb(evaluate({ eq: STACK, convention: 'stack', load: kg(40, 'stack'), reps: [8, 10], logged: { reps: 5 } })?.change)).toBe('Next sets: 40 kg stack × 5');
    expect(nb(evaluate({ eq: STACK, convention: 'stack', load: kg(40, 'stack'), reps: [8, 10], logged: { reps: 10, rpe: 10 } })?.change)).toBe('Next sets: 40 kg stack × 8–9');
  });

  it('equipment min: at the lightest stack plate there is nothing lighter, so reps instead', () => {
    expect(nb(evaluate({ eq: STACK, convention: 'stack', load: kg(5, 'stack'), reps: [10, 12], logged: { reps: 7 } })?.change)).toBe('Next sets: 5 kg stack × 7');
  });

  it('assisted machine: one assistance step easier (more assistance), never less', () => {
    const a = evaluate({ eq: ASSIST, convention: 'assistance', load: kg(20, 'assistance'), reps: [6, 8], logged: { reps: 3 } });
    expect(nb(a?.change)).toBe('Next sets: Assist 25 kg × 6–8');
    expect(a?.rule.decision).toBe('reduce_load');
  });

  it('lb equipment stays in lb: 225 lb → 210 lb (5 lb steps, rounded down)', () => {
    const a = evaluate({ eq: LB_BAR, convention: 'total', unit: 'lb', load: lb(225), reps: [5, 5], logged: { reps: 3 } });
    expect(targets(a)[0]).toMatchObject({ load: 210, unit: 'lb', reps: { min: 5, max: 5 } });
  });

  it('bodyweight: fewer reps only', () => {
    expect(nb(evaluate({ eq: null, convention: 'bodyweight', load: null, reps: [10, 15], logged: { reps: 7 } })?.change)).toBe('Next sets: 7 reps');
  });

  it('a 0-rep miss targets 1, not 0', () => {
    expect(nb(evaluate({ eq: STACK, convention: 'stack', load: kg(5, 'stack'), reps: [3, 6], logged: { reps: 0 } })?.change)).toBe('Next sets: 5 kg stack × 1');
  });

  it('no offer when nothing can change: no pending set left, or no load step and no rep target', () => {
    expect(evaluate({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 }, sets: 1 })).toBeNull();
    const agg = workout({ eq: STACK, convention: 'stack', load: kg(5, 'stack'), reps: null, logged: { reps: null, rpe: 10 } });
    expect(evaluate({ eq: STACK, convention: 'stack', load: kg(5, 'stack'), reps: null, logged: { reps: null } }, 'rpe_high', { aggregate: agg })).toBeNull();
  });

  it('warm-ups left to do aren’t changed', () => {
    const a = evaluate({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 }, types: ['working', 'warmup', 'working'] });
    expect(targets(a).map((t) => t.set)).toEqual([3]);
    expect(nb(a?.change)).toBe('Next set: 57.5 kg × 3–6');
  });

  it('a set planned at different loads (top + back-off) gets its own step each', () => {
    const agg = workout({ eq: BAR, convention: 'total', load: kg(100), reps: [6, 8], logged: { reps: 3 } });
    const third = agg.sets[2];
    if (third === undefined) throw new Error('fixture');
    agg.sets[2] = { ...third, planned: { ...third.planned, load: kg(80) } };
    const a = evaluate({ eq: BAR, convention: 'total', load: kg(100), reps: [6, 8], logged: { reps: 3 } }, undefined, { aggregate: agg });
    expect(nb(a?.change)).toBe('Set 2: 95 kg × 6–8 · Set 3: 75 kg × 6–8');
    expect(a?.reason).toContain('(5–6.3%)');
  });

  it('too easy: the next step if ≤ 5% heavier, else +1 rep; at the equipment max, +1 rep; never past the max', () => {
    expect(nb(evaluate({ eq: BAR, convention: 'total', load: kg(100), reps: [6, 8], logged: { reps: 8, rpe: 6 } })?.change)).toBe('Next sets: 102.5 kg × 6–8');
    expect(nb(evaluate({ eq: STACK, convention: 'stack', load: kg(40, 'stack'), reps: [8, 10], logged: { reps: 8, rpe: 5 } })?.change)).toBe('Next sets: 40 kg stack × 9–11');
    const capped = stack({ maxLoad: 40 });
    const a = evaluate({ eq: capped, convention: 'stack', load: kg(40, 'stack'), reps: [8, 10], logged: { reps: 8, rpe: 5 } });
    expect(targets(a).every((t) => t.load === 40)).toBe(true);
    expect(a?.rule.decision).toBe('increase_reps');
  });

  it('too easy on an assisted machine: one step less assistance', () => {
    expect(nb(evaluate({ eq: ASSIST, convention: 'assistance', load: kg(20, 'assistance'), reps: [6, 8], logged: { reps: 8, rpe: 5 } })?.change)).toBe('Next sets: Assist 15 kg × 6–8');
  });

  it('pain blocks every increase (rule 9): a flag on the movement, or pain mentioned at check-in', () => {
    const easy: Spec = { eq: BAR, convention: 'total', load: kg(100), reps: [6, 8], logged: { reps: 8, rpe: 6 } };
    expect(evaluate(easy, undefined, { painFlags: [flag()] })).toBeNull();
    expect(evaluate(easy, undefined, { sessionPainUnspecified: true })).toBeNull();
    // A reduction is still offered with a pain flag.
    expect(evaluate({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } }, undefined, { painFlags: [flag()] })).not.toBeNull();
  });

  it('a finished workout gets nothing', () => {
    const agg = workout({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } });
    expect(evaluate({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } }, undefined, { aggregate: { ...agg, session: { ...agg.session, status: 'finished' } } })).toBeNull();
  });
});

describe('the rule’s change through the reducer: labelled, versioned, idempotent, undoable', () => {
  const sp: Spec = { eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 2 } };
  function command(a: SessionAdjustment, over: { expectedVersion?: number; opId?: string } = {}) {
    return {
      type: 'adjust_pending_targets' as const,
      at: at(120),
      opId: over.opId ?? 'built-in-adjust:t1',
      expectedVersion: over.expectedVersion ?? a.args.baseVersion,
      actionId: id(8001),
      reason: a.reason,
      rule: a.rule,
      changes: a.plan.flatMap((e) => e.changes.flatMap((c) => (c.after === null ? [] : [{ setId: c.setId, target: c.after }]))),
      removeSetIds: [],
      addSets: [],
    };
  }

  it('changed targets read `built_in_rule` with the rule’s own words for Why?, never the coach; done sets untouched', () => {
    const agg = workout(sp);
    const a = evaluate(sp);
    if (a === null) throw new Error('fixture');
    const r = reduceSession(agg, command(a));
    if (!r.ok) throw new Error(r.error.message);
    const [s1, s2, s3] = r.state.sets;
    expect(s1).toEqual(agg.sets[0]);
    for (const s of [s2, s3]) {
      expect(s?.planned).toMatchObject({ load: kg(57.5), source: 'built_in_rule', provenance: { source: 'rule', rule: { decision: 'reduce_load' } }, coach: { actionId: id(8001) } });
      expect(s?.planned.provenance?.coach).toBeUndefined();
      expect(carriesTodayAdjustment(s?.planned ?? agg.sets[0]?.planned ?? ({} as never), id(8001))).toBe(true);
    }
    expect(r.state.session.version).toBe(10);

    // Stale: a change worked out on version 9 is refused on version 10.
    const stale = reduceSession(r.state, command(a, { opId: 'other' }));
    expect(stale.ok).toBe(false);

    // Undo puts the plan back.
    const undo = reduceSession(r.state, { type: 'revert_target_adjustment', at: at(130), opId: 'undo:x', actionId: id(8001), removedSetIds: [], addedSetIds: [] });
    if (!undo.ok) throw new Error(undo.error.message);
    expect(undo.state.sets[1]?.planned).toMatchObject({ load: kg(62.5), source: 'built_in_rule' });
    expect(undo.state.sets[1]?.planned.coach).toBeUndefined();
  });

  it('the same opId twice applies once (duplicate operation)', () => {
    const agg = workout(sp);
    const a = evaluate(sp);
    if (a === null) throw new Error('fixture');
    const r1 = reduceSession(agg, command(a));
    if (!r1.ok) throw new Error(r1.error.message);
    const r2 = reduceSession(r1.state, command(a));
    expect(r2.ok && r2.duplicate).toBe(true);
    if (r2.ok) expect(r2.state.session.version).toBe(r1.state.session.version);
  });
});

describe('Ben’s own Too hard / Too easy with no coach (review coach-fallback S1)', () => {
  const asked = (sp: Spec, intent: 'too_hard' | 'too_easy', over: { painFlags?: PainFlag[]; sessionPainUnspecified?: boolean } = {}) =>
    evaluateSessionAdjustment({
      aggregate: workout(sp),
      trigger: { kind: 'ben_asked', intent, sessionExerciseId: id(1), fact: intent === 'too_hard' ? 'Too hard' : 'Too easy' },
      painFlags: over.painFlags ?? [],
      sessionPainUnspecified: over.sessionPainUnspecified ?? false,
      gymName: 'Main Gym',
    });

  it('too hard: the same lighter step as a trigger, recorded with Ben’s request as the fact', () => {
    const a = asked({ eq: BAR, convention: 'total', load: kg(62.5), reps: [3, 6], logged: { reps: 6 } }, 'too_hard');
    expect(targets(a)).toEqual([
      { set: 2, load: 57.5, unit: 'kg', reps: { min: 3, max: 6 } },
      { set: 3, load: 57.5, unit: 'kg', reps: { min: 3, max: 6 } },
    ]);
    expect(a?.reason).toBe('Too hard. Lighter load for the remaining sets (8%).');
    expect(a?.rule.facts).toEqual(['Too hard']);
  });

  it('per-hand dumbbells and lb equipment stay in their own unit and convention', () => {
    const d = asked({ eq: DB, convention: 'per_hand', load: kg(25, 'per_hand'), reps: [8, 10], logged: { reps: 10 } }, 'too_hard');
    expect(nb(d?.change)).toBe('Next sets: 22.5 kg each × 8–10');
    const l = asked({ eq: LB_BAR, convention: 'total', unit: 'lb', load: lb(135), reps: [5, 5], logged: { reps: 5 } }, 'too_hard');
    for (const t of targets(l)) expect(t.unit).toBe('lb');
  });

  it('too hard with no lighter load (bodyweight): one fewer rep than the planned top, never below 1', () => {
    const a = asked({ eq: null, convention: 'bodyweight', load: null, reps: [8, 10], logged: { reps: null } }, 'too_hard');
    expect(targets(a).map((t) => t.reps)).toEqual([{ min: 8, max: 9 }, { min: 8, max: 9 }]);
    expect(asked({ eq: null, convention: 'bodyweight', load: null, reps: [1, 1], logged: { reps: null } }, 'too_hard')).toBeNull();
  });

  it('assisted: one step more assistance; too easy: one step less', () => {
    const sp: Spec = { eq: ASSIST, convention: 'assistance', load: kg(20, 'assistance'), reps: [6, 8], logged: { reps: 8 } };
    expect(targets(asked(sp, 'too_hard')).every((t) => t.load !== null && t.load > 20)).toBe(true);
    expect(nb(asked(sp, 'too_easy')?.change)).toBe('Next sets: Assist 15 kg × 6–8');
  });

  it('too easy: never with a pain flag or pain at check-in (rule 9); too hard still applies', () => {
    const sp: Spec = { eq: BAR, convention: 'total', load: kg(60), reps: [8, 10], logged: { reps: 10 } };
    expect(asked(sp, 'too_easy')).not.toBeNull();
    expect(asked(sp, 'too_easy', { painFlags: [flag()] })).toBeNull();
    expect(asked(sp, 'too_easy', { sessionPainUnspecified: true })).toBeNull();
    expect(asked(sp, 'too_hard', { painFlags: [flag()] })).not.toBeNull();
  });

  it('an unknown exercise row: nothing', () => {
    const a = evaluateSessionAdjustment({ aggregate: workout({ eq: BAR, convention: 'total', load: kg(60), reps: [8, 10], logged: { reps: 10 } }), trigger: { kind: 'ben_asked', intent: 'too_hard', sessionExerciseId: id(999), fact: 'Too hard' }, painFlags: [], sessionPainUnspecified: false, gymName: null });
    expect(a).toBeNull();
  });
});
