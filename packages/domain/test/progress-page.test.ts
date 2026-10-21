import { describe, expect, it } from 'vitest';

import type { BuilderMuscleInfo, LiftTarget, Load, ReviewProposal, TrainingReview } from '@fizz/schemas';
import {
  addDays,
  changeRowView,
  coachChangesView,
  isStructuralProposal,
  liftsView,
  loadAtReps,
  musclePlanOfReview,
  musclesView,
  percentOfPlan,
  thisWeekView,
  toMs,
  type LiftsOptions,
  type ReviewPlan,
  type ReviewSession,
  type ReviewSet,
  type ReviewTemplate,
  type WeeklyReviewInput,
} from '../src/index';

/**
 * Progress v3 (agreed with Ben 21 Oct; progress-goals.md "Progress v3 (agreed)", prototype
 * progress-simple.html): This week, Lifts, Muscles and Coach's changes as pure view models.
 */

const TZ = 'Europe/London';
const MONDAY = '2026-10-12';
/** Thu 15 Oct, 09:00: the week is live. */
const LIVE = toMs('2026-10-15T08:00:00.000Z');
const TODAY = '2026-10-15';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BENCH = id(1);
const SQUAT = id(2);
const ROW = id(3);
const CURL = id(4);
const PULLUP = id(5);
const PUSHUP = id(6);
const DB_PRESS = id(7);
const RAISE = id(8);
const INFO: Record<string, BuilderMuscleInfo> = {
  [BENCH]: { primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] },
  [SQUAT]: { primaryMuscles: ['quads'] },
  [ROW]: { primaryMuscles: ['lats'] },
  [CURL]: { primaryMuscles: ['biceps'] },
  [PULLUP]: { primaryMuscles: ['lats'] },
  [PUSHUP]: { primaryMuscles: ['chest'] },
  [DB_PRESS]: { primaryMuscles: ['front_delts'] },
  [RAISE]: { primaryMuscles: ['side_delts'] },
};
const NAMES: Record<string, string> = { [BENCH]: 'Bench', [SQUAT]: 'Squat', [ROW]: 'Row', [CURL]: 'Curl', [PULLUP]: 'Pull-up', [PUSHUP]: 'Push-up', [DB_PRESS]: 'DB press', [RAISE]: 'Lat raise' };
const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const lb = (value: number): Load => ({ value, unit: 'lb', convention: 'total' });
const work = (load: Load | null, reps: number, more: Partial<ReviewSet> = {}): ReviewSet => ({ setType: 'working', load, reps, rpe: null, targetRpe: null, counts: true, ...more });

