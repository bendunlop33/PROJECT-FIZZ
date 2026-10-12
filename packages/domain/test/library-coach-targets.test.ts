import { describe, expect, it } from 'vitest';
import type { NextSessionTargetRecord, PlannedSet, Routine, SessionAggregate, SetTemplate, SetType } from '@fizz/schemas';
import { planRoutineStart, reduceSession, routineTemplatesWithTargets, shapeTemplates, targetRpeOf, withCoachTargets, type NextTargetEntry } from '../src/index';
import { at, id, idGen, kg, OWNER, profile, routine, routineExercise, template, values } from './fixtures';
import { EXERCISES, exerciseSets, INCLINE, MAIN, MAIN_EQ, mainRack, pushA } from './gym-fixture';
import { expectOk, logCmd } from './session-fixture';

/**
 * Review B1 (workout-library A, rounds 1 and 2): a coach target for next time
 * (D21) never replaces a library workout's structure. Its set types always
 * stay. A slot not changed since the target became active takes the coach's
 * load and reps (and its set count on a one-type slot). A slot Ben changed
 * since keeps his count and reps; the coach's load is used only where its
 * reps fit his range, else the built-in rule's. A routine from before the
 * library keeps the old behaviour.
 */

const ACTION = id(4000);
const SET_AT = at(1300).utc;

const rule = (load: number, reps = { min: 6, max: 8 }): PlannedSet => ({ load: kg(load), reps, durationS: null, rpe: null, rir: null, source: 'built_in_rule' });
const entry = (setType: SetType, planned: PlannedSet): { setType: SetType; planned: PlannedSet } => ({ setType, planned });
const coachPlanned = (load: number, reps = { min: 5, max: 5 }): PlannedSet => ({ load: kg(load), reps, durationS: null, rpe: null, rir: null, source: 'coach' });

function coachEntries(o: { setType?: SetType; load?: number; count?: number; sets?: number | null; builtIn?: { setType: SetType; planned: PlannedSet }[] }): NextTargetEntry[] {
  const builtIn = o.builtIn ?? [1, 2, 3].map(() => entry('working', rule(97.5)));
  const coach = { sets: o.sets ?? null, setAtUtc: SET_AT, builtIn };
  return Array.from({ length: o.count ?? 3 }, () => ({ setType: o.setType ?? 'working', planned: coachPlanned(o.load ?? 100), coach }));
}

const topBackoff = (): SetTemplate[] => [
  template(1, { setType: 'warmup', targetReps: { min: 8, max: 8 }, targetLoad: kg(60) }),
  template(2, { setType: 'top', targetReps: { min: 4, max: 6 } }),
  template(3, { setType: 'backoff', targetReps: { min: 6, max: 8 } }),
  template(4, { setType: 'backoff', targetReps: { min: 6, max: 8 } }),
  template(5, { setType: 'backoff', targetReps: { min: 6, max: 8 } }),
];

const shape = (ts: SetTemplate[]) => ts.map((t) => `${t.setType} ${t.targetLoad === null ? 'auto' : String(t.targetLoad.value)}×${t.targetReps === null ? '-' : `${String(t.targetReps.min)}–${String(t.targetReps.max)}`}`);

