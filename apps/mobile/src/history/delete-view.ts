import { localHourUtcMs, toMs } from '@fizz/domain';

import { formatCalendarDate, formatDayMonth, formatShortDate } from '../format/dates';
import { formatCount, plural } from '../format/numbers';
import type { DeletedWorkoutRow, WorkoutPresence } from '../services/history-services';
import type { RepeatCandidate } from '../services/workout-services';

/**
 * Deleting past workouts (delete-workouts.md §2, §7): every line the
 * screens show, and the select-mode rules. Pure, so the screens only lay
 * out and call `services.history`. Copy is the spec's, word for word.
 */

export type PastRow = Pick<RepeatCandidate, 'sessionId' | 'version' | 'title' | 'startedAtUtc' | 'tz' | 'localDate' | 'source' | 'gymName' | 'sets'>;

export const DELETE_COPY = {
  menuItem: 'Delete workout',
  select: 'Select',
  cancel: 'Cancel',
  selectAll: 'Select all',
  deselectAll: 'Deselect all',
  recentlyDeleted: 'Recently deleted',
  restore: 'Restore',
  undo: 'Undo',
  footnote: 'Gone 30 days after deleting.',
  footnoteInfo: 'Older backups still hold them until they rotate out.',
  empty: 'Nothing deleted in the last 30 days.',
  gone: 'This workout was deleted.',
  none: 'None',
} as const;

/** `Thu 8 Oct` (an imported, date-only workout: `Thu 2 May 2024`, never shifted by the phone's zone). */
export function workoutDateText(row: Pick<PastRow, 'startedAtUtc' | 'tz' | 'localDate'>, phoneTz: string): string {
  return row.localDate !== null ? formatCalendarDate(row.localDate) : formatShortDate(toMs(row.startedAtUtc), row.tz || phoneTz);
}

/** `Thu 8 Oct · Push A` */
export function pastRowTitle(row: PastRow, phoneTz: string): string {
  return `${workoutDateText(row, phoneTz)} · ${row.title}`;
}

/** `Main Gym · 16 sets`, or `12 sets` (imported: no gym recorded; 18 Oct, no `Imported` tag). */
export function pastRowDetail(row: PastRow): string {
  return row.source === 'import' ? plural(row.sets, 'set', 'sets') : `${row.gymName} · ${plural(row.sets, 'set', 'sets')}`;
}

/** `2 workouts couldn’t be read and aren’t listed.` (Past workouts, Recently deleted). */
export function unreadableLine(n: number): string {
  return `${plural(n, 'workout', 'workouts')} couldn’t be read and ${n === 1 ? 'isn’t' : 'aren’t'} listed.`;
}

/** `Gone on 9 Nov` (the last day it can be restored, in the phone's zone). */
export function goneOnText(goneOn: string): string {
  return `Gone on ${formatDayMonth(localHourUtcMs(goneOn, 12, 'UTC'), 'UTC')}`;
}

/** The banner on a deleted workout opened from an old link (§3.2). */
export function deletedBannerText(goneOn: string): string {
  return `Deleted · gone on ${formatDayMonth(localHourUtcMs(goneOn, 12, 'UTC'), 'UTC')}`;
}

/** `Push A · Thu 8 Oct deleted` / `3 workouts deleted`. */
export function deletedToastText(rows: readonly PastRow[], phoneTz: string): string {
  const only = rows.length === 1 ? rows[0] : undefined;
  return only ? `${only.title} · ${workoutDateText(only, phoneTz)} deleted` : `${plural(rows.length, 'workout', 'workouts')} deleted`;
}

/** `Push A · Thu 8 Oct restored` / `2 workouts restored`. */
export function restoredToastText(rows: readonly PastRow[], phoneTz: string): string {
  const only = rows.length === 1 ? rows[0] : undefined;
  return only ? `${only.title} · ${workoutDateText(only, phoneTz)} restored` : `${plural(rows.length, 'workout', 'workouts')} restored`;
}

/** Select mode's title: `Select workouts` / `3 selected`. */
export function selectTitle(selected: number): string {
  return selected === 0 ? 'Select workouts' : `${formatCount(selected)} selected`;
}

/** `Select all` until everything loaded is ticked, then `Deselect all`. */
export function selectAllLabel(selected: ReadonlySet<string>, rows: readonly Pick<PastRow, 'sessionId'>[]): string {
  return rows.length > 0 && rows.every((r) => selected.has(r.sessionId)) ? DELETE_COPY.deselectAll : DELETE_COPY.selectAll;
}

