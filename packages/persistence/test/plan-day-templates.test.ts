import { afterEach, describe, expect, it } from 'vitest';

import { applyPlan, currentPlanVersion, endPlan, newPlanDraft, undoPlanApply } from '@fizz/domain';
import { at, hotelFixture, id, OWNER, profile, richFinishedSession } from '@fizz/domain/testing';
import {
  RoutineSchema,
  type ActionRecord,
  type BuilderDraftKey,
  type PlanDayVariation,
  type PlanDraft,
  type PlanDraftVersion,
  type Review,
  type Routine,
  type WorkoutDraft,
  type WorkoutDraftVersion,
} from '@fizz/schemas';

import {
  checkIntegrity,
  createBackup,
  DatabaseManager,
  domainOf,
  exportTables,
  latestVersion,
  migrate,
  MIGRATIONS,
  openStore,
  parseBackup,
  sha256Hex,
  startWorkoutDraftIn,
  type BackupFile,
  type Store,
} from '../src/index';
import { stableStringify } from '@fizz/domain';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir, withoutSchema30 } from './helpers';

/**
 * Workout builder v3, slice S1 in SQLite (migration 30; Ben approved 20 Oct):
 * one template per (plan, split day, main lift) inside the write; variations
 * keyed by split day + main lift (max 5, Undo, survive a plan's Undo and End,
 * carried to a new plan); one open builder draft per key and date, empty
 * while open, never started empty; session plan-day provenance; reviews with
 * facts apart from coach text; all Your data through backup, restore, export
 * and `Delete my data`; older databases and backups migrate unchanged.
 */

let dirs: { dir: string; cleanup: () => void }[] = [];
afterEach(() => {
  for (const d of dirs) d.cleanup();
  dirs = [];
});
function managerIn(dir?: string): Promise<DatabaseManager> {
  let path = dir;
  if (path === undefined) {
    const d = tempDir();
    dirs.push(d);
    path = d.dir;
  }
  let n = 0;
  return DatabaseManager.open({ host: nodeDatabaseHost(path), newName: () => `v3-${String(Date.now())}-${String((n += 1))}.db` });
}

const APP = { name: 'GymSmarter', version: '0.1.0', build: null };
const PLAN = id(9100);
const PLAN_2 = id(9101);
const INCLINE = id(9050);
const { BENCH } = hotelFixture;

function template(n: number, over: Partial<Routine> = {}): Routine {
  return RoutineSchema.parse({
    id: id(n),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(0).utc,
    updatedAtUtc: at(0).utc,
    name: 'Chest · bench',
    exercises: [{ id: id(n + 1), exerciseId: BENCH, equipmentId: null, order: 0, supersetGroup: null, setTemplates: [{ id: id(n + 2), setType: 'working', targetLoad: null, targetReps: { min: 6, max: 8 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null }], restBySetType: {}, transitionRestS: null, progressionRuleId: null, main: true }],
    source: 'coach',
    planDay: { planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: BENCH, minutes: 60 },
    ...over,
  });
}

function variation(n: number, over: Partial<PlanDayVariation> = {}): PlanDayVariation {
  return {
    id: id(n),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(n).utc,
    updatedAtUtc: at(n).utc,
    splitDayId: 'chest',
    mainLiftExerciseId: BENCH,
    label: `variation ${String(n)}`,
    extras: [{ kind: 'set_count', exerciseId: BENCH, n: 5 }],
    deletedAtUtc: null,
    opIds: [`save-${String(n)}`],
    ...over,
  };
}

const KEY: BuilderDraftKey = { planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: BENCH, localDate: '2026-10-08' };

function builderVersion(slots: WorkoutDraftVersion['plan']['slots']): WorkoutDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(9300),
    turnId: 'manual',
    request: { text: '', minutes: 60, focus: 'split_day', gymId: null, origin: 'builder', day: { name: 'Chest', bodyParts: ['Chest'] }, setup: { dayId: 'chest', minutes: 60, mainLiftExerciseId: BENCH, supersets: true, groups: [{ parts: ['Chest'], count: 4 }] } },
    rawArgs: '',
    plan: { slots },
    fitMinutes: 60,
    checks: [],
    rationale: null,
    contextHash: 'setup-hash',
    equipmentVersion: 'eq',
    createdAt: at(0),
  };
}

