import { describe, expect, it } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';

import {
  FEED_FILTERS,
  HISTORY_PAGE_WEEKS,
  RECENT_MAX,
  deriveWorkoutTitle,
  feedActivityOf,
  feedWhen,
  feedWorkoutOf,
  feedWorkoutTitle,
  filterFeed,
  groupFeedByWeek,
  historyFirstFrom,
  historyOlderFrom,
  mergeFeed,
  mondayOfDate,
  recentFeed,
  weekHeader,
  weekTotalText,
  type FeedActivityInput,
  type FeedWorkoutInput,
} from '../src/index';
import { BENCH, ROW, exercises, startFixture } from './session-fixture';

/**
 * (Ben, 26 Oct: "the app isn't very good at showing recent activity beyond the last couple of days") Today's Recent
 * and History: workouts and activities merged, grouped by week, worded. Today is Tue 27 Oct 2026.
 */

const TODAY = '2026-10-27';
const sp = (t: string): string => t.replaceAll(' ', ' ');
const noon = (date: string) => Date.parse(`${date}T12:00:00.000Z`);

const workout = (n: number, date: string, over: Partial<FeedWorkoutInput> = {}): FeedWorkoutInput => ({
  sessionId: `s${String(n)}`,
  localDate: date,
  sortMs: Date.parse(`${date}T07:00:00.000Z`),
  title: 'Push A',
  durationMs: 52 * 60_000,
  sets: 16,
  source: 'manual',
  ...over,
});

const run = (n: number, date: string, over: Partial<FeedActivityInput> = {}): FeedActivityInput => ({
  activityId: `a${String(n)}`,
  localDate: date,
  kind: 'run',
  status: 'done',
  distanceM: 5200,
  durationS: 28 * 60,
  effort: null,
  sortMs: noon(date),
  source: 'ben',
  linkedSessionId: null,
  ...over,
});

describe('row text', () => {
  it('weekday and date, name, one value line', () => {
    const [w, a] = mergeFeed({ workouts: [workout(1, '2026-10-25')], activities: [run(1, '2026-10-24')] });
    expect(w?.kind).toBe('workout');
    expect(sp(w?.when ?? '')).toBe('Sun 25 Oct');
    expect(w?.title).toBe('Push A');
    expect(sp(w?.value ?? '')).toBe('52 min · 16 sets');
    expect(w?.accessibilityLabel).toBe('Sunday 25 October, Push A, 52 min · 16 sets');
    expect(sp(a?.when ?? '')).toBe('Sat 24 Oct');
    expect(a?.title).toBe('Run');
    expect(sp(a?.value ?? '')).toBe('5.2 km · 28 min');
  });

  it('an imported (date-only) workout has no duration; one set is singular', () => {
    const [w] = mergeFeed({ workouts: [workout(1, '2024-05-02', { durationMs: null, sets: 1, source: 'import' })], activities: [] });
    expect(sp(w?.value ?? '')).toBe('1 set');
    expect(w?.kind === 'workout' ? w.source : null).toBe('import');
  });

  it('an hour-plus workout reads 1 h 04 min', () => {
    const [w] = mergeFeed({ workouts: [workout(1, TODAY, { durationMs: 64 * 60_000 })], activities: [] });
    expect(sp(w?.value ?? '')).toBe('1 h 04 min · 16 sets');
  });

  it('an activity: distance and time, either alone, else its effort word', () => {
    const items = mergeFeed({
      workouts: [],
      activities: [run(1, '2026-10-20', { durationS: null }), run(2, '2026-10-21', { distanceM: null, durationS: 45 * 60, kind: 'ride' }), run(3, '2026-10-22', { distanceM: null, durationS: null, effort: 'easy', kind: 'swim' })],
    });
    expect(items.map((i) => `${i.title} ${sp(i.value)}`)).toEqual(['Swim easy', 'Ride 45 min', 'Run 5.2 km']);
  });

  it('feedWhen pads nothing and uses the date as given', () => {
    expect(sp(feedWhen('2026-11-02'))).toBe('Mon 2 Nov');
  });
});

