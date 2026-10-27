import {
  coachTargetRows,
  isFromRoutine,
  libraryChangesView,
  liveRoutines,
  nextTargetFitsSource,
  nextTargetSourceBasis,
  LIBRARY_CHANGES_COPY,
  type ChangeTap,
  type LibraryChangeRow,
  type LibraryChangesView,
  type NextTimeChangeInput,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { NextSessionTargetRecord, UserProfile } from '@fizz/schemas';

import type { CoachService } from '../coach/coach-service';
import { runChangeTap } from '../reviews/change-taps';
import type { WeeklyReviewService } from '../reviews/weekly-review-service';

/**
 * Library › Plan › Changes (redesign 27 Oct, D2 and D5): the coach's changes to come, read once for the Plan row's
 * `✦ 3 changes · next week`, the Changes screen, the dots on a plan day's changed numbers and a saved workout's `✦1`.
 *
 * - **Next time**: the coach's saved next-session targets (D21) of each saved workout's and plan day's last workout
 *   (the targets the workout's next start uses), and of the newest workout that came from none (an ad-hoc workout's
 *   targets follow the exercise). A row that no longer fits its workout (a set corrected since) isn't shown.
 * - **Weekly review**: the newest review's changes (`reviews.changesNow`, moved here from Progress).
 *
 * Taps go to the existing writes: a next-time row's Undo / Apply / Skip / Redo is `coach.tapNextTarget` against the
 * row's version as read (rule 5; a newer version is refused, never overwritten); a weekly change's is the review's own
 * `applyProposal` / `skipProposal` / `undoProposal` / `redoProposal` (`runChangeTap`). Local only: works offline, no
 * coach call (rule 1). Nothing here decides a change (rule 3: the coach's records and the review's do).
 */

export interface LibraryChangesDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  reviews: Pick<WeeklyReviewService, 'changesNow' | 'applyProposal' | 'skipProposal' | 'undoProposal' | 'redoProposal'>;
  coach: Pick<CoachService, 'tapNextTarget'>;
}

export interface LibraryChangesData {
  view: LibraryChangesView;
  /** The stored next-time rows the view was read from (their versions are what a tap writes against). */
  records: Readonly<Record<string, NextSessionTargetRecord>>;
}

export type LibraryChangeOutcome = { ok: true; text: string | null } | { ok: false; message: string };

export const LIBRARY_CHANGES_SERVICE_COPY = {
  changedSince: 'Out of date',
  used: 'Already used',
  failed: 'Couldn’t change that. Try again.',
} as const;

/** Enough finished workouts to find each workout's last one (small rows, no decode). */
const REF_LIMIT = 400;

const NEXT_TAP: Readonly<Record<ChangeTap, 'undo' | 'apply' | 'not_now' | 'use_coach'>> = { undo: 'undo', apply: 'apply', skip: 'not_now', redo: 'use_coach' };

