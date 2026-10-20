import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import {
  buildExerciseDetailView,
  buildExerciseTabView,
  collectExerciseSeries,
  exerciseHeadline,
  exerciseRecords,
  liftTargetChartValue,
  sessionE1rm,
  sessionTotalWeight,
  TOTAL_ADDED_ONLY,
  type ExerciseSeries,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
} from '../src/index';
import { kg, lb } from './fixtures';

/**
 * Ben, 20 Oct 2026 (decision 8): bodyweight and weighted (BW +) versions of
 * one exercise are one Progress series; bodyweight sets count as `+0` added.
 * Bodyweight rows never get an Est. 1RM and add nothing to total weight.
 */

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
const TODAY = '2026-10-08';
const WINDOW = { from: '2026-04-15', to: TODAY };
const BW: Load = { value: 0, unit: 'kg', convention: 'bodyweight' };

let n = 0;
function set(load: Load | null, reps: number | null, over: Partial<ProgressSet> = {}): ProgressSet {
  n += 1;
  return { setId: `set-${String(n)}`, setType: 'working', side: null, load, reps, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: n, ...over };
}

function row(sets: ProgressSet[], over: Partial<ProgressExercise> = {}): ProgressExercise {
  n += 1;
  return {
    sessionExerciseId: `row-${String(n)}`,
    exerciseId: 'pullup',
    exerciseName: 'Pull-up',
    equipmentId: 'bar',
    equipmentKind: 'bodyweight_station',
    equipmentName: 'Pull-up bar',
    gymId: 'gym-1',
    convention: 'added',
    unit: 'kg',
    measurement: 'reps',
    laterality: 'bilateral',
    sets,
    ...over,
  };
}

function session(date: string, rows: ProgressExercise[]): ProgressSession {
  const startedMs = Date.parse(`${date}T17:00:00.000Z`);
  n += 1;
  return {
    sessionId: `s-${date}-${String(n)}`,
    version: 3,
    source: 'manual',
    name: 'Pull',
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
  };
}

const bwRow = (reps: number[], over: Partial<ProgressExercise> = {}) => row(reps.map((r) => set(BW, r)), { convention: 'bodyweight', ...over });
const addedRow = (sets: [number, number][], over: Partial<ProgressExercise> = {}) => row(sets.map(([l, r]) => set(kg(l, 'added'), r)), over);

const history = () => [
  session('2026-09-01', [bwRow([12, 10])]),
  session('2026-09-03', [addedRow([[10, 8], [10, 8]])]),
  session('2026-09-05', [bwRow([14])]),
  session('2026-09-07', [addedRow([[15, 6]]), bwRow([10])]),
];

