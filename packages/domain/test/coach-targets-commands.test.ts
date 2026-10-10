import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { buildActiveSetView, explainTarget, reduceSession } from '../src/index';
import { at, id, kg, lb, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * `adjust_pending_targets` / `revert_target_adjustment` (ADR 0019 §4, C7):
 * the coach's validated change to today's pending sets, and its Undo.
 */

const ACTION = id(77_001);

function adjust(state: SessionAggregate, over: Partial<Extract<SessionCommand, { type: 'adjust_pending_targets' }>> = {}): Extract<SessionCommand, { type: 'adjust_pending_targets' }> {
  return { type: 'adjust_pending_targets', at: at(100), opId: 'coach:adjust:1', expectedVersion: state.session.version, actionId: ACTION, changes: [], removeSetIds: [], addSets: [], ...over };
}

function revert(over: Partial<Extract<SessionCommand, { type: 'revert_target_adjustment' }>> = {}): SessionCommand {
  return { type: 'revert_target_adjustment', at: at(200), opId: 'undo:1', actionId: ACTION, removedSetIds: [], addedSetIds: [], ...over };
}

function bench(state: SessionAggregate) {
  const [, b1, b2] = setsFor(state, BENCH);
  if (!b1 || !b2) throw new Error('fixture');
  return { b1, b2 };
}

describe('adjust_pending_targets', () => {
  it('changes pending targets with source coach, keeps what it replaced, and the set card says Coach target / Plan was', () => {
    let s = startFixture().state;
    const { b1, b2 } = bench(s);
    s = apply(s, logCmd(setsFor(s, BENCH)[0]?.id ?? '', values(kg(60), 10), 10));
    s = apply(s, logCmd(b1.id, values(kg(100), 6), 200));
    const r = expectOk(reduceSession(s, adjust(s, { changes: [{ setId: b2.id, target: { load: kg(95), reps: { min: 8, max: 8 } } }] })));
    const after = r.state.sets.find((x) => x.id === b2.id);
    expect(after?.planned).toMatchObject({ load: kg(95), reps: { min: 8, max: 8 }, source: 'coach', coach: { actionId: ACTION, before: { load: kg(100) } } });
    expect(r.state.session.version).toBe(s.session.version + 1);
    expect(r.events.at(-1)).toEqual({ type: 'TargetsAdjusted', actionId: ACTION, setIds: [b2.id], reverted: false });
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
    // Rest and the done set are untouched.
    expect(r.state.sets.find((x) => x.id === b1.id)).toEqual(s.sets.find((x) => x.id === b1.id));
    expect(r.state.restTimer).toEqual(s.restTimer);
    const view = buildActiveSetView({ aggregate: { ...r.state, session: { ...r.state.session, activeSetId: b2.id } }, nowMs: 400_000, gymName: null, previous: {}, painFlagged: new Set(), edits: null, title: null });
    expect(view.focus?.target?.replace(/\u00a0/g, ' ')).toBe('Coach target 95 kg · 8 reps');
    expect(view.focus?.planWas?.replace(/\u00a0/g, ' ')).toBe('Plan was 100 kg × 6–8');
    expect(view.focus?.coachActionId).toBe(ACTION);
  });

  it('rule 5: a stale version changes nothing; rule 2: a done set is refused; units are never converted', () => {
    let s = startFixture().state;
    const { b1, b2 } = bench(s);
    expectError(reduceSession(s, adjust(s, { expectedVersion: s.session.version - 1, changes: [{ setId: b2.id, target: { load: kg(95), reps: null } }] })), 'stale_version');
    s = apply(s, logCmd(b1.id, values(kg(100), 6), 200));
    expectError(reduceSession(s, adjust(s, { changes: [{ setId: b1.id, target: { load: kg(95), reps: null } }] })), 'set_not_pending');
    expectError(reduceSession(s, adjust(s, { changes: [{ setId: b2.id, target: { load: lb(210), reps: null } }] })), 'unit_mismatch');
    expectError(reduceSession(s, adjust(s, { changes: [{ setId: b2.id, target: { load: kg(95, 'per_hand'), reps: null } }] })), 'convention_mismatch');
  });

  it('a duplicate op ID changes nothing; adds and removes a pending set', () => {
    const s = startFixture().state;
    const [r1, r2] = setsFor(s, ROW);
    if (!r1 || !r2) throw new Error('fixture');
    const cmd = adjust(s, { removeSetIds: [r2.id], addSets: [{ newSetId: id(88_001), copyFromSetId: r1.id, target: { load: kg(45, 'stack'), reps: { min: 12, max: 12 } } }] });
    const once = expectOk(reduceSession(s, cmd)).state;
    const twice = expectOk(reduceSession(once, cmd));
    expect(twice.duplicate).toBe(true);
    expect(twice.state).toBe(once);
    expect(once.sets.find((x) => x.id === r2.id)?.status).toBe('deleted');
    const added = once.sets.find((x) => x.id === id(88_001));
    expect(added).toMatchObject({ status: 'pending', setType: r1.setType, rest: r1.rest, planned: { source: 'coach', load: kg(45, 'stack') } });
    expect(SessionAggregateSchema.safeParse(once).success).toBe(true);
  });
});

describe('revert_target_adjustment (Undo)', () => {
  it('puts back exactly the replaced target on still-pending sets; a set logged since stays as logged', () => {
    let s = startFixture().state;
    const { b1, b2 } = bench(s);
    const [r1, r2] = setsFor(s, ROW);
    if (!r1 || !r2) throw new Error('fixture');
    const original = s.sets.find((x) => x.id === b2.id)?.planned;
    s = apply(s, adjust(s, { changes: [{ setId: b1.id, target: { load: kg(95), reps: null } }, { setId: b2.id, target: { load: kg(95), reps: null } }], removeSetIds: [r2.id], addSets: [{ newSetId: id(88_002), copyFromSetId: r1.id, target: { load: kg(45, 'stack'), reps: null } }] }));
    s = apply(s, logCmd(b1.id, values(kg(95), 8), 300));
    const r = expectOk(reduceSession(s, revert({ removedSetIds: [r2.id], addedSetIds: [id(88_002)] })));
    expect(r.state.sets.find((x) => x.id === b2.id)?.planned).toEqual(original);
    expect(r.state.sets.find((x) => x.id === b1.id)).toMatchObject({ status: 'completed', actual: { load: kg(95) } });
    expect(r.state.sets.find((x) => x.id === r2.id)?.status).toBe('pending');
    expect(r.state.sets.find((x) => x.id === id(88_002))?.status).toBe('deleted');
    expect(r.events.at(-1)).toMatchObject({ type: 'TargetsAdjusted', reverted: true });
    // Undo twice: nothing more happens.
    const again = expectOk(reduceSession(r.state, revert({ opId: 'undo:2' })));
    expect(again.state).toBe(r.state);
  });

  it('a later adjustment on the same set means the older one can’t be reverted there (rule 5: never applied to newer state)', () => {
    let s = startFixture().state;
    const { b2 } = bench(s);
    s = apply(s, adjust(s, { changes: [{ setId: b2.id, target: { load: kg(95), reps: null } }] }));
    s = apply(s, adjust(s, { opId: 'coach:adjust:2', actionId: id(77_002), changes: [{ setId: b2.id, target: { load: kg(92.5), reps: null } }] }));
    const r = expectOk(reduceSession(s, revert()));
    expect(r.state).toBe(s);
    // Reverting the newer one goes back to the older coach target, with its own provenance.
    const back = expectOk(reduceSession(s, revert({ opId: 'undo:3', actionId: id(77_002) }))).state;
    expect(back.sets.find((x) => x.id === b2.id)?.planned).toMatchObject({ load: kg(95), source: 'coach', coach: { actionId: ACTION } });
  });
});

describe('Why? on a coach target (active-workout §2.12, ADR 0019 §4)', () => {
  it('today’s change: set by the coach, its reason in quotes, Last time kept; Undo puts back the old target and its Why? exactly', () => {
    const s = startFixture().state;
    const { b2 } = bench(s);
    const r = expectOk(reduceSession(s, adjust(s, { reason: 'Set 1 was RPE 10.', changes: [{ setId: b2.id, target: { load: kg(95), reps: null } }] })));
    const planned = r.state.sets.find((x) => x.id === b2.id)?.planned;
    expect(planned?.provenance).toMatchObject({ source: 'coach', coach: { actionId: ACTION, scope: 'today', reason: 'Set 1 was RPE 10.' }, basis: s.sets.find((x) => x.id === b2.id)?.planned.provenance?.basis ?? null });
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
    const why = explainTarget({ aggregate: r.state, setId: b2.id, nowMs: 400_000, basisNow: null, gymNames: {}, painFlags: [], history: [] });
    expect(why?.rows.find((x) => x.key === 'set_by')?.lines[0]).toMatch(/^Coach · /);
    expect(why?.rows.find((x) => x.key === 'reason')?.lines).toEqual(['“Set 1 was RPE 10.”']);
    const back = expectOk(reduceSession(r.state, revert()));
    expect(back.state.sets.find((x) => x.id === b2.id)?.planned).toEqual(s.sets.find((x) => x.id === b2.id)?.planned);
  });

  it('no reason given: no Reason row, never a made-up one', () => {
    const s = startFixture().state;
    const { b2 } = bench(s);
    const r = expectOk(reduceSession(s, adjust(s, { changes: [{ setId: b2.id, target: { load: kg(95), reps: null } }] })));
    const why = explainTarget({ aggregate: r.state, setId: b2.id, nowMs: 400_000, basisNow: null, gymNames: {}, painFlags: [], history: [] });
    expect(why?.rows.some((x) => x.key === 'reason')).toBe(false);
    expect(why?.recorded).toBe(true);
  });
});
