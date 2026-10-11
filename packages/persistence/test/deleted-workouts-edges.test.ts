import { afterEach, describe, expect, it } from 'vitest';
import { newCheckIn, newPainFlag, reduceSession, startWorkout } from '@fizz/domain';
import { at, dumbbells, exercise, GYM, gym, HISTORY_EXERCISES, id, idGen, largeHistory, OWNER, profile, richFinishedSession, SPLIT_SQUAT } from '@fizz/domain/testing';
import type { SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
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
    // What claude/progress's 0008 does, as if it had merged first and taken an earlier number.
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
    expect(await migrate(old)).toMatchObject({ from: 7, to: latestVersion(), applied: [8] });

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
    expect((await m.store.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).map((x) => x.session.id)).toEqual([a.session.id]);
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
