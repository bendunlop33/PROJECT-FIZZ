import { z } from 'zod';
import { ZonedTimestampSchema, validate, type ValidationIssue, type ZonedTimestamp } from '@fizz/schemas';
import { stableStringify } from '@fizz/domain';
import type { SqlExecutor, SqlRow } from '../driver';
import { checkIntegrityWith, type IntegrityReport } from '../integrity';
import { latestVersion, readUserVersion, type Migration, MIGRATIONS } from '../migrations';
import { ident, insert } from '../sql';
import type { Store } from '../store';
import { sha256Hex } from './sha256';

/**
 * Portable backup (brief §7 `createBackup` / `restoreBackup`, ADR 0004/0005).
 *
 * A backup is a JSON snapshot of every table at the database's schema
 * version, in one file Ben saves to Files. It carries its own schema version,
 * so an older backup is restored by building a fresh database at that version,
 * loading the rows, then running the normal migrations forward. The checksum
 * covers everything except itself.
 *
 * Files are data, never instructions (CLAUDE.md rule 8): table and column
 * names must match the schema exactly, values are bound as parameters, and
 * every record is validated before the restored database is used.
 */
export const BACKUP_FORMAT = 'fizz-backup';
export const BACKUP_FORMAT_VERSION = 1;

const CellSchema = z.union([z.string(), z.number(), z.null()]);

export const AppInfoSchema = z.object({
  name: z.string().min(1).max(60),
  version: z.string().min(1).max(40),
  /** Build number or CI run, when known. */
  build: z.string().max(80).nullable(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const BackupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.int().min(1),
  createdAt: ZonedTimestampSchema,
  app: AppInfoSchema,
  schemaVersion: z.int().min(1),
  counts: z.record(z.string(), z.int().min(0)),
  tables: z.record(z.string(), z.array(z.record(z.string(), CellSchema))),
  checksum: z.object({ algorithm: z.literal('sha-256'), value: z.string().regex(/^[0-9a-f]{64}$/) }),
});
export type BackupFile = z.infer<typeof BackupFileSchema>;

export type BackupErrorCode =
  | 'malformed'
  | 'not_a_backup'
  | 'backup_too_new'
  | 'schema_too_new'
  | 'checksum_mismatch'
  | 'counts_mismatch'
  | 'unexpected_tables'
  | 'unexpected_columns'
  | 'restore_failed'
  | 'integrity_failed'
  | 'nothing_to_roll_back'
  /** The data changed since the restore preview was made (review S5): nothing was switched. */
  | 'preview_stale';

export interface BackupError {
  code: BackupErrorCode;
  message: string;
  issues?: readonly ValidationIssue[];
}

/** Human-level counts for the restore preview. */
export interface BackupCounts {
  profiles: number;
  gyms: number;
  equipment: number;
  exercises: number;
  routines: number;
  progressionRules: number;
  finishedWorkouts: number;
  unfinishedWorkouts: number;
  discardedWorkouts: number;
  loggedSets: number;
  firstWorkoutUtc: string | null;
  lastWorkoutUtc: string | null;
}

function checksumOf(file: Omit<BackupFile, 'checksum'>): string {
  return sha256Hex(stableStringify(file));
}

/** Tables at this database's schema version, by name. */
async function tableNames(q: SqlExecutor): Promise<string[]> {
  const rows = await q.getAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

async function tableInfo(q: SqlExecutor, table: string): Promise<{ columns: string[]; key: string[] }> {
  const rows = await q.getAll<{ name: string; pk: number }>(`PRAGMA table_info(${ident(table)})`);
  return {
    columns: rows.map((r) => r.name),
    key: rows.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk).map((r) => r.name),
  };
}

/** Every row of every table, in primary-key order (deterministic, so equal data hashes equal). */
export async function exportTables(q: SqlExecutor): Promise<Record<string, SqlRow[]>> {
  const tables: Record<string, SqlRow[]> = {};
  for (const name of await tableNames(q)) {
    const { key } = await tableInfo(q, name);
    const order = key.length > 0 ? key.map(ident).join(', ') : 'rowid';
    tables[name] = await q.getAll(`SELECT * FROM ${ident(name)} ORDER BY ${order}`);
  }
  return tables;
}

/** Hash of a database's content and schema version (not of any file envelope). */
export function contentHash(schemaVersion: number, tables: Record<string, readonly SqlRow[]>): string {
  return sha256Hex(stableStringify({ schemaVersion, tables }));
}

export function countBackup(tables: Record<string, readonly SqlRow[]>): BackupCounts {
  const len = (t: string) => tables[t]?.length ?? 0;
  const sessions = tables.sessions ?? [];
  const started = sessions.map((s) => s.started_at_utc).filter((v): v is string => typeof v === 'string').sort();
  return {
    profiles: len('profiles'),
    gyms: len('gyms'),
    equipment: len('equipment'),
    exercises: len('exercises'),
    routines: len('routines'),
    progressionRules: len('progression_rules'),
    finishedWorkouts: sessions.filter((s) => s.status === 'finished').length,
    unfinishedWorkouts: sessions.filter((s) => s.status === 'active').length,
    discardedWorkouts: sessions.filter((s) => s.status === 'discarded').length,
    loggedSets: (tables.session_sets ?? []).filter((s) => s.status === 'completed').length,
    firstWorkoutUtc: started[0] ?? null,
    lastWorkoutUtc: started.at(-1) ?? null,
  };
}

export interface CreatedBackup {
  /** Suggested name for the Files location Ben picks. */
  fileName: string;
  /** The file contents (UTF-8 JSON). */
  text: string;
  schemaVersion: number;
  counts: BackupCounts;
  checksum: string;
  /** The live database's integrity at backup time. A failed check doesn't block the backup, but a restore of it will be refused. */
  integrity: IntegrityReport;
}

/**
 * Snapshot the whole database into a backup file. Runs in one slot of the
 * store's queue, so no write lands halfway through the export.
 */
export function createBackup(store: Store, options: { at: ZonedTimestamp; app: AppInfo }): Promise<CreatedBackup> {
  return store.db.read(async (q) => {
    const schemaVersion = await readUserVersion(q);
    const integrity = await checkIntegrityWith(q, schemaVersion);
    const tables = await exportTables(q);
    const counts: Record<string, number> = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
    const body = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: options.at,
      app: options.app,
      schemaVersion,
      counts,
      tables,
    } as const;
    const checksum = checksumOf(body);
    const file: BackupFile = { ...body, checksum: { algorithm: 'sha-256', value: checksum } };
    const stamp = options.at.utc.replace(/\.\d+Z$/, 'Z').replaceAll(':', '-');
    return {
      fileName: `fizz-backup-${stamp}-v${schemaVersion}.json`,
      text: JSON.stringify(file),
      schemaVersion,
      counts: countBackup(tables),
      checksum,
      integrity,
    };
  });
}

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; error: BackupError };