describe('routineTemplatesWithTargets: a coach target on a library workout', () => {
  it('Top 4–6 + 3 Back-off 6–8 with a coach 3 × 100 kg × 5: the top set takes the coach target, the back-offs stay (B1)', () => {
    const ruleOf = new Map<string, PlannedSet>();
    const builtIn = [
      entry('top', rule(100, { min: 4, max: 6 })),
      ...[1, 2, 3].map(() => entry('backoff', rule(85))),
    ];
    const out = routineTemplatesWithTargets(topBackoff(), coachEntries({ setType: 'top', sets: 3, builtIn }), { legacy: false, newId: idGen(50_000), ruleOf, editedAtUtc: at(0).utc });
    expect(shape(out)).toEqual(['warmup 60×8–8', 'top 100×5–5', 'backoff 85×6–8', 'backoff 85×6–8', 'backoff 85×6–8']);
    // Only the top set is the coach's; the back-offs are the built-in rule's.
    expect(out.filter((t) => ruleOf.get(t.id)?.source === 'coach').map((t) => t.setType)).toEqual(['top']);
    expect(out.filter((t) => ruleOf.get(t.id)?.source === 'built_in_rule').map((t) => t.setType)).toEqual(['backoff', 'backoff', 'backoff']);
  });

  it('a coach target of a type the workout no longer has goes on its first working type; types are never merged', () => {
    const out = routineTemplatesWithTargets(topBackoff(), coachEntries({ setType: 'working', sets: 3 }), { legacy: false, newId: idGen(50_100), ruleOf: new Map(), editedAtUtc: at(2000).utc });
    // Edited since (at 2000 > 1300): the top set keeps its 4–6; the coach's 5 reps fit, so its load is used.
    expect(shape(out)).toEqual(['warmup 60×8–8', 'top 100×4–6', 'backoff 97.5×6–8', 'backoff 97.5×6–8', 'backoff 97.5×6–8']);
  });

  it('a one-type workout not edited since the target: the coach’s set count is used', () => {
    const ts = [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 4, count: 4 }), { legacy: false, newId: idGen(50_200), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(shape(out)).toEqual(Array(4).fill('working 100×5–5'));
  });

  it('edited after the target: Ben’s count and reps win; the coach’s 5-rep load doesn’t fit 6–8, so the built-in rule’s load is used (B1 r2)', () => {
    const ts = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const ruleOf = new Map<string, PlannedSet>();
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 3 }), { legacy: false, newId: idGen(50_300), ruleOf, editedAtUtc: at(2000).utc });
    expect(shape(out)).toEqual(Array(4).fill('working 97.5×6–8'));
    expect(out.every((t) => ruleOf.get(t.id)?.source === 'built_in_rule')).toBe(true);
  });

  it('edited after the target, coach reps inside Ben’s range: his reps stay and the coach’s load is used', () => {
    const ts = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 4, max: 6 } }));
    const ruleOf = new Map<string, PlannedSet>();
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 3 }), { legacy: false, newId: idGen(50_350), ruleOf, editedAtUtc: at(2000).utc });
    expect(shape(out)).toEqual(Array(4).fill('working 100×4–6'));
    expect(out.every((t) => ruleOf.get(t.id)?.source === 'coach')).toBe(true);
  });

  it('a target that became active after the edit (Applied later) counts as unedited', () => {
    const ts = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 3 }), { legacy: false, newId: idGen(50_380), ruleOf: new Map(), editedAtUtc: at(1000).utc });
    expect(shape(out)).toEqual(Array(3).fill('working 100×5–5'));
  });

  it('a slot never changed (no structure time) takes the coach’s count and reps', () => {
    const ts = [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 2, count: 2 }), { legacy: false, newId: idGen(50_390), ruleOf: new Map() });
    expect(shape(out)).toEqual(Array(2).fill('working 100×5–5'));
  });

  it('a timed set never gets the coach’s reps (S2): it keeps its time and takes the built-in rule’s load', () => {
    const ts = [template(1, { targetReps: null, targetDurationS: 40 }), template(2, { targetReps: null, targetDurationS: 40 })];
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: null, count: 2 }), { legacy: false, newId: idGen(50_395), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(out.map((t) => [t.targetReps, t.targetDurationS, t.targetLoad?.value ?? null])).toEqual([
      [null, 40, 97.5],
      [null, 40, 97.5],
    ]);
  });

  it('the coach kept the count (sets null): the workout’s count stays even when the built-in plan has another', () => {
    const ts = [1, 2].map((n) => template(n));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: null, count: 3 }), { legacy: false, newId: idGen(50_400), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(out).toHaveLength(2);
  });

  it('a coach count on a mixed workout is not used, even unedited', () => {
    const out = routineTemplatesWithTargets(topBackoff(), coachEntries({ setType: 'top', sets: 5, count: 5 }), { legacy: false, newId: idGen(50_500), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(out.map((t) => t.setType)).toEqual(['warmup', 'top', 'backoff', 'backoff', 'backoff']);
  });

  it('fewer sets drop Auto sets from the end; Ben’s Fixed pin is kept, with its load', () => {
    const ts = [template(1), template(2), template(3, { targetLoad: kg(90) })];
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 2, count: 2 }), { legacy: false, newId: idGen(50_600), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(shape(out)).toEqual(['working 100×5–5', 'working 90×6–8']);
  });

  it('a routine from before the library keeps the old behaviour: the coach rows are the working sets', () => {
    const out = routineTemplatesWithTargets(topBackoff(), coachEntries({ setType: 'top', sets: 3 }), { legacy: true, newId: idGen(50_700), ruleOf: new Map() });
    expect(shape(out)).toEqual(['warmup 60×8–8', 'top 100×5–5', 'top 100×5–5', 'top 100×5–5']);
  });
});

