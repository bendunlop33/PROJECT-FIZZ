import { describe, expect, it } from 'vitest';

import {
  PlanDraftSchema,
  RoutineSchema,
  type EquipmentInstance,
  type Exercise,
  type Load,
  type PainFlag,
  type PlanDraft,
  type PlanDraftVersion,
  type ProposePlanArgs,
  type ProposedExercise,
  type ProposedPlanDay,
  type Routine,
  type SplitDay,
} from '@fizz/schemas';

import {
  addPlanVersion,
  applyPlan,
  checkPlanProposal,
  currentPlanVersion,
  doableHere,
  expirePlanDraft,
  isInRotation,
  loadReferences,
  newPlanDraft,
  painHoldFor,
  planDayLines,
  planDayRows,
  planFirstLoads,
  planIsOpen,
  planLeftOut,
  planRoutineForSplitDay,
  planRoutines,
  planRoutineStart,
  planUpNext,
  rotationRoutines,
  endPlan,
  activePause,
  autoResumeDue,
  pausePlan,
  pinPlanDay,
  resumePlan,
  undoPlanControl,
  undoEndPlan,
  undoPlanApply,
  pausedDates,
  planInUseUntilUtc,
  localMidnightUtcMs,
  toIso,
  toMs,
  type FinishedRef,
  type HistorySession,
  type PlanProposalContext,
  type SubstituteContext,
  type WorkoutProposalContext,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, kg, OWNER, profile, stack, TZ } from './fixtures';

/**
 * Coach-built multi-day plans (Ben, 19 Oct): every day checked as a
 * workout draft, days mapped to split days, Apply (replace or add) and its
 * Undo (rule 2, rule 3, rule 5: duplicate op IDs, stale versions), Up next
 * through the plan, and a day's first workout taking the plan's checked
 * loads (kg/lb, per-hand dumbbells, an equipment max, an assisted machine,
 * pain held).
 */

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

