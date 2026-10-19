import type { EquipmentKind, Load } from '@fizz/schemas';
import { cardioDistanceText, cardioTimeText, cardioValuesText, distanceLoadText, formatDistance, formatDuration, formatNumber, loadText, NBSP } from '../display';
import { paceText } from '../cardio';
import { exclusionWords, isSetCountable } from '../exclusions';
import { E1RM_MAX_REPS } from './e1rm';
import { RECORD_MIN_SESSIONS } from '../session/records';
import {
  ASSIST_RECORD_MIN_REPS,
  collectExerciseSeries,
  defaultSeries,
  distanceTableByLoad,
  DEFAULT_TREND_RANGE,
  exerciseHeadline,
  exerciseHistory,
  exerciseTrend,
  hasRepTable,
  listProgressExercises,
  metricsFor,
  mondayOf,
  repTableByReps,
  repTableByWeight,
  seriesLoadValue,
  TREND_RANGES,
  trendRangeBounds,
  type ExerciseMetric,
  type ExerciseSeries,
  type ProgressExerciseEntry,
  type SeriesSession,
  type TrendMarker,
  type TrendPoint,
  type TrendRange,
} from './exercise';
import { MUSCLE_GROUPS, type MuscleGroup } from './muscle-groups';
import { muscleGroupCredits, type MuscleInfo } from './muscles';
import type { ProgressSession, ProgressSet } from './projection';
import { exerciseRecords, type ExerciseRecord } from './records';
import { countNoun, loadUnitText, massWords, monthName } from './text';
import type { DateRange } from './window';

/**
 * Exercises list and exercise detail view models (progress.md §2.6, §2.7,
 * §3.4, §5.5, §5.6). Every word and number the screens show, from the pure
 * metrics in `exercise.ts`. The screens only lay these out; nothing here
 * needs a network or the coach. Estimates always carry `≈` and `Est.` (or
 * "estimate" for VoiceOver, check 27); units and conventions are always
 * shown (`kg`, `kg each`, `kg stack`, `kg assist`).
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const TIMES = `${NBSP}×${NBSP}`;

function parts(date: string): { y: string; m: number; d: number } {
  const [y, m, d] = date.split('-');
  return { y: y ?? '', m: Number(m), d: Number(d) };
}

function weekday(date: string): number {
  const { y, m, d } = parts(date);
  // eslint-disable-next-line no-restricted-globals -- arithmetic on calendar fields, not a clock read
  return (new Date(Date.UTC(Number(y), m - 1, d)).getUTCDay() + 6) % 7;
}

/** `8 Oct`; `8 Oct 2025` outside today's year (long histories span years). */
export function shortDate(date: string, today: string): string {
  const { y, m, d } = parts(date);
  const base = `${String(d)}${NBSP}${MONTHS_SHORT[m - 1] ?? ''}`;
  return y === today.slice(0, 4) ? base : `${base} ${y}`;
}

/** `8 October` / `8 October 2025` (VoiceOver). */
export function longDate(date: string, today: string): string {
  const { y, m, d } = parts(date);
  const base = `${String(d)} ${MONTHS_LONG[m - 1] ?? ''}`;
  return y === today.slice(0, 4) ? base : `${base} ${y}`;
}

/** `Thu 8 Oct`. */
export function weekdayShortDate(date: string, today: string): string {
  return `${WEEKDAY_SHORT[weekday(date)] ?? ''} ${shortDate(date, today)}`;
}

/** `Thursday 8 October`. */
export function weekdayLongDate(date: string, today: string): string {
  return `${WEEKDAY_LONG[weekday(date)] ?? ''} ${longDate(date, today)}`;
}

/** `October`; `October 2025` outside today's year. */
export function monthLabel(month: string, today: string): string {
  const name = monthName(month);
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
}

/** `12,345`. */
export function thousands(n: number): string {
  const [whole, frac] = formatNumber(n).split('.');
  const w = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? w : `${w}.${frac}`;
}

export const RANGE_LABEL: Readonly<Record<TrendRange, string>> = { '3m': '3 mo', '6m': '6 mo', '1y': '1 yr', all: 'All' };

export function metricLabel(metric: ExerciseMetric): string {
  switch (metric) {
    case 'e1rm':
      return 'Est. 1RM';
    case 'top_set':
      return 'Top set';
    case 'volume':
      return 'Volume';
    case 'best_set':
      return 'Best set';
    case 'longest_hold':
      return 'Longest hold';
    case 'total_distance':
      return 'Total distance';
    case 'best_distance':
      return 'Best distance';
    case 'total_time':
      return 'Total time';
  }
}

/** The series' load unit as shown on axes and values: `kg`, `kg each`, `kg stack`, `kg plates`, `kg added`, `kg assist`. */
export function seriesUnitText(series: Pick<ExerciseSeries, 'key' | 'equipmentKind'>): string {
  return loadUnitText(series.key.unit, series.key.convention, series.equipmentKind);
}

/** The y-axis unit (§5.5 `Axis units`). */
export function axisUnit(series: ExerciseSeries, metric: ExerciseMetric): string {
  switch (metric) {
    case 'e1rm':
    case 'top_set':
      return seriesUnitText(series);
    case 'volume':
      return `${seriesUnitText(series)} × reps`;
    case 'best_set':
      return 'reps';
    case 'longest_hold':
      return 'min:s';
    case 'total_distance':
    case 'best_distance':
      return 'm';
    case 'total_time':
      return 'h:mm:ss';
  }
}

const estimateText = (value: number, series: ExerciseSeries) => `≈${formatNumber(value)}${NBSP}${seriesUnitText(series)}`;

function setLoadText(load: Load, series: Pick<ExerciseSeries, 'equipmentKind'>): string {
  return loadText(load, load.convention, series.equipmentKind === null ? null : { kind: series.equipmentKind });
}

/** `105 kg × 3`, `Assist 15 kg × 8`, `BW + 10 kg × 8`, `22.5 kg each × 10`. */
function setText(set: Pick<ProgressSet, 'load' | 'reps'>, series: ExerciseSeries): string {
  if (set.load === null || set.reps === null) return '—';
  return `${setLoadText(set.load, series)}${TIMES}${String(set.reps)}`;
}

function setWords(set: Pick<ProgressSet, 'load' | 'reps'>, kind: EquipmentKind | null): string {
  if (set.load === null || set.reps === null) return '';
  return `${massWords(set.load, kind)} by ${String(set.reps)}`;
}

/** A distance set's load as shown (`40 kg`, `24 kg each`); null with none (never `BW +`, as `distanceLoadText`). */
function distanceSetLoad(load: Load | null, series: Pick<ExerciseSeries, 'key' | 'equipmentKind'>): string | null {
  return distanceLoadText(load, series.key.convention, series.equipmentKind === null ? null : { kind: series.equipmentKind });
}

/** `40 kg × 50 m`, `50 m`. */
function distanceSetText(set: Pick<ProgressSet, 'load' | 'distanceM'>, series: Pick<ExerciseSeries, 'key' | 'equipmentKind'>): string {
  const d = set.distanceM === undefined ? '—' : formatDistance(set.distanceM);
  const load = distanceSetLoad(set.load, series);
  return load === null ? d : `${load}${TIMES}${d}`;
}

