import { describe, expect, it } from 'vitest';
import type { CommandOf, SessionAggregate } from '@fizz/schemas';
import { buildAddExerciseCommand, buildExecutionOrder, reduceSession } from '../src/index';
import { at, exercise, idGen, kg, profile, stack, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * (12 Oct, coach `add_exercise_today`) The existing `add_exercise` command
 * with a position or a superset partner, and its Undo (`undo_op`): the
 * added row comes out again only while nothing on it is done (rule 2).
 */

const CURL = exercise(260, 'Cable curl', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const rowOf = (s: SessionAggregate, exerciseId: string) => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined);
const plan = (n: number) => Array.from({ length: n }, () => ({ setType: 'working' as const, planned: { load: kg(20, 'stack'), reps: { min: 10, max: 12 }, durationS: null, rpe: 8, rir: null } }));

function addCurl(_state: SessionAggregate, over: Partial<CommandOf<'add_exercise'>> = {}, opId = 'add-curl'): CommandOf<'add_exercise'> {
  return { ...buildAddExerciseCommand({ opId, owner: profile(), exercise: CURL, equipmentId: stack().id, at: at(10), newId: idGen(70_000), plan: plan(3) }), ...over };
}

const namesInOrder = (s: SessionAggregate) => [...s.exercises].filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order).map((e) => e.exerciseName);

describe('add_exercise placement', () => {
  it('goes at the end by default', () => {
    const { state } = startFixture();
    const s = apply(state, addCurl(state));
    expect(namesInOrder(s).at(-1)).toBe('Cable curl');
    expect(rowOf(s, CURL.id)?.supersetGroup).toBeNull();
    expect(setsFor(s, CURL.id)).toHaveLength(3);
  });

  it('goes straight after a named row', () => {
    const { state } = startFixture();
    const bench = rowOf(state, BENCH);
    const s = apply(state, addCurl(state, { afterSessionExerciseId: bench?.id ?? '' }));
    expect(namesInOrder(s)).toEqual(['Bench press', 'Cable curl', 'Cable row', 'Face pull', 'Dead hang']);
  });

  it('after a superset member goes after the whole superset, not inside it', () => {
    const { state } = startFixture();
    const row = rowOf(state, ROW);
    const s = apply(state, addCurl(state, { afterSessionExerciseId: row?.id ?? '' }));
    expect(namesInOrder(s)).toEqual(['Bench press', 'Cable row', 'Face pull', 'Cable curl', 'Dead hang']);
    expect(rowOf(s, CURL.id)?.supersetGroup).toBeNull();
  });

  it('joins an existing superset after its last member, and the rounds interleave', () => {
    const { state } = startFixture();
    const row = rowOf(state, ROW);
    const s = apply(state, addCurl(state, { supersetWithSessionExerciseId: row?.id ?? '' }));
    expect(rowOf(s, CURL.id)?.supersetGroup).toBe('A');
    expect(namesInOrder(s)).toEqual(['Bench press', 'Cable row', 'Face pull', 'Cable curl', 'Dead hang']);
    const order = buildExecutionOrder(s.exercises, s.sets);
    const curl = setsFor(s, CURL.id);
    const face = setsFor(s, FACE);
    expect(order.indexOf(curl[0]?.id ?? '')).toBe(order.indexOf(face[0]?.id ?? '') + 1);
  });

  it('pairs with a plain row under a new letter, and both rows get it', () => {
    const { state } = startFixture();
    const bench = rowOf(state, BENCH);
    const s = apply(state, addCurl(state, { supersetWithSessionExerciseId: bench?.id ?? '' }));
    expect(rowOf(s, BENCH)?.supersetGroup).toBe('B');
    expect(rowOf(s, CURL.id)?.supersetGroup).toBe('B');
    expect(namesInOrder(s)).toEqual(['Bench press', 'Cable curl', 'Cable row', 'Face pull', 'Dead hang']);
    // Bench's logged values are untouched by the pairing.
    expect(setsFor(s, BENCH).map((x) => x.planned)).toEqual(setsFor(state, BENCH).map((x) => x.planned));
  });

  it('refuses a partner that is done, or a row that is not in the workout', () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    const s = apply(state, logCmd(hang?.id ?? '', values(null, null, { durationS: 45 }), 30));
    expectError(reduceSession(s, addCurl(s, { supersetWithSessionExerciseId: rowOf(s, HANG)?.id ?? '' })), 'invalid_values');
    expectError(reduceSession(s, addCurl(s, { afterSessionExerciseId: idGen(99_000)() })), 'exercise_not_found');
  });

  it('a retry with the same opId and placement is a duplicate; another placement under it is refused', () => {
    const { state } = startFixture();
    const bench = rowOf(state, BENCH)?.id ?? '';
    const cmd = addCurl(state, { afterSessionExerciseId: bench });
    const s = apply(state, cmd);
    expect(expectOk(reduceSession(s, { ...cmd, at: at(99) })).duplicate).toBe(true);
    expectError(reduceSession(s, { ...cmd, afterSessionExerciseId: rowOf(s, ROW)?.id ?? '' }), 'operation_id_reused');
  });
});

