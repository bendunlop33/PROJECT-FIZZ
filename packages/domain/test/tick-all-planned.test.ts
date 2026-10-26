import { describe, expect, it } from 'vitest';
import { SessionCommandSchema, type SessionAggregate, type SessionExercise, type WorkoutSet } from '@fizz/schemas';
import { asPastLog, plannedLogValues, PAST_LOG_SET_SPACING_MS, reduceSession, tickAllDoneText, tickAllPlannedSets, TICK_ALL_LABEL, toIso, toMs } from '../src/index';
import { at, kg, lb, ms, TZ, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 26 Oct; log-past-workout Q-PL2) `Tick all as planned` in a past log started from a saved workout or a plan
 * day: every planned set not done yet logged with its planned values, in one versioned, idempotent write, each set
 * still editable; Undo puts them all back. Never in a live workout.
 */

const yesterday = ms(0) - 24 * 3600 * 1000;
const pastLog = (): SessionAggregate => asPastLog(startFixture().state, { utc: toIso(yesterday), tz: TZ }, at(0));
const tick = (s: SessionAggregate, opId = 'tick-1', seconds = 30) => ({ type: 'tick_all_planned' as const, at: at(seconds), opId, expectedVersion: s.session.version });
const ex = (over: Partial<SessionExercise>): SessionExercise => ({ ...(startFixture().state.exercises[0] as SessionExercise), ...over });
const pending = (over: Partial<WorkoutSet['planned']>): WorkoutSet => {
  const s = startFixture().state.sets[1] as WorkoutSet;
  return { ...s, planned: { ...s.planned, ...over } };
};

describe('planned values (pure)', () => {
  it('load as planned (kg, lb, per hand, stack, assistance), the target reps or a range’s low end, no effort', () => {
    expect(plannedLogValues(pending({ load: kg(100), reps: { min: 8, max: 8 } }), ex({}))).toEqual({ load: kg(100), reps: 8, durationS: null, rpe: null, rir: null });
    expect(plannedLogValues(pending({ load: lb(225), reps: { min: 6, max: 8 }, rpe: 8 }), ex({ unit: 'lb' }))).toMatchObject({ load: lb(225), reps: 6, rpe: null });
    expect(plannedLogValues(pending({ load: kg(22.5, 'per_hand'), reps: { min: 10, max: 12 } }), ex({ loadConvention: 'per_hand' }))?.load).toEqual(kg(22.5, 'per_hand'));
    expect(plannedLogValues(pending({ load: kg(25, 'assistance'), reps: { min: 8, max: 8 } }), ex({ loadConvention: 'assistance' }))?.load).toEqual(kg(25, 'assistance'));
  });

  it('bodyweight logs bodyweight; an added row with nothing planned adds nothing; no reps or time planned: not ticked', () => {
    expect(plannedLogValues(pending({ load: null, reps: { min: 12, max: 12 } }), ex({ loadConvention: 'bodyweight' }))?.load).toEqual({ value: 0, unit: 'kg', convention: 'bodyweight' });
    expect(plannedLogValues(pending({ load: null, reps: { min: 8, max: 8 } }), ex({ loadConvention: 'added' }))?.load).toEqual({ value: 0, unit: 'kg', convention: 'added' });
    expect(plannedLogValues(pending({ reps: null }), ex({}))).toBeNull();
    expect(plannedLogValues(pending({ reps: null, durationS: null }), ex({ measurement: 'duration' }))).toBeNull();
    expect(plannedLogValues(pending({ reps: null, durationS: 45 }), ex({ measurement: 'duration', loadConvention: 'bodyweight' }))).toMatchObject({ durationS: 45, reps: null });
  });
});