/** "40 kilograms", "24 kilograms each"; null with no load. */
function distanceLoadWords(load: Load | null, series: Pick<ExerciseSeries, 'key' | 'equipmentKind'>): string | null {
  if (load === null || distanceSetLoad(load, series) === null) return null;
  return `${formatNumber(load.value)} ${load.unit === 'kg' ? 'kilograms' : 'pounds'}${load.convention === 'per_hand' ? ' each' : ''}`;
}

/** "50 metres with 40 kilograms"; "50 metres" with no load. */
function distanceSetWords(set: Pick<ProgressSet, 'load' | 'distanceM'>, series: Pick<ExerciseSeries, 'key' | 'equipmentKind'>): string {
  const metres = countNoun(set.distanceM ?? 0, 'metre', 'metres');
  const load = distanceLoadWords(set.load, series);
  return load === null ? metres : `${metres} with ${load}`;
}

/** A point's value as shown: `≈123 kg`, `102.5 kg × 6`, `4,520 kg × reps`, `14 reps`, `1:30`. */
function valueText(p: Pick<TrendPoint, 'value' | 'fromSet'>, series: ExerciseSeries, metric: ExerciseMetric): string {
  switch (metric) {
    case 'e1rm':
      return estimateText(p.value, series);
    case 'top_set':
      return p.fromSet ? setText(p.fromSet, series) : '—';
    case 'volume':
      return `${thousands(p.value)}${NBSP}${seriesUnitText(series)}${TIMES}reps`;
    case 'best_set':
      return countNoun(p.value, 'rep', 'reps');
    case 'longest_hold':
      return formatDuration(p.value);
    case 'total_distance':
      return formatDistance(p.value);
    case 'best_distance':
      if (series.kind === 'cardio') return p.fromSet ? cardioSetText(p.fromSet, series) : cardioDistanceText(p.value);
      return p.fromSet ? distanceSetText({ load: p.fromSet.load, distanceM: p.value }, series) : formatDistance(p.value);
    case 'total_time':
      return cardioTimeText(p.value);
  }
}

function unitWords(series: ExerciseSeries): string {
  return series.key.unit === 'kg' ? 'kilograms' : 'pounds';
}

/** VoiceOver value: "about 126.5 kilograms", "105 kilograms by 3", "14 reps", "90 seconds". */
function valueWords(p: Pick<TrendPoint, 'value' | 'fromSet'>, series: ExerciseSeries, metric: ExerciseMetric): string {
  switch (metric) {
    case 'e1rm':
      return `about ${formatNumber(p.value)} ${unitWords(series)}${series.key.convention === 'per_hand' ? ' each' : ''}`;
    case 'top_set':
      return p.fromSet ? setWords(p.fromSet, series.equipmentKind) : '';
    case 'volume':
      return `${formatNumber(p.value)} ${unitWords(series)} times reps`;
    case 'best_set':
      return countNoun(p.value, 'rep', 'reps');
    case 'longest_hold':
      return countNoun(p.value, 'second', 'seconds');
    case 'total_distance':
      return countNoun(p.value, 'metre', 'metres');
    case 'best_distance':
      return p.fromSet ? distanceSetWords({ load: p.fromSet.load, distanceM: p.value }, series) : countNoun(p.value, 'metre', 'metres');
    case 'total_time':
      return countNoun(Math.round(p.value / 60), 'minute', 'minutes');
  }
}

function metricWords(metric: ExerciseMetric): string {
  switch (metric) {
    case 'e1rm':
      return 'Estimated one-rep max, an estimate';
    case 'top_set':
      return 'Top set';
    case 'volume':
      return 'Volume';
    case 'best_set':
      return 'Best set';
    case 'longest_hold':
      return 'Longest hold';
    case 'total_distance':
      return 'Total distance';
    case 'best_distance':
      return 'Best distance';
    case 'total_time':
      return 'Total time';
  }
}

/** A cardio set as logged, with its pace: `20:00 · 4,800 m · 2:05 /500 m` (19 Oct). */
export function cardioSetText(s: Pick<ProgressSet, 'durationS' | 'distanceM'>, series: { key: Pick<ExerciseSeries['key'], 'exerciseId'> }): string {
  const pace = paceText(s, series.key.exerciseId);
  return pace === null ? cardioValuesText(s) : `${cardioValuesText(s)} · ${pace}`;
}

/** `100×8`, `L 20×10`, `+10×8`, `12`, `0:45`, `40×50 m`, with ` (spotted)` for a marked set (PG21). */
export function compactSetText(s: ProgressSet, series: Pick<ExerciseSeries, 'kind' | 'equipmentKind'> & { key?: Pick<ExerciseSeries['key'], 'exerciseId'> }): string {
  let core: string;
  if (series.kind === 'cardio') core = series.key === undefined ? cardioValuesText(s) : cardioSetText(s, { key: series.key });
  else if (series.kind === 'distance') {
    const d = s.distanceM === undefined ? '—' : formatDistance(s.distanceM);
    const noLoad = s.load === null || s.load.convention === 'bodyweight' || (s.load.convention === 'added' && s.load.value === 0 && series.equipmentKind !== 'plate_loaded_machine');
    core = noLoad ? d : `${formatNumber(s.load?.value ?? 0)}×${d}`;
  } else if (series.kind === 'timed') core = s.durationS === null ? '—' : formatDuration(s.durationS);
  else if (series.kind === 'bodyweight' || s.load === null) core = s.reps === null ? '—' : String(s.reps);
  else if (series.kind === 'added_bodyweight') core = `${s.load.value === 0 ? 'BW' : `+${formatNumber(s.load.value)}`}×${String(s.reps ?? 0)}`;
  else core = `${formatNumber(s.load.value)}×${String(s.reps ?? 0)}`;
  const side = s.side === 'left' ? 'L ' : s.side === 'right' ? 'R ' : '';
  const marked = exclusionWords(s.exclusions);
  return `${side}${core}${marked === null ? '' : ` (${marked})`}`;
}

// ---------------------------------------------------------------------------
// Series

export interface SeriesOption {
  id: string;
  /** `Main Gym · Barbell`, `History · kg` (imported; 18 Oct: no `FitNotes` in labels). */
  label: string;
  sessionCount: number;
  /** `Main Gym · Barbell · 24`. */
  menuLabel: string;
  source: 'app' | 'import';
}