function finishedSource(): SessionAggregate {
  let s = pushA();
  for (const set of exerciseSets(s, INCLINE)) s = expectOk(reduceSession(s, logCmd(set.id, values(kg(32.5, 'per_hand'), 10), 60 + set.index * 120, `log-${set.id}`))).state;
  return expectOk(reduceSession(s, { type: 'finish', at: at(1200), opId: 'finish-src', expectedVersion: s.session.version, endedAt: null })).state;
}

function coachRow(source: SessionAggregate, sets: number | null): NextSessionTargetRecord {
  return {
    id: id(4001),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: SET_AT,
    updatedAtUtc: SET_AT,
    sourceSessionId: source.session.id,
    sourceVersion: source.session.version,
    exerciseId: INCLINE,
    exerciseName: 'Incline DB press',
    actionId: ACTION,
    target: { load: kg(35, 'per_hand'), reps: { min: 8, max: 10 } },
    sets,
    builtIn: null,
    builtInSets: null,
    size: 'small',
    status: 'saved',
    reason: 'All sets at RPE 7.',
    guardNotes: [],
    pctChange: 7.7,
    usedBySessionId: null,
  };
}

describe('Start of a library workout edited after a coach target (B1, WL-A4, WL7)', () => {
  const source = finishedSource();
  const ruleWhy = { source: 'rule' as const, setAt: at(1200), routineName: null, requestedLoad: kg(32.5, 'per_hand'), basis: null, guardNotes: [] };
  const builtIn = new Map([[INCLINE, [1, 2, 3].map(() => entry('working', { ...rule(32.5), load: kg(32.5, 'per_hand'), provenance: ruleWhy }))]]);

  // `changedAtUtc`: when Ben last changed the slot's structure (S1); the workout's own `updatedAtUtc` (a rename, a rotation toggle) is later and doesn't count.
  const library = (changedAtUtc: string | undefined, setTemplates: SetTemplate[]): Routine => ({
    ...routine([routineExercise(901, { exerciseId: INCLINE, equipmentId: mainRack.id, order: 0, setTemplates, ...(changedAtUtc === undefined ? {} : { structureChangedAtUtc: changedAtUtc }) })]),
    source: 'ben',
    updatedAtUtc: at(9000).utc,
  });
  const start = (r: Routine, sets: number | null) =>
    planRoutineStart({
      opId: 'b1-start',
      owner: profile(),
      gymId: MAIN,
      routine: r,
      exercises: EXERCISES,
      gymEquipment: MAIN_EQ,
      knownEquipment: new Map(MAIN_EQ.map((e) => [e.id, e])),
      at: at(86_400),
      newId: idGen(60_000),
      targets: withCoachTargets(builtIn, [coachRow(source, sets)], source, { flaggedExerciseIds: new Set(), painToday: false }),
    });

  it('Ben restructured Incline as 1 Top 4–6 + 2 Back-off 6–8 after the coach saved 4 × 35 kg each × 8–10: Start keeps his structure', () => {
    const edited = library(at(5000).utc, [
      template(1, { setType: 'top', targetReps: { min: 4, max: 6 } }),
      template(2, { setType: 'backoff', targetReps: { min: 6, max: 8 } }),
      template(3, { setType: 'backoff', targetReps: { min: 6, max: 8 } }),
    ]);
    const sets = exerciseSets(start(edited, 4).aggregate, INCLINE);
    expect(sets.map((s) => s.setType)).toEqual(['top', 'backoff', 'backoff']);
    // His 4–6 stays; the coach's 35 kg was for 8–10, so the top set takes the built-in rule's load (B1 r2).
    expect(sets[0]?.planned).toMatchObject({ load: kg(32.5, 'per_hand'), reps: { min: 4, max: 6 }, source: 'built_in_rule' });
    expect(sets[1]?.planned).toMatchObject({ load: kg(32.5, 'per_hand'), reps: { min: 6, max: 8 }, source: 'built_in_rule' });
  });

  it('WL-A4: Ben changes Incline to 6–8 after a coach 35 kg × 8–10 target: Start shows 6–8 at the rule’s load, with one Why? line', () => {
    const edited = library(at(5000).utc, [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 } })));
    const sets = exerciseSets(start(edited, null).aggregate, INCLINE);
    expect(sets.map((s) => [s.planned.reps, s.planned.load?.value, s.planned.source])).toEqual(Array(3).fill([{ min: 6, max: 8 }, 32.5, 'built_in_rule']));
    expect(sets[0]?.planned.provenance?.guardNotes).toContain('Kept your edit: 6–8 reps');
  });

  it('Ben widens Incline to 8–12 after the target: his reps stay and the coach’s 35 kg (for 8–10, inside 8–12) is used', () => {
    const edited = library(at(5000).utc, [1, 2, 3].map((n) => template(n, { targetReps: { min: 8, max: 12 } })));
    const sets = exerciseSets(start(edited, null).aggregate, INCLINE);
    expect(sets.map((s) => [s.planned.reps, s.planned.load?.value, s.planned.source])).toEqual(Array(3).fill([{ min: 8, max: 12 }, 35, 'coach']));
  });

  it('a rename or rotation toggle after the target (workout updatedAtUtc later, slot unchanged) keeps the coach’s count and reps (S1)', () => {
    const three = [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const sets = exerciseSets(start(library(undefined, three), 2).aggregate, INCLINE);
    expect(sets.map((s) => [s.planned.reps, s.planned.load?.value, s.planned.source])).toEqual(Array(2).fill([{ min: 8, max: 10 }, 35, 'coach']));
  });

  it('a target Ben Applies after his edit counts from when it was applied (S1): the coach’s count is used', () => {
    const four = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 8, max: 10 } }));
    const applied = { ...coachRow(source, 3), status: 'applied' as const, version: 2, updatedAtUtc: at(6000).utc };
    const targets = withCoachTargets(builtIn, [applied], source, { flaggedExerciseIds: new Set(), painToday: false });
    expect(targets.get(INCLINE)?.find((e) => e.coach !== undefined)?.coach?.setAtUtc).toBe(at(6000).utc);
    // `Why?` shows the same time the comparison uses, not when the coach first raised it (review N14).
    expect(targets.get(INCLINE)?.find((e) => e.coach !== undefined)?.planned.provenance?.setAt.utc).toBe(at(6000).utc);
    const out = planRoutineStart({
      opId: 'b1-applied',
      owner: profile(),
      gymId: MAIN,
      routine: library(at(5000).utc, four),
      exercises: EXERCISES,
      gymEquipment: MAIN_EQ,
      knownEquipment: new Map(MAIN_EQ.map((e) => [e.id, e])),
      at: at(86_400),
      newId: idGen(61_000),
      targets,
    });
    expect(exerciseSets(out.aggregate, INCLINE)).toHaveLength(3);
  });

  it('a one-type workout edited to 4 sets after a coach 3-set target keeps 4, and Why? says so; unedited it takes the coach’s 3', () => {
    const four = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 8, max: 10 } }));
    const edited = exerciseSets(start(library(at(5000).utc, four), 3).aggregate, INCLINE);
    expect(edited).toHaveLength(4);
    expect(edited[0]?.planned.provenance?.guardNotes).toContain('Kept your edit: 4 sets');
    expect(exerciseSets(start(library(at(0).utc, four), 3).aggregate, INCLINE)).toHaveLength(3);
  });
});

