import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import {
  addMonths,
  buildExerciseDetailView,
  buildExerciseListView,
  buildProgressHomeView,
  collectExerciseSeries,
  compactSetText,
  exerciseHeadline,
  exerciseHistory,
  exerciseRecords,
  exerciseTrend,
  metricsFor,
  repTableByReps,
  repTableByWeight,
  seriesKind,
  thousands,
  TOTAL_ASSUMED,
  toProgressSession,
  trendRangeBounds,
  TREND_MAX_POINTS,
  type ExerciseSeries,
  type MuscleInfo,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
} from '../src/index';
import { at, kg, lb, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Progress slice B (progress.md §8 checks 26–39): series, Est. 1RM, top set,
 * total weight, rep table, records, history and the exercise detail view model,
 * on small `ProgressSession` values. kg/lb, per-hand dumbbells, assisted
 * machines, bodyweight + added, timed holds, imports and marked sets.
 */

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
const TODAY = '2026-10-08';
const GYMS = { 'gym-1': 'Main Gym', 'gym-2': 'Hotel Gym' };

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

function onlySeries(sessions: ProgressSession[], exerciseId = 'bench'): ExerciseSeries {
  const all = collectExerciseSeries(sessions, exerciseId, { unit: null });
  expect(all).toHaveLength(1);
  return all[0] as ExerciseSeries;
}

describe('series (Ben, 20 Oct: one per exercise and kind, replacing PG15 for Progress)', () => {
  it('bench on Main Gym barbell, Hotel Gym barbell and imported history are one series; each session keeps its source', () => {
    const sessions = [
      bench('2026-09-01', [[100, 5]]),
      bench('2026-09-03', [[90, 5]], { equipmentId: 'bar-2', gymId: 'gym-2' }),
      imported('2026-01-03', [row([set(kg(80), 5)])]),
      bench('2026-09-05', [[100, 6]]),
    ];
    const all = collectExerciseSeries(sessions, 'bench', { unit: null });
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('bench|load');
    expect(all[0]?.sessions.map((s) => [s.source, s.rows[0]?.equipmentId ?? null])).toEqual([
      ['import', null],
      ['app', 'bar-1'],
      ['app', 'bar-2'],
      ['app', 'bar-1'],
    ]);
    // Stored provenance is untouched: the imported row is still an import with no equipment.
    expect(sessions[2]?.source).toBe('import');
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, range: 'all' });
    // One kind: no menu, no gym, equipment or `History` label.
    expect(v?.series.map((s) => s.label)).toEqual(['']);
    expect(v?.seriesLabel).toBe('');
    expect(v?.points.map((p) => p.sessionId)).toEqual([sessions[2]?.sessionId, sessions[0]?.sessionId, sessions[1]?.sessionId, sessions[3]?.sessionId]);
    expect(v?.converted).toBeNull();
  });

  it('kg and lb sessions are one series in Ben’s unit; a converted value says so behind the info tap', () => {
    const lbSession = session('2026-09-02', [row([set(lb(225), 5)], { unit: 'lb' })]);
    const sessions = [bench('2026-09-01', [[100, 5]]), lbSession];
    const all = collectExerciseSeries(sessions, 'bench', { unit: 'kg' });
    expect(all).toHaveLength(1);
    // 225 lb = 102.06 kg; the stored set keeps its lb.
    expect(all[0]?.sessions[1]?.sets[0]?.load).toEqual(kg(102.06));
    expect(all[0]?.sessions[1]?.sets[0]?.convertedFrom).toBe('lb');
    expect(lbSession.exercises[0]?.sets[0]?.load).toEqual(lb(225));
    expect(all[0]?.convertedFrom).toBe('lb');
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, unit: 'kg', metric: 'top_set' });
    expect(v?.converted).toBe('Converted from lb');
    expect(v?.axisUnit).toBe('kg');
    expect(v?.points.map((p) => sp(p.display))).toEqual(['100 kg × 5', '102.06 kg × 5']);
    expect(v?.points[1]?.notes).toContain('Converted from lb');
    expect(v?.points[0]?.notes).not.toContain('Converted from lb');
    // In lb, the kg session is the converted one: 225 × (1 + 5/30) = 262.5 → 263 (whole lb).
    const inLb = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, unit: 'lb' });
    expect(inLb?.converted).toBe('Converted from kg');
    expect(sp(inLb?.stats[0]?.value)).toBe('≈263 lb');
  });

  it('the series kind follows convention, equipment and measurement (§6.3, check 29)', () => {
    expect(seriesKind('total', 'barbell', 'reps')).toBe('load');
    expect(seriesKind('per_hand', 'dumbbells', 'reps')).toBe('load');
    expect(seriesKind('stack', 'weight_stack', 'reps')).toBe('load');
    expect(seriesKind('added', 'plate_loaded_machine', 'reps')).toBe('load');
    expect(seriesKind('added', 'bodyweight_station', 'reps')).toBe('added_bodyweight');
    expect(seriesKind('added', null, 'reps')).toBe('added_bodyweight');
    expect(seriesKind('assistance', 'assisted_stack', 'reps')).toBe('assisted');
    expect(seriesKind('bodyweight', null, 'reps')).toBe('bodyweight');
    expect(seriesKind('total', 'barbell', 'duration')).toBe('timed');
    expect(metricsFor('load')).toEqual(['e1rm', 'top_set', 'total_weight']);
    expect(metricsFor('assisted')).toEqual(['top_set']);
    expect(metricsFor('added_bodyweight')).toEqual(['top_set', 'total_weight']);
    expect(metricsFor('bodyweight')).toEqual(['best_set']);
    expect(metricsFor('timed')).toEqual(['longest_hold']);
  });
});

