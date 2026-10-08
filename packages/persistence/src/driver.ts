/**
 * The minimal async SQL surface this package needs. It is small on purpose so
 * the whole persistence layer runs on Linux (`node:sqlite`, see `./node`) and
 * on the phone (`expo-sqlite`) with the same code.
 *
 * Values are SQLite's storage classes as JS sees them. Booleans, objects and
 * `undefined` are never bound: callers convert them first (0/1, JSON text, null).
 */
export type SqlValue = string | number | null;

/** A result row: column name → value. */
export type SqlRow = Record<string, SqlValue>;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlExecutor {
  /** Run one or more statements with no parameters (DDL, PRAGMA). Never pass user data here. */
  exec(sql: string): Promise<void>;
  /** Run one statement with bound parameters. */
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  getAll<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  getFirst<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

export interface SqlDriver extends SqlExecutor {
  /**
   * Run `fn` in one transaction that only the statements issued through `tx`
   * belong to. Commit when `fn` resolves (and resolve with its value); roll back
   * and rethrow when it throws. Not re-entrant: never start a transaction, or
   * use the outer driver, from inside `fn`. Serialising callers is the job of
   * `Database` (one write queue), not the driver.
   */
  withExclusiveTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Expected shape of the `expo-sqlite` adapter (written later in `apps/mobile`;
 * this package doesn't depend on expo-sqlite). A sketch, against SDK 57's API:
 *
 * ```ts
 * import * as SQLite from 'expo-sqlite';
 *
 * export async function openExpoDriver(name: string): Promise<SqlDriver> {
 *   const db = await SQLite.openDatabaseAsync(name);
 *   const wrap = (x: SQLite.SQLiteDatabase): SqlExecutor => ({
 *     exec: (sql) => x.execAsync(sql),
 *     run: async (sql, params = []) => {
 *       const r = await x.runAsync(sql, [...params]);
 *       return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
 *     },
 *     getAll: (sql, params = []) => x.getAllAsync(sql, [...params]),
 *     getFirst: (sql, params = []) => x.getFirstAsync(sql, [...params]),
 *   });
 *   return {
 *     ...wrap(db),
 *     async withExclusiveTransaction(fn) {
 *       // expo resolves with void, so carry the result out through a closure.
 *       let out: Awaited<ReturnType<typeof fn>> | undefined;
 *       await db.withExclusiveTransactionAsync(async (txn) => { out = await fn(wrap(txn)); });
 *       return out as Awaited<ReturnType<typeof fn>>;
 *     },
 *     close: () => db.closeAsync(),
 *   };
 * }
 * ```
 *
 * Notes for that adapter (to verify on the device, research §2.1):
 * - `withExclusiveTransactionAsync` runs on a separate connection, so it doesn't
 *   work with `:memory:` and per-connection PRAGMAs (e.g. `foreign_keys`) don't
 *   carry over. This package therefore never relies on `foreign_keys = ON`;
 *   `checkIntegrity` runs `PRAGMA foreign_key_check` instead. Triggers and
 *   CHECK constraints are part of the schema and apply on every connection.
 * - `getAllAsync` returns `unknown[]`-ish rows; the cast to `SqlRow` is safe
 *   because every row read here is validated before use.
 * - SQLite must be ≥ 3.37 (STRICT tables). expo-sqlite bundles its own SQLite;
 *   confirm `select sqlite_version()` in the capability probe.
 * - Also needed: a `DatabaseHost` (below) over `openDatabaseAsync`
 *   and `deleteDatabaseAsync`, which must also remove the `-wal`/`-shm` files.
 */

/**
 * Opens and deletes database files by name. Used by `DatabaseManager` to
 * restore into a fresh file and keep the previous one for rollback.
 * On the phone: `openDatabaseAsync(name)` / `deleteDatabaseAsync(name)`.
 */
export interface DatabaseHost {
  open(name: string): Promise<SqlDriver>;
  /** Delete the file and its `-wal`/`-shm` companions. No-op when missing. The database must be closed. */
  remove(name: string): Promise<void>;
}
