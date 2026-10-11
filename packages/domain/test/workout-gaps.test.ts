import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type PainFlag, type PlannedSet, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import {
  buildActiveSetView,
  buildAddExerciseCommand,
  buildSwapExerciseCommand,
  isRemovable,
  midSwapSlot,
  notCopiedText,
  reduceSession,
  startWorkoutFromSession,
  swapPainCarry,
  valuesText,
  type SwapPlan,
} from '../src/index';
import { at, exercise, id, idGen, kg, ms, profile, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

const CHEST = exercise(230, 'Cable chest press', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const SLED = exercise(231, 'Sled push', { measurement: 'distance', compatibleEquipment: [], defaultLoadConvention: 'added' });

const planned = (load: number | null, reps = { min: 8, max: 10 }): PlannedSet => ({ load: load === null ? null : kg(load, 'stack'), reps, durationS: null, rpe: null, rir: null, source: 'built_in_rule' });
const chestPlan = (load: number | null): SwapPlan => ({ exercise: CHEST, pin: null, plan: load === null ? null : [{ setType: 'working', planned: planned(load) }] });

const benchRow = (s: SessionAggregate) => s.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
const view = (s: SessionAggregate, seconds = 1000) => buildActiveSetView({ aggregate: s, nowMs: ms(seconds), gymName: 'Main', previous: {}, painFlagged: new Set(), edits: null, withTimeLeft: false });

function swapCmd(s: SessionAggregate, plan: SwapPlan, opId = 'swap-1', newIdStart = 70_000): SessionCommand {
  const r = buildSwapExerciseCommand({ aggregate: s, sessionExerciseId: benchRow(s), plan, gymName: 'Main', ownerUnit: 'kg', opId, at: at(400), newId: idGen(newIdStart) });
  if (!r.ok) throw new Error(r.reason);
  return r.command;
}

/** Warm-up and Bench set 1 logged; Bench set 2 pending and active. */
function midBench(): SessionAggregate {
  let s = startFixture().state;
  const [w, b1] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 300));
  return s;
}

