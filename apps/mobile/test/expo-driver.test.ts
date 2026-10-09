import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { at, describeRepositoryContract, gym, profile } from '@fizz/domain/testing';
import { createBackup, DatabaseManager, openStore } from '@fizz/persistence';

import {
  createExpoDatabaseHost,
  createExpoSqlDriver,
  isSqliteVersionSupported,
  parseSqliteVersion,
  readSqliteVersion,
  toSqlRow,
  UnexpectedSqlValueError,
} from '../src/data/expo-driver';
import { FakeExpoDatabase, fakeHostDeps } from './fake-expo-sqlite';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fizz-expo-driver-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function freshDriver() {
  const db = new FakeExpoDatabase(join(tempDir(), 't.db'));
  const driver = createExpoSqlDriver(db);
  await driver.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  return { db, driver };
}

describe('toSqlRow', () => {
  it('passes text, numbers and null through', () => {
    expect(toSqlRow({ a: 'x', b: 1.5, c: null })).toEqual({ a: 'x', b: 1.5, c: null });
  });
  it('turns a safe bigint into a number and rejects an unsafe one', () => {
    expect(toSqlRow({ n: 42n })).toEqual({ n: 42 });
    expect(() => toSqlRow({ n: 2n ** 60n })).toThrow(UnexpectedSqlValueError);
  });
  it('rejects blobs, booleans and non-objects instead of guessing', () => {
    expect(() => toSqlRow({ b: new Uint8Array([1]) })).toThrow(/blob/);
    expect(() => toSqlRow({ b: true })).toThrow(/boolean/);
    expect(() => toSqlRow(null)).toThrow(UnexpectedSqlValueError);
  });
});

