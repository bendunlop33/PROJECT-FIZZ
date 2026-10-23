import { describe, expect, it } from 'vitest';

import { ReviewFactSchema, type BuilderMuscleInfo, type LiftTarget, type Load, type Routine } from '@fizz/schemas';
import {
  isStalled,
  liftNowText,
  missedText,
  reviewCardView,
  reviewFactLines,
  reviewHistoryRow,
  reviewSessionOf,
  sessionsText,
  sparkPoints,
  wasNowTarget,
  toMs,
  weekDataOfReview,
  weeklyFacts,
  weeklyReviewFacts,
  weeklyReviewWeek,
  weeklyReviewWorthwhile,
  withTemplateWorkingSets,
  type ReviewPlan,
  type ReviewSession,
  type ReviewSet,
  type ReviewTemplate,
  type WeeklyReviewInput,
} from '../src/index';
import { richFinishedSession } from './testing';

const TZ = 'Europe/London';
/** Views keep numbers and units together with no-break spaces. */
const plain = (t: string | null | undefined): string | null => (t == null ? null : t.replaceAll('\u00a0', ' '));
const MONDAY = '2026-10-12';
const NOW = toMs('2026-10-19T09:00:00.000Z');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BENCH = id(1);
const SQUAT = id(2);
const CURL = id(3);
const PULLUP = id(4);
const DB_PRESS = id(5);
const PUSHUP = id(6);
const RUN = id(7);

const INFO: Record<string, BuilderMuscleInfo> = {
  [BENCH]: { primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'front_delts'] },
  [SQUAT]: { primaryMuscles: ['quads'], secondaryMuscles: ['glutes'] },
  [CURL]: { primaryMuscles: ['hamstrings'] },
  [PULLUP]: { primaryMuscles: ['lats'], secondaryMuscles: ['biceps'] },
  [DB_PRESS]: { primaryMuscles: ['front_delts'], secondaryMuscles: ['triceps'] },
  [PUSHUP]: { primaryMuscles: ['chest'] },
  [RUN]: { primaryMuscles: ['quads'], measurement: 'cardio' },
};

const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const work = (load: Load | null, reps: number, more: Partial<ReviewSet> = {}): ReviewSet => ({ setType: 'working', load, reps, rpe: null, targetRpe: null, counts: true, ...more });

let seq = 100;
function sess(date: string, exercises: { exerciseId: string; sets: ReviewSet[]; planned?: number | null }[], more: Partial<ReviewSession> = {}): ReviewSession {
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
    exercises: exercises.map((e) => ({ exerciseId: e.exerciseId, name: `Ex ${e.exerciseId.slice(-2)}`, equipmentKind: null, sets: e.sets, plannedWorking: e.planned === undefined ? e.sets.filter((s) => s.setType !== 'warmup').length : e.planned })),
    ...more,
  };
}