describe('swap an exercise mid-workout (EL4, B3)', () => {
  it('moves only the pending sets; logged sets stay on the original row (rule 2)', () => {
    const s0 = midBench();
    const b2 = setsFor(s0, BENCH)[2];
    expect(midSwapSlot(s0, benchRow(s0))).toEqual({ workingSets: 1, templates: [{ setType: 'working', reps: { min: 6, max: 8 }, durationS: null }] });
    const r = expectOk(reduceSession(s0, swapCmd(s0, chestPlan(45))));
    const s = r.state;
    const bench = setsFor(s, BENCH);
    expect(bench.map((x) => x.status)).toEqual(['completed', 'completed', 'deleted']);
    expect(bench[1]?.actual).toEqual(s0.sets.find((x) => x.id === bench[1]?.id)?.actual);
    const chest = s.exercises.find((e) => e.exerciseId === CHEST.id);
    expect(chest).toMatchObject({ exerciseName: 'Cable chest press', loadConvention: 'stack', swappedFrom: { sessionExerciseId: benchRow(s), opId: 'swap-1' } });
    // Straight after the original row.
    expect(chest?.order).toBe((s.exercises.find((e) => e.exerciseId === BENCH)?.order ?? -9) + 1);
    const moved = setsFor(s, CHEST.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ status: 'pending', setType: 'working', planned: { load: kg(45, 'stack'), reps: { min: 8, max: 10 } }, rest: b2?.rest });
    // The active set moved with its slot.
    expect(s.session.activeSetId).toBe(moved[0]?.id);
    expect(s.exercises.find((e) => e.exerciseId === BENCH)?.removed).toBeUndefined();
    expect(r.events.map((e) => e.type)).toContain('ExerciseSwapped');
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
    expect(view(s).focus?.swappedFrom).toEqual({ name: 'Bench press', opId: 'swap-1' });
  });

  it('fits the target to the gym: past the stack max is capped, never extrapolated (rule 4)', () => {
    const s0 = midBench();
    const cmd = swapCmd(s0, chestPlan(80));
    if (cmd.type !== 'swap_exercise') throw new Error('type');
    const load = cmd.sets[0]?.planned.load;
    expect(load === null || (load !== undefined && load.value <= 50)).toBe(true);
    expectOk(reduceSession(s0, cmd));
  });

  it('no history: the slot keeps its reps with a blank load (never the original’s load, GS3)', () => {
    const s0 = midBench();
    const cmd = swapCmd(s0, chestPlan(null));
    if (cmd.type !== 'swap_exercise') throw new Error('type');
    expect(cmd.sets[0]?.planned).toMatchObject({ load: null, reps: { min: 6, max: 8 } });
  });

  it('the reducer refuses a load the item can’t make and a stale version', () => {
    const s0 = midBench();
    const cmd = swapCmd(s0, chestPlan(45));
    if (cmd.type !== 'swap_exercise') throw new Error('type');
    const bad = { ...cmd, sets: cmd.sets.map((x) => ({ ...x, planned: { ...x.planned, load: kg(47, 'stack') } })) };
    expectError(reduceSession(s0, bad), 'invalid_values');
    const over = { ...cmd, sets: cmd.sets.map((x) => ({ ...x, planned: { ...x.planned, load: kg(55, 'stack') } })) };
    expectError(reduceSession(s0, over), 'invalid_values');
    expectError(reduceSession(s0, { ...cmd, expectedVersion: s0.session.version - 1 }), 'stale_version');
    const lb = { ...cmd, unit: 'lb' as const };
    expectError(reduceSession(s0, lb), 'convention_mismatch');
  });

  it('is idempotent: a retry with new generated IDs is a duplicate; another swap on the same opId is refused', () => {
    const s0 = midBench();
    const s1 = apply(s0, swapCmd(s0, chestPlan(45)));
    const again = reduceSession(s1, swapCmd(s0, chestPlan(45), 'swap-1', 80_000));
    expect(again.ok && again.duplicate).toBe(true);
    const other = { ...(swapCmd(s0, chestPlan(45), 'swap-1') as Extract<SessionCommand, { type: 'swap_exercise' }>), exercise: { ...(swapCmd(s0, chestPlan(45)) as Extract<SessionCommand, { type: 'swap_exercise' }>).exercise, exerciseId: id(999) } };
    expectError(reduceSession(s1, other), 'operation_id_reused');
  });

  it('a row with nothing logged leaves the workout; Undo brings it back exactly', () => {
    const s0 = startFixture().state;
    const before = setsFor(s0, BENCH);
    const s1 = apply(s0, swapCmd(s0, chestPlan(45)));
    expect(s1.exercises.find((e) => e.exerciseId === BENCH)?.removed).toMatchObject({ by: 'swap', opId: 'swap-1' });
    expect(view(s1).exercises.map((e) => e.name)).not.toContain('Bench press');
    expect(setsFor(s1, CHEST.id).map((x) => x.setType)).toEqual(['warmup', 'working', 'working']);
    const s2 = apply(s1, { type: 'undo_op', at: at(410), opId: 'undo-swap', targetOpId: 'swap-1' });
    expect(s2.exercises.find((e) => e.exerciseId === BENCH)?.removed).toBeUndefined();
    expect(s2.exercises.find((e) => e.exerciseId === CHEST.id)?.removed).toMatchObject({ by: 'swap' });
    expect(setsFor(s2, BENCH).map((x) => [x.status, x.planned])).toEqual(before.map((x) => [x.status, x.planned]));
    expect(s2.session.activeSetId).toBe(s0.session.activeSetId);
    expect(view(s2).exercises.map((e) => e.name)).not.toContain('Cable chest press');
    // Undo twice: refused, nothing changes.
    expectError(reduceSession(s2, { type: 'undo_op', at: at(420), opId: 'undo-swap-2', targetOpId: 'swap-1' }), 'stale_version');
  });

  it('Undo after a set was logged on the substitute: the logged set stays (it’s real), the rest go back', () => {
    let s = startFixture().state;
    s = apply(s, swapCmd(s, chestPlan(45)));
    const [cw] = setsFor(s, CHEST.id);
    s = apply(s, logCmd(cw?.id ?? '', values(kg(20, 'stack'), 12), 500));
    s = apply(s, { type: 'undo_op', at: at(600), opId: 'undo-swap', targetOpId: 'swap-1' });
    expect(setsFor(s, CHEST.id).map((x) => x.status)).toEqual(['completed', 'deleted', 'deleted']);
    expect(setsFor(s, BENCH).map((x) => x.status)).toEqual(['deleted', 'pending', 'pending']);
    expect(s.exercises.find((e) => e.exerciseId === CHEST.id)?.removed).toBeUndefined();
  });

  it('refuses while the work timer runs on a moving set, and when nothing is pending', () => {
    let s = startFixture().state;
    const hang = s.exercises.find((e) => e.exerciseId === HANG)?.id ?? '';
    const [h1] = setsFor(s, HANG);
    s = apply(s, { type: 'set_active_set', at: at(1), opId: 'act', setId: h1?.id ?? '', expectedVersion: s.session.version });
    s = apply(s, { type: 'start_work_interval', at: at(2), opId: 'w', setId: h1?.id ?? '', durationS: 45 });
    const plank = exercise(232, 'Plank', { measurement: 'duration', compatibleEquipment: [], defaultLoadConvention: 'bodyweight' });
    const r = buildSwapExerciseCommand({ aggregate: s, sessionExerciseId: hang, plan: { exercise: plank, pin: null, plan: null }, gymName: 'Main', ownerUnit: 'kg', opId: 'sw', at: at(3), newId: idGen(71_000) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.command.sets[0]?.planned).toMatchObject({ load: null, durationS: 45 });
    expectError(reduceSession(s, r.command), 'work_interval_running');
    // A different measurement is never offered (and never built).
    expect(buildSwapExerciseCommand({ aggregate: s, sessionExerciseId: hang, plan: chestPlan(45), gymName: 'Main', ownerUnit: 'kg', opId: 'sw2', at: at(3), newId: idGen(72_000) })).toEqual({ ok: false, reason: 'measurement' });
  });
});

