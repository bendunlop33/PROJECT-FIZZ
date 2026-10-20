import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import {
  buildExerciseTabView,
  buildProgressHomeView,
  collectExerciseSeries,
  DEFAULT_TRAILING,
  measuresFor,
  mostReps,
  muscleFrequency,
  sessionTotalWeight,
  muscleLabel,
  normaliseTrailing,
  parseTrailing,
  periodHolding,
  progressWindow,
  trailingAverage,
  workingSetCount,
  workingWeight,
  type ExerciseSeries,
  type MuscleInfo,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
} from '../src/index';
import { kg, lb } from './fixtures';

/**
 * Progress › Exercises tab (Ben, 13–14 Oct 2026, D3) and the D2 muscle
 * sub-rows: working weight, reps, trailing average, the stat line, the
 * sessions table, imported FitNotes history, kg/lb, per-hand dumbbells,
 * assisted machines and marked sets.
 */

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
const TODAY = '2026-10-14';
const WINDOW = { from: '2026-04-15', to: TODAY };

let n = 0;
function set(load: Load | null, reps: number | null, over: Partial<ProgressSet> = {}): ProgressSet {
  n += 1;
  return { setId: `set-${String(n)}`, setType: 'working', side: null, load, reps, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: n, ...over };
}

function row(sets: ProgressSet[], over: Partial<ProgressExercise> = {}): ProgressExercise {
  n += 1;
  return {
    sessionExerciseId: `row-${String(n)}`,
    exerciseId: 'bench',
    exerciseName: 'Bench press',
    equipmentId: 'bar-1',
    equipmentKind: 'barbell',
    equipmentName: 'Barbell',
    gymId: 'gym-1',
    convention: 'total',
    unit: 'kg',
    measurement: 'reps',
    laterality: 'bilateral',
    sets,
    ...over,
  };
}

function session(date: string, rows: ProgressExercise[], over: Partial<ProgressSession> = {}): ProgressSession {
  const startedMs = Date.parse(`${date}T17:00:00.000Z`);
  n += 1;
  return {
    sessionId: `s-${date}-${String(n)}`,
    version: 3,
    source: 'manual',
    name: 'Push A',
    gymId: 'gym-1',
    startedAtUtc: new Date(startedMs).toISOString(),
    startedMs,
    tz: 'Europe/London',
    date,
    dateOnly: false,
    endedAtUtc: new Date(startedMs + 3_600_000).toISOString(),
    durationMs: 3_600_000,
    durationConfirmed: false,
    exercises: rows,
    ...over,
  };
}

const imported = (date: string, rows: ProgressExercise[]) =>
  session(date, rows.map((r) => ({ ...r, equipmentId: null, equipmentKind: null, equipmentName: null, gymId: null })), { source: 'import', name: null, gymId: null, dateOnly: true, durationMs: null, endedAtUtc: null });

const bench = (date: string, sets: [number, number][], over: Partial<ProgressExercise> = {}) => session(date, [row(sets.map(([l, r]) => set(kg(l), r)), over)]);

function only(sessions: ProgressSession[], exerciseId = 'bench'): ExerciseSeries {
  const all = collectExerciseSeries(sessions, exerciseId);
  expect(all).toHaveLength(1);
  return all[0] as ExerciseSeries;
}

