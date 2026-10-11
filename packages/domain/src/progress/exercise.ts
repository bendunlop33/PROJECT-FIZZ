import type { EquipmentKind, Load, LoadConvention, Measurement, WeightUnit } from '@fizz/schemas';
import { addDays, daysBetween, weekdayIndexOfDate } from '../calendar';
import { isSetCountable } from '../exclusions';
import { e1rmConventionAllowed, estimateOneRepMax } from './e1rm';
import type { ProgressExercise, ProgressSession, ProgressSet } from './projection';
import { inRange, type DateRange } from './window';

/**
 * Exercise detail metrics (progress.md slice B, §2.7, §6.2, §6.3; PG10–PG12,
 * PG15, PG21, PG28, PG29, PG31). Pure and deterministic: every function takes
 * the projected finished workouts (`toProgressSession`: finished only, so
 * active, discarded and reverted workouts and deleted or skipped sets are
 * never here) and local dates in the owner's zone.
 *
 * - **One series = one exercise + equipment instance + load convention + unit**
 *   (PG15). Imported history has no equipment (ADR 0016), so it forms its own
 *   series per convention and unit (`FitNotes · kg`), with its provenance
 *   (`source: 'import'`) carried to every point and row. Series are never merged.
 * - **Sets Ben marked** (`Spotted`, `Pain`, …) are left out of top set, Est.
 *   1RM, the rep table, records and every best or change, and counted in
 *   volume (PG21), all through `isSetCountable`.
 * - **Units and conventions** are never mixed: a set whose load isn't in the
 *   series' convention and unit is left out of the series' numbers.
 */

export type ExerciseMetric = 'e1rm' | 'top_set' | 'volume' | 'best_set' | 'longest_hold';
export type TrendRange = '3m' | '6m' | '1y' | 'all';
export const TREND_RANGES: readonly TrendRange[] = ['3m', '6m', '1y', 'all'];
export const DEFAULT_TREND_RANGE: TrendRange = '6m';

/** PG12: this many days between sessions of a series breaks the line. */
export const TREND_GAP_DAYS = 21;
/** §3.4 Long history: above this many points in range, one point per week (the week's best). */
export const TREND_MAX_POINTS = 150;
/** The rep table's `By reps` stops here (PG28). */
export const REP_TABLE_MAX_REPS = 12;
/** §2.7: the default series is the one used most in the last 12 weeks. */
export const DEFAULT_SERIES_DAYS = 84;

/**
 * What a series measures, from its convention, equipment and measurement
 * (§6.3): `load` (total, per hand, stack, plate-loaded `added`) has Est. 1RM,
 * top set and volume; `assisted` (less is better) and `added_bodyweight`
 * (`BW + 10 kg`) have a top set; `bodyweight` has the best set in reps;
 * `timed` the longest hold.
 */
export type SeriesKind = 'load' | 'assisted' | 'added_bodyweight' | 'bodyweight' | 'timed';

export interface SeriesKey {
  exerciseId: string;
  source: 'app' | 'import';
  /** Null for imported history and for rows logged with no equipment. */
  equipmentId: string | null;
  convention: LoadConvention;
  unit: WeightUnit;
  measurement: Measurement;
}

/** A stable string for a series (navigation params, remembered choice). */
export function seriesIdOf(k: SeriesKey): string {
  const eq = k.source === 'import' ? 'import' : (k.equipmentId ?? 'none');
  return [k.exerciseId, eq, k.convention, k.unit, k.measurement === 'duration' ? 'timed' : 'reps'].join('|');
}

export function seriesKind(convention: LoadConvention, equipmentKind: EquipmentKind | null, measurement: Measurement): SeriesKind {
  if (measurement === 'duration') return 'timed';
  if (convention === 'assistance') return 'assisted';
  if (convention === 'bodyweight') return 'bodyweight';
  if (convention === 'added' && equipmentKind !== 'plate_loaded_machine') return 'added_bodyweight';
  return 'load';
}

/** §6.3: the metrics a series offers, the default first (PG29). */
export function metricsFor(kind: SeriesKind): ExerciseMetric[] {
  switch (kind) {
    case 'load':
      return ['e1rm', 'top_set', 'volume'];
    case 'assisted':
    case 'added_bodyweight':
      return ['top_set'];
    case 'bodyweight':
      return ['best_set'];
    case 'timed':
      return ['longest_hold'];
  }
}

