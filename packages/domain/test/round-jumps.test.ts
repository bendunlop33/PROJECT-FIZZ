import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { currentRoundIndex, jumpRoundCommand, reduceSession, roundJumps, sessionRounds } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 31 Oct) `Do next` and `Move to end` on an exercise's `⋯`: today's remaining rounds only, a
 * superset as one block, done sets never touched (rule 2), versioned and idempotent with Undo (rule 5),
 * and Undo still works after a relaunch (restart recovery).
 */

const reload = (s: SessionAggregate): SessionAggregate => SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const op = (opId: string, seconds = 400) => ({ opId, at: at(seconds) });
const order = (s: SessionAggregate): string[] => sessionRounds(s).map((r) => r.members.map((m) => m.exerciseName).join('+'));

/** Bench warm-up and set 1 logged; set 2 is next (Bench is current and started). */
function benchStarted(): SessionAggregate {
  let s = startFixture().state;
  const [w, b1] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 6), 300));
  return s;
}

function jump(s: SessionAggregate, exerciseId: string, j: 'do_next' | 'to_end', opId: string): SessionCommand {
  const r = jumpRoundCommand(s, rowId(s, exerciseId), j, op(opId));
  if (!r.ok) throw new Error(r.reason);
  return r.command;
}

describe('Do next / Move to end (Ben, 31 Oct)', () => {
  it('the current round is the one with the open set, else the first with a set to do', () => {
    const s0 = startFixture().state;
    expect(currentRoundIndex(s0)).toBe(0);
    const hang = setsFor(s0, HANG)[0]?.id ?? '';
    const s1 = apply(s0, { type: 'set_active_set', at: at(10), opId: 'jump-h', setId: hang, expectedVersion: s0.session.version });
    expect(currentRoundIndex(s1)).toBe(2);
  });

  it('Do next puts the round straight after the current one; done sets keep their values and versions', () => {
    const s0 = benchStarted();
    const s1 = apply(s0, jump(s0, HANG, 'do_next', 'dn-1'));
    expect(order(s1)).toEqual(['Bench press', 'Dead hang', 'Cable row+Face pull']);
    expect(s1.sets).toEqual(s0.sets);
    expect(s1.session.activeSetId).toBe(s0.session.activeSetId);
    expect(s1.session.version).toBe(s0.session.version + 1);
  });

  it('a superset moves as one block: Move to end and Do next carry both members', () => {
    const s0 = benchStarted();
    const s1 = apply(s0, jump(s0, ROW, 'to_end', 'end-1'));
    expect(order(s1)).toEqual(['Bench press', 'Dead hang', 'Cable row+Face pull']);
    // Back with Do next, from either member.
    const s2 = apply(s1, jump(s1, FACE, 'do_next', 'dn-2'));
    expect(order(s2)).toEqual(['Bench press', 'Cable row+Face pull', 'Dead hang']);
    expect(s2.sets).toEqual(s0.sets);
  });

  it('only offered when it moves something: not on the current round, not where it already is', () => {
    const s0 = benchStarted();
    expect(roundJumps(s0, rowId(s0, BENCH))).toEqual({ doNext: false, toEnd: false });
    expect(jumpRoundCommand(s0, rowId(s0, BENCH), 'to_end', op('x'))).toEqual({ ok: false, reason: 'current' });
    // The superset is already next; Dead hang is already last.
    expect(roundJumps(s0, rowId(s0, ROW))).toEqual({ doNext: false, toEnd: true });
    expect(roundJumps(s0, rowId(s0, HANG))).toEqual({ doNext: true, toEnd: false });
  });

  it('a done or started round stays where it is, and nothing passes one', () => {
    let s = benchStarted();
    for (const x of setsFor(s, HANG)) s = apply(s, logCmd(x.id, values(null, null, { durationS: 45 }), 500));
    // Dead hang done (out of order): hidden for it, and the superset can’t go past it to the end.
    expect(roundJumps(s, rowId(s, HANG))).toEqual({ doNext: false, toEnd: false });
    expect(jumpRoundCommand(s, rowId(s, HANG), 'do_next', op('x'))).toEqual({ ok: false, reason: 'started' });
    expect(jumpRoundCommand(s, rowId(s, ROW), 'to_end', op('x'))).toEqual({ ok: false, reason: 'crosses_started' });
    // Every round done: nothing to offer.
    let done = startFixture().state;
    for (const x of done.sets) done = apply(done, logCmd(x.id, values(x.planned.load, 8, x.planned.durationS ? { durationS: 45 } : {}), 600));
    expect(currentRoundIndex(done)).toBe(-1);
    for (const id of [BENCH, ROW, HANG]) expect(roundJumps(done, rowId(done, id))).toEqual({ doNext: false, toEnd: false });
  });

  it('a round behind the current one (Ben jumped ahead) lands straight after it', () => {
    const s0 = startFixture().state;
    const hang = setsFor(s0, HANG)[0]?.id ?? '';
    const s1 = apply(s0, { type: 'set_active_set', at: at(10), opId: 'jump-h', setId: hang, expectedVersion: s0.session.version });
    const s2 = apply(s1, jump(s1, BENCH, 'do_next', 'dn-b'));
    expect(order(s2)).toEqual(['Cable row+Face pull', 'Dead hang', 'Bench press']);
  });

  it('idempotent on its opId, refused on a stale version, and Undo puts the order back after a relaunch', () => {
    const s0 = benchStarted();
    const cmd = jump(s0, HANG, 'do_next', 'dn-3');
    const r1 = expectOk(reduceSession(s0, cmd));
    const again = expectOk(reduceSession(r1.state, cmd));
    expect(again.duplicate).toBe(true);
    expect(again.state).toEqual(r1.state);
    // Worked out on the old version, after another change: refused, never applied to the newer state.
    const other = apply(s0, logCmd(setsFor(s0, BENCH)[2]?.id ?? '', values(kg(100), 6), 420));
    expectError(reduceSession(other, { ...cmd, opId: 'dn-4' }), 'stale_version');
    const back = apply(reload(r1.state), { type: 'undo_op', at: at(900), opId: 'undo-dn-3', targetOpId: 'dn-3' });
    expect(order(back)).toEqual(order(s0));
    expect(back.sets).toEqual(s0.sets);
  });
});
