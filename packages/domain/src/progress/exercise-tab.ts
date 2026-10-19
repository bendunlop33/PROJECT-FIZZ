import type { ProgressPeriodKey } from '@fizz/schemas';

import { formatDistance, formatDuration, formatNumber, loadText, NBSP } from '../display';
import { isSetCountable } from '../exclusions';
import {
  collectExerciseSeries,
  sessionBestDistance,
  sessionE1rm,
  sessionLongestHold,
  sessionTopSet,
  sessionVolume,
  type ExerciseSeries,
  type SeriesKind,
  type SeriesSession,
} from './exercise';
import { cardioSetText, longDate, seriesLabels, seriesUnitText, shortDate, thousands, weekdayLongDate } from './exercise-view';
import { countRowSets } from './muscles';
import type { ProgressSession, ProgressSet } from './projection';
import { countNoun, rangeWords } from './text';
import { inRange, periodProgressWindow, PROGRESS_PERIODS, type DateRange } from './window';

/**
 * Progress › Exercises tab (Ben, 13–14 Oct 2026; ideas-2026-10-12 D3 and
 * "Progress › Exercises"). One exercise, one measure, one period: a stat
 * line, a line chart with a dashed trailing average, and a sessions table.
 * Pure; reuses the slice-B series (PG15: one exercise + equipment +
 * convention + unit, imported FitNotes history its own series) and the
 * per-session metrics in `exercise.ts`. Estimates carry `≈` and `Est.`.
 */

export type ExerciseMeasure = 'e1rm' | 'weight' | 'reps' | 'top_set' | 'hold' | 'distance';

export const TRAILING_OPTIONS: readonly number[] = [3, 5, 10, 20];
export const DEFAULT_TRAILING = 5;
export const TRAILING_MIN = 2;
export const TRAILING_MAX = 50;

/** The measures a series offers, the default first. */
export function measuresFor(kind: SeriesKind): ExerciseMeasure[] {
  switch (kind) {
    case 'load':
      return ['e1rm', 'weight', 'reps', 'top_set'];
    case 'assisted':
    case 'added_bodyweight':
      return ['weight', 'reps', 'top_set'];
    case 'bodyweight':
      return ['reps'];
    case 'timed':
      return ['hold'];
    case 'distance':
    case 'cardio':
      return ['distance'];
  }
}

export function measureLabel(m: ExerciseMeasure): string {
  switch (m) {
    case 'e1rm':
      return 'Est. 1RM';
    case 'weight':
      return 'Weight';
    case 'reps':
      return 'Reps';
    case 'top_set':
      return 'Top set';
    case 'hold':
      return 'Longest hold';
    case 'distance':
      return 'Best distance';
  }
}

/** A typed number from `Other`: a whole number of sessions, `TRAILING_MIN`–`TRAILING_MAX`; null otherwise. */
export function parseTrailing(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= TRAILING_MIN && n <= TRAILING_MAX ? n : null;
}

/** Any trailing count made valid (the default for anything out of range). */
export function normaliseTrailing(n: number | null | undefined): number {
  return n !== null && n !== undefined && Number.isInteger(n) && n >= TRAILING_MIN && n <= TRAILING_MAX ? n : DEFAULT_TRAILING;
}

/**
 * The trailing average of the last `n` values, each value included: index i
 * averages values[max(0, i−n+1)..i] (fewer at the start). Rounded to 2 dp.
 */
export function trailingAverage(values: readonly number[], n: number): number[] {
  const k = Math.max(1, Math.floor(n));
  const out: number[] = [];
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= k) sum -= values[i - k] as number;
    out.push(Math.round((sum / Math.min(k, i + 1)) * 100) / 100);
  });
  return out;
}

type Loaded = ProgressSet & { load: NonNullable<ProgressSet['load']>; reps: number };

/** A countable non-warm-up set in the series' convention and unit, with at least 1 rep. */
function workingLoaded(s: ProgressSet, series: Pick<ExerciseSeries, 'key'>): s is Loaded {
  return s.setType !== 'warmup' && isSetCountable(s, 'e1rm') && s.load !== null && s.reps !== null && s.reps >= 1 && s.load.convention === series.key.convention && s.load.unit === series.key.unit;
}

