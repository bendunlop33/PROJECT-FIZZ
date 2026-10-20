import { describe, expect, it } from 'vitest';
import type { PlanDraft, Routine, RoutineExercise } from '@fizz/schemas';

import {
  isFromPlanDay,
  planDayKeyOf,
  planDayOf,
  planDaysByDue,
  planDaysDoneBy,
  planRoutineForSplitDay,
  planRoutines,
  planUpNext,
  type FinishedRef,
  type PlanDueDay,
  type PlanDueWorkout,
} from '../src/index';
import { at, id } from './fixtures';

/**
 * Workout builder v3 §4.2 (Ben approved 20 Oct): templates per main lift,
 * session plan-day provenance, and Up next credited by the plan day (plan,
 * day index), so a `Today only` start (a draft with no routine) still moves
 * it on and a plan that repeats a split day keeps its days apart (review
 * b3-data B1). Today opens the template used last (Q2, S1).
 */

const PLAN = id(500);
const OTHER_PLAN = id(501);
const BENCH = id(600);
const INCLINE = id(601);
const SQUAT = id(602);

type R = Pick<Routine, 'id' | 'createdFromSessionId' | 'deletedAtUtc' | 'createdFromPlan' | 'planDay' | 'exercises'>;

const ex = (exerciseId: string, main?: boolean): RoutineExercise => ({ id: id(700), exerciseId, equipmentId: null, order: 0, supersetGroup: null, setTemplates: [], restBySetType: {}, transitionRestS: null, progressionRuleId: null, ...(main === undefined ? {} : { main }) });

function tpl(n: number, splitDayId: string, main: string | null, over: Partial<R> = {}, dayIndex = splitDayId === 'legs' ? 1 : 0): R {
  return { id: id(n), createdFromSessionId: null, deletedAtUtc: null, exercises: [], planDay: { planId: PLAN, dayIndex, splitDayId, mainLiftExerciseId: main, minutes: 60 }, ...over };
}

const CHEST_BENCH = tpl(1, 'chest', BENCH, { createdFromPlan: { planId: PLAN, dayIndex: 0, versionN: 1, splitDayId: 'chest', atUtc: at(0).utc } });
const CHEST_INCLINE = tpl(2, 'chest', INCLINE);
const LEGS = tpl(3, 'legs', SQUAT, { createdFromPlan: { planId: PLAN, dayIndex: 1, versionN: 1, splitDayId: 'legs', atUtc: at(0).utc } });

/** A `Today only` start's plan day: (plan, day index), no template. */
const asDay = (dayIndex: number, splitDayId: string, over: Partial<NonNullable<FinishedRef['planDay']>> = {}): NonNullable<FinishedRef['planDay']> => ({ planId: PLAN, dayIndex, splitDayId, templateRoutineId: null, ...over });

const plan = (made: { dayIndex: number; routineId: string }[]): Pick<PlanDraft, 'id' | 'status' | 'applied'> => ({
  id: PLAN,
  status: 'applied',
  applied: { mode: 'add', versionN: 1, opId: 'apply', atUtc: at(0).utc, made: made.map((m) => ({ ...m, version: 1 })), rotationOff: [] },
});

const ref = (n: number, over: Partial<FinishedRef>): FinishedRef => ({ sessionId: id(900 + n), routineId: null, startedAtUtc: at(n * 3600).utc, tz: at(0).tz, ...over });

