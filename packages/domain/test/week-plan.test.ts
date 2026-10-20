import { describe, expect, it } from 'vitest';

import { ActivitySchema, RoutineSchema, WeekPlanSchema, type Activity, type ActivityFields, type Routine, type RoutineExercise, type SetTemplate } from '@fizz/schemas';

import {
  activeWeekPlan,
  addActivity,
  applyWeekPlan,
  checkWeekProposal,
  localMidnightUtcMs,
  mergedExercises,
  mergedName,
  routineSeconds,
  suggestWeek,
  undoWeekPlan,
  weekChangeText,
  weekDays,
  weekDaysRemoved,
  weekFacts,
  weekFactsKey,
  type WeekDayInput,
  type WeekProposal,
} from '../src/index';
import { id, idGen } from './fixtures';

/**
 * This week shaped around a run (Ben, 20 Oct). Today is Thu 22 Oct 2026 in
 * London; Ben lifts 4 days a week and has done 1 (Monday); a long run is
 * planned for Saturday. Plan days left: Chest, Shoulders, Back, Legs.
 */

const TZ = 'Europe/London';
const TODAY = '2026-10-22';
const NOW_MS = localMidnightUtcMs(TODAY, TZ) + 9 * 3_600_000;
const AT = { utc: new Date(NOW_MS).toISOString(), tz: TZ };
const OWNER = id(1);

const CHEST: WeekDayInput = { id: id(101), name: 'Chest', bodyParts: ['Chest', 'Triceps'], done: false };
const SHOULDERS: WeekDayInput = { id: id(102), name: 'Shoulders', bodyParts: ['Shoulders'], done: false };
const BACK: WeekDayInput = { id: id(103), name: 'Back', bodyParts: ['Back', 'Biceps'], done: false };
const LEGS: WeekDayInput = { id: id(104), name: 'Legs', bodyParts: ['Quads', 'Hamstrings', 'Glutes'], done: false };
const ARMS: WeekDayInput = { id: id(105), name: 'Arms', bodyParts: ['Biceps', 'Triceps'], done: true };

function activity(n: number, over: Partial<ActivityFields>): Activity {
  const c = addActivity({ id: id(n), ownerId: OWNER, fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: null, distanceM: null, effort: 'long', ...over }, source: 'ben', opId: `a${String(n)}`, at: AT });
  if (c.kind !== 'write') throw new Error(c.kind);
  return ActivitySchema.parse(c.next);
}

const longSat = activity(1, {});
const facts = (over: Partial<Parameters<typeof weekFacts>[0]> = {}) =>
  weekFacts({ today: TODAY, nowMs: NOW_MS, tz: TZ, aim: 4, gymDates: new Set(['2026-10-19']), days: [ARMS, CHEST, SHOULDERS, BACK, LEGS], activities: [longSat], ...over });

describe('the week’s facts', () => {
  it('gym days left: aim − done, never more than the open dates (a planned long run takes its day)', () => {
    const f = facts();
    expect(f.monday).toBe('2026-10-19');
    // Thu, Fri, Sun open (Sat is the run).
    expect(f.openDates).toEqual(['2026-10-22', '2026-10-23', '2026-10-25']);
    expect(f.gymDaysDone).toBe(1);
    expect(f.gymDaysLeft).toBe(3);
    expect(f.remaining.map((d) => d.name)).toEqual(['Chest', 'Shoulders', 'Back', 'Legs']);
    expect(f.needsReshape).toBe(true);
  });

  it('a workout today takes today out; runs never count as gym days; with no aim, the open dates', () => {
    expect(facts({ gymDates: new Set(['2026-10-19', TODAY]) }).openDates[0]).toBe('2026-10-23');
    // A done run on Monday is not a gym day.
    const doneMon = activity(2, { status: 'done', date: '2026-10-19', distanceM: 10_000, effort: null });
    expect(facts({ gymDates: new Set(), activities: [doneMon] }).gymDaysDone).toBe(0);
    expect(facts({ aim: null }).gymDaysLeft).toBe(3);
    // Room for every day: no reshape.
    expect(facts({ activities: [], aim: 5 }).needsReshape).toBe(false);
  });

  it('the facts key changes with a workout, an activity or the plan version', () => {
    const k = (over: Partial<Parameters<typeof weekFactsKey>[0]> = {}) => weekFactsKey({ monday: '2026-10-19', basisKey: 'plan:1', workoutIds: [id(9)], activities: [{ id: id(1), version: 1 }], ...over });
    expect(k()).toBe(k());
    expect(k({ workoutIds: [id(9), id(10)] })).not.toBe(k());
    expect(k({ activities: [{ id: id(1), version: 2 }] })).not.toBe(k());
    expect(k({ basisKey: 'plan:2' })).not.toBe(k());
  });
});