/** Series labels (§5.5): gym and equipment for logged series, `History · kg` for imported ones (no equipment recorded); made unique when two would read the same. */
export function seriesLabels(series: readonly ExerciseSeries[], gymNames: Readonly<Record<string, string>>): Map<string, string> {
  // Two series that would read the same: say what differs (unit and convention, or timed and weighted), then the unit, then an ordinal as a last resort.
  const loadedTimed = (s: ExerciseSeries) => s.key.measurement === 'duration' && s.key.convention !== 'bodyweight';
  const detail = (s: ExerciseSeries) => (s.key.measurement !== 'duration' ? seriesUnitText(s) : loadedTimed(s) ? 'timed · weighted' : 'timed');
  const base = new Map<string, string>();
  for (const s of series) {
    if (s.key.source === 'import') {
      // Timed and bodyweight imports say so (not a unit they don't use, review progress-B r3 N1).
      const what = s.key.measurement === 'duration' ? detail(s) : s.key.convention === 'bodyweight' ? 'reps' : `${s.key.unit}${s.key.convention === 'per_hand' ? ' each' : s.key.convention === 'assistance' ? ' assist' : ''}`;
      base.set(s.id, `History · ${what}`);
      continue;
    }
    const gym = s.gymId === null ? null : (gymNames[s.gymId] ?? null);
    const eq = s.key.equipmentId === null ? 'No equipment' : (s.equipmentName ?? 'Equipment');
    base.set(s.id, gym === null ? eq : `${gym} · ${eq}`);
  }
  const step1 = new Map<string, string>();
  const baseCounts = countLabels(base);
  for (const s of series) {
    const l = base.get(s.id) ?? '';
    if ((baseCounts.get(l) ?? 0) <= 1) step1.set(s.id, l);
    else step1.set(s.id, s.key.source === 'import' ? `History · ${detail(s)}` : `${l} · ${detail(s)}`);
  }
  const step1Counts = countLabels(step1);
  const step2 = new Map<string, string>();
  for (const s of series) {
    const l = step1.get(s.id) ?? '';
    step2.set(s.id, (step1Counts.get(l) ?? 0) > 1 ? `${l} · ${loadedTimed(s) ? seriesUnitText(s) : s.key.unit}` : l);
  }
  const step2Counts = countLabels(step2);
  // The ordinal goes on the shorter step-1 label (`History · kg (1)`, not `History · kg · kg (1)`), counted per step-1 label so it stays unique (review progress-B r3 N1).
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const s of series) {
    const l = step2.get(s.id) ?? '';
    if ((step2Counts.get(l) ?? 0) <= 1) {
      out.set(s.id, l);
      continue;
    }
    const short = step1.get(s.id) ?? l;
    const k = (seen.get(short) ?? 0) + 1;
    seen.set(short, k);
    out.set(s.id, `${short} (${String(k)})`);
  }
  return out;
}

function countLabels(labels: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of labels.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  return counts;
}

// ---------------------------------------------------------------------------
// Exercise detail view

export interface ChartPointView {
  sessionId: string;
  date: string;
  value: number;
  /** `≈123 kg`. */
  display: string;
  /** `Thu 1 Oct · Push A`. */
  title: string;
  /** `Est. 1RM  ≈115.5 kg  from 105 kg × 3` · `Top set  105 kg × 3`. */
  detail: string;
  /** Marker and tag words for the selected point (`Edited`, `1 set not counted (spotted)`, `FitNotes`). */
  notes: string[];
  hollow: boolean;
  breakBefore: boolean;
  /** "Thursday 1 October, estimated one-rep max about 115.5 kilograms, from 105 kilograms by 3." */
  words: string;
}

export interface MarkerView {
  key: string;
  kind: TrendMarker['kind'];
  date: string;
  /** For a gap, the session before it (the lane centres the word between the two). */
  from: string | null;
  label: string;
  words: string;
}

export interface TrendPanelLine {
  label: 'Latest' | 'Best' | 'Change';
  value: string;
  words: string;
  /** `Change` only: the arrow beside it (with the words, never colour alone). */
  direction?: 'up' | 'down' | 'same';
}

export interface TableRowView {
  key: string;
  sessionId: string;
  date: string;
  value: string;
  notes: string;
  words: string;
}

export type ChartState =
  | { kind: 'chart' }
  | { kind: 'too_few'; message: string; action: { label: string; range: TrendRange } | null }
  | { kind: 'none_in_range'; message: string; action: { label: string; range: TrendRange } }
  | { kind: 'no_eligible'; message: string };

export interface RepTableView {
  by: 'weight' | 'reps';
  headers: [string, string, string];
  rows: { key: string; sessionId: string | null; cells: [string, string, string]; note: string | null; tag: string | null; words: string }[];
  /** Rows shown before `Show all (n)` (by weight; by reps shows every row, at most 12). */
  initial: number;
}

/** Distance series' best distance at each load (no toggle). */
export type DistanceTableView = Omit<RepTableView, 'by'>;

export interface RecordRowView {
  key: string;
  sessionId: string;
  sessionExerciseId: string;
  label: string;
  value: string;
  date: string;
  isEstimate: boolean;
  words: string;
}

export interface HistoryRowView {
  key: string;
  sessionId: string;
  /** `Thu 8 Oct · Push A`. */
  title: string;
  /** `102.5×6 · 100×8 · 100×7 (spotted)`. */
  sets: string;
  tags: string[];
  words: string;
}

export interface ExerciseDetailView {
  exerciseId: string;
  title: string;
  series: SeriesOption[];
  seriesId: string;
  seriesLabel: string;
  seriesSource: 'app' | 'import';
  stats: { value: string; label: string }[];
  statsWords: string;
  metrics: { key: ExerciseMetric; label: string }[];
  metric: ExerciseMetric;
  ranges: { key: TrendRange; label: string }[];
  range: TrendRange;
  /** `Est. 1RM · 9 Apr – 8 Oct` (`· weekly best` when weekly). */
  heading: string;
  /** The `ⓘ` (Est. 1RM sheet) is offered. */
  estimateInfo: boolean;
  axisUnit: string;
  /** Hold values are seconds shown as `m:ss` on the axis. */
  axisFormat: 'number' | 'duration';
  bars: boolean;
  bounds: DateRange;
  chart: ChartState;
  points: ChartPointView[];
  markers: MarkerView[];
  /** The chart's VoiceOver summary (§5.6). */
  chartWords: string;
  /** Range summary (nothing selected). */
  panel: TrendPanelLine[];
  table: { headers: [string, string, string]; rows: TableRowView[] };
  repTable: RepTableView | null;
  /** Distance series only: `BEST DISTANCE` by load. */
  distanceTable: DistanceTableView | null;
  /** Null for series with no defined record (timed holds, SP2; distance sets): the section is hidden. */
  records: { items: RecordRowView[]; empty: string | null } | null;
  history: { unit: string; months: { month: string; title: string; rows: HistoryRowView[] }[]; more: { label: string; months: number } | null };
  pain: { flagId: string; text: string; words: string } | null;
  /** The workout opened on (a home record or a past workout), when the chart shows it: its own point, or its week's point under weekly bests. */
  selectedSessionId: string | null;
  /**
   * What to select for `selectedSessionId`: the chart point to highlight and
   * the panel for that workout. Under weekly bests the point is the week's
   * and the panel is the workout's own value (review progress-B r2 S1).
   * `weekBest` is set only then: the highlighted point's value for the
   * panel's tag (`Week best ≈163.5 kg`) and VoiceOver (review progress-B r3 S1).
   */
  selection: ExerciseSelection | null;
}

export interface ExerciseSelection {
  /** The chart point to highlight. */
  index: number;
  /** The workout the panel shows, opens and VoiceOver reads. */
  point: ChartPointView;
  /** Under weekly bests, when the workout isn't its week's best: the highlighted point's value. */
  weekBest: { text: string; words: string } | null;
}