/**
 * Read and verify a backup file: shape, format version, schema version this
 * build can migrate from, checksum and counts. Doesn't touch any database.
 */
export function parseBackup(text: string, migrations: readonly Migration[] = MIGRATIONS): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'malformed', message: 'This file is not valid JSON.' } };
  }
  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, error: { code: 'not_a_backup', message: 'This file is not a training-app backup.' } };
  }
  const parsed = validate(BackupFileSchema, json);
  if (!parsed.ok) return { ok: false, error: { code: 'malformed', message: 'The backup file is damaged or incomplete.', issues: parsed.issues } };
  const file = parsed.value;
  if (file.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: { code: 'backup_too_new', message: 'This backup was made by a newer version of the app. Update the app first.' } };
  }
  if (file.schemaVersion > latestVersion(migrations)) {
    return { ok: false, error: { code: 'schema_too_new', message: 'This backup was made by a newer version of the app. Update the app first.' } };
  }
  const { checksum, ...body } = file;
  if (checksumOf(body) !== checksum.value) {
    return { ok: false, error: { code: 'checksum_mismatch', message: 'The backup file is damaged (checksum does not match). Nothing was changed.' } };
  }
  const tableKeys = Object.keys(file.tables).sort();
  const countKeys = Object.keys(file.counts).sort();
  if (stableStringify(tableKeys) !== stableStringify(countKeys) || tableKeys.some((t) => file.counts[t] !== file.tables[t]?.length)) {
    return { ok: false, error: { code: 'counts_mismatch', message: 'The backup file is inconsistent (record counts do not match).' } };
  }
  return { ok: true, file };
}

/**
 * Before loading: the backup's tables must be exactly those of an empty
 * database migrated to `file.schemaVersion`, and every column must exist.
 */
export async function checkBackupShape(q: SqlExecutor, file: Pick<BackupFile, 'schemaVersion' | 'tables'>): Promise<BackupError | null> {
  const expected = await tableNames(q);
  const given = Object.keys(file.tables).sort();
  if (stableStringify(expected) !== stableStringify(given)) {
    return {
      code: 'unexpected_tables',
      message: `The backup's tables don't match schema version ${file.schemaVersion}.`,
      issues: [
        ...given.filter((t) => !expected.includes(t)).map((t) => ({ path: t, message: 'Unknown table' })),
        ...expected.filter((t) => !given.includes(t)).map((t) => ({ path: t, message: 'Missing table' })),
      ],
    };
  }
  for (const table of expected) {
    const { columns } = await tableInfo(q, table);
    for (const [i, row] of (file.tables[table] ?? []).entries()) {
      const unknown = Object.keys(row).filter((c) => !columns.includes(c));
      if (unknown.length > 0) {
        return {
          code: 'unexpected_columns',
          message: `The backup has columns that schema version ${file.schemaVersion} doesn't have.`,
          issues: unknown.map((c) => ({ path: `${table}.${i}.${c}`, message: 'Unknown column' })),
        };
      }
    }
  }
  return null;
}

/** Insert every row of a backup (inside the caller's transaction). */
export async function insertBackupRows(tx: SqlExecutor, file: Pick<BackupFile, 'tables'>): Promise<void> {
  for (const [table, rows] of Object.entries(file.tables)) {
    for (const row of rows) await insert(tx, table, row);
  }
}
