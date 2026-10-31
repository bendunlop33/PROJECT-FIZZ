import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SqlValue } from '@fizz/persistence';

import type { ExpoDatabaseLike, ExpoHostDeps } from '../src/data/expo-driver';

/**
 * A stand-in for expo-sqlite 57's `SQLiteDatabase` over node:sqlite, copying
 * the behaviour the adapter depends on: `withExclusiveTransactionAsync` opens
 * a second connection to the same file and runs BEGIN / COMMIT, or ROLLBACK
 * and rethrow (node_modules/expo-sqlite/src/SQLiteDatabase.ts), and
 * `deleteDatabase` removes only the main file and throws when it's missing.
 */
export class FakeExpoDatabase implements ExpoDatabaseLike {
  private readonly db: DatabaseSync;
  closed = false;
  /** Every statement, for assertions. */
  readonly log: string[];

  constructor(
    readonly path: string,
    log: string[] = [],
  ) {
    this.db = new DatabaseSync(path);
    this.log = log;
  }

  private check(sql: string) {
    if (this.closed) throw new Error('Access to closed resource');
    this.log.push(sql);
  }

  execAsync(source: string): Promise<void> {
    return this.attempt(() => {
      this.check(source);
      this.db.exec(source);
    });
  }

  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }> {
    return this.attempt(() => {
      this.check(source);
      const r = this.db.prepare(source).run(...(params as SQLInputValue[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    });
  }

  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]> {
    return this.attempt(() => {
      this.check(source);
      return this.db.prepare(source).all(...(params as SQLInputValue[])) as T[];
    });
  }

  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null> {
    return this.attempt(() => {
      this.check(source);
      return (this.db.prepare(source).get(...(params as SQLInputValue[])) ?? null) as T | null;
    });
  }

  async withExclusiveTransactionAsync(task: (txn: ExpoDatabaseLike) => Promise<void>): Promise<void> {
    const transaction = new FakeExpoDatabase(this.path, this.log);
    let error: unknown;
    try {
      await transaction.execAsync('BEGIN');
      await task(transaction);
      await transaction.execAsync('COMMIT');
    } catch (e) {
      await transaction.execAsync('ROLLBACK');
      error = e;
    } finally {
      await transaction.closeAsync();
    }
    if (error instanceof Error) throw error;
    if (error !== undefined) throw new Error('Transaction failed');
  }

  closeAsync(): Promise<void> {
    return this.attempt(() => {
      if (this.closed) return;
      this.closed = true;
      this.db.close();
    });
  }

  private attempt<T>(f: () => T): Promise<T> {
    try {
      return Promise.resolve(f());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

/** Host dependencies over a directory, with expo-sqlite's delete semantics. */
export function fakeHostDeps(dir: string): ExpoHostDeps & { opened: Map<string, FakeExpoDatabase> } {
  const opened = new Map<string, FakeExpoDatabase>();
  return {
    opened,
    openDatabase: (name) => {
      const db = new FakeExpoDatabase(join(dir, name));
      opened.set(name, db);
      return Promise.resolve(db);
    },
    deleteDatabase: (name) => {
      const path = join(dir, name);
      const open = opened.get(name);
      if (open && !open.closed) return Promise.reject(new Error(`Unable to delete database ${path} that is currently open`));
      if (!existsSync(path)) return Promise.reject(new Error(`Database ${path} not found`));
      rmSync(path);
      return Promise.resolve();
    },
    fileExists: (name) => Promise.resolve(existsSync(join(dir, name))),
    deleteFileIfExists: (name) => {
      rmSync(join(dir, name), { force: true });
      return Promise.resolve();
    },
  };
}