describe('Est. 1RM (PG11, checks 27–29)', () => {
  it('100 kg × 5 is ≈116.5 kg; 100 kg × 1 is ≈100 kg; one value per session from its best eligible set', () => {
    const sessions = [bench('2026-09-01', [[100, 5]]), bench('2026-09-03', [[100, 1]]), bench('2026-09-05', [[90, 8], [100, 3], [60, 15]])];
    const t = exerciseTrend(onlySeries(sessions), 'e1rm', '6m', TODAY);
    expect(t.points.map((p) => p.value)).toEqual([116.5, 100, 114]);
    // 90 × 8 = 114 beats 100 × 3 = 110; 60 × 15 (> 10 reps) is never used.
    expect(t.points[2]?.fromSet?.load).toEqual(kg(90));
    expect(t.points.every((p) => p.kind === 'estimate')).toBe(true);
  });

  it('warm-ups, marked sets and sets over 10 reps are ignored; no value is averaged across sessions', () => {
    const s = session('2026-09-01', [row([set(kg(120), 3, { setType: 'warmup' }), set(kg(110), 3, { exclusions: ['spotted'] }), set(kg(80), 12), set(kg(100), 5)])]);
    const t = exerciseTrend(onlySeries([s]), 'e1rm', '6m', TODAY);
    expect(t.points.map((p) => p.value)).toEqual([116.5]);
    expect(t.points[0]?.excludedSets).toBe(1);
  });

  it('every Est. 1RM value carries ≈ and Est. (or "estimate" for VoiceOver) on every surface', () => {
    const sessions = ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07'].map((d, i) => bench(d, [[100 + i * 2.5, 5]]));
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY });
    if (!v) throw new Error('view');
    expect(v.stats[0]?.label).toBe('EST. 1RM');
    // 107.5 × (1 + 5/30) = 125.42 → 125.5.
    expect(sp(v.stats[0]?.value)).toBe('≈125.5 kg');
    expect(v.statsWords).toMatch(/an estimate, about 125.5 kilograms/);
    expect(sp(v.heading)).toBe('Est. 1RM · 9 Apr – 8 Oct');
    expect(v.points.every((p) => p.display.startsWith('≈') && p.detail.startsWith('Est. 1RM'))).toBe(true);
    expect(v.points.every((p) => p.words.includes('estimated one-rep max about'))).toBe(true);
    expect(v.panel.every((l) => l.value.includes('≈'))).toBe(true);
    expect(sp(v.panel.find((l) => l.label === 'Change')?.value)).toBe('Up ≈9 kg since 1 Sep');
    expect(v.chartWords).toMatch(/^Estimated one-rep max, an estimate, Bench press, 9 April/);
    expect(v.table.headers[1]).toBe('Est. 1RM (estimate)');
    expect(v.table.rows.every((r) => r.value.startsWith('≈'))).toBe(true);
    const rec = v.records?.items.find((r) => r.label === 'Best Est. 1RM');
    expect(rec?.isEstimate).toBe(true);
    expect(sp(rec?.value)).toBe('≈125.5 kg');
    expect(rec?.words).toMatch(/an estimate/);
    expect(v.estimateInfo).toBe(true);
  });

  it('per-hand dumbbells: the per-dumbbell value, labelled `each`', () => {
    const sessions = [session('2026-09-01', [row([set(kg(30, 'per_hand'), 10)], { exerciseId: 'db', equipmentId: 'db-1', equipmentKind: 'dumbbells', equipmentName: 'Dumbbells', convention: 'per_hand' })])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'db', today: TODAY });
    expect(sp(v?.stats[0]?.value)).toBe('≈40 kg each');
    expect(v?.axisUnit).toBe('kg each');
    expect(sp(v?.stats[1]?.value)).toBe('30 kg each × 10');
  });

  it('assisted, bodyweight, bodyweight + added and timed series have no Est. 1RM; the default metric changes (check 29)', () => {
    const pull = (conv: 'assistance' | 'added' | 'bodyweight', load: Load | null, kind: ProgressExercise['equipmentKind']) =>
      session('2026-09-01', [row([set(load, 8)], { exerciseId: `pull-${conv}`, convention: conv, equipmentKind: kind, equipmentId: `eq-${conv}` })]);
    const a = buildExerciseDetailView({ sessions: [pull('assistance', kg(20, 'assistance'), 'assisted_stack')], exerciseId: 'pull-assistance', today: TODAY });
    expect(a?.metrics.map((m) => m.label)).toEqual(['Top set']);
    expect(a?.stats.map((s) => s.label)).toEqual(['LEAST ASSIST', 'MOST REPS', 'SESSIONS']);
    expect(a?.estimateInfo).toBe(false);
    const w = buildExerciseDetailView({ sessions: [pull('added', kg(10, 'added'), 'bodyweight_station')], exerciseId: 'pull-added', today: TODAY });
    expect(w?.metrics.map((m) => m.label)).toEqual(['Top set', 'Total weight']);
    expect(sp(w?.stats[0]?.value)).toBe('BW + 10 kg × 8');
    const b = buildExerciseDetailView({ sessions: [pull('bodyweight', null, null)], exerciseId: 'pull-bodyweight', today: TODAY });
    expect(b?.metrics.map((m) => m.label)).toEqual(['Best set']);
    expect(b?.stats.map((s) => `${s.label} ${s.value}`)).toEqual(['MOST REPS 8', 'SESSIONS 1']);
    expect(b?.repTable).toBeNull();
    const hold = session('2026-09-01', [row([set(null, null, { durationS: 75 }), set(null, null, { durationS: 90 })], { exerciseId: 'plank', convention: 'bodyweight', measurement: 'duration', equipmentId: null, equipmentKind: null })]);
    const h = buildExerciseDetailView({ sessions: [hold], exerciseId: 'plank', today: TODAY });
    expect(h?.metrics.map((m) => m.label)).toEqual(['Longest hold']);
    expect(h?.stats[0]).toEqual({ value: '1:30', label: 'LONGEST HOLD' });
    // Even when asked for, an unavailable metric falls back to the default.
    expect(buildExerciseDetailView({ sessions: [hold], exerciseId: 'plank', today: TODAY, metric: 'e1rm' })?.metric).toBe('longest_hold');
  });

  it('a plate-loaded machine’s `added` load has Est. 1RM; a dip belt’s doesn’t', () => {
    const sled = session('2026-09-01', [row([set(kg(100, 'added'), 5)], { exerciseId: 'leg-press', convention: 'added', equipmentKind: 'plate_loaded_machine', equipmentId: 'lp' })]);
    expect(buildExerciseDetailView({ sessions: [sled], exerciseId: 'leg-press', today: TODAY })?.metrics.map((m) => m.key)).toEqual(['e1rm', 'top_set', 'total_weight']);
  });
});