describe('working weight (Weight measure)', () => {
  it('is the load with the most working sets, warm-ups left out', () => {
    const s = only([session('2026-10-01', [row([set(kg(60), 5, { setType: 'warmup' }), set(kg(60), 5, { setType: 'warmup' }), set(kg(60), 5, { setType: 'warmup' }), set(kg(100), 5), set(kg(100), 5), set(kg(105), 3)])])]);
    expect(workingWeight(s.sessions[0] as never, s)).toMatchObject({ value: 100, sets: 2 });
  });

  it('a tie goes to the harder load: heavier, or less assistance on an assisted machine', () => {
    const s = only([bench('2026-10-01', [[100, 5], [100, 5], [110, 3], [110, 3]])]);
    expect(workingWeight(s.sessions[0] as never, s)?.value).toBe(110);
    const a = only([session('2026-10-01', [row([set(kg(30, 'assistance'), 8), set(kg(30, 'assistance'), 8), set(kg(20, 'assistance'), 6), set(kg(20, 'assistance'), 6)], { exerciseId: 'pullup', exerciseName: 'Assisted pull-up', convention: 'assistance', equipmentKind: 'assisted_stack' })])], 'pullup');
    expect(workingWeight(a.sessions[0] as never, a)?.value).toBe(20);
  });

  it('marked sets (spotted) are left out; a set in the other unit is converted (20 Oct)', () => {
    const s = only([session('2026-10-01', [row([set(kg(120), 3, { exclusions: ['spotted'] }), set(kg(120), 3, { exclusions: ['spotted'] }), set(kg(100), 5), set(kg(100), 5), set(lb(225), 5)])])]);
    expect(workingWeight(s.sessions[0] as never, s)?.value).toBe(100);
    // 225 lb reads as 102.06 kg in a kg series.
    const one = only([session('2026-10-01', [row([set(lb(225), 5), set(lb(225), 5), set(kg(100), 5)])])], 'bench');
    expect(workingWeight(one.sessions[0] as never, one)?.value).toBe(102.06);
  });

  it('per-hand dumbbells stay per hand', () => {
    const s = only([session('2026-10-01', [row([set(kg(22.5, 'per_hand'), 10), set(kg(22.5, 'per_hand'), 10)], { exerciseId: 'db', convention: 'per_hand', equipmentKind: 'dumbbells' })])], 'db');
    const v = buildExerciseTabView({ sessions: [], exerciseId: 'db', today: TODAY, window: WINDOW });
    expect(v).toBeNull();
    expect(workingWeight(s.sessions[0] as never, s)?.value).toBe(22.5);
  });
});

describe('reps, sets and the trailing average', () => {
  it('Reps is the most reps in one working set', () => {
    const s = only([bench('2026-10-01', [[100, 5], [90, 9], [80, 12]])]);
    expect(mostReps(s.sessions[0] as never, s)?.reps).toBe(12);
  });

  it('a left + right pair counts as one working set', () => {
    const s = only([session('2026-10-01', [row([set(kg(20, 'per_hand'), 10, { side: 'left' }), set(kg(20, 'per_hand'), 10, { side: 'right' }), set(kg(20, 'per_hand'), 10, { side: 'left' }), set(kg(20, 'per_hand'), 10, { side: 'right' })], { laterality: 'unilateral', convention: 'per_hand' })])]);
    expect(workingSetCount(s.sessions[0] as never)).toBe(2);
  });

  it('averages the last N values, fewer at the start', () => {
    expect(trailingAverage([10, 20, 30, 40], 3)).toEqual([10, 15, 20, 30]);
    expect(trailingAverage([], 5)).toEqual([]);
    expect(trailingAverage([7], 5)).toEqual([7]);
  });

  it('Other takes a whole number 2–50; anything else falls back to 5', () => {
    expect(parseTrailing('8')).toBe(8);
    expect(parseTrailing(' 12 ')).toBe(12);
    expect(parseTrailing('1')).toBeNull();
    expect(parseTrailing('2.5')).toBeNull();
    expect(parseTrailing('abc')).toBeNull();
    expect(parseTrailing('51')).toBeNull();
    expect(normaliseTrailing(null)).toBe(DEFAULT_TRAILING);
    expect(normaliseTrailing(0)).toBe(5);
    expect(normaliseTrailing(20)).toBe(20);
  });
});