describe('merging', () => {
  it('newest first across both kinds; same day by time', () => {
    const items = mergeFeed({
      workouts: [workout(1, '2026-10-25'), workout(2, '2026-10-27', { sortMs: Date.parse('2026-10-27T18:00:00.000Z') })],
      activities: [run(1, '2026-10-27'), run(2, '2026-10-26')],
    });
    expect(items.map((i) => i.key)).toEqual(['w:s2', 'a:a1', 'a:a2', 'w:s1']);
  });

  it('a planned activity is not something Ben did: left out', () => {
    const items = mergeFeed({ workouts: [], activities: [run(1, '2026-10-26', { status: 'planned' }), run(2, '2026-10-25')] });
    expect(items.map((i) => i.key)).toEqual(['a:a2']);
  });

  it('an activity linked to a listed workout shows once, as the workout (a future Health source)', () => {
    const items = mergeFeed({
      workouts: [workout(1, '2026-10-25')],
      activities: [run(1, '2026-10-25', { kind: 'other', source: 'health', linkedSessionId: 's1' }), run(2, '2026-10-25', { source: 'health', linkedSessionId: null })],
    });
    expect(items.map((i) => i.key)).toEqual(['a:a2', 'w:s1']);
    expect(items.find((i) => i.kind === 'activity')?.source).toBe('health');
  });

  it('a link to a workout not listed (deleted) keeps the activity', () => {
    const items = mergeFeed({ workouts: [], activities: [run(1, '2026-10-25', { linkedSessionId: 'gone' })] });
    expect(items).toHaveLength(1);
  });

  it('the order is stable on ties', () => {
    const a = mergeFeed({ workouts: [], activities: [run(2, TODAY), run(1, TODAY)] });
    const b = mergeFeed({ workouts: [], activities: [run(1, TODAY), run(2, TODAY)] });
    expect(a.map((i) => i.key)).toEqual(b.map((i) => i.key));
  });
});

describe("Today's Recent", () => {
  it('the last 14 days (today included), at most 6 rows', () => {
    const workouts = Array.from({ length: 10 }, (_, i) => workout(i, `2026-10-${String(27 - i * 2).padStart(2, '0')}`));
    const items = mergeFeed({ workouts, activities: [] });
    const recent = recentFeed(items, TODAY);
    expect(recent).toHaveLength(RECENT_MAX);
    expect(recent[0]?.localDate).toBe(TODAY);
  });

  it('nothing older than 14 days; nothing in the future', () => {
    const items = mergeFeed({ workouts: [workout(1, '2026-10-13'), workout(2, '2026-10-14'), workout(3, '2026-10-28')], activities: [] });
    expect(recentFeed(items, TODAY).map((i) => i.key)).toEqual(['w:s2']);
  });

  it('empty: nothing (the screen shows no section)', () => {
    expect(recentFeed([], TODAY)).toEqual([]);
  });
});

describe('week grouping', () => {
  it('This week, Last week, then the date range; a tiny total per week', () => {
    const items = mergeFeed({
      workouts: [workout(1, TODAY), workout(2, '2026-10-25'), workout(3, '2026-10-21'), workout(4, '2026-10-14')],
      activities: [run(1, '2026-10-26'), run(2, '2026-10-19')],
    });
    const weeks = groupFeedByWeek(items, TODAY);
    expect(weeks.map((w) => sp(w.header))).toEqual(['This week', 'Last week', '12–18 Oct']);
    expect(weeks.map((w) => w.total)).toEqual(['1 workout · 1 activity', '2 workouts · 1 activity', '1 workout']);
    expect(weeks[0]?.items.map((i) => i.key)).toEqual(['w:s1', 'a:a1']);
    expect(weeks[2]?.accessibilityLabel).toBe('12–18 Oct, 1 workout');
  });

  it('a Sunday belongs to the week before (Monday-first)', () => {
    expect(mondayOfDate('2026-10-26')).toBe('2026-10-26');
    expect(mondayOfDate('2026-11-01')).toBe('2026-10-26');
    expect(mondayOfDate('2026-10-25')).toBe('2026-10-19');
  });

  it('weeks with nothing are not listed', () => {
    const weeks = groupFeedByWeek(mergeFeed({ workouts: [workout(1, TODAY), workout(2, '2026-09-01')], activities: [] }), TODAY);
    expect(weeks).toHaveLength(2);
  });

  it('headers across months and years', () => {
    expect(sp(weekHeader('2026-09-28', TODAY))).toBe('28 Sep – 4 Oct');
    expect(sp(weekHeader('2025-12-15', TODAY))).toBe('15–21 Dec 2025');
    expect(sp(weekHeader('2025-12-29', TODAY))).toBe('29 Dec 2025 – 4 Jan');
    expect(sp(weekHeader('2025-12-29', '2027-02-01'))).toBe('29 Dec 2025 – 4 Jan 2026');
  });

  it('a total of activities only', () => {
    expect(weekTotalText([{ kind: 'activity' }, { kind: 'activity' }])).toBe('2 activities');
  });
});

