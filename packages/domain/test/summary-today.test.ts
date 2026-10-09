import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate, SetValues } from '@fizz/schemas';

import {
  buildAddExerciseCommand,
  buildTodayView,
  buildWorkoutSummary,
  newCheckIn,
  newPainFlag,
  NBSP,
  startWorkout,
  toHistorySessions,
  toIso,
  type HistorySession,
  type SummaryInput,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, ms, OWNER, profile, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const BENCH = exercise(220, 'Bench press');

/** An empty workout with one exercise and `n` working sets (added like the Add set control). */
function workout(ex: Exercise, eq: EquipmentInstance | null, n: number, startS = 0, opPrefix = 'w'): SessionAggregate {
  const owner = profile();
  const ids = idGen(80_000 + startS);
  let s = startWorkout({ opId: `${opPrefix}-start`, owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: eq ? [eq] : [], at: at(startS), newId: ids }).aggregate;
  s = apply(s, buildAddExerciseCommand({ opId: `${opPrefix}-add`, owner, exercise: ex, equipmentId: eq?.id ?? null, at: at(startS + 1), newId: ids }));
  const sx = s.exercises[0]?.id ?? '';
  for (let i = 1; i < n; i += 1) s = apply(s, { type: 'add_set', at: at(startS + 1), opId: `${opPrefix}-set-${String(i)}`, sessionExerciseId: sx, newSetId: ids(), setType: null });
  return s;
}

function logAll(s: SessionAggregate, vals: SetValues[], startS: number, side?: 'left' | 'right' | 'both'): SessionAggregate {
  let out = s;
  vals.forEach((v, i) => {
    const setId = out.session.activeSetId;
    if (setId === null) throw new Error('no active set');
    out = apply(out, logCmd(setId, v, startS + 10 + i * 120, `log-${setId}-${String(i)}`, side));
  });
  return out;
}

function finish(s: SessionAggregate, atS: number, endedAtS: number | null = null): SessionAggregate {
  return apply(s, { type: 'finish', at: at(atS), opId: `fin-${s.session.id}`, expectedVersion: s.session.version, endedAt: endedAtS === null ? null : at(endedAtS) });
}

function input(s: SessionAggregate, history: HistorySession[], over: Partial<SummaryInput> = {}): SummaryInput {
  const exId = s.exercises[0]?.exerciseId ?? '';
  return { aggregate: s, nowMs: ms(100_000), gymName: 'Main Gym', history: { [exId]: [...history, ...toHistorySessions(s, exId)] }, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected', ...over };
}

describe('buildWorkoutSummary', () => {
  const bar = barbell();
  // Last week: 3 × 12 at 60 kg (the top of the default 8–12 range).
  const lastWeek: HistorySession = { sessionId: id(600), performedAtUtc: at(-7 * 86_400).utc, equipmentId: bar.id, sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load: kg(60), reps: 12, rpe: 8, rir: null })) };

  it('facts, a like-for-like comparison and a built-in Next time row tagged with its source', () => {
    const s = finish(logAll(workout(BENCH, bar, 3), [values(kg(60), 12, { rpe: 8 }), values(kg(60), 12, { rpe: 8.5 }), values(kg(60), 12, { rpe: 9 })], 0), 600);
    const sum = buildWorkoutSummary(input(s, [lastWeek]));
    expect(sum.title).toBe('Workout');
    expect(sum.facts).toMatchObject({ exercisesDone: 1, exercisesTotal: 1, workingSets: 3, skippedSets: 0, warmupSets: 0 });
    expect(plain(sum.facts.activeText)).toBe('10 min');
    expect(sum.comparison).toMatchObject({ kind: 'compared', exerciseName: 'Bench press', lastAtUtc: lastWeek.performedAtUtc });
    if (sum.comparison?.kind !== 'compared') throw new Error('no comparison');
    expect(plain(sum.comparison.todayText)).toBe('60 kg × 12');
    expect(plain(sum.comparison.why)).toBe('Same Olympic bar at Main Gym, working sets');
    expect(sum.exercises.map((e) => [e.name, e.setsText, plain(e.results)])).toEqual([['Bench press', '3 sets', '60×12 · 60×12 · 60×12']]);
    expect(sum.nextTime?.sourceTag).toBe('Built-in rule (coach not connected)');
    expect(sum.nextTime?.rows.map((r) => [r.kind, plain(r.target), r.decision, r.ruleName])).toEqual([
      ['change', 'Target 62.5 kg × 8–12', 'increase_load', 'Double progression, 8–12 reps (built-in default)'],
    ]);
    expect(sum.nextTime?.rows[0]?.summary).toContain('Increase to 62.5');
  });

  it('an incomplete session holds with the domain fact; a first time has nothing to compare', () => {
    let s = workout(BENCH, bar, 3);
    s = logAll(s, [values(kg(60), 12), values(kg(60), 12)], 0);
    s = finish(s, 600);
    const sum = buildWorkoutSummary(input(s, []));
    expect(sum.facts.skippedSets).toBe(1);
    expect(sum.comparison).toEqual({ kind: 'first_time', text: 'First time logging Bench press with Olympic bar at Main Gym. Nothing to compare yet.' });
    // Even a first time is listed when it held because sets were skipped.
    expect(sum.nextTime?.rows.map((r) => r.kind)).toEqual(['held']);
    const again = buildWorkoutSummary(input(s, [lastWeek]));
    expect(again.nextTime?.rows.map((r) => [r.kind, plain(r.target)])).toEqual([['held', 'Same target: 60 kg × 8–12']]);
    expect(again.nextTime?.rows[0]?.facts.some((f) => f.startsWith('Only 2 of 3 working sets'))).toBe(true);
  });

  it('a pain flag stops progression for that movement (rule 9)', () => {
    const s = finish(logAll(workout(BENCH, bar, 3), [1, 2, 3].map(() => values(kg(60), 12)), 0), 600);
    const flag = newPainFlag({ id: id(41), ownerId: OWNER, opId: 'p', exerciseId: BENCH.id, exerciseName: 'Bench press', area: 'shoulder', source: 'check_in', checkInId: null, at: at(0) });
    const sum = buildWorkoutSummary(input(s, [lastWeek], { painFlags: [flag] }));
    expect(sum.nextTime?.rows.map((r) => [r.kind, r.decision, plain(r.target)])).toEqual([['pain', 'halted_pain', 'Same target: 60 kg × 8–12']]);
  });

  it('shows the check-in as given and never lets it change Next time (check 19, 24)', () => {
    const s = finish(logAll(workout(BENCH, bar, 3), [1, 2, 3].map(() => values(kg(60), 12)), 0), 600);
    const low = newCheckIn({ id: id(42), ownerId: OWNER, opId: 'c', score: 1, reasons: ['pain', 'tired'], note: 'Baby was up at 3', at: at(-60), localDate: '2026-10-08' });
    const high = { ...low, score: 5 as const, reasons: [] };
    const a = buildWorkoutSummary(input(s, [lastWeek], { checkIn: low }));
    expect(a.checkIn).toEqual({ checkInId: id(42), scoreText: '1 of 5', reasons: 'Tired · Pain', note: 'Baby was up at 3', painNotFlagged: true });
    const b = buildWorkoutSummary(input(s, [lastWeek], { checkIn: high }));
    const c = buildWorkoutSummary(input(s, [lastWeek], { checkIn: null }));
    expect(a.nextTime).toEqual(b.nextTime);
    expect(b.nextTime).toEqual(c.nextTime);
    expect(c.checkIn).toBeNull();
    expect(buildWorkoutSummary(input(s, [lastWeek], { checkIn: { ...low, deletedAtUtc: at(5).utc } })).checkIn).toBeNull();
  });

  it('a first, complete session lists nothing: Same targets next time', () => {
    const s = finish(logAll(workout(BENCH, bar, 2), [values(kg(60), 10), values(kg(60), 9)], 0), 600);
    const sum = buildWorkoutSummary(input(s, []));
    expect(sum.nextTime).toEqual({ sourceTag: 'Built-in rule (coach not connected)', rows: [], emptyText: 'No target changes. Same targets next time.' });
  });

  it('a workout with no working sets hides comparison and Next time', () => {
    const s = finish(workout(BENCH, bar, 1), 60);
    const sum = buildWorkoutSummary(input(s, []));
    expect(sum).toMatchObject({ empty: true, comparison: null, nextTime: null });
  });

  it('marks an edited end time and gives the Edit times bounds', () => {
    const s = finish(logAll(workout(BENCH, bar, 1), [values(kg(60), 10)], 0), 3600, 400);
    const sum = buildWorkoutSummary(input(s, []));
    expect(sum.timingEdited).toEqual({ start: false, end: true });
    expect(sum.timingBounds).toEqual({ startLatestUtc: at(10).utc, endEarliestUtc: at(10).utc, endLatestUtc: toIso(ms(100_000)) });
    expect(plain(sum.facts.activeText)).toBe('7 min');
  });

  it('per-hand dumbbells at the rack max progress reps, never past the max', () => {
    const db = dumbbells();
    const press = exercise(221, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const hist: HistorySession = { sessionId: id(601), performedAtUtc: at(-86_400).utc, equipmentId: db.id, sets: [1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(30, 'per_hand'), reps: 12, rpe: null, rir: null })) };
    const s = finish(logAll(workout(press, db, 2), [1, 2].map(() => values(kg(30, 'per_hand'), 12)), 0), 600);
    const sum = buildWorkoutSummary(input(s, [hist]));
    expect(sum.exercises[0]?.setsText).toBe('2 sets (kg each)');
    expect(sum.nextTime?.rows.map((r) => [r.decision, plain(r.target)])).toEqual([['increase_reps', 'Target 30 kg each × 13']]);
  });

  it('assisted machine: progress means less assistance', () => {
    const a = assisted();
    const pull = exercise(222, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
    const hist: HistorySession = { sessionId: id(602), performedAtUtc: at(-86_400).utc, equipmentId: a.id, sets: [1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(30, 'assistance'), reps: 12, rpe: null, rir: null })) };
    const s = finish(logAll(workout(pull, a, 2), [1, 2].map(() => values(kg(30, 'assistance'), 12)), 0), 600);
    expect(buildWorkoutSummary(input(s, [hist])).nextTime?.rows.map((r) => plain(r.target))).toEqual(['Target Assist 25 kg × 8–12']);
  });
});

