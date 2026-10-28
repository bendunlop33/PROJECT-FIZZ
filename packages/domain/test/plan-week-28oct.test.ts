import { describe, expect, it } from 'vitest';
import type { MuscleGroup } from '@fizz/schemas';
import { aheadDates, assignPlanWeek, planDaysByDue, buildWeekTiles, pbBlockWeekOf, planDaysDoneThisWeek, planFirstWeekExpected, planWeekExpectedNow, type PlanWeekSlotDay, type PlanWeekSlotWorkout } from '../src/index';

/**
 * (Ben, 28 Oct) A plan started mid-week, and this week's plan days one to one: Ben's 6-day Set days PPL (Mon Push A,
 * Tue Pull A, Wed Legs, Thu Push B, Fri Pull B, Sat Legs B); Legs (squat, RDL) Mon 26, Pull (rows, pull-ups) Tue 27,
 * Push A started from the plan Wed 28. One workout never ticks two plan days; the variant is the one it led with, else
 * the first not filled yet; a plan workout fills its own day.
 */

const TZ = 'Europe/London';
const PLAN = 'plan-1';
const day = (routineId: string, name: string, dayIndex: number, main: string, bodyParts: PlanWeekSlotDay['bodyParts']): PlanWeekSlotDay => ({ routineId, name, bodyParts, mainLiftExerciseId: main, planKey: { planId: PLAN, dayIndex } });
const DAYS = [
  day('push-a', 'Push A', 0, 'bench', ['Chest', 'Shoulders', 'Triceps']),
  day('pull-a', 'Pull A', 1, 'row', ['Back', 'Biceps']),
  day('legs-a', 'Legs', 2, 'squat', ['Quads', 'Hamstrings']),
  day('push-b', 'Push B', 3, 'ohp', ['Chest', 'Shoulders', 'Triceps']),
  day('pull-b', 'Pull B', 4, 'pullup', ['Back', 'Biceps']),
  day('legs-b', 'Legs B', 5, 'rdl', ['Quads', 'Hamstrings']),
];
const g = (x: Partial<Record<MuscleGroup, number>>) => new Map(Object.entries(x) as [MuscleGroup, number][]);
const LEGS = g({ Quads: 4, Hamstrings: 4 });
const PULL = g({ Back: 6, Biceps: 2 });
const PUSH = g({ Chest: 6, Shoulders: 3, Triceps: 3 });
const wk = (sessionId: string, utc: string, groups: ReadonlyMap<MuscleGroup, number>, over: Partial<PlanWeekSlotWorkout> = {}): PlanWeekSlotWorkout => ({ sessionId, routineId: null, startedAtUtc: utc, groups, ...over });
const ids = (m: ReadonlyMap<string, PlanWeekSlotWorkout>) => Object.fromEntries([...m].map(([k, v]) => [k, v.sessionId]));