describe('plan-day keys (§4.2)', () => {
  it('planDay wins; an older plan workout derives its key when read', () => {
    expect(planDayOf(CHEST_INCLINE)).toEqual({ planId: PLAN, dayIndex: 0 });
    const old = { exercises: [ex(SQUAT), ex(BENCH, true)], createdFromPlan: { planId: PLAN, dayIndex: 1, versionN: 1, splitDayId: null, atUtc: at(0).utc } };
    const split = { days: [{ id: 'legs', mainLiftExerciseId: SQUAT }, { id: 'chest' }] };
    // splitDayId from the split day at its dayIndex; main lift from its own main exercise.
    expect(planDayKeyOf(old, split)).toEqual({ planId: PLAN, dayIndex: 1, splitDayId: 'chest', mainLiftExerciseId: BENCH });
    // No main exercise: the Profile's main lift for the day, then the split day's.
    expect(planDayKeyOf({ ...old, exercises: [ex(BENCH)] }, split, { chest: INCLINE })).toEqual({ planId: PLAN, dayIndex: 1, splitDayId: 'chest', mainLiftExerciseId: INCLINE });
    expect(planDayKeyOf({ ...old, exercises: [], createdFromPlan: { ...old.createdFromPlan, dayIndex: 0 } }, split)).toEqual({ planId: PLAN, dayIndex: 0, splitDayId: 'legs', mainLiftExerciseId: SQUAT });
    // Not derivable: an ordinary routine.
    expect(planDayKeyOf({ ...old, createdFromPlan: { ...old.createdFromPlan, dayIndex: 5 } }, split)).toBeNull();
    expect(planDayKeyOf({ exercises: [] }, split)).toBeNull();
    // An older plan workout is its plan day even with no split day (Up next walks it by index).
    expect(planDayOf({ createdFromPlan: { planId: PLAN, dayIndex: 2, versionN: 1, splitDayId: null, atUtc: at(0).utc } })).toEqual({ planId: PLAN, dayIndex: 2 });
    expect(planDayOf({})).toBeNull();
  });

  it('a workout counts for a plan day by its routine, its template, or (plan, day index)', () => {
    expect(isFromPlanDay(ref(1, { routineId: CHEST_BENCH.id }), CHEST_BENCH)).toBe(true);
    expect(isFromPlanDay(ref(1, { planDay: asDay(0, 'chest') }), CHEST_INCLINE)).toBe(true);
    expect(isFromPlanDay(ref(1, { planDay: asDay(1, 'legs', { templateRoutineId: CHEST_INCLINE.id }) }), CHEST_INCLINE)).toBe(true);
    expect(isFromPlanDay(ref(1, { planDay: { ...asDay(0, 'chest'), planId: OTHER_PLAN } }), CHEST_INCLINE)).toBe(false);
    expect(isFromPlanDay(ref(1, { planDay: asDay(1, 'legs') }), CHEST_INCLINE)).toBe(false);
  });
});

describe('planRoutines: every template (§4.2)', () => {
  it('two templates per day both appear; a template added later sits with its day; deleted and other plans’ stay out', () => {
    const added = tpl(4, 'chest', id(603));
    const deleted = tpl(5, 'legs', id(604), { deletedAtUtc: at(10).utc });
    const other = tpl(6, 'chest', id(605), { planDay: { planId: OTHER_PLAN, dayIndex: 0, splitDayId: 'chest', mainLiftExerciseId: id(605), minutes: 60 } });
    const routines = [CHEST_BENCH, CHEST_INCLINE, LEGS, added, deleted, other];
    const p = plan([{ dayIndex: 0, routineId: CHEST_BENCH.id }, { dayIndex: 0, routineId: CHEST_INCLINE.id }, { dayIndex: 1, routineId: LEGS.id }]);
    expect(planRoutines(p, routines).map((r) => r.id)).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id, added.id, LEGS.id]);
    // Apply made one per day (before v3): the incline template, added since, still appears.
    expect(planRoutines(plan([{ dayIndex: 0, routineId: CHEST_BENCH.id }, { dayIndex: 1, routineId: LEGS.id }]), routines).map((r) => r.id)).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id, added.id, LEGS.id]);
    expect(planRoutines(null, routines)).toEqual([]);
  });
});

