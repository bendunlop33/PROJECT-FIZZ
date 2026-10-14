import { describe, expect, it } from 'vitest';

import { DraftPlanSchema, WorkoutDraftSchema, type EquipmentInstance, type Exercise, type Load, type PainFlag, type ProposeWorkoutArgs, type ProposedExercise, type WorkoutDraft, type WorkoutDraftVersion } from '@fizz/schemas';

import {
  checkWorkoutProposal,
  doableHere,
  loadReferences,
  newWorkoutDraft,
  painHoldFor,
  planCoachDraft,
  type HistorySession,
  type SubstituteContext,
  type WorkoutProposalContext,
} from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, idGen, kg, OWNER, profile, stack, TZ } from './fixtures';

/**
 * Coach loads through the draft (workout-builder v2.1): `checkWorkoutProposal`
 * stores checked loads per set template (BD6), `planCoachDraft` plans them
 * after `recheckDraftLoad` (B5–B7) and labels them (`source: coach`, `est.`),
 * falls back to the rule where a load is missing or rejected, and the main
 * lift is kept (BD19). Covers kg, per-hand dumbbells, a stack max, pain
 * after the build, newer history, a gym switch and preview == Start.
 */

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

const HOTEL = id(3);
const bar = barbell({ id: id(700), gymId: GYM, plates: [{ mass: 25, count: 4 }, { mass: 20, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const rack = dumbbells({ id: id(701), gymId: GYM, loads: steps(2.5, 30, 2.5) });
const cable = stack({ id: id(702), gymId: GYM, name: 'Cable station', stackLoads: steps(2.5, 100, 2.5) });
const hotelRack = dumbbells({ id: id(710), gymId: HOTEL, loads: steps(2.5, 20, 2.5) });
const MAIN_GYM = { id: GYM, name: 'Main gym', equipment: [bar, rack, cable] };
const HOTEL_GYM = { id: HOTEL, name: 'Hotel gym', equipment: [hotelRack] };
const KNOWN = new Map<string, EquipmentInstance>([bar, rack, cable, hotelRack].map((e) => [e.id, e]));

const ex = (n: number, name: string, key: string, over: Partial<Exercise>): Exercise => exercise(n, name, { catalogueKey: key, ...over });
const BENCH = ex(210, 'Bench press', 'barbell-bench-press', { movementPattern: 'horizontal_push', mechanic: 'compound', compatibleEquipment: ['barbell', 'dumbbells'] });
const INCLINE = ex(211, 'Incline DB press', 'dumbbell-incline-press', { movementPattern: 'horizontal_push', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound' });
const FLY = ex(212, 'Cable fly', 'cable-fly', { movementPattern: 'horizontal_push', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' });
const PUSHDOWN = ex(214, 'Triceps pushdown', 'cable-triceps-pushdown', { movementPattern: 'elbow_extension', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' });
const OHP = ex(215, 'Overhead press', 'barbell-overhead-press', { movementPattern: 'vertical_push', mechanic: 'compound' });
const ALL = [BENCH, INCLINE, FLY, PUSHDOWN, OHP];
const BY_KEY = new Map(ALL.map((e) => [e.catalogueKey ?? '', e]));
const EXERCISES = new Map(ALL.map((e) => [e.id, e]));

function session(n: number, daysAgo: number, eq: EquipmentInstance | null, sets: { load: Load; reps: number; rpe?: number }[], imported = false): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: imported ? null : (eq?.id ?? null),
    gymId: imported ? null : GYM,
    imported,
    sets: sets.map((s) => ({ setType: 'working' as const, side: null, load: s.load, reps: s.reps, rpe: s.rpe ?? null, rir: null })),
    tz: TZ,
  };
}

const HISTORIES = new Map<string, HistorySession[]>([
  [BENCH.id, [session(900, 2, bar, [{ load: kg(100), reps: 7, rpe: 8 }, { load: kg(100), reps: 7, rpe: 8 }]), session(901, 6, bar, [{ load: kg(97.5), reps: 8, rpe: 8 }]), session(902, 9, bar, [{ load: kg(97.5), reps: 7, rpe: 8 }])]],
  [INCLINE.id, [session(910, 10, null, [{ load: kg(30, 'per_hand'), reps: 8 }, { load: kg(30, 'per_hand'), reps: 8 }], true)]],
  [PUSHDOWN.id, [session(920, 3, cable, [{ load: kg(25, 'stack'), reps: 12, rpe: 9 }])]],
  [OHP.id, [session(930, 3, bar, [{ load: kg(50), reps: 8, rpe: 8 }])]],
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
  reportedAt: { utc: '2026-10-06T08:00:00.000Z', tz: TZ },
  status: 'active',
  clearedAtUtc: null,
  createdByOpId: 'flag-1',
};

const subCtx = (gym: typeof MAIN_GYM, over: Partial<SubstituteContext> = {}): SubstituteContext => ({ ownerId: OWNER, unit: 'kg', gym, knownEquipment: KNOWN, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(0), ...over });

function ctx(over: Partial<WorkoutProposalContext> = {}, opts: { flags?: PainFlag[]; sessionPain?: boolean; histories?: Map<string, HistorySession[]> } = {}): WorkoutProposalContext {
  const flags = opts.flags ?? [];
  const sub = subCtx(MAIN_GYM, { painFlags: flags, sessionPain: { active: opts.sessionPain === true, reportedAtUtc: null } });
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
    newSlotKey: (exerciseId, i) => `00000000-0000-4000-9${String(i).padStart(3, '0')}-${exerciseId.slice(-12)}`,
    loads: {
      refsFor: (e) => loadReferences({ exercise: e, history: (opts.histories ?? HISTORIES).get(e.id) ?? [], ctx: sub, nowMs }),
      painFor: (e) => painHoldFor(e.id, flags, sub.sessionPain, nowMs, TZ),
      askedHeavier: false,
    },
    ...over,
  };
}

const load = (value: number, convention: Load['convention'], basis: string): NonNullable<ProposedExercise['load']> => ({ value, unit: 'kg', convention, basis, from: 'own_history', relatedCatalogueId: null });
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
const args = (exercises: ProposedExercise[]): ProposeWorkoutArgs => ({ name: null, exercises, message: 'Bench first.' });

/** Ben's 14 Oct case: 4 sets on bench for 6–8, with the coach's load and why. */
const PUSH = args([
  pex('barbell-bench-press', { workingSets: 4, reps: { min: 6, max: 8 }, targetRpe: 8, load: load(102.5, 'total', 'last 3: 100×7 @8 → 102.5') }),
  pex('dumbbell-incline-press', { reps: { min: 8, max: 10 }, load: load(30, 'per_hand', 'FitNotes 30×8 → repeat') }),
  pex('cable-fly', { reps: { min: 12, max: 15 }, targetRpe: 9, load: load(100, 'stack', 'est. for 12–15 @9') }),
  pex('cable-triceps-pushdown', { reps: { min: 10, max: 12 }, targetRpe: 9, load: load(40, 'stack', 'last 25×12') }),
]);

function versionOf(plan: WorkoutDraftVersion['plan'], over: Partial<WorkoutDraftVersion> = {}): WorkoutDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(960),
    turnId: 'turn-1',
    request: { text: 'build me a 45 min push session', minutes: 45, focus: 'push', gymId: GYM, origin: 'text' },
    rawArgs: '{}',
    plan,
    fitMinutes: 90,
    checks: [],
    rationale: null,
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    createdAt: at(-60),
    ...over,
  };
}

function draftOf(a: ProposeWorkoutArgs = PUSH, c: WorkoutProposalContext = ctx()): WorkoutDraft {
  const r = checkWorkoutProposal(a, c);
  if (r.status === 'unusable') throw new Error('unusable');
  expect(DraftPlanSchema.safeParse(r.plan).success).toBe(true);
  const d = newWorkoutDraft({ id: id(970), ownerId: OWNER, version: versionOf(r.plan, { checks: r.checks }), opId: 'build-1', at: at(-60) });
  expect(WorkoutDraftSchema.safeParse(d).success).toBe(true);
  return d;
}

function planOf(d: WorkoutDraft, opts: { gym?: typeof MAIN_GYM; flags?: PainFlag[]; sessionPain?: boolean; histories?: Map<string, HistorySession[]> } = {}) {
  const gym = opts.gym ?? MAIN_GYM;
  return planCoachDraft({
    draft: d,
    start: { opId: 'preview', owner: profile(), gymId: gym.id, gymName: gym.name, exercises: EXERCISES, gymEquipment: gym.equipment, knownEquipment: KNOWN, at: at(0), newId: idGen(30_000) },
    histories: opts.histories ?? HISTORIES,
    substitute: subCtx(gym, { painFlags: opts.flags ?? [], sessionPain: { active: opts.sessionPain === true, reportedAtUtc: null } }),
    today: { draft: null, edits: [], swaps: new Map(), fit: { held: () => false } },
  });
}

const setsFor = (out: ReturnType<typeof planOf>, exerciseId: string) => {
  const row = out.aggregate.exercises.find((e) => e.exerciseId === exerciseId);
  return out.aggregate.sets.filter((s) => s.sessionExerciseId === row?.id && s.setType !== 'warmup').sort((a, b) => a.index - b.index);
};

describe('checkWorkoutProposal stores checked loads (BD6)', () => {
  it('each working template carries its checked load, source and basis; the slot records the item and history version', () => {
    const r = checkWorkoutProposal(PUSH, ctx());
    if (r.status === 'unusable') throw new Error('unusable');
    const [bench, incline, fly, pushdown] = r.plan.slots;
    expect(bench?.setTemplates.map((t) => t.load?.load?.value)).toEqual([102.5, 102.5, 102.5, 102.5]);
    expect(bench?.setTemplates[0]?.load).toMatchObject({ source: 'coach', basis: 'last 3: 100×7 @8 → 102.5', basisFromCoach: true });
    expect(bench?.checkedOn).toMatchObject({ equipmentId: bar.id, kind: 'barbell', convention: 'total', unit: 'kg', barKg: 20 });
    expect(bench?.checkedHistoryVersion).toMatch(/[0-9a-f-]{36}/);
    expect(incline?.setTemplates[0]?.load).toMatchObject({ load: { value: 30, convention: 'per_hand' }, source: 'coach' });
    expect(fly?.setTemplates[0]?.load).toMatchObject({ load: { value: 25 }, source: 'coach_est', notes: ['capped at 25 · first time'] });
    expect(pushdown?.setTemplates[0]?.load).toMatchObject({ load: null, source: 'rule' });
    // Every load note is a code check line too (the coach's tool result and `Why?`).
    expect(r.checks.filter((c) => c.kind === 'load').map((c) => c.text)).toEqual(['Cable fly · capped at 25 · first time', 'Triceps pushdown · coach load 40 kg too far from last 25 × 12']);
  });

  it('BD9: a pain-flagged exercise Ben named is kept and held; one he didn’t name is left out', () => {
    const a = args([pex('barbell-overhead-press', { reps: { min: 6, max: 8 }, load: load(55, 'total', 'last 50×8') })]);
    const left = checkWorkoutProposal(a, ctx({}, { flags: [SHOULDER] }));
    expect(left.status).toBe('unusable');
    const kept = checkWorkoutProposal(a, ctx({ namedByBen: (e) => e.id === OHP.id }, { flags: [SHOULDER] }));
    if (kept.status === 'unusable') throw new Error('unusable');
    expect(kept.plan.slots[0]?.setTemplates[0]?.load).toMatchObject({ load: { value: 50 }, held: true });
    expect(kept.checks.map((c) => c.text.replaceAll(' ', ' '))).toContain('Overhead press kept · held · shoulder flagged 6 Oct');
  });

  it('WB-P3 / BD19: a stored main lift the coach left out is inserted first with `kept as main lift`; "something different" skips it', () => {
    const noBench = args([pex('dumbbell-incline-press', { load: load(30, 'per_hand', 'FitNotes 30×8') }), pex('cable-fly', { reps: { min: 12, max: 15 } })]);
    const r = checkWorkoutProposal(noBench, ctx({ mainLift: { exercise: BENCH, skip: false } }));
    if (r.status === 'unusable') throw new Error('unusable');
    expect(r.plan.slots.map((s) => s.exerciseId)).toEqual([BENCH.id, INCLINE.id, FLY.id]);
    expect(r.plan.slots.map((s) => s.main)).toEqual([true, false, false]);
    expect(r.plan.slots[0]?.setTemplates[0]?.load?.source).toBe('rule');
    expect(r.checks.map((c) => c.text)).toContain('Bench press kept as main lift');
    const skip = checkWorkoutProposal(noBench, ctx({ mainLift: { exercise: BENCH, skip: true } }));
    expect(skip.status !== 'unusable' && skip.plan.slots.map((s) => s.exerciseId)).toEqual([INCLINE.id, FLY.id]);
    // WB-P4: a pain-flagged main lift isn't inserted.
    const flagged = checkWorkoutProposal(noBench, ctx({ mainLift: { exercise: OHP, skip: false } }, { flags: [SHOULDER] }));
    expect(flagged.status !== 'unusable' && flagged.plan.slots.map((s) => s.exerciseId)).toEqual([INCLINE.id, FLY.id]);
  });
});

describe('planCoachDraft plans the checked loads (WB-L1, WB5, WB-L10, WB-L12, WB-L6b, WB-L7)', () => {
  it('the coach’s loads become the planned sets, labelled coach / est. with the basis; rejected ones use the rule', () => {
    const out = planOf(draftOf());
    const bench = setsFor(out, BENCH.id);
    expect(bench.map((s) => s.planned.load?.value)).toEqual([102.5, 102.5, 102.5, 102.5]);
    expect(bench[0]?.planned.source).toBe('coach');
    expect(bench[0]?.planned.provenance).toMatchObject({ source: 'coach', coach: { scope: 'build', reason: 'last 3: 100×7 @8 → 102.5' } });
    expect(bench[0]?.planned.provenance?.estimate).toBeUndefined();
    const fly = setsFor(out, FLY.id);
    expect(fly[0]?.planned).toMatchObject({ load: { value: 25, convention: 'stack' }, source: 'coach', provenance: { estimate: true } });
    const pushdown = setsFor(out, PUSHDOWN.id);
    expect(pushdown[0]?.planned.source).toBe('built_in_rule');
    expect(pushdown[0]?.planned.load?.value).toBeGreaterThanOrEqual(25);
    expect(setsFor(out, INCLINE.id)[0]?.planned.load).toEqual({ value: 30, unit: 'kg', convention: 'per_hand' });
  });

  it('WB5 / WB-L10: the same inputs plan the same loads (preview == Start; offline, nothing is asked again)', () => {
    const d = draftOf();
    const a = planOf(d);
    const b = planOf(d);
    expect(a.aggregate.sets.map((s) => s.planned.load)).toEqual(b.aggregate.sets.map((s) => s.planned.load));
  });

  it('WB-L12: a newer bench session caps the stored load at plan time, with the newer session named', () => {
    const d = draftOf();
    const newer = new Map(HISTORIES);
    newer.set(BENCH.id, [session(990, 0.0002, bar, [{ load: kg(100), reps: 5, rpe: 10 }]), ...(HISTORIES.get(BENCH.id) ?? [])]);
    const out = planOf(d, { histories: newer });
    const bench = setsFor(out, BENCH.id);
    expect(bench.every((s) => s.planned.load?.value === 95)).toBe(true);
    expect(bench[0]?.planned.provenance?.guardNotes.some((n) => /^capped at 95 · newer session/.test(n.replaceAll(' ', ' ')))).toBe(true);
  });

  it('WB-L6b: at Hotel gym (dumbbells only) a barbell-checked bench load is never read as per hand: the rule plans it', () => {
    const out = planOf(draftOf(), { gym: HOTEL_GYM });
    const bench = setsFor(out, BENCH.id);
    expect(out.ruleNotes.get(out.version.plan.slots[0]?.slotKey ?? '')).toEqual(['different equipment here · rule used']);
    expect(bench.every((s) => s.planned.source !== 'coach')).toBe(true);
    expect(bench.every((s) => s.planned.load === null || (s.planned.load.convention === 'per_hand' && s.planned.load.value <= 20))).toBe(true);
    // Incline DB (same kind) is re-fitted to the hotel rack's 20 kg each, never past it.
    expect(setsFor(out, INCLINE.id).every((s) => (s.planned.load?.value ?? 0) <= 20)).toBe(true);
  });

  it('BD10 / WB-L7b: pain after the build holds the stored load at no harder than the most recent session', () => {
    const d = draftOf();
    const out = planOf(d, { sessionPain: true });
    expect(setsFor(out, BENCH.id).every((s) => s.planned.load?.value === 100)).toBe(true);
  });

  it('a v1 draft (no stored loads) plans as before, from the rule', () => {
    const v1 = checkWorkoutProposal(PUSH, ctx({ loads: undefined }));
    if (v1.status === 'unusable') throw new Error('unusable');
    expect(v1.plan.slots.every((s) => s.setTemplates.every((t) => t.load === undefined))).toBe(true);
    const d = newWorkoutDraft({ id: id(971), ownerId: OWNER, version: versionOf(v1.plan), opId: 'build-2', at: at(-60) });
    const out = planOf(d);
    expect(setsFor(out, BENCH.id)[0]?.planned.source).toBe('built_in_rule');
  });
});
