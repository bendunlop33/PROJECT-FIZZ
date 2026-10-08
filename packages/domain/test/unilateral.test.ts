import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import { reduceSession, startWorkout, summariseVolume } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, idGen, kg, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, expectError, expectOk, logCmd } from './session-fixture';

const SPLIT_SQUAT = exercise(230, 'Bulgarian split squat', {
  compatibleEquipment: ['dumbbells'],
  defaultLoadConvention: 'per_hand',
  laterality: 'unilateral',
});
const BENCH = exercise(231, 'Bench press');

function start(): SessionAggregate {
  const rack = dumbbells();
  const r = routine([
    routineExercise(700, {
      exerciseId: SPLIT_SQUAT.id,
      equipmentId: rack.id,
      order: 0,
      setTemplates: [7001, 7002, 7003].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })),
    }),
    routineExercise(701, { exerciseId: BENCH.id, equipmentId: barbell().id, order: 1, setTemplates: [template(7011, { targetLoad: kg(60) })] }),
  ]);
  return startWorkout({
    opId: 's',
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises: new Map([
      [SPLIT_SQUAT.id, SPLIT_SQUAT],
      [BENCH.id, BENCH],
    ]),
    gymEquipment: [rack, barbell()],
    at: at(0),
    newId: idGen(60_000),
  }).aggregate;
}

const splitSets = (s: SessionAggregate) => s.sets.filter((x) => x.sessionExerciseId === s.exercises[0]?.id).sort((a, b) => a.index - b.index);