export interface ExerciseDetailInput {
  sessions: readonly ProgressSession[];
  exerciseId: string;
  today: string;
  gymNames?: Readonly<Record<string, string>>;
  /** The catalogue or custom name, used when the logged names are missing. */
  name?: string;
  seriesId?: string | null;
  /** Prefer a series on this equipment (Workout overview `History`). */
  equipmentId?: string | null;
  /** Else prefer a series at this gym (Workout overview `History` on equipment with no history yet). */
  gymId?: string | null;
  /** Open on the series containing this workout, with its point selected (home record, past workout). */
  sessionId?: string | null;
  /** Select this workout (its point, or its week's under weekly bests) without choosing the series or range, as after an opening. */
  selectSessionId?: string | null;
  /** With `sessionId`: the workout row tapped (Summary), so the series is that row's even when the exercise is on two rows. */
  sessionExerciseId?: string | null;
  metric?: ExerciseMetric | null;
  range?: TrendRange | null;
  repBy?: 'weight' | 'reps';
  /** History months shown (`Load September` adds one). */
  historyMonths?: number;
  /** An active pain flag on this exercise (`Pain flag since 2 Oct`). */
  painFlag?: { flagId: string; date: string } | null;
}

/**
 * The chart range. Opening on a workout older than the range (an old or
 * imported Summary) widens it to the narrowest range that holds that
 * workout, so its point is shown and selected (review progress-B S2).
 */
function openingRange(series: ExerciseSeries, input: ExerciseDetailInput, today: string): TrendRange {
  const asked = input.range ?? DEFAULT_TREND_RANGE;
  if (!input.sessionId) return asked;
  const date = series.sessions.find((x) => x.sessionId === input.sessionId)?.date;
  if (date === undefined) return asked;
  const firstDate = series.sessions[0]?.date ?? null;
  const holds = (r: TrendRange) => date >= trendRangeBounds(r, today, firstDate).from;
  if (holds(asked)) return asked;
  return TREND_RANGES.slice(TREND_RANGES.indexOf(asked) + 1).find(holds) ?? 'all';
}

const lastMs = (s: ExerciseSeries) => s.sessions[s.sessions.length - 1]?.startedMs ?? 0;

function pickSeries(all: readonly ExerciseSeries[], input: ExerciseDetailInput): ExerciseSeries | null {
  if (input.sessionId) {
    const hit = all.filter((s) => s.sessions.some((x) => x.sessionId === input.sessionId));
    const onRow = input.sessionExerciseId == null ? undefined : hit.find((s) => s.sessions.some((x) => x.sessionId === input.sessionId && x.rows.some((r) => r.sessionExerciseId === input.sessionExerciseId)));
    if (onRow) return onRow;
    const onEq = input.equipmentId == null ? undefined : hit.find((s) => s.key.equipmentId === input.equipmentId);
    if (onEq ?? hit[0]) return onEq ?? hit[0] ?? null;
  }
  if (input.seriesId) {
    const s = all.find((x) => x.id === input.seriesId);
    if (s) return s;
  }
  if (input.equipmentId) {
    const onEq = all.filter((s) => s.key.source === 'app' && s.key.equipmentId === input.equipmentId);
    const d = defaultSeries(onEq, input.today);
    if (d) return d;
  }
  if (input.gymId) {
    const atGym = all.filter((s) => s.key.source === 'app' && s.gymId === input.gymId);
    const d = defaultSeries(atGym, input.today);
    if (d) return d;
  }
  return defaultSeries(all, input.today);
}

function pointTitle(p: { date: string; name: string | null; source: 'app' | 'import' }, today: string): string {
  const name = p.name !== null && p.name.trim() !== '' ? p.name : 'Workout';
  return `${weekdayShortDate(p.date, today)} · ${name}`;
}

function markedNote(p: TrendPoint, metric: ExerciseMetric): string | null {
  if (p.excludedSets === 0) return null;
  return metric === 'volume' || metric === 'total_distance' ? `${countNoun(p.excludedSets, 'marked set', 'marked sets')} included` : `${countNoun(p.excludedSets, 'set', 'sets')} not counted`;
}

function pointView(p: TrendPoint, series: ExerciseSeries, metric: ExerciseMetric, today: string): ChartPointView {
  const display = valueText(p, series, metric);
  const from = metric === 'e1rm' && p.fromSet ? `  from ${setText(p.fromSet, series)}` : '';
  const notes = [p.edited ? 'Edited' : null, markedNote(p, metric)].filter((x): x is string => x !== null);
  const fromWords = metric === 'e1rm' && p.fromSet ? `, from ${setWords(p.fromSet, series.equipmentKind)}` : '';
  const metricName = metric === 'e1rm' ? 'estimated one-rep max' : metricLabel(metric).toLowerCase();
  return {
    sessionId: p.sessionId,
    date: p.date,
    value: p.value,
    display,
    title: pointTitle(p, today),
    detail: `${metricLabel(metric)}  ${display}${from}`,
    notes,
    hollow: false,
    breakBefore: p.breakBefore,
    words: `${weekdayLongDate(p.date, today)}, ${metricName} ${valueWords(p, series, metric)}${fromWords}.${notes.length > 0 ? ` ${notes.join('. ')}.` : ''}`,
  };
}

/** A set of 10 reps or fewer exists in range but Ben marked it (so `No sets of 10 reps or fewer` would be false, N1). */
function hasMarkedE1rmSet(series: ExerciseSeries, bounds: DateRange): boolean {
  return series.sessions.some(
    (ss) =>
      ss.date >= bounds.from &&
      ss.date <= bounds.to &&
      ss.sets.some((x) => x.setType !== 'warmup' && x.load !== null && x.load.unit === series.key.unit && x.load.convention === series.key.convention && x.reps !== null && x.reps >= 1 && x.reps <= E1RM_MAX_REPS && !isSetCountable(x, 'e1rm')),
  );
}

/** `2 sessions edited, 1 session not counted.` for the chart summary (the marker lane is hidden from VoiceOver, N4). */
function markerWords(markers: readonly TrendMarker[]): string {
  const edited = markers.filter((m) => m.kind === 'edited').length;
  const notCounted = markers.filter((m) => m.kind === 'not_counted').length;
  const parts = [edited > 0 ? `${countNoun(edited, 'session', 'sessions')} edited` : null, notCounted > 0 ? `${countNoun(notCounted, 'session', 'sessions')} not counted` : null].filter((x): x is string => x !== null);
  return parts.length === 0 ? '' : `${parts.join(', ')}.`;
}

function markerView(m: TrendMarker, today: string): MarkerView {
  switch (m.kind) {
    case 'gap':
      return { key: `gap:${m.date}`, kind: 'gap', date: m.date, from: m.from, label: `Gap ${String(m.days)} days`, words: `Gap of ${String(m.days)} days, ${longDate(m.from, today)} to ${longDate(m.date, today)}` };
    case 'edited':
      return { key: `edited:${m.sessionId}`, kind: 'edited', date: m.date, from: null, label: 'Edited', words: `Corrected after logging, ${longDate(m.date, today)}` };
    case 'not_counted':
      return { key: `not:${m.sessionId}`, kind: 'not_counted', date: m.date, from: null, label: 'Not counted', words: `Not counted, ${longDate(m.date, today)}` };
  }
}