describe('assignPlanWeek: one workout, one plan day', () => {
  it('Ben’s week: Legs Mon → Legs (not Legs B too), Pull Tue → Pull A (led with rows), then Push A from the plan → Push A only', () => {
    const mon = wk('mon', '2026-10-26T18:00:00Z', LEGS, { leadExerciseId: 'squat' });
    const tue = wk('tue', '2026-10-27T18:00:00Z', PULL, { leadExerciseId: 'row' });
    expect(ids(assignPlanWeek(DAYS, [mon, tue]))).toEqual({ 'legs-a': 'mon', 'pull-a': 'tue' });
    const wed = wk('wed', '2026-10-28T18:04:00Z', PUSH, { routineId: 'push-a', planDay: { planId: PLAN, dayIndex: 0, templateRoutineId: 'push-a' }, leadExerciseId: 'ohp' });
    // Started as Push A: Push A, even though it led with Push B's main lift.
    expect(ids(assignPlanWeek(DAYS, [wed, tue, mon]))).toEqual({ 'legs-a': 'mon', 'pull-a': 'tue', 'push-a': 'wed' });
  });

  it('variants: led with the second one’s main lift → that one; unclear → the first not filled yet', () => {
    expect(ids(assignPlanWeek(DAYS, [wk('x', '2026-10-27T18:00:00Z', PULL, { leadExerciseId: 'pullup' })]))).toEqual({ 'pull-b': 'x' });
    const a = wk('a', '2026-10-26T18:00:00Z', PULL, { leadExerciseId: 'curl' });
    const b = wk('b', '2026-10-27T18:00:00Z', PULL, { leadExerciseId: 'curl' });
    expect(ids(assignPlanWeek(DAYS, [b, a]))).toEqual({ 'pull-a': 'a', 'pull-b': 'b' });
    // A third pull this week fills nothing.
    expect(assignPlanWeek(DAYS, [a, b, wk('c', '2026-10-28T18:00:00Z', PULL)]).size).toBe(2);
  });

  it('named for variants (an import `Pull`): the first free one, after the plan’s own workouts took theirs', () => {
    const own = wk('own', '2026-10-28T18:00:00Z', PULL, { routineId: 'pull-a' });
    const named = wk('named', '2026-10-26T18:00:00Z', PULL, { routineId: 'pull-a', variants: ['pull-a', 'pull-b'] });
    expect(ids(assignPlanWeek(DAYS, [named, own]))).toEqual({ 'pull-a': 'own', 'pull-b': 'named' });
  });

  it('this week’s merged day (Push A + Push B → Push): its workout does both days; another push fills nothing more', () => {
    const merged = wk('m', '2026-10-28T18:00:00Z', PUSH, { routineId: 'merged-push' });
    expect(ids(assignPlanWeek(DAYS, [merged], [{ routineId: 'merged-push', dayIds: ['push-a', 'push-b'] }]))).toEqual({ 'push-a': 'm', 'push-b': 'm' });
  });

  it('a plan workout done twice fills its day once; the second never spills onto a twin', () => {
    const one = wk('1', '2026-10-26T18:00:00Z', PUSH, { routineId: 'push-a' });
    const two = wk('2', '2026-10-27T18:00:00Z', PUSH, { routineId: 'push-a' });
    expect(ids(assignPlanWeek(DAYS, [one, two]))).toEqual({ 'push-a': '1' });
  });

  it('planDaysDoneThisWeek: Ben’s week reads 2 of 6, then 3 with Push A; the week counts from Monday even when applied Wed', () => {
    const now = Date.parse('2026-10-28T20:00:00Z');
    const days = DAYS.map((d) => ({ ...d }));
    const ws = [wk('mon', '2026-10-26T18:00:00Z', LEGS, { leadExerciseId: 'squat' }), wk('tue', '2026-10-27T18:00:00Z', PULL, { leadExerciseId: 'row' })];
    expect([...planDaysDoneThisWeek({ days, appliedAtUtc: '2026-10-28T09:00:00Z', workouts: ws, nowMs: now, tz: TZ }).keys()].sort()).toEqual(['legs-a', 'pull-a']);
    const withPush = [...ws, wk('wed', '2026-10-28T18:04:00Z', PUSH, { routineId: 'push-a' })];
    expect([...planDaysDoneThisWeek({ days, appliedAtUtc: '2026-10-26T07:00:00Z', workouts: withPush, nowMs: now, tz: TZ }).keys()].sort()).toEqual(['legs-a', 'pull-a', 'push-a']);
    // Last week's never count this week.
    expect(planDaysDoneThisWeek({ days, appliedAtUtc: '2026-10-20T07:00:00Z', workouts: [wk('old', '2026-10-25T18:00:00Z', LEGS)], nowMs: now, tz: TZ }).size).toBe(0);
  });
});

describe('a plan started mid-week expects only the days still possible', () => {
  it('Set days: the days not done on or after the start’s weekday, plus the ones done', () => {
    // Started Wed 28; Legs (Wed) and Push B, Pull B, Legs B still possible; Push A and Pull A (Mon, Tue) are not.
    expect(planFirstWeekExpected({ appliedLocalDate: '2026-10-28', monday: '2026-10-26', done: 0, notDone: [0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday })) })).toBe(4);
    // Legs and Pull A done Mon/Tue (they count): 2 done + Push B, Pull B, Legs B (Push A's Monday is past) = 5.
    expect(planFirstWeekExpected({ appliedLocalDate: '2026-10-28', monday: '2026-10-26', done: 2, notDone: [0, 3, 4, 5].map((weekday) => ({ weekday })) })).toBe(5);
  });

  it('Any days: as many as dates left from the start; a Monday start or another week: null (the whole week)', () => {
    expect(planFirstWeekExpected({ appliedLocalDate: '2026-10-31', monday: '2026-10-26', done: 0, notDone: Array.from({ length: 6 }, () => ({ weekday: null })) })).toBe(2);
    expect(planFirstWeekExpected({ appliedLocalDate: '2026-10-26', monday: '2026-10-26', done: 0, notDone: [{ weekday: null }] })).toBeNull();
    expect(planFirstWeekExpected({ appliedLocalDate: '2026-10-20', monday: '2026-10-26', done: 0, notDone: [{ weekday: null }] })).toBeNull();
    const done = new Map([['legs-a', '2026-10-26T18:00:00Z']]);
    expect(planWeekExpectedNow({ days: DAYS, done, appliedAtUtc: '2026-10-30T09:00:00Z', nowMs: Date.parse('2026-10-30T12:00:00Z'), tz: TZ })).toBe(4);
  });
});