/**
 * Target RPE (ADR 0006 amendment 3) on a library workout: the coach's target
 * RPE goes with its load wherever its load is used (WL7: unedited, or edited
 * since with the coach's reps inside Ben's range), and sets Ben adds before
 * Start carry the same target as the set they copy.
 */
describe('target RPE on a library workout (merge with target RPE)', () => {
  const withRpe = (o: { sets?: number | null; count?: number }, rpe: number): NextTargetEntry[] => coachEntries(o).map((e) => ({ ...e, planned: { ...e.planned, rpe } }));

  it('unedited since the coach target: its load, reps and target RPE are used', () => {
    const ts = [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 }, targetRpe: 9 }));
    const out = routineTemplatesWithTargets(ts, withRpe({ sets: 3 }, 8), { legacy: false, newId: idGen(51_000), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(out.map((t) => [t.targetLoad?.value ?? null, t.targetRpe, t.targetRir])).toEqual(Array(3).fill([100, 8, null]));
  });

  it('edited since, coach reps inside Ben’s range: his reps, the coach’s load and its target RPE', () => {
    const ts = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 4, max: 6 } }));
    const out = routineTemplatesWithTargets(ts, withRpe({ sets: 3 }, 8), { legacy: false, newId: idGen(51_100), ruleOf: new Map(), editedAtUtc: at(2000).utc });
    expect(out.map((t) => [t.targetLoad?.value ?? null, t.targetReps, t.targetRpe])).toEqual(Array(4).fill([100, { min: 4, max: 6 }, 8]));
  });

  it('edited since, coach reps outside his range: the built-in rule’s load, and the set keeps its own target RPE (not the coach’s)', () => {
    const ts = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 6, max: 8 }, targetRpe: 9 }));
    const out = routineTemplatesWithTargets(ts, withRpe({ sets: 3 }, 7), { legacy: false, newId: idGen(51_200), ruleOf: new Map(), editedAtUtc: at(2000).utc });
    expect(out.map((t) => [t.targetLoad?.value ?? null, t.targetRpe])).toEqual(Array(4).fill([97.5, 9]));
  });

  it('a coach target with no RPE leaves the template’s own RPE/RIR alone', () => {
    const ts = [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 }, targetRir: 2 }));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 3 }), { legacy: false, newId: idGen(51_300), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(out.map((t) => [t.targetRpe, t.targetRir])).toEqual(Array(3).fill([null, 2]));
  });

  it('sets Ben adds before Start copy the last working set’s target RPE; with none, they fall back to the rule’s like the others', () => {
    const ts = [template(1, { setType: 'warmup', targetRpe: null }), ...[2, 3].map((n) => template(n, { targetRpe: 8.5 }))];
    const more = shapeTemplates(ts, { workingSets: 4 }, { newId: idGen(51_400) });
    expect(more.filter((t) => t.setType !== 'warmup').map((t) => t.targetRpe)).toEqual([8.5, 8.5, 8.5, 8.5]);
    const plain = shapeTemplates([2, 3].map((n) => template(n)), { workingSets: 3 }, { newId: idGen(51_500) });
    const targets = plain.map((t) => targetRpeOf({ setType: t.setType, planned: { rpe: t.targetRpe, rir: t.targetRir, source: 'built_in_rule' } }, 9));
    expect(targets).toEqual(Array(3).fill({ rpe: 9, source: 'rule' }));
  });
});
