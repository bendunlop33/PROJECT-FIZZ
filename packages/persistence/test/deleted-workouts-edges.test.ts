import { afterEach, describe, expect, it } from 'vitest';
import { createSessionService, newCheckIn, newPainFlag, reduceSession, startWorkout } from '@fizz/domain';
import { at, dumbbells, exercise, GYM, gym, HISTORY_EXERCISES, id, idGen, largeHistory, OWNER, profile, richFinishedSession, SPLIT_SQUAT } from '@fizz/domain/testing';
import { ActionRecordSchema, type ActionDetail, type ActionRecord, type SessionAggregate, type ZonedTimestamp } from '@fizz/schemas';
import {
  checkIntegrity,
  DatabaseManager,
  exportTables,
  latestVersion,
  migrate,
  MIGRATIONS,
  openStore,
  readUserVersion,
  SESSIONS_V7_COLUMNS,
  UnexpectedSessionsColumnsError,
  type SqlDriver,
  type SqlValue,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { importWorkouts } from './import-fixture';
import { memoryDriver, schemaDump, tempDir } from './helpers';

/**
 * Delete-workouts edge cases the review asked for (S6, B1): migration 8 on a
 * populated schema-7 database and its column guard, `Delete my data` and
 * `Reset coaching knowledge` with deleted workouts and tombstones (DW29),
 * and the purge of a workout with a check-in, a pain flag from that
 * check-in and a coach offer.
 */

const TZ = 'Europe/London';
const z = (utc: string): ZonedTimestamp => ({ utc, tz: TZ });
const NOW = z('2026-10-09T07:12:00.000Z');

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const item = (a: SessionAggregate) => ({ sessionId: a.session.id, expectedVersion: a.session.version });

/** Copy every row of `from` into a database migrated to `version`, keeping only the columns that exist there. */
async function copyInto(from: SqlDriver, to: SqlDriver, version: number): Promise<void> {
  await migrate(to, MIGRATIONS, version);
  const tables = await from.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  await to.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) {
    const cols = new Set((await to.getAll<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name));
    if (cols.size === 0) continue;
    for (const row of await from.getAll(`SELECT * FROM ${name}`)) {
      const keys = Object.keys(row).filter((k) => cols.has(k));
      await to.run(`INSERT INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => row[k] as SqlValue));
    }
  }
  await to.exec('PRAGMA foreign_keys = ON');
}

/** A store with finished, active, discarded, imported and reverted (undone import) workouts. */
async function mixedStore(): Promise<{ store: Store; driver: SqlDriver }> {
  const driver = memoryDriver();
  const store = await openStore(driver);
  await store.repos.profiles.save(profile(), null);
  for (const e of HISTORY_EXERCISES) await store.repos.exercises.save(e, null);
  for (const a of largeHistory({ weeks: 2, perWeek: 3 })) expect(await store.repos.sessions.save(a, null)).toMatchObject({ ok: true });
  // Discarded: started, then discarded with nothing logged.
  const owner = profile();
  const started = startWorkout({ opId: 'start-discard', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [], at: at(-50_000), newId: idGen(700_000) }).aggregate;
  const discarded = reduceSession(started, { type: 'discard', at: at(-49_000), opId: 'discard-1', expectedVersion: started.session.version, confirmedLoggedSets: 0 });
  if (!discarded.ok) throw new Error(discarded.error.message);
  expect(await store.repos.sessions.save(discarded.state, null)).toMatchObject({ ok: true });
  // Imported, one import kept and one undone.
  await importWorkouts(store, { at: z('2026-10-05T10:00:00.000Z'), dates: ['2026-09-01', '2026-09-03'], jobNo: 1 });
  const undone = await importWorkouts(store, { at: z('2026-10-05T11:00:00.000Z'), dates: ['2026-08-01'], jobNo: 2 });
  expect(await store.repos.imports.revertJob(undone.job.id, undone.job.version, 'undo-2', z('2026-10-05T12:00:00.000Z'))).toMatchObject({ ok: true });
  // Active, last (one per owner).
  const active = startWorkout({ opId: 'start-active', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [], at: at(100), newId: idGen(710_000) }).aggregate;
  expect(await store.repos.sessions.save(active, null)).toMatchObject({ ok: true });
  return { store, driver };
}

describe('migration 8 (review B1, S6)', () => {
  it('refuses, changing nothing, when `sessions` has a column it doesn’t know (another branch’s migration merged first)', async () => {
    const db = memoryDriver();
    cleanups.push(() => db.close());
    await migrate(db, MIGRATIONS, 7);
    // What Progress's migration (now 9) adds, as if it had merged first and taken number 8.
    await db.exec('ALTER TABLE sessions ADD COLUMN duration_confirmed_at_utc TEXT; ALTER TABLE sessions ADD COLUMN duration_confirmed_at_tz TEXT');
    const before = await schemaDump(db);
    await expect(migrate(db)).rejects.toThrow(UnexpectedSessionsColumnsError);
    await expect(migrate(db)).rejects.toThrow(/unknown column\(s\) duration_confirmed_at_utc, duration_confirmed_at_tz/);
    expect(await readUserVersion(db)).toBe(7);
    expect(await schemaDump(db)).toEqual(before);
  });

  it('refuses when a column it copies is missing', async () => {
    const db = memoryDriver();
    cleanups.push(() => db.close());
    await migrate(db, MIGRATIONS, 7);
    await db.exec('ALTER TABLE sessions DROP COLUMN today_edits');
    await expect(migrate(db)).rejects.toThrow(/missing column\(s\) today_edits/);
    expect(await readUserVersion(db)).toBe(7);
  });

  it('the frozen list is exactly schema 7’s `sessions`', async () => {
    const db = memoryDriver();
    cleanups.push(() => db.close());
    await migrate(db, MIGRATIONS, 7);
    expect((await db.getAll<{ name: string }>('PRAGMA table_info(sessions)')).map((c) => c.name)).toEqual([...SESSIONS_V7_COLUMNS]);
  });

  it('on a populated schema-7 database with every workout status: every row kept, the same schema as a fresh database, foreign keys and integrity clean', async () => {
    const { store, driver } = await mixedStore();
    cleanups.push(() => store.close());
    const statuses = (await driver.getAll<{ status: string; n: number }>('SELECT status, count(*) AS n FROM sessions GROUP BY status ORDER BY status')).map((r) => [r.status, r.n]);
    expect(statuses).toEqual([
      ['active', 1],
      ['discarded', 1],
      ['finished', 8],
      ['reverted', 1],
    ]);
    const source = await exportTables(driver);

    const old = memoryDriver();
    await copyInto(driver, old, 7);
    expect(await readUserVersion(old)).toBe(7);
    // 8, then every later migration (9: Progress's Count it, 10: workout gaps).
    expect(await migrate(old)).toMatchObject({ from: 7, to: latestVersion(), applied: MIGRATIONS.slice(7).map((m) => m.version) });

    const fresh = memoryDriver();
    cleanups.push(() => fresh.close());
    await migrate(fresh);
    expect(await schemaDump(old)).toEqual(await schemaDump(fresh));
    expect(await old.getAll('PRAGMA foreign_key_check')).toEqual([]);
    expect(await old.getAll('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    // Every row of every table is back as it was (the new columns empty).
    expect(await exportTables(old)).toEqual(source);
    const migrated = await openStore(old);
    cleanups.push(() => migrated.close());
    expect((await checkIntegrity(migrated.db)).ok).toBe(true);
    expect(await migrated.countRecords()).toEqual(await store.countRecords());
  });
});

describe('migration 9 on main’s schema 8 (review progress-merge S2)', () => {
  it('a populated schema-8 database with deleted and purged workouts: 9 (and 10) applied, the same schema as a fresh database, every row kept, deleted workouts out of Progress', async () => {
    const { store, driver } = await mixedStore();
    cleanups.push(() => store.close());
    const finished = (await driver.getAll<{ id: string }>("SELECT id FROM sessions WHERE status = 'finished' ORDER BY started_at_utc, id")).map((r) => r.id);
    const [kept, purged] = await Promise.all(finished.slice(0, 2).map((sid) => store.repos.sessions.get(sid)));
    if (!kept || !purged) throw new Error('fixture');
    expect((await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(kept), item(purged)], opId: 'del-m9', at: NOW })).ok).toBe(true);
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-m9', at: NOW, sessionIds: [purged.session.id] })).toMatchObject({ ok: true, purged: [purged.session.id] });
    const statuses = (await driver.getAll<{ status: string; n: number }>('SELECT status, count(*) AS n FROM sessions GROUP BY status ORDER BY status')).map((r) => [r.status, r.n]);
    expect(statuses).toEqual([
      ['active', 1],
      ['deleted', 1],
      ['discarded', 1],
      ['finished', 6],
      ['reverted', 1],
    ]);
    expect(await driver.getAll('SELECT session_id FROM purged_sessions')).toEqual([{ session_id: purged.session.id }]);
    const source = await exportTables(driver);

    const old = memoryDriver();
    await copyInto(driver, old, 8);
    expect(await readUserVersion(old)).toBe(8);
    expect(await migrate(old)).toMatchObject({ from: 8, to: latestVersion(), applied: [9, 10, 11, 12] });

    const fresh = memoryDriver();
    cleanups.push(() => fresh.close());
    await migrate(fresh);
    expect(await schemaDump(old)).toEqual(await schemaDump(fresh));
    expect(await old.getAll('PRAGMA foreign_key_check')).toEqual([]);
    expect(await old.getAll('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await exportTables(old)).toEqual(source);
    const migrated = await openStore(old);
    cleanups.push(() => migrated.close());
    expect((await checkIntegrity(migrated.db)).ok).toBe(true);
    expect(await migrated.countRecords()).toEqual(await store.countRecords());
    // Progress reads finished workouts only: the deleted one and the purged one are out.
    const listed = (await migrated.repos.sessions.listFinishedRevisions(OWNER)).map((r) => r.id);
    expect(listed).toHaveLength(6);
    expect(listed).not.toContain(kept.session.id);
    expect(listed).not.toContain(purged.session.id);
    expect((await migrated.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).sessions.map((x) => x.session.id)).toEqual([kept.session.id]);
    expect(await migrated.repos.sessions.isPurged(purged.session.id)).toBe(true);
  });
});

describe('migration 10 (workout gaps) on main’s schema 9', () => {
  it('a populated schema-9 database (deleted, purged, a counted workout): only 10 applied, the same schema as a fresh database, every row kept, and the new columns take writes', async () => {
    const { store, driver } = await mixedStore();
    cleanups.push(() => store.close());
    const finished = (await driver.getAll<{ id: string }>("SELECT id FROM sessions WHERE status = 'finished' ORDER BY started_at_utc, id")).map((r) => r.id);
    const [kept, purged, counted] = await Promise.all(finished.slice(0, 3).map((sid) => store.repos.sessions.get(sid)));
    if (!kept || !purged || !counted) throw new Error('fixture');
    expect((await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(kept), item(purged)], opId: 'del-m10', at: NOW })).ok).toBe(true);
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-m10', at: NOW, sessionIds: [purged.session.id] })).toMatchObject({ ok: true, purged: [purged.session.id] });
    // Schema 9's own column: `Count it` on a finished workout.
    const service = createSessionService(store.repos, () => 'unused');
    const count = await service.dispatch(counted.session.id, { type: 'confirm_session_duration', at: NOW, opId: 'count-m10', confirmed: true, expectedVersion: counted.session.version });
    expect(count.ok).toBe(true);
    const source = await exportTables(driver);

    const old = memoryDriver();
    await copyInto(driver, old, 9);
    expect(await readUserVersion(old)).toBe(9);
    expect(await old.getAll("SELECT duration_confirmed_at_utc AS u FROM sessions WHERE duration_confirmed_at_utc IS NOT NULL")).toEqual([{ u: NOW.utc }]);
    expect(await migrate(old)).toMatchObject({ from: 9, to: latestVersion(), applied: [10, 11, 12] });
    expect(latestVersion()).toBe(12);

    const fresh = memoryDriver();
    cleanups.push(() => fresh.close());
    await migrate(fresh);
    expect(await schemaDump(old)).toEqual(await schemaDump(fresh));
    expect(await old.getAll('PRAGMA foreign_key_check')).toEqual([]);
    expect(await old.getAll('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    // Every row of every table as it was; the new columns empty on every old row.
    expect(await exportTables(old)).toEqual(source);
    expect(await old.getAll('SELECT count(*) AS n FROM session_exercises WHERE note IS NOT NULL OR removed IS NOT NULL OR swapped_from IS NOT NULL OR measures_distance IS NOT NULL')).toEqual([{ n: 0 }]);
    expect(await old.getAll('SELECT count(*) AS n FROM session_sets WHERE note IS NOT NULL OR actual_distance_m IS NOT NULL')).toEqual([{ n: 0 }]);

    const migrated = await openStore(old);
    cleanups.push(() => migrated.close());
    expect((await checkIntegrity(migrated.db)).ok).toBe(true);
    expect(await migrated.countRecords()).toEqual(await store.countRecords());
    expect((await migrated.repos.sessions.get(counted.session.id))?.session.durationConfirmedAt).toEqual(NOW);
    expect((await migrated.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).sessions.map((x) => x.session.id)).toEqual([kept.session.id]);
    expect(await migrated.repos.sessions.isPurged(purged.session.id)).toBe(true);
    // A note on a finished workout's exercise (allowed after Finish) lands in migration 10's column and reads back.
    const before = await migrated.repos.sessions.get(counted.session.id);
    const row = before?.exercises[0];
    if (!before || !row) throw new Error('fixture');
    const noted = await createSessionService(migrated.repos, () => 'unused').dispatch(before.session.id, { type: 'set_note', at: NOW, opId: 'note-m10', target: { kind: 'exercise', sessionExerciseId: row.id }, note: 'Bench at 3', expectedVersion: before.session.version });
    expect(noted.ok).toBe(true);
    expect(await old.getAll('SELECT note FROM session_exercises WHERE id = ?', [row.id])).toEqual([{ note: 'Bench at 3' }]);
    expect((await migrated.repos.sessions.get(before.session.id))?.exercises[0]?.note).toBe('Bench at 3');
  });
});

describe('migration 11 (coach set actions) on main’s schema 10', () => {
  let n = 0;
  const coachAction = (detail: ActionDetail): ActionRecord => {
    n += 1;
    return ActionRecordSchema.parse({
      actionId: id(950_000 + n),
      turnId: null,
      opId: `m11-op-${String(n)}`,
      status: 'committed',
      author: 'coach',
      detail,
      failure: null,
      reason: null,
      evidenceRefs: [],
      guardNotes: [],
      entityVersions: [],
      undoneBy: null,
      createdAt: NOW,
    });
  };

  it('a populated schema-10 database (deleted, purged, a workout-gaps note, memories, a forgotten one, playbook candidates, coach actions): 11 then 12 (today fit) applied, in place, every row kept, the same schema as a fresh database, and the new statuses take writes', async () => {
    const { store, driver } = await mixedStore();
    cleanups.push(() => store.close());
    const finished = (await driver.getAll<{ id: string }>("SELECT id FROM sessions WHERE status = 'finished' ORDER BY started_at_utc, id")).map((r) => r.id);
    const [kept, purged, noted] = await Promise.all(finished.slice(0, 3).map((sid) => store.repos.sessions.get(sid)));
    if (!kept || !purged || !noted) throw new Error('fixture');
    expect((await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(kept), item(purged)], opId: 'del-m11', at: NOW })).ok).toBe(true);
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-m11', at: NOW, sessionIds: [purged.session.id] })).toMatchObject({ ok: true, purged: [purged.session.id] });
    // Schema 10's own column: a note on a finished workout's exercise.
    const row = noted.exercises[0];
    if (!row) throw new Error('fixture');
    const note = await createSessionService(store.repos, () => 'unused').dispatch(noted.session.id, { type: 'set_note', at: NOW, opId: 'note-m11', target: { kind: 'exercise', sessionExerciseId: row.id }, note: 'Bench at 3', expectedVersion: noted.session.version });
    expect(note.ok).toBe(true);
    // Your data and Coaching knowledge as schema 10 allowed them.
    const mem = (k: number, text: string, actionId: string) => ({ id: id(960_000 + k), ownerId: OWNER, version: 1, createdAtUtc: NOW.utc, updatedAtUtc: NOW.utc, text, contentKey: `memory:${text}`, status: 'active' as const, quote: text, createdByActionId: actionId });
    const m1 = coachAction({ kind: 'save_memory', memoryId: id(960_001), text: 'Trains before work' });
    expect((await store.repos.coach.commit(OWNER, { kind: 'save_memory', action: m1, memory: mem(1, 'Trains before work', m1.actionId) })).status).toBe('written');
    const m2 = coachAction({ kind: 'save_memory', memoryId: id(960_002), text: 'Hates lunges' });
    expect((await store.repos.coach.commit(OWNER, { kind: 'save_memory', action: m2, memory: mem(2, 'Hates lunges', m2.actionId) })).status).toBe('written');
    const f2 = coachAction({ kind: 'forget_memory', memoryId: id(960_002), text: 'Hates lunges' });
    expect((await store.repos.coach.commit(OWNER, { kind: 'forget_memory', action: f2, memoryId: id(960_002), expectedVersion: 1, atUtc: NOW.utc })).status).toBe('written');
    const cand = (k: number, text: string, actionId: string) => ({ id: id(970_000 + k), version: 1, createdAtUtc: NOW.utc, updatedAtUtc: NOW.utc, text, contentKey: `playbook:${text}`, statedBy: 'ben' as const, status: 'to_review' as const, createdByActionId: actionId });
    const c1 = coachAction({ kind: 'add_playbook_candidate', candidateId: id(970_001), text: 'Deload every 6 weeks' });
    expect((await store.repos.coach.commit(OWNER, { kind: 'playbook_candidate', action: c1, candidate: cand(1, 'Deload every 6 weeks', c1.actionId) })).status).toBe('written');
    const source = await exportTables(driver);
    expect((source.coach_actions ?? []).length).toBe(4);

    const old = memoryDriver();
    await copyInto(driver, old, 10);
    expect(await readUserVersion(old)).toBe(10);
    // Schema 10 refuses what 11 adds.
    await expect(old.run("UPDATE playbook_candidates SET status = 'approved'")).rejects.toThrow();
    expect(await migrate(old)).toMatchObject({ from: 10, to: latestVersion(), applied: [11, 12] });
    expect(latestVersion()).toBe(12);

    const fresh = memoryDriver();
    cleanups.push(() => fresh.close());
    await migrate(fresh);
    expect(await schemaDump(old)).toEqual(await schemaDump(fresh));
    expect(await old.getAll('PRAGMA foreign_key_check')).toEqual([]);
    expect(await old.getAll('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await exportTables(old)).toEqual(source);

    const migrated = await openStore(old);
    cleanups.push(() => migrated.close());
    expect(migrated.migration).toMatchObject({ from: 12, to: 12, applied: [] });
    expect((await checkIntegrity(migrated.db)).ok).toBe(true);
    expect(await migrated.countRecords()).toEqual(await store.countRecords());
    expect((await migrated.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).sessions.map((x) => x.session.id)).toEqual([kept.session.id]);
    expect(await migrated.repos.sessions.isPurged(purged.session.id)).toBe(true);
    expect((await migrated.repos.sessions.get(noted.session.id))?.exercises[0]?.note).toBe('Bench at 3');
    expect((await migrated.repos.coach.listMemories(OWNER, 'all')).map((m) => [m.text, m.status]).sort()).toEqual([
      ['Hates lunges', 'forgotten'],
      ['Trains before work', 'active'],
    ]);
    expect(await migrated.repos.coach.getAction(f2.actionId)).toEqual(await store.repos.coach.getAction(f2.actionId));
    // The new statuses and kinds take writes, through the repository and the table.
    const [candidate] = await migrated.repos.coach.listPlaybookCandidates();
    if (!candidate) throw new Error('fixture');
    expect(await migrated.repos.coach.decidePlaybookCandidate({ candidateId: candidate.id, expectedVersion: candidate.version, decision: 'approve', atUtc: NOW.utc })).toMatchObject({ status: 'written', candidate: { status: 'approved' } });
    await old.run("INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('m11-x', 'o', 'm11-x', NULL, NULL, 'log_set', 'committed', 1, 't', 't', '{}')");
    await expect(old.run("DELETE FROM coach_actions WHERE id = 'm11-x'")).rejects.toThrow(/never deleted/);
  });
});

describe('Delete my data and Reset coaching knowledge with deleted workouts (DW29)', () => {
  async function managerWithDeletions() {
    const { dir, cleanup } = tempDir();
    let n = 0;
    const m = await DatabaseManager.open({ host: nodeDatabaseHost(dir), newName: () => `t-${String(++n)}.db` });
    cleanups.push(cleanup, () => m.close().catch(() => undefined));
    await m.store.repos.profiles.save(profile(), null);
    for (const e of HISTORY_EXERCISES) await m.store.repos.exercises.save(e, null);
    // A knowledge exercise nothing uses, so Reset has something to remove.
    await m.store.repos.exercises.save(exercise(260, 'Landmine press'), null);
    const history = largeHistory({ weeks: 1, perWeek: 3 });
    for (const a of history) await m.store.repos.sessions.save(a, null);
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    expect((await m.store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a), item(b)], opId: 'del', at: NOW })).ok).toBe(true);
    expect(await m.store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [b.session.id] })).toMatchObject({ ok: true });
    return { m, a, b };
  }

  const count = (m: DatabaseManager, sql: string) => m.store.db.read(async (q) => (await q.getFirst<{ n: number }>(sql))?.n ?? -1);

  it('Delete my data removes deleted workouts and tombstones', async () => {
    const { m } = await managerWithDeletions();
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    expect(await count(m, 'SELECT count(*) AS n FROM sessions')).toBe(0);
    expect(await count(m, 'SELECT count(*) AS n FROM purged_sessions')).toBe(0);
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
  });

  it('Reset coaching knowledge leaves them untouched: the deleted workout keeps its clock, the purged one stays purged', async () => {
    const { m, a, b } = await managerWithDeletions();
    const before = await m.store.db.read(async (q) => ({
      deleted: await q.getAll("SELECT * FROM sessions WHERE status = 'deleted'"),
      tombstones: await q.getAll('SELECT * FROM purged_sessions'),
    }));
    expect(await m.resetKnowledge([])).toMatchObject({ ok: true, status: 'switched' });
    const after = await m.store.db.read(async (q) => ({
      deleted: await q.getAll("SELECT * FROM sessions WHERE status = 'deleted'"),
      tombstones: await q.getAll('SELECT * FROM purged_sessions'),
    }));
    expect(after).toEqual(before);
    expect((await m.store.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).sessions.map((x) => x.session.id)).toEqual([a.session.id]);
    expect(await m.store.repos.sessions.isPurged(b.session.id)).toBe(true);
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
  });
});

describe('the purge of a workout with a check-in, a pain flag and a coach offer (S6)', () => {
  it('removes the workout and its check-in; the pain flag, still active, and every other record read back; integrity passes', async () => {
    const store = await openStore(memoryDriver());
    cleanups.push(() => store.close());
    const { repos } = store;
    await repos.profiles.save(profile(), null);
    await repos.gyms.save(gym(2, { isDefault: true }), null);
    await repos.equipment.save(dumbbells(), null);
    await repos.exercises.save(SPLIT_SQUAT, null);
    const checkIn = newCheckIn({ id: id(300), ownerId: OWNER, opId: 'checkin-op', score: 2, reasons: ['pain'], note: 'Knee', at: at(-10), localDate: '2026-10-08' });
    await repos.checkIns.save(checkIn, null);
    const flag = newPainFlag({ id: id(301), ownerId: OWNER, opId: 'pain-op', exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: 'knee', source: 'check_in', checkInId: checkIn.id, at: at(-9) });
    await repos.painFlags.save(flag, null);
    const rich = richFinishedSession();
    const workout: SessionAggregate = { ...rich, session: { ...rich.session, checkIn: { kind: 'answered', checkInId: checkIn.id } } };
    expect(await repos.sessions.save(workout, null)).toMatchObject({ ok: true });
    const exId = workout.exercises[0]?.id ?? '';
    await repos.coach.recordOffer(OWNER, { sessionId: workout.session.id, sessionExerciseId: exId, kind: 'rpe_10', atVersion: workout.session.version, atUtc: at(5).utc });
    expect((await checkIntegrity(store.db)).ok).toBe(true);

    expect((await repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(workout)], opId: 'del', at: NOW })).ok).toBe(true);
    // DW17: the pain flag raised with it still holds while it is deleted.
    expect((await repos.painFlags.listActive(OWNER)).map((f) => f.id)).toEqual([flag.id]);
    expect(await repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge', at: NOW, sessionIds: [workout.session.id] })).toMatchObject({ ok: true, purged: [workout.session.id] });

    const left = await store.db.read(async (q) => ({
      session: await q.getFirst('SELECT id FROM sessions WHERE id = ?', [workout.session.id]),
      checkIn: await q.getFirst('SELECT id FROM check_ins WHERE id = ?', [checkIn.id]),
      offers: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM coach_offers WHERE session_id = ?', [workout.session.id]))?.n,
    }));
    expect(left).toEqual({ session: null, checkIn: null, offers: 0 });
    // DW-D6: the flag stays, active; it still names the movement and its area.
    expect(await repos.painFlags.listActive(OWNER)).toEqual([expect.objectContaining({ id: flag.id, exerciseId: SPLIT_SQUAT.id, area: 'knee', status: 'active' })]);
    const report = await checkIntegrity(store.db);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('the coach fit’s start fence with deleted and purged workouts (merge with the workout library)', () => {
  it('counts every Start: deleting or purging a workout never lowers it, so a Start plus a purge between a fit’s request and its write still moves it', async () => {
    const { store, driver } = await mixedStore();
    cleanups.push(() => store.close());
    const before = await store.repos.drafts.startFence(OWNER);
    const finished = (await driver.getAll<{ id: string }>("SELECT id FROM sessions WHERE status = 'finished' AND source = 'manual' ORDER BY started_at_utc, id")).map((r) => r.id);
    const one = await store.repos.sessions.get(finished[0] ?? '');
    if (!one) throw new Error('fixture');
    expect((await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(one)], opId: 'del-fence', at: NOW })).ok).toBe(true);
    expect(await store.repos.drafts.startFence(OWNER)).toBe(before);
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-fence', at: NOW, sessionIds: [one.session.id] })).toMatchObject({ ok: true, purged: [one.session.id] });
    expect(await store.repos.drafts.startFence(OWNER)).toBe(before);
  });
});
