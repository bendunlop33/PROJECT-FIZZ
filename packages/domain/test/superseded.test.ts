import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { reduceSession } from '../src/index';
import { at, id, kg, values } from './fixtures';
import { apply, BENCH, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

// Third review follow-up 4: duplicates report `superseded` when their effect is
// no longer in place, for every command where that is meaningful.

const bench = (s: SessionAggregate) => setsFor(s, BENCH);
const dup = (s: SessionAggregate, cmd: SessionCommand) => {
  const r = expectOk(reduceSession(s, { ...cmd, at: at(500) }));
  expect(r.duplicate).toBe(true);
  return r.superseded;
};

describe('superseded duplicates (third review follow-up 4)', () => {
  it('correct_set: superseded once a later correction, or a delete, changed the set', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30, 'l1'));
    const fix: SessionCommand = { type: 'correct_set', at: at(40), opId: 'c1', setId: w.id, expectedSetVersion: 2, patch: { reps: 9 } };
    s = apply(s, fix);
    expect(dup(s, fix)).toBe(false);
    const later = apply(s, { type: 'correct_set', at: at(50), opId: 'c2', setId: w.id, expectedSetVersion: 3, patch: { reps: 8 } });
    expect(dup(later, fix)).toBe(true);
    const deleted = apply(s, { type: 'delete_set', at: at(50), opId: 'd', setId: w.id, expectedSetVersion: 3 });
    expect(dup(deleted, fix)).toBe(true);
  });

  it('skip_exercise: superseded once a skipped set was deleted', () => {
    const { state } = startFixture();
    const skip: SessionCommand = { type: 'skip_exercise', at: at(10), opId: 'sk', sessionExerciseId: state.exercises[0]?.id ?? '' };
    const s = apply(state, skip);
    expect(dup(s, skip)).toBe(false);
    const b2 = bench(s)[2];
    const after = apply(s, { type: 'delete_set', at: at(20), opId: 'd', setId: b2?.id ?? '', expectedSetVersion: 2 });
    expect(dup(after, skip)).toBe(true);
  });

  it('add_set: a retry with a regenerated ID is a duplicate, superseded once the added set was deleted', () => {
    const { state } = startFixture();
    const add: SessionCommand = { type: 'add_set', at: at(10), opId: 'a', sessionExerciseId: state.exercises[1]?.id ?? '', newSetId: id(33_000), setType: null };
    const s = apply(state, add);
    expect(s.processedOps.a?.createdIds).toEqual([id(33_000)]);
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
    const retry = { ...add, newSetId: id(33_001) };
    expect(dup(s, retry)).toBe(false);
    const after = apply(s, { type: 'delete_set', at: at(20), opId: 'd', setId: id(33_000), expectedSetVersion: 1 });
    expect(dup(after, retry)).toBe(true);
    expect(setsFor(after, ROW).some((x) => x.id === id(33_001))).toBe(false);
  });

  it('update_session_timing: superseded once a later edit replaced the value', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    let s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 30, 'l1'));
    s = apply(s, { type: 'finish', at: at(300), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const edit: SessionCommand = {
      type: 'update_session_timing',
      at: at(400),
      opId: 'e1',
      expectedVersion: s.session.version,
      startedAt: null,
      endedAt: at(200),
    };
    s = apply(s, edit);
    expect(dup(s, edit)).toBe(false);
    s = apply(s, { ...edit, opId: 'e2', at: at(410), expectedVersion: s.session.version, endedAt: at(250) });
    expect(dup(s, edit)).toBe(true);
  });

  it('transient commands are never superseded (documented): a repeated pause after resume', () => {
    const { state } = startFixture();
    const pause: SessionCommand = { type: 'pause', at: at(10), opId: 'p' };
    let s = apply(state, pause);
    s = apply(s, { type: 'resume', at: at(20), opId: 'r' });
    expect(dup(s, pause)).toBe(false);
  });
});