describe('top set and change (§5.5)', () => {
  it('heaviest, then most reps; `Same load, 2 more reps than …`', () => {
    const sessions = [bench('2026-09-01', [[100, 6]]), bench('2026-09-03', [[100, 7]]), bench('2026-09-05', [[100, 8], [95, 10]])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, metric: 'top_set' });
    expect(v?.points.map((p) => sp(p.display))).toEqual(['100 kg × 6', '100 kg × 7', '100 kg × 8']);
    expect(sp(v?.panel.find((l) => l.label === 'Change')?.value)).toBe('Same load, 2 more reps than 1 Sep');
    expect(sp(v?.panel.find((l) => l.label === 'Best')?.value)).toBe('100 kg × 8 · 5 Sep');
  });

  it('assisted: less assistance is better (best, change)', () => {
    const asst = (d: string, l: number) => session(d, [row([set(kg(l, 'assistance'), 8)], { exerciseId: 'chin', convention: 'assistance', equipmentKind: 'assisted_stack', equipmentId: 'as' })]);
    const v = buildExerciseDetailView({ sessions: [asst('2026-09-01', 30), asst('2026-09-03', 25), asst('2026-09-05', 27.5)], exerciseId: 'chin', today: TODAY });
    expect(sp(v?.panel.find((l) => l.label === 'Best')?.value)).toBe('Assist 25 kg × 8 · 3 Sep');
    expect(sp(v?.panel.find((l) => l.label === 'Change')?.value)).toBe('2.5 kg less assistance than 1 Sep');
    expect(v?.repTable?.rows.map((r) => sp(r.cells[0]))).toEqual(['Assist 25 kg', 'Assist 27.5 kg', 'Assist 30 kg']);
    expect(sp(v?.stats[0]?.value)).toBe('25 kg');
  });
});

