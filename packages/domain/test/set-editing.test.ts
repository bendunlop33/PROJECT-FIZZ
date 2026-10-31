import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';
import { buildExecutionOrder, findSetRecord, reduceSession, summariseVolume } from '../src/index';
import { at, dumbbells, exercise, GYM, idGen, kg, lb, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, setsFor, startFixture } from './session-fixture';
import { startWorkout } from '../src/index';

/** 14 Oct (Ben, build 151): "I should be able to edit anything on the sets". */

const edit = (setId: string, version: number, patch: Extract<SessionCommand, { type: 'edit_planned_set' }>['patch'], opId = 'edit-1', seconds = 30): SessionCommand => ({
  type: 'edit_planned_set',
  at: at(seconds),
  opId,
  setId,
  expectedSetVersion: version,
  patch,
});

function bench(s: SessionAggregate, i: number) {
  const set = setsFor(s, BENCH)[i];
  if (!set) throw new Error(`no bench set ${String(i)}`);
  return set;
}

describe('edit_planned_set: a set not done yet', () => {
  it('changes load, reps (range or exact), type, target RPE and rest in one versioned write', () => {
    const s = startFixture().state;
    const b2 = bench(s, 2);
    const r = expectOk(reduceSession(s, edit(b2.id, b2.version, { load: kg(102.5), reps: { min: 5, max: 5 }, setType: 'top', targetRpe: 8.5, restS: 240 })));
    const after = bench(r.state, 2);
    expect(after).toMatchObject({ setType: 'top', rest: { seconds: 240, source: 'set_override' }, version: b2.version + 1 });
    expect(after.planned).toMatchObject({ load: kg(102.5), reps: { min: 5, max: 5 }, rpeOverride: 8.5 });
    expect(r.state.session.version).toBe(s.session.version + 1);
    expect(r.events.map((e) => e.type)).toEqual(['PlannedSetEdited', 'RestPlanChanged']);
    // A range target stays a range.
    const ranged = expectOk(reduceSession(r.state, edit(b2.id, after.version, { reps: { min: 6, max: 10 } }, 'edit-2', 31)));
    expect(bench(ranged.state, 2).planned.reps).toEqual({ min: 6, max: 10 });
  });

  it('never touches a logged set: it is corrected instead (rule 2)', () => {
    let s = startFixture().state;
    const w = bench(s, 0);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 20));
    expectError(reduceSession(s, edit(w.id, bench(s, 0).version, { load: kg(80) })), 'set_not_pending');
    expect(bench(s, 0).actual?.load).toEqual(kg(60));
  });

  it('refuses a stale set version and changes nothing (rule 5)', () => {
    const s = startFixture().state;
    const b1 = bench(s, 1);
    const once = apply(s, edit(b1.id, b1.version, { load: kg(105) }));
    const r = reduceSession(once, edit(b1.id, b1.version, { load: kg(110) }, 'edit-2'));
    expectError(r, 'stale_version');
    expect(bench(once, 1).planned.load).toEqual(kg(105));
  });

  it('applies a repeated operation ID once (idempotent) and rejects the ID on a different edit', () => {
    const s = startFixture().state;
    const b1 = bench(s, 1);
    const cmd = edit(b1.id, b1.version, { load: kg(105) });
    const first = expectOk(reduceSession(s, cmd));
    const again = expectOk(reduceSession(first.state, cmd));
    expect(again.duplicate).toBe(true);
    expect(again.superseded).toBe(false);
    expect(again.state).toBe(first.state);
    expectError(reduceSession(first.state, edit(b1.id, b1.version, { load: kg(110) })), 'operation_id_reused');
  });

  it('keeps loads to what the equipment can make: kg/lb, between min and max (rule 4)', () => {
    const s = startFixture().state;
    const b1 = bench(s, 1);
    expectError(reduceSession(s, edit(b1.id, b1.version, { load: kg(101) })), 'invalid_values');
    expectError(reduceSession(s, edit(b1.id, b1.version, { load: kg(400) })), 'invalid_values');
    expectError(reduceSession(s, edit(b1.id, b1.version, { load: lb(225) })), 'unit_mismatch');
    expectError(reduceSession(s, edit(b1.id, b1.version, { load: kg(100, 'per_hand') })), 'convention_mismatch');
    // A stack never goes past its heaviest plate (50).
    const face = setsFor(s, FACE)[0];
    expectError(reduceSession(s, edit(face?.id ?? '', face?.version ?? 1, { load: kg(55, 'stack') })), 'invalid_values');
    expect(expectOk(reduceSession(s, edit(face?.id ?? '', face?.version ?? 1, { load: kg(50, 'stack') }))).state).toBeDefined();
  });

  it('per-hand dumbbells: only the rack’s own pairs', () => {
    const rack = dumbbells();
    const press = exercise(260, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: routine([routineExercise(900, { exerciseId: press.id, equipmentId: rack.id, order: 0, setTemplates: [template(9001, { targetLoad: kg(20, 'per_hand') })] })]),
      exercises: new Map([[press.id, press]]),
      gymEquipment: [rack],
      at: at(0),
      newId: idGen(71_000),
    }).aggregate;
    const set = s.sets[0];
    if (!set) throw new Error('no set');
    expectError(reduceSession(s, edit(set.id, set.version, { load: kg(21, 'per_hand') })), 'invalid_values');
    expectError(reduceSession(s, edit(set.id, set.version, { load: kg(32.5, 'per_hand') })), 'invalid_values');
    expectError(reduceSession(s, edit(set.id, set.version, { load: kg(45) })), 'convention_mismatch');
    const ok = apply(s, edit(set.id, set.version, { load: kg(22.5, 'per_hand') }));
    expect(ok.sets[0]?.planned.load).toEqual(kg(22.5, 'per_hand'));
  });

  it('a target change replaces only the draft values it sets; with nothing of Ben’s left, Log logs the new target', () => {
    let s = startFixture().state;
    const w = bench(s, 0);
    s = apply(s, { type: 'save_draft', at: at(5), setId: w.id, values: values(kg(60), 9) });
    expect(bench(s, 0).draft).not.toBeNull();
    s = apply(s, edit(w.id, bench(s, 0).version, { load: kg(70) }));
    // Weight-revert B1 (21 Oct): a new load never drops the reps Ben typed.
    expect(bench(s, 0).draft).toMatchObject({ load: kg(70), reps: 9 });
    expect(bench(s, 0).planned.edit?.fields).toEqual(['load']);
    s = apply(s, edit(w.id, bench(s, 0).version, { reps: { min: 9, max: 9 } }, 'edit-reps'));
    expect(bench(s, 0).draft).toBeNull();
    // A rest-only edit keeps the draft.
    s = apply(s, { type: 'save_draft', at: at(6), setId: w.id, values: values(kg(70), 9) });
    s = apply(s, edit(w.id, bench(s, 0).version, { restS: 75 }, 'edit-rest'));
    expect(bench(s, 0).draft?.reps).toBe(9);
  });

  it('a warm-up or drop set has no target RPE: changing the type clears it, and setting one is refused', () => {
    let s = startFixture().state;
    const b1 = bench(s, 1);
    s = apply(s, edit(b1.id, b1.version, { targetRpe: 8 }));
    expect(bench(s, 1).planned.rpeOverride).toBe(8);
    s = apply(s, edit(b1.id, bench(s, 1).version, { setType: 'warmup' }, 'to-warmup'));
    expect(bench(s, 1).planned.rpeOverride).toBeUndefined();
    expectError(reduceSession(s, edit(b1.id, bench(s, 1).version, { targetRpe: 9 }, 'rpe-again')), 'invalid_values');
  });

  it('Undo puts back exactly what the edit replaced (target, type, rest, draft), once', () => {
    let s = startFixture().state;
    const b1 = bench(s, 1);
    s = apply(s, { type: 'save_draft', at: at(5), setId: b1.id, values: values(kg(100), 7) });
    const before = bench(s, 1);
    s = apply(s, edit(b1.id, before.version, { load: kg(90), setType: 'backoff', restS: 90 }));
    const undo: SessionCommand = { type: 'undo_op', at: at(40), opId: 'undo:edit-1', targetOpId: 'edit-1' };
    const r = expectOk(reduceSession(s, undo));
    const back = bench(r.state, 1);
    expect({ planned: back.planned, setType: back.setType, rest: back.rest, draft: back.draft }).toEqual({ planned: before.planned, setType: before.setType, rest: before.rest, draft: before.draft });
    expect(r.events).toEqual([{ type: 'PlannedSetEdited', setId: b1.id, undo: true }]);
    // The undo is idempotent; the edit is now superseded.
    expect(expectOk(reduceSession(r.state, undo)).duplicate).toBe(true);
    expect(expectOk(reduceSession(r.state, edit(b1.id, before.version, { load: kg(90), setType: 'backoff', restS: 90 }))).superseded).toBe(true);
  });

  it('Undo is refused once the set changed since: edited again, or logged (rule 5)', () => {
    let s = startFixture().state;
    const b1 = bench(s, 1);
    s = apply(s, edit(b1.id, b1.version, { load: kg(90) }));
    const again = apply(s, edit(b1.id, bench(s, 1).version, { load: kg(95) }, 'edit-2'));
    expectError(reduceSession(again, { type: 'undo_op', at: at(40), opId: 'u1', targetOpId: 'edit-1' }), 'stale_version');
    // The latest edit can still be undone, back to 90.
    const undone = apply(again, { type: 'undo_op', at: at(41), opId: 'u2', targetOpId: 'edit-2' });
    expect(bench(undone, 1).planned.load).toEqual(kg(90));

    let logged = apply(s, logCmd(bench(s, 0).id, values(kg(60), 10), 50));
    logged = apply(logged, logCmd(b1.id, values(kg(90), 8), 60));
    expectError(reduceSession(logged, { type: 'undo_op', at: at(70), opId: 'u3', targetOpId: 'edit-1' }), 'stale_version');
    expect(bench(logged, 1).actual?.load).toEqual(kg(90));
  });

  it('edit A, edit B, Undo B: A’s Undo works again and puts the original back; it survives a restart (review S5)', async () => {
    const { SessionAggregateSchema } = await import('@fizz/schemas');
    let s = startFixture().state;
    const b1 = bench(s, 1);
    s = apply(s, edit(b1.id, b1.version, { load: kg(90) }));
    s = apply(s, edit(b1.id, bench(s, 1).version, { load: kg(95), restS: 60 }, 'edit-2'));
    s = apply(s, { type: 'undo_op', at: at(40), opId: 'u-b', targetOpId: 'edit-2' });
    expect(bench(s, 1).planned.load).toEqual(kg(90));
    s = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
    const r = expectOk(reduceSession(s, { type: 'undo_op', at: at(41), opId: 'u-a', targetOpId: 'edit-1' }));
    expect(bench(r.state, 1).planned).toEqual(b1.planned);
    expect(bench(r.state, 1).rest).toEqual(b1.rest);
    // Versions only go up.
    expect(bench(r.state, 1).version).toBe(b1.version + 4);
  });

  it('an earlier edit that was already stale before the next one stays stale after that one’s Undo', () => {
    let s = startFixture().state;
    const b1 = bench(s, 1);
    s = apply(s, edit(b1.id, b1.version, { load: kg(90) }));
    // Something else moved the set on (A's Undo is now refused)…
    s = { ...s, sets: s.sets.map((x) => (x.id === b1.id ? { ...x, version: x.version + 1 } : x)) };
    expectError(reduceSession(s, { type: 'undo_op', at: at(39), opId: 'u0', targetOpId: 'edit-1' }), 'stale_version');
    s = apply(s, edit(b1.id, bench(s, 1).version, { load: kg(95) }, 'edit-2'));
    s = apply(s, { type: 'undo_op', at: at(40), opId: 'u-b', targetOpId: 'edit-2' });
    // …so undoing B doesn't bring A's Undo back.
    expect(bench(s, 1).planned.edit).toBeUndefined();
    expectError(reduceSession(s, { type: 'undo_op', at: at(41), opId: 'u-a', targetOpId: 'edit-1' }), 'stale_version');
  });

  it('Ben’s edit replaces a coach change’s marker on that set, so the coach’s Undo can’t revert it', () => {
    let s = startFixture().state;
    const b2 = bench(s, 2);
    s = apply(s, {
      type: 'adjust_pending_targets',
      at: at(10),
      opId: 'coach-op',
      expectedVersion: s.session.version,
      actionId: 'act-1',
      changes: [{ setId: b2.id, target: { load: kg(95), reps: { min: 6, max: 8 } } }],
      removeSetIds: [],
      addSets: [],
    });
    expect(bench(s, 2).planned.coach?.actionId).toBe('act-1');
    s = apply(s, edit(b2.id, bench(s, 2).version, { load: kg(97.5) }));
    expect(bench(s, 2).planned).toMatchObject({ load: kg(97.5) });
    expect(bench(s, 2).planned.coach).toBeUndefined();
    expect(bench(s, 2).planned.source).toBeUndefined();
    s = apply(s, { type: 'revert_target_adjustment', at: at(40), opId: 'coach-undo', actionId: 'act-1', removedSetIds: [], addedSetIds: [] });
    expect(bench(s, 2).planned.load).toEqual(kg(97.5));
    // Undo of Ben's edit brings the coach's target (and its marker) back.
    s = apply(s, { type: 'undo_op', at: at(41), opId: 'u', targetOpId: 'edit-1' });
    expect(bench(s, 2).planned).toMatchObject({ load: kg(95), coach: { actionId: 'act-1' } });
  });

  it('a timed set’s target is a time; reps are refused there', () => {
    const s = startFixture().state;
    const hang = setsFor(s, HANG)[0];
    if (!hang) throw new Error('no hang');
    expectError(reduceSession(s, edit(hang.id, hang.version, { reps: { min: 5, max: 5 } })), 'invalid_values');
    expect(apply(s, edit(hang.id, hang.version, { durationS: 60 })).sets.find((x) => x.id === hang.id)?.planned.durationS).toBe(60);
  });

  it('survives a restart: the edit and its Undo record round-trip through the schema', async () => {
    const { SessionAggregateSchema } = await import('@fizz/schemas');
    const s = startFixture().state;
    const b1 = bench(s, 1);
    const edited = apply(s, edit(b1.id, b1.version, { load: kg(90), reps: { min: 4, max: 6 } }));
    const restored = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(edited)));
    expect(restored).toEqual(edited);
    const undone = apply(restored, { type: 'undo_op', at: at(60), opId: 'u', targetOpId: 'edit-1' });
    expect(bench(undone, 1).planned).toEqual(b1.planned);
  });
});

