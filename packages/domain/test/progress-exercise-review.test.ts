import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import {
  buildExerciseDetailView,
  buildProgressHomeView,
  collectExerciseSeries,
  exerciseRecords,
  exerciseTrend,
  leastAssistRecords,
  mondayOf,
  seriesKindLabel,
  TREND_MAX_POINTS,
  type ExerciseSeries,
  type MuscleInfo,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
  toProgressSession,
} from '../src/index';
import { at, kg, lb, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Review progress-B fixes: B1 (Latest and Change are sessions under weekly
 * bests), S1 (assisted records; timed has no records section), S2 (opening on
 * an old workout widens the range), S3 (FitNotes label collisions), S4
 * (overview `History` prefers this gym's equipment), S5 (home lists 3 records
 * then `All records (n)`), N1, N2, N4, and weekly bests by local date.
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

function addDaysIso(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

describe('B1: under weekly bests, Latest and Change describe sessions', () => {
  // 2 Jan 2023 is a Monday. Two sessions a week (Mon heavy, Thu light) up to Mon 5 Oct 2026 and Thu 8 Oct 2026.
  const sessions: ProgressSession[] = [];
  for (let w = 0; ; w += 1) {
    const mon = addDaysIso('2023-01-02', w * 7);
    if (mon > TODAY) break;
    sessions.push(bench(mon, [[140, 5]]));
    const thu = addDaysIso(mon, 3);
    if (thu <= TODAY) sessions.push(bench(thu, [[100, 5]]));
  }

  it('the latest is the last session (8 Oct, ≈116.5 kg), not the week’s best (5 Oct, ≈163.5 kg)', () => {
    expect(sessions.length).toBeGreaterThan(TREND_MAX_POINTS);
    const series = collectExerciseSeries(sessions, 'bench')[0] as ExerciseSeries;
    const t = exerciseTrend(series, 'e1rm', 'all', TODAY);
    expect(t.aggregation).toBe('weekly_best');
    expect(t.points.at(-1)?.date).toBe('2026-10-05');
    expect(t.summary.latest?.date).toBe('2026-10-08');
    expect(t.summary.latest?.value).toBe(116.5);
    expect(t.summary.first?.date).toBe('2023-01-02');
    expect(t.summary.best?.value).toBe(163.5);

    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, range: 'all' });
    if (!v) throw new Error('view');
    expect(v.heading.endsWith('· weekly best')).toBe(true);
    expect(sp(v.panel.find((l) => l.label === 'Latest')?.value)).toBe('≈116.5 kg · 8 Oct');
    // First session in range was 2 Jan 2023 (140 × 5 → 163.5); the last 100 × 5 → 116.5.
    expect(sp(v.panel.find((l) => l.label === 'Change')?.value)).toBe('Down ≈47 kg since 2 Jan 2023');
    expect(v.chartWords).toContain('latest about 116.5 kilograms on 8 October');
  });

  it('weekly bests group by the local date: a Sunday-evening session stays in its own Monday–Sunday week', () => {
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // Monday
    // Sunday 23:30 in London is Monday in UTC+1 terms only if read wrong; the projected local `date` decides.
    const many: ProgressSession[] = [];
    for (let i = 0; i < TREND_MAX_POINTS + 10; i += 1) many.push(bench(addDaysIso('2026-01-05', i), [[100, 5]]));
    const late = session('2026-10-04', [row([set(kg(150), 5)])], { startedMs: Date.parse('2026-10-04T22:30:00.000Z'), startedAtUtc: '2026-10-04T22:30:00.000Z' });
    const t = exerciseTrend(collectExerciseSeries([...many, late], 'bench')[0] as ExerciseSeries, 'e1rm', 'all', TODAY);
    expect(t.aggregation).toBe('weekly_best');
    expect(t.points.find((p) => p.sessionId === late.sessionId)?.date).toBe('2026-10-04');
  });

  it('a session at 23:30Z on Sunday is Monday in London and Sunday in Los Angeles: the projected local date picks the week (r2 N2)', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(setsFor(s, BENCH)[1]?.id ?? '', values(kg(150), 5), 60));
    s = apply(s, { type: 'finish', at: at(3600), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const sunday = { ...s, session: { ...s.session, startedAt: { utc: '2026-10-04T23:30:00.000Z', tz: 'Europe/London' } } };
    const london = toProgressSession(sunday, 'Europe/London', 0);
    const la = toProgressSession(sunday, 'America/Los_Angeles', 0);
    if (!london || !la) throw new Error('projection');
    expect([london.date, la.date]).toEqual(['2026-10-05', '2026-10-04']);
    // Light daily sessions (100 × 5) from January push the chart to weekly bests; the 150 × 5 is the best of whichever week it lands in.
    const benchRow = london.exercises.find((e) => e.exerciseId === BENCH) as ProgressExercise;
    const many: ProgressSession[] = [];
    for (let i = 0; i < TREND_MAX_POINTS + 10; i += 1) {
      const date = addDaysIso('2026-01-05', i);
      many.push({ ...london, sessionId: `light-${date}`, date, startedMs: Date.parse(`${date}T17:00:00.000Z`), exercises: [{ ...benchRow, sets: [set(kg(100), 5)] }] });
    }
    const weekOf = (p: ProgressSession) => {
      const all = collectExerciseSeries([...many, p], BENCH);
      expect(all).toHaveLength(1);
      const t = exerciseTrend(all[0] as ExerciseSeries, 'top_set', 'all', TODAY);
      expect(t.aggregation).toBe('weekly_best');
      const point = t.points.find((x) => x.sessionId === p.sessionId);
      return point === undefined ? null : mondayOf(point.date);
    };
    expect(weekOf(london)).toBe('2026-10-05');
    expect(weekOf(la)).toBe('2026-09-28');
  });
});

