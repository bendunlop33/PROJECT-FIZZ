import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type Exercise, type PlannedSet, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import {
  canDropRound,
  dropRoundCommand,
  roundDraggable,
  fitPlanToItem,
  snapTypedLoadEasier,
  addWarmupCommand,
  adviseSessionChange,
  buildExecutionOrder,
  canAddWarmupNow,
  moveRoundCommand,
  moveSetCommand,
  movableSetIds,
  plannedFromBuilderRows,
  reduceSession,
  removeExerciseCommand,
  roundMoveTargets,
  roundSteps,
  sessionRounds,
  setMoveSteps,
  startWorkout,
  stepRoundCommand,
  stepSetCommand,
  canRemoveExercise,
  pairWithCommand,
  supersetNextCommand,
  typeRestCommand,
  warmupGap,
  type BuilderExerciseInfo,
} from '../src/index';
import { assisted, at, dumbbells, exercise, GYM, id, idGen, kg, lb, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * workout-table-v3 §7 "Same editing as the builder": the new session commands (`reorder_sets`,
 * `add_warmup`, `set_rest_after` by type, `remove_exercise` keeping logged sets) and the pure
 * helpers the round page, the pop-up and the Workout sheet send through. Each: idempotent opIds,
 * versioned (stale refused, rule 5), done sets never touched (rule 2), Undo, and a reload of the
 * saved workout (restart recovery) still undoes.
 */

const reload = (s: SessionAggregate): SessionAggregate => SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
const undo = (target: string, opId = `undo-${target}`): SessionCommand => ({ type: 'undo_op', at: at(900), opId, targetOpId: target });
const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const op = (opId: string, seconds = 400) => ({ opId, at: at(seconds) });

/** Bench warm-up and set 1 logged; set 2 is next. */
function benchStarted(): SessionAggregate {
  let s = startFixture().state;
  const [w, b1] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 6), 300));
  return s;
}

/** Bench with two more working sets added (four working, one done). */
function benchWithMore(): SessionAggregate {
  let s = benchStarted();
  const bench = rowId(s, BENCH);
  s = apply(s, { type: 'add_set', at: at(310), opId: 'add-a', sessionExerciseId: bench, newSetId: id(91001), setType: 'working' });
  s = apply(s, { type: 'add_set', at: at(311), opId: 'add-b', sessionExerciseId: bench, newSetId: id(91002), setType: 'working' });
  return s;
}