describe('unilateral exercises (review M5)', () => {
  it('snapshots laterality; unilateral sets default to "both sides", bilateral sets have no side', () => {
    const s = start();
    expect(s.exercises.map((e) => e.laterality)).toEqual(['unilateral', 'bilateral']);
    expect(splitSets(s).map((x) => x.side)).toEqual(['both', 'both', 'both']);
    expect(s.sets.find((x) => x.sessionExerciseId === s.exercises[1]?.id)?.side).toBeNull();
  });

  it('"10 each side" sets count once, with per-side reps not doubled', () => {
    let s = start();
    splitSets(s).forEach((set, i) => {
      s = apply(s, logCmd(set.id, values(kg(15, 'per_hand'), 10), 60 * (i + 1)));
    });
    const [split, bench] = summariseVolume(s);
    expect(split).toMatchObject({ sets: 3, reps: 30, bySide: { left: { sets: 3, reps: 30 }, right: { sets: 3, reps: 30 } } });
    expect(bench).toMatchObject({ sets: 0, reps: 0, bySide: null });
  });

  it('separate left and right sets are recorded per side and a pair counts as one set', () => {
    let s = start();
    const [s1, s2] = splitSets(s);
    if (!s1 || !s2) throw new Error('fixture');
    const sx = s.exercises[0]?.id ?? '';
    const log = (setId: string, reps: number, side: 'left' | 'right' | undefined, t: number) => {
      s = apply(s, logCmd(setId, values(kg(15, 'per_hand'), reps), t, `log-${setId}`, side));
    };
    // Left on a planned row adds the right side as the next set; logging it keeps its side.
    log(s1.id, 10, 'left', 60);
    const r1 = s.session.activeSetId ?? '';
    log(r1, 10, undefined, 90);
    log(s2.id, 8, 'left', 180);
    const r2 = s.session.activeSetId ?? '';
    log(r2, 7, 'right', 210);
    const done = splitSets(s).filter((x) => x.status === 'completed');
    expect(done.map((x) => x.side)).toEqual(['left', 'left', 'right', 'right']);
    expect(done.map((x) => x.pairedWithSetId)).toEqual([null, null, s1.id, s2.id]);
    expect(summariseVolume(s)[0]).toEqual({
      sessionExerciseId: sx,
      sets: 2,
      reps: 18,
      bySide: { left: { sets: 2, reps: 18 }, right: { sets: 2, reps: 17 } },
    });
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it('a side is rejected on bilateral exercises; a side correction is audited', () => {
    let s = start();
    const benchSet = s.sets.find((x) => x.sessionExerciseId === s.exercises[1]?.id);
    const cmd = logCmd(benchSet?.id ?? '', values(kg(60), 8), 30, 'log-bench', 'left');
    expectError(reduceSession(s, cmd), 'invalid_values');

    const first = splitSets(s)[0];
    if (!first) throw new Error('fixture');
    s = apply(s, logCmd(first.id, values(kg(15, 'per_hand'), 10), 30));
    s = apply(s, { type: 'correct_set', at: at(40), opId: 'c', setId: first.id, expectedSetVersion: 2, patch: { side: 'left' } });
    expect(s.audit.at(-1)).toMatchObject({ kind: 'corrected', before: { side: 'both' }, after: { side: 'left' } });
    expect(summariseVolume(s)[0]).toMatchObject({ sets: 1, reps: 10, bySide: { right: { sets: 0, reps: 0 } } });
  });
});

describe('other-side rows (review R4, ADR 0003)', () => {
  const each15 = (reps: number) => values(kg(15, 'per_hand'), reps);
  const live = (s: SessionAggregate) => splitSets(s).filter((x) => x.status !== 'deleted');

  it("reviewer's probe: Left, Right, Left on the three planned rows does not finish the exercise", () => {
    let s = start();
    const [p1, p2, p3] = splitSets(s);
    if (!p1 || !p2 || !p3) throw new Error('fixture');
    s = apply(s, logCmd(p1.id, each15(10), 60, 'l1', 'left'));
    s = apply(s, logCmd(p2.id, each15(10), 120, 'r2', 'right'));
    s = apply(s, logCmd(p3.id, each15(10), 180, 'l3', 'left'));
    // Each single-side log left a pending row for its other side.
    const pending = live(s).filter((x) => x.status === 'pending');
    expect(pending.map((x) => [x.side, x.pairedWithSetId])).toEqual([
      ['right', p1.id],
      ['left', p2.id],
      ['right', p3.id],
    ]);
    // Split squat isn't done: the next active set is the other side of set 3, not the bench.
    expect(s.session.activeSetId).toBe(pending[2]?.id);
    for (const x of pending) s = apply(s, logCmd(x.id, each15(10), 300 + x.index, `other-${x.id}`));
    expect(summariseVolume(s)[0]?.bySide).toEqual({ left: { sets: 3, reps: 30 }, right: { sets: 3, reps: 30 } });
    expect(summariseVolume(s)[0]?.sets).toBe(3);
  });

  it('the other side becomes the next set, with the same values drafted and no effort', () => {
    let s = start();
    const p1 = splitSets(s)[0];
    if (!p1) throw new Error('fixture');
    const r = expectOk(reduceSession(s, logCmd(p1.id, { ...each15(9), rpe: 8 }, 60, 'l1', 'left')));
    s = r.state;
    const other = live(s).find((x) => x.pairedWithSetId === p1.id);
    expect(other).toMatchObject({ status: 'pending', side: 'right', setType: 'working', index: 3, draft: { reps: 9, rpe: null } });
    expect(s.session.activeSetId).toBe(other?.id);
    expect(r.events).toContainEqual({ type: 'SetAdded', setId: other?.id, sessionExerciseId: s.exercises[0]?.id });
    // "Both sides" logs add nothing.
    const p2 = splitSets(s)[1];
    const n = s.sets.length;
    s = apply(s, logCmd(p2?.id ?? '', each15(9), 90, 'b2'));
    expect(s.sets).toHaveLength(n);
  });

  it('a retried single-side log is a duplicate and adds no second row; the derived ID is stable', () => {
    const s0 = start();
    const p1 = splitSets(s0)[0];
    if (!p1) throw new Error('fixture');
    const cmd = logCmd(p1.id, each15(10), 60, 'l1', 'left');
    const s1 = apply(s0, cmd);
    const again = expectOk(reduceSession(s1, { ...cmd, at: at(65) }));
    expect(again.duplicate).toBe(true);
    expect(again.state.sets).toHaveLength(s1.sets.length);
    // Same command on the same state (e.g. after a crash before the save landed) derives the same ID.
    expect(apply(s0, cmd).sets.map((x) => x.id)).toEqual(s1.sets.map((x) => x.id));
  });

  it('the other-side row only takes its own side', () => {
    let s = start();
    const p1 = splitSets(s)[0];
    s = apply(s, logCmd(p1?.id ?? '', each15(10), 60, 'l1', 'left'));
    const other = s.session.activeSetId ?? '';
    expectError(reduceSession(s, logCmd(other, each15(10), 90, 'x', 'left')), 'invalid_values');
    expectError(reduceSession(s, logCmd(other, each15(10), 90, 'y', 'both')), 'invalid_values');
    expect(apply(s, logCmd(other, each15(10), 90, 'z', 'right')).sets.find((x) => x.id === other)?.status).toBe('completed');
  });

  it('undoing a single-side log removes its pending other side and restores "both sides"', () => {
    let s = start();
    const p1 = splitSets(s)[0];
    if (!p1) throw new Error('fixture');
    s = apply(s, logCmd(p1.id, each15(10), 60, 'l1', 'left'));
    const other = s.session.activeSetId ?? '';
    const r = expectOk(reduceSession(s, { type: 'undo_log', at: at(65), opId: 'u', setId: p1.id, expectedSetVersion: 2 }));
    expect(r.state.sets.find((x) => x.id === p1.id)).toMatchObject({ status: 'pending', side: 'both' });
    expect(r.state.sets.find((x) => x.id === other)).toMatchObject({ status: 'deleted' });
    expect(r.state.audit.at(-1)).toMatchObject({ kind: 'deleted', setId: other, opId: 'u' });
    expect(r.events).toContainEqual({ type: 'SetDeleted', setId: other });
    expect(r.state.session.activeSetId).toBe(p1.id);
  });

  it('deleting a left-logged set also removes its pending other side; deleting only the other side is allowed', () => {
    let s = start();
    const [p1, p2] = splitSets(s);
    if (!p1 || !p2) throw new Error('fixture');
    s = apply(s, logCmd(p1.id, each15(10), 60, 'l1', 'left'));
    const other1 = s.session.activeSetId ?? '';
    const afterDelete = apply(s, { type: 'delete_set', at: at(70), opId: 'd', setId: p1.id, expectedSetVersion: 2 });
    expect(afterDelete.sets.find((x) => x.id === other1)?.status).toBe('deleted');

    s = apply(s, logCmd(other1, each15(10), 90, 'r1'));
    s = apply(s, logCmd(p2.id, each15(10), 120, 'l2', 'left'));
    const other2 = s.session.activeSetId ?? '';
    s = apply(s, { type: 'delete_set', at: at(130), opId: 'd2', setId: other2, expectedSetVersion: 1 });
    expect(s.sets.find((x) => x.id === p2.id)?.status).toBe('completed');
  });
});
