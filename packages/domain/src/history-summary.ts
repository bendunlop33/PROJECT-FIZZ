import type { SessionAggregate } from '@fizz/schemas';
import { toHistorySessions } from './history';
import type { HistorySession } from './progression';
import { stableStringify } from './stable';
import { isInHistory } from './session/deletion';

/**
 * (ADR 0032, Ben-approved 24 Oct) The stored per-workout history summary: what history readers (Today, Your workout,
 * the plan builder, progression, Progress and the coach's context) read of a finished workout, so the first read after
 * a launch needn't decode every workout's nine tables and schema-check them.
 *
 * Derived Your data: written in the same transaction as every save, edit, delete, restore and import of the workout
 * (persistence `writeAggregate`), rebuilt from the workouts by a migration and on open when one is missing or stale,
 * never in a backup (a restore rebuilds them). Only workouts in history (`isInHistory`) have one.
 *
 * Pure: these functions compute a summary from a decoded, validated workout. Nothing here reads or writes storage.
 */

/** Bump when what a summary holds changes: every stored summary of another format is rebuilt on open. */
export const HISTORY_SUMMARY_FORMAT = 1;

/**
 * A finished workout as history reads it: the workout's session, rows, sets and storage revision exactly as stored;
 * without its audit trails, processed operations, rest timer and work interval (no history reader uses them), and with
 * the rows added after it was planned (`addedRowIds`; `extraCopies` tells copies apart by them).
 */
export type HistoryWorkout = Pick<SessionAggregate, 'session' | 'exercises' | 'sets' | 'revision'> & {
  /** Rows added after the workout was planned (`add_exercise` operations' created IDs), in operation order. */
  addedRowIds: readonly string[];
};

/** What history readers accept: a stored workout (`SessionAggregate`) or its summary (`HistoryWorkout`). */
export type HistoryLike = Pick<SessionAggregate, 'session' | 'exercises' | 'sets' | 'revision'> & {
  addedRowIds?: readonly string[];
  processedOps?: SessionAggregate['processedOps'];
};

/** A workout's stored summary: the workout as history reads it, and each exercise's progression history. */
export interface HistorySummary {
  format: typeof HISTORY_SUMMARY_FORMAT;
  workout: HistoryWorkout;
  /** `toHistorySessions(workout, exerciseId, { identity: true })` for every exercise in the workout (none: `[]`). */
  lifts: Readonly<Record<string, readonly HistorySession[]>>;
}

/** The rows added to the workout after it was planned (Library, picker, coach adds): `add_exercise` records. */
export function addedRowIdsOf(w: Pick<HistoryLike, 'addedRowIds' | 'processedOps'>): readonly string[] {
  if (w.addedRowIds !== undefined) return w.addedRowIds;
  const out: string[] = [];
  for (const op of Object.values(w.processedOps ?? {})) if (op.commandType === 'add_exercise') for (const id of op.createdIds ?? []) out.push(id);
  return out;
}

/** The workout as history reads it (see `HistoryWorkout`). Shares the aggregate's objects; never mutate either. */
export function toHistoryWorkout(a: SessionAggregate): HistoryWorkout {
  return { session: a.session, exercises: a.exercises, sets: a.sets, revision: a.revision, addedRowIds: addedRowIdsOf(a) };
}

/**
 * The summary stored for `a`, or null when it isn't in history (active, discarded, reverted, deleted: no summary is
 * stored for those). Deterministic: the same workout always gives the same summary.
 */
export function historySummaryOf(a: SessionAggregate): HistorySummary | null {
  if (!isInHistory(a.session)) return null;
  const workout = toHistoryWorkout(a);
  const lifts: Record<string, readonly HistorySession[]> = {};
  for (const e of a.exercises) if (!(e.exerciseId in lifts)) lifts[e.exerciseId] = toHistorySessions(workout, e.exerciseId, { identity: true });
  return { format: HISTORY_SUMMARY_FORMAT, workout, lifts };
}

/** Whether two summaries hold the same facts (key order aside): the consistency check's comparison. */
export function sameHistorySummary(a: HistorySummary | null, b: HistorySummary | null): boolean {
  if (a === null || b === null) return a === b;
  return stableStringify(a) === stableStringify(b);
}
