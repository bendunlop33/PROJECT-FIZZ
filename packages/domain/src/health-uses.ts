import type { ActivityKind, WeightUnit } from '@fizz/schemas';

import { activityDistanceText, activityDurationText } from './activity';
import { addDays, daysBetween } from './calendar';
import { formatNumber, NBSP } from './display';
import { HK_STRENGTH_TYPES, type BodyweightEntry, type HealthDailyValue } from './health';
import { convertMass } from './units';

/**
 * (Ben, 27 Oct) The three approved uses of Apple Health data, pure. Gym first: everything here is secondary context
 * beside lifting, never a score (rule 6) and never a reason for the coach to change loads on its own (rule 3).
 *
 * 1. Today's line: last night's sleep and this morning's resting heart rate against its 28-day median
 *    (`todayHealthLine`). Hidden with no data.
 * 2. The week's other activity (Ben's `＋ Activity` and Health's, linked watch workouts never counted twice),
 *    grouped by type (`activityGroupTotals`, `activityGroupsLine`), and the week's sleep and resting heart rate
 *    (`weekHealthFacts`). Facts for the weekly review and its coach, as data (rules 8, 10).
 * 3. Bodyweight over time: points with a trailing 7-day average (`bodyweightChart`).
 */

// ---------------------------------------------------------------------------
// Today: sleep and resting heart rate

/** The resting heart rate baseline: the median of the 28 days before today, with at least `minDays` of them. */
export const RHR_BASELINE = { days: 28, minDays: 7, showDeltaFrom: 3 } as const;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export interface RestingHrVsBaseline {
  date: string;
  bpm: number;
  source: string;
  /** Median of the 28 days before; null with fewer than 7 of them. */
  baseline: number | null;
  /** `bpm − baseline`, rounded; null with no baseline. */
  delta: number | null;
}

/** Today's resting heart rate against the median of the 28 days before it; null with no value today. */
export function restingHrVsBaseline(days: readonly HealthDailyValue[], today: string): RestingHrVsBaseline | null {
  const t = days.find((d) => d.date === today);
  if (t === undefined) return null;
  const from = addDays(today, -RHR_BASELINE.days);
  const before = days.filter((d) => d.date >= from && d.date < today).map((d) => d.value);
  const base = before.length >= RHR_BASELINE.minDays ? median(before) : null;
  return { date: today, bpm: t.value, source: t.source, baseline: base, delta: base === null ? null : Math.round(t.value - base) };
}