const benchSlot = { slotKey: id(9310), exerciseId: BENCH, catalogueId: 'barbell-bench-press', order: 0, main: true, supersetGroup: null, setTemplates: [{ setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null, targetRpe: 8, restS: 180 }], rev: 1 };

function builderDraft(n: number, slots: WorkoutDraftVersion['plan']['slots'] = [], key: BuilderDraftKey = KEY): WorkoutDraft {
  return {
    id: id(n),
    ownerId: OWNER,
    status: 'open',
    name: 'Chest · Bench',
    currentVersion: 1,
    versions: [builderVersion(slots)],
    sessionId: null,
    startedAtUtc: null,
    routineId: null,
    discardedAtUtc: null,
    opIds: [`open-${String(n)}`],
    createdAt: at(0),
    tz: at(0).tz,
    expiresAtUtc: at(14 * 86_400).utc,
    version: 1,
    updatedAtUtc: at(0).utc,
    builderKey: key,
  };
}

function review(n: number, inputsHash: string, over: Partial<Review> = {}): Review {
  return {
    id: id(n),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(n).utc,
    updatedAtUtc: at(n).utc,
    subject: { kind: 'weekly', weekMonday: '2026-10-05' },
    inputsHash,
    facts: [{ kind: 'sessions_vs_plan', done: 3, planned: 4 }],
    coach: { status: 'pending' },
    status: 'current',
    supersededById: null,
    opIds: [`review-${String(n)}`],
    createdAt: at(n),
    ...over,
  };
}

// A plan applied the existing way (one workout per day), for Undo and End.
const planSlot = { slotKey: id(9400), exerciseId: BENCH, catalogueId: 'barbell-bench-press', order: 0, main: true, supersetGroup: null, setTemplates: [{ setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null, targetRpe: 8, restS: null }] };
function planVersion(): PlanDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(9410),
    turnId: 'turn-1',
    request: { text: 'a 2-day plan', gymId: null, origin: 'text' },
    rawArgs: '{}',
    days: ['Chest', 'Legs'].map((name, i) => ({ index: i, name, splitDayId: name.toLowerCase(), focus: 'split_day' as const, minutes: 60, plan: { slots: [planSlot] }, checks: [] })),
    checks: [],
    rationale: null,
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    createdAt: at(0),
  };
}
function planRecord(opId: string, p: PlanDraft): ActionRecord {
  const v = currentPlanVersion(p);
  return {
    actionId: v.actionId,
    turnId: 'turn-1',
    opId,
    status: 'committed',
    author: 'coach',
    detail: { kind: 'build_plan', planId: p.id, versionN: v.n, parentN: v.parentN, name: p.name, days: v.days.map((d) => ({ name: d.name, exerciseCount: d.plan.slots.length, leftOut: 0 })), gymName: null },
    failure: null,
    reason: null,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: v.createdAt,
  };
}
async function appliedPlan(store: Store, planId: string): Promise<void> {
  const p = newPlanDraft({ id: planId, ownerId: OWNER, version: { ...planVersion(), actionId: planId === PLAN ? id(9410) : id(9411) }, opId: `plan-${planId}`, at: at(0) });
  expect(await store.repos.coach.commit(OWNER, { kind: 'plan_draft', action: planRecord(`plan-${planId}`, p), plan: p, expectedVersion: null })).toMatchObject({ status: 'written' });
  expect(await store.repos.planDrafts.apply(OWNER, planId, (c, live) => applyPlan(c, { expectedVersion: 1, versionN: 1, mode: 'add', opId: `apply-${planId}`, at: at(100), live }))).toMatchObject({ status: 'written' });
}

