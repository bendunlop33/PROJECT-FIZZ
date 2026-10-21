import { describe, expect, it } from 'vitest';

import { DraftPlanSchema, type Routine } from '@fizz/schemas';
import {
  assembleTodayDraft,
  breakdownUnit,
  buildTodayStrip,
  coachDraftListed,
  defaultTodayControls,
  planDayOfBuilderDraft,
  deriveId,
  fromDraftPlan,
  estimateBuilderMinutes,
  toDraftPlan,
  withSlotRevs,
  lastUsedMainLift,
  otherMainOptions,
  otherSessionDay,
  stepTodayMinutes,
  TODAY_OTHER_SESSIONS,
  todayBreakdown,
  todayFitLine,
  todayMixLine,
  todayPlanDays,
  todayWhy,
  toggleTodayAbs,
  topSetText,
  withTodayControl,
  type BuilderGroupName,
  type BuilderPool,
  type TodayAssembleInput,
  type TodayControls,
  type TodayDay,
  type TodayMixFacts,
} from '../src/index';
import { context, info, lbRack, POOL } from './builder-v3-fixture';

/**
 * Today (v2), workout-builder-v3 §2.0 and the 20 Oct additions: the session
 * card drafted from a plan day's template and the five controls, with the
 * Wave 1 builder rules (fixture: the prototype's exercises and Main Gym).
 */

const CHEST_TEMPLATE = ['bench', 'incline_db', 'cable_fly', 'pushdown', 'crunch'];

const chestDay = (over: Partial<TodayDay['templates'][number]> = {}): TodayDay => ({
  key: 'plan:p1:0',
  kind: 'plan',
  name: 'Chest',
  planId: 'p1',
  dayIndex: 0,
  splitDayId: 'chest',
  templates: [
    {
      routineId: 'r-bench',
      version: 3,
      label: 'Bench',
      mainLiftExerciseId: 'bench',
      exerciseIds: CHEST_TEMPLATE,
      minutes: 60,
      absPlan: true,
      supersetsPlan: true,
      groups: [
        { group: 'Chest', count: 3 },
        { group: 'Triceps', count: 1 },
        { group: 'Abs', count: 1 },
      ],
      ...over,
    },
    {
      routineId: 'r-incline',
      version: 1,
      label: 'Incline',
      mainLiftExerciseId: 'incline_bb',
      exerciseIds: ['incline_bb', 'cable_fly', 'machine_press', 'pushdown'],
      minutes: 60,
      absPlan: false,
      supersetsPlan: true,
      groups: [
        { group: 'Chest', count: 3 },
        { group: 'Triceps', count: 1 },
      ],
    },
  ],
});

/** Today's pool: the template's exercises first, then the fixture's history/catalogue order. */
const poolFor = (day: TodayDay, main: string | null): BuilderPool => {
  const t = day.templates.find((x) => x.mainLiftExerciseId === main) ?? day.templates[0];
  return (g: BuilderGroupName) => [...new Set([...(t?.exerciseIds ?? []).filter((id) => info(id)?.group === g), ...POOL[g]])];
};

const MIX: TodayMixFacts = {
  candidates: (g) => [...POOL[g], ...(g === 'Chest' ? ['pec_deck'] : [])],
  recentCountOnDay: new Map([['cable_fly', 3]]),
  lastTwoOnDay: new Set(['cable_fly', 'incline_db']),
  lastDoneMs: new Map([['crossover', 1000]]),
  availableHere: () => true,
  painFlagged: () => false,
};

function input(controls: Partial<TodayControls> = {}, day = chestDay(), mix: TodayMixFacts = MIX): TodayAssembleInput {
  const c = { ...defaultTodayControls(day, { goal: 'strength' }), ...controls };
  return { day, controls: c, ctx: context(), pool: poolFor(day, c.mainLiftExerciseId), mix };
}

function draft(controls: Partial<TodayControls> = {}, day = chestDay(), mix: TodayMixFacts = MIX) {
  const i = input(controls, day, mix);
  const c = i.controls;
  const d = assembleTodayDraft(i);
  if (d === null) throw new Error('no draft');
  return { d, c };
}

const ids = (d: ReturnType<typeof draft>['d']) => d.workout.blocks.flatMap((b) => b.slots.map((s) => s.exerciseId));
const name = (id: string) => info(id)?.name ?? id;
/** No-break spaces read as spaces (display text keeps numbers with their units). */
const sp = (t: string | null | undefined) => (t ?? '').replaceAll('\u00a0', ' ');