describe('block week of a plan started mid-week (training-blocks §4.1, approved: week 1 is the week of Apply)', () => {
  const answers = { weeks: 6 as const, effort: 'standard' as const };
  it('week 1 is the partial week; week 2 starts the next Monday; a plan workout before Apply that week counts there', () => {
    const at = '2026-10-28T09:00:00Z';
    expect(pbBlockWeekOf({ answers, appliedAtUtc: at, workouts: [], nowMs: Date.parse('2026-10-28T20:00:00Z'), tz: TZ }).week).toBe(1);
    const b = pbBlockWeekOf({ answers, appliedAtUtc: at, workouts: [{ startedAtUtc: '2026-10-27T18:00:00Z', dayIndex: 1 }], nowMs: Date.parse('2026-11-02T08:00:00Z'), tz: TZ });
    expect(b).toMatchObject({ week: 2, mondays: ['2026-10-26', '2026-11-02'], daysDone: [[1], []] });
  });

  it('a workout named for variants takes the first not done that week, after the plan’s own', () => {
    const b = pbBlockWeekOf({ answers, appliedAtUtc: '2026-10-26T07:00:00Z', workouts: [{ startedAtUtc: '2026-10-26T18:00:00Z', dayIndex: 1, dayIndexes: [1, 4] }, { startedAtUtc: '2026-10-28T18:00:00Z', dayIndex: 1 }], nowMs: Date.parse('2026-10-28T20:00:00Z'), tz: TZ });
    expect(b.daysDone).toEqual([[1, 4]]);
    expect(b.doneOn?.[0]).toEqual({ 1: '2026-10-28', 4: '2026-10-26' });
  });
});

describe('Today’s tiles: an Any days plan’s days left (the next N − done days)', () => {
  const names = (ts: ReturnType<typeof buildWeekTiles>) => ts.map((t) => `${t.date.slice(8)} ${t.state}${t.marks.map((m) => ` ${m.shape}:${m.colour}`).join('')}`);
  it('Wed with Push in progress: today holds Push, Push B, Pull B, Legs B go Thu–Sat; Sunday plain; never a past day', () => {
    expect(aheadDates('2026-10-28', ['Push', 'Push', 'Pull', 'Legs'], 'Push')).toEqual([
      { localDate: '2026-10-29', name: 'Push' },
      { localDate: '2026-10-30', name: 'Pull' },
      { localDate: '2026-10-31', name: 'Legs' },
    ]);
    const t = buildWeekTiles({ today: '2026-10-28', workouts: [{ sessionId: 'm', localDate: '2026-10-26', title: 'Workout', dayName: 'Legs' }], activities: [], ahead: ['Push', 'Push', 'Pull', 'Legs'], chosen: 'Push' });
    expect(names(t)).toEqual(['26 done dot:legs', '27 plain', '28 planned ring:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
  });

  it('more days left than dates: the ones that fit; Sunday: none after it', () => {
    expect(aheadDates('2026-10-31', ['A', 'B', 'C'], null).map((d) => d.localDate)).toEqual(['2026-11-01']);
    expect(aheadDates('2026-11-01', ['A'], null)).toEqual([]);
  });
});

describe('Up next after Ben’s week (D19: the day trained least recently)', () => {
  it('Legs off-plan Mon, Pull Tue, Push A Wed → Legs B (legs longest ago; Legs is done, so its variant), never Legs again', () => {
    const ws = [
      wk('mon', '2026-10-26T18:00:00Z', LEGS, { leadExerciseId: 'squat' }),
      wk('tue', '2026-10-27T18:00:00Z', PULL, { leadExerciseId: 'row' }),
      wk('wed', '2026-10-28T18:04:00Z', PUSH, { routineId: 'push-a' }),
    ];
    expect(planDaysByDue(DAYS, ws)[0]?.day.name).toBe('Legs B');
    // Led with the RDL (Legs B's main lift): Legs is next instead.
    const rdl = [{ ...ws[0], leadExerciseId: 'rdl' } as PlanWeekSlotWorkout, ...ws.slice(1)];
    expect(planDaysByDue(DAYS, rdl)[0]?.day.name).toBe('Legs');
  });
});