describe('S1: assisted records; timed has no records section', () => {
  const asst = (d: string, l: number, reps = 8, over: Partial<ProgressSet> = {}) =>
    session(d, [row([set(kg(l, 'assistance'), reps, over)], { exerciseId: 'chin', exerciseName: 'Assisted pull-up', convention: 'assistance', equipmentKind: 'assisted_stack', equipmentId: 'as', equipmentName: 'Assist machine' })]);

  it('five sessions from 30 to 15 kg of assistance: `Least assistance for 8+ reps` records, newest first', () => {
    const sessions = [asst('2026-09-01', 30), asst('2026-09-04', 27.5), asst('2026-09-07', 25), asst('2026-09-10', 20), asst('2026-10-02', 15)];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'chin', today: TODAY });
    expect(v?.records?.items.map((r) => sp(`${r.label}  ${r.value} · ${r.date}`))).toEqual(['Least assistance for 8+ reps  15 kg · 2 Oct', 'Least assistance for 8+ reps  20 kg · 10 Sep']);
    expect(v?.records?.empty).toBeNull();
    expect(v?.records?.items[0]?.words).toBe('Least assistance for 8 or more reps, 15 kilograms of assistance, 8 reps, 2 October.');
  });

  it('only sets of 8+ reps count, marked sets never do, and an equal value is not a record', () => {
    const base = [asst('2026-09-01', 30), asst('2026-09-04', 30), asst('2026-09-07', 30)];
    expect(leastAssistRecords([...base, asst('2026-09-10', 15, 6)])).toEqual([]);
    expect(leastAssistRecords([...base, asst('2026-09-10', 15, 8, { exclusions: ['spotted'] })])).toEqual([]);
    expect(leastAssistRecords([...base, asst('2026-09-10', 30, 10)])).toEqual([]);
    expect(leastAssistRecords([...base, asst('2026-09-10', 25, 12)]).map((r) => [r.value, r.reps])).toEqual([[25, 12]]);
    // Fewer than 3 earlier sessions: none.
    expect(leastAssistRecords([asst('2026-09-01', 30), asst('2026-09-04', 25), asst('2026-09-07', 20)])).toEqual([]);
  });

  it('an imported set with as little assistance or less (converted) suppresses the claim', () => {
    const base = [asst('2026-09-01', 30), asst('2026-09-04', 30), asst('2026-09-07', 30), asst('2026-09-10', 20)];
    const imp = (l: Load) => imported('2025-01-01', [row([set(l, 8)], { exerciseId: 'chin', convention: 'assistance', unit: l.unit })]);
    expect(leastAssistRecords([imp(kg(20, 'assistance')), ...base])).toEqual([]);
    expect(leastAssistRecords([imp(lb(40, 'assistance')), ...base])).toEqual([]); // 40 lb ≈ 18.1 kg
    expect(leastAssistRecords([imp(kg(22.5, 'assistance')), ...base]).map((r) => r.value)).toEqual([20]);
  });

  it('kg and lb assisted series keep their own records', () => {
    const lbAsst = (d: string, l: number) => session(d, [row([set(lb(l, 'assistance'), 8)], { exerciseId: 'chin', convention: 'assistance', unit: 'lb', equipmentKind: 'assisted_stack', equipmentId: 'as' })]);
    const sessions = [asst('2026-09-01', 30), asst('2026-09-04', 30), asst('2026-09-07', 30), lbAsst('2026-09-08', 20), asst('2026-09-10', 25)];
    const kgSeries = collectExerciseSeries(sessions, 'chin').find((s) => s.key.unit === 'kg') as ExerciseSeries;
    expect(exerciseRecords(sessions, kgSeries).items.map((r) => [r.kind, r.value])).toEqual([['least_assist', 25]]);
  });

  it('a timed series has no records section (no record is defined for holds)', () => {
    const hold = (d: string, s: number) => session(d, [row([set(null, null, { durationS: s })], { exerciseId: 'plank', convention: 'bodyweight', measurement: 'duration', equipmentId: null, equipmentKind: null })]);
    const v = buildExerciseDetailView({ sessions: [hold('2026-09-01', 60), hold('2026-09-03', 60), hold('2026-09-05', 60), hold('2026-09-07', 90)], exerciseId: 'plank', today: TODAY });
    expect(v?.records).toBeNull();
  });
});