describe('migration 30 in place on a schema-29 database', () => {
  it('keeps every row as it was (no backfill: keys are derived when read); adds the tables and indexes; Your data', async () => {
    const db = memoryDriver();
    const at29 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 29) });
    await at29.repos.profiles.save(profile(), null);
    await appliedPlan(at29, PLAN);
    await at29.repos.sessions.save(richFinishedSession(), null);
    const before = await at29.db.read((q) => exportTables(q));
    expect(await migrate(db)).toEqual({ from: 29, to: 30, applied: [30] });
    const at30 = await openStore(db);
    const after = await at30.db.read((q) => exportTables(q));
    // Every older table keeps its rows; sessions gain only an empty `plan_day`.
    for (const [t, rows] of Object.entries(before)) {
      if (t === 'sessions') expect(after.sessions).toEqual(rows.map((r) => ({ ...r, plan_day: null })));
      else expect(after[t]).toEqual(rows);
    }
    expect(after.plan_day_variations).toEqual([]);
    expect(after.reviews).toEqual([]);
    // Plan workouts from before v3 have no `planDay` written (derived on read, never on write).
    const routines = await at30.repos.routines.listByOwner(OWNER);
    expect(routines.length).toBe(2);
    expect(routines.every((r) => r.planDay === undefined && r.createdFromPlan?.planId === PLAN)).toBe(true);
    expect((await at30.repos.sessions.get(richFinishedSession().session.id))?.session.planDay).toBeUndefined();
    expect((await checkIntegrity(at30.db)).ok).toBe(true);
    const indexes = await db.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('routines_plan_day', 'workout_drafts_open_builder', 'reviews_current', 'plan_day_variations_key') ORDER BY name");
    expect(indexes.map((r) => r.name)).toEqual(['plan_day_variations_key', 'reviews_current', 'routines_plan_day', 'workout_drafts_open_builder']);
    expect(domainOf('plan_day_variations', {})).toBe('your_data');
    expect(domainOf('reviews', {})).toBe('your_data');
    await at30.close();
  });
});

