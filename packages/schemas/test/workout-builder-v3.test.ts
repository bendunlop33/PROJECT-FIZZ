import { describe, expect, it } from 'vitest';
import {
  BUILD_LIMITS,
  builderDraftKeyText,
  DraftPlanSchema,
  DraftSlotSchema,
  hideDayNoteOn,
  MemorySchema,
  PlanAppliedSchema,
  PlanDayDraftSchema,
  PlanDayVariationSchema,
  planDayTemplateKey,
  TrainingReviewSchema,
  reviewCoachSettled,
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
    expect(BUILD_LIMITS).toMatchObject({ maxSuperset: 4, maxWarmups: 6, maxDropSets: 3, maxWorkingSets: 10, maxExercises: 10, minRestS: 30, maxRestS: 360, maxRestBeforeDropS: 60, minMinutes: 15, maxMinutes: 180 });
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
    const empty = draft(builderVersion([]), { builderKey: { planId: id(7), dayIndex: 0, splitDayId: 'chest', mainLiftExerciseId: id(200), localDate: '2026-10-20' } });
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

  it('the builder key is one text per (plan, day index, split day, main lift, local date)', () => {
    expect(builderDraftKeyText({ planId: null, dayIndex: null, splitDayId: null, mainLiftExerciseId: null, localDate: '2026-10-20' })).toBe('-|-|-|-|2026-10-20');
    expect(builderDraftKeyText({ planId: id(7), dayIndex: 3, splitDayId: 'push', mainLiftExerciseId: id(200), localDate: '2026-10-20' })).toBe(`${id(7)}|3|push|${id(200)}|2026-10-20`);
    // A plan day names its index; no plan, no index (B1).
    const empty = draft(builderVersion([]));
    expect(validate(WorkoutDraftSchema, { ...empty, builderKey: { planId: id(7), dayIndex: null, splitDayId: 'push', mainLiftExerciseId: null, localDate: '2026-10-20' } }).ok).toBe(false);
    expect(validate(WorkoutDraftSchema, { ...empty, builderKey: { planId: null, dayIndex: 0, splitDayId: 'push', mainLiftExerciseId: null, localDate: '2026-10-20' } }).ok).toBe(false);
  });

  it('at most 6 warm-ups per exercise (S7; WU4’s longest ladder, 22 Oct)', () => {
    const w = (n: number) => Array.from({ length: n }, () => working(60, 'warmup'));
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [...w(6), working()] })).ok).toBe(true);
    expect(validate(DraftSlotSchema, slot(1, { setTemplates: [...w(7), working()] })).ok).toBe(false);
  });

  it('a builder superset has 2–4 exercises; an older coach version with a lone group still reads (S7)', () => {
    const lone = [slot(0), slot(1, { supersetGroup: 'A' })];
    expect(validate(WorkoutDraftSchema, draft(builderVersion(lone))).ok).toBe(false);
    expect(validate(WorkoutDraftSchema, draft(builderVersion([slot(0), slot(1, { supersetGroup: 'A' }), slot(2, { supersetGroup: 'A' })]))).ok).toBe(true);
    expect(validate(WorkoutDraftSchema, draft(coachVersion({ plan: { slots: lone } }))).ok).toBe(true);
  });
});