describe('S2: opening on an older workout widens the range to include it', () => {
  const sessions = [bench('2025-03-01', [[90, 5]]), bench('2025-11-01', [[95, 5]]), bench('2026-09-01', [[100, 5]]), bench('2026-10-01', [[100, 5]])];

  it('a workout before `6 mo` opens on `1 yr`, one before `1 yr` on `All`, with its point selected', () => {
    const nov = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, sessionId: sessions[1]?.sessionId ?? null });
    expect(nov?.range).toBe('1y');
    expect(nov?.selectedSessionId).toBe(sessions[1]?.sessionId);
    const mar = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, sessionId: sessions[0]?.sessionId ?? null, range: '3m' });
    expect(mar?.range).toBe('all');
    expect(mar?.selectedSessionId).toBe(sessions[0]?.sessionId);
  });

  it('a workout already in range keeps the asked range; no workout keeps the default', () => {
    expect(buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, sessionId: sessions[3]?.sessionId ?? null, range: '3m' })?.range).toBe('3m');
    expect(buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY })?.range).toBe('6m');
    expect(buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, range: '1y' })?.range).toBe('1y');
  });

  it('an imported workout from years ago opens the one series on `All` (20 Oct: imports merged)', () => {
    const imp = imported('2021-05-05', [row([set(kg(80), 5)])]);
    const v = buildExerciseDetailView({ sessions: [imp, ...sessions], exerciseId: 'bench', today: TODAY, sessionId: imp.sessionId });
    expect(v?.seriesSource).toBe('app');
    expect(v?.series).toHaveLength(1);
    expect(v?.range).toBe('all');
    expect(v?.selectedSessionId).toBe(imp.sessionId);
  });
});