describe('reorder_sets (set-row drag)', () => {
  it('moves only sets not done yet; done sets keep their logged order and versions; the first pending becomes current', () => {
    const s0 = benchWithMore();
    const bench = rowId(s0, BENCH);
    const pending = movableSetIds(s0, bench);
    expect(pending).toHaveLength(3);
    const [b2, x1, x2] = pending;
    expect(s0.session.activeSetId).toBe(b2);
    const cmd = moveSetCommand(s0, x2 ?? '', 0, op('reorder-1'));
    expect(cmd?.setIds).toEqual([x2, b2, x1]);
    const r = expectOk(reduceSession(s0, cmd as SessionCommand));
    const s1 = r.state;
    expect(movableSetIds(s1, bench)).toEqual([x2, b2, x1]);
    // Done sets: same index, values and version.
    const done0 = setsFor(s0, BENCH).filter((x) => x.status === 'completed');
    const done1 = setsFor(s1, BENCH).filter((x) => x.status === 'completed');
    expect(done1).toEqual(done0);
    // Pending sets: only the index moved.
    for (const id0 of pending) {
      const a = s0.sets.find((x) => x.id === id0);
      const b = s1.sets.find((x) => x.id === id0);
      expect({ ...b, index: 0 }).toEqual({ ...a, index: 0 });
    }
    expect(s1.session.activeSetId).toBe(x2);
    expect(s1.session.version).toBe(s0.session.version + 1);
    expect(r.events.some((e) => e.type === 'SetsReordered')).toBe(true);
    // Execution order follows the new order.
    const order = buildExecutionOrder(s1.exercises, s1.sets).filter((x) => pending.includes(x));
    expect(order).toEqual([x2, b2, x1]);
  });

  it('is idempotent and refuses a stale version or a set list that changed', () => {
    const s0 = benchWithMore();
    const cmd = moveSetCommand(s0, movableSetIds(s0, rowId(s0, BENCH))[2] ?? '', 0, op('reorder-1'));
    if (cmd === null) throw new Error('no move');
    const s1 = apply(s0, cmd);
    const again = expectOk(reduceSession(s1, cmd));
    expect(again.duplicate).toBe(true);
    expect(again.superseded).toBe(false);
    // The same order sent against the newer state with a new opId: stale version.
    expectError(reduceSession(s1, { ...cmd, opId: 'reorder-2' }), 'stale_version');
    // A list that names a done set: refused as stale (nothing changes).
    const done = setsFor(s0, BENCH).find((x) => x.status === 'completed')?.id ?? '';
    const bad: SessionCommand = { type: 'reorder_sets', at: at(400), opId: 'reorder-3', sessionExerciseId: rowId(s0, BENCH), setIds: [done, ...movableSetIds(s0, rowId(s0, BENCH)).slice(1)], expectedVersion: s0.session.version };
    expectError(reduceSession(s0, bad), 'stale_version');
  });

  it('Undo puts the old order (and the current set) back, also after a relaunch; refused once a set moved on', () => {
    const s0 = benchWithMore();
    const bench = rowId(s0, BENCH);
    const before = movableSetIds(s0, bench);
    const s1 = apply(s0, moveSetCommand(s0, before[2] ?? '', 0, op('reorder-1')) as SessionCommand);
    const back = apply(reload(s1), undo('reorder-1'));
    expect(movableSetIds(back, bench)).toEqual(before);
    expect(back.session.activeSetId).toBe(before[0]);
    expect(expectOk(reduceSession(back, moveSetCommand(s0, before[2] ?? '', 0, op('reorder-1')) as SessionCommand)).superseded).toBe(true);
    // Log the moved set: the Undo is refused (rule 2: a done set never moves).
    const logged = apply(s1, logCmd(before[2] ?? '', values(kg(100), 6), 600));
    expectError(reduceSession(logged, undo('reorder-1')), 'stale_version');
  });

  it('VoiceOver Move up / Move down: one place among the pending sets', () => {
    const s0 = benchWithMore();
    const [a, b, c] = movableSetIds(s0, rowId(s0, BENCH));
    expect(setMoveSteps(s0, a ?? '')).toEqual({ up: false, down: true });
    expect(setMoveSteps(s0, c ?? '')).toEqual({ up: true, down: false });
    expect(stepSetCommand(s0, a ?? '', 'up', op('x'))).toBeNull();
    expect(stepSetCommand(s0, b ?? '', 'up', op('x'))?.setIds).toEqual([b, a, c]);
    // A done set never moves.
    const done = setsFor(s0, BENCH).find((x) => x.status === 'completed')?.id ?? '';
    expect(setMoveSteps(s0, done)).toEqual({ up: false, down: false });
    expect(stepSetCommand(s0, done, 'down', op('x'))).toBeNull();
  });
});