/**
 * Working weight: the load used for the most countable working sets; a tie
 * goes to the harder load (heavier; less assistance on assisted machines).
 * A left + right pair counts once, as in `workingSetCount` and
 * `sessionVolume` (the busier side per load). Returns the load and how many
 * sets used it; null with no loaded sets.
 */
export function workingWeight(ss: Pick<SeriesSession, 'rows'>, series: Pick<ExerciseSeries, 'key' | 'kind'>): { value: number; sets: number } | null {
  if (series.kind !== 'load' && series.kind !== 'assisted' && series.kind !== 'added_bodyweight') return null;
  const byLoad = new Map<number, number>();
  const tally = (sets: readonly ProgressSet[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const s of sets) if (workingLoaded(s, series)) m.set(s.load.value, (m.get(s.load.value) ?? 0) + 1);
    return m;
  };
  const add = (m: Map<number, number>) => {
    for (const [v, c] of m) byLoad.set(v, (byLoad.get(v) ?? 0) + c);
  };
  for (const row of ss.rows) {
    if (row.laterality === 'bilateral') {
      add(tally(row.sets));
      continue;
    }
    add(tally(row.sets.filter((s) => s.side === 'both' || s.side === null)));
    const left = tally(row.sets.filter((s) => s.side === 'left'));
    const right = tally(row.sets.filter((s) => s.side === 'right'));
    const sides = new Map<number, number>();
    for (const v of new Set([...left.keys(), ...right.keys()])) sides.set(v, Math.max(left.get(v) ?? 0, right.get(v) ?? 0));
    add(sides);
  }
  const lowerWins = series.kind === 'assisted';
  let best: { value: number; sets: number } | null = null;
  for (const [value, sets] of byLoad) {
    const harder = best !== null && (lowerWins ? value < best.value : value > best.value);
    if (best === null || sets > best.sets || (sets === best.sets && harder)) best = { value, sets };
  }
  return best;
}

/** The most reps in one countable working set (loaded sets in the series' unit for loaded series). */
export function mostReps(ss: Pick<SeriesSession, 'sets'>, series: Pick<ExerciseSeries, 'key' | 'kind'>): ProgressSet | null {
  let best: ProgressSet | null = null;
  for (const s of ss.sets) {
    if (s.setType === 'warmup' || !isSetCountable(s, 'e1rm') || s.reps === null || s.reps < 1) continue;
    if (series.kind !== 'bodyweight' && !workingLoaded(s, series)) continue;
    if (best === null || s.reps > (best.reps ?? 0)) best = s;
  }
  return best;
}

/** Working sets in the session (non-warm-up; a left + right pair counts once). */
export function workingSetCount(ss: Pick<SeriesSession, 'rows'>): number {
  let n = 0;
  for (const r of ss.rows) {
    const c = countRowSets(r);
    n += c.hard + c.easy;
  }
  return n;
}

interface MeasureValue {
  value: number;
  /** `≈118 kg`, `100 kg`, `8 reps`, `105 kg × 3`, `1:30`. */
  text: string;
  estimate: boolean;
}

const TIMES = `${NBSP}×${NBSP}`;

function loadOnly(value: number, series: ExerciseSeries): string {
  const load = { value, unit: series.key.unit, convention: series.key.convention };
  return loadText(load, series.key.convention, series.equipmentKind === null ? null : { kind: series.equipmentKind });
}

function setText(s: ProgressSet, series: ExerciseSeries): string {
  if (s.load === null || s.reps === null) return s.reps === null ? '—' : countNoun(s.reps, 'rep', 'reps');
  return `${loadOnly(s.load.value, series)}${TIMES}${String(s.reps)}`;
}