/** `6h 10m`, `7h`, `45m`: the Today line's compact sleep (Ben's wording). */
export function compactSleepText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${String(m)}m`;
  return m === 0 ? `${String(h)}h` : `${String(h)}h${NBSP}${String(m)}m`;
}

function spokenSleep(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [h > 0 ? `${String(h)} ${h === 1 ? 'hour' : 'hours'}` : null, m > 0 || h === 0 ? `${String(m)} ${m === 1 ? 'minute' : 'minutes'}` : null].filter((x): x is string => x !== null).join(' ');
}

export interface TodayHealthLine {
  /** `Sleep 6h 10m · RHR 58 ↑4`; either part alone when only it exists. */
  text: string;
  accessibilityLabel: string;
  /** Sources behind the values, raw names cleaned (`Garmin`). */
  sources: string[];
}

/**
 * Today's one line (Ben, 27 Oct): last night's sleep (the night ending today) and this morning's resting heart rate,
 * with an arrow and the change from its 28-day median only when that is 3 bpm or more. Null with neither for today
 * (no placeholder). No colour, no verdict (rule 6).
 */
export function todayHealthLine(signals: { sleep: readonly HealthDailyValue[]; restingHeartRate: readonly HealthDailyValue[] }, today: string): TodayHealthLine | null {
  const night = signals.sleep.find((d) => d.date === today) ?? null;
  const rhr = restingHrVsBaseline(signals.restingHeartRate, today);
  if (night === null && rhr === null) return null;
  const parts: string[] = [];
  const said: string[] = [];
  if (night !== null) {
    parts.push(`Sleep${NBSP}${compactSleepText(night.value)}`);
    said.push(`Sleep last night ${spokenSleep(night.value)}`);
  }
  if (rhr !== null) {
    const shown = rhr.delta !== null && Math.abs(rhr.delta) >= RHR_BASELINE.showDeltaFrom;
    const delta = shown && rhr.delta !== null ? `${NBSP}${rhr.delta > 0 ? '↑' : '↓'}${String(Math.abs(rhr.delta))}` : '';
    parts.push(`RHR${NBSP}${String(rhr.bpm)}${delta}`);
    said.push(`Resting heart rate ${String(rhr.bpm)}${shown && rhr.delta !== null ? `, ${String(Math.abs(rhr.delta))} ${rhr.delta > 0 ? 'above' : 'below'} your 28-day median` : ''}`);
  }
  const sources = [...new Set([night?.source, rhr?.source].filter((x): x is string => x !== undefined))];
  return { text: parts.join(' · '), accessibilityLabel: `${said.join('. ')}. From Apple Health${sources.length > 0 ? `, ${sources.join(', ')}` : ''}`, sources };
}

/** `Apple Health · Garmin`: the sheet's source line. */
export function appleHealthSourceLine(sources: readonly string[]): string {
  return ['Apple Health', ...new Set(sources)].join(' · ');
}

// ---------------------------------------------------------------------------
// The week's other activity, grouped (Ben, 27 Oct: "and other exercise too")

export const ACTIVITY_GROUPS = ['run', 'ride', 'swim', 'walk', 'cardio', 'sport', 'strength', 'other'] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

/** Health workout types (HKWorkoutActivityType) that are walks or hikes. */
const WALK_TYPES: ReadonlySet<number> = new Set([52, 24]);
/** Other cardio: elliptical, rowing, stairs, HIIT, jump rope, mixed cardio, skiing, snowboarding, cross-country, hand cycling, stair stepper, triathlon. */
const CARDIO_TYPES: ReadonlySet<number> = new Set([16, 35, 44, 60, 61, 63, 64, 67, 68, 73, 74, 82]);

/** What grouping needs of one done activity (Ben's, or one read from Health). */
export interface GroupableActivity {
  kind: ActivityKind;
  durationS: number | null;
  distanceM: number | null;
  /** Health's workout type when it came from Health; absent for Ben's own. */
  healthType?: number | null;
  /** From Apple Health (shown with ♥ and counted once; a linked watch workout is never one of these). */
  fromHealth?: boolean;
}

/** Run, ride, swim, walk/hike, other cardio (rowing …), sports, watch strength not linked to a workout, other. */
export function activityGroupOf(a: Pick<GroupableActivity, 'kind' | 'healthType'>): ActivityGroup {
  if (a.kind === 'run' || a.kind === 'swim' || a.kind === 'sport') return a.kind;
  const t = a.healthType ?? null;
  // A Health indoor cycle (74) is a ride; Health's own ride kind already says so.
  if (a.kind === 'ride') return 'ride';
  if (t !== null && HK_STRENGTH_TYPES.has(t)) return 'strength';
  if (t !== null && WALK_TYPES.has(t)) return 'walk';
  if (t !== null && CARDIO_TYPES.has(t)) return 'cardio';
  return 'other';
}

export interface ActivityGroupTotal {
  group: ActivityGroup;
  count: number;
  /** Total minutes in seconds; null unless every one had a duration. */
  durationS: number | null;
  /** Total distance; null unless every one had one (or the group has no distance). */
  distanceM: number | null;
  /** Any came from Apple Health. */
  fromHealth: boolean;
}

const HAS_DISTANCE: ReadonlySet<ActivityGroup> = new Set(['run', 'ride', 'swim', 'walk']);

/**
 * Done activities grouped, in the fixed group order. Totals only when every activity in the group gave the value
 * (never a partial sum that reads as the whole; rule 6). Distance only for runs, rides, swims and walks.
 */
export function activityGroupTotals(done: readonly GroupableActivity[]): ActivityGroupTotal[] {
  const by = new Map<ActivityGroup, GroupableActivity[]>();
  for (const a of done) {
    const g = activityGroupOf(a);
    by.set(g, [...(by.get(g) ?? []), a]);
  }
  const out: ActivityGroupTotal[] = [];
  for (const g of ACTIVITY_GROUPS) {
    const list = by.get(g);
    if (list === undefined || list.length === 0) continue;
    const all = (k: 'durationS' | 'distanceM'): number | null => (list.every((a) => a[k] !== null) ? list.reduce((m, a) => m + (a[k] ?? 0), 0) : null);
    out.push({ group: g, count: list.length, durationS: all('durationS'), distanceM: HAS_DISTANCE.has(g) ? all('distanceM') : null, fromHealth: list.some((a) => a.fromHealth === true) });
  }
  return out;
}

const GROUP_WORDS: Readonly<Record<ActivityGroup, [string, string]>> = {
  run: ['run', 'runs'],
  ride: ['ride', 'rides'],
  swim: ['swim', 'swims'],
  walk: ['walk', 'walks'],
  cardio: ['cardio', 'cardio'],
  sport: ['sport', 'sports'],
  strength: ['other strength', 'other strength'],
  other: ['other', 'other'],
};

export function activityGroupWord(group: ActivityGroup, count: number): string {
  const [one, many] = GROUP_WORDS[group];
  return count === 1 ? one : many;
}

/** `2 runs 14 km`, `1 ride 45 min`, `3 walks 2 h`: distance where it applies, else minutes, else the count. */
export function activityGroupText(t: ActivityGroupTotal): string {
  const head = `${String(t.count)}${NBSP}${activityGroupWord(t.group, t.count)}`;
  if (t.distanceM !== null && t.distanceM > 0) return `${head} ${activityDistanceText(t.distanceM)}`;
  if (t.durationS !== null && t.durationS > 0) return `${head} ${activityDurationText(t.durationS)}`;
  return head;
}

export interface ActivityGroupsLine {
  /** The first groups: `2 runs 14 km · 1 ride 45 min · 3 walks 2 h`. */
  line: string;
  /** Groups past the line (`+2 more` opens the full list); 0 with none. */
  more: number;
  /** Every group, one line each. */
  all: string[];
  /** Any came from Apple Health (♥). */
  fromHealth: boolean;
  accessibilityLabel: string;
}

/** One compact line (gym first: it sits after lifting); null with no other activity. */
export function activityGroupsLine(totals: readonly ActivityGroupTotal[], shown = 3): ActivityGroupsLine | null {
  if (totals.length === 0) return null;
  const all = totals.map(activityGroupText);
  const more = Math.max(0, all.length - shown);
  const fromHealth = totals.some((t) => t.fromHealth);
  return { line: all.slice(0, shown).join(' · '), more, all, fromHealth, accessibilityLabel: `Other activity: ${all.join(', ').replaceAll(NBSP, ' ')}${fromHealth ? ', including Apple Health' : ''}` };
}

// ---------------------------------------------------------------------------
// The week's sleep and resting heart rate

export interface WeekHealthFacts {
  /** Average minutes asleep over the nights recorded (wake-up dates in the week). */
  sleep: { avgMin: number; nights: number } | null;
  /** The week's first and last resting heart rate (two days at least); no slope, no score. */
  restingHr: { start: { date: string; bpm: number }; end: { date: string; bpm: number } } | null;
  sources: string[];
}

/** The week's sleep average and resting heart rate start → end, from what Health recorded; null with neither. */
export function weekHealthFacts(signals: { sleep: readonly HealthDailyValue[]; restingHeartRate: readonly HealthDailyValue[] }, monday: string): WeekHealthFacts | null {
  const sunday = addDays(monday, 6);
  const inWeek = (d: HealthDailyValue) => d.date >= monday && d.date <= sunday;
  const nights = signals.sleep.filter(inWeek);
  const hr = signals.restingHeartRate.filter(inWeek).sort((a, b) => (a.date < b.date ? -1 : 1));
  const sleep = nights.length === 0 ? null : { avgMin: Math.round(nights.reduce((m, d) => m + d.value, 0) / nights.length), nights: nights.length };
  const first = hr[0];
  const last = hr.at(-1);
  const restingHr = first !== undefined && last !== undefined && hr.length >= 2 ? { start: { date: first.date, bpm: first.value }, end: { date: last.date, bpm: last.value } } : null;
  if (sleep === null && restingHr === null) return null;
  const sources = [...new Set([...nights.map((d) => d.source), ...(restingHr === null ? [] : hr.map((d) => d.source))])].slice(0, 4);
  return { sleep, restingHr, sources };
}

/** `Sleep avg 7h 05m · RHR 56 → 58`; null with neither. */
export function weekHealthLine(f: WeekHealthFacts | null): string | null {
  if (f === null) return null;
  const parts: string[] = [];
  if (f.sleep !== null) parts.push(`Sleep avg${NBSP}${compactSleepText(f.sleep.avgMin)}`);
  if (f.restingHr !== null) parts.push(`RHR${NBSP}${String(f.restingHr.start.bpm)}${NBSP}→${NBSP}${String(f.restingHr.end.bpm)}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Bodyweight chart (Progress)