describe('add_warmup (＋ Warm-up mid-workout)', () => {
  it('fills the ramp gap on the bar, rounded down; goes before the first working set and becomes current; Undo takes it out', () => {
    const s0 = startFixture().state;
    const bench = rowId(s0, BENCH);
    const built = addWarmupCommand(s0, bench, { ...op('warm-1'), newSetId: id(92001) });
    if (!built.ok) throw new Error(built.reason);
    // Ramp 0 · 60 · 100: the biggest gap is 0–60, middle 30 (on 20 kg bar + plates) × 10.
    expect(built.command.planned.load).toEqual(kg(30));
    expect(built.command.planned.reps).toEqual({ min: 10, max: 10 });
    const s1 = apply(s0, built.command);
    const order = setsFor(s1, BENCH).map((x) => `${x.setType}:${String(x.planned.load?.value)}`);
    expect(order).toEqual(['warmup:30', 'warmup:60', 'working:100', 'working:100']);
    expect(s1.session.activeSetId).toBe(id(92001));
    const back = apply(reload(s1), undo('warm-1'));
    expect(setsFor(back, BENCH).filter((x) => x.status !== 'deleted').map((x) => x.planned.load?.value)).toEqual([60, 100, 100]);
    expect(expectOk(reduceSession(back, built.command)).superseded).toBe(true);
  });

  it('after a working set is done it goes before the next one, never before a done set', () => {
    const s0 = benchStarted();
    const built = addWarmupCommand(s0, rowId(s0, BENCH), { ...op('warm-1'), newSetId: id(92001) });
    if (!built.ok) throw new Error(built.reason);
    const s1 = apply(s0, built.command);
    const rows = setsFor(s1, BENCH);
    expect(rows.map((x) => x.status)).toEqual(['completed', 'completed', 'pending', 'pending']);
    expect(rows[2]?.id).toBe(id(92001));
    // The done sets are untouched (rule 2).
    expect(rows.slice(0, 2)).toEqual(setsFor(s0, BENCH).slice(0, 2));
  });

  it('refuses a load the bar can’t make, a stale version, and a done exercise; idempotent', () => {
    const s0 = startFixture().state;
    const bench = rowId(s0, BENCH);
    const built = addWarmupCommand(s0, bench, { ...op('warm-1'), newSetId: id(92001) });
    if (!built.ok) throw new Error(built.reason);
    expectError(reduceSession(s0, { ...built.command, opId: 'warm-bad', planned: { ...built.command.planned, load: kg(31.3) } }), 'invalid_values');
    const s1 = apply(s0, built.command);
    expect(expectOk(reduceSession(s1, built.command)).duplicate).toBe(true);
    expectError(reduceSession(s1, { ...built.command, opId: 'warm-2', newSetId: id(92002) }), 'stale_version');
    let done = s0;
    for (const x of setsFor(done, HANG)) done = apply(done, logCmd(x.id, values(null, null, { durationS: 45 }), 500));
    expect(addWarmupCommand(done, rowId(done, HANG), { ...op('warm-3'), newSetId: id(92003) })).toEqual({ ok: false, reason: 'done' });
  });

  it('per-hand dumbbells in lb round down on the rack; assisted machines have no ramp; at most 6 (WU4’s longest ladder)', () => {
    const CURL = id(260);
    const PULL = id(261);
    const exs = new Map<string, Exercise>([
      [CURL, exercise(260, 'Dumbbell curl', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
      [PULL, exercise(261, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })],
    ]);
    const rack = dumbbells({ unit: 'lb', loads: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] });
    const machine = assisted();
    const r = routine([
      routineExercise(600, { exerciseId: CURL, equipmentId: rack.id, order: 0, setTemplates: [template(6001, { targetLoad: lb(35, 'per_hand'), targetReps: { min: 8, max: 12 } })] }),
      routineExercise(601, { exerciseId: PULL, equipmentId: machine.id, order: 1, setTemplates: [template(6011, { targetLoad: kg(25, 'assistance') })] }),
    ]);
    const s0 = startWorkout({ opId: 'start-lb', owner: profile({ preferredUnit: 'lb' }), gymId: GYM, routine: r, exercises: exs, gymEquipment: [rack, machine], at: at(0), newId: idGen() }).aggregate;
    const curl = rowId(s0, CURL);
    const built = addWarmupCommand(s0, curl, { ...op('warm-lb'), newSetId: id(93001) });
    if (!built.ok) throw new Error(built.reason);
    // 35 lb each: gap 0–35, middle 17.5 → 15 lb each (down, never up), × 10.
    expect(built.command.planned.load).toEqual(lb(15, 'per_hand'));
    let s = apply(s0, built.command);
    expect(addWarmupCommand(s0, rowId(s0, PULL), { ...op('warm-as'), newSetId: id(93002) })).toEqual({ ok: false, reason: 'no_load' });
    for (let i = 0; i < 6; i += 1) {
      const next = addWarmupCommand(s, curl, { ...op(`warm-lb-${String(i)}`), newSetId: id(93010 + i) });
      if (!next.ok) {
        expect(['max_warmups', 'no_gap']).toContain(next.reason);
        break;
      }
      s = apply(s, next.command);
    }
    expect(setsFor(s, CURL).filter((x) => x.setType === 'warmup').length).toBeLessThanOrEqual(6);
    expect(canAddWarmupNow(s, curl)).toBe(false);
  });

  it('not inside a superset: a warm-up there would shift every round (integrity B1); the reducer refuses too', () => {
    const s0 = startFixture().state;
    const row = rowId(s0, ROW);
    expect(addWarmupCommand(s0, row, { ...op('warm-ss'), newSetId: id(94001) })).toEqual({ ok: false, reason: 'superset' });
    expect(canAddWarmupNow(s0, row)).toBe(false);
    const forced: SessionCommand = { type: 'add_warmup', at: at(400), opId: 'warm-ss', sessionExerciseId: row, newSetId: id(94001), planned: { load: kg(25, 'stack'), reps: { min: 10, max: 10 }, durationS: null, rpe: null, rir: null }, restS: 60, expectedVersion: s0.session.version };
    expectError(reduceSession(s0, forced), 'invalid_values');
    // The rounds still pair Row 1 · Face 1 · Row 2 · Face 2.
    const [r1, r2] = setsFor(s0, ROW).map((x) => x.id);
    const [f1, f2] = setsFor(s0, FACE).map((x) => x.id);
    expect(buildExecutionOrder(s0.exercises, s0.sets).filter((x) => [r1, r2, f1, f2].includes(x))).toEqual([r1, f1, r2, f2]);
  });

  it('not offered when the only sets not done sit before a done one (the reducer would refuse; review S7)', () => {
    let s = startFixture().state;
    const [, , b2] = setsFor(s, BENCH);
    // Ben logs Bench set 2 first: the warm-up and set 1 are still pending, before a done set.
    s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 5), 100));
    const bench = rowId(s, BENCH);
    expect(addWarmupCommand(s, bench, { ...op('warm-x'), newSetId: id(94002) })).toEqual({ ok: false, reason: 'done' });
    expect(canAddWarmupNow(s, bench)).toBe(false);
  });

  it('a later set Ben made current stays current (N3)', () => {
    let s = startFixture().state;
    const [, b1, b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(setsFor(s, BENCH)[0]?.id ?? '', values(kg(60), 10), 60));
    s = apply(s, { type: 'set_active_set', at: at(70), opId: 'pick-b2', setId: b2?.id ?? '', expectedVersion: s.session.version });
    expect(s.session.activeSetId).toBe(b2?.id);
    const built = addWarmupCommand(s, rowId(s, BENCH), { ...op('warm-n3'), newSetId: id(94003) });
    if (!built.ok) throw new Error(built.reason);
    const s1 = apply(s, built.command);
    expect(s1.session.activeSetId).toBe(b2?.id);
    expect(b1).toBeDefined();
  });

  it('warmupGap is the builder’s rule: biggest gap, rounded down, reps by closeness; null with no room', () => {
    const down = (v: number) => Math.floor(v / 2.5) * 2.5;
    expect(warmupGap([], 100, down)).toEqual({ load: 50, reps: 5 });
    // A tie goes to the lighter gap (the builder's order).
    expect(warmupGap([50], 100, down)).toEqual({ load: 25, reps: 10 });
    expect(warmupGap([10, 50], 100, down)).toEqual({ load: 75, reps: 3 });
    expect(warmupGap([20, 40, 60, 70], 100, down)).toEqual({ load: 85, reps: 1 });
    expect(warmupGap([], 2.5, down)).toBeNull();
  });
});