/** One session's value for a measure; null when the session has nothing for it. */
export function measureValue(ss: SeriesSession, series: ExerciseSeries, measure: ExerciseMeasure): MeasureValue | null {
  switch (measure) {
    case 'e1rm': {
      const e = sessionE1rm(ss, series);
      return e === null ? null : { value: e.value, text: `≈${formatNumber(e.value)}${NBSP}${seriesUnitText(series)}`, estimate: true };
    }
    case 'weight': {
      const w = workingWeight(ss, series);
      return w === null ? null : { value: w.value, text: loadOnly(w.value, series), estimate: false };
    }
    case 'reps': {
      const r = mostReps(ss, series);
      return r === null || r.reps === null ? null : { value: r.reps, text: countNoun(r.reps, 'rep', 'reps'), estimate: false };
    }
    case 'top_set': {
      const t = sessionTopSet(ss, series);
      return t === null || t.fromSet === null ? null : { value: t.value, text: setText(t.fromSet, series), estimate: false };
    }
    case 'hold': {
      const h = sessionLongestHold(ss);
      return series.kind !== 'timed' || h === null ? null : { value: h.value, text: formatDuration(h.value), estimate: false };
    }
    case 'distance': {
      const d = sessionBestDistance(ss, series);
      if (d === null) return null;
      return { value: d.value, text: series.kind === 'cardio' && d.fromSet !== null ? cardioSetText(d.fromSet, series) : formatDistance(d.value), estimate: false };
    }
  }
}

function measureUnit(series: ExerciseSeries, measure: ExerciseMeasure): string {
  switch (measure) {
    case 'e1rm':
    case 'weight':
    case 'top_set':
      return seriesUnitText(series);
    case 'reps':
      return 'reps';
    case 'hold':
      return 'min:s';
    case 'distance':
      return 'm';
  }
}

export interface ExerciseTabPoint {
  sessionId: string;
  date: string;
  value: number;
  /** The trailing average at this session (over the last N sessions with a value, earlier ones before the period included). */
  average: number;
  /** `8 Oct · Est. 1RM ≈118 kg`. */
  readout: string;
  words: string;
}

export interface ExerciseTabRow {
  sessionId: string;
  date: string;
  cells: { date: string; topSet: string; volume: string; sets: string; e1rm: string };
  /** The chart readout for this session: its point's, or `8 Oct · Est. 1RM —` when it has no value for the measure. */
  readout: string;
  words: string;
}

export interface ExerciseTabView {
  exerciseId: string;
  title: string;
  /** Shown only with more than one (PG15: never merged). */
  series: { id: string; label: string }[];
  seriesId: string;
  measures: { key: ExerciseMeasure; label: string }[];
  measure: ExerciseMeasure;
  measureLabel: string;
  trailing: number;
  stats: { value: string; label: string }[];
  statsWords: string;
  chart: {
    from: string;
    to: string;
    unit: string;
    format: 'number' | 'duration';
    points: ExerciseTabPoint[];
    words: string;
  };
  /** Newest first. `unit` carries the convention: `kg`, `kg each`, `kg stack`, `kg assist`, `reps`. */
  table: { unit: string; rows: ExerciseTabRow[] };
  /** No session of this series in the period, or none with a value for the measure. */
  empty: string | null;
}

export interface ExerciseTabInput {
  sessions: readonly ProgressSession[];
  exerciseId: string;
  today: string;
  window: DateRange;
  gymNames?: Readonly<Record<string, string>>;
  /** The catalogue or custom name. */
  name?: string;
  seriesId?: string | null;
  /** Open on the series holding this workout (a home record), ahead of `seriesId`. */
  sessionId?: string | null;
  /** With `sessionId`: the workout row, when the exercise is on two rows. */
  sessionExerciseId?: string | null;
  measure?: ExerciseMeasure | null;
  trailing?: number | null;
}

function openSeries(all: readonly ExerciseSeries[], input: ExerciseTabInput): ExerciseSeries | undefined {
  if (!input.sessionId) return undefined;
  const hit = all.filter((s) => s.sessions.some((x) => x.sessionId === input.sessionId));
  const onRow = input.sessionExerciseId ? hit.find((s) => s.sessions.some((x) => x.sessionId === input.sessionId && x.rows.some((r) => r.sessionExerciseId === input.sessionExerciseId))) : undefined;
  return onRow ?? hit[0];
}

/**
 * The period that shows a workout opened from a record: the asked preset
 * when it holds the date, else the narrowest wider preset, else a custom
 * period from that date to today.
 */
