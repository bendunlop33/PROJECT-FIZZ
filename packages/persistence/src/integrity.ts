import type { Database } from './database';
import { DOCUMENT_TABLES, erase, type DocumentTable } from './documents';
import { COACH_DOCUMENT_TABLES } from './coach';
import { DRAFT_DOCUMENT_TABLES } from './drafts';
import { WORKOUT_DRAFT_DOCUMENT_TABLES } from './workout-drafts';
import { PLAN_DRAFT_DOCUMENT_TABLES } from './plan-drafts';
import { TRAINING_PROFILE_DOCUMENT_TABLES } from './training-profiles';
import { ACTIVITY_DOCUMENT_TABLES } from './activities';
import { PLAN_DAY_DOCUMENT_TABLES } from './plan-days';
import type { SqlExecutor } from './driver';
import { CorruptDataError } from './errors';
import { latestVersion, readUserVersion } from './migrations';
import { decodeImportRow, EXERCISE_ALIAS_SPEC, IMPORT_JOB_SPEC } from './imports';
import { readAggregate } from './sessions';
import { ident, rowId } from './sql';
import { monotonicMs, noYield, type Slicer } from './backup/slice';

/** Every document table, the import ones included. */
const ALL_DOCUMENTS: readonly DocumentTable[] = [...DOCUMENT_TABLES, erase(IMPORT_JOB_SPEC), erase(EXERCISE_ALIAS_SPEC), ...COACH_DOCUMENT_TABLES, ...DRAFT_DOCUMENT_TABLES, ...WORKOUT_DRAFT_DOCUMENT_TABLES, ...PLAN_DRAFT_DOCUMENT_TABLES, ...TRAINING_PROFILE_DOCUMENT_TABLES, ...ACTIVITY_DOCUMENT_TABLES, ...PLAN_DAY_DOCUMENT_TABLES];

/** Import rows checked per queue turn by `checkIntegrity`. */
const ROW_CHUNK = 2000;

function rowLabel(row: { job_id?: unknown; row_number?: unknown }): string {
  return `${String(row.job_id)}#${String(row.row_number)}`;
}

export interface IntegrityIssue {
  /** `sqlite` for engine-level problems, otherwise the table. */
  table: string;
  id: string | null;
  message: string;
}

export interface IntegrityReport {
  ok: boolean;
  schemaVersion: number;
  issues: IntegrityIssue[];
  /** Records that were read and validated, by table. */
  checked: Record<string, number>;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Check a database without changing it: SQLite's own `integrity_check`,
 * foreign keys (never enforced at write time, see `driver.ts`), the schema
 * version, and every record through the same validation the repositories use.
 * Collects every problem instead of stopping at the first.
 */
export async function checkIntegrityWith(q: SqlExecutor, expectedVersion: number = latestVersion()): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const checked: Record<string, number> = {};

  const schemaVersion = await readUserVersion(q);
  if (schemaVersion !== expectedVersion) {
    issues.push({ table: 'sqlite', id: null, message: `Schema version is ${schemaVersion}, expected ${expectedVersion}` });
  }
  const engine = await q.getAll<{ integrity_check: string }>('PRAGMA integrity_check');
  for (const r of engine) if (r.integrity_check !== 'ok') issues.push({ table: 'sqlite', id: null, message: r.integrity_check });
  const fks = await q.getAll<{ table: string; rowid: number | null; parent: string }>('PRAGMA foreign_key_check');
  for (const r of fks) {
    issues.push({ table: r.table, id: r.rowid === null ? null : String(r.rowid), message: `References a missing ${r.parent} row` });
  }
  if (schemaVersion !== expectedVersion) return { ok: false, schemaVersion, issues, checked };

