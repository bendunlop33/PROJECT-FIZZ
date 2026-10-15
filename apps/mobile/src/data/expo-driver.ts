import type { DatabaseHost, SqlDriver, SqlExecutor, SqlRow, SqlRunResult, SqlValue } from '@fizz/persistence';

/**
 * `SqlDriver` over expo-sqlite (ADR 0005; the shape sketched in
 * packages/persistence/src/driver.ts). This file has no runtime import of
 * expo-sqlite: it works against the small structural interface below, so the
 * adapter logic is unit-tested on Linux with a fake (test/expo-driver.test.ts).
 * The real binding is in `expo-sqlite-host.ts`.
 *
 * expo-sqlite 57.0.4 behaviour this adapter relies on or works around
 * (read from node_modules/expo-sqlite; verify on the device):
 * - `withExclusiveTransactionAsync` opens a NEW connection per transaction and
 *   runs `BEGIN` (deferred), then `COMMIT`, or `ROLLBACK` + rethrow. It
 *   resolves with void, so the result is carried out through a closure.
 *   Because it is another connection, per-connection PRAGMAs don't carry over
 *   (persistence never relies on `foreign_keys`), `:memory:` can't be used,
 *   and a write on the outer connection while it is open would fail with
 *   "database is locked". `Database` serialises callers; this adapter also
 *   refuses outer use while a transaction is open, like the node driver.
 * - If ROLLBACK itself fails (SQLite may already have rolled back, e.g. on a
 *   full disk), expo throws the ROLLBACK error and the original one is lost.
 *   Either way nothing is committed.
 * - `deleteDatabaseAsync` deletes only the main file, throws when the file is
 *   missing and refuses an open database. `DatabaseHost.remove` must be a
 *   no-op when missing and must also remove `-wal`/`-shm`/`-journal`, so the
 *   host does both (see `createExpoDatabaseHost`).
 * - Rows come back as plain objects. Values are checked to be SQLite text,
 *   numbers or null; this schema never stores blobs.
 */

/** The slice of expo-sqlite's `SQLiteDatabase` the adapter uses. */
export interface ExpoDatabaseLike {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  withExclusiveTransactionAsync(task: (txn: ExpoDatabaseLike) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export class UnexpectedSqlValueError extends Error {
  constructor(column: string, kind: string) {
    super(`Column ${column} returned a ${kind}; only text, numbers and null are expected`);
    this.name = 'UnexpectedSqlValueError';
  }
}

/** Normalise one row from expo-sqlite into the persistence package's `SqlRow`. */
export function toSqlRow(raw: unknown): SqlRow {
  if (typeof raw !== 'object' || raw === null) throw new UnexpectedSqlValueError('(row)', typeof raw);
  const row: SqlRow = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value === 'string') {
      row[key] = value;
    } else if (typeof value === 'number') {
      row[key] = value;
    } else if (typeof value === 'bigint') {
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new UnexpectedSqlValueError(key, 'integer too large for JavaScript');
      row[key] = Number(value);
    } else {
      throw new UnexpectedSqlValueError(key, value instanceof Uint8Array || value instanceof ArrayBuffer ? 'blob' : typeof value);
    }
  }
  return row;
}

function copyParams(params: readonly SqlValue[] | undefined): SqlValue[] {
  return params === undefined ? [] : [...params];
}

function executor(db: ExpoDatabaseLike, guard: () => void): SqlExecutor {
  return {
    async exec(sql) {
      guard();
      await db.execAsync(sql);
    },
    async run(sql, params): Promise<SqlRunResult> {
      guard();
      const r = await db.runAsync(sql, copyParams(params));
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    async getAll<T extends SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]> {
      guard();
      const rows = await db.getAllAsync<unknown>(sql, copyParams(params));
      return rows.map(toSqlRow) as T[];
    },
    async getFirst<T extends SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T | null> {
      guard();
      const row = await db.getFirstAsync<unknown>(sql, copyParams(params));
      return row === null || row === undefined ? null : (toSqlRow(row) as T);
    },
  };
}

/** Wrap an open expo-sqlite database. */
export function createExpoSqlDriver(db: ExpoDatabaseLike): SqlDriver {
  let inTransaction = false;
  let closed = false;
  const outer = executor(db, () => {
    if (closed) throw new Error('Database is closed');
    if (inTransaction) throw new Error('Outer driver used inside a transaction: use the transaction executor');
  });

  return {
    ...outer,
    async withExclusiveTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (closed) throw new Error('Database is closed');
      if (inTransaction) throw new Error('Nested transaction: serialise callers through Database');
      inTransaction = true;
      let live = true;
      let result: { value: T } | null = null;
      try {
        await db.withExclusiveTransactionAsync(async (txn) => {
          const tx = executor(txn, () => {
            if (!live) throw new Error('Transaction executor used after the transaction ended');
          });
          result = { value: await fn(tx) };
          live = false;
        });
      } finally {
        live = false;
        inTransaction = false;
      }
      // TypeScript can't see the assignment inside the callback.
      const done = result as { value: T } | null;
      if (done === null) throw new Error('Transaction finished without a result');
      return done.value;
    },
    async close() {
      if (closed) return;
      closed = true;
      await db.closeAsync();
    },
  };
}

/** What the host needs from expo-sqlite and the file system (injected for tests). */
export interface ExpoHostDeps {
  openDatabase(name: string): Promise<ExpoDatabaseLike>;
  /** expo-sqlite `deleteDatabaseAsync`: main file only; throws when missing or open. */
  deleteDatabase(name: string): Promise<void>;
  /** Does `name` exist in expo-sqlite's database directory? */
  fileExists(name: string): Promise<boolean>;
  /** Delete `name` in the database directory if it exists. */
  deleteFileIfExists(name: string): Promise<void>;
}

export const DATABASE_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/** `DatabaseHost` for `DatabaseManager`: opens files through expo-sqlite and removes them completely. */
export function createExpoDatabaseHost(deps: ExpoHostDeps): DatabaseHost {
  return {
    async open(name) {
      return createExpoSqlDriver(await deps.openDatabase(name));
    },
    async remove(name) {
      if (await deps.fileExists(name)) await deps.deleteDatabase(name);
      for (const suffix of DATABASE_COMPANION_SUFFIXES) await deps.deleteFileIfExists(name + suffix);
    },
  };
}

/** STRICT tables need SQLite ≥ 3.37 (ADR 0005). */
export const MIN_SQLITE_VERSION = [3, 37, 0] as const;

export function parseSqliteVersion(text: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isSqliteVersionSupported(text: string): boolean {
  const v = parseSqliteVersion(text);
  if (!v) return false;
  for (let i = 0; i < 3; i += 1) {
    const a = v[i] ?? 0;
    const b = MIN_SQLITE_VERSION[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export async function readSqliteVersion(q: SqlExecutor): Promise<string> {
  const row = await q.getFirst<{ v: string }>('SELECT sqlite_version() AS v');
  return typeof row?.v === 'string' ? row.v : 'unknown';
}