/** False only for assisted top sets: less assistance is better. */
export function higherIsBetter(kind: SeriesKind, metric: ExerciseMetric): boolean {
  return !(kind === 'assisted' && metric === 'top_set');
}

/** One workout's sets of one series (all its rows on that equipment that day). */
export interface SeriesSession {
  sessionId: string;
  date: string;
  startedMs: number;
  source: 'app' | 'import';
  /** The workout's own name; null = none given. */
  name: string | null;
  rows: readonly ProgressExercise[];
  /** Every completed set of those rows, rows in workout order. */
  sets: readonly ProgressSet[];
  /** A set was corrected after logging. */
  edited: boolean;
}

export interface ExerciseSeries {
  id: string;
  key: SeriesKey;
  kind: SeriesKind;
  equipmentKind: EquipmentKind | null;
  equipmentName: string | null;
  gymId: string | null;
  /** The latest logged name of the exercise in this series. */
  exerciseName: string;
  /** Oldest first. */
  sessions: SeriesSession[];
}

export function keyOfRow(s: ProgressSession, ex: ProgressExercise): SeriesKey {
  const source = s.source === 'import' ? 'import' : 'app';
  return { exerciseId: ex.exerciseId, source, equipmentId: source === 'import' ? null : ex.equipmentId, convention: ex.convention, unit: ex.unit, measurement: ex.measurement };
}

export const chronological = (a: { startedMs: number; sessionId: string }, b: { startedMs: number; sessionId: string }) => a.startedMs - b.startedMs || a.sessionId.localeCompare(b.sessionId);

/**
 * Every series of one exercise (PG15), each with its sessions oldest first.
 * One pass over the workouts; rows of other exercises are skipped at once.
 */
export function collectExerciseSeries(sessions: readonly ProgressSession[], exerciseId: string): ExerciseSeries[] {
  const out = new Map<string, ExerciseSeries>();
  const ordered = [...sessions].sort(chronological);
  for (const s of ordered) {
    const bySeries = new Map<string, ProgressExercise[]>();
    for (const ex of s.exercises) {
      if (ex.exerciseId !== exerciseId) continue;
      const id = seriesIdOf(keyOfRow(s, ex));
      bySeries.set(id, [...(bySeries.get(id) ?? []), ex]);
    }
    for (const [id, rows] of bySeries) {
      const first = rows[0] as ProgressExercise;
      const key = keyOfRow(s, first);
      const sets = rows.flatMap((r) => r.sets);
      if (sets.length === 0) continue;
      const entry: SeriesSession = { sessionId: s.sessionId, date: s.date, startedMs: s.startedMs, source: key.source, name: s.name, rows, sets, edited: sets.some((x) => x.edited === true) };
      const existing = out.get(id);
      const last = rows[rows.length - 1] as ProgressExercise;
      if (existing === undefined) {
        out.set(id, {
          id,
          key,
          kind: seriesKind(key.convention, first.equipmentKind, key.measurement),
          equipmentKind: first.equipmentKind,
          equipmentName: first.equipmentName ?? null,
          gymId: key.source === 'import' ? null : first.gymId,
          exerciseName: last.exerciseName,
          sessions: [entry],
        });
      } else {
        existing.sessions.push(entry);
        existing.exerciseName = last.exerciseName;
        if (first.equipmentName) existing.equipmentName = first.equipmentName;
        if (first.equipmentKind !== null) {
          existing.equipmentKind = first.equipmentKind;
          existing.kind = seriesKind(key.convention, first.equipmentKind, key.measurement);
        }
        if (key.source === 'app' && first.gymId !== null) existing.gymId = first.gymId;
      }
    }
  }
  return [...out.values()];
}

/** §2.7 series menu default: the series used most in the last 12 weeks; else (and on ties) the most recent. */
export function defaultSeries(series: readonly ExerciseSeries[], today: string): ExerciseSeries | null {
  const since = addDays(today, -(DEFAULT_SERIES_DAYS - 1));
  let best: { s: ExerciseSeries; recent: number; lastMs: number } | null = null;
  for (const s of series) {
    const recent = s.sessions.filter((x) => x.date >= since && x.date <= today).length;
    const lastMs = s.sessions[s.sessions.length - 1]?.startedMs ?? 0;
    if (best === null || recent > best.recent || (recent === best.recent && lastMs > best.lastMs)) best = { s, recent, lastMs };
  }
  return best?.s ?? null;
}