describe('set type changes keep warm-ups out of volume and records', () => {
  it('a logged working set corrected to a warm-up leaves volume; back to working, it counts again', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(bench(s, 0).id, values(kg(60), 10), 20));
    s = apply(s, logCmd(bench(s, 1).id, values(kg(100), 8), 200));
    const sets = (x: SessionAggregate) => summariseVolume(x).find((v) => v.sessionExerciseId === bench(x, 1).sessionExerciseId);
    const working = sets(s);
    expect(working?.sets).toBe(1);
    const b1 = bench(s, 1);
    const warm = apply(s, { type: 'correct_set', at: at(210), opId: 'c1', setId: b1.id, expectedSetVersion: b1.version, patch: { setType: 'warmup' } });
    expect(sets(warm)?.sets ?? 0).toBe(0);
    const back = apply(warm, { type: 'undo_op', at: at(220), opId: 'u', targetOpId: 'c1' });
    expect(sets(back)).toEqual(working);
  });

  it('a warm-up is never a record', () => {
    const base = { exerciseName: 'Bench press', gymName: null, equipmentId: null, convention: 'total' as const, measurement: 'reps', earlierToday: [], history: [] };
    expect(findSetRecord({ ...base, set: { setType: 'warmup', load: kg(500), reps: 1 } })).toBeNull();
  });
});