describe('r2 S1: opening an old workout under weekly bests selects its week', () => {
  // Mon 140 × 5 and Thu 100 × 5 every week from 2 Jan 2023: `All` has more than 150 sessions, so weekly bests.
  const sessions: ProgressSession[] = [];
  for (let w = 0; ; w += 1) {
    const mon = addDaysIso('2023-01-02', w * 7);
    if (mon > TODAY) break;
    sessions.push(bench(mon, [[140, 5]]));
    const thu = addDaysIso(mon, 3);
    if (thu <= TODAY) sessions.push(bench(thu, [[100, 5]]));
  }
  const thursday = (date: string) => sessions.find((x) => x.date === date) as ProgressSession;

  for (const date of ['2023-03-09', '2025-06-12']) {
    it(`a Thursday (${date}) that isn't its week's best: the week's point is selected, the panel is the workout's own value`, () => {
      const opened = thursday(date);
      const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, sessionId: opened.sessionId });
      if (!v) throw new Error('view');
      expect(v.range).toBe('all');
      expect(v.heading.endsWith('· weekly best')).toBe(true);
      expect(v.points.some((p) => p.sessionId === opened.sessionId)).toBe(false);
      expect(v.selectedSessionId).toBe(opened.sessionId);
      const sel = v.selection;
      if (!sel) throw new Error('selection');
      // The highlighted point is that week's Monday (140 × 5).
      expect(v.points[sel.index]?.date).toBe(mondayOf(date));
      expect(sp(v.points[sel.index]?.display)).toBe('≈163.5 kg');
      // The panel describes the opened Thursday, and `Open workout ›` goes to it.
      expect(sel.point.sessionId).toBe(opened.sessionId);
      expect(sel.point.date).toBe(date);
      expect(sp(sel.point.display)).toBe('≈116.5 kg');
      expect(sel.point.title.startsWith('Thu')).toBe(true);
      expect(sp(sel.point.detail)).toBe('Est. 1RM  ≈116.5 kg  from 100 kg × 5');
      // The panel's tag and VoiceOver say what the highlighted point is (r3 S1).
      expect(sp(sel.weekBest?.text)).toBe('Week best ≈163.5 kg');
      expect(sel.weekBest?.words).toMatch(/^Week best about 163\.5 kilograms, Monday \d+ \w+/);
    });
  }

  it('an opened Thursday with every set marked has nothing to select under weekly bests (r3)', () => {
    const marked = session('2025-06-12', [row([set(kg(100), 5, { exclusions: ['pain'] }), set(kg(100), 5, { exclusions: ['pain'] })])]);
    const all = [...sessions.filter((x) => x.date !== '2025-06-12'), marked];
    const v = buildExerciseDetailView({ sessions: all, exerciseId: 'bench', today: TODAY, sessionId: marked.sessionId });
    expect([v?.range, v?.selectedSessionId, v?.selection]).toEqual(['all', null, null]);
    expect(v?.heading.endsWith('· weekly best')).toBe(true);
  });

  it('the week’s best workout selects its own point; a later fetch with `selectSessionId` keeps the selection without choosing the range', () => {
    const mon = sessions.find((x) => x.date === '2025-06-09') as ProgressSession;
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, sessionId: mon.sessionId });
    expect(v?.selection?.point.sessionId).toBe(mon.sessionId);
    expect(v?.selection?.weekBest).toBeNull();
    expect(v?.points[v.selection?.index ?? -1]?.sessionId).toBe(mon.sessionId);
    const thu = thursday('2025-06-12');
    const again = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, range: 'all', selectSessionId: thu.sessionId });
    expect(again?.selectedSessionId).toBe(thu.sessionId);
    expect(again?.points[again.selection?.index ?? -1]?.date).toBe('2025-06-09');
    // `selectSessionId` doesn't widen: on the default `6 mo` the June 2025 workout isn't shown, so nothing is selected.
    const narrow = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, selectSessionId: thu.sessionId });
    expect([narrow?.range, narrow?.selectedSessionId, narrow?.selection]).toEqual(['6m', null, null]);
  });
});

describe('20 Oct: one series per kind, labelled by kind only', () => {
  it('imports of one kind join the logged series; kinds that can’t share an axis stay apart with a kind word', () => {
    const sessions = [
      imported('2025-01-01', [row([set(kg(100), 5)])]),
      imported('2025-01-02', [row([set(kg(50, 'stack'), 10)], { convention: 'stack' })]),
      imported('2025-01-03', [row([set(null, 12)], { convention: 'bodyweight' })]),
      imported('2025-01-04', [row([set(null, null, { durationS: 30 })], { convention: 'bodyweight', measurement: 'duration' })]),
      imported('2025-01-05', [row([set(lb(225), 5)], { unit: 'lb' })]),
    ];
    const all = collectExerciseSeries(sessions, 'bench', { unit: 'kg' });
    // Total, stack and lb are all `load`: one series. Bodyweight and timed are their own.
    expect(all.map((x) => [x.kind, x.sessions.length])).toEqual([
      ['load', 3],
      ['bodyweight', 1],
      ['timed', 1],
    ]);
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, unit: 'kg' });
    expect(v?.series.map((x) => x.label).sort()).toEqual(['Bodyweight', 'Timed', 'Weighted']);
    expect(v?.series.some((x) => /History|FitNotes|\(\d\)/.test(x.menuLabel))).toBe(false);
  });

  it('every kind has a word', () => {
    expect(['load', 'assisted', 'added_bodyweight', 'bodyweight', 'timed', 'distance', 'cardio'].map((k) => seriesKindLabel(k as never))).toEqual(['Weighted', 'Assisted', 'Bodyweight + weight', 'Bodyweight', 'Timed', 'Distance', 'Cardio']);
  });
});