const painFlag = (exerciseId: string, status: PainFlag['status'] = 'active'): PainFlag => ({
  id: id(7_700),
  ownerId: profile().id,
  version: 1,
  createdAtUtc: at(310).utc,
  updatedAtUtc: at(310).utc,
  exerciseId,
  exerciseName: 'Bench press',
  area: 'shoulder',
  source: 'workout',
  checkInId: null,
  reportedAt: at(310),
  status,
  clearedAtUtc: null,
  createdByOpId: 'op-pain',
});

describe('swap after pain holds the substitute today (B5, rule 9; review gaps B1)', () => {
  it('an active flag on the swapped exercise, or a logged set marked pain, carries; nothing else does', () => {
    const s = midBench();
    const row = benchRow(s);
    expect(swapPainCarry(s, row, [])).toEqual({ active: false, reportedAtUtc: null });
    expect(swapPainCarry(s, row, [painFlag(ROW)]).active).toBe(false);
    expect(swapPainCarry(s, row, [painFlag(BENCH, 'cleared')]).active).toBe(false);
    expect(swapPainCarry(s, row, [painFlag(BENCH)])).toEqual({ active: true, reportedAtUtc: at(310).utc });
    // A set marked `pain` (the flag since cleared) still holds today.
    const b1 = setsFor(s, BENCH)[1];
    const marked: SessionAggregate = { ...s, sets: s.sets.map((x) => (x.id === b1?.id ? { ...x, exclusions: ['pain' as const] } : x)) };
    expect(swapPainCarry(marked, row, [])).toEqual({ active: true, reportedAtUtc: b1?.completedAt?.utc ?? null });
  });

  it('swapping the substitute again still carries the original’s pain (Bench → Chest → …)', () => {
    const s0 = midBench();
    const s1 = apply(s0, swapCmd(s0, chestPlan(45)));
    const chest = s1.exercises.find((e) => e.exerciseId === CHEST.id)?.id ?? '';
    expect(swapPainCarry(s1, chest, [painFlag(BENCH)]).active).toBe(true);
    expect(swapPainCarry(s1, chest, []).active).toBe(false);
  });
});