// ---------------------------------------------------------------------------
// Per-session values

type Loaded = ProgressSet & { load: Load; reps: number };

/** A non-warm-up set of the series' convention and unit, with load and at least 1 rep. */
function loadedSet(s: ProgressSet, key: SeriesKey): s is Loaded {
  return s.setType !== 'warmup' && s.load !== null && s.reps !== null && s.reps >= 1 && s.load.convention === key.convention && s.load.unit === key.unit;
}

/** PG21: counts for top set, Est. 1RM, rep table, records and every best or change. */
const counts = (s: ProgressSet) => isSetCountable(s, 'e1rm');

export interface MetricValue {
  value: number;
  kind: 'actual' | 'estimate';
  /** The set the value came from; null for volume (a sum). */
  fromSet: ProgressSet | null;
}

/** Heavier is better, then more reps; for assistance, lighter is better, then more reps. */
function betterTop(a: Loaded, b: Loaded | null, lowerWins: boolean): boolean {
  if (b === null) return true;
  if (a.load.value !== b.load.value) return lowerWins ? a.load.value < b.load.value : a.load.value > b.load.value;
  return a.reps > b.reps;
}

/** PG11: the session's single best eligible set's Est. 1RM (never averaged). */
export function sessionE1rm(ss: SeriesSession, series: Pick<ExerciseSeries, 'key' | 'kind' | 'equipmentKind'>): MetricValue | null {
  if (series.kind !== 'load' || !e1rmConventionAllowed(series.key.convention, series.equipmentKind)) return null;
  let best: { value: number; set: Loaded } | null = null;
  for (const s of ss.sets) {
    if (!loadedSet(s, series.key) || !counts(s)) continue;
    const e = estimateOneRepMax(s.load, s.reps, series.equipmentKind);
    if (!e.eligible) continue;
    if (best === null || e.value > best.value || (e.value === best.value && s.load.value > best.set.load.value)) best = { value: e.value, set: s };
  }
  return best === null ? null : { value: best.value, kind: 'estimate', fromSet: best.set };
}

/** Top set: heaviest (least assistance for assisted), then most reps. Countable sets only. */
export function sessionTopSet(ss: SeriesSession, series: Pick<ExerciseSeries, 'key' | 'kind'>): MetricValue | null {
  if (series.kind !== 'load' && series.kind !== 'assisted' && series.kind !== 'added_bodyweight') return null;
  const lowerWins = series.kind === 'assisted';
  let best: Loaded | null = null;
  for (const s of ss.sets) if (loadedSet(s, series.key) && counts(s) && betterTop(s, best, lowerWins)) best = s;
  return best === null ? null : { value: best.load.value, kind: 'actual', fromSet: best };
}

/** Bodyweight `Best set`: the most reps in one countable set. */
export function sessionBestSet(ss: SeriesSession): MetricValue | null {
  let best: ProgressSet | null = null;
  for (const s of ss.sets) if (s.setType !== 'warmup' && counts(s) && s.reps !== null && s.reps >= 1 && (best === null || s.reps > (best.reps ?? 0))) best = s;
  return best === null ? null : { value: best.reps ?? 0, kind: 'actual', fromSet: best };
}

/** Timed `Longest hold`, seconds. */
export function sessionLongestHold(ss: SeriesSession): MetricValue | null {
  let best: ProgressSet | null = null;
  for (const s of ss.sets) if (s.setType !== 'warmup' && counts(s) && s.durationS !== null && s.durationS > 0 && (best === null || s.durationS > (best.durationS ?? 0))) best = s;
  return best === null ? null : { value: best.durationS ?? 0, kind: 'actual', fromSet: best };
}

/**
 * PG31 volume: Σ load × reps over completed non-warm-up sets, marked sets
 * included (the work was done). Per-dumbbell loads stay per hand. A
 * unilateral row counts its `both` sets plus the busier side, never the two
 * sides added. Only for `load` series.
 */