describe('set_rest_after by set type (pop-up rest per type)', () => {
  it('changes the pending sets of that type only, marked as Ben’s own; never a done set', () => {
    const s0 = benchWithMore();
    const bench = rowId(s0, BENCH);
    const cmd = typeRestCommand(s0, bench, 'working', 150, op('rest-1'));
    if (cmd === null) throw new Error('no command');
    expect(cmd.scope).toBe('type');
    const s1 = apply(s0, cmd);
    for (const x of setsFor(s1, BENCH)) {
      const was = s0.sets.find((y) => y.id === x.id);
      if (x.status === 'pending' && x.setType === 'working') {
        expect(x.rest.seconds).toBe(150);
        expect(x.rest.byOpId).toBe('rest-1');
      } else expect(x).toEqual(was);
    }
    expectError(reduceSession(s1, { ...cmd, opId: 'rest-2' }), 'stale_version');
  });

  it('a superset’s After each round is the last member’s rest, labelled as Ben’s round rest, never as a saved default (review S3)', () => {
    const s0 = startFixture().state;
    const cmd = typeRestCommand(s0, rowId(s0, ROW), 'round', 75, op('rest-r'));
    expect(cmd?.scope).toBe('round');
    const s1 = apply(s0, cmd as SessionCommand);
    for (const x of setsFor(s1, FACE)) {
      expect(x.rest).toEqual({ seconds: 75, source: 'set_override', sourceLabel: 'After each round (yours)', byOpId: 'rest-r' });
    }
    expect(setsFor(s1, ROW)).toEqual(setsFor(s0, ROW));
    expect(expectOk(reduceSession(s1, cmd as SessionCommand)).duplicate).toBe(true);
    if (cmd === null) throw new Error('no command');
    expectError(reduceSession(s1, { ...cmd, opId: 'rest-r2' }), 'stale_version');
  });
});