describe('swap leaves a half-logged left/right pair alone (review gaps S1)', () => {
  it('the pending other side stays on the original row; only the untouched sets move', () => {
    let s = startFixture().state;
    s = { ...s, exercises: s.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, laterality: 'unilateral' as const } : e)), sets: s.sets.map((x) => (setsFor(s, BENCH).some((b) => b.id === x.id) ? { ...x, side: 'both' as const } : x)) };
    const [w, b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 300, 'left-1', 'left'));
    const partner = s.sets.find((x) => x.pairedWithSetId === b1?.id);
    expect(partner?.status).toBe('pending');
    // The slot is the untouched set 2 only.
    expect(midSwapSlot(s, benchRow(s))?.workingSets).toBe(1);
    const after = apply(s, swapCmd(s, chestPlan(45)));
    expect(after.sets.find((x) => x.id === partner?.id)).toEqual(partner);
    expect(setsFor(after, CHEST.id)).toHaveLength(1);
    expect(after.exercises.find((e) => e.exerciseId === BENCH)?.removed).toBeUndefined();
  });

  it('nothing to swap when only the other side is left', () => {
    let s = startFixture().state;
    s = { ...s, exercises: s.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, laterality: 'unilateral' as const } : e)), sets: s.sets.map((x) => (setsFor(s, BENCH).some((b) => b.id === x.id) ? { ...x, side: 'both' as const } : x)) };
    const [w, b1, b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 300));
    s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 8), 500, 'left-2', 'left'));
    expect(midSwapSlot(s, benchRow(s))).toBeNull();
  });
});