export function sessionVolume(ss: SeriesSession, series: Pick<ExerciseSeries, 'key' | 'kind'>): MetricValue | null {
  if (series.kind !== 'load') return null;
  let total = 0;
  let used = 0;
  const sum = (xs: readonly ProgressSet[]): number => {
    let acc = 0;
    for (const s of xs) {
      if (!loadedSet(s, series.key) || !isSetCountable(s, 'volume')) continue;
      used += 1;
      acc += s.load.value * s.reps;
    }
    return acc;
  };
  for (const row of ss.rows) {
    if (row.laterality === 'bilateral') {
      total += sum(row.sets);
    } else {
      total += sum(row.sets.filter((s) => s.side === 'both' || s.side === null));
      total += Math.max(sum(row.sets.filter((s) => s.side === 'left')), sum(row.sets.filter((s) => s.side === 'right')));
    }
  }
  return used > 0 ? { value: Math.round(total * 100) / 100, kind: 'actual', fromSet: null } : null;
}

export function sessionMetric(ss: SeriesSession, series: Pick<ExerciseSeries, 'key' | 'kind' | 'equipmentKind'>, metric: ExerciseMetric): MetricValue | null {
  switch (metric) {
    case 'e1rm':
      return sessionE1rm(ss, series);
    case 'top_set':
      return sessionTopSet(ss, series);
    case 'volume':
      return sessionVolume(ss, series);
    case 'best_set':
      return series.kind === 'bodyweight' ? sessionBestSet(ss) : null;
    case 'longest_hold':
      return series.kind === 'timed' ? sessionLongestHold(ss) : null;
  }
}

/** Non-warm-up sets Ben marked in this session (shown on the point). */
function markedCount(ss: SeriesSession): number {
  return ss.sets.filter((s) => s.setType !== 'warmup' && !counts(s)).length;
}

/** Every non-warm-up set was marked: no point, marker `Not counted` (PG21). */
function allMarked(ss: SeriesSession): boolean {
  const working = ss.sets.filter((s) => s.setType !== 'warmup');
  return working.length > 0 && working.every((s) => !counts(s));
}

// ---------------------------------------------------------------------------
// Ranges

/** `YYYY-MM-DD` plus whole months, the day clamped to the month's length. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = (y ?? 1970) * 12 + ((m ?? 1) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = daysBetween(`${pad4(year)}-${pad2(month)}-01`, month === 12 ? `${pad4(year + 1)}-01-01` : `${pad4(year)}-${pad2(month + 1)}-01`);
  return `${pad4(year)}-${pad2(month)}-${pad2(Math.min(d ?? 1, last))}`;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

/**
 * The chart range, ending today inclusive: `6 mo` on 8 Oct is 9 Apr – 8 Oct.
 * `All` starts at the series' first session (or today with none).
 */
export function trendRangeBounds(range: TrendRange, today: string, firstDate: string | null): DateRange {
  switch (range) {
    case '3m':
      return { from: addDays(addMonths(today, -3), 1), to: today };
    case '6m':
      return { from: addDays(addMonths(today, -6), 1), to: today };
    case '1y':
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case 'all':
      return { from: firstDate !== null && firstDate < today ? firstDate : today, to: today };
  }
}

// ---------------------------------------------------------------------------
// Trend

export interface TrendPoint {
  sessionId: string;
  date: string;
  /** The workout's name (null = none given). */
  name: string | null;
  value: number;
  kind: 'actual' | 'estimate';
  fromSet: ProgressSet | null;
  source: 'app' | 'import';
  /** Non-warm-up sets Ben marked in this session (left out of the value unless the metric is volume). */
  excludedSets: number;
  edited: boolean;
  /** A gap (PG12) lies between the previous point and this one: the line breaks. */
  breakBefore: boolean;
}

export interface TrendGap {
  /** The session before the gap and the one after it. */
  from: string;
  to: string;
  days: number;
}

export type TrendMarker = { kind: 'gap'; date: string; from: string; days: number } | { kind: 'edited'; date: string; sessionId: string } | { kind: 'not_counted'; date: string; sessionId: string };