describe('remove_exercise with logged sets (asks first, keeps them in history)', () => {
  it('without the confirmation it is refused; with it the rest goes, the logged sets and the row stay; Undo brings the rest back', () => {
    const s0 = benchStarted();
    const bench = rowId(s0, BENCH);
    const { command, loggedSets } = removeExerciseCommand(s0, bench, op('remove-1'));
    expect(loggedSets).toBe(2);
    const unasked: SessionCommand = { type: 'remove_exercise', at: command.at, opId: 'remove-0', sessionExerciseId: bench, expectedVersion: command.expectedVersion };
    expectError(reduceSession(s0, unasked), 'exercise_logged');
    expectError(reduceSession(s0, { ...command, confirmedLoggedSets: 1, opId: 'remove-x' }), 'exercise_logged');
    const s1 = apply(s0, command);
    const rows = setsFor(s1, BENCH);
    expect(rows.filter((x) => x.status === 'completed')).toEqual(setsFor(s0, BENCH).filter((x) => x.status === 'completed'));
    expect(rows.filter((x) => x.status === 'pending')).toEqual([]);
    expect(s1.exercises.find((e) => e.id === bench)?.removed).toBeUndefined();
    // Log moves on to the next exercise.
    expect(s1.sets.find((x) => x.id === s1.session.activeSetId)?.sessionExerciseId).not.toBe(bench);
    expect(expectOk(reduceSession(s1, command)).duplicate).toBe(true);
    const back = apply(reload(s1), undo('remove-1'));
    expect(setsFor(back, BENCH).map((x) => x.status)).toEqual(setsFor(s0, BENCH).map((x) => x.status));
    expect(expectOk(reduceSession(back, command)).superseded).toBe(true);
  });

  it('a confirmation built when the dialog opened is refused once the workout moved on (integrity B2)', () => {
    const s0 = benchStarted();
    const bench = rowId(s0, BENCH);
    // The dialog opens: the command (and its count) is fixed now.
    const asked = removeExerciseCommand(s0, bench, op('remove-1'));
    // Before Ben confirms, the next set is logged from the lock screen.
    const moved = apply(s0, logCmd(setsFor(s0, BENCH)[2]?.id ?? '', values(kg(100), 6), 500));
    expectError(reduceSession(moved, asked.command), 'stale_version');
    expect(moved.sets).toEqual(apply(s0, logCmd(setsFor(s0, BENCH)[2]?.id ?? '', values(kg(100), 6), 500)).sets);
  });

  it('a superset member with logged sets: its rest goes, the partner keeps its rounds, the logged sets stay grouped; Undo (S7)', () => {
    let s0 = startFixture().state;
    for (const x of setsFor(s0, BENCH)) s0 = apply(s0, logCmd(x.id, values(x.planned.load, 8), 100));
    s0 = apply(s0, logCmd(setsFor(s0, ROW)[0]?.id ?? '', values(kg(50, 'stack'), 10), 200));
    s0 = apply(s0, logCmd(setsFor(s0, FACE)[0]?.id ?? '', values(kg(20, 'stack'), 12), 260));
    const row = rowId(s0, ROW);
    const { command, loggedSets } = removeExerciseCommand(s0, row, op('remove-row'));
    expect(loggedSets).toBe(1);
    const s1 = apply(s0, command);
    // Row 1 stays, logged and still in superset A; Row 2 is gone.
    expect(setsFor(s1, ROW).map((x) => x.status)).toEqual(['completed', 'deleted']);
    expect(s1.exercises.find((e) => e.id === row)?.supersetGroup).toBe('A');
    expect(setsFor(s1, ROW)[0]).toEqual(setsFor(s0, ROW)[0]);
    // Face pull's round 2 is next, then Dead hang; Face's offset is unchanged.
    const face2 = setsFor(s1, FACE)[1]?.id;
    expect(s1.session.activeSetId).toBe(face2);
    expect(s1.exercises.find((e) => e.exerciseId === FACE)?.roundOffset).toBe(s0.exercises.find((e) => e.exerciseId === FACE)?.roundOffset);
    const order = buildExecutionOrder(s1.exercises, s1.sets).filter((x) => s1.sets.find((y) => y.id === x)?.status === 'pending');
    expect(order).toEqual([face2, ...setsFor(s1, HANG).map((x) => x.id)]);
    const back = apply(reload(s1), undo('remove-row'));
    expect(setsFor(back, ROW).map((x) => x.status)).toEqual(['completed', 'pending']);
    expect(canRemoveExercise(back, row)).toBe(true);
  });

  it('Remove is only offered when it would do something (review S5)', () => {
    const s0 = startFixture().state;
    expect(canRemoveExercise(s0, rowId(s0, BENCH))).toBe(true);
    let done = s0;
    for (const x of setsFor(done, BENCH)) done = apply(done, logCmd(x.id, values(x.planned.load, 8), 100));
    expect(canRemoveExercise(done, rowId(done, BENCH))).toBe(false);
    expectError(reduceSession(done, removeExerciseCommand(done, rowId(done, BENCH), op('r')).command), 'set_not_pending');
  });

  it('a confirmation for logged sets that were unticked since is stale', () => {
    let s0 = startFixture().state;
    const [w] = setsFor(s0, BENCH);
    s0 = apply(s0, logCmd(w?.id ?? '', values(kg(60), 10), 60, 'log-w'));
    const { command } = removeExerciseCommand(s0, rowId(s0, BENCH), op('remove-1'));
    const unticked = apply(s0, { type: 'undo_log', at: at(70), opId: 'untick', setId: w?.id ?? '', expectedSetVersion: s0.sets.find((x) => x.id === w?.id)?.version ?? 1 });
    expectError(reduceSession(unticked, { ...command, expectedVersion: unticked.session.version }), 'stale_version');
  });
});