function input(more: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput {
  return { monday: MONDAY, nowMs: NOW, tz: TZ, sessions: [], plans: [], aim: null, goal: null, info: (x) => INFO[x] ?? null, lifts: [], liftTargets: [], activities: [], templates: [], painFlagged: new Set(), unit: 'kg', ...more };
}

const CHEST_DAY = id(50);
const LEGS_DAY = id(51);
const PULL_DAY = id(52);
const SHOULDER_DAY = id(53);
const plan = (more: Partial<ReviewPlan> = {}): ReviewPlan => ({
  planId: id(60),
  appliedAtUtc: '2026-09-01T08:00:00.000Z',
  untilUtc: null,
  days: [
    { routineId: CHEST_DAY, name: 'Chest', bodyParts: ['Chest', 'Triceps'] },
    { routineId: PULL_DAY, name: 'Back', bodyParts: ['Back', 'Biceps'] },
    { routineId: LEGS_DAY, name: 'Legs', bodyParts: ['Quads', 'Hamstrings'] },
    { routineId: SHOULDER_DAY, name: 'Shoulders', bodyParts: ['Shoulders'] },
  ],
  pausedDates: new Set(),
  ...more,
});

describe('weekly review facts: edge cases (rule 6: from stored records only)', () => {
  it('no plan, no aim, no history: nothing to review, nothing invented', () => {
    const f = weeklyFacts(input());
    expect(f.hasHistory).toBe(false);
    expect(weeklyReviewWorthwhile(f)).toBe(false);
    expect(f.week).toEqual({ monday: MONDAY, done: 0, planned: null, workouts: 0, runs: 0 });
    expect(f.weeks).toHaveLength(6);
    expect(f.weeks.every((w) => w.planned === null && w.done === 0)).toBe(true);
    expect(f.lifts).toEqual([]);
    expect(f.rpe).toBeNull();
    expect(weeklyReviewFacts(f).map((x) => x.kind)).toEqual(['week_sessions', 'week_sessions', 'week_sessions', 'week_sessions', 'week_sessions', 'week_sessions', 'week_status']);
  });

  it('a plan: plan days done vs planned (the consistency card’s count), day dots, missed days named once the week is over', () => {
    const s1 = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST_DAY });
    const s2 = sess('2026-10-14', [{ exerciseId: PULLUP, sets: [work(kg(20, 'assistance'), 8)] }], { routineId: PULL_DAY });
    const s3 = sess('2026-10-16', [{ exerciseId: DB_PRESS, sets: [work(kg(20, 'per_hand'), 10)] }], { routineId: SHOULDER_DAY });
    const f = weeklyFacts(input({ sessions: [s1, s2, s3], plans: [plan()] }));
    expect(f.basis).toBe('plan');
    expect(f.week).toMatchObject({ done: 3, planned: 4, workouts: 3 });
    expect(f.days.map((d) => [d.name, d.done])).toEqual([['Chest', true], ['Back', true], ['Legs', false], ['Shoulders', true]]);
    expect(f.missed).toEqual(['Legs']);
    // Partial week (Sunday evening review): nothing called missed yet.
    const partial = weeklyFacts(input({ sessions: [s1, s2, s3], plans: [plan()], nowMs: toMs('2026-10-18T18:30:00.000Z') }));
    expect(partial.complete).toBe(false);
    expect(partial.missed).toEqual([]);
  });

  it('the plan applied after a week: that week has no plan (planned null), never a made-up target', () => {
    const late = plan({ appliedAtUtc: '2026-10-10T08:00:00.000Z' });
    const old = sess('2026-10-01', [{ exerciseId: BENCH, sets: [work(kg(90), 6)] }]);
    const f = weeklyFacts(input({ sessions: [old], plans: [late] }));
    expect(f.weeks.find((w) => w.monday === '2026-09-28')).toEqual({ monday: '2026-09-28', done: 1, planned: null, workouts: 1, runs: 0 });
    expect(f.week.planned).toBe(4);
  });

  it('a paused (deload) week: the paused days come off the plan; a fully paused week isn’t judged', () => {
    const paused = new Set(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    const s1 = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST_DAY });
    const f = weeklyFacts(input({ sessions: [s1], plans: [plan({ pausedDates: paused })] }));
    expect(f.week).toMatchObject({ done: 1, planned: 2 });
    // Plan sets per muscle aren't shown against a part-paused week.
    expect(f.groups.every((g) => g.planned === null)).toBe(true);
    const all = new Set(Array.from({ length: 7 }, (_, i) => `2026-10-${String(12 + i)}`));
    expect(weeklyFacts(input({ plans: [plan({ pausedDates: all })] })).week.planned).toBeNull();
  });

  it('no plan with a days-a-week aim: days trained against the aim; two workouts on one day are one day', () => {
    const a = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }]);
    const b = sess('2026-10-13', [{ exerciseId: CURL, sets: [work(kg(40), 10)] }]);
    const f = weeklyFacts(input({ sessions: [a, b], aim: 3 }));
    expect(f.basis).toBe('aim');
    expect(f.week).toMatchObject({ done: 1, planned: 3, workouts: 2 });
  });

  it('sets per muscle by the builder’s convention: full credit to the first primary muscle, nothing to secondaries; warm-ups and cardio out', () => {
    const s = sess('2026-10-13', [
      { exerciseId: BENCH, sets: [{ ...work(kg(60), 10), setType: 'warmup' }, work(kg(100), 6), work(kg(100), 6), work(kg(95), 8)] },
      { exerciseId: DB_PRESS, sets: [work(kg(20, 'per_hand'), 10), work(kg(20, 'per_hand'), 10)] },
      { exerciseId: RUN, sets: [work(null, 1)] },
    ]);
    const templates: ReviewTemplate[] = [{ planId: id(60), routineId: CHEST_DAY, name: 'Chest', version: 3, exercises: [{ exerciseId: BENCH, name: 'Bench', workingSets: 4 }, { exerciseId: DB_PRESS, name: 'DB press', workingSets: 3 }] }];
    const f = weeklyFacts(input({ sessions: [s], plans: [plan()], templates, goal: 'muscle' }));
    expect(f.groups).toEqual([
      { group: 'Chest', sets: 3, planned: 4, range: { min: 6, max: 20 } },
      { group: 'Shoulders', sets: 2, planned: 3, range: { min: 6, max: 20 } },
    ]);
    expect(weeklyFacts(input({ sessions: [s], goal: 'strength' })).groups[0]?.range).toEqual({ min: 4, max: 10 });
    expect(weeklyFacts(input({ sessions: [s] })).groups[0]?.range).toBeNull();
  });
});

