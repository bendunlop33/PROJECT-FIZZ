import { describe, expect, it } from 'vitest';
import type { NextSessionTargetRecord, PlannedSet, Routine, SessionAggregate, SetType } from '@fizz/schemas';
import { planRoutineStart, reduceSession, startWorkoutFromSession, withCoachTargets } from '../src/index';
import { at, id, idGen, kg, OWNER, profile, routine, routineExercise, template, values } from './fixtures';
import { BENCH, EXERCISES, exerciseSets, HOTEL, HOTEL_EQ, INCLINE, MAIN, MAIN_EQ, mainBar, mainRack, propose, pushA, rowOf, switchCmd } from './gym-fixture';
import { expectOk, logCmd } from './session-fixture';

/**
 * A coach target for next time is saved against the gym it was made at, and
 * the next workout may start somewhere else. It goes through the same shared
 * fit (`snapPlanToGym`) as every other target, so it is re-snapped to that
 * gym's equipment and never above its max (rule 4; coach review B1.4).
 */

const ACTION = id(4000);

function finishedSource(): SessionAggregate {
  let s = pushA();
  for (const set of exerciseSets(s, INCLINE)) s = expectOk(reduceSession(s, logCmd(set.id, values(kg(32.5, 'per_hand'), 10), 60 + set.index * 120, `log-${set.id}`))).state;
  return expectOk(reduceSession(s, { type: 'finish', at: at(1200), opId: 'finish-src', expectedVersion: s.session.version, endedAt: null })).state;
}