describe('rounds: move, superset with next, unlink mid-round', () => {
  it('only rounds not started move, and never past a started one', () => {
    const s0 = benchStarted();
    const rounds = sessionRounds(s0);
    expect(rounds.map((r) => r.started)).toEqual([true, false, false]);
    expect(roundMoveTargets(rounds, 0)).toEqual([]);
    expect(roundMoveTargets(rounds, 2)).toEqual([1]);
    expect(moveRoundCommand(s0, rowId(s0, BENCH), 1, op('m1'))).toEqual({ ok: false, reason: 'started' });
    expect(moveRoundCommand(s0, rowId(s0, HANG), 0, op('m1'))).toEqual({ ok: false, reason: 'crosses_started' });
    expect(roundSteps(s0, rowId(s0, HANG))).toEqual({ up: true, down: false });
    const m = stepRoundCommand(s0, rowId(s0, HANG), 'up', op('m1'));
    if (!m.ok) throw new Error(m.reason);
    const s1 = apply(s0, m.command);
    expect(sessionRounds(s1).map((r) => r.members.map((x) => x.exerciseName).join('+'))).toEqual(['Bench press', 'Dead hang', 'Cable row+Face pull']);
    expect(s1.sets).toEqual(s0.sets);
    const back = apply(reload(s1), undo('m1'));
    expect(sessionRounds(back).map((r) => r.key)).toEqual(rounds.map((r) => r.key));
  });

  it('Workout sheet drag: an edge moves the round (never a started one, never past one), the middle makes a superset', () => {
    const s0 = startFixture().state;
    const hang = rowId(s0, HANG);
    const bench = rowId(s0, BENCH);
    const row = rowId(s0, ROW);
    expect(roundDraggable(s0, hang)).toBe(true);
    const first = dropRoundCommand(s0, hang, bench, 'before', op('d1'));
    expect(first?.type).toBe('move_exercise');
    const s1 = apply(s0, first as SessionCommand);
    expect(sessionRounds(s1).map((r) => r.members[0]?.exerciseName)).toEqual(['Dead hang', 'Bench press', 'Cable row']);
    // Back down: after the superset.
    const down = dropRoundCommand(s1, hang, row, 'after', op('d2'));
    const s2 = apply(s1, down as SessionCommand);
    expect(sessionRounds(s2).map((r) => r.members[0]?.exerciseName)).toEqual(['Bench press', 'Cable row', 'Dead hang']);
    // A drop where it already is: nothing to send.
    expect(dropRoundCommand(s0, hang, row, 'after', op('d3'))).toBeNull();
    // Onto: a superset with that round.
    const onto = dropRoundCommand(s0, hang, bench, 'onto', op('d4'));
    expect(onto?.type).toBe('link_superset');
    // Bench started: it can't be dragged, and nothing goes above it.
    const started = benchStarted();
    expect(roundDraggable(started, rowId(started, BENCH))).toBe(false);
    expect(canDropRound(started, rowId(started, HANG), rowId(started, BENCH), 'before')).toBe(false);
    expect(canDropRound(started, rowId(started, HANG), rowId(started, ROW), 'before')).toBe(true);
    expect(canDropRound(started, rowId(started, BENCH), rowId(started, HANG), 'after')).toBe(false);
  });

  it('Superset with next pairs with the next round’s first exercise; advice says why it isn’t recommended, the change stays', () => {
    const s0 = startFixture().state;
    const cmd = supersetNextCommand(s0, rowId(s0, BENCH), op('pair-1'));
    if (cmd === null) throw new Error('no pair');
    const s1 = apply(s0, cmd);
    expect(sessionRounds(s1)[0]?.members.length).toBeGreaterThan(1);
    const info = (exerciseId: string): BuilderExerciseInfo | null => {
      const base = { exerciseId, group: 'Chest' as const, role: 'compound' as const, part: 'Chest', angle: '', barbell: false };
      if (exerciseId === BENCH) return { ...base, name: 'Bench press', heavy: true, muscles: ['chest'] };
      if (exerciseId === ROW) return { ...base, name: 'Cable row', group: 'Back' as const, part: 'Back', heavy: true, muscles: ['lats'] };
      if (exerciseId === FACE) return { ...base, name: 'Face pull', group: 'Back' as const, part: 'Back', role: 'isolation' as const, heavy: false, muscles: ['rear delts'] };
      return null;
    };
    const advice = adviseSessionChange(s0, s1, info);
    expect(advice?.kind).toBe('heavy_pair');
    // Advice never blocks: the superset is in place.
    expect(s1.exercises.find((e) => e.exerciseId === BENCH)?.supersetGroup).not.toBeNull();
    expect(supersetNextCommand(s0, rowId(s0, HANG), op('pair-2'))).toBeNull();
  });

  it('Unlink mid-round: the half-done round finishes first (the partner stays current), then the rest go one by one; logged sets untouched', () => {
    let s = startFixture().state;
    for (const x of setsFor(s, BENCH)) s = apply(s, logCmd(x.id, values(x.planned.load, 8), 100));
    const [r1, r2] = setsFor(s, ROW);
    s = apply(s, logCmd(r1?.id ?? '', values(kg(50, 'stack'), 10), 200));
    const [f1, f2] = setsFor(s, FACE).map((x) => x.id);
    expect(s.session.activeSetId).toBe(f1);
    const split = apply(s, { type: 'split_superset', at: at(210), opId: 'split-1', expectedVersion: s.session.version, sessionExerciseId: rowId(s, ROW) });
    expect(split.session.activeSetId).toBe(f1);
    expect(split.sets).toEqual(s.sets);
    // The member behind (Face pull) comes first, so nothing is left behind until the end.
    expect(sessionRounds(split).map((r) => r.members.map((m) => m.exerciseName).join('+'))).toEqual(['Bench press', 'Face pull', 'Cable row', 'Dead hang']);
    // The partner's set finishes the half-done round; then Face 2, then Row 2, then Dead hang.
    const afterF1 = apply(split, logCmd(f1 ?? '', values(kg(20, 'stack'), 12), 260));
    expect(afterF1.session.activeSetId).toBe(f2);
    const afterF2 = apply(afterF1, logCmd(f2 ?? '', values(kg(20, 'stack'), 12), 320));
    expect(afterF2.session.activeSetId).toBe(r2?.id);
    const afterR2 = apply(afterF2, logCmd(r2?.id ?? '', values(kg(50, 'stack'), 10), 380));
    expect(afterR2.sets.find((x) => x.id === afterR2.session.activeSetId)?.sessionExerciseId).toBe(rowId(s, HANG));
    // Undo (after a reload) puts the superset back in its old order.
    const back = apply(reload(split), undo('split-1'));
    expect(sessionRounds(back).map((r) => r.members.map((m) => m.exerciseName).join('+'))).toEqual(['Bench press', 'Cable row+Face pull', 'Dead hang']);
    expect(buildExecutionOrder(back.exercises, back.sets)).toEqual(buildExecutionOrder(s.exercises, s.sets));
    // Every logged value is exactly as logged.
    for (const x of afterF2.sets.filter((y) => y.status === 'completed' && s.sets.some((z) => z.id === y.id && z.status === 'completed'))) {
      expect(x).toEqual(s.sets.find((y) => y.id === x.id));
    }
  });

  it('Superset with next is not offered when both sides are already supersets, or when the next exercise is done (review S5)', () => {
    const s0 = startFixture().state;
    expect(supersetNextCommand(s0, rowId(s0, BENCH), op('p1'))).not.toBeNull();
    // Hang up one, then Bench + Hang: two supersets side by side.
    const up = stepRoundCommand(s0, rowId(s0, HANG), 'up', op('m-h'));
    if (!up.ok) throw new Error(up.reason);
    const hangFirst = apply(s0, up.command);
    const linked = apply(hangFirst, supersetNextCommand(hangFirst, rowId(hangFirst, BENCH), op('p2')) as SessionCommand);
    expect(sessionRounds(linked).map((r) => r.members.length)).toEqual([2, 2]);
    expect(supersetNextCommand(linked, rowId(linked, HANG), op('p3'))).toBeNull();
    expect(supersetNextCommand(linked, rowId(linked, BENCH), op('p3'))).toBeNull();
    // Next exercise done: nothing to pair.
    let done = s0;
    for (const x of setsFor(done, HANG)) done = apply(done, logCmd(x.id, values(null, null, { durationS: 45 }), 500));
    expect(supersetNextCommand(done, rowId(done, FACE), op('p4'))).toBeNull();
  });

  it('a drop onto another exercise never moves a round past a started one, nor onto a done round (integrity S1, parity S5)', () => {
    let s = startFixture().state;
    // Ben swiped ahead and logged Row 1: the Row+Face round is started.
    s = apply(s, logCmd(setsFor(s, ROW)[0]?.id ?? '', values(kg(50, 'stack'), 10), 100));
    const bench = rowId(s, BENCH);
    const hang = rowId(s, HANG);
    expect(sessionRounds(s).map((r) => r.started)).toEqual([false, true, false]);
    // Hang onto Bench would move Hang above the started superset: refused, and not a drop target.
    expect(pairWithCommand(s, hang, bench, op('o1'))).toBeNull();
    expect(canDropRound(s, hang, bench, 'onto')).toBe(false);
    expect(dropRoundCommand(s, hang, bench, 'onto', op('o1'))).toBeNull();
    // Bench onto Hang: Bench (behind on a tie, the earlier row leads) — Hang would move up past the started round too.
    expect(canDropRound(s, bench, hang, 'onto')).toBe(false);
    // Neighbours still pair.
    const fresh = startFixture().state;
    expect(canDropRound(fresh, rowId(fresh, HANG), rowId(fresh, BENCH), 'onto')).toBe(true);
    // A done round is never a target.
    let done = fresh;
    for (const x of setsFor(done, BENCH)) done = apply(done, logCmd(x.id, values(x.planned.load, 8), 100));
    expect(canDropRound(done, rowId(done, HANG), rowId(done, BENCH), 'onto')).toBe(false);
    expect(canDropRound(done, rowId(done, BENCH), rowId(done, HANG), 'onto')).toBe(false);
  });
});

