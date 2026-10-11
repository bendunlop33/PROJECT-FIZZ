import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, PlannedSet, Routine, SessionAggregate } from '@fizz/schemas';
import { SessionAggregateSchema } from '@fizz/schemas';
import { createMemoryRepositories, createSessionService, planRoutineStart, reduceSession } from '../src/index';
import { assisted, at, dumbbells, exercise, id, idGen, kg, OWNER, profile, routine, routineExercise, template } from './fixtures';
import { BENCH, CABLE_ROW, EXERCISES, exerciseSets, HOTEL, HOTEL_EQ, INCLINE, LATERAL, MAIN, MAIN_EQ, mainBar, mainCable, mainRack, propose, rowOf, switchCmd } from './gym-fixture';
import { expectOk } from './session-fixture';

/**
 * Routine Start on the shared fit (merge review S1, ADR 0019): the routine's
 * own item and unfitted loads go to `startWorkout`, so `planned.snap` keeps
 * the plan and a later switch back restores it.
 */

const plain = (s: string) => s.replaceAll(' ', ' ');

/** Push A as a saved routine pinned to Main Gym's items (gym-switch §7 fixture). */
const PUSH_A: Routine = {
  ...routine([
    routineExercise(900, { exerciseId: BENCH, equipmentId: mainBar.id, order: 0, setTemplates: [1, 2, 3, 4].map((n) => template(9000 + n, { targetLoad: kg(100), targetReps: { min: 6, max: 8 } })) }),
    routineExercise(901, { exerciseId: INCLINE, equipmentId: mainRack.id, order: 1, setTemplates: [1, 2, 3].map((n) => template(9010 + n, { targetLoad: kg(32.5, 'per_hand'), targetReps: { min: 8, max: 10 } })) }),
    routineExercise(902, { exerciseId: CABLE_ROW, equipmentId: mainCable.id, order: 2, setTemplates: [1, 2, 3].map((n) => template(9020 + n, { targetLoad: kg(50, 'stack'), targetReps: { min: 12, max: 12 } })) }),
    routineExercise(903, { exerciseId: LATERAL, equipmentId: mainRack.id, order: 3, setTemplates: [1, 2, 3].map((n) => template(9030 + n, { targetLoad: kg(10, 'per_hand'), targetReps: { min: 12, max: 15 } })) }),
  ]),
  name: 'Push A',
};

const known = new Map<string, EquipmentInstance>(MAIN_EQ.map((e) => [e.id, e]));

function startAt(gymId: string, gymEquipment: EquipmentInstance[], over: Partial<Parameters<typeof planRoutineStart>[0]> = {}) {
  return planRoutineStart({
    opId: 'rs-1',
    owner: profile(),
    gymId,
    routine: PUSH_A,
    exercises: EXERCISES,
    gymEquipment,
    knownEquipment: known,
    at: at(0),
    newId: idGen(30_000),
    gymName: gymId === HOTEL ? 'Hotel · Lisbon' : 'Main Gym',
    ...over,
  });
}

const loads = (s: SessionAggregate, exerciseId: string) => exerciseSets(s, exerciseId).map((x) => x.planned.load);

