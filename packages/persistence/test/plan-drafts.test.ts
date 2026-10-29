import { afterEach, describe, expect, it } from 'vitest';

import { addPlanVersion, applyPlan, currentPlanVersion, endPlan, newPlanDraft, pausePlan, pinPlanDay, planRoutines, resumePlan, rotationRoutines, undoEndPlan, undoPlanApply, undoPlanControl } from '@fizz/domain';
import { at, hotelFixture, id, OWNER, profile } from '@fizz/domain/testing';
import { RoutineSchema, type ActionRecord, type PlanDraft, type PlanDraftVersion, type Routine } from '@fizz/schemas';

import { checkIntegrity, createBackup, DatabaseManager, domainOf, exportTables, migrate, MIGRATIONS, openStore, type Store } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { failingDriver, memoryDriver, tempDir } from './helpers';

/**
 * Coach plans in SQLite (19 Oct, migration 20): the coach's write (plan +
 * `build_plan` record in one transaction, idempotent, a stale version
 * refused), Ben's Apply and Undo (the plan and every workout they touch in
 * one transaction: all or nothing, a retried tap replays, a stale card
 * changes nothing), backup and restore (Your data), and a relaunch.
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
  return DatabaseManager.open({ host: nodeDatabaseHost(path), newName: () => `p-${String(Date.now())}-${String((n += 1))}.db` });
}

const PLAN = id(7100);
const { BENCH } = hotelFixture;

const slot = (n: number) => ({ slotKey: id(7300 + n), exerciseId: BENCH, catalogueId: 'barbell-bench-press', order: 0, main: true, supersetGroup: null, setTemplates: [{ setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null, targetRpe: 8, restS: null }] });

function version(days = ['Push', 'Pull', 'Legs'], over: Partial<PlanDraftVersion> = {}): PlanDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(7200),
    turnId: 'turn-1',
    request: { text: 'build me a 3-day plan', gymId: null, origin: 'text' },
    rawArgs: '{"days":[]}',
    days: days.map((name, i) => ({ index: i, name, splitDayId: name.toLowerCase(), focus: 'split_day' as const, minutes: 60, plan: { slots: [slot(i)] }, checks: [] })),
    checks: [],
    rationale: 'Push, pull, legs.',
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    createdAt: at(0),
    ...over,
  };
}

function record(opId: string, p: PlanDraft): ActionRecord {
  const v = currentPlanVersion(p);
  return {
    actionId: v.actionId,
    turnId: 'turn-1',
    opId,
    status: 'committed',
    author: 'coach',
    detail: { kind: 'build_plan', planId: p.id, versionN: v.n, parentN: v.parentN, name: p.name, days: v.days.map((d) => ({ name: d.name, exerciseCount: d.plan.slots.length, leftOut: 0 })), gymName: null },
    failure: null,
    reason: v.rationale,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: v.createdAt,
  };
}

function routine(n: number, name: string): Routine {
  return RoutineSchema.parse({
    id: id(n),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(-1000).utc,
    updatedAtUtc: at(-1000).utc,
    name,
    exercises: [{ id: id(n + 1), exerciseId: BENCH, equipmentId: null, order: 0, supersetGroup: null, setTemplates: [{ id: id(n + 2), setType: 'working', targetLoad: null, targetReps: { min: 6, max: 8 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null }], restBySetType: {}, transitionRestS: null, progressionRuleId: null }],
    source: 'ben',
    inRotation: true,
    rotationAtUtc: at(-1000 + (n - 8000)).utc,
  });
}

async function seeded(store: Store): Promise<PlanDraft> {
  await store.repos.profiles.save(profile(), null);
  await store.repos.routines.save(routine(8000, 'Push A'), null);
  await store.repos.routines.save(routine(8010, 'Pull A'), null);
  const p = newPlanDraft({ id: PLAN, ownerId: OWNER, version: version(), opId: 'plan-1', at: at(0) });
  expect(await store.repos.coach.commit(OWNER, { kind: 'plan_draft', action: record('plan-1', p), plan: p, expectedVersion: null })).toMatchObject({ status: 'written' });
  return p;
}

const apply = (store: Store, opId: string, expectedVersion = 1, mode: 'replace' | 'add' = 'replace', versionN = 1) =>
  store.repos.planDrafts.apply(OWNER, PLAN, (c, live) => applyPlan(c, { expectedVersion, versionN, mode, opId, at: at(100), live }));
const undo = (store: Store, opId: string, expectedVersion: number) => store.repos.planDrafts.undo(OWNER, PLAN, (c, routines) => undoPlanApply(c, { expectedVersion, opId, at: at(200), routines }));
const rotation = async (store: Store) => rotationRoutines(await store.repos.routines.listByOwner(OWNER)).map((r) => r.name);

describe('the coach writes a plan with its record, once (rule 5)', () => {
  it('a replayed opId is the same write; another first plan with the same ID can’t overwrite it; a new version on a stale version writes nothing', async () => {
    const store = await openStore(memoryDriver());
    const p = await seeded(store);
    expect(await store.repos.coach.commit(OWNER, { kind: 'plan_draft', action: record('plan-1', p), plan: p, expectedVersion: null })).toMatchObject({ status: 'replayed' });
    expect(await store.repos.coach.commit(OWNER, { kind: 'plan_draft', action: record('plan-2', p), plan: p, expectedVersion: null })).toEqual({ status: 'conflict', reason: 'already_exists' });
    const v2 = addPlanVersion(p, { version: version(['Upper', 'Lower'], { actionId: id(7201) }), expectedVersion: 1, opId: 'plan-3', at: at(30) });
    if (v2.kind !== 'write') throw new Error(v2.kind);
    expect(await store.repos.coach.commit(OWNER, { kind: 'plan_draft', action: record('plan-3', v2.next), plan: v2.next, expectedVersion: 5 })).toEqual({ status: 'conflict', reason: 'stale_version' });
    expect(await store.repos.coach.commit(OWNER, { kind: 'plan_draft', action: record('plan-3', v2.next), plan: v2.next, expectedVersion: 1 })).toMatchObject({ status: 'written' });
    expect(await store.repos.planDrafts.get(PLAN)).toMatchObject({ currentVersion: 2, name: '2-day plan' });
    expect((await store.repos.coach.getAction(id(7201)))?.detail).toMatchObject({ kind: 'build_plan', versionN: 2, parentN: 1 });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });
});

describe('Apply and Undo: the plan and its workouts in one transaction', () => {
  it('Replace: the plan’s days are the rotation; a retried Apply replays with the same workouts; a second Apply is stale', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const a = await apply(store, 'apply-1');
    expect(a).toMatchObject({ status: 'written', plan: { status: 'applied', version: 2 } });
    expect(await rotation(store)).toEqual(['Push', 'Pull', 'Legs']);
    expect((await store.repos.routines.listByOwner(OWNER)).map((r) => r.name).sort()).toEqual(['Legs', 'Pull', 'Pull A', 'Push', 'Push A']);
    const again = await apply(store, 'apply-1');
    expect(again).toMatchObject({ status: 'replayed' });
    if (again.status !== 'replayed') throw new Error('replay');
    expect(again.routines.map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(await apply(store, 'apply-2', 1)).toMatchObject({ status: 'stale' });
    expect((await store.repos.routines.listByOwner(OWNER))).toHaveLength(5);
    expect(await store.repos.planDrafts.applied(OWNER)).toMatchObject({ id: PLAN });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('Undo restores the setup before Apply; a retried Undo replays; an Undo after Ben edited a plan workout changes nothing', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    await apply(store, 'apply-1');
    const push = (await store.repos.routines.listByOwner(OWNER)).find((r) => r.name === 'Push');
    if (push === undefined) throw new Error('push');
    // Ben renames it: Undo would lose his change, so it is refused and nothing changes.
    await store.repos.routines.save({ ...push, name: 'Push heavy', version: 2, lastOpId: 'rename' }, 1);
    expect(await undo(store, 'undo-1', 2)).toMatchObject({ status: 'changed_since', names: ['Push heavy'] });
    expect(await rotation(store)).toEqual(['Push heavy', 'Pull', 'Legs']);
    await store.repos.routines.save({ ...push, version: 3, lastOpId: 'rename-back' }, 2);
    // Still refused: the version moved on, even with the old name back.
    expect(await undo(store, 'undo-2', 2)).toMatchObject({ status: 'changed_since' });
    await store.close();

    const fresh = await openStore(memoryDriver());
    await seeded(fresh);
    await apply(fresh, 'apply-1');
    expect(await undo(fresh, 'undo-1', 2)).toMatchObject({ status: 'written', plan: { status: 'open', applied: null, version: 3 } });
    expect(await rotation(fresh)).toEqual(['Push A', 'Pull A']);
    expect(await undo(fresh, 'undo-1', 2)).toMatchObject({ status: 'replayed' });
    expect(await undo(fresh, 'undo-3', 3)).toMatchObject({ status: 'stale' });
    // Open again: Add alongside keeps Push A and Pull A in the rotation.
    expect(await apply(fresh, 'apply-3', 3, 'add')).toMatchObject({ status: 'written' });
    expect(await rotation(fresh)).toEqual(['Push A', 'Pull A', 'Push', 'Pull', 'Legs']);
    expect((await checkIntegrity(fresh.db)).ok).toBe(true);
    await fresh.close();
  });

  it('a failed write mid-Apply leaves nothing behind (all or nothing)', async () => {
    // The plan row's write (an upsert of the applied plan) fails after the workouts were written in the same transaction.
    const driver = failingDriver(memoryDriver(), (sql) => sql.includes('"plan_drafts"') && sql.includes('ON CONFLICT'));
    driver.armed = false;
    const store = await openStore(driver);
    await seeded(store);
    driver.armed = true;
    await expect(apply(store, 'apply-1')).rejects.toThrow();
    driver.armed = false;
    expect(await rotation(store)).toEqual(['Push A', 'Pull A']);
    expect((await store.repos.routines.listByOwner(OWNER))).toHaveLength(2);
    expect(await store.repos.planDrafts.get(PLAN)).toMatchObject({ status: 'open', version: 1 });
    await store.close();
  });
});

const end = (store: Store, opId: string, expectedVersion: number) => store.repos.planDrafts.endOrResume(OWNER, PLAN, (c, routines) => endPlan(c, { expectedVersion, opId, at: at(300), routines }));
const resume = (store: Store, opId: string, expectedVersion: number) => store.repos.planDrafts.endOrResume(OWNER, PLAN, (c, routines, otherApplied) => undoEndPlan(c, { expectedVersion, opId, at: at(400), routines, otherApplied }));

describe('End plan and its Undo (migration 22): the plan and its days in one transaction', () => {
  it('End takes the days out of the rotation and keeps them; a retry replays; Undo puts them back; a relaunch reads the ended plan', async () => {
    const d = tempDir();
    dirs.push(d);
    const m = await managerIn(d.dir);
    await seeded(m.store);
    await apply(m.store, 'apply-1');
    expect(await end(m.store, 'end-1', 2)).toMatchObject({ status: 'written', plan: { status: 'ended', version: 3 } });
    expect(await end(m.store, 'end-1', 2)).toMatchObject({ status: 'replayed' });
    expect(await end(m.store, 'end-2', 2)).toMatchObject({ status: 'stale' });
    // (Ben, 20 Oct: option B) the workouts Replace took out are back in the rotation, in their places.
    expect(await rotation(m.store)).toEqual(['Push A', 'Pull A']);
    expect((await m.store.repos.routines.listByOwner(OWNER)).map((r) => r.name).sort()).toEqual(['Legs', 'Pull', 'Pull A', 'Push', 'Push A']);
    expect(await m.store.repos.planDrafts.applied(OWNER)).toBeNull();
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    await m.close();
    const again = await managerIn(d.dir);
    expect(await again.store.repos.planDrafts.get(PLAN)).toMatchObject({ status: 'ended' });
    expect(await resume(again.store, 'resume-1', 3)).toMatchObject({ status: 'written', plan: { status: 'applied', version: 4 } });
    expect(await resume(again.store, 'resume-1', 3)).toMatchObject({ status: 'replayed' });
    expect(await rotation(again.store)).toEqual(['Push', 'Pull', 'Legs']);
    expect(await again.store.repos.planDrafts.applied(OWNER)).toMatchObject({ id: PLAN });
    await again.close();
  });

  it('a failed write mid-End leaves nothing behind (all or nothing)', async () => {
    const driver = failingDriver(memoryDriver(), (sql) => sql.includes('"plan_drafts"') && sql.includes('ON CONFLICT'));
    driver.armed = false;
    const store = await openStore(driver);
    await seeded(store);
    await apply(store, 'apply-1');
    driver.armed = true;
    await expect(end(store, 'end-1', 2)).rejects.toThrow();
    driver.armed = false;
    expect(await rotation(store)).toEqual(['Push', 'Pull', 'Legs']);
    expect(await store.repos.planDrafts.get(PLAN)).toMatchObject({ status: 'applied', version: 2 });
    await store.close();
  });

  it('migration 22 keeps every plan row; before it, an ended plan can’t be stored', async () => {
    const old = memoryDriver();
    const at21 = await openStore(old, { migrations: MIGRATIONS.filter((x) => x.version <= 21) });
    await seeded(at21);
    await apply(at21, 'apply-1');
    await expect(end(at21, 'end-1', 2)).rejects.toThrow();
    expect(await migrate(old)).toMatchObject({ from: 21, to: 39, applied: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39] });
    const at22 = await openStore(old);
    expect(await at22.repos.planDrafts.get(PLAN)).toMatchObject({ status: 'applied', version: 2 });
    expect(await end(at22, 'end-1', 2)).toMatchObject({ status: 'written' });
    expect((await checkIntegrity(at22.db)).ok).toBe(true);
    await at22.close();
  });
});

describe('Make next, pause and resume (Ben, 20 Oct): versioned writes on the plan, kept across a relaunch and a backup', () => {
  it('pin, pause, resume and Undo round-trip; a retry replays; a stale version writes nothing; End restores Push A and Pull A in the same transaction', async () => {
    const d = tempDir();
    dirs.push(d);
    const m = await managerIn(d.dir);
    await seeded(m.store);
    await apply(m.store, 'apply-1');
    const control = (make: Parameters<Store['repos']['planDrafts']['control']>[2]) => m.store.repos.planDrafts.control(OWNER, PLAN, make);
    const days = async () => planRoutines(await m.store.repos.planDrafts.get(PLAN), await m.store.repos.routines.listByOwner(OWNER));
    const legs = (await days())[2];
    if (legs === undefined) throw new Error('legs');
    const pin = (opId: string, v: number) => control((c, routines) => pinPlanDay(c, { expectedVersion: v, opId, at: at(500), routineId: legs.id, days: planRoutines(c, routines) }));
    expect(await pin('pin-1', 2)).toMatchObject({ status: 'written', plan: { version: 3, pin: { routineId: legs.id } } });
    expect(await pin('pin-1', 2)).toMatchObject({ status: 'replayed' });
    expect(await pin('pin-2', 2)).toMatchObject({ status: 'stale' });
    expect(await control((c) => pausePlan(c, { expectedVersion: 3, opId: 'pause-1', at: at(600), untilDate: '2026-11-03', tz: 'Pacific/Auckland' }))).toMatchObject({ status: 'written', plan: { version: 4 } });
    expect(await control((c) => pausePlan(c, { expectedVersion: 4, opId: 'pause-2', at: at(600), untilDate: '2020-01-01', tz: 'Pacific/Auckland' }))).toMatchObject({ status: 'invalid' });
    expect(await control((c) => undoPlanControl(c, { expectedVersion: 4, opId: 'u-1', at: at(700), targetOpId: 'pause-1' }))).toMatchObject({ status: 'written', plan: { version: 5, pauses: [] } });
    expect(await control((c) => pausePlan(c, { expectedVersion: 5, opId: 'pause-3', at: at(800), untilDate: null, tz: 'Pacific/Auckland' }))).toMatchObject({ status: 'written' });
    expect(await control((c) => resumePlan(c, { expectedVersion: 6, opId: 'resume-1', at: at(900), tz: 'Pacific/Auckland' }))).toMatchObject({ status: 'written', plan: { version: 7 } });
    const before = await m.store.repos.planDrafts.get(PLAN);
    expect(before?.pauses).toHaveLength(1);
    expect(before?.pin?.routineId).toBe(legs.id);
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    const made = await createBackup(m.store, { at: at(950), app: { name: 'GymSmarter', version: '0.1.0', build: null } });
    await m.close();

    const again = await managerIn(d.dir);
    expect(await again.store.repos.planDrafts.get(PLAN)).toEqual(before);
    // End: the days out and Push A and Pull A back, together.
    expect(await again.store.repos.planDrafts.endOrResume(OWNER, PLAN, (c, routines) => endPlan(c, { expectedVersion: 7, opId: 'end-1', at: at(1000), routines }))).toMatchObject({ status: 'written', plan: { status: 'ended', ended: { notRestored: [] } } });
    expect(rotationRoutines(await again.store.repos.routines.listByOwner(OWNER)).map((r) => r.name)).toEqual(['Push A', 'Pull A']);
    expect(await again.store.repos.planDrafts.endOrResume(OWNER, PLAN, (c, routines, other) => undoEndPlan(c, { expectedVersion: 8, opId: 'resume-end', at: at(1100), routines, otherApplied: other }))).toMatchObject({ status: 'written' });
    expect(rotationRoutines(await again.store.repos.routines.listByOwner(OWNER)).map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs']);
    await again.close();

    const dst = await managerIn();
    expect(await dst.restore(made.text, at(1200))).toMatchObject({ ok: true });
    expect(await dst.store.repos.planDrafts.get(PLAN)).toEqual(before);
    await dst.close();
  });
});

describe('Your data: backup, restore, relaunch (rule 10)', () => {
  it('plans are Your data; a backup carries an applied plan and its workouts; a relaunch and a restore read them back', async () => {
    expect(domainOf('plan_drafts', {})).toBe('your_data');
    const d = tempDir();
    dirs.push(d);
    const src = await managerIn(d.dir);
    await seeded(src.store);
    await apply(src.store, 'apply-1');
    const applied = await src.store.repos.planDrafts.get(PLAN);
    expect((await src.store.db.read((q) => exportTables(q))).plan_drafts).toHaveLength(1);
    const made = await createBackup(src.store, { at: at(300), app: { name: 'GymSmarter', version: '0.1.0', build: null } });
    await src.close();

    const again = await managerIn(d.dir);
    expect(await again.store.repos.planDrafts.get(PLAN)).toEqual(applied);
    expect(await rotation(again.store)).toEqual(['Push', 'Pull', 'Legs']);
    await again.close();

    const dst = await managerIn();
    expect(await dst.restore(made.text, at(400))).toMatchObject({ ok: true });
    expect(await dst.store.repos.planDrafts.get(PLAN)).toEqual(applied);
    // Undo still works after a restore: the workouts are at the versions Apply left.
    expect(await undo(dst.store, 'undo-r', 2)).toMatchObject({ status: 'written' });
    expect(await rotation(dst.store)).toEqual(['Push A', 'Pull A']);
    await dst.close();
  });
});
