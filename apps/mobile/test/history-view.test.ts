import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mergeFeed, type FeedActivityInput, type FeedWorkoutInput } from '@fizz/domain';

import { HISTORY_EMPTY, historyRowTitle, historySelectable, historyView, historyWorkoutLine } from '../src/history/history-view';
import type { HistoryFeed } from '../src/services/history-services';
import type { RepeatCandidate } from '../src/services/workout-services';

/** History's layout choices (docs/design/history.md; Ben, 26 Oct), pure. Today is Tue 27 Oct 2026 in London. */

const TODAY = '2026-10-27';
const TZ = 'Europe/London';
const sp = (t: string): string => t.replaceAll(' ', ' ');

const w = (id: string, date: string): FeedWorkoutInput => ({ sessionId: id, localDate: date, sortMs: Date.parse(`${date}T17:00:00.000Z`), title: 'Push A', durationMs: 52 * 60_000, sets: 16, source: 'manual' });
const a = (id: string, date: string): FeedActivityInput => ({ activityId: id, localDate: date, kind: 'run', status: 'done', distanceM: 5200, durationS: 1680, effort: null, sortMs: Date.parse(`${date}T12:00:00.000Z`), source: 'ben', linkedSessionId: null });
const row = (id: string, date: string, over: Partial<RepeatCandidate> = {}): RepeatCandidate => ({ sessionId: id, version: 3, title: 'Push A', startedAtUtc: `${date}T17:00:00.000Z`, tz: TZ, localDate: null, source: 'manual', gymId: 'g', gymName: 'Main Gym', exerciseNames: ['Bench press'], sets: 16, ...over });

function feed(over: Partial<HistoryFeed> = {}): HistoryFeed {
  const items = mergeFeed({ workouts: [w('s1', '2026-10-26'), w('s2', '2026-10-14')], activities: [a('a1', '2026-10-25')] });
  return { today: TODAY, from: '2026-09-21', items, workouts: { s1: row('s1', '2026-10-26'), s2: row('s2', '2026-10-14') }, unreadable: 0, olderFrom: null, ...over };
}

describe('History view', () => {
  it('weeks newest first with their totals; All lists both kinds', () => {
    const v = historyView(feed(), 'all', false);
    expect(v.weeks.map((x) => `${sp(x.header)} | ${x.total}`)).toEqual(['This week | 1 workout', 'Last week | 1 activity', '12–18 Oct | 1 workout']);
    expect(v.empty).toBeNull();
    expect(v.more).toBe(false);
  });

  it('the filter: Workouts, Activities', () => {
    expect(historyView(feed(), 'workouts', false).weeks.flatMap((x) => x.items.map((i) => i.kind))).toEqual(['workout', 'workout']);
    expect(historyView(feed(), 'activities', false).weeks.flatMap((x) => x.items.map((i) => i.kind))).toEqual(['activity']);
  });

  it('select mode lists workouts only, whatever the filter; Select all covers every loaded workout', () => {
    const v = historyView(feed(), 'activities', true);
    expect(v.weeks.flatMap((x) => x.items.map((i) => i.kind))).toEqual(['workout', 'workout']);
    expect(historySelectable(feed()).map((r) => r.sessionId)).toEqual(['s1', 's2']);
  });

  it('empty: one short line, only when nothing older exists either', () => {
    const none = feed({ items: [], workouts: {} });
    expect(historyView(none, 'all', false).empty).toBe(HISTORY_EMPTY.all);
    expect(historyView({ ...none, olderFrom: '2026-08-10' }, 'all', false)).toMatchObject({ empty: null, more: true, weeks: [] });
    expect(historyView(feed(), 'activities', false).empty).toBeNull();
    expect(historyView(feed({ items: feed().items.filter((i) => i.kind === 'workout') }), 'activities', false).empty).toBe(HISTORY_EMPTY.activities);
  });

  it('a workout row whose details could not be described is not shown (never a blank row)', () => {
    const v = historyView(feed({ workouts: { s1: row('s1', '2026-10-26') } }), 'all', false);
    expect(v.weeks.flatMap((x) => x.items.map((i) => i.key))).toEqual(['w:s1', 'a:a1']);
  });

  it('row titles and the workout value line (gym, time, sets; imported: no gym)', () => {
    const items = feed().items;
    const wi = items[0];
    const ai = items[1];
    if (wi === undefined || ai === undefined) throw new Error('items');
    expect(sp(historyRowTitle(wi, row('s1', '2026-10-26'), TZ))).toBe('Mon 26 Oct · Push A');
    expect(sp(historyRowTitle(ai, undefined, TZ))).toBe('Sun 25 Oct · Run');
    expect(sp(historyWorkoutLine(wi, row('s1', '2026-10-26')))).toBe('Main Gym · 52 min · 16 sets');
    expect(sp(historyWorkoutLine(wi, row('s1', '2026-10-26', { source: 'import' })))).toBe('52 min · 16 sets');
  });
});

describe('screens (source checks)', () => {
  const read = (...p: string[]) => readFileSync(join(import.meta.dirname, '../src', ...p), 'utf8');
  it('Today shows Recent (the last three) only with something in it; History moved to Progress (redesign v3 §A6)', () => {
    const today = read('screens', 'TodayScreen.tsx');
    expect(today).toContain('recentRows.length > 0 ? (');
    expect(today).toContain('todayRecentRows(session.recent)');
    expect(today).not.toContain("navigation.navigate('History')");
    const parts = read('screens', 'today', 'TodaySession.tsx');
    expect(parts).toContain('accessibilityLabel={r.accessibilityLabel}');
    expect(parts).toMatch(/numeric[\s\S]*\{r\.line\}/);
  });

  it('History keeps every Past workouts capability', () => {
    const src = read('screens', 'history', 'HistoryScreen.tsx');
    for (const s of ['useSelectDelete(', 'rowCustomActions(', 'save.open(', 'LogPastWorkoutSheet', "navigate('RecentlyDeleted')", "navigate('Repeat'", 'ActivitySheet', 'Segmented', 'HISTORY_COPY.showMore']) expect(src, s).toContain(s);
  });
});
