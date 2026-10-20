import { describe, expect, it } from 'vitest';
import {
  BUILD_LIMITS,
  builderDraftKeyText,
  DraftPlanSchema,
  DraftSlotSchema,
  MemorySchema,
  PlanAppliedSchema,
  PlanDayDraftSchema,
  PlanDayVariationSchema,
  planDayTemplateKey,
  ReviewSchema,
  reviewSubjectKey,
  RoutineSchema,
  SessionPlanDaySchema,
  slotRev,
  validate,
  VariationOpSchema,
  WorkoutDraftSchema,
  type DraftSetTemplate,
  type DraftSlot,
  type WorkoutDraft,
  type WorkoutDraftVersion,
} from '../src/index';

/**
 * Workout builder v3, slice S1 (schemas and limits; Ben approved 20 Oct):
 * old records parse unchanged; new fields are optional; the limits are
 * Q7 (rest), `maxSuperset` 4, `maxWarmups` 4 and 3 drop sets per exercise.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-10-20T06:00:00.000Z';
const meta = { id: id(1), ownerId: id(2), version: 1, createdAtUtc: T, updatedAtUtc: T };
const at = { utc: T, tz: 'Pacific/Auckland' };

const working = (restS: number | null = 90, setType: DraftSetTemplate['setType'] = 'working'): DraftSetTemplate => ({ setType, reps: { min: 8, max: 10 }, durationS: null, targetRpe: 8, restS });
const slot = (n: number, over: Partial<DraftSlot> = {}): DraftSlot => ({ slotKey: id(100 + n), exerciseId: id(200 + n), catalogueId: `ex-${String(n)}`, order: n, main: n === 0, supersetGroup: null, setTemplates: [working()], ...over });

function coachVersion(over: Partial<WorkoutDraftVersion> = {}): WorkoutDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(10),
    turnId: 'turn-1',
    request: { text: 'push, 45', minutes: 45, focus: 'push', gymId: null, origin: 'text' },
    rawArgs: '{}',
    plan: { slots: [slot(0)] },
    fitMinutes: 45,
    checks: [],
    rationale: null,
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    createdAt: at,
    ...over,
  };
}

const SETUP = { dayId: 'chest', minutes: 60, mainLiftExerciseId: id(200), supersets: true, groups: [{ parts: ['Chest' as const], count: 4 }, { parts: ['Core' as const], count: 1 }] };

function builderVersion(slots: DraftSlot[]): WorkoutDraftVersion {
  return coachVersion({ turnId: 'manual', rawArgs: '', request: { text: '', minutes: 60, focus: 'split_day', gymId: id(3), origin: 'builder', day: { name: 'Chest', bodyParts: ['Chest'] }, setup: SETUP }, plan: { slots }, fitMinutes: 60 });
}

function draft(version: WorkoutDraftVersion, over: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return {
    id: id(5),
    ownerId: id(2),
    status: 'open',
    name: 'Chest · Bench',
    currentVersion: 1,
    versions: [version],
    sessionId: null,
    startedAtUtc: null,
    routineId: null,
    discardedAtUtc: null,
    opIds: ['op-1'],
    createdAt: at,
    tz: at.tz,
    expiresAtUtc: '2026-11-03T06:00:00.000Z',
    version: 1,
    updatedAtUtc: T,
    ...over,
  };
}

describe('limits (S1, Q7)', () => {
  it('reconciled values', () => {
    expect(BUILD_LIMITS).toMatchObject({ maxSuperset: 4, maxWarmups: 4, maxDropSets: 3, maxWorkingSets: 10, maxExercises: 10, minRestS: 30, maxRestS: 360, maxRestBeforeDropS: 60, minMinutes: 15, maxMinutes: 180 });
  });

  it('a 0:15 rest before a drop validates; 1:01 does not; a drop set rests like a working set', () => {
    const ok = slot(1, { setTemplates: [working(90), working(15), working(90, 'drop')] });
    expect(validate(DraftSlotSchema, ok).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(0), working(90, 'drop')] })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(61), working(90, 'drop')] })).ok).toBe(false);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(60), working(15, 'drop')] })).ok).toBe(false);
  });

  it('other rests are 0:30–6:00 (Q7)', () => {
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(360)] })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(375)] })).ok).toBe(false);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(15)] })).ok).toBe(false);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(null)] })).ok).toBe(true);
  });

  it('a 4th drop set fails; drops count against the 10 sets', () => {
    // A drop that another drop follows rests 0:00–1:00 too; the last one rests like a working set.
    const chain = [working(90), working(15), working(15, 'drop'), working(15, 'drop'), working(90, 'drop')];
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: chain })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [working(15), working(15, 'drop'), working(15, 'drop'), working(15, 'drop'), working(90, 'drop')] })).ok).toBe(false);
    const eight = Array.from({ length: 8 }, () => working(90));
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [...eight, working(15), working(90, 'drop')] })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [...eight, working(90), working(15), working(90, 'drop')] })).ok).toBe(false);
  });

  it('a 5-exercise superset fails; 4 is fine', () => {
    const ss = (n: number) => Array.from({ length: n }, (_, i) => slot(i + 1, { supersetGroup: 'A' }));
    expect(validate(DraftPlanSchema, { slots: ss(4) }).ok).toBe(true);
    expect(validate(DraftPlanSchema, { slots: ss(5) }).ok).toBe(false);
  });

  it('slot revisions default to 1; rest by set type is optional', () => {
    expect(slotRev(slot(1))).toBe(1);
    expect(slotRev(slot(1, { rev: 4 }))).toBe(4);
    expect(validate(DraftSlotSchema, slot(1, { rev: 2, restBySetType: { top: { seconds: 210 }, backoff: { seconds: 180 } } })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { rev: 0 })).ok).toBe(false);
  });
});

describe('workout drafts: builder versions (§4.4)', () => {
  it('a coach draft from before v3 parses unchanged', () => {
    expect(validate(WorkoutDraftSchema, draft(coachVersion())).ok).toBe(true);
  });

  it('zero slots save while open; a started draft and a coach version need one', () => {
    const empty = draft(builderVersion([]), { builderKey: { planId: id(7), splitDayId: 'chest', mainLiftExerciseId: id(200), localDate: '2026-10-20' } });
    expect(validate(WorkoutDraftSchema, empty).ok).toBe(true);
    expect(validate(WorkoutDraftSchema, { ...empty, status: 'started', sessionId: id(9), startedAtUtc: T }).ok).toBe(false);
    expect(validate(WorkoutDraftSchema, { ...draft(builderVersion([slot(0)])), status: 'started', sessionId: id(9), startedAtUtc: T }).ok).toBe(true);
    expect(validate(WorkoutDraftSchema, draft(coachVersion({ plan: { slots: [] } }))).ok).toBe(false);
  });

  it('a builder version records its set-up and has no model turn', () => {
    const v = builderVersion([slot(0)]);
    expect(validate(WorkoutDraftSchema, draft(v)).ok).toBe(true);
    const noSetup = { ...v.request };
    delete noSetup.setup;
    expect(validate(WorkoutDraftSchema, draft({ ...v, request: noSetup })).ok).toBe(false);
    expect(validate(WorkoutDraftSchema, draft({ ...v, turnId: 'turn-1' })).ok).toBe(false);
    expect(validate(WorkoutDraftSchema, draft({ ...v, request: { ...v.request, setup: { ...SETUP, groups: [{ parts: ['Chest'], count: 5 }] } } })).ok).toBe(false);
    expect(validate(WorkoutDraftSchema, draft({ ...v, request: { ...v.request, setup: { ...SETUP, minutes: 14 } } })).ok).toBe(false);
  });

  it("load sources gain 'calc' and 'ben'", () => {
    const load = (source: string) => ({ load: { value: 95, unit: 'kg', convention: 'total' }, source, basis: null, basisFromCoach: false, held: false, notes: [], notUsed: null });
    for (const source of ['calc', 'ben', 'coach', 'coach_est', 'rule', 'none']) expect(validate(DraftSlotSchema, slot(1, { setTemplates: [{ ...working(), load: load(source) } as DraftSetTemplate] })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [{ ...working(), load: load('typed') } as unknown as DraftSetTemplate] })).ok).toBe(false);
  });

  it('the undo snapshot survives a round trip through JSON', () => {
    const d = draft(builderVersion([slot(0), slot(1)]), { version: 3, undo: { opId: 'swap-1', atVersion: 3, snapshot: { currentVersion: 1, setup: SETUP, plan: { slots: [slot(0)] } } } });
    const parsed = WorkoutDraftSchema.parse(JSON.parse(JSON.stringify(d)));
    expect(parsed.undo?.snapshot.plan.slots).toHaveLength(1);
  });

  it('the builder key is one text per (plan, split day, main lift, local date)', () => {
    expect(builderDraftKeyText({ planId: null, splitDayId: null, mainLiftExerciseId: null, localDate: '2026-10-20' })).toBe('-|-|-|2026-10-20');
    expect(builderDraftKeyText({ planId: id(7), splitDayId: 'chest', mainLiftExerciseId: id(200), localDate: '2026-10-20' })).toBe(`${id(7)}|chest|${id(200)}|2026-10-20`);
  });
});

describe('plan days: templates, variations, provenance (§4.2, §4.3)', () => {
  const routine = { ...meta, name: 'Chest · bench', exercises: [] };

  it('a routine from before v3 parses; a template carries its key and minutes', () => {
    expect(validate(RoutineSchema, routine).ok).toBe(true);
    expect(validate(RoutineSchema, { ...routine, planDay: { planId: id(7), splitDayId: 'chest', mainLiftExerciseId: id(200), minutes: 60 } }).ok).toBe(true);
    expect(validate(RoutineSchema, { ...routine, planDay: { planId: id(7), splitDayId: 'chest', mainLiftExerciseId: null, minutes: 181 } }).ok).toBe(false);
    expect(planDayTemplateKey({ planId: id(7), splitDayId: 'chest', mainLiftExerciseId: null })).toBe(`${id(7)}|chest|-`);
  });

  it('a plan day still needs an exercise; Apply may record a template per main lift', () => {
    const day = { index: 0, name: 'Chest', splitDayId: 'chest', focus: 'chest', minutes: 60, plan: { slots: [] }, checks: [] };
    expect(validate(PlanDayDraftSchema, day).ok).toBe(false);
    expect(validate(PlanDayDraftSchema, { ...day, plan: { slots: [slot(0)] } }).ok).toBe(true);
    const made = Array.from({ length: 14 }, (_, i) => ({ dayIndex: i % 7, routineId: id(300 + i), version: 1, mainLiftExerciseId: i < 7 ? id(200) : id(201) }));
    expect(validate(PlanAppliedSchema, { mode: 'add', versionN: 1, opId: 'apply', atUtc: T, made, rotationOff: [] }).ok).toBe(true);
  });

  it('variations: template + typed extras, a label of 1–40, tombstoned', () => {
    const v = { ...meta, splitDayId: 'chest', mainLiftExerciseId: id(200), label: 'arms superset', extras: [{ kind: 'add_slot', after: 'end', slot: { id: id(400), exerciseId: id(401), equipmentId: null, order: 5, supersetGroup: null, setTemplates: [{ id: id(402), setType: 'working', targetLoad: null, targetReps: { min: 8, max: 12 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null }], restBySetType: {}, transitionRestS: null, progressionRuleId: null } }, { kind: 'pair', a: id(401), b: id(203) }, { kind: 'set_count', exerciseId: id(203), n: 4 }, { kind: 'remove_slot', exerciseId: id(204) }], deletedAtUtc: null, opIds: ['save-1'] };
    expect(validate(PlanDayVariationSchema, v).ok).toBe(true);
    expect(validate(PlanDayVariationSchema, { ...v, label: ' ' }).ok).toBe(false);
    expect(validate(PlanDayVariationSchema, { ...v, label: 'x'.repeat(41) }).ok).toBe(false);
    expect(validate(VariationOpSchema, { kind: 'pair', a: id(1), b: id(1) }).ok).toBe(false);
    expect(validate(VariationOpSchema, { kind: 'set_count', exerciseId: id(1), n: 11 }).ok).toBe(false);
    expect(validate(VariationOpSchema, { kind: 'rename', label: 'x' }).ok).toBe(false);
  });

  it('session provenance names a template with its version, or neither', () => {
    const p = { planId: id(7), splitDayId: 'chest', templateRoutineId: id(300), templateVersion: 2, variationId: null };
    expect(validate(SessionPlanDaySchema, p).ok).toBe(true);
    expect(validate(SessionPlanDaySchema, { ...p, templateRoutineId: null, templateVersion: null }).ok).toBe(true);
    expect(validate(SessionPlanDaySchema, { ...p, templateVersion: null }).ok).toBe(false);
  });
});

describe('reviews and day notes (§6.1, §6.2, §2.9)', () => {
  const review = {
    ...meta,
    subject: { kind: 'weekly', weekMonday: '2026-10-19' },
    inputsHash: 'h1',
    facts: [
      { kind: 'sessions_vs_plan', done: 3, planned: 4 },
      { kind: 'group_sets', group: 'Chest', sets: 12, planned: 14, range: { min: 10, max: 20 } },
      { kind: 'est_max', exerciseId: id(200), value: { value: 127, unit: 'kg' }, estimate: true },
    ],
    coach: { status: 'offline' },
    status: 'current',
    supersededById: null,
    opIds: ['review-1'],
    createdAt: at,
  };

  it('facts and coach text are separate; offline has no text', () => {
    expect(validate(ReviewSchema, review).ok).toBe(true);
    expect(validate(ReviewSchema, { ...review, coach: { status: 'offline', verdict: 'Good week' } }).ok).toBe(true); // extra keys are stripped, never shown
    expect(ReviewSchema.parse({ ...review, coach: { status: 'offline', verdict: 'Good week' } }).coach).toEqual({ status: 'offline' });
    expect(validate(ReviewSchema, { ...review, coach: { status: 'reviewed', verdict: 'Solid week', lines: ['Chest sets a bit low'], actionIds: [], numbersChecked: true } }).ok).toBe(true);
  });

  it('an estimate is always labelled; unknown fact kinds fail', () => {
    expect(validate(ReviewSchema, { ...review, facts: [{ kind: 'est_max', exerciseId: id(200), value: { value: 127, unit: 'kg' }, estimate: false }] }).ok).toBe(false);
    expect(validate(ReviewSchema, { ...review, facts: [{ kind: 'recovery_score', value: 80 }] }).ok).toBe(false);
  });

  it('a superseded review names its successor', () => {
    expect(validate(ReviewSchema, { ...review, status: 'superseded' }).ok).toBe(false);
    expect(validate(ReviewSchema, { ...review, status: 'superseded', supersededById: id(9) }).ok).toBe(true);
  });

  it('subject keys', () => {
    expect(reviewSubjectKey({ kind: 'pre_session', localDate: '2026-10-20', splitDayId: 'chest', draftId: null })).toBe('2026-10-20');
    expect(reviewSubjectKey({ kind: 'session', draftId: id(5), draftVersion: 2 })).toBe(id(5));
    expect(reviewSubjectKey({ kind: 'post_session', sessionId: id(6) })).toBe(id(6));
    expect(reviewSubjectKey({ kind: 'weekly', weekMonday: '2026-10-19' })).toBe('2026-10-19');
    expect(reviewSubjectKey({ kind: 'block', planId: id(7), blockId: null, fromDate: '2026-10-19', toDate: '2026-11-15' })).toBe(`${id(7)}|-|2026-10-19`);
  });

  it('a memory from before v3 parses; a day note scopes one to a plan day', () => {
    const memory = { ...meta, text: 'Include abs', contentKey: 'include abs', status: 'active', quote: 'Include abs', createdByActionId: id(11) };
    expect(validate(MemorySchema, memory).ok).toBe(true);
    expect(validate(MemorySchema, { ...memory, dayNote: { splitDayId: 'chest', mainLiftExerciseId: id(200), reviewId: id(12), hiddenOn: ['2026-10-20'] } }).ok).toBe(true);
    expect(validate(MemorySchema, { ...memory, dayNote: { splitDayId: 'chest', mainLiftExerciseId: null, reviewId: null, hiddenOn: ['20 Oct'] } }).ok).toBe(false);
  });
});