describe('code’s suggestion and the coach’s proposal', () => {
  it('merges two upper days of the same kind first, never a leg day', () => {
    expect(mergedName(CHEST, SHOULDERS)).toBe('Push');
    expect(mergedName(BACK, { bodyParts: ['Biceps'] })).toBe('Pull');
    expect(mergedName(CHEST, BACK)).toBe('Upper');
    expect(mergedName(CHEST, LEGS)).toBeNull();
    expect(suggestWeek(facts())).toEqual({ merges: [{ dayIds: [CHEST.id, SHOULDERS.id], name: 'Push' }], skips: [] });
    expect(suggestWeek({ remaining: [LEGS, { ...LEGS, id: id(200) }], gymDaysLeft: 1 })).toEqual({ merges: [], skips: [] });
  });

  it('checks the proposal and builds the before/after list (legs after Saturday’s run)', () => {
    const c = checkWeekProposal({ merges: [{ dayIds: [CHEST.id, SHOULDERS.id], name: 'Push' }], skips: [], message: '' }, facts());
    if (!c.ok) throw new Error(c.failure);
    expect(c.before.map((r) => r.name)).toEqual(['Chest', 'Shoulders', 'Back', 'Legs']);
    // Sat's run: Fri and Sun are no-leg days, so legs is before it (today).
    expect(c.after).toEqual([
      { name: 'Push', note: 'Chest + Shoulders' },
      { name: 'Back', note: null },
      { name: 'Legs', note: 'Before Sat’s run' },
    ]);
    expect(c.merges[0]?.fromNames).toEqual(['Chest', 'Shoulders']);
    // A run on Friday: legs goes last, after it (Sunday).
    const fri = facts({ activities: [activity(3, { date: '2026-10-23' })] });
    const c2 = checkWeekProposal({ merges: [{ dayIds: [CHEST.id, SHOULDERS.id], name: 'Push' }], skips: [], message: '' }, { ...fri, remaining: [LEGS, CHEST, SHOULDERS, BACK] });
    expect(c2.ok && c2.after).toEqual([
      { name: 'Push', note: 'Chest + Shoulders' },
      { name: 'Back', note: null },
      { name: 'Legs', note: 'After Fri’s run' },
    ]);
  });

  it('refuses a day that isn’t left, one used twice, nothing at all, or every day skipped', () => {
    const f = facts();
    expect(checkWeekProposal({ merges: [{ dayIds: [ARMS.id, CHEST.id], name: 'Upper' }], skips: [], message: '' }, f)).toMatchObject({ ok: false });
    expect(checkWeekProposal({ merges: [{ dayIds: [CHEST.id, SHOULDERS.id], name: 'Push' }], skips: [CHEST.id], message: '' }, f)).toMatchObject({ ok: false });
    expect(checkWeekProposal({ merges: [], skips: [], message: '' }, f)).toMatchObject({ ok: false, failure: 'no day is merged or skipped' });
    expect(checkWeekProposal({ merges: [], skips: [CHEST.id, SHOULDERS.id, BACK.id], message: '' }, { ...f, remaining: [CHEST, SHOULDERS, BACK] })).toMatchObject({ ok: false });
    const skip = checkWeekProposal({ merges: [], skips: [SHOULDERS.id], message: '' }, f);
    expect(skip.ok && skip.after.map((r) => r.name)).toEqual(['Chest', 'Back', 'Legs']);
  });
});

// ---------------------------------------------------------------------------
// The merged day