function changeLine(first: TrendPoint, latest: TrendPoint, series: ExerciseSeries, metric: ExerciseMetric, today: string): TrendPanelLine {
  const since = shortDate(first.date, today);
  const sinceWords = longDate(first.date, today);
  const d = Math.round((latest.value - first.value) * 100) / 100;
  const dir: 'up' | 'down' | 'same' = d > 0 ? 'up' : d < 0 ? 'down' : 'same';
  const amount = Math.abs(d);
  const same = (): TrendPanelLine => {
    const r = (latest.fromSet?.reps ?? 0) - (first.fromSet?.reps ?? 0);
    if (metric === 'top_set' && r !== 0) {
      const what = series.kind === 'assisted' ? 'Same assistance' : 'Same load';
      const reps = r > 0 ? countNoun(r, 'more rep', 'more reps') : countNoun(-r, 'fewer rep', 'fewer reps');
      return { label: 'Change', value: `${what}, ${reps} than ${since}`, words: `${what}, ${reps} than ${sinceWords}`, direction: r > 0 ? 'up' : 'down' };
    }
    if (metric === 'best_distance' && latest.fromSet && first.fromSet) {
      // Same metres, different load: on a sled, more load over a fixed distance is the progression (review misc-fixes S1).
      const loadOf = (x: ProgressSet): number | null => (x.load === null ? 0 : seriesLoadValue(x, series.key));
      const a = loadOf(first.fromSet);
      const b = loadOf(latest.fromSet);
      const l = a === null || b === null ? 0 : Math.round((b - a) * 100) / 100;
      if (l !== 0) {
        const more = l > 0 ? 'more' : 'less';
        const each = series.key.convention === 'per_hand' ? ' each' : '';
        const n = formatNumber(Math.abs(l));
        return { label: 'Change', value: `Same distance, ${n}${NBSP}${series.key.unit} ${more}${each} than ${since}`, words: `Same distance, ${n} ${unitWords(series)} ${more}${each} than ${sinceWords}`, direction: l > 0 ? 'up' : 'down' };
      }
    }
    return { label: 'Change', value: `Same as ${since}`, words: `Same as ${sinceWords}`, direction: 'same' };
  };
  if (dir === 'same') return same();
  const word = dir === 'up' ? 'Up' : 'Down';
  switch (metric) {
    case 'e1rm':
      return { label: 'Change', value: `${word} ≈${formatNumber(amount)}${NBSP}${seriesUnitText(series)} since ${since}`, words: `${word} about ${formatNumber(amount)} ${unitWords(series)} since ${sinceWords}, an estimate`, direction: dir };
    case 'top_set':
      if (series.kind === 'assisted') {
        const more = dir === 'up' ? 'more' : 'less';
        return { label: 'Change', value: `${formatNumber(amount)}${NBSP}${series.key.unit} ${more} assistance than ${since}`, words: `${formatNumber(amount)} ${unitWords(series)} ${more} assistance than ${sinceWords}`, direction: dir };
      }
      return { label: 'Change', value: `${word} ${formatNumber(amount)}${NBSP}${seriesUnitText(series)} since ${since}`, words: `${word} ${formatNumber(amount)} ${unitWords(series)} since ${sinceWords}`, direction: dir };
    case 'volume':
      return { label: 'Change', value: `${word} ${thousands(amount)}${NBSP}${seriesUnitText(series)}${TIMES}reps since ${since}`, words: `${word} ${formatNumber(amount)} ${unitWords(series)} times reps since ${sinceWords}`, direction: dir };
    case 'best_set':
      return { label: 'Change', value: `${word} ${countNoun(amount, 'rep', 'reps')} since ${since}`, words: `${word} ${countNoun(amount, 'rep', 'reps')} since ${sinceWords}`, direction: dir };
    case 'longest_hold':
      return { label: 'Change', value: `${word} ${formatDuration(amount)} since ${since}`, words: `${word} ${countNoun(amount, 'second', 'seconds')} since ${sinceWords}`, direction: dir };
    case 'total_distance':
    case 'best_distance':
      return { label: 'Change', value: `${word} ${series.kind === 'cardio' ? cardioDistanceText(amount) : formatDistance(amount)} since ${since}`, words: `${word} ${countNoun(amount, 'metre', 'metres')} since ${sinceWords}`, direction: dir };
    case 'total_time':
      return { label: 'Change', value: `${word} ${cardioTimeText(amount)} since ${since}`, words: `${word} ${countNoun(Math.round(amount / 60), 'minute', 'minutes')} since ${sinceWords}`, direction: dir };
  }
}

function recordView(r: ExerciseRecord, series: ExerciseSeries, today: string): RecordRowView {
  const date = shortDate(r.date, today);
  const dateW = longDate(r.date, today);
  let label: string;
  let value: string;
  let words: string;
  switch (r.kind) {
    case 'heaviest':
      label = 'Heaviest set';
      value = r.load ? setText({ load: r.load, reps: r.reps }, series) : '—';
      words = `Heaviest set, ${r.load ? setWords({ load: r.load, reps: r.reps }, series.equipmentKind) : ''}, ${dateW}.`;
      break;
    case 'most_reps_at_load':
      label = r.load ? `Most reps at ${setLoadText(r.load, series)}` : 'Most reps';
      value = String(r.reps ?? 0);
      words = `Most reps at ${r.load ? massWords(r.load, series.equipmentKind) : ''}, ${String(r.reps ?? 0)}, ${dateW}.`;
      break;
    case 'best_e1rm':
      label = 'Best Est. 1RM';
      value = estimateText(r.value, series);
      words = `Best estimated one-rep max, an estimate, about ${formatNumber(r.value)} ${unitWords(series)}, ${dateW}.`;
      break;
    case 'most_reps':
      label = 'Most reps';
      value = String(r.value);
      words = `Most reps, ${String(r.value)}, ${dateW}.`;
      break;
    case 'least_assist':
      label = `Least assistance for ${String(ASSIST_RECORD_MIN_REPS)}+ reps`;
      value = `${formatNumber(r.value)}${NBSP}${series.key.unit}`;
      words = `Least assistance for ${String(ASSIST_RECORD_MIN_REPS)} or more reps, ${r.load ? massWords(r.load, series.equipmentKind) : `${formatNumber(r.value)} ${unitWords(series)}`}${r.reps === null ? '' : `, ${countNoun(r.reps, 'rep', 'reps')}`}, ${dateW}.`;
      break;
  }
  return { key: `${r.sessionExerciseId}:${r.kind}`, sessionId: r.sessionId, sessionExerciseId: r.sessionExerciseId, label, value, date, isEstimate: r.isEstimate, words };
}

function historyRow(ss: SeriesSession, series: ExerciseSeries, today: string): HistoryRowView {
  const working = ss.sets.filter((s) => s.setType !== 'warmup');
  const shown = working.length > 0 ? working : ss.sets;
  const sets = shown.map((s) => compactSetText(s, series)).join(' · ');
  const tags = [ss.edited ? 'Edited' : null].filter((x): x is string => x !== null);
  const title = pointTitle(ss, today);
  return {
    key: ss.sessionId,
    sessionId: ss.sessionId,
    title,
    sets,
    tags,
    words: `${weekdayLongDate(ss.date, today)}, ${title.split(' · ').slice(1).join(' · ')}. ${sets.replace(/×/g, ' by ').replace(/ · /g, ', ')}.${tags.length > 0 ? ` ${tags.join(', ')}.` : ''} Opens the workout.`,
  };
}