describe('add_set after a set (insert)', () => {
  it('goes straight after that set, copies it, and moves only the positions of later sets', () => {
    const s = startFixture().state;
    const [w, b1, b2] = [bench(s, 0), bench(s, 1), bench(s, 2)];
    const r = expectOk(reduceSession(s, { type: 'add_set', at: at(10), opId: 'ins', sessionExerciseId: w.sessionExerciseId, newSetId: 'new-set', setType: null, afterSetId: w.id }));
    const order = buildExecutionOrder(r.state.exercises, r.state.sets).filter((x) => [w.id, b1.id, b2.id, 'new-set'].includes(x));
    expect(order).toEqual([w.id, 'new-set', b1.id, b2.id]);
    const added = r.state.sets.find((x) => x.id === 'new-set');
    expect(added).toMatchObject({ setType: 'warmup', status: 'pending', planned: { load: kg(60) }, rest: w.rest });
    // Positions moved; versions and values didn't.
    expect(bench(r.state, 2)).toMatchObject({ id: b1.id, version: b1.version, planned: b1.planned });
  });

  it('inserting after a logged set never changes it, and the copy carries no other set’s Undo record', () => {
    let s = startFixture().state;
    s = apply(s, edit(bench(s, 0).id, bench(s, 0).version, { load: kg(62.5) }));
    s = apply(s, logCmd(bench(s, 0).id, values(kg(62.5), 10), 20));
    const w = bench(s, 0);
    const after = apply(s, { type: 'add_set', at: at(30), opId: 'ins', sessionExerciseId: w.sessionExerciseId, newSetId: 'new-set', setType: null, afterSetId: w.id });
    expect(after.sets.find((x) => x.id === w.id)).toEqual(w);
    expect(after.sets.find((x) => x.id === 'new-set')?.planned.edit).toBeUndefined();
  });

  it('Undo takes the added set out again while it is still pending; not after it was logged', () => {
    const s = startFixture().state;
    const w = bench(s, 0);
    const added = apply(s, { type: 'add_set', at: at(10), opId: 'ins', sessionExerciseId: w.sessionExerciseId, newSetId: 'new-set', setType: null, afterSetId: w.id });
    const undone = expectOk(reduceSession(added, { type: 'undo_op', at: at(11), opId: 'u', targetOpId: 'ins' }));
    expect(undone.state.sets.find((x) => x.id === 'new-set')?.status).toBe('deleted');
    expect(undone.state.audit.at(-1)).toMatchObject({ kind: 'deleted', setId: 'new-set' });

    let logged = apply(added, logCmd(w.id, values(kg(60), 10), 20));
    logged = apply(logged, logCmd('new-set', values(kg(60), 10), 100));
    expectError(reduceSession(logged, { type: 'undo_op', at: at(120), opId: 'u2', targetOpId: 'ins' }), 'stale_version');
  });
});