describe('buildExerciseTabView', () => {
  const history = [
    bench('2026-03-01', [[80, 5]]),
    bench('2026-03-08', [[90, 5]]),
    bench('2026-09-01', [[100, 5], [100, 5], [100, 4]]),
    bench('2026-10-01', [[105, 3], [100, 6], [100, 6]]),
  ];

  it('defaults to Est. 1RM, labelled an estimate; the stat line is Est. 1RM · Best set · Sessions', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.measure).toBe('e1rm');
    expect(v.measures.map((m) => m.label)).toEqual(['Est. 1RM', 'Weight', 'Reps', 'Top set', 'Total weight']);
    expect(v.stats.map((s) => s.label)).toEqual(['Est. 1RM', 'Best set', 'Sessions']);
    expect(sp(v.stats[0]?.value)).toMatch(/^≈\d/);
    expect(sp(v.stats[1]?.value)).toBe('105 kg × 3');
    expect(v.stats[2]?.value).toBe('2');
    expect(v.statsWords).toContain('an estimate');
    expect(v.chart.points).toHaveLength(2);
    expect(sp(v.chart.points[0]?.readout)).toMatch(/^1 Sep · Est\. 1RM ≈/);
    expect(v.chart.words).toContain('an estimate');
  });

  it('the trailing average includes sessions before the period', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight', trailing: 3 });
    expect(v?.chart.points.map((p) => p.value)).toEqual([100, 100]);
    // 90, 100, 100 → 96.67 at 1 Oct; 80, 90, 100 → 90 at 1 Sep.
    expect(v?.chart.points.map((p) => p.average)).toEqual([90, 96.67]);
    expect(v?.trailing).toBe(3);
    expect(sp(v?.chart.points[1]?.readout)).toBe('1 Oct · Weight 100 kg');
  });

  it('Top set and Reps read as their own values', () => {
    const top = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'top_set' });
    expect(top?.chart.points.map((p) => p.value)).toEqual([100, 105]);
    expect(sp(top?.chart.points[1]?.readout)).toBe('1 Oct · Top set 105 kg × 3');
    const reps = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'reps' });
    expect(reps?.chart.points.map((p) => p.value)).toEqual([5, 6]);
    expect(reps?.chart.unit).toBe('reps');
  });

  it('the sessions table is newest first: date, top set, total weight, sets, Est. 1RM', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(v?.table.rows.map((r) => r.cells.date.replace(/\u00a0/g, ' '))).toEqual(['1 Oct', '1 Sep']);
    expect(v?.table.rows[0]?.cells).toMatchObject({ topSet: '105×3', total: '1,515', sets: '3' });
    expect(v?.table.rows[0]?.words).toContain('total weight 1515 kg');
    expect(v?.table.rows[0]?.cells.e1rm).toMatch(/^≈/);
    expect(v?.table.rows[0]?.words).toContain('estimated one-rep max about');
  });

  it('a period with no sessions says so; the series and trailing count stay', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: { from: '2026-05-01', to: '2026-05-31' } });
    expect(v?.empty).toBe('No sessions in this period.');
    expect(v?.chart.points).toEqual([]);
    expect(v?.stats[0]?.value).toBe('—');
  });

  it('imported FitNotes sessions join the one series (Ben, 20 Oct): no series menu, every session on one chart', () => {
    const fn = [imported('2026-06-01', [row([set(kg(95), 5)])]), imported('2026-07-01', [row([set(kg(97.5), 5)])]), imported('2026-08-01', [row([set(kg(100), 5)])])];
    const v = buildExerciseTabView({ sessions: [...history, ...fn], exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight' });
    expect(v?.series).toEqual([]);
    expect(v?.chart.points.map((p) => p.value)).toEqual([95, 97.5, 100, 100, 100]);
    expect(v?.converted).toBeNull();
  });

  it('lb sessions are converted to the display unit and the info tap says so', () => {
    const lbBench = session('2026-10-05', [row([set(lb(225), 5)], { unit: 'lb' })]);
    const v = buildExerciseTabView({ sessions: [...history, lbBench], exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight', unit: 'kg' });
    expect(v?.series).toEqual([]);
    expect(v?.chart.points.map((p) => p.value)).toEqual([100, 100, 102.06]);
    expect(v?.table.unit).toBe('kg');
    expect(v?.converted).toBe('Converted from lb');
    // Shown in lb when Ben's unit is lb: the kg sessions are the converted ones.
    const inLb = buildExerciseTabView({ sessions: [...history, lbBench], exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight', unit: 'lb' });
    expect(inLb?.chart.points.map((p) => p.value)).toEqual([220.46, 220.46, 225]);
    expect(inLb?.table.unit).toBe('lb');
    expect(inLb?.converted).toBe('Converted from kg');
  });

  it('an assisted machine offers Weight, Reps and Top set, no Est. 1RM; Best set is the least assistance', () => {
    const rows = (a: number) => [row([set(kg(a, 'assistance'), 8), set(kg(a, 'assistance'), 8)], { exerciseId: 'pullup', exerciseName: 'Assisted pull-up', convention: 'assistance', equipmentKind: 'assisted_stack' })];
    const v = buildExerciseTabView({ sessions: [session('2026-09-01', rows(30)), session('2026-10-01', rows(25))], exerciseId: 'pullup', today: TODAY, window: WINDOW });
    expect(v?.measures.map((m) => m.key)).toEqual(['weight', 'reps', 'top_set']);
    expect(v?.measure).toBe('weight');
    expect(v?.stats.map((s) => s.label)).toEqual(['Best set', 'Sessions']);
    expect(sp(v?.stats[0]?.value)).toBe('Assist 25 kg × 8');
    expect(v?.table.rows[0]?.cells.e1rm).toBe('—');
  });

  it('a bodyweight exercise offers Reps', () => {
    expect(measuresFor('bodyweight')).toEqual(['reps']);
    expect(measuresFor('timed')).toEqual(['hold']);
  });

  it('an unknown measure falls back to the default', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'hold' });
    expect(v?.measure).toBe('e1rm');
  });
});

describe('review fixes (progress-exercises B1, S1, S2, S3, S4)', () => {
  const raises = (date: string, loads: number[]) => session(date, [row(loads.map((l) => set(kg(l, 'per_hand'), 15)), { exerciseId: 'raise', exerciseName: 'Lateral raise', convention: 'per_hand', equipmentKind: 'dumbbells', equipmentId: 'db-1' })]);

  it('B1: work always over 10 reps opens on Weight, with points, not a blank Est. 1RM chart', () => {
    const v = buildExerciseTabView({ sessions: [raises('2026-09-01', [10, 10, 10]), raises('2026-10-01', [12, 12, 12])], exerciseId: 'raise', today: TODAY, window: WINDOW });
    expect(v?.measures[0]?.key).toBe('e1rm');
    expect(v?.measure).toBe('weight');
    expect(v?.chart.points.map((p) => p.value)).toEqual([10, 12]);
    expect(v?.empty).toBeNull();
  });

  it('B1: a chosen measure with no points, in a period with sessions, says so', () => {
    const v = buildExerciseTabView({ sessions: [raises('2026-09-01', [10, 10]), raises('2026-10-01', [12, 12])], exerciseId: 'raise', today: TODAY, window: WINDOW, measure: 'e1rm' });
    expect(v?.measure).toBe('e1rm');
    expect(v?.chart.points).toEqual([]);
    expect(v?.empty).toBe('No Est. 1RM in this period.');
    expect(v?.table.rows).toHaveLength(2);
  });

  it('B1: the default still prefers Est. 1RM when it has a point', () => {
    const v = buildExerciseTabView({ sessions: [bench('2026-10-01', [[100, 5]])], exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(v?.measure).toBe('e1rm');
  });

  it('S1: the sessions table names the convention: kg each for dumbbells, kg assist on an assisted machine', () => {
    const db = buildExerciseTabView({ sessions: [raises('2026-10-01', [12, 12])], exerciseId: 'raise', today: TODAY, window: WINDOW });
    expect(sp(db?.table.unit)).toBe('kg each');
    expect(sp(db?.table.rows[0]?.words)).toContain('top set 12 kg each by 15');
    // Total weight counts both dumbbells: 12 × 15 × 2 sets × 2.
    expect(sp(db?.table.rows[0]?.words)).toContain('total weight 720 kg');
    expect(db?.table.rows[0]?.cells.total).toBe('720');
    const assisted = [row([set(kg(30, 'assistance'), 8), set(kg(30, 'assistance'), 8)], { exerciseId: 'pullup', exerciseName: 'Assisted pull-up', convention: 'assistance', equipmentKind: 'assisted_stack' })];
    const a = buildExerciseTabView({ sessions: [session('2026-10-01', assisted)], exerciseId: 'pullup', today: TODAY, window: WINDOW });
    expect(sp(a?.table.unit)).toBe('kg assist');
    expect(a?.table.rows[0]?.cells.topSet).toBe('30×8');
    expect(sp(a?.table.rows[0]?.words)).toContain('top set Assist 30 kg by 8');
    expect(a?.table.rows[0]?.words).not.toContain('top set 30 by 8');
    const lbs = buildExerciseTabView({ sessions: [session('2026-10-01', [row([set(lb(225), 5)], { unit: 'lb' })])], exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(lbs?.table.unit).toBe('lb');
  });

  it('S2: a left + right pair counts once for working weight, matching the Sets column', () => {
    const side = (l: number, s: 'left' | 'right') => set(kg(l, 'per_hand'), 10, { side: s });
    const uni = row([side(16, 'left'), side(16, 'right'), side(16, 'left'), side(16, 'right')], { exerciseId: 'db', convention: 'per_hand', equipmentKind: 'dumbbells', laterality: 'unilateral' });
    const bi = row([set(kg(18, 'per_hand'), 10), set(kg(18, 'per_hand'), 10), set(kg(18, 'per_hand'), 10)], { exerciseId: 'db', convention: 'per_hand', equipmentKind: 'dumbbells', equipmentId: uni.equipmentId });
    const s = only([session('2026-10-01', [uni, bi])], 'db');
    expect(workingWeight(s.sessions[0] as never, s)).toMatchObject({ value: 18, sets: 3 });
    expect(workingSetCount(s.sessions[0] as never)).toBe(5);
    // A side with an extra set: the busier side counts.
    const odd = only([session('2026-10-01', [row([side(20, 'left'), side(20, 'right'), side(20, 'left')], { exerciseId: 'db', convention: 'per_hand', equipmentKind: 'dumbbells', laterality: 'unilateral' })])], 'db');
    expect(workingWeight(odd.sessions[0] as never, odd)).toMatchObject({ value: 20, sets: 2 });
  });

  it('S4: every row carries a readout; a session with no value for the measure reads `date · measure —`', () => {
    const v = buildExerciseTabView({ sessions: [raises('2026-10-01', [12])], exerciseId: 'raise', today: TODAY, window: WINDOW, measure: 'e1rm' });
    expect(sp(v?.table.rows[0]?.readout)).toBe('1 Oct · Est. 1RM —');
    const w = buildExerciseTabView({ sessions: [raises('2026-10-01', [12])], exerciseId: 'raise', today: TODAY, window: WINDOW });
    expect(w?.table.rows[0]?.readout).toBe(w?.chart.points[0]?.readout);
  });

  it('S3: opening on a record picks the series holding that workout (its kind, when the exercise has two)', () => {
    const assisted = session('2026-10-05', [row([set(kg(30, 'assistance'), 8)], { convention: 'assistance', equipmentKind: 'assisted_stack', equipmentId: 'assist-1' })]);
    const sessions = [bench('2026-09-01', [[100, 5]]), bench('2026-09-08', [[100, 5]]), assisted];
    const v = buildExerciseTabView({ sessions, exerciseId: 'bench', today: TODAY, window: WINDOW, sessionId: assisted.sessionId });
    expect(v?.series.map((s) => s.label)).toEqual(['Weighted', 'Assisted']);
    expect(v?.table.unit).toBe('kg assist');
    expect(v?.chart.points.map((p) => p.sessionId)).toEqual([assisted.sessionId]);
  });

  it('S3: a record older than the period widens it to the narrowest preset, or a custom period past 1 year', () => {
    expect(periodHolding('2026-10-01', TODAY, '1m')).toEqual({ period: '1m', range: null });
    expect(periodHolding('2026-06-01', TODAY, '1m')).toEqual({ period: '6m', range: null });
    expect(periodHolding('2026-06-01', TODAY, '1y')).toEqual({ period: '1y', range: null });
    expect(periodHolding('2024-02-10', TODAY, '6m')).toEqual({ period: '6m', range: { from: '2024-02-10', to: TODAY } });
  });
});

describe('Total weight (Ben, 20 Oct 2026)', () => {
  const total = (sessions: ProgressSession[], exerciseId = 'bench', impl: 1 | 2 | null = null) => {
    const s = only(sessions, exerciseId);
    return sessionTotalWeight(s.sessions[0] as never, s, impl)?.value ?? null;
  };

  it('barbell: Σ load × reps over working sets; warm-ups out, marked sets in (the work was done)', () => {
    const s = [session('2026-10-01', [row([set(kg(60), 5, { setType: 'warmup' }), set(kg(100), 5), set(kg(100), 5, { exclusions: ['spotted'] }), set(kg(105), 3)])])];
    expect(total(s)).toBe(100 * 5 + 100 * 5 + 105 * 3);
  });

  it('per-hand dumbbells count both dumbbells on a two-handed lift; one on a one-arm or goblet lift', () => {
    const press = (over: Partial<ProgressExercise> = {}, sets = [set(kg(20, 'per_hand'), 10), set(kg(20, 'per_hand'), 10)]) =>
      [session('2026-10-01', [row(sets, { exerciseId: 'db', convention: 'per_hand', equipmentKind: 'dumbbells', ...over })])];
    // Bilateral, no catalogue count: a pair.
    expect(total(press(), 'db')).toBe(20 * 10 * 2 * 2);
    // Catalogue says one dumbbell (goblet squat): never doubled.
    expect(total(press(), 'db', 1)).toBe(20 * 10 * 2);
    // One-arm row, left and right: one dumbbell per side, both sides counted.
    const oneArm = press({ laterality: 'unilateral' }, [set(kg(30, 'per_hand'), 8, { side: 'left' }), set(kg(30, 'per_hand'), 8, { side: 'right' })]);
    expect(total(oneArm, 'db')).toBe(30 * 8 * 2);
    // `10 each side` with two dumbbells (split squat): both dumbbells, both sides.
    const split = press({ laterality: 'unilateral' }, [set(kg(16, 'per_hand'), 10, { side: 'both' })]);
    expect(total(split, 'db', 2)).toBe(16 * 10 * 2 * 2);
  });

  it('bodyweight + added counts the added mass only; assisted and bodyweight have no Total weight', () => {
    const dips = (loads: number[]) => [session('2026-10-01', [row(loads.map((l) => set(kg(l, 'added'), 8)), { exerciseId: 'dip', exerciseName: 'Dip', convention: 'added', equipmentKind: 'bodyweight_station' })])];
    expect(total(dips([10, 10, 0]), 'dip')).toBe(10 * 8 * 2);
    expect(measuresFor('added_bodyweight')).toContain('total');
    expect(measuresFor('assisted')).not.toContain('total');
    expect(measuresFor('bodyweight')).not.toContain('total');
    const assisted = [session('2026-10-01', [row([set(kg(30, 'assistance'), 8)], { exerciseId: 'pullup', convention: 'assistance', equipmentKind: 'assisted_stack' })])];
    expect(total(assisted, 'pullup')).toBeNull();
    const a = buildExerciseTabView({ sessions: assisted, exerciseId: 'pullup', today: TODAY, window: WINDOW, measure: 'total' });
    expect(a?.measures.map((m) => m.key)).not.toContain('total');
    expect(a?.measure).not.toBe('total');
    expect(a?.table.rows[0]?.cells.total).toBe('—');
  });

  it('the measure: `Total weight`, a plain kg or lb axis, readout and table value', () => {
    const v = buildExerciseTabView({ sessions: [bench('2026-09-01', [[100, 5], [100, 5]]), bench('2026-10-01', [[100, 5], [102.5, 5]])], exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'total' });
    expect(v?.measureLabel).toBe('Total weight');
    expect(v?.chart.unit).toBe('kg');
    expect(v?.chart.points.map((p) => p.value)).toEqual([1000, 1012.5]);
    expect(sp(v?.chart.points[1]?.readout)).toBe('1 Oct · Total weight 1,012.5 kg');
    expect(v?.table.rows[0]?.cells.total).toBe('1,012.5');
    expect(v?.stats.map((x) => x.label)).toEqual(['Est. 1RM', 'Best set', 'Sessions']);
    const dbs = buildExerciseTabView({ sessions: [session('2026-10-01', [row([set(kg(20, 'per_hand'), 10)], { exerciseId: 'db', convention: 'per_hand', equipmentKind: 'dumbbells' })])], exerciseId: 'db', today: TODAY, window: WINDOW, measure: 'total' });
    // Never `kg each`: a total counts both dumbbells.
    expect(dbs?.chart.unit).toBe('kg');
    expect(sp(dbs?.chart.points[0]?.readout)).toBe('1 Oct · Total weight 400 kg');
  });

  it('lb sets are converted into the display unit before summing', () => {
    const s = [session('2026-10-01', [row([set(kg(100), 5)]), row([set(lb(225), 5)], { unit: 'lb', equipmentId: 'bar-2', gymId: 'gym-2' })])];
    const v = buildExerciseTabView({ sessions: s, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'total', unit: 'kg' });
    expect(v?.chart.points.map((p) => p.value)).toEqual([100 * 5 + 102.06 * 5]);
    expect(v?.converted).toBe('Converted from lb');
  });
});

describe('one series per exercise (Ben, 20 Oct 2026)', () => {
  it('app sessions at two gyms and imported history are one series: no picker, one chart', () => {
    const sessions = [
      imported('2026-05-01', [row([set(kg(90), 5)])]),
      bench('2026-06-01', [[95, 5]]),
      bench('2026-07-01', [[97.5, 5]], { equipmentId: 'bar-hotel', gymId: 'gym-2', equipmentName: 'Hotel barbell' }),
      bench('2026-08-01', [[100, 5]]),
    ];
    const v = buildExerciseTabView({ sessions, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight' });
    expect(v?.series).toEqual([]);
    expect(v?.seriesId).toBe('bench|load');
    expect(v?.chart.points.map((p) => p.value)).toEqual([90, 95, 97.5, 100]);
    expect(v?.table.rows).toHaveLength(4);
    expect(v?.stats.find((x) => x.label === 'Sessions')?.value).toBe('4');
    expect(v?.converted).toBeNull();
  });

  it('mixed conventions plot as recorded; the table says the plain unit and each top set its own', () => {
    const sessions = [
      bench('2026-09-01', [[100, 5]]),
      session('2026-10-01', [row([set(kg(30, 'per_hand'), 10)], { equipmentId: 'db-1', equipmentKind: 'dumbbells', convention: 'per_hand' })]),
      session('2026-10-05', [row([set(kg(40, 'stack'), 12)], { equipmentId: 'stack-1', equipmentKind: 'weight_stack', convention: 'stack' })]),
    ];
    const v = buildExerciseTabView({ sessions, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'top_set' });
    expect(v?.series).toEqual([]);
    expect(v?.table.unit).toBe('kg');
    expect(v?.chart.unit).toBe('kg');
    expect(v?.chart.points.map((p) => p.value)).toEqual([100, 30, 40]);
    expect(v?.chart.points.map((p) => sp(p.readout))).toEqual(['1 Sep · Top set 100 kg × 5', '1 Oct · Top set 30 kg each × 10', '5 Oct · Top set 40 kg stack × 12']);
    expect(v?.table.rows.map((r) => r.cells.topSet)).toEqual(['40×12 stack', '30×10 each', '100×5']);
    // Weight keeps the set's own text too.
    const w = buildExerciseTabView({ sessions, exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight' });
    expect(sp(w?.chart.points[1]?.readout)).toBe('1 Oct · Weight 30 kg each');
    // One convention: the header carries it and the cells stay short.
    const db = buildExerciseTabView({ sessions: [sessions[1] as ProgressSession], exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(sp(db?.table.unit)).toBe('kg each');
    expect(db?.table.rows[0]?.cells.topSet).toBe('30×10');
  });
});

describe('D2 muscle sub-rows', () => {
  const INFO: ReadonlyMap<string, MuscleInfo> = new Map<string, MuscleInfo>([
    ['row', { name: 'Row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['biceps', 'traps'] }],
    ['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps'] }],
  ]);
  const w = progressWindow(TODAY, 30);
  const s = [session('2026-10-10', [row([set(kg(60), 8), set(kg(60), 8), set(kg(60), 8)], { exerciseId: 'row', exerciseName: 'Row' }), row([set(kg(100), 5)])])];

  it('body parts: a group opens to its muscles, ½ for a helper muscle', () => {
    const fr = muscleFrequency(s, INFO, w, 'body_part');
    const back = fr.rows.find((r) => r.key === 'Back');
    expect(back?.subRows).toEqual([
      { key: 'lats', label: 'Lats', sets: 3, sessions: 1 },
      { key: 'upper_back', label: 'Upper back', sets: 3, sessions: 1 },
      { key: 'traps', label: 'Traps', sets: 1.5, sessions: 1 },
    ]);
    expect(fr.rows.find((r) => r.key === 'Calves')?.subRows).toEqual([]);
    expect(muscleLabel('front_delts')).toBe('Front delts');
  });

  it('Push/Pull/Legs: a group opens to its exercises, adding up to the row', () => {
    const fr = muscleFrequency(s, INFO, w, 'ppl');
    const pull = fr.rows.find((r) => r.key === 'pull');
    expect(pull?.subRows).toEqual([{ key: 'row', label: 'Row', sets: 3, sessions: null }]);
    expect(pull?.subRows.reduce((a, r) => a + r.sets, 0)).toBe(pull?.sets);
  });

  it('the home view carries the sub-rows with their text', () => {
    const v = buildProgressHomeView({ sessions: s, exercises: INFO, gymNames: {}, today: TODAY, period: '1m', grouping: 'body_part', range: null });
    if (v.dataState !== 'normal') throw new Error('expected data');
    const back = v.muscles.rows.find((r) => r.key === 'Back');
    expect(back?.subRows.map((r) => [r.label, r.sessionsText, r.setsText])).toEqual([
      ['Lats', '1', '3'],
      ['Upper back', '1', '3'],
      ['Traps', '1', '1½'],
    ]);
    expect(back?.subRows[2]?.words).toBe('Traps, 1 session, 1 and a half sets');
  });
});
