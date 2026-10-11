import { describe, expect, it } from 'vitest';
import type { Load, SessionAggregate } from '@fizz/schemas';

import {
  buildCalendarMonthView,
  buildProgressHomeView,
  countRowSets,
  countSessions,
  estimateOneRepMax,
  exerciseSplit,
  getActiveDurationMs,
  gymTimeText,
  hardSetKind,
  muscleFrequency,
  muscleGroupCredits,
  progressWindow,
  PROGRESS_DURATION_CAP_MS,
  recordsInWindow,
  setsText,
  setsWords,
  timeInGym,
  toProgressSession,
  type MuscleInfo,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
} from '../src/index';
import { at, kg, lb, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Progress slice A (progress.md §8 checks 1–14, 17, 23): windows, sessions,
 * time in gym, muscle frequency, records and Est. 1RM. Built on small
 * `ProgressSession` values; the projection from stored workouts is tested on
 * real aggregates at the end.
 */

/** Display text uses no-break spaces between numbers and units; compare with plain spaces. */
const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
const MIN = 60_000;
const H = 60 * MIN;
const TODAY = '2026-10-11'; // a Sunday

let n = 0;
function set(over: Partial<ProgressSet> = {}): ProgressSet {
  n += 1;
  return { setId: `set-${String(n)}`, setType: 'working', side: null, load: kg(100), reps: 8, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: n, ...over };
}

function row(exerciseId: string, sets: ProgressSet[], over: Partial<ProgressExercise> = {}): ProgressExercise {
  return {
    sessionExerciseId: `${exerciseId}-row-${String((n += 1))}`,
    exerciseId,
    exerciseName: exerciseId,
    equipmentId: 'bar-1',
    equipmentKind: 'barbell',
    gymId: 'gym-1',
    convention: 'total',
    unit: 'kg',
    measurement: 'reps',
    laterality: 'bilateral',
    sets,
    ...over,
  };
}

function session(date: string, over: Partial<ProgressSession> = {}): ProgressSession {
  const startedMs = Date.parse(`${date}T18:00:00.000Z`);
  return {
    sessionId: `s-${date}-${String((n += 1))}`,
    version: 3,
    source: 'manual',
    name: 'Push A',
    gymId: 'gym-1',
    startedAtUtc: new Date(startedMs).toISOString(),
    startedMs,
    tz: 'Europe/London',
    date,
    dateOnly: false,
    endedAtUtc: new Date(startedMs + 60 * MIN).toISOString(),
    durationMs: 60 * MIN,
    durationConfirmed: false,
    exercises: [],
    ...over,
  };
}

const imported = (date: string, over: Partial<ProgressSession> = {}) => session(date, { source: 'import', dateOnly: true, durationMs: null, endedAtUtc: null, name: null, gymId: null, ...over });

const INFO: ReadonlyMap<string, MuscleInfo> = new Map<string, MuscleInfo>([
  ['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps'] }],
  ['incline', { name: 'Incline press', movementPattern: 'horizontal_push', primaryMuscles: ['chest', 'upper_chest'], secondaryMuscles: ['front_delts'] }],
  ['row', { name: 'Single-arm row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['biceps'] }],
  ['squat', { name: 'Back squat', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], secondaryMuscles: ['hamstrings'] }],
  ['plank', { name: 'Plank', movementPattern: 'core', primaryMuscles: ['abs'] }],
  ['carry', { name: 'Farmer carry', movementPattern: 'carry', primaryMuscles: ['grip'] }],
  ['pinch', { name: 'Plate pinch', movementPattern: 'carry', primaryMuscles: [] }],
]);

/** Check 1's nine workouts, plus one on 11 Sep (previous window). */
const CHECK1 = ['2026-09-12', '2026-09-15', '2026-09-20', '2026-09-23', '2026-09-27', '2026-09-30', '2026-10-03', '2026-10-06', '2026-10-08'];

