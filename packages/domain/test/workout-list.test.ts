import { describe, expect, it } from 'vitest';
import type { LoadConvention, WeightUnit } from '@fizz/schemas';
import { coachRowLoads, compactEachText, compactExerciseName, compactLoadSpoken, compactLoadText, NBSP, slotRepsText, workoutListRows, workoutListTargetHeader, type BuilderExerciseInfo, type BuilderSlot, type BuilderWorkout } from '../src/index';

const sp = (s: string) => s.replaceAll(NBSP, ' ');

function slot(key: string, exerciseId: string, o: { loads: (number | null)[]; reps?: number; repsMax?: number; convention?: LoadConvention; unit?: WeightUnit; main?: boolean; warmups?: number; durationS?: number }): BuilderSlot {
  const rows = [
    ...Array.from({ length: o.warmups ?? 0 }, () => ({ type: 'warmup' as const, reps: 5, load: 40, rpe: null })),
    ...o.loads.map((load) => ({ type: 'working' as const, reps: o.reps ?? 6, ...(o.repsMax !== undefined ? { repsMax: o.repsMax } : {}), load, rpe: 8, ...(o.durationS !== undefined ? { durationS: o.durationS } : {}) })),
  ];
  return { key, exerciseId, main: o.main ?? false, repRange: { min: o.reps ?? 6, max: o.repsMax ?? o.reps ?? 6 }, rows, unit: o.unit ?? 'kg', convention: o.convention ?? 'total', source: 'rule', startLight: null, anchorE1rm: null };
}

const NAMES: Record<string, string> = { bench: 'Barbell bench press', db_sp: 'Dumbbell shoulder press', inc_db: 'Incline dumbbell press', lat: 'Cable lateral raise', push: 'Triceps pushdown', plank: 'Plank', dip: 'Assisted dip', kb: 'Kettlebell swing' };
const info = (id: string): BuilderExerciseInfo | null => (NAMES[id] === undefined ? null : ({ exerciseId: id, name: NAMES[id], group: 'Chest', role: 'compound', heavy: false, angle: '', muscles: [], barbell: false, part: 'chest' }));

const W: BuilderWorkout = {
  restLevel: 'normal',
  blocks: [
    { auto: false, slots: [slot('a', 'bench', { loads: [82.5, 82.5, 82.5, 82.5], reps: 6, repsMax: 8, main: true, warmups: 3 })] },
    { auto: false, slots: [slot('b', 'db_sp', { loads: [24, 24, 24], reps: 8, repsMax: 10, convention: 'per_hand' })] },
    { auto: false, slots: [slot('c', 'inc_db', { loads: [22, 22, 22], reps: 8, repsMax: 10, convention: 'per_hand' })] },
    { auto: true, slots: [slot('d', 'lat', { loads: [7.5, 7.5, 7.5], reps: 12, repsMax: 15, convention: 'stack' }), slot('e', 'push', { loads: [30, 30, 30], reps: 10, repsMax: 12, convention: 'stack' })] },
  ],
};

describe('compactExerciseName (redesign B2)', () => {
  it('shortens Dumbbell to DB as a whole word, any case', () => {
    expect(compactExerciseName('Dumbbell shoulder press')).toBe('DB shoulder press');
    expect(compactExerciseName('Incline dumbbell press')).toBe('Incline DB press');
    expect(compactExerciseName('Single-arm Dumbbell row')).toBe('Single-arm DB row');
    expect(compactExerciseName('Dumbbells walk')).toBe('DBs walk');
  });
  it('never shortens Barbell, Kettlebell or a word that only contains it', () => {
    expect(compactExerciseName('Barbell bench press')).toBe('Barbell bench press');
    expect(compactExerciseName('Kettlebell swing')).toBe('Kettlebell swing');
    expect(compactExerciseName('Superdumbbellish')).toBe('Superdumbbellish');
  });
});

describe('compactEachText (redesign B1, plan day lines)', () => {
  it('each after a number or unit reads ea; other words stay', () => {
    expect(compactEachText('3 × 8–10 · 22.5 kg each')).toBe('3 × 8–10 · 22.5 kg ea');
    expect(compactEachText(`24${NBSP}each`)).toBe(`24${NBSP}ea`);
    expect(compactEachText('Top 30 kg each · 25 kg each')).toBe('Top 30 kg ea · 25 kg ea');
    expect(compactEachText('Do each side')).toBe('Do each side');
  });
});

describe('compactLoadText (redesign B1)', () => {
  it('per-dumbbell reads ea; VoiceOver says each', () => {
    expect(sp(compactLoadText(24, 'kg', 'per_hand', 'kg'))).toBe('24 ea');
    expect(compactLoadSpoken(24, 'kg', 'per_hand')).toBe('24 kilograms each');
  });
  it('another unit inline, kg/lb', () => {
    expect(sp(compactLoadText(50, 'lb', 'per_hand', 'kg'))).toBe('50 lb ea');
    expect(compactLoadSpoken(50, 'lb', 'per_hand')).toBe('50 pounds each');
    expect(sp(compactLoadText(100, 'lb', 'total', 'lb'))).toBe('100');
  });
  it('assisted, added, bodyweight and unknown', () => {
    expect(sp(compactLoadText(25, 'kg', 'assistance', 'kg'))).toBe('assist 25');
    expect(compactLoadSpoken(25, 'kg', 'assistance')).toBe('assistance 25 kilograms');
    expect(compactLoadText(10, 'kg', 'added', 'kg')).toBe('+10');
    expect(compactLoadText(0, 'kg', 'added', 'kg')).toBe('BW');
    expect(compactLoadText(null, 'kg', 'bodyweight', 'kg')).toBe('BW');
    expect(compactLoadText(null, 'kg', 'total', 'kg')).toBe('—');
    expect(compactLoadSpoken(null, 'kg', 'total')).toBe('no load yet');
  });
  it('header says ea only when every loaded row is per hand', () => {
    expect(workoutListTargetHeader('kg', ['per_hand', 'per_hand', 'bodyweight'])).toBe('Target kg ea');
    expect(workoutListTargetHeader('kg', ['per_hand', 'total'])).toBe('Target kg');
    expect(workoutListTargetHeader('lb', [])).toBe('Target lb');
  });
});