describe('createExpoSqlDriver', () => {
  it('runs statements with bound parameters and normalises results', async () => {
    const { driver } = await freshDriver();
    const r = await driver.run('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(r).toEqual({ changes: 1, lastInsertRowId: 1 });
    expect(await driver.getAll('SELECT * FROM t')).toEqual([{ id: 1, v: 'a' }]);
    expect(await driver.getFirst('SELECT * FROM t WHERE id = ?', [2])).toBeNull();
  });

  it('does not let the caller mutate the parameter array it passed', async () => {
    const { db, driver } = await freshDriver();
    const params = ['b'] as const;
    let seen: unknown[] | null = null;
    const original = db.runAsync.bind(db);
    db.runAsync = (sql, p) => {
      seen = p;
      return original(sql, p);
    };
    await driver.run('INSERT INTO t (v) VALUES (?)', params);
    expect(seen).toEqual(['b']);
    expect(seen).not.toBe(params);
  });

  it('commits a transaction on a separate connection and returns its value', async () => {
    const { db, driver } = await freshDriver();
    const out = await driver.withExclusiveTransaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (?)', ['x']);
      return 'done';
    });
    expect(out).toBe('done');
    expect(await driver.getAll('SELECT v FROM t')).toEqual([{ v: 'x' }]);
    expect(db.log).toContain('BEGIN');
    expect(db.log).toContain('COMMIT');
  });

  it('rolls back everything when the transaction throws, and rethrows', async () => {
    const { driver } = await freshDriver();
    await expect(
      driver.withExclusiveTransaction(async (tx) => {
        await tx.run('INSERT INTO t (v) VALUES (?)', ['x']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await driver.getAll('SELECT * FROM t')).toEqual([]);
  });

  it('refuses the outer driver and nested transactions while a transaction is open', async () => {
    const { driver } = await freshDriver();
    await expect(
      driver.withExclusiveTransaction(async () => {
        await driver.run('INSERT INTO t (v) VALUES (?)', ['outer']);
      }),
    ).rejects.toThrow(/Outer driver used inside a transaction/);
    await expect(driver.withExclusiveTransaction(() => driver.withExclusiveTransaction(() => Promise.resolve(1)))).rejects.toThrow(/Nested transaction/);
    // The guard is released after a failure.
    expect(await driver.getAll('SELECT * FROM t')).toEqual([]);
  });

  it('refuses a transaction executor that leaked out of its transaction', async () => {
    const { driver } = await freshDriver();
    const leaked = await driver.withExclusiveTransaction((tx) => Promise.resolve(tx));
    await expect(leaked.run('INSERT INTO t (v) VALUES (?)', ['late'])).rejects.toThrow(/after the transaction ended/);
  });

  it('fails loudly after close, and close is idempotent', async () => {
    const { db, driver } = await freshDriver();
    await driver.close();
    await driver.close();
    expect(db.closed).toBe(true);
    await expect(driver.getAll('SELECT 1')).rejects.toThrow('Database is closed');
    await expect(driver.withExclusiveTransaction(() => Promise.resolve(1))).rejects.toThrow('Database is closed');
  });
});

describe('SQLite version check', () => {
  it('parses and compares against 3.37.0', () => {
    expect(parseSqliteVersion('3.45.1')).toEqual([3, 45, 1]);
    expect(parseSqliteVersion('nonsense')).toBeNull();
    expect(isSqliteVersionSupported('3.37.0')).toBe(true);
    expect(isSqliteVersionSupported('3.36.9')).toBe(false);
    expect(isSqliteVersionSupported('4.0.0')).toBe(true);
    expect(isSqliteVersionSupported('unknown')).toBe(false);
  });
  it('reads the engine version through the driver', async () => {
    const { driver } = await freshDriver();
    expect(isSqliteVersionSupported(await readSqliteVersion(driver))).toBe(true);
  });
});

describe('createExpoDatabaseHost', () => {
  it('removes the database and its -wal/-shm/-journal files, and is a no-op when missing', async () => {
    const dir = tempDir();
    const deps = fakeHostDeps(dir);
    const host = createExpoDatabaseHost(deps);
    const driver = await host.open('a.db');
    await driver.exec('PRAGMA journal_mode = WAL; CREATE TABLE x (id INTEGER PRIMARY KEY)');
    await driver.run('INSERT INTO x DEFAULT VALUES');
    writeFileSync(join(dir, 'a.db-journal'), '');
    await expect(host.remove('a.db')).rejects.toThrow(/currently open/);
    await driver.close();
    await host.remove('a.db');
    expect(readdirSync(dir)).toEqual([]);
    await host.remove('a.db');
    await host.remove('never-existed.db');
  });
});

// The domain's repository contract, run through the expo adapter.
describeRepositoryContract('SQLite (expo-sqlite adapter over a fake)', async () => {
  const store = await openStore(createExpoSqlDriver(new FakeExpoDatabase(join(tempDir(), 'contract.db'))));
  return { repos: store.repos, close: () => store.close() };
});

describe('DatabaseManager over the expo host', () => {
  it('opens, backs up, restores into a new file and rolls back', async () => {
    const dir = tempDir();
    let n = 0;
    const manager = await DatabaseManager.open({ host: createExpoDatabaseHost(fakeHostDeps(dir)), newName: () => `training-${String(++n)}.db` });
    const owner = profile();
    expect((await manager.store.repos.profiles.save(owner, null)).ok).toBe(true);
    const backup = await createBackup(manager.store, { at: at(0), app: { name: 'Fizz', version: '0.1.0', build: '1' } });
    expect((await manager.store.repos.gyms.save(gym(2), null)).ok).toBe(true);

    const restored = await manager.restore(backup.text, at(60));
    expect(restored.ok && restored.status).toBe('restored');
    expect(await manager.store.repos.gyms.listByOwner(owner.id)).toEqual([]);
    expect(existsSync(join(dir, 'training-2.db'))).toBe(true);

    const back = await manager.rollback(at(120));
    expect(back.ok).toBe(true);
    expect(await manager.store.repos.gyms.listByOwner(owner.id)).toHaveLength(1);
    await manager.close();
  });
});
