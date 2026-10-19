import { describe, expect, it } from 'vitest';

import type { MuscleGroup, PlanPause, Routine, RoutineExercise } from '@fizz/schemas';

import {
  activePause,
  activePin,
  aimWithPause,
  autoResumeDue,
  consistency,
  localMidnightUtcMs,
  pausedDates,
  planDayBodyParts,
  planDaysByDue,
  planDaysDoneBy,
  planDaysDoneThisWeek,
  planOverview,
  validPauseUntil,
  toIso,
  type PlanDueDay,
  type PlanDueWorkout,
} from '../src/index';
import { at, exercise, id, ms, TZ } from './fixtures';

/**
 * A plan that follows what Ben does (Ben, 20 Oct): Up next is the plan day
 * trained least recently by muscles, counting every workout (an off-plan
 * leg session counts as Legs); `Make next` pins a day until it's done; a
 * pause (optional until date, auto-resume on it) takes the plan out of Up
 * next and its days out of the aim.
 *
 * T0 is Thu 8 Oct 2026, 19:00 in Auckland.
 */

const DAY = 86_400;
const PUSH: PlanDueDay = { routineId: id(1), name: 'Push', bodyParts: ['Chest', 'Shoulders', 'Triceps'] };
const PULL: PlanDueDay = { routineId: id(2), name: 'Pull', bodyParts: ['Back', 'Biceps'] };
const LEGS: PlanDueDay = { routineId: id(3), name: 'Legs', bodyParts: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] };
const PPL = [PUSH, PULL, LEGS];

const groups = (g: Partial<Record<MuscleGroup, number>>): Map<MuscleGroup, number> => new Map(Object.entries(g) as [MuscleGroup, number][]);
const workout = (n: number, seconds: number, routineId: string | null, g: Partial<Record<MuscleGroup, number>>): PlanDueWorkout => ({ sessionId: id(100 + n), routineId, startedAtUtc: at(seconds).utc, groups: groups(g) });
const pushDone = (n: number, s: number, routineId: string | null = PUSH.routineId) => workout(n, s, routineId, { Chest: 6, Shoulders: 3, Triceps: 3 });
const pullDone = (n: number, s: number, routineId: string | null = PULL.routineId) => workout(n, s, routineId, { Back: 6, Biceps: 3 });
const legsDone = (n: number, s: number, routineId: string | null = LEGS.routineId) => workout(n, s, routineId, { Quads: 6, Hamstrings: 3, Glutes: 2 });
const names = (ds: readonly { day: PlanDueDay }[]) => ds.map((d) => d.day.name);

describe('adaptive Up next while a plan is in use (Ben, 20 Oct)', () => {
  it('day 1 before anything is done; then the plan days trained least recently, never the one just done', () => {
    expect(names(planDaysByDue(PPL, []))).toEqual(['Push', 'Pull', 'Legs']);
    expect(names(planDaysByDue(PPL, [pushDone(1, 0)]))).toEqual(['Pull', 'Legs']);
    expect(names(planDaysByDue(PPL, [pushDone(1, 0), pullDone(2, DAY)]))).toEqual(['Legs', 'Push']);
  });

  it('skipped legs: Push, Pull, then Push again (off-plan) → Legs is next, not Pull', () => {
    const ws = [pushDone(1, 0), pullDone(2, DAY), pushDone(3, 2 * DAY, null)];
    expect(names(planDaysByDue(PPL, ws))[0]).toBe('Legs');
  });

  it('an off-plan leg session (empty workout, coach-built, imported) counts as Legs: Legs is ✓ and Up next is another day', () => {
    const ws = [pushDone(1, 0), legsDone(2, DAY, null)];
    expect(names(planDaysByDue(PPL, ws))).toEqual(['Pull', 'Push']);
    expect(planDaysDoneBy(PPL, legsDone(2, DAY, null))).toEqual([LEGS.routineId]);
  });

  it('a workout that trained two days counts for both; the only day left is offered even if just done', () => {
    const full = workout(1, 0, null, { Chest: 4, Back: 4, Quads: 4 });
    expect(planDaysByDue(PPL, [full]).map((d) => d.day.name)).toEqual(['Push', 'Pull', 'Legs']);
    const one = [{ ...LEGS }];
    expect(names(planDaysByDue(one, [legsDone(1, 0)]))).toEqual(['Legs']);
  });

  it('a workout that trained no plan day (core only) changes nothing', () => {
    expect(names(planDaysByDue(PPL, [pushDone(1, 0), workout(2, DAY, null, { Core: 6 })]))).toEqual(['Pull', 'Legs']);
  });

  it('two days with the same body parts alternate (Upper A, Upper B)', () => {
    const A: PlanDueDay = { routineId: id(11), name: 'Upper A', bodyParts: ['Chest', 'Back'] };
    const B: PlanDueDay = { routineId: id(12), name: 'Upper B', bodyParts: ['Chest', 'Back'] };
    const L: PlanDueDay = { routineId: id(13), name: 'Lower', bodyParts: ['Quads', 'Hamstrings'] };
    const days = [A, B, L];
    const upper = (n: number, s: number, r: string) => workout(n, s, r, { Chest: 5, Back: 5 });
    expect(names(planDaysByDue(days, [upper(1, 0, A.routineId)]))).toEqual(['Lower']);
    expect(names(planDaysByDue(days, [upper(1, 0, A.routineId), workout(2, DAY, L.routineId, { Quads: 6 })]))[0]).toBe('Upper B');
  });

  it('a plan day with no body parts (cardio) counts by its own workouts only', () => {
    const cardio: PlanDueDay = { routineId: id(14), name: 'Conditioning', bodyParts: [] };
    const days = [PUSH, cardio];
    expect(names(planDaysByDue(days, [workout(1, 0, cardio.routineId, {})]))).toEqual(['Push']);
    expect(names(planDaysByDue(days, [pushDone(1, 0)]))).toEqual(['Conditioning']);
  });

  it('Make next pins a day first until it is done (by its own workout or one that trained its body parts)', () => {
    const pin = { routineId: PUSH.routineId, opId: 'pin-1', atUtc: at(DAY).utc };
    const ws = [pushDone(1, 0)];
    expect(planDaysByDue(PPL, ws, pin).map((d) => [d.day.name, d.pinned])).toEqual([
      ['Push', true],
      ['Pull', false],
      ['Legs', false],
    ]);
    // Done after the pin: off-plan push counts.
    expect(activePin(pin, PPL, [...ws, pushDone(2, 2 * DAY, null)])).toBeNull();
    expect(names(planDaysByDue(PPL, [...ws, pushDone(2, 2 * DAY, null)], pin))).toEqual(['Pull', 'Legs']);
    // A pin on a day no longer in the plan does nothing.
    expect(activePin({ ...pin, routineId: id(99) }, PPL, ws)).toBeNull();
  });
});

