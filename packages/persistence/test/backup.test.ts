import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService, stableStringify } from '@fizz/domain';
import {
  assisted,
  at,
  barbell,
  bodyweightStation,
  doubleProgression,
  dumbbells,
  exercise,
  gym,
  id,
  idGen,
  kg,
  logCmd,
  OWNER,
  plateMachine,
  profile,
  richFinishedSession,
  routine,
  routineExercise,
  SPLIT_SQUAT,
  stack,
  topSetBackoff,
  unilateralSession,
  values,
} from '@fizz/domain/testing';
import {
  checkIntegrity,
  createBackup,
  DatabaseManager,
  exportTables,
  MIGRATIONS,
  parseBackup,
  readUserVersion,
  sha256Hex,
  sqlMigration,
  type BackupFile,
  type DatabaseHost,
  type Migration,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { failingDriver, tempDir } from './helpers';

const APP = { name: 'PROJECT-FIZZ', version: '0.1.0', build: 'ci-42' };

let dirs: { dir: string; cleanup: () => void }[] = [];
function dir(): string {
  const d = tempDir();
  dirs.push(d);
  return d.dir;
}
afterEach(() => {
  for (const d of dirs) d.cleanup();
  dirs = [];
});

/** Sequential names that stay unique per directory across reopened managers. */
const counters = new Map<string, number>();
function names(directory: string, prefix: string): () => string {
  return () => {
    const n = (counters.get(directory) ?? 0) + 1;
    counters.set(directory, n);
    return `${prefix}-${String(n)}.db`;
  };
}

async function openManager(
  directory: string,
  opts: { host?: DatabaseHost; migrations?: readonly Migration[]; prefix?: string; newName?: () => string } = {},
) {
  return DatabaseManager.open({
    host: opts.host ?? nodeDatabaseHost(directory),
    newName: opts.newName ?? names(directory, opts.prefix ?? 'training'),
    ...(opts.migrations ? { migrations: opts.migrations } : {}),
  });
}

/** Everything a real database holds: every document kind and finished + active sessions. */
async function populate(store: Store): Promise<void> {
  const { repos } = store;
  await repos.profiles.save(profile({ preferredUnit: 'lb' }), null);
  await repos.gyms.save(gym(2, { isDefault: true, locationLabel: 'Ponsonby' }), null);
  for (const eq of [barbell(), dumbbells({ unit: 'lb', loads: [5, 10, 12.5], maxLoad: 12.5 }), stack({ addOns: [2.5] }), assisted(), plateMachine(), bodyweightStation()]) {
    await repos.equipment.save(eq, null);
  }
  await repos.exercises.save(SPLIT_SQUAT, null);
  await repos.exercises.save(exercise(241, 'Custom press', { ownerId: OWNER, source: 'custom' }), null);
  await repos.routines.save(routine([routineExercise(700, { exerciseId: SPLIT_SQUAT.id, restBySetType: { working: { seconds: 120 } } })]), null);
  await repos.progressionRules.save(doubleProgression(), null);
  await repos.progressionRules.save(topSetBackoff(), null);
  await repos.sessions.save(richFinishedSession(), null);
  const active = unilateralSession('start-active', idGen(97_000));
  await repos.sessions.save(active, null);
}

const snapshot = (store: Store) => store.db.read((q) => exportTables(q));

/** Re-sign a modified backup body, as a careful attacker or a buggy tool could. */
function resign(file: BackupFile): string {
  const body: Partial<BackupFile> = { ...file };
  delete body.checksum;
  return JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });
}