describe('filter', () => {
  const items = mergeFeed({ workouts: [workout(1, TODAY)], activities: [run(1, TODAY)] });
  it('All · Workouts · Activities', () => {
    expect(FEED_FILTERS.map((f) => f.label)).toEqual(['All', 'Workouts', 'Activities']);
    expect(filterFeed(items, 'all')).toHaveLength(2);
    expect(filterFeed(items, 'workouts').map((i) => i.kind)).toEqual(['workout']);
    expect(filterFeed(items, 'activities').map((i) => i.kind)).toEqual(['activity']);
  });
});

describe('paging by week', () => {
  it('the first page is this week and the five before it', () => {
    expect(HISTORY_PAGE_WEEKS).toBe(6);
    expect(historyFirstFrom(TODAY)).toBe('2026-09-21');
  });

  it('Show more: the next six weeks; nothing older: no Show more', () => {
    expect(historyOlderFrom('2026-09-21', '2026-09-20')).toBe('2026-08-10');
    expect(historyOlderFrom('2026-09-21', null)).toBeNull();
    expect(historyOlderFrom('2026-09-21', '2026-09-21')).toBeNull();
  });

  it('a long gap is skipped: the next page reaches the newest older entry', () => {
    // Nothing between 10 Aug and 21 Sep; the newest older workout is 3 Mar.
    const next = historyOlderFrom('2026-09-21', '2026-03-03');
    expect(next).toBe('2026-01-26');
    expect(next !== null && next <= mondayOfDate('2026-03-03')).toBe(true);
  });
});

describe('inputs from stored records', () => {
  function finished(over: (a: SessionAggregate) => SessionAggregate = (a) => a): SessionAggregate {
    const { state } = startFixture();
    const a: SessionAggregate = {
      ...state,
      session: { ...state.session, status: 'finished', endedAt: { utc: new Date(Date.parse(state.session.startedAt.utc) + 50 * 60_000).toISOString(), tz: state.session.startedAt.tz } },
      sets: state.sets.map((x, i) => (i < 3 ? { ...x, status: 'completed' as const } : x)),
    };
    return over(a);
  }

  it('a workout: its date in its own zone, duration, completed sets', () => {
    const a = finished();
    const w = feedWorkoutOf(a, { title: 'Push A', nowMs: Date.parse('2026-10-27T00:00:00.000Z') });
    expect(w.sessionId).toBe(a.session.id);
    expect(w.durationMs).toBe(50 * 60_000);
    expect(w.sets).toBe(3);
    // 06:00 UTC on 8 Oct is 19:00 on 8 Oct in Auckland.
    expect(w.localDate).toBe('2026-10-08');
  });

  it('an imported workout keeps its own date and shows no duration', () => {
    const a = finished((x) => ({ ...x, session: { ...x.session, source: 'import', localDate: '2024-05-02' } }));
    const w = feedWorkoutOf(a, { title: 'Workout', nowMs: 0 });
    expect(w.localDate).toBe('2024-05-02');
    expect(w.durationMs).toBeNull();
  });

  it('a workout with no end has no duration', () => {
    const a = finished((x) => ({ ...x, session: { ...x.session, endedAt: null } }));
    expect(feedWorkoutOf(a, { title: 'W', nowMs: 0 }).durationMs).toBeNull();
  });

  it('title: the stored name, else from its exercises, else Empty workout', () => {
    const a = finished();
    const info = (id: string) => exercises.get(id) ?? null;
    expect(feedWorkoutTitle({ ...a, session: { ...a.session, routineName: 'Chest day' } }, info)).toBe('Chest day');
    expect(feedWorkoutTitle({ ...a, session: { ...a.session, routineName: null }, exercises: a.exercises.filter((e) => e.exerciseId === BENCH || e.exerciseId === ROW) }, info)).toBe(deriveWorkoutTitle([BENCH, ROW].map((id) => exercises.get(id)).filter((e) => e !== undefined)));
    expect(feedWorkoutTitle({ ...a, session: { ...a.session, routineName: null }, exercises: [] }, info)).toBe('Empty workout');
  });

  it('an activity: its date, source and (none yet) link', () => {
    const f = feedActivityOf({ id: 'x', tz: 'Europe/London', source: 'ben', fields: { kind: 'run', status: 'done', date: '2026-10-25', distanceM: 10_000, durationS: null, effort: 'long' } });
    expect(f).toMatchObject({ activityId: 'x', localDate: '2026-10-25', source: 'ben', linkedSessionId: null, distanceM: 10_000 });
    expect(feedActivityOf({ id: 'y', tz: 'UTC', source: 'health', linkedSessionId: 's1', fields: { kind: 'other', status: 'done', date: '2026-10-25', distanceM: null, durationS: 3600, effort: null } }).linkedSessionId).toBe('s1');
  });
});