describe('controls → draft (§2.0.2 controls 1–5)', () => {
  it('opens on the template: main lift first, its accessories, abs last, fitted to the plan length', () => {
    const { d, c } = draft();
    expect(c).toMatchObject({ mainLiftExerciseId: 'bench', accessories: 'focused', minutes: 60, abs: null, supersets: true, mix: 0 });
    const list = ids(d);
    expect(list[0]).toBe('bench');
    expect(list).toEqual(expect.arrayContaining(['incline_db', 'cable_fly', 'pushdown', 'crunch']));
    expect(list.at(-1)).toBe('crunch');
    expect(d.minutes).toBeLessThanOrEqual(60);
    expect(d.exerciseCount).toBeLessThanOrEqual(7);
    // Main lift never in a superset; abs never with a heavy lift.
    for (const b of d.workout.blocks) {
      if (b.slots.length < 2) continue;
      expect(b.slots.some((s) => s.main)).toBe(false);
      expect(b.slots.some((s) => info(s.exerciseId)?.heavy === true) && b.slots.some((s) => info(s.exerciseId)?.group === 'Abs')).toBe(false);
    }
    expect(d.advice).toEqual([]);
  });

  it('Main lift chip: Incline uses its own template; Bench back again', () => {
    const { d } = draft({ mainLiftExerciseId: 'incline_bb' });
    expect(d.template.label).toBe('Incline');
    expect(ids(d)[0]).toBe('incline_bb');
    expect(d.absOn).toBe(false);
  });

  it('Accessories: Focused = 2 × 3 sets, Varied = 3 × 2 sets at different angles', () => {
    const chestAcc = (x: ReturnType<typeof draft>['d']) => x.workout.blocks.flatMap((b) => b.slots).filter((s) => !s.main && info(s.exerciseId)?.group === 'Chest');
    const focused = chestAcc(draft({ minutes: 120 }).d);
    expect(focused.length).toBeGreaterThanOrEqual(2);
    const varied = draft({ accessories: 'varied', minutes: 90 }).d;
    const v = chestAcc(varied);
    expect(v.length).toBeGreaterThanOrEqual(3);
    const angles = v.slice(0, 3).map((s) => info(s.exerciseId)?.angle);
    expect(new Set(angles).size).toBe(3);
  });

  it('Time −15: trims only as far as needed, never the main lift; the main lift keeps its sets and loads', () => {
    const base = draft().d;
    const short = draft({ minutes: 45 }).d;
    expect(short.minutes).toBeLessThanOrEqual(45);
    const mainOf = (x: typeof base) => x.workout.blocks.flatMap((b) => b.slots).find((s) => s.main);
    expect(mainOf(short)?.rows).toEqual(mainOf(base)?.rows);
    const line = todayFitLine(short.fit, 45, 60, name);
    expect(sp(line)).toMatch(/^To fit 45 min: /);
  });

  it('Time steps of 5 within 15–180', () => {
    expect(stepTodayMinutes(60, 1)).toBe(65);
    expect(stepTodayMinutes(60, -1)).toBe(55);
    expect(stepTodayMinutes(15, -1)).toBe(15);
    expect(stepTodayMinutes(180, 1)).toBe(180);
  });

  it('Time +: fills beyond the plan (exercises before sets), with a `With N min` line', () => {
    const long = draft({ minutes: 90 }).d;
    const base = draft().d;
    expect(long.exerciseCount + long.workout.blocks.flatMap((b) => b.slots).reduce((n, s) => n + s.rows.length, 0)).toBeGreaterThan(base.exerciseCount + base.workout.blocks.flatMap((b) => b.slots).reduce((n, s) => n + s.rows.length, 0));
    expect(sp(todayFitLine(long.fit, 90, 60, name))).toMatch(/^With 90 min: /);
  });

  it('Abs: off removes the ab exercise; supersets on gives the arm exercise an arm partner (same slot)', () => {
    const day = chestDay();
    const { d, c } = draft({ abs: false });
    expect(ids(d)).not.toContain('crunch');
    const armPair = d.workout.blocks.find((b) => b.slots.some((s) => s.exerciseId === 'pushdown'));
    expect(armPair?.slots.map((s) => info(s.exerciseId)?.group).sort()).toEqual(['Biceps', 'Triceps']);
    // `plan: on` shows while it differs; toggling back clears it.
    const t = day.templates[0];
    if (t === undefined) throw new Error('template');
    expect(toggleTodayAbs(c, t).abs).toBeNull();
  });

  it('Abs off with supersets off: the freed time adds exercises first (a second arm exercise), said once', () => {
    const { d } = draft({ abs: false, supersets: false });
    const arms = ids(d).filter((id) => ['Biceps', 'Triceps'].includes(info(id)?.group ?? ''));
    expect(arms.length).toBeGreaterThanOrEqual(1);
    const line = todayFitLine(d.fit, 60, 60, name);
    if (d.fit.steps.some((s) => s.kind === 'add')) expect(line).toContain('in the time freed');
  });

  it('Abs on for a day the plan has none: added, last', () => {
    const { d } = draft({ mainLiftExerciseId: 'incline_bb', abs: true, minutes: 75 });
    expect(ids(d).at(-1)).toBe('crunch');
  });

  it('Supersets off splits the pairs and the minutes go up', () => {
    const on = draft({ minutes: 120 }).d;
    const off = draft({ minutes: 120, supersets: false }).d;
    expect(off.workout.blocks.every((b) => b.slots.length === 1)).toBe(true);
    expect(on.workout.blocks.some((b) => b.slots.length > 1)).toBe(true);
  });

  it('a main-lift or accessories change resets Mix it up; time does not', () => {
    const c = { ...defaultTodayControls(chestDay()), mix: 2 };
    expect(withTodayControl(c, 'accessories', 'varied').mix).toBe(0);
    expect(withTodayControl(c, 'mainLiftExerciseId', 'incline_bb').mix).toBe(0);
    expect(withTodayControl(c, 'minutes', 45).mix).toBe(2);
  });
});

