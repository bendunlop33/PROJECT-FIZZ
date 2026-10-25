import { HISTORY_SUMMARY_FORMAT, historySummaryOf, sameHistorySummary, type HistorySummary } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';
import type { SqlExecutor } from './driver';
import { deleteHistorySummaryIn, hasSummaryTables, parseStoredLifts, parseStoredWorkout, putHistorySummaryIn, staleHistorySummaries } from './history-summaries';
import { readAggregates } from './sessions';
import { inHistorySql } from './sql';
import type { Slicer } from './backup/slice';

/**
 * (ADR 0032) The history summaries' consistency check and repair: a summary must equal the one recomputed from its
 * workout (`historySummaryOf`), and only workouts in history have one. Summaries are derived, so a repair rewrites them
 * from the workouts (the authoritative record) and never touches a workout.
 */

/** Workouts read per batch while checking or rebuilding. */
const BATCH = 100;
/** Workouts decoded per batch when the rebuild is sliced. */
const SLICED_BATCH = 4;

export interface SummaryRebuild {
  /** Summaries written (or rewritten). */
  written: number;
  /** Workouts whose summary rows were removed (not in history, gone, or unreadable). */
  removed: number;
  /** Workouts that didn't decode: no summary is kept for them (history reads decode them and report them as before). */
  unreadable: string[];
}

/**
 * Rewrite the summaries of `sessionIds` from their workouts, inside the caller's transaction: in history → its summary;
 * otherwise (or unreadable, or no such workout) → none.
 */
export async function rebuildHistorySummariesIn(tx: SqlExecutor, sessionIds: readonly string[], slice?: Slicer): Promise<SummaryRebuild> {
  const out: SummaryRebuild = { written: 0, removed: 0, unreadable: [] };
  if (sessionIds.length === 0 || !(await hasSummaryTables(tx))) return out;
  // Sliced (a restore, a reset, the migration's backfill): a few workouts per turn, so the JS thread breathes.
  const batch = slice === undefined ? BATCH : SLICED_BATCH;
  for (let i = 0; i < sessionIds.length; i += batch) {
    const ids = sessionIds.slice(i, i + batch);
    const read = await readAggregates(tx, ids);
    for (const id of ids) {
      await slice?.();
      const a = read.get(id);
      const summary = a === undefined || a instanceof Error ? null : historySummaryOf(a);
      if (a instanceof Error) out.unreadable.push(id);
      if (summary === null) {
        await deleteHistorySummaryIn(tx, id);
        out.removed += 1;
      } else {
        await putHistorySummaryIn(tx, summary);
        out.written += 1;
      }
    }
  }
  return out;
}

/**
 * Bring every summary up to date without decoding the ones that are current (by revision and format): what `openStore`
 * runs on every open (after a restore, a reset, an update that changed the format, or a write that bypassed the
 * repositories) and migration 36's backfill. Usually finds nothing to do (one query).
 */
export async function refreshStaleHistorySummariesIn(tx: SqlExecutor, slice?: Slicer): Promise<SummaryRebuild> {
  if (!(await hasSummaryTables(tx))) return { written: 0, removed: 0, unreadable: [] };
  const { missing, orphans } = await staleHistorySummaries(tx);
  return rebuildHistorySummariesIn(tx, [...new Set([...missing, ...orphans])], slice);
}

export interface SummaryCheck {
  ok: boolean;
  /** Workouts in history checked. */
  checked: number;
  /** In history, with no current summary (none, another revision or another format). */
  missing: string[];
  /** A current summary that differs from the one recomputed from the workout. */
  differing: string[];
  /** Summary rows of a workout that isn't in history, or lift rows with no summary. */
  orphans: string[];
  /** Workouts in history that didn't decode (their summary can't be checked; the integrity check reports them). */
  unreadable: string[];
}

/** The stored summary of `sessionId` as written (null: none, or another revision or format, or unparsable). */
async function storedSummary(q: SqlExecutor, sessionId: string, revision: number): Promise<HistorySummary | null> {
  const row = await q.getFirst<{ revision: number; format: number; data: string; lifts: string }>('SELECT revision, format, data, lifts FROM history_summaries WHERE session_id = ?', [sessionId]);
  if (row?.revision !== revision || row.format !== HISTORY_SUMMARY_FORMAT) return null;
  const workout = parseStoredWorkout(row.data);
  const lifts = parseStoredLifts(row.lifts);
  if (workout === null || lifts === null) return null;
  // The exercise index must list exactly the summary's exercises (a per-exercise read finds workouts through it).
  const indexed = (await q.getAll<{ exercise_id: string }>('SELECT exercise_id FROM history_summary_exercises WHERE session_id = ? ORDER BY exercise_id', [sessionId])).map((r) => r.exercise_id);
  if (indexed.join('|') !== Object.keys(lifts).sort().join('|')) return null;
  return { format: HISTORY_SUMMARY_FORMAT, workout, lifts };
}

/**
 * Whether `sessionId`'s stored summary must be rebuilt, given its workout as just read (`a`; an Error: it didn't
 * decode): no current summary for a workout in history, one that differs from the recomputed one, or one at all for a
 * workout that isn't in history or can't be read (history reads then decode it and report it, as before).
 */
export async function summaryNeedsRebuild(q: SqlExecutor, sessionId: string, a: SessionAggregate | Error | null): Promise<boolean> {
  if (!(await hasSummaryTables(q))) return false;
  const want = a === null || a instanceof Error ? null : historySummaryOf(a);
  if (want === null) return (await q.getFirst('SELECT 1 AS x FROM history_summaries WHERE session_id = ? UNION SELECT 1 AS x FROM history_summary_exercises WHERE session_id = ?', [sessionId, sessionId])) !== null;
  const got = await storedSummary(q, sessionId, want.workout.revision);
  return got === null || !sameHistorySummary(got, want);
}

/**
 * The full consistency check (ADR 0032): every workout in history decoded and its summary recomputed and compared with
 * the stored one, plus orphaned rows. Reads only. `sessionIds` limits it to those workouts (orphans are always checked).
 */
export async function checkHistorySummariesWith(q: SqlExecutor, sessionIds?: readonly string[], opts: { orphans?: boolean } = {}): Promise<SummaryCheck> {
  const out: SummaryCheck = { ok: true, checked: 0, missing: [], differing: [], orphans: [], unreadable: [] };
  if (!(await hasSummaryTables(q))) return out;
  const ids = sessionIds ?? (await q.getAll<{ id: string }>(`SELECT id FROM sessions WHERE ${inHistorySql()} ORDER BY id`)).map((r) => r.id);
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const read = await readAggregates(q, batch);
    for (const id of batch) {
      const a = read.get(id);
      if (a === undefined) continue;
      if (a instanceof Error) {
        out.unreadable.push(id);
        continue;
      }
      const want = historySummaryOf(a);
      if (want === null) continue;
      out.checked += 1;
      const got = await storedSummary(q, id, a.revision);
      if (got === null) out.missing.push(id);
      else if (!sameHistorySummary(got, want)) out.differing.push(id);
    }
  }
  if (opts.orphans !== false) out.orphans = (await staleHistorySummaries(q)).orphans;
  out.ok = out.missing.length === 0 && out.differing.length === 0 && out.orphans.length === 0;
  return out;
}