describe('tick_all_planned (reducer)', () => {
  it('logs every planned set in workout order with its planned values and placeholder times; one version bump; no rest', () => {
    const s = pastLog();
    const plan = tickAllPlannedSets(s);
    expect(plan.length).toBe(s.sets.filter((x) => x.status === 'pending').length);
    const cmd = tick(s);
    expect(SessionCommandSchema.safeParse(cmd).success).toBe(true);
    const r = expectOk(reduceSession(s, cmd));
    const after = r.state;
    expect(after.session.version).toBe(s.session.version + 1);
    expect(after.sets.every((x) => x.status === 'completed')).toBe(true);
    expect(after.restTimer).toBeNull();
    for (const p of plan) expect(after.sets.find((x) => x.id === p.setId)?.actual).toEqual(p.values);
    // Placeholder times in tick order, a second apart from the start (ADR 0033).
    const times = plan.map((p) => toMs(after.sets.find((x) => x.id === p.setId)?.completedAt?.utc ?? ''));
    expect(times).toEqual(plan.map((_p, i) => yesterday + (i + 1) * PAST_LOG_SET_SPACING_MS));
    // The bench working sets read as planned (100 × 6, the range's low end); the hang its 45 s.
    const [, b1] = setsFor(after, BENCH);
    expect(b1?.actual).toMatchObject({ load: kg(100), reps: 6, rpe: null });
    expect(setsFor(after, HANG)[0]?.actual).toMatchObject({ durationS: 45 });
    expect(setsFor(after, ROW)[0]?.actual).toMatchObject({ load: kg(50, 'stack'), reps: 10 });
    expect(tickAllDoneText(after, 'tick-1')).toBe(`${String(plan.length)} sets ticked`);
    expect(TICK_ALL_LABEL).toBe('Tick all as planned');
    // Nothing left: the button goes.
    expect(tickAllPlannedSets(after)).toEqual([]);
  });

  it('a set already done, one Ben added and one taken out before the start stay as they are', () => {
    let s = pastLog();
    const [w, b1, b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(b1?.id ?? '', values(kg(105), 5), 10));
    s = apply(s, { type: 'add_set', at: at(12), opId: 'add', sessionExerciseId: s.exercises[0]?.id ?? '', newSetId: '00000000-0000-4000-8000-000000009999', setType: null });
    const added = s.sets.find((x) => x.id === '00000000-0000-4000-8000-000000009999');
    expect(added?.planned.addedInWorkout).toBe(true);
    const plan = tickAllPlannedSets(s).map((p) => p.setId);
    expect(plan).toContain(w?.id);
    expect(plan).toContain(b2?.id);
    expect(plan).not.toContain(b1?.id);
    expect(plan).not.toContain(added?.id);
    const after = apply(s, tick(s));
    expect(after.sets.find((x) => x.id === b1?.id)?.actual).toMatchObject({ load: kg(105), reps: 5 });
    expect(after.sets.find((x) => x.id === added?.id)?.status).toBe('pending');
  });

  it('a retry is a duplicate; a stale version and a reused opId are refused; a live workout or one not from a plan never ticks all', () => {
    const s = pastLog();
    const cmd = tick(s);
    const after = apply(s, cmd);
    const again = expectOk(reduceSession(after, { ...cmd, at: at(40) }));
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(after);
    expectError(reduceSession(after, tick(s, 'tick-2')), 'stale_version');
    const live = startFixture().state;
    expect(tickAllPlannedSets(live)).toEqual([]);
    expectError(reduceSession(live, tick(live)), 'invalid_values');
    const empty = { ...s, session: { ...s.session, routineId: null } };
    expect(tickAllPlannedSets(empty)).toEqual([]);
  });

  it('each set stays editable; Undo puts every set back to not done, and is refused once one changed since', () => {
    const s = pastLog();
    const after = apply(s, tick(s));
    const undone = apply(after, { type: 'undo_op', at: at(50), opId: 'undo-1', targetOpId: 'tick-1' });
    expect(undone.sets.filter((x) => x.status === 'pending').map((x) => x.id).sort()).toEqual(s.sets.filter((x) => x.status === 'pending').map((x) => x.id).sort());
    expect(undone.sets.every((x) => x.actual === null)).toBe(true);
    // Corrected after the tick: that set is Ben's now, so the whole Undo is out of date (never half undone).
    const [, b1] = setsFor(after, BENCH);
    const corrected = apply(after, { type: 'correct_set', at: at(45), opId: 'fix-1', setId: b1?.id ?? '', expectedSetVersion: b1?.version ?? 0, patch: { reps: 5 } });
    expect(corrected.sets.find((x) => x.id === b1?.id)?.actual?.reps).toBe(5);
    expectError(reduceSession(corrected, { type: 'undo_op', at: at(50), opId: 'undo-2', targetOpId: 'tick-1' }), 'stale_version');
  });
});