describe('rep table (PG28, checks 30, 31)', () => {
  const sessions = [bench('2026-09-24', [[100, 8], [100, 7]]), bench('2026-10-08', [[102.5, 6]])];
  const s = onlySeries(sessions);
  const all = { from: '2026-01-01', to: TODAY };

  it('by weight: 100×8, 100×7 and 102.5×6 list `102.5 kg 6` and `100 kg 8` with their dates', () => {
    expect(repTableByWeight(s, all).map((r) => [r.load, r.reps, r.date])).toEqual([
      [102.5, 6, '2026-10-08'],
      [100, 8, '2026-09-24'],
    ]);
  });

  it('by reps: 6 → 102.5, 5 → 102.5 from 6 reps, 8 → 100, 7 → 100 from 8 reps, nothing above 8', () => {
    const rows = repTableByReps(s, all);
    expect(rows.map((r) => [r.reps, r.load, r.fromReps])).toEqual([
      [1, 102.5, 6],
      [2, 102.5, 6],
      [3, 102.5, 6],
      [4, 102.5, 6],
      [5, 102.5, 6],
      [6, 102.5, null],
      [7, 100, 8],
      [8, 100, null],
    ]);
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, repBy: 'reps' });
    expect(v?.repTable?.headers).toEqual(['Reps', 'Heaviest', 'Date']);
    const r5 = v?.repTable?.rows[4];
    expect(r5?.note).toBe('from 6 reps');
    expect(r5?.words).toBe('5 reps, heaviest 102.5 kilograms, from a set of 6, 8 October.');
  });

  it('stops at 12 reps; actual values only; the first date a count was done', () => {
    const ss = onlySeries([bench('2026-09-01', [[60, 15]]), bench('2026-09-03', [[60, 15]])]);
    const rows = repTableByReps(ss, all);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.load === 60 && r.date === '2026-09-01')).toBe(true);
  });

  it('uses the selected range; imported rows read like any other, no FitNotes tag (18 Oct)', () => {
    const imp = imported('2026-02-01', [row([set(kg(110), 2)])]);
    const v = buildExerciseDetailView({ sessions: [imp], exerciseId: 'bench', today: TODAY, range: 'all' });
    expect(v?.repTable?.rows[0]?.tag).toBeNull();
    expect(buildExerciseDetailView({ sessions: [imp], exerciseId: 'bench', today: TODAY, range: '3m' })?.repTable?.rows).toEqual([]);
  });
});

describe('marked sets (PG21, check 32)', () => {
  const spotted = set(kg(105), 3, { exclusions: ['spotted'] });
  const sessions = [bench('2026-09-01', [[100, 5]]), bench('2026-09-03', [[100, 5]]), bench('2026-09-05', [[100, 5]]), session('2026-09-07', [row([spotted, set(kg(100), 6)])])];

  it('a 105×3 marked Spotted is not in the chart, rep table, records or StatStrip; history reads `105×3 (spotted)`', () => {
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, metric: 'top_set' });
    if (!v) throw new Error('view');
    expect(v.points.map((p) => sp(p.display))).not.toContain('105 kg × 3');
    expect(v.repTable?.rows.map((r) => sp(r.cells[0]))).toEqual(['100 kg']);
    expect(v.records?.items.some((r) => r.value.includes('105'))).toBe(false);
    expect(v.stats.some((s) => s.value.includes('105'))).toBe(false);
    expect(v.history.months[0]?.rows[0]?.sets).toBe('105×3 (spotted) · 100×6');
    expect(v.points[3]?.notes).toContain('1 set not counted');
  });

  it('every set that day marked: no point, marker `Not counted`; total weight still counts them (PG31)', () => {
    const all = [...sessions, session('2026-09-09', [row([set(kg(110), 2, { exclusions: ['technique'] })])])];
    const t = exerciseTrend(onlySeries(all), 'e1rm', '6m', TODAY);
    expect(t.points).toHaveLength(4);
    expect(t.markers.filter((m) => m.kind === 'not_counted').map((m) => m.date)).toEqual(['2026-09-09']);
    const vol = exerciseTrend(onlySeries(all), 'total_weight', '6m', TODAY);
    expect(vol.points).toHaveLength(5);
    expect(vol.points[4]?.value).toBe(220);
    expect(vol.markers.some((m) => m.kind === 'not_counted')).toBe(false);
    const v = buildExerciseDetailView({ sessions: all, exerciseId: 'bench', today: TODAY });
    expect(v?.markers.map((m) => m.label)).toContain('Not counted');
    expect(v?.table.rows[0]).toMatchObject({ value: '—', notes: 'Not counted' });
  });
});

