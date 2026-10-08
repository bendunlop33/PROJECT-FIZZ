import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import { reduceSession, startWorkout, summariseVolume } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, idGen, kg, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, expectError, logCmd } from './session-fixture';

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
    const [s1, s2, s3] = splitSets(s);
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const sx = s.exercises[0]?.id ?? '';
    s = apply(s, { type: 'add_set', at: at(1), opId: 'add', sessionExerciseId: sx, newSetId: id(61_000), setType: null });
    const log = (setId: string, reps: number, side: 'left' | 'right', t: number) => {
      s = apply(s, logCmd(setId, values(kg(15, 'per_hand'), reps), t, `log-${setId}`, side));
    };
    log(s1.id, 10, 'left', 60);
    log(s2.id, 10, 'right', 90);
    log(s3.id, 8, 'left', 180);
    log(id(61_000), 7, 'right', 210);
    expect(splitSets(s).map((x) => x.side)).toEqual(['left', 'right', 'left', 'right']);
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
