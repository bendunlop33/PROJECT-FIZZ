import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqlDriver, SqlExecutor, SqlValue } from '../src/index';
import { openNodeDriver } from '../src/node/index';

export function memoryDriver(): SqlDriver {
  return openNodeDriver(':memory:');
}

/** A temporary directory removed by the returned `cleanup`. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'fizz-persistence-'));
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); } };
}

/** The full schema (tables, indexes, triggers) as comparable rows. */
export async function schemaDump(q: SqlExecutor): Promise<unknown[]> {
  return q.getAll("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
}

/**
 * Wrap a driver so that any statement matching `failOn` throws inside a
 * transaction, simulating a crash or a full disk mid-write.
 */
export function failingDriver(inner: SqlDriver, failOn: (sql: string) => boolean): SqlDriver & { armed: boolean } {
  const state = { armed: true };
  const check = (sql: string) => {
    if (state.armed && failOn(sql)) throw new Error(`Injected failure on: ${sql.slice(0, 60)}`);
  };
  const wrap = (x: SqlExecutor): SqlExecutor => ({
    exec: (sql) => {
      check(sql);
      return x.exec(sql);
    },
    run: (sql, params?: readonly SqlValue[]) => {
      check(sql);
      return x.run(sql, params);
    },
    getAll: (sql, params) => x.getAll(sql, params),
    getFirst: (sql, params) => x.getFirst(sql, params),
  });
  return Object.assign(state, {
    ...wrap(inner),
    withExclusiveTransaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => inner.withExclusiveTransaction((tx) => fn(wrap(tx))),
    close: () => inner.close(),
  });
}