describe('a plan day’s body parts', () => {
  const BENCH = exercise(201, 'Bench', { primaryMuscles: ['chest'] });
  const OHP = exercise(202, 'OHP', { primaryMuscles: ['front_delts'] });
  const ABS = exercise(203, 'Crunch', { primaryMuscles: ['abs'] });
  const GRIP = exercise(204, 'Wrist curl', { primaryMuscles: ['forearms'] });
  const of = (eid: string) => [BENCH, OHP, ABS, GRIP].find((e) => e.id === eid) ?? null;
  const rex = (n: number, exerciseId: string, sets: number): RoutineExercise => ({
    id: id(300 + n),
    exerciseId,
    equipmentId: null,
    order: n,
    supersetGroup: null,
    setTemplates: Array.from({ length: sets }, (_, i) => ({ id: id(400 + n * 10 + i), setType: 'working' as const, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null })),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  });
  const r = (exercises: RoutineExercise[], splitDayId: string | null = null): Pick<Routine, 'exercises' | 'createdFromPlan'> => ({
    exercises,
    ...(splitDayId === null ? {} : { createdFromPlan: { planId: id(9), dayIndex: 0, versionN: 1, splitDayId, atUtc: at(0).utc } }),
  });

  it('from its exercises’ primary muscles (a part with a fifth of the sets), else the split day it was mapped to', () => {
    expect(planDayBodyParts(r([rex(0, BENCH.id, 6), rex(1, OHP.id, 3), rex(2, ABS.id, 1)]), of, null)).toEqual(['Chest', 'Shoulders']);
    const split = { kind: 'ppl' as const, days: [{ id: 'legs', name: 'Legs', bodyParts: ['Quads' as const] }] };
    expect(planDayBodyParts(r([], 'legs'), of, split)).toEqual(['Quads']);
    // Forearms isn't a split body part: nothing from exercises, so the mapping (none here) → empty.
    expect(planDayBodyParts(r([rex(0, GRIP.id, 3)]), of, null)).toEqual([]);
  });
});

