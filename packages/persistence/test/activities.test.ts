import { afterEach, describe, expect, it } from 'vitest';

import { addActivity, applyWeekPlan, deleteActivity, editActivity, mergedExercises, undoActivity, undoWeekPlan, type WeekProposal } from '@fizz/domain';
import { at, id, idGen, OWNER, profile, routineExercise } from '@fizz/domain/testing';
import type { ActionRecord, ActivityFields } from '@fizz/schemas';

import { checkIntegrity, createBackup, DatabaseManager, domainOf, exportTables, migrate, MIGRATIONS } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * Activities and week overrides in SQLite (Ben, 20 Oct, migration 26):
 * versioned, idempotent writes; a coach-logged activity and its record in one
 * write, with Undo; a week change and its merged day together (all or
 * nothing); Your data in backups, restore and a relaunch.
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
  return DatabaseManager.open({ host: nodeDatabaseHost(path), newName: () => `a-${String(Date.now())}-${String((n += 1))}.db` });
}

const RUN: ActivityFields = { kind: 'run', status: 'planned', date: '2026-10-10', durationS: null, distanceM: 18_000, effort: 'long' };
const APP = { name: 'GymSmarter', version: '0.1.0', build: null };

function added(n: number, fields: ActivityFields = RUN) {
  const c = addActivity({ id: id(n), ownerId: OWNER, fields, source: 'ben', opId: `add-${String(n)}`, at: at(0) });
  if (c.kind !== 'write') throw new Error(c.kind);
  return c;
}