describe('Routine Start at the hotel, then switch back to Main (review S1, GS2)', () => {
  const out = startAt(HOTEL, HOTEL_EQ);
  const s = out.aggregate;

  it('at the hotel: bench has reps and no load, and the plan is kept on the set', () => {
    expect(SessionAggregateSchema.parse(s)).toBeTruthy();
    expect(rowOf(s, BENCH)?.equipmentId).toBeNull();
    expect(loads(s, BENCH)).toEqual([null, null, null, null]);
    expect(exerciseSets(s, BENCH).map((x) => x.planned.reps)).toEqual(Array(4).fill({ min: 6, max: 8 }));
    expect(exerciseSets(s, BENCH)[0]?.planned.snap).toMatchObject({ intended: kg(100), outcome: 'dropped', reason: 'not_here', intendedOn: { equipmentId: mainBar.id, name: 'Olympic bar' }, by: 'start' });
    // Incline capped on the hotel rack, the intended 32.5 kg kept.
    expect(rowOf(s, INCLINE)?.equipmentId).toBe(HOTEL_EQ[0]?.id);
    expect(loads(s, INCLINE)).toEqual(Array(3).fill(kg(20, 'per_hand')));
    expect(exerciseSets(s, INCLINE)[0]?.planned.snap).toMatchObject({ intended: kg(32.5, 'per_hand'), outcome: 'capped' });
  });

  it('notes name the gym (N2)', () => {
    expect(out.notes).toContainEqual({ exerciseName: 'Bench press', text: 'No Olympic bar at Hotel · Lisbon: no load target.', tone: 'warning' });
    expect(out.notes).toContainEqual({ exerciseName: 'Cable row', text: 'No Cable station at Hotel · Lisbon: no load target.', tone: 'warning' });
    expect(out.notes).toContainEqual({ exerciseName: 'Incline DB press', text: 'Rounded down from 32.5 kg each: Hotel · Lisbon stops at 20 kg each.', tone: 'info' });
  });

  it('Why? on a dropped routine-template load says why (N3)', () => {
    expect(exerciseSets(s, BENCH)[0]?.planned.provenance?.guardNotes.map(plain)).toEqual(['No load target: plan was 100 kg, and this gym has nothing of that kind to check it on.']);
  });

  it('switching to Main restores the bar and 100 kg, the rack and 32.5 kg, the cable and 50 kg', () => {
    const p = propose(s, { id: MAIN, equipment: MAIN_EQ });
    const back = expectOk(reduceSession(s, switchCmd(p, 60))).state;
    expect(rowOf(back, BENCH)?.equipmentId).toBe(mainBar.id);
    expect(loads(back, BENCH)).toEqual(Array(4).fill(kg(100)));
    expect(loads(back, INCLINE)).toEqual(Array(3).fill(kg(32.5, 'per_hand')));
    expect(loads(back, CABLE_ROW)).toEqual(Array(3).fill(kg(50, 'stack')));
    // Why? no longer carries the hotel's drop note.
    expect(exerciseSets(back, BENCH)[0]?.planned.provenance?.guardNotes).toEqual([]);
  });

  it('a rule target dropped at the hotel is restored at Main too, still the rule’s', () => {
    const ruleWhy = { source: 'rule' as const, setAt: at(-100), routineName: null, requestedLoad: null, basis: null, rule: { name: 'Built-in', decision: 'increase_load' as const, summary: 'Increase to 102.5 kg.', facts: [] }, guardNotes: [] };
    const planned: PlannedSet = { load: kg(102.5), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule', provenance: ruleWhy };
    const hotel = startAt(HOTEL, HOTEL_EQ, { targets: new Map([[BENCH, [{ setType: 'working' as const, planned }, { setType: 'working' as const, planned }]]]) }).aggregate;
    expect(loads(hotel, BENCH)).toEqual([null, null]);
    expect(exerciseSets(hotel, BENCH)[0]?.planned.source).toBe('built_in_rule');
    expect(exerciseSets(hotel, BENCH)[0]?.planned.provenance?.guardNotes.map(plain)).toEqual(['No load target: target was 102.5 kg, and this gym has nothing of that kind to check it on.']);
    const back = expectOk(reduceSession(hotel, switchCmd(propose(hotel, { id: MAIN, equipment: MAIN_EQ }), 60))).state;
    expect(loads(back, BENCH)).toEqual([kg(102.5), kg(102.5)]);
    expect(exerciseSets(back, BENCH)[0]?.planned.source).toBe('built_in_rule');
    expect(exerciseSets(back, BENCH)[0]?.planned.provenance?.rule?.summary).toBe('Increase to 102.5 kg.');
  });
});

describe('Routine Start uses GS3 like Start, Repeat and the switch (one rule)', () => {
  it('another kind the exercise lists stands in when nothing of the same kind is here', () => {
    const ROW_ANY = id(850);
    const exs = new Map([[ROW_ANY, exercise(850, 'Row (any)', { compatibleEquipment: ['barbell', 'dumbbells'], defaultLoadConvention: 'per_hand' })]]);
    const r: Routine = { ...routine([routineExercise(950, { exerciseId: ROW_ANY, equipmentId: mainBar.id, setTemplates: [template(9500, { targetLoad: kg(25, 'per_hand'), targetReps: { min: 10, max: 10 } })] })]), name: 'Rows' };
    const out = startAt(HOTEL, HOTEL_EQ, { routine: r, exercises: exs });
    // Mapped to the hotel rack (step 4), and the load still fitted on it: capped at 20 kg each.
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(HOTEL_EQ[0]?.id);
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(20, 'per_hand'));
  });

  it('the item last used at this gym comes before the first of the same kind (GS3 step 2, N2)', () => {
    const spare = dumbbells({ id: id(711), gymId: HOTEL, name: 'Spare dumbbells', loads: [10, 15, 20, 25, 30] });
    const out = startAt(HOTEL, [...HOTEL_EQ, spare], { lastUsedHere: (exerciseId) => (exerciseId === INCLINE ? spare.id : null) });
    expect(rowOf(out.aggregate, INCLINE)?.equipmentId).toBe(spare.id);
    expect(loads(out.aggregate, INCLINE)).toEqual(Array(3).fill(kg(30, 'per_hand')));
  });
});

describe('Routine Start on an assisted machine (N1)', () => {
  const PULL = id(851);
  const exs = new Map([[PULL, exercise(851, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })]]);
  const machine = assisted({ gymId: MAIN });
  const r: Routine = { ...routine([routineExercise(951, { exerciseId: PULL, equipmentId: machine.id, setTemplates: [template(9510, { targetLoad: kg(50, 'assistance'), targetReps: { min: 6, max: 8 } })] })]), name: 'Pull' };

  it('more assistance than the machine gives: dropped, worded as assistance, never "heavier"', () => {
    const out = startAt(MAIN, [machine], { routine: r, exercises: exs });
    expect(out.aggregate.sets[0]?.planned.load).toBeNull();
    expect(out.notes).toEqual([{ exerciseName: 'Assisted pull-up', text: 'No load target: Assist 50 kg is more assistance than Main Gym gives.', tone: 'warning' }]);
    expect(out.aggregate.sets[0]?.planned.provenance?.guardNotes.map(plain)).toEqual(['No load target: plan was Assist 50 kg, more assistance than this machine gives.']);
  });
});

describe('session service: startRoutine passes the gym name and last-used item (N2)', () => {
  it('notes name the gym', async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    await repos.gyms.save({ id: HOTEL, ownerId: OWNER, version: 1, createdAtUtc: at(0).utc, updatedAtUtc: at(0).utc, name: 'Hotel · Lisbon', isDefault: false }, null);
    for (const e of [...MAIN_EQ, ...HOTEL_EQ]) await repos.equipment.save(e, null);
    for (const e of EXERCISES.values()) await repos.exercises.save(e, null);
    await repos.routines.save({ ...PUSH_A, ownerId: OWNER }, null);
    const svc = createSessionService(repos, idGen(40_000));
    const r = await svc.startRoutine({ ownerId: OWNER, gymId: HOTEL, routineId: PUSH_A.id, opId: 'tap', at: at(10), preview: true, lastUsedHere: () => null });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.notes).toContainEqual({ exerciseName: 'Bench press', text: 'No Olympic bar at Hotel · Lisbon: no load target.', tone: 'warning' });
  });
});