describe('planUpNext credits the plan day (plan, day index) (§4.2)', () => {
  const days = [CHEST_BENCH, CHEST_INCLINE, LEGS];

  it('Up next moves on after a `Today only` start (no routine), past the day’s other template', () => {
    expect(planUpNext(days, [], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext(days, [ref(1, { planDay: asDay(0, 'chest') })], at(0).utc)?.id).toBe(LEGS.id);
    // Doing the incline template is Chest too.
    expect(planUpNext(days, [ref(1, { routineId: CHEST_INCLINE.id })], at(0).utc)?.id).toBe(LEGS.id);
    expect(planUpNext(days, [ref(1, { routineId: CHEST_BENCH.id }), ref(2, { planDay: asDay(1, 'legs') })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
  });

  it('older workouts still count by routine; another plan’s day and workouts before Apply don’t', () => {
    expect(planUpNext(days, [ref(1, { routineId: LEGS.id })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext(days, [ref(1, { planDay: { ...asDay(0, 'chest'), planId: OTHER_PLAN } })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext(days, [ref(-5, { planDay: asDay(0, 'chest') })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    // One day only (both templates the same day): that day again, as last used (Q2).
    expect(planUpNext([CHEST_BENCH, CHEST_INCLINE], [ref(1, { routineId: CHEST_BENCH.id })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext([CHEST_BENCH, CHEST_INCLINE], [ref(1, { routineId: CHEST_INCLINE.id })], at(0).utc)?.id).toBe(CHEST_INCLINE.id);
  });

  it('(Q2, S1) a day with several templates opens the one used last: by routine, template, or main lift', () => {
    // Chest · incline last time, then Legs: Chest comes round as incline.
    expect(planUpNext(days, [ref(1, { routineId: CHEST_INCLINE.id }), ref(2, { routineId: LEGS.id })], at(0).utc)?.id).toBe(CHEST_INCLINE.id);
    expect(planUpNext(days, [ref(1, { planDay: asDay(0, 'chest', { templateRoutineId: CHEST_INCLINE.id }) }), ref(2, { planDay: asDay(1, 'legs') })], at(0).utc)?.id).toBe(CHEST_INCLINE.id);
    // A `Today only` start with no template names its main lift.
    expect(planUpNext(days, [ref(1, { planDay: asDay(0, 'chest', { mainLiftExerciseId: INCLINE }) }), ref(2, { routineId: LEGS.id })], at(0).utc)?.id).toBe(CHEST_INCLINE.id);
    // Nothing names one (a Today only start with neither): the first.
    expect(planUpNext(days, [ref(1, { planDay: asDay(0, 'chest') }), ref(2, { routineId: LEGS.id })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    // Never done since Apply: the first.
    expect(planUpNext(days, [ref(-5, { routineId: CHEST_INCLINE.id })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
  });
});

describe('a plan that repeats a split day: Push/Pull/Legs/Push (review b3-data B1)', () => {
  const link = (dayIndex: number, splitDayId: string) => ({ planId: PLAN, dayIndex, versionN: 1, splitDayId, atUtc: at(0).utc });
  // Before v3: one workout per day, no `planDay`.
  const old = (n: number, dayIndex: number, splitDayId: string): R => ({ id: id(n), createdFromSessionId: null, deletedAtUtc: null, exercises: [], createdFromPlan: link(dayIndex, splitDayId) });
  const PUSH1 = old(11, 0, 'push');
  const PULL = old(12, 1, 'pull');
  const LEGS_D = old(13, 2, 'legs');
  const PUSH2 = old(14, 3, 'push');
  const pre = [PUSH1, PULL, LEGS_D, PUSH2];

  it('pre-v3 workouts: after push2 comes push1 (not pull), and the cycle visits every day', () => {
    expect(planUpNext(pre, [ref(1, { routineId: PUSH2.id })], at(0).utc)?.id).toBe(PUSH1.id);
    expect(planUpNext(pre, [ref(1, { routineId: PUSH1.id })], at(0).utc)?.id).toBe(PULL.id);
    expect(planUpNext(pre, [ref(1, { routineId: LEGS_D.id })], at(0).utc)?.id).toBe(PUSH2.id);
    const order: string[] = [];
    const refs: FinishedRef[] = [];
    for (let i = 0; i < 8; i += 1) {
      const next = planUpNext(pre, refs, at(0).utc);
      if (next === null) throw new Error('no day');
      order.push(next.id);
      refs.push(ref(i + 1, { routineId: next.id }));
    }
    expect(order).toEqual([PUSH1.id, PULL.id, LEGS_D.id, PUSH2.id, PUSH1.id, PULL.id, LEGS_D.id, PUSH2.id]);
  });

  it('v3 templates: a session started from push2’s template is credited to push2; a Today only day-4 start too', () => {
    const p1 = tpl(21, 'push', BENCH, {}, 0);
    const pull = tpl(22, 'pull', null, {}, 1);
    const legs = tpl(23, 'legs', SQUAT, {}, 2);
    const p2 = tpl(24, 'push', BENCH, {}, 3);
    const v3 = [p1, pull, legs, p2];
    expect(planUpNext(v3, [ref(1, { planDay: asDay(3, 'push', { templateRoutineId: p2.id, mainLiftExerciseId: BENCH }) })], at(0).utc)?.id).toBe(p1.id);
    expect(planUpNext(v3, [ref(1, { planDay: asDay(3, 'push') })], at(0).utc)?.id).toBe(p1.id);
    expect(planUpNext(v3, [ref(1, { planDay: asDay(0, 'push') })], at(0).utc)?.id).toBe(pull.id);
    // The split-day fallback picks the Push day done least recently, a Today only start counting (N4).
    expect(planRoutineForSplitDay(v3, 'push', [ref(1, { planDay: asDay(0, 'push') })])?.id).toBe(p2.id);
    expect(planRoutineForSplitDay(v3, 'push', [ref(1, { planDay: asDay(3, 'push') })])?.id).toBe(p1.id);
  });

  it('adaptive Up next keeps the two Push days apart', () => {
    const d = (r: R, name: string, bodyParts: PlanDueDay['bodyParts']): PlanDueDay => ({ routineId: r.id, name, bodyParts, planKey: planDayOf(r) });
    const due = [d(PUSH1, 'Push', []), d(PULL, 'Pull', []), d(LEGS_D, 'Legs', []), d(PUSH2, 'Push', [])];
    const w: PlanDueWorkout = { sessionId: id(950), routineId: PUSH2.id, startedAtUtc: at(3600).utc, groups: new Map() };
    expect(planDaysDoneBy(due, w)).toEqual([PUSH2.id]);
    expect(planDaysDoneBy(due, { ...w, routineId: null, planDay: { planId: PLAN, dayIndex: 0 } })).toEqual([PUSH1.id]);
    expect(planDaysByDue(due, [w]).map((x) => x.day.routineId)).not.toContain(PUSH2.id);
    expect(planDaysByDue(due, [w]).map((x) => x.day.routineId)).toContain(PUSH1.id);
  });
});

describe('adaptive Up next (planDaysByDue) credits (plan, split day) (§4.2)', () => {
  const day = (r: R, name: string, bodyParts: PlanDueDay['bodyParts']): PlanDueDay => ({ routineId: r.id, name, bodyParts, planKey: planDayOf(r) });
  const days = [day(CHEST_BENCH, 'Chest · bench', ['Chest']), day(CHEST_INCLINE, 'Chest · incline', ['Chest']), day(LEGS, 'Legs', ['Quads'])];
  const w = (n: number, over: Partial<PlanDueWorkout>): PlanDueWorkout => ({ sessionId: id(900 + n), routineId: null, startedAtUtc: at(n * 3600).utc, groups: new Map(), ...over });

  it('a `Today only` Chest start with no sets counted yet still moves Up next to Legs', () => {
    const order = planDaysByDue(days, [w(1, { planDay: { planId: PLAN, dayIndex: 0 } })]);
    expect(order[0]?.day.routineId).toBe(LEGS.id);
    expect(planDaysDoneBy(days, w(1, { planDay: { planId: PLAN, dayIndex: 0 } })).sort()).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id].sort());
    // Started from the incline template (named only by `templateRoutineId`): Chest is done.
    expect(planDaysDoneBy(days, w(1, { planDay: { planId: PLAN, dayIndex: 0, templateRoutineId: CHEST_INCLINE.id } })).sort()).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id].sort());
  });

  it('without plan-day provenance (older workouts) nothing changes', () => {
    expect(planDaysByDue(days, [w(1, {})]).map((p) => p.day.routineId)).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id, LEGS.id]);
    expect(planDaysByDue(days, [w(1, { routineId: LEGS.id })])[0]?.day.routineId).toBe(CHEST_BENCH.id);
  });
});