describe('a logged set’s Type (pop-up Type picker on a done set)', () => {
  it('changes the label and counting only: the logged numbers are byte-identical, audited, and Undo puts the type back (rule 2)', () => {
    const s0 = benchStarted();
    const done = setsFor(s0, BENCH).find((x) => x.status === 'completed' && x.setType === 'working');
    if (done === undefined) throw new Error('no logged set');
    const cmd: SessionCommand = { type: 'correct_set', at: at(500), opId: 'type-1', setId: done.id, expectedSetVersion: done.version, patch: { setType: 'top' } };
    const s1 = apply(s0, cmd);
    const after = s1.sets.find((x) => x.id === done.id);
    expect(after?.setType).toBe('top');
    expect(JSON.stringify(after?.actual)).toBe(JSON.stringify(done.actual));
    expect(after?.completedAt).toEqual(done.completedAt);
    expect(s1.audit.some((e) => e.opId === 'type-1' && e.setId === done.id && e.kind === 'corrected')).toBe(true);
    // A stale correction is refused; a repeat is a no-op.
    expectError(reduceSession(s1, { ...cmd, opId: 'type-2' }), 'stale_version');
    expect(expectOk(reduceSession(s1, cmd)).duplicate).toBe(true);
    const back = apply(reload(s1), undo('type-1'));
    const restored = back.sets.find((x) => x.id === done.id);
    expect(restored?.setType).toBe('working');
    expect(JSON.stringify(restored?.actual)).toBe(JSON.stringify(done.actual));
  });
});

