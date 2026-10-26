import {
  addDays,
  feedActivityOf,
  feedWorkoutOf,
  historyFirstFrom,
  historyOlderFrom,
  localMidnightUtcMs,
  mergeFeed,
  toIso,
  type FeedItem,
  type HistoryWorkout,
  buildDeleteConfirmView,
  goneOnDate,
  isInHistory,
  isRestorable,
  localDateOf,
  toMs,
  type DeleteConfirmView,
  type DeleteItem,
  type DeletionError,
  type SessionRef,
} from '@fizz/domain';
import type { DeletionOutcome, SqliteRepositories } from '@fizz/persistence';
import type { SessionAggregate, UserProfile, ZonedTimestamp } from '@fizz/schemas';

import type { RepeatCandidate } from './workout-services';

/**
 * Deleting past workouts (delete-workouts.md): the screens' only way to
 * delete, restore, list Recently deleted and purge. Everything is a local
 * write (§3.1: offline and AI make no difference); the domain decides what
 * is allowed and the store writes it in one transaction.
 */

/** Past workouts loads this many rows at a time; `Show more` loads the next (review r2 B2). */
export const PAST_PAGE = 30;

const DAY_MS = 86_400_000;

export interface PastWorkoutsPage {
  rows: RepeatCandidate[];
  unreadable: number;
  /** Older workouts exist beyond these rows. */
  more: boolean;
}

/**
 * (Ben, 26 Oct) History: what Ben did from `from` (a Monday) to today, workouts and done activities merged, newest
 * first. `workouts`: each listed workout's row (repeat, select and delete, Save to Workouts). `olderFrom`: where
 * `Show more` reads from next; null when nothing older exists.
 */
export interface HistoryFeed {
  today: string;
  from: string;
  items: FeedItem[];
  workouts: Readonly<Record<string, RepeatCandidate>>;
  unreadable: number;
  olderFrom: string | null;
}

export interface DeletedWorkoutRow extends RepeatCandidate {
  /** Last local day it can be restored (`Gone on <date>`), in the phone's zone. */
  goneOn: string;
  deletedAtUtc: string;
}

export type HistoryWriteOutcome =
  | { ok: true; duplicate: boolean; refs: SessionRef[] }
  | {
      ok: false;
      /** `stale`: something changed since it was shown; nothing was written (DW8). `failed`: the write itself failed; retry with the same op ID. */
      kind: 'stale' | 'failed';
      message: string;
      sessionIds: string[];
    };

/** What a screen opened on a workout ID shows (§3.2). */
export type WorkoutPresence =
  | { kind: 'live' }
  /** In Recently deleted: banner `Deleted · gone on <date>` and `Restore`. */
  | { kind: 'deleted'; goneOn: string; version: number }
  /** Purged, or past its 30 days: `This workout was deleted.` and nothing else. */
  | { kind: 'gone' }
  /** Not in history and not in Recently deleted (unfinished, discarded, or its import undone): shown, with no delete or restore (review S5). */
  | { kind: 'hidden' }
  | { kind: 'missing' };

export interface HistoryServicesContext {
  repos: () => SqliteRepositories;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
  describe: (a: SessionAggregate, gyms: Map<string, string>) => Promise<RepeatCandidate>;
  /** `describe` for a page of workouts in one go (exercises and gyms read once). */
  describeMany: (ws: readonly HistoryWorkout[], gyms: Map<string, string>) => Promise<RepeatCandidate[]>;
  activeWorkout: () => Promise<SessionAggregate | null>;
}

export const DELETE_MESSAGES = {
  staleSelected: 'Changed since you selected. Check and try again.',
  staleOpened: 'Changed since you opened it. Check and try again.',
  // The spec's `Couldn’t delete. Nothing was changed.` is banned by the minimal-copy audit; the line is shortened (flagged to the PM).
  failed: 'Couldn’t delete.',
  gone: 'No longer available.',
  restoreFailed: 'Couldn’t restore.',
} as const;

function failure(error: DeletionError, staleMessage: string): Extract<HistoryWriteOutcome, { ok: false }> {
  if (error.code === 'stale') return { ok: false, kind: 'stale', message: staleMessage, sessionIds: error.sessionIds };
  return { ok: false, kind: 'failed', message: DELETE_MESSAGES.failed, sessionIds: [] };
}