function coachRow(source: SessionAggregate, load: number): NextSessionTargetRecord {
  return {
    id: id(4001),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(1300).utc,
    updatedAtUtc: at(1300).utc,
    sourceSessionId: source.session.id,
    sourceVersion: source.session.version,
    exerciseId: INCLINE,
    exerciseName: 'Incline DB press',
    actionId: ACTION,
    target: { load: kg(load, 'per_hand'), reps: { min: 8, max: 10 } },
    sets: null,
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

type Plan = Map<string, { setType: SetType; planned: PlannedSet }[]>;

function coachPlan(source: SessionAggregate, load: number): Plan {
  return withCoachTargets(new Map(), [coachRow(source, load)], source, { flaggedExerciseIds: new Set(), painToday: false });
}

const loads = (s: SessionAggregate, exerciseId: string) => exerciseSets(s, exerciseId).map((x) => x.planned.load);

describe('a coach target saved at Main is re-snapped when the next workout starts at the hotel', () => {
  const source = finishedSource();

  it('Start next session at the hotel: 35 kg each is capped at the hotel rack’s 20 kg each, still the coach’s target', () => {
    const plan = coachPlan(source, 35);
    expect(plan.get(INCLINE)?.map((p) => p.planned.load)).toEqual(Array(3).fill(kg(35, 'per_hand')));
    const out = startWorkoutFromSession({ opId: 'next-hotel', owner: profile(), gymId: HOTEL, gymName: 'Hotel · Lisbon', source, exercises: EXERCISES, gymEquipment: HOTEL_EQ, at: at(86_400), newId: idGen(40_000), targets: plan });
    const sets = exerciseSets(out.aggregate, INCLINE);
    expect(loads(out.aggregate, INCLINE)).toEqual(Array(3).fill(kg(20, 'per_hand')));
    expect(sets[0]?.planned.source).toBe('coach');
    expect(sets[0]?.planned.snap).toMatchObject({ intended: kg(35, 'per_hand'), outcome: 'capped' });
    expect(sets[0]?.planned.provenance?.coach).toMatchObject({ actionId: ACTION, scope: 'next_session' });
    // Switching to Main puts the coach's 35 kg each back (GS2).
    const back = expectOk(reduceSession(out.aggregate, switchCmd(propose(out.aggregate, { id: MAIN, equipment: MAIN_EQ }), 60))).state;
    expect(loads(back, INCLINE)).toEqual(Array(3).fill(kg(35, 'per_hand')));
    expect(exerciseSets(back, INCLINE)[0]?.planned.source).toBe('coach');
  });

  it('a coach load between the hotel’s steps is rounded to one the rack has', () => {
    const rack = { ...HOTEL_EQ[0], loads: [10, 15, 20] } as (typeof HOTEL_EQ)[number];
    const out = startWorkoutFromSession({ opId: 'next-hotel-2', owner: profile(), gymId: HOTEL, source, exercises: EXERCISES, gymEquipment: [rack], at: at(86_400), newId: idGen(41_000), targets: coachPlan(source, 17.5) });
    // Toward easier, never a load the rack doesn't have.
    expect(loads(out.aggregate, INCLINE)).toEqual(Array(3).fill(kg(15, 'per_hand')));
  });

  it('Routine Start at the hotel fits the coach target the same way', () => {
    const r: Routine = {
      ...routine([routineExercise(901, { exerciseId: INCLINE, equipmentId: mainRack.id, order: 0, setTemplates: [1, 2, 3].map((n) => template(9010 + n, { targetLoad: kg(32.5, 'per_hand'), targetReps: { min: 8, max: 10 } })) })]),
      name: 'Push A',
    };
    const out = planRoutineStart({
      opId: 'rs-hotel',
      owner: profile(),
      gymId: HOTEL,
      routine: r,
      exercises: EXERCISES,
      gymEquipment: HOTEL_EQ,
      knownEquipment: new Map(MAIN_EQ.map((e) => [e.id, e])),
      at: at(86_400),
      newId: idGen(42_000),
      gymName: 'Hotel · Lisbon',
      targets: coachPlan(source, 35),
    });
    expect(loads(out.aggregate, INCLINE)).toEqual(Array(3).fill(kg(20, 'per_hand')));
    expect(exerciseSets(out.aggregate, INCLINE)[0]?.planned.source).toBe('coach');
  });
});

describe('adjust_pending_targets passes the reducer’s rule-4 check (coach review B1.5)', () => {
  it('a load the row’s item can’t make is refused', () => {
    const s = pushA();
    const [first] = exerciseSets(s, INCLINE);
    const r = reduceSession(s, { type: 'adjust_pending_targets', at: at(10), opId: 'adj-1', expectedVersion: s.session.version, actionId: ACTION, reason: null, changes: [{ setId: first?.id ?? '', target: { load: kg(33, 'per_hand'), reps: { min: 8, max: 10 } } }], removeSetIds: [], addSets: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_values');
  });

  it('above the item’s max is refused, also on an added set', () => {
    const s = pushA();
    const [first] = exerciseSets(s, INCLINE);
    const r = reduceSession(s, { type: 'adjust_pending_targets', at: at(10), opId: 'adj-2', expectedVersion: s.session.version, actionId: ACTION, reason: null, changes: [], removeSetIds: [], addSets: [{ newSetId: id(4100), copyFromSetId: first?.id ?? '', target: { load: kg(42.5, 'per_hand'), reps: { min: 8, max: 10 } } }] });
    expect(r.ok).toBe(false);
  });

  it('after a switch to a gym with no bar, a bench load is refused: nothing here can check it', () => {
    const s = pushA();
    const hotel = expectOk(reduceSession(s, switchCmd(propose(s, { id: HOTEL, equipment: HOTEL_EQ }), 30))).state;
    expect(rowOf(hotel, BENCH)?.equipmentId).toBeNull();
    const pending = exerciseSets(hotel, BENCH).find((x) => x.status === 'pending');
    const r = reduceSession(hotel, { type: 'adjust_pending_targets', at: at(40), opId: 'adj-3', expectedVersion: hotel.session.version, actionId: ACTION, reason: null, changes: [{ setId: pending?.id ?? '', target: { load: kg(95), reps: { min: 6, max: 8 } } }], removeSetIds: [], addSets: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/no equipment here/);
    // Reps alone are fine.
    const reps = reduceSession(hotel, { type: 'adjust_pending_targets', at: at(41), opId: 'adj-4', expectedVersion: hotel.session.version, actionId: ACTION, reason: null, changes: [{ setId: pending?.id ?? '', target: { load: null, reps: { min: 5, max: 6 } } }], removeSetIds: [], addSets: [] });
    expect(reps.ok).toBe(true);
  });

  it('an achievable load on the item applies', () => {
    const s = pushA();
    const [first] = exerciseSets(s, BENCH);
    expect(rowOf(s, BENCH)?.equipmentId).toBe(mainBar.id);
    const r = reduceSession(s, { type: 'adjust_pending_targets', at: at(10), opId: 'adj-5', expectedVersion: s.session.version, actionId: ACTION, reason: null, changes: [{ setId: first?.id ?? '', target: { load: kg(97.5), reps: { min: 6, max: 8 } } }], removeSetIds: [], addSets: [] });
    expect(r.ok).toBe(true);
  });
});