export function periodHolding(date: string, today: string, period: ProgressPeriodKey): { period: ProgressPeriodKey; range: DateRange | null } {
  const holds = (k: ProgressPeriodKey) => inRange(date, periodProgressWindow(today, k));
  const keys = PROGRESS_PERIODS.map((p) => p.key);
  const wider = keys.slice(keys.indexOf(period)).find(holds);
  return wider ? { period: wider, range: null } : { period, range: { from: date, to: today } };
}

/** The series shown by default: most sessions in the period (imports count), then the most recent. */
export function exerciseTabSeries(series: readonly ExerciseSeries[], window: DateRange): ExerciseSeries | null {
  let best: { s: ExerciseSeries; n: number; last: number } | null = null;
  for (const s of series) {
    const n = s.sessions.filter((x) => inRange(x.date, window)).length;
    const last = s.sessions[s.sessions.length - 1]?.startedMs ?? 0;
    if (best === null || n > best.n || (n === best.n && last > best.last)) best = { s, n, last };
  }
  return best?.s ?? null;
}

function bestSetStat(sessions: readonly SeriesSession[], series: ExerciseSeries): string | null {
  if (series.kind === 'load' || series.kind === 'assisted' || series.kind === 'added_bodyweight') {
    const lowerWins = series.kind === 'assisted';
    let best: ProgressSet | null = null;
    for (const ss of sessions) {
      const t = sessionTopSet(ss, series)?.fromSet ?? null;
      if (t === null || t.load === null) continue;
      const b = best?.load ?? null;
      if (best === null || b === null || (t.load.value !== b.value ? (lowerWins ? t.load.value < b.value : t.load.value > b.value) : (t.reps ?? 0) > (best.reps ?? 0))) best = t;
    }
    return best === null ? null : setText(best, series);
  }
  const m: ExerciseMeasure = series.kind === 'bodyweight' ? 'reps' : series.kind === 'timed' ? 'hold' : 'distance';
  let best: MeasureValue | null = null;
  for (const ss of sessions) {
    const v = measureValue(ss, series, m);
    if (v !== null && (best === null || v.value > best.value)) best = v;
  }
  return best?.text ?? null;
}

