import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';
import { buildActiveSetView, coachUndoRefusal, gymChangedSince, reduceSession } from '../src/index';
import { at, id, kg, values } from './fixtures';
import { exerciseSets, HOTEL, HOTEL_EQ, INCLINE, MAIN, MAIN_EQ, propose, pushA, rowOf, switchCmd } from './gym-fixture';
import { expectOk, logCmd } from './session-fixture';

/**
 * Undo of a coach change to today's sets after a gym change (review
 * coach-v1-final-r2 B1, ADR 0020 §4.3). The change's saved `before` targets
 * were fitted to the old gym, so Undo is refused once a gym change since is
 * still in effect; it never puts back a load the new gym can't make (rule 4).
 */

const ACTION = id(78_001);

type Adjust = Extract<SessionCommand, { type: 'adjust_pending_targets' }>;
function adjust(s: SessionAggregate, over: Partial<Adjust>): Adjust {
  return { type: 'adjust_pending_targets', at: at(100), opId: 'coach:adjust', expectedVersion: s.session.version, actionId: ACTION, reason: null, changes: [], removeSetIds: [], addSets: [], ...over };
}
const revert = (over: Partial<Extract<SessionCommand, { type: 'revert_target_adjustment' }>> = {}): SessionCommand => ({
  type: 'revert_target_adjustment',
  at: at(900),
  opId: 'undo:coach',
  actionId: ACTION,
  removedSetIds: [],
  addedSetIds: [],
  ...over,
});
const pendingIncline = (s: SessionAggregate) => exerciseSets(s, INCLINE).filter((x) => x.status === 'pending');
const loadsOf = (s: SessionAggregate) => pendingIncline(s).map((x) => x.planned.load);

function lighterCmd(s: SessionAggregate): Adjust {
  return adjust(s, { changes: pendingIncline(s).map((x) => ({ setId: x.id, target: { load: kg(17.5, 'per_hand'), reps: { min: 8, max: 10 } } })) });
}
function lighterAtMain(): SessionAggregate {
  const s = pushA();
  return expectOk(reduceSession(s, lighterCmd(s))).state;
}