let tid = 0;
const tpl = (setType: SetTemplate['setType'] = 'working', rest = 120): SetTemplate => ({ id: id(5000 + (tid += 1)), setType, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: rest });
const ex = (n: number, exerciseId: string, sets: number, main: boolean, order: number, warmups = 0, group: string | null = null): RoutineExercise => ({
  id: id(4000 + n),
  exerciseId,
  equipmentId: null,
  order,
  supersetGroup: group,
  setTemplates: [...Array.from({ length: warmups }, () => tpl('warmup', 60)), ...Array.from({ length: sets }, () => tpl())],
  restBySetType: {},
  transitionRestS: null,
  progressionRuleId: null,
  main,
});
const BENCH = id(301);
const INCLINE = id(302);
const FLY = id(303);
const OHP = id(304);
const LATERAL = id(305);
const chestDay = [ex(1, BENCH, 4, true, 0, 2), ex(2, INCLINE, 3, false, 1), ex(3, FLY, 3, false, 2, 0, 'A')];
const shoulderDay = [ex(4, OHP, 4, true, 0), ex(5, LATERAL, 4, false, 1, 0, 'A'), ex(6, FLY, 3, false, 2)];
const working = (e: RoutineExercise) => e.setTemplates.filter((t) => t.setType !== 'warmup').length;