describe('plan days: templates, variations, provenance (§4.2, §4.3)', () => {
  const routine = { ...meta, name: 'Chest · bench', exercises: [] };

  it('a routine from before v3 parses; a template carries its key and minutes', () => {
    expect(validate(RoutineSchema, routine).ok).toBe(true);
    expect(validate(RoutineSchema, { ...routine, planDay: { planId: id(7), dayIndex: 0, splitDayId: 'chest', mainLiftExerciseId: id(200), minutes: 60 } }).ok).toBe(true);
    expect(validate(RoutineSchema, { ...routine, planDay: { planId: id(7), dayIndex: 0, splitDayId: 'chest', mainLiftExerciseId: null, minutes: 181 } }).ok).toBe(false);
    // A plan day is (plan, day index): one that leaves the index out, or names day 8, fails (B1).
    expect(validate(RoutineSchema, { ...routine, planDay: { planId: id(7), splitDayId: 'chest', mainLiftExerciseId: null, minutes: 60 } }).ok).toBe(false);
    expect(validate(RoutineSchema, { ...routine, planDay: { planId: id(7), dayIndex: 7, splitDayId: 'chest', mainLiftExerciseId: null, minutes: 60 } }).ok).toBe(false);
    expect(planDayTemplateKey({ planId: id(7), dayIndex: 0, mainLiftExerciseId: null })).toBe(`${id(7)}|0|-`);
    // Push on days 1 and 4 of Push/Pull/Legs/Push: two keys.
    expect(planDayTemplateKey({ planId: id(7), dayIndex: 0, mainLiftExerciseId: id(200) })).not.toBe(planDayTemplateKey({ planId: id(7), dayIndex: 3, mainLiftExerciseId: id(200) }));
  });

  it('a plan day still needs an exercise; Apply may record a template per main lift', () => {
    const day = { index: 0, name: 'Chest', splitDayId: 'chest', focus: 'chest', minutes: 60, plan: { slots: [] }, checks: [] };
    expect(validate(PlanDayDraftSchema, day).ok).toBe(false);
    expect(validate(PlanDayDraftSchema, { ...day, plan: { slots: [slot(0)] } }).ok).toBe(true);
    const made = Array.from({ length: 14 }, (_, i) => ({ dayIndex: i % 7, routineId: id(300 + i), version: 1, mainLiftExerciseId: i < 7 ? id(200) : id(201) }));
    expect(validate(PlanAppliedSchema, { mode: 'add', versionN: 1, opId: 'apply', atUtc: T, made, rotationOff: [] }).ok).toBe(true);
  });

  it('variations: template + typed extras, a label of 1–40, tombstoned', () => {
    const v = { ...meta, splitDayId: 'chest', mainLiftExerciseId: id(200), label: 'arms superset', extras: [{ kind: 'add_slot', after: 'end', slot: { exerciseId: id(401), workingSets: 3 } }, { kind: 'add_slot', after: id(203), slot: { exerciseId: id(402) } }, { kind: 'pair', a: id(401), b: id(203) }, { kind: 'set_count', exerciseId: id(203), n: 4 }, { kind: 'remove_slot', exerciseId: id(204) }], deletedAtUtc: null, opIds: ['save-1'] };
    expect(validate(PlanDayVariationSchema, v).ok).toBe(true);
    expect(validate(PlanDayVariationSchema, { ...v, label: ' ' }).ok).toBe(false);
    expect(validate(PlanDayVariationSchema, { ...v, label: 'x'.repeat(41) }).ok).toBe(false);
    expect(validate(VariationOpSchema, { kind: 'pair', a: id(1), b: id(1) }).ok).toBe(false);
    expect(validate(VariationOpSchema, { kind: 'set_count', exerciseId: id(1), n: 11 }).ok).toBe(false);
    expect(validate(VariationOpSchema, { kind: 'rename', label: 'x' }).ok).toBe(false);
    // One `add_slot` shape with S2's applyVariation: the exercise and, optionally, its working sets (S2).
    expect(validate(VariationOpSchema, { kind: 'add_slot', after: 'end', slot: { exerciseId: id(1), workingSets: 11 } }).ok).toBe(false);
    expect(VariationOpSchema.parse({ kind: 'add_slot', after: 'end', slot: { exerciseId: id(1), setTemplates: [] } })).toEqual({ kind: 'add_slot', after: 'end', slot: { exerciseId: id(1) } });
  });

  it('session provenance names a template with its version, or neither', () => {
    const p = { planId: id(7), dayIndex: 0, splitDayId: 'chest', templateRoutineId: id(300), templateVersion: 2, variationId: null };
    expect(validate(SessionPlanDaySchema, p).ok).toBe(true);
    const noIndex: Partial<typeof p> = { ...p };
    delete noIndex.dayIndex;
    expect(validate(SessionPlanDaySchema, noIndex).ok).toBe(false);
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
    expect(validate(TrainingReviewSchema, review).ok).toBe(true);
    expect(validate(TrainingReviewSchema, { ...review, coach: { status: 'offline', verdict: 'Good week' } }).ok).toBe(true); // extra keys are stripped, never shown
    expect(TrainingReviewSchema.parse({ ...review, coach: { status: 'offline', verdict: 'Good week' } }).coach).toEqual({ status: 'offline' });
    expect(validate(TrainingReviewSchema, { ...review, coach: { status: 'reviewed', verdict: 'Solid week', lines: ['Chest sets a bit low'], actionIds: [], numbersChecked: true } }).ok).toBe(true);
  });

  it('an estimate is always labelled; unknown fact kinds fail', () => {
    expect(validate(TrainingReviewSchema, { ...review, facts: [{ kind: 'est_max', exerciseId: id(200), value: { value: 127, unit: 'kg' }, estimate: false }] }).ok).toBe(false);
    expect(validate(TrainingReviewSchema, { ...review, facts: [{ kind: 'recovery_score', value: 80 }] }).ok).toBe(false);
  });

  it('only reviewed or silent settles the coach part; offline and the rest retry (S5)', () => {
    expect(reviewCoachSettled({ status: 'reviewed', verdict: null, lines: [], actionIds: [], numbersChecked: true })).toBe(true);
    expect(reviewCoachSettled({ status: 'silent' })).toBe(true);
    for (const status of ['pending', 'offline', 'not_connected', 'failed'] as const) expect(reviewCoachSettled({ status })).toBe(false);
  });

  it('a superseded review names its successor', () => {
    expect(validate(TrainingReviewSchema, { ...review, status: 'superseded' }).ok).toBe(false);
    expect(validate(TrainingReviewSchema, { ...review, status: 'superseded', supersededById: id(9) }).ok).toBe(true);
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

  it('hiding a day note keeps today and later only, so the cap never refuses a hide (N1)', () => {
    const weekly = Array.from({ length: 14 }, (_, i) => `2026-${String(7 + Math.floor(i / 4)).padStart(2, '0')}-${String(10 + (i % 4)).padStart(2, '0')}`);
    const scope = { splitDayId: 'chest', mainLiftExerciseId: null, reviewId: null, hiddenOn: weekly };
    const next = hideDayNoteOn(scope, '2026-10-20');
    expect(next.hiddenOn).toEqual(['2026-10-20']);
    expect(hideDayNoteOn(next, '2026-10-20').hiddenOn).toEqual(['2026-10-20']);
    expect(validate(MemorySchema, { ...meta, text: 'Include abs', contentKey: 'include abs', status: 'active', quote: 'Include abs', createdByActionId: id(11), dayNote: hideDayNoteOn(scope, '2026-10-27') }).ok).toBe(true);
  });
});
