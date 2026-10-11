import { describe, expect, it } from 'vitest';
import {
  Database,
  latestVersion,
  migrate,
  MIGRATIONS,
  readUserVersion,
  SchemaTooNewError,
  sqlMigration,
  type Migration,
} from '../src/index';
import { memoryDriver, schemaDump } from './helpers';

const TABLES = [
  'check_ins',
  'coach_actions',
  'coach_messages',
  'coach_offers',
  'coach_threads',
  'coach_turns',
  'equipment',
  'exercise_aliases',
  'exercises',
  'gyms',
  'import_jobs',
  'import_rows',
  'memories',
  'next_session_targets',
  'next_target_uses',
  'pain_flags',
  'playbook_candidates',
  'processed_operations',
  'profiles',
  'progression_rules',
  'rest_timers',
  'routines',
  'session_exercises',
  'session_pauses',
  'session_sets',
  'sessions',
  'set_audit',
  'timing_audit',
  'work_intervals',
];

describe('migrations', () => {
  it('builds the current schema from an empty database, once', async () => {
    const db = memoryDriver();
    expect(await readUserVersion(db)).toBe(0);
    expect(await migrate(db)).toEqual({ from: 0, to: latestVersion(), applied: MIGRATIONS.map((m) => m.version) });
    const tables = await db.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(TABLES);
    expect(await migrate(db)).toEqual({ from: latestVersion(), to: latestVersion(), applied: [] });
  });

  it('reaches the same schema from every prior version as from empty', async () => {
    const fresh = memoryDriver();
    await migrate(fresh);
    const expected = await schemaDump(fresh);
    for (let k = 0; k <= latestVersion(); k += 1) {
      const db = memoryDriver();
      await migrate(db, MIGRATIONS, k);
      expect(await readUserVersion(db)).toBe(k);
      const report = await migrate(db);
      expect(report.from).toBe(k);
      expect(report.to).toBe(latestVersion());
      expect(await schemaDump(db)).toEqual(expected);
    }
  });

  it('rolls a failed migration back completely, including user_version', async () => {
    const broken: Migration = {
      version: 2,
      name: 'broken',
      up: async (tx) => {
        await tx.exec('CREATE TABLE half_done (x INTEGER) STRICT');
        throw new Error('boom');
      },
    };
    const db = memoryDriver();
    await expect(migrate(db, [...MIGRATIONS.slice(0, 1), broken])).rejects.toThrow('boom');
    expect(await readUserVersion(db)).toBe(1);
    expect(await db.getFirst("SELECT name FROM sqlite_master WHERE name = 'half_done'")).toBeNull();
  });

  it('applies later migrations, carrying data forward', async () => {
    const m2 = sqlMigration(2, 'gym colour', "ALTER TABLE gyms ADD COLUMN colour TEXT NOT NULL DEFAULT 'none'");
    const db = memoryDriver();
    await migrate(db, MIGRATIONS.slice(0, 1));
    await db.run("INSERT INTO gyms (id, owner_id, version, updated_at_utc, data) VALUES ('g', 'o', 1, 't', '{}')");
    expect(await migrate(db, [...MIGRATIONS.slice(0, 1), m2])).toMatchObject({ from: 1, to: 2, applied: [2] });
    expect(await db.getFirst('SELECT id, colour FROM gyms')).toEqual({ id: 'g', colour: 'none' });
  });

  it('refuses a database from a newer build and never goes backwards', async () => {
    const db = memoryDriver();
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toBeInstanceOf(SchemaTooNewError);
    expect(await readUserVersion(db)).toBe(99);
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([]);

    const current = memoryDriver();
    await migrate(current);
    await expect(migrate(current, MIGRATIONS, 0)).rejects.toThrow('forward-only');
  });

  it('rejects a malformed migration list', async () => {
    await expect(migrate(memoryDriver(), [sqlMigration(2, 'gap', 'SELECT 1')])).rejects.toThrow('malformed');
  });
});

