import {
  ALIAS_USES_MAX,
  ExerciseAliasSchema,
  ImportJobSchema,
  ImportRowSchema,
  SessionAggregateSchema,
  type AliasTarget,
  type Exercise,
  type ExerciseAlias,
  type RememberedTotal,
  type ImportJob,
  type ImportRow,
  type PerHandReading,
  type SessionAggregate,
  type ZonedTimestamp,
} from '@fizz/schemas';
import { aliasUses, localDateOf, toMs, type EarlierImport } from '@fizz/domain';
import type { Database } from './database';
import { EXERCISE_SPEC, listDocuments, saveDocumentIn, decodeDocument, type DocumentSpec } from './documents';
import type { SqlExecutor, SqlRow, SqlValue } from './driver';
import { checkRead, checkWrite, inHistorySql, insert, parseJson, parseJsonOrNull, rowId } from './sql';
import { writeAggregate } from './sessions';

/**
 * FitNotes import storage (data-import-export §2.5, §3.4, §4.3; brief §6
 * `ImportJob` / `ImportMapping`). All Your data (rule 10).
 *
 * - A job and every one of its source rows are written in one transaction
 *   when the commit starts. Rows never change afterwards.
 * - Workouts are written one per transaction (a resumable batch). Each is
 *   idempotent by its start operation ID, and refused once the job is no
 *   longer `committing` (an undone import gets nothing more).
 * - Undo reverts: the job's workouts get status `reverted` (hidden from
 *   history, Progress, "Last" values and targets) and nothing is deleted (DX7).
 *   What the import taught (its names and dumbbell answers) stays recorded as
 *   that import's use of each alias, and readers ignore it from then on
 *   (`rememberedAnswer`; review r5 S2). An import never changes an exercise,
 *   so there is nothing of the kind to undo (review r6 B1).
 * - Every write is versioned; a stale `expectedVersion` is refused (rule 5).
 */

export const IMPORT_JOB_SPEC: DocumentSpec<ImportJob> = {
  table: 'import_jobs',
  schema: ImportJobSchema,
  columns: (j) => ({ owner_id: j.ownerId, status: j.status, checksum: j.checksum }),
};

export const EXERCISE_ALIAS_SPEC: DocumentSpec<ExerciseAlias> = {
  table: 'exercise_aliases',
  schema: ExerciseAliasSchema,
  columns: (a) => ({ owner_id: a.ownerId, source: a.source, name_key: a.nameKey }),
};

function rowRecord(r: ImportRow): Record<string, SqlValue> {
  return {
    job_id: r.jobId,
    row_number: r.row,
    line: r.line,
    local_date: r.localDate,
    exercise_name: r.exerciseName,
    cells: JSON.stringify(r.cells),
    result: r.result,
    detail: r.detail,
    session_id: r.sessionId,
    set_id: r.setId,
    imported: r.imported === null ? null : JSON.stringify(r.imported),
  };
}

/** Decode and validate one stored import row. Throws `CorruptDataError`. */
export function decodeImportRow(row: SqlRow): ImportRow {
  const id = `${rowId(row.job_id)}#${rowId(row.row_number)}`;
  return checkRead(
    ImportRowSchema,
    {
      jobId: row.job_id,
      row: row.row_number,
      line: row.line,
      localDate: row.local_date,
      exerciseName: row.exercise_name,
      cells: parseJson('import_rows', id, 'cells', row.cells ?? null),
      result: row.result,
      detail: row.detail,
      sessionId: row.session_id,
      setId: row.set_id,
      imported: parseJsonOrNull('import_rows', id, 'imported', row.imported ?? null),
    },
    'import_rows',
    id,
  );
}

export type CreateJobOutcome =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: 'another_import_running' | 'conflict' };

export type CommitWorkoutOutcome = 'written' | 'duplicate' | 'job_not_committing';

export type JobWriteOutcome =
  | { ok: true; job: ImportJob; duplicate: boolean; workouts?: number }
  | { ok: false; error: 'not_found' | 'stale' | 'wrong_status' };

export interface AliasToSave {
  name: string;
  nameKey: string;
  target: AliasTarget;
  /** Ben's dumbbell answer for the name; null clears a stored one; absent: this import didn't ask (review r4 S2). */
  perHand?: PerHandReading | null;
  /** Ben's barbell answer for the name, kept exactly (exercise, bar, bar weight; review r8); null: he gave none this time; absent: this import didn't ask (PM decision after review r7). */
  total?: RememberedTotal | null;
}

export class SqliteImports {
  constructor(private readonly db: Database) {}

