import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate, SetValues } from '@fizz/schemas';

import {
  doneTodayDurationLine,
  analyseImport,
  buildAddExerciseCommand,
  buildImportedSession,
  buildTodayView,
  buildWorkoutSummary,
  DEFAULT_ANSWERS,
  parseFitNotesCsv,
  planImportRows,
  newCheckIn,
  newPainFlag,
  NBSP,
  startWorkout,
  toHistorySessions,
  toIso,
  lastComparableSession,
  resumeRows,
  weekStripLabel,
  weekText,
  type HistorySession,
  type SummaryInput,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, ms, OWNER, profile, values } from './fixtures';
import { apply, logCmd } from './session-fixture';
import { CANDIDATES } from './import-fixtures';

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
  const lastWeek: HistorySession = { sessionId: id(600), performedAtUtc: at(-7 * 86_400).utc, equipmentId: bar.id, gymId: GYM, imported: false, sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load: kg(60), reps: 12, rpe: 8, rir: null })) };

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
    expect(sum.nextTime?.sourceTag).toBe('Rule');
    // The tag names the built-in rule whatever the coach's state: no coach targets exist in this build.
    expect(buildWorkoutSummary(input(s, [lastWeek], { coach: 'unavailable' })).nextTime?.sourceTag).toBe('Rule');
    expect(buildWorkoutSummary(input(s, [lastWeek], { coach: 'connected' })).nextTime?.sourceTag).toBe('Rule');
    expect(sum.nextTime?.rows.map((r) => [r.kind, plain(r.target), r.decision, r.ruleName])).toEqual([
      ['change', 'Target 62.5 kg × 8–12', 'increase_load', '8–12 reps, up to RPE 9'],
    ]);
    expect(sum.nextTime?.rows[0]?.summary).toContain('Increase to 62.5');
  });

  it('an incomplete session holds with the domain fact; a first time has nothing to compare', () => {
    let s = workout(BENCH, bar, 3);
    s = logAll(s, [values(kg(60), 12), values(kg(60), 12)], 0);
    s = finish(s, 600);
    const sum = buildWorkoutSummary(input(s, []));
    expect(sum.facts.skippedSets).toBe(1);
    expect(sum.comparison).toEqual({ kind: 'first_time', text: 'First time' });
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

  it('shows the check-in as given; score and reasons never change Next time, but pain with no movement holds it (check 19, 24; PM SP3)', () => {
    const s = finish(logAll(workout(BENCH, bar, 3), [1, 2, 3].map(() => values(kg(60), 12)), 0), 600);
    const low = newCheckIn({ id: id(42), ownerId: OWNER, opId: 'c', score: 1, reasons: ['tired'], note: 'Baby was up at 3', at: at(-60), localDate: '2026-10-08' });
    const high = { ...low, score: 5 as const, reasons: [] };
    const a = buildWorkoutSummary(input(s, [lastWeek], { checkIn: low }));
    expect(a.checkIn).toEqual({ checkInId: id(42), scoreText: '1 of 5', reasons: 'Tired', note: 'Baby was up at 3', painNotFlagged: false });
    const b = buildWorkoutSummary(input(s, [lastWeek], { checkIn: high }));
    const c = buildWorkoutSummary(input(s, [lastWeek], { checkIn: null }));
    expect(a.nextTime).toEqual(b.nextTime);
    expect(b.nextTime).toEqual(c.nextTime);
    expect(c.checkIn).toBeNull();
    expect(buildWorkoutSummary(input(s, [lastWeek], { checkIn: { ...low, deletedAtUtc: at(5).utc } })).checkIn).toBeNull();
    // Pain with no movement chosen: no increases for any exercise of this workout.
    const pain = { ...low, reasons: ['pain' as const, 'tired' as const] };
    const d = buildWorkoutSummary(input(s, [lastWeek], { checkIn: pain }));
    expect(d.checkIn?.painNotFlagged).toBe(true);
    expect(d.nextTime?.rows.map((r) => [r.kind, r.decision, plain(r.target)])).toEqual([['pain', 'halted_pain', 'Same target: 60 kg × 8–12']]);
    // With the movement flagged instead, only that flag holds (here: the same exercise).
    expect(buildWorkoutSummary(input(s, [lastWeek], { checkIn: { ...pain, painFlagIds: [id(9)] } })).nextTime).toEqual(c.nextTime);
  });

  it('a first, complete session lists nothing: Same targets next time', () => {
    const s = finish(logAll(workout(BENCH, bar, 2), [values(kg(60), 10), values(kg(60), 9)], 0), 600);
    const sum = buildWorkoutSummary(input(s, []));
    expect(sum.nextTime).toEqual({ sourceTag: 'Rule', rows: [], emptyText: 'Same targets next time' });
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
    const hist: HistorySession = { sessionId: id(601), performedAtUtc: at(-86_400).utc, equipmentId: db.id, gymId: GYM, imported: false, sets: [1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(30, 'per_hand'), reps: 12, rpe: null, rir: null })) };
    const s = finish(logAll(workout(press, db, 2), [1, 2].map(() => values(kg(30, 'per_hand'), 12)), 0), 600);
    const sum = buildWorkoutSummary(input(s, [hist]));
    expect(sum.exercises[0]?.setsText).toBe('2 sets (kg each)');
    expect(sum.exercises[0]?.unitNote).toBe('(kg each)');
    expect(sum.nextTime?.rows.map((r) => [r.decision, plain(r.target)])).toEqual([['increase_reps', 'Target 30 kg each × 13']]);
  });

  it('assisted machine: progress means less assistance', () => {
    const a = assisted();
    const pull = exercise(222, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
    const hist: HistorySession = { sessionId: id(602), performedAtUtc: at(-86_400).utc, equipmentId: a.id, gymId: GYM, imported: false, sets: [1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(30, 'assistance'), reps: 12, rpe: null, rir: null })) };
    const s = finish(logAll(workout(pull, a, 2), [1, 2].map(() => values(kg(30, 'assistance'), 12)), 0), 600);
    expect(buildWorkoutSummary(input(s, [hist])).nextTime?.rows.map((r) => plain(r.target))).toEqual(['Target Assist 25 kg × 8–12']);
  });
});