describe('builder loads for an added or swapped exercise', () => {
  it('plannedFromBuilderRows keeps the item’s unit and convention, exact reps and the row’s target RPE', () => {
    const plan = plannedFromBuilderRows(
      [
        { type: 'warmup', reps: 8, load: 15, rpe: null },
        { type: 'working', reps: 8, load: 25, rpe: 8 },
        { type: 'working', reps: 8, load: null, rpe: 9 },
      ],
      { unit: 'lb', convention: 'per_hand' },
    );
    expect(plan.map((p) => p.planned.load)).toEqual([lb(15, 'per_hand'), lb(25, 'per_hand'), null]);
    expect(plan.map((p) => p.planned.rpe)).toEqual([null, 8, 9]);
    expect(plan[1]?.planned.reps).toEqual({ min: 8, max: 8 });
  });
});

describe('loads typed or planned on the gym’s kit (rule 4)', () => {
  it('fitPlanToItem keeps what the item makes, rounds toward easier, never past the max, and blanks what only fits harder', () => {
    const plan: { planned: PlannedSet }[] = [
      { planned: { load: kg(50, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
      { planned: { load: kg(52, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
      { planned: { load: kg(80, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
      { planned: { load: kg(2, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
    ];
    const fitted = fitPlanToItem(plan, startFixture().input.gymEquipment[1] ?? null);
    expect(fitted.map((p) => p.planned.load?.value ?? null)).toEqual([50, 50, 50, null]);
    // Assisted: easier is more assistance; past the most assistance there is it can't go.
    const machine = assisted();
    const assistedPlan: { planned: PlannedSet }[] = [{ planned: { load: kg(22, 'assistance'), reps: null, durationS: null, rpe: null, rir: null } }, { planned: { load: kg(60, 'assistance'), reps: null, durationS: null, rpe: null, rir: null } }];
    const a = fitPlanToItem(assistedPlan, machine);
    expect(a.map((p) => p.planned.load?.value ?? null)).toEqual([25, null]);
  });

  it('a kg typed in the pop-up rounds down on the bar, never up past what was typed', () => {
    const s0 = startFixture().state;
    const [, b1] = setsFor(s0, BENCH);
    expect(snapTypedLoadEasier(s0, b1?.id ?? '', 101)).toBe(100);
    // Past the bar's max (every plate on): the max, never more.
    expect(snapTypedLoadEasier(s0, b1?.id ?? '', 1000)).toBe(187.5);
    expect(snapTypedLoadEasier(s0, b1?.id ?? '', 10)).toBeUndefined();
  });
});