describe('Undo for delete set, skip exercise and corrections (copy D4)', () => {
  it('delete of a logged set: Undo puts it back as it was; a second Undo is refused', () => {
    const s0 = midBench();
    const b1 = setsFor(s0, BENCH)[1];
    const s1 = apply(s0, { type: 'delete_set', at: at(310), opId: 'del', setId: b1?.id ?? '', expectedSetVersion: b1?.version ?? 0 });
    expect(setsFor(s1, BENCH)[1]?.status).toBe('deleted');
    const r = expectOk(reduceSession(s1, { type: 'undo_op', at: at(311), opId: 'undo-del', targetOpId: 'del' }));
    const back = setsFor(r.state, BENCH)[1];
    expect(back).toMatchObject({ status: 'completed', actual: b1?.actual, version: (b1?.version ?? 0) + 2 });
    expect(r.state.audit.at(-1)).toMatchObject({ kind: 'undone', opId: 'undo-del', setId: b1?.id, before: { status: 'deleted' }, after: { status: 'completed' } });
    expectError(reduceSession(r.state, { type: 'undo_op', at: at(312), opId: 'undo-del-2', targetOpId: 'del' }), 'stale_version');
    // A retry of the same Undo is a duplicate, not a second change.
    const dup = reduceSession(r.state, { type: 'undo_op', at: at(311), opId: 'undo-del', targetOpId: 'del' });
    expect(dup.ok && dup.duplicate).toBe(true);
  });

  it('delete of the active pending set: Undo makes it active again', () => {
    const s0 = midBench();
    const b2 = setsFor(s0, BENCH)[2];
    expect(s0.session.activeSetId).toBe(b2?.id);
    const s1 = apply(s0, { type: 'delete_set', at: at(310), opId: 'del', setId: b2?.id ?? '', expectedSetVersion: b2?.version ?? 0 });
    expect(s1.session.activeSetId).not.toBe(b2?.id);
    const s2 = apply(s1, { type: 'undo_op', at: at(311), opId: 'u', targetOpId: 'del' });
    expect(setsFor(s2, BENCH)[2]?.status).toBe('pending');
  });

  it('skip exercise: Undo returns every skipped set to pending', () => {
    const s0 = startFixture().state;
    const row = s0.exercises.find((e) => e.exerciseId === ROW)?.id ?? '';
    const s1 = apply(s0, { type: 'skip_exercise', at: at(10), opId: 'skip', sessionExerciseId: row });
    expect(setsFor(s1, ROW).map((x) => x.status)).toEqual(['skipped', 'skipped']);
    const s2 = apply(s1, { type: 'undo_op', at: at(11), opId: 'u', targetOpId: 'skip' });
    expect(setsFor(s2, ROW).map((x) => x.status)).toEqual(['pending', 'pending']);
    expect(setsFor(s2, ROW)[0]?.skippedBy).toBeUndefined();
  });

  it('skip, then a set re-added and logged: Undo is refused only if a skipped set changed', () => {
    const s0 = startFixture().state;
    const row = s0.exercises.find((e) => e.exerciseId === ROW)?.id ?? '';
    let s = apply(s0, { type: 'skip_exercise', at: at(10), opId: 'skip', sessionExerciseId: row });
    const r1 = setsFor(s, ROW)[0];
    s = apply(s, { type: 'delete_set', at: at(11), opId: 'del', setId: r1?.id ?? '', expectedSetVersion: r1?.version ?? 0 });
    expectError(reduceSession(s, { type: 'undo_op', at: at(12), opId: 'u', targetOpId: 'skip' }), 'stale_version');
  });

  it('correction: Undo restores the earlier values and the Edited tag; refused once the set changed again', () => {
    const s0 = midBench();
    const b1 = setsFor(s0, BENCH)[1];
    const s1 = apply(s0, { type: 'correct_set', at: at(320), opId: 'fix', setId: b1?.id ?? '', expectedSetVersion: b1?.version ?? 0, patch: { reps: 6, setType: 'top' } });
    expect(setsFor(s1, BENCH)[1]).toMatchObject({ edited: true, setType: 'top', actual: { reps: 6 } });
    const s2 = apply(s1, { type: 'undo_op', at: at(321), opId: 'u', targetOpId: 'fix' });
    expect(setsFor(s2, BENCH)[1]).toMatchObject({ edited: false, setType: 'working', actual: { reps: 8 } });

    const again = setsFor(s1, BENCH)[1];
    const s3 = apply(s1, { type: 'correct_set', at: at(330), opId: 'fix2', setId: again?.id ?? '', expectedSetVersion: again?.version ?? 0, patch: { reps: 7 } });
    expectError(reduceSession(s3, { type: 'undo_op', at: at(331), opId: 'u', targetOpId: 'fix' }), 'stale_version');
    // Undo of the newest correction keeps the earlier one's Edited tag.
    expect(setsFor(apply(s3, { type: 'undo_op', at: at(332), opId: 'u2', targetOpId: 'fix2' }), BENCH)[1]).toMatchObject({ edited: true, actual: { reps: 6 } });
  });

  it('after Finish: Undo of a correction is allowed; Undo of a delete is not', () => {
    let s = midBench();
    const [w, b1] = setsFor(s, BENCH);
    s = apply(s, { type: 'correct_set', at: at(320), opId: 'fix', setId: b1?.id ?? '', expectedSetVersion: b1?.version ?? 0, patch: { reps: 5 } });
    s = apply(s, { type: 'delete_set', at: at(321), opId: 'del', setId: w?.id ?? '', expectedSetVersion: w?.version ?? 0 });
    s = apply(s, { type: 'finish', at: at(400), opId: 'fin', expectedVersion: s.session.version, endedAt: at(400) });
    expect(s.session.status).toBe('finished');
    expect(setsFor(apply(s, { type: 'undo_op', at: at(500), opId: 'u', targetOpId: 'fix' }), BENCH)[1]?.actual?.reps).toBe(8);
    expect(reduceSession(s, { type: 'undo_op', at: at(500), opId: 'u2', targetOpId: 'del' }).ok).toBe(false);
  });

  it('refuses an Undo of something that has no Undo here, or never happened', () => {
    const s = midBench();
    expectError(reduceSession(s, { type: 'undo_op', at: at(1), opId: 'u', targetOpId: 'nope' }), 'operation_not_found');
    const logOp = Object.keys(s.processedOps).find((k) => s.processedOps[k]?.commandType === 'log_set') ?? '';
    expectError(reduceSession(s, { type: 'undo_op', at: at(1), opId: 'u2', targetOpId: logOp }), 'operation_not_undoable');
  });
});

