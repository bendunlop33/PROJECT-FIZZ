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
  muscleLabel,
  normaliseTrailing,
  parseTrailing,
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
    expect(workingWeight(s.sessions[0] as never, s)).toEqual({ value: 100, sets: 2 });
  });

  it('a tie goes to the harder load: heavier, or less assistance on an assisted machine', () => {
    const s = only([bench('2026-10-01', [[100, 5], [100, 5], [110, 3], [110, 3]])]);
    expect(workingWeight(s.sessions[0] as never, s)?.value).toBe(110);
    const a = only([session('2026-10-01', [row([set(kg(30, 'assistance'), 8), set(kg(30, 'assistance'), 8), set(kg(20, 'assistance'), 6), set(kg(20, 'assistance'), 6)], { exerciseId: 'pullup', exerciseName: 'Assisted pull-up', convention: 'assistance', equipmentKind: 'assisted_stack' })])], 'pullup');
    expect(workingWeight(a.sessions[0] as never, a)?.value).toBe(20);
  });

  it('marked sets (spotted) and other units are left out', () => {
    const s = only([session('2026-10-01', [row([set(kg(120), 3, { exclusions: ['spotted'] }), set(kg(120), 3, { exclusions: ['spotted'] }), set(kg(100), 5), set(lb(225), 5)])])]);
    expect(workingWeight(s.sessions[0] as never, s)?.value).toBe(100);
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
    expect(v.measures.map((m) => m.label)).toEqual(['Est. 1RM', 'Weight', 'Reps', 'Top set']);
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

  it('the sessions table is newest first: date, top set, volume, sets, Est. 1RM', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(v?.table.rows.map((r) => r.cells.date.replace(/\u00a0/g, ' '))).toEqual(['1 Oct', '1 Sep']);
    expect(v?.table.rows[0]?.cells).toMatchObject({ topSet: '105×3', volume: '1,515', sets: '3' });
    expect(v?.table.rows[0]?.cells.e1rm).toMatch(/^≈/);
    expect(v?.table.rows[0]?.words).toContain('estimated one-rep max about');
  });

  it('a period with no sessions says so; the series and trailing count stay', () => {
    const v = buildExerciseTabView({ sessions: history, exerciseId: 'bench', today: TODAY, window: { from: '2026-05-01', to: '2026-05-31' } });
    expect(v?.empty).toBe('No sessions in this period.');
    expect(v?.chart.points).toEqual([]);
    expect(v?.stats[0]?.value).toBe('—');
  });

  it('imported FitNotes sessions are their own series and are chosen when they fill the period', () => {
    const fn = [imported('2026-06-01', [row([set(kg(95), 5)])]), imported('2026-07-01', [row([set(kg(97.5), 5)])]), imported('2026-08-01', [row([set(kg(100), 5)])])];
    const v = buildExerciseTabView({ sessions: [...history, ...fn], exerciseId: 'bench', today: TODAY, window: WINDOW, measure: 'weight' });
    expect(v?.series).toHaveLength(2);
    expect(v?.series.map((s) => s.label)).toContain('FitNotes · kg');
    expect(v?.chart.points.map((p) => p.value)).toEqual([95, 97.5, 100]);
    const app = v?.series.find((s) => !s.label.startsWith('FitNotes'));
    const w = buildExerciseTabView({ sessions: [...history, ...fn], exerciseId: 'bench', today: TODAY, window: WINDOW, seriesId: app?.id ?? null });
    expect(w?.chart.points).toHaveLength(2);
  });

  it('kg and lb are never mixed: a lb series is its own', () => {
    const v = buildExerciseTabView({ sessions: [...history, bench('2026-10-05', [[225, 5]], { unit: 'lb' })].map((s) => s), exerciseId: 'bench', today: TODAY, window: WINDOW });
    expect(v?.series.length).toBe(2);
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