export const BODYWEIGHT_RANGES = ['1m', '3m', '1y', 'all'] as const;
export type BodyweightRange = (typeof BODYWEIGHT_RANGES)[number];
export const BODYWEIGHT_RANGE_LABEL: Readonly<Record<BodyweightRange, string>> = { '1m': '1M', '3m': '3M', '1y': '1Y', all: 'All' };
const RANGE_DAYS: Readonly<Record<BodyweightRange, number | null>> = { '1m': 30, '3m': 91, '1y': 365, all: null };
/** The average line: the mean of the points in the 7 days ending on each point's date. */
export const BODYWEIGHT_AVG_DAYS = 7;

export interface BodyweightPoint {
  date: string;
  /** In Ben's unit, 1 decimal. */
  value: number;
  from: 'you' | 'health';
  /** The entry (Ben's, editable) or Health sample ID. */
  id: string;
  sourceName: string | null;
}

export interface BodyweightChartView {
  range: BodyweightRange;
  unit: WeightUnit;
  /** Inclusive local dates of the x axis. */
  from: string;
  to: string;
  /** One a day (Ben's entry wins), oldest first, inside the range. */
  points: BodyweightPoint[];
  /** The trailing 7-day average at each point. */
  average: number[];
  /** `82.4 kg · 26 Oct`; null with no entry at all. */
  latest: string | null;
  /** `−1.2 kg` over the range (first to last point in it); null with fewer than two. */
  change: string | null;
  /** (Optional) `Withings · Apple Health` when any point came from Health. */
  source: string | null;
  accessibilityLabel: string;
  /** No entry at all. */
  empty: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const dayText = (date: string): string => `${String(Number(date.slice(8, 10)))}${NBSP}${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;

/** One value a day: the day's last entry (Ben's win already, `bodyweightEntries`), in `unit`. */
export function bodyweightDaily(entries: readonly BodyweightEntry[], unit: WeightUnit): BodyweightPoint[] {
  const byDay = new Map<string, BodyweightEntry>();
  for (const e of entries) {
    const have = byDay.get(e.date);
    // Ben's beats Health's; among the same kind the later one stands.
    if (have === undefined || (have.from === 'health' && e.from === 'you') || (have.from === e.from && have.recordedAtUtc <= e.recordedAtUtc)) byDay.set(e.date, e);
  }
  return [...byDay.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => ({ date: e.date, value: round1(convertMass({ value: e.value, unit: e.unit }, unit).value), from: e.from, id: e.id, sourceName: e.sourceName }));
}

/** The mean of the points dated within the 7 days ending on each point (points before the range count too). */
export function bodyweightTrailingAverage(points: readonly Pick<BodyweightPoint, 'date' | 'value'>[], days = BODYWEIGHT_AVG_DAYS): number[] {
  return points.map((p) => {
    const win = points.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < days);
    return round1(win.reduce((m, q) => m + q.value, 0) / win.length);
  });
}

function signed(n: number, unit: WeightUnit): string {
  const r = round1(n);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${formatNumber(Math.abs(r))}${NBSP}${unit}`;
}

