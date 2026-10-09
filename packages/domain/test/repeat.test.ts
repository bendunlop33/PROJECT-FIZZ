import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';

import { NBSP, repeatPreviewLines, startWorkoutFromSession } from '../src/index';
import { reduceSession, startWorkout } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, BENCH, exercises, logCmd, ROW, setsFor, startFixture } from './session-fixture';

const plain = (s: string) => s.replaceAll(NBSP, ' ');

/** Push A finished: bench W 60×10, 102.5×8, 100×7; row 50×12 once (second skipped); face pull skipped; hang not done. */
function finishedPushA(): SessionAggregate {
  let s = startFixture().state;
  const bench = setsFor(s, BENCH);
  s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 10));
  s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(102.5), 8, { rpe: 9 }), 200));
  s = apply(s, logCmd(bench[2]?.id ?? '', values(kg(100), 7), 400));
  const row = setsFor(s, ROW);
  s = apply(s, logCmd(row[0]?.id ?? '', values(kg(50, 'stack'), 12), 600));
  s = apply(s, { type: 'skip_exercise', at: at(700), opId: 'skip-row', sessionExerciseId: s.exercises.find((e) => e.exerciseId === ROW)?.id ?? '' });
  for (const ex of s.exercises.filter((e) => e.exerciseId !== BENCH && e.exerciseId !== ROW)) {
    s = apply(s, { type: 'skip_exercise', at: at(710), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
  }
  return apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
}

describe('Repeat last workout (routines.md RT4, check 13)', () => {
  const source = finishedPushA();

  it('copies each done set’s actual as a pending target; nothing is done; skipped sets are listed', () => {
    const out = startWorkoutFromSession({ opId: 'rep-1', owner: profile(), gymId: GYM, source, exercises, gymEquipment: [barbell(), stack()], at: at(86_400), newId: idGen(40_000) });
    const s = out.aggregate;
    expect(s.session).toMatchObject({ status: 'active', routineId: null, startOperationId: 'rep-1' });
    expect(s.sets.every((x) => x.status === 'pending' && x.actual === null && x.completedAt === null)).toBe(true);
    const bench = setsFor(s, BENCH);
    expect(bench.map((x) => [x.setType, x.planned.load?.value, x.planned.reps, x.planned.source])).toEqual([
      ['warmup', 60, { min: 10, max: 10 }, 'repeat'],
      ['working', 102.5, { min: 8, max: 8 }, 'repeat'],
      ['working', 100, { min: 7, max: 7 }, 'repeat'],
    ]);
    // Effort isn't copied as a target; progression isn't applied.
    expect(bench.every((x) => x.planned.rpe === null)).toBe(true);
    expect(setsFor(s, ROW).map((x) => x.planned.load?.value)).toEqual([50]);
    expect(out.notCopied).toEqual([
      { exerciseName: 'Cable row', skipped: 1 },
      { exerciseName: 'Face pull', skipped: 2 },
      { exerciseName: 'Dead hang', skipped: 1 },
    ]);
    expect(s.exercises.map((e) => e.exerciseName)).toEqual(['Bench press', 'Cable row']);
    expect(repeatPreviewLines(s).map((l) => [l.exerciseName, plain(l.line)])).toEqual([
      ['Bench press', '3 sets · W 60 kg × 10 · 102.5 kg × 8 · 100 kg × 7'],
      ['Cable row', '1 set · 50 kg stack × 12'],
    ]);
    expect(out.notes).toEqual([]);
  });

  it('at another gym: loads are rounded toward easier and never above its max; missing equipment is said plainly', () => {
    const lighter = barbell({ id: '00000000-0000-4000-8000-0000000009b1', plates: [{ mass: 20, count: 4 }] });
    const out = startWorkoutFromSession({ opId: 'rep-2', owner: profile(), gymId: GYM, source, exercises, gymEquipment: [lighter], at: at(86_400), newId: idGen(41_000) });
    const bench = setsFor(out.aggregate, BENCH);
    // This bar makes 20, 60 and 100 kg: 102.5 rounds down to 100 (max), 100 stays.
    expect(bench.map((x) => x.planned.load?.value)).toEqual([60, 100, 100]);
    // The stack isn't here: reps kept, no load planned (review B1).
    expect(setsFor(out.aggregate, ROW).map((x) => [x.planned.load, x.planned.reps])).toEqual([[null, { min: 12, max: 12 }]]);
    expect(out.notes.map((n) => [n.exerciseName, n.text])).toEqual([
      ['Cable row', 'No Cable stack here: no load target (last time 50 kg stack × 12).'],
      ['Bench press', 'Rounded down from 102.5 kg: this gym stops at 100 kg.'],
    ]);
  });

  it('hotel gym with only dumbbells: no barbell or stack load is planned, reps kept, never "Kept as done" (review B1)', () => {
    const hotel = [dumbbells({ loads: [5, 10, 15, 20, 25, 30] })];
    const out = startWorkoutFromSession({ opId: 'rep-h', owner: profile(), gymId: GYM, source, exercises, gymEquipment: hotel, at: at(86_400), newId: idGen(43_000) });
    const bench = setsFor(out.aggregate, BENCH);
    expect(bench.map((x) => x.planned.load)).toEqual([null, null, null]);
    expect(bench.map((x) => x.planned.reps)).toEqual([
      { min: 10, max: 10 },
      { min: 8, max: 8 },
      { min: 7, max: 7 },
    ]);
    expect(out.aggregate.exercises.every((e) => e.equipmentId === null)).toBe(true);
    expect(setsFor(out.aggregate, ROW).every((x) => x.planned.load === null)).toBe(true);
    expect(out.notes.map((n) => [n.exerciseName, n.text])).toEqual([
      ['Bench press', 'No Olympic bar here: no load target (last time 102.5 kg × 8).'],
      ['Cable row', 'No Cable stack here: no load target (last time 50 kg stack × 12).'],
    ]);
    expect(out.notes.some((n) => n.text.includes('Kept as done'))).toBe(false);
    expect(out.aggregate.sets.every((x) => x.status === 'pending')).toBe(true);
  });

  it('a workout with nothing logged has nothing to repeat', () => {
    let s = startFixture().state;
    s = apply(s, { type: 'finish', at: at(60), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    expect(startWorkoutFromSession({ opId: 'r', owner: profile(), gymId: GYM, source: s, exercises, gymEquipment: [], at: at(100), newId: idGen(42_000) }).empty).toBe(true);
  });
});

/** kg↔lb in Repeat (PM decision on spec issue 5): converted only to an achievable load on today's equipment. */
describe('Repeat across units', () => {
  const DB_PRESS = id(210);
  const CURL = id(211);
  const dbExercises = new Map([
    [DB_PRESS, exercise(210, 'DB press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
    [CURL, exercise(211, 'Weighted curl', { compatibleEquipment: [], defaultLoadConvention: 'total' })],
  ]);
  const kgRack = dumbbells();
  function finishedDb(): SessionAggregate {
    const r = routine([
      routineExercise(600, { exerciseId: DB_PRESS, equipmentId: kgRack.id, setTemplates: [template(6001, { targetLoad: kg(22.5, 'per_hand') })] }),
      routineExercise(601, { exerciseId: CURL, order: 1, setTemplates: [template(6011, { targetLoad: kg(10) })] }),
    ]);
    let s = startWorkout({ opId: 's', owner: profile(), gymId: GYM, routine: r, exercises: dbExercises, gymEquipment: [kgRack], at: at(0), newId: idGen(60_000) }).aggregate;
    s = apply(s, logCmd(setsFor(s, DB_PRESS)[0]?.id ?? '', values(kg(22.5, 'per_hand'), 8), 10));
    s = apply(s, logCmd(setsFor(s, CURL)[0]?.id ?? '', values(kg(10), 12), 100));
    return apply(s, { type: 'finish', at: at(300), opId: 'fin-db', expectedVersion: s.session.version, endedAt: null });
  }
  const source = finishedDb();

  it('a kg dumbbell target at an lb rack becomes the rack’s load, rounded toward easier, with a note', () => {
    const lbRack = dumbbells({ id: id(120), name: 'Hotel rack', unit: 'lb', loads: [10, 20, 30, 40, 45, 50] });
    const out = startWorkoutFromSession({ opId: 'r-lb', owner: profile(), gymId: GYM, source, exercises: dbExercises, gymEquipment: [lbRack], at: at(86_400), newId: idGen(61_000) });
    // 22.5 kg ≈ 49.6 lb: rounds down to 45 lb, never up to 50.
    expect(setsFor(out.aggregate, DB_PRESS)[0]?.planned.load).toEqual(lb(45, 'per_hand'));
    expect(out.notes.map((n) => n.text)).toContain('Rounded from 22.5 kg each to 45 lb each to match this gym.');
  });

  it('when the easiest converted load is harder than last time (below the rack’s lightest), the load is dropped with a note', () => {
    const heavyRack = dumbbells({ id: id(121), name: 'Heavy rack', unit: 'lb', loads: [60, 70, 80] });
    const out = startWorkoutFromSession({ opId: 'r-hv', owner: profile(), gymId: GYM, source, exercises: dbExercises, gymEquipment: [heavyRack], at: at(86_400), newId: idGen(62_000) });
    const set = setsFor(out.aggregate, DB_PRESS)[0];
    expect(set?.planned.load).toBeNull();
    expect(set?.planned.reps).toEqual({ min: 8, max: 8 });
    expect(out.notes).toContainEqual({ exerciseName: 'DB press', text: 'No load target: last time was 22.5 kg each, and the easiest here is 60 lb each.' });
  });

  it('with no equipment to check on, a load in the other unit is dropped (never converted), reps kept', () => {
    const out = startWorkoutFromSession({ opId: 'r-nu', owner: profile({ preferredUnit: 'lb' }), gymId: GYM, source, exercises: dbExercises, gymEquipment: [], at: at(86_400), newId: idGen(63_000) });
    const curl = setsFor(out.aggregate, CURL)[0];
    expect(curl?.planned.load).toBeNull();
    expect(curl?.planned.reps).toEqual({ min: 12, max: 12 });
    expect(out.notes).toContainEqual({ exerciseName: 'Weighted curl', text: "No load target: last time was 10 kg, and there's no equipment here to check a lb load on." });
    // The session is in lb: Ben enters a load in lb and it logs.
    const set = curl?.id ?? '';
    const r = reduceSession(out.aggregate, logCmd(set, values(lb(25), 12), 86_500));
    expect(r.ok ? null : r.error).toBeNull();
  });

  it('same unit, no equipment either side: the load is kept as before', () => {
    const out = startWorkoutFromSession({ opId: 'r-su', owner: profile(), gymId: GYM, source, exercises: dbExercises, gymEquipment: [], at: at(86_400), newId: idGen(64_000) });
    expect(setsFor(out.aggregate, CURL)[0]?.planned.load).toEqual(kg(10));
  });
});
