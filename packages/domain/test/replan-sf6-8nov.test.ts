import { describe, expect, it } from 'vitest';
import type { PlannedSet, SessionAggregate } from '@fizz/schemas';

import { reduceSession, replanCandidates, replanCommand, replanEntries } from '../src/index';
import { at, kg } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * SF6 (Ben, 8 Nov): after a reorder, only the built-in rule's own targets of exercises not started are worked out
 * again; Ben's typed values, coach targets, drafts and started rows never change. The command is versioned and
 * idempotent (rule 5).
 */

const rule = (load: number, reps: number): PlannedSet => ({ load: kg(load, 'stack'), reps: { min: reps, max: reps }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' });

/** The fixture with the cable row's sets marked as the built-in rule's targets. */
function withRuleRow(): SessionAggregate {
  const { state } = startFixture();
  const row = state.exercises.find((e) => e.exerciseId === ROW);
  return { ...state, sets: state.sets.map((s) => (s.sessionExerciseId === row?.id ? { ...s, planned: rule(50, 10) } : s)) };
}

describe('replanCandidates / replanEntries', () => {
  it('only rows not started whose targets are all the rule’s; its context counts what is planned before it', () => {
    const state = withRuleRow();
    const c = replanCandidates(state);
    expect(c.map((x) => x.row.exerciseId)).toEqual([ROW]);
    // Bench (2 working sets) is before it.
    expect(c[0]?.today?.earlier).toEqual([{ exerciseId: BENCH, sets: 2 }]);
    expect(c[0]?.workingSets).toBe(2);
  });

  it('a set Ben typed, a draft, or a started row leaves the row out', () => {
    const state = withRuleRow();
    const [r1] = setsFor(state, ROW);
    if (!r1) throw new Error('set');
    const typed = apply(state, { type: 'edit_planned_set', at: at(1), opId: 'e1', setId: r1.id, expectedSetVersion: r1.version, patch: { load: kg(45, 'stack') } });
    expect(replanCandidates(typed)).toEqual([]);
    const logged = apply(state, logCmd(r1.id, { load: kg(50, 'stack'), reps: 10, durationS: null, rpe: 8, rir: null }, 10));
    expect(replanCandidates(logged)).toEqual([]);
  });

  it('pairs sets in order; a plan of another shape changes nothing; equal values are left alone', () => {
    const state = withRuleRow();
    const [c] = replanCandidates(state);
    if (!c) throw new Error('candidate');
    expect(replanEntries(c, [{ setType: 'working', planned: rule(50, 10) }])).toEqual([]);
    expect(replanEntries(c, [{ setType: 'working', planned: rule(50, 10) }, { setType: 'working', planned: rule(50, 10) }])).toEqual([]);
    const e = replanEntries(c, [{ setType: 'working', planned: rule(50, 9) }, { setType: 'working', planned: rule(50, 9) }]);
    expect(e.map((x) => x.planned.reps)).toEqual([{ min: 9, max: 9 }, { min: 9, max: 9 }]);
  });
});

describe('replan_built_in_targets', () => {
  it('replaces the rule’s targets, keeps Ben’s target RPE, is idempotent and refuses stale versions', () => {
    let state = withRuleRow();
    const [r1, r2] = setsFor(state, ROW);
    if (!r1 || !r2) throw new Error('sets');
    state = apply(state, { type: 'set_target_rpe', at: at(1), opId: 'rpe-1', expectedVersion: state.session.version, scope: { kind: 'set', setId: r1.id }, rpe: 7 });
    const [c] = replanCandidates(state);
    if (!c) throw new Error('candidate');
    const cmd = replanCommand(state, replanEntries(c, [{ setType: 'working', planned: rule(45, 10) }, { setType: 'working', planned: rule(45, 10) }]), { opId: 'replan-1', at: at(2) });
    if (cmd === null) throw new Error('nothing');
    const r = expectOk(reduceSession(state, cmd));
    const after = setsFor(r.state, ROW);
    expect(after.map((s) => s.planned.load?.value)).toEqual([45, 45]);
    expect(after[0]?.planned.rpeOverride).toBe(7);
    // The same operation again: nothing more.
    const again = expectOk(reduceSession(r.state, cmd));
    expect(again.duplicate).toBe(true);
    expect(again.state.session.version).toBe(r.state.session.version);
    // An older session version: refused, never applied to newer state.
    expectError(reduceSession(r.state, { ...cmd, opId: 'replan-2' }), 'stale_version');
  });

  it('never replaces a target Ben typed or a coach target', () => {
    const state = withRuleRow();
    const [r1] = setsFor(state, ROW);
    if (!r1) throw new Error('set');
    const typed = apply(state, { type: 'edit_planned_set', at: at(1), opId: 'e1', setId: r1.id, expectedSetVersion: r1.version, patch: { load: kg(45, 'stack') } });
    const set = setsFor(typed, ROW)[0];
    if (!set) throw new Error('set');
    expectError(reduceSession(typed, { type: 'replan_built_in_targets', at: at(2), opId: 'x', expectedVersion: typed.session.version, sets: [{ setId: set.id, expectedSetVersion: set.version, planned: rule(40, 10) }] }), 'invalid_values');
    const coachState = { ...state, sets: state.sets.map((s) => (s.id === r1.id ? { ...s, planned: { ...s.planned, source: 'coach' as const } } : s)) };
    expectError(reduceSession(coachState, { type: 'replan_built_in_targets', at: at(2), opId: 'y', expectedVersion: coachState.session.version, sets: [{ setId: r1.id, expectedSetVersion: r1.version, planned: rule(40, 10) }] }), 'invalid_values');
  });
});
