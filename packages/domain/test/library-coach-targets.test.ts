import { describe, expect, it } from 'vitest';
import type { NextSessionTargetRecord, PlannedSet, Routine, SessionAggregate, SetTemplate, SetType } from '@fizz/schemas';
import { planRoutineStart, reduceSession, routineTemplatesWithTargets, withCoachTargets, type NextTargetEntry } from '../src/index';
import { at, id, idGen, kg, OWNER, profile, routine, routineExercise, template, values } from './fixtures';
import { EXERCISES, exerciseSets, INCLINE, MAIN, MAIN_EQ, mainRack, pushA } from './gym-fixture';
import { expectOk, logCmd } from './session-fixture';

/**
 * Review B1 (workout-library A): a coach target for next time (D21) never
 * replaces a library workout's structure. The workout's set types, counts
 * and reps stay; the coach's load and reps go on the matching Auto sets; its
 * set count is used only on a one-type workout not edited since the target
 * was saved. A routine from before the library keeps the old behaviour.
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
    expect(shape(out)).toEqual(['warmup 60×8–8', 'top 100×5–5', 'backoff 97.5×6–8', 'backoff 97.5×6–8', 'backoff 97.5×6–8']);
  });

  it('a one-type workout not edited since the target: the coach’s set count is used', () => {
    const ts = [1, 2, 3].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 4, count: 4 }), { legacy: false, newId: idGen(50_200), ruleOf: new Map(), editedAtUtc: at(0).utc });
    expect(shape(out)).toEqual(Array(4).fill('working 100×5–5'));
  });

  it('edited after the target was saved: the workout’s set count wins; the coach’s load and reps still apply', () => {
    const ts = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    const out = routineTemplatesWithTargets(ts, coachEntries({ sets: 3 }), { legacy: false, newId: idGen(50_300), ruleOf: new Map(), editedAtUtc: at(2000).utc });
    expect(shape(out)).toEqual(Array(4).fill('working 100×5–5'));
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
  const builtIn = new Map([[INCLINE, [1, 2, 3].map(() => entry('working', { ...rule(32.5), load: kg(32.5, 'per_hand') }))]]);

  const library = (updatedAtUtc: string, setTemplates: SetTemplate[]): Routine => ({
    ...routine([routineExercise(901, { exerciseId: INCLINE, equipmentId: mainRack.id, order: 0, setTemplates })]),
    source: 'ben',
    updatedAtUtc,
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
    expect(sets[0]?.planned).toMatchObject({ load: kg(35, 'per_hand'), reps: { min: 8, max: 10 }, source: 'coach' });
    expect(sets[1]?.planned).toMatchObject({ load: kg(32.5, 'per_hand'), reps: { min: 6, max: 8 }, source: 'built_in_rule' });
  });

  it('a one-type workout edited to 4 sets after a coach 3-set target keeps 4; unedited it takes the coach’s 3', () => {
    const four = [1, 2, 3, 4].map((n) => template(n, { targetReps: { min: 6, max: 8 } }));
    expect(exerciseSets(start(library(at(5000).utc, four), 3).aggregate, INCLINE)).toHaveLength(4);
    expect(exerciseSets(start(library(at(0).utc, four), 3).aggregate, INCLINE)).toHaveLength(3);
  });
});