export interface ExerciseTrend {
  metric: ExerciseMetric;
  range: TrendRange;
  bounds: DateRange;
  /** Oldest first; one per session, or one per week (`weekly_best`). */
  points: TrendPoint[];
  /** One per session in range with a value, oldest first (the table lists every session, check 36). */
  sessionPoints: TrendPoint[];
  gaps: TrendGap[];
  markers: TrendMarker[];
  aggregation: 'session' | 'weekly_best';
  /** Sessions of the series inside the range (with or without a value). */
  sessionsInRange: number;
  /** The last session before the range, when there is none in it (`Last: 2 Feb`). */
  lastBefore: string | null;
  summary: { latest: TrendPoint | null; best: TrendPoint | null; first: TrendPoint | null };
  higherIsBetter: boolean;
  /** Points each range would have (`Try 1 yr` when a wider range has ≥ 3). */
  pointsByRange: Record<TrendRange, number>;
}

function pointsOf(series: ExerciseSeries, metric: ExerciseMetric, within: (date: string) => boolean): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const ss of series.sessions) {
    if (!within(ss.date)) continue;
    const v = sessionMetric(ss, series, metric);
    if (v === null) continue;
    out.push({ sessionId: ss.sessionId, date: ss.date, name: ss.name, value: v.value, kind: v.kind, fromSet: v.fromSet, source: ss.source, excludedSets: markedCount(ss), edited: ss.edited, breakBefore: false });
  }
  return out;
}

function better(a: TrendPoint, b: TrendPoint | null, higher: boolean): boolean {
  if (b === null) return true;
  if (a.value !== b.value) return higher ? a.value > b.value : a.value < b.value;
  // A tie keeps the earlier one (the record date), except an equal top set with more reps.
  const ra = a.fromSet?.reps ?? 0;
  const rb = b.fromSet?.reps ?? 0;
  return ra > rb;
}

/** Monday of a date's week (weeks run Monday–Sunday, PG16). */
export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndexOfDate(date));
}

/**
 * `exerciseTrend` (§6.2): one point per session (its best eligible value,
 * never smoothed), gaps, markers, the range summary and, above
 * `TREND_MAX_POINTS`, one point per week (the week's best).
 */