  getJob(jobId: string): Promise<ImportJob | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst('SELECT * FROM import_jobs WHERE id = ?', [jobId]);
      return row ? decodeDocument(IMPORT_JOB_SPEC, row) : null;
    });
  }

  /** Every import, newest first. */
  listJobs(ownerId: string): Promise<ImportJob[]> {
    return this.db.read(async (q) => {
      const jobs = await listDocuments(q, IMPORT_JOB_SPEC, 'owner_id = ?', [ownerId]);
      return jobs.sort((a, b) => toMs(b.startedAt.utc) - toMs(a.startedAt.utc));
    });
  }

  /** The import still being written (at most one per owner), if any. */
  committingJob(ownerId: string): Promise<ImportJob | null> {
    return this.db.read(async (q) => (await listDocuments(q, IMPORT_JOB_SPEC, "owner_id = ? AND status = 'committing'", [ownerId]))[0] ?? null);
  }

  /** Every source row of a job, in file order. */
  rows(jobId: string): Promise<ImportRow[]> {
    return this.db.read(async (q) => (await q.getAll('SELECT * FROM import_rows WHERE job_id = ? ORDER BY row_number', [jobId])).map(decodeImportRow));
  }

  /** A job's source rows on one date, in file order (one imported workout's sets and their originals). */
  rowsOn(jobId: string, localDate: string): Promise<ImportRow[]> {
    return this.db.read(async (q) => (await q.getAll('SELECT * FROM import_rows WHERE job_id = ? AND local_date = ? ORDER BY row_number', [jobId, localDate])).map(decodeImportRow));
  }

  /** Where an imported set came from (check 24), or null for a set logged in the app. */
  provenance(setId: string): Promise<{ row: ImportRow; job: ImportJob } | null> {
    return this.db.read(async (q) => {
      const raw = await q.getFirst('SELECT * FROM import_rows WHERE set_id = ?', [setId]);
      if (!raw) return null;
      const row = decodeImportRow(raw);
      const jobRow = await q.getFirst('SELECT * FROM import_jobs WHERE id = ?', [row.jobId]);
      return jobRow ? { row, job: decodeDocument(IMPORT_JOB_SPEC, jobRow) } : null;
    });
  }

  aliases(ownerId: string): Promise<ExerciseAlias[]> {
    return this.db.read((q) => listDocuments(q, EXERCISE_ALIAS_SPEC, 'owner_id = ?', [ownerId]));
  }

  /** Local dates that came in with imports still in effect (committing or committed), with the newest such import. */
  importedDates(ownerId: string): Promise<Map<string, EarlierImport>> {
    return this.db.read(async (q) => {
      const jobs = (await listDocuments(q, IMPORT_JOB_SPEC, "owner_id = ? AND status <> 'reverted'", [ownerId])).sort(
        (a, b) => toMs(a.startedAt.utc) - toMs(b.startedAt.utc),
      );
      const out = new Map<string, EarlierImport>();
      for (const job of jobs) {
        const dates = await q.getAll<{ d: string }>("SELECT DISTINCT local_date AS d FROM import_rows WHERE job_id = ? AND result = 'imported'", [job.id]);
        for (const { d } of dates) out.set(d, { jobId: job.id, fileName: job.fileName, startedAtUtc: job.startedAt.utc, tz: job.startedAt.tz });
      }
      return out;
    });
  }

  /** Local dates (each in its own zone) of workouts logged in the app, unfinished included; imported ones excluded. */
  appDates(ownerId: string): Promise<Set<string>> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ utc: string; tz: string }>(
        "SELECT started_at_utc AS utc, started_at_tz AS tz FROM sessions WHERE owner_id = ? AND import_job_id IS NULL AND status IN ('active', 'finished')",
        [ownerId],
      );
      return new Set(rows.map((r) => localDateOf(toMs(r.utc), r.tz)));
    });
  }

  /**
   * Workouts of a job by state (delete-workouts §6.2): `finished` in history,
   * `deleted` in Recently deleted at `nowUtc` (the Undo alert's
   * `Includes 3 in Recently deleted.`, the import's `· 3 deleted`).
   */
  jobWorkoutCounts(jobId: string, nowUtc: string): Promise<{ finished: number; deleted: number }> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ finished: number | null; deleted: number | null }>(
        `SELECT sum(${inHistorySql()}) AS finished, sum(status = 'deleted' AND purge_after_utc > ?) AS deleted FROM sessions WHERE import_job_id = ?`,
        [nowUtc, jobId],
      );
      return { finished: row?.finished ?? 0, deleted: row?.deleted ?? 0 };
    });
  }

  /**
   * Local dates of imported workouts in Recently deleted at `nowUtc` (§6.2,
   * DW26): the re-import's `n are in Recently deleted.` Past their 30 days
   * they aren't listed there, so they aren't counted (review r2 N1).
   */
  deletedImportDates(ownerId: string, nowUtc: string): Promise<Set<string>> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ d: string | null }>(
        "SELECT local_date AS d FROM sessions WHERE owner_id = ? AND import_job_id IS NOT NULL AND status = 'deleted' AND purge_after_utc > ?",
        [ownerId, nowUtc],
      );
      return new Set(rows.map((r) => r.d).filter((d): d is string => d !== null));
    });
  }

  /** Workouts of a job already written (any status), by local date. */
  writtenDates(jobId: string): Promise<Set<string>> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ d: string }>('SELECT local_date AS d FROM sessions WHERE import_job_id = ?', [jobId]);
      return new Set(rows.map((r) => r.d));
    });
  }

  /**
   * Start a commit: the job, every source row, the custom exercises `Add
   * new` makes (and catalogue exercises the rows use that aren't stored yet;
   * an exercise already stored is never changed), and the remembered names,
   * in one transaction. Idempotent by job ID and operation ID: the same call
   * again is a `duplicate` and changes nothing.
   */
  createJob(job: ImportJob, rows: readonly ImportRow[], extras: { exercises: readonly Exercise[]; aliases: readonly AliasToSave[]; at: ZonedTimestamp; newId: () => string }): Promise<CreateJobOutcome> {
    return this.db.write(async (tx) => {
      const existing = await tx.getFirst('SELECT * FROM import_jobs WHERE id = ?', [job.id]);
      if (existing) {
        const stored = decodeDocument(IMPORT_JOB_SPEC, existing);
        return stored.operationId === job.operationId ? { ok: true, duplicate: true } : { ok: false, error: 'conflict' };
      }
      const running = await tx.getFirst("SELECT id FROM import_jobs WHERE owner_id = ? AND status = 'committing'", [job.ownerId]);
      if (running) return { ok: false, error: 'another_import_running' };
      const saved = await saveDocumentIn(tx, IMPORT_JOB_SPEC, job, null);
      if (!saved.ok) return { ok: false, error: 'conflict' };
      for (const r of rows) {
        if (r.jobId !== job.id) throw new Error(`Row ${String(r.row)} belongs to another job`);
        await insert(tx, 'import_rows', rowRecord(checkWrite(ImportRowSchema, r, 'import_rows', `${r.jobId}#${String(r.row)}`)));
      }
      for (const e of extras.exercises) await saveImportExercise(tx, e);
      for (const a of extras.aliases) await upsertAlias(tx, job, a, extras.at, extras.newId);
      return { ok: true, duplicate: false };
    });
  }

  /**
   * Write one imported workout (one resumable batch). A workout already
   * written (same start operation) is a duplicate; a job that is no longer
   * `committing` (undone) gets nothing.
   */
  commitWorkout(jobId: string, aggregate: SessionAggregate): Promise<CommitWorkoutOutcome> {
    return this.db.write(async (tx) => {
      const job = await tx.getFirst<{ status: string; owner_id: string }>('SELECT status, owner_id FROM import_jobs WHERE id = ?', [jobId]);
      if (job?.status !== 'committing') return 'job_not_committing';
      const valid = checkWrite(SessionAggregateSchema, aggregate, 'sessions', aggregate.session.id);
      if (valid.session.importJobId !== jobId || valid.session.ownerId !== job.owner_id || valid.session.source !== 'import') {
        throw new Error('An imported workout must belong to its job and owner');
      }
      const already = await tx.getFirst('SELECT id FROM sessions WHERE owner_id = ? AND start_operation_id = ?', [valid.session.ownerId, valid.session.startOperationId]);
      if (already) return 'duplicate';
      await writeAggregate(tx, valid);
      return 'written';
    });
  }

  /** Every planned workout is in: `committing` → `committed`. */
  finishJob(jobId: string, expectedVersion: number, at: ZonedTimestamp): Promise<JobWriteOutcome> {
    return this.db.write(async (tx) => {
      const job = await readJob(tx, jobId);
      if (!job) return { ok: false, error: 'not_found' };
      if (job.status === 'committed') return { ok: true, job, duplicate: true };
      if (job.status !== 'committing') return { ok: false, error: 'wrong_status' };
      if (job.version !== expectedVersion) return { ok: false, error: 'stale' };
      const next: ImportJob = { ...job, status: 'committed', finishedAt: at, version: job.version + 1, updatedAtUtc: at.utc };
      const saved = await saveDocumentIn(tx, IMPORT_JOB_SPEC, next, job.version);
      if (!saved.ok) return { ok: false, error: 'stale' };
      return { ok: true, job: next, duplicate: false };
    });
  }

  /**
   * `Undo this import` (`revertImport(jobId, expectedVersion, operationId)`):
   * in one transaction, every workout of the job becomes `reverted` (its
   * version and storage revision bump, so a stale copy can't be saved over
   * it) and the job records the undo. Nothing is deleted (DX7). The same
   * operation again is a duplicate; a stale version is refused.
   */
  revertJob(jobId: string, expectedVersion: number, opId: string, at: ZonedTimestamp): Promise<JobWriteOutcome> {
    return this.db.write(async (tx) => {
      const job = await readJob(tx, jobId);
      if (!job) return { ok: false, error: 'not_found' };
      if (job.status === 'reverted') return job.revert?.opId === opId ? { ok: true, job, duplicate: true, workouts: job.revert.workouts } : { ok: false, error: 'wrong_status' };
      if (job.version !== expectedVersion) return { ok: false, error: 'stale' };
      // Deleted workouts of the import are reverted too and leave Recently deleted (delete-workouts §6.2, DW25).
      const changed = await tx.run(
        `UPDATE sessions SET status = 'reverted', version = version + 1, revision = revision + 1, last_activity_at_utc = ?,
           deleted_at_utc = NULL, deleted_at_tz = NULL, deleted_by_op_id = NULL, purge_after_utc = NULL
         WHERE import_job_id = ? AND status IN ('finished', 'deleted')`,
        [at.utc, jobId],
      );
      const next: ImportJob = { ...job, status: 'reverted', revert: { at, opId, workouts: changed.changes }, version: job.version + 1, updatedAtUtc: at.utc };
      const saved = await saveDocumentIn(tx, IMPORT_JOB_SPEC, next, job.version);
      if (!saved.ok) throw new Error('Import job changed during the undo');
      return { ok: true, job: next, duplicate: false, workouts: changed.changes };
    });
  }
}