describe('sha256Hex', () => {
  it('matches node:crypto, including multi-byte text and block boundaries', () => {
    const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Kōrero 💪 120 kg × 5', 'lone \ud800 surrogate', 'x'.repeat(10_000)];
    for (const s of inputs) expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

describe('createBackup / restore', () => {
  let source: DatabaseManager;
  let backupText: string;

  beforeEach(async () => {
    source = await openManager(dir());
    await populate(source.store);
    const created = await createBackup(source.store, { at: at(3600), app: APP });
    backupText = created.text;
    expect(created.integrity.ok).toBe(true);
    expect(created.fileName).toBe('fizz-backup-2026-10-08T07-00-00Z-v1.json');
    expect(created.counts).toMatchObject({ profiles: 1, gyms: 1, equipment: 6, exercises: 2, routines: 1, progressionRules: 2, finishedWorkouts: 1, unfinishedWorkouts: 1, loggedSets: 3 });
  });
  afterEach(async () => {
    await source.close();
  });

  it('round-trips every table and every aggregate exactly', async () => {
    const target = await openManager(dir());
    const preview = await target.preview(backupText);
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.preview).toMatchObject({
      identical: false,
      needsMigration: false,
      replacesUnfinishedWorkout: false,
      backup: { app: APP, schemaVersion: 1, counts: { equipment: 6, finishedWorkouts: 1 } },
      current: { counts: { equipment: 0, finishedWorkouts: 0 } },
    });

    const out = await target.restore(backupText, at(4000));
    expect(out).toMatchObject({ ok: true, status: 'restored' });
    expect(await snapshot(target.store)).toEqual(await snapshot(source.store));
    const richId = richFinishedSession().session.id;
    expect(await target.store.repos.sessions.get(richId)).toEqual(await source.store.repos.sessions.get(richId));
    expect(await target.store.repos.equipment.listByGym(barbell().gymId)).toEqual(await source.store.repos.equipment.listByGym(barbell().gymId));
    expect((await checkIntegrity(target.store.db)).ok).toBe(true);

    // The restored database is live: the unfinished workout resumes, and an operation
    // ID processed before the backup is still recognised as a duplicate.
    const service = createSessionService(target.store.repos, idGen(99_000));
    const recovered = await service.recover(OWNER, at(5000));
    expect(recovered?.state.session.startOperationId).toBe('start-active');
    const firstSet = recovered?.state.sets[0]?.id ?? '';
    const sessionId = recovered?.state.session.id ?? '';
    const cmd = logCmd(firstSet, values(kg(15, 'per_hand'), 9), 5000, 'after-restore');
    expect(await service.dispatch(sessionId, cmd)).toMatchObject({ ok: true, duplicate: false });
    const backupAgain = await createBackup(target.store, { at: at(6000), app: APP });
    const third = await openManager(dir());
    await third.restore(backupAgain.text, at(6100));
    const svc3 = createSessionService(third.store.repos, idGen(99_500));
    expect(await svc3.dispatch(sessionId, cmd)).toMatchObject({ ok: true, duplicate: true });
    await third.close();
    await target.close();
  });

  it('a duplicate restore is a no-op and keeps the rollback target', async () => {
    const d = dir();
    const target = await openManager(d);
    await target.store.repos.profiles.save(profile({ effortScale: 'off' }), null);
    const before = await snapshot(target.store);
    const first = await target.restore(backupText, at(4000));
    expect(first).toMatchObject({ ok: true, status: 'restored' });
    const slots = target.databaseNames;
    expect(slots).toEqual({ current: 'training-2.db', previous: 'training-1.db', orphan: null });

    const second = await target.restore(backupText, at(4100));
    expect(second).toMatchObject({ ok: true, status: 'unchanged', preview: { identical: true } });
    expect(target.databaseNames).toEqual(slots);
    expect(await snapshot(target.store)).toEqual(await snapshot(source.store));

    // Rollback returns to the data from before the restore, and can itself be undone.
    expect(await target.rollback(at(4200))).toMatchObject({ ok: true });
    expect(await snapshot(target.store)).toEqual(before);
    expect(await target.rollback(at(4300))).toMatchObject({ ok: true });
    expect(await snapshot(target.store)).toEqual(await snapshot(source.store));
    await target.close();

    // The switch is durable: a relaunch opens the same database.
    const relaunched = await openManager(d);
    expect(relaunched.databaseNames.current).toBe('training-2.db');
    expect(await snapshot(relaunched.store)).toEqual(await snapshot(source.store));
    await relaunched.close();
  });

  it('a second restore drops the oldest database file, keeping one for rollback', async () => {
    const d = dir();
    const target = await openManager(d);
    await target.restore(backupText, at(4000));
    await target.store.repos.gyms.save(gym(30), null);
    await target.restore(backupText, at(4100));
    expect(target.databaseNames).toEqual({ current: 'training-3.db', previous: 'training-2.db', orphan: null });
    expect(readdirSync(d).filter((f) => f.endsWith('.db')).sort()).toEqual(['fizz-meta.db', 'training-2.db', 'training-3.db']);
    await target.close();
  });

  it('refuses rollback when there is nothing to go back to', async () => {
    const target = await openManager(dir());
    expect(await target.rollback(at(0))).toMatchObject({ ok: false, error: { code: 'nothing_to_roll_back' } });
    await target.close();
  });

  describe('rejected or failed restores leave the current database intact', () => {
    let d: string;
    let target: DatabaseManager;
    let before: Awaited<ReturnType<typeof snapshot>>;
    beforeEach(async () => {
      d = dir();
      target = await openManager(d);
      await target.store.repos.profiles.save(profile(), null);
      await target.store.repos.gyms.save(gym(50), null);
      before = await snapshot(target.store);
    });
    afterEach(async () => {
      await target.close();
    });
    const files = () => readdirSync(d).filter((f) => f.endsWith('.db')).sort();
    async function expectUntouched(): Promise<void> {
      expect(await snapshot(target.store)).toEqual(before);
      expect(target.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
      expect(files()).toEqual(['fizz-meta.db', 'training-1.db']);
    }

    it.each([
      ['a flipped byte', (t: string) => t.replace('"reps"', '"rEps"'), 'checksum_mismatch'],
      ['a changed value', (t: string) => t.replace('"actual_reps":10', '"actual_reps":11'), 'checksum_mismatch'],
      ['truncation', (t: string) => t.slice(0, t.length / 2), 'malformed'],
      ['another JSON file', () => JSON.stringify({ hello: 'world' }), 'not_a_backup'],
      ['a missing field', (t: string) => JSON.stringify({ ...(JSON.parse(t) as object), app: undefined }), 'malformed'],
    ])('rejects %s', async (_label, corrupt, code) => {
      const tampered = corrupt(backupText);
      expect(tampered).not.toBe(backupText);
      expect(await target.restore(tampered, at(4000))).toMatchObject({ ok: false, error: { code } });
      await expectUntouched();
    });

    it('rejects a re-signed backup whose records are invalid, after building and discarding a fresh file', async () => {
      const file = JSON.parse(backupText) as BackupFile;
      const profileRow = file.tables.profiles?.[0];
      if (!profileRow || typeof profileRow.data !== 'string') throw new Error('fixture');
      profileRow.data = profileRow.data.replace('Pacific/Auckland', 'Mars/Olympus');
      const out = await target.restore(resign(file), at(4000));
      expect(out).toMatchObject({ ok: false, error: { code: 'integrity_failed' } });
      if (!out.ok) expect(out.error.issues?.[0]).toMatchObject({ path: `profiles.${OWNER}`, message: expect.stringContaining('time zone') as unknown });
      await expectUntouched();
    });

    it('rejects unknown tables and columns (files are data, not instructions)', async () => {
      const file = JSON.parse(backupText) as BackupFile;
      const extraTable = { ...file, tables: { ...file.tables, evil: [] }, counts: { ...file.counts, evil: 0 } };
      expect(await target.restore(resign(extraTable), at(4000))).toMatchObject({ ok: false, error: { code: 'unexpected_tables' } });
      const gymsRows = file.tables.gyms ?? [];
      const extraColumn = { ...file, tables: { ...file.tables, gyms: gymsRows.map((r) => ({ ...r, 'id") VALUES (1); DROP TABLE gyms; --': 'x' })) } };
      expect(await target.restore(resign(extraColumn), at(4000))).toMatchObject({ ok: false, error: { code: 'unexpected_columns' } });
      await expectUntouched();
    });

    it('never adopts or deletes a database file it did not create', async () => {
      await target.close();
      target = await openManager(d, { newName: () => 'training-1.db' });
      expect(await target.restore(backupText, at(4000))).toMatchObject({ ok: false, error: { code: 'restore_failed' } });
      await expectUntouched();
      await target.close();
      // A stray non-empty file with the chosen name is left alone too.
      const stray = await openManager(dir(), { newName: () => 'stray.db' });
      await stray.close();
      target = await openManager(d, { newName: () => 'fizz-meta.db' });
      expect(await target.restore(backupText, at(4000))).toMatchObject({ ok: false, error: { code: 'restore_failed' } });
      await expectUntouched();
    });

    it('rolls back a restore that fails while loading rows', async () => {
      await target.close();
      const real = nodeDatabaseHost(d);
      const host: DatabaseHost = {
        open: async (name) => (name === 'training-2.db' ? failingDriver(await real.open(name), (sql) => sql.includes('INSERT INTO "set_audit"')) : real.open(name)),
        remove: (name) => real.remove(name),
      };
      target = await openManager(d, { host });
      const out = await target.restore(backupText, at(4000));
      expect(out).toMatchObject({ ok: false, error: { code: 'restore_failed' } });
      await expectUntouched();
    });

    it('cleans up after a restore that crashed before the switch', async () => {
      await target.close();
      const real = nodeDatabaseHost(d);
      const crashing: DatabaseHost = {
        open: async (name) => (name === 'training-2.db' ? failingDriver(await real.open(name), (sql) => sql.includes('INSERT INTO "sessions"')) : real.open(name)),
        // The process "dies" before it can delete the half-built file.
        remove: () => Promise.reject(new Error('killed')),
      };
      target = await openManager(d, { host: crashing });
      expect(await target.restore(backupText, at(4000))).toMatchObject({ ok: false });
      expect(target.databaseNames.orphan).toBe('training-2.db');
      await target.close();

      target = await openManager(d);
      await expectUntouched();
    });
  });
});

describe('restoring a backup from an older schema version', () => {
  const v2: Migration = sqlMigration(
    2,
    'gym name column',
    "ALTER TABLE gyms ADD COLUMN name TEXT NOT NULL DEFAULT ''; UPDATE gyms SET name = json_extract(data, '$.name');",
  );
  const withV2 = [...MIGRATIONS, v2];

  it('loads it at its own version, then migrates it forward', async () => {
    const old = await openManager(dir());
    await populate(old.store);
    const backup = await createBackup(old.store, { at: at(100), app: APP });
    expect(backup.schemaVersion).toBe(1);

    const newer = await openManager(dir(), { migrations: withV2 });
    expect(await newer.store.db.read((q) => readUserVersion(q))).toBe(2);
    const out = await newer.restore(backup.text, at(200));
    expect(out).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true, identical: false } });
    expect(await newer.store.db.read((q) => readUserVersion(q))).toBe(2);
    expect(await newer.store.db.read((q) => q.getAll('SELECT id, name FROM gyms'))).toEqual([{ id: id(2), name: 'Gym 2' }]);
    const richId = richFinishedSession().session.id;
    expect(await newer.store.repos.sessions.get(richId)).toEqual(await old.store.repos.sessions.get(richId));

    // A backup from the newer schema can't be restored by the older build.
    const newerBackup = await createBackup(newer.store, { at: at(300), app: APP });
    expect(parseBackup(newerBackup.text)).toMatchObject({ ok: false, error: { code: 'schema_too_new' } });
    expect(await old.restore(newerBackup.text, at(400))).toMatchObject({ ok: false, error: { code: 'schema_too_new' } });
    await old.close();
    await newer.close();
  });
});

describe('checkIntegrity', () => {
  it('reports corrupt documents and dangling references without stopping at the first', async () => {
    const m = await openManager(dir());
    await populate(m.store);
    expect(await checkIntegrity(m.store.db)).toMatchObject({ ok: true, issues: [], checked: { equipment: 6, sessions: 2 } });

    await m.store.db.driver.run("UPDATE gyms SET data = json_set(data, '$.isDefault', 'yes')");
    await m.store.db.driver.exec('PRAGMA foreign_keys = OFF'); // simulate a connection that doesn't enforce them
    await m.store.db.driver.run("UPDATE session_sets SET session_exercise_id = ? WHERE ordinal = 0 AND session_id = ?", [
      id(1234),
      richFinishedSession().session.id,
    ]);
    const report = await checkIntegrity(m.store.db);
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.table).sort()).toEqual(['gyms', 'session_sets', 'sessions']);
    await m.close();
  });
});