let seq = 1000;
function sess(date: string, exercises: { exerciseId: string; sets: ReviewSet[]; equipmentId?: string; equipmentKind?: 'weight_stack' | 'plate_loaded_machine' }[], more: Partial<ReviewSession> = {}): ReviewSession {
  seq += 1;
  const startedAtUtc = `${date}T17:00:00.000Z`;
  return {
    sessionId: id(seq),
    name: 'Workout',
    date,
    startedMs: toMs(startedAtUtc),
    startedAtUtc,
    routineId: null,
    template: null,
    feel: null,
    plannedReps: null,
    doneReps: 0,
    exercises: exercises.map((e) => ({ exerciseId: e.exerciseId, name: NAMES[e.exerciseId] ?? 'X', equipmentKind: e.equipmentKind ?? null, equipmentId: e.equipmentId ?? null, sets: e.sets, plannedWorking: e.sets.length })),
    ...more,
  };
}
const input = (more: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput => ({ monday: MONDAY, nowMs: LIVE, tz: TZ, sessions: [], plans: [], aim: null, goal: null, info: (x) => INFO[x] ?? null, lifts: [], liftTargets: [], activities: [], templates: [], painFlagged: new Set(), unit: 'kg', ...more });

const CHEST = id(50);
const BACK = id(51);
const SHOULDERS = id(52);
const LEGS = id(53);
const PLAN = id(60);
const plan = (more: Partial<ReviewPlan> = {}): ReviewPlan => ({
  planId: PLAN,
  appliedAtUtc: '2026-08-01T08:00:00.000Z',
  untilUtc: null,
  days: [
    { routineId: CHEST, name: 'Chest', bodyParts: ['Chest'] },
    { routineId: BACK, name: 'Back', bodyParts: ['Back'] },
    { routineId: SHOULDERS, name: 'Shoulders', bodyParts: ['Shoulders'] },
    { routineId: LEGS, name: 'Legs', bodyParts: ['Quads'] },
  ],
  pausedDates: new Set(),
  ...more,
});

describe('This week: sessions, one chip per planned session with day and % of planned reps', () => {
  it('% of planned reps: done ÷ planned, can go over 100; null with nothing planned in reps', () => {
    expect(percentOfPlan({ plannedReps: 170, doneReps: 156 })).toBe(92);
    expect(percentOfPlan({ plannedReps: 50, doneReps: 52 })).toBe(104);
    expect(percentOfPlan({ plannedReps: null, doneReps: 40 })).toBeNull();
    expect(percentOfPlan({ plannedReps: 0, doneReps: 0 })).toBeNull();
  });

  it('a plan: done chips `Mon – 100%` (one line), the rest `to do` while the week runs; runs counted apart', () => {
    const chest = sess('2026-10-12', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST, plannedReps: 40, doneReps: 40 });
    const back = sess('2026-10-14', [{ exerciseId: ROW, sets: [work(kg(90), 8)] }], { routineId: BACK, plannedReps: 170, doneReps: 156 });
    const v = thisWeekView(input({ sessions: [chest, back], plans: [plan()], activities: [{ id: 'r1', date: '2026-10-13', kind: 'run', status: 'done', distanceM: 5000 }, { id: 'r2', date: '2026-10-14', kind: 'run', status: 'done', distanceM: null }] }), { today: TODAY });
    expect(v.range).toBe('12–18 Oct');
    expect(v.sessions).toBe('2 of 4');
    expect(v.runs).toBe('2 runs');
    expect(v.chips.map((c) => [c.name, c.line, c.state])).toEqual([
      ['Chest', 'Mon – 100%', 'done'],
      ['Back', 'Wed – 92%', 'done'],
      ['Shoulders', 'to do', 'upcoming'],
      ['Legs', 'to do', 'upcoming'],
    ]);
    expect(v.chips[0]?.sessionId).toBe(chest.sessionId);
    expect(v.chips[1]?.accessibilityLabel).toBe('Back, done Wednesday, 92% of planned reps');
    expect(v.empty).toBe(false);
  });

  it('once the week is over, a planned session not done is `missed` (no red, no day: plan days aren’t dated)', () => {
    const chest = sess('2026-10-12', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST, plannedReps: 40, doneReps: 40 });
    const v = thisWeekView(input({ sessions: [chest], plans: [plan()], nowMs: toMs('2026-10-19T08:00:00.000Z') }), { today: '2026-10-19' });
    expect(v.chips.map((c) => c.state)).toEqual(['done', 'missed', 'missed', 'missed']);
    expect(v.chips[1]?.line).toBe('missed');
  });

  it('paused days take sessions off the week: the extra days read `paused`; a fully paused week is `Paused`', () => {
    const paused = new Set(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    const chest = sess('2026-10-12', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST, plannedReps: 40, doneReps: 40 });
    const v = thisWeekView(input({ sessions: [chest], plans: [plan({ pausedDates: paused })] }), { today: TODAY });
    expect(v.sessions).toBe('1 of 2');
    expect(v.chips.map((c) => c.state)).toEqual(['done', 'upcoming', 'paused', 'paused']);
    const all = new Set(Array.from({ length: 7 }, (_, i) => `2026-10-${String(12 + i)}`));
    expect(thisWeekView(input({ plans: [plan({ pausedDates: all })] }), { today: TODAY }).sessions).toBe('Paused');
  });

  it('no plan: the days-a-week aim (workouts, then `to do`); neither: the workouts done; nothing at all: empty', () => {
    const a = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { name: 'Push', plannedReps: null, doneReps: 6 });
    const aim = thisWeekView(input({ sessions: [a], aim: 3 }), { today: TODAY });
    expect(aim.sessions).toBe('1 of 3');
    expect(aim.chips.map((c) => [c.name, c.line, c.state])).toEqual([['Push', 'Tue', 'done'], ['Workout', 'to do', 'upcoming'], ['Workout', 'to do', 'upcoming']]);
    const none = thisWeekView(input({ sessions: [a] }), { today: TODAY });
    expect(none.sessions).toBe('1');
    expect(none.chips).toHaveLength(1);
    expect(thisWeekView(input(), { today: TODAY }).empty).toBe(true);
  });

  it('Last 4 weeks: one square per planned session (done, missed, paused), `n of m` right, newest first, the week’s review to open', () => {
    const s = [
      sess('2026-10-05', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST }),
      sess('2026-10-07', [{ exerciseId: ROW, sets: [work(kg(90), 8)] }], { routineId: BACK }),
      sess('2026-10-09', [{ exerciseId: DB_PRESS, sets: [work(kg(20, 'per_hand'), 10)] }], { routineId: SHOULDERS }),
      sess('2026-09-22', [{ exerciseId: BENCH, sets: [work(kg(95), 6)] }], { routineId: CHEST }),
    ];
    const pausedWeek = new Set(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    const v = thisWeekView(input({ sessions: s, plans: [plan({ pausedDates: pausedWeek })], activities: [{ id: 'r', date: '2026-10-06', kind: 'run', status: 'done', distanceM: null }] }), { today: TODAY, reviewIds: new Map([['2026-10-05', 'rev-1']]) });
    expect(v.past.map((r) => [r.week, r.squares.join(','), r.right])).toEqual([
      ['5 Oct', 'done,done,done,missed', '3 of 4'],
      ['28 Sep', 'paused,paused,paused,paused', 'Paused'],
      ['21 Sep', 'done,missed,missed,missed', '1 of 4'],
      ['14 Sep', 'missed,missed,missed,missed', '0 of 4'],
    ]);
    expect(v.past[0]?.accessibilityLabel).toBe('Week of 5 October: 3 of 4 sessions, 1 run');
    expect(v.past[1]?.accessibilityLabel).toBe('Week of 28 September: paused');
    expect(v.past[0]?.reviewId).toBe('rev-1');
    expect(v.past[2]?.reviewId).toBeNull();
  });
});