function repTableView(series: ExerciseSeries, bounds: DateRange, by: 'weight' | 'reps', today: string): RepTableView | null {
  if (!hasRepTable(series.kind)) return null;
  const lower = series.kind === 'assisted';
  // 18 Oct (Ben): imported rows read like any other (no `FitNotes` tag); the source stays in the data.
  const loadOf = (v: number): Load => ({ value: v, unit: series.key.unit, convention: series.key.convention });
  if (by === 'weight') {
    const rows = repTableByWeight(series, bounds).map((r) => ({
      key: `w:${String(r.load)}`,
      sessionId: r.sessionId,
      cells: [setLoadText(loadOf(r.load), series), String(r.reps), shortDate(r.date, today)] as [string, string, string],
      note: null,
      tag: null,
      words: `${massWords(loadOf(r.load), series.equipmentKind)}, ${countNoun(r.reps, 'rep', 'reps')}, ${longDate(r.date, today)}.`,
    }));
    return { by, headers: [lower ? 'Assist' : 'Weight', 'Reps', 'Date'], rows, initial: 10 };
  }
  const best = lower ? 'least assistance' : 'heaviest';
  const rows = repTableByReps(series, bounds).map((r) => ({
    key: `r:${String(r.reps)}`,
    sessionId: r.sessionId,
    cells: [String(r.reps), r.load === null ? '—' : setLoadText(loadOf(r.load), series), r.date === null ? '' : shortDate(r.date, today)] as [string, string, string],
    note: r.fromReps === null ? null : `from ${String(r.fromReps)} reps`,
    tag: null,
    words:
      r.load === null || r.date === null
        ? `${countNoun(r.reps, 'rep', 'reps')}, none.`
        : `${countNoun(r.reps, 'rep', 'reps')}, ${best} ${massWords(loadOf(r.load), series.equipmentKind)}${r.fromReps === null ? '' : `, from a set of ${String(r.fromReps)}`}, ${longDate(r.date, today)}.`,
  }));
  return { by, headers: ['Reps', lower ? 'Least assist' : 'Heaviest', 'Date'], rows, initial: REP_ROWS_ALL };
}
const REP_ROWS_ALL = 12;

/** Distance series: `BEST DISTANCE` by load, heaviest first (the rep table's place). */
function distanceTableView(series: ExerciseSeries, bounds: DateRange, today: string): DistanceTableView | null {
  if (series.kind !== 'distance') return null;
  const loadOf = (v: number): Load => ({ value: v, unit: series.key.unit, convention: series.key.convention });
  const rows = distanceTableByLoad(series, bounds).map((r) => {
    const load = r.load === null ? null : distanceSetLoad(loadOf(r.load), series);
    const metres = formatDistance(r.distanceM);
    return {
      key: `d:${r.load === null ? 'none' : String(r.load)}`,
      sessionId: r.sessionId,
      cells: [load ?? 'No load', metres, shortDate(r.date, today)] as [string, string, string],
      note: null,
      tag: null,
      words: `${(r.load === null ? null : distanceLoadWords(loadOf(r.load), series)) ?? 'No load'}, ${countNoun(r.distanceM, 'metre', 'metres')}, ${longDate(r.date, today)}.`,
    };
  });
  return { headers: ['Weight', 'Distance', 'Date'], rows, initial: 10 };
}

function headlineView(series: ExerciseSeries): { stats: { value: string; label: string }[]; words: string } {
  const h = exerciseHeadline(series);
  const sessions = { value: String(h.sessions), label: 'SESSIONS' };
  const sessionsWords = `${countNoun(h.sessions, 'session', 'sessions')}.`;
  const dash = '—';
  switch (series.kind) {
    case 'load': {
      const e = h.bestE1rm;
      const b = h.bestSet;
      return {
        stats: [{ value: e ? estimateText(e.value, series) : dash, label: 'EST. 1RM' }, { value: b ? setText(b.set, series) : dash, label: 'BEST SET' }, sessions],
        words: [e ? `Best estimated one-rep max, an estimate, about ${formatNumber(e.value)} ${unitWords(series)}.` : '', b ? `Best set ${setWords(b.set, series.equipmentKind)}.` : '', sessionsWords].filter((x) => x !== '').join(' '),
      };
    }
    case 'assisted': {
      const b = h.bestSet;
      return {
        stats: [{ value: b ? `${formatNumber(b.set.load.value)}${NBSP}${series.key.unit}` : dash, label: 'LEAST ASSIST' }, { value: h.mostReps ? String(h.mostReps.reps) : dash, label: 'MOST REPS' }, sessions],
        words: [b ? `Least assistance ${massWords(b.set.load, series.equipmentKind)}.` : '', h.mostReps ? `Most reps ${String(h.mostReps.reps)}.` : '', sessionsWords].filter((x) => x !== '').join(' '),
      };
    }
    case 'added_bodyweight': {
      const b = h.bestSet;
      return {
        stats: [{ value: b ? setText(b.set, series) : dash, label: 'BEST SET' }, { value: h.mostReps ? String(h.mostReps.reps) : dash, label: 'MOST REPS' }, sessions],
        words: [b ? `Best set ${setWords(b.set, series.equipmentKind)}.` : '', h.mostReps ? `Most reps ${String(h.mostReps.reps)}.` : '', sessionsWords].filter((x) => x !== '').join(' '),
      };
    }
    case 'bodyweight':
      return {
        stats: [{ value: h.mostReps ? String(h.mostReps.reps) : dash, label: 'MOST REPS' }, sessions],
        words: [h.mostReps ? `Most reps ${String(h.mostReps.reps)}.` : '', sessionsWords].filter((x) => x !== '').join(' '),
      };
    case 'timed':
      return {
        stats: [{ value: h.longestHold ? formatDuration(h.longestHold.seconds) : dash, label: 'LONGEST HOLD' }, sessions],
        words: [h.longestHold ? `Longest hold ${countNoun(h.longestHold.seconds, 'second', 'seconds')}.` : '', sessionsWords].filter((x) => x !== '').join(' '),
      };
    case 'cardio': {
      const b = h.bestDistance;
      const t = h.totalDistanceM;
      return {
        stats: [{ value: b ? cardioSetText(b.set, series) : dash, label: 'BEST DISTANCE' }, { value: t === null ? dash : cardioDistanceText(t), label: 'TOTAL DISTANCE' }, sessions],
        words: [b ? `Best distance ${countNoun(b.set.distanceM, 'metre', 'metres')}.` : '', t === null ? '' : `Total distance ${countNoun(t, 'metre', 'metres')}.`, sessionsWords].filter((x) => x !== '').join(' '),
      };
    }
    case 'distance': {
      const b = h.bestDistance;
      const t = h.totalDistanceM;
      return {
        stats: [{ value: b ? distanceSetText(b.set, series) : dash, label: 'BEST DISTANCE' }, { value: t === null ? dash : formatDistance(t), label: 'TOTAL DISTANCE' }, sessions],
        words: [b ? `Best distance ${distanceSetWords(b.set, series)}.` : '', t === null ? '' : `Total distance ${countNoun(t, 'metre', 'metres')}.`, sessionsWords].filter((x) => x !== '').join(' '),
      };
    }
  }
}