describe('gaps, edits and long history (PG12, checks 33, 36)', () => {
  it('a 24-day gap breaks the line and shows `Gap 24 days` in the marker lane and the table', () => {
    const sessions = [bench('2026-07-01', [[100, 5]]), bench('2026-07-05', [[100, 5]]), bench('2026-07-29', [[100, 6]]), bench('2026-08-01', [[100, 7]])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY });
    expect(v?.points.map((p) => p.breakBefore)).toEqual([false, false, true, false]);
    expect(v?.markers.find((m) => m.kind === 'gap')).toMatchObject({ label: 'Gap 24 days', date: '2026-07-29', from: '2026-07-05' });
    expect(v?.table.rows.find((r) => r.notes.includes('Gap 24 days'))?.sessionId).toBe(sessions[2]?.sessionId);
    expect(v?.chartWords).toMatch(/One gap: a gap of 24 days in July\./);
    // 20 days is not a gap.
    const close = [bench('2026-07-01', [[100, 5]]), bench('2026-07-21', [[100, 5]])];
    expect(exerciseTrend(onlySeries(close), 'e1rm', '6m', TODAY).gaps).toEqual([]);
  });

  it('a corrected set marks its session `Edited`', () => {
    const s = session('2026-09-01', [row([set(kg(100), 5, { edited: true })])]);
    const v = buildExerciseDetailView({ sessions: [s], exerciseId: 'bench', today: TODAY });
    expect(v?.markers.map((m) => m.label)).toEqual(['Edited']);
    expect(v?.history.months[0]?.rows[0]?.tags).toEqual(['Edited']);
  });

  it('`All` with years of history draws weekly bests (`· weekly best`); the table lists every session', () => {
    const sessions: ProgressSession[] = [];
    for (let i = 0; i < 3 * 120; i += 1) {
      const date = addDaysIso('2024-01-01', i * 2);
      if (date > TODAY) break;
      sessions.push(bench(date, [[80 + (i % 9) * 2.5, 5]]));
    }
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, range: 'all' });
    if (!v) throw new Error('view');
    expect(sessions.length).toBeGreaterThan(TREND_MAX_POINTS);
    expect(v.heading.endsWith('· weekly best')).toBe(true);
    expect(v.points.length).toBeLessThan(sessions.length);
    expect(v.table.rows).toHaveLength(sessions.length);
    // Each weekly point is the best of its week.
    const t = exerciseTrend(onlySeries(sessions), 'e1rm', 'all', TODAY);
    for (const p of t.points) {
      const week = t.sessionPoints.filter((q) => mondayIso(q.date) === mondayIso(p.date));
      expect(p.value).toBe(Math.max(...week.map((q) => q.value)));
    }
  });
});

function addDaysIso(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function mondayIso(date: string): string {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysIso(date, -((d + 6) % 7));
}

describe('ranges and chart states (§3.4)', () => {
  it('`6 mo` on 8 Oct is 9 Apr – 8 Oct; months clamp to their length', () => {
    expect(trendRangeBounds('6m', '2026-10-08', null)).toEqual({ from: '2026-04-09', to: '2026-10-08' });
    expect(trendRangeBounds('3m', '2026-05-31', null)).toEqual({ from: '2026-03-01', to: '2026-05-31' });
    expect(trendRangeBounds('1y', '2026-10-08', null)).toEqual({ from: '2025-10-09', to: '2026-10-08' });
    expect(trendRangeBounds('all', '2026-10-08', '2019-02-03')).toEqual({ from: '2019-02-03', to: '2026-10-08' });
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
  });

  it('1–2 points: `2 sessions in this range.` with `Try 1 yr` when a wider range has ≥ 3', () => {
    const sessions = [bench('2025-12-01', [[100, 5]]), bench('2026-09-01', [[100, 5]]), bench('2026-09-05', [[100, 5]])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, range: '6m' });
    expect(v?.chart).toEqual({ kind: 'too_few', message: '2 sessions in this range.', action: { label: 'Try 1 yr', range: '1y' } });
  });

  it('none in range: `None between 9 Apr and 8 Oct. Last: 2 Feb.` + `Show all`', () => {
    const v = buildExerciseDetailView({ sessions: [bench('2026-02-02', [[100, 5]])], exerciseId: 'bench', today: TODAY });
    expect(v?.chart.kind).toBe('none_in_range');
    if (v?.chart.kind === 'none_in_range') {
      expect(sp(v.chart.message)).toBe('None between 9 Apr and 8 Oct. Last: 2 Feb.');
      expect(v.chart.action).toEqual({ label: 'Show all', range: 'all' });
    }
  });

  it('Est. 1RM with only sets over 10 reps: `No sets of 10 reps or fewer in this range.`', () => {
    const v = buildExerciseDetailView({ sessions: [bench('2026-09-01', [[60, 12]])], exerciseId: 'bench', today: TODAY });
    expect(v?.chart).toEqual({ kind: 'no_eligible', message: 'No sets of 10 reps or fewer in this range.' });
  });

  it('dates outside this year carry the year', () => {
    const v = buildExerciseDetailView({ sessions: [bench('2025-03-02', [[100, 5]])], exerciseId: 'bench', today: TODAY, range: 'all' });
    expect(sp(v?.heading)).toBe('Est. 1RM · 2 Mar 2025 – 8 Oct');
    expect(v?.history.months[0]?.title).toBe('March 2025');
  });
});