describe('bodyweight and weighted are one series (Ben, 20 Oct)', () => {
  it('one BW + series; bodyweight sets read as +0 added; the stored sets are untouched', () => {
    const sessions = history();
    const all = collectExerciseSeries(sessions, 'pullup', { unit: null });
    expect(all.map((s) => s.id)).toEqual(['pullup|added_bodyweight']);
    const s = all[0] as ExerciseSeries;
    expect(s.sessions).toHaveLength(4);
    expect(s.sessions[0]?.sets.map((x) => x.load)).toEqual([kg(0, 'added'), kg(0, 'added')]);
    // The latest row was bodyweight: the series still reads as BW + (convention `added`).
    expect(s.key.convention).toBe('added');
    expect(sessions[0]?.exercises[0]?.sets[0]?.load).toEqual(BW);
    expect(sessions[0]?.exercises[0]?.convention).toBe('bodyweight');
  });

  it('only bodyweight: stays a bodyweight series (reps); timed and assisted stay apart', () => {
    expect(collectExerciseSeries([session('2026-09-01', [bwRow([12])])], 'pullup', { unit: null }).map((s) => s.kind)).toEqual(['bodyweight']);
    const mixed = [
      session('2026-09-01', [bwRow([12])]),
      session('2026-09-02', [addedRow([[10, 8]])]),
      session('2026-09-03', [row([set(kg(30, 'assistance'), 8)], { convention: 'assistance', equipmentKind: 'assisted_stack' })]),
      session('2026-09-04', [row([set(BW, null, { durationS: 30 })], { convention: 'bodyweight', measurement: 'duration' })]),
    ];
    expect(collectExerciseSeries(mixed, 'pullup', { unit: null }).map((s) => s.kind).sort()).toEqual(['added_bodyweight', 'assisted', 'timed']);
  });

  it('no Est. 1RM for any row; Top set and Total weight count bodyweight as +0', () => {
    const s = collectExerciseSeries(history(), 'pullup', { unit: null })[0] as ExerciseSeries;
    for (const ss of s.sessions) expect(sessionE1rm(ss, s)).toBeNull();
    expect(s.sessions.map((ss) => sessionTotalWeight(ss, s)?.value ?? null)).toEqual([0, 160, 0, 90]);
    const h = exerciseHeadline(s);
    expect(h.bestE1rm).toBeNull();
    expect(h.bestSet?.set.load.value).toBe(15);
    expect(h.mostReps?.reps).toBe(14);

    const v = buildExerciseDetailView({ sessions: history(), exerciseId: 'pullup', today: TODAY, metric: 'top_set' });
    expect(v?.series).toHaveLength(1);
    expect(v?.seriesLabel).toBe('');
    expect(v?.metrics.map((m) => m.key)).toEqual(['top_set', 'total_weight']);
    expect(v?.estimateInfo).toBe(false);
    expect(v?.stats.map((x) => x.label)).toEqual(['BEST SET', 'MOST REPS', 'SESSIONS']);
    expect(v?.points.map((p) => sp(p.display))).toEqual(['BW × 12', 'BW + 10 kg × 8', 'BW × 14', 'BW + 15 kg × 6']);
    expect(v?.history.months[0]?.rows[0]?.sets).toBe('+15×6 · BW×10');
    const t = buildExerciseDetailView({ sessions: history(), exerciseId: 'pullup', today: TODAY, metric: 'total_weight' });
    expect(t?.points.map((p) => sp(p.display))).toEqual(['0 kg', '160 kg', '0 kg', '90 kg']);
    expect(t?.axisUnit).toBe('kg');
    // Review N1: a 0 kg bodyweight session isn't broken; the info tap says so (Total weight only).
    expect(t?.info).toBe(TOTAL_ADDED_ONLY);
    expect(v?.info).toBeNull();
    // The rep table: `BW` is a row (+0).
    expect(v?.repTable?.rows.some((r) => r.cells[0] === 'BW')).toBe(true);
  });

  it('records: never an Est. 1RM, and a bodyweight set is never a heavier one', () => {
    const sessions = [...history(), session('2026-09-09', [addedRow([[20, 5]])]), session('2026-09-11', [bwRow([20])])];
    const s = collectExerciseSeries(sessions, 'pullup', { unit: null })[0] as ExerciseSeries;
    const r = exerciseRecords(sessions, s);
    expect(r.items.some((x) => x.kind === 'best_e1rm')).toBe(false);
    expect(r.items.filter((x) => x.kind !== 'most_reps').every((x) => (x.load?.value ?? 0) > 0)).toBe(true);
    // The bodyweight 20 is a `Most reps at BW` record (review S1), never a load record.
    expect(r.items.filter((x) => x.kind === 'most_reps').map((x) => x.value)).toEqual([20]);
  });

  it('kg and lb: a bodyweight set is +0 in Ben’s unit (never converted)', () => {
    const sessions = [session('2026-09-01', [bwRow([12])]), session('2026-09-02', [row([set(lb(25, 'added'), 8)], { unit: 'lb' })])];
    const s = collectExerciseSeries(sessions, 'pullup', { unit: 'kg' })[0] as ExerciseSeries;
    expect(s.sessions[0]?.sets[0]?.load).toEqual(kg(0, 'added'));
    expect(s.sessions[0]?.sets[0]?.convertedFrom).toBeUndefined();
    expect(s.sessions[1]?.sets[0]?.convertedFrom).toBe('lb');
  });

  it('the Exercises tab: one series, Total weight of +0 rows is 0, no Est. 1RM', () => {
    const v = buildExerciseTabView({ sessions: history(), exerciseId: 'pullup', today: TODAY, window: WINDOW, measure: 'total' });
    expect(v?.series).toEqual([]);
    expect(v?.measures.map((m) => m.key)).toEqual(['weight', 'reps', 'top_set', 'total']);
    expect(v?.chart.points.map((p) => p.value)).toEqual([0, 160, 0, 90]);
    expect(v?.table.rows.map((r) => r.cells.e1rm)).toEqual(['—', '—', '—', '—']);
    expect(v?.info).toBe(TOTAL_ADDED_ONLY);
  });

  it('a BW + lift target’s dotted line still sits on the merged series’ Top set', () => {
    const v = buildExerciseDetailView({ sessions: history(), exerciseId: 'pullup', today: TODAY, metric: 'top_set' });
    if (!v) throw new Error('no view');
    expect(v.seriesTerms).toEqual({ exerciseId: 'pullup', kind: 'added_bodyweight', convention: 'added', unit: 'kg' });
    const target = { exerciseId: 'pullup', kind: 'weight_reps', reps: 5, load: { value: 20, unit: 'kg', convention: 'added' } } as unknown as Parameters<typeof liftTargetChartValue>[0];
    expect(liftTargetChartValue(target, { ...v.seriesTerms, metric: v.metric })).toBe(20);
  });
  it('a bodyweight Most reps record survives one weighted session (`Most reps at BW`, review S1)', () => {
    const bwOnly = [
      session('2026-09-01', [bwRow([12])]),
      session('2026-09-03', [bwRow([14])]),
      session('2026-09-05', [bwRow([15])]),
      session('2026-09-07', [bwRow([20])]),
    ];
    const before = exerciseRecords(bwOnly, collectExerciseSeries(bwOnly, 'pullup', { unit: null })[0] as ExerciseSeries);
    expect(before.items.map((x) => [x.kind, x.value])).toEqual([['most_reps', 20]]);
    const sessions = [...bwOnly, session('2026-09-09', [addedRow([[10, 5]])])];
    const s = collectExerciseSeries(sessions, 'pullup', { unit: null })[0] as ExerciseSeries;
    expect(s.kind).toBe('added_bodyweight');
    const after = exerciseRecords(sessions, s);
    expect(after.items.map((x) => [x.kind, x.value])).toEqual([['most_reps', 20]]);
    const v = buildExerciseDetailView({ sessions, exerciseId: 'pullup', today: TODAY, metric: 'top_set' });
    expect(v?.records?.items.map((r) => [r.label, r.value])).toEqual([['Most reps at BW', '20']]);
    // More reps at +0 earlier in the merged series: no BW record.
    const beaten = [session('2026-08-20', [addedRow([[0, 25]])]), ...sessions];
    const s2 = collectExerciseSeries(beaten, 'pullup', { unit: null })[0] as ExerciseSeries;
    expect(exerciseRecords(beaten, s2).items.some((x) => x.kind === 'most_reps')).toBe(false);
    // Weighted reps never count against a BW record.
    const heavyReps = [session('2026-08-20', [addedRow([[5, 30]])]), ...sessions];
    const s3 = collectExerciseSeries(heavyReps, 'pullup', { unit: null })[0] as ExerciseSeries;
    expect(exerciseRecords(heavyReps, s3).items.map((x) => [x.kind, x.value])).toEqual([['most_reps', 20]]);
  });

  it('an imported BW + set with a blank weight plots as +0, like a logged bodyweight set (review S2)', () => {
    const imported = { ...session('2026-09-02', [row([set(null, 12)])]), source: 'import' as const };
    const sessions = [session('2026-09-01', [addedRow([[10, 8]])]), imported, session('2026-09-04', [bwRow([10])])];
    const s = collectExerciseSeries(sessions, 'pullup', { unit: null })[0] as ExerciseSeries;
    expect(s.sessions[1]?.sets[0]?.load).toEqual(kg(0, 'added'));
    expect(s.sessions.map((ss) => sessionTotalWeight(ss, s)?.value ?? null)).toEqual([80, 0, 0]);
    const t = buildExerciseDetailView({ sessions, exerciseId: 'pullup', today: TODAY, metric: 'top_set' });
    expect(t?.points.map((p) => sp(p.display))).toEqual(['BW + 10 kg × 8', 'BW × 12', 'BW × 10']);
    // The stored set is untouched.
    expect(imported.exercises[0]?.sets[0]?.load).toBeNull();
  });

  it('a plate-loaded `added` row with a blank weight is not +0', () => {
    const plate = [session('2026-09-01', [row([set(kg(40, 'added'), 8), set(null, 8)], { exerciseId: 'pullup', equipmentKind: 'plate_loaded_machine' })])];
    const s = collectExerciseSeries(plate, 'pullup', { unit: null })[0] as ExerciseSeries;
    expect(s.kind).toBe('load');
    expect(s.sessions[0]?.sets[1]?.load).toBeNull();
  });
});
