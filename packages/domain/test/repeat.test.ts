import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';

import { NBSP, repeatPreviewLines, startWorkoutFromSession } from '../src/index';
import { at, barbell, GYM, idGen, kg, profile, stack, values } from './fixtures';
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
    expect(out.notes.map((n) => [n.exerciseName, n.text])).toEqual([
      ['Cable row', 'No Cable stack here. Kept as done, loads not checked.'],
      ['Bench press', 'Rounded down from 102.5 kg: this gym stops at 100 kg.'],
    ]);
  });

  it('a workout with nothing logged has nothing to repeat', () => {
    let s = startFixture().state;
    s = apply(s, { type: 'finish', at: at(60), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    expect(startWorkoutFromSession({ opId: 'r', owner: profile(), gymId: GYM, source: s, exercises, gymEquipment: [], at: at(100), newId: idGen(42_000) }).empty).toBe(true);
  });
});