export function createHistoryServices(ctx: HistoryServicesContext) {
  const repos = () => ctx.repos();
  const phoneTz = () => ctx.now().tz;

  async function run(write: () => Promise<DeletionOutcome>, staleMessage: string, failedMessage: string): Promise<HistoryWriteOutcome> {
    try {
      const out = await write();
      return out.ok ? out : failure(out.error, staleMessage);
    } catch {
      return { ok: false, kind: 'failed', message: failedMessage, sessionIds: [] };
    }
  }

  const history = {
    /**
     * `Delete workout` / `Delete (n)` (§4): one call, all-or-nothing. A retry
     * after a failure reuses the same `opId` (§3.1 Write failed).
     */
    async deleteWorkouts(items: readonly DeleteItem[], opId: string, opts: { from: 'selection' | 'opened' } = { from: 'selection' }): Promise<HistoryWriteOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, kind: 'failed', message: DELETE_MESSAGES.failed, sessionIds: [] };
      return run(
        () => repos().sessions.deleteWorkouts({ ownerId: p.id, items, opId, at: ctx.now() }),
        opts.from === 'opened' ? DELETE_MESSAGES.staleOpened : DELETE_MESSAGES.staleSelected,
        DELETE_MESSAGES.failed,
      );
    },

    /** `Restore`, `Restore (n)` and every toast's `Undo` of a delete (§4). `expectedVersion` is the deleted version. */
    async restoreWorkouts(items: readonly DeleteItem[], opId: string): Promise<HistoryWriteOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, kind: 'failed', message: DELETE_MESSAGES.restoreFailed, sessionIds: [] };
      return run(() => repos().sessions.restoreWorkouts({ ownerId: p.id, items, opId, at: ctx.now() }), DELETE_MESSAGES.gone, DELETE_MESSAGES.restoreFailed);
    },

    /**
     * Recently deleted (§2.5): newest deletion first; past 30 days never
     * listed. A row that can't be read is skipped and counted; a read that
     * fails outright throws, so the screen shows its error, never the empty
     * state (review r2 S2).
     */
    async recentlyDeleted(): Promise<{ rows: DeletedWorkoutRow[]; unreadable: number }> {
      const p = await ctx.profile();
      if (!p) return { rows: [], unreadable: 0 };
      const now = ctx.now();
      const list = await repos().sessions.listRecentlyDeleted(p.id, now.utc);
      const gyms = new Map<string, string>();
      const rows: DeletedWorkoutRow[] = [];
      let unreadable = list.unreadable;
      for (const a of list.sessions) {
        const deletion = a.session.deletion;
        if (!deletion) {
          unreadable += 1;
          continue;
        }
        rows.push({ ...(await ctx.describe(a, gyms)), goneOn: goneOnDate(deletion.purgeAfterUtc, now.tz), deletedAtUtc: deletion.at.utc });
      }
      return { rows, unreadable };
    },

    /**
     * Past workouts (§2.3): every workout in history, logged in the app or
     * imported from FitNotes (B7, DW-Q3; rows carry `source`, shown with an
     * `Imported` tag), newest first, including ones with nothing logged
     * (review r2 B1). Paged: `limit` rows from `offset`; `more` when older
     * ones exist (B2). A record that can't be read is skipped and counted.
     */
    async pastWorkouts(page: { limit?: number; offset?: number } = {}): Promise<PastWorkoutsPage> {
      const limit = page.limit ?? PAST_PAGE;
      const offset = page.offset ?? 0;
      const p = await ctx.profile();
      if (!p) return { rows: [], unreadable: 0, more: false };
      const ids = await repos().sessions.listPastWorkoutIds(p.id, limit + 1, offset);
      const gyms = new Map<string, string>();
      const rows: RepeatCandidate[] = [];
      let unreadable = 0;
      for (const id of ids.slice(0, limit)) {
        let a: SessionAggregate | null;
        try {
          a = await repos().sessions.get(id);
        } catch {
          unreadable += 1;
          continue;
        }
        if (a) rows.push(await ctx.describe(a, gyms));
      }
      return { rows, unreadable, more: ids.length > limit };
    },

    /**
     * (Ben, 26 Oct) History: workouts and activities from `from` (a Monday; default: this week and the five before),
     * newest first. Batched reads only: the workouts' stored summaries in one range read, the activities in one, and
     * one read each for what is older. A record that can't be read is skipped and counted. A read that fails outright
     * throws, so the screen shows its error, never an empty history.
     */
    async feed(req: { from?: string } = {}): Promise<HistoryFeed> {
      const p = await ctx.profile();
      const now = ctx.now();
      const nowMs = toMs(now.utc);
      const tz = p?.timezone ?? now.tz;
      const today = localDateOf(nowMs, tz);
      const from = req.from ?? historyFirstFrom(today);
      if (!p) return { today, from, items: [], workouts: {}, unreadable: 0, olderFrom: null };
      // A day either side of the range: a workout's date is in its own zone. Each is then placed by its own date.
      const fromUtc = toIso(localMidnightUtcMs(from, tz) - DAY_MS);
      const { sessions, unreadable } = await repos().sessions.listFinishedBetweenReadable(p.id, fromUtc, toIso(nowMs + DAY_MS));
      const listed: HistoryWorkout[] = [];
      let olderInRange: string | null = null;
      for (const w of sessions) {
        if (!isInHistory(w.session)) continue;
        const date = feedWorkoutOf(w, { title: '', nowMs }).localDate;
        if (date >= from) listed.push(w);
        else if (olderInRange === null || date > olderInRange) olderInRange = date;
      }
      const rows = await ctx.describeMany(listed, new Map());
      const workouts: Record<string, RepeatCandidate> = {};
      for (const r of rows) workouts[r.sessionId] = r;
      const activities = await repos().activities.listBetween(p.id, from, addDays(today, 1));
      const items = mergeFeed({
        workouts: listed.map((w) => feedWorkoutOf(w, { title: workouts[w.session.id]?.title ?? 'Workout', nowMs })),
        activities: activities.map(feedActivityOf),
      });
      const olderWorkoutUtc = await repos().sessions.latestInHistoryStartBefore(p.id, fromUtc);
      const olderActivity = await repos().activities.latestDateBefore(p.id, from);
      const olderWorkout = olderWorkoutUtc === null ? null : localDateOf(toMs(olderWorkoutUtc), tz);
      const newestOlder = [olderInRange, olderWorkout, olderActivity].filter((d): d is string => d !== null).sort().at(-1) ?? null;
      return { today, from, items, workouts, unreadable, olderFrom: historyOlderFrom(from, newestOlder === null ? null : newestOlder < from ? newestOlder : addDays(from, -1)) };
    },

    /**
     * The Past workouts footer and the Data & backup row: 0 hides the footer and reads `None`.
     * `null` when the count can't be read: the row shows without a count, never a false `None` (review r3 N6).
     */
    async recentlyDeletedCount(): Promise<number | null> {
      const p = await ctx.profile();
      if (!p) return 0;
      return repos().sessions.countRecentlyDeleted(p.id, ctx.now().utc).catch(() => null);
    },

    /** `Delete now (n)` after its alert (§3.3, DW23): purged at once, in one transaction. */
    async deleteNow(sessionIds: readonly string[], opId: string): Promise<{ ok: true; purged: number } | { ok: false; message: string }> {
      const p = await ctx.profile();
      if (!p) return { ok: false, message: DELETE_MESSAGES.failed };
      try {
        const out = await repos().sessions.purgeDeleted({ ownerId: p.id, opId, at: ctx.now(), sessionIds });
        return out.ok ? { ok: true, purged: out.purged.length } : { ok: false, message: DELETE_MESSAGES.gone };
      } catch {
        return { ok: false, message: DELETE_MESSAGES.failed };
      }
    },

    /**
     * The launch purge (§6.4): workouts past their 30 days. Silent; never while
     * a workout is unfinished. Idempotent by its daily op ID.
     */
    async purgeDue(): Promise<number> {
      const p = await ctx.profile();
      if (!p) return 0;
      if (await ctx.activeWorkout()) return 0;
      const now = ctx.now();
      // Keyed on the phone's day; a second launch that day still purges what has become due since (review N1).
      const out = await repos().sessions.purgeDeleted({ ownerId: p.id, opId: `purge:${localDateOf(toMs(now.utc), now.tz)}`, at: now });
      return out.ok && !out.duplicate ? out.purged.length : 0;
    },

    /** What a Summary / Past workout opened on `sessionId` shows (§3.2). */
    async presence(sessionId: string): Promise<WorkoutPresence> {
      const a = await repos().sessions.get(sessionId).catch(() => null);
      if (a === null) return (await repos().sessions.isPurged(sessionId).catch(() => false)) ? { kind: 'gone' } : { kind: 'missing' };
      if (isInHistory(a.session)) return { kind: 'live' };
      if (!a.session.deletion) return { kind: 'hidden' };
      if (!isRestorable(a.session, toMs(ctx.now().utc))) return { kind: 'gone' };
      return { kind: 'deleted', goneOn: goneOnDate(a.session.deletion.purgeAfterUtc, phoneTz()), version: a.session.version };
    },

    /** An import's date view after its workout was purged (its import rows went with it; review N4). */
    async importDatePurged(jobId: string, localDate: string): Promise<boolean> {
      return repos().sessions.isPurgedImportDate(jobId, localDate).catch(() => false);
    },

    /** Select in an import's workout list (§2.1, DW24): its workouts in history, oldest first. */
    async importWorkouts(jobId: string): Promise<{ rows: RepeatCandidate[]; unreadable: number }> {
      const p = await ctx.profile();
      if (!p) return { rows: [], unreadable: 0 };
      const { sessions, unreadable } = await repos().sessions.listImportJobInHistory(p.id, jobId);
      const gyms = new Map<string, string>();
      const rows: RepeatCandidate[] = [];
      for (const a of sessions) rows.push(await ctx.describe(a, gyms));
      return { rows, unreadable };
    },

    /** The confirm sheet for several (§2.4). The UI never computes the range. */
    confirmView(rows: readonly Pick<RepeatCandidate, 'startedAtUtc' | 'tz' | 'localDate' | 'source'>[]): DeleteConfirmView | null {
      return buildDeleteConfirmView(rows.map((r) => ({ startedAt: { utc: r.startedAtUtc, tz: r.tz }, source: r.source, ...(r.localDate === null ? {} : { localDate: r.localDate }) })));
    },
  };
  return history;
}

export type HistoryServices = ReturnType<typeof createHistoryServices>;
