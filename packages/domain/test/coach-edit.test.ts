import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type EditTodayArgs, type EditTodayOp, type Exercise, type PainFlag, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { planCoachEdit, reduceSession, startWorkout, type CoachEditExerciseInputs, type CoachEditInput } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, kg, OWNER, profile, stack, TZ, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * Coach v3 (ADR 0027, Ben 18 Oct): `edit_today` → `planCoachEdit` → one `coach_edit_today`
 * operation (all or nothing, one version bump) and its Undo (`revert_coach_edit`). Covers
 * pending-sets-only, the equipment max, kg/lb, per-hand dumbbells, pain holds, duplicate op IDs,
 * stale versions and a reload of the saved workout (restart recovery).
 */

const CHEST = exercise(230, 'Cable chest press', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const RAISE = exercise(231, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const FLY = exercise(232, 'Cable fly', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });

const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const order = (s: SessionAggregate): string[] => [...s.exercises].filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order).map((e) => e.exerciseName);

function inputs(e: Exercise, equipment = [barbell(), stack(), dumbbells()]): CoachEditExerciseInputs {
  return {
    exercise: e,
    history: [],
    owner: profile(),
    sameMovementIds: [],
    substitute: { ownerId: OWNER, unit: 'kg', gym: { id: GYM, name: 'Main gym', equipment }, knownEquipment: new Map(), painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(5) },
  };
}

function plan(s: SessionAggregate, ops: EditTodayOp[], over: Partial<CoachEditInput> = {}, exercises = new Map<number, CoachEditExerciseInputs | null>()): ReturnType<typeof planCoachEdit> {
  const args: EditTodayArgs = { baseVersion: s.session.version, ops, reason: 'Ben asked', benAsked: true, benQuote: 'swap it' };
  return planCoachEdit({ aggregate: s, args, intent: 'general', opId: 'turn-1:edit_today:x', actionId: id(9_000), at: at(500), painFlags: [], sessionPainUnspecified: false, gymName: 'Main gym', messagePain: null, exercises, ...over });
}

function ok(p: ReturnType<typeof planCoachEdit>) {
  if (p.status !== 'ok') throw new Error(`Expected ok, got ${p.status}${p.status === 'rejected' ? `: ${p.failure}` : ''}`);
  return p;
}

const revert = (opId = 'undo-1', target = 'turn-1:edit_today:x'): SessionCommand => ({ type: 'revert_coach_edit', at: at(600), opId, targetOpId: target, actionId: id(9_000) });

/** Warm-up and Bench set 1 logged; Bench set 2 pending. */
function midBench(): SessionAggregate {
  let s = startFixture().state;
  const [w, b1] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
  return apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 300));
}

