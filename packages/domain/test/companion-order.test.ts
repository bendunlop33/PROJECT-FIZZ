import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { buildExecutionOrder, getSetPair, reduceSession, startWorkout } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, idGen, kg, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, expectOk, logCmd } from './session-fixture';

// Review T1: the other side of a single-side log is performed straight after its
// partner (same superset round), and the order then continues normally.

const SPLIT_SQUAT = exercise(240, 'Bulgarian split squat', {
  compatibleEquipment: ['dumbbells'],
  defaultLoadConvention: 'per_hand',
  laterality: 'unilateral',
});
const ONE_ARM_ROW = exercise(241, 'One-arm cable row', {
  compatibleEquipment: ['weight_stack'],
  defaultLoadConvention: 'stack',
  laterality: 'unilateral',
});
const FACE_PULL = exercise(242, 'Face pull', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const BENCH = exercise(243, 'Bench press');

function startPlain(): SessionAggregate {
  const rack = dumbbells();
  const r = routine([
    routineExercise(800, {
      exerciseId: SPLIT_SQUAT.id,
      equipmentId: rack.id,
      order: 0,
      setTemplates: [8001, 8002, 8003].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })),
    }),
    routineExercise(801, { exerciseId: BENCH.id, equipmentId: barbell().id, order: 1, setTemplates: [template(8011, { targetLoad: kg(60) })] }),
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
    newId: idGen(61_000),
  }).aggregate;
}

function startSuperset(): SessionAggregate {
  const r = routine([
    routineExercise(810, {
      exerciseId: ONE_ARM_ROW.id,
      equipmentId: stack().id,
      order: 0,
      supersetGroup: 'A',
      transitionRestS: 15,
      setTemplates: [8101, 8102].map((n) => template(n, { targetLoad: kg(20, 'stack'), targetReps: { min: 10, max: 12 } })),
      restBySetType: { working: { seconds: 90, presetName: 'Moderate' } },
    }),
    routineExercise(811, {
      exerciseId: FACE_PULL.id,
      equipmentId: stack().id,
      order: 1,
      supersetGroup: 'A',
      setTemplates: [8111, 8112].map((n) => template(n, { targetLoad: kg(20, 'stack'), targetReps: { min: 12, max: 15 } })),
      restBySetType: { working: { seconds: 90, presetName: 'Moderate' } },
    }),
    routineExercise(812, { exerciseId: BENCH.id, equipmentId: barbell().id, order: 2, setTemplates: [template(8121, { targetLoad: kg(60) })] }),
  ]);
  return startWorkout({
    opId: 's',
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises: new Map([
      [ONE_ARM_ROW.id, ONE_ARM_ROW],
      [FACE_PULL.id, FACE_PULL],
      [BENCH.id, BENCH],
    ]),
    gymEquipment: [stack(), barbell()],
    at: at(0),
    newId: idGen(62_000),
  }).aggregate;
}

/** Human-readable label of a set: exercise name, planned position, side. */
function label(s: SessionAggregate, setId: string | null): string {
  if (setId === null) return 'none';
  const set = s.sets.find((x) => x.id === setId);
  const ex = s.exercises.find((e) => e.id === set?.sessionExerciseId);
  const planned = s.sets
    .filter((x) => x.sessionExerciseId === ex?.id && x.pairedWithSetId === null)
    .sort((a, b) => a.index - b.index)
    .findIndex((x) => x.id === (set?.pairedWithSetId ?? set?.id));
  const side = set?.side === null || set?.side === 'both' ? '' : ` ${set?.side ?? ''}`;
  return `${ex?.exerciseName ?? '?'} ${planned + 1}${side}`;
}

const each15 = (reps: number) => values(kg(15, 'per_hand'), reps);
const stack20 = (reps: number) => values(kg(20, 'stack'), reps);