describe('lift trends for the lifts Ben chose (§6.2): est. 1RM labelled, target line, no projection', () => {
  const history = (exerciseId: string, loads: readonly [string, Load, number][]) => loads.map(([date, load, reps]) => sess(date, [{ exerciseId, sets: [work(load, reps)] }]));

  it('est. 1RM per session (Epley, labelled), oldest first; the target is a level line with was → now → target', () => {
    const sessions = history(BENCH, [['2026-09-29', kg(90), 6], ['2026-10-06', kg(92.5), 6], ['2026-10-13', kg(95), 6]]);
    const target: LiftTarget = { id: 't1', exerciseId: BENCH, exerciseName: 'Bench', kind: 'one_rm', load: { value: 120, unit: 'kg', convention: 'total' }, reps: 1, setAtUtc: '2026-09-20T08:00:00.000Z', setOnDate: '2026-09-20', was: { value: 105, date: '2026-09-15', isEstimate: true }, setBy: 'ben' };
    const f = weeklyFacts(input({ sessions, lifts: [BENCH], liftTargets: [target] }));
    const l = f.lifts[0];
    expect(l?.metric).toBe('e1rm');
    expect(l?.points.map((p) => p.value)).toEqual([108, 111, 114]);
    // `was` and `now` are estimates: the line says so, as it is read alone (review b3-wave3-truth S1).
    expect(plain(wasNowTarget(l ?? (undefined as never)))).toBe('est. 1RM was 105 → now 114 → target 120 kg');
    expect(plain(liftNowText(l ?? (undefined as never)))).toBe('est. 1RM 114 kg');
  });

  it('no target needed to see a trend; any exercise Ben logs; at most 6, in his order', () => {
    const sessions = [...history(SQUAT, [['2026-10-06', kg(120), 5], ['2026-10-13', kg(125), 5]]), ...history(CURL, [['2026-10-14', kg(40), 10]])];
    const f = weeklyFacts(input({ sessions, lifts: [CURL, SQUAT, BENCH, id(90), id(91), id(92), id(93)] }));
    expect(f.lifts.map((l) => l.exerciseId)).toEqual([CURL, SQUAT, BENCH, id(90), id(91), id(92)]);
    expect(f.lifts.every((l) => l.target === null)).toBe(true);
    // A chosen lift with no sets in the window stays (review b3-wave3-ux S3), never silently dropped.
    expect(f.lifts[2]?.points).toEqual([]);
    expect(f.lifts[2]?.now).toBeNull();
    expect(reviewFactLines(f).some((l) => l.includes('Ex 01'))).toBe(false);
  });

  it('lb: kg-logged sets are shown in Ben’s lb (and a lb target keeps its own unit)', () => {
    const sessions = history(BENCH, [['2026-10-13', kg(100), 1]]);
    const f = weeklyFacts(input({ sessions, lifts: [BENCH], unit: 'lb' }));
    expect(f.lifts[0]).toMatchObject({ unit: 'lb', now: 220 });
  });

  it('a weight × reps target plots the best set at those reps or more; per-hand dumbbells say `each`', () => {
    const sessions = history(DB_PRESS, [['2026-10-06', kg(30, 'per_hand'), 8], ['2026-10-13', kg(32, 'per_hand'), 6], ['2026-10-14', kg(28, 'per_hand'), 10]]);
    const target: LiftTarget = { id: 't2', exerciseId: DB_PRESS, exerciseName: 'DB press', kind: 'weight_reps', load: { value: 34, unit: 'kg', convention: 'per_hand' }, reps: 8, setAtUtc: '2026-09-20T08:00:00.000Z', setOnDate: '2026-09-20', was: null, setBy: 'ben' };
    const f = weeklyFacts(input({ sessions, lifts: [DB_PRESS], liftTargets: [target] }));
    const l = f.lifts[0];
    expect(l?.metric).toBe('best_set');
    expect(l?.points.map((p) => p.value)).toEqual([30, 28]);
    expect(plain(wasNowTarget(l ?? (undefined as never)))).toBe('now 28 → target 34 kg each × 8');
  });

  it('assisted: less assistance is stronger (stall check inverted); bodyweight plots reps', () => {
    const sessions = [...history(PULLUP, [['2026-09-22', kg(30, 'assistance'), 8], ['2026-09-29', kg(25, 'assistance'), 8], ['2026-10-06', kg(25, 'assistance'), 8], ['2026-10-13', kg(27.5, 'assistance'), 8], ['2026-10-14', kg(25, 'assistance'), 8]]), ...history(PUSHUP, [['2026-10-13', kg(0, 'bodyweight'), 20]])];
    const f = weeklyFacts(input({ sessions, lifts: [PULLUP, PUSHUP] }));
    expect(f.lifts[0]).toMatchObject({ metric: 'best_set', lowerIsBetter: true, now: 25 });
    expect(f.lifts[1]).toMatchObject({ metric: 'reps', unit: null, now: 20 });
    expect(f.stalled.map((x) => x.exerciseId)).toEqual([PULLUP]);
  });

  it('stalled: no new best over 3 sessions against everything before; needs 4 sessions', () => {
    expect(isStalled([100, 100, 100, 100], false)).toBe(true);
    expect(isStalled([100, 97.5, 100, 102.5], false)).toBe(false);
    expect(isStalled([100, 100, 100], false)).toBe(false);
    expect(isStalled([25, 25, 27.5, 25], true)).toBe(true);
    expect(isStalled([30, 27.5, 27.5, 25], true)).toBe(false);
    const sessions = history(SQUAT, [['2026-09-22', kg(120), 5], ['2026-09-29', kg(120), 5], ['2026-10-06', kg(117.5), 5], ['2026-10-13', kg(120), 5]]);
    expect(weeklyFacts(input({ sessions })).stalled).toEqual([{ exerciseId: SQUAT, name: 'Ex 02', sessions: 3 }]);
    // Not flagged when the lift wasn't done this week.
    expect(weeklyFacts(input({ sessions: sessions.slice(0, 3), monday: MONDAY })).stalled).toEqual([]);
  });

  it('a marked set (Spotted, Pain…) is never a best', () => {
    const sessions = [sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(110), 3, { counts: false }), work(kg(100), 3)] }])];
    expect(weeklyFacts(input({ sessions, lifts: [BENCH] })).lifts[0]?.points[0]?.load?.value).toBe(100);
  });
});