describe('buildTodayView', () => {
  const tz = 'Pacific/Auckland';
  const local = (utc: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(utc));
  const base = { todayLocalDate: local(at(0).utc), localDateOf: local, recentCheckIns: [], finishedThisWeek: [] as SessionAggregate[] };

  it('no workout: Nothing planned; the week line counts finished workouts', () => {
    expect(buildTodayView({ ...base, nowMs: ms(0), active: null })).toMatchObject({ main: { kind: 'no_plan' }, week: { count: 0, text: 'No workouts yet this week.' } });
    const done = finish(logAll(workout(BENCH, barbell(), 1, -7200), [values(kg(60), 10)], -7200), -6000);
    const v = buildTodayView({ ...base, nowMs: ms(0), active: null, finishedThisWeek: [done] });
    expect(v.main).toMatchObject({ kind: 'done_today', title: 'Workout' });
    expect(v.week).toEqual({ count: 1, text: '1 workout this week', days: [] });
  });

  it('This week strip: a dot per day, trained and today marked; a derived name for an unnamed workout', () => {
    const done = finish(logAll(workout(BENCH, barbell(), 1, -7200), [values(kg(60), 10)], -7200), -6000);
    const today = local(at(0).utc);
    const dayBefore = local(at(-86_400).utc);
    const weekDates = [dayBefore, today, 'x-3', 'x-4', 'x-5', 'x-6', 'x-7'];
    const v = buildTodayView({ ...base, nowMs: ms(0), active: null, finishedThisWeek: [done], weekDates, titles: { [done.session.id]: 'Push' } });
    expect(v.week.days.map((d) => [d.letter, d.trained, d.today])).toEqual([
      ['M', false, false],
      ['T', true, true],
      ['W', false, false],
      ['T', false, false],
      ['F', false, false],
      ['S', false, false],
      ['S', false, false],
    ]);
    expect(v.main).toMatchObject({ kind: 'done_today', title: 'Push' });
  });

  it('week line: a workout in progress is never "no workouts" (premium-feel §2.5, device bug D1)', () => {
    const today = local(at(0).utc);
    const weekDates = ['x-1', 'x-2', 'x-3', 'x-4', 'x-5', today, 'x-7'];
    const s = logAll(workout(BENCH, barbell(), 3), [values(kg(60), 10)], 0);
    const v = buildTodayView({ ...base, nowMs: ms(30), active: s, weekDates });
    expect(v.week.count).toBe(0);
    expect(v.week.text).toBe('Workout in progress');
    expect(v.week.text).not.toMatch(/No workouts/);
    expect(v.week.days.map((d) => [d.trained, d.inProgress, d.today])[5]).toEqual([false, true, true]);
    expect(weekStripLabel(v.week.days)).toBe('This week: 0 days trained, today in progress');

    const done = finish(logAll(workout(BENCH, barbell(), 1, -7200), [values(kg(60), 10)], -7200), -6000);
    const both = buildTodayView({ ...base, nowMs: ms(30), active: s, finishedThisWeek: [done], weekDates, titles: { [s.session.id]: 'Full body' } });
    expect(both.week.text).toBe('1 done · Full body in progress');
    expect(both.week.days[5]).toMatchObject({ trained: true, inProgress: true, today: true });
    expect(weekStripLabel(both.week.days)).toBe('This week: 1 day trained, today in progress');
  });

  it('a forgotten workout from an earlier week is not "in progress" this week (review S8)', () => {
    const later = 9 * 86_400;
    const today = local(at(later).utc);
    const weekDates = ['x-1', 'x-2', 'x-3', today, 'x-5', 'x-6', 'x-7'];
    const s = logAll(workout(BENCH, barbell(), 3), [values(kg(60), 10)], 0);
    const v = buildTodayView({ ...base, nowMs: ms(later), active: s, weekDates });
    expect(v.main.kind).toBe('stale');
    expect(v.week.text).toBe('No workouts yet this week.');
    expect(v.week.days.some((d) => d.inProgress)).toBe(false);
  });

  it('weekText: every row of the §2.5 table', () => {
    expect(weekText(0, null)).toBe('No workouts yet this week.');
    expect(weekText(0, 'Full body')).toBe('Full body in progress');
    expect(weekText(1, null)).toBe('1 workout this week');
    expect(weekText(3, null)).toBe('3 workouts this week');
    expect(weekText(2, 'Push A')).toBe('2 done · Push A in progress');
  });

  it('a finished session is not in progress', () => {
    const today = local(at(0).utc);
    const done = finish(logAll(workout(BENCH, barbell(), 1, -7200), [values(kg(60), 10)], -7200), -6000);
    const v = buildTodayView({ ...base, nowMs: ms(0), active: done, finishedThisWeek: [done], weekDates: [today] });
    expect(v.week.days[0]).toMatchObject({ trained: true, inProgress: false });
    expect(v.week.text).toBe('1 workout this week');
  });

  it('resume rows: done / now / pending / skipped, in words, with where a tap resumes (premium-feel §2.3)', () => {
    let s = workout(BENCH, barbell(), 3);
    s = logAll(s, [values(kg(60), 10)], 0);
    const v = buildTodayView({ ...base, nowMs: ms(30), active: s });
    if (v.main.kind !== 'resume') throw new Error('not resume');
    expect(v.main.rows).toEqual([
      { sessionExerciseId: s.exercises[0]?.id, name: 'Bench press', status: 'now', done: 1, total: 3, text: '1 of 3 sets', firstPendingSetId: s.sets.filter((x) => x.status === 'pending').sort((a, b) => a.index - b.index)[0]?.id },
    ]);
    // Another exercise's view of the same workout: pending, then all done, then skipped.
    expect(resumeRows(s, null)[0]?.status).toBe('pending');
    const allDone = { ...s, sets: s.sets.map((x) => ({ ...x, status: 'completed' as const })) };
    expect(resumeRows(allDone, null)[0]).toMatchObject({ status: 'done', text: '3 of 3 sets', firstPendingSetId: null });
    const skipped = { ...s, sets: s.sets.map((x) => ({ ...x, status: 'skipped' as const })) };
    expect(resumeRows(skipped, null)[0]).toMatchObject({ status: 'skipped', text: 'Skipped' });
    const deleted = { ...s, sets: s.sets.map((x, i) => (i === 2 ? { ...x, status: 'deleted' as const } : x)) };
    expect(resumeRows(deleted, null)[0]?.total).toBe(2);
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

describe('date-only (imported) workouts on Today and the summary (review B2, N3)', () => {
  /** A FitNotes workout dated `date`, imported in London (anchor 12:00 local, no end time). */
  function imported(date: string): SessionAggregate {
    const p = parseFitNotesCsv(`Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n${date},Lat pulldown,Back,40,10,,,\n`, '2026-10-31');
    if (!p.ok) throw new Error('not parsed');
    const ctx = { ownerId: OWNER, candidates: CANDIDATES, aliases: new Map(), appDates: new Set<string>(), importedDates: new Map(), defaultUnit: 'kg' as const };
    const jobId = '00000000-0000-4000-8000-0000000a0b01';
    const rows = planImportRows(p, analyseImport(p, ctx, DEFAULT_ANSWERS), { jobId, defaultUnit: 'kg' });
    return buildImportedSession({ ownerId: OWNER, jobId, operationId: 'op-1', tz: 'Europe/London', gymId: null, importedAtUtc: '2026-10-09T17:00:00.000Z', date, rows });
  }
  const londonDate = (utc: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(utc));

  it('trained with FitNotes this morning and imported at 18:00: Today says done with no duration', () => {
    const now = Date.parse('2026-10-09T17:00:00.000Z');
    const v = buildTodayView({ nowMs: now, active: null, finishedThisWeek: [imported('2026-10-09')], todayLocalDate: '2026-10-09', localDateOf: londonDate, recentCheckIns: [] });
    expect(v.main).toEqual({ kind: 'done_today', sessionId: expect.any(String) as string, title: 'Workout', activeMs: null });
  });

  it('the summary shows the date only: no time range, no active time', () => {
    const agg = imported('2026-10-09');
    const sum = buildWorkoutSummary({ aggregate: agg, nowMs: Date.parse('2026-10-09T17:00:00.000Z'), gymName: null, history: {}, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    expect(sum.dateOnly).toBe('2026-10-09');
    expect(sum.endedAtUtc).toBeNull();
    expect(sum.facts).toMatchObject({ activeMs: null, activeText: null, workingSets: 1 });
    // A workout logged in the app keeps its times.
    const logged = finish(logAll(workout(BENCH, barbell(), 1), [values(kg(60), 10)], 0), 600);
    const own = buildWorkoutSummary(input(logged, []));
    expect(own.dateOnly).toBeNull();
    expect(own.facts.activeMs).toBeGreaterThan(0);
  });

  it('an imported workout is a history record: no comparison, highlight or Next time (review r2 B1)', () => {
    const earlier = imported('2026-10-01');
    const agg = imported('2026-10-05');
    const exId = agg.exercises[0]?.exerciseId ?? '';
    const history = { [exId]: [...toHistorySessions(earlier, exId), ...toHistorySessions(agg, exId)] };
    const sum = buildWorkoutSummary({ aggregate: agg, nowMs: Date.parse('2026-10-09T17:00:00.000Z'), gymName: null, history, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    expect(sum.facts.workingSets).toBe(1);
    expect(sum.comparison).toBeNull();
    expect(sum.highlight).toBeNull();
    expect(sum.nextTime).toBeNull();
  });

  it('keeps its own date in a phone zone 12+ hours away (London noon is already tomorrow in Auckland)', () => {
    const agg = imported('2026-10-09');
    const auckland = (utc: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(utc));
    expect(auckland(agg.session.startedAt.utc)).toBe('2026-10-10');
    const now = Date.parse('2026-10-09T05:00:00.000Z'); // 18:00 on 9 Oct in Auckland
    expect(buildTodayView({ nowMs: now, active: null, finishedThisWeek: [agg], todayLocalDate: '2026-10-09', localDateOf: auckland, recentCheckIns: [] }).main).toMatchObject({ kind: 'done_today', activeMs: null });
    expect(buildTodayView({ nowMs: now + 86_400_000, active: null, finishedThisWeek: [agg], todayLocalDate: '2026-10-10', localDateOf: auckland, recentCheckIns: [] }).main).toEqual({ kind: 'no_plan' });
  });
});

describe('imported history is comparable, labelled FitNotes (B7; was P-I3 option (a), review r2 B1)', () => {
  /** FitNotes `Lat pulldown 40 × 10` on 1 Oct, imported with the gym not recorded and no equipment. */
  function importedPulldown(): SessionAggregate {
    const p = parseFitNotesCsv('Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n2026-10-01,Lat pulldown,Back,40,10,,,\n', '2026-10-31');
    if (!p.ok) throw new Error('not parsed');
    const ctx = { ownerId: OWNER, candidates: CANDIDATES, aliases: new Map(), appDates: new Set<string>(), importedDates: new Map(), defaultUnit: 'kg' as const };
    const jobId = '00000000-0000-4000-8000-0000000a0b02';
    const rows = planImportRows(p, analyseImport(p, ctx, DEFAULT_ANSWERS), { jobId, defaultUnit: 'kg' });
    return buildImportedSession({ ownerId: OWNER, jobId, operationId: 'op-2', tz: 'Europe/London', gymId: null, importedAtUtc: '2026-10-02T17:00:00.000Z', date: '2026-10-01', rows });
  }

  it('an exercise with no equipment either side: Last, comparison and highlight from FitNotes, labelled', () => {
    const imp = importedPulldown();
    const impEx = imp.exercises[0];
    if (!impEx) throw new Error('no exercise');
    expect([impEx.equipmentId, impEx.unit, impEx.loadConvention]).toEqual([null, 'kg', 'stack']);
    // Today in the app, added with no equipment (none at this gym): same exercise, unit and convention.
    const pulldown = exercise(230, 'Lat pulldown', { id: impEx.exerciseId, movementPattern: 'pull', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
    const s = finish(logAll(workout(pulldown, null, 1), [values(kg(45, 'stack'), 10)], 0), 600);
    expect(s.exercises[0]).toMatchObject({ equipmentId: null, unit: 'kg', loadConvention: 'stack' });
    const history = toHistorySessions(imp, impEx.exerciseId);
    expect(history.map((h) => [h.imported, h.gymId, h.equipmentId])).toEqual([[true, null, null]]);

    const ex = s.exercises[0];
    if (!ex) throw new Error('no exercise');
    expect(lastComparableSession(history, ex)).toMatchObject({ imported: true, gymId: null, sets: [{ values: { load: kg(40, 'stack'), reps: 10 } }] });
    const sum = buildWorkoutSummary(input(s, history));
    expect(sum.comparison).toMatchObject({ kind: 'compared', why: 'Working sets', lastAtUtc: history[0]?.performedAtUtc });
    // 45 > 40: heaviest, against FitNotes too.
    expect(sum.highlight).toMatch(/^Heaviest Lat pulldown set/);
    // Never claims the FitNotes workout was at today's gym.
    expect(JSON.stringify(sum)).not.toContain('Main Gym, working sets');
  });

  it('the comparison names the compared workout’s own gym, never assumes today’s', () => {
    const bar = barbell();
    const otherGym = id(77);
    const elsewhere: HistorySession = { sessionId: id(603), performedAtUtc: at(-7 * 86_400).utc, equipmentId: bar.id, gymId: otherGym, imported: false, sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load: kg(60), reps: 12, rpe: 8, rir: null })) };
    const s = finish(logAll(workout(BENCH, bar, 3), [1, 2, 3].map(() => values(kg(60), 12, { rpe: 8 })), 0), 600);
    const named = buildWorkoutSummary(input(s, [elsewhere], { gymNames: { [otherGym]: 'Home', [GYM]: 'Main Gym' } }));
    expect(named.comparison?.kind === 'compared' ? plain(named.comparison.why) : null).toBe('Same Olympic bar at Home, working sets');
    // Its gym's name isn't known: no gym named rather than today's.
    const unnamed = buildWorkoutSummary(input(s, [elsewhere]));
    expect(unnamed.comparison?.kind === 'compared' ? plain(unnamed.comparison.why) : null).toBe('Same Olympic bar, working sets');
    // Not recorded: said so.
    const notRecorded = buildWorkoutSummary(input(s, [{ ...elsewhere, gymId: null }]));
    expect(notRecorded.comparison?.kind === 'compared' ? plain(notRecorded.comparison.why) : null).toBe('Same Olympic bar, gym not recorded, working sets');
  });
});

describe('Summary record lines (premium-feel §5.1, review S3)', () => {
  const eq = barbell();
  const past = (load: number, day: number): SessionAggregate => finish(logAll(workout(BENCH, eq, 1, day * 86_400, `p${String(day)}`), [values(kg(load), 5)], day * 86_400), day * 86_400 + 600);
  const history = [past(60, -3), past(62.5, -2), past(65, -1)].flatMap((s) => toHistorySessions(s, BENCH.id));

  it('one line per exercise: the heaviest set wins over a later most-reps set', () => {
    const today = finish(logAll(workout(BENCH, eq, 3), [values(kg(65), 5), values(kg(67.5), 5), values(kg(67.5), 6)], 0), 1_000);
    const sum = buildWorkoutSummary(input(today, history));
    expect(sum.records).toEqual(['Heaviest bench press set at Main Gym so far']);
  });

  it('most reps at the heaviest load when nothing heavier', () => {
    const today = finish(logAll(workout(BENCH, eq, 1), [values(kg(65), 7)], 0), 1_000);
    expect(buildWorkoutSummary(input(today, history)).records.map(plain)).toEqual(['Most reps at 65 kg on bench press so far']);
  });

  it('none before 3 earlier sessions, and later workouts never count against an old Summary', () => {
    const today = finish(logAll(workout(BENCH, eq, 1), [values(kg(70), 5)], 0), 1_000);
    expect(buildWorkoutSummary(input(today, history.slice(1))).records).toEqual([]);
    // A heavier workout after this one doesn't take this one's record away.
    const later = toHistorySessions(past(80, 2), BENCH.id);
    expect(buildWorkoutSummary(input(today, [...history, ...later])).records).toHaveLength(1);
  });
});

describe('doneTodayDurationLine (F20)', () => {
  it('shows the duration once: not again under a title that already ends with it', () => {
    expect(doneTodayDurationLine('Legs · 45 min', 45 * 60_000)).toBeNull();
    expect(doneTodayDurationLine('Legs · 45 min', 52 * 60_000)).toBe('52 min');
    expect(doneTodayDurationLine('Legs', 45 * 60_000)).toBe('45 min');
    expect(doneTodayDurationLine('Legs · 45 min', null)).toBeNull();
  });
});