describe('migration 26 in place on a schema-25 database', () => {
  it('adds activities and week_plans; coach_actions keeps every row and takes the new kinds', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 25);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;
    await db.run(row('a1', 'pause_plan'));
    await expect(db.run(row('a2', 'log_activity'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db)).toEqual({ from: 25, to: 26, applied: [26] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a2', 'log_activity'));
    await db.run(row('a3', 'propose_week'));
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('activities', 'week_plans') ORDER BY name")).toEqual([{ name: 'activities' }, { name: 'week_plans' }]);
    expect(domainOf('activities', {})).toBe('your_data');
    expect(domainOf('week_plans', {})).toBe('your_data');
  });
});

describe('activities: versioned writes, Undo, backup and restore', () => {
  it('add replays on a retry; an edit on an old version is stale; Undo; a relaunch and a restore read them back', async () => {
    const d = tempDir();
    dirs.push(d);
    const m = await managerIn(d.dir);
    await m.store.repos.profiles.save(profile(), null);
    const acts = m.store.repos.activities;
    expect(await acts.add(OWNER, added(1))).toMatchObject({ status: 'written', activity: { version: 1 } });
    // A double tap: the same ID and op ID replays.
    expect(await acts.add(OWNER, added(1))).toMatchObject({ status: 'replayed' });
    // Another owner's write is refused outright.
    await expect(acts.add(id(99), added(2))).rejects.toThrow();
    expect(await acts.change(OWNER, id(1), (c) => editActivity(c, { expectedVersion: 1, opId: 'e1', at: at(10), fields: { ...RUN, date: '2026-10-11' } }))).toMatchObject({ status: 'written', activity: { version: 2 } });
    expect(await acts.change(OWNER, id(1), (c) => editActivity(c, { expectedVersion: 1, opId: 'e2', at: at(10), fields: RUN }))).toMatchObject({ status: 'stale' });
    expect(await acts.change(OWNER, id(1), (c) => editActivity(c, { expectedVersion: 1, opId: 'e1', at: at(10), fields: RUN }))).toMatchObject({ status: 'replayed' });
    expect(await acts.change(OWNER, id(1), (c) => undoActivity(c, { opId: 'u1', at: at(20), targetOpId: 'e1' }))).toMatchObject({ status: 'written', activity: { fields: { date: '2026-10-10' } } });
    await acts.add(OWNER, added(3, { ...RUN, status: 'done', date: '2026-10-08', effort: 'easy', distanceM: 5_000 }));
    expect(await acts.change(OWNER, id(3), (c) => deleteActivity(c, { expectedVersion: 1, opId: 'd3', at: at(30) }))).toMatchObject({ status: 'written' });
    expect((await acts.listBetween(OWNER, '2026-10-05', '2026-10-12')).map((a) => a.id)).toEqual([id(1)]);
    expect(await acts.change(OWNER, id(404), (c) => deleteActivity(c, { expectedVersion: 1, opId: 'x', at: at(30) }))).toMatchObject({ status: 'missing' });
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    const all = await acts.listByOwner(OWNER);
    const made = await createBackup(m.store, { at: at(40), app: APP });
    expect(made.text).toContain('"activities"');
    await m.close();

    const again = await managerIn(d.dir);
    expect(await again.store.repos.activities.listByOwner(OWNER)).toEqual(all);
    await again.close();
    const dst = await managerIn();
    expect(await dst.restore(made.text, at(50))).toMatchObject({ ok: true });
    expect(await dst.store.repos.activities.listByOwner(OWNER)).toEqual(all);
    // Undo still works after a restore: the delete is the last write on it.
    expect(await dst.store.repos.activities.change(OWNER, id(3), (c) => undoActivity(c, { opId: 'u3', at: at(60), targetOpId: 'd3' }))).toMatchObject({ status: 'written', activity: { deletedAtUtc: null } });
    await dst.close();
  });

  it('a coach-logged activity and its record in one write; its Undo is a tombstone, only while unchanged', async () => {
    const m = await managerIn();
    await m.store.repos.profiles.save(profile(), null);
    const c = added(5);
    const activity = { ...c.next, source: 'coach' as const };
    const action: ActionRecord = {
      actionId: id(8000),
      turnId: 'turn-1',
      opId: 'add-5',
      status: 'committed',
      author: 'coach',
      detail: { kind: 'log_activity', activityId: activity.id, fields: activity.fields, versionAfter: 1 },
      failure: null,
      reason: null,
      evidenceRefs: [],
      guardNotes: [],
      entityVersions: [{ entity: 'activity', id: activity.id, before: null, after: 1 }],
      undoneBy: null,
      createdAt: at(0),
    };
    expect(await m.store.repos.coach.commit(OWNER, { kind: 'activity', action, activity, expectedVersion: null })).toMatchObject({ status: 'written' });
    expect(await m.store.repos.coach.commit(OWNER, { kind: 'activity', action, activity, expectedVersion: null })).toMatchObject({ status: 'replayed' });
    expect(await m.store.repos.activities.get(activity.id)).toMatchObject({ source: 'coach', version: 1 });
    const undo: ActionRecord = { ...action, actionId: id(8001), opId: 'undo-5', author: 'ben', detail: { kind: 'undo', undoneActionId: action.actionId, what: 'the run', restored: [], alreadyLogged: [] }, entityVersions: [], createdAt: at(10) };
    const r = await m.store.repos.coach.undo(OWNER, undo);
    expect(r).toMatchObject({ status: 'written' });
    expect((await m.store.repos.activities.get(activity.id))?.deletedAtUtc).not.toBeNull();
    await m.close();
  });
});

describe('week changes: Apply and Undo with the merged day, all or nothing', () => {
  it('Apply writes the change and its workout; a second Apply is stale; Undo tombstones the workout; a restore reads them back', async () => {
    const m = await managerIn();
    await m.store.repos.profiles.save(profile(), null);
    const proposal: WeekProposal = {
      actionId: id(9000),
      weekMonday: '2026-10-05',
      basis: { kind: 'split' },
      merges: [{ dayIds: ['chest', 'shoulders'], name: 'Push', fromNames: ['Chest', 'Shoulders'] }],
      skips: [],
      before: [{ name: 'Chest', note: null }, { name: 'Shoulders', note: null }],
      after: [{ name: 'Push', note: 'Chest + Shoulders' }],
      factsKey: 'k',
    };
    const exercises = mergedExercises([routineExercise(10, { exerciseId: id(554), main: true })], [routineExercise(11, { exerciseId: id(555) })], { minutes: 60, newId: idGen(20_000) });
    const apply = (opId: string, actionId = proposal.actionId) =>
      m.store.repos.weekPlans.apply(OWNER, '2026-10-05', (current) => applyWeekPlan({ id: id(9100), ownerId: OWNER, proposal: { ...proposal, actionId }, monday: '2026-10-05', factsKey: 'k', current, merged: [{ routineId: id(9200), exercises }], opId, at: at(0) }));
    expect(await apply('apply-1')).toMatchObject({ status: 'written', week: { status: 'applied' } });
    expect(await apply('apply-1')).toMatchObject({ status: 'replayed' });
    expect(await apply('apply-2', id(9001))).toMatchObject({ status: 'stale' });
    const routine = await m.store.repos.routines.get(id(9200));
    expect(routine).toMatchObject({ name: 'Push', inRotation: false, createdForWeek: { weekPlanId: id(9100) } });
    expect(await m.store.repos.weekPlans.byProposal(OWNER, proposal.actionId)).toMatchObject({ id: id(9100) });
    const made = await createBackup(m.store, { at: at(5), app: APP });
    expect((await m.store.db.read((q) => exportTables(q))).week_plans).toHaveLength(1);
    expect(await m.store.repos.weekPlans.undo(OWNER, id(9100), (c, routines) => undoWeekPlan(c, { expectedVersion: 1, opId: 'undo-1', at: at(10), routines }))).toMatchObject({ status: 'written', week: { status: 'undone' } });
    expect((await m.store.repos.routines.get(id(9200)))?.deletedAtUtc).toBe(at(10).utc);
    expect(await m.store.repos.weekPlans.undo(OWNER, id(9100), (c, routines) => undoWeekPlan(c, { expectedVersion: 1, opId: 'undo-2', at: at(10), routines }))).toMatchObject({ status: 'stale' });
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    await m.close();

    const dst = await managerIn();
    expect(await dst.restore(made.text, at(20))).toMatchObject({ ok: true });
    expect(await dst.store.repos.weekPlans.listForWeek(OWNER, '2026-10-05')).toMatchObject([{ status: 'applied' }]);
    expect(await dst.store.repos.routines.get(id(9200))).toMatchObject({ deletedAtUtc: null });
    await dst.close();
  });
});
