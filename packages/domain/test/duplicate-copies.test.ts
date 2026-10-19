import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';
import { nextTargetBlocks, toHistorySessions } from '../src/index';
import { at, barbell, id, kg, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * The same exercise twice in one workout (Ben, 19 Oct: "Even if it's the same exercise with
 * different or no weight"): each copy's sets stand alone. Only the main copy is the exercise's
 * history, so a lighter copy never merges into it or moves its targets.
 */

const COPY = id(77_001);
const COPY_SET = id(77_002);

function addCopy(s: SessionAggregate, equipmentId: string | null, load: number): SessionAggregate {
  const cmd: SessionCommand = {
    type: 'add_exercise',
    at: at(300),
    opId: 'add-copy',
    newSessionExerciseId: COPY,
    newSetId: COPY_SET,
    exercise: { exerciseId: BENCH, name: 'Bench press', measurement: 'reps', laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: ['barbell'] },
    equipmentId,
    unit: 'kg',
    rest: { seconds: 60, source: 'global_default', sourceLabel: 'Default' },
    plan: [{ id: COPY_SET, setType: 'working', planned: { load: kg(load), reps: { min: 20, max: 20 }, durationS: null, rpe: null, rir: null } }],
    supersetWithSessionExerciseId: s.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '',
  };
  return apply(s, cmd);
}

function finished(equipmentId: string | null, load: number): SessionAggregate {
  let s = startFixture().state;
  s = addCopy(s, equipmentId, load);
  const bench = s.exercises.find((e) => e.exerciseId === BENCH && e.id !== COPY)?.id;
  const own = s.sets.filter((x) => x.sessionExerciseId === bench).sort((a, b) => a.index - b.index);
  let t = 100;
  for (const x of own) s = apply(s, logCmd(x.id, values(kg(x.setType === 'warmup' ? 60 : 100), 8), (t += 60)));
  s = apply(s, logCmd(COPY_SET, values(kg(load), 20), (t += 60)));
  return apply(s, { type: 'finish', at: at(t + 60), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
}

describe('two copies of one exercise', () => {
  it('a lighter copy on the same bar is not part of the exercise’s history', () => {
    const h = toHistorySessions(finished(barbell().id, 40), BENCH);
    expect(h).toHaveLength(1);
    expect(h[0]?.sets.map((x) => x.load?.value)).toEqual([60, 100, 100]);
  });

  it('a copy with no equipment (0 kg) stands alone on its own item', () => {
    const h = toHistorySessions(finished(null, 0), BENCH);
    expect(h.map((x) => [x.equipmentId, x.sets.map((y) => y.load?.value)])).toEqual([
      [barbell().id, [60, 100, 100]],
      [null, [0]],
    ]);
  });

  it('next time is planned from the main copy, never the 0 kg one (even on its own item)', () => {
    const s = finished(null, 0);
    expect(nextTargetBlocks(s).map((b) => [b.root.id === COPY, b.copy])).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it('the copy keeps its own sets in the workout', () => {
    const s = finished(barbell().id, 40);
    expect(setsFor(s, BENCH).every((x) => x.sessionExerciseId !== COPY)).toBe(true);
    expect(s.sets.filter((x) => x.sessionExerciseId === COPY).map((x) => x.actual?.load?.value)).toEqual([40]);
  });
});
