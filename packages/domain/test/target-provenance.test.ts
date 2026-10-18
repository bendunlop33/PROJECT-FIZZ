import { describe, expect, it } from 'vitest';
import { PlannedSetSchema, type EquipmentInstance, type Load, type PlannedSet, type SessionAggregate, type TargetProvenance } from '@fizz/schemas';

import {
  buildStepCard,
  calculateNextTargets,
  fitProvenance,
  getAchievableLoads,
  NBSP,
  pctChange,
  plannedSetsFromTargets,
  startWorkout,
  startWorkoutFromSession,
  stepText,
  targetStep,
  toHistorySessions,
  type HistorySession,
  type NextTargets,
} from '../src/index';
import { assisted, at, barbell, bodyweightStation, doubleProgression, dumbbells, exercise, GYM, id, idGen, kg, lb, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, BENCH, exercises, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/** Domain text uses no-break spaces; tests read it with plain spaces. */
const plain = (s: string) => s.replaceAll(NBSP, ' ');
const DAY = 86_400;

/** A finished one-exercise history workout (sets logged in the app, so IDs and versions are kept). */
function history(eq: EquipmentInstance | null, loads: { load: Load | null; reps: number; rpe?: number }[], day = 0): HistorySession {
  return {
    sessionId: id(9_000 + day),
    performedAtUtc: at(day * DAY).utc,
    tz: 'Pacific/Auckland',
    routineName: 'Push A',
    equipmentId: eq?.id ?? null,
    gymId: GYM,
    imported: false,
    sets: loads.map((s, i) => ({ setType: 'working' as const, side: null, load: s.load, reps: s.reps, rpe: s.rpe ?? null, rir: null, setId: id(9_100 + day * 10 + i), version: 1 })),
  };
}

function rule(eq: EquipmentInstance | null, h: HistorySession[], unit: 'kg' | 'lb' = 'kg', convention = eq?.loadConvention ?? 'total'): NextTargets {
  return calculateNextTargets({ exerciseName: 'Bench press', measurement: 'reps', history: h, rule: doubleProgression({ workingSets: 2 }), equipment: eq, unit, convention, pain: { active: false, reportedAtUtc: null } });
}

function provenanceOf(plan: { planned: PlannedSet }[] | null, i = 0): TargetProvenance {
  const p = plan?.[i]?.planned.provenance;
  if (!p) throw new Error('no provenance');
  return p;
}

describe('buildStepCard (coaching-playbook §6): achievable neighbours from getAchievableLoads only', () => {
  it('barbell kg: the next plate pair either side, with % change', () => {
    const card = buildStepCard(barbell(), kg(100));
    expect(card).toMatchObject({ nextUp: { load: kg(102.5), pct: 2.5 }, nextDown: { load: kg(97.5), pct: -2.5 }, atMax: false, atMin: false });
  });

  it('per-hand dumbbells: the rack’s own steps; the heaviest is at max', () => {
    expect(buildStepCard(dumbbells(), kg(10, 'per_hand'))).toMatchObject({ nextUp: { load: kg(12.5, 'per_hand'), pct: 25 }, nextDown: { load: kg(7.5, 'per_hand') } });
    const top = buildStepCard(dumbbells(), kg(30, 'per_hand'));
    expect(top).toMatchObject({ nextUp: null, atMax: true, nextDown: { load: kg(27.5, 'per_hand') } });
  });

  it('assisted machine: up (harder) is less assistance', () => {
    const card = buildStepCard(assisted(), kg(20, 'assistance'));
    expect(card).toMatchObject({ nextUp: { load: kg(15, 'assistance') }, nextDown: { load: kg(25, 'assistance') } });
    expect(buildStepCard(assisted(), kg(5, 'assistance'))).toMatchObject({ atMax: true, nextUp: null });
    expect(buildStepCard(assisted(), kg(40, 'assistance'))).toMatchObject({ atMin: true, nextDown: null });
  });

  it('never converts: another unit or convention, a bodyweight station, or no loads give no card', () => {
    expect(buildStepCard(barbell(), lb(225))).toBeNull();
    expect(buildStepCard(barbell(), kg(20, 'per_hand'))).toBeNull();
    expect(buildStepCard(bodyweightStation(), kg(0, 'bodyweight'))).toBeNull();
    expect(buildStepCard(stack({ stackLoads: [5, 10], minLoad: 20 }), kg(10, 'stack'))).toBeNull();
    expect(pctChange(0, 5)).toBeNull();
  });
});

describe('stepText: the Equipment row’s step line', () => {
  it('kg bar, lb bar, dumbbells (each), stack, assisted, and no equipment', () => {
    const bar = barbell();
    expect(plain(stepText(targetStep(kg(100), kg(102.5), bar) ?? fail()))).toBe('+2.5 kg (+2.5%) · smallest step');
    expect(plain(stepText(targetStep(kg(100), kg(105), bar) ?? fail()))).toBe('+5 kg (+5%)');
    expect(plain(stepText(targetStep(kg(100), kg(90), bar) ?? fail()))).toBe('−10 kg (−10%)');
    expect(plain(stepText(targetStep(kg(100), kg(97.5), bar) ?? fail()))).toBe('−2.5 kg (−2.5%) · smallest step');
    expect(plain(stepText(targetStep(kg(20, 'per_hand'), kg(22.5, 'per_hand'), dumbbells()) ?? fail()))).toBe('+2.5 kg each (+12.5%) · smallest step');
    expect(plain(stepText(targetStep(kg(40, 'stack'), kg(45, 'stack'), stack()) ?? fail()))).toBe('+5 kg (+12.5%) · smallest step');
    expect(plain(stepText(targetStep(kg(20, 'assistance'), kg(15, 'assistance'), assisted()) ?? fail()))).toBe('5 kg less assistance · smallest step');
    expect(plain(stepText(targetStep(kg(20, 'assistance'), kg(30, 'assistance'), assisted()) ?? fail()))).toBe('10 kg more assistance');
    expect(plain(stepText(targetStep(kg(60), kg(62.5), null) ?? fail()))).toBe('+2.5 kg (+4.2%)');
    // No change, or a change across units/conventions, is not a step.
    expect(targetStep(kg(100), kg(100), bar)).toBeNull();
    expect(targetStep(kg(100), lb(225), bar)).toBeNull();
  });
});

function fail(): never {
  throw new Error('expected a step');
}

describe('built-in rule provenance (plannedSetsFromTargets with why)', () => {
  const bar = barbell();

  it('records the basis workout, the rule’s own words and the equipment step, matching calculateNextTargets and buildStepCard (check 39)', () => {
    const h = [history(bar, [{ load: kg(100), reps: 8, rpe: 8 }, { load: kg(100), reps: 8, rpe: 8 }])];
    const result = rule(bar, h);
    expect(result.decision).toBe('increase_load');
    const plan = plannedSetsFromTargets(result, { history: h, equipment: bar, at: at(2 * DAY) });
    const p = provenanceOf(plan);
    expect(p).toMatchObject({ source: 'rule', setAt: at(2 * DAY), routineName: null, requestedLoad: null, guardNotes: [] });
    expect(p.basis).toMatchObject({ sessionId: h[0]?.sessionId, routineName: 'Push A', gymId: GYM, equipmentId: bar.id });
    expect(p.basis?.sets.map((s) => [s.setId, s.version, s.values.load?.value, s.values.reps, s.values.rpe])).toEqual([
      [id(9_100), 1, 100, 8, 8],
      [id(9_101), 1, 100, 8, 8],
    ]);
    expect(p.rule).toEqual({ name: result.rule.name, decision: 'increase_load', summary: result.explanation.summary, facts: result.explanation.facts });
    const card = buildStepCard(bar, kg(100));
    expect(p.step).toEqual({ from: kg(100), to: card?.nextUp?.load, pctChange: card?.nextUp?.pct, smallest: true, equipmentKind: 'barbell' });
    // Every planned set carries it, and it is valid stored data.
    expect(plan?.every((x) => x.planned.provenance?.source === 'rule')).toBe(true);
    for (const x of plan ?? []) expect(PlannedSetSchema.safeParse(x.planned).success).toBe(true);
  });

  it('without why, nothing extra is stored (older callers unchanged)', () => {
    const h = [history(bar, [{ load: kg(100), reps: 8, rpe: 8 }, { load: kg(100), reps: 8, rpe: 8 }])];
    expect(plannedSetsFromTargets(rule(bar, h))?.[0]?.planned.provenance).toBeUndefined();
  });

  it('lb bar: the step is in lb and measured on that bar', () => {
    const lbBar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 4 }, { mass: 2.5, count: 2 }] });
    const h = [history(lbBar, [{ load: lb(225), reps: 8, rpe: 8 }, { load: lb(225), reps: 8, rpe: 8 }])];
    const result = rule(lbBar, h, 'lb');
    expect(result.sets[0]?.load).toEqual(lb(230));
    const p = provenanceOf(plannedSetsFromTargets(result, { history: h, equipment: lbBar, at: at(2 * DAY) }));
    expect(p.step).toMatchObject({ from: lb(225), to: lb(230), pctChange: 2.2, smallest: true });
    expect(plain(stepText(p.step ?? fail()))).toBe('+5 lb (+2.2%) · smallest step');
  });

  it('per-hand dumbbells at the heaviest in the rack: reps go up, and the cap is said', () => {
    const rack = dumbbells();
    const h = [history(rack, [{ load: kg(30, 'per_hand'), reps: 8, rpe: 8 }, { load: kg(30, 'per_hand'), reps: 8, rpe: 8 }])];
    const result = rule(rack, h);
    expect(result.decision).toBe('increase_reps');
    const p = provenanceOf(plannedSetsFromTargets(result, { history: h, equipment: rack, at: at(2 * DAY) }));
    expect(p.step).toBeUndefined();
    expect(p.guardNotes.map(plain)).toEqual(['Capped at 30 kg each: the heaviest dumbbell here.']);
  });

  it('assisted machine: less assistance is the step up', () => {
    const machine = assisted();
    const h = [history(machine, [{ load: kg(20, 'assistance'), reps: 8, rpe: 8 }, { load: kg(20, 'assistance'), reps: 8, rpe: 8 }])];
    const result = rule(machine, h);
    expect(result.sets[0]?.load).toEqual(kg(15, 'assistance'));
    const p = provenanceOf(plannedSetsFromTargets(result, { history: h, equipment: machine, at: at(2 * DAY) }));
    expect(plain(stepText(p.step ?? fail()))).toBe('5 kg less assistance · smallest step');
  });

  it('assisted machine at its least assistance: capped, never past the machine', () => {
    const machine = assisted();
    const h = [history(machine, [{ load: kg(5, 'assistance'), reps: 8, rpe: 8 }, { load: kg(5, 'assistance'), reps: 8, rpe: 8 }])];
    const p = provenanceOf(plannedSetsFromTargets(rule(machine, h), { history: h, equipment: machine, at: at(2 * DAY) }));
    expect(p.guardNotes.map(plain)).toEqual(['Capped at Assist 5 kg: the least assistance this machine gives.']);
  });

  it('no equipment at this gym: says the load wasn’t checked', () => {
    const h = [history(null, [{ load: kg(40, 'stack'), reps: 12, rpe: 8 }, { load: kg(40, 'stack'), reps: 12, rpe: 8 }])];
    const result = rule(null, h, 'kg', 'stack');
    expect(result.loadFeasibility).toBe('unchecked');
    const p = provenanceOf(plannedSetsFromTargets(result, { history: h, equipment: null, at: at(2 * DAY) }));
    expect(p.guardNotes).toEqual(['Not checked against equipment: this exercise has no equipment set up at this gym.']);
  });

  it('skips a basis workout with nothing logged', () => {
    const empty = { ...history(bar, [], 1), sets: [] };
    const real = history(bar, [{ load: kg(100), reps: 8, rpe: 8 }, { load: kg(100), reps: 8, rpe: 8 }], 0);
    const h = [empty, real];
    const result = { ...rule(bar, h), basedOnSessionIds: [empty.sessionId, real.sessionId] };
    expect(provenanceOf(plannedSetsFromTargets(result, { history: h, equipment: bar, at: at(3 * DAY) })).basis?.sessionId).toBe(real.sessionId);
  });

  it('a FitNotes basis (no equipment recorded) is recorded as imported, with its working sets only (B7)', () => {
    const real = history(bar, [{ load: kg(100), reps: 8, rpe: 8 }, { load: kg(100), reps: 8, rpe: 8 }], 0);
    const imported = { ...history(null, [{ load: kg(60), reps: 10 }, { load: kg(120), reps: 8 }, { load: kg(120), reps: 8 }], 2), imported: true, gymId: null };
    const h = [imported, real];
    const result = { ...rule(bar, h), basedOnSessionIds: [imported.sessionId, real.sessionId] };
    const basis = provenanceOf(plannedSetsFromTargets(result, { history: h, equipment: bar, at: at(3 * DAY) })).basis;
    expect(basis).toMatchObject({ sessionId: imported.sessionId, imported: true, gymId: null });
    expect(basis?.sets.map((x) => x.values.load?.value)).toEqual([120, 120]);
  });

  it('fitProvenance keeps an extreme explanation inside the schema, so the write never fails', () => {
    const h = [history(bar, [{ load: kg(100), reps: 8, rpe: 8 }, { load: kg(100), reps: 8, rpe: 8 }])];
    const result = rule(bar, h);
    const long = 'x'.repeat(2_000);
    const huge = { ...result, rule: { ...result.rule, name: long }, explanation: { summary: long, facts: Array.from({ length: 40 }, () => long) } };
    const plan = plannedSetsFromTargets(huge, { history: h, equipment: bar, at: at(2 * DAY) });
    const p = provenanceOf(plan);
    expect(PlannedSetSchema.safeParse(plan?.[0]?.planned).success).toBe(true);
    expect(p.rule?.facts).toHaveLength(20);
    expect(p.rule?.summary.endsWith('…')).toBe(true);
    expect(fitProvenance({ ...p, guardNotes: ['', 'a', ...Array.from({ length: 15 }, () => long)] }).guardNotes).toHaveLength(10);
  });
});