describe('remove an exercise added by mistake (exercise-library §4.6)', () => {
  const add = (s: SessionAggregate) =>
    apply(s, buildAddExerciseCommand({ opId: 'add-chest', owner: profile(), exercise: CHEST, equipmentId: s.session.equipmentSnapshot.find((e) => e.kind === 'weight_stack')?.id ?? null, at: at(5), newId: idGen(60_000) }));

  it('removes it with no confirm; Undo brings it back with its sets', () => {
    const s0 = add(startFixture().state);
    const row = s0.exercises.find((e) => e.exerciseId === CHEST.id);
    if (!row) throw new Error('row');
    expect(isRemovable(s0, row)).toBe(true);
    const s1 = apply(s0, { type: 'remove_exercise', at: at(6), opId: 'rm', sessionExerciseId: row.id, expectedVersion: s0.session.version });
    expect(s1.exercises.find((e) => e.id === row.id)?.removed).toMatchObject({ by: 'remove', opId: 'rm' });
    expect(setsFor(s1, CHEST.id).every((x) => x.status === 'deleted')).toBe(true);
    expect(view(s1).exercises.map((e) => e.name)).not.toContain('Cable chest press');
    const s2 = apply(s1, { type: 'undo_op', at: at(7), opId: 'u', targetOpId: 'rm' });
    expect(s2.exercises.find((e) => e.id === row.id)?.removed).toBeUndefined();
    expect(setsFor(s2, CHEST.id).map((x) => x.status)).toEqual(['pending']);
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s2))).success).toBe(true);
  });

  it('is refused once a set is logged on it (skip or delete sets instead)', () => {
    let s = midBench();
    const bench = s.exercises.find((e) => e.exerciseId === BENCH);
    if (!bench) throw new Error('bench');
    expect(isRemovable(s, bench)).toBe(false);
    expectError(reduceSession(s, { type: 'remove_exercise', at: at(400), opId: 'rm', sessionExerciseId: bench.id, expectedVersion: s.session.version }), 'exercise_logged');
    s = add(s);
    expectError(reduceSession(s, { type: 'remove_exercise', at: at(400), opId: 'rm2', sessionExerciseId: bench.id, expectedVersion: s.session.version - 1 }), 'stale_version');
  });
});

describe('notes on an exercise or a set (active-workout §4.4)', () => {
  it('sets, trims and clears; never touches values or the set’s version', () => {
    const s0 = midBench();
    const b1 = setsFor(s0, BENCH)[1];
    const row = benchRow(s0);
    const s1 = apply(s0, { type: 'set_note', at: at(1), opId: 'n1', target: { kind: 'exercise', sessionExerciseId: row }, note: '  Seat 4  ', expectedVersion: s0.session.version });
    expect(s1.exercises.find((e) => e.id === row)?.note).toBe('Seat 4');
    const s2 = apply(s1, { type: 'set_note', at: at(2), opId: 'n2', target: { kind: 'set', setId: b1?.id ?? '' }, note: 'Felt easy', expectedVersion: s1.session.version });
    const after = setsFor(s2, BENCH)[1];
    expect(after).toMatchObject({ note: 'Felt easy', version: b1?.version, actual: b1?.actual, edited: false });
    expect(view(s2).focus?.note).toBe('Seat 4');
    expect(view(s2).focus?.rows.find((x) => x.setId === b1?.id)?.note).toBe('Felt easy');
    const s3 = apply(s2, { type: 'set_note', at: at(3), opId: 'n3', target: { kind: 'exercise', sessionExerciseId: row }, note: null, expectedVersion: s2.session.version });
    expect(s3.exercises.find((e) => e.id === row)?.note).toBeUndefined();
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s2))).success).toBe(true);
    expectError(reduceSession(s3, { type: 'set_note', at: at(4), opId: 'n4', target: { kind: 'set', setId: b1?.id ?? '' }, note: 'x', expectedVersion: s0.session.version }), 'stale_version');
  });

  it('works after Finish', () => {
    let s = midBench();
    s = apply(s, { type: 'finish', at: at(400), opId: 'fin', expectedVersion: s.session.version, endedAt: at(400) });
    s = apply(s, { type: 'set_note', at: at(500), opId: 'n', target: { kind: 'exercise', sessionExerciseId: benchRow(s) }, note: 'Grip wider', expectedVersion: s.session.version });
    expect(s.exercises.find((e) => e.exerciseId === BENCH)?.note).toBe('Grip wider');
  });
});