async function readJob(q: SqlExecutor, jobId: string): Promise<ImportJob | null> {
  const row = await q.getFirst('SELECT * FROM import_jobs WHERE id = ?', [jobId]);
  return row ? decodeDocument(IMPORT_JOB_SPEC, row) : null;
}

/**
 * An exercise the import uses: a catalogue exercise or `Add new`'s custom
 * one, saved when it isn't stored yet. An exercise that is already stored
 * is never changed by an import (review r6 B1): `Add new` with other
 * equipment is another exercise (`customExerciseIdFor` per equipment), so
 * nothing an undone import answered lives on in an exercise, and an import
 * still in effect that mapped a name to it keeps reading it its way.
 */
async function saveImportExercise(tx: SqlExecutor, e: Exercise): Promise<void> {
  const row = await tx.getFirst('SELECT id FROM exercises WHERE id = ?', [e.id]);
  if (row) return;
  const saved = await saveDocumentIn(tx, EXERCISE_SPEC, e, null);
  if (!saved.ok) throw new Error('Exercise conflict');
}

/**
 * One remembered name per owner, source and key, versioned (version + 1 on
 * every import that answers or uses it). Each import adds its use (its
 * target and, when it asked, the dumbbell and barbell answers), so Undo import can ignore
 * exactly what that import taught (review r5 S2). `target` / `perHand` /
 * `jobId` record the last write; the dumbbell answer is kept there unless
 * this import gave or cleared one (review r4 S2).
 */
