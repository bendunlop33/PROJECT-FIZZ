import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { buildActiveSetView, buildSetEditView, classifyNextSessionChange, evaluateCoachTrigger, isIncrease, nextSessionBases, reduceSession, sameTarget, targetRpeOf, validateNextSessionTargets } from '../src/index';
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

// ---------------------------------------------------------------------------
// Review target-rpe B1: next-session targets compare with the target the coach saw

describe('next-session target RPE against the resolved target (review target-rpe B1)', () => {
  const ctx = { benAskedForMoreSets: false };
  /** Bench logged 100 kg × 6 twice; `plan` edits the working sets' plan first. */
  function finished(plan: (p: SessionAggregate['sets'][number]['planned']) => SessionAggregate['sets'][number]['planned'] = (p) => p) {
    let s = startFixture().state;
    s = { ...s, sets: s.sets.map((x) => (x.setType === 'working' ? { ...x, planned: plan(x.planned) } : x)) };
    const { w, b1, b2 } = bench(s);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    s = apply(s, logCmd(b1.id, values(kg(100), 6), 200));
    s = apply(s, logCmd(b2.id, values(kg(100), 6), 400));
    return { s, benchRow: b1.sessionExerciseId };
  }

  it('built-in plan (no stored RPE): last.rpe is the rule’s 8.5; a one-step load change at RPE 8.5 is small, and isn’t stored as a new RPE', () => {
    const { s, benchRow } = finished();
    expect(bench(s).b1.planned.rpe).toBeNull();
    const bases = nextSessionBases(s, new Map(), { [benchRow]: 8.5 });
    const b = bases.find((x) => x.exercise.id === benchRow);
    expect(b?.last.rpe).toBe(8.5);
    expect(b?.lastRpeSource).toBe('rule');
    if (b === undefined) throw new Error('fixture');
    expect(classifyNextSessionChange(b.last, b.lastSets, { ...b.last, load: kg(102.5) }, b.lastSets, b.equipment, ctx).size).toBe('small');
    const v = validateNextSessionTargets({ source: s, bases, targets: [{ exerciseId: BENCH, target: { load: kg(102.5), reps: { min: 6, max: 8 }, rpe: 8.5 }, sets: null, reason: 'Moved well.' }], painFlags: [], gymName: null, ctx });
    expect(v.rows[0]).toMatchObject({ size: 'small', reasons: [], after: { load: kg(102.5), reps: { min: 6, max: 8 } } });
    expect(v.rows[0]?.after.rpe).toBeUndefined();
    // A different target RPE is still bigger (CA8).
    const nine = validateNextSessionTargets({ source: s, bases, targets: [{ exerciseId: BENCH, target: { load: kg(102.5), reps: { min: 6, max: 8 }, rpe: 9.5 }, sets: null, reason: 'Push.' }], painFlags: [], gymName: null, ctx });
    expect(nine.rows[0]).toMatchObject({ size: 'bigger', reasons: ['The effort target changes.'] });
  });

  it('routine RIR 2: last.rpe is 8; the coach’s rpe 8 with one step more load is small', () => {
    const { s, benchRow } = finished((p) => ({ ...p, rir: 2 }));
    const bases = nextSessionBases(s, new Map(), { [benchRow]: 8.5 });
    const b = bases.find((x) => x.exercise.id === benchRow);
    expect(b).toMatchObject({ last: { rpe: 8 }, lastRpeSource: 'plan' });
    const v = validateNextSessionTargets({ source: s, bases, targets: [{ exerciseId: BENCH, target: { load: kg(102.5), reps: { min: 6, max: 8 }, rpe: 8 }, sets: null, reason: 'Moved well.' }], painFlags: [], gymName: null, ctx });
    expect(v.rows[0]).toMatchObject({ size: 'small', reasons: [] });
  });

  it('a pain flag blocks a next-session RPE raise above the built-in target (rule 9)', () => {
    const { s, benchRow } = finished();
    const bases = nextSessionBases(s, new Map(), { [benchRow]: 8.5 });
    const flag = { id: id(7777), ownerId: 'o', version: 1, createdAtUtc: at(0).utc, updatedAtUtc: at(0).utc, exerciseId: BENCH, exerciseName: 'Bench press', area: null, source: 'workout', checkInId: null, reportedAt: at(0), status: 'active', clearedAtUtc: null, createdByOpId: 'p' } as const;
    const v = validateNextSessionTargets({ source: s, bases, targets: [{ exerciseId: BENCH, target: { load: kg(100), reps: { min: 6, max: 8 }, rpe: 10 }, sets: null, reason: 'Push.' }], painFlags: [flag], gymName: null, ctx });
    expect(v.rows).toEqual([]);
    expect(v.dropped[0]?.kind).toBe('pain_blocked');
  });
});

