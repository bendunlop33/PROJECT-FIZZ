import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import {
  buildAddExerciseCommand,
  buildExerciseDetailView,
  collectExerciseSeries,
  compactSetText,
  distanceTableByLoad,
  exerciseHeadline,
  exerciseTrend,
  metricsFor,
  recordsInWindow,
  seriesIdOf,
  seriesKind,
  sessionBestDistance,
  sessionMetric,
  sessionTotalDistance,
  toProgressSession,
  trendRangeBounds,
  type ExerciseSeries,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
} from '../src/index';
import { at, exercise, idGen, kg, lb, profile, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Progress for distance sets (sled push, carries): the projection carries
 * metres; a distance series has its own kind with `Total distance` and
 * `Best distance` (actual metres, with the load they were done at), a best
 * distance by load table, and never an Est. 1RM, top set, volume or rep table.
 */

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
const TODAY = '2026-10-08';

let n = 0;
function set(load: Load | null, distanceM: number | null, over: Partial<ProgressSet> = {}): ProgressSet {
  n += 1;
  return { setId: `set-${String(n)}`, setType: 'working', side: null, load, reps: null, durationS: null, ...(distanceM === null ? {} : { distanceM }), rpe: null, rir: null, completedAtUtc: null, index: n, ...over };
}

function sledRow(sets: ProgressSet[], over: Partial<ProgressExercise> = {}): ProgressExercise {
  n += 1;
  return {
    sessionExerciseId: `row-${String(n)}`,
    exerciseId: 'sled-push',
    exerciseName: 'Sled push',
    equipmentId: null,
    equipmentKind: null,
    equipmentName: null,
    gymId: 'gym-1',
    convention: 'added',
    unit: 'kg',
    measurement: 'distance',
    laterality: 'bilateral',
    sets,
    ...over,
  };
}

const carryRow = (sets: ProgressSet[], over: Partial<ProgressExercise> = {}) =>
  sledRow(sets, { exerciseId: 'farmers-carry', exerciseName: 'Farmer’s carry', equipmentId: 'db-1', equipmentKind: 'dumbbells', equipmentName: 'Dumbbells', convention: 'per_hand', ...over });

function session(date: string, rows: ProgressExercise[]): ProgressSession {
  const startedMs = Date.parse(`${date}T17:00:00.000Z`);
  n += 1;
  return {
    sessionId: `s-${date}-${String(n)}`,
    version: 3,
    source: 'manual',
    name: 'Conditioning',
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

function onlySeries(sessions: ProgressSession[], exerciseId = 'sled-push'): ExerciseSeries {
  const all = collectExerciseSeries(sessions, exerciseId);
  expect(all).toHaveLength(1);
  return all[0] as ExerciseSeries;
}

const added = (v: number) => kg(v, 'added');
const ALL = { from: '2000-01-01', to: TODAY };

describe('projection carries distance', () => {
  it('a logged sled push keeps its metres; other sets have no distance key', () => {
    const SLED = exercise(231, 'Sled push', { measurement: 'distance', compatibleEquipment: [], defaultLoadConvention: 'added' });
    let s = startFixture().state;
    s = apply(s, buildAddExerciseCommand({ opId: 'add-sled', owner: profile(), exercise: SLED, equipmentId: null, at: at(5), newId: idGen(61_000) }));
    const [b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 30));
    const [sled] = setsFor(s, SLED.id);
    s = apply(s, logCmd(sled?.id ?? '', values(added(40), null, { distanceM: 20 }), 60));
    s = apply(s, { type: 'finish', at: at(3600), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const p = toProgressSession(s, 'Europe/London', 0);
    const sledEx = p?.exercises.find((e) => e.exerciseId === SLED.id);
    expect(sledEx?.measurement).toBe('distance');
    expect(sledEx?.sets).toEqual([expect.objectContaining({ load: added(40), reps: null, distanceM: 20 })]);
    const benchSet = p?.exercises.find((e) => e.exerciseId === BENCH)?.sets[0];
    expect(benchSet && 'distanceM' in benchSet).toBe(false);
    // And Progress shows it as distance, never as an empty load chart.
    const v = buildExerciseDetailView({ sessions: p ? [p] : [], exerciseId: SLED.id, today: '2026-10-09' });
    expect(v?.metric).toBe('total_distance');
    expect(sp(v?.points[0]?.display)).toBe('20 m');
  });
});

describe('distance series kind', () => {
  it('distance is its own kind for every convention, with no Est. 1RM, top set or volume', () => {
    for (const c of ['total', 'per_hand', 'added', 'bodyweight', 'stack'] as const) expect(seriesKind(c, null, 'distance')).toBe('distance');
    expect(seriesKind('added', 'plate_loaded_machine', 'distance')).toBe('distance');
    expect(metricsFor('distance')).toEqual(['total_distance', 'best_distance']);
  });

  it('a distance series never shares an id with a reps series of the same exercise', () => {
    const key = { exerciseId: 'x', source: 'app' as const, equipmentId: null, convention: 'added' as const, unit: 'kg' as const };
    expect(seriesIdOf({ ...key, measurement: 'distance' })).not.toBe(seriesIdOf({ ...key, measurement: 'reps' }));
  });

  it('Est. 1RM and the load metrics return nothing for a distance series, even with reps logged', () => {
    const ss = onlySeries([session('2026-10-01', [sledRow([set(added(100), 20, { reps: 5 })])])]);
    const one = ss.sessions[0];
    if (one === undefined) throw new Error('no session');
    for (const m of ['e1rm', 'top_set', 'volume', 'best_set', 'longest_hold'] as const) expect(sessionMetric(one, ss, m)).toBeNull();
    expect(exerciseHeadline(ss)).toMatchObject({ bestE1rm: null, bestSet: null, mostReps: null });
  });
});

describe('total and best distance', () => {
  it('total: Σ metres of working sets, marked sets included, warm-ups and sets with no metres left out', () => {
    const ss = onlySeries([
      session('2026-10-01', [sledRow([set(added(20), 10, { setType: 'warmup' }), set(added(40), 20), set(added(60), 20, { exclusions: ['pain'] }), set(added(60), 15), set(added(60), null)])]),
    ]);
    const one = ss.sessions[0];
    if (one === undefined) throw new Error('no session');
    expect(sessionTotalDistance(one, ss)).toMatchObject({ value: 55, kind: 'actual', fromSet: null });
  });

  it('total: a unilateral carry counts the busier side, never both sides added', () => {
    const ss = onlySeries(
      [session('2026-10-01', [carryRow([set(kg(24, 'per_hand'), 40, { side: 'left' }), set(kg(24, 'per_hand'), 30, { side: 'right' }), set(kg(24, 'per_hand'), 20, { side: 'both' })], { laterality: 'unilateral' })])],
      'farmers-carry',
    );
    const one = ss.sessions[0];
    if (one === undefined) throw new Error('no session');
    expect(sessionTotalDistance(one, ss)?.value).toBe(60);
  });

  it('best: the longest counted set, then the heavier load; a marked set is not counted', () => {
    const ss = onlySeries([session('2026-10-01', [sledRow([set(added(40), 25), set(added(80), 25), set(added(20), 50, { exclusions: ['spotted'] })])])]);
    const one = ss.sessions[0];
    if (one === undefined) throw new Error('no session');
    const b = sessionBestDistance(one, ss);
    expect(b).toMatchObject({ value: 25, kind: 'actual' });
    expect(b?.fromSet?.load).toEqual(added(80));
  });

  it('best distance by load: one row per load, heaviest first, no load last; another unit is left out', () => {
    const ss = onlySeries([
      session('2026-09-20', [sledRow([set(added(40), 20), set(added(0), 50), set(lb(90, 'added'), 100)])]),
      session('2026-10-01', [sledRow([set(added(40), 30), set(added(80), 15), set(null, 60), set(added(100), 40, { exclusions: ['technique'] })])]),
    ]);
    expect(distanceTableByLoad(ss, ALL).map((r) => [r.load, r.distanceM, r.date])).toEqual([
      [80, 15, '2026-10-01'],
      [40, 30, '2026-10-01'],
      [null, 60, '2026-10-01'],
    ]);
  });

  it('the trend: one point per session, best and change in metres; all-marked sessions are not counted for best only', () => {
    const ss = onlySeries([
      session('2026-09-01', [sledRow([set(added(40), 20), set(added(40), 20)])]),
      session('2026-09-15', [sledRow([set(added(60), 20, { exclusions: ['pain'] })])]),
      session('2026-10-01', [sledRow([set(added(60), 25), set(added(60), 25), set(added(60), 25)])]),
    ]);
    const total = exerciseTrend(ss, 'total_distance', '6m', TODAY);
    expect(total.points.map((p) => p.value)).toEqual([40, 20, 75]);
    expect(total.markers.filter((m) => m.kind === 'not_counted')).toEqual([]);
    const best = exerciseTrend(ss, 'best_distance', '6m', TODAY);
    expect(best.points.map((p) => p.value)).toEqual([20, 25]);
    expect(best.markers.filter((m) => m.kind === 'not_counted')).toHaveLength(1);
    expect(trendRangeBounds('6m', TODAY, null).to).toBe(TODAY);
  });
});

describe('exercise detail for a distance series', () => {
  const sessions = () => [
    session('2026-09-01', [sledRow([set(added(40), 20), set(added(40), 20)])]),
    session('2026-09-15', [sledRow([set(added(60), 20), set(added(60), 20, { exclusions: ['pain'] })])]),
    session('2026-10-01', [sledRow([set(added(60), 25), set(added(0), 40)])]),
  ];

  it('labelled metrics in metres, no Est. 1RM anywhere, no rep table or records', () => {
    const v = buildExerciseDetailView({ sessions: sessions(), exerciseId: 'sled-push', today: TODAY });
    if (v === null) throw new Error('no view');
    expect(v.metrics.map((m) => m.label)).toEqual(['Total distance', 'Best distance']);
    expect(v.metric).toBe('total_distance');
    expect(v.estimateInfo).toBe(false);
    expect(v.axisUnit).toBe('m');
    expect(v.axisFormat).toBe('number');
    expect(v.bars).toBe(false);
    expect(sp(v.heading)).toBe('Total distance · 9 Apr – 8 Oct');
    expect(v.points.map((p) => sp(p.display))).toEqual(['40 m', '40 m', '65 m']);
    expect(v.points[1]?.notes).toContain('1 marked set included');
    expect(v.panel.map((l) => `${l.label} ${sp(l.value) ?? ''}`)).toEqual(['Latest 65 m · 1 Oct', 'Best 65 m · 1 Oct', 'Change Up 25 m since 1 Sep']);
    expect(v.stats.map((s) => [sp(s.value), s.label])).toEqual([
      ['40 m', 'BEST DISTANCE'],
      ['145 m', 'TOTAL DISTANCE'],
      ['3', 'SESSIONS'],
    ]);
    expect(v.statsWords).toBe('Best distance 40 metres. Total distance 145 metres. 3 sessions.');
    expect(v.repTable).toBeNull();
    expect(v.records).toBeNull();
    expect(v.table.headers).toEqual(['Date', 'Total distance', 'Notes']);
    expect(JSON.stringify(v)).not.toMatch(/1RM|≈/);
    expect(v.history.unit).toBe('kg added × m');
    expect(sp(v.history.months[0]?.rows[0]?.sets)).toBe('60×25 m · 40 m');
  });

  it('Best distance shows the load the set was done with; the BEST DISTANCE table lists each load', () => {
    const v = buildExerciseDetailView({ sessions: sessions(), exerciseId: 'sled-push', today: TODAY, metric: 'best_distance' });
    if (v === null) throw new Error('no view');
    expect(v.points.map((p) => sp(p.display))).toEqual(['40 kg × 20 m', '60 kg × 20 m', '40 m']);
    expect(v.points[0]?.words).toBe('Tuesday 1 September, best distance 20 metres with 40 kilograms.');
    expect(v.distanceTable?.headers).toEqual(['Weight', 'Distance', 'Date']);
    expect(v.distanceTable?.rows.map((r) => r.cells.map(sp))).toEqual([
      ['60 kg', '25 m', '1 Oct'],
      ['40 kg', '20 m', '1 Sep'],
      ['No load', '40 m', '1 Oct'],
    ]);
    expect(v.distanceTable?.rows[0]?.words).toBe('60 kilograms, 25 metres, 1 October.');
  });

  it('a per-hand carry in lb says each, in lb', () => {
    const v = buildExerciseDetailView({
      sessions: [session('2026-10-01', [carryRow([set(lb(50, 'per_hand'), 40), set(lb(60, 'per_hand'), 30)], { unit: 'lb' })])],
      exerciseId: 'farmers-carry',
      today: TODAY,
      metric: 'best_distance',
    });
    if (v === null) throw new Error('no view');
    expect(sp(v.points[0]?.display)).toBe('50 lb each × 40 m');
    expect(v.points[0]?.words).toContain('40 metres with 50 pounds each');
    expect(v.distanceTable?.rows.map((r) => sp(r.cells[0]))).toEqual(['60 lb each', '50 lb each']);
    expect(v.history.unit).toBe('lb each × m');
  });

  it('compact history text: load × metres, metres alone with no load, marked sets tagged', () => {
    const ss = onlySeries([session('2026-10-01', [sledRow([set(added(40), 20)])])]);
    expect(sp(compactSetText(set(added(40), 1500), ss))).toBe('40×1.5 km');
    expect(sp(compactSetText(set(added(0), 20), ss))).toBe('20 m');
    expect(sp(compactSetText(set(null, 20, { exclusions: ['pain'] }), ss))).toMatch(/^20 m \(.+\)$/);
  });

  it('home records leave distance sets out (no heaviest-set record from a sled)', () => {
    const r = recordsInWindow(
      [
        session('2026-09-01', [sledRow([set(added(40), 20)])]),
        session('2026-09-10', [sledRow([set(added(60), 20)])]),
        session('2026-09-20', [sledRow([set(added(80), 20)])]),
        session('2026-10-01', [sledRow([set(added(100), 20, { reps: 1 })])]),
      ],
      { from: '2026-09-01', to: TODAY },
    );
    expect(r.items).toEqual([]);
  });
});

describe('distance: load at the same distance, plate-loaded sleds, unloaded series (review misc-fixes S1, S2)', () => {
  const plateRow = (sets: ProgressSet[]) => sledRow(sets, { equipmentId: 'sled-1', equipmentKind: 'plate_loaded_machine', equipmentName: 'Prowler' });

  it('Best distance: the same metres with more load reads as more load, not "Same as"', () => {
    const sessions = [session('2026-09-01', [sledRow([set(added(40), 25)])]), session('2026-10-01', [sledRow([set(added(80), 25)])])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'sled-push', today: TODAY, metric: 'best_distance' });
    if (v === null) throw new Error('no view');
    const change = v.panel.find((l) => l.label === 'Change');
    expect(sp(change?.value)).toBe('Same distance, 40 kg more than 1 Sep');
    expect(change?.words).toBe('Same distance, 40 kilograms more than 1 September');
    expect(change?.direction).toBe('up');
  });

  it('Best distance: the same metres with less load reads down; the same load reads "Same as"', () => {
    const less = buildExerciseDetailView({
      sessions: [session('2026-09-01', [sledRow([set(added(80), 25)])]), session('2026-10-01', [sledRow([set(added(60), 25)])])],
      exerciseId: 'sled-push',
      today: TODAY,
      metric: 'best_distance',
    });
    const c1 = less?.panel.find((l) => l.label === 'Change');
    expect(sp(c1?.value)).toBe('Same distance, 20 kg less than 1 Sep');
    expect(c1?.direction).toBe('down');
    const same = buildExerciseDetailView({
      sessions: [session('2026-09-01', [sledRow([set(added(60), 25)])]), session('2026-10-01', [sledRow([set(added(60), 25)])])],
      exerciseId: 'sled-push',
      today: TODAY,
      metric: 'best_distance',
    });
    const c2 = same?.panel.find((l) => l.label === 'Change');
    expect(sp(c2?.value)).toBe('Same as 1 Sep');
    expect(c2?.direction).toBe('same');
  });

  it('Best distance: a per-hand carry at the same metres says each, in lb', () => {
    const v = buildExerciseDetailView({
      sessions: [session('2026-09-01', [carryRow([set(lb(50, 'per_hand'), 40)], { unit: 'lb' })]), session('2026-10-01', [carryRow([set(lb(60, 'per_hand'), 40)], { unit: 'lb' })])],
      exerciseId: 'farmers-carry',
      today: TODAY,
      metric: 'best_distance',
    });
    const c = v?.panel.find((l) => l.label === 'Change');
    expect(sp(c?.value)).toBe('Same distance, 10 lb more each than 1 Sep');
    expect(c?.words).toBe('Same distance, 10 pounds more each than 1 September');
  });

  it('Total distance: the same metres with more load still reads "Same as" (load is not part of the total)', () => {
    const sessions = [session('2026-09-01', [sledRow([set(added(40), 25)])]), session('2026-10-01', [sledRow([set(added(80), 25)])])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'sled-push', today: TODAY, metric: 'total_distance' });
    expect(sp(v?.panel.find((l) => l.label === 'Change')?.value)).toBe('Same as 1 Sep');
  });

  it('a plate-loaded sled reads kg plates in points, StatStrip, table and history; 0 kg reads the same way everywhere', () => {
    const sessions = [session('2026-09-01', [plateRow([set(added(0), 30)])]), session('2026-10-01', [plateRow([set(added(40), 25), set(added(0), 20)])])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'sled-push', today: TODAY, metric: 'best_distance' });
    if (v === null) throw new Error('no view');
    expect(v.points.map((p) => sp(p.display))).toEqual(['0 kg plates × 30 m', '40 kg plates × 25 m']);
    expect(sp(v.stats[0]?.value)).toBe('0 kg plates × 30 m');
    expect(v.distanceTable?.rows.map((r) => r.cells.map(sp))).toEqual([
      ['40 kg plates', '25 m', '1 Oct'],
      ['0 kg plates', '30 m', '1 Sep'],
    ]);
    expect(v.history.unit).toBe('kg plates × m');
    expect(sp(v.history.months[0]?.rows[0]?.sets)).toBe('40×25 m · 0×20 m');
    expect(JSON.stringify(v)).not.toMatch(/No load|BW \+/);
  });

  it('a bodyweight-convention distance series (walking lunge): metres alone, history in m, no load table', () => {
    const lunge = (sets: ProgressSet[]) => sledRow(sets, { exerciseId: 'walking-lunge', exerciseName: 'Walking lunge', convention: 'bodyweight' });
    const sessions = [session('2026-09-01', [lunge([set(null, 30), set(null, 40)])]), session('2026-10-01', [lunge([set(null, 50)])])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'walking-lunge', today: TODAY, metric: 'best_distance' });
    if (v === null) throw new Error('no view');
    expect(v.points.map((p) => sp(p.display))).toEqual(['40 m', '50 m']);
    expect(v.stats.map((s) => [sp(s.value), s.label])).toEqual([
      ['50 m', 'BEST DISTANCE'],
      ['120 m', 'TOTAL DISTANCE'],
      ['2', 'SESSIONS'],
    ]);
    expect(v.history.unit).toBe('m');
    expect(sp(v.history.months[0]?.rows[0]?.sets)).toBe('50 m');
    expect(v.distanceTable?.rows.map((r) => r.cells[0])).toEqual(['No load']);
    expect(JSON.stringify([v.stats, v.points, v.panel, v.table, v.distanceTable, v.history])).not.toMatch(/kg|1RM|≈|BW/);
  });

  it('headline: equal metres across sessions, the heavier wins whichever came first', () => {
    const later = onlySeries([session('2026-09-01', [sledRow([set(added(40), 25)])]), session('2026-10-01', [sledRow([set(added(80), 25)])])]);
    expect(exerciseHeadline(later).bestDistance).toMatchObject({ date: '2026-10-01', set: { distanceM: 25, load: added(80) } });
    const earlier = onlySeries([session('2026-09-01', [sledRow([set(added(80), 25)])]), session('2026-10-01', [sledRow([set(added(40), 25)])])]);
    expect(exerciseHeadline(earlier).bestDistance).toMatchObject({ date: '2026-09-01', set: { distanceM: 25, load: added(80) } });
    const longer = onlySeries([session('2026-09-01', [sledRow([set(added(80), 25)])]), session('2026-10-01', [sledRow([set(added(20), 26)])])]);
    expect(exerciseHeadline(longer).bestDistance).toMatchObject({ date: '2026-10-01', set: { distanceM: 26 } });
  });

  it('BEST DISTANCE with nothing in range is an empty table (the screen says "None in this range."), not hidden', () => {
    const v = buildExerciseDetailView({ sessions: [session('2025-01-10', [sledRow([set(added(40), 25)])])], exerciseId: 'sled-push', today: TODAY, metric: 'best_distance', range: '3m' });
    if (v === null) throw new Error('no view');
    expect(v.range).toBe('3m');
    expect(v.distanceTable).not.toBeNull();
    expect(v.distanceTable?.rows).toEqual([]);
  });

  it('Total distance on All with a long history: one point per week, the week’s best session total', () => {
    const sessions: ProgressSession[] = [];
    // 90 weeks, Monday and Thursday: 180 sessions, over TREND_MAX_POINTS.
    const monday0 = Date.parse('2024-12-30T00:00:00Z');
    for (let w = 0; w < 90; w += 1) {
      const mon = new Date(monday0 + w * 7 * 86_400_000).toISOString().slice(0, 10);
      const thu = new Date(monday0 + (w * 7 + 3) * 86_400_000).toISOString().slice(0, 10);
      sessions.push(session(mon, [sledRow([set(added(40), 50), set(added(40), 50)])]));
      sessions.push(session(thu, [sledRow([set(added(40), 101 + w)])]));
    }
    const ss = onlySeries(sessions);
    const t = exerciseTrend(ss, 'total_distance', 'all', TODAY);
    expect(t.aggregation).toBe('weekly_best');
    expect(t.points).toHaveLength(90);
    expect(t.points[0]).toMatchObject({ date: '2025-01-02', value: 101 });
    expect(t.points[89]?.value).toBe(190);
    // Every week's best is its Thursday (101 m and up), never a Monday's 100 m.
    expect(t.points.every((p) => p.value >= 101 && new Date(`${p.date}T00:00:00Z`).getUTCDay() === 4)).toBe(true);
  });
});