describe('templates: one per (plan, split day, main lift) inside the write (§4.2)', () => {
  it('two main lifts per day; a second Chest · bench is refused; deleting frees the key; another plan has its own', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const r = store.repos.routines;
    expect(await r.saveTemplate(template(9000), null)).toMatchObject({ ok: true });
    expect(await r.saveTemplate(template(9010, { name: 'Chest · incline', planDay: { planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: INCLINE, minutes: 55 } }), null)).toMatchObject({ ok: true });
    expect(await r.saveTemplate(template(9020), null)).toEqual({ ok: false, error: 'duplicate_template', existingId: id(9000) });
    // Any other path is held by the unique index: the write fails, nothing is stored.
    await expect(r.save(template(9020), null)).rejects.toThrow(/UNIQUE/);
    expect(await r.get(id(9020))).toBeNull();
    // Re-saving the same template (a new version) is fine.
    expect(await r.saveTemplate({ ...template(9000), version: 2, planDay: { planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: BENCH, minutes: 50 } }, 1)).toMatchObject({ ok: true });
    expect((await r.listTemplates(OWNER, PLAN)).map((x) => x.name).sort()).toEqual(['Chest · bench', 'Chest · incline']);
    expect((await r.templateFor(OWNER, { planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: INCLINE }))?.id).toBe(id(9010));
    expect(await r.templateFor(OWNER, { planId: PLAN, splitDayId: 'legs', mainLiftExerciseId: null })).toBeNull();
    // A deleted template frees the key.
    expect(await r.saveTemplate({ ...template(9000), version: 3, deletedAtUtc: at(10).utc }, 2)).toMatchObject({ ok: true });
    expect(await r.saveTemplate(template(9020), null)).toMatchObject({ ok: true });
    // The same day under another plan is another key.
    expect(await r.saveTemplate(template(9030, { planDay: { planId: PLAN_2, splitDayId: 'chest', mainLiftExerciseId: BENCH, minutes: 60 } }), null)).toMatchObject({ ok: true });
    // A stale version is refused as before (rule 5).
    expect(await r.saveTemplate({ ...template(9010, { planDay: { planId: PLAN, splitDayId: 'chest', mainLiftExerciseId: INCLINE, minutes: 55 } }), version: 2 }, 5)).toMatchObject({ ok: false, error: 'conflict' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });
});

describe('variations (§4.3, Q10)', () => {
  it('versioned and idempotent; max 5 live per key; one label per key; delete is a tombstone and Undo respects the limit', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const v = store.repos.planDayVariations;
    for (let n = 1; n <= 5; n += 1) expect(await v.saveVariation(OWNER, variation(9500 + n), null, `save-${String(9500 + n)}`)).toMatchObject({ status: 'written' });
    // A double tap replays; a 6th is refused (Limit reached); another main lift has its own 5.
    expect(await v.saveVariation(OWNER, variation(9501), null, 'save-9501')).toMatchObject({ status: 'replayed' });
    expect(await v.saveVariation(OWNER, variation(9506), null, 'save-9506')).toEqual({ status: 'limit' });
    expect(await v.saveVariation(OWNER, variation(9506, { mainLiftExerciseId: INCLINE }), null, 'save-9506')).toMatchObject({ status: 'written' });
    expect(await v.saveVariation(OWNER, variation(9507, { mainLiftExerciseId: INCLINE, label: ' VARIATION 9506 ' }), null, 'save-9507')).toEqual({ status: 'duplicate_label' });
    // Rename at a stale version: refused.
    const renamed = { ...variation(9501), label: 'arms superset', version: 2, opIds: ['save-9501', 'rename-1'] };
    expect(await v.saveVariation(OWNER, renamed, 3, 'rename-1')).toMatchObject({ status: 'stale' });
    expect(await v.saveVariation(OWNER, renamed, 1, 'rename-1')).toMatchObject({ status: 'written', variation: { label: 'arms superset' } });
    // Delete (tombstone) frees a place; Undo of the delete is refused once a 5th took it.
    const deleted = { ...renamed, version: 3, deletedAtUtc: at(50).utc, opIds: [...renamed.opIds, 'delete-1'] };
    expect(await v.saveVariation(OWNER, deleted, 2, 'delete-1')).toMatchObject({ status: 'written' });
    expect((await v.listFor(OWNER, 'chest', BENCH)).length).toBe(4);
    expect(await v.saveVariation(OWNER, variation(9508), null, 'save-9508')).toMatchObject({ status: 'written' });
    const undone = { ...deleted, version: 4, deletedAtUtc: null, opIds: [...deleted.opIds, 'undo-1'] };
    expect(await v.saveVariation(OWNER, undone, 3, 'undo-1')).toEqual({ status: 'limit' });
    expect(await v.saveVariation(OWNER, { ...variation(9508), version: 2, deletedAtUtc: at(60).utc, opIds: ['save-9508', 'delete-2'] }, 1, 'delete-2')).toMatchObject({ status: 'written' });
    expect(await v.saveVariation(OWNER, undone, 3, 'undo-1')).toMatchObject({ status: 'written', variation: { label: 'arms superset', deletedAtUtc: null } });
    // Another owner's write and an op ID not recorded are refused.
    expect(await v.saveVariation(id(99), variation(9509), null, 'save-9509')).toMatchObject({ status: 'invalid' });
    expect(await v.saveVariation(OWNER, variation(9509), null, 'other-op')).toMatchObject({ status: 'invalid' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('survive a plan’s Undo and End, and a new plan with Chest · bench picks them up (keyed by split day, not plan)', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    await appliedPlan(store, PLAN);
    expect(await store.repos.planDayVariations.saveVariation(OWNER, variation(9601), null, 'save-9601')).toMatchObject({ status: 'written' });
    const before = await store.repos.planDayVariations.listByOwner(OWNER);
    expect(await store.repos.planDrafts.undo(OWNER, PLAN, (c, routines) => undoPlanApply(c, { expectedVersion: 2, opId: 'undo-plan', at: at(200), routines }))).toMatchObject({ status: 'written' });
    expect(await store.repos.planDayVariations.listByOwner(OWNER)).toEqual(before);
    await appliedPlan(store, PLAN_2);
    expect(await store.repos.planDrafts.endOrResume(OWNER, PLAN_2, (c, routines) => endPlan(c, { expectedVersion: 2, opId: 'end-plan', at: at(300), routines }))).toMatchObject({ status: 'written' });
    expect(await store.repos.planDayVariations.listByOwner(OWNER)).toEqual(before);
    // Whatever plan is in use, Chest · bench lists the same variations.
    expect((await store.repos.planDayVariations.listFor(OWNER, 'chest', BENCH)).map((x) => x.id)).toEqual([id(9601)]);
    await store.close();
  });
});

describe('builder drafts (§4.4)', () => {
  it('one open draft per key and date, resumed; empty while open; Start refuses it empty; started frees the key', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const d = store.repos.workoutDrafts;
    expect(await d.createBuilderDraft(OWNER, builderDraft(9700))).toMatchObject({ status: 'written', draft: { versions: [{ plan: { slots: [] } }] } });
    expect(await d.createBuilderDraft(OWNER, builderDraft(9700))).toMatchObject({ status: 'replayed' });
    // Reopening makes a new draft for the same key: the open one is returned to resume.
    expect(await d.createBuilderDraft(OWNER, builderDraft(9701))).toMatchObject({ status: 'exists', draft: { id: id(9700) } });
    expect((await d.openBuilderDraft(OWNER, KEY))?.id).toBe(id(9700));
    // Another main lift, another date, no plan: other keys.
    expect(await d.createBuilderDraft(OWNER, builderDraft(9702, [], { ...KEY, mainLiftExerciseId: INCLINE }))).toMatchObject({ status: 'written' });
    expect(await d.createBuilderDraft(OWNER, builderDraft(9703, [], { ...KEY, localDate: '2026-10-09' }))).toMatchObject({ status: 'written' });
    expect(await d.createBuilderDraft(OWNER, builderDraft(9704, [], { planId: null, splitDayId: null, mainLiftExerciseId: null, localDate: '2026-10-09' }))).toMatchObject({ status: 'written' });
    expect(await d.createBuilderDraft(OWNER, builderDraft(9705, [], { planId: null, splitDayId: null, mainLiftExerciseId: null, localDate: '2026-10-09' }))).toMatchObject({ status: 'exists', draft: { id: id(9704) } });
    expect((await d.earlierOpenBuilderDrafts(OWNER, '2026-10-09')).map((x) => x.id).sort()).toEqual([id(9700), id(9702)]);
    // The unique index holds on any path.
    await expect(d.save(builderDraft(9706), null)).rejects.toThrow(/UNIQUE/);
    // Start refuses an empty workout; the draft stays open.
    expect(await store.db.write((tx) => startWorkoutDraftIn(tx, id(9700), OWNER, id(9799), at(10).utc))).toBe(false);
    expect(await d.get(id(9700))).toMatchObject({ status: 'open', version: 1 });
    // With an exercise it starts, and the key is free for a second workout that day.
    const filled: WorkoutDraft = { ...builderDraft(9700, [benchSlot]), version: 2, opIds: ['open-9700', 'add-bench'], undo: { opId: 'add-bench', atVersion: 2, snapshot: { currentVersion: 1, setup: builderVersion([]).request.setup ?? null, plan: { slots: [] } } } };
    expect(await d.save(filled, 1)).toMatchObject({ ok: true });
    expect(await store.db.write((tx) => startWorkoutDraftIn(tx, id(9700), OWNER, id(9799), at(10).utc))).toBe(true);
    expect(await d.get(id(9700))).toMatchObject({ status: 'started', sessionId: id(9799) });
    expect(await d.createBuilderDraft(OWNER, builderDraft(9707))).toMatchObject({ status: 'written' });
    // The undo snapshot survived the write and reads back (force-close).
    expect((await d.get(id(9700)))?.undo).toMatchObject({ opId: 'add-bench', atVersion: 2 });
    expect(await d.createBuilderDraft(id(99), builderDraft(9708))).toMatchObject({ status: 'invalid' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });
});

describe('session plan-day provenance (§4.2)', () => {
  it('round-trips and reaches the finished refs Up next reads', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const plain = richFinishedSession();
    const a = { ...plain, session: { ...plain.session, planDay: { planId: PLAN, splitDayId: 'chest', templateRoutineId: null, templateVersion: null, variationId: id(9601) } } };
    expect(await store.repos.sessions.save(a, null)).toMatchObject({ ok: true });
    expect((await store.repos.sessions.get(a.session.id))?.session.planDay).toEqual(a.session.planDay);
    const refs = await store.repos.sessions.listFinishedRefs(OWNER, 5, { includeImported: true });
    expect(refs[0]).toMatchObject({ sessionId: a.session.id, planDay: { planId: PLAN, splitDayId: 'chest', variationId: id(9601) } });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });
});

describe('reviews (§6.1, §6.2)', () => {
  it('one current review per subject; the same inputs don’t re-run; new inputs supersede; the coach part lands later, versioned', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const r = store.repos.reviews;
    expect(await r.record(OWNER, review(9801, 'h1'))).toMatchObject({ status: 'written' });
    expect(await r.record(OWNER, review(9801, 'h1'))).toMatchObject({ status: 'replayed' });
    expect(await r.record(OWNER, review(9802, 'h1'))).toMatchObject({ status: 'unchanged', review: { id: id(9801) } });
    expect(await r.record(OWNER, review(9803, 'h2'))).toMatchObject({ status: 'written' });
    expect(await r.get(id(9801))).toMatchObject({ status: 'superseded', supersededById: id(9803), version: 2 });
    expect((await r.current(OWNER, { kind: 'weekly', weekMonday: '2026-10-05' }))?.id).toBe(id(9803));
    // Coach text arrives after the facts: a versioned update; a stale one changes nothing.
    const reviewed: Review = { ...review(9803, 'h2'), version: 2, coach: { status: 'reviewed', verdict: 'Three of four days', lines: [], actionIds: [], numbersChecked: true }, opIds: ['review-9803', 'coach-1'] };
    expect(await r.update(OWNER, reviewed, 5, 'coach-1')).toMatchObject({ status: 'stale' });
    expect(await r.update(OWNER, reviewed, 1, 'coach-1')).toMatchObject({ status: 'written' });
    expect(await r.update(OWNER, reviewed, 1, 'coach-1')).toMatchObject({ status: 'replayed' });
    // The facts are kept apart from the coach's words.
    expect(await r.get(id(9803))).toMatchObject({ facts: [{ kind: 'sessions_vs_plan', done: 3, planned: 4 }], coach: { status: 'reviewed', verdict: 'Three of four days' } });
    expect(await r.record(OWNER, review(9804, 'h1', { subject: { kind: 'weekly', weekMonday: '2026-10-12' }, createdAt: at(9900) }))).toMatchObject({ status: 'written' });
    expect((await r.listCurrent(OWNER, 'weekly', 10)).map((x) => x.id)).toEqual([id(9804), id(9803)]);
    expect(await r.record(OWNER, review(9805, 'h1', { status: 'superseded', supersededById: id(1) }))).toMatchObject({ status: 'invalid' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });
});

describe('backup, restore, export, delete (rule 10)', () => {
  async function populate(store: Store): Promise<void> {
    await store.repos.profiles.save(profile(), null);
    expect(await store.repos.routines.saveTemplate(template(9000), null)).toMatchObject({ ok: true });
    expect(await store.repos.planDayVariations.saveVariation(OWNER, variation(9601), null, 'save-9601')).toMatchObject({ status: 'written' });
    expect(await store.repos.workoutDrafts.createBuilderDraft(OWNER, builderDraft(9700))).toMatchObject({ status: 'written' });
    expect(await store.repos.reviews.record(OWNER, review(9801, 'h1'))).toMatchObject({ status: 'written' });
    const plain = richFinishedSession();
    await store.repos.sessions.save({ ...plain, session: { ...plain.session, planDay: { planId: PLAN, splitDayId: 'chest', templateRoutineId: id(9000), templateVersion: 1, variationId: null } } }, null);
  }

  it('a backup round trip keeps templates, variations, builder drafts, reviews and provenance; the key still holds after restore', async () => {
    const src = await managerIn();
    await populate(src.store);
    const before = await src.store.db.read((q) => exportTables(q));
    const made = await createBackup(src.store, { at: at(500), app: APP });
    for (const t of ['plan_day_variations', 'reviews']) expect(made.text).toContain(`"${t}"`);
    await src.close();
    const dst = await managerIn();
    expect(await dst.restore(made.text, at(600))).toMatchObject({ ok: true, status: 'restored' });
    expect(await dst.store.db.read((q) => exportTables(q))).toEqual(before);
    expect((await checkIntegrity(dst.store.db)).ok).toBe(true);
    expect(await dst.store.repos.routines.saveTemplate(template(9020), null)).toMatchObject({ ok: false, error: 'duplicate_template' });
    expect(await dst.store.repos.workoutDrafts.createBuilderDraft(OWNER, builderDraft(9701))).toMatchObject({ status: 'exists' });
    await dst.close();
  });

  it('export My data carries them; Coaching knowledge doesn’t; Delete my data removes them', async () => {
    const m = await managerIn();
    await populate(m.store);
    const mine = await m.exportDomain('your_data');
    expect(mine.tables.plan_day_variations).toHaveLength(1);
    expect(mine.tables.reviews).toHaveLength(1);
    expect(mine.tables.routines?.some((r) => (r.data as Routine).planDay !== undefined)).toBe(true);
    const known = await m.exportDomain('coaching_knowledge');
    expect(known.tables.plan_day_variations).toBeUndefined();
    expect(known.tables.reviews).toBeUndefined();
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    const left = await m.store.db.read((q) => exportTables(q));
    for (const t of ['plan_day_variations', 'reviews', 'routines', 'workout_drafts', 'sessions']) expect(left[t]).toEqual([]);
    await m.close();
  });

  it('a schema-29 backup (before v3) restores, migrates and reads with empty v3 tables', async () => {
    const src = await managerIn();
    await src.store.repos.profiles.save(profile(), null);
    await appliedPlan(src.store, PLAN);
    await src.store.repos.sessions.save(richFinishedSession(), null);
    const made = await createBackup(src.store, { at: at(500), app: APP });
    await src.close();
    const parsed = await parseBackup(made.text);
    if (!parsed.ok) throw new Error('backup');
    const tables = withoutSchema30({ ...parsed.file.tables });
    const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
    const body: Partial<BackupFile> = { ...parsed.file, schemaVersion: 29, tables, counts };
    delete body.checksum;
    const text = JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });
    const dst = await managerIn();
    expect(await dst.restore(text, at(600))).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(await dst.store.db.read((q) => q.getFirst<{ user_version: number }>('PRAGMA user_version'))).toEqual({ user_version: latestVersion() });
    expect(await dst.store.repos.planDayVariations.listByOwner(OWNER)).toEqual([]);
    expect(await dst.store.repos.reviews.listByOwner(OWNER)).toEqual([]);
    expect((await dst.store.repos.sessions.get(richFinishedSession().session.id))?.session.planDay).toBeUndefined();
    expect((await dst.store.repos.routines.listByOwner(OWNER)).every((r) => r.createdFromPlan?.planId === PLAN && r.planDay === undefined)).toBe(true);
    expect((await checkIntegrity(dst.store.db)).ok).toBe(true);
    await dst.close();
  });
});