/**
 * The workout opened on, selected: its own point, or under weekly bests the
 * point of the week that holds it, with the workout's own value in the panel
 * and `Open workout ›` going to it (review progress-B r2 S1). Null when the
 * workout has no value in this metric and range (every set marked, say).
 */
function openedSelection(
  sessionId: string | null,
  trend: ReturnType<typeof exerciseTrend>,
  points: readonly ChartPointView[],
  series: ExerciseSeries,
  metric: ExerciseMetric,
  today: string,
): ExerciseSelection | null {
  if (sessionId === null) return null;
  const own = trend.points.findIndex((p) => p.sessionId === sessionId);
  if (own >= 0) {
    const point = points[own];
    return point === undefined ? null : { index: own, point, weekBest: null };
  }
  if (trend.aggregation !== 'weekly_best') return null;
  const mine = trend.sessionPoints.find((p) => p.sessionId === sessionId);
  if (mine === undefined) return null;
  const week = mondayOf(mine.date);
  const index = trend.points.findIndex((p) => mondayOf(p.date) === week);
  const best = trend.points[index];
  const shown = points[index];
  if (best === undefined || shown === undefined) return null;
  return {
    index,
    point: pointView(mine, series, metric, today),
    weekBest: { text: `Week best ${shown.display}`, words: `Week best ${valueWords(best, series, metric)}, ${weekdayLongDate(best.date, today)}.` },
  };
}

/**
 * `buildExerciseDetailView`: everything exercise detail shows for one
 * series, metric and range. Returns null when the exercise has no finished
 * session.
 */
export function buildExerciseDetailView(input: ExerciseDetailInput): ExerciseDetailView | null {
  const mine = input.sessions.filter((s) => s.exercises.some((e) => e.exerciseId === input.exerciseId));
  const all = collectExerciseSeries(mine, input.exerciseId);
  const series = pickSeries(all, input);
  if (series === null) return null;
  const today = input.today;
  const gymNames = input.gymNames ?? {};
  const labels = seriesLabels(all, gymNames);
  const metrics = metricsFor(series.kind);
  const metric = input.metric && metrics.includes(input.metric) ? input.metric : (metrics[0] as ExerciseMetric);
  const range = openingRange(series, input, today);
  const trend = exerciseTrend(series, metric, range, today);
  const label = labels.get(series.id) ?? '';
  const title = series.exerciseName || input.name || 'Exercise';
  const rangeText = `${shortDate(trend.bounds.from, today)} – ${shortDate(trend.bounds.to, today)}`;
  const rangeWordsText = `${longDate(trend.bounds.from, today)} to ${longDate(trend.bounds.to, today)}`;

  const points = trend.points.map((p) => ({ ...pointView(p, series, metric, today), hollow: false }));
  const markers = trend.markers.map((m) => markerView(m, today));

  // Chart state (§3.4)
  let chart: ChartState = { kind: 'chart' };
  const wider = TREND_RANGES.slice(TREND_RANGES.indexOf(range) + 1).find((r) => trend.pointsByRange[r] >= 3) ?? null;
  if (trend.sessionsInRange === 0) {
    const last = trend.lastBefore;
    chart = { kind: 'none_in_range', message: `None between ${shortDate(trend.bounds.from, today)} and ${shortDate(trend.bounds.to, today)}.${last === null ? '' : ` Last: ${shortDate(last, today)}.`}`, action: { label: 'Show all', range: 'all' } };
  } else if (trend.points.length === 0 && metric === 'e1rm' && !hasMarkedE1rmSet(series, trend.bounds)) {
    chart = { kind: 'no_eligible', message: 'No sets of 10 reps or fewer in this range.' };
  } else if (trend.points.length < 3) {
    chart = {
      kind: 'too_few',
      message: trend.points.length === 0 ? 'No counted sets in this range.' : `${countNoun(trend.points.length, 'session', 'sessions')} in this range.`,
      action: wider === null ? null : { label: wider === 'all' ? 'Show all' : `Try ${RANGE_LABEL[wider]}`, range: wider },
    };
  }

  // Range summary (nothing selected)
  const { latest, best, first } = trend.summary;
  const panel: TrendPanelLine[] = [];
  if (latest) panel.push({ label: 'Latest', value: `${valueText(latest, series, metric)} · ${shortDate(latest.date, today)}`, words: `Latest ${valueWords(latest, series, metric)}, ${longDate(latest.date, today)}.` });
  if (best) {
    const from = metric === 'e1rm' && best.fromSet ? ` (${formatNumber(best.fromSet.load?.value ?? 0)}${TIMES}${String(best.fromSet.reps ?? 0)})` : '';
    panel.push({ label: 'Best', value: `${valueText(best, series, metric)} · ${shortDate(best.date, today)}${from}`, words: `Best ${valueWords(best, series, metric)}, ${longDate(best.date, today)}${metric === 'e1rm' && best.fromSet ? `, from ${setWords(best.fromSet, series.equipmentKind)}` : ''}.` });
  }
  if (first && latest && first.sessionId !== latest.sessionId) panel.push(changeLine(first, latest, series, metric, today));

  // Chart summary for VoiceOver (§5.6)
  let chartWords: string;
  if (trend.points.length === 0) {
    chartWords = `${metricWords(metric)}, ${title} on ${label}, ${rangeWordsText}. ${chart.kind === 'chart' ? '' : chart.message}`.trim();
  } else {
    let lo = trend.points[0] as TrendPoint;
    let hi = lo;
    for (const p of trend.points) {
      if (p.value < lo.value) lo = p;
      if (p.value > hi.value) hi = p;
    }
    const gaps = trend.gaps.map((g) => `a gap of ${String(g.days)} days in ${monthName(g.to.slice(0, 7))}`);
    chartWords = [
      `${metricWords(metric)}, ${title} on ${label}, ${rangeWordsText}${trend.aggregation === 'weekly_best' ? ', weekly best' : ''}.`,
      `${countNoun(trend.points.length, trend.aggregation === 'weekly_best' ? 'week' : 'session', trend.aggregation === 'weekly_best' ? 'weeks' : 'sessions')}.`,
      `Lowest ${valueWords(lo, series, metric)} on ${longDate(lo.date, today)}, highest ${valueWords(hi, series, metric)} on ${longDate(hi.date, today)}, latest ${valueWords(latest ?? hi, series, metric)} on ${longDate((latest ?? hi).date, today)}.`,
      gaps.length === 0 ? '' : `${gaps.length === 1 ? 'One' : String(gaps.length)} ${gaps.length === 1 ? 'gap' : 'gaps'}: ${gaps.join(', ')}.`,
      markerWords(trend.markers),
      'Swipe up or down to move between sessions.',
    ]
      .filter((x) => x !== '')
      .join(' ');
  }

  // Table (every session in range, check 36): values, then the markers as words.
  const gapAt = new Map(trend.gaps.map((g) => [g.to, g.days]));
  const notCounted = new Set(trend.markers.flatMap((m) => (m.kind === 'not_counted' ? [m.sessionId] : [])));
  const rowsBySession = new Map(trend.sessionPoints.map((p) => [p.sessionId, p]));
  const tableRows: TableRowView[] = [];
  for (const ss of series.sessions) {
    if (ss.date < trend.bounds.from || ss.date > trend.bounds.to) continue;
    const p = rowsBySession.get(ss.sessionId);
    if (p === undefined && !notCounted.has(ss.sessionId)) continue;
    const notes = [gapAt.has(ss.date) ? `Gap ${String(gapAt.get(ss.date))} days` : null, ss.edited ? 'Edited' : null, notCounted.has(ss.sessionId) ? 'Not counted' : null].filter((x): x is string => x !== null);
    const value = p === undefined ? '—' : valueText(p, series, metric);
    tableRows.push({
      key: ss.sessionId,
      sessionId: ss.sessionId,
      date: shortDate(ss.date, today),
      value,
      notes: notes.join(' · '),
      words: `${weekdayLongDate(ss.date, today)}, ${p === undefined ? 'no value' : valueWords(p, series, metric)}${notes.length > 0 ? `. ${notes.join(', ')}` : ''}. Opens the workout.`,
    });
  }
  tableRows.reverse();

  // Records (PG10, PG30)
  const rec = exerciseRecords(input.sessions, series);
  const records =
    series.kind === 'timed' || series.kind === 'distance' || series.kind === 'cardio'
      ? null
      : {
          items: rec.items.map((r) => recordView(r, series, today)),
          empty: rec.items.length > 0 ? null : series.key.source === 'import' || rec.loggedSessions <= RECORD_MIN_SESSIONS ? `Records start after ${String(RECORD_MIN_SESSIONS)} logged sessions.` : 'No records yet.',
        };

  // History
  const historyMonths = Math.max(1, input.historyMonths ?? 2);
  const hist = exerciseHistory(series, historyMonths);
  const unit =
    series.kind === 'cardio' ? 'time · m' : series.kind === 'timed' ? 'min:s' : series.kind === 'bodyweight' ? 'reps' : series.kind === 'distance' ? (series.key.convention === 'bodyweight' ? 'm' : `${seriesUnitText(series)} × m`) : `${seriesUnitText(series)} × reps`;

  const statStrip = headlineView(series);
  const selectId = input.sessionId ?? input.selectSessionId ?? null;
  const selection = openedSelection(selectId, trend, points, series, metric, today);

  return {
    exerciseId: input.exerciseId,
    title,
    series: [...all]
      .sort((a, b) => (a.key.source === b.key.source ? b.sessions.length - a.sessions.length || lastMs(b) - lastMs(a) : a.key.source === 'app' ? -1 : 1))
      .map((s) => ({ id: s.id, label: labels.get(s.id) ?? '', sessionCount: s.sessions.length, menuLabel: `${labels.get(s.id) ?? ''} · ${String(s.sessions.length)}`, source: s.key.source })),
    seriesId: series.id,
    seriesLabel: label,
    seriesSource: series.key.source,
    stats: statStrip.stats,
    statsWords: statStrip.words,
    metrics: metrics.map((m) => ({ key: m, label: metricLabel(m) })),
    metric,
    ranges: TREND_RANGES.map((r) => ({ key: r, label: RANGE_LABEL[r] })),
    range,
    heading: `${metricLabel(metric)} · ${rangeText}${trend.aggregation === 'weekly_best' ? ' · weekly best' : ''}`,
    estimateInfo: metric === 'e1rm',
    axisUnit: axisUnit(series, metric),
    axisFormat: metric === 'longest_hold' ? 'duration' : 'number',
    bars: metric === 'volume',
    bounds: trend.bounds,
    chart,
    points,
    markers,
    chartWords,
    panel,
    table: { headers: ['Date', metric === 'e1rm' ? 'Est. 1RM (estimate)' : metricLabel(metric), 'Notes'], rows: tableRows },
    repTable: repTableView(series, trend.bounds, input.repBy ?? 'weight', today),
    distanceTable: distanceTableView(series, trend.bounds, today),
    records,
    history: {
      unit,
      months: hist.months.map((m) => ({ month: m.month, title: monthLabel(m.month, today), rows: m.sessions.map((s) => historyRow(s, series, today)) })),
      more: hist.nextMonth === null ? null : { label: `Load ${monthLabel(hist.nextMonth, today)}`, months: historyMonths + 1 },
    },
    pain: input.painFlag ? { flagId: input.painFlag.flagId, text: `Pain flag since ${shortDate(input.painFlag.date, today)}`, words: `Pain flag since ${longDate(input.painFlag.date, today)}. Opens the flag.` } : null,
    selectedSessionId: selection === null ? null : selectId,
    selection,
  };
}