describe('↻ Mix it up (today only)', () => {
  it('never the main lift; the most-done accessory; shortlist excludes the day’s last two sessions and pain; cycles; Undo = 0', () => {
    const before = draft({ minutes: 90 }).d;
    expect(before.mix).toBeNull();
    expect(before.mixOptions).toBeGreaterThan(0);
    const one = draft({ minutes: 90, mix: 1 }).d;
    expect(one.mix?.fromExerciseId).toBe('cable_fly');
    expect(one.mix?.toExerciseId).not.toBe('incline_db');
    expect(ids(one)).not.toContain('cable_fly');
    expect(ids(one)[0]).toBe('bench');
    // Least recently done first (never done before ever-done).
    const n = one.mix?.n ?? 0;
    expect(n).toBeGreaterThan(1);
    const wrap = draft({ minutes: 90, mix: n + 1 }).d;
    expect(wrap.mix?.toExerciseId).toBe(one.mix?.toExerciseId);
    expect(wrap.mix?.k).toBe(1);
    const line = todayMixLine(one.mix ?? { fromExerciseId: '', toExerciseId: '', k: 0, n: 0 }, name);
    expect(line.text).toBe(`Cable fly → ${name(one.mix?.toExerciseId ?? '')} · today only`);
    expect(line.another).toBe(`Another (1/${String(n)})`);
    expect(line.notReviewed).toBe(true);
    // Pain-flagged options are never offered.
    const pained = draft({ minutes: 90, mix: 1 }, chestDay(), { ...MIX, painFlagged: (id) => id === one.mix?.toExerciseId }).d;
    expect(pained.mix?.toExerciseId).not.toBe(one.mix?.toExerciseId);
    // Undo: mix 0 is the code draft again.
    expect(ids(draft({ minutes: 90, mix: 0 }).d)).toEqual(ids(before));
    // The coach's order (its pick first, from code's shortlist only) decides the first pick; anything else is ignored.
    expect(before.mixFromExerciseId).toBe('cable_fly');
    const coachFirst = [...before.mixShortlist].reverse();
    const coached = assembleTodayDraft({ ...input({ minutes: 90, mix: 1 }), mixOrder: coachFirst });
    expect(coached?.mix?.toExerciseId).toBe(coachFirst[0]);
    const offList = assembleTodayDraft({ ...input({ minutes: 90, mix: 1 }), mixOrder: ['not-on-the-list', ...before.mixShortlist.slice(1)] });
    expect(offList?.mix?.toExerciseId).toBe(one.mix?.toExerciseId);
  });
});

