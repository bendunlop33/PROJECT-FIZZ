import type { SessionAggregate, Weekday, WorkoutSession, ZonedTimestamp } from '@fizz/schemas';
import { addDays, localDateOf, localMidnightUtcMs, weekdayOf } from '../calendar';
import { stableStringify } from '../stable';
import { toIso, toMs } from '../time';

/**
 * Deleting finished workouts (delete-workouts.md). Pure: the persistence
 * layer reads the sessions and writes what these return in one transaction.
 *
 * - Deleting is a status change `finished` → `deleted` with a deletion
 *   record (DW-D1). No set, exercise or audit row changes (DW6); the
 *   session's version and storage revision bump, so a stale copy can't be
 *   saved over it (rule 5).
 * - Restore puts it back to `finished` and clears the record, version + 1
 *   (DW9). Both operations are recorded in the session's processed
 *   operations, which is also how a retry is recognised (DW7).
 * - Several workouts are all-or-nothing: one stale item refuses the lot.
 */

/** Days a deleted workout stays in Recently deleted (§6.4). */
export const RESTORE_WINDOW_DAYS = 30;

export const DELETE_WORKOUT_COMMAND = 'delete_workout';
export const RESTORE_WORKOUT_COMMAND = 'restore_workout';

/** The status `isInHistory` admits (SQL readers use `inHistorySql`, which is built from it). */
export const HISTORY_STATUS = 'finished' as const;

/**
 * The one predicate every derived view uses (§5, DW19): a workout is in
 * history when it is finished. Active, discarded, reverted (import undone)
 * and deleted workouts are not.
 */
export function isInHistory(session: Pick<WorkoutSession, 'status'>): boolean {
  return session.status === HISTORY_STATUS;
}

/**
 * When a workout deleted at `at` stops being restorable: the end of the local
 * day (in `at.tz`) `RESTORE_WINDOW_DAYS` days later, as the first instant of
 * the next day (exclusive).
 */
export function purgeAfterUtc(at: ZonedTimestamp): string {
  const deletedOn = localDateOf(toMs(at.utc), at.tz);
  return toIso(localMidnightUtcMs(addDays(deletedOn, RESTORE_WINDOW_DAYS + 1), at.tz));
}

/** The local date shown as `Gone on <date>` (the last day it can be restored), in `tz`. */
export function goneOnDate(purgeAfter: string, tz: string): string {
  return localDateOf(toMs(purgeAfter) - 1, tz);
}

/** Deleted and still within its 30 days at `nowMs` (DW21: past it, never listed or restorable, purged or not). */
export function isRestorable(session: Pick<WorkoutSession, 'status' | 'deletion'>, nowMs: number): boolean {
  return session.status === 'deleted' && session.deletion !== undefined && nowMs < toMs(session.deletion.purgeAfterUtc);
}

/** Deleted and past its 30 days: what the purge removes. */
export function isPurgeDue(session: Pick<WorkoutSession, 'status' | 'deletion'>, nowMs: number): boolean {
  return session.status === 'deleted' && session.deletion !== undefined && nowMs >= toMs(session.deletion.purgeAfterUtc);
}

export interface DeleteItem {
  sessionId: string;
  /** The session `version` the list or screen showed. */
  expectedVersion: number;
}

export interface WorkoutsRequest {
  ownerId: string;
  items: readonly DeleteItem[];
  opId: string;
  at: ZonedTimestamp;
}

/** A session as it is after the operation (`version` is what Undo / Restore must send). */
export interface SessionRef {
  sessionId: string;
  version: number;
}

export type DeletionError =
  | { code: 'empty' }
  /** One or more workouts changed, were restored, deleted, reverted or purged since they were shown. Nothing was written. */
  | { code: 'stale'; sessionIds: string[] }
  | { code: 'operation_id_reused' };

export type DeletionPlan =
  | {
      ok: true;
      /** The same operation was already applied: nothing to write. */
      duplicate: boolean;
      writes: { aggregate: SessionAggregate; expectedRevision: number }[];
      refs: SessionRef[];
    }
  | { ok: false; error: DeletionError };

function fingerprint(items: readonly DeleteItem[]): string {
  return stableStringify([...items].sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)).map((i) => [i.sessionId, i.expectedVersion]));
}

function plan(
  found: ReadonlyMap<string, SessionAggregate | null>,
  req: WorkoutsRequest,
  command: string,
  eligible: (a: SessionAggregate) => boolean,
  apply: (a: SessionAggregate) => SessionAggregate,
  /** The operation's outcome still holds (nothing undid it since); a retry otherwise is stale (review r2 N5). */
  stillApplied: (a: SessionAggregate) => boolean,
): DeletionPlan {
  if (req.items.length === 0) return { ok: false, error: { code: 'empty' } };
  const ids = new Set(req.items.map((i) => i.sessionId));
  if (ids.size !== req.items.length) return { ok: false, error: { code: 'operation_id_reused' } };
  const fp = fingerprint(req.items);

  // A retry of this operation: every item already carries it.
  const prior = req.items.map((i) => found.get(i.sessionId)?.processedOps[req.opId] ?? null);
  if (prior.some((p) => p !== null)) {
    if (prior.every((p) => p !== null && p.commandType === command && p.fingerprint === fp)) {
      // A late retry after a later operation changed the workout again: say so, never `ok` with the newer state.
      const changed = req.items.filter((i) => {
        const a = found.get(i.sessionId);
        return !a || !stillApplied(a) || laterLifecycleOp(a, req.opId);
      });
      if (changed.length > 0) return { ok: false, error: { code: 'stale', sessionIds: changed.map((i) => i.sessionId) } };
      return {
        ok: true,
        duplicate: true,
        writes: [],
        refs: req.items.map((i) => ({ sessionId: i.sessionId, version: found.get(i.sessionId)?.session.version ?? i.expectedVersion })),
      };
    }
    return { ok: false, error: { code: 'operation_id_reused' } };
  }

  const stale: string[] = [];
  const writes: { aggregate: SessionAggregate; expectedRevision: number }[] = [];
  for (const item of req.items) {
    const a = found.get(item.sessionId) ?? null;
    if (a?.session.ownerId !== req.ownerId || a.session.version !== item.expectedVersion || !eligible(a)) {
      stale.push(item.sessionId);
      continue;
    }
    const next = apply(a);
    writes.push({
      aggregate: {
        ...next,
        revision: a.revision + 1,
        processedOps: { ...next.processedOps, [req.opId]: { opId: req.opId, commandType: command, fingerprint: fp, atUtc: req.at.utc } },
      },
      expectedRevision: a.revision,
    });
  }
  if (stale.length > 0) return { ok: false, error: { code: 'stale', sessionIds: stale } };
  return { ok: true, duplicate: false, writes, refs: writes.map((w) => ({ sessionId: w.aggregate.session.id, version: w.aggregate.session.version })) };
}

