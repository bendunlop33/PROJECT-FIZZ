import type { CheckIn, CheckInReason } from '@fizz/schemas';

import type { AppServices } from '../services/app-services';

/** What's up? reasons and note, as one write. */
export interface ReasonsPatch {
  reasons: readonly CheckInReason[];
  note: string | null;
}

/**
 * What's up? `Done` (check-in.md §2.3): the reasons and note it saved, and the
 * opId it used. Pure.
 */
export interface ReasonsSubmission {
  key: string;
  opId: string;
}

/**
 * The opId for a `Done`. A retry of the same reasons and note reuses the
 * last one (a duplicate, rule 5); anything else, including going back to an
 * earlier choice after Back from the pain step, is a new write.
 */
export function reasonsSubmission(prev: ReasonsSubmission | null, patch: ReasonsPatch, newId: () => string): ReasonsSubmission {
  const key = JSON.stringify([[...patch.reasons].sort(), patch.note]);
  return prev?.key === key ? prev : { key, opId: newId() };
}

/** Where `Done` goes, from the saved check-in (never the sheet's unsaved state). */
export function afterReasonsStep(saved: Pick<CheckIn, 'reasons'>): 'pain' | 'ill' | 'start' {
  if (saved.reasons.includes('pain')) return 'pain';
  if (saved.reasons.includes('ill')) return 'ill';
  return 'start';
}

/**
 * The sheet's reasons writes so far: the last submission, and the reasons and
 * note the check-in had before this sheet's first `Done` (what `Skip` goes
 * back to). Both null until a `Done`.
 */
export interface ReasonsSheetState {
  submission: ReasonsSubmission | null;
  before: ReasonsPatch | null;
}

export const NO_REASONS_WRITTEN: ReasonsSheetState = { submission: null, before: null };

type CheckInsApi = Pick<AppServices['checkIns'], 'update' | 'get'>;

/** A reasons write: the saved check-in, or the error and (when stale) the latest check-in to show. */
export type ReasonsWrite = ({ ok: true; checkIn: CheckIn; duplicate: boolean } | { ok: false; message: string; stale: boolean; latest: CheckIn | null }) & { state: ReasonsSheetState };

async function write(checkIns: CheckInsApi, record: CheckIn, patch: ReasonsPatch, state: ReasonsSheetState, newId: () => string): Promise<ReasonsWrite> {
  const submission = reasonsSubmission(state.submission, patch, newId);
  const next: ReasonsSheetState = { submission, before: state.before ?? { reasons: [...record.reasons], note: record.note ?? null } };
  const r = await checkIns.update(record.id, { reasons: [...patch.reasons], note: patch.note }, record.version, submission.opId);
  if (r.ok) return { ok: true, checkIn: r.checkIn, duplicate: r.duplicate, state: next };
  const stale = r.stale === true;
  return { ok: false, message: r.message, stale, latest: stale ? await checkIns.get(record.id) : null, state: next };
}

/**
 * What's up? `Done`: saves the reasons and note (a new opId per distinct
 * payload) and says where to go next, from what was saved.
 */
export async function submitReasons(
  checkIns: CheckInsApi,
  record: CheckIn,
  patch: ReasonsPatch,
  state: ReasonsSheetState,
  newId: () => string,
): Promise<ReasonsWrite & { next?: 'pain' | 'ill' | 'start' }> {
  const r = await write(checkIns, record, patch, state, newId);
  return r.ok ? { ...r, next: afterReasonsStep(r.checkIn) } : r;
}

/**
 * `Skip` after a `Done` (Back from the pain step, check-in.md §5): starts with
 * the score only, so the reasons and note this sheet saved are put back to
 * what the check-in had before its first `Done`, as a new write. With no
 * `Done` yet, nothing is written.
 */
export async function skipReasons(checkIns: CheckInsApi, record: CheckIn, state: ReasonsSheetState, newId: () => string): Promise<ReasonsWrite> {
  if (state.before === null) return { ok: true, checkIn: record, duplicate: false, state };
  return write(checkIns, record, state.before, state, newId);
}