describe('weekly signals: RPE, feel, runs, repeated edits (§6.1 feedback loop)', () => {
  it('RPE against the sessions’ own targets (never assumed); feel as Ben tapped it; runs he logged', () => {
    const a = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6, { rpe: 9, targetRpe: 8 }), work(kg(100), 6, { rpe: 9.5, targetRpe: 8 })] }], { feel: 'hard' });
    const b = sess('2026-10-15', [{ exerciseId: SQUAT, sets: [work(kg(120), 5, { rpe: 8 })] }], { feel: 'good' });
    const activities = [
      { id: id(70), date: '2026-10-14', kind: 'run' as const, status: 'done' as const, distanceM: 8000 },
      { id: id(71), date: '2026-10-17', kind: 'run' as const, status: 'done' as const, distanceM: 12000 },
      { id: id(72), date: '2026-10-18', kind: 'run' as const, status: 'planned' as const, distanceM: 5000 },
    ];
    const f = weeklyFacts(input({ sessions: [a, b], activities }));
    // Only the sets with a target are held against it (review b3-wave3-truth B3): squat's untargeted RPE 8 stays out.
    expect(f.rpe).toEqual({ sessions: 1, mean: 9.3, target: 8 });
    expect(f.feel).toEqual({ easy: 0, good: 1, hard: 1 });
    expect(f.runs).toEqual({ count: 2, distanceM: 20000 });
    expect(f.week.runs).toBe(2);
    expect(reviewFactLines(f)).toEqual(['2 workouts · 2 runs', 'RPE 9.3 · target 8', 'Felt: 1 good, 1 hard']);
    // No RPE logged: no RPE fact (rule 6).
    expect(weeklyFacts(input({ sessions: [sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }])] })).rpe).toBeNull();
  });

  it('the same edit twice from a template suggests updating it; not when pain-flagged, outside 1–8, or not this week', () => {
    const template: ReviewTemplate = { planId: id(60), routineId: LEGS_DAY, name: 'Legs', version: 4, exercises: [{ exerciseId: SQUAT, name: 'Squat', workingSets: 4 }, { exerciseId: CURL, name: 'Leg curl', workingSets: 3 }] };
    const fromLegs = (date: string, curlSets: number) => sess(date, [{ exerciseId: SQUAT, sets: [work(kg(120), 5)], planned: 4 }, { exerciseId: CURL, sets: [work(kg(40), 10)], planned: curlSets }], { template: { routineId: LEGS_DAY }, routineId: LEGS_DAY });
    const sessions = [fromLegs('2026-10-08', 4), fromLegs('2026-10-15', 4)];
    const f = weeklyFacts(input({ sessions, templates: [template] }));
    expect(f.edits).toEqual([{ routineId: LEGS_DAY, routineName: 'Legs', expectedVersion: 4, exerciseId: CURL, exerciseName: 'Leg curl', sessions: 2, fromSets: 3, toSets: 4 }]);
    expect(weeklyFacts(input({ sessions, templates: [template], painFlagged: new Set([CURL]) })).edits).toEqual([]);
    expect(weeklyFacts(input({ sessions: [fromLegs('2026-10-08', 4), fromLegs('2026-10-15', 3)], templates: [template] })).edits).toEqual([]);
    expect(weeklyFacts(input({ sessions: [fromLegs('2026-10-01', 4), fromLegs('2026-10-08', 4)], templates: [template] })).edits).toEqual([]);
    expect(weeklyFacts(input({ sessions: [fromLegs('2026-10-08', 9), fromLegs('2026-10-15', 9)], templates: [template] })).edits).toEqual([]);
  });

  it('a workout whose sets Ben didn’t set himself (`plannedWorking` null) is never an edit: two short days aren’t a new plan (D1; review v5offers B1)', () => {
    const template: ReviewTemplate = { planId: id(60), routineId: LEGS_DAY, name: 'Legs', version: 4, exercises: [{ exerciseId: SQUAT, name: 'Squat', workingSets: 4 }, { exerciseId: CURL, name: 'Leg curl', workingSets: 3 }] };
    const fromLegs = (date: string, curl: number | null) => sess(date, [{ exerciseId: SQUAT, sets: [work(kg(120), 5)], planned: 4 }, { exerciseId: CURL, sets: [work(kg(40), 10)], planned: curl }], { template: { routineId: LEGS_DAY }, routineId: LEGS_DAY });
    expect(weeklyFacts(input({ sessions: [fromLegs('2026-10-08', null), fromLegs('2026-10-15', null)], templates: [template] })).edits).toEqual([]);
    // One fitted day in the newest two breaks Ben's streak too.
    expect(weeklyFacts(input({ sessions: [fromLegs('2026-10-08', 2), fromLegs('2026-10-15', null)], templates: [template] })).edits).toEqual([]);
    expect(weeklyFacts(input({ sessions: [fromLegs('2026-10-08', 2), fromLegs('2026-10-15', 2)], templates: [template] })).edits.map((e) => [e.exerciseId, e.toSets])).toEqual([[CURL, 2]]);
  });

  it('the stored facts parse with the review schema (and IDs that aren’t stored IDs are left out)', () => {
    const sessions = [sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6, { rpe: 8, targetRpe: 8 })] }], { routineId: CHEST_DAY, feel: 'easy' })];
    const f = weeklyFacts(input({ sessions, plans: [plan()], lifts: [BENCH], goal: 'both', activities: [{ id: id(70), date: '2026-10-14', kind: 'run', status: 'done', distanceM: null }] }));
    const facts = weeklyReviewFacts(f);
    for (const x of facts) expect(ReviewFactSchema.safeParse(x).success).toBe(true);
    expect(facts.map((x) => x.kind)).toEqual(expect.arrayContaining(['sessions_vs_plan', 'week_sessions', 'week_day', 'group_sets', 'lift_trend', 'rpe_drift', 'runs', 'feel']));
    expect(facts.find((x) => x.kind === 'runs')).toEqual({ kind: 'runs', count: 1, distanceM: null });
  });
});

