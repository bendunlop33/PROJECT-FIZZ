import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { DatabaseHost, SqlDriver, SqlExecutor, SqlRow, SqlValue } from '../driver';

/**
 * `SqlDriver` over Node's built-in `node:sqlite` (Node ≥ 22.13), for tests and
 * tooling on Linux. No native npm dependency. Not for the app: the phone uses
 * the expo-sqlite adapter described in `driver.ts`.
 *
 * Transactions use `BEGIN EXCLUSIVE` on the same connection, and the executor
 * handed to `fn` stops working once the transaction ends, so a leaked
 * reference can't write outside it.
 */
export function openNodeDriver(path: string): SqlDriver {
  const db = new DatabaseSync(path);
  let inTransaction = false;

  const bind = (params: readonly SqlValue[] | undefined): SQLInputValue[] => [...(params ?? [])];
  const plain = (row: Record<string, unknown>): SqlRow => ({ ...row }) as SqlRow;

  /** Run synchronously, but report like an async driver: errors become rejections. */
  function attempt<T>(f: () => T): Promise<T> {
    try {
      return Promise.resolve(f());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function executor(isLive: () => boolean): SqlExecutor {
    const guard = () => {
      if (!isLive()) throw new Error('Transaction executor used after the transaction ended, or outer driver used inside one');
    };
    return {
      exec: (sql) =>
        attempt(() => {
          guard();
          db.exec(sql);
        }),
      run: (sql, params) =>
        attempt(() => {
          guard();
          const r = db.prepare(sql).run(...bind(params));
          return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
        }),
      getAll: <T extends SqlRow>(sql: string, params?: readonly SqlValue[]) =>
        attempt(() => {
          guard();
          return db.prepare(sql).all(...bind(params)).map(plain) as T[];
        }),
      getFirst: <T extends SqlRow>(sql: string, params?: readonly SqlValue[]) =>
        attempt(() => {
          guard();
          const row = db.prepare(sql).get(...bind(params));
          return row === undefined ? null : (plain(row) as T);
        }),
    };
  }

  const outer = executor(() => !inTransaction);

  return {
    ...outer,
    async withExclusiveTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (inTransaction) throw new Error('Nested transaction: serialise callers through Database');
      db.exec('BEGIN EXCLUSIVE');
      inTransaction = true;
      let live = true;
      try {
        const result = await fn(executor(() => live));
        live = false;
        inTransaction = false;
        db.exec('COMMIT');
        return result;
      } catch (e) {
        live = false;
        inTransaction = false;
        if (db.isTransaction) db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => attempt(() => { db.close(); }),
  };
}

/** `DatabaseHost` for a directory of database files (tests, tooling). */
export function nodeDatabaseHost(directory: string): DatabaseHost {
  return {
    open: (name) => Promise.resolve(openNodeDriver(join(directory, name))),
    remove: (name) => {
      for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(join(directory, name + suffix), { force: true });
      return Promise.resolve();
    },
  };
}
