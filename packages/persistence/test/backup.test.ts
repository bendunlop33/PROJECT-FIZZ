import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService, newCheckIn, newPainFlag, reduceSession, stableStringify } from '@fizz/domain';
import {
  assisted,
  at,
  barbell,
  bodyweightStation,
  doubleProgression,
  dumbbells,
  exercise,
  gym,
  hotelFixture,
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
  latestVersion,
  MIGRATIONS,
  parseBackup,
  readUserVersion,
  sha256Hex,
  sha256HexAsync,
  Sha256Stream,
  sqlMigration,
  timeSlicer,
  utf8Bytes,
  writeStable,
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
  // Saved from a finished workout (premium-feel §2.6): the new optional fields round-trip too.
  await repos.routines.save(
    { ...routine([routineExercise(700, { exerciseId: SPLIT_SQUAT.id, restBySetType: { working: { seconds: 120 } } })]), createdFromSessionId: richFinishedSession().session.id, deletedAtUtc: null, lastOpId: 'save-routine-op' },
    null,
  );
  await repos.progressionRules.save(doubleProgression(), null);
  await repos.progressionRules.save(topSetBackoff(), null);
  await repos.sessions.save(richFinishedSession(), null);
  const active = unilateralSession('start-active', idGen(97_000));
  // Schema 2: a check-in linked to the active workout, and a pain flag.
  const checkIn = newCheckIn({ id: id(300), ownerId: OWNER, opId: 'checkin-op', score: 2, reasons: ['tired', 'pain'], note: 'Baby was up at 3', at: at(10), localDate: '2026-10-08' });
  await repos.checkIns.save(checkIn, null);
  await repos.painFlags.save(
    newPainFlag({ id: id(301), ownerId: OWNER, opId: 'pain-op', exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: 'knee', source: 'check_in', checkInId: checkIn.id, at: at(11) }),
    null,
  );
  await repos.sessions.save({ ...active, session: { ...active.session, checkIn: { kind: 'answered', checkInId: checkIn.id } } }, null);
}

const snapshot = (store: Store) => store.db.read((q) => exportTables(q));

/** Re-sign a modified backup body, as a careful attacker or a buggy tool could. */
function resign(file: BackupFile): string {
  const body: Partial<BackupFile> = { ...file };
  delete body.checksum;
  return JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });
}

describe('sha256Hex', () => {
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Kōrero 💪 120 kg × 5', 'lone \ud800 surrogate', 'ends \ud800', '\udc00 first', 'x'.repeat(10_000)];
  const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

  it('matches node:crypto, including multi-byte text and block boundaries', () => {
    for (const s of inputs) expect(sha256Hex(s)).toBe(node(s));
    for (const s of inputs) expect(Buffer.from(utf8Bytes(s)).equals(Buffer.from(s, 'utf8'))).toBe(true);
  });

  it('streams: any split, even inside a surrogate pair, and a clone finishes independently (B1)', async () => {
    for (const s of inputs.slice(0, -1)) {
      for (let cut = 0; cut <= s.length; cut += 1) expect(new Sha256Stream().update(s, 0, cut).update(s, cut).digestHex()).toBe(node(s));
    }
    const prefix = new Sha256Stream().update('{"a":1');
    const copy = prefix.clone();
    expect(prefix.update('}').digestHex()).toBe(node('{"a":1}'));
    expect(copy.update(',"b":2}').digestHex()).toBe(node('{"a":1,"b":2}'));
    const big = 'Bench 💪 '.repeat(20_000);
    expect(await sha256HexAsync(big, timeSlicer(0))).toBe(node(big));
  });

  it('writeStable pieces are exactly stableStringify (B1)', async () => {
    const value = { b: [1, 'x', null, { z: undefined, y: [true, { q: 'Kōrero' }] }], a: { c: 2.5, d: [] }, e: undefined, f: '\ud800' };
    const pieces: string[] = [];
    await writeStable(value, (p) => pieces.push(p), timeSlicer(0));
    expect(pieces.join('')).toBe(stableStringify(value));
  });
});