describe('undo_op on add_exercise', () => {
  it('takes the row out, deletes its pending sets as tombstones, and is superseded afterwards', () => {
    const { state } = startFixture();
    const cmd = addCurl(state);
    const s = apply(state, cmd);
    const u = expectOk(reduceSession(s, { type: 'undo_op', at: at(20), opId: 'undo-add', targetOpId: cmd.opId }));
    expect(rowOf(u.state, CURL.id)).toBeUndefined();
    expect(u.state.exercises.find((e) => e.exerciseId === CURL.id)?.removed).toMatchObject({ opId: 'undo-add', by: 'remove' });
    expect(setsFor(u.state, CURL.id).every((x) => x.status === 'deleted')).toBe(true);
    expect(u.state.session.version).toBe(s.session.version + 1);
    // The add replayed now reports its effect is gone.
    expect(expectOk(reduceSession(u.state, cmd))).toMatchObject({ duplicate: true, superseded: true });
  });

  it('is refused once a set on the added row is logged (rule 2: a done set is never touched)', () => {
    const { state } = startFixture();
    const cmd = addCurl(state);
    let s = apply(state, cmd);
    const first = setsFor(s, CURL.id)[0];
    s = apply(s, logCmd(first?.id ?? '', values(kg(20, 'stack'), 12), 40));
    const r = reduceSession(s, { type: 'undo_op', at: at(50), opId: 'undo-add', targetOpId: cmd.opId });
    expectError(r, 'stale_version');
    expect(setsFor(s, CURL.id)[0]?.status).toBe('completed');
  });

  it('ungroups a partner left alone in its superset; an existing superset keeps its letter', () => {
    const { state } = startFixture();
    const pair = addCurl(state, { supersetWithSessionExerciseId: rowOf(state, BENCH)?.id ?? '' });
    const s = apply(state, pair);
    const back = apply(s, { type: 'undo_op', at: at(20), opId: 'u1', targetOpId: pair.opId });
    expect(rowOf(back, BENCH)?.supersetGroup).toBeNull();

    const join = addCurl(state, { supersetWithSessionExerciseId: rowOf(state, ROW)?.id ?? '' }, 'join');
    const t = apply(state, join);
    const back2 = apply(t, { type: 'undo_op', at: at(20), opId: 'u2', targetOpId: join.opId });
    expect(rowOf(back2, ROW)?.supersetGroup).toBe('A');
    expect(rowOf(back2, FACE)?.supersetGroup).toBe('A');
  });

  it('moves the active set on when the active set was on the added row', () => {
    const { state } = startFixture();
    const cmd = addCurl(state, { afterSessionExerciseId: rowOf(state, BENCH)?.id ?? '' });
    let s = apply(state, cmd);
    const curl1 = setsFor(s, CURL.id)[0]?.id ?? '';
    s = apply(s, { type: 'set_active_set', at: at(15), opId: 'jump', setId: curl1, expectedVersion: s.session.version });
    const u = apply(s, { type: 'undo_op', at: at(20), opId: 'undo-add', targetOpId: cmd.opId });
    expect(u.session.activeSetId).not.toBe(curl1);
    expect(u.sets.find((x) => x.id === u.session.activeSetId)?.status).toBe('pending');
  });
});