describe('the stored draft (§4.4) and back', () => {
  it('goes through the builder codec: a valid DraftPlan with supersets A/B, per-slot state and revs, Q7 rests; reads back to the same estimate', () => {
    const { d } = draft();
    const plan = withSlotRevs(null, toDraftPlan(d.workout, { info, catalogueIdOf: (id) => `cat-${id}`, checkedOnOf: () => null })).plan;
    // The fixture's exercise IDs and slot keys aren't UUIDs (Ben's rows are); everything else must validate as stored.
    expect(DraftPlanSchema.safeParse({ slots: plan.slots.map((s) => ({ ...s, exerciseId: deriveId(s.exerciseId), slotKey: deriveId(s.slotKey) })) }).error?.issues ?? []).toEqual([]);
    expect(plan.slots[0]?.main).toBe(true);
    expect(plan.slots.every((s) => s.rev === 1 && s.builder !== undefined)).toBe(true);
    expect(plan.slots[0]?.setTemplates.find((t) => t.setType === 'top')?.load?.load).toMatchObject({ unit: 'kg', convention: 'total' });
    const groups = new Set(plan.slots.map((s) => s.supersetGroup).filter((g) => g !== null));
    if (d.workout.blocks.some((b) => b.slots.length > 1)) expect(groups.has('A')).toBe(true);
    const back = fromDraftPlan(plan, d.workout.restLevel);
    expect(estimateBuilderMinutes(back, { info })).toBe(d.minutes);
    expect(back.blocks.map((b) => b.slots.length)).toEqual(d.workout.blocks.map((b) => b.slots.length));
  });
});

describe('Session breakdown rows', () => {
  it('# · Exercise + works · Sets (+N W) · Top set; superset rows a/b', () => {
    const { d } = draft();
    const rows = todayBreakdown(d.workout, info, (id) => (id === 'bench' ? 'Chest, front delts, triceps' : null), breakdownUnit(d.workout, 'kg'));
    expect(rows.every((r) => !r.held)).toBe(true);
    const held = todayBreakdown(d.workout, info, () => null, breakdownUnit(d.workout, 'kg'), (id) => id === 'bench');
    expect(held.find((r) => r.exerciseId === 'bench')).toMatchObject({ held: true });
    expect(held.find((r) => r.exerciseId === 'bench')?.accessibilityLabel).toContain('pain flag, held');
    expect(rows[0]).toMatchObject({ label: '1', name: 'Barbell bench press', works: 'Chest, front delts, triceps', sets: 4 });
    expect(sp(rows[0]?.warmupText)).toMatch(/^\+\d W$/);
    expect(Number(rows[0]?.top)).toBeGreaterThan(0);
    const pair = rows.filter((r) => r.superset !== null);
    if (pair.length > 0) {
      expect(pair[0]?.label).toMatch(/a$/);
      expect(pair[0]?.superset?.first).toBe(true);
    }
    expect(rows[0]?.accessibilityLabel).toContain('Barbell bench press');
  });

  it('per-hand shows `each`; a lb item under a kg header carries its unit', () => {
    const ctx = context({ incline_db: { equipment: lbRack, unit: 'lb', convention: 'per_hand', e1rm: 90 } });
    const day = chestDay();
    const c = defaultTodayControls(day);
    const d = assembleTodayDraft({ day, controls: c, ctx, pool: poolFor(day, 'bench'), mix: MIX });
    const slot = d?.workout.blocks.flatMap((b) => b.slots).find((s) => s.exerciseId === 'incline_db');
    if (slot === undefined) throw new Error('slot');
    expect(slot.unit).toBe('lb');
    expect(sp(topSetText(slot, 'kg'))).toMatch(/ lb each$/);
    expect(sp(topSetText(slot, 'lb'))).toMatch(/^\d+(\.\d+)? each$/);
  });
});

