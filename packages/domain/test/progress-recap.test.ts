import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import { buildMonthlyRecap, MONTHLY_RECAP, recapCardShown, recapMonthOf, type MuscleInfo, type ProgressExercise, type ProgressSession, type ProgressSet } from '../src/index';
import { kg, lb } from './fixtures';

/**
 * The monthly recap (Ben approved 26 Oct): facts only, from finished workouts. Counts, time (imports have none),
 * working sets per body part, actual records (never an estimate), the tracked lifts' heaviest top set against the
 * month before (kg/lb, per-hand dumbbells, assisted machines), and the weeks at his aim with a plan.
 */

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
let n = 0;
function set(load: Load | null, reps: number | null, over: Partial<ProgressSet> = {}): ProgressSet {
  n += 1;
  return { setId: `set-${String(n)}`, setType: 'working', side: null, load, reps, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: n, ...over };
}
function row(exerciseId: string, name: string, sets: ProgressSet[], over: Partial<ProgressExercise> = {}): ProgressExercise {
  n += 1;
  return { sessionExerciseId: `row-${String(n)}`, exerciseId, exerciseName: name, equipmentId: 'bar-1', equipmentKind: 'barbell', equipmentName: 'Barbell', gymId: 'gym-1', convention: 'total', unit: 'kg', measurement: 'reps', laterality: 'bilateral', sets, ...over };
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
const bench = (date: string, load: number, reps = 5) => session(date, [row('bench', 'Bench press', [set(kg(load), reps), set(kg(load), reps)])]);
const info = new Map<string, MuscleInfo>([
  ['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], split: 'push', mechanic: 'compound' }],
  ['curl', { name: 'Curl', movementPattern: 'elbow_flexion', primaryMuscles: ['biceps'], secondaryMuscles: [], split: 'pull', mechanic: 'isolation' }],
  ['db-press', { name: 'Dumbbell press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: [], split: 'push', mechanic: 'compound' }],
  ['pullup', { name: 'Assisted pull-up', movementPattern: 'vertical_pull', primaryMuscles: ['lats'], secondaryMuscles: [], split: 'pull', mechanic: 'compound' }],
] as [string, MuscleInfo][]);

describe('monthly recap', () => {
  it('the month before today; shown on the 1st–7th until dismissed, only with a workout', () => {
    expect(recapMonthOf('2026-11-03')).toBe('2026-10');
    expect(recapMonthOf('2027-01-01')).toBe('2026-12');
    const recap = buildMonthlyRecap({ sessions: [bench('2026-10-05', 80)], exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks: null });
    expect(recap?.month).toBe('2026-10');
    expect(recapCardShown({ today: '2026-11-01', dismissed: null, recap })).toBe(true);
    expect(recapCardShown({ today: `2026-11-0${String(MONTHLY_RECAP.showDays)}`, dismissed: null, recap })).toBe(true);
    expect(recapCardShown({ today: '2026-11-08', dismissed: null, recap })).toBe(false);
    expect(recapCardShown({ today: '2026-11-02', dismissed: '2026-10', recap })).toBe(false);
    // Last month's dismissal doesn't hide this month's.
    expect(recapCardShown({ today: '2026-11-02', dismissed: '2026-09', recap })).toBe(true);
    // No workout that month: no recap at all.
    expect(buildMonthlyRecap({ sessions: [bench('2026-09-05', 80)], exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks: null })).toBeNull();
  });

  it('workouts and time against the month before; imports count as workouts but have no time (said, not guessed)', () => {
    const sessions = [
      bench('2026-09-10', 80),
      bench('2026-10-01', 80),
      bench('2026-10-08', 82.5),
      session('2026-10-15', [row('bench', 'Bench press', [set(kg(85), 5)], { equipmentId: null, equipmentKind: null, gymId: null })], { source: 'import', dateOnly: true, durationMs: null, endedAtUtc: null }),
      bench('2026-11-01', 90),
    ];
    const r = buildMonthlyRecap({ sessions, exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks: null });
    expect(r?.title).toBe('October');
    expect(r?.previousTitle).toBe('September');
    expect(r?.stats.map((s) => [s.label, sp(s.value), sp(s.previous)])).toEqual([
      ['Workouts', '3', '1'],
      ['Time', '2 h 00 min', '1 h 00 min'],
    ]);
    expect(r?.timeNote).toBe('2 of 3 timed');
    expect(sp(r?.line)).toBe('3 workouts · 2 h 00 min');
    expect(r?.accessibilityLabel).not.toMatch(/score|recovery|readiness/i);
  });

  it('sets per body part against the month before, largest first; warm-ups never count', () => {
    const sessions = [
      session('2026-09-10', [row('curl', 'Curl', [set(kg(12), 10), set(kg(12), 10)])]),
      session('2026-10-02', [row('bench', 'Bench press', [set(kg(60), 10, { setType: 'warmup' }), set(kg(80), 5), set(kg(80), 5), set(kg(80), 5)])]),
    ];
    const r = buildMonthlyRecap({ sessions, exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks: null });
    const chest = r?.muscles.find((m) => m.key === 'Chest');
    expect(chest).toMatchObject({ value: '3', previous: '0' });
    const biceps = r?.muscles.find((m) => m.key === 'Biceps');
    expect(biceps).toMatchObject({ value: '0', previous: '2' });
    expect(r?.muscles[0]?.key).toBe('Chest');
  });

  it('records are actual sets set that month (never an estimate), each with its workout', () => {
    // Records need earlier logged sessions of the series first.
    const sessions = [bench('2026-08-01', 70), bench('2026-08-08', 72.5), bench('2026-08-15', 75), bench('2026-09-01', 77.5), bench('2026-10-06', 85), bench('2026-10-20', 80, 3)];
    const r = buildMonthlyRecap({ sessions, exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks: null });
    expect(r?.records.map((x) => sp(x.text))).toEqual(['85 kg × 5']);
    expect(r?.records[0]?.sessionId).toBe(sessions[4]?.sessionId);
    expect(JSON.stringify(r)).not.toMatch(/≈|Est\./);
    expect(sp(r?.line)).toBe('2 workouts · 2 h 00 min · 1 record');
  });

  it('tracked lifts: heaviest top set against the month before, in his unit (kg/lb), per-hand dumbbells and assisted said', () => {
    const sessions = [
      bench('2026-09-03', 80, 5),
      session('2026-09-04', [row('db-press', 'Dumbbell press', [set({ value: 30, unit: 'kg', convention: 'per_hand' }, 8)], { convention: 'per_hand', equipmentKind: 'dumbbells', equipmentId: 'db-1' })]),
      bench('2026-10-03', 80, 6),
      bench('2026-10-10', 82.5, 5),
      session('2026-10-04', [row('db-press', 'Dumbbell press', [set({ value: 32, unit: 'kg', convention: 'per_hand' }, 8)], { convention: 'per_hand', equipmentKind: 'dumbbells', equipmentId: 'db-1' })]),
      session('2026-10-05', [row('pullup', 'Assisted pull-up', [set({ value: 30, unit: 'kg', convention: 'assistance' }, 8)], { convention: 'assistance', equipmentKind: 'assisted_stack', equipmentId: 'assist-1' })]),
      session('2026-09-05', [row('pullup', 'Assisted pull-up', [set({ value: 35, unit: 'kg', convention: 'assistance' }, 8)], { convention: 'assistance', equipmentKind: 'assisted_stack', equipmentId: 'assist-1' })]),
    ];
    const r = buildMonthlyRecap({ sessions, exercises: info, today: '2026-11-03', lifts: ['curl', 'bench', 'db-press', 'pullup'], unit: 'kg', planWeeks: null });
    // Curl wasn't trained: left out; up to 3 lifts.
    expect(r?.lifts.map((l) => [l.name, sp(l.text), l.unit])).toEqual([
      ['Bench press', '80 × 5 → 82.5 × 5', 'kg'],
      ['Dumbbell press', '30 × 8 → 32 × 8', 'kg each'],
      ['Assisted pull-up', '35 × 8 → 30 × 8', 'kg assist'],
    ]);
    expect(r?.lifts[0]?.sessionId).toBe(sessions[3]?.sessionId);
    // In lb, the same sets converted (his display unit).
    const inLb = buildMonthlyRecap({ sessions: [bench('2026-10-03', 100)], exercises: info, today: '2026-11-03', lifts: ['bench'], unit: 'lb', planWeeks: null });
    expect(inLb?.lifts[0]?.unit).toBe('lb');
    // A lift logged in lb shows in kg when kg is his unit.
    const fromLb = buildMonthlyRecap({ sessions: [session('2026-10-03', [row('bench', 'Bench press', [set(lb(225), 5)], { unit: 'lb' })])], exercises: info, today: '2026-11-03', lifts: ['bench'], unit: 'kg', planWeeks: null });
    expect(fromLb?.lifts[0]?.unit).toBe('kg');
  });

  it('with a plan: the weeks starting that month at his aim; none without a plan', () => {
    const sessions = [bench('2026-10-05', 80)];
    const planWeeks = [
      { monday: '2026-09-28', atAim: true },
      { monday: '2026-10-05', atAim: true },
      { monday: '2026-10-12', atAim: false },
      { monday: '2026-10-19', atAim: true },
      { monday: '2026-10-26', atAim: null },
    ];
    const r = buildMonthlyRecap({ sessions, exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks });
    expect(r?.plan?.text).toBe('2 of 3');
    expect(buildMonthlyRecap({ sessions, exercises: info, today: '2026-11-03', lifts: [], unit: 'kg', planWeeks: null })?.plan).toBeNull();
  });
});