/** Whether a delete or restore was recorded on `a` after operation `opId`. */
function laterLifecycleOp(a: SessionAggregate, opId: string): boolean {
  const at = a.processedOps[opId]?.atUtc;
  if (at === undefined) return false;
  return Object.values(a.processedOps).some((o) => o.opId !== opId && (o.commandType === DELETE_WORKOUT_COMMAND || o.commandType === RESTORE_WORKOUT_COMMAND) && o.atUtc > at);
}

/**
 * `deleteWorkouts` (§8): only `finished` workouts at the shown version.
 * Refuses active, discarded, reverted and already-deleted ones as stale.
 */
export function planDeleteWorkouts(found: ReadonlyMap<string, SessionAggregate | null>, req: WorkoutsRequest): DeletionPlan {
  const deletion = { at: req.at, opId: req.opId, purgeAfterUtc: purgeAfterUtc(req.at) };
  return plan(found, req, DELETE_WORKOUT_COMMAND, (a) => a.session.status === 'finished', (a) => ({
    ...a,
    session: { ...a.session, status: 'deleted', deletion, version: a.session.version + 1 },
  }), (a) => a.session.status === 'deleted' && a.session.deletion?.opId === req.opId);
}

/**
 * `restoreWorkouts` (§8; also the toast's Undo): only `deleted` workouts at
 * the shown version that are still restorable at `req.at`. Purged, reverted
 * and past-30-days ones are stale (`No longer available.`).
 */
export function planRestoreWorkouts(found: ReadonlyMap<string, SessionAggregate | null>, req: WorkoutsRequest): DeletionPlan {
  const nowMs = toMs(req.at.utc);
  return plan(found, req, RESTORE_WORKOUT_COMMAND, (a) => isRestorable(a.session, nowMs), (a) => {
    const session: WorkoutSession = { ...a.session, status: 'finished', version: a.session.version + 1 };
    delete session.deletion;
    return { ...a, session };
  }, (a) => isInHistory(a.session));
}

/** What the confirm sheet for several workouts shows (§2.4, DW4). The UI never computes the range. */
export interface DeleteConfirmView {
  count: number;
  /** Local dates (each workout in its own zone; imported: its date). */
  firstDate: string;
  lastDate: string;
  importedCount: number;
  title: string;
  /** `Mon 5 Oct – Thu 8 Oct`, `Mon 5 Oct`, or `28 Dec 2025 – 3 Jan 2026` across years. */
  range: string;
  /** `1 imported`, or null. */
  importedLine: string | null;
  confirmLabel: string;
}

export interface DeleteSelectionItem {
  startedAt: ZonedTimestamp;
  localDate?: string;
  source: 'manual' | 'import';
}

const WEEKDAYS: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function dateParts(localDate: string): { y: number; m: number; d: number; weekday: string } {
  const [y = 0, m = 1, d = 1] = localDate.split('-').map(Number);
  return { y, m, d, weekday: WEEKDAYS[weekdayOf(localMidnightUtcMs(localDate, 'UTC'), 'UTC')] };
}

/** `Mon 5 Oct`, or `5 Oct 2025` with the year. */
export function shortDateText(localDate: string, withYear = false): string {
  const p = dateParts(localDate);
  const month = MONTHS[p.m - 1] ?? '';
  return withYear ? `${String(p.d)} ${month} ${String(p.y)}` : `${p.weekday} ${String(p.d)} ${month}`;
}

export function localDateOfWorkout(w: Pick<DeleteSelectionItem, 'startedAt' | 'localDate'>): string {
  return w.localDate ?? localDateOf(toMs(w.startedAt.utc), w.startedAt.tz);
}

export function buildDeleteConfirmView(selection: readonly DeleteSelectionItem[]): DeleteConfirmView | null {
  if (selection.length === 0) return null;
  const dates = selection.map(localDateOfWorkout).sort();
  const firstDate = dates[0] ?? '';
  const lastDate = dates[dates.length - 1] ?? '';
  const count = selection.length;
  const importedCount = selection.filter((s) => s.source === 'import').length;
  const years = firstDate.slice(0, 4) !== lastDate.slice(0, 4);
  const range = firstDate === lastDate ? shortDateText(firstDate) : `${shortDateText(firstDate, years)} – ${shortDateText(lastDate, years)}`;
  const noun = count === 1 ? 'workout' : 'workouts';
  return {
    count,
    firstDate,
    lastDate,
    importedCount,
    title: `Delete ${String(count)} ${noun}?`,
    range,
    importedLine: importedCount > 0 ? `${String(importedCount)} imported` : null,
    confirmLabel: `Delete ${String(count)} ${noun}`,
  };
}