describe('S4 and N2: which series opens', () => {
  const sessions = [
    bench('2026-09-01', [[100, 5]]),
    bench('2026-09-02', [[100, 5]]),
    session('2026-09-03', [row([set(kg(30, 'per_hand'), 10)], { equipmentId: 'db-h', equipmentKind: 'dumbbells', equipmentName: 'Dumbbells', gymId: 'gym-2', convention: 'per_hand' })]),
  ];

  it('overview `History` at Hotel Gym: barbell and dumbbells are one series; each point reads in its own convention', () => {
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, equipmentId: 'db-h', metric: 'top_set' });
    expect(v?.series).toHaveLength(1);
    expect(v?.seriesLabel).toBe('');
    // Mixed conventions: plain unit on the axis, `each` on the dumbbell point; never converted between them.
    expect(v?.axisUnit).toBe('kg');
    expect(v?.points.map((p) => sp(p.display))).toEqual(['100 kg × 5', '100 kg × 5', '30 kg each × 10']);
    expect(v?.points.map((p) => p.value)).toEqual([100, 100, 30]);
    expect(v?.repTable?.rows.map((r) => sp(r.cells[0]))).toEqual(['100 kg', '30 kg each']);
    expect(buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY, equipmentId: null, gymId: 'gym-3' })?.seriesId).toBe('bench|load');
  });

  it('a null equipmentId is no filter; the tapped Summary row picks its series', () => {
    const noEq = row([set(kg(20), 10)], { equipmentId: null, equipmentKind: null, equipmentName: null });
    const bar = row([set(kg(100), 5)]);
    const s = session('2026-09-05', [noEq, bar]);
    const plain = buildExerciseDetailView({ sessions: [s], exerciseId: 'bench', today: TODAY, sessionId: s.sessionId, equipmentId: null });
    // Both rows are the one series.
    expect(plain?.seriesId).toBe('bench|load');
    const tapped = buildExerciseDetailView({ sessions: [s], exerciseId: 'bench', today: TODAY, sessionId: s.sessionId, sessionExerciseId: bar.sessionExerciseId, equipmentId: null });
    expect(tapped?.seriesId).toBe('bench|load');
    expect(tapped?.selectedSessionId).toBe(s.sessionId);
  });
});

describe('S5: home lists 3 records, then `All records (n)`', () => {
  it('5 records: 3 shown first, `All records (5)` lists the rest', () => {
    const lift = (id: string, name: string) => (d: string, l: number) => session(d, [row([set(kg(l), 5)], { exerciseId: id, exerciseName: name, equipmentId: `eq-${id}` })]);
    const lifts = ['a', 'b', 'c', 'd', 'e'].map((id) => lift(id, `Lift ${id}`));
    const sessions = lifts.flatMap((f, i) => [f('2026-08-01', 50), f('2026-08-04', 50), f('2026-08-07', 50), f(`2026-10-0${String(i + 1)}`, 60)]);
    const info = new Map<string, MuscleInfo>();
    const home = buildProgressHomeView({ sessions, exercises: info, today: TODAY, period: '1m', grouping: 'body_part', gymNames: GYMS });
    if (home.dataState !== 'normal') throw new Error('home');
    expect(home.records.items).toHaveLength(5);
    expect(home.records.initial).toBe(3);
    expect(home.records.more).toEqual({ label: 'All records (5)', words: 'All records, 5.' });
    expect(home.records.items[0]?.sessionExerciseId).toBeTruthy();
    const few = buildProgressHomeView({ sessions: sessions.filter((s) => !s.exercises.some((e) => e.exerciseId === 'a' || e.exerciseId === 'b')), exercises: info, today: TODAY, period: '1m', grouping: 'body_part' });
    if (few.dataState !== 'normal') throw new Error('home');
    expect(few.records.items).toHaveLength(3);
    expect(few.records.more).toBeNull();
  });
});

describe('N1 and N4: empty message and chart words', () => {
  it('every set of 10 reps or fewer marked: `No counted sets`, not `No sets of 10 reps or fewer`', () => {
    const v = buildExerciseDetailView({ sessions: [session('2026-09-01', [row([set(kg(100), 5, { exclusions: ['spotted'] })])])], exerciseId: 'bench', today: TODAY });
    expect(v?.chart).toMatchObject({ kind: 'too_few', message: 'No counted sets in this range.' });
    const high = buildExerciseDetailView({ sessions: [bench('2026-09-01', [[60, 12]])], exerciseId: 'bench', today: TODAY });
    expect(high?.chart).toEqual({ kind: 'no_eligible', message: 'No sets of 10 reps or fewer in this range.' });
  });

  it('the chart summary mentions edited and not-counted sessions', () => {
    const sessions = [bench('2026-09-01', [[100, 5]]), session('2026-09-03', [row([set(kg(100), 6, { edited: true })])]), bench('2026-09-05', [[100, 7]]), session('2026-09-07', [row([set(kg(105), 3, { exclusions: ['pain'] })])])];
    const v = buildExerciseDetailView({ sessions, exerciseId: 'bench', today: TODAY });
    expect(v?.chartWords).toContain('1 session edited, 1 session not counted.');
  });
});