/**
 * Progress's bodyweight card: the points in the range with the 7-day average line, the latest value, and the change
 * over the range. Actuals only (rule 6), shown in Ben's unit; no target, no projection.
 */
export function bodyweightChart(entries: readonly BodyweightEntry[], opts: { range: BodyweightRange; unit: WeightUnit; today: string }): BodyweightChartView {
  const daily = bodyweightDaily(entries, opts.unit);
  const avgAll = bodyweightTrailingAverage(daily);
  const span = RANGE_DAYS[opts.range];
  const first = daily[0]?.date ?? opts.today;
  const from = span === null ? (first < opts.today ? first : addDays(opts.today, -30)) : addDays(opts.today, -span);
  const idx = daily.map((p, i) => ({ p, i })).filter(({ p }) => p.date >= from && p.date <= opts.today);
  const points = idx.map(({ p }) => p);
  const average = idx.map(({ i }) => avgAll[i] ?? 0);
  const last = daily.at(-1) ?? null;
  const latest = last === null ? null : `${formatNumber(last.value)}${NBSP}${opts.unit} · ${dayText(last.date)}`;
  const a = points[0];
  const b = points.at(-1);
  const change = a !== undefined && b !== undefined && points.length >= 2 ? signed(b.value - a.value, opts.unit) : null;
  const healthSources = [...new Set(points.filter((p) => p.from === 'health').map((p) => p.sourceName ?? 'Health'))];
  const source = healthSources.length === 0 ? null : `${healthSources.join(', ')} · Apple Health`;
  const said = [
    'Bodyweight',
    latest === null ? 'no entries' : `latest ${latest.replace(' · ', ' on ')}`,
    change === null ? null : `change ${change.replace('−', 'minus ')} over ${BODYWEIGHT_RANGE_LABEL[opts.range]}`,
    points.length > 0 ? `${String(points.length)} ${points.length === 1 ? 'day' : 'days'}` : null,
  ].filter((x): x is string => x !== null);
  return { range: opts.range, unit: opts.unit, from, to: opts.today, points, average, latest, change, source, accessibilityLabel: said.join(', ').replaceAll(NBSP, ' '), empty: daily.length === 0 };
}
