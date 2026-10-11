import { formatLastDone } from '@fizz/domain';
import type { ZonedTimestamp } from '@fizz/schemas';

import type { OverviewData, OverviewStartOf, OverviewTarget, SessionList, SessionPickerRow } from '../services/workout-services';

/**
 * The session picker's view (session-picker.md §2, §4.5, §6): words and
 * which rows show where. Pure; the service groups, orders and recommends,
 * and these only format.
 */

export const SESSION_PICKER_COPY = {
  title: 'Choose session',
  close: 'Close',
  upNext: 'Up next',
  older: 'Older',
  edited: 'Edited',
  new: 'New',
  loadFailed: 'Couldn’t load sessions.',
  tryAgain: 'Try again',
  sessions: 'Sessions',
  allSessions: 'All sessions',
  change: 'Change',
  changeSession: 'Change session',
  switchFailed: 'Couldn’t load that session.',
  emptyWorkout: 'Empty workout',
  pastWorkouts: 'Past workouts',
  saveAsRoutine: 'Save as routine',
  savedAsRoutine: 'Saved as routine',
} as const;

const exercisesText = (n: number): string => `${String(n)} ${n === 1 ? 'exercise' : 'exercises'}`;

/** `6 days ago`, `14 Aug`, or `New` for a routine never done (Today's `Sessions` rows). */
export function lastDoneText(row: Pick<SessionPickerRow, 'lastDone'>, now: ZonedTimestamp): string {
  return row.lastDone === null ? SESSION_PICKER_COPY.new : formatLastDone(row.lastDone, now);
}

/** `6 days ago · 5 exercises · Edited`, or `New · 4 exercises` for a routine never done. Actuals only. */
export function pickerRowDetail(row: Pick<SessionPickerRow, 'lastDone' | 'exerciseCount' | 'edited'>, now: ZonedTimestamp): string {
  return [lastDoneText(row, now), exercisesText(row.exerciseCount), ...(row.edited ? [SESSION_PICKER_COPY.edited] : [])].join(' · ');
}

/** VoiceOver (§4.5): "Legs, up next, last done 6 days ago, 5 exercises, edited today, selected." */
export function pickerRowLabel(row: Pick<SessionPickerRow, 'label' | 'lastDone' | 'exerciseCount' | 'edited' | 'recommended'>, now: ZonedTimestamp, selected: boolean): string {
  const parts = [
    row.label,
    ...(row.recommended ? ['up next'] : []),
    row.lastDone === null ? 'new, not done yet' : `last done ${formatLastDone(row.lastDone, now)}`,
    exercisesText(row.exerciseCount),
    ...(row.edited ? ['edited today'] : []),
    ...(selected ? ['selected'] : []),
  ];
  return parts.join(', ');
}

/** The row the overview is showing (its `✓`): the same routine, or the same source workout. */
export function isShownRow(row: Pick<SessionPickerRow, 'routineId' | 'sourceSessionId'>, startOf: OverviewStartOf | null): boolean {
  if (startOf === null) return false;
  if (startOf.routineOf !== undefined) return row.routineId === startOf.routineOf;
  return row.routineId === null && row.sourceSessionId === startOf.nextOf;
}

/** Every row, in picker order (`current`, then `OLDER`). */
export function allRows(list: SessionList): SessionPickerRow[] {
  return [...list.current, ...list.older];
}

/** `Change` and `SESSIONS` show only with 2 or more session types (§2.1, §5). */
export function hasChoice(list: SessionList | null): boolean {
  return list !== null && allRows(list).length >= 2;
}

export const TODAY_SESSIONS_CAP = 3;

/**
 * Today's `SESSIONS` (§2.1): up to 3 rows in picker order, without Up next
 * (it is the hero), then `All sessions ›` when more exist. Done today: Up
 * next is included, first (§5). With one type that is Up next there is
 * nothing to list; one that isn't (a routine never done, while Up next is
 * an unnamed workout or First workout) is still listed, so it stays reachable.
 */
export function todaySessions(list: SessionList | null, opts: { includeUpNext: boolean }): { rows: SessionPickerRow[]; more: boolean } {
  if (list === null || (!hasChoice(list) && list.recommendedKey !== null)) return { rows: [], more: false };
  const pool = allRows(list).filter((r) => opts.includeUpNext || !r.recommended);
  return { rows: pool.slice(0, TODAY_SESSIONS_CAP), more: pool.length > TODAY_SESSIONS_CAP };
}

/**
 * An in-place switch on the overview (§4.2, review r2 S1): read the picked
 * session first, with the same gym and tapped check-in as the page (SP11),
 * and show it only when it loads. A session that can't be shown here (its
 * routine deleted, its source gone, or it can't be planned at this gym)
 * leaves the current page up: Ben is never left on a dead page.
 */
export async function switchSession(ports: { load: (target: OverviewTarget) => Promise<OverviewData | null>; show: (target: OverviewTarget) => void }, next: OverviewTarget): Promise<'switched' | 'failed'> {
  const page = await ports.load(next).catch(() => null);
  if (page === null) return 'failed';
  ports.show(next);
  return 'switched';
}
