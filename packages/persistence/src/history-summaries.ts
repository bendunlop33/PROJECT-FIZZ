import { HISTORY_SUMMARY_FORMAT, historySummaryOf, type HistorySession, type HistorySummary, type HistoryWorkout } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';
import type { SqlExecutor, SqlValue } from './driver';
import { inHistorySql, insert } from './sql';

/**
 * (ADR 0032, Ben-approved 24 Oct) Storage of the per-workout history summary (`HistorySummary`, migration 36): derived
 * Your data, one `history_summaries` row per workout in history and one `history_summary_exercises` row per exercise of it.
 * Written in the transaction of every workout write; read by the history reads in `sessions.ts`; rebuilt by
 * `summary-repair.ts`. Never in a backup.
 */

/** The derived tables: left out of backups, exports and content comparisons (rebuilt from the workouts on open). */
export const DERIVED_TABLES = ['history_summaries', 'history_summary_exercises'] as const;

export function isDerivedTable(name: string): boolean {
  return (DERIVED_TABLES as readonly string[]).includes(name);
}

/** Whether this database has the summary tables (schema 36 and later; tests also open older schemas). */
export async function hasSummaryTables(q: SqlExecutor): Promise<boolean> {
  return (await q.getFirst("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'history_summaries'")) !== null;
}

/** Remove a workout's summary rows (it left history, or it is being rewritten or purged). */
export async function deleteHistorySummaryIn(tx: SqlExecutor, sessionId: string): Promise<void> {
  await tx.run('DELETE FROM history_summary_exercises WHERE session_id = ?', [sessionId]);
  await tx.run('DELETE FROM history_summaries WHERE session_id = ?', [sessionId]);
}

/** Store `summary` as the summary of its workout (any earlier rows of the workout are replaced). */
export async function putHistorySummaryIn(tx: SqlExecutor, summary: HistorySummary): Promise<void> {
  const s = summary.workout.session;
  await deleteHistorySummaryIn(tx, s.id);
  await insert(tx, 'history_summaries', {
    session_id: s.id,
    owner_id: s.ownerId,
    started_at_utc: s.startedAt.utc,
    revision: summary.workout.revision,
    format: summary.format,
    data: JSON.stringify(summary.workout),
    lifts: JSON.stringify(summary.lifts),
  });
  for (const exerciseId of Object.keys(summary.lifts)) {
    await insert(tx, 'history_summary_exercises', { session_id: s.id, exercise_id: exerciseId, owner_id: s.ownerId, started_at_utc: s.startedAt.utc });
  }
}

/**
 * The summary of a validated workout being written, inside the same transaction (`writeAggregate`): stored when it
 * is in history, removed when it isn't. A database before schema 36 has no summaries.
 */
export async function writeHistorySummaryIn(tx: SqlExecutor, a: SessionAggregate): Promise<void> {
  if (!(await hasSummaryTables(tx))) return;
  const summary = historySummaryOf(a);
  if (summary === null) await deleteHistorySummaryIn(tx, a.session.id);
  else await putHistorySummaryIn(tx, summary);
}

/** A stored summary row as read back (no schema check: written by `putHistorySummaryIn` from a validated workout). */
export function parseStoredWorkout(data: SqlValue | undefined): HistoryWorkout | null {
  if (typeof data !== 'string') return null;
  try {
    const w = JSON.parse(data) as HistoryWorkout | null;
    return w !== null && typeof w === 'object' && typeof w.session === 'object' && Array.isArray(w.sets) && Array.isArray(w.exercises) && Array.isArray(w.addedRowIds) ? w : null;
  } catch {
    return null;
  }
}

/** A stored summary's `lifts` (each exercise's progression history, by exercise ID) as read back. */
export function parseStoredLifts(data: SqlValue | undefined): Record<string, HistorySession[]> | null {
  if (typeof data !== 'string') return null;
  try {
    const v = JSON.parse(data) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => Array.isArray(x)) ? (v as Record<string, HistorySession[]>) : null;
  } catch {
    return null;
  }
}

/** SQL: a summary row `w` that is the current one for session `s` (same revision, this build's format). */
export const FRESH_SUMMARY_SQL = (w: string, s: string): string => `(${w}.revision = ${s}.revision AND ${w}.format = ${String(HISTORY_SUMMARY_FORMAT)})`;

/**
 * Workouts whose stored summary isn't current, without decoding anything: in history with no summary of this format
 * at its revision (`missing`), or a summary row for a workout that isn't in history (any more) (`orphans`). The
 * cheap check `openStore` runs on every open.
 */
export async function staleHistorySummaries(q: SqlExecutor): Promise<{ missing: string[]; orphans: string[] }> {
  const missing = await q.getAll<{ id: string }>(
    `SELECT s.id AS id FROM sessions s LEFT JOIN history_summaries w ON w.session_id = s.id
     WHERE ${inHistorySql('s')} AND (w.session_id IS NULL OR NOT ${FRESH_SUMMARY_SQL('w', 's')}) ORDER BY s.id`,
  );
  const orphans = await q.getAll<{ id: string }>(
    `SELECT w.session_id AS id FROM history_summaries w LEFT JOIN sessions s ON s.id = w.session_id
     WHERE s.id IS NULL OR NOT ${inHistorySql('s')}
     UNION SELECT l.session_id AS id FROM history_summary_exercises l LEFT JOIN history_summaries w ON w.session_id = l.session_id WHERE w.session_id IS NULL
     ORDER BY id`,
  );
  return { missing: missing.map((r) => r.id), orphans: orphans.map((r) => r.id) };
}
