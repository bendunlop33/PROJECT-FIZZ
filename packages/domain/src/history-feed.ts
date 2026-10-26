import type { ActivityEffort, ActivityKind, Exercise, HealthActivityProvenance, SessionAggregate } from '@fizz/schemas';
import { ACTIVITY_WORD, EFFORT_WORD, activityDistanceText, activityDurationText, activitySortMs } from './activity';
import { addDays, localDateOf, weekdayIndexOfDate } from './calendar';
import { NBSP, formatMinutes, formatNumber } from './display';
import { deriveWorkoutTitle, storedWorkoutName } from './session/first-run';
import { workoutDurationMs } from './session/view';
import { toMs } from './time';
import { healthSourceText } from './health';

/**
 * (Ben, 26 Oct: "at the moment the app isn't very good at showing recent activity beyond the last couple of days")
 * What Ben did, workouts and activities in one list, newest first: Today's `Recent` (the last 14 days) and the History
 * screen (grouped by week). docs/design/history.md.
 *
 * Pure. The services read stored history summaries and activities in batched reads and pass them in as plain facts;
 * this module merges, groups, filters and words them. Only what was done: a planned activity is not something Ben did
 * (it shows on Today's strip and the calendar as planned, never here as done; rule 6).
 *
 * Apple Health (ADR 0035) slots in through the activities model: its rows carry `source: 'health'` and their source
 * name; a Health workout linked to a gym workout isn't listed (or is left out by `linkedSessionId`) and the workout
 * carries a small linked mark; an unlinked Health strength workout on a gym day offers a one-tap `Link`.
 */

/** A workout in history, as the feed reads it. */
export interface FeedWorkoutInput {
  sessionId: string;
  /** Its local date: an imported workout's own date, else its start's date in its own zone. */
  localDate: string;
  /** Its start (an imported, date-only workout: its noon anchor). */
  sortMs: number;
  title: string;
  /** Null: a date-only (imported) workout, or one with no end; no duration is shown (rule 6). */
  durationMs: number | null;
  /** Completed sets, as Past workouts counts them (a two-sided pair counts once). */
  sets: number;
  source: 'manual' | 'import';
  /** (ADR 0035) A Health workout is linked to it: its source (`Garmin`), for the row's small linked mark. */
  linkedSource?: string | null;
}

/** An activity (a run, a ride), as the feed reads it. */
export interface FeedActivityInput {
  activityId: string;
  localDate: string;
  kind: ActivityKind;
  status: 'done' | 'planned';
  distanceM: number | null;
  durationS: number | null;
  effort: ActivityEffort | null;
  sortMs: number;
  /** Who or what recorded it (`ben`, `coach`; a read-only source such as `health` later). */
  source: string;
  /** The gym workout this activity is the same session as; it then shows once, as the workout. */
  linkedSessionId: string | null;
  /** (ADR 0035) Read from Apple Health: its own title (`Strength`, `Walk`) and source (`Garmin`). */
  title?: string;
  fromHealth?: string;
  /** A Health strength (or `other`) workout that can be linked to a gym workout of the same day (`Link` chip). */
  linkable?: boolean;
}

interface FeedItemBase {
  /** `w:<id>` / `a:<id>`: unique across both kinds. */
  key: string;
  localDate: string;
  sortMs: number;
  /** `Sat 25 Oct`. */
  when: string;
  /** `Push A`, `Run`. */
  title: string;
  /** `52 min · 16 sets`, `5.2 km · 28 min`. */
  value: string;
  /** VoiceOver: `Saturday 25 October, Push A, 52 min · 16 sets`. */
  accessibilityLabel: string;
}

export type FeedItem =
  | (FeedItemBase & { kind: 'workout'; sessionId: string; source: 'manual' | 'import'; /** (ADR 0035) Linked Health workout's source: the row's ♥ mark. */ linkedSource?: string })
  | (FeedItemBase & {
      kind: 'activity';
      activityId: string;
      source: string;
      /** (ADR 0035) Read from Apple Health: its source. */
      fromHealth?: string;
      /** (Ben, 27 Oct) The one-tap `Link` chip: the same day's gym workout nearest in time, not linked yet. */
      linkTo?: { sessionId: string; title: string };
    });

export type FeedFilter = 'all' | 'workouts' | 'activities';