describe('when the weekly review runs (§6.1)', () => {
  it('Sunday from 18:00 reviews this week; any other time, the week just ended', () => {
    expect(weeklyReviewWeek(toMs('2026-10-18T16:59:00.000Z'), TZ)).toBe('2026-10-05');
    expect(weeklyReviewWeek(toMs('2026-10-18T17:00:00.000Z'), TZ)).toBe('2026-10-12');
    expect(weeklyReviewWeek(toMs('2026-10-19T07:00:00.000Z'), TZ)).toBe('2026-10-12');
    expect(weeklyReviewWeek(toMs('2026-10-22T12:00:00.000Z'), TZ)).toBe('2026-10-12');
  });
});

describe('reviewSessionOf: a stored workout as the review reads it', () => {
  it('finished only, corrections applied, Ben’s feel and the template it came from', () => {
    const a = richFinishedSession();
    const r = reviewSessionOf({ ...a, session: { ...a.session, feel: { value: 'good', at: a.session.startedAt } } }, TZ, NOW);
    expect(r?.feel).toBe('good');
    expect(r?.exercises.length).toBeGreaterThan(0);
    expect(r?.exercises.every((e) => e.plannedWorking !== null && e.plannedWorking >= 0)).toBe(true);
    expect(reviewSessionOf({ ...a, session: { ...a.session, status: 'active', endedAt: null } }, TZ, NOW)).toBeNull();
  });

  it('an exercise whose sets Ben didn’t set himself reads no set-up count (`SessionPlanDay.notEdited`: Today’s card, a Time fit; review v5offers B1)', () => {
    const a = richFinishedSession();
    const fitted = a.exercises[0]?.exerciseId ?? '';
    const planDay = { planId: id(61), dayIndex: 0, splitDayId: 'legs', templateRoutineId: id(62), templateVersion: 1, variationId: null, notEdited: [fitted] };
    const r = reviewSessionOf({ ...a, session: { ...a.session, planDay } }, TZ, NOW);
    expect(r?.exercises.filter((e) => e.exerciseId === fitted).map((e) => e.plannedWorking)).toEqual([null]);
    expect(r?.exercises.filter((e) => e.exerciseId !== fitted).every((e) => e.plannedWorking !== null)).toBe(true);
  });
});