describe('schema guards', () => {
  async function ready() {
    const db = memoryDriver();
    await migrate(db);
    await db.run(
      `INSERT INTO sessions (id, owner_id, gym_id, start_operation_id, status, source, started_at_utc, started_at_tz,
        version, revision, equipment_snapshot, last_activity_at_utc)
       VALUES ('s', 'o', 'g', 'op', 'active', 'manual', 't', 'UTC', 1, 1, '[]', 't')`,
    );
    return db;
  }

  it('makes audit, processed operations and pauses append-only', async () => {
    const db = await ready();
    await db.run("INSERT INTO set_audit (session_id, ordinal, id, set_id, op_id, kind, at_utc) VALUES ('s', 0, 'a', 'x', 'op', 'logged', 't')");
    await expect(db.run("UPDATE set_audit SET kind = 'undone'")).rejects.toThrow('append-only');
    await expect(db.run('DELETE FROM set_audit')).rejects.toThrow('append-only');
    await db.run("INSERT INTO processed_operations (session_id, op_id, ordinal, command_type, fingerprint, at_utc) VALUES ('s', 'op', 0, 'log_set', 'f', 't')");
    await expect(db.run("UPDATE processed_operations SET fingerprint = 'g'")).rejects.toThrow('append-only');
    await db.run("INSERT INTO session_pauses (session_id, ordinal, start_utc, end_utc) VALUES ('s', 0, 'a', 'b')");
    await expect(db.run('DELETE FROM session_pauses')).rejects.toThrow('append-only');
    await expect(db.run('DELETE FROM sessions')).rejects.toThrow('never deleted');
  });

  it('enforces types, enums and one active session per owner', async () => {
    const db = await ready();
    await expect(db.run("UPDATE sessions SET version = 'two'")).rejects.toThrow();
    await expect(db.run("UPDATE sessions SET status = 'paused'")).rejects.toThrow();
    await expect(
      db.run(
        `INSERT INTO sessions (id, owner_id, gym_id, start_operation_id, status, source, started_at_utc, started_at_tz,
          version, revision, equipment_snapshot, last_activity_at_utc)
         VALUES ('s2', 'o', 'g', 'op2', 'active', 'manual', 't', 'UTC', 1, 1, '[]', 't')`,
      ),
    ).rejects.toThrow('UNIQUE');
  });
});

describe('node driver and Database queue', () => {
  it('commits on success and rolls back on throw', async () => {
    const db = memoryDriver();
    await db.exec('CREATE TABLE t (n INTEGER) STRICT');
    expect(await db.withExclusiveTransaction(async (tx) => (await tx.run('INSERT INTO t VALUES (1)')).changes)).toBe(1);
    await expect(
      db.withExclusiveTransaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (2)');
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(await db.getAll('SELECT n FROM t')).toEqual([{ n: 1 }]);
  });

  it('refuses nested transactions and leaked executors', async () => {
    const db = memoryDriver();
    let leaked: Parameters<Parameters<typeof db.withExclusiveTransaction>[0]>[0] | null = null;
    await db.withExclusiveTransaction(async (tx) => {
      leaked = tx;
      await expect(db.withExclusiveTransaction(() => Promise.resolve())).rejects.toThrow('Nested');
      await expect(db.exec('SELECT 1')).rejects.toThrow();
    });
    expect(leaked).not.toBeNull();
    await expect((leaked as unknown as { exec: (s: string) => Promise<void> }).exec('SELECT 1')).rejects.toThrow('after the transaction');
  });

  it('serialises concurrent writes so read-modify-write never loses an update', async () => {
    const driver = memoryDriver();
    await driver.exec('CREATE TABLE c (n INTEGER) STRICT; INSERT INTO c VALUES (0);');
    const db = new Database(driver);
    const bump = () =>
      db.write(async (tx) => {
        const row = await tx.getFirst<{ n: number }>('SELECT n FROM c');
        await Promise.resolve(); // yield, as a real async driver would
        await tx.run('UPDATE c SET n = ?', [(row?.n ?? 0) + 1]);
      });
    await Promise.all(Array.from({ length: 20 }, bump));
    expect(await db.read((q) => q.getFirst('SELECT n FROM c'))).toEqual({ n: 20 });
    await db.close();
    await expect(db.read((q) => q.getFirst('SELECT 1'))).rejects.toThrow('closed');
  });
});