async function upsertAlias(tx: SqlExecutor, job: ImportJob, a: AliasToSave, at: ZonedTimestamp, newId: () => string): Promise<void> {
  const row = await tx.getFirst('SELECT * FROM exercise_aliases WHERE owner_id = ? AND source = ? AND name_key = ?', [job.ownerId, 'fitnotes', a.nameKey]);
  const current = row ? decodeDocument(EXERCISE_ALIAS_SPEC, row) : null;
  const perHand = (a.perHand === undefined ? current?.perHand : a.perHand) ?? null;
  const use = { jobId: job.id, target: a.target, ...(a.perHand === undefined ? {} : { perHand: a.perHand }), ...(a.total === undefined ? {} : { total: a.total }) };
  const uses = [...(current ? aliasUses(current) : []).filter((u) => u.jobId !== job.id), use].slice(-ALIAS_USES_MAX);
  const next: ExerciseAlias = current
    ? { ...current, name: a.name, target: a.target, jobId: job.id, uses, version: current.version + 1, updatedAtUtc: at.utc }
    : {
        id: newId(),
        ownerId: job.ownerId,
        version: 1,
        createdAtUtc: at.utc,
        updatedAtUtc: at.utc,
        source: 'fitnotes',
        name: a.name,
        nameKey: a.nameKey,
        target: a.target,
        jobId: job.id,
        uses,
      };
  if (perHand === null) delete next.perHand;
  else next.perHand = perHand;
  const saved = await saveDocumentIn(tx, EXERCISE_ALIAS_SPEC, next, current ? current.version : null);
  if (!saved.ok) throw new Error('Alias conflict');
}
