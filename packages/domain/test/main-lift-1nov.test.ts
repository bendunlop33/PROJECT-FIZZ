import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type Routine, type SessionAggregate } from '@fizz/schemas';

import { mainLiftDayName, mainLiftOffer, mainLiftTemplateClash, reduceSession, templateWithMainLift, timeFitOffer, withOneMainLift, workoutMainLifts, type BuilderExerciseInfo } from '../src/index';
import { at, id, kg, routineExercise, template, values } from './fixtures';
import { BENCH, ROW, apply, expectError, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 1 Nov) `Make main lift`: one main lift per day, the one before becomes a normal compound keeping its sets,
 * sets untouched; the plan day's key and name follow (Every week); today's live workout changes only its plan day's
 * main lift and name (versioned, idempotent, undoable; a done set never changes).
 */

const INCLINE = id(210);
const PLAN = id(900);

function pushB(): Pick<Routine, 'id' | 'exercises' | 'name' | 'planDay' | 'deletedAtUtc'> {
  return {
    id: id(800),
    name: 'Push B · bench press',
    planDay: { planId: PLAN, dayIndex: 1, splitDayId: 'push', mainLiftExerciseId: BENCH, minutes: 60 },
    deletedAtUtc: null,
    exercises: [
      routineExercise(600, { exerciseId: BENCH, order: 0, main: true, setTemplates: [template(6001, { setType: 'top' }), template(6002, { setType: 'backoff' }), template(6003, { setType: 'backoff' })] }),
      routineExercise(601, { exerciseId: INCLINE, order: 1, setTemplates: [template(6011), template(6012), template(6013)] }),
      routineExercise(602, { exerciseId: ROW, order: 2, setTemplates: [template(6021), template(6022)] }),
    ],
  };
}

describe('one main lift per day (pure)', () => {
  it('the pick is the only main lift; every other is not; sets, order and supersets untouched', () => {
    const r = pushB();
    const out = withOneMainLift(r.exercises, id(601));
    if (out === null || out === 'same') throw new Error('no change');
    expect(out.map((e) => e.main)).toEqual([false, true, false]);
    expect(out.map((e) => e.setTemplates)).toEqual(r.exercises.map((e) => e.setTemplates));
    expect(out.map((e) => [e.id, e.order, e.supersetGroup])).toEqual(r.exercises.map((e) => [e.id, e.order, e.supersetGroup]));
    expect(withOneMainLift(out, id(601))).toBe('same');
    expect(withOneMainLift(r.exercises, 'nope')).toBeNull();
  });

  it('Every week: the template’s key and name follow; the previous main lift keeps its top set and back-offs', () => {
    const r = pushB();
    const t = templateWithMainLift(r, { rowId: id(601), liftName: 'Incline barbell press' });
    if (t === null) throw new Error('no change');
    expect(t.planDay?.mainLiftExerciseId).toBe(INCLINE);
    expect(t.name).toBe('Push B · incline barbell press');
    expect(t.exercises.find((e) => e.exerciseId === BENCH)?.setTemplates.map((x) => x.setType)).toEqual(['top', 'backoff', 'backoff']);
    expect(t.exercises.find((e) => e.exerciseId === BENCH)?.main).toBe(false);
    expect(t.exercises.filter((e) => e.main === true).map((e) => e.exerciseId)).toEqual([INCLINE]);
    // Already the main lift: nothing to write.
    expect(templateWithMainLift({ ...r, ...t }, { rowId: id(601), liftName: 'Incline barbell press' })).toBeNull();
    // A saved workout (no plan day) keeps its own name.
    const saved = templateWithMainLift({ ...r, name: 'My push', planDay: undefined }, { rowId: id(601), liftName: 'Incline barbell press' });
    expect(saved?.name).toBe('My push');
    expect(saved?.planDay).toBeUndefined();
  });

  it('names: only a day name with a `·` part follows', () => {
    expect(mainLiftDayName('Push B · bench press', 'Overhead press')).toBe('Push B · overhead press');
    expect(mainLiftDayName('Push B', 'Overhead press')).toBe('Push B');
  });

  it('another template of the same plan day with that main lift: a clash (one per plan day and lift)', () => {
    const r = pushB();
    const key = pushB().planDay;
    if (key === undefined) throw new Error('no key');
    const other = { ...pushB(), id: id(801), planDay: { ...key, mainLiftExerciseId: INCLINE } };
    expect(mainLiftTemplateClash(r, [r, other], INCLINE)).toBe(true);
    expect(mainLiftTemplateClash(r, [r, { ...other, deletedAtUtc: '2026-10-01T00:00:00.000Z' }], INCLINE)).toBe(false);
    expect(mainLiftTemplateClash(r, [r, { ...other, planDay: { ...other.planDay, dayIndex: 2 } }], INCLINE)).toBe(false);
  });
});