describe('timeSlicer', () => {
  it('pauses only once its budget is used', async () => {
    let now = 0;
    let pauses = 0;
    const slice = timeSlicer(8, () => ((pauses += 1), Promise.resolve()), () => now);
    await slice();
    now = 7;
    await slice();
    expect(pauses).toBe(0);
    now = 8;
    await slice();
    expect(pauses).toBe(1);
    await slice();
    expect(pauses).toBe(1);
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
    // One pass hashes both: the whole file's SHA-256 and the body checksum (B1).
    expect(created.sha256).toBe(sha256Hex(created.text));
    const parsed = await parseBackup(created.text);
    expect(parsed.ok && parsed.file.checksum.value).toBe(created.checksum);
    expect(created.fileName).toBe(`fizz-backup-2026-10-08T07-00-00Z-v${latestVersion()}.json`);
    expect(created.counts).toMatchObject({ profiles: 1, gyms: 1, equipment: 6, exercises: 2, routines: 1, progressionRules: 2, finishedWorkouts: 1, unfinishedWorkouts: 1, loggedSets: 3 });
  });
  afterEach(async () => {
    await source.close();
  });

  it('records the same coverage digest as the store, and a correction to a finished workout moves it (S1)', async () => {
    const created = await createBackup(source.store, { at: at(3600), app: APP });
    expect(created.finishedWorkoutsDigest).toBe(await source.store.finishedWorkoutsDigest());
    const workout = richFinishedSession();
    const stored = await source.store.db.read((q) => q.getFirst<{ version: number }>('SELECT version FROM sessions WHERE id = ?', [workout.session.id]));
    const fixed = await createSessionService(source.store.repos, idGen(95_000)).dispatch(workout.session.id, {
      type: 'rename_session',
      at: at(7200),
      opId: 'rename-after-backup',
      name: 'Upper A',
      expectedVersion: stored?.version ?? 0,
    });
    expect(fixed.ok).toBe(true);
    const renamed = await source.store.finishedWorkoutsDigest();
    expect(renamed).not.toBe(created.finishedWorkoutsDigest);
    const again = await createBackup(source.store, { at: at(7300), app: APP });
    expect(again.finishedWorkoutsDigest).toBe(renamed);
  });

  it('holds a checked backup for Restore until told to forget it (N2)', async () => {
    const target = await openManager(dir());
    expect(target.holdsCheckedBackup).toBe(false);
    expect((await target.check(backupText)).ok).toBe(true);
    expect(target.holdsCheckedBackup).toBe(true);
    target.forgetChecked();
    expect(target.holdsCheckedBackup).toBe(false);
    expect((await target.check(backupText)).ok).toBe(true);
    await target.close();
  });

  it('round-trips every table and every aggregate exactly', async () => {
    const target = await openManager(dir());
    const preview = await target.preview(backupText);
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.preview).toMatchObject({
      identical: false,
      needsMigration: false,
      replacesUnfinishedWorkout: false,
      backup: { app: APP, schemaVersion: latestVersion(), counts: { equipment: 6, finishedWorkouts: 1 } },
      current: { counts: { equipment: 0, finishedWorkouts: 0 } },
    });

    const out = await target.restore(backupText, at(4000));
    expect(out).toMatchObject({ ok: true, status: 'restored' });
    expect(await snapshot(target.store)).toEqual(await snapshot(source.store));
    const richId = richFinishedSession().session.id;
    expect(await target.store.repos.sessions.get(richId)).toEqual(await source.store.repos.sessions.get(richId));
    expect(await target.store.repos.equipment.listByGym(barbell().gymId)).toEqual(await source.store.repos.equipment.listByGym(barbell().gymId));
    expect(await target.store.repos.routines.get(id(300))).toMatchObject({ createdFromSessionId: richId, deletedAtUtc: null, lastOpId: 'save-routine-op' });
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

    it.each([
      ['a new file won’t open (disk full)', 'open'],
      ['the meta database can’t record the new file', 'meta'],
    ] as const)('returns restore_failed, never a rejection, when %s (review S3)', async (_label, broken) => {
      await target.close();
      const real = nodeDatabaseHost(d);
      const host: DatabaseHost = {
        open: async (name) => {
          if (name === 'fizz-meta.db') return broken === 'meta' ? failingDriver(await real.open(name), (sql) => sql.startsWith('UPDATE database_slots')) : real.open(name);
          if (broken === 'open' && name !== 'training-1.db') throw new Error('ENOSPC: no space left on device');
          return real.open(name);
        },
        remove: (name) => real.remove(name),
      };
      target = await openManager(d, { host });
      await expect(target.restore(backupText, at(4000))).resolves.toMatchObject({ ok: false, error: { code: 'restore_failed' } });
      await expect(target.check(backupText)).resolves.toMatchObject({ ok: false, error: { code: 'restore_failed' } });
      expect(await snapshot(target.store)).toEqual(before);
      expect(target.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
      await target.close();
      // A relaunch with working storage leaves nothing behind.
      target = await openManager(d);
      await expectUntouched();
    });

    it('refuses a restore whose preview no longer matches the data (review S5)', async () => {
      const p = await target.preview(backupText);
      if (!p.ok) throw new Error(p.error.message);
      await target.store.repos.gyms.save(gym(51), null);
      expect(await target.restore(backupText, at(4000), { expectedStamp: p.preview.stamp })).toMatchObject({ ok: false, error: { code: 'preview_stale' } });
      expect(target.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
      expect(files()).toEqual(['fizz-meta.db', 'training-1.db']);
      const again = await target.preview(backupText);
      if (!again.ok) throw new Error(again.error.message);
      expect(again.preview.stamp).not.toBe(p.preview.stamp);
      expect(await target.restore(backupText, at(4000), { expectedStamp: again.preview.stamp })).toMatchObject({ ok: true, status: 'restored' });
    });

    it('rollback returns restore_failed, never a rejection, when the earlier file won’t open (review S3)', async () => {
      expect(await target.restore(backupText, at(4000))).toMatchObject({ ok: true, status: 'restored' });
      await target.close();
      const real = nodeDatabaseHost(d);
      const host: DatabaseHost = {
        open: (name) => (name === 'training-1.db' ? Promise.reject(new Error('unable to open database file')) : real.open(name)),
        remove: (name) => real.remove(name),
      };
      target = await openManager(d, { host });
      const restored = await snapshot(target.store);
      await expect(target.rollback(at(4100))).resolves.toMatchObject({ ok: false, error: { code: 'restore_failed' } });
      expect(target.databaseNames).toMatchObject({ current: 'training-2.db', previous: 'training-1.db' });
      expect(await snapshot(target.store)).toEqual(restored);
      await target.close();
      // Nothing was lost: with the file readable again, Undo works.
      target = await openManager(d);
      expect(await target.rollback(at(4200))).toMatchObject({ ok: true });
      expect(await snapshot(target.store)).toEqual(before);
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

describe('restoring a backup from schema 1 (before check-ins)', () => {
  it('loads it at version 1, migrates it forward, and its sessions read with no check-in', async () => {
    // A schema-1 file as an older build wrote it: no check-in tables or columns.
    const src = await openManager(dir());
    await src.store.repos.profiles.save(profile({ preferredUnit: 'lb' }), null);
    await src.store.repos.sessions.save(richFinishedSession(), null);
    const made = await createBackup(src.store, { at: at(100), app: APP });
    await src.close();
    const file = JSON.parse(made.text) as BackupFile;
    const tables = { ...file.tables };
    delete tables.check_ins;
    delete tables.pain_flags;
    // …and nothing from schema 3 (imports).
    delete tables.import_jobs;
    delete tables.import_rows;
    delete tables.exercise_aliases;
    // …and nothing from schema 4 (coach).
    for (const t of ['coach_threads', 'coach_turns', 'coach_messages', 'coach_actions', 'memories', 'playbook_candidates', 'next_session_targets', 'next_target_uses', 'coach_offers', 'pre_start_drafts']) Reflect.deleteProperty(tables, t);
    tables.sessions = (tables.sessions ?? []).map((row) => {
      const copy = { ...row };
      delete copy.check_in;
      delete copy.check_in_id;
      delete copy.import_job_id;
      delete copy.local_date;
      // …and nothing from schema 4 (Finish by, set exclusions below)…
      delete copy.finish_by_utc;
      delete copy.finish_by_tz;
      // …or schema 5 (gym switch).
      delete copy.gym_changes;
      // …or schema 7 (today's edits).
      delete copy.today_edits;
      // …or schema 8 (Progress's Count it).
      delete copy.duration_confirmed_at_utc;
      delete copy.duration_confirmed_at_tz;
      return copy;
    });
    tables.session_exercises = (tables.session_exercises ?? []).map((row) => {
      const copy = { ...row };
      delete copy.continues_from_id;
      delete copy.equipment_version;
      return copy;
    });
    tables.session_sets = (tables.session_sets ?? []).map((row) => {
      const copy = { ...row };
      delete copy.exclusions;
      delete copy.skipped_by;
      return copy;
    });
    const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
    const v1 = resign({ ...file, schemaVersion: 1, tables, counts });

    const current = await openManager(dir());
    const out = await current.restore(v1, at(200));
    expect(out).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(await current.store.db.read((q) => readUserVersion(q))).toBe(latestVersion());
    const restored = await current.store.repos.sessions.get(richFinishedSession().session.id);
    expect(restored?.session.checkIn).toBeNull();
    expect(await current.store.repos.checkIns.listSince(OWNER, '2000-01-01T00:00:00.000Z')).toEqual([]);
    await current.close();
  });
});

describe('restoring a backup from an older schema version', () => {
  const next = latestVersion() + 1;
  const vNext: Migration = sqlMigration(
    next,
    'gym name column',
    "ALTER TABLE gyms ADD COLUMN name TEXT NOT NULL DEFAULT ''; UPDATE gyms SET name = json_extract(data, '$.name');",
  );
  const withV2 = [...MIGRATIONS, vNext];

  it('loads it at its own version, then migrates it forward', async () => {
    const old = await openManager(dir());
    await populate(old.store);
    const backup = await createBackup(old.store, { at: at(100), app: APP });
    expect(backup.schemaVersion).toBe(latestVersion());

    const newer = await openManager(dir(), { migrations: withV2 });
    expect(await newer.store.db.read((q) => readUserVersion(q))).toBe(next);
    const out = await newer.restore(backup.text, at(200));
    expect(out).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true, identical: false } });
    expect(await newer.store.db.read((q) => readUserVersion(q))).toBe(next);
    expect(await newer.store.db.read((q) => q.getAll('SELECT id, name FROM gyms'))).toEqual([{ id: id(2), name: 'Gym 2' }]);
    const richId = richFinishedSession().session.id;
    expect(await newer.store.repos.sessions.get(richId)).toEqual(await old.store.repos.sessions.get(richId));

    // A backup from the newer schema can't be restored by the older build.
    const newerBackup = await createBackup(newer.store, { at: at(300), app: APP });
    expect(await parseBackup(newerBackup.text)).toMatchObject({ ok: false, error: { code: 'schema_too_new' } });
    expect(await old.restore(newerBackup.text, at(400))).toMatchObject({ ok: false, error: { code: 'schema_too_new' } });
    await old.close();
    await newer.close();
  });
});

describe('merged schema: active-set (4) and gym switch (5)', () => {
  /** A switched workout with Ben's exclusion on a logged set and a `Finish by`: every field the two migrations added. */
  function switchedWithFlags() {
    const { BENCH, HOTEL, HOTEL_EQ, exerciseSets, propose, pushA, switchCmd } = hotelFixture;
    const ok = (r: ReturnType<typeof reduceSession>) => {
      if (!r.ok) throw new Error(r.error.message);
      return r.state;
    };
    let s = pushA();
    const bench = exerciseSets(s, BENCH);
    s = ok(reduceSession(s, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 60)));
    s = ok(reduceSession(s, switchCmd(propose(s, { id: HOTEL, equipment: HOTEL_EQ }), 320)));
    const done = s.sets.find((x) => x.id === bench[0]?.id);
    s = ok(reduceSession(s, { type: 'correct_set', at: at(330), opId: 'mark-spotted', setId: done?.id ?? '', expectedSetVersion: done?.version ?? 1, patch: { exclusions: ['spotted'] } }));
    s = ok(reduceSession(s, { type: 'set_finish_by', at: at(340), opId: 'finish-by', finishBy: at(4000), expectedVersion: s.session.version }));
    return s;
  }

  it('a backup from build 91 (schema 4: exclusions, Finish by) restores into schema 5 and migrates forward', async () => {
    const src = await openManager(dir());
    await populate(src.store);
    // A schema-4 workout: an exclusion on a logged set and a `Finish by`, no gym change.
    const { BENCH, exerciseSets, pushA } = hotelFixture;
    const ok = (r: ReturnType<typeof reduceSession>) => {
      if (!r.ok) throw new Error(r.error.message);
      return r.state;
    };
    let w = pushA();
    const first = exerciseSets(w, BENCH)[0];
    w = ok(reduceSession(w, logCmd(first?.id ?? '', values(kg(100), 8), 60)));
    w = ok(reduceSession(w, { type: 'finish', at: at(90), opId: 'fin-v4', expectedVersion: w.session.version, endedAt: null }));
    const done = w.sets.find((x) => x.id === first?.id);
    w = ok(reduceSession(w, { type: 'correct_set', at: at(100), opId: 'mark-v4', setId: done?.id ?? '', expectedSetVersion: done?.version ?? 1, patch: { exclusions: ['pain'] } }));
    await src.store.repos.sessions.save(w, null);
    const made = await createBackup(src.store, { at: at(200), app: APP });
    await src.close();
    // Build 91 had no gym-switch columns.
    const file = JSON.parse(made.text) as BackupFile;
    const tables = { ...file.tables };
    tables.sessions = (tables.sessions ?? []).map((row) => {
      const copy = { ...row };
      delete copy.gym_changes;
      // …or schema 7 (today's edits).
      delete copy.today_edits;
      // …or schema 8 (Progress's Count it).
      delete copy.duration_confirmed_at_utc;
      delete copy.duration_confirmed_at_tz;
      return copy;
    });
    tables.session_exercises = (tables.session_exercises ?? []).map((row) => {
      const copy = { ...row };
      delete copy.continues_from_id;
      delete copy.equipment_version;
      return copy;
    });
    tables.session_sets = (tables.session_sets ?? []).map((row) => {
      const copy = { ...row };
      delete copy.skipped_by;
      return copy;
    });
    // Nor coach tables (schema 6).
    for (const t of ['coach_threads', 'coach_turns', 'coach_messages', 'coach_actions', 'memories', 'playbook_candidates', 'next_session_targets', 'next_target_uses', 'coach_offers', 'pre_start_drafts']) Reflect.deleteProperty(tables, t);
    const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
    const v4 = resign({ ...file, schemaVersion: 4, tables, counts });

    const current = await openManager(dir());
    expect(await current.restore(v4, at(300))).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(await current.store.db.read((q) => readUserVersion(q))).toBe(latestVersion());
    const read = await current.store.repos.sessions.get(w.session.id);
    expect(read).toEqual(w);
    expect(read?.sets.find((x) => x.id === first?.id)?.exclusions).toEqual(['pain']);
    expect(read?.session.gymChanges).toBeUndefined();
    expect((await checkIntegrity(current.store.db)).ok).toBe(true);
    await current.close();
  });

  it('a backup at schema 5 round-trips a switched workout with exclusions and Finish by', async () => {
    const source = await openManager(dir());
    await source.store.repos.profiles.save(profile(), null);
    const s = switchedWithFlags();
    expect(s.session.gymChanges).toHaveLength(1);
    expect(s.session.finishBy).toBeDefined();
    expect(s.sets.some((x) => x.exclusions?.includes('spotted'))).toBe(true);
    await source.store.repos.sessions.save(s, null);
    const backup = await createBackup(source.store, { at: at(500), app: APP });
    expect(backup.schemaVersion).toBe(latestVersion());
    const target = await openManager(dir());
    expect(await target.restore(backup.text, at(600))).toMatchObject({ ok: true, status: 'restored' });
    expect(await target.store.repos.sessions.get(s.session.id)).toEqual(s);
    expect((await checkIntegrity(target.store.db)).ok).toBe(true);
    await source.close();
    await target.close();
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

describe('check a backup (verifyBackup, DX3) and restore bookkeeping', () => {
  let source: DatabaseManager;
  let backupText: string;
  beforeEach(async () => {
    source = await openManager(dir());
    await populate(source.store);
    backupText = (await createBackup(source.store, { at: at(3600), app: APP })).text;
  });
  afterEach(async () => {
    await source.close();
  });
  const dbFiles = (d: string) => readdirSync(d).filter((f) => f.endsWith('.db')).sort();

  it('rebuilds the file in a scratch database, reports it restorable, and changes nothing', async () => {
    const d = dir();
    const target = await openManager(d);
    await target.store.repos.profiles.save(profile(), null);
    const before = await snapshot(target.store);
    const out = await target.check(backupText);
    expect(out).toMatchObject({ ok: true, restorable: true, issues: [], preview: { identical: false, backup: { counts: { finishedWorkouts: 1 } } } });
    expect(await snapshot(target.store)).toEqual(before);
    expect(target.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
    expect(target.rollbackTarget).toEqual({ available: false, last: null });
    expect(dbFiles(d)).toEqual(['fizz-meta.db', 'training-1.db']);
    await target.close();
  });

  it('reports damaged records as "won\'t restore" without touching anything', async () => {
    const d = dir();
    const target = await openManager(d);
    const file = JSON.parse(backupText) as BackupFile;
    const row = file.tables.profiles?.[0];
    if (!row || typeof row.data !== 'string') throw new Error('fixture');
    row.data = row.data.replace('Pacific/Auckland', 'Mars/Olympus');
    const out = await target.check(resign(file));
    expect(out).toMatchObject({ ok: true, restorable: false });
    if (out.ok) expect(out.issues[0]).toMatchObject({ path: `profiles.${OWNER}` });
    expect(dbFiles(d)).toEqual(['fizz-meta.db', 'training-1.db']);
    expect(await target.check(backupText.replace('"reps"', '"rEps"'))).toMatchObject({ ok: false, error: { code: 'checksum_mismatch' } });
    await target.close();
  });

  it('a check after a restore keeps the rollback target and the last-switch record', async () => {
    const d = dir();
    const target = await openManager(d);
    await target.store.repos.profiles.save(profile({ effortScale: 'off' }), null);
    await target.restore(backupText, at(4000));
    const slots = target.databaseNames;
    expect(target.rollbackTarget).toEqual({ available: true, last: { atUtc: at(4000).utc, reason: 'restore' } });
    expect(await target.check(backupText)).toMatchObject({ ok: true, restorable: true, preview: { identical: true } });
    expect(target.databaseNames).toEqual(slots);
    await target.rollback(at(4100));
    expect(target.rollbackTarget).toEqual({ available: true, last: { atUtc: at(4100).utc, reason: 'rollback' } });
    await target.close();
    // The record survives a relaunch.
    const again = await openManager(d);
    expect(again.rollbackTarget.last).toEqual({ atUtc: at(4100).utc, reason: 'rollback' });
    expect(again.interruptedRestore).toBe(false);
    await again.close();
  });

  it('counts what is only on this phone, so the preview can say what a restore replaces', async () => {
    const small = await openManager(dir());
    await small.store.repos.profiles.save(profile({ preferredUnit: 'lb' }), null);
    const smallBackup = (await createBackup(small.store, { at: at(100), app: APP })).text;
    await small.close();
    const p = await source.preview(smallBackup);
    if (!p.ok) throw new Error(p.error.message);
    const sessions = await source.store.db.read((q) => q.getAll<{ started_at_utc: string }>("SELECT started_at_utc FROM sessions WHERE status != 'discarded' ORDER BY started_at_utc"));
    // Gym, 6 equipment, the custom exercise, routine, 2 rules, check-in, pain flag; the profile is in both.
    // The catalogue exercise (no owner) is Coaching knowledge, never counted (review R1, rule 10).
    expect(p.preview.onlyOnPhone).toEqual({ workouts: 2, newestWorkoutUtc: sessions.at(-1)?.started_at_utc ?? null, otherRecords: 13 });
    const same = await source.preview(backupText);
    if (!same.ok) throw new Error(same.error.message);
    expect(same.preview.onlyOnPhone).toEqual({ workouts: 0, newestWorkoutUtc: null, otherRecords: 0 });
  });

  it('never counts shared Coaching-knowledge rows (ownerless exercises) as replaced, changed or lost (review R1, RS1)', async () => {
    // Two installs on different days: each seeds the same catalogue exercise with its own first-launch time.
    const starter = (atUtc: string, name = 'Bench press') => exercise(900, name, { createdAtUtc: atUtc, updatedAtUtc: atUtc });
    const other = await openManager(dir());
    await other.store.repos.profiles.save(profile(), null);
    await other.store.repos.exercises.save(starter(at(-86_400 * 30).utc), null);
    const otherBackup = (await createBackup(other.store, { at: at(100), app: APP })).text;
    await other.close();

    const fresh = await openManager(dir());
    // Only on this phone, and a different version of the shared row: neither is "your data".
    await fresh.store.repos.exercises.save(starter(at(0).utc, 'Bench press (new name)'), null);
    await fresh.store.repos.exercises.save(exercise(901, 'Starter only here'), null);
    const p = await fresh.preview(otherBackup);
    if (!p.ok) throw new Error(p.error.message);
    expect(p.preview.onlyOnPhone).toEqual({ workouts: 0, newestWorkoutUtc: null, otherRecords: 0 });
    expect(p.preview.changedOnPhone).toEqual({ workouts: 0, newestWorkoutUtc: null, otherRecords: 0 });
    expect(await fresh.restore(otherBackup, at(200))).toMatchObject({ ok: true, status: 'restored' });
    // The copy kept for Undo holds only shared rows: nothing is lost with it.
    const again = await fresh.preview(otherBackup);
    if (!again.ok) throw new Error(again.error.message);
    expect(again.preview.keptForUndo).toMatchObject({ workouts: 0, otherRecords: 0 });
    // A custom exercise (owned) is your data and still counts.
    await fresh.store.repos.exercises.save(exercise(902, 'My press', { ownerId: OWNER, source: 'custom' }), null);
    const owned = await fresh.preview(otherBackup);
    if (!owned.ok) throw new Error(owned.error.message);
    expect(owned.preview.onlyOnPhone.otherRecords).toBe(1);
    await fresh.close();
  });

  it('counts records whose content differs from the backup as replaced (PM decision on SP3)', async () => {
    const target = await openManager(dir());
    await target.restore(backupText, at(4000));
    await target.store.repos.profiles.save({ ...profile({ preferredUnit: 'lb' }), effortScale: 'off', version: 2, updatedAtUtc: at(4100).utc }, 1);
    const p = await target.preview(backupText);
    if (!p.ok) throw new Error(p.error.message);
    expect(p.preview.identical).toBe(false);
    expect(p.preview.onlyOnPhone).toEqual({ workouts: 0, newestWorkoutUtc: null, otherRecords: 0 });
    expect(p.preview.changedOnPhone).toEqual({ workouts: 0, newestWorkoutUtc: null, otherRecords: 1 });
    await target.close();
  });

  it('a second restore after Undo says what the data kept for Undo holds before deleting it (review S2)', async () => {
    const d = dir();
    const target = await openManager(d);
    await target.store.repos.profiles.save(profile({ preferredUnit: 'lb' }), null);
    // 1. Restore A.
    expect(await target.restore(backupText, at(4000))).toMatchObject({ ok: true, status: 'restored' });
    expect(target.databaseNames).toEqual({ current: 'training-2.db', previous: 'training-1.db', orphan: null });
    // 2. Train on the restored data: finish the backup's unfinished workout and add a gym.
    const svc = createSessionService(target.store.repos, idGen(98_000));
    const active = await target.store.repos.sessions.getActive(OWNER);
    if (!active) throw new Error('fixture');
    expect(await svc.dispatch(active.session.id, { type: 'finish', at: at(4500), opId: 'fin-after-restore', expectedVersion: active.session.version, endedAt: null })).toMatchObject({ ok: true });
    await target.store.repos.gyms.save(gym(31), null);
    // 3. Undo restore: training-2.db (with that work) is now the copy kept for Undo.
    expect(await target.rollback(at(5000))).toMatchObject({ ok: true });
    expect(target.databaseNames).toEqual({ current: 'training-1.db', previous: 'training-2.db', orphan: null });

    // 4. Restore A again: the preview says what would be lost with the kept copy.
    const p = await target.preview(backupText);
    if (!p.ok) throw new Error(p.error.message);
    expect(p.preview.keptForUndo).toEqual({ workouts: 1, newestWorkoutUtc: active.session.startedAt.utc, otherRecords: 1, keptSinceUtc: at(5000).utc, unreadable: false });
    const checked = await target.check(backupText);
    expect(checked.ok && checked.preview.keptForUndo?.workouts).toBe(1);
    expect(await target.restore(backupText, at(6000))).toMatchObject({ ok: true, status: 'restored' });
    // The kept copy (training-2.db) was deleted, as the preview said; training-3.db was Check's scratch copy.
    expect(readdirSync(d).filter((f) => f.endsWith('.db')).sort()).toEqual(['fizz-meta.db', 'training-1.db', 'training-4.db']);

    // A kept copy whose data is all in the backup or on the phone loses nothing.
    const again = await target.preview(backupText);
    if (!again.ok) throw new Error(again.error.message);
    expect(again.preview.identical).toBe(true);
    await target.store.repos.gyms.save(gym(32), null);
    const after = await target.preview(backupText);
    if (!after.ok) throw new Error(after.error.message);
    expect(after.preview.keptForUndo).toMatchObject({ workouts: 0, otherRecords: 0 });
    await target.close();
  });

  it('says a restore was interrupted only when a restore (not a check) was building a file', async () => {
    const d = dir();
    const real = nodeDatabaseHost(d);
    const crashing: DatabaseHost = {
      open: async (name) => (name === 'training-2.db' ? failingDriver(await real.open(name), (sql) => sql.includes('INSERT INTO "sessions"')) : real.open(name)),
      remove: () => Promise.reject(new Error('killed')),
    };
    const target = await openManager(d, { host: crashing });
    expect(await target.restore(backupText, at(4000))).toMatchObject({ ok: false });
    await target.close();
    const relaunched = await openManager(d);
    expect(relaunched.interruptedRestore).toBe(true);
    expect(dbFiles(d)).toEqual(['fizz-meta.db', 'training-1.db']);
    await relaunched.close();
    const again = await openManager(d);
    expect(again.interruptedRestore).toBe(false);
    await again.close();
  });
});