describe('workoutListRows (redesign A5, B)', () => {
  const rows = workoutListRows(W, info, 'kg');
  it('reads Exercise · Sets · Target as the prototype', () => {
    expect(rows.map((r) => [r.name, sp(r.sets), sp(r.target)])).toEqual([
      ['Barbell bench press', '4 × 6–8', '82.5'],
      ['DB shoulder press', '3 × 8–10', '24 ea'],
      ['Incline DB press', '3 × 8–10', '22 ea'],
      ['Cable lateral raise', '3 × 12–15', '7.5'],
      ['Triceps pushdown', '3 × 10–12', '30'],
    ]);
  });
  it('warm-ups are not counted; supersets share a block; main lift flagged', () => {
    expect(rows[0]?.main).toBe(true);
    expect(rows[3]?.superset).toBe(3);
    expect(rows[4]?.superset).toBe(3);
    expect(rows[1]?.superset).toBeNull();
  });
  it('VoiceOver keeps the full name and says each', () => {
    expect(rows[1]?.fullName).toBe('Dumbbell shoulder press');
    expect(rows[1]?.accessibilityLabel).toBe('Dumbbell shoulder press, 3 sets of 8 to 10 reps, target 24 kilograms each');
    expect(rows[0]?.accessibilityLabel).toContain('main lift');
  });
  it('builder rows carry the bottom of the range: the slot’s range shows; rows outside it show as they are', () => {
    const s = { ...slot('r', 'lat', { loads: [7.5, 7.5], reps: 12, convention: 'stack' }), repRange: { min: 12, max: 15 } };
    expect(slotRepsText(s)).toBe('12–15');
    const odd = { ...s, rows: s.rows.map((r) => ({ ...r, reps: 20 })) };
    expect(slotRepsText(odd)).toBe('20');
  });
  it('timed sets read their time', () => {
    const s = slot('p', 'plank', { loads: [null, null], convention: 'bodyweight', durationS: 45 });
    expect(slotRepsText(s)).toBe('0:45');
    const r = workoutListRows({ restLevel: 'normal', blocks: [{ auto: false, slots: [s] }] }, info, 'kg')[0];
    expect(sp(r?.sets ?? '')).toBe('2 × 0:45');
    expect(r?.target).toBe('BW');
  });
  it('assisted top set is the least assistance', () => {
    const s = slot('x', 'dip', { loads: [30, 25, 20], convention: 'assistance' });
    expect(sp(workoutListRows({ restLevel: 'normal', blocks: [{ auto: false, slots: [s] }] }, info, 'kg')[0]?.target ?? '')).toBe('assist 20');
  });
  it('pain-flagged rows are marked held', () => {
    const held = workoutListRows(W, info, 'kg', { pained: (id) => id === 'bench' });
    expect(held[0]?.held).toBe(true);
    expect(held[0]?.accessibilityLabel).toContain('pain flag, held');
  });
});

describe('coachRowLoads: the ✦ value on the affected row (redesign A5)', () => {
  const lighter = (w: BuilderWorkout, key: string, to: number): BuilderWorkout => ({ ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === key ? { ...s, rows: s.rows.map((r) => (r.type === 'warmup' ? r : { ...r, load: to })) } : s)) })) });
  it('reads the slots whose top load the offer changes', () => {
    const after = lighter(W, 'b', 22);
    const loads = coachRowLoads(W, after);
    expect(loads).toEqual({ b: 22 });
    const rows = workoutListRows(W, info, 'kg', { coach: loads });
    expect(sp(rows[1]?.coach ?? '')).toBe('✦ 22 ea');
    expect(rows[1]?.accessibilityLabel).toContain('coach suggests 22 kilograms each, tap to review');
    expect(rows[2]?.coach).toBeNull();
  });
  it('a set count or swap alone shows no value; nothing changed: none', () => {
    expect(coachRowLoads(W, W)).toEqual({});
    const fewer: BuilderWorkout = { ...W, blocks: W.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === 'c' ? { ...s, rows: s.rows.slice(0, 2) } : s.key === 'd' ? { ...s, exerciseId: 'push' } : s)) })) };
    expect(coachRowLoads(W, fewer)).toEqual({});
  });
  it('assisted: less assistance is the top set', () => {
    const w: BuilderWorkout = { restLevel: 'normal', blocks: [{ auto: false, slots: [slot('x', 'dip', { loads: [30, 30], convention: 'assistance' })] }] };
    expect(coachRowLoads(w, lighter(w, 'x', 35))).toEqual({ x: 35 });
  });
});