// ---------------------------------------------------------------------------
// Review target-rpe B2: Ben's target RPE on a logged set, from Edit set (`correct_set`)

describe('Edit set → Target RPE on a logged set (CHANGELOG 2026-10-11 (b); review target-rpe B2)', () => {
  type Correct = Extract<SessionCommand, { type: 'correct_set' }>;
  const correct = (setId: string, setVersion: number, targetRpe: number | null, opId = 'fix:1', at$ = 600): Correct => ({ type: 'correct_set', at: at(at$), opId, setId, expectedSetVersion: setVersion, patch: { targetRpe } });
  function loggedAt10() {
    let s = startFixture().state;
    const { w, b1 } = bench(s);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    s = apply(s, logCmd(b1.id, values(kg(100), 6, { rpe: 10 }), 200));
    const set = s.sets.find((x) => x.id === b1.id);
    if (set === undefined) throw new Error('fixture');
    return { s, set };
  }

  it('Ben marks a just-logged RPE 10 set as planned at 10: the offer clears; actual values and Edited stay; audited', () => {
    const { s, set } = loggedAt10();
    expect(evaluateCoachTrigger(set, 1, undefined, targetRpeOf(set, 8.5)?.rpe ?? null)?.kind).toBe('rpe_high');
    const r = expectOk(reduceSession(s, correct(set.id, set.version, 10)));
    const after = r.state.sets.find((x) => x.id === set.id);
    if (after === undefined) throw new Error('fixture');
    expect(after.planned.rpeOverride).toBe(10);
    expect(after.actual).toEqual(set.actual);
    expect(after.edited).toBe(false);
    expect(after.version).toBe(set.version + 1);
    expect(r.state.session.version).toBe(s.session.version + 1);
    // F4: the offer check on the corrected set finds nothing.
    expect(evaluateCoachTrigger(after, 1, undefined, targetRpeOf(after, 8.5)?.rpe ?? null)).toBeNull();
    const entry = r.state.audit.at(-1);
    expect(entry).toMatchObject({ kind: 'corrected', setId: set.id, opId: 'fix:1' });
    expect(entry?.before?.targetRpe).toBeUndefined();
    expect(entry?.after?.targetRpe).toBe(10);
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
  });

  it('rule 5: a stale set version is refused; a replay applies once; null clears it back to the rule’s', () => {
    const { s, set } = loggedAt10();
    expectError(reduceSession(s, correct(set.id, set.version - 1 || 99, 10)), 'stale_version');
    const once = expectOk(reduceSession(s, correct(set.id, set.version, 10)));
    const dup = reduceSession(once.state, correct(set.id, set.version, 10));
    expect(dup).toMatchObject({ ok: true, duplicate: true });
    expect(dup.state).toBe(once.state);
    const v2 = once.state.sets.find((x) => x.id === set.id)?.version ?? 0;
    const cleared = expectOk(reduceSession(once.state, correct(set.id, v2, null, 'fix:2', 700)));
    const c = cleared.state.sets.find((x) => x.id === set.id);
    expect(c && 'rpeOverride' in c.planned).toBe(false);
    expect(c && targetRpeOf(c, 8.5)).toEqual({ rpe: 8.5, source: 'rule' });
  });

  it('a warm-up has no target effort', () => {
    const { s } = loggedAt10();
    const w = bench(s).w;
    const logged = s.sets.find((x) => x.id === w.id);
    expectError(reduceSession(s, correct(w.id, logged?.version ?? 1, 9)), 'invalid_values');
  });

  it('the sheet shows the target in force and Ben’s value as edited; only in an active workout', () => {
    const { s, set } = loggedAt10();
    const plain = buildSetEditView(s, set.id, null, null, { ruleTargetRpe: { [set.sessionExerciseId]: 8.5 } });
    expect(plain?.targetRpe).toEqual({ target: { rpe: 8.5, source: 'rule' }, override: null, changed: false });
    expect(plain?.changed).toBe(false);
    const edited = buildSetEditView(s, set.id, null, null, { targetRpe: 10, ruleTargetRpe: { [set.sessionExerciseId]: 8.5 } });
    expect(edited?.targetRpe).toEqual({ target: { rpe: 10, source: 'ben' }, override: 10, changed: true });
    expect(edited?.changed).toBe(true);
    const done = { ...s, session: { ...s.session, status: 'finished' as const } };
    expect(buildSetEditView(done, set.id, null)?.targetRpe).toBeNull();
    expect(buildSetEditView(s, bench(s).w.id, null)?.targetRpe).toBeNull();
  });
});