describe('windows and sessions (checks 1–3)', () => {
  it('30 days ends today inclusive; the previous window is the 30 days before', () => {
    const w = progressWindow(TODAY, 30);
    expect(w).toMatchObject({ from: '2026-09-12', to: '2026-10-11', previous: { from: '2026-08-13', to: '2026-09-11' } });
    expect(progressWindow(TODAY, 7)).toMatchObject({ from: '2026-10-05', to: TODAY });
  });

  it('check 1: 9 sessions in 30 days, 11 Sep counts only in the previous window, 7 days shows 2, the week bars read 1 · 2 · 2 · 2 · 2', () => {
    const sessions = [...CHECK1, '2026-09-11'].map((d) => session(d));
    const c30 = countSessions(sessions, progressWindow(TODAY, 30));
    expect(c30.count).toBe(9);
    expect(c30.previousCount).toBe(1);
    expect(c30.weeks?.map((w) => w.count)).toEqual([1, 2, 2, 2, 2]);
    expect(c30.weeks?.map((w) => w.from)).toEqual(['2026-09-12', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(c30.weeks?.[0]).toMatchObject({ to: '2026-09-13', partial: true });
    expect(c30.weeks?.[4]).toMatchObject({ partial: false });
    expect(c30.perWeek).toBe(2.1);
    expect(c30.days).toBeNull();
    expect(countSessions(sessions, progressWindow(TODAY, 7)).count).toBe(2);
  });

  it('check 2: for 30 and 60 days the bars always add up to the session count, and the first label is inside the window', () => {
    const sessions = Array.from({ length: 80 }, (_, i) => session(`2026-${String(8 + Math.floor(i / 31)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`));
    for (const today of ['2026-10-11', '2026-10-05', '2026-10-07', '2026-09-30']) {
      for (const days of [30, 60] as const) {
        const w = progressWindow(today, days);
        const c = countSessions(sessions, w);
        expect(c.weeks?.reduce((a, b) => a + b.count, 0)).toBe(c.count);
        expect(c.weeks?.[0]?.from).toBe(w.from);
        expect(c.weeks?.at(-1)?.to).toBe(today);
      }
    }
  });

  it('check 3: 7 days is 7 cells ending today; two workouts on a day count 2; 14 days is 14 cells; perWeek only from 14 days', () => {
    const sessions = [session('2026-10-06'), session('2026-10-08'), session('2026-10-08')];
    const c7 = countSessions(sessions, progressWindow(TODAY, 7));
    expect(c7.days?.map((d) => d.count)).toEqual([0, 1, 0, 2, 0, 0, 0]);
    expect(c7.days?.[0]).toMatchObject({ date: '2026-10-05', weekday: 0 });
    expect(c7.days?.[6]).toMatchObject({ date: TODAY, weekday: 6, isToday: true });
    expect(c7.perWeek).toBeNull();
    expect(countSessions(sessions, progressWindow(TODAY, 14)).days).toHaveLength(14);
  });

  it('lastSessionDate is the latest workout up to the window end, for `Last workout:`', () => {
    const c = countSessions([session('2026-08-14'), session('2026-07-01')], progressWindow(TODAY, 7));
    expect(c).toMatchObject({ count: 0, lastSessionDate: '2026-08-14' });
  });
});

describe('time in gym (checks 4–8, PG25)', () => {
  it('check 4: imported workouts count as sessions, never add time, and are left out of time', () => {
    const t = timeInGym([session('2026-10-08'), imported('2026-10-06')], progressWindow(TODAY, 7));
    expect(t).toMatchObject({ sessionCount: 2, timedCount: 1, totalMs: 60 * MIN, avgMs: 60 * MIN, excluded: { imported: 1 } });
    const home = buildProgressHomeView({ sessions: [imported('2026-10-06')], exercises: INFO, today: TODAY, days: 7, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.activity.stats.map((s) => s.value)).toEqual(['1', '—', '—']);
    expect(home.activity.footnote).toBe('No times for imported workouts');
  });

  it('check 6: over 4 h is left out until confirmed; the footnote counts what was used', () => {
    const long = session('2026-10-02', { durationMs: 5 * H + 12 * MIN, name: 'Push A' });
    const sessions = [...CHECK1.map((d) => session(d)).slice(1), long];
    const w = progressWindow(TODAY, 30);
    const t = timeInGym(sessions, w);
    expect(t.sessionCount).toBe(9);
    expect(t.timedCount).toBe(8);
    expect(t.excluded.overCap).toEqual([{ sessionId: long.sessionId, version: 3, name: 'Push A', date: '2026-10-02', durationMs: 5 * H + 12 * MIN }]);
    const home = buildProgressHomeView({ sessions, exercises: INFO, today: TODAY, days: 30, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.activity.footnote).toBe('Time from 8 of 9 sessions');
    expect(sp(home.activity.sheet.overCap[0]?.text)).toBe('Fri 2 Oct · Push A · 5 h 12 min');
    // Count it: the same session, confirmed.
    const confirmed = timeInGym([...sessions.slice(0, -1), { ...long, durationConfirmed: true }], w);
    expect(confirmed.timedCount).toBe(9);
    expect(confirmed.totalMs).toBe(8 * H + 5 * H + 12 * MIN);
    // Exactly 4 h is not over the cap.
    expect(timeInGym([session('2026-10-02', { durationMs: PROGRESS_DURATION_CAP_MS })], w).timedCount).toBe(1);
  });

  it('a finished workout with no end time is left out and listed', () => {
    const t = timeInGym([session('2026-10-02', { durationMs: null, endedAtUtc: null })], progressWindow(TODAY, 30));
    expect(t.excluded.noEnd).toHaveLength(1);
    expect(t.timedCount).toBe(0);
  });

  it('check 7: AVG is total ÷ timed sessions, rounded to the minute; with none it is —', () => {
    const t = timeInGym([session('2026-10-08', { durationMs: 50 * MIN }), session('2026-10-09', { durationMs: 64 * MIN + 20_000 })], progressWindow(TODAY, 7));
    expect(sp(gymTimeText(t.avgMs ?? 0))).toBe('57 min');
    expect(timeInGym([], progressWindow(TODAY, 7)).avgMs).toBeNull();
  });

  it('check 8: the comparison is counts and time, or none; never a percentage', () => {
    const sessions = [session('2026-09-01', { durationMs: 3 * H + 25 * MIN }), session('2026-09-03', { durationMs: 3 * H + 25 * MIN }), session('2026-10-08')];
    const home = buildProgressHomeView({ sessions, exercises: INFO, today: TODAY, days: 30, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(sp(home.activity.comparison)).toBe('Previous 30 days: 2 sessions · 6 h 50 min');
    const none = buildProgressHomeView({ sessions: [session('2026-10-08')], exercises: INFO, today: TODAY, days: 30, grouping: 'body_part' });
    if (none.dataState !== 'normal') throw new Error('expected normal');
    expect(none.activity.comparison).toBe('Previous 30 days: none');
    expect(JSON.stringify(home)).not.toMatch(/%/);
  });

  it('time totals: minutes, hours and minutes, whole hours from 100 h', () => {
    expect(sp(gymTimeText(57 * MIN))).toBe('57 min');
    expect(sp(gymTimeText(6 * H + 39 * MIN))).toBe('6 h 39 min');
    expect(sp(gymTimeText(104 * H + 20 * MIN))).toBe('104 h');
  });
});

describe('muscles (checks 9–15, PG26, PG27)', () => {
  const w7 = progressWindow(TODAY, 7);
  const rowOf = (fr: ReturnType<typeof muscleFrequency>, key: string) => fr.rows.find((r) => r.key === key);

  it('check 9: 4 bench sets give Chest 1 · 4, Shoulders 1 · 2, Triceps 1 · 2; a single bench set gives Triceps 0 · ½', () => {
    const fr = muscleFrequency([session('2026-10-08', { exercises: [row('bench', [set(), set(), set(), set()])] })], INFO, w7, 'body_part');
    expect(rowOf(fr, 'Chest')).toMatchObject({ sessions: 1, sets: 4 });
    expect(rowOf(fr, 'Shoulders')).toMatchObject({ sessions: 1, sets: 2 });
    expect(rowOf(fr, 'Triceps')).toMatchObject({ sessions: 1, sets: 2 });
    expect(rowOf(fr, 'Triceps')?.contributors).toEqual([{ exerciseId: 'bench', name: 'Bench press', sets: 4, factor: 0.5, total: 2 }]);
    const one = muscleFrequency([session('2026-10-08', { exercises: [row('bench', [set()])] })], INFO, w7, 'body_part');
    expect(rowOf(one, 'Triceps')).toMatchObject({ sessions: 0, sets: 0.5 });
    expect(setsText(0.5)).toBe('½');
    expect(setsText(8.5)).toBe('8½');
  });

  it('check 10: chest + upper_chest primary gives Chest 1 a set, not 2', () => {
    expect(muscleGroupCredits(INFO.get('incline') ?? { primaryMuscles: [] })).toEqual(new Map([['Chest', 1], ['Shoulders', 0.5]]));
    const fr = muscleFrequency([session('2026-10-08', { exercises: [row('incline', [set(), set()])] })], INFO, w7, 'body_part');
    expect(rowOf(fr, 'Chest')?.sets).toBe(2);
  });

  it('check 11: Push/Pull/Legs counts each set once in its exercise’s group; the groups add up to the hard sets', () => {
    const s = session('2026-10-08', {
      exercises: [row('bench', [set(), set(), set(), set()]), row('row', [set({ side: 'both' }), set({ side: 'both' })], { laterality: 'unilateral' }), row('squat', [set()]), row('plank', [set({ load: null, reps: null, durationS: 45 })]), row('carry', [set()])],
    });
    const fr = muscleFrequency([s], INFO, w7, 'ppl');
    expect(fr.rows.map((r) => [r.label, r.sessions, r.sets])).toEqual([
      ['Push', 1, 4],
      ['Pull', 1, 2],
      ['Legs', 1, 1],
      ['Core', 1, 1],
      ['Other', 1, 1],
    ]);
    expect(fr.rows.reduce((a, r) => a + r.sets, 0)).toBe(fr.hardSets);
  });

  it('check 12: body parts always shows the 11 groups in order; PPL shows Other only above 0', () => {
    const fr = muscleFrequency([], INFO, w7, 'body_part');
    expect(fr.rows.map((r) => r.key)).toEqual(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Forearms']);
    expect(fr.rows.every((r) => r.sets === 0 && r.sessions === 0)).toBe(true);
    expect(muscleFrequency([], INFO, w7, 'ppl').rows.map((r) => r.label)).toEqual(['Push', 'Pull', 'Legs', 'Core']);
  });

  it('check 13: warm-ups and RPE 5 are not counted; unrated sets count; marked sets count and are reported', () => {
    expect(hardSetKind({ setType: 'warmup', rpe: 9, rir: null })).toBe('warmup');
    expect(hardSetKind({ setType: 'working', rpe: 5, rir: null })).toBe('easy');
    expect(hardSetKind({ setType: 'working', rpe: 6, rir: null })).toBe('hard');
    expect(hardSetKind({ setType: 'working', rpe: null, rir: 5 })).toBe('easy');
    expect(hardSetKind({ setType: 'working', rpe: null, rir: 4 })).toBe('hard');
    expect(hardSetKind({ setType: 'drop', rpe: null, rir: null })).toBe('hard');
    const s = session('2026-10-08', { exercises: [row('bench', [set({ setType: 'warmup' }), set({ rpe: 5 }), set(), set({ exclusions: ['spotted'] })])] });
    const fr = muscleFrequency([s, imported('2026-10-07', { exercises: [row('bench', [set(), set()])] })], INFO, w7, 'body_part');
    expect(rowOf(fr, 'Chest')).toMatchObject({ sessions: 2, sets: 4 });
    expect(fr.notCounted).toMatchObject({ warmups: 1, easy: 1 });
    expect(fr.markedCounted).toBe(1);
    const home = buildProgressHomeView({ sessions: [s], exercises: INFO, today: TODAY, days: 7, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.muscles.notCounted).toMatchObject({ summary: '1 warm-up set · 1 rated under RPE 6', marked: '1 set you marked is counted here.' });
  });

  it('check 14: 3 left + 3 right sets of a single-arm row count 3 sets', () => {
    const sides = [set({ side: 'left' }), set({ side: 'right' }), set({ side: 'left' }), set({ side: 'right' }), set({ side: 'left' }), set({ side: 'right' })];
    const r = row('row', sides, { laterality: 'unilateral', convention: 'per_hand', equipmentKind: 'dumbbells' });
    expect(countRowSets(r).hard).toBe(3);
    const fr = muscleFrequency([session('2026-10-08', { exercises: [r] })], INFO, w7, 'body_part');
    expect(rowOf(fr, 'Back')?.sets).toBe(3);
    expect(rowOf(fr, 'Biceps')?.sets).toBe(1.5);
  });

  it('check 15: contributor lines read `sets × factor = total`', () => {
    const home = buildProgressHomeView({ sessions: [session('2026-10-08', { exercises: [row('bench', [set(), set(), set(), set()]), row('incline', [set(), set()])] })], exercises: INFO, today: TODAY, days: 30, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    const chest = home.muscles.rows.find((r) => r.key === 'Chest');
    expect(chest?.contributors.map((c) => c.text)).toEqual(['Bench press  4 sets × 1 = 4', 'Incline press  2 sets × 1 = 2']);
    expect(home.muscles.rows.find((r) => r.key === 'Triceps')?.words).toBe('Triceps, 1 session, 2 sets.');
    expect(chest?.perWeek).toBe('1.4');
    expect(setsWords(8.5)).toBe('8 and a half sets');
  });

  it('check 16: exercises without muscles are listed and count in no body-part row; in PPL they fall back to their pattern or Other', () => {
    const s = session('2026-10-08', { exercises: [row('pinch', [set(), set(), set()]), row('mystery', [set()])] });
    const fr = muscleFrequency([s], INFO, w7, 'body_part');
    expect(fr.notCounted.noMuscles).toEqual([
      { exerciseId: 'pinch', name: 'Plate pinch', sets: 3 },
      { exerciseId: 'mystery', name: 'mystery', sets: 1 },
    ]);
    expect(fr.rows.every((r) => r.sets === 0)).toBe(true);
    expect(exerciseSplit(INFO.get('pinch'))).toBe('other');
    expect(exerciseSplit(undefined)).toBe('other');
    expect(exerciseSplit({ name: 'x', movementPattern: 'vertical_push', primaryMuscles: [] })).toBe('push');
    expect(exerciseSplit({ name: 'x', movementPattern: 'hinge', primaryMuscles: ['hamstrings'], split: 'pull' })).toBe('pull');
    const home = buildProgressHomeView({ sessions: [s], exercises: INFO, today: TODAY, days: 7, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.muscles.noMusclesLine).toBe('2 exercises have no muscles set');
    expect(home.muscles.noneSet).toBe(true);
  });

  it('Last trained looks back before the window', () => {
    const fr = muscleFrequency([session('2026-08-14', { exercises: [row('squat', [set(), set()])] })], INFO, w7, 'body_part');
    expect(rowOf(fr, 'Quads')).toMatchObject({ sessions: 0, sets: 0, lastTrained: '2026-08-14' });
    expect(rowOf(fr, 'Calves')?.lastTrained).toBeNull();
  });
});

describe('records in the window (check 17, PG10, PG30)', () => {
  const benchRow = (load: Load, reps: number, over: Partial<ProgressExercise> = {}) => row('bench', [set({ load, reps })], { exerciseName: 'Bench press', ...over });
  const history = ['2026-09-01', '2026-09-05', '2026-09-09'].map((d) => session(d, { exercises: [benchRow(kg(100), 5)] }));
  const w30 = progressWindow(TODAY, 30);

  it('a heavier set after 3 earlier sessions on the same equipment is a record, with load × reps', () => {
    const r = recordsInWindow([...history, session('2026-10-01', { exercises: [benchRow(kg(105), 3)] })], w30);
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ kind: 'heaviest', label: 'Heaviest set', date: '2026-10-01', isEstimate: false });
    expect(sp(r.items[0]?.value)).toBe('105 kg × 3');
    const home = buildProgressHomeView({ sessions: [...history, session('2026-10-01', { exercises: [benchRow(kg(105), 3)] })], exercises: INFO, today: TODAY, days: 30, grouping: 'body_part', gymNames: { 'gym-1': 'Main Gym' } });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.records.items[0]).toMatchObject({ title: 'Bench press · Main Gym', date: '1\u00a0Oct', words: 'Bench press, Main Gym. Heaviest set, 105 kilograms by 3, 1 October.' });
  });

  it('more reps at the heaviest load is `Most reps at`', () => {
    const r = recordsInWindow([...history, session('2026-10-01', { exercises: [benchRow(kg(100), 7)] })], w30);
    expect(r.items[0]).toMatchObject({ kind: 'most_reps_at_load', value: '7' });
    expect(sp(r.items[0]?.label)).toBe('Most reps at 100 kg');
  });

  it('needs ≥ 3 earlier sessions; other equipment, units or conventions are not comparable', () => {
    expect(recordsInWindow([...history.slice(1), session('2026-10-01', { exercises: [benchRow(kg(105), 3)] })], w30).total).toBe(0);
    expect(recordsInWindow([...history, session('2026-10-01', { exercises: [benchRow(kg(105), 3, { equipmentId: 'bar-2' })] })], w30).total).toBe(0);
    expect(recordsInWindow([...history, session('2026-10-01', { exercises: [benchRow(lb(240), 3, { unit: 'lb' })] })], w30).total).toBe(0);
  });

  it('imported workouts never claim a record, and a heavier imported set suppresses one', () => {
    const imp = (d: string, load: Load) => imported(d, { exercises: [benchRow(load, 3, { equipmentId: null, gymId: null })] });
    expect(recordsInWindow([...history, imp('2026-10-01', kg(120))], w30).total).toBe(0);
    expect(recordsInWindow([imp('2026-08-01', kg(110)), ...history, session('2026-10-01', { exercises: [benchRow(kg(105), 3)] })], w30).total).toBe(0);
  });

  it('marked sets are never records; records before the window are not listed; newest first and limited', () => {
    const spotted = session('2026-10-01', { exercises: [row('bench', [set({ load: kg(110), reps: 3, exclusions: ['spotted'] })])] });
    expect(recordsInWindow([...history, spotted], w30).total).toBe(0);
    const old = session('2026-09-10', { exercises: [benchRow(kg(102.5), 3)] });
    const r = recordsInWindow([...history, old, session('2026-10-01', { exercises: [benchRow(kg(105), 3)] }), session('2026-10-05', { exercises: [benchRow(kg(107.5), 2)] })], progressWindow(TODAY, 14), { limit: 1 });
    expect(r.total).toBe(2);
    expect(r.items.map((i) => i.date)).toEqual(['2026-10-05']);
  });

  it('per-dumbbell loads read `each`', () => {
    const db = (d: string, v: number) => session(d, { exercises: [row('db', [set({ load: kg(v, 'per_hand'), reps: 8 })], { exerciseName: 'DB press', convention: 'per_hand', equipmentKind: 'dumbbells' })] });
    const r = recordsInWindow([db('2026-09-01', 30), db('2026-09-04', 30), db('2026-09-07', 30), db('2026-10-02', 32.5)], w30);
    expect(sp(r.items[0]?.value)).toBe('32.5 kg each × 8');
  });

  it('assisted and bodyweight movements have no records (heavier is not better)', () => {
    const asst = (d: string, v: number) => session(d, { exercises: [row('pullup', [set({ load: kg(v, 'assistance'), reps: 8 })], { convention: 'assistance', equipmentKind: 'assisted_stack' })] });
    expect(recordsInWindow([asst('2026-09-01', 30), asst('2026-09-04', 30), asst('2026-09-07', 30), asst('2026-10-02', 40)], w30).total).toBe(0);
  });
});

describe('Est. 1RM (PG11)', () => {
  it('Epley, rounded to 0.5 kg; 1 rep is the load; labelled an estimate', () => {
    expect(estimateOneRepMax(kg(100), 5)).toEqual({ eligible: true, value: 116.5, unit: 'kg', convention: 'total', isEstimate: true });
    expect(estimateOneRepMax(kg(100), 1)).toMatchObject({ value: 100 });
    expect(estimateOneRepMax(kg(100), 10)).toMatchObject({ value: 133.5 });
  });

  it('rounds lb to 1 lb and keeps per-dumbbell and stack loads as they are', () => {
    expect(estimateOneRepMax(lb(225), 5)).toMatchObject({ value: 263, unit: 'lb' });
    expect(estimateOneRepMax(kg(30, 'per_hand'), 8)).toMatchObject({ value: 38, convention: 'per_hand' });
    expect(estimateOneRepMax(kg(50, 'stack'), 10)).toMatchObject({ value: 66.5, convention: 'stack' });
  });

  it('only 1–10 reps; never assisted, bodyweight or BW + added; added counts only on a plate-loaded machine', () => {
    expect(estimateOneRepMax(kg(100), 11)).toEqual({ eligible: false, reason: 'reps' });
    expect(estimateOneRepMax(kg(100), 0)).toEqual({ eligible: false, reason: 'reps' });
    expect(estimateOneRepMax(kg(100), null)).toEqual({ eligible: false, reason: 'reps' });
    expect(estimateOneRepMax(kg(20, 'assistance'), 5)).toEqual({ eligible: false, reason: 'convention' });
    expect(estimateOneRepMax({ value: 0, unit: 'kg', convention: 'bodyweight' }, 5)).toEqual({ eligible: false, reason: 'convention' });
    expect(estimateOneRepMax(kg(20, 'added'), 5, null)).toEqual({ eligible: false, reason: 'convention' });
    expect(estimateOneRepMax(kg(20, 'added'), 5, 'bodyweight_station')).toEqual({ eligible: false, reason: 'convention' });
    expect(estimateOneRepMax(kg(100, 'added'), 5, 'plate_loaded_machine')).toMatchObject({ eligible: true, value: 116.5 });
    expect(estimateOneRepMax(null, 5)).toEqual({ eligible: false, reason: 'no_load' });
  });
});

describe('home view states (§3.1, check 19, 23)', () => {
  it('empty: nothing to show', () => {
    expect(buildProgressHomeView({ sessions: [], exercises: INFO, today: TODAY, days: 30, grouping: 'body_part' })).toEqual({ dataState: 'empty' });
  });

  it('no sessions in the window: 0 · — · —, bars at 0 with labels, last workout line, every muscle row 0', () => {
    const home = buildProgressHomeView({ sessions: [session('2026-08-14', { exercises: [row('bench', [set()])] })], exercises: INFO, today: TODAY, days: 7, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(sp(home.datesLine)).toBe('5 Oct – 11 Oct');
    expect(home.activity.stats).toEqual([
      { value: '0', label: 'SESSIONS' },
      { value: '—', label: 'TIME' },
      { value: '—', label: 'AVG' },
    ]);
    expect(sp(home.activity.lastWorkout)).toBe('Last workout: Fri 14 Aug');
    expect(home.activity.bars).toMatchObject({ kind: 'days' });
    expect(home.records.empty).toBe('No new records in the last 7 days.');
    expect(home.muscles.rows.every((r) => r.zero)).toBe(true);
  });

  it('VoiceOver sentences for the strip and bars', () => {
    const home = buildProgressHomeView({ sessions: [session('2026-10-06', { durationMs: 59 * MIN }), session('2026-10-08', { durationMs: 59 * MIN })], exercises: INFO, today: TODAY, days: 7, grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.activity.statsWords).toBe('2 sessions. Time in gym 1 hour 58 minutes. Average 59 minutes per session.');
    expect(home.activity.bars.words).toBe('Last 7 days: Tuesday 6 October, 1 workout; Thursday 8 October, 1 workout. Other days none.');
    const w30 = buildProgressHomeView({ sessions: CHECK1.map((d) => session(d)), exercises: INFO, today: TODAY, days: 30, grouping: 'body_part' });
    if (w30.dataState !== 'normal') throw new Error('expected normal');
    expect(w30.activity.bars.words).toBe('Sessions per week: from 12 September, 1; from 14 September, 2; from 21 September, 2; from 28 September, 2; from 5 October, 2.');
    expect(w30.activity.bars).toMatchObject({ kind: 'weeks', max: 3 });
  });

  it('no invented values: no score, ring, percentage, streak, recovery, readiness or fatigue words', () => {
    const home = buildProgressHomeView({ sessions: CHECK1.map((d) => session(d, { exercises: [row('bench', [set(), set()])] })), exercises: INFO, today: TODAY, days: 30, grouping: 'ppl' });
    expect(JSON.stringify(home)).not.toMatch(/score|ring|%|streak|recovery|readiness|fatigue/i);
  });
});

describe('calendar month (check 18)', () => {
  it('a Monday-first grid with workout counts, day lists, imported rows without times, and the default day', () => {
    const v = buildCalendarMonthView({
      sessions: [session('2026-10-08', { durationMs: 54 * MIN, exercises: [row('bench', [set(), set({ setType: 'warmup' })])] }), session('2026-10-08'), imported('2026-10-02', { exercises: [row('bench', [set(), set()])] }), session('2026-09-30')],
      exercises: INFO,
      gymNames: { 'gym-1': 'Main Gym' },
      month: '2026-10',
      today: TODAY,
    });
    expect(v.title).toBe('October 2026');
    expect(v.weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(v.weeks[0]?.[3]).toMatchObject({ date: '2026-10-01', day: 1 });
    expect(v.weeks.flat().find((d) => d?.date === '2026-10-08')?.count).toBe(2);
    expect(v.days['2026-10-08']?.[0]).toMatchObject({ title: 'Push A · Main Gym', detail: '19:00–20:00 · 54 min · 1 set' });
    expect(v.days['2026-10-02']?.[0]).toMatchObject({ title: 'Imported', detail: '2 sets', imported: true });
    expect(v.defaultSelected).toBe(TODAY);
    expect(v.previousMonth).toBe('2026-09');
    const sep = buildCalendarMonthView({ sessions: [session('2026-09-30')], exercises: INFO, month: '2026-09', today: TODAY });
    expect(sep.defaultSelected).toBe('2026-09-30');
    expect(buildCalendarMonthView({ sessions: [], exercises: INFO, month: '2026-08', today: TODAY }).empty).toBe('No workouts in August.');
  });

  it('shows the unfinished workout, never as counted', () => {
    const v = buildCalendarMonthView({ sessions: [], exercises: INFO, month: '2026-10', today: TODAY, active: { sessionId: 'a', date: TODAY, name: 'Push A', fresh: true } });
    expect(v.days[TODAY]?.[0]).toMatchObject({ kind: 'in_progress', detail: 'In progress · Resume ›' });
    expect(v.weeks.flat().find((d) => d?.date === TODAY)?.count).toBe(0);
  });
});

describe('projection from stored workouts (checks 5, 21, PG16, PG33)', () => {
  function finishedWithPause(): SessionAggregate {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 60));
    s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 8, { rpe: 8 }), 400));
    s = apply(s, { type: 'pause', at: at(20 * 60), opId: 'p' });
    s = apply(s, { type: 'resume', at: at(28 * 60), opId: 'r' });
    return apply(s, { type: 'finish', at: at(62 * 60), opId: 'f', expectedVersion: s.session.version, endedAt: null });
  }

  it('check 5: time is the Summary’s active time (start to end minus pauses): 62 min with an 8 min pause is 54 min', () => {
    const agg = finishedWithPause();
    const p = toProgressSession(agg, 'Europe/London', Date.parse(at(99_999).utc));
    expect(p?.durationMs).toBe(54 * MIN);
    expect(p?.durationMs).toBe(getActiveDurationMs(agg, 0));
    expect(p?.exercises.find((e) => e.exerciseId === BENCH)?.sets.map((x) => x.reps)).toEqual([10, 8]);
  });

  it('the date is the owner’s local date of the start (PG16)', () => {
    const agg = finishedWithPause(); // starts 2026-10-08T06:00Z
    expect(toProgressSession(agg, 'Europe/London', 0)?.date).toBe('2026-10-08');
    expect(toProgressSession(agg, 'America/Los_Angeles', 0)?.date).toBe('2026-10-07');
  });

  it('unfinished, discarded and reverted workouts are not projected (PG33)', () => {
    const active = startFixture().state;
    expect(toProgressSession(active, 'Europe/London', 0)).toBeNull();
    const agg = finishedWithPause();
    expect(toProgressSession({ ...agg, session: { ...agg.session, status: 'discarded' } }, 'Europe/London', 0)).toBeNull();
    expect(toProgressSession({ ...agg, session: { ...agg.session, status: 'reverted' } }, 'Europe/London', 0)).toBeNull();
  });

  it('an imported workout keeps its own date and has no time', () => {
    const agg = finishedWithPause();
    const imp = { ...agg, session: { ...agg.session, source: 'import' as const, localDate: '2026-10-01' } };
    expect(toProgressSession(imp, 'Pacific/Auckland', 0)).toMatchObject({ date: '2026-10-01', dateOnly: true, durationMs: null, source: 'import' });
  });

  it('a confirmed duration is carried', () => {
    const agg = finishedWithPause();
    expect(toProgressSession({ ...agg, session: { ...agg.session, durationConfirmedAt: at(99_000) } }, 'Europe/London', 0)?.durationConfirmed).toBe(true);
  });
});