describe('pause (Ben, 20 Oct: "pause eg if go on hols")', () => {
  const pause = (over: Partial<PlanPause> = {}): PlanPause => ({ opId: 'p-1', fromUtc: at(0).utc, untilDate: '2026-11-03', endedAtUtc: null, endedBy: null, ...over });
  const plan = (pauses: PlanPause[]) => ({ status: 'applied' as const, pauses });

  it('runs from the tap until the until date starts (local), or until Resume; auto-resume is due on the date', () => {
    const p = pause();
    expect(activePause(plan([p]), ms(DAY), TZ)).toEqual(p);
    const nov3 = localMidnightUtcMs('2026-11-03', TZ);
    expect(activePause(plan([p]), nov3 - 1000, TZ)).not.toBeNull();
    expect(activePause(plan([p]), nov3, TZ)).toBeNull();
    expect(autoResumeDue(plan([p]), nov3 - 1000, TZ)).toBeNull();
    expect(autoResumeDue(plan([p]), nov3 + 3600_000, TZ)).toEqual(p);
    expect(activePause(plan([pause({ endedAtUtc: at(DAY).utc })]), ms(2 * DAY), TZ)).toBeNull();
    expect(activePause(plan([pause({ untilDate: null })]), ms(400 * DAY), TZ)).not.toBeNull();
    expect(activePause({ status: 'ended', pauses: [p] }, ms(DAY), TZ)).toBeNull();
  });

  it('paused dates: from the pause’s own date up to the until date or Resume’s date; same-day resume pauses none', () => {
    expect([...pausedDates([pause({ untilDate: '2026-10-12' })], '2026-10-05', '2026-10-19', TZ)]).toEqual(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(pausedDates([pause({ endedAtUtc: at(3600).utc })], '2026-10-05', '2026-10-19', TZ).size).toBe(0);
    expect(pausedDates([pause({ untilDate: null })], '2026-10-05', '2026-10-12', TZ).size).toBe(4);
  });

  it('a picked until date is after today and within a year', () => {
    expect(validPauseUntil(null, ms(0), TZ)).toBe(true);
    expect(validPauseUntil('2026-10-08', ms(0), TZ)).toBe(false);
    expect(validPauseUntil('2026-10-09', ms(0), TZ)).toBe(true);
    expect(validPauseUntil('2028-01-01', ms(0), TZ)).toBe(false);
    expect(validPauseUntil('3 Nov', ms(0), TZ)).toBe(false);
  });

  it('the aim leaves paused days out', () => {
    expect(aimWithPause(4, 0)).toBe(4);
    expect(aimWithPause(4, 4)).toBe(2);
    expect(aimWithPause(3, 7)).toBe(0);
  });
});

describe('week counting with a plan that adapts and pauses', () => {
  const days = PPL.map((d) => ({ routineId: d.routineId, bodyParts: d.bodyParts }));
  const appliedAtUtc = at(-3 * DAY).utc; // Mon 5 Oct, 19:00

  it('a plan day counts done this week by its own workout or an off-plan one that mainly trained its body parts', () => {
    const ws = [pushDone(1, -2 * DAY), legsDone(2, -DAY, null), workout(3, -DAY + 3600, null, { Core: 5 })];
    const done = planDaysDoneThisWeek({ days, appliedAtUtc, workouts: ws, nowMs: ms(0), tz: TZ });
    expect([...done.keys()].sort()).toEqual([PUSH.routineId, LEGS.routineId].sort());
    // A plan workout counts for its own day only (Push's plan workout doesn't tick Pull).
    expect(planDaysDoneBy(PPL, pushDone(4, 0))).toEqual([PUSH.routineId]);
  });

  it('Your plan: ✓ for an off-plan leg day, Next is the day Up next says; paused shows `Paused · until 3 Nov` and no Next; days this week leaves paused days out', () => {
    const base = {
      plan: { id: id(50), name: '3-day plan', status: 'applied' as const, version: 3, appliedAtUtc },
      days: PPL.map((d) => ({ routineId: d.routineId, name: d.name, bodyParts: d.bodyParts, createdFromSessionId: null })),
      workouts: [{ ...legsDone(2, -DAY, null), tz: TZ }],
      nextRoutineId: PUSH.routineId,
      training: null,
      sets: { planned: 0, done: 0 },
      nowMs: ms(0),
      tz: TZ,
    };
    const v = planOverview(base);
    expect(v?.days.map((d) => [d.name, d.state, d.next])).toEqual([
      ['Push', 'next', true],
      ['Pull', 'todo', false],
      ['Legs', 'done', false],
    ]);
    expect(v?.paused).toBeNull();
    expect(v?.daysThisWeek.text).toBe('1 of 3');
    const p = planOverview({ ...base, paused: { untilDate: '2026-11-03' }, pausedDaysThisWeek: 4 });
    expect(p?.paused?.text).toBe('Paused · until 3 Nov');
    expect(p?.days.some((d) => d.next)).toBe(false);
    expect(p?.daysThisWeek.text).toBe('1 of 1');
    expect(planOverview({ ...base, paused: { untilDate: null } })?.paused?.text).toBe('Paused');
  });

  it('consistency: paused days don’t count against the aim; a fully paused week isn’t judged', () => {
    const paused = pausedDates([{ opId: 'p', fromUtc: toIso(localMidnightUtcMs('2026-09-21', TZ)), untilDate: '2026-10-01', endedAtUtc: null, endedBy: null }], '2026-08-01', '2026-10-12', TZ);
    const c = consistency({ workouts: [], nowMs: ms(0), tz: TZ, aim: 3, plan: null, pausedDates: paused });
    const sep21 = c.weeks.find((w) => w.monday === '2026-09-21');
    const sep28 = c.weeks.find((w) => w.monday === '2026-09-28');
    expect(sep21).toMatchObject({ pausedDays: 7, aim: null, atAim: null, text: '0' });
    expect(sep28).toMatchObject({ pausedDays: 3, aim: 2, atAim: false, text: '0/2' });
    expect(c.atAimText).toBe('Weeks at your aim: 0 of 7');
    // The plan's days this week: 4 of 7 days paused → 3 × 3/7 ≈ 1.
    const now = consistency({ workouts: [], nowMs: ms(0), tz: TZ, aim: null, plan: { days, appliedAtUtc }, pausedDates: new Set(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']) });
    expect(now.planThisWeek?.text).toBe('0 of 1');
  });
});