describe('coach Undo after a gym switch (rule 4)', () => {
  it('Main → hotel → Undo: refused with gym_changed; the sets keep a load the hotel rack can make', () => {
    const adjusted = lighterAtMain();
    expect(coachUndoRefusal(adjusted, ACTION)).toBeNull();
    const hotel = expectOk(reduceSession(adjusted, switchCmd(propose(adjusted, { id: HOTEL, equipment: HOTEL_EQ }), 200))).state;
    expect(loadsOf(hotel)).toEqual(Array(3).fill(kg(17.5, 'per_hand')));
    expect(coachUndoRefusal(hotel, ACTION)).toBe('gym_changed');
    const r = reduceSession(hotel, revert());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ code: 'gym_changed', message: 'The gym changed.' });
    expect(loadsOf(r.state)).toEqual(Array(3).fill(kg(17.5, 'per_hand')));
    expect(r.state.session.gymId).toBe(HOTEL);
  });

  it('the Undo action is no longer offered on the set, and a replayed adjustment reports superseded', () => {
    const adjusted = lighterAtMain();
    const hotel = expectOk(reduceSession(adjusted, switchCmd(propose(adjusted, { id: HOTEL, equipment: HOTEL_EQ }), 200))).state;
    const set = pendingIncline(hotel)[0];
    const view = (s: SessionAggregate) => buildActiveSetView({ aggregate: { ...s, session: { ...s.session, activeSetId: set?.id ?? null } }, nowMs: 400_000, gymName: null, previous: {}, painFlagged: new Set(), edits: null, title: null });
    expect(view(adjusted).focus?.coachActionId).toBe(ACTION);
    expect(view(hotel).focus?.coachActionId).toBeNull();
    // The same adjustment again (same opId and content) is a duplicate whose effect is no longer in place.
    const replay = reduceSession(hotel, lighterCmd(pushA()));
    expect(replay).toMatchObject({ ok: true, duplicate: true, superseded: true });
  });

  it('switch undone (back on Main’s equipment): the coach Undo works again and puts back 32.5 kg each', () => {
    const adjusted = lighterAtMain();
    const hotel = expectOk(reduceSession(adjusted, switchCmd(propose(adjusted, { id: HOTEL, equipment: HOTEL_EQ }), 200))).state;
    const change = hotel.session.gymChanges?.at(-1);
    const back = expectOk(reduceSession(hotel, { type: 'undo_change_gym', at: at(300), opId: 'undo-switch', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' })).state;
    expect(back.session.gymId).toBe(MAIN);
    expect(coachUndoRefusal(back, ACTION)).toBeNull();
    const undone = expectOk(reduceSession(back, revert())).state;
    expect(loadsOf(undone)).toEqual(Array(3).fill(kg(32.5, 'per_hand')));
  });

  it('adjust at the hotel, switch to Main, Undo: refused; the targets stay as fitted at Main', () => {
    const s = pushA();
    const hotel = expectOk(reduceSession(s, switchCmd(propose(s, { id: HOTEL, equipment: HOTEL_EQ }), 50))).state;
    expect(loadsOf(hotel)).toEqual(Array(3).fill(kg(20, 'per_hand')));
    const adjusted = expectOk(reduceSession(hotel, adjust(hotel, { changes: pendingIncline(hotel).map((x) => ({ setId: x.id, target: { load: kg(15, 'per_hand'), reps: { min: 8, max: 10 } } })) }))).state;
    // The switch back to Main is a new change (the hotel switch can't be undone once the coach changed the plan).
    const main = expectOk(reduceSession(adjusted, switchCmd(propose(adjusted, { id: MAIN, equipment: MAIN_EQ }), 300))).state;
    expect(main.session.gymId).toBe(MAIN);
    const before = loadsOf(main);
    expect(coachUndoRefusal(main, ACTION)).toBe('gym_changed');
    const r = reduceSession(main, revert());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('gym_changed');
    expect(loadsOf(r.state)).toEqual(before);
    // Never the hotel's capped 20 kg each with its hotel snap.
    expect(pendingIncline(r.state).every((x) => x.planned.source === 'coach')).toBe(true);
  });

  it('a set the coach removed stays removed after a switch that split the row; nothing comes back on the old row', () => {
    let s = pushA();
    const [first, second, third] = exerciseSets(s, INCLINE);
    s = expectOk(reduceSession(s, logCmd(first?.id ?? '', values(kg(32.5, 'per_hand'), 10), 60, 'log-incline-1'))).state;
    s = expectOk(reduceSession(s, adjust(s, { removeSetIds: [third?.id ?? ''], changes: [{ setId: second?.id ?? '', target: { load: kg(30, 'per_hand'), reps: { min: 8, max: 10 } } }] }))).state;
    const hotel = expectOk(reduceSession(s, switchCmd(propose(s, { id: HOTEL, equipment: HOTEL_EQ }), 200))).state;
    // GS6: the done set keeps the Main row; the pending one continues on a hotel row.
    const mainRow = rowOf(hotel, INCLINE, 0);
    const hotelRow = rowOf(hotel, INCLINE, 1);
    expect(hotelRow?.continuesFromId).toBe(mainRow?.id);
    expect(hotel.sets.find((x) => x.id === second?.id)?.sessionExerciseId).toBe(hotelRow?.id);
    const r = reduceSession(hotel, revert({ removedSetIds: [third?.id ?? ''] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('gym_changed');
    const removed = r.state.sets.find((x) => x.id === third?.id);
    expect(removed?.status).toBe('deleted');
    expect(removed?.sessionExerciseId).toBe(mainRow?.id);
    expect(r.state.sets.find((x) => x.id === second?.id)?.planned.load).toEqual(kg(20, 'per_hand'));
  });
});

describe('gymChangedSince', () => {
  const change = (actionId: string) => ({ kind: 'change' as const, actionId, undoOf: undefined });
  const undo = (of: string) => ({ kind: 'undo' as const, actionId: `undo:${of}`, undoOf: of });
  const session = (entries: ReturnType<typeof change | typeof undo>[]) => ({ gymChanges: entries }) as unknown as Pick<SessionAggregate['session'], 'gymChanges'>;

  it('counts only changes still in effect after the point', () => {
    expect(gymChangedSince(session([]), 0)).toBe(false);
    expect(gymChangedSince(session([change('a')]), 1)).toBe(false);
    expect(gymChangedSince(session([change('a')]), 0)).toBe(true);
    expect(gymChangedSince(session([change('a'), undo('a')]), 0)).toBe(false);
    expect(gymChangedSince(session([change('a'), undo('a'), change('b')]), 0)).toBe(true);
    // An undo of a change made before the point is itself a change since.
    expect(gymChangedSince(session([change('a'), undo('a')]), 1)).toBe(true);
  });
});