describe('template tweaks (Apply): working sets only, versioned', () => {
  const routine: Routine = {
    id: LEGS_DAY,
    ownerId: id(80),
    version: 4,
    createdAtUtc: '2026-09-01T08:00:00.000Z',
    updatedAtUtc: '2026-09-01T08:00:00.000Z',
    name: 'Legs',
    exercises: [
      {
        id: id(81),
        exerciseId: CURL,
        equipmentId: null,
        order: 0,
        supersetGroup: null,
        setTemplates: [
          { id: id(82), setType: 'warmup', targetLoad: null, targetReps: { min: 10, max: 10 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null },
          { id: id(83), setType: 'working', targetLoad: kg(40), targetReps: { min: 10, max: 12 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: 90 },
          { id: id(84), setType: 'working', targetLoad: kg(40), targetReps: { min: 10, max: 12 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: 90 },
        ],
        restBySetType: {},
        transitionRestS: null,
        progressionRuleId: null,
      },
    ],
  };
  it('adds copies of the last working set, or drops the last ones; warm-ups stay; loads untouched', () => {
    const up = withTemplateWorkingSets(routine, { exerciseId: CURL, toSets: 4, expectedVersion: 4, opId: 'op-1', atUtc: '2026-10-19T09:00:00.000Z' });
    if (up.kind !== 'write') throw new Error(up.kind);
    expect(up.next.version).toBe(5);
    expect(up.next.lastOpId).toBe('op-1');
    const t = up.next.exercises[0]?.setTemplates ?? [];
    expect(t.map((x) => x.setType)).toEqual(['warmup', 'working', 'working', 'working', 'working']);
    expect(t.slice(3).every((x) => x.targetLoad?.value === 40 && x.restOverrideS === 90)).toBe(true);
    expect(new Set(t.map((x) => x.id)).size).toBe(5);
    const down = withTemplateWorkingSets(routine, { exerciseId: CURL, toSets: 1, expectedVersion: 4, opId: 'op-2', atUtc: '2026-10-19T09:00:00.000Z' });
    expect(down.kind === 'write' && down.next.exercises[0]?.setTemplates.map((x) => x.id)).toEqual([id(82), id(83)]);
  });
  it('stale version refused (rule 5); 0 or 9 sets, or a missing exercise, invalid', () => {
    expect(withTemplateWorkingSets(routine, { exerciseId: CURL, toSets: 3, expectedVersion: 3, opId: 'o', atUtc: 'x' }).kind).toBe('stale');
    expect(withTemplateWorkingSets(routine, { exerciseId: CURL, toSets: 0, expectedVersion: 4, opId: 'o', atUtc: 'x' })).toEqual({ kind: 'invalid', reason: 'sets' });
    expect(withTemplateWorkingSets(routine, { exerciseId: CURL, toSets: 9, expectedVersion: 4, opId: 'o', atUtc: 'x' })).toEqual({ kind: 'invalid', reason: 'sets' });
    expect(withTemplateWorkingSets(routine, { exerciseId: BENCH, toSets: 3, expectedVersion: 4, opId: 'o', atUtc: 'x' })).toEqual({ kind: 'invalid', reason: 'missing_exercise' });
  });
});

describe('Progress › Reviews views', () => {
  const sessions = [
    sess('2026-09-29', [{ exerciseId: BENCH, sets: [work(kg(90), 6)] }], { routineId: CHEST_DAY }),
    sess('2026-10-06', [{ exerciseId: BENCH, sets: [work(kg(92.5), 6)] }], { routineId: CHEST_DAY }),
    sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(95), 6)] }], { routineId: CHEST_DAY }),
    sess('2026-10-15', [{ exerciseId: SQUAT, sets: [work(kg(120), 5)] }], { routineId: LEGS_DAY }),
  ];
  const f = weeklyFacts(input({ sessions, plans: [plan()], lifts: [BENCH], goal: 'muscle' }));

  it('stored facts read back into the same views; the card shows 3–5 facts, the verdict or `Not reviewed`, and proposals', () => {
    const facts = weeklyReviewFacts(f);
    const review = {
      id: id(99),
      ownerId: id(80),
      version: 1,
      createdAtUtc: '2026-10-19T09:00:00.000Z',
      updatedAtUtc: '2026-10-19T09:00:00.000Z',
      subject: { kind: 'weekly' as const, weekMonday: MONDAY },
      inputsHash: 'h',
      facts,
      coach: { status: 'offline' as const },
      status: 'current' as const,
      supersededById: null,
      opIds: ['o'],
      createdAt: { utc: '2026-10-19T09:00:00.000Z', tz: TZ },
      proposals: [{ id: 'p1', source: 'code' as const, change: { kind: 'template_sets' as const, routineId: LEGS_DAY, routineName: 'Legs', expectedVersion: 4, exerciseId: CURL, exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: null, status: 'open' as const, actionId: null }],
    };
    const d = weekDataOfReview(review, (x) => (x === BENCH ? 'Bench press' : 'Exercise'));
    if (d === null) throw new Error('not weekly');
    expect(d.week).toEqual(f.week);
    expect(d.missed).toEqual(['Back', 'Shoulders']);
    expect(d.lifts[0]?.points.map((p) => p.value)).toEqual(f.lifts[0]?.points.map((p) => p.value));
    const card = reviewCardView(review, d, '2026-10-19');
    expect(card.verdict).toBe('Not reviewed · Offline');
    expect(plain(card.week)).toBe('w/c 12 Oct');
    expect(card.facts[0]).toBe('2 of 4 sessions');
    expect(card.facts.map(plain)).toContain('Bench press: est. 1RM 114 kg');
    expect(card.facts.length).toBeLessThanOrEqual(5);
    expect(card.proposals[0]).toMatchObject({ text: 'Leg curl on Legs: 3 → 4 sets', statusText: null, canUndo: false });
    const row = reviewHistoryRow(review, d, '2026-10-19');
    // The title is the week's facts; the status is secondary (review b3-wave3-ux S6).
    expect(plain(row.title)).toBe('w/c 12 Oct · 2 of 4');
    expect(plain(row.detail)).toBe('Not reviewed · Offline · Missed: Back, Shoulders');
    expect(row.spark).toEqual([108, 111, 114]);
    expect(sparkPoints(row.spark, 64, 22)).toEqual([{ x: 2, y: 20 }, { x: 32, y: 11 }, { x: 62, y: 2 }]);
  });
});

