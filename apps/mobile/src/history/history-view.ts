import { filterFeed, groupFeedByWeek, type FeedFilter, type FeedItem, type FeedWeek } from '@fizz/domain';

import type { HistoryFeed } from '../services/history-services';
import type { RepeatCandidate } from '../services/workout-services';
import { pastRowTitle } from './delete-view';

/**
 * History (docs/design/history.md; Ben, 26 Oct): what the screen lays out, pure. The service reads the page; the
 * domain merges, groups and words it; this picks what is shown for the filter and select mode.
 */

export interface HistoryView {
  weeks: FeedWeek[];
  /** Select mode lists workouts only (an activity is deleted from its own sheet). */
  selectable: RepeatCandidate[];
  /** Nothing at all to show and nothing older: the one short line. */
  empty: string | null;
  /** `Show more`: older weeks exist. */
  more: boolean;
}

export const HISTORY_EMPTY: Readonly<Record<FeedFilter, string>> = {
  all: 'Nothing logged yet.',
  workouts: 'No workouts yet.',
  activities: 'No activities yet.',
};

export function historyView(feed: HistoryFeed, filter: FeedFilter, selecting: boolean): HistoryView {
  const items = filterFeed(feed.items, selecting ? 'workouts' : filter).filter((i) => i.kind !== 'workout' || feed.workouts[i.sessionId] !== undefined);
  return {
    weeks: groupFeedByWeek(items, feed.today),
    selectable: historySelectable(feed),
    empty: items.length === 0 && feed.olderFrom === null ? HISTORY_EMPTY[selecting ? 'workouts' : filter] : null,
    more: feed.olderFrom !== null,
  };
}

/** Every listed workout's row, newest first: what select mode ticks (`Select all` covers only what is loaded). */
export function historySelectable(feed: HistoryFeed): RepeatCandidate[] {
  return feed.items.flatMap((i) => (i.kind === 'workout' ? [feed.workouts[i.sessionId]].filter((r): r is RepeatCandidate => r !== undefined) : []));
}

/** A row's title: `Sun 25 Oct · Push A` (a workout as Past workouts titled it), `Sat 24 Oct · Run`. */
export function historyRowTitle(item: FeedItem, row: RepeatCandidate | undefined, phoneTz: string): string {
  return item.kind === 'workout' && row !== undefined ? pastRowTitle(row, phoneTz) : `${item.when} · ${item.title}`;
}

/** A workout row's value line: `Main Gym · 52 min · 16 sets`; imported (no gym recorded): `16 sets`. */
export function historyWorkoutLine(item: FeedItem, row: RepeatCandidate): string {
  return row.source === 'import' ? item.value : `${row.gymName} · ${item.value}`;
}