// ---------------------------------------------------------------------------
// Exercises list (§2.6)

export interface ExerciseListRowView {
  exerciseId: string;
  name: string;
  /** `24 sessions · last 8 Oct`. */
  line: string;
  words: string;
}

export interface ExerciseListView {
  rows: ExerciseListRowView[];
  /** `All` then the 11 body-part groups (fixed order). */
  groups: { key: MuscleGroup | null; label: string }[];
  group: MuscleGroup | null;
  query: string;
  /** No exercise has a finished session yet. */
  empty: boolean;
  /** `No matches.` when the search or filter hides every row. */
  noMatches: string | null;
}

/** The groups an exercise mainly works (primary muscles), for the filter chips. */
function primaryGroups(info: MuscleInfo | undefined): Set<MuscleGroup> {
  const out = new Set<MuscleGroup>();
  if (info === undefined) return out;
  for (const [g, credit] of muscleGroupCredits(info)) if (credit === 1) out.add(g);
  return out;
}

export function buildExerciseListView(input: { sessions: readonly ProgressSession[]; exercises: ReadonlyMap<string, MuscleInfo>; today: string; query?: string; group?: MuscleGroup | null }): ExerciseListView {
  const entries: ProgressExerciseEntry[] = listProgressExercises(input.sessions);
  const q = (input.query ?? '').trim().toLowerCase();
  const group = input.group ?? null;
  const rows = entries
    .filter((e) => q === '' || e.name.toLowerCase().includes(q) || (input.exercises.get(e.exerciseId)?.name.toLowerCase().includes(q) ?? false))
    .filter((e) => group === null || primaryGroups(input.exercises.get(e.exerciseId)).has(group))
    .map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      line: `${countNoun(e.sessionCount, 'session', 'sessions')} · last ${shortDate(e.lastDate, input.today)}`,
      words: `${e.name}, ${countNoun(e.sessionCount, 'session', 'sessions')}, last ${longDate(e.lastDate, input.today)}.`,
    }));
  return {
    rows,
    groups: [{ key: null, label: 'All' }, ...MUSCLE_GROUPS.map((g) => ({ key: g, label: g }))],
    group,
    query: input.query ?? '',
    empty: entries.length === 0,
    noMatches: entries.length > 0 && rows.length === 0 ? 'No matches.' : null,
  };
}
