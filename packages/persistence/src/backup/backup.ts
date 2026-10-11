import { z } from 'zod';
import { ZonedTimestampSchema, validate, type ValidationIssue, type ZonedTimestamp } from '@fizz/schemas';
import { stableStringify } from '@fizz/domain';
import type { SqlExecutor, SqlRow } from '../driver';
import { checkIntegrity, type IntegrityReport } from '../integrity';
import { latestVersion, readUserVersion, type Migration, MIGRATIONS } from '../migrations';
import { ident, insert } from '../sql';
import type { Store } from '../store';
import { finishedWorkoutsDigest } from './coverage';
import { writeStable, stableHash } from './serialise';
import { Sha256Stream } from './sha256';
import { noYield, type Slicer } from './slice';

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

function checksumOf(file: Omit<BackupFile, 'checksum'>, slice: Slicer): Promise<string> {
  return stableHash(file, slice);
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

/** Rows read per page when `exportTables` is sliced. */
const EXPORT_PAGE = 1000;

/**
 * Every row of every table, in primary-key order (deterministic, so equal data
 * hashes equal). With a `slice`, big tables are read in pages with a pause
 * between them (backup review B1); the caller still holds one queue slot, so
 * no write lands between pages. A write queued meanwhile (a set logged,
 * Summary Undo) waits for the rest of the export: ~200-350 ms on a 2-year
 * history in the perf test (fix-backup review S3), not yet measured on the
 * phone. A separate read connection would remove the wait; not done until
 * a device measurement shows it is needed.
 */
export async function exportTables(q: SqlExecutor, slice?: Slicer): Promise<Record<string, SqlRow[]>> {
  const tables: Record<string, SqlRow[]> = {};
  for (const name of await tableNames(q)) {
    const { key } = await tableInfo(q, name);
    const order = key.length > 0 ? key.map(ident).join(', ') : 'rowid';
    const sql = `SELECT * FROM ${ident(name)} ORDER BY ${order}`;
    if (slice === undefined) {
      tables[name] = await q.getAll(sql);
      continue;
    }
    const rows: SqlRow[] = [];
    for (;;) {
      const page = await q.getAll(`${sql} LIMIT ? OFFSET ?`, [EXPORT_PAGE, rows.length]);
      for (const r of page) rows.push(r);
      await slice();
      if (page.length < EXPORT_PAGE) break;
    }
    tables[name] = rows;
  }
  return tables;
}

/** Hash of a database's content and schema version (not of any file envelope). */
export function contentHash(schemaVersion: number, tables: Record<string, readonly SqlRow[]>, slice: Slicer = noYield): Promise<string> {
  return stableHash({ schemaVersion, tables }, slice);
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
  /** SHA-256 of `text` (the whole file), computed in the same pass as the checksum. */
  sha256: string;
  /** `finishedWorkoutsDigest` of the finished workouts in this backup, by ID and revision (B2, S1). */
  finishedWorkoutsDigest: string;
  schemaVersion: number;
  counts: BackupCounts;
  checksum: string;
  /** The live database's integrity at backup time. A failed check doesn't block the backup, but a restore of it will be refused. */
  integrity: IntegrityReport;
}

export interface BackupWorkOptions {
  /** Pauses long work so the JS thread stays responsive (backup review B1). Default: never pauses. */
  slice?: Slicer;
}

/**
 * Snapshot the whole database into a backup file.
 *
 * Only the export holds the store's queue (one slot, so no write lands
 * halfway through it). The integrity check then runs in the store's small
 * turns, and serialising and hashing run off the queue in slices (backup
 * review B1), so logging, Undo and taps never wait for a whole backup.
 * The text is serialised and hashed once: the body's checksum and the
 * whole file's SHA-256 share every byte but the last.
 */
export async function createBackup(store: Store, options: { at: ZonedTimestamp; app: AppInfo } & BackupWorkOptions): Promise<CreatedBackup> {
  const slice = options.slice ?? noYield;
  const { schemaVersion, tables } = await store.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q, slice) }));
  await slice();
  // Runs in later queue turns, so a write landing between the export and this check is judged
  // here but isn't in the file: `integrity` describes the live database, not exactly these rows (N1).
  const integrity = await checkIntegrity(store.db, schemaVersion, slice);
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
  // Hash every piece but the one held back; the last is the body's closing `}`.
  const pieces: string[] = [];
  const prefix = new Sha256Stream();
  const held = { piece: null as string | null };
  await writeStable(
    body,
    (piece) => {
      if (held.piece !== null) {
        prefix.update(held.piece);
        pieces.push(held.piece);
      }
      held.piece = piece;
    },
    slice,
  );
  if (held.piece !== '}') throw new Error('backup: unexpected serialisation');
  const whole = prefix.clone();
  const checksum = prefix.update('}').digestHex();
  const tail = `,"checksum":${JSON.stringify({ algorithm: 'sha-256', value: checksum })}}`;
  const sha256 = whole.update(tail).digestHex();
  pieces.push(tail);
  await slice();
  const text = pieces.join('');
  const stamp = options.at.utc.replace(/\.\d+Z$/, 'Z').replaceAll(':', '-');
  return {
    fileName: `fizz-backup-${stamp}-v${String(schemaVersion)}.json`,
    text,
    sha256,
    finishedWorkoutsDigest: finishedWorkoutsDigest(
      (tables.sessions ?? []).filter((s) => s.status === 'finished').map((s) => ({ id: String(s.id), revision: Number(s.revision) })),
    ),
    schemaVersion,
    counts: countBackup(tables),
    checksum,
    integrity,
  };
}

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; error: BackupError };