/** Push A from the session fixture, started as plan day 1 with bench as its main lift. */
function planWorkout(): SessionAggregate {
  const { state } = startFixture();
  return { ...state, session: { ...state.session, routineName: 'Push A · bench press', planDay: { planId: PLAN, dayIndex: 0, splitDayId: 'push', mainLiftExerciseId: BENCH, templateRoutineId: null, templateVersion: null, variationId: null } } };
}
const rowOf = (a: SessionAggregate, exerciseId: string) => a.exercises.find((e) => e.exerciseId === exerciseId)?.id ?? '';
const setMain = (a: SessionAggregate, exerciseId: string, opId = 'main-1', expectedVersion = a.session.version) => reduceSession(a, { type: 'set_main_lift', at: at(30), opId, sessionExerciseId: rowOf(a, exerciseId), expectedVersion });

describe('set_main_lift on the live workout', () => {
  it('today only: the plan day’s main lift and the name follow; no set changes at all; the aggregate stays valid', () => {
    let a = planWorkout();
    const bench = setsFor(a, BENCH);
    a = apply(a, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 10));
    a = apply(a, logCmd(bench[1]?.id ?? '', values(kg(100), 5), 200));
    const before = a.sets;
    const r = expectOk(setMain(a, ROW));
    expect(r.state.session.planDay?.mainLiftExerciseId).toBe(ROW);
    expect(r.state.session.routineName).toBe('Push A · cable row');
    expect(r.state.session.version).toBe(a.session.version + 1);
    expect(r.state.sets).toEqual(before);
    expect(workoutMainLifts(r.state, new Set([BENCH]))).toEqual(new Set([ROW]));
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
  });

  it('a repeated op ID changes nothing; a stale version is refused; the same lift again is a no-op', () => {
    const a = planWorkout();
    const first = expectOk(setMain(a, ROW));
    const again = expectOk(reduceSession(first.state, { type: 'set_main_lift', at: at(30), opId: 'main-1', sessionExerciseId: rowOf(a, ROW), expectedVersion: a.session.version }));
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(first.state);
    expectError(setMain(first.state, BENCH, 'main-2', a.session.version), 'stale_version');
    expect(expectOk(setMain(first.state, ROW, 'main-3')).state.session.version).toBe(first.state.session.version);
  });

  it('Undo puts the main lift and name back; an older change can’t be undone once another came after it', () => {
    const a = planWorkout();
    const one = expectOk(setMain(a, ROW, 'main-1')).state;
    const back = expectOk(reduceSession(one, { type: 'undo_op', at: at(40), opId: 'undo-1', targetOpId: 'main-1' })).state;
    expect(back.session.planDay?.mainLiftExerciseId).toBe(BENCH);
    expect(back.session.planDay?.mainLiftChange).toBeUndefined();
    expect(back.session.routineName).toBe('Push A · bench press');
    expect(workoutMainLifts(back, new Set([BENCH]))).toEqual(new Set([BENCH]));
    const two = expectOk(setMain(one, BENCH, 'main-2')).state;
    expectError(reduceSession(two, { type: 'undo_op', at: at(50), opId: 'undo-2', targetOpId: 'main-1' }), 'stale_version');
  });

  it('refused without a plan day, on a timed row, and after Finish', () => {
    const { state } = startFixture();
    expectError(setMain(state, ROW), 'exercise_not_found');
    const a = planWorkout();
    expectError(reduceSession(a, { type: 'set_main_lift', at: at(30), opId: 'main-h', sessionExerciseId: a.exercises[3]?.id ?? '', expectedVersion: a.session.version }), 'exercise_not_found');
    const done = { ...a, session: { ...a.session, status: 'finished' as const } };
    expectError(setMain(done, ROW), 'session_finished');
  });

  it('the offer: a compound strength row of a plan workout that isn’t the main lift and has a set left', () => {
    const a = planWorkout();
    const mains = workoutMainLifts(a, new Set());
    expect(mainLiftOffer(a, rowOf(a, ROW), mains, true)).toEqual({ current: BENCH, can: true });
    expect(mainLiftOffer(a, rowOf(a, ROW), mains, false).can).toBe(false);
    expect(mainLiftOffer(a, rowOf(a, BENCH), mains, true).can).toBe(false);
    const { state } = startFixture();
    expect(mainLiftOffer(state, rowOf(state, ROW), workoutMainLifts(state, new Set()), true).can).toBe(false);
  });

  it('the workout’s +N min fit reads the new main lift: never cut, its sets kept', () => {
    const infoOf = (exerciseId: string, name: string, group: 'Chest' | 'Back', role: 'compound' | 'isolation'): BuilderExerciseInfo => ({ exerciseId, name, group, role, heavy: role === 'compound', part: group, muscles: [group.toLowerCase()], angle: group, barbell: role === 'compound' });
    const INFO = new Map([[BENCH, infoOf(BENCH, 'Bench press', 'Chest', 'compound')], [ROW, infoOf(ROW, 'Cable row', 'Back', 'compound')]]);
    const info = (exerciseId: string): BuilderExerciseInfo | null => INFO.get(exerciseId) ?? infoOf(exerciseId, 'Face pull', 'Back', 'isolation');
    const a = expectOk(setMain(planWorkout(), ROW)).state;
    const o = timeFitOffer({ aggregate: a, overByMinutes: 30, info, mainExerciseIds: new Set([BENCH]) });
    expect(o.lines.some((l) => l.sessionExerciseId === rowOf(a, ROW))).toBe(false);
  });
});
