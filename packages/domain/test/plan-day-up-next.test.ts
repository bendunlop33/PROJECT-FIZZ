import { describe, expect, it } from 'vitest';
import type { PlanDraft, Routine, RoutineExercise } from '@fizz/schemas';

import { isFromPlanDay, planDayKeyOf, planDayOf, planDaysByDue, planDaysDoneBy, planRoutines, planUpNext, type FinishedRef, type PlanDueDay, type PlanDueWorkout } from '../src/index';
import { at, id } from './fixtures';

/**
 * Workout builder v3 §4.2 (Ben approved 20 Oct): templates per main lift,
 * session plan-day provenance, and Up next credited by (plan, split day),
 * so a `Today only` start (a draft with no routine) still moves it on.
 */

const PLAN = id(500);
const OTHER_PLAN = id(501);
const BENCH = id(600);
const INCLINE = id(601);
const SQUAT = id(602);

type R = Pick<Routine, 'id' | 'createdFromSessionId' | 'deletedAtUtc' | 'createdFromPlan' | 'planDay' | 'exercises'>;

const ex = (exerciseId: string, main?: boolean): RoutineExercise => ({ id: id(700), exerciseId, equipmentId: null, order: 0, supersetGroup: null, setTemplates: [], restBySetType: {}, transitionRestS: null, progressionRuleId: null, ...(main === undefined ? {} : { main }) });

function tpl(n: number, splitDayId: string, main: string | null, over: Partial<R> = {}): R {
  return { id: id(n), createdFromSessionId: null, deletedAtUtc: null, exercises: [], planDay: { planId: PLAN, splitDayId, mainLiftExerciseId: main, minutes: 60 }, ...over };
}

const CHEST_BENCH = tpl(1, 'chest', BENCH, { createdFromPlan: { planId: PLAN, dayIndex: 0, versionN: 1, splitDayId: 'chest', atUtc: at(0).utc } });
const CHEST_INCLINE = tpl(2, 'chest', INCLINE);
const LEGS = tpl(3, 'legs', SQUAT, { createdFromPlan: { planId: PLAN, dayIndex: 1, versionN: 1, splitDayId: 'legs', atUtc: at(0).utc } });

const plan = (made: { dayIndex: number; routineId: string }[]): Pick<PlanDraft, 'id' | 'status' | 'applied'> => ({
  id: PLAN,
  status: 'applied',
  applied: { mode: 'add', versionN: 1, opId: 'apply', atUtc: at(0).utc, made: made.map((m) => ({ ...m, version: 1 })), rotationOff: [] },
});

const ref = (n: number, over: Partial<FinishedRef>): FinishedRef => ({ sessionId: id(900 + n), routineId: null, startedAtUtc: at(n * 3600).utc, tz: at(0).tz, ...over });

describe('plan-day keys (§4.2)', () => {
  it('planDay wins; an older plan workout derives its key when read', () => {
    expect(planDayOf(CHEST_INCLINE)).toEqual({ planId: PLAN, splitDayId: 'chest' });
    const old = { exercises: [ex(SQUAT), ex(BENCH, true)], createdFromPlan: { planId: PLAN, dayIndex: 1, versionN: 1, splitDayId: null, atUtc: at(0).utc } };
    const split = { days: [{ id: 'legs', mainLiftExerciseId: SQUAT }, { id: 'chest' }] };
    // splitDayId from the split day at its dayIndex; main lift from its own main exercise.
    expect(planDayKeyOf(old, split)).toEqual({ planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: BENCH });
    // No main exercise: the Profile's main lift for the day, then the split day's.
    expect(planDayKeyOf({ ...old, exercises: [ex(BENCH)] }, split, { chest: INCLINE })).toEqual({ planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: INCLINE });
    expect(planDayKeyOf({ ...old, exercises: [], createdFromPlan: { ...old.createdFromPlan, dayIndex: 0 } }, split)).toEqual({ planId: PLAN, splitDayId: 'legs', mainLiftExerciseId: SQUAT });
    // Not derivable: an ordinary routine.
    expect(planDayKeyOf({ ...old, createdFromPlan: { ...old.createdFromPlan, dayIndex: 5 } }, split)).toBeNull();
    expect(planDayKeyOf({ exercises: [] }, split)).toBeNull();
    expect(planDayOf({ createdFromPlan: { planId: PLAN, dayIndex: 0, versionN: 1, splitDayId: null, atUtc: at(0).utc } })).toBeNull();
  });

  it('a workout counts for a plan day by its routine or by (plan, split day)', () => {
    expect(isFromPlanDay(ref(1, { routineId: CHEST_BENCH.id }), CHEST_BENCH)).toBe(true);
    expect(isFromPlanDay(ref(1, { planDay: { planId: PLAN, splitDayId: 'chest' } }), CHEST_INCLINE)).toBe(true);
    expect(isFromPlanDay(ref(1, { planDay: { planId: OTHER_PLAN, splitDayId: 'chest' } }), CHEST_INCLINE)).toBe(false);
    expect(isFromPlanDay(ref(1, { planDay: { planId: PLAN, splitDayId: 'legs' } }), CHEST_INCLINE)).toBe(false);
  });
});