/** Tapping `Select all` / `Deselect all`. */
export function toggleAll(selected: ReadonlySet<string>, rows: readonly Pick<PastRow, 'sessionId'>[]): Set<string> {
  return selectAllLabel(selected, rows) === DELETE_COPY.deselectAll ? new Set() : new Set(rows.map((r) => r.sessionId));
}

export function toggleOne(selected: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

/**
 * After a stale refusal the list reloads; the selection keeps only IDs that
 * are still listed (still finished) (§3.1 Stale).
 */
export function keepSelection(selected: ReadonlySet<string>, rows: readonly Pick<PastRow, 'sessionId'>[]): Set<string> {
  const listed = new Set(rows.map((r) => r.sessionId));
  return new Set([...selected].filter((id) => listed.has(id)));
}

/** The toolbar: `Delete (3)`, disabled at 0. */
export function deleteToolbarLabel(selected: number): string {
  return `Delete (${formatCount(selected)})`;
}

/** Recently deleted's toolbar: `Restore (2)` · `Delete now (2)`. */
export function restoreToolbarLabels(selected: number): { restore: string; deleteNow: string } {
  return { restore: `Restore (${formatCount(selected)})`, deleteNow: `Delete now (${formatCount(selected)})` };
}

/** `Delete now` asks once (§3.3, DW23). */
export function deleteNowAlert(count: number): { title: string; message: string; confirm: string } {
  return { title: `Delete ${plural(count, 'workout', 'workouts')} now?`, message: 'This can’t be undone.', confirm: 'Delete now' };
}

/** `Recently deleted (3) ›` footer in Past workouts, only when there is something. */
export function recentlyDeletedFooter(count: number | null): string | null {
  // `null`: the count couldn't be read, so the row shows without one rather than hiding (review r3 N6).
  if (count === null) return DELETE_COPY.recentlyDeleted;
  return count > 0 ? `${DELETE_COPY.recentlyDeleted} (${formatCount(count)})` : null;
}

/** Data & backup's always-present row: value `3` or `None` (not tappable at 0); no value when the count couldn't be read. */
export function recentlyDeletedDataRow(count: number | null): { title: string; value: string; opens: boolean } {
  if (count === null) return { title: DELETE_COPY.recentlyDeleted, value: '', opens: true };
  return { title: DELETE_COPY.recentlyDeleted, value: count > 0 ? formatCount(count) : DELETE_COPY.none, opens: count > 0 };
}

/** VoiceOver custom actions on a row (§4): `Delete` in Past workouts, `Restore` in Recently deleted. */
export function rowCustomActions(kind: 'past' | 'deleted'): { name: string; label: string }[] {
  return kind === 'past' ? [{ name: 'delete', label: 'Delete' }] : [{ name: 'restore', label: DELETE_COPY.restore }];
}

/** VoiceOver label of a select-mode row: `Thu 8 Oct, Push A, selected`. */
export function selectRowLabel(row: PastRow, phoneTz: string, selected: boolean): string {
  return `${workoutDateText(row, phoneTz)}, ${row.title}${selected ? ', selected' : ''}`;
}

/** A Recently deleted row's three lines (§2.5). */
export function deletedRowLines(row: DeletedWorkoutRow, phoneTz: string): { title: string; detail: string; gone: string } {
  return { title: pastRowTitle(row, phoneTz), detail: pastRowDetail(row), gone: goneOnText(row.goneOn) };
}

/** Summary's `⋯` (its one item is Delete) only on a workout in history (review r2 N2, r3 N5). */
export function summaryCanDelete(presence: WorkoutPresence): boolean {
  return presence.kind === 'live';
}

/** Where a Past workouts row opens: one with nothing logged opens its Summary, others Repeat (review r2 B1, r3 N5). */
export function pastRowOpens(row: Pick<RepeatCandidate, 'sets'>): 'summary' | 'repeat' {
  return row.sets === 0 ? 'summary' : 'repeat';
}

/**
 * Recently deleted's list state (review r2 S2, r3 N3, N5): the empty line only when nothing is deleted
 * and nothing is unreadable; `Select`, the toolbar and the footnote only over rows.
 */
export function recentlyDeletedListView(rowCount: number, unreadable: number, selecting: boolean): { empty: boolean; select: boolean; selecting: boolean; footnote: boolean } {
  const any = rowCount > 0;
  return { empty: !any && unreadable === 0, select: any, selecting: selecting && any, footnote: any };
}