describe('Why? (facts from code; honest review status)', () => {
  it('next day, last session → today’s load, goal, accessories and time; offline says so', () => {
    const lines = todayWhy({ dayName: 'Chest', nextDayName: 'Chest', other: false, last: { dateText: '13 Oct', lift: 'bench', value: '100', reps: 6, rpe: 8 }, mainTarget: '102.5', goal: 'strength', liftTarget: 'bench target 110 kg', accessories: 'focused', minutes: 60, coachReason: null, review: 'offline' });
    expect(lines.map(sp)).toEqual(['Plan: Chest is next', 'Last Chest, 13 Oct: bench 100 × 6 at RPE 8 → 102.5', 'Goal: strength · bench target 110 kg', 'Accessories focused · 60 min', 'Not reviewed · Offline']);
    const picked = todayWhy({ dayName: 'Back', nextDayName: 'Chest', other: false, last: null, mainTarget: null, goal: null, liftTarget: null, accessories: 'varied', minutes: 45, coachReason: null, review: 'not_connected' });
    expect(picked[0]).toBe('Back picked by you; the plan moves on');
    expect(picked.at(-1)).toBe('Not reviewed · Coach not connected');
    // A main lift this gym can't do, and a pain-held one: one short line each, before the controls line.
    const flagged = todayWhy({ dayName: 'Back', nextDayName: 'Back', other: false, last: null, mainTarget: null, goal: null, liftTarget: null, accessories: 'focused', minutes: 45, coachReason: null, review: 'not_reviewed', held: ['Barbell row'], missingHere: 'Deadlift' });
    expect(flagged.map(sp)).toEqual(['Plan: Back is next', 'Deadlift: not at this gym', 'Barbell row: pain flag · held', 'Accessories focused · 45 min', 'Not reviewed']);
    // The coach looked (todayCoachWhy → `reviewed`): its reason when it changed something, else no review line.
    const looked = todayWhy({ dayName: 'Chest', nextDayName: 'Chest', other: false, last: null, mainTarget: null, goal: null, liftTarget: null, accessories: 'focused', minutes: 60, coachReason: null, review: 'reviewed' });
    expect(looked.map(sp)).toEqual(['Plan: Chest is next', 'Accessories focused · 60 min']);
    const spoke = todayWhy({ dayName: 'Chest', nextDayName: 'Chest', other: false, last: null, mainTarget: null, goal: null, liftTarget: null, accessories: 'focused', minutes: 60, coachReason: 'Three hard sessions in a row', review: 'reviewed' });
    expect(spoke.at(-1)).toBe('✦ Coach: Three hard sessions in a row');
  });
});

describe('7-day strip (3 back, today, 3 ahead)', () => {
  it('done ✓, Rest on an empty past day, planned runs dashed with `Planned`, no runs unless logged', () => {
    const cells = buildTodayStrip({
      today: '2026-10-20',
      workouts: [{ sessionId: 's1', localDate: '2026-10-17', title: 'Shoulders' }],
      activities: [
        { activityId: 'a1', localDate: '2026-10-18', kind: 'run', status: 'done', distanceM: 12_000, durationS: 3720, effort: 'easy' },
        { activityId: 'a2', localDate: '2026-10-21', kind: 'run', status: 'planned', distanceM: 8000, durationS: null, effort: null },
      ],
      chosen: 'Chest',
    });
    expect(cells.map((c) => c.weekday)).toEqual(['SAT', 'SUN', 'MON', 'TODAY', 'WED', 'THU', 'FRI']);
    expect(cells[0]?.items[0]).toMatchObject({ kind: 'workout', text: '✓ Shoulders' });
    expect(cells[1]?.items[0]).toMatchObject({ kind: 'activity', text: 'Run 12k', planned: false });
    expect(cells[2]?.items[0]).toMatchObject({ kind: 'rest', text: 'Rest' });
    expect(cells[2]?.weekStart).toBe(true);
    expect(cells[3]?.items[0]).toMatchObject({ kind: 'today', text: 'Chest' });
    expect(cells[4]?.items[0]).toMatchObject({ kind: 'activity', text: 'Run 8k', planned: true });
    expect(cells[4]?.accessibilityLabel).toContain('Planned');
    // No dated plan days: future cells stay empty (never inferred from the rotation).
    expect(cells[5]?.items).toEqual([]);
    const none = buildTodayStrip({ today: '2026-10-20', workouts: [], activities: [], chosen: null });
    expect(none.flatMap((c) => c.items).some((i) => i.kind === 'activity')).toBe(false);
    expect(buildTodayStrip({ today: '2026-10-20', workouts: [], activities: [], chosen: null, todayOnly: true })).toHaveLength(1);
    expect(cells[0]?.listText).toBe('Sat 17 · ✓ Shoulders');
  });
});