/** `BackupFileSchema` with the rows left for `RowSchema`, so they're checked in slices. */
const EnvelopeSchema = BackupFileSchema.extend({ tables: z.record(z.string(), z.array(z.unknown())) });
const RowSchema = z.record(z.string(), CellSchema);

/**
 * Read and verify a backup file: shape, format version, schema version this
 * build can migrate from, checksum and counts. Doesn't touch any database.
 * Rows and the checksum are checked in slices (backup review B1).
 */
export async function parseBackup(text: string, migrations: readonly Migration[] = MIGRATIONS, slice: Slicer = noYield): Promise<ParseResult> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'malformed', message: 'This file is not valid JSON.' } };
  }
  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, error: { code: 'not_a_backup', message: 'This file is not a training-app backup.' } };
  }
  const damaged = (issues: readonly ValidationIssue[]): ParseResult => ({ ok: false, error: { code: 'malformed', message: 'The backup file is damaged or incomplete.', issues } });
  await slice();
  const envelope = validate(EnvelopeSchema, json);
  if (!envelope.ok) return damaged(envelope.issues);
  const tables: BackupFile['tables'] = {};
  for (const [name, rows] of Object.entries(envelope.value.tables)) {
    for (const [i, row] of rows.entries()) {
      const r = validate(RowSchema, row);
      if (!r.ok) return damaged(r.issues.map((issue) => ({ ...issue, path: ['tables', name, String(i), issue.path].filter((p) => p !== '').join('.') })));
      await slice();
    }
    // Every row passed `RowSchema`, which only checks (cells are plain JSON values).
    tables[name] = rows as BackupFile['tables'][string];
  }
  const file: BackupFile = { ...envelope.value, tables };
  if (file.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: { code: 'backup_too_new', message: 'This backup was made by a newer version of the app. Update the app first.' } };
  }
  if (file.schemaVersion > latestVersion(migrations)) {
    return { ok: false, error: { code: 'schema_too_new', message: 'This backup was made by a newer version of the app. Update the app first.' } };
  }
  const { checksum, ...body } = file;
  if ((await checksumOf(body, slice)) !== checksum.value) {
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
export async function checkBackupShape(q: SqlExecutor, file: BackupFile, slice: Slicer = noYield): Promise<BackupError | null> {
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
      await slice();
    }
  }
  return null;
}

/** Insert every row of a backup (inside the caller's transaction). */
export async function insertBackupRows(tx: SqlExecutor, file: BackupFile, slice: Slicer = noYield): Promise<void> {
  for (const [table, rows] of Object.entries(file.tables)) {
    for (const row of rows) {
      await insert(tx, table, row);
      await slice();
    }
  }
}