describe('distance sets (ADR 0011)', () => {
  const addSled = (s: SessionAggregate) => apply(s, buildAddExerciseCommand({ opId: 'add-sled', owner: profile(), exercise: SLED, equipmentId: null, at: at(5), newId: idGen(61_000) }));

  it('needs a distance to log, stores it, and shows metres', () => {
    let s = addSled(startFixture().state);
    const [sled] = setsFor(s, SLED.id);
    expect(s.exercises.find((e) => e.exerciseId === SLED.id)?.measurement).toBe('distance');
    expectError(reduceSession(s, logCmd(sled?.id ?? '', values(kg(40, 'added'), null), 30)), 'invalid_values');
    s = apply(s, logCmd(sled?.id ?? '', values(kg(40, 'added'), null, { distanceM: 20 }), 30));
    expect(setsFor(s, SLED.id)[0]?.actual).toMatchObject({ distanceM: 20 });
    expect(valuesText({ load: kg(40, 'added'), reps: null, durationS: null, distanceM: 20 }, { convention: 'added', measurement: 'distance' })).toBe('40 kg × 20 m');
    expect(valuesText({ load: kg(0, 'added'), reps: null, durationS: null, distanceM: 1500 }, { convention: 'added', measurement: 'distance' })).toBe('1.5 km');
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it('the focus card asks for a distance and steps it by 5 m', () => {
    let s = addSled(startFixture().state);
    const [sled] = setsFor(s, SLED.id);
    s = apply(s, { type: 'set_active_set', at: at(6), opId: 'act', setId: sled?.id ?? '', expectedVersion: s.session.version });
    const v = view(s, 7);
    expect(v.focus?.distance).toMatchObject({ value: null, up: { enabled: true, value: 5 }, down: { enabled: false } });
    expect(v.focus?.missing).toBe('distance');
    expect(v.primary).toMatchObject({ kind: 'enter', field: 'distance', label: 'Enter distance' });
    s = apply(s, { type: 'save_draft', at: at(8), setId: sled?.id ?? '', values: values(kg(0, 'added'), null, { distanceM: 25 }) });
    expect(view(s, 9).focus?.distance).toMatchObject({ value: 25, down: { enabled: true, value: 20 } });
  });
});

describe('Repeat with a distance exercise (review gaps S4)', () => {
  it('a sled push is listed as not copied, never dropped silently; the rest is copied', () => {
    let s = startFixture().state;
    s = apply(s, buildAddExerciseCommand({ opId: 'add-sled', owner: profile(), exercise: SLED, equipmentId: null, at: at(5), newId: idGen(61_000) }));
    const [sled] = setsFor(s, SLED.id);
    const [w] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10));
    s = apply(s, logCmd(sled?.id ?? '', values(kg(40, 'added'), null, { distanceM: 20 }), 30));
    for (const ex of s.exercises) if (s.sets.some((x) => x.sessionExerciseId === ex.id && x.status === 'pending')) s = apply(s, { type: 'skip_exercise', at: at(40), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    s = apply(s, { type: 'finish', at: at(90), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const out = startWorkoutFromSession({ opId: 'rep-sled', owner: profile(), gymId: s.session.gymId ?? '', source: s, exercises: new Map([[SLED.id, SLED]]), gymEquipment: s.session.equipmentSnapshot, at: at(86_400), newId: idGen(62_000) });
    expect(out.notCopied).toContainEqual({ kind: 'distance', exerciseName: 'Sled push', sets: 1 });
    expect(out.aggregate.exercises.map((e) => e.exerciseName)).toEqual(['Bench press']);
    expect(notCopiedText(out.notCopied)).toContain('1 distance set (Sled push)');
    expect(notCopiedText([{ kind: 'skipped', exerciseName: 'Cable fly', skipped: 2 }])).toBe('Not copied: 2 skipped sets (Cable fly)');
    expect(notCopiedText([])).toBeNull();
  });
});

describe('timed sets: the work timer on the focus card (active-workout §2.7)', () => {
  it('idle shows Start 0:45; running shows Stop with the time left; stopped leaves the time to log', () => {
    let s = startFixture().state;
    const [h1] = setsFor(s, HANG);
    s = apply(s, { type: 'set_active_set', at: at(1), opId: 'act', setId: h1?.id ?? '', expectedVersion: s.session.version });
    expect(view(s, 2).focus?.workTimer).toEqual({ state: 'idle', plannedS: 45, remainingMs: null, label: 'Start 0:45' });
    expect(view(s, 2).primary).toEqual({ kind: 'start_work', label: 'Start 0:45', durationS: 45, logLabel: 'Log 0:45' });
    expect(view(s, 2).focus?.duration).toMatchObject({ value: 45, up: { enabled: true, value: 50 }, down: { enabled: true, value: 40 } });
    s = apply(s, { type: 'start_work_interval', at: at(10), opId: 'w', setId: h1?.id ?? '', durationS: 45 });
    expect(view(s, 20).focus?.workTimer).toMatchObject({ state: 'running', remainingMs: 35_000, label: 'Stop' });
    expect(view(s, 20).primary).toEqual({ kind: 'stop_work', label: 'Stop' });
    s = apply(s, { type: 'stop_work_interval', at: at(48), opId: 'stop', setId: h1?.id ?? '' });
    const f = view(s, 49).focus;
    expect(f?.workTimer?.state).toBe('ended');
    expect(f?.duration?.value).toBe(38);
    expect(f?.logLabel).toContain('0:38');
    expect(view(s, 49).primary.kind).toBe('log');
  });

  it('a time typed without the timer (gym clock, Start forgotten) logs as typed; Start stays primary (review gaps S2)', () => {
    let s = startFixture().state;
    const [h1] = setsFor(s, HANG);
    s = apply(s, { type: 'set_active_set', at: at(1), opId: 'act', setId: h1?.id ?? '', expectedVersion: s.session.version });
    s = apply(s, { type: 'save_draft', at: at(2), setId: h1?.id ?? '', values: values(null, null, { durationS: 52 }) });
    const v = view(s, 3);
    expect(v.primary).toMatchObject({ kind: 'start_work', logLabel: 'Log 0:52' });
    const f = v.focus;
    if (!f) throw new Error('focus');
    s = apply(s, { type: 'log_set', at: at(4), opId: f.opId, setId: f.setId, values: f.logValues, restTimerId: id(98_001) });
    expect(s.sets.find((x) => x.id === h1?.id)).toMatchObject({ status: 'completed', actual: { durationS: 52 } });
    expect(s.workInterval).toBeNull();
  });

  it('the time Ben sets before Start is what the timer runs; at 0 a tick fills the planned time', () => {
    let s = startFixture().state;
    const [h1] = setsFor(s, HANG);
    s = apply(s, { type: 'set_active_set', at: at(1), opId: 'act', setId: h1?.id ?? '', expectedVersion: s.session.version });
    s = apply(s, { type: 'save_draft', at: at(2), setId: h1?.id ?? '', values: values(null, null, { durationS: 60 }) });
    expect(view(s, 3).primary).toEqual({ kind: 'start_work', label: 'Start 1:00', durationS: 60, logLabel: 'Log 1:00' });
    s = apply(s, { type: 'start_work_interval', at: at(5), opId: 'w', setId: h1?.id ?? '', durationS: 60 });
    s = apply(s, { type: 'tick', at: at(70) });
    expect(view(s, 71).focus?.duration?.value).toBe(60);
    expect(view(s, 71).primary).toMatchObject({ kind: 'log' });
    // While the timer ran, Delete and Skip were refused (§2.7).
    const s2 = apply(startFixture().state, { type: 'start_work_interval', at: at(5), opId: 'w', setId: h1?.id ?? '', durationS: 60 });
    const hangRow = s2.exercises.find((e) => e.exerciseId === HANG)?.id ?? '';
    expectError(reduceSession(s2, { type: 'skip_exercise', at: at(6), opId: 'sk', sessionExerciseId: hangRow }), 'work_interval_running');
  });
});