describe('the merged day', () => {
  it('main lifts first, an exercise in both once, superset labels apart, new IDs', () => {
    const out = mergedExercises(chestDay, shoulderDay, { minutes: 180, newId: idGen(9000) });
    expect(out.map((e) => e.exerciseId)).toEqual([BENCH, OHP, INCLINE, FLY, LATERAL]);
    expect(out.map((e) => e.order)).toEqual([0, 1, 2, 3, 4]);
    expect(out.find((e) => e.exerciseId === LATERAL)?.supersetGroup).toBe('A2');
    expect(out.every((e) => !chestDay.concat(shoulderDay).some((s) => s.id === e.id))).toBe(true);
    expect(out.map(working)).toEqual([4, 4, 3, 3, 4]);
  });

  it('set counts trimmed to fit the session length: others first, main lifts keep two', () => {
    const out = mergedExercises(chestDay, shoulderDay, { minutes: 45, newId: idGen(9100) });
    expect(routineSeconds(out)).toBeLessThanOrEqual(45 * 60);
    // Warm-ups stay; main lifts keep at least two working sets, others one.
    expect(out[0]?.setTemplates.filter((t) => t.setType === 'warmup')).toHaveLength(2);
    expect(working(out[0] as RoutineExercise)).toBeGreaterThanOrEqual(2);
    expect(out.every((e) => working(e) >= 1)).toBe(true);
    const total = out.reduce((n, e) => n + working(e), 0);
    expect(total).toBeLessThan(18);
    // Others were cut before any main lift.
    // Others come down before any main lift does.
    if (out.slice(2).some((e) => working(e) > 1)) expect(out.slice(0, 2).map(working)).toEqual([4, 4]);
    else expect(out.slice(2).map(working)).toEqual([1, 1, 1]);
    // A very short session: everything at its floor, and no further.
    const tiny = mergedExercises(chestDay, shoulderDay, { minutes: 15, newId: idGen(9200) });
    expect(tiny.map(working)).toEqual([2, 2, 1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// Apply, Undo, expiry

const PROPOSAL: WeekProposal = {
  actionId: id(700),
  weekMonday: '2026-10-19',
  basis: { kind: 'plan', planId: id(800), planVersion: 3 },
  merges: [{ dayIds: [CHEST.id, SHOULDERS.id], name: 'Push', fromNames: ['Chest', 'Shoulders'] }],
  skips: [],
  before: [CHEST, SHOULDERS, BACK, LEGS].map((d) => ({ name: d.name, note: null })),
  after: [
    { name: 'Push', note: 'Chest + Shoulders' },
    { name: 'Back', note: null },
    { name: 'Legs', note: 'Before Sat’s run' },
  ],
  factsKey: 'k1',
};
const merged = [{ routineId: id(900), exercises: mergedExercises(chestDay, shoulderDay, { minutes: 60, newId: idGen(9300) }) }];

function applied() {
  const c = applyWeekPlan({ id: id(600), ownerId: OWNER, proposal: PROPOSAL, monday: '2026-10-19', factsKey: 'k1', current: [], merged, opId: 'apply-1', at: AT });
  if (c.kind !== 'write') throw new Error(c.kind);
  return c;
}

describe('apply, undo and expiry', () => {
  it('Apply writes the week change and the merged day (out of the rotation, marked for its week)', () => {
    const c = applied();
    expect(WeekPlanSchema.parse(c.next)).toMatchObject({ status: 'applied', weekMonday: '2026-10-19', made: [{ routineId: id(900), version: 1 }] });
    const r = RoutineSchema.parse(c.routines[0]?.next);
    expect(r).toMatchObject({ name: 'Push', inRotation: false, source: 'coach', createdForWeek: { weekPlanId: id(600), weekMonday: '2026-10-19' } });
    expect(weekChangeText(c.next)).toBe('This week: Push (Chest + Shoulders), Legs (Before Sat’s run)');
    expect(weekDaysRemoved(c.next)).toBe(1);
  });

  it('stale: the facts changed, another week, or a change already in use; duplicate on the same op', () => {
    expect(applyWeekPlan({ id: id(601), ownerId: OWNER, proposal: PROPOSAL, monday: '2026-10-19', factsKey: 'k2', current: [], merged, opId: 'a', at: AT }).kind).toBe('stale');
    expect(applyWeekPlan({ id: id(601), ownerId: OWNER, proposal: PROPOSAL, monday: '2026-10-26', factsKey: 'k1', current: [], merged, opId: 'a', at: AT }).kind).toBe('stale');
    const first = applied().next;
    expect(applyWeekPlan({ id: id(601), ownerId: OWNER, proposal: PROPOSAL, monday: '2026-10-19', factsKey: 'k1', current: [first], merged, opId: 'apply-1', at: AT }).kind).toBe('duplicate');
    expect(applyWeekPlan({ id: id(601), ownerId: OWNER, proposal: { ...PROPOSAL, actionId: id(701) }, monday: '2026-10-19', factsKey: 'k1', current: [first], merged, opId: 'apply-2', at: AT }).kind).toBe('stale');
  });

  it('Undo: the week as the plan has it, the merged day tombstoned; stale on an old version', () => {
    const c = applied();
    const routine = c.routines[0]?.next as Routine;
    const u = undoWeekPlan(c.next, { expectedVersion: 1, opId: 'undo-1', at: AT, routines: new Map([[routine.id, routine]]) });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next).toMatchObject({ status: 'undone', version: 2 });
    expect(u.routines[0]?.next.deletedAtUtc).toBe(AT.utc);
    expect(undoWeekPlan(u.next, { expectedVersion: 1, opId: 'undo-2', at: AT, routines: new Map() }).kind).toBe('stale');
    expect(undoWeekPlan(u.next, { expectedVersion: 2, opId: 'undo-1', at: AT, routines: new Map() }).kind).toBe('duplicate');
  });

  it('in use this week only: next Monday the plan is as it was (no write)', () => {
    const w = applied().next;
    expect(activeWeekPlan([w], NOW_MS, TZ)?.id).toBe(w.id);
    // Sunday 23:00 still this week; Monday 00:30 not.
    expect(activeWeekPlan([w], localMidnightUtcMs('2026-10-25', TZ) + 23 * 3_600_000, TZ)?.id).toBe(w.id);
    expect(activeWeekPlan([w], localMidnightUtcMs('2026-10-26', TZ) + 30 * 60_000, TZ)).toBeNull();
    // A different plan in use: not this one's.
    expect(activeWeekPlan([w], NOW_MS, TZ, (b) => b.kind === 'plan' && b.planId === id(801))).toBeNull();
  });

  it('this week’s days: the merged day where the first of its days was, skipped days out', () => {
    const days = [CHEST, SHOULDERS, BACK, LEGS];
    const w = applied().next;
    const push = { id: id(900), name: 'Push', bodyParts: [], done: false } as WeekDayInput;
    expect(weekDays(days, (d) => d.id, w, () => push).map((d) => d.name)).toEqual(['Push', 'Back', 'Legs']);
    expect(weekDays(days, (d) => d.id, { merges: [], skips: [{ dayId: BACK.id, name: 'Back' }] }, () => null).map((d) => d.name)).toEqual(['Chest', 'Shoulders', 'Legs']);
    // The merged day's workout gone: both days stay.
    expect(weekDays(days, (d) => d.id, w, () => null).map((d) => d.name)).toEqual(['Chest', 'Shoulders', 'Back', 'Legs']);
    expect(weekDays(days, (d) => d.id, null, () => push)).toEqual(days);
  });
});
