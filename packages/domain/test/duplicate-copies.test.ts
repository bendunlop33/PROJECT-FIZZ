import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';
import { lastComparableSession, nextTargetBlocks, toHistorySessions } from '../src/index';
import { at, barbell, id, kg, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * The same exercise twice in one workout (Ben, 19 Oct: "Even if it's the same exercise with
 * different or no weight"): each copy's sets stand alone. Every copy is history (review B2), but a
 * second copy is its own entry, never merged into the main copy's sets, and only the main copy (the
 * planned slot, never the copy with more sets) plans next time and shows as Last.
 */

const COPY = id(77_001);
const COPY_SET = id(77_002);

function addCopy(s: SessionAggregate, equipmentId: string | null, load: number, sets = 1): SessionAggregate {
  const ids = [COPY_SET, ...Array.from({ length: sets - 1 }, (_, i) => id(77_010 + i))];
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
    plan: ids.map((x) => ({ id: x, setType: 'working' as const, planned: { load: kg(load), reps: { min: 20, max: 20 }, durationS: null, rpe: null, rir: null } })),
    supersetWithSessionExerciseId: s.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '',
  };
  return apply(s, cmd);
}

/** Bench (the planned slot) logged at 100 kg (`benchDone` working sets), then the copy's sets at `load`. */
function finished(equipmentId: string | null, load: number, copySets = 1, benchDone = Number.POSITIVE_INFINITY): SessionAggregate {
  let s = startFixture().state;
  s = addCopy(s, equipmentId, load, copySets);
  const bench = s.exercises.find((e) => e.exerciseId === BENCH && e.id !== COPY)?.id;
  const own = s.sets.filter((x) => x.sessionExerciseId === bench).sort((a, b) => a.index - b.index);
  let t = 100;
  let working = 0;
  for (const x of own) {
    if (x.setType !== 'warmup' && working >= benchDone) continue;
    if (x.setType !== 'warmup') working += 1;
    s = apply(s, logCmd(x.id, values(kg(x.setType === 'warmup' ? 60 : 100), 8), (t += 60)));
  }
  for (const x of s.sets.filter((y) => y.sessionExerciseId === COPY).sort((a, b) => a.index - b.index)) s = apply(s, logCmd(x.id, values(kg(load), 20), (t += 60)));
  return apply(s, { type: 'finish', at: at(t + 60), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
}

describe('two copies of one exercise', () => {
  it('a lighter copy on the same bar is its own history entry, marked copy, never merged into the main one', () => {
    const h = toHistorySessions(finished(barbell().id, 40), BENCH);
    expect(h.map((x) => [x.copy ?? false, x.sets.map((y) => y.load?.value)])).toEqual([
      [false, [60, 100, 100]],
      [true, [40]],
    ]);
  });

  it('review B2: a lighter copy with more sets never hides the heavier sets or plans next time', () => {
    const s = finished(barbell().id, 20, 6, 2);
    const h = toHistorySessions(s, BENCH);
    // Every completed set is still history.
    expect(h.flatMap((x) => x.sets.map((y) => y.load?.value))).toEqual([60, 100, 100, 20, 20, 20, 20, 20, 20]);
    expect(h.find((x) => x.copy !== true)?.sets.map((y) => y.load?.value)).toEqual([60, 100, 100]);
    // Next time and Last read the planned slot (the 100 kg row), not the copy with more sets.
    expect(nextTargetBlocks(s).map((b) => [b.root.id === COPY, b.copy])).toEqual([
      [false, false],
      [true, true],
    ]);
    const bench = s.exercises.find((e) => e.exerciseId === BENCH && e.id !== COPY);
    if (!bench) throw new Error('no bench');
    expect(lastComparableSession(h, bench)?.sets.map((x) => x.values.load?.value)).toEqual([100, 100]);
  });

  it('review B2: a 0 kg copy with more sets on its own item never plans next time either', () => {
    const s = finished(null, 0, 4, 2);
    expect(nextTargetBlocks(s).map((b) => [b.root.id === COPY, b.copy])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(toHistorySessions(s, BENCH).flatMap((x) => x.sets.map((y) => y.load?.value))).toEqual([60, 100, 100, 0, 0, 0, 0]);
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