export function createLibraryChangesService(deps: LibraryChangesDeps) {
  const repos = () => deps.store().repos;

  /** Each source workout (a routine's last one, and the newest ad-hoc one) with the routine its changes land on. */
  async function sources(ownerId: string): Promise<{ sessionId: string; routineId: string | null; routineName: string | null }[]> {
    const routines = liveRoutines(await repos().routines.listByOwner(ownerId));
    const refs = [...(await repos().sessions.listFinishedRefs(ownerId, REF_LIMIT))].sort((a, b) => (a.startedAtUtc < b.startedAtUtc ? 1 : a.startedAtUtc > b.startedAtUtc ? -1 : 0));
    const out: { sessionId: string; routineId: string | null; routineName: string | null }[] = [];
    const taken = new Set<string>();
    for (const r of routines) {
      const last = refs.find((f) => isFromRoutine(f, r));
      if (last === undefined || taken.has(last.sessionId)) continue;
      taken.add(last.sessionId);
      out.push({ sessionId: last.sessionId, routineId: r.id, routineName: r.name });
    }
    // The newest workout overall, when it came from no saved workout: its next-time changes follow the exercise.
    const newest = refs[0];
    if (newest !== undefined && !taken.has(newest.sessionId) && !routines.some((r) => isFromRoutine(newest, r))) out.push({ sessionId: newest.sessionId, routineId: null, routineName: null });
    return out;
  }

  async function nextTimeInputs(ownerId: string): Promise<{ inputs: NextTimeChangeInput[]; records: Record<string, NextSessionTargetRecord> }> {
    const inputs: NextTimeChangeInput[] = [];
    const records: Record<string, NextSessionTargetRecord> = {};
    for (const s of await sources(ownerId)) {
      const rows = coachTargetRows(await repos().coach.listNextTargets(ownerId, s.sessionId).catch(() => [] as NextSessionTargetRecord[]));
      if (rows.length === 0) continue;
      const source = await repos()
        .sessions.get(s.sessionId)
        .catch(() => null);
      const fits = source === null ? null : { version: source.session.version, basis: nextTargetSourceBasis(source) };
      for (const row of rows) {
        records[row.id] = row;
        inputs.push({ row, routineId: s.routineId, routineName: s.routineName, stale: fits === null || !nextTargetFitsSource(row, fits) });
      }
    }
    return { inputs, records };
  }

  return {
    /** The changes to come. Null with no profile; a failed read of either part shows the other (never invented). */
    async read(): Promise<LibraryChangesData | null> {
      const p = await deps.profile();
      if (p === null) return null;
      const [next, weekly] = await Promise.all([nextTimeInputs(p.id).catch(() => ({ inputs: [], records: {} })), deps.reviews.changesNow().catch(() => null)]);
      const view = libraryChangesView({
        nextTime: next.inputs,
        weekly: weekly === null || weekly.view === null ? null : { view: weekly.view, proposals: weekly.proposals },
        // An older week's review (not next week's) is under Earlier changes too.
        hasEarlier: (weekly?.hasPast ?? false) || (weekly?.view != null && !weekly.view.current),
      });
      return { view, records: next.records };
    },

    /**
     * Ben's tap on a change: Undo, Redo, Apply or Skip, against what he saw (`data`, rule 5). One op ID per tap (a
     * retried tap replays). The outcome's `text` is the toast (`Bench press back to 82.5 kg` after an Undo).
     */
    async tap(data: LibraryChangesData, row: LibraryChangeRow, tap: ChangeTap, opId: string): Promise<LibraryChangeOutcome> {
      if (!row.taps.includes(tap)) return { ok: false, message: LIBRARY_CHANGES_SERVICE_COPY.changedSince };
      const ref = row.ref;
      if (ref.kind === 'weekly') {
        const r = await runChangeTap(deps.reviews, tap, { reviewId: ref.reviewId, proposalId: ref.proposalId, opId }).catch(() => null);
        if (r === null) return { ok: false, message: LIBRARY_CHANGES_SERVICE_COPY.failed };
        return r.ok ? { ok: true, text: tap === 'undo' ? row.undoneText : null } : { ok: false, message: r.message };
      }
      const record = data.records[ref.rowId];
      if (record === undefined) return { ok: false, message: LIBRARY_CHANGES_SERVICE_COPY.changedSince };
      const r = await deps.coach.tapNextTarget(record, NEXT_TAP[tap], opId).catch(() => null);
      if (r === null) return { ok: false, message: LIBRARY_CHANGES_SERVICE_COPY.failed };
      if (r.status === 'not_possible') return { ok: false, message: r.reason === 'used' ? LIBRARY_CHANGES_SERVICE_COPY.used : LIBRARY_CHANGES_SERVICE_COPY.changedSince };
      return { ok: true, text: tap === 'undo' ? row.undoneText : tap === 'skip' ? LIBRARY_CHANGES_COPY.skipped : null };
    },
  };
}

export type LibraryChangesService = ReturnType<typeof createLibraryChangesService>;