describe('Lifts: top set at each lift’s reps, real kg, est. points hollow', () => {
  const weeks = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];
  const opts = (more: Partial<LiftsOptions> = {}): LiftsOptions => ({ today: TODAY, mains: new Set([BENCH, SQUAT, ROW]), planReps: new Map([[BENCH, 6], [SQUAT, 5], [ROW, 8]]), pickedReps: {}, nameOf: (x) => NAMES[x] ?? 'Exercise', ...more });
  const series = (exerciseId: string, sets: readonly (ReviewSet | null)[]) => sets.flatMap((s, i) => (s === null ? [] : [sess(addWeekday(weeks[i] ?? MONDAY), [{ exerciseId, sets: [s] }])]));
  const addWeekday = (monday: string) => addDays(monday, 1);

  it('the app’s e1RM formula converts a set to other reps (Epley), rounded for display', () => {
    expect(loadAtReps(100, 4, 6, 'kg')).toBe(94.5);
    expect(loadAtReps(100, 6, 1, 'kg')).toBe(120);
    expect(loadAtReps(100, 5, 5, 'kg')).toBe(100);
    expect(loadAtReps(225, 3, 5, 'lb')).toBe(212);
  });

  it('tracked reps: a lift target’s, else the plan’s, else Ben’s pick, else his newest top set’s', () => {
    const target: LiftTarget = { id: 't', exerciseId: BENCH, exerciseName: 'Bench', kind: 'weight_reps', load: { value: 110, unit: 'kg', convention: 'total' }, reps: 5, setAtUtc: '2026-08-01T08:00:00.000Z', setOnDate: '2026-08-01', was: null, setBy: 'ben' };
    const sessions = [...series(BENCH, [work(kg(100), 5)]), ...series(SQUAT, [work(kg(120), 5)]), ...series(CURL, [work(kg(15, 'per_hand'), 10)]), ...series(RAISE, [work(kg(10, 'per_hand'), 15)])];
    const v = liftsView(input({ sessions, lifts: [BENCH, SQUAT, CURL, RAISE], liftTargets: [target] }), opts({ pickedReps: { [CURL]: 12 } }));
    expect(v.lifts.map((l) => [l.name, l.reps, l.repsSource])).toEqual([['Bench', 5, 'target'], ['Squat', 5, 'plan'], ['Curl', 12, 'picked'], ['Lat raise', 12, 'logged']]);
    expect(v.lifts[0]?.targetText).toBe('110');
  });

  it('real point when a set reached the reps (heaviest for at least them); else est. from the best 3–12-rep set; a single never (a long set is real: it reached the reps)', () => {
    const sessions = series(BENCH, [work(kg(90), 6), work(kg(100), 4), work(kg(120), 1), work(kg(60), 15), work(kg(95), 8), null, work(kg(80), 3), work(kg(100), 6)]);
    const l = liftsView(input({ sessions, lifts: [BENCH] }), opts()).lifts[0];
    expect(l?.points.map((p) => [p.week, p.value, p.estimate])).toEqual([[0, 90, false], [1, 94.5, true], [3, 60, false], [4, 95, false], [6, 73.5, true], [7, 100, false]]);
    expect(l?.points[1]?.detail).toBe('est. 94.5 × 6 from 100 × 4');
    expect(l?.current).toBe('100');
    expect(l?.chartLabel).toContain('2 estimated');
  });

  it('an estimate as the newest point is marked (○) and said', () => {
    const sessions = series(BENCH, [null, null, null, null, null, null, work(kg(100), 6), work(kg(105), 4)]);
    const l = liftsView(input({ sessions, lifts: [BENCH] }), opts()).lifts[0];
    expect(l?.current).toBe('○ 99');
    expect(l?.currentEstimate).toBe(true);
    expect(l?.accessibilityLabel).toContain('current estimated 99 kg');
  });

  it('kg sets on a lb profile are shown in lb; per-hand dumbbells say `each`', () => {
    const sessions = [...series(BENCH, [work(kg(100), 6)]), ...series(DB_PRESS, [work(kg(30, 'per_hand'), 10)])];
    const v = liftsView(input({ sessions, lifts: [BENCH, DB_PRESS], unit: 'lb' }), opts({ planReps: new Map([[BENCH, 6], [DB_PRESS, 10]]) }));
    expect(v.unit).toBe('lb');
    expect(v.lifts[0]?.points[0]?.value).toBe(220);
    expect(v.lifts.find((l) => l.exerciseId === DB_PRESS)?.accessibilityLabel).toContain('kg each'.replace('kg', 'lb'));
    const lbSets = liftsView(input({ sessions: series(BENCH, [work(lb(225), 6)]), lifts: [BENCH] }), opts()).lifts[0];
    expect(lbSets?.points[0]?.value).toBe(102);
  });

  it('assisted: less assistance is better, never estimated; bodyweight is listed with best reps, not drawn', () => {
    const sessions = [...series(PULLUP, [work(kg(30, 'assistance'), 8), work(kg(25, 'assistance'), 5), work(kg(20, 'assistance'), 8)]), ...series(PUSHUP, [work(kg(0, 'bodyweight'), 20), work(null, 22)])];
    const v = liftsView(input({ sessions, lifts: [PULLUP, PUSHUP] }), opts({ mains: new Set(), planReps: new Map([[PULLUP, 8]]) }));
    const pull = v.lifts.find((l) => l.exerciseId === PULLUP);
    expect(pull?.lowerIsBetter).toBe(true);
    expect(pull?.points.map((p) => [p.value, p.estimate])).toEqual([[30, false], [20, false]]);
    expect(pull?.accessibilityLabel).toContain('up 10 kg assist in 8 weeks');
    const push = v.lifts.find((l) => l.exerciseId === PUSHUP);
    // No plan or split main lifts: the lifts shown are the main ones; a bodyweight one is listed, never drawn.
    expect(push).toMatchObject({ chartable: false, repsText: '–', current: '22 reps', colour: null, accessory: false });
  });

  it('main lifts are drawn (colour slots 1–3); everything else is listed under Accessories', () => {
    const sessions = [BENCH, SQUAT, ROW, RAISE, CURL].flatMap((x) => series(x, [work(kg(50), 8)]));
    const v = liftsView(input({ sessions, lifts: [RAISE, BENCH, CURL, SQUAT, ROW] }), opts());
    expect(v.lifts.map((l) => [l.name, l.colour, l.accessory])).toEqual([['Bench', 0, false], ['Squat', 1, false], ['Row', 2, false], ['Lat raise', null, true], ['Curl', null, true]]);
    expect(v.weeks).toEqual(['24 Aug', '31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct'].map((w) => w.replace(' ', ' ')));
    expect(v.chartLabel).toBe('Top sets over 8 weeks: Bench 50 to 50 kg, Squat 50 to 50 kg, Row 50 to 50 kg');
  });

  it('`On track` and `about mid-Nov at this rate`: real points only, after 4 rising weeks, within 6 months', () => {
    const target: LiftTarget = { id: 't', exerciseId: BENCH, exerciseName: 'Bench', kind: 'weight_reps', load: { value: 110, unit: 'kg', convention: 'total' }, reps: 6, setAtUtc: '2026-08-01T08:00:00.000Z', setOnDate: '2026-08-01', was: null, setBy: 'ben' };
    const rising = series(BENCH, [90, 92.5, 92.5, 95, 95, 97.5, 97.5, 100].map((x) => work(kg(x), 6)));
    const l = liftsView(input({ sessions: rising, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0];
    expect(l?.focus.onTrack).toBe(true);
    expect(l?.focus.eta).toBe('about late-Nov at this rate');
    expect(l?.focus.subtitle).toBe('Top set × 6 (target reps) · 100 now');
    // Falling lately: no date.
    const falling = series(BENCH, [90, 92.5, 95, 97.5, 100, 97.5, 97.5, 97.5].map((x) => work(kg(x), 6)));
    expect(liftsView(input({ sessions: falling, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0]?.focus).toMatchObject({ onTrack: false, eta: null });
    // Too slow to get there within 6 months: no date.
    const slow = series(BENCH, [90, 90, 90, 90, 90, 90.5, 91, 91.5].map((x) => work(kg(x), 6)));
    expect(liftsView(input({ sessions: slow, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0]?.focus.eta).toBeNull();
    // Rising only on estimates: no date.
    const est = series(BENCH, [90, 92.5, 95, 97.5, 100, 102.5, 105, 107.5].map((x) => work(kg(x), 4)));
    expect(liftsView(input({ sessions: est, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0]?.focus.eta).toBeNull();
    // No target: nothing to be on track for.
    expect(liftsView(input({ sessions: rising, lifts: [BENCH] }), opts()).lifts[0]?.focus).toMatchObject({ onTrack: false, eta: null, subtitle: 'Top set × 6 (plan reps) · 100 now' });
  });

  it('`at this rate` only on the most recent points: weeks that fell since (even as estimates), or a stale run, give no date (review progress-v3-data B2)', () => {
    const target: LiftTarget = { id: 't', exerciseId: BENCH, exerciseName: 'Bench', kind: 'weight_reps', load: { value: 110, unit: 'kg', convention: 'total' }, reps: 6, setAtUtc: '2026-08-01T08:00:00.000Z', setOnDate: '2026-08-01', was: null, setBy: 'ben' };
    const fell = series(BENCH, [work(kg(90), 6), work(kg(92.5), 6), work(kg(95), 6), work(kg(97.5), 6), null, work(kg(85), 4), null, work(kg(85), 4)]);
    const l = liftsView(input({ sessions: fell, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0];
    expect(l?.current).toBe('○ 80.5');
    expect(l?.focus).toMatchObject({ onTrack: false, eta: null });
    // Four rising real weeks, but the newest 3 weeks ago: no date.
    const stale = series(BENCH, [null, work(kg(90), 6), work(kg(92.5), 6), work(kg(95), 6), work(kg(97.5), 6), null, null, null]);
    expect(liftsView(input({ sessions: stale, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0]?.focus.eta).toBeNull();
    // A flat run isn't rising.
    const flat = series(BENCH, [null, null, null, null, work(kg(100), 6), work(kg(100), 6), work(kg(100), 6), work(kg(100), 6)]);
    expect(liftsView(input({ sessions: flat, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0]?.focus.eta).toBeNull();
  });

  it('a one-rep-max target: only a single is a real 1-rep top set; other sets estimate it, hollow (review progress-v3-data S1)', () => {
    const target = { id: 't', exerciseId: BENCH, exerciseName: 'Bench', kind: 'one_rm', load: { value: 120, unit: 'kg', convention: 'total' }, reps: 1, setAtUtc: '2026-08-01T08:00:00.000Z', setOnDate: '2026-08-01', was: null, setBy: 'ben' } as LiftTarget;
    const sessions = series(BENCH, [null, null, null, null, null, null, work(kg(105), 1), work(kg(97.5), 5)]);
    const l = liftsView(input({ sessions, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0];
    expect(l?.points.map((p) => [p.value, p.estimate])).toEqual([[105, false], [114, true]]);
    expect(l?.current).toBe('○ 114');
    expect(l?.points[1]?.detail).toBe('est. 114 × 1 from 97.5 × 5');
  });

  it('stacks and plate-loaded machines compare only sets on the same machine as the newest (review progress-v3-design S1)', () => {
    const A = id(700);
    const B = id(701);
    const pulldown = (w: number, eq: string, load: number) => sess(addWeekday(weeks[w] ?? MONDAY), [{ exerciseId: ROW, sets: [work(kg(load, 'stack'), 8)], equipmentId: eq, equipmentKind: 'weight_stack' }]);
    const sessions = [pulldown(4, A, 50), pulldown(5, A, 55), pulldown(6, B, 70), pulldown(7, B, 72.5)];
    const l = liftsView(input({ sessions, lifts: [ROW] }), opts()).lifts[0];
    expect(l?.points.map((p) => [p.week, p.value])).toEqual([[6, 70], [7, 72.5]]);
    // Barbell loads are the same anywhere: every set counts.
    const bar = [4, 5, 6, 7].map((w, i) => sess(addWeekday(weeks[w] ?? MONDAY), [{ exerciseId: BENCH, sets: [work(kg(90 + i), 6)], equipmentId: i < 2 ? A : B }]));
    expect(liftsView(input({ sessions: bar, lifts: [BENCH] }), opts()).lifts[0]?.points).toHaveLength(4);
  });

  it('a main lift with no sets in 8 weeks stays a main row (`–`, no line); a 4th main lift is a main row too; only non-plan lifts are Accessories (review progress-v3-design S3)', () => {
    const sessions = [BENCH, ROW, CURL, PULLUP].flatMap((x) => series(x, [work(kg(50), 8)]));
    const v = liftsView(input({ sessions, lifts: [BENCH, SQUAT, ROW, PULLUP, CURL] }), opts({ mains: new Set([BENCH, SQUAT, ROW, PULLUP]) }));
    expect(v.lifts.map((l) => [l.name, l.colour, l.accessory, l.current])).toEqual([
      ['Bench', 0, false, '50'],
      ['Row', 1, false, '50'],
      ['Pull-up', 2, false, '50'],
      ['Squat', null, false, '–'],
      ['Curl', null, true, '50'],
    ]);
  });

  it('tracked reps changed in the window (a new target): a `now × 4` marker at that week', () => {
    const target: LiftTarget = { id: 't', exerciseId: BENCH, exerciseName: 'Bench', kind: 'weight_reps', load: { value: 110, unit: 'kg', convention: 'total' }, reps: 4, setAtUtc: '2026-09-23T08:00:00.000Z', setOnDate: '2026-09-23', was: null, setBy: 'ben' };
    const sessions = series(BENCH, [work(kg(100), 6), null, null, null, null, null, null, work(kg(105), 4)]);
    const l = liftsView(input({ sessions, lifts: [BENCH], liftTargets: [target] }), opts()).lifts[0];
    expect(l?.marker).toEqual({ week: 4, label: 'now × 4' });
    // History before it is shown at the new reps too: 100 × 6 is a real point at 4 reps.
    expect(l?.points[0]).toMatchObject({ week: 0, value: 100, estimate: false });
    // A new plan with other reps: the marker at the plan's start.
    const plan2 = liftsView(input({ sessions, lifts: [BENCH] }), opts({ previousPlanReps: new Map([[BENCH, 8]]), planAppliedDate: '2026-10-01' })).lifts[0];
    expect(plan2?.marker).toEqual({ week: 5, label: 'now × 6' });
    expect(liftsView(input({ sessions, lifts: [BENCH] }), opts()).lifts[0]?.marker).toBeNull();
  });
});

describe('Muscles: sets per week per muscle vs plan, 8 complete weeks', () => {
  const templates: ReviewTemplate[] = [
    { planId: PLAN, routineId: CHEST, name: 'Chest', version: 1, exercises: [{ exerciseId: BENCH, name: 'Bench', workingSets: 4 }] },
    { planId: PLAN, routineId: BACK, name: 'Back', version: 1, exercises: [{ exerciseId: ROW, name: 'Row', workingSets: 4 }, { exerciseId: CURL, name: 'Curl', workingSets: 3 }] },
  ];
  it('rows Chest, Back, Shoulders, Legs, Arms; first primary muscle gets the set; every working set whatever RPE; warm-ups out', () => {
    const s = sess('2026-10-06', [
      { exerciseId: BENCH, sets: [work(kg(60), 10, { setType: 'warmup' }), work(kg(100), 6, { rpe: 6 }), work(kg(100), 6), work(kg(100), 6, { rpe: 10 }), work(kg(100), 6)] },
      { exerciseId: CURL, sets: [work(kg(15, 'per_hand'), 10)] },
    ]);
    const v = musclesView(input({ sessions: [s], plans: [plan()], templates }), { today: TODAY });
    expect(v.rows.map((r) => r.key)).toEqual(['Chest', 'Back', 'Shoulders', 'Legs', 'Arms']);
    expect(v.weeks.at(-1)).toBe('5 Oct');
    const chest = v.rows[0];
    expect(chest?.bars.at(-1)).toEqual({ value: 4, planned: 4, atPlan: true });
    expect(chest?.last).toBe('4 of 4');
    const arms = v.rows[4];
    expect(arms?.bars.at(-1)).toEqual({ value: 1, planned: 3, atPlan: false });
    expect(arms?.accessibilityLabel).toBe('Arms: 1 set last week, plan 3. At plan in 0 of 8 weeks.');
    // The live week isn't a bar (it would read as under plan mid-week).
    expect(musclesView(input({ sessions: [sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }])], plans: [plan()], templates }), { today: TODAY }).rows[0]?.bars.at(-1)?.value).toBe(0);
  });

  it('a reviewed week keeps the plan it was reviewed against: a later +1 set doesn’t re-judge it (review progress-v3-design S4)', () => {
    const s = sess('2026-10-06', [{ exerciseId: BENCH, sets: [work(kg(100), 6), work(kg(100), 6), work(kg(100), 6), work(kg(100), 6)] }]);
    const later: ReviewTemplate[] = [{ ...templates[0], exercises: [{ exerciseId: BENCH, name: 'Bench', workingSets: 5 }] } as ReviewTemplate, templates[1] as ReviewTemplate];
    const stored = musclePlanOfReview({ facts: [{ kind: 'group_sets', group: 'Chest', sets: 4, planned: 4, range: null }, { kind: 'group_sets', group: 'Biceps', sets: 1, planned: 3, range: null }] });
    expect(stored).toEqual(new Map([['Chest', 4], ['Arms', 3]]));
    const v = musclesView(input({ sessions: [s], plans: [plan()], templates: later }), { today: TODAY, storedPlans: new Map([['2026-10-05', stored]]) });
    expect(v.rows[0]?.bars.at(-1)).toEqual({ value: 4, planned: 4, atPlan: true });
    // An unreviewed week uses the plan's templates as they are now.
    expect(musclesView(input({ sessions: [s], plans: [plan()], templates: later }), { today: TODAY }).rows[0]?.bars.at(-1)).toEqual({ value: 4, planned: 5, atPlan: false });
    // A review with no plan line that week: none.
    expect(musclePlanOfReview({ facts: [{ kind: 'group_sets', group: 'Chest', sets: 4, planned: null, range: null }] })).toBeNull();
  });

  it('a paused week is a stub (null); a week under no plan has no plan line; no plan at all: plain counts', () => {
    const all = new Set(Array.from({ length: 7 }, (_, i) => `2026-10-${String(5 + i).padStart(2, '0')}`));
    const v = musclesView(input({ plans: [plan({ pausedDates: all })], templates }), { today: TODAY });
    expect(v.rows[0]?.bars.at(-1)).toEqual({ value: null, planned: null, atPlan: true });
    expect(v.rows[0]?.last).toBe('Paused');
    const late = musclesView(input({ sessions: [sess('2026-09-01', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }])], plans: [plan({ appliedAtUtc: '2026-10-01T08:00:00.000Z' })], templates }), { today: TODAY });
    expect(late.rows[0]?.bars[2]).toEqual({ value: 1, planned: null, atPlan: true });
    const none = musclesView(input({ sessions: [sess('2026-10-06', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }])] }), { today: TODAY });
    expect(none.rows[0]?.last).toBe('1');
    expect(none.rows[0]?.accessibilityLabel).toBe('Chest: 1 set last week.');
    expect(musclesView(input(), { today: TODAY }).empty).toBe(true);
  });
});

describe('Coach’s changes: small changes already made (Undo), structural ones asked, NEW until Got it', () => {
  const proposal = (more: Partial<ReviewProposal> = {}): ReviewProposal => ({ id: 'p1', source: 'coach', change: { kind: 'template_sets', routineId: BACK, routineName: 'Pull', expectedVersion: 2, exerciseId: ROW, exerciseName: 'Row', fromSets: 3, toSets: 4 }, reason: 'Stuck at 92.5 × 8 for 3 weeks', status: 'applied', actionId: id(900), ...more });
  const review = (more: Partial<TrainingReview> = {}): TrainingReview => ({
    id: id(99),
    ownerId: id(80),
    version: 3,
    createdAtUtc: '2026-10-19T09:00:00.000Z',
    updatedAtUtc: '2026-10-19T09:00:00.000Z',
    subject: { kind: 'weekly', weekMonday: '2026-10-12' },
    inputsHash: 'h',
    facts: [],
    coach: { status: 'reviewed', verdict: 'Good week. Legs light.', lines: [], actionIds: [], numbersChecked: true },
    status: 'current',
    supersededById: null,
    opIds: ['o'],
    createdAt: { utc: '2026-10-19T09:00:00.000Z', tz: TZ },
    proposals: [proposal(), proposal({ id: 'p2', change: { kind: 'template_sets', routineId: SHOULDERS, routineName: 'Upper', expectedVersion: 1, exerciseId: RAISE, exerciseName: 'Lateral raise', fromSets: 3, toSets: 4 }, reason: 'Shoulders under plan 2 weeks running', status: 'undone' })],
    ...more,
  });

  it('a set change on the same exercise is small (applied with Undo); nothing in the plan’s sets is structural', () => {
    expect(isStructuralProposal(proposal())).toBe(false);
    const row = changeRowView(proposal());
    expect(row).toMatchObject({ exercise: 'Row', before: '3 sets', after: '4 sets', when: 'next Pull', why: 'Stuck at 92.5 × 8 for 3 weeks', canUndo: true, canRedo: false, statusText: null });
    expect(row.accessibilityLabel).toBe('Row: 3 sets to 4 sets, next Pull. Stuck at 92.5 × 8 for 3 weeks');
    expect(changeRowView(proposal({ status: 'undone' }))).toMatchObject({ canUndo: false, canRedo: true, statusText: 'Undone' });
    expect(changeRowView(proposal({ status: 'stale' }))).toMatchObject({ canUndo: false, canRedo: false, statusText: 'Out of date' });
  });

  it('the coach’s sentence, the changes, NEW until `Got it`; collapsed to `1 change for next week`', () => {
    const v = coachChangesView(review(), TODAY);
    expect(v).toMatchObject({ isNew: true, note: 'Good week. Legs light.', tag: 'Coach', reviewed: true, collapsed: '1 change for next week', asks: [] });
    expect(v?.rows.map((r) => [r.exercise, r.status])).toEqual([['Row', 'applied'], ['Lateral raise', 'undone']]);
    expect(coachChangesView(review({ seenAtUtc: '2026-10-19T10:00:00.000Z' }), TODAY)?.isNew).toBe(false);
  });

  it('a small change not made yet is `Not applied` with Apply, asked, never drawn as made (review progress-v3-design B1, B3)', () => {
    const open = changeRowView(proposal({ status: 'open', actionId: null }));
    expect(open).toMatchObject({ statusText: 'Not applied', canApply: true, canUndo: false, canRedo: false });
    expect(open.accessibilityLabel).toContain('Not applied');
    const v = coachChangesView(review({ proposals: [proposal(), proposal({ id: 'p3', status: 'open', actionId: null, reason: null })] }), TODAY);
    expect(v?.rows.map((r) => r.id)).toEqual(['p1']);
    expect(v?.asks.map((r) => [r.id, r.statusText])).toEqual([['p3', 'Not applied']]);
    expect(v?.collapsed).toBe('1 change for next week');
  });

  it('collapses once Ben acted on every change; an older week isn’t `for next week`; the content key ignores statuses (review progress-v3 S5, S6)', () => {
    expect(coachChangesView(review(), TODAY, { actedOn: new Set(['p2']) })?.isNew).toBe(true);
    expect(coachChangesView(review(), TODAY, { actedOn: new Set(['p1', 'p2']) })?.isNew).toBe(false);
    expect(coachChangesView(review(), TODAY, { current: false })).toMatchObject({ isNew: false, current: false, right: 'w/c 12 Oct', collapsed: '1 change' });
    const a = coachChangesView(review(), TODAY)?.contentKey;
    expect(coachChangesView(review({ proposals: [proposal({ status: 'undone' }), proposal({ id: 'p2', change: { kind: 'template_sets', routineId: SHOULDERS, routineName: 'Upper', expectedVersion: 1, exerciseId: RAISE, exerciseName: 'Lateral raise', fromSets: 3, toSets: 4 }, reason: 'Shoulders under plan 2 weeks running', status: 'applied' })] }), TODAY)?.contentKey).toBe(a);
    expect(coachChangesView(review({ coach: { status: 'reviewed', verdict: 'Another week.', lines: [], actionIds: [], numbersChecked: true } }), TODAY)?.contentKey).not.toBe(a);
  });

  it('offline: the built-in changes with `Not reviewed · Offline`, no coach sentence (rule 1)', () => {
    const v = coachChangesView(review({ coach: { status: 'offline' }, proposals: [proposal({ source: 'code', reason: '4 sets the last 2 times' })] }), TODAY);
    expect(v).toMatchObject({ note: null, tag: 'Not reviewed · Offline', reviewed: false, collapsed: '1 change for next week' });
    expect(coachChangesView(review({ proposals: [] }), TODAY)?.collapsed).toBe('No changes for next week');
  });
});
