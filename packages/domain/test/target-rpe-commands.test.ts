import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { buildActiveSetView, classifyNextSessionChange, evaluateCoachTrigger, isIncrease, reduceSession, sameTarget, targetRpeOf } from '../src/index';
import { at, barbell, id, kg, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * Ben's own target RPE (`set_target_rpe`) and the coach's recommended one
 * (CHANGELOG 2026-10-11 "Offers follow the target RPE" (b)).
 */

type SetTargetRpe = Extract<SessionCommand, { type: 'set_target_rpe' }>;

function setRpe(state: SessionAggregate, over: Partial<SetTargetRpe>): SetTargetRpe {
  return { type: 'set_target_rpe', at: at(150), opId: 'rpe:1', expectedVersion: state.session.version, scope: { kind: 'today' }, rpe: 8, ...over };
}

function bench(state: SessionAggregate) {
  const [w, b1, b2] = setsFor(state, BENCH);
  if (!w || !b1 || !b2) throw new Error('fixture');
  return { w, b1, b2 };
}

const overrideOf = (s: SessionAggregate, setId: string): number | undefined => s.sets.find((x) => x.id === setId)?.planned.rpeOverride;

describe('set_target_rpe (Ben’s override; Your data, versioned)', () => {
  it('for one set: only that pending working set changes, the version bumps', () => {
    const s = startFixture().state;
    const { b1, b2 } = bench(s);
    const r = expectOk(reduceSession(s, setRpe(s, { scope: { kind: 'set', setId: b2.id }, rpe: 10 })));
    expect(overrideOf(r.state, b2.id)).toBe(10);
    expect(overrideOf(r.state, b1.id)).toBeUndefined();
    expect(r.state.session.version).toBe(s.session.version + 1);
    expect(r.state.sets.find((x) => x.id === b2.id)?.version).toBe(b2.version + 1);
    expect(r.events).toContainEqual({ type: 'TargetRpeSet', setIds: [b2.id], rpe: 10 });
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
  });

  it('for the exercise: its pending working sets, never the warm-up or a logged set (rule 2)', () => {
    let s = startFixture().state;
    const { w, b1, b2 } = bench(s);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    s = apply(s, logCmd(b1.id, values(kg(100), 6), 200));
    const r = expectOk(reduceSession(s, setRpe(s, { scope: { kind: 'exercise', sessionExerciseId: b1.sessionExerciseId }, rpe: 7.5 })));
    expect(overrideOf(r.state, b2.id)).toBe(7.5);
    expect(r.state.sets.find((x) => x.id === b1.id)).toEqual(s.sets.find((x) => x.id === b1.id));
    expect(r.state.sets.find((x) => x.id === w.id)).toEqual(s.sets.find((x) => x.id === w.id));
    for (const row of setsFor(r.state, ROW)) expect(row.planned.rpeOverride).toBeUndefined();
  });

  it('for today: every pending working set; null clears it back to the coach’s or the rule’s', () => {
    const s = startFixture().state;
    const r = expectOk(reduceSession(s, setRpe(s, { rpe: 9 })));
    const working = r.state.sets.filter((x) => x.setType !== 'warmup' && x.setType !== 'drop');
    expect(working.length).toBeGreaterThan(2);
    for (const x of working) expect(x.planned.rpeOverride).toBe(9);
    const cleared = expectOk(reduceSession(r.state, setRpe(r.state, { opId: 'rpe:2', rpe: null })));
    for (const x of cleared.state.sets) expect('rpeOverride' in x.planned).toBe(false);
    // Clearing what isn't set changes nothing (no version bump).
    const again = expectOk(reduceSession(cleared.state, setRpe(cleared.state, { opId: 'rpe:3', rpe: null })));
    expect(again.state.session.version).toBe(cleared.state.session.version);
  });

  it('rule 5: a stale version is refused; a duplicate op ID applies once; a reused ID for another intent is refused', () => {
    const s = startFixture().state;
    const { b1, w } = bench(s);
    expectError(reduceSession(s, setRpe(s, { expectedVersion: s.session.version - 1 })), 'stale_version');
    const once = expectOk(reduceSession(s, setRpe(s, { scope: { kind: 'set', setId: b1.id } })));
    const dup = reduceSession(once.state, setRpe(s, { scope: { kind: 'set', setId: b1.id } }));
    expect(dup).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expect(dup.state).toBe(once.state);
    expectError(reduceSession(once.state, setRpe(once.state, { scope: { kind: 'set', setId: b1.id }, rpe: 6 })), 'operation_id_reused');
    // A later override replaces it: the replayed op reads as superseded.
    const later = expectOk(reduceSession(once.state, setRpe(once.state, { opId: 'rpe:9', scope: { kind: 'set', setId: b1.id }, rpe: 6 })));
    expect(reduceSession(later.state, setRpe(s, { scope: { kind: 'set', setId: b1.id } }))).toMatchObject({ duplicate: true, superseded: true });
    expectError(reduceSession(s, setRpe(s, { opId: 'rpe:w', scope: { kind: 'set', setId: w.id } })), 'invalid_values');
  });

  it('refuses a logged set (its plan is what the offer judged)', () => {
    let s = startFixture().state;
    const { b1 } = bench(s);
    s = apply(s, logCmd(b1.id, values(kg(100), 6), 200));
    expectError(reduceSession(s, setRpe(s, { scope: { kind: 'set', setId: b1.id } })), 'set_not_pending');
  });

  it('survives a coach change and its Undo; the trigger and the target line read it', () => {
    let s = startFixture().state;
    const { b1, b2 } = bench(s);
    s = apply(s, setRpe(s, { scope: { kind: 'set', setId: b2.id }, rpe: 10 }));
    const adjust: SessionCommand = { type: 'adjust_pending_targets', at: at(300), opId: 'coach:1', expectedVersion: s.session.version, actionId: id(88_001), changes: [{ setId: b2.id, target: { load: kg(95), reps: { min: 6, max: 6 }, rpe: 8 } }], removeSetIds: [], addSets: [] };
    s = apply(s, adjust);
    const afterCoach = s.sets.find((x) => x.id === b2.id);
    expect(afterCoach?.planned).toMatchObject({ rpe: 8, rpeOverride: 10 });
    expect(afterCoach && targetRpeOf(afterCoach, 8.5)).toEqual({ rpe: 10, source: 'ben' });
    s = apply(s, setRpe(s, { opId: 'rpe:2', scope: { kind: 'set', setId: b2.id }, rpe: 9 }));
    s = apply(s, { type: 'revert_target_adjustment', at: at(400), opId: 'undo:1', actionId: id(88_001), removedSetIds: [], addedSetIds: [] });
    const undone = s.sets.find((x) => x.id === b2.id);
    expect(undone?.planned.load).toEqual(b2.planned.load);
    expect(undone?.planned.rpe).toBe(b2.planned.rpe);
    expect(undone?.planned.rpeOverride).toBe(9);
    // Logged at RPE 10 on Ben's RPE-10 plan: no offer (Ben's case).
    s = apply(s, logCmd(b1.id, values(kg(100), 6), 500));
    const logged = apply(s, logCmd(b2.id, values(kg(100), 6, { rpe: 10 }), 700));
    const set = logged.sets.find((x) => x.id === b2.id);
    if (set === undefined) throw new Error('fixture');
    expect(evaluateCoachTrigger(set, 2, undefined, targetRpeOf(set, 8.5)?.rpe ?? null)?.kind ?? null).toBeNull();
    const view = buildActiveSetView({ aggregate: { ...s, session: { ...s.session, activeSetId: b2.id } }, nowMs: 800_000, gymName: null, previous: {}, painFlagged: new Set(), edits: null, title: null, ruleTargetRpe: { [b2.sessionExerciseId]: 8.5 } });
    expect(view.focus?.target?.replace(/\u00a0/g, ' ')).toMatch(/@ RPE 9$/);
  });
});

describe('the coach’s target RPE', () => {
  it('a raise counts as an increase (pain, lighter session); a lower one doesn’t', () => {
    const before = { load: kg(100), reps: { min: 5, max: 5 }, rpe: 8 };
    expect(isIncrease(before, { ...before, rpe: 9 }, 'total')).toBe(true);
    expect(isIncrease(before, { ...before, rpe: 7 }, 'total')).toBe(false);
    expect(isIncrease({ load: kg(100), reps: null }, { load: kg(100), reps: null, rpe: 9 }, 'total')).toBe(false);
    expect(sameTarget(before, { load: kg(100), reps: { min: 5, max: 5 } })).toBe(true);
    expect(sameTarget(before, { ...before, rpe: 7 })).toBe(false);
  });

  it('CA8: a next-session target RPE that changes is bigger (a proposal); the same one is small', () => {
    const last = { load: kg(100), reps: { min: 3, max: 6 }, rpe: 8 };
    const bar = barbell();
    expect(classifyNextSessionChange(last, 3, { ...last, load: kg(102.5) }, 3, bar, { benAskedForMoreSets: false }).size).toBe('small');
    expect(classifyNextSessionChange(last, 3, { ...last, rpe: 8 }, 3, bar, { benAskedForMoreSets: false }).size).toBe('small');
    const changed = classifyNextSessionChange(last, 3, { ...last, rpe: 9 }, 3, bar, { benAskedForMoreSets: false });
    expect(changed).toMatchObject({ size: 'bigger', reasons: ['The effort target changes.'] });
  });
});