describe('buildTodayView', () => {
  const tz = 'Pacific/Auckland';
  const local = (utc: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(utc));
  const base = { todayLocalDate: local(at(0).utc), localDateOf: local, recentCheckIns: [], finishedThisWeek: [] as SessionAggregate[] };

  it('no workout: Nothing planned; the week line counts finished workouts', () => {
    expect(buildTodayView({ ...base, nowMs: ms(0), active: null })).toMatchObject({ main: { kind: 'no_plan' }, week: { count: 0, text: 'No workouts logged yet this week.' } });
    const done = finish(logAll(workout(BENCH, barbell(), 1, -7200), [values(kg(60), 10)], -7200), -6000);
    const v = buildTodayView({ ...base, nowMs: ms(0), active: null, finishedThisWeek: [done] });
    expect(v.main).toMatchObject({ kind: 'done_today', title: 'Workout' });
    expect(v.week).toEqual({ count: 1, text: '1 workout this week' });
  });

  it('resume card: now line, progress and rest status', () => {
    let s = workout(BENCH, barbell(), 3);
    s = logAll(s, [values(kg(60), 10)], 0);
    const v = buildTodayView({ ...base, nowMs: ms(30), active: s });
    expect(v.main).toMatchObject({ kind: 'resume', now: 'Bench press · set 2 of 3', done: 1, total: 3, status: { kind: 'resting' } });
  });

  it('stale card after 6 h: Finish ends about 3 min after the last set; nothing logged offers Discard', () => {
    let s = workout(BENCH, barbell(), 3);
    s = logAll(s, [values(kg(60), 10)], 0);
    const v = buildTodayView({ ...base, nowMs: ms(7 * 3600), active: s });
    expect(v.main).toMatchObject({ kind: 'stale', lastSetAtUtc: at(10).utc, endedAboutUtc: at(190).utc, done: 1 });
    const empty = workout(BENCH, barbell(), 1);
    expect(buildTodayView({ ...base, nowMs: ms(7 * 3600), active: empty }).main).toMatchObject({ kind: 'stale', endedAboutUtc: null });
  });

  it('shows an unlinked check-in under 2 h old', () => {
    const one = { id: id(43), recordedAtUtc: at(-600).utc, outcome: 'not_started' as const, deleted: false, linked: false, score: 3 as const, reasons: ['tired' as const] };
    const recent = [one];
    expect(buildTodayView({ ...base, nowMs: ms(0), active: null, recentCheckIns: recent }).unlinkedCheckIn?.id).toBe(id(43));
    expect(buildTodayView({ ...base, nowMs: ms(0), active: null, recentCheckIns: [{ ...one, linked: true }] }).unlinkedCheckIn).toBeNull();
  });
});