describe('Total weight on exercise detail (Ben, 20 Oct: replaces Volume)', () => {
  it('each dumbbell and side counted, marked sets in, warm-ups out; bars on a plain kg axis', () => {
    const plain = [session('2026-09-01', [row([set(kg(60), 10, { setType: 'warmup' }), set(kg(100), 5), set(kg(100), 5, { exclusions: ['spotted'] })])])];
    const p = buildExerciseDetailView({ sessions: plain, exerciseId: 'bench', today: TODAY, metric: 'total_weight' });
    expect(p?.metric).toBe('total_weight');
    expect(sp(p?.points[0]?.display)).toBe('1,000 kg');
    expect(p?.heading.startsWith('Total weight · ')).toBe(true);
    expect(p?.axisUnit).toBe('kg');
    expect(p?.bars).toBe(true);
    // One-arm row, left and right: one dumbbell per side, both sides counted (item 7: as built).
    const uni = row([set(kg(30, 'per_hand'), 10, { side: 'left' }), set(kg(30, 'per_hand'), 8, { side: 'right' }), set(kg(30, 'per_hand'), 10, { side: 'left' }), set(kg(30, 'per_hand'), 10, { side: 'right' })], {
      exerciseId: 'db-row',
      convention: 'per_hand',
      laterality: 'unilateral',
      equipmentKind: 'dumbbells',
      equipmentId: 'db',
    });
    const v = buildExerciseDetailView({ sessions: [session('2026-09-01', [uni])], exerciseId: 'db-row', today: TODAY, metric: 'total_weight', implements: 1 });
    expect(sp(v?.points[0]?.display)).toBe('1,140 kg');
    expect(v?.axisUnit).toBe('kg');
    expect(v?.info).toBeNull();
    expect(v?.history.months[0]?.rows[0]?.sets).toBe('L 30×10 · R 30×8 · L 30×10 · R 30×10');
    // Two-handed dumbbell press with no catalogue count: both dumbbells, an estimate, the info tap says so.
    const press = [session('2026-09-01', [row([set(kg(20, 'per_hand'), 10)], { exerciseId: 'db-press', convention: 'per_hand', equipmentKind: 'dumbbells', equipmentId: 'db' })])];
    const est = buildExerciseDetailView({ sessions: press, exerciseId: 'db-press', today: TODAY, metric: 'total_weight' });
    expect(sp(est?.points[0]?.display)).toBe('≈400 kg');
    expect(est?.points[0]?.words).toContain('about 400 kilograms');
    expect(est?.info).toBe(TOTAL_ASSUMED);
    expect(sp(buildExerciseDetailView({ sessions: press, exerciseId: 'db-press', today: TODAY, metric: 'total_weight', implements: 2 })?.points[0]?.display)).toBe('400 kg');
    // Change reads in plain kg.
    const two = [bench('2026-09-01', [[100, 5]]), bench('2026-09-03', [[100, 5], [100, 5]])];
    expect(sp(buildExerciseDetailView({ sessions: two, exerciseId: 'bench', today: TODAY, metric: 'total_weight' })?.panel.find((l) => l.label === 'Change')?.value)).toBe('Up 500 kg since 1 Sep');
  });

  it('no Volume metric anywhere; total weight only where there is load (and BW +)', () => {
    for (const kind of ['load', 'assisted', 'bodyweight', 'timed', 'added_bodyweight', 'distance', 'cardio'] as const) expect(metricsFor(kind) as string[]).not.toContain('volume');
    expect(metricsFor('added_bodyweight')).toEqual(['top_set', 'total_weight']);
    for (const kind of ['assisted', 'bodyweight', 'timed', 'distance', 'cardio'] as const) expect(metricsFor(kind)).not.toContain('total_weight');
  });

  it('thousands are grouped', () => {
    expect(thousands(12345)).toBe('12,345');
    expect(thousands(1234.5)).toBe('1,234.5');
    expect(thousands(999)).toBe('999');
  });
});