export const FEED_FILTERS: readonly { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'activities', label: 'Activities' },
];

export const HISTORY_COPY = {
  title: 'History',
  allHistory: 'All history ›',
  allHistoryLabel: 'All history',
  recent: 'Recent',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  showMore: 'Show more',
  filter: 'Show',
} as const;

/** Today's Recent: this many days back, today included. */
export const RECENT_DAYS = 14;
/** Today's Recent: at most this many rows, then `All history ›`. */
export const RECENT_MAX = 6;
/** History loads this many weeks at a time; `Show more` loads older ones. */
export const HISTORY_PAGE_WEEKS = 6;

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

const dayOf = (date: string) => Number(date.slice(8, 10));
const monthOf = (date: string) => Number(date.slice(5, 7)) - 1;
const yearOf = (date: string) => date.slice(0, 4);

function count(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** The Monday of a local date's week. */
export function mondayOfDate(date: string): string {
  return addDays(date, -weekdayIndexOfDate(date));
}

/** `Sat 25 Oct`. */
export function feedWhen(date: string): string {
  return `${WEEKDAY[weekdayIndexOfDate(date)] ?? ''} ${String(dayOf(date))}${NBSP}${MONTH[monthOf(date)] ?? ''}`;
}

/** `Saturday 25 October` (VoiceOver). */
function spokenWhen(date: string): string {
  return `${WEEKDAY_LONG[weekdayIndexOfDate(date)] ?? ''} ${String(dayOf(date))} ${MONTH_LONG[monthOf(date)] ?? ''}`;
}

/** A workout's value line: `52 min · 16 sets`; date-only: `16 sets`. */
export function workoutValueText(w: Pick<FeedWorkoutInput, 'durationMs' | 'sets'>): string {
  return [w.durationMs === null ? null : formatMinutes(w.durationMs), count(w.sets, 'set', 'sets')].filter((x): x is string => x !== null).join(' · ');
}

/** An activity's value line: distance and time (`5.2 km · 28 min`); neither logged: its effort word (`easy`). */
export function activityValueText(a: Pick<FeedActivityInput, 'distanceM' | 'durationS' | 'effort'>): string {
  const parts: string[] = [];
  if (a.distanceM !== null) parts.push(activityDistanceText(a.distanceM));
  if (a.durationS !== null) parts.push(activityDurationText(a.durationS));
  if (parts.length === 0 && a.effort !== null) parts.push(EFFORT_WORD[a.effort]);
  return parts.join(' · ');
}

function label(date: string, title: string, value: string): string {
  return [spokenWhen(date), title, value].filter((x) => x !== '').join(', ').replaceAll(NBSP, ' ');
}

/** The name a workout is listed with: its stored name, else one from its exercises (`Push`), `Empty workout` with none. */
export function feedWorkoutTitle(w: Pick<SessionAggregate, 'session' | 'exercises'>, info: (exerciseId: string) => Pick<Exercise, 'movementPattern' | 'primaryMuscles'> | null): string {
  const stored = storedWorkoutName(w.session);
  if (stored !== null) return stored;
  const live = w.exercises.filter((e) => e.removed === undefined);
  if (live.length === 0) return 'Empty workout';
  return deriveWorkoutTitle(live.map((e) => info(e.exerciseId)).filter((x): x is Pick<Exercise, 'movementPattern' | 'primaryMuscles'> => x !== null));
}

/** A workout in history (stored summary or decoded) as the feed's input. */
export function feedWorkoutOf(w: Pick<SessionAggregate, 'session' | 'exercises' | 'sets' | 'revision'>, opts: { title: string; nowMs: number }): FeedWorkoutInput {
  const s = w.session;
  const startMs = toMs(s.startedAt.utc);
  return {
    sessionId: s.id,
    localDate: s.localDate ?? localDateOf(startMs, s.startedAt.tz),
    sortMs: startMs,
    title: opts.title,
    durationMs: s.endedAt === null ? null : workoutDurationMs(w, opts.nowMs),
    sets: w.sets.filter((x) => x.status === 'completed' && x.pairedWithSetId === null).length,
    source: s.source,
  };
}

/**
 * A stored activity as the feed's input. `linkedSessionId`: set by a source that links to a workout. An activity read
 * from Apple Health carries its own title and source, sorts at its real start, and is linkable when it is a strength
 * (or `other`) workout (ADR 0035).
 */
export function feedActivityOf(a: {
  id: string;
  tz: string;
  source: string;
  fields: { kind: ActivityKind; status: 'done' | 'planned'; date: string; distanceM: number | null; durationS: number | null; effort: ActivityEffort | null };
  linkedSessionId?: string | null;
  health?: Pick<HealthActivityProvenance, 'label' | 'sourceName' | 'startUtc' | 'strength' | 'activityType'> | undefined;
}): FeedActivityInput {
  const h = a.health;
  const fromHealth = h !== undefined && a.source === 'health';
  return {
    activityId: a.id,
    localDate: a.fields.date,
    kind: a.fields.kind,
    status: a.fields.status,
    distanceM: a.fields.distanceM,
    durationS: a.fields.durationS,
    effort: a.fields.effort,
    sortMs: fromHealth ? toMs(h.startUtc) : activitySortMs(a),
    source: a.source,
    linkedSessionId: a.linkedSessionId ?? null,
    ...(h === undefined ? {} : { fromHealth: h.sourceName }),
    ...(fromHealth && (a.fields.kind === 'other' || a.fields.kind === 'sport') ? { title: h.label } : {}),
    ...(fromHealth && (h.strength || h.activityType === 3000) ? { linkable: true } : {}),
  };
}

/** (ADR 0035) A workout's feed input with its linked Health workout's source (shortened), when it has one. */
export function withLinkedSource(w: FeedWorkoutInput, linked: ReadonlyMap<string, string>): FeedWorkoutInput {
  const source = linked.get(w.sessionId);
  return source === undefined ? w : { ...w, linkedSource: healthSourceText(source) };
}

/**
 * Workouts and done activities in one list, newest first (by date, then time; a tie by key, so the order is stable).
 * A planned activity is left out (not done). An activity linked to one of these workouts is left out: the workout
 * stands for it. Callers pass the workouts of the same days as the activities.
 */
export function mergeFeed(input: { workouts: readonly FeedWorkoutInput[]; activities: readonly FeedActivityInput[] }): FeedItem[] {
  const ids = new Set(input.workouts.map((w) => w.sessionId));
  const out: FeedItem[] = [];
  for (const w of input.workouts) {
    const value = workoutValueText(w);
    const linked = w.linkedSource ?? null;
    out.push({
      kind: 'workout',
      key: `w:${w.sessionId}`,
      sessionId: w.sessionId,
      source: w.source,
      localDate: w.localDate,
      sortMs: w.sortMs,
      when: feedWhen(w.localDate),
      title: w.title,
      value,
      ...(linked === null ? {} : { linkedSource: linked }),
      accessibilityLabel: label(w.localDate, w.title, value) + (linked === null ? '' : `, linked to ${linked} activity`),
    });
  }
  const freeWorkouts = input.workouts.filter((w) => (w.linkedSource ?? null) === null && w.durationMs !== null);
  for (const a of input.activities) {
    if (a.status !== 'done') continue;
    if (a.linkedSessionId !== null && ids.has(a.linkedSessionId)) continue;
    const title = a.title ?? ACTIVITY_WORD[a.kind];
    const value = [activityValueText(a), a.fromHealth ?? ''].filter((x) => x !== '').join(' · ');
    const near = a.linkable === true ? freeWorkouts.filter((w) => w.localDate === a.localDate).sort((x, y) => Math.abs(x.sortMs - a.sortMs) - Math.abs(y.sortMs - a.sortMs))[0] : undefined;
    out.push({
      kind: 'activity',
      key: `a:${a.activityId}`,
      activityId: a.activityId,
      source: a.source,
      localDate: a.localDate,
      sortMs: a.sortMs,
      when: feedWhen(a.localDate),
      title,
      value,
      ...(a.fromHealth === undefined ? {} : { fromHealth: a.fromHealth }),
      ...(near === undefined ? {} : { linkTo: { sessionId: near.sessionId, title: near.title } }),
      accessibilityLabel: label(a.localDate, title, value) + (a.fromHealth === undefined ? '' : ', from Apple Health'),
    });
  }
  return out.sort((x, y) => (x.localDate !== y.localDate ? (x.localDate < y.localDate ? 1 : -1) : x.sortMs !== y.sortMs ? y.sortMs - x.sortMs : x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

/** Today's Recent: the last 14 days (today included), newest first, at most 6 rows. */
export function recentFeed(items: readonly FeedItem[], today: string): FeedItem[] {
  const from = addDays(today, -(RECENT_DAYS - 1));
  return items.filter((i) => i.localDate >= from && i.localDate <= today).slice(0, RECENT_MAX);
}

export function filterFeed(items: readonly FeedItem[], filter: FeedFilter): FeedItem[] {
  if (filter === 'all') return [...items];
  const kind = filter === 'workouts' ? 'workout' : 'activity';
  return items.filter((i) => i.kind === kind);
}

/** `This week`, `Last week`, then `13–19 Oct`, `27 Oct – 2 Nov`; another year's: `15–21 Dec 2025`. */
export function weekHeader(monday: string, today: string): string {
  const thisMonday = mondayOfDate(today);
  if (monday === thisMonday) return HISTORY_COPY.thisWeek;
  if (monday === addDays(thisMonday, -7)) return HISTORY_COPY.lastWeek;
  const sunday = addDays(monday, 6);
  const year = yearOf(sunday) === yearOf(today) ? '' : ` ${yearOf(sunday)}`;
  const m1 = MONTH[monthOf(monday)] ?? '';
  const m2 = MONTH[monthOf(sunday)] ?? '';
  if (monthOf(monday) === monthOf(sunday)) return `${String(dayOf(monday))}–${String(dayOf(sunday))}${NBSP}${m2}${year}`;
  const y1 = yearOf(monday) !== yearOf(sunday) ? ` ${yearOf(monday)}` : '';
  return `${String(dayOf(monday))}${NBSP}${m1}${y1} – ${String(dayOf(sunday))}${NBSP}${m2}${year}`;
}

/** A week's tiny total: `3 workouts · 1 activity`; one kind only: just that. */
export function weekTotalText(items: readonly Pick<FeedItem, 'kind'>[]): string {
  const w = items.filter((i) => i.kind === 'workout').length;
  const a = items.length - w;
  return [w > 0 ? count(w, 'workout', 'workouts') : null, a > 0 ? count(a, 'activity', 'activities') : null].filter((x): x is string => x !== null).join(' · ');
}

export interface FeedWeek {
  monday: string;
  /** `This week`, `Last week`, `13–19 Oct`. */
  header: string;
  /** `3 workouts · 1 activity`. */
  total: string;
  accessibilityLabel: string;
  items: FeedItem[];
}

/** Newest-first items grouped by their Monday-first week, newest week first. Weeks with nothing aren't listed. */
export function groupFeedByWeek(items: readonly FeedItem[], today: string): FeedWeek[] {
  const weeks: FeedWeek[] = [];
  const byMonday = new Map<string, FeedItem[]>();
  for (const i of items) {
    const m = mondayOfDate(i.localDate);
    let list = byMonday.get(m);
    if (list === undefined) {
      list = [];
      byMonday.set(m, list);
    }
    list.push(i);
  }
  for (const monday of [...byMonday.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))) {
    const list = byMonday.get(monday) ?? [];
    const header = weekHeader(monday, today);
    const total = weekTotalText(list);
    weeks.push({ monday, header, total, accessibilityLabel: `${header}, ${total}`.replaceAll(NBSP, ' '), items: list });
  }
  return weeks;
}

/** The first page's start: the Monday `HISTORY_PAGE_WEEKS - 1` weeks before this week's. */
export function historyFirstFrom(today: string): string {
  return addDays(mondayOfDate(today), -7 * (HISTORY_PAGE_WEEKS - 1));
}

/**
 * `Show more`'s next start, or null when nothing older exists. `newestOlder`: the newest date with a workout or
 * activity before `from`. A long gap (months off) is skipped, so the next page always brings something.
 */
export function historyOlderFrom(from: string, newestOlder: string | null): string | null {
  if (newestOlder === null || newestOlder >= from) return null;
  const page = addDays(from, -7 * HISTORY_PAGE_WEEKS);
  const gap = mondayOfDate(newestOlder);
  return gap < page ? addDays(gap, -7 * (HISTORY_PAGE_WEEKS - 1)) : page;
}