describe('routine provenance (startWorkout)', () => {
  const bar = barbell();

  function start(tpl: Parameters<typeof template>[1], eq: EquipmentInstance = bar, exerciseId = BENCH) {
    const r = routine([routineExercise(600, { exerciseId, equipmentId: eq.id, setTemplates: [template(6001, tpl)] })]);
    const ex = new Map([[exerciseId, exercises.get(exerciseId) ?? exercise(250, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })]]);
    const out = startWorkout({ opId: 's', owner: profile(), gymId: GYM, routine: r, exercises: ex, gymEquipment: [eq], at: at(0), newId: idGen(80_000) });
    return out.aggregate.sets[0]?.planned;
  }

  it('an exact template load: the routine, no equipment note', () => {
    const planned = start({ targetLoad: kg(100) });
    expect(planned?.provenance).toEqual({ source: 'plan', setAt: at(0), routineName: 'Push A', requestedLoad: kg(100), basis: null, guardNotes: [] });
  });

  it('a load the bar can’t make is rounded toward easier, and the plan’s number is kept', () => {
    expect(start({ targetLoad: kg(101) })?.provenance?.guardNotes.map(plain)).toEqual(['Rounded to 100 kg, the nearest easier load this bar makes. Plan was 101 kg.']);
    const top = getAchievableLoads(bar).loads.at(-1) ?? 0;
    expect(start({ targetLoad: kg(500) })?.provenance?.guardNotes.map(plain)).toEqual([`Capped at ${String(top)} kg: the most this bar makes. Plan was 500 kg.`]);
    expect(start({ targetLoad: lb(225) })?.provenance?.guardNotes.map(plain)).toEqual(['Rounded from 225 lb to 100 kg to match this bar.']);
  });

  it('a load in another convention is dropped, never converted', () => {
    const planned = start({ targetLoad: kg(30, 'per_hand') });
    expect(planned?.load).toBeNull();
    expect(planned?.provenance?.guardNotes.map(plain)).toEqual(['No load target: plan was 30 kg each, a different kind of load, so it isn’t converted.']);
  });

  it('assisted machine: more assistance than it gives is dropped, never made harder (shared fit, ADR 0019)', () => {
    const machine = assisted();
    const planned = start({ targetLoad: kg(50, 'assistance') }, machine, id(250));
    expect(planned?.load).toBeNull();
    expect(planned?.reps).not.toBeNull();
    expect(planned?.provenance?.guardNotes.map(plain)).toEqual(['No load target: plan was Assist 50 kg, more assistance than this machine gives.']);
  });

  it('assisted machine: less assistance than it gives is set to its least (easier), with the note', () => {
    const machine = assisted();
    const planned = start({ targetLoad: kg(2.5, 'assistance') }, machine, id(250));
    expect(planned?.load).toEqual(kg(5, 'assistance'));
    expect(planned?.provenance?.guardNotes.map(plain)).toEqual(['Set to Assist 5 kg: the least assistance this machine gives. Plan was Assist 2.5 kg.']);
  });

  it('a reps-only target records the routine with no load and no note', () => {
    expect(start({ targetLoad: null })?.provenance).toEqual({ source: 'plan', setAt: at(0), routineName: 'Push A', requestedLoad: null, basis: null, guardNotes: [] });
  });
});