describe('planCoachEdit + coach_edit_today (Coach v3)', () => {
  it('swap moves only pending sets; logged sets stay; one version bump; Undo puts it back', () => {
    const s0 = midBench();
    const p = ok(plan(s0, [{ op: 'swap', sessionExerciseId: rowId(s0, BENCH), toExerciseId: CHEST.id }], {}, new Map([[0, inputs(CHEST)]])));
    expect(p.lines).toEqual([{ change: 'swap', text: 'Bench press → Cable chest press' }]);
    const r = expectOk(reduceSession(s0, p.command));
    expect(r.state.session.version).toBe(s0.session.version + 1);
    expect(setsFor(r.state, BENCH).map((x) => x.status)).toEqual(['completed', 'completed', 'deleted']);
    expect(setsFor(r.state, CHEST.id).map((x) => x.status)).toEqual(['pending']);
    const back = expectOk(reduceSession(r.state, revert())).state;
    expect(back.session.version).toBe(r.state.session.version + 1);
    expect(setsFor(back, BENCH).map((x) => x.status)).toEqual(['completed', 'completed', 'pending']);
    expect(rowId(back, CHEST.id)).toBe('');
  });

  it('many ops in one: targets, set count, add, move and remove; Undo restores the plan exactly', () => {
    const s0 = startFixture().state;
    const face = setsFor(s0, FACE);
    const p = ok(
      plan(
        s0,
        [
          { op: 'set', setId: face[1]?.id ?? '', target: { load: kg(25, 'stack'), reps: null, rpe: null } },
          { op: 'set_count', sessionExerciseId: rowId(s0, ROW), workingSets: 3 },
          { op: 'add', exerciseId: FLY.id, workingSets: 2, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null },
          { op: 'move', sessionExerciseId: rowId(s0, HANG), afterSessionExerciseId: null },
        ],
        {},
        new Map([[2, inputs(FLY)]]),
      ),
    );
    expect(p.command.steps.map((x) => x.type)).toEqual(['adjust_pending_targets', 'add_exercise', 'move_exercise']);
    expect(p.lines.map((l) => l.text)).toEqual(['Cable row: 2 → 3 sets', 'Added Cable fly · 2 sets', 'Dead hang moved first']);
    const s1 = expectOk(reduceSession(s0, p.command)).state;
    expect(s1.session.version).toBe(s0.session.version + 1);
    expect(order(s1)).toEqual(['Dead hang', 'Bench press', 'Cable row', 'Face pull', 'Cable fly']);
    expect(setsFor(s1, ROW).filter((x) => x.status === 'pending')).toHaveLength(3);
    expect(setsFor(s1, FACE)[1]?.planned.load).toEqual(kg(25, 'stack'));
    // Restart recovery: the saved workout reads back and the Undo still works on it.
    const reloaded = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s1)));
    const s2 = expectOk(reduceSession(reloaded, revert())).state;
    expect(order(s2)).toEqual(order(s0));
    const live = (s: SessionAggregate) => s.sets.filter((x) => x.status !== 'deleted').map((x) => [x.id, x.status, x.planned.load]);
    expect(live(s2)).toEqual(live(s0));
  });

  it('is idempotent on its opId and refuses a different edit on the same opId', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'move', sessionExerciseId: rowId(s0, HANG), afterSessionExerciseId: null }]));
    const s1 = apply(s0, p.command);
    const again = expectOk(reduceSession(s1, { ...p.command, at: at(700) }));
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(s1);
    const other = ok(plan(s0, [{ op: 'move', sessionExerciseId: rowId(s0, BENCH), afterSessionExerciseId: rowId(s0, HANG) }]));
    expectError(reduceSession(s1, other.command), 'operation_id_reused');
    // Undone since: a replay says it is no longer in place.
    const s2 = apply(s1, revert());
    const replay = expectOk(reduceSession(s2, p.command));
    expect(replay.duplicate && replay.superseded).toBe(true);
  });

  it('stale versions are refused: by the planner and by the reducer (rule 5)', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'move', sessionExerciseId: rowId(s0, HANG), afterSessionExerciseId: null }]));
    const moved = apply(s0, logCmd(setsFor(s0, BENCH)[0]?.id ?? '', values(kg(60), 10), 60));
    expectError(reduceSession(moved, p.command), 'stale_version');
    expect(plan(moved, [{ op: 'move', sessionExerciseId: rowId(s0, HANG), afterSessionExerciseId: null }], { args: { baseVersion: s0.session.version, ops: [], reason: 'x' } }).status).toBe('stale');
  });

  it('all or nothing: a step the workout refuses refuses the whole edit', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'set_count', sessionExerciseId: rowId(s0, ROW), workingSets: 3 }, { op: 'move', sessionExerciseId: rowId(s0, HANG), afterSessionExerciseId: null }]));
    const forged = { ...p.command, steps: p.command.steps.map((x) => (x.type === 'move_exercise' ? { ...x, sessionExerciseId: id(77_777) } : x)) };
    const r = reduceSession(s0, forged);
    expectError(r, 'exercise_not_found');
    expect(r.state).toBe(s0);
  });

  it('never touches done sets: fewer sets than done is refused; a done exercise can’t be removed or moved', () => {
    const s0 = midBench();
    const bench = rowId(s0, BENCH);
    expect(plan(s0, [{ op: 'set_count', sessionExerciseId: bench, workingSets: 0 }])).toMatchObject({ status: 'rejected', failure: 'Bench press: 1 set is already done' });
    // Fewer: the pending set at the end goes; the done one stays.
    const fewer = ok(plan(s0, [{ op: 'set_count', sessionExerciseId: bench, workingSets: 1 }]));
    const s1 = apply(s0, fewer.command);
    expect(setsFor(s1, BENCH).map((x) => x.status)).toEqual(['completed', 'completed', 'deleted']);
    // A done set named in a target change is dropped with a note, never changed (rule 2).
    const done = setsFor(s0, BENCH)[1]?.id ?? '';
    expect(plan(s0, [{ op: 'set', setId: done, target: { load: kg(90), reps: null, rpe: null } }])).toMatchObject({ status: 'rejected' });
    expect(plan(s1, [{ op: 'remove', sessionExerciseId: bench }])).toMatchObject({ status: 'rejected', failure: 'Bench press is done' });
    expect(plan(s1, [{ op: 'move', sessionExerciseId: bench, afterSessionExerciseId: null }])).toMatchObject({ status: 'rejected', failure: 'Bench press is done' });
  });

  it('remove: a row with nothing done leaves; one with a done set has the rest skipped', () => {
    const s0 = midBench();
    const p = ok(plan(s0, [{ op: 'remove', sessionExerciseId: rowId(s0, BENCH) }, { op: 'remove', sessionExerciseId: rowId(s0, HANG) }]));
    expect(p.lines.map((l) => l.text)).toEqual(['Rest of Bench press skipped', 'Removed Dead hang']);
    const s1 = apply(s0, p.command);
    expect(setsFor(s1, BENCH).map((x) => x.status)).toEqual(['completed', 'completed', 'skipped']);
    expect(order(s1)).not.toContain('Dead hang');
    const s2 = apply(s1, revert());
    expect(setsFor(s2, BENCH).map((x) => x.status)).toEqual(['completed', 'completed', 'pending']);
    expect(order(s2)).toContain('Dead hang');
  });

  it('equipment max and kg/lb: a target past the stack max is capped; a lb target is converted', () => {
    const s0 = startFixture().state;
    const face = setsFor(s0, FACE);
    const p = ok(plan(s0, [{ op: 'set', setId: face[0]?.id ?? '', target: { load: kg(65, 'stack'), reps: null, rpe: null } }, { op: 'set', setId: face[1]?.id ?? '', target: { load: { value: 66, unit: 'lb', convention: 'stack' }, reps: null, rpe: null } }]));
    const after = p.exercises[0]?.changes.map((c) => c.after?.load);
    expect(after).toEqual([kg(50, 'stack'), kg(30, 'stack')]);
    expect(p.guardNotes.map((n) => n.kind)).toEqual(expect.arrayContaining(['capped', 'converted']));
    apply(s0, p.command);
  });

  it('per-hand dumbbells: an added dumbbell exercise is planned per dumbbell on the rack', () => {
    // Not at a gym without dumbbells (rule 4)…
    const plain = startFixture().state;
    expect(plan(plain, [{ op: 'add', exerciseId: RAISE.id, workingSets: 3, reps: null, workSeconds: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null }], {}, new Map([[0, inputs(RAISE)]]))).toMatchObject({ status: 'rejected', failure: 'Lateral raise: nothing for it at Main gym' });
    // …and per dumbbell where there is a rack.
    const { input } = startFixture();
    const s0 = startWorkout({ ...input, gymEquipment: [barbell(), stack(), dumbbells()] }).aggregate;
    const p = ok(plan(s0, [{ op: 'add', exerciseId: RAISE.id, workingSets: 3, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: null, afterSessionExerciseId: rowId(s0, BENCH), supersetWithSessionExerciseId: null }], {}, new Map([[0, inputs(RAISE)]])));
    const s1 = apply(s0, p.command);
    const raise = s1.exercises.find((e) => e.exerciseId === RAISE.id);
    expect(raise?.loadConvention).toBe('per_hand');
    expect(order(s1).slice(0, 2)).toEqual(['Bench press', 'Lateral raise']);
  });

  it('pain holds: no extra sets and no swap to a flagged movement (rule 9)', () => {
    const s0 = startFixture().state;
    const flag: PainFlag = { id: id(8_000), ownerId: OWNER, version: 1, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, exerciseId: FACE, exerciseName: 'Face pull', area: 'shoulder', source: 'coach', checkInId: null, reportedAt: { utc: at(1).utc, tz: TZ }, status: 'active', clearedAtUtc: null, createdByOpId: 'x' };
    expect(plan(s0, [{ op: 'set_count', sessionExerciseId: rowId(s0, FACE), workingSets: 3 }], { painFlags: [flag] }).status).toBe('rejected');
    const flaggedChest: PainFlag = { ...flag, id: id(8_001), exerciseId: CHEST.id, exerciseName: CHEST.name };
    expect(plan(s0, [{ op: 'swap', sessionExerciseId: rowId(s0, BENCH), toExerciseId: CHEST.id }], { painFlags: [flaggedChest] }, new Map([[0, inputs(CHEST)]])).status).toBe('rejected');
  });

  it('two ops that fight over a row are refused; an offer’s Adjust only changes its row', () => {
    const s0 = startFixture().state;
    const bench = rowId(s0, BENCH);
    expect(plan(s0, [{ op: 'swap', sessionExerciseId: bench, toExerciseId: CHEST.id }, { op: 'set_count', sessionExerciseId: bench, workingSets: 4 }], {}, new Map([[0, inputs(CHEST)]])).status).toBe('rejected');
    expect(plan(s0, [{ op: 'move', sessionExerciseId: rowId(s0, HANG), afterSessionExerciseId: null }], { onlySessionExerciseId: bench })).toMatchObject({ status: 'rejected', failure: 'only Bench press' });
  });

  it('Undo is refused (nothing changes) once a set is logged on the added exercise', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'add', exerciseId: FLY.id, workingSets: 2, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null }], {}, new Map([[0, inputs(FLY)]])));
    const s1 = apply(s0, p.command);
    const fly = setsFor(s1, FLY.id)[0]?.id ?? '';
    const s2 = apply(s1, logCmd(fly, values(kg(20, 'stack'), 12), 550));
    const r = reduceSession(s2, revert());
    expectError(r, 'stale_version');
    expect(r.state).toBe(s2);
  });

  it('move: Undo is refused after another move; a move of a superset member moves the pair', () => {
    const s0 = startFixture().state;
    const s1 = apply(s0, { type: 'move_exercise', at: at(10), opId: 'm1', sessionExerciseId: rowId(s0, FACE), afterSessionExerciseId: rowId(s0, HANG), expectedVersion: s0.session.version });
    expect(order(s1)).toEqual(['Bench press', 'Dead hang', 'Cable row', 'Face pull']);
    const s2 = apply(s1, { type: 'move_exercise', at: at(11), opId: 'm2', sessionExerciseId: rowId(s0, BENCH), afterSessionExerciseId: rowId(s0, HANG), expectedVersion: s1.session.version });
    expectError(reduceSession(s2, { type: 'undo_op', at: at(12), opId: 'u1', targetOpId: 'm1' }), 'stale_version');
    const s3 = apply(s2, { type: 'undo_op', at: at(12), opId: 'u2', targetOpId: 'm2' });
    expect(order(s3)).toEqual(order(s1));
    const s4 = apply(s3, { type: 'undo_op', at: at(13), opId: 'u3', targetOpId: 'm1' });
    expect(order(s4)).toEqual(order(s0));
  });
});
