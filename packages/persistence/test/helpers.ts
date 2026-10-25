import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqlDriver, SqlExecutor, SqlValue } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import type { SessionAggregate } from '@fizz/schemas';

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

/** A session as a build before migration 31 saved it: no rest marked as put back finished by an undo. */
export function beforeSchema31(a: SessionAggregate): SessionAggregate {
  if (a.restTimer?.restoredFinished === undefined) return a;
  const restTimer = { ...a.restTimer };
  delete restTimer.restoredFinished;
  return { ...a, restTimer };
}

/** A backup's tables as a schema-35 build wrote them: no `sessions.past_log` or `timing_audit.shift_ms` (migration 36, Ben 25 Oct). */
export function withoutSchema36<T extends Record<string, Record<string, unknown>[]>>(tables: T): T {
  const out: Record<string, Record<string, unknown>[]> = { ...tables };
  if (out.sessions) {
    out.sessions = out.sessions.map((row) => {
      const copy = { ...row };
      delete copy.past_log;
      return copy;
    });
  }
  if (out.timing_audit) {
    out.timing_audit = out.timing_audit.map((row) => {
      const copy = { ...row };
      delete copy.shift_ms;
      return copy;
    });
  }
  return out as T;
}

/** A backup's tables as a schema-33 build wrote them: no `sessions.deload` (migration 34, PM 23 Oct), nor later columns. */
export function withoutSchema34<T extends Record<string, Record<string, unknown>[]>>(tables: T): T {
  const out: Record<string, Record<string, unknown>[]> = withoutSchema36({ ...tables });
  if (out.sessions) {
    out.sessions = out.sessions.map((row) => {
      const copy = { ...row };
      delete copy.deload;
      return copy;
    });
  }
  return out as T;
}

/** A backup's tables as a schema-31 build wrote them: no `sessions.feel` (migration 32, `How did it feel?`), nor later columns. */
export function withoutSchema32<T extends Record<string, Record<string, unknown>[]>>(tables: T): T {
  const out: Record<string, Record<string, unknown>[]> = withoutSchema34({ ...tables });
  if (out.sessions) {
    out.sessions = out.sessions.map((row) => {
      const copy = { ...row };
      delete copy.feel;
      return copy;
    });
  }
  return out as T;
}

/**
 * A backup's tables as a schema-30 build wrote them: no `rest_timers.resume_on_undo`
 * or `restored_finished` (migration 31, unticking keeps the rest).
 */
export function withoutSchema31<T extends Record<string, Record<string, unknown>[]>>(tables: T): T {
  const out: Record<string, Record<string, unknown>[]> = withoutSchema32({ ...tables });
  if (out.rest_timers) {
    out.rest_timers = out.rest_timers.map((row) => {
      const copy = { ...row };
      delete copy.resume_on_undo;
      delete copy.restored_finished;
      return copy;
    });
  }
  return out as T;
}

/**
 * A backup's tables as a schema-29 build wrote them: no tables or columns
 * from migration 30 (workout builder v3), nor later ones (31). For tests that
 * relabel a current backup as an older schema; strip newer additions first.
 */
export function withoutSchema30<T extends Record<string, Record<string, unknown>[]>>(tables: T): T {
  const out: Record<string, Record<string, unknown>[]> = withoutSchema31({ ...tables });
  delete out.plan_day_variations;
  delete out.reviews;
  if (out.sessions) {
    out.sessions = out.sessions.map((row) => {
      const copy = { ...row };
      delete copy.plan_day;
      return copy;
    });
  }
  return out as T;
}
