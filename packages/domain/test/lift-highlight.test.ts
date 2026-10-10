import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate, SetValues } from '@fizz/schemas';

import { buildAddExerciseCommand, buildLiftHighlight, NBSP, sparklinePoints, startWorkout } from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, idGen, kg, lb, profile, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

/** Today's lift highlight (D-Today): last top set, change and sparkline, from logged sets only. */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const BENCH = exercise(700, 'Bench press');
const CURL = exercise(701, 'Dumbbell curl', { defaultLoadConvention: 'per_hand', compatibleEquipment: ['dumbbells'] });
const PULLUP = exercise(702, 'Assisted pull-up', { defaultLoadConvention: 'assistance', compatibleEquipment: ['assisted_stack'] });

/** A finished workout at `startS` with each exercise logged as given. */
function finished(startS: number, items: { ex: Exercise; eq: EquipmentInstance; sets: SetValues[] }[], unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(100_000 + startS);
  let s = startWorkout({ opId: `s-${String(startS)}`, owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: items.map((i) => i.eq), at: at(startS), newId: ids }).aggregate;
  items.forEach((item, k) => {
    s = apply(s, buildAddExerciseCommand({ opId: `a-${String(startS)}-${String(k)}`, owner, exercise: item.ex, equipmentId: item.eq.id, at: at(startS + 1), newId: ids }));
    const sx = s.exercises[k]?.id ?? '';
    const existing = s.sets.filter((x) => x.sessionExerciseId === sx).length;
    for (let i = existing; i < item.sets.length; i += 1) s = apply(s, { type: 'add_set', at: at(startS + 1), opId: `as-${String(startS)}-${String(k)}-${String(i)}`, sessionExerciseId: sx, newSetId: ids(), setType: null });
  });
  let t = startS + 10;
  items.forEach((item, k) => {
    const sx = s.exercises[k]?.id ?? '';
    const pending = s.sets.filter((x) => x.sessionExerciseId === sx && x.status !== 'completed').sort((a, b) => a.index - b.index);
    item.sets.forEach((v, i) => {
      const set = pending[i];
      if (!set) throw new Error('missing set');
      t += 120;
      s = apply(s, logCmd(set.id, v, t, `l-${set.id}`));
    });
  });
  return apply(s, { type: 'finish', at: at(t + 60), opId: `f-${String(startS)}`, expectedVersion: s.session.version, endedAt: null });
}

describe('buildLiftHighlight', () => {
  const bar = barbell();

  it('nothing logged: no highlight', () => {
    expect(buildLiftHighlight([])).toBeNull();
  });

  it('one workout: the top set (heaviest, then most reps), no change line, one point', () => {
    const w = finished(0, [{ ex: BENCH, eq: bar, sets: [values(kg(95), 8), values(kg(100), 6), values(kg(100), 8)] }]);
    const h = buildLiftHighlight([w]);
    expect(h).not.toBeNull();
    expect(h?.exerciseName).toBe('Bench press');
    expect(plain(h?.text)).toBe('100 kg × 8');
    expect(h?.change).toBeNull();
    expect(h?.points).toEqual([100]);
  });

  it('up from the last top load; points oldest first, at most 7', () => {
    const ws = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => finished(i * 10_000, [{ ex: BENCH, eq: bar, sets: [values(kg(80 + i * 2.5), 8)] }]));
    const h = buildLiftHighlight([...ws].reverse());
    expect(plain(h?.text)).toBe('100 kg × 8');
    expect(h?.change).toBe('up from 97.5');
    expect(h?.points).toEqual([85, 87.5, 90, 92.5, 95, 97.5, 100]);
  });

  it('down, more reps, fewer reps, same', () => {
    const a = finished(0, [{ ex: BENCH, eq: bar, sets: [values(kg(100), 6)] }]);
    expect(buildLiftHighlight([a, finished(10_000, [{ ex: BENCH, eq: bar, sets: [values(kg(97.5), 6)] }])])?.change).toBe('down from 100');
    expect(buildLiftHighlight([a, finished(10_000, [{ ex: BENCH, eq: bar, sets: [values(kg(100), 8)] }])])?.change).toBe('+2 reps');
    expect(buildLiftHighlight([a, finished(10_000, [{ ex: BENCH, eq: bar, sets: [values(kg(100), 5)] }])])?.change).toBe('−1 rep');
    expect(buildLiftHighlight([a, finished(10_000, [{ ex: BENCH, eq: bar, sets: [values(kg(100), 6)] }])])?.change).toBe('same as last time');
  });

  it('lb stays lb; per-hand dumbbells say each', () => {
    const w = finished(0, [{ ex: BENCH, eq: barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 8 }, { mass: 25, count: 4 }, { mass: 10, count: 4 }, { mass: 5, count: 4 }, { mass: 2.5, count: 4 }] }), sets: [values(lb(225), 5)] }], 'lb');
    expect(plain(buildLiftHighlight([w])?.text)).toBe('225 lb × 5');
    const d = finished(0, [{ ex: CURL, eq: dumbbells(), sets: [values(kg(14, 'per_hand'), 10)] }]);
    expect(plain(buildLiftHighlight([d])?.text)).toBe('14 kg each × 10');
  });

  it('passes over assisted movements (up would mean easier) and picks the next weighted one', () => {
    const w = finished(0, [
      { ex: PULLUP, eq: assisted(), sets: [values(kg(30, 'assistance'), 8)] },
      { ex: BENCH, eq: bar, sets: [values(kg(60), 10)] },
    ]);
    expect(buildLiftHighlight([w])?.exerciseName).toBe('Bench press');
    const only = finished(0, [{ ex: PULLUP, eq: assisted(), sets: [values(kg(30, 'assistance'), 8)] }]);
    expect(buildLiftHighlight([only])).toBeNull();
  });

  it('a different set-up (equipment) is not part of the series', () => {
    const other = barbell({ id: '00000000-0000-4000-8000-000000009999', name: 'Other bar' });
    const a = finished(0, [{ ex: BENCH, eq: other, sets: [values(kg(120), 3)] }]);
    const b = finished(10_000, [{ ex: BENCH, eq: bar, sets: [values(kg(100), 5)] }]);
    const h = buildLiftHighlight([a, b]);
    expect(h?.points).toEqual([100]);
    expect(h?.change).toBeNull();
  });

  it('ignores active workouts', () => {
    const owner = profile();
    const s = startWorkout({ opId: 'act', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [bar], at: at(0), newId: idGen(300_000) }).aggregate;
    expect(buildLiftHighlight([s])).toBeNull();
  });
});

describe('sparklinePoints', () => {
  it('spreads points across the width, lowest at the bottom, flat in the middle', () => {
    expect(sparklinePoints([], 100, 40)).toEqual([]);
    expect(sparklinePoints([5], 100, 40)).toEqual([{ x: 100, y: 20 }]);
    expect(sparklinePoints([1, 1], 100, 40)).toEqual([
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ]);
    const p = sparklinePoints([0, 5, 10], 100, 40, 4);
    expect(p).toEqual([
      { x: 0, y: 36 },
      { x: 50, y: 20 },
      { x: 100, y: 4 },
    ]);
  });
});