describe('plan days, templates per main lift, last used, Other sessions', () => {
  const routine = (id: string, name: string, dayIndex: number, splitDayId: string, main: string, exercises: string[]): Routine =>
    ({
      id,
      ownerId: 'o',
      version: 1,
      createdAtUtc: '2026-10-01T00:00:00.000Z',
      updatedAtUtc: '2026-10-01T00:00:00.000Z',
      name,
      exercises: exercises.map((e, i) => ({ id: `${id}-${String(i)}`, exerciseId: e, equipmentId: null, order: i, supersetGroup: null, setTemplates: [], restBySetType: {}, transitionRestS: null, progressionRuleId: null, ...(e === main ? { main: true } : {}) })),
      createdFromSessionId: null,
      planDay: { planId: 'p1', dayIndex, splitDayId, mainLiftExerciseId: main, minutes: 55 },
    });

  it('one day per (plan, day index) with a chip per main lift, labels from the name; last-used opens', () => {
    const days = todayPlanDays({
      planId: 'p1',
      templates: [routine('r1', 'Chest · bench', 0, 'chest', 'bench', CHEST_TEMPLATE), routine('r2', 'Chest · incline', 0, 'chest', 'incline_bb', ['incline_bb', 'cable_fly']), routine('r3', 'Legs · squat', 1, 'legs', 'squat', ['squat', 'rdl', 'calf'])],
      split: { days: [{ id: 'chest', name: 'Chest' }, { id: 'legs', name: 'Legs' }] },
      info,
      defaultMinutes: 60,
    });
    expect(days.map((d) => [d.name, d.templates.map((t) => t.label)])).toEqual([
      ['Chest', ['Bench', 'Incline']],
      ['Legs', ['Squat']],
    ]);
    const chest = days[0];
    if (chest === undefined) throw new Error('chest');
    expect(chest.templates[0]).toMatchObject({ minutes: 55, absPlan: true, mainLiftExerciseId: 'bench' });
    expect(chest.templates[0]?.groups[0]).toEqual({ group: 'Chest', count: 3 });
    expect(lastUsedMainLift(chest, [{ routineId: null, planDay: { planId: 'p1', dayIndex: 0, splitDayId: 'chest', templateRoutineId: 'r2', mainLiftExerciseId: 'incline_bb', variationId: null } }])).toBe('incline_bb');
    expect(lastUsedMainLift(chest, [])).toBeNull();

    const push = TODAY_OTHER_SESSIONS.find((s) => s.id === 'push');
    if (push === undefined) throw new Error('push');
    const options = otherMainOptions(push, days, info, []);
    expect(options).toEqual([{ id: 'bench', label: 'Bench' }]);
    const pushDay = otherSessionDay(push, options, info, 60);
    expect(pushDay).toMatchObject({ key: 'other:push', kind: 'other', planId: null, dayIndex: null });
    expect(pushDay.templates[0]?.groups[0]?.group).toBe('Chest');
    expect(TODAY_OTHER_SESSIONS.map((s) => s.name)).toEqual(['Full body', 'Upper', 'Push']);
  });
});

describe('Start provenance (§4.2) and the coach list', () => {
  it('a plan-day builder draft starts as its plan day; an Other session has none; builder drafts are never `FROM COACH`', () => {
    const key = { planId: 'p1', dayIndex: 2, splitDayId: 'chest', mainLiftExerciseId: 'bench', localDate: '2026-10-20' };
    const request = { setup: { dayId: 'chest', minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [], templateRoutineId: 'r1', templateVersion: 4, variationId: null } } as never;
    expect(planDayOfBuilderDraft({ builderKey: key }, { request })).toEqual({ planDay: { planId: 'p1', dayIndex: 2, splitDayId: 'chest', mainLiftExerciseId: 'bench', templateRoutineId: 'r1', templateVersion: 4, variationId: null } });
    expect(planDayOfBuilderDraft({ builderKey: { ...key, planId: null, dayIndex: null, splitDayId: 'push' } }, { request })).toEqual({});
    expect(planDayOfBuilderDraft({}, { request })).toEqual({});
    const open = { status: 'open' as const, expiresAtUtc: '2026-11-01T00:00:00.000Z' };
    expect(coachDraftListed(open, '2026-10-20T00:00:00.000Z')).toBe(true);
    expect(coachDraftListed({ ...open, builderKey: key }, '2026-10-20T00:00:00.000Z')).toBe(false);
  });
});
