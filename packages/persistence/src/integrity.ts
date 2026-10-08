import type { Database } from './database';
import { DOCUMENT_TABLES } from './documents';
import type { SqlExecutor } from './driver';
import { CorruptDataError } from './errors';
import { latestVersion, readUserVersion } from './migrations';
import { readAggregate } from './sessions';
import { ident, rowId } from './sql';

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

  for (const spec of DOCUMENT_TABLES) {
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

/** `checkIntegrityWith` through the store's queue, so no write runs meanwhile. */
export function checkIntegrity(db: Database, expectedVersion?: number): Promise<IntegrityReport> {
  return db.read((q) => checkIntegrityWith(q, expectedVersion));
}