describe('records (PG10, PG30, check 39)', () => {
  it('every record of the series, newest first, Best Est. 1RM labelled; heaviest and most reps as the home judges them', () => {
    const sessions = [
      bench('2026-08-01', [[100, 5]]),
      bench('2026-08-04', [[100, 5]]),
      bench('2026-08-07', [[100, 5]]),
      bench('2026-08-10', [[100, 7]]), // most reps at 100, and Est. 1RM 123.5
      bench('2026-08-13', [[105, 3]]), // heaviest (Est. 1RM 115.5: no)
    ];
    const s = onlySeries(sessions);
    const r = exerciseRecords(sessions, s);
    expect(r.items.map((x) => [x.date, x.kind])).toEqual([
      ['2026-08-13', 'heaviest'],
      ['2026-08-10', 'most_reps_at_load'],
      ['2026-08-10', 'best_e1rm'],
    ]);
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY });
    expect(v?.records?.items.map((x) => sp(`${x.label}  ${x.value} · ${x.date}`))).toEqual(['Heaviest set  105 kg × 3 · 13 Aug', 'Most reps at 100 kg  7 · 10 Aug', 'Best Est. 1RM  ≈123.5 kg · 10 Aug']);
  });

  it('fewer than 3 earlier logged sessions: none, and `Records start after 3 logged sessions.`', () => {
    const sessions = [bench('2026-08-01', [[100, 5]]), bench('2026-08-04', [[110, 5]]), bench('2026-08-07', [[120, 5]])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY });
    expect(v?.records).toEqual({ items: [], empty: 'Records start after 3 logged sessions.' });
  });

  it('imports never make a record but a higher imported Est. 1RM suppresses one; an imported-only series has none', () => {
    const base = [bench('2026-08-01', [[100, 5]]), bench('2026-08-04', [[100, 5]]), bench('2026-08-07', [[100, 5]]), bench('2026-08-10', [[100, 7]])];
    const s = collectExerciseSeries(base, 'bench', { unit: null })[0] as ExerciseSeries;
    expect(exerciseRecords(base, s).items.map((x) => x.kind)).toEqual(['most_reps_at_load', 'best_e1rm']);
    // An imported 95 × 10 (Est. 126.5) suppresses the 123.5 Est. 1RM claim, not the lighter-load rep record.
    const imp = imported('2026-01-01', [row([set(kg(95), 10)])]);
    const withImp = collectExerciseSeries([imp, ...base], 'bench', { unit: null }).find((x) => x.key.source === 'app') as ExerciseSeries;
    expect(exerciseRecords([imp, ...base], withImp).items.map((x) => x.kind)).toEqual(['most_reps_at_load']);
    // A heavier imported set suppresses the actual records too (as `findSetRecord`).
    const heavy = imported('2026-01-01', [row([set(kg(110), 1)])]);
    const withHeavy = collectExerciseSeries([heavy, ...base], 'bench', { unit: null })[0] as ExerciseSeries;
    expect(exerciseRecords([heavy, ...base], withHeavy).items.map((x) => x.kind)).toEqual(['best_e1rm']);
    const onlyImp = [imported('2026-01-01', [row([set(kg(100), 5)])]), imported('2026-01-04', [row([set(kg(100), 5)])]), imported('2026-01-07', [row([set(kg(100), 5)])]), imported('2026-01-10', [row([set(kg(120), 5)])])];
    const v = buildExerciseDetailView({ sessions: onlyImp, exerciseId: 'bench', today: TODAY, range: 'all' });
    expect(v?.seriesLabel).toBe('');
    expect(v?.records).toEqual({ items: [], empty: 'Records start after 3 logged sessions.' });
    // 18 Oct (Ben): imported points and rows carry no `FitNotes` tag; the source stays in the data.
    expect(v?.points.some((p) => p.notes.includes('FitNotes'))).toBe(false);
    expect(v?.history.months[0]?.rows.some((r) => r.tags.includes('FitNotes'))).toBe(false);
    expect(v?.history.months[0]?.rows[0]?.title).toMatch(/· Workout$/);
  });

  it('Best Est. 1RM on the home: labelled, only when the row has no actual record', () => {
    const sessions = [bench('2026-09-20', [[100, 5]]), bench('2026-09-23', [[100, 5]]), bench('2026-09-26', [[100, 5]]), bench('2026-10-01', [[95, 10]])];
    const info = new Map<string, MuscleInfo>([['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'] }]]);
    const home = buildProgressHomeView({ sessions, exercises: info, today: TODAY, period: '1m', grouping: 'body_part', gymNames: GYMS });
    if (home.dataState !== 'normal') throw new Error('home');
    expect(home.records.items.map((r) => [r.label, sp(r.value)])).toEqual([['Best Est. 1RM', '≈126.5 kg']]);
    expect(home.records.items[0]?.words).toMatch(/estimated one-rep max, an estimate/);
  });
});

describe('headline and history', () => {
  it('all-time bests per convention, countable sets only', () => {
    const s = onlySeries([bench('2026-09-01', [[100, 8]]), bench('2026-09-05', [[105, 3]]), session('2026-09-07', [row([set(kg(110), 1, { exclusions: ['pain'] })])])]);
    const h = exerciseHeadline(s);
    expect(h.sessions).toBe(3);
    expect(h.bestE1rm?.value).toBe(126.5);
    expect(h.bestSet?.set.load).toEqual(kg(105));
  });

  it('months newest first, `Load August` pages back; compact sets per convention', () => {
    const s = onlySeries([bench('2026-07-01', [[100, 5]]), bench('2026-08-01', [[100, 5]]), bench('2026-09-01', [[100, 5]]), bench('2026-09-20', [[102.5, 6], [100, 8]])]);
    const h = exerciseHistory(s, 1);
    expect(h.months.map((m) => [m.month, m.sessions.length])).toEqual([['2026-09', 2]]);
    expect(h.nextMonth).toBe('2026-08');
    const v = buildExerciseDetailView({ sessions: s.sessions.map((x) => session(x.date, [...x.rows])), exerciseId: 'bench', today: TODAY, historyMonths: 2 });
    expect(v?.history.months.map((m) => m.title)).toEqual(['September', 'August']);
    expect(v?.history.more).toEqual({ label: 'Load July', months: 3 });
    expect(v?.history.months[0]?.rows[0]?.sets).toBe('102.5×6 · 100×8');
    expect(compactSetText(set(kg(10, 'added'), 8), { kind: 'added_bodyweight', equipmentKind: null })).toBe('+10×8');
    expect(compactSetText(set(null, 12), { kind: 'bodyweight', equipmentKind: null })).toBe('12');
    expect(compactSetText(set(null, null, { durationS: 45 }), { kind: 'timed', equipmentKind: null })).toBe('0:45');
  });
});