const HOTEL = id(3);
const IMPERIAL = id(4);
const bar = barbell({ id: id(700), gymId: GYM, plates: [{ mass: 25, count: 4 }, { mass: 20, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const rack = dumbbells({ id: id(701), gymId: GYM, loads: steps(2.5, 30, 2.5) });
const cable = stack({ id: id(702), gymId: GYM, name: 'Cable station', stackLoads: steps(2.5, 100, 2.5) });
const assist = assisted({ id: id(703), gymId: GYM });
const hotelRack = dumbbells({ id: id(710), gymId: HOTEL, name: 'Hotel dumbbells', loads: steps(2.5, 20, 2.5) });
const lbRack = dumbbells({ id: id(711), gymId: IMPERIAL, name: 'Imperial dumbbells', unit: 'lb', loads: steps(5, 100, 5) });
const MAIN_GYM = { id: GYM, name: 'Main gym', equipment: [bar, rack, cable, assist] };
const HOTEL_GYM = { id: HOTEL, name: 'Hotel gym', equipment: [hotelRack] };
const LB_GYM = { id: IMPERIAL, name: 'Imperial gym', equipment: [lbRack] };
const KNOWN = new Map<string, EquipmentInstance>([bar, rack, cable, assist, hotelRack, lbRack].map((e) => [e.id, e]));

const ex = (n: number, name: string, key: string, over: Partial<Exercise>): Exercise => exercise(n, name, { catalogueKey: key, ...over });
const BENCH = ex(210, 'Bench press', 'barbell-bench-press', { movementPattern: 'horizontal_push', mechanic: 'compound', primaryMuscles: ['chest'] });
const INCLINE = ex(211, 'Incline DB press', 'dumbbell-incline-press', { movementPattern: 'horizontal_push', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound', primaryMuscles: ['chest'] });
const PUSHDOWN = ex(214, 'Triceps pushdown', 'cable-triceps-pushdown', { movementPattern: 'elbow_extension', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation', primaryMuscles: ['triceps'] });
const OHP = ex(215, 'Overhead press', 'barbell-overhead-press', { movementPattern: 'vertical_push', mechanic: 'compound', primaryMuscles: ['shoulders'] });
const PULLUP = ex(218, 'Assisted pull-up', 'assisted-pull-up', { movementPattern: 'vertical_pull', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', mechanic: 'compound', primaryMuscles: ['lats'] });
const ROW = ex(219, 'Cable row', 'cable-row', { movementPattern: 'horizontal_pull', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'compound', primaryMuscles: ['upper back'] });
const SQUAT = ex(220, 'Back squat', 'barbell-back-squat', { movementPattern: 'squat', mechanic: 'compound', primaryMuscles: ['quads'] });
const CURL = ex(221, 'DB curl', 'dumbbell-curl', { movementPattern: 'elbow_flexion', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation', primaryMuscles: ['biceps'] });
const ALL = [BENCH, INCLINE, PUSHDOWN, OHP, PULLUP, ROW, SQUAT, CURL];
const BY_KEY = new Map(ALL.map((e) => [e.catalogueKey ?? '', e]));
const EXERCISES = new Map(ALL.map((e) => [e.id, e]));

const SPLIT: SplitDay[] = [
  { id: 'push', name: 'Push', bodyParts: ['Chest', 'Shoulders', 'Triceps'] },
  { id: 'pull', name: 'Pull', bodyParts: ['Back', 'Biceps'] },
  { id: 'legs', name: 'Legs', bodyParts: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
];

function session(n: number, daysAgo: number, eq: EquipmentInstance | null, sets: { load: Load; reps: number; rpe?: number }[]): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: eq?.id ?? null,
    gymId: GYM,
    imported: false,
    sets: sets.map((s) => ({ setType: 'working' as const, side: null, load: s.load, reps: s.reps, rpe: s.rpe ?? null, rir: null })),
    tz: TZ,
  };
}

const HISTORIES = new Map<string, HistorySession[]>([
  [BENCH.id, [session(900, 2, bar, [{ load: kg(100), reps: 7, rpe: 8 }, { load: kg(100), reps: 7, rpe: 8 }])]],
  [INCLINE.id, [session(901, 2, rack, [{ load: kg(27.5, 'per_hand'), reps: 9, rpe: 8 }])]],
  [PULLUP.id, [session(902, 4, assist, [{ load: kg(30, 'assistance'), reps: 8, rpe: 8 }])]],
  [ROW.id, [session(903, 4, cable, [{ load: kg(60, 'stack'), reps: 10, rpe: 8 }])]],
  [SQUAT.id, [session(904, 5, bar, [{ load: kg(120), reps: 6, rpe: 8 }])]],
  [OHP.id, [session(905, 3, bar, [{ load: kg(50), reps: 8, rpe: 8 }])]],
]);

const SHOULDER: PainFlag = {
  id: id(950),
  ownerId: OWNER,
  version: 1,
  createdAtUtc: at(-2 * 86_400).utc,
  updatedAtUtc: at(-2 * 86_400).utc,
  exerciseId: OHP.id,
  exerciseName: 'Overhead press',
  area: 'shoulder',
  source: 'workout',
  checkInId: null,
  reportedAt: { utc: at(-2 * 86_400).utc, tz: TZ },
  status: 'active',
  clearedAtUtc: null,
  createdByOpId: 'flag-1',
};

const subCtx = (gym: typeof MAIN_GYM, over: Partial<SubstituteContext> = {}): SubstituteContext => ({ ownerId: OWNER, unit: 'kg', gym, knownEquipment: KNOWN, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(0), ...over });

function dayCtx(dayIndex: number, flags: PainFlag[] = []): WorkoutProposalContext {
  const sub = subCtx(MAIN_GYM, { painFlags: flags });
  const nowMs = Date.parse(at(0).utc);
  return {
    exerciseFor: (key) => BY_KEY.get(key) ?? null,
    usable: (e) => doableHere(e, MAIN_GYM),
    substituteFor: () => null,
    painFlags: flags,
    nowMs,
    tz: TZ,
    restPresetsS: [60, 90, 120, 150, 180],
    ruleReps: () => null,
    previous: null,
    newSlotKey: (exerciseId, i) => `00000000-0000-4000-9${String(dayIndex)}${String(i).padStart(2, '0')}-${exerciseId.slice(-12)}`,
    loads: {
      refsFor: (e) => loadReferences({ exercise: e, history: HISTORIES.get(e.id) ?? [], ctx: sub, nowMs }),
      painFor: (e) => painHoldFor(e.id, flags, sub.sessionPain, nowMs, TZ),
      askedHeavier: false,
    },
  };
}

function planCtx(flags: PainFlag[] = [], over: Partial<PlanProposalContext> = {}): PlanProposalContext {
  return { splitDays: SPLIT, dayContext: (i) => dayCtx(i, flags), minutesFor: (d) => d.minutes ?? 60, ...over };
}

const load = (value: number, unit: 'kg' | 'lb', convention: Exclude<Load['convention'], 'bodyweight'>): NonNullable<ProposedExercise['load']> => ({ value, unit, convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const pex = (catalogueId: string, over: Partial<ProposedExercise> = {}): ProposedExercise => ({
  catalogueId,
  warmups: null,
  workingSets: 3,
  reps: { min: 8, max: 10 },
  workSeconds: null,
  targetRpe: 8,
  topSet: null,
  restSeconds: null,
  superset: null,
  load: null,
  ...over,
});
const day = (dayName: string, splitDayId: string | null, exercises: ProposedExercise[], over: Partial<ProposedPlanDay> = {}): ProposedPlanDay => ({ dayName, splitDayId, focus: null, minutes: null, exercises, ...over });

/** "Build me a 4-day plan": Push, Pull, Legs and an upper day that isn't a split day. */
const FOUR: ProposePlanArgs = {
  message: 'Push, pull, legs, then an upper day.',
  days: [
    day('Push', 'push', [pex('barbell-bench-press', { reps: { min: 6, max: 8 }, load: load(102.5, 'kg', 'total') }), pex('dumbbell-incline-press', { load: load(27.5, 'kg', 'per_hand') }), pex('cable-triceps-pushdown')]),
    day('Pull', 'pull', [pex('assisted-pull-up', { load: load(27.5, 'kg', 'assistance') }), pex('cable-row', { load: load(60, 'kg', 'stack') }), pex('dumbbell-curl')]),
    day('Legs', 'legs', [pex('barbell-back-squat', { reps: { min: 5, max: 6 }, load: load(122.5, 'kg', 'total') })]),
    day('Upper', null, [pex('dumbbell-incline-press', { load: load(27.5, 'kg', 'per_hand') }), pex('cable-row', { load: load(60, 'kg', 'stack') })], { minutes: 45 }),
  ],
};

function versionOf(days: PlanDraftVersion['days'], over: Partial<PlanDraftVersion> = {}): PlanDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(960),
    turnId: 'turn-1',
    request: { text: 'build me a 4-day plan', gymId: GYM, origin: 'text' },
    rawArgs: '{}',
    days,
    checks: [],
    rationale: null,
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    createdAt: at(-60),
    ...over,
  };
}

function planOf(a: ProposePlanArgs = FOUR): PlanDraft {
  const r = checkPlanProposal(a, planCtx());
  if (r.status === 'unusable') throw new Error('unusable');
  const p = newPlanDraft({ id: id(970), ownerId: OWNER, version: versionOf(r.days, { checks: r.checks }), opId: 'plan-1', at: at(-60) });
  expect(PlanDraftSchema.safeParse(p).success).toBe(true);
  return p;
}

function oldRoutine(n: number, name: string, inRotation: boolean, rotationAtUtc: string): Routine {
  return RoutineSchema.parse({
    id: id(n),
    ownerId: OWNER,
    version: 3,
    createdAtUtc: at(-90 * 86_400).utc,
    updatedAtUtc: at(-30 * 86_400).utc,
    name,
    exercises: [{ id: id(n + 1), exerciseId: BENCH.id, equipmentId: null, order: 0, supersetGroup: null, setTemplates: [{ id: id(n + 2), setType: 'working', targetLoad: null, targetReps: { min: 6, max: 8 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null }], restBySetType: {}, transitionRestS: null, progressionRuleId: null }],
    source: 'ben',
    inRotation,
    rotationAtUtc,
  });
}

const PUSH_A = oldRoutine(600, 'Push A', true, at(-80 * 86_400).utc);
const PULL_A = oldRoutine(610, 'Pull A', true, at(-79 * 86_400).utc);
const ARMS = oldRoutine(620, 'Arms', false, at(-78 * 86_400).utc);

// ---------------------------------------------------------------------------

describe('checkPlanProposal: every day checked as a workout draft', () => {
  it('maps days to Ben’s split days by ID and names them as the split day; a day that isn’t one keeps the coach’s name', () => {
    const r = checkPlanProposal({ ...FOUR, days: FOUR.days.map((d, i) => (i === 0 ? { ...d, dayName: 'Chest & tris' } : d)) }, planCtx());
    expect(r.status).toBe('ok');
    expect(r.days.map((d) => [d.name, d.splitDayId, d.focus, d.minutes])).toEqual([
      ['Push', 'push', 'split_day', 60],
      ['Pull', 'pull', 'split_day', 60],
      ['Legs', 'legs', 'split_day', 60],
      ['Upper', null, 'coach_picks', 45],
    ]);
    expect(r.checks.map((c) => c.text)).toEqual(['Chest & tris named Push · your split day']);
  });

  it('checks each day’s loads like a draft: kg total, per-hand dumbbells, a stack, an assisted machine', () => {
    const r = checkPlanProposal(FOUR, planCtx());
    if (r.status === 'unusable') throw new Error('unusable');
    const loadOf = (d: number, s: number) => r.days[d]?.plan.slots[s]?.setTemplates.find((t) => t.setType !== 'warmup')?.load?.load ?? null;
    expect(loadOf(0, 0)).toEqual({ value: 102.5, unit: 'kg', convention: 'total' });
    expect(loadOf(0, 1)).toEqual({ value: 27.5, unit: 'kg', convention: 'per_hand' });
    // The assisted stack has 5 kg steps: 27.5 kg assistance fits toward easier (more assistance), never harder.
    expect(loadOf(1, 0)).toEqual({ value: 30, unit: 'kg', convention: 'assistance' });
    expect(loadOf(1, 1)).toEqual({ value: 60, unit: 'kg', convention: 'stack' });
    // Slot keys are per day, so the same exercise on two days is two slots.
    const keys = r.days.flatMap((d) => d.plan.slots.map((s) => s.slotKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a pain-flagged movement is left out of its day (rule 9); a day with nothing usable is left out with a line', () => {
    const a: ProposePlanArgs = { ...FOUR, days: [day('Push', 'push', [pex('barbell-overhead-press'), pex('barbell-bench-press')]), day('Shoulders', null, [pex('barbell-overhead-press')]), day('Legs', 'legs', [pex('barbell-back-squat')])] };
    const r = checkPlanProposal(a, planCtx([SHOULDER]));
    expect(r.status).toBe('partial');
    expect(r.days.map((d) => d.name)).toEqual(['Push', 'Legs']);
    expect(r.days.map((d) => d.index)).toEqual([0, 1]);
    expect(r.days[0]?.checks.find((c) => c.leftOut)?.text).toMatch(/^Overhead press left out · shoulder flagged/);
    expect(r.checks.map((c) => c.text)).toEqual(['Shoulders left out · nothing usable here']);
    expect(planLeftOut(versionOf(r.days, { checks: r.checks }))).toEqual({ exercises: 1, days: 1 });
  });

  it('nothing usable at all is unusable; an unknown split day is dropped; a split day twice is Push and Push 2', () => {
    expect(checkPlanProposal({ ...FOUR, days: [day('X', null, [pex('nope')])] }, planCtx()).status).toBe('unusable');
    const r = checkPlanProposal({ ...FOUR, days: [day('Push', 'push', [pex('barbell-bench-press')]), day('Arms', 'arms', [pex('dumbbell-curl')]), day('Push', 'push', [pex('dumbbell-incline-press')])] }, planCtx());
    expect(r.days.map((d) => [d.name, d.splitDayId])).toEqual([
      ['Push', 'push'],
      ['Arms', null],
      ['Push 2', 'push'],
    ]);
    expect(r.checks.map((c) => c.kind)).toEqual(['split_unknown', 'split_repeated']);
  });

  it('each day gets its own checks context (its split day, for its main lift) and its own length', () => {
    const seen: (string | null)[] = [];
    const r = checkPlanProposal(FOUR, planCtx([], { dayContext: (i, s) => (seen.push(s?.id ?? null), dayCtx(i)), minutesFor: (d) => d.minutes ?? 75 }));
    expect(seen).toEqual(['push', 'pull', 'legs', null]);
    expect(r.days.map((d) => d.minutes)).toEqual([75, 75, 75, 45]);
  });

  it('notes two days in a row mostly on the same muscles (behind Why?)', () => {
    const r = checkPlanProposal({ ...FOUR, days: [day('Push', 'push', [pex('barbell-bench-press')]), day('Chest', null, [pex('dumbbell-incline-press')])] }, planCtx([], { topGroupOf: () => 'Chest' }));
    expect(r.checks).toEqual([{ kind: 'same_muscles_in_a_row', dayIndex: 1, text: 'Push and Chest both mostly Chest' }]);
  });

  it('the card lines: name, exercises, working sets, minutes', () => {
    const p = planOf();
    expect(planDayLines(currentPlanVersion(p))).toEqual([
      { index: 0, name: 'Push', exercises: 3, workingSets: 9, minutes: 60, leftOut: 0 },
      { index: 1, name: 'Pull', exercises: 3, workingSets: 9, minutes: 60, leftOut: 0 },
      { index: 2, name: 'Legs', exercises: 1, workingSets: 3, minutes: 60, leftOut: 0 },
      { index: 3, name: 'Upper', exercises: 2, workingSets: 6, minutes: 45, leftOut: 0 },
    ]);
    expect(p.name).toBe('4-day plan');
  });

  it('a day’s rows show the checked loads with their convention, est. and held marks', () => {
    const r = checkPlanProposal({ ...FOUR, days: [day('Push', 'push', [pex('barbell-bench-press', { load: load(120, 'kg', 'total') }), pex('dumbbell-incline-press', { load: load(27.5, 'kg', 'per_hand') }), pex('cable-triceps-pushdown')]), day('Pull', 'pull', [pex('assisted-pull-up', { load: load(30, 'kg', 'assistance') })])] }, planCtx());
    const rows = r.days.map((d) => planDayRows(d, (eid) => EXERCISES.get(eid) ?? null).map((x) => [x.name, x.scheme.replace(/\s/g, ' '), x.load.replace(/\s/g, ' '), x.estimate, x.main]));
    expect(rows).toEqual([
      [
        // 120 for 8–10 reps is more than 20% above what 100 × 7 @8 backs (Ben 19 Oct): the check caps it (rule 6).
        ['Bench press', '3 × 8–10', '115 kg', false, true],
        ['Incline DB press', '3 × 8–10', '27.5 kg each', false, true],
        ['Triceps pushdown', '3 × 8–10', '—', false, false],
      ],
      [['Assisted pull-up', '3 × 8–10', 'Assist 30 kg', false, true]],
    ]);
  });
});

describe('the plan’s lifecycle (rule 5)', () => {
  it('a new version is current; a duplicate op ID writes nothing; an older version is stale; past 14 days it is closed and expires', () => {
    const p = planOf();
    const v2 = versionOf(currentPlanVersion(p).days.slice(0, 3));
    const c = addPlanVersion(p, { version: v2, expectedVersion: 1, opId: 'plan-2', at: at(0) });
    if (c.kind !== 'write') throw new Error(c.kind);
    expect(c.next).toMatchObject({ currentVersion: 2, version: 2, name: '3-day plan' });
    expect(c.next.versions.map((v) => v.status)).toEqual(['replaced', 'current']);
    expect(PlanDraftSchema.safeParse(c.next).success).toBe(true);
    expect(addPlanVersion(c.next, { version: v2, expectedVersion: 2, opId: 'plan-2', at: at(0) }).kind).toBe('duplicate');
    expect(addPlanVersion(c.next, { version: v2, expectedVersion: 1, opId: 'plan-3', at: at(0) }).kind).toBe('stale');
    const late = at(15 * 86_400);
    expect(planIsOpen(p, late.utc)).toBe(false);
    expect(addPlanVersion(p, { version: v2, expectedVersion: 1, opId: 'plan-4', at: late }).kind).toBe('closed');
    expect(expirePlanDraft(p, late.utc)).toMatchObject({ status: 'expired', version: 2 });
    expect(expirePlanDraft(p, at(0).utc)).toBeNull();
  });
});

describe('Apply and Undo (rule 2, rule 3, rule 5)', () => {
  const live = [PUSH_A, PULL_A, ARMS];

  it('Replace my workouts: each day a saved workout in the rotation in day order; the others leave the rotation (kept in Workouts)', () => {
    const p = planOf();
    const c = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live });
    if (c.kind !== 'write') throw new Error(c.kind);
    expect(c.create.map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    for (const r of c.create) expect(RoutineSchema.safeParse(r).success).toBe(true);
    expect(c.create.every((r) => r.source === 'coach' && r.inRotation === true && r.createdFromPlan?.planId === p.id)).toBe(true);
    // Auto loads (the first workout takes the plan's checked loads; then next-time targets).
    expect(c.create.flatMap((r) => r.exercises.flatMap((e) => e.setTemplates.map((t) => t.targetLoad)))).toEqual(expect.arrayContaining([null]));
    expect(c.create.flatMap((r) => r.exercises.flatMap((e) => e.setTemplates)).every((t) => t.targetLoad === null)).toBe(true);
    // The coach's target RPE and reps stay; the item the loads were checked on is the row's.
    expect(c.create[0]?.exercises[0]).toMatchObject({ exerciseId: BENCH.id, equipmentId: bar.id, main: true });
    expect(c.create[0]?.exercises[0]?.setTemplates.find((t) => t.setType !== 'warmup')).toMatchObject({ targetReps: { min: 6, max: 8 }, targetRpe: 8 });
    // Its warm-ups are the planner's (WU4 for the main lift's 6 reps: bar, 40 / 60 / 80 %), reps only: Start plans their loads.
    expect(c.create[0]?.exercises[0]?.setTemplates.filter((t) => t.setType === 'warmup').map((t) => [t.targetReps?.min, t.targetLoad])).toEqual([[5, null], [5, null], [3, null], [2, null]]);
    expect(c.update.map((u) => [u.next.name, u.next.inRotation, u.expectedVersion])).toEqual([
      ['Push A', false, 3],
      ['Pull A', false, 3],
    ]);
    expect(c.next).toMatchObject({ status: 'applied', version: 2, applied: { mode: 'replace', versionN: 1, opId: 'apply-1' } });
    expect(c.next.applied?.rotationOff.map((o) => [o.name, o.rotationAtUtc, o.versionBefore, o.versionAfter])).toEqual([
      ['Push A', PUSH_A.rotationAtUtc, 3, 4],
      ['Pull A', PULL_A.rotationAtUtc, 3, 4],
    ]);
    expect(PlanDraftSchema.safeParse(c.next).success).toBe(true);
    // The rotation is now the plan's days, in day order.
    const after = [...c.create, ...c.update.map((u) => u.next), ARMS];
    expect(rotationRoutines(after).map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
  });

  it('Add alongside: the plan’s days join the rotation after what is already in it; nothing else changes', () => {
    const c = applyPlan(planOf(), { expectedVersion: 1, versionN: 1, mode: 'add', opId: 'apply-1', at: at(0), live });
    if (c.kind !== 'write') throw new Error(c.kind);
    expect(c.update).toEqual([]);
    expect(rotationRoutines([...live, ...c.create]).map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Push', 'Pull', 'Legs', 'Upper']);
  });

  it('a retried Apply is a duplicate with the same workout IDs; an older card (version or plan version) is stale; an applied plan can’t be applied again', () => {
    const p = planOf();
    const a = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live });
    const b = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(5), live });
    if (a.kind !== 'write' || b.kind !== 'write') throw new Error('write');
    expect(b.create.map((r) => r.id)).toEqual(a.create.map((r) => r.id));
    expect(applyPlan(a.next, { expectedVersion: 2, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(5), live }).kind).toBe('duplicate');
    expect(applyPlan(a.next, { expectedVersion: 2, versionN: 1, mode: 'replace', opId: 'apply-2', at: at(5), live }).kind).toBe('stale');
    expect(applyPlan(p, { expectedVersion: 0, versionN: 1, mode: 'replace', opId: 'apply-3', at: at(5), live }).kind).toBe('stale');
    const v2 = addPlanVersion(p, { version: versionOf(currentPlanVersion(p).days.slice(0, 2)), expectedVersion: 1, opId: 'plan-2', at: at(0) });
    if (v2.kind !== 'write') throw new Error(v2.kind);
    // The card showed version 1; the plan is on version 2 now: nothing applies (rule 5).
    expect(applyPlan(v2.next, { expectedVersion: 2, versionN: 1, mode: 'replace', opId: 'apply-4', at: at(5), live }).kind).toBe('stale');
    expect(applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-5', at: at(15 * 86_400), live }).kind).toBe('closed');
  });

  it('Undo deletes the plan’s workouts and puts the others back in their places; the plan is open again', () => {
    const p = planOf();
    const a = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live });
    if (a.kind !== 'write') throw new Error(a.kind);
    const now = new Map<string, Routine | null>([...a.create, ...a.update.map((u) => u.next), ARMS].map((r) => [r.id, r]));
    const u = undoPlanApply(a.next, { expectedVersion: 2, opId: 'undo-1', at: at(60), routines: now });
    if (u.kind !== 'write') throw new Error(u.kind);
    const back = new Map(now);
    for (const x of u.update) back.set(x.next.id, x.next);
    const all = [...back.values()].filter((r): r is Routine => r !== null);
    expect(rotationRoutines(all).map((r) => [r.name, r.rotationAtUtc])).toEqual([
      ['Push A', PUSH_A.rotationAtUtc],
      ['Pull A', PULL_A.rotationAtUtc],
    ]);
    expect(a.create.every((r) => back.get(r.id)?.deletedAtUtc === at(60).utc)).toBe(true);
    expect(isInRotation(back.get(ARMS.id) as Routine)).toBe(false);
    expect(u.next).toMatchObject({ status: 'open', applied: null, undoneAtUtc: at(60).utc, version: 3 });
    expect(PlanDraftSchema.safeParse(u.next).success).toBe(true);
    // Retried: a duplicate. An Undo from an older card: stale.
    expect(undoPlanApply(u.next, { expectedVersion: 3, opId: 'undo-1', at: at(61), routines: back }).kind).toBe('duplicate');
    expect(undoPlanApply(u.next, { expectedVersion: 3, opId: 'undo-2', at: at(61), routines: back }).kind).toBe('stale');
    // Open again: Apply can run again (a new op ID).
    expect(applyPlan(u.next, { expectedVersion: 3, versionN: 1, mode: 'add', opId: 'apply-2', at: at(70), live: all }).kind).toBe('write');
  });

  it('a second plan’s Apply ends the first (superseded, no Undo of its own); the second’s Undo puts the first back as the plan in use (review S3)', () => {
    const first = planOf();
    const a = applyPlan(first, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-a', at: at(0), live });
    if (a.kind !== 'write') throw new Error(a.kind);
    const routinesA = [...a.create, ...a.update.map((u) => u.next), ARMS];
    const second = { ...planOf(), id: id(971) };
    const b = applyPlan(second, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-b', at: at(60), live: routinesA, applied: [a.next] });
    if (b.kind !== 'write') throw new Error(b.kind);
    // The first plan's days leave the rotation (Replace); the first plan is ended, naming the plan that ended it.
    expect(b.update.map((u) => u.next.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(b.supersede).toHaveLength(1);
    const ended = b.supersede[0]?.next as PlanDraft;
    expect(ended).toMatchObject({ id: first.id, status: 'superseded', supersededBy: { planId: second.id, opId: 'apply-b' }, version: 3 });
    expect(b.supersede[0]?.expectedVersion).toBe(2);
    expect(PlanDraftSchema.safeParse(ended).success).toBe(true);
    expect(b.next.applied?.superseded).toEqual([{ planId: first.id, versionAfter: 3 }]);
    expect(PlanDraftSchema.safeParse(b.next).success).toBe(true);
    // The first plan is no longer in use: no days for Up next, and its Undo is stale (never "changed since").
    expect(planRoutines(ended, [...b.create, ...b.update.map((u) => u.next)])).toEqual([]);
    const routinesB = new Map<string, Routine | null>([...b.create, ...b.update.map((u) => u.next), ARMS, ...a.update.map((u) => u.next)].map((r) => [r.id, r]));
    expect(undoPlanApply(ended, { expectedVersion: 3, opId: 'undo-a', at: at(90), routines: routinesB }).kind).toBe('stale');
    // The second plan's Undo: its days gone, the first plan's days back in the rotation, the first plan applied again.
    const u = undoPlanApply(b.next, { expectedVersion: 2, opId: 'undo-b', at: at(90), routines: routinesB, plans: new Map([[first.id, ended]]) });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.restore).toHaveLength(1);
    expect(u.restore[0]?.next).toMatchObject({ id: first.id, status: 'applied', supersededBy: null, version: 4 });
    expect(PlanDraftSchema.safeParse(u.restore[0]?.next).success).toBe(true);
    const back = new Map(routinesB);
    for (const x of u.update) back.set(x.next.id, x.next);
    expect(rotationRoutines([...back.values()].filter((r): r is Routine => r !== null)).map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(planRoutines(u.restore[0]?.next ?? null, [...back.values()].filter((r): r is Routine => r !== null)).map((r) => r.id)).toEqual(a.create.map((r) => r.id));
    // A first plan changed since (not as this Apply left it) isn't touched.
    const moved = undoPlanApply(b.next, { expectedVersion: 2, opId: 'undo-b2', at: at(90), routines: routinesB, plans: new Map([[first.id, { ...ended, version: 9 }]]) });
    expect(moved.kind === 'write' ? moved.restore : null).toEqual([]);
  });

  it('Undo refuses (nothing changes) when Ben changed a plan workout or a workout Apply took out since; one he deleted stays deleted', () => {
    const p = planOf();
    const a = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live });
    if (a.kind !== 'write') throw new Error(a.kind);
    const [push, pull] = a.create;
    if (push === undefined || pull === undefined) throw new Error('days');
    const edited: Routine = { ...push, version: 2, name: 'Push heavy' };
    const now = new Map<string, Routine | null>([...a.create, ...a.update.map((x) => x.next)].map((r) => [r.id, r]));
    now.set(push.id, edited);
    const u = undoPlanApply(a.next, { expectedVersion: 2, opId: 'undo-1', at: at(60), routines: now });
    expect(u).toMatchObject({ kind: 'changed_since', names: ['Push heavy'] });
    now.set(push.id, push);
    now.set(pull.id, { ...pull, version: 2, deletedAtUtc: at(30).utc });
    const ok = undoPlanApply(a.next, { expectedVersion: 2, opId: 'undo-2', at: at(60), routines: now });
    if (ok.kind !== 'write') throw new Error(ok.kind);
    expect(ok.update.some((x) => x.next.id === pull.id)).toBe(false);
  });
});

describe('End plan and its Undo (Ben, 19 Oct: Library › Your plan; rule 2, rule 5)', () => {
  const live = [PUSH_A, PULL_A, ARMS];
  function applied() {
    const a = applyPlan(planOf(), { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live });
    if (a.kind !== 'write') throw new Error(a.kind);
    const routines = new Map<string, Routine | null>([...a.create, ...a.update.map((u) => u.next), ARMS].map((r) => [r.id, r]));
    return { a, routines };
  }
  const withUpdates = (m: ReadonlyMap<string, Routine | null>, update: readonly { next: Routine }[]) => {
    const out = new Map(m);
    for (const u of update) out.set(u.next.id, u.next);
    return out;
  };
  const inRotation = (m: ReadonlyMap<string, Routine | null>) => rotationRoutines([...m.values()].filter((r): r is Routine => r !== null)).map((r) => r.name);

  // Review plan-adapt B1: a pause running when the plan stops being in use ends with it, and its Undo reopens it.
  it('End while paused closes the pause (later weeks are judged again); Undo of End reopens it', () => {
    const { a, routines } = applied();
    const p = pausePlan(a.next, { expectedVersion: 2, opId: 'pause-1', at: at(10), untilDate: null, tz: TZ });
    if (p.kind !== 'write') throw new Error(p.kind);
    const e = endPlan(p.next, { expectedVersion: 3, opId: 'end-1', at: at(4 * 86_400), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    expect(e.next.pauses?.at(-1)).toMatchObject({ opId: 'pause-1', endedAtUtc: at(4 * 86_400).utc, endedBy: 'end' });
    expect(PlanDraftSchema.safeParse(e.next).success).toBe(true);
    // Paused days stop at End: the weeks after aren't paused.
    expect(pausedDates(e.next.pauses, '2026-10-05', '2026-11-30', TZ).size).toBe(4);
    // Even an open pause stored on an ended plan stops at End (the backstop).
    const open = (e.next.pauses ?? []).map((x) => ({ ...x, endedAtUtc: null, endedBy: null }));
    expect(pausedDates(open, '2026-10-05', '2026-11-30', TZ, planInUseUntilUtc(e.next)).size).toBe(4);
    const after = new Map(routines);
    for (const u of e.update) after.set(u.next.id, u.next);
    const u = undoEndPlan(e.next, { expectedVersion: 4, opId: 'resume-1', at: at(4 * 86_400 + 60), routines: after, otherApplied: false });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next.pauses?.at(-1)).toMatchObject({ opId: 'pause-1', endedAtUtc: null, endedBy: null });
    expect(activePause(u.next, toMs(at(5 * 86_400).utc), TZ)).not.toBeNull();
    // A pause Ben resumed before End is left as it was, by End and by its Undo.
    const r = resumePlan(p.next, { expectedVersion: 3, opId: 'resume-p', at: at(86_400), tz: TZ });
    if (r.kind !== 'write') throw new Error(r.kind);
    const e2 = endPlan(r.next, { expectedVersion: 4, opId: 'end-2', at: at(4 * 86_400), routines });
    if (e2.kind !== 'write') throw new Error(e2.kind);
    expect(e2.next.pauses).toEqual(r.next.pauses);
  });

  it('a new plan applied over a paused one closes its pause; the new plan’s Undo puts the first back paused', () => {
    const { a, routines } = applied();
    const p = pausePlan(a.next, { expectedVersion: 2, opId: 'pause-1', at: at(10), untilDate: null, tz: TZ });
    if (p.kind !== 'write') throw new Error(p.kind);
    const second = { ...planOf(), id: id(972) };
    const live2 = [...routines.values()].filter((r): r is Routine => r !== null);
    const b = applyPlan(second, { expectedVersion: 1, versionN: 1, mode: 'add', opId: 'apply-b', at: at(2 * 86_400), live: live2, applied: [p.next] });
    if (b.kind !== 'write') throw new Error(b.kind);
    const sup = b.supersede[0]?.next as PlanDraft;
    expect(sup.pauses?.at(-1)).toMatchObject({ endedAtUtc: at(2 * 86_400).utc, endedBy: 'end' });
    expect(pausedDates(sup.pauses, '2026-10-05', '2026-11-30', TZ, planInUseUntilUtc(sup)).size).toBe(2);
    const back = new Map(routines);
    for (const r of b.create) back.set(r.id, r);
    const u = undoPlanApply(b.next, { expectedVersion: 2, opId: 'undo-b', at: at(2 * 86_400 + 60), routines: back, plans: new Map([[sup.id, sup]]) });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.restore[0]?.next.pauses?.at(-1)).toMatchObject({ opId: 'pause-1', endedAtUtc: null, endedBy: null });
  });

  it('auto-resume reads the until date where Ben is now (a time-zone change moves it with him); an Undo of the pause after the auto-resume is stale', () => {
    const { a } = applied();
    const p = pausePlan(a.next, { expectedVersion: 2, opId: 'pause-1', at: at(10), untilDate: '2026-11-03', tz: TZ });
    if (p.kind !== 'write') throw new Error(p.kind);
    // 3 Nov 08:00 in Auckland is still 2 Nov in London.
    const nov3Auckland = localMidnightUtcMs('2026-11-03', TZ) + 8 * 3_600_000;
    const LONDON = 'Europe/London';
    expect(autoResumeDue(p.next, nov3Auckland, TZ)).not.toBeNull();
    expect(autoResumeDue(p.next, nov3Auckland, LONDON)).toBeNull();
    expect(activePause(p.next, nov3Auckland, LONDON)).not.toBeNull();
    const early = resumePlan(p.next, { expectedVersion: 3, opId: 'auto-1', at: { utc: toIso(nov3Auckland), tz: LONDON }, tz: LONDON, auto: true });
    expect(early.kind).toBe('invalid');
    const nov3London = localMidnightUtcMs('2026-11-03', LONDON);
    const r = resumePlan(p.next, { expectedVersion: 3, opId: 'auto-1', at: { utc: toIso(nov3London + 3_600_000), tz: LONDON }, tz: LONDON, auto: true });
    if (r.kind !== 'write') throw new Error(r.kind);
    expect(r.next.pauses?.at(-1)).toMatchObject({ endedAtUtc: toIso(nov3London), endedBy: 'auto' });
    // The pause card's Undo (made before the auto-resume) changes nothing now.
    expect(undoPlanControl(r.next, { expectedVersion: 3, opId: 'undo-pause', at: { utc: toIso(nov3London + 7_200_000), tz: LONDON }, targetOpId: 'pause-1' }).kind).toBe('stale');
    expect(undoPlanControl(r.next, { expectedVersion: 4, opId: 'undo-pause-2', at: { utc: toIso(nov3London + 7_200_000), tz: LONDON }, targetOpId: 'pause-1' }).kind).toBe('stale');
  });

  it('End after a dated pause’s date (before the auto-resume write) closes it at its date', () => {
    const { a, routines } = applied();
    const p = pausePlan(a.next, { expectedVersion: 2, opId: 'pause-1', at: at(10), untilDate: '2026-10-12', tz: TZ });
    if (p.kind !== 'write') throw new Error(p.kind);
    const e = endPlan(p.next, { expectedVersion: 3, opId: 'end-1', at: at(10 * 86_400), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    expect(e.next.pauses?.at(-1)).toMatchObject({ endedAtUtc: toIso(localMidnightUtcMs('2026-10-12', TZ)), endedBy: 'auto' });
  });

  it('End: the plan’s days leave the rotation (kept, with their history); the plan is ended, no longer in use; Up next has no plan days', () => {
    const { a, routines } = applied();
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    expect(e.update.map((u) => [u.next.name, u.next.inRotation, u.expectedVersion])).toEqual([
      ['Push', false, 1],
      ['Pull', false, 1],
      ['Legs', false, 1],
      ['Upper', false, 1],
      // (Ben, 20 Oct: option B) the workouts `Replace my workouts` took out go back.
      ['Push A', true, 4],
      ['Pull A', true, 4],
    ]);
    expect(e.update.every((u) => u.next.deletedAtUtc === undefined || u.next.deletedAtUtc === null)).toBe(true);
    expect(e.next).toMatchObject({ status: 'ended', version: 3, ended: { opId: 'end-1', atUtc: at(100).utc } });
    expect(e.next.ended?.rotationOff.map((o) => [o.versionBefore, o.versionAfter])).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    expect(PlanDraftSchema.safeParse(e.next).success).toBe(true);
    const after = withUpdates(routines, e.update);
    expect(inRotation(after)).toEqual(['Push A', 'Pull A']);
    expect(planRoutines(e.next, [...after.values()].filter((r): r is Routine => r !== null))).toEqual([]);
    // The Apply's Undo from the coach card is stale now (it would delete the workouts End keeps).
    expect(undoPlanApply(e.next, { expectedVersion: 3, opId: 'undo-apply', at: at(110), routines: after }).kind).toBe('stale');
    // Ended isn't open: it can't be applied again from its card.
    expect(applyPlan(e.next, { expectedVersion: 3, versionN: 1, mode: 'replace', opId: 'apply-2', at: at(110), live: [] }).kind).not.toBe('write');
  });

  it('a retried End is a duplicate; an older version or a plan not in use is stale; a day Ben already took out stays as it is', () => {
    const { a, routines } = applied();
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    expect(endPlan(e.next, { expectedVersion: 3, opId: 'end-1', at: at(101), routines }).kind).toBe('duplicate');
    expect(endPlan(e.next, { expectedVersion: 3, opId: 'end-2', at: at(101), routines }).kind).toBe('stale');
    expect(endPlan(a.next, { expectedVersion: 1, opId: 'end-3', at: at(101), routines }).kind).toBe('stale');
    expect(endPlan(planOf(), { expectedVersion: 1, opId: 'end-4', at: at(101), routines }).kind).toBe('stale');
    const [push] = a.create;
    if (push === undefined) throw new Error('push');
    const out = new Map(routines);
    out.set(push.id, { ...push, version: 2, inRotation: false });
    const e2 = endPlan(a.next, { expectedVersion: 2, opId: 'end-5', at: at(100), routines: out });
    if (e2.kind !== 'write') throw new Error(e2.kind);
    expect(e2.update.map((u) => u.next.name)).toEqual(['Pull', 'Legs', 'Upper', 'Push A', 'Pull A']);
  });

  it('(Ben, 20 Oct: option B) End restores the workouts Replace took out, in their places as before Apply; Undo of End takes them out again', () => {
    const { a, routines } = applied();
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    const after = withUpdates(routines, e.update);
    expect([PUSH_A.id, PULL_A.id].map((x) => after.get(x)?.rotationAtUtc)).toEqual([PUSH_A.rotationAtUtc, PULL_A.rotationAtUtc]);
    expect(e.next.ended?.restored).toEqual([
      { routineId: PUSH_A.id, versionBefore: 4, versionAfter: 5 },
      { routineId: PULL_A.id, versionBefore: 4, versionAfter: 5 },
    ]);
    expect(e.next.ended?.notRestored).toEqual([]);
    expect(isInRotation(after.get(ARMS.id) as Routine)).toBe(false);
    const u = undoEndPlan(e.next, { expectedVersion: 3, opId: 'resume-1', at: at(120), routines: after, otherApplied: false });
    if (u.kind !== 'write') throw new Error(u.kind);
    const back = withUpdates(after, u.update);
    expect(inRotation(back)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    // Apply's record follows them: a second End restores them again, and the card's Undo of Apply still puts them back.
    expect(u.next.applied?.rotationOff.map((o) => o.versionAfter)).toEqual([6, 6]);
    const e2 = endPlan(u.next, { expectedVersion: 4, opId: 'end-2', at: at(130), routines: back });
    if (e2.kind !== 'write') throw new Error(e2.kind);
    expect(inRotation(withUpdates(back, e2.update))).toEqual(['Push A', 'Pull A']);
    expect(undoPlanApply(u.next, { expectedVersion: 4, opId: 'undo-apply', at: at(130), routines: back }).kind).toBe('write');
  });

  it('a replaced workout Ben deleted or changed since isn’t restored and is named; one he put back himself is left as it is', () => {
    const { a, routines } = applied();
    const edited = new Map(routines);
    const pushA = routines.get(PUSH_A.id) as Routine;
    const pullA = routines.get(PULL_A.id) as Routine;
    edited.set(PUSH_A.id, { ...pushA, version: pushA.version + 1, name: 'Push A heavy' });
    edited.set(PULL_A.id, { ...pullA, version: pullA.version + 1, deletedAtUtc: at(50).utc });
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines: edited });
    if (e.kind !== 'write') throw new Error(e.kind);
    expect(e.next.ended?.restored).toEqual([]);
    expect(e.next.ended?.notRestored).toEqual([
      { routineId: PUSH_A.id, name: 'Push A heavy' },
      { routineId: PULL_A.id, name: 'Pull A' },
    ]);
    expect(PlanDraftSchema.safeParse(e.next).success).toBe(true);
    const himself = new Map(routines);
    himself.set(PUSH_A.id, { ...pushA, version: pushA.version + 1, inRotation: true });
    const e2 = endPlan(a.next, { expectedVersion: 2, opId: 'end-2', at: at(100), routines: himself });
    if (e2.kind !== 'write') throw new Error(e2.kind);
    expect(e2.next.ended?.notRestored).toEqual([]);
    expect(e2.next.ended?.restored?.map((r) => r.routineId)).toEqual([PULL_A.id]);
    // Add alongside took nothing out: nothing to restore.
    const add = applyPlan(planOf(), { expectedVersion: 1, versionN: 1, mode: 'add', opId: 'apply-add', at: at(0), live });
    if (add.kind !== 'write') throw new Error(add.kind);
    const e3 = endPlan(add.next, { expectedVersion: 2, opId: 'end-3', at: at(100), routines: new Map([...add.create, ...live].map((r) => [r.id, r])) });
    expect(e3.kind === 'write' ? e3.next.ended?.restored : null).toEqual([]);
  });

  it('Undo of End refuses when Ben changed a restored workout since', () => {
    const { a, routines } = applied();
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    const after = withUpdates(routines, e.update);
    const pushA = after.get(PUSH_A.id) as Routine;
    after.set(PUSH_A.id, { ...pushA, version: pushA.version + 1, name: 'Push A v2' });
    expect(undoEndPlan(e.next, { expectedVersion: 3, opId: 'resume-1', at: at(120), routines: after, otherApplied: false })).toMatchObject({ kind: 'changed_since', names: ['Push A v2'] });
  });

  it('Undo of End: the days back in the rotation in their places, the plan in use again, and the card’s Undo of Apply still works', () => {
    const { a, routines } = applied();
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    const ended = withUpdates(routines, e.update);
    const u = undoEndPlan(e.next, { expectedVersion: 3, opId: 'resume-1', at: at(120), routines: ended, otherApplied: false });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next).toMatchObject({ status: 'applied', ended: null, version: 4 });
    expect(PlanDraftSchema.safeParse(u.next).success).toBe(true);
    const back = withUpdates(ended, u.update);
    expect(inRotation(back)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(a.create.map((r) => back.get(r.id)?.rotationAtUtc)).toEqual(a.create.map((r) => r.rotationAtUtc));
    expect(planRoutines(u.next, [...back.values()].filter((r): r is Routine => r !== null)).map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    // The Apply record follows the workouts' versions: Undo of Apply finds them as left, and restores Push A and Pull A.
    expect(u.next.applied?.made.map((m) => m.version)).toEqual([3, 3, 3, 3]);
    const undo = undoPlanApply(u.next, { expectedVersion: 4, opId: 'undo-apply', at: at(130), routines: back });
    expect(undo.kind).toBe('write');
    // Retried: duplicate; from an older read: stale.
    expect(undoEndPlan(u.next, { expectedVersion: 4, opId: 'resume-1', at: at(121), routines: back, otherApplied: false }).kind).toBe('duplicate');
    expect(undoEndPlan(u.next, { expectedVersion: 4, opId: 'resume-2', at: at(121), routines: back, otherApplied: false }).kind).toBe('stale');
  });

  it('Undo of End refuses when a newer plan is in use, or Ben changed a plan workout since (nothing changes)', () => {
    const { a, routines } = applied();
    const e = endPlan(a.next, { expectedVersion: 2, opId: 'end-1', at: at(100), routines });
    if (e.kind !== 'write') throw new Error(e.kind);
    const ended = withUpdates(routines, e.update);
    expect(undoEndPlan(e.next, { expectedVersion: 3, opId: 'resume-1', at: at(120), routines: ended, otherApplied: true }).kind).toBe('stale');
    const pull = e.update[1]?.next;
    if (pull === undefined) throw new Error('pull');
    const edited = new Map(ended);
    edited.set(pull.id, { ...pull, version: pull.version + 1, name: 'Pull heavy' });
    expect(undoEndPlan(e.next, { expectedVersion: 3, opId: 'resume-2', at: at(120), routines: edited, otherApplied: false })).toMatchObject({ kind: 'changed_since', names: ['Pull heavy'] });
  });
});

describe('Make next, pause and resume (Ben, 20 Oct; rule 2, rule 5)', () => {
  function applied() {
    const a = applyPlan(planOf(), { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live: [] });
    if (a.kind !== 'write') throw new Error(a.kind);
    return a;
  }
  const DAY = 86_400;

  it('Make next pins a live plan day; versioned, idempotent; Undo puts the pin before back; a stale Undo changes nothing', () => {
    const a = applied();
    const [push, pull] = a.create;
    if (push === undefined || pull === undefined) throw new Error('days');
    const p1 = pinPlanDay(a.next, { expectedVersion: 2, opId: 'pin-1', at: at(10), routineId: pull.id, days: a.create });
    if (p1.kind !== 'write') throw new Error(p1.kind);
    expect(p1.next).toMatchObject({ version: 3, pin: { routineId: pull.id, opId: 'pin-1' }, lastControl: { opId: 'pin-1', kind: 'pin', versionAfter: 3, before: { pin: null, pauses: [] } } });
    expect(PlanDraftSchema.safeParse(p1.next).success).toBe(true);
    expect(pinPlanDay(p1.next, { expectedVersion: 3, opId: 'pin-1', at: at(11), routineId: pull.id, days: a.create }).kind).toBe('duplicate');
    expect(pinPlanDay(p1.next, { expectedVersion: 2, opId: 'pin-2', at: at(11), routineId: push.id, days: a.create }).kind).toBe('stale');
    expect(pinPlanDay(p1.next, { expectedVersion: 3, opId: 'pin-3', at: at(11), routineId: id(999), days: a.create })).toMatchObject({ kind: 'invalid', reason: 'not_a_day' });
    const p2 = pinPlanDay(p1.next, { expectedVersion: 3, opId: 'pin-4', at: at(12), routineId: push.id, days: a.create });
    if (p2.kind !== 'write') throw new Error(p2.kind);
    // The first pin's Undo is out of date now; the second's puts Pull back.
    expect(undoPlanControl(p2.next, { expectedVersion: 4, opId: 'u-1', at: at(13), targetOpId: 'pin-1' }).kind).toBe('stale');
    const u = undoPlanControl(p2.next, { expectedVersion: 4, opId: 'u-2', at: at(13), targetOpId: 'pin-4' });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next.pin?.routineId).toBe(pull.id);
    expect(undoPlanControl(u.next, { expectedVersion: 5, opId: 'u-3', at: at(14), targetOpId: 'pin-4' }).kind).toBe('stale');
    expect(undoPlanControl(u.next, { expectedVersion: 5, opId: 'u-2', at: at(14), targetOpId: 'pin-4' }).kind).toBe('duplicate');
    // Unpin.
    const un = pinPlanDay(u.next, { expectedVersion: 5, opId: 'pin-5', at: at(15), routineId: null, days: a.create });
    expect(un.kind === 'write' ? un.next.pin : 'x').toBeNull();
    // Only the plan in use.
    expect(pinPlanDay(planOf(), { expectedVersion: 1, opId: 'pin-6', at: at(15), routineId: push.id, days: a.create }).kind).toBe('stale');
  });

  it('Pause until a date: paused now, back in use on the date; the first open after it writes the resume; Resume any time; Undo of each', () => {
    const a = applied();
    const p = pausePlan(a.next, { expectedVersion: 2, opId: 'pause-1', at: at(10), untilDate: '2026-11-03', tz: TZ });
    if (p.kind !== 'write') throw new Error(p.kind);
    expect(PlanDraftSchema.safeParse(p.next).success).toBe(true);
    expect(activePause(p.next, Date.parse(at(DAY).utc), TZ)?.untilDate).toBe('2026-11-03');
    // A second pause while one runs, or a date not after today: refused.
    expect(pausePlan(p.next, { expectedVersion: 3, opId: 'pause-2', at: at(20), untilDate: null, tz: TZ })).toMatchObject({ kind: 'invalid', reason: 'already_paused' });
    expect(pausePlan(a.next, { expectedVersion: 2, opId: 'pause-3', at: at(10), untilDate: '2026-10-08', tz: TZ })).toMatchObject({ kind: 'invalid', reason: 'bad_date' });
    // Undo of the pause: in use again.
    const up = undoPlanControl(p.next, { expectedVersion: 3, opId: 'u-1', at: at(30), targetOpId: 'pause-1' });
    if (up.kind !== 'write') throw new Error(up.kind);
    expect(activePause(up.next, Date.parse(at(DAY).utc), TZ)).toBeNull();
    // Resume early, then Undo of the resume: paused again.
    const r = resumePlan(p.next, { expectedVersion: 3, opId: 'resume-1', at: at(2 * DAY), tz: TZ });
    if (r.kind !== 'write') throw new Error(r.kind);
    expect(r.next.pauses?.at(-1)).toMatchObject({ endedAtUtc: at(2 * DAY).utc, endedBy: 'ben' });
    expect(activePause(r.next, Date.parse(at(3 * DAY).utc), TZ)).toBeNull();
    expect(resumePlan(r.next, { expectedVersion: 4, opId: 'resume-2', at: at(3 * DAY), tz: TZ })).toMatchObject({ kind: 'invalid', reason: 'not_paused' });
    const ur = undoPlanControl(r.next, { expectedVersion: 4, opId: 'u-2', at: at(3 * DAY), targetOpId: 'resume-1' });
    expect(ur.kind === 'write' ? activePause(ur.next, Date.parse(at(3 * DAY).utc), TZ) : 'x').not.toBeNull();
    // Auto-resume: not before the date; on it, ended at the date's start, and the pause's Undo is out of date.
    const nov4 = Date.parse('2026-11-03T20:00:00.000Z');
    expect(resumePlan(p.next, { expectedVersion: 3, opId: 'auto-0', at: at(5 * DAY), tz: TZ, auto: true }).kind).toBe('invalid');
    expect(autoResumeDue(p.next, nov4, TZ)).not.toBeNull();
    const auto = resumePlan(p.next, { expectedVersion: 3, opId: 'auto-1', at: { utc: new Date(nov4).toISOString(), tz: TZ }, tz: TZ, auto: true });
    if (auto.kind !== 'write') throw new Error(auto.kind);
    expect(auto.next.pauses?.at(-1)).toMatchObject({ endedAtUtc: '2026-11-02T11:00:00.000Z', endedBy: 'auto' });
    expect(auto.next.lastControl).toBeNull();
    expect(autoResumeDue(auto.next, nov4, TZ)).toBeNull();
    expect(PlanDraftSchema.safeParse(auto.next).success).toBe(true);
    // Retried auto-resume with the same op ID: duplicate.
    expect(resumePlan(auto.next, { expectedVersion: 4, opId: 'auto-1', at: { utc: new Date(nov4).toISOString(), tz: TZ }, tz: TZ, auto: true }).kind).toBe('duplicate');
  });

  it('Pause with no date runs until Resume', () => {
    const a = applied();
    const p = pausePlan(a.next, { expectedVersion: 2, opId: 'pause-1', at: at(10), untilDate: null, tz: TZ });
    if (p.kind !== 'write') throw new Error(p.kind);
    expect(activePause(p.next, Date.parse(at(200 * DAY).utc), TZ)).not.toBeNull();
    expect(autoResumeDue(p.next, Date.parse(at(200 * DAY).utc), TZ)).toBeNull();
  });
});

describe('Up next walks the plan (rotation, not dates)', () => {
  const p = planOf();
  const a = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live: [] });
  if (a.kind !== 'write') throw new Error(a.kind);
  const days = planRoutines(a.next, a.create);
  const ref = (n: number, routineId: string | null, seconds: number): FinishedRef => ({ sessionId: id(n), routineId, startedAtUtc: at(seconds).utc, tz: TZ });

  it('day 1 before any plan day is done (workouts before Apply don’t count); then the day after the newest, wrapping', () => {
    expect(days.map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    const applied = a.next.applied?.atUtc ?? '';
    expect(planUpNext(days, [ref(1, null, -100)], applied)?.name).toBe('Push');
    expect(planUpNext(days, [ref(1, days[0]?.id ?? null, 100)], applied)?.name).toBe('Pull');
    expect(planUpNext(days, [ref(1, days[0]?.id ?? null, 100), ref(2, days[3]?.id ?? null, 200), ref(3, null, 300)], applied)?.name).toBe('Push');
    expect(planUpNext([], [], applied)).toBeNull();
  });

  it('with a split: the plan’s workout for the split day due; two days on one split day alternate (least recently done first)', () => {
    const two = checkPlanProposal({ ...FOUR, days: [day('Push', 'push', [pex('barbell-bench-press')]), day('Pull', 'pull', [pex('cable-row')]), day('Push', 'push', [pex('dumbbell-incline-press')])] }, planCtx());
    const tp = newPlanDraft({ id: id(971), ownerId: OWNER, version: versionOf(two.days), opId: 'plan-9', at: at(-60) });
    const ta = applyPlan(tp, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-9', at: at(0), live: [] });
    if (ta.kind !== 'write') throw new Error(ta.kind);
    const [push1, , push2] = ta.create;
    expect(planRoutineForSplitDay(ta.create, 'push', [])?.id).toBe(push1?.id);
    expect(planRoutineForSplitDay(ta.create, 'push', [ref(1, push1?.id ?? null, 100)])?.id).toBe(push2?.id);
    expect(planRoutineForSplitDay(ta.create, 'push', [ref(1, push1?.id ?? null, 100), ref(2, push2?.id ?? null, 200)])?.id).toBe(push1?.id);
    expect(planRoutineForSplitDay(ta.create, 'legs', [])).toBeNull();
  });

  it('an undone or open plan has no days; a deleted day drops out', () => {
    expect(planRoutines(p, a.create)).toEqual([]);
    const gone = a.create.map((r, i) => (i === 1 ? { ...r, deletedAtUtc: at(5).utc } : r));
    expect(planRoutines(a.next, gone).map((r) => r.name)).toEqual(['Push', 'Legs', 'Upper']);
  });
});

describe('a plan day’s first workout takes the plan’s checked loads', () => {
  const p = planOf();
  const a = applyPlan(p, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(0), live: [] });
  if (a.kind !== 'write') throw new Error(a.kind);
  const plan = a.next;

  function start(routine: Routine, gym = MAIN_GYM, flags: PainFlag[] = []) {
    const firstLoads = planFirstLoads({ routine, plan, exercises: EXERCISES, histories: HISTORIES, substitute: subCtx(gym, { painFlags: flags }), nowMs: Date.parse(at(60).utc) });
    return planRoutineStart({ opId: 'start', owner: profile(), gymId: gym.id, gymName: gym.name, routine, exercises: EXERCISES, gymEquipment: gym.equipment, knownEquipment: KNOWN, at: at(60), newId: (() => { let n = 40_000; return () => id((n += 1)); })(), firstLoads });
  }
  const working = (out: ReturnType<typeof start>, exerciseId: string) => {
    const row = out.aggregate.exercises.find((e) => e.exerciseId === exerciseId);
    return out.aggregate.sets.filter((s) => s.sessionExerciseId === row?.id && s.setType !== 'warmup');
  };

  it('kg, per-hand dumbbells, a stack and an assisted machine, each labelled coach with its basis', () => {
    const [push, pull] = a.create;
    if (push === undefined || pull === undefined) throw new Error('days');
    const pushOut = start(push);
    expect(working(pushOut, BENCH.id).map((s) => s.planned.load)).toEqual([kg(102.5), kg(102.5), kg(102.5)]);
    expect(working(pushOut, BENCH.id)[0]?.planned).toMatchObject({ source: 'coach', provenance: { source: 'coach', coach: { scope: 'build', actionId: id(960) }, routineName: 'Push' } });
    expect(working(pushOut, INCLINE.id)[0]?.planned.load).toEqual(kg(27.5, 'per_hand'));
    // No coach load (pushdown: no history, none proposed): the row's own Auto template, no load.
    expect(working(pushOut, PUSHDOWN.id).every((s) => s.planned.load === null)).toBe(true);
    const pullOut = start(pull);
    expect(working(pullOut, PULLUP.id)[0]?.planned.load).toEqual(kg(30, 'assistance'));
    expect(working(pullOut, ROW.id)[0]?.planned.load).toEqual(kg(60, 'stack'));
  });

  it('at another gym the shared fit caps to that gym’s max (rule 4); in lb it converts', () => {
    const upper = a.create[3];
    if (upper === undefined) throw new Error('day');
    const hotel = start(upper, HOTEL_GYM);
    // The hotel rack stops at 20 kg each: never above the max.
    expect(working(hotel, INCLINE.id).map((s) => s.planned.load)).toEqual([kg(20, 'per_hand'), kg(20, 'per_hand'), kg(20, 'per_hand')]);
    // 27.5 kg each is 60.6 lb: the lb rack's 60 lb (toward easier).
    const imperial = start(upper, LB_GYM);
    expect(working(imperial, INCLINE.id).map((s) => s.planned.load)).toEqual([{ value: 60, unit: 'lb', convention: 'per_hand' }, { value: 60, unit: 'lb', convention: 'per_hand' }, { value: 60, unit: 'lb', convention: 'per_hand' }]);
    expect(working(imperial, INCLINE.id)[0]?.planned.source).toBe('coach');
  });

  it('a row Ben changed in the editor since Apply, or a workout already done, plans as usual (no plan loads)', () => {
    const push = a.create[0];
    if (push === undefined) throw new Error('day');
    const edited: Routine = { ...push, exercises: push.exercises.map((e, i) => (i === 0 ? { ...e, structureChangedAtUtc: at(30).utc } : e)) };
    const out = start(edited);
    expect(working(out, BENCH.id).every((s) => s.planned.load === null)).toBe(true);
    expect(working(out, INCLINE.id)[0]?.planned.load).toEqual(kg(27.5, 'per_hand'));
    // Another plan's workout: nothing.
    expect(planFirstLoads({ routine: { ...push, createdFromPlan: undefined }, plan, exercises: EXERCISES, histories: HISTORIES, substitute: subCtx(MAIN_GYM), nowMs: Date.parse(at(60).utc) }).size).toBe(0);
  });

  it('pain since the build holds the load at no more than last time (rule 9)', () => {
    const r = checkPlanProposal({ ...FOUR, days: [day('Push', 'push', [pex('barbell-overhead-press', { load: load(52.5, 'kg', 'total') })])] }, planCtx());
    const pp = newPlanDraft({ id: id(972), ownerId: OWNER, version: versionOf(r.days), opId: 'plan-x', at: at(-60) });
    const pa = applyPlan(pp, { expectedVersion: 1, versionN: 1, mode: 'add', opId: 'apply-x', at: at(0), live: [] });
    if (pa.kind !== 'write') throw new Error(pa.kind);
    const routine = pa.create[0];
    if (routine === undefined) throw new Error('day');
    const loads = planFirstLoads({ routine, plan: pa.next, exercises: EXERCISES, histories: HISTORIES, substitute: subCtx(MAIN_GYM, { painFlags: [SHOULDER] }), nowMs: Date.parse(at(60).utc) });
    const sets = [...loads.values()][0]?.sets ?? [];
    for (const s of sets) if (s !== null) expect(s.load?.value ?? 0).toBeLessThanOrEqual(50);
  });
});