/** The Exercises tab for one exercise; null when it has no finished session. */
export function buildExerciseTabView(input: ExerciseTabInput): ExerciseTabView | null {
  const all = collectExerciseSeries(input.sessions, input.exerciseId);
  const series = openSeries(all, input) ?? (input.seriesId ? all.find((s) => s.id === input.seriesId) : undefined) ?? exerciseTabSeries(all, input.window);
  if (series === null) return null;
  const labels = seriesLabels(all, input.gymNames ?? {});
  const offered = measuresFor(series.kind);
  // The default is the first measure with a point (review B1): sets over 10 reps have no Est. 1RM, so isolation work opens on Weight.
  const has = (m: ExerciseMeasure, inPeriod: boolean) => series.sessions.some((ss) => (!inPeriod || inRange(ss.date, input.window)) && measureValue(ss, series, m) !== null);
  const measure = input.measure && offered.includes(input.measure) ? input.measure : (offered.find((m) => has(m, true)) ?? offered.find((m) => has(m, false)) ?? offered[0] ?? 'reps');
  const trailing = normaliseTrailing(input.trailing);
  const label = measureLabel(measure);

  // The trailing average runs over every session with a value, so the period's first points average earlier sessions too.
  const valued = series.sessions.map((ss) => ({ ss, v: measureValue(ss, series, measure) })).filter((x): x is { ss: SeriesSession; v: MeasureValue } => x.v !== null);
  const averages = trailingAverage(
    valued.map((x) => x.v.value),
    trailing,
  );
  const points: ExerciseTabPoint[] = [];
  valued.forEach((x, i) => {
    if (!inRange(x.ss.date, input.window)) return;
    const date = shortDate(x.ss.date, input.today);
    points.push({
      sessionId: x.ss.sessionId,
      date: x.ss.date,
      value: x.v.value,
      average: averages[i] ?? x.v.value,
      readout: `${date} · ${label} ${x.v.text}`,
      words: `${weekdayLongDate(x.ss.date, input.today)}, ${label}${x.v.estimate ? ', an estimate,' : ''} ${x.v.text.replace('≈', 'about ')}`,
    });
  });

  const inWindow = series.sessions.filter((ss) => inRange(ss.date, input.window));
  const stats: { value: string; label: string }[] = [];
  if (offered.includes('e1rm')) {
    let best: number | null = null;
    for (const ss of inWindow) {
      const e = sessionE1rm(ss, series);
      if (e !== null && (best === null || e.value > best)) best = e.value;
    }
    stats.push({ value: best === null ? '—' : `≈${formatNumber(best)}${NBSP}${seriesUnitText(series)}`, label: 'Est. 1RM' });
  }
  stats.push({ value: bestSetStat(inWindow, series) ?? '—', label: 'Best set' });
  stats.push({ value: String(inWindow.length), label: 'Sessions' });

  const unit = seriesUnitText(series);
  const readouts = new Map(points.map((p) => [p.sessionId, p.readout]));
  const rows: ExerciseTabRow[] = [...inWindow].reverse().map((ss) => {
    const top = series.kind === 'bodyweight' ? mostReps(ss, series) : (sessionTopSet(ss, series)?.fromSet ?? null);
    const loaded = top !== null && top.load !== null && series.kind !== 'bodyweight';
    // Cardio (19 Oct): the session's longest set as logged, time · distance · pace; never a load or reps.
    const cardio = series.kind === 'cardio' ? (sessionBestDistance(ss, series)?.fromSet ?? ss.sets.find((x) => x.setType !== 'warmup' && x.durationS !== null) ?? null) : null;
    const topText = cardio !== null ? cardioSetText(cardio, series) : top === null ? '—' : !loaded ? String(top.reps ?? '—') : `${formatNumber(top.load?.value ?? 0)}×${String(top.reps ?? 0)}`;
    // VoiceOver hears the load in full (`Assist 30 kg by 8`, `12 kg each by 12`); the cell's unit is in the header.
    const topWords = cardio !== null ? topText.replace(/\u00a0/g, ' ') : top === null ? 'none' : loaded ? setText(top, series).replace(/\u00a0/g, ' ').replace(' × ', ' by ') : countNoun(top.reps ?? 0, 'rep', 'reps');
    const vol = sessionVolume(ss, series);
    const e = sessionE1rm(ss, series);
    const sets = workingSetCount(ss);
    return {
      sessionId: ss.sessionId,
      date: ss.date,
      cells: { date: shortDate(ss.date, input.today), topSet: topText, volume: vol === null ? '—' : thousands(vol.value), sets: String(sets), e1rm: e === null ? '—' : `≈${formatNumber(e.value)}` },
      readout: readouts.get(ss.sessionId) ?? `${shortDate(ss.date, input.today)} · ${label} —`,
      words: [
        longDate(ss.date, input.today),
        `top set ${topWords}`,
        vol === null ? null : `volume ${formatNumber(vol.value)} ${unit}`,
        countNoun(sets, 'set', 'sets'),
        e === null ? null : `estimated one-rep max about ${formatNumber(e.value)}`,
      ]
        .filter((w): w is string => w !== null)
        .join(', '),
    };
  });

  const range = rangeWords(input.window, input.today);
  return {
    exerciseId: input.exerciseId,
    title: input.name || series.exerciseName,
    series: all.length > 1 ? all.map((s) => ({ id: s.id, label: labels.get(s.id) ?? s.id })) : [],
    seriesId: series.id,
    measures: offered.map((key) => ({ key, label: measureLabel(key) })),
    measure,
    measureLabel: label,
    trailing,
    stats,
    statsWords: stats.map((s) => `${s.label}${s.label === 'Est. 1RM' ? ', an estimate,' : ''} ${s.value.replace('≈', 'about ')}`).join('. '),
    chart: {
      from: input.window.from,
      to: input.window.to,
      unit: measureUnit(series, measure),
      format: measure === 'hold' ? 'duration' : 'number',
      points,
      words: `${label}${measure === 'e1rm' ? ', an estimate' : ''}, ${countNoun(points.length, 'session', 'sessions')}, ${range}. Trailing average of the last ${String(trailing)}.`,
    },
    table: { unit, rows },
    empty: inWindow.length === 0 ? 'No sessions in this period.' : points.length === 0 ? `No ${label} in this period.` : null,
  };
}