describe('other-side row order (review T1)', () => {
  it('plain: Left → Right → set 2; Left, Right, Left across three sets, then the next exercise', () => {
    let s = startPlain();
    const seen: string[] = [label(s, s.session.activeSetId)];
    let t = 60;
    for (let i = 0; i < 3; i += 1) {
      s = apply(s, logCmd(s.session.activeSetId ?? '', each15(10), (t += 60), `l${i}`, 'left'));
      seen.push(label(s, s.session.activeSetId));
      s = apply(s, logCmd(s.session.activeSetId ?? '', each15(10), (t += 60), `r${i}`));
      seen.push(label(s, s.session.activeSetId));
    }
    expect(seen).toEqual([
      'Bulgarian split squat 1',
      'Bulgarian split squat 1 right',
      'Bulgarian split squat 2',
      'Bulgarian split squat 2 right',
      'Bulgarian split squat 3',
      'Bulgarian split squat 3 right',
      'Bench press 1',
    ]);
  });

  it('plain: the execution order puts each other side straight after its partner', () => {
    let s = startPlain();
    const [p1, p2] = s.sets.filter((x) => x.side !== null).sort((a, b) => a.index - b.index);
    s = apply(s, logCmd(p2?.id ?? '', each15(10), 60, 'l2', 'left'));
    s = apply(s, logCmd(p1?.id ?? '', each15(10), 120, 'r1', 'right'));
    expect(buildExecutionOrder(s.exercises, s.sets).map((x) => label(s, x))).toEqual([
      'Bulgarian split squat 1 right',
      'Bulgarian split squat 1 left',
      'Bulgarian split squat 2 left',
      'Bulgarian split squat 2 right',
      'Bulgarian split squat 3',
      'Bench press 1',
    ]);
  });

  it('plain: deleting the pending other side continues with set 2, not the next exercise', () => {
    let s = startPlain();
    s = apply(s, logCmd(s.session.activeSetId ?? '', each15(10), 60, 'l1', 'left'));
    const other = s.session.activeSetId ?? '';
    expect(label(s, other)).toBe('Bulgarian split squat 1 right');
    s = apply(s, { type: 'delete_set', at: at(70), opId: 'd', setId: other, expectedSetVersion: 1 });
    expect(label(s, s.session.activeSetId)).toBe('Bulgarian split squat 2');
  });

  it('superset: A1 Left → A1 Right (transition) → B1 (transition) → A2, exact sequence and rest kinds', () => {
    let s = startSuperset();
    const seen: string[] = [label(s, s.session.activeSetId)];
    const rests: string[] = [];
    const step = (cmd: Parameters<typeof logCmd>) => {
      const r = expectOk(reduceSession(s, logCmd(...cmd)));
      s = r.state;
      seen.push(label(s, s.session.activeSetId));
      rests.push(`${s.restTimer?.kind ?? 'none'} ${s.restTimer?.durationS ?? 0}`);
    };
    step([s.session.activeSetId ?? '', stack20(10), 60, 'a1l', 'left']);
    step([s.session.activeSetId ?? '', stack20(10), 90, 'a1r']);
    step([s.session.activeSetId ?? '', stack20(12), 120, 'b1']);
    step([s.session.activeSetId ?? '', stack20(10), 240, 'a2l', 'left']);
    step([s.session.activeSetId ?? '', stack20(10), 270, 'a2r']);
    step([s.session.activeSetId ?? '', stack20(12), 300, 'b2']);
    expect(seen).toEqual([
      'One-arm cable row 1',
      'One-arm cable row 1 right',
      'Face pull 1',
      'One-arm cable row 2',
      'One-arm cable row 2 right',
      'Face pull 2',
      'Bench press 1',
    ]);
    // Inside a round every rest is the transition; the full rest only follows the round's last member.
    expect(rests).toEqual(['transition 15', 'transition 15', 'rest 90', 'transition 15', 'transition 15', 'rest 90']);
  });

  it('superset: deleting the pending other side goes to the partner exercise in the same round', () => {
    let s = startSuperset();
    s = apply(s, logCmd(s.session.activeSetId ?? '', stack20(10), 60, 'a1l', 'left'));
    const other = s.session.activeSetId ?? '';
    s = apply(s, { type: 'delete_set', at: at(70), opId: 'd', setId: other, expectedSetVersion: 1 });
    expect(label(s, s.session.activeSetId)).toBe('Face pull 1');
  });
});

describe('other side after its partner is deleted (review follow-up 2)', () => {
  it('a logged other side is no longer presented as a pair once its partner is deleted, and keeps its position', () => {
    let s = startPlain();
    const p1 = s.session.activeSetId ?? '';
    s = apply(s, logCmd(p1, each15(10), 60, 'l1', 'left'));
    const other = s.session.activeSetId ?? '';
    expect(getSetPair(s, p1)).toEqual({ partnerSetId: other, role: 'first_side' });
    expect(getSetPair(s, other)).toEqual({ partnerSetId: p1, role: 'other_side' });
    s = apply(s, logCmd(other, each15(10), 90, 'r1'));
    s = apply(s, { type: 'delete_set', at: at(100), opId: 'd', setId: p1, expectedSetVersion: 2 });

    const orphan = s.sets.find((x) => x.id === other);
    expect(orphan).toMatchObject({ status: 'completed', side: 'right', version: 2 });
    // The provenance link is kept in the data (completed sets are never silently changed);
    // the view no longer pairs it with a deleted set.
    expect(orphan?.pairedWithSetId).toBe(p1);
    expect(getSetPair(s, other)).toBeNull();
    expect(getSetPair(s, p1)).toBeNull();
    // It stays at its partner's old position: before set 2, and set 2 is next.
    expect(buildExecutionOrder(s.exercises, s.sets).slice(0, 2).map((x) => label(s, x))).toEqual([
      'Bulgarian split squat 1 right',
      'Bulgarian split squat 2',
    ]);
    expect(label(s, s.session.activeSetId)).toBe('Bulgarian split squat 2');
  });

  it('sets with no pair, and pending other sides of an undone log, report no pair', () => {
    let s = startPlain();
    const p1 = s.session.activeSetId ?? '';
    expect(getSetPair(s, p1)).toBeNull();
    s = apply(s, logCmd(p1, each15(10), 60, 'l1', 'left'));
    s = apply(s, { type: 'undo_log', at: at(65), opId: 'u', setId: p1, expectedSetVersion: 2 });
    expect(getSetPair(s, p1)).toBeNull();
    expect(getSetPair(s, 'missing')).toBeNull();
  });
});
