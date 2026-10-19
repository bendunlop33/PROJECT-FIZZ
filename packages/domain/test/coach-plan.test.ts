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
  undoPlanApply,
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
    const r = checkPlanProposal({ ...FOUR, days: [day('Push', 'push', [pex('barbell-bench-press', { load: load(102.5, 'kg', 'total') }), pex('dumbbell-incline-press', { load: load(27.5, 'kg', 'per_hand') }), pex('cable-triceps-pushdown')]), day('Pull', 'pull', [pex('assisted-pull-up', { load: load(30, 'kg', 'assistance') })])] }, planCtx());
    const rows = r.days.map((d) => planDayRows(d, (eid) => EXERCISES.get(eid) ?? null).map((x) => [x.name, x.scheme.replace(/\s/g, ' '), x.load.replace(/\s/g, ' '), x.estimate, x.main]));
    expect(rows).toEqual([
      [
        // 102.5 for 8–10 reps is more than 100 × 7 @8 backs: the check caps it (rule 6).
        ['Bench press', '3 × 8–10', '100 kg', false, true],
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
    expect(c.create[0]?.exercises[0]?.setTemplates[0]).toMatchObject({ targetReps: { min: 6, max: 8 }, targetRpe: 8 });
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