describe('distance: equal metres across sessions, longer then heavier everywhere (review misc-fixes-r2 S1)', () => {
  it('the panel Best line and the StatStrip pick the same heavier set, whichever came first', () => {
    const later = buildExerciseDetailView({
      sessions: [session('2026-09-01', [sledRow([set(added(40), 25)])]), session('2026-10-01', [sledRow([set(added(80), 25)])])],
      exerciseId: 'sled-push',
      today: TODAY,
      metric: 'best_distance',
    });
    if (later === null) throw new Error('no view');
    expect(sp(later.stats[0]?.value)).toBe('80 kg × 25 m');
    expect(sp(later.panel.find((l) => l.label === 'Best')?.value)).toBe('80 kg × 25 m · 1 Oct');
    const earlier = buildExerciseDetailView({
      sessions: [session('2026-09-01', [sledRow([set(added(80), 25)])]), session('2026-10-01', [sledRow([set(added(40), 25)])])],
      exerciseId: 'sled-push',
      today: TODAY,
      metric: 'best_distance',
    });
    expect(sp(earlier?.stats[0]?.value)).toBe('80 kg × 25 m');
    expect(sp(earlier?.panel.find((l) => l.label === 'Best')?.value)).toBe('80 kg × 25 m · 1 Sep');
  });

  it('equal metres and equal load keep the earlier session as Best; longer still beats heavier', () => {
    const tie = exerciseTrend(onlySeries([session('2026-09-01', [sledRow([set(added(60), 25)])]), session('2026-10-01', [sledRow([set(added(60), 25)])])]), 'best_distance', 'all', TODAY);
    expect(tie.summary.best?.date).toBe('2026-09-01');
    const longer = exerciseTrend(onlySeries([session('2026-09-01', [sledRow([set(added(80), 25)])]), session('2026-10-01', [sledRow([set(added(20), 26)])])]), 'best_distance', 'all', TODAY);
    expect(longer.summary.best).toMatchObject({ date: '2026-10-01', value: 26 });
  });

  it('weekly-best chart points pick the heavier set at equal metres', () => {
    const sessions: ProgressSession[] = [];
    // 90 weeks, Monday 40 kg × 25 m and Thursday 80 kg × 25 m (and the reverse every other week).
    const monday0 = Date.parse('2024-12-30T00:00:00Z');
    for (let w = 0; w < 90; w += 1) {
      const mon = new Date(monday0 + w * 7 * 86_400_000).toISOString().slice(0, 10);
      const thu = new Date(monday0 + (w * 7 + 3) * 86_400_000).toISOString().slice(0, 10);
      const [a, b] = w % 2 === 0 ? [40, 80] : [80, 40];
      sessions.push(session(mon, [sledRow([set(added(a), 25)])]));
      sessions.push(session(thu, [sledRow([set(added(b), 25)])]));
    }
    const t = exerciseTrend(onlySeries(sessions), 'best_distance', 'all', TODAY);
    expect(t.aggregation).toBe('weekly_best');
    expect(t.points).toHaveLength(90);
    expect(t.points.every((p) => p.value === 25 && p.fromSet?.load?.value === 80)).toBe(true);
  });
});