export function exerciseTrend(series: ExerciseSeries, metric: ExerciseMetric, range: TrendRange, today: string): ExerciseTrend {
  const firstDate = series.sessions[0]?.date ?? null;
  const bounds = trendRangeBounds(range, today, firstDate);
  const within = (d: string) => inRange(d, bounds);
  const higher = higherIsBetter(series.kind, metric);
  const inside = series.sessions.filter((s) => within(s.date));

  const gaps: TrendGap[] = [];
  for (let i = 1; i < inside.length; i += 1) {
    const a = inside[i - 1] as SeriesSession;
    const b = inside[i] as SeriesSession;
    const days = daysBetween(a.date, b.date);
    if (days >= TREND_GAP_DAYS) gaps.push({ from: a.date, to: b.date, days });
  }
  const markers: TrendMarker[] = gaps.map((g) => ({ kind: 'gap' as const, date: g.to, from: g.from, days: g.days }));
  for (const s of inside) {
    if (s.edited) markers.push({ kind: 'edited', date: s.date, sessionId: s.sessionId });
    if (metric !== 'volume' && allMarked(s)) markers.push({ kind: 'not_counted', date: s.date, sessionId: s.sessionId });
  }
  markers.sort((a, b) => a.date.localeCompare(b.date));

  const sessionPoints = pointsOf(series, metric, within);
  let points = sessionPoints;
  let aggregation: ExerciseTrend['aggregation'] = 'session';
  if (sessionPoints.length > TREND_MAX_POINTS) {
    aggregation = 'weekly_best';
    const weeks = new Map<string, TrendPoint>();
    for (const p of sessionPoints) {
      const w = mondayOf(p.date);
      const cur = weeks.get(w) ?? null;
      if (better(p, cur, higher)) weeks.set(w, p);
    }
    points = [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  const withBreaks = (ps: TrendPoint[]) =>
    ps.map((p, i) => {
      const prev = i > 0 ? ps[i - 1] : undefined;
      return { ...p, breakBefore: prev !== undefined && gaps.some((g) => g.from >= prev.date && g.to <= p.date) };
    });
  points = withBreaks(points);
  const sessionRows = withBreaks(sessionPoints);

  let best: TrendPoint | null = null;
  for (const p of points) if (better(p, best, higher)) best = p;
  const before = series.sessions.filter((s) => s.date < bounds.from);
  const pointsByRange = Object.fromEntries(
    TREND_RANGES.map((r) => {
      const b = trendRangeBounds(r, today, firstDate);
      return [r, pointsOf(series, metric, (d) => inRange(d, b)).length];
    }),
  ) as Record<TrendRange, number>;

  return {
    metric,
    range,
    bounds,
    points,
    sessionPoints: sessionRows,
    gaps,
    markers,
    aggregation,
    sessionsInRange: inside.length,
    lastBefore: inside.length === 0 ? (before[before.length - 1]?.date ?? null) : null,
    summary: { latest: points[points.length - 1] ?? null, best, first: points[0] ?? null },
    higherIsBetter: higher,
    pointsByRange,
  };
}

// ---------------------------------------------------------------------------
// Rep table (PG28)

export interface RepByWeightRow {
  load: number;
  reps: number;
  date: string;
  sessionId: string;
  source: 'app' | 'import';
}

export interface RepByRepsRow {
  reps: number;
  /** Null: no set of at least this many reps (never past the last done count). */
  load: number | null;
  /** The set's own reps when it has more than `reps` (`from 6 reps`); null when exact. */
  fromReps: number | null;
  date: string | null;
  sessionId: string | null;
  source: 'app' | 'import' | null;
}

/** §6.3: the rep table exists for load, assisted and BW + added series. */
export function hasRepTable(kind: SeriesKind): boolean {
  return kind === 'load' || kind === 'assisted' || kind === 'added_bodyweight';
}

/**
 * By weight: one row per load used, the most reps in one set at that load and
 * the first date it was done; heaviest first (assisted: least assistance
 * first). Actual, countable sets only (PG21).
 */
export function repTableByWeight(series: ExerciseSeries, bounds: DateRange): RepByWeightRow[] {
  if (!hasRepTable(series.kind)) return [];
  const byLoad = new Map<number, RepByWeightRow>();
  for (const ss of series.sessions) {
    if (!inRange(ss.date, bounds)) continue;
    for (const s of ss.sets) {
      if (!loadedSet(s, series.key) || !counts(s)) continue;
      const cur = byLoad.get(s.load.value);
      if (cur === undefined || s.reps > cur.reps) byLoad.set(s.load.value, { load: s.load.value, reps: s.reps, date: ss.date, sessionId: ss.sessionId, source: ss.source });
    }
  }
  const lowerFirst = series.kind === 'assisted';
  return [...byLoad.values()].sort((a, b) => (lowerFirst ? a.load - b.load : b.load - a.load));
}

/**
 * By reps (rep records): for each rep count from 1 to the most done (at most
 * 12), the heaviest load lifted for **at least** that many reps (assisted:
 * the least assistance). A heavier or equal load at more reps supersedes:
 * 100 × 8 is also the 7RM (`from 8 reps`).
 */
export function repTableByReps(series: ExerciseSeries, bounds: DateRange): RepByRepsRow[] {
  const byWeight = repTableByWeight(series, bounds);
  if (byWeight.length === 0) return [];
  const maxDone = Math.min(REP_TABLE_MAX_REPS, Math.max(...byWeight.map((r) => r.reps)));
  const lowerWins = series.kind === 'assisted';
  const rows: RepByRepsRow[] = [];
  for (let reps = 1; reps <= maxDone; reps += 1) {
    let best: RepByWeightRow | null = null;
    for (const w of byWeight) {
      if (w.reps < reps) continue;
      const wins = best === null || (w.load !== best.load ? (lowerWins ? w.load < best.load : w.load > best.load) : w.reps > best.reps || (w.reps === best.reps && w.date < best.date));
      if (wins) best = w;
    }
    rows.push(
      best === null
        ? { reps, load: null, fromReps: null, date: null, sessionId: null, source: null }
        : { reps, load: best.load, fromReps: best.reps > reps ? best.reps : null, date: best.date, sessionId: best.sessionId, source: best.source },
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Headline (StatStrip, all time)

export interface ExerciseHeadline {
  sessions: number;
  /** Load series: the best session Est. 1RM (an estimate). */
  bestE1rm: { value: number; date: string; sessionId: string; fromSet: ProgressSet } | null;
  /** Heaviest set (load, BW + added) or least assistance (assisted). */
  bestSet: { set: Loaded; date: string; sessionId: string } | null;
  /** Most reps in one set (assisted, BW + added, bodyweight). */
  mostReps: { reps: number; date: string; sessionId: string } | null;
  /** Timed: the longest hold, seconds. */
  longestHold: { seconds: number; date: string; sessionId: string } | null;
}

/** `exerciseHeadline` (§6.2): all-time bests of the series, countable sets only (PG21). */
export function exerciseHeadline(series: ExerciseSeries): ExerciseHeadline {
  const out: ExerciseHeadline = { sessions: series.sessions.length, bestE1rm: null, bestSet: null, mostReps: null, longestHold: null };
  const lowerWins = series.kind === 'assisted';
  for (const ss of series.sessions) {
    const e = sessionE1rm(ss, series);
    if (e !== null && e.fromSet !== null && (out.bestE1rm === null || e.value > out.bestE1rm.value)) out.bestE1rm = { value: e.value, date: ss.date, sessionId: ss.sessionId, fromSet: e.fromSet };
    for (const s of ss.sets) {
      if (s.setType === 'warmup' || !counts(s)) continue;
      if (loadedSet(s, series.key) && (series.kind === 'load' || series.kind === 'assisted' || series.kind === 'added_bodyweight')) {
        if (betterTop(s, out.bestSet?.set ?? null, lowerWins)) out.bestSet = { set: s, date: ss.date, sessionId: ss.sessionId };
      }
      if (s.reps !== null && s.reps >= 1 && series.kind !== 'load' && series.kind !== 'timed' && (out.mostReps === null || s.reps > out.mostReps.reps)) {
        out.mostReps = { reps: s.reps, date: ss.date, sessionId: ss.sessionId };
      }
      if (series.kind === 'timed' && s.durationS !== null && s.durationS > 0 && (out.longestHold === null || s.durationS > out.longestHold.seconds)) {
        out.longestHold = { seconds: s.durationS, date: ss.date, sessionId: ss.sessionId };
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// History (§2.7 region 13)

export interface HistoryMonth {
  /** `YYYY-MM`. */
  month: string;
  sessions: SeriesSession[];
}

/**
 * `exerciseHistory` (§6.2): the series' sessions by month, newest first, the
 * newest `months` months that have sessions, and the next older month (for
 * `Load September`), or null at the start of the history.
 */
export function exerciseHistory(series: ExerciseSeries, months: number): { months: HistoryMonth[]; nextMonth: string | null } {
  const byMonth = new Map<string, SeriesSession[]>();
  for (let i = series.sessions.length - 1; i >= 0; i -= 1) {
    const s = series.sessions[i] as SeriesSession;
    const m = s.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), s]);
  }
  const all = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const shown = all.slice(0, Math.max(1, months)).map(([month, sessions]) => ({ month, sessions }));
  return { months: shown, nextMonth: all[shown.length]?.[0] ?? null };
}

// ---------------------------------------------------------------------------
// Exercises list (§2.6)

export interface ProgressExerciseEntry {
  exerciseId: string;
  /** The latest logged name. */
  name: string;
  sessionCount: number;
  lastDate: string;
  lastMs: number;
}

/** Exercises with ≥ 1 finished session (logged or imported), most recently done first. */
export function listProgressExercises(sessions: readonly ProgressSession[]): ProgressExerciseEntry[] {
  const out = new Map<string, ProgressExerciseEntry>();
  for (const s of sessions) {
    const seen = new Set<string>();
    for (const ex of s.exercises) {
      if (ex.sets.length === 0 || seen.has(ex.exerciseId)) continue;
      seen.add(ex.exerciseId);
      const cur = out.get(ex.exerciseId);
      if (cur === undefined) out.set(ex.exerciseId, { exerciseId: ex.exerciseId, name: ex.exerciseName, sessionCount: 1, lastDate: s.date, lastMs: s.startedMs });
      else {
        cur.sessionCount += 1;
        if (s.startedMs > cur.lastMs) {
          cur.lastMs = s.startedMs;
          cur.lastDate = s.date;
          cur.name = ex.exerciseName;
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => b.lastMs - a.lastMs || a.name.localeCompare(b.name));
}