  for (const spec of ALL_DOCUMENTS) {
    const rows = await q.getAll(`SELECT * FROM ${ident(spec.table)} ORDER BY id`);
    checked[spec.table] = rows.length;
    for (const row of rows) {
      try {
        spec.decode(row);
      } catch (e) {
        issues.push({ table: spec.table, id: rowId(row.id), message: describe(e) });
      }
    }
  }
  const importRows = await q.getAll('SELECT * FROM import_rows ORDER BY job_id, row_number');
  checked.import_rows = importRows.length;
  for (const row of importRows) {
    try {
      decodeImportRow(row);
    } catch (e) {
      issues.push({ table: 'import_rows', id: rowLabel(row), message: describe(e) });
    }
  }
  const sessions = await q.getAll<{ id: string }>('SELECT id FROM sessions ORDER BY id');
  checked.sessions = sessions.length;
  for (const { id } of sessions) {
    try {
      await readAggregate(q, id);
    } catch (e) {
      issues.push({ table: e instanceof CorruptDataError ? e.table : 'sessions', id, message: describe(e) });
    }
  }
  return { ok: issues.length === 0, schemaVersion, issues, checked };
}

/** Most sessions read per queue turn by `checkIntegrity`. */
const SESSION_CHUNK = 10;
/** A turn also ends once it has run this long, so a Log tapped meanwhile waits at most about this (backup review B1). */
const TURN_BUDGET_MS = 8;

/**
 * The same checks as `checkIntegrityWith`, through the store's queue in small
 * turns (review S4): the engine checks, each document table and every
 * `SESSION_CHUNK` sessions are separate reads, so a Log tapped during the
 * launch check waits for one small turn, never for the whole database.
 * Records written between turns are checked as they are then.
 */
export async function checkIntegrity(db: Database, expectedVersion: number = latestVersion(), slice: Slicer = noYield): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const checked: Record<string, number> = {};
  const schemaVersion = await db.read(async (q) => {
    const version = await readUserVersion(q);
    if (version !== expectedVersion) issues.push({ table: 'sqlite', id: null, message: `Schema version is ${version}, expected ${expectedVersion}` });
    const engine = await q.getAll<{ integrity_check: string }>('PRAGMA integrity_check');
    for (const r of engine) if (r.integrity_check !== 'ok') issues.push({ table: 'sqlite', id: null, message: r.integrity_check });
    const fks = await q.getAll<{ table: string; rowid: number | null; parent: string }>('PRAGMA foreign_key_check');
    for (const r of fks) issues.push({ table: r.table, id: r.rowid === null ? null : String(r.rowid), message: `References a missing ${r.parent} row` });
    return version;
  });
  if (schemaVersion !== expectedVersion) return { ok: false, schemaVersion, issues, checked };

  for (const spec of ALL_DOCUMENTS) {
    await db.read(async (q) => {
      const rows = await q.getAll(`SELECT * FROM ${ident(spec.table)} ORDER BY id`);
      checked[spec.table] = rows.length;
      for (const row of rows) {
        try {
          spec.decode(row);
        } catch (e) {
          issues.push({ table: spec.table, id: rowId(row.id), message: describe(e) });
        }
      }
    });
    await slice();
  }
  const rowCount = await db.read(async (q) => (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM import_rows'))?.n ?? 0);
  checked.import_rows = rowCount;
  for (let offset = 0; offset < rowCount; offset += ROW_CHUNK) {
    await db.read(async (q) => {
      const rows = await q.getAll('SELECT * FROM import_rows ORDER BY job_id, row_number LIMIT ? OFFSET ?', [ROW_CHUNK, offset]);
      for (const row of rows) {
        try {
          decodeImportRow(row);
        } catch (e) {
          issues.push({ table: 'import_rows', id: rowLabel(row), message: describe(e) });
        }
      }
    });
    await slice();
  }
  const ids = await db.read(async (q) => (await q.getAll<{ id: string }>('SELECT id FROM sessions ORDER BY id')).map((r) => r.id));
  checked.sessions = ids.length;
  for (let i = 0; i < ids.length; ) {
    i = await db.read(async (q) => {
      const started = monotonicMs();
      let next = i;
      do {
        const id = ids[next] ?? '';
        next += 1;
        try {
          await readAggregate(q, id);
        } catch (e) {
          issues.push({ table: e instanceof CorruptDataError ? e.table : 'sessions', id, message: describe(e) });
        }
      } while (next < ids.length && next - i < SESSION_CHUNK && monotonicMs() - started < TURN_BUDGET_MS);
      return next;
    });
    await slice();
  }
  return { ok: issues.length === 0, schemaVersion, issues, checked };
}