describe('Repeat provenance (startWorkoutFromSession)', () => {
  function finished(): SessionAggregate {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 10));
    s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(102.5), 8, { rpe: 9 }), 200));
    s = apply(s, logCmd(bench[2]?.id ?? '', values(kg(100), 7), 400));
    s = apply(s, logCmd(setsFor(s, ROW)[0]?.id ?? '', values(kg(50, 'stack'), 12), 600));
    for (const ex of s.exercises.filter((e) => e.exerciseId !== BENCH)) s = apply(s, { type: 'skip_exercise', at: at(700), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    return apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
  }
  const source = finished();

  it('each set records the set it copies, as it was', () => {
    const out = startWorkoutFromSession({ opId: 'r', owner: profile(), gymId: GYM, source, exercises, gymEquipment: [barbell(), stack()], at: at(DAY), newId: idGen(82_000) });
    const set2 = setsFor(out.aggregate, BENCH)[1];
    const from = setsFor(source, BENCH)[1];
    expect(set2?.planned.provenance).toEqual({
      source: 'repeat',
      setAt: at(DAY),
      routineName: 'Push A',
      requestedLoad: kg(102.5),
      basis: {
        sessionId: source.session.id,
        performedAt: source.session.startedAt,
        routineName: 'Push A',
        gymId: GYM,
        equipmentId: barbell().id,
        // `number`: Set 2 as the card showed it (review N1).
        sets: [{ setId: from?.id, version: from?.version, number: 2, setType: 'working', side: null, values: from?.actual }],
      },
      guardNotes: [],
    });
    expect(out.aggregate.sets.every((x) => x.planned.provenance === undefined || PlannedSetSchema.safeParse(x.planned).success)).toBe(true);
  });

  it('at a lighter gym: the cap is said with last time’s load; equipment that isn’t here is said too', () => {
    const lighter = barbell({ plates: [{ mass: 20, count: 4 }] });
    const out = startWorkoutFromSession({ opId: 'r2', owner: profile(), gymId: GYM, source, exercises, gymEquipment: [lighter], at: at(DAY), newId: idGen(83_000) });
    expect(setsFor(out.aggregate, BENCH)[1]?.planned.provenance?.guardNotes.map(plain)).toEqual(['Capped at 100 kg: the most this bar makes. Last time was 102.5 kg.']);
    expect(setsFor(out.aggregate, ROW)[0]?.planned.provenance?.guardNotes.map(plain)).toEqual(['No load target: no Cable stack here.']);
  });

  it('history keeps set IDs and versions only when asked (identity), for the basis', () => {
    const [plainHist] = toHistorySessions(source, BENCH);
    const [withId] = toHistorySessions(source, BENCH, { identity: true });
    expect(plainHist?.sets[0]).not.toHaveProperty('setId');
    const logged = setsFor(source, BENCH)[1];
    expect(withId?.sets[1]).toMatchObject({ setId: logged?.id, version: logged?.version });
    expect(withId).toMatchObject({ tz: 'Pacific/Auckland', routineName: 'Push A' });
  });
});