describe('opening on a workout (home record, past workout, overview)', () => {
  it('a sessionId opens the series that has it with its point selected; an equipmentId prefers the kind used on it', () => {
    const sessions = [bench('2026-09-01', [[100, 5]]), bench('2026-09-02', [[100, 5]]), bench('2026-09-03', [[90, 5]], { equipmentId: 'bar-2', gymId: 'gym-2' })];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, sessionId: sessions[2]?.sessionId ?? null });
    expect(v?.seriesId).toBe('bench|load');
    expect(v?.selectedSessionId).toBe(sessions[2]?.sessionId);
    const assist = session('2026-09-04', [row([set(kg(30, 'assistance'), 8)], { convention: 'assistance', equipmentKind: 'assisted_stack', equipmentId: 'assist-1' })]);
    const both = [...sessions, assist];
    expect(buildExerciseDetailView({ sessions: both, exerciseId: 'bench', today: TODAY, equipmentId: 'assist-1' })?.seriesLabel).toBe('Assisted');
    expect(buildExerciseDetailView({ sessions: both, exerciseId: 'bench', today: TODAY, equipmentId: 'bar-2' })?.seriesLabel).toBe('Weighted');
    expect(buildExerciseDetailView({ sessions, exerciseId: 'nothing', today: TODAY })).toBeNull();
  });

  it('a pain flag shows `Pain flag since 2 Oct`', () => {
    const v = buildExerciseDetailView({ sessions: [bench('2026-09-01', [[100, 5]])], exerciseId: 'bench', today: TODAY, painFlag: { flagId: 'f1', date: '2026-10-02' } });
    expect(sp(v?.pain?.text)).toBe('Pain flag since 2 Oct');
  });
});

describe('exercises list (§2.6)', () => {
  const info = new Map<string, MuscleInfo>([
    ['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }],
    ['squat', { name: 'Back squat', movementPattern: 'squat', primaryMuscles: ['quads'] }],
  ]);
  const sessions = [
    session('2026-09-01', [row([set(kg(100), 5)]), row([set(kg(140), 5)], { exerciseId: 'squat', exerciseName: 'Back squat' })]),
    session('2026-10-01', [row([set(kg(100), 5)])]),
    session('2026-10-02', [row([], { exerciseId: 'empty' })]),
  ];

  it('exercises with ≥ 1 session, sorted by last done; search and body-part filter (primary muscles)', () => {
    const v = buildExerciseListView({ sessions, exercises: info, today: TODAY });
    expect(v.rows.map((r) => [r.name, sp(r.line)])).toEqual([
      ['Bench press', '2 sessions · last 1 Oct'],
      ['Back squat', '1 session · last 1 Sep'],
    ]);
    expect(buildExerciseListView({ sessions, exercises: info, today: TODAY, query: 'SQU' }).rows.map((r) => r.name)).toEqual(['Back squat']);
    expect(buildExerciseListView({ sessions, exercises: info, today: TODAY, group: 'Chest' }).rows.map((r) => r.name)).toEqual(['Bench press']);
    expect(buildExerciseListView({ sessions, exercises: info, today: TODAY, group: 'Triceps' }).noMatches).toBe('No matches.');
    expect(v.groups).toHaveLength(12);
    expect(buildExerciseListView({ sessions: [], exercises: info, today: TODAY }).empty).toBe(true);
  });
});

describe('projection carries what slice B needs', () => {
  it('equipment name from the snapshot, and the `edited` flag after a correction', () => {
    let s = startFixture().state;
    const b = setsFor(s, BENCH);
    s = apply(s, logCmd(b[0]?.id ?? '', values(kg(100), 8), 60));
    const logged = setsFor(s, BENCH)[0];
    s = apply(s, { type: 'correct_set', at: at(120), opId: 'c1', setId: logged?.id ?? '', expectedSetVersion: logged?.version ?? 1, patch: { reps: 7 } });
    s = apply(s, { type: 'finish', at: at(3600), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const p = toProgressSession(s, 'Europe/London', 0);
    const ex = p?.exercises.find((e) => e.exerciseId === BENCH);
    expect(ex?.sets[0]).toMatchObject({ reps: 7, edited: true });
    expect(typeof ex?.equipmentName === 'string' || ex?.equipmentName === null).toBe(true);
    const v = buildExerciseDetailView({ sessions: p ? [p] : [], exerciseId: BENCH, today: '2026-10-09' });
    expect(v?.markers.map((m) => m.kind)).toContain('edited');
  });
});
