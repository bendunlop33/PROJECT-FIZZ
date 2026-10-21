import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type Exercise, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import {
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
  supersetMidRound,
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

  it('per-hand dumbbells in lb round down on the rack; assisted machines have no ramp; at most 4', () => {
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
    expect(setsFor(s, CURL).filter((x) => x.setType === 'warmup').length).toBeLessThanOrEqual(4);
    expect(canAddWarmupNow(s, curl)).toBe(false);
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

  it('a superset’s After each round is the last member’s rest', () => {
    const s0 = startFixture().state;
    const cmd = typeRestCommand(s0, rowId(s0, ROW), 'round', 75, op('rest-r'));
    expect(cmd?.scope).toBe('exercise');
    const s1 = apply(s0, cmd as SessionCommand);
    expect(setsFor(s1, FACE).every((x) => x.rest.seconds === 75)).toBe(true);
    expect(setsFor(s1, ROW)).toEqual(setsFor(s0, ROW));
  });
});

describe('remove_exercise with logged sets (asks first, keeps them in history)', () => {
  it('without the confirmation it is refused; with it the rest goes, the logged sets and the row stay; Undo brings the rest back', () => {
    const s0 = benchStarted();
    const bench = rowId(s0, BENCH);
    const { command, loggedSets } = removeExerciseCommand(s0, bench, op('remove-1'));
    expect(loggedSets).toBe(2);
    expectError(reduceSession(s0, { ...command, confirmedLoggedSets: undefined, opId: 'remove-0' } as SessionCommand), 'exercise_logged');
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

  it('Unlink mid-round: the half-done round finishes first (the partner stays current); logged sets untouched', () => {
    let s = startFixture().state;
    for (const x of setsFor(s, BENCH)) s = apply(s, logCmd(x.id, values(x.planned.load, 8), 100));
    const [r1] = setsFor(s, ROW);
    s = apply(s, logCmd(r1?.id ?? '', values(kg(50, 'stack'), 10), 200));
    expect(supersetMidRound(s, rowId(s, ROW))).toBe(true);
    const f1 = setsFor(s, FACE)[0]?.id;
    expect(s.session.activeSetId).toBe(f1);
    const split = apply(s, { type: 'split_superset', at: at(210), opId: 'split-1', expectedVersion: s.session.version, sessionExerciseId: rowId(s, ROW) });
    expect(split.session.activeSetId).toBe(f1);
    expect(split.sets).toEqual(s.sets);
    expect(supersetMidRound(split, rowId(split, ROW))).toBe(false);
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
    const plan = [
      { planned: { load: kg(50, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
      { planned: { load: kg(52, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
      { planned: { load: kg(80, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
      { planned: { load: kg(2, 'stack'), reps: null, durationS: null, rpe: null, rir: null } },
    ];
    const fitted = fitPlanToItem(plan, startFixture().input.gymEquipment[1] ?? null);
    expect(fitted.map((p) => p.planned.load?.value ?? null)).toEqual([50, 50, 50, null]);
    // Assisted: easier is more assistance; past the most assistance there is it can't go.
    const machine = assisted();
    const a = fitPlanToItem([{ planned: { load: kg(22, 'assistance'), reps: null, durationS: null, rpe: null, rir: null } }, { planned: { load: kg(60, 'assistance'), reps: null, durationS: null, rpe: null, rir: null } }], machine);
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