describe('planRoutines: every template (§4.2)', () => {
  it('two templates per day both appear; a template added later sits with its day; deleted and other plans’ stay out', () => {
    const added = tpl(4, 'chest', id(603));
    const deleted = tpl(5, 'legs', id(604), { deletedAtUtc: at(10).utc });
    const other = tpl(6, 'chest', id(605), { planDay: { planId: OTHER_PLAN, splitDayId: 'chest', mainLiftExerciseId: id(605), minutes: 60 } });
    const routines = [CHEST_BENCH, CHEST_INCLINE, LEGS, added, deleted, other];
    const p = plan([{ dayIndex: 0, routineId: CHEST_BENCH.id }, { dayIndex: 0, routineId: CHEST_INCLINE.id }, { dayIndex: 1, routineId: LEGS.id }]);
    expect(planRoutines(p, routines).map((r) => r.id)).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id, added.id, LEGS.id]);
    // Apply made one per day (before v3): the incline template, added since, still appears.
    expect(planRoutines(plan([{ dayIndex: 0, routineId: CHEST_BENCH.id }, { dayIndex: 1, routineId: LEGS.id }]), routines).map((r) => r.id)).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id, added.id, LEGS.id]);
    expect(planRoutines(null, routines)).toEqual([]);
  });
});

describe('planUpNext credits (plan, split day) (§4.2)', () => {
  const days = [CHEST_BENCH, CHEST_INCLINE, LEGS];

  it('Up next moves on after a `Today only` start (no routine), past the day’s other template', () => {
    expect(planUpNext(days, [], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext(days, [ref(1, { planDay: { planId: PLAN, splitDayId: 'chest' } })], at(0).utc)?.id).toBe(LEGS.id);
    // Doing the incline template is Chest too.
    expect(planUpNext(days, [ref(1, { routineId: CHEST_INCLINE.id })], at(0).utc)?.id).toBe(LEGS.id);
    expect(planUpNext(days, [ref(1, { routineId: CHEST_INCLINE.id }), ref(2, { planDay: { planId: PLAN, splitDayId: 'legs' } })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
  });

  it('older workouts still count by routine; another plan’s day and workouts before Apply don’t', () => {
    expect(planUpNext(days, [ref(1, { routineId: LEGS.id })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext(days, [ref(1, { planDay: { planId: OTHER_PLAN, splitDayId: 'chest' } })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    expect(planUpNext(days, [ref(-5, { planDay: { planId: PLAN, splitDayId: 'chest' } })], at(0).utc)?.id).toBe(CHEST_BENCH.id);
    // One day only (both templates the same day): the next template.
    expect(planUpNext([CHEST_BENCH, CHEST_INCLINE], [ref(1, { routineId: CHEST_BENCH.id })], at(0).utc)?.id).toBe(CHEST_INCLINE.id);
  });
});

describe('adaptive Up next (planDaysByDue) credits (plan, split day) (§4.2)', () => {
  const day = (r: R, name: string, bodyParts: PlanDueDay['bodyParts']): PlanDueDay => ({ routineId: r.id, name, bodyParts, planKey: planDayOf(r) });
  const days = [day(CHEST_BENCH, 'Chest · bench', ['Chest']), day(CHEST_INCLINE, 'Chest · incline', ['Chest']), day(LEGS, 'Legs', ['Quads'])];
  const w = (n: number, over: Partial<PlanDueWorkout>): PlanDueWorkout => ({ sessionId: id(900 + n), routineId: null, startedAtUtc: at(n * 3600).utc, groups: new Map(), ...over });

  it('a `Today only` Chest start with no sets counted yet still moves Up next to Legs', () => {
    const order = planDaysByDue(days, [w(1, { planDay: { planId: PLAN, splitDayId: 'chest' } })]);
    expect(order[0]?.day.routineId).toBe(LEGS.id);
    expect(planDaysDoneBy(days, w(1, { planDay: { planId: PLAN, splitDayId: 'chest' } })).sort()).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id].sort());
  });

  it('without plan-day provenance (older workouts) nothing changes', () => {
    expect(planDaysByDue(days, [w(1, {})]).map((p) => p.day.routineId)).toEqual([CHEST_BENCH.id, CHEST_INCLINE.id, LEGS.id]);
    expect(planDaysByDue(days, [w(1, { routineId: LEGS.id })])[0]?.day.routineId).toBe(CHEST_BENCH.id);
  });
});