describe('review fixes (b3-wave3 truth and UX reviews, 21 Oct)', () => {
  const THREE: ReviewPlan = { ...plan(), days: plan().days.slice(0, 3) };
  const stored = (facts: ReturnType<typeof weeklyReviewFacts>, coach: Parameters<typeof reviewCardView>[0]['coach'] = { status: 'offline' }) => ({
    id: id(98),
    ownerId: id(80),
    version: 1,
    createdAtUtc: '2026-10-19T09:00:00.000Z',
    updatedAtUtc: '2026-10-19T09:00:00.000Z',
    subject: { kind: 'weekly' as const, weekMonday: MONDAY },
    inputsHash: 'h',
    facts,
    coach,
    status: 'current' as const,
    supersededById: null,
    opIds: ['o'],
    createdAt: { utc: '2026-10-19T09:00:00.000Z', tz: TZ },
    proposals: [],
  });
  const read = (r: ReturnType<typeof stored>) => {
    const d = weekDataOfReview(r, () => 'Exercise');
    if (d === null) throw new Error('not weekly');
    return d;
  };

  it('truth B3: RPE compares only the sets that had a target (bench at 8 vs 8, untargeted curls at 10 stay out)', () => {
    const s = sess('2026-10-13', [
      { exerciseId: BENCH, sets: [work(kg(100), 5, { rpe: 8, targetRpe: 8 }), work(kg(100), 5, { rpe: 8, targetRpe: 8 })] },
      { exerciseId: CURL, sets: [work(kg(30), 10, { rpe: 10 }), work(kg(30), 10, { rpe: 10 })] },
    ]);
    const f = weeklyFacts(input({ sessions: [s] }));
    expect(f.rpe).toEqual({ sessions: 1, mean: 8, target: 8 });
    expect(reviewFactLines(f)).toContain('RPE 8 · target 8');
    // With no targets at all: the plain mean, no target.
    const none = weeklyFacts(input({ sessions: [sess('2026-10-13', [{ exerciseId: CURL, sets: [work(kg(30), 10, { rpe: 10 }), work(kg(30), 10, { rpe: 9 })] }])] }));
    expect(none.rpe).toEqual({ sessions: 1, mean: 9.5, target: null });
  });

  it('truth B4: with paused days, missed is planned − done and no day is named (which one can’t be said)', () => {
    const paused = new Set(['2026-10-17', '2026-10-18']);
    const one = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST_DAY });
    const f = weeklyFacts(input({ sessions: [one], plans: [{ ...THREE, pausedDates: paused }] }));
    expect(f.week).toMatchObject({ done: 1, planned: 2 });
    expect(f.missedCount).toBe(1);
    expect(f.missed).toEqual([]);
    expect(reviewFactLines(f)).toContain('Missed: 1 day');
    // Stored and read back: the same, never re-derived from the dots.
    const d = read(stored(weeklyReviewFacts(f)));
    expect(d.missedCount).toBe(1);
    expect(d.missed).toEqual([]);
    expect(missedText(d)).toBe('Missed: 1 day');
  });

  it('truth B4: everything planned done in a part-paused week: nothing missed on the stored card, row or full review', () => {
    const paused = new Set(['2026-10-17', '2026-10-18']);
    const a = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST_DAY });
    const b = sess('2026-10-14', [{ exerciseId: PULLUP, sets: [work(kg(20, 'assistance'), 8)] }], { routineId: PULL_DAY });
    const f = weeklyFacts(input({ sessions: [a, b], plans: [{ ...THREE, pausedDates: paused }] }));
    expect(f.week).toMatchObject({ done: 2, planned: 2 });
    const r = stored(weeklyReviewFacts(f));
    const d = read(r);
    expect(d.missed).toEqual([]);
    expect(d.missedCount).toBe(0);
    expect(reviewCardView(r, d, '2026-10-19').facts.some((x) => x.startsWith('Missed'))).toBe(false);
    expect(reviewHistoryRow(r, d, '2026-10-19').detail).not.toContain('Missed');
    expect(missedText(d)).toBeNull();
  });

  it('truth B4: a Sunday-evening review names no day missed, stored or live (days still to come)', () => {
    const one = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST_DAY });
    const f = weeklyFacts(input({ sessions: [one], plans: [plan()], nowMs: toMs('2026-10-18T18:30:00.000Z') }));
    expect(f.complete).toBe(false);
    const d = read(stored(weeklyReviewFacts(f)));
    expect(d.complete).toBe(false);
    expect(d.missed).toEqual([]);
    expect(d.missedCount).toBe(0);
    // Without pauses, at most planned − done days are named.
    const done = weeklyFacts(input({ sessions: [one], plans: [plan()] }));
    expect(done.missed).toEqual(['Back', 'Legs', 'Shoulders']);
    expect(done.missedCount).toBe(3);
  });

  it('truth S2: an aim stays the aim (4 days against 3 is `4 of 3`, as the consistency card)', () => {
    const days = ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-17'].map((d) => sess(d, [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }]));
    const f = weeklyFacts(input({ sessions: days, aim: 3 }));
    expect(f.week).toMatchObject({ done: 4, planned: 3 });
    expect(sessionsText(f.week)).toBe('4 of 3');
    expect(read(stored(weeklyReviewFacts(f))).basis).toBe('aim');
  });

  it('truth S5: a week under an older plan has no plan line (null), never `plan 0`', () => {
    const old = { ...plan(), planId: id(61) };
    const s = sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }], { routineId: CHEST_DAY });
    const templates: ReviewTemplate[] = [{ planId: id(60), routineId: CHEST_DAY, name: 'Chest', version: 3, exercises: [{ exerciseId: BENCH, name: 'Bench', workingSets: 4 }] }];
    expect(weeklyFacts(input({ sessions: [s], plans: [old], templates })).groups).toEqual([{ group: 'Chest', sets: 1, planned: null, range: null }]);
  });

  it('UX S1: the card’s five facts lead with the flags; lift values come last', () => {
    const lifts = [BENCH, SQUAT, DB_PRESS, PULLUP, PUSHUP, CURL];
    const history = (exerciseId: string, load: Load, reps: number) => ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'].map((d) => sess(d, [{ exerciseId, sets: [work(load, reps, { rpe: 9, targetRpe: 8 })] }], { feel: 'hard' }));
    const sessions = [...history(BENCH, kg(100), 5), ...history(SQUAT, kg(120), 5), ...history(CURL, kg(40), 10)];
    const f = weeklyFacts(input({ sessions, lifts, goal: 'muscle' }));
    const r = stored(weeklyReviewFacts(f));
    const card = reviewCardView(r, read(r), '2026-10-19');
    expect(card.facts).toHaveLength(5);
    expect(card.facts[1]).toMatch(/^Chest: 1 sets ▼ 6–20$/);
    expect(card.facts.some((x) => x.includes('no new best in 3 sessions'))).toBe(true);
    expect(card.facts.some((x) => x.includes('est. 1RM'))).toBe(false);
  });

  it('UX B1: a coach review whose verdict was hidden leads with its first line that passed; never `Not reviewed`', () => {
    const f = weeklyFacts(input({ sessions: [sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(100), 6)] }])] }));
    const facts = weeklyReviewFacts(f);
    const hidden = stored(facts, { status: 'reviewed', verdict: null, lines: ['Good pressing week.', 'Keep the legs day.'], actionIds: [], numbersChecked: true });
    const card = reviewCardView(hidden, read(hidden), '2026-10-19');
    expect(card.verdict).toBe('Good pressing week.');
    expect(card.lines).toEqual(['Keep the legs day.']);
    expect(card.reviewed).toBe(true);
    const nothing = stored(facts, { status: 'reviewed', verdict: null, lines: [], actionIds: [], numbersChecked: true });
    expect(reviewCardView(nothing, read(nothing), '2026-10-19').verdict).toBe('Reviewed');
    // While the call is out it says so (not `Not reviewed · Pending`).
    const pending = stored(facts, { status: 'pending' });
    expect(reviewCardView(pending, read(pending), '2026-10-19').verdict).toBe('Reviewing…');
  });

  it('UX N4: an assisted sparkline rises as assistance falls', () => {
    const sessions = ['2026-09-29', '2026-10-06', '2026-10-13'].map((d, i) => sess(d, [{ exerciseId: PULLUP, sets: [work(kg(30 - 5 * i, 'assistance'), 8)] }]));
    const f = weeklyFacts(input({ sessions, lifts: [PULLUP] }));
    const r = stored(weeklyReviewFacts(f));
    const spark = reviewHistoryRow(r, read(r), '2026-10-19').spark;
    expect(spark[2]).toBeGreaterThan(spark[0] ?? 0);
  });
});
