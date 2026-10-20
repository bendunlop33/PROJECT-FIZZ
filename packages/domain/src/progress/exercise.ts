import type { EquipmentKind, ImplementCount, Load, LoadConvention, Measurement, WeightUnit } from '@fizz/schemas';
import { addDays, addMonths, daysBetween, weekdayIndexOfDate } from '../calendar';
import { isSetCountable } from '../exclusions';
import { convertMass, LOAD_DISPLAY_STEP, roundToStep } from '../units';
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
 * - **One series per exercise and kind** (Ben, 20 Oct 2026, replacing PG15
 *   for Progress): every gym, equipment item and source (logged or imported)
 *   of one exercise is one series. Only the kind (`load`, `assisted`, BW +,
 *   bodyweight, timed, distance, cardio) splits it, since those don't share
 *   an axis. Each session keeps its provenance (`source`), and the stored
 *   sets are untouched.
 * - **Bodyweight and weighted (BW +) are one series** (Ben, 20 Oct 2026):
 *   when an exercise has BW + rows, its bodyweight rows join that series and
 *   their sets read as `+0` added (`BW`). They never get an Est. 1RM and
 *   add nothing to total weight.
 * - **Units** are converted to Ben's display unit for the series (each
 *   converted set keeps `convertedFrom`). **Conventions** (total, each hand,
 *   stack, plates) are plotted as recorded and never converted into each
 *   other; each set carries its row's equipment kind so its own text reads
 *   right (`22.5 kg each`).
 * - **Sets Ben marked** (`Spotted`, `Pain`, …) are left out of top set, Est.
 *   1RM, the rep table, records and every best or change, and counted in
 *   total weight (PG21), all through `isSetCountable`.
 */

export type ExerciseMetric = 'e1rm' | 'top_set' | 'total_weight' | 'best_set' | 'longest_hold' | 'total_distance' | 'best_distance' | 'total_time';
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
 * top set and total weight; `assisted` (less is better) has a top set;
 * `added_bodyweight` (`BW + 10 kg`, bodyweight rows as `+0`) a top set and
 * total weight (the added mass); `bodyweight` has the best set in reps;
 * `timed` the longest hold; `distance` (sled push, carries) total distance and
 * the longest set, never an Est. 1RM; `cardio` (rower, bike; 19 Oct) total
 * distance, the longest set and total time, never load, reps or total weight.
 */
export type SeriesKind = 'load' | 'assisted' | 'added_bodyweight' | 'bodyweight' | 'timed' | 'distance' | 'cardio';

/**
 * One row's record series (PG10 records, the Summary's record line): one
 * exercise + equipment instance + load convention + unit, imports apart.
 * Progress charts use the consolidated `ExerciseSeries`, whose `key` is the
 * latest row's with the display unit.
 */
export interface SeriesKey {
  exerciseId: string;
  source: 'app' | 'import';
  /** Null for imported history and for rows logged with no equipment. */
  equipmentId: string | null;
  convention: LoadConvention;
  unit: WeightUnit;
  measurement: Measurement;
}

/** A stable string for a record series. */
export function seriesIdOf(k: SeriesKey): string {
  const eq = k.source === 'import' ? 'import' : (k.equipmentId ?? 'none');
  return [k.exerciseId, eq, k.convention, k.unit, k.measurement === 'duration' ? 'timed' : k.measurement === 'distance' ? 'distance' : k.measurement === 'cardio' ? 'cardio' : 'reps'].join('|');
}

export function seriesKind(convention: LoadConvention, equipmentKind: EquipmentKind | null, measurement: Measurement): SeriesKind {
  if (measurement === 'cardio') return 'cardio';
  if (measurement === 'duration') return 'timed';
  if (measurement === 'distance') return 'distance';
  if (convention === 'assistance') return 'assisted';
  if (convention === 'bodyweight') return 'bodyweight';
  if (convention === 'added' && equipmentKind !== 'plate_loaded_machine') return 'added_bodyweight';
  return 'load';
}

/** §6.3: the metrics a series offers, the default first (PG29). */
export function metricsFor(kind: SeriesKind): ExerciseMetric[] {
  switch (kind) {
    case 'load':
      return ['e1rm', 'top_set', 'total_weight'];
    case 'assisted':
      return ['top_set'];
    case 'added_bodyweight':
      return ['top_set', 'total_weight'];
    case 'bodyweight':
      return ['best_set'];
    case 'timed':
      return ['longest_hold'];
    case 'distance':
      return ['total_distance', 'best_distance'];
    case 'cardio':
      return ['total_distance', 'best_distance', 'total_time'];
  }
}

/** False only for assisted top sets: less assistance is better. */
export function higherIsBetter(kind: SeriesKind, metric: ExerciseMetric): boolean {
  return !(kind === 'assisted' && metric === 'top_set');
}

/**
 * A set as a series reads it: its row's equipment kind (so a per-hand or
 * stack set reads as itself in a merged series) and, when its load was
 * converted to the series' unit, the unit it was logged in.
 */
export type SeriesSet = ProgressSet & { equipmentKind?: EquipmentKind | null; convertedFrom?: WeightUnit };

/** One workout's sets of one series (all its rows of the exercise and kind that day). */
export interface SeriesSession {
  sessionId: string;
  date: string;
  startedMs: number;
  source: 'app' | 'import';
  /** The workout's own name; null = none given. */
  name: string | null;
  rows: readonly ProgressExercise[];
  /** Every completed set of those rows, rows in workout order. */
  sets: readonly SeriesSet[];
  /** A set was corrected after logging. */
  edited: boolean;
}

export interface ExerciseSeries {
  /** `<exerciseId>|<kind>`: stable across gyms, equipment, units and imports. */
  id: string;
  /** The latest row's convention and measurement, the display unit, `app` when any session was logged in the app. */
  key: SeriesKey;
  kind: SeriesKind;
  equipmentKind: EquipmentKind | null;
  equipmentName: string | null;
  gymId: string | null;
  /** The latest logged name of the exercise in this series. */
  exerciseName: string;
  /** Oldest first. */
  sessions: SeriesSession[];
  /** A set's load was logged in this other unit and converted for the chart (`Converted from lb`); null when none was. */
  convertedFrom: WeightUnit | null;
}

/** The consolidated series id (Ben, 20 Oct). */
export function consolidatedSeriesId(exerciseId: string, kind: SeriesKind): string {
  return `${exerciseId}|${kind}`;
}

export function keyOfRow(s: ProgressSession, ex: ProgressExercise): SeriesKey {
  const source = s.source === 'import' ? 'import' : 'app';
  return { exerciseId: ex.exerciseId, source, equipmentId: source === 'import' ? null : ex.equipmentId, convention: ex.convention, unit: ex.unit, measurement: ex.measurement };
}

export const chronological = (a: { startedMs: number; sessionId: string }, b: { startedMs: number; sessionId: string }) => a.startedMs - b.startedMs || a.sessionId.localeCompare(b.sessionId);

/** A load in `unit`, as the series shows it (converted and rounded to the display step; bodyweight has no mass). */
export function loadInUnit(load: Load, unit: WeightUnit): Load {
  if (load.unit === unit) return load;
  if (load.convention === 'bodyweight') return { ...load, unit };
  return { ...load, value: roundToStep(convertMass({ value: load.value, unit: load.unit }, unit).value, LOAD_DISPLAY_STEP), unit };
}

/**
 * A bodyweight row in a BW + series (Ben, 20 Oct): its sets as `+0` added in
 * the series' unit (they read `BW`). The stored sets are untouched.
 */
function asAddedZero(row: ProgressExercise, unit: WeightUnit): ProgressExercise {
  return { ...row, convention: 'added', sets: row.sets.map((x) => (x.load === null || x.load.convention === 'bodyweight' ? { ...x, load: { value: 0, unit, convention: 'added' } } : x)) };
}

/** A row's sets in the series' unit, each with the row's equipment kind. */
function normaliseRow(raw: ProgressExercise, unit: WeightUnit, zeroAdded: boolean): { row: ProgressExercise; converted: WeightUnit | null } {
  const row = zeroAdded ? asAddedZero(raw, unit) : raw;
  let converted: WeightUnit | null = null;
  const sets = row.sets.map((x): SeriesSet => {
    if (x.load === null || x.load.unit === unit) return { ...x, equipmentKind: row.equipmentKind };
    if (x.load.convention === 'bodyweight') return { ...x, load: loadInUnit(x.load, unit), equipmentKind: row.equipmentKind };
    converted = x.load.unit;
    return { ...x, load: loadInUnit(x.load, unit), equipmentKind: row.equipmentKind, convertedFrom: x.load.unit };
  });
  return { row: { ...row, unit, sets }, converted };
}

/** The unit of the latest loaded row of the exercise (the default display unit); kg with none. */
function latestUnit(ordered: readonly ProgressSession[], exerciseId: string): WeightUnit {
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const s = ordered[i] as ProgressSession;
    for (let j = s.exercises.length - 1; j >= 0; j -= 1) {
      const ex = s.exercises[j] as ProgressExercise;
      if (ex.exerciseId === exerciseId && ex.convention !== 'bodyweight' && ex.sets.length > 0) return ex.unit;
    }
  }
  return 'kg';
}

/** A row's own kind (`seriesKind`). */
const rowKind = (ex: ProgressExercise): SeriesKind => seriesKind(ex.convention, ex.equipmentKind, ex.measurement);

/**
 * Every series of one exercise (Ben, 20 Oct 2026): one per kind, every gym,
 * equipment item and source merged, each with its sessions oldest first and
 * loads in `unit` (Ben's display unit, required so no caller mixes units;
 * null: the latest row's). Bodyweight rows join the BW + series when the
 * exercise has one (`+0` added). Rows of other exercises are skipped at once.
 */
export function collectExerciseSeries(sessions: readonly ProgressSession[], exerciseId: string, opts: { unit: WeightUnit | null }): ExerciseSeries[] {
  const out = new Map<string, ExerciseSeries>();
  const ordered = [...sessions].sort(chronological);
  const unit = opts.unit ?? latestUnit(ordered, exerciseId);
  const weighted = ordered.some((s) => s.exercises.some((ex) => ex.exerciseId === exerciseId && ex.sets.length > 0 && rowKind(ex) === 'added_bodyweight'));
  const kindOf = (ex: ProgressExercise): SeriesKind => {
    const k = rowKind(ex);
    return k === 'bodyweight' && weighted ? 'added_bodyweight' : k;
  };
  for (const s of ordered) {
    const byKind = new Map<SeriesKind, ProgressExercise[]>();
    for (const ex of s.exercises) {
      if (ex.exerciseId !== exerciseId || ex.sets.length === 0) continue;
      const kind = kindOf(ex);
      byKind.set(kind, [...(byKind.get(kind) ?? []), ex]);
    }
    for (const [kind, raw] of byKind) {
      const normalised = raw.map((r) => normaliseRow(r, unit, kind === 'added_bodyweight' && rowKind(r) === 'bodyweight'));
      const rows = normalised.map((n) => n.row);
      const converted = normalised.find((n) => n.converted !== null)?.converted ?? null;
      const id = consolidatedSeriesId(exerciseId, kind);
      const source = s.source === 'import' ? 'import' : 'app';
      const sets = rows.flatMap((r) => r.sets as readonly SeriesSet[]);
      const entry: SeriesSession = { sessionId: s.sessionId, date: s.date, startedMs: s.startedMs, source, name: s.name, rows, sets, edited: sets.some((x) => x.edited === true) };
      const last = rows[rows.length - 1] as ProgressExercise;
      const key: SeriesKey = { exerciseId, source, equipmentId: source === 'import' ? null : last.equipmentId, convention: last.convention, unit, measurement: last.measurement };
      const existing = out.get(id);
      if (existing === undefined) {
        out.set(id, {
          id,
          key,
          kind,
          equipmentKind: last.equipmentKind,
          equipmentName: last.equipmentName ?? null,
          gymId: source === 'import' ? null : last.gymId,
          exerciseName: last.exerciseName,
          sessions: [entry],
          convertedFrom: converted,
        });
        continue;
      }
      existing.sessions.push(entry);
      existing.exerciseName = last.exerciseName;
      if (converted !== null) existing.convertedFrom = converted;
      // The latest row describes the series; an imported row (no equipment) never replaces a logged one's equipment.
      if (source === 'app' || existing.key.source === 'import') {
        existing.key = key;
        if (last.equipmentKind !== null) existing.equipmentKind = last.equipmentKind;
        if (last.equipmentName) existing.equipmentName = last.equipmentName;
        if (source === 'app' && last.gymId !== null) existing.gymId = last.gymId;
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

type Loaded = SeriesSet & { load: Load; reps: number };

/** What the per-session values read of a series (records pass a single row's record series). */
export type SeriesShape = Pick<ExerciseSeries, 'key' | 'kind'> & { equipmentKind?: EquipmentKind | null };

/** The set's own equipment kind (its row's), else the series'. */
export function setEquipmentKind(s: SeriesSet, series: { equipmentKind?: EquipmentKind | null }): EquipmentKind | null {
  return s.equipmentKind !== undefined ? s.equipmentKind : (series.equipmentKind ?? null);
}

/**
 * A non-warm-up set in the series' unit whose load is of the series' kind
 * (any convention of that kind: total, each hand, stack and plates are all
 * `load`), with at least 1 rep.
 */
export function seriesLoadedSet(s: SeriesSet, series: SeriesShape): s is SeriesSet & { load: Load; reps: number } {
  return loadedSet(s, series);
}

function loadedSet(s: SeriesSet, series: SeriesShape): s is Loaded {
  if (s.setType === 'warmup' || s.load === null || s.reps === null || s.reps < 1 || s.load.unit !== series.key.unit) return false;
  return s.load.convention === series.key.convention || seriesKind(s.load.convention, setEquipmentKind(s, series), series.key.measurement) === series.kind;
}

/** PG21: counts for top set, Est. 1RM, rep table, records and every best or change. */
const counts = (s: ProgressSet) => isSetCountable(s, 'e1rm');

export interface MetricValue {
  value: number;
  kind: 'actual' | 'estimate';
  /** The set the value came from; null for a sum (total weight, total distance, total time). */
  fromSet: SeriesSet | null;
}

/** Heavier is better, then more reps; for assistance, lighter is better, then more reps. */
function betterTop(a: Loaded, b: Loaded | null, lowerWins: boolean): boolean {
  if (b === null) return true;
  if (a.load.value !== b.load.value) return lowerWins ? a.load.value < b.load.value : a.load.value > b.load.value;
  return a.reps > b.reps;
}

/** PG11: the session's single best eligible set's Est. 1RM (never averaged). */
export function sessionE1rm(ss: SeriesSession, series: SeriesShape): MetricValue | null {
  if (series.kind !== 'load') return null;
  let best: { value: number; set: Loaded } | null = null;
  for (const s of ss.sets) {
    if (!loadedSet(s, series) || !counts(s)) continue;
    const kind = setEquipmentKind(s, series);
    if (!e1rmConventionAllowed(s.load.convention, kind)) continue;
    const e = estimateOneRepMax(s.load, s.reps, kind);
    if (!e.eligible) continue;
    if (best === null || e.value > best.value || (e.value === best.value && s.load.value > best.set.load.value)) best = { value: e.value, set: s };
  }
  return best === null ? null : { value: best.value, kind: 'estimate', fromSet: best.set };
}

/** Top set: heaviest (least assistance for assisted), then most reps. Countable sets only. */
export function sessionTopSet(ss: SeriesSession, series: SeriesShape): MetricValue | null {
  if (series.kind !== 'load' && series.kind !== 'assisted' && series.kind !== 'added_bodyweight') return null;
  const lowerWins = series.kind === 'assisted';
  let best: Loaded | null = null;
  for (const s of ss.sets) if (loadedSet(s, series) && counts(s) && betterTop(s, best, lowerWins)) best = s;
  return best === null ? null : { value: best.load.value, kind: 'actual', fromSet: best };
}

/** §5.5 assisted record: `Least assistance for 8+ reps`. */
export const ASSIST_RECORD_MIN_REPS = 8;

/**
 * Assisted `Least assistance for 8+ reps`: the lightest assistance in one
 * countable set of at least `ASSIST_RECORD_MIN_REPS` reps (then most reps).
 */
export function sessionLeastAssist(ss: SeriesSession, series: SeriesShape): MetricValue | null {
  if (series.kind !== 'assisted') return null;
  let best: Loaded | null = null;
  for (const s of ss.sets) if (loadedSet(s, series) && counts(s) && s.reps >= ASSIST_RECORD_MIN_REPS && betterTop(s, best, true)) best = s;
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
 * How many times a set's load was moved per rep, for total weight: a per-hand
 * load counts each dumbbell (the catalogue's `implements`, else two on a
 * bilateral row and one per side on a unilateral one, an assumption:
 * `assumed`), and a `both` set ("10 each side") counts both sides.
 */
function timesMoved(s: Loaded, row: ProgressExercise, implementsCount: ImplementCount | null): { times: number; assumed: boolean } {
  const perHand = s.load.convention === 'per_hand';
  const implementsUsed = !perHand ? 1 : (implementsCount ?? (row.laterality === 'bilateral' ? 2 : 1));
  return { times: implementsUsed * (row.laterality === 'unilateral' && s.side === 'both' ? 2 : 1), assumed: perHand && implementsCount === null };
}

/**
 * Total weight (Ben, 20 Oct 2026): Σ load × reps over the session's completed
 * working sets (warm-ups out, marked sets in: the work was done), each
 * dumbbell and side counted (`timesMoved`), every set in the series' unit.
 * BW + series count the added mass only. None for assisted (less is better,
 * no total), bodyweight, timed, distance or cardio. An `estimate` when a
 * per-hand set's dumbbell count isn't in the catalogue (`implements` left
 * out: done either way, review S4).
 */
export function sessionTotalWeight(ss: SeriesSession, series: SeriesShape, implementsCount: ImplementCount | null = null): MetricValue | null {
  if (series.kind !== 'load' && series.kind !== 'added_bodyweight') return null;
  let total = 0;
  let used = 0;
  let assumed = false;
  for (const row of ss.rows) {
    for (const s of row.sets as readonly SeriesSet[]) {
      if (!loadedSet(s, series) || !isSetCountable(s, 'volume')) continue;
      used += 1;
      const t = timesMoved(s, row, implementsCount);
      if (t.assumed) assumed = true;
      total += s.load.value * s.reps * t.times;
    }
  }
  return used > 0 ? { value: Math.round(total * 100) / 100, kind: assumed ? 'estimate' : 'actual', fromSet: null } : null;
}

/** A completed non-warm-up distance set with metres. */
type Distanced = ProgressSet & { distanceM: number };
const distanced = (s: ProgressSet): s is Distanced => s.setType !== 'warmup' && s.distanceM !== undefined && s.distanceM > 0;

/** The set's load when it is in the series' convention and unit (what a distance set carried or pushed). */
export function seriesLoadValue(s: ProgressSet, key: SeriesKey): number | null {
  return s.load !== null && s.load.convention === key.convention && s.load.unit === key.unit ? s.load.value : null;
}

/**
 * Distance `Best distance`: the longest countable set (PG21), then the
 * heavier load. Actual metres, never adjusted for load.
 */
export function sessionBestDistance(ss: SeriesSession, series: SeriesShape): MetricValue | null {
  if (series.kind !== 'distance' && series.kind !== 'cardio') return null;
  let best: Distanced | null = null;
  for (const s of ss.sets) {
    if (!distanced(s) || !counts(s)) continue;
    if (best === null || s.distanceM > best.distanceM || (s.distanceM === best.distanceM && (seriesLoadValue(s, series.key) ?? 0) > (seriesLoadValue(best, series.key) ?? 0))) best = s;
  }
  return best === null ? null : { value: best.distanceM, kind: 'actual', fromSet: best };
}

/**
 * Distance `Total distance`: Σ metres over completed non-warm-up sets, marked
 * sets included (the work was done, as total weight, PG31). A unilateral row (a
 * suitcase carry) counts its `both` sets plus the busier side.
 */
export function sessionTotalDistance(ss: SeriesSession, series: Pick<ExerciseSeries, 'kind'>): MetricValue | null {
  if (series.kind !== 'distance' && series.kind !== 'cardio') return null;
  let used = 0;
  const sum = (xs: readonly ProgressSet[]): number => {
    let acc = 0;
    for (const s of xs) {
      if (!distanced(s) || !isSetCountable(s, 'volume')) continue;
      used += 1;
      acc += s.distanceM;
    }
    return acc;
  };
  let total = 0;
  for (const row of ss.rows) {
    if (row.laterality === 'bilateral') total += sum(row.sets);
    else {
      total += sum(row.sets.filter((s) => s.side === 'both' || s.side === null));
      total += Math.max(sum(row.sets.filter((s) => s.side === 'left')), sum(row.sets.filter((s) => s.side === 'right')));
    }
  }
  return used > 0 ? { value: Math.round(total * 100) / 100, kind: 'actual', fromSet: null } : null;
}

/** Cardio `Total time`: Σ seconds over completed non-warm-up sets, marked sets included (the work was done, as total distance). */
export function sessionTotalTime(ss: SeriesSession, series: Pick<ExerciseSeries, 'kind'>): MetricValue | null {
  if (series.kind !== 'cardio') return null;
  let used = 0;
  let total = 0;
  for (const s of ss.sets) {
    if (s.setType === 'warmup' || s.durationS === null || s.durationS <= 0 || !isSetCountable(s, 'volume')) continue;
    used += 1;
    total += s.durationS;
  }
  return used > 0 ? { value: total, kind: 'actual', fromSet: null } : null;
}

/** One session's value for a metric; `implementsCount` (the catalogue's dumbbells per hand-load set) is for total weight. */
export function sessionMetric(ss: SeriesSession, series: SeriesShape, metric: ExerciseMetric, implementsCount: ImplementCount | null = null): MetricValue | null {
  switch (metric) {
    case 'e1rm':
      return sessionE1rm(ss, series);
    case 'top_set':
      return sessionTopSet(ss, series);
    case 'total_weight':
      return sessionTotalWeight(ss, series, implementsCount);
    case 'best_set':
      return series.kind === 'bodyweight' ? sessionBestSet(ss) : null;
    case 'longest_hold':
      return series.kind === 'timed' ? sessionLongestHold(ss) : null;
    case 'total_distance':
      return sessionTotalDistance(ss, series);
    case 'best_distance':
      return sessionBestDistance(ss, series);
    case 'total_time':
      return sessionTotalTime(ss, series);
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
  fromSet: SeriesSet | null;
  source: 'app' | 'import';
  /** Non-warm-up sets Ben marked in this session (left out of the value unless the metric is a total). */
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

function pointsOf(series: ExerciseSeries, metric: ExerciseMetric, within: (date: string) => boolean, implementsCount: ImplementCount | null): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const ss of series.sessions) {
    if (!within(ss.date)) continue;
    const v = sessionMetric(ss, series, metric, implementsCount);
    if (v === null) continue;
    out.push({ sessionId: ss.sessionId, date: ss.date, name: ss.name, value: v.value, kind: v.kind, fromSet: v.fromSet, source: ss.source, excludedSets: markedCount(ss), edited: ss.edited, breakBefore: false });
  }
  return out;
}

function better(a: TrendPoint, b: TrendPoint | null, higher: boolean, distanceKey: SeriesKey | null = null): boolean {
  if (b === null) return true;
  if (a.value !== b.value) return higher ? a.value > b.value : a.value < b.value;
  // Equal best distance: the heavier set wins (longer, then heavier, as the StatStrip); equal load keeps the earlier.
  if (distanceKey !== null) {
    const la = a.fromSet === null ? 0 : (seriesLoadValue(a.fromSet, distanceKey) ?? 0);
    const lb = b.fromSet === null ? 0 : (seriesLoadValue(b.fromSet, distanceKey) ?? 0);
    return la > lb;
  }
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
export function exerciseTrend(series: ExerciseSeries, metric: ExerciseMetric, range: TrendRange, today: string, implementsCount: ImplementCount | null = null): ExerciseTrend {
  const firstDate = series.sessions[0]?.date ?? null;
  const bounds = trendRangeBounds(range, today, firstDate);
  const within = (d: string) => inRange(d, bounds);
  const higher = higherIsBetter(series.kind, metric);
  const distanceKey = metric === 'best_distance' && series.kind === 'distance' ? series.key : null;
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
    if (metric !== 'total_weight' && metric !== 'total_distance' && allMarked(s)) markers.push({ kind: 'not_counted', date: s.date, sessionId: s.sessionId });
  }
  markers.sort((a, b) => a.date.localeCompare(b.date));

  // One pass over the whole series; each range's count (for `Try 1 yr`) comes from the same points.
  const allPoints = pointsOf(series, metric, () => true, implementsCount);
  const sessionPoints = allPoints.filter((p) => within(p.date));
  let points = sessionPoints;
  let aggregation: ExerciseTrend['aggregation'] = 'session';
  if (sessionPoints.length > TREND_MAX_POINTS) {
    aggregation = 'weekly_best';
    const weeks = new Map<string, TrendPoint>();
    for (const p of sessionPoints) {
      const w = mondayOf(p.date);
      const cur = weeks.get(w) ?? null;
      if (better(p, cur, higher, distanceKey)) weeks.set(w, p);
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

  // Latest, first and best always describe sessions, even when the chart shows weekly bests (B1).
  let best: TrendPoint | null = null;
  for (const p of sessionRows) if (better(p, best, higher, distanceKey)) best = p;
  const before = series.sessions.filter((s) => s.date < bounds.from);
  const pointsByRange = Object.fromEntries(
    TREND_RANGES.map((r) => {
      const b = trendRangeBounds(r, today, firstDate);
      return [r, allPoints.filter((p) => inRange(p.date, b)).length];
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
    summary: { latest: sessionRows[sessionRows.length - 1] ?? null, best, first: sessionRows[0] ?? null },
    higherIsBetter: higher,
    pointsByRange,
  };
}

// ---------------------------------------------------------------------------
// Rep table (PG28)

/** How a table load reads (`22.5 kg each`, `40 kg stack`): its own convention and equipment, never converted between them. */
export interface LoadAs {
  convention: LoadConvention;
  equipmentKind: EquipmentKind | null;
}

export interface RepByWeightRow {
  load: number;
  as: LoadAs;
  reps: number;
  date: string;
  sessionId: string;
  source: 'app' | 'import';
}

export interface RepByRepsRow {
  reps: number;
  /** Null: no set of at least this many reps (never past the last done count). */
  load: number | null;
  as: LoadAs | null;
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
 * first). Actual, countable sets only (PG21). The same number in two
 * conventions (`20 kg each`, `20 kg`) is two rows.
 */
export function repTableByWeight(series: ExerciseSeries, bounds: DateRange): RepByWeightRow[] {
  if (!hasRepTable(series.kind)) return [];
  const byLoad = new Map<string, RepByWeightRow>();
  for (const ss of series.sessions) {
    if (!inRange(ss.date, bounds)) continue;
    for (const s of ss.sets) {
      if (!loadedSet(s, series) || !counts(s)) continue;
      const as: LoadAs = { convention: s.load.convention, equipmentKind: setEquipmentKind(s, series) };
      const k = `${String(s.load.value)}|${as.convention}`;
      const cur = byLoad.get(k);
      if (cur === undefined || s.reps > cur.reps) byLoad.set(k, { load: s.load.value, as, reps: s.reps, date: ss.date, sessionId: ss.sessionId, source: ss.source });
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
        ? { reps, load: null, as: null, fromReps: null, date: null, sessionId: null, source: null }
        : { reps, load: best.load, as: best.as, fromReps: best.reps > reps ? best.reps : null, date: best.date, sessionId: best.sessionId, source: best.source },
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Best distance by load (distance series)

export interface DistanceByLoadRow {
  /** The load in the series' convention and unit; null for sets with none (an empty sled). */
  load: number | null;
  distanceM: number;
  date: string;
  sessionId: string;
  source: 'app' | 'import';
}

/**
 * Distance series: one row per load, the longest countable set at that load
 * and the first date it was done; heaviest first, no load last. A set whose
 * load is in another convention or unit is left out. 0 kg added (not plate
 * loaded) is no load, matching the set text.
 */
export function distanceTableByLoad(series: ExerciseSeries, bounds: DateRange): DistanceByLoadRow[] {
  if (series.kind !== 'distance') return [];
  const byLoad = new Map<number | null, DistanceByLoadRow>();
  for (const ss of series.sessions) {
    if (!inRange(ss.date, bounds)) continue;
    for (const s of ss.sets) {
      if (!distanced(s) || !counts(s)) continue;
      if (s.load !== null && s.load.convention !== 'bodyweight' && seriesLoadValue(s, series.key) === null) continue;
      const v = seriesLoadValue(s, series.key);
      // 0 kg reads `No load` only where the set text says so too (added load, not a plate-loaded sled; review misc-fixes N1).
      const zeroIsNone = series.key.convention === 'added' && series.equipmentKind !== 'plate_loaded_machine';
      const load = v === null || (v === 0 && zeroIsNone) ? null : v;
      const cur = byLoad.get(load);
      if (cur === undefined || s.distanceM > cur.distanceM) byLoad.set(load, { load, distanceM: s.distanceM, date: ss.date, sessionId: ss.sessionId, source: ss.source });
    }
  }
  return [...byLoad.values()].sort((a, b) => (b.load ?? -1) - (a.load ?? -1));
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
  /** Distance: the longest countable set (then the heavier load). */
  bestDistance: { set: ProgressSet & { distanceM: number }; date: string; sessionId: string } | null;
  /** Distance: all-time metres, marked sets included (as `Total distance`). */
  totalDistanceM: number | null;
}

/** `exerciseHeadline` (§6.2): all-time bests of the series, countable sets only (PG21). */
export function exerciseHeadline(series: ExerciseSeries): ExerciseHeadline {
  const out: ExerciseHeadline = { sessions: series.sessions.length, bestE1rm: null, bestSet: null, mostReps: null, longestHold: null, bestDistance: null, totalDistanceM: null };
  const lowerWins = series.kind === 'assisted';
  for (const ss of series.sessions) {
    if (series.kind === 'distance' || series.kind === 'cardio') {
      const b = sessionBestDistance(ss, series);
      const cur = out.bestDistance?.set ?? null;
      const heavier = (x: ProgressSet, y: ProgressSet) => (seriesLoadValue(x, series.key) ?? 0) > (seriesLoadValue(y, series.key) ?? 0);
      if (b !== null && b.fromSet !== null && (cur === null || b.value > cur.distanceM || (b.value === cur.distanceM && heavier(b.fromSet, cur)))) out.bestDistance = { set: { ...b.fromSet, distanceM: b.value }, date: ss.date, sessionId: ss.sessionId };
      const t = sessionTotalDistance(ss, series);
      if (t !== null) out.totalDistanceM = Math.round(((out.totalDistanceM ?? 0) + t.value) * 100) / 100;
      continue;
    }
    const e = sessionE1rm(ss, series);
    if (e !== null && e.fromSet !== null && (out.bestE1rm === null || e.value > out.bestE1rm.value)) out.bestE1rm = { value: e.value, date: ss.date, sessionId: ss.sessionId, fromSet: e.fromSet };
    for (const s of ss.sets) {
      if (s.setType === 'warmup' || !counts(s)) continue;
      if (loadedSet(s, series) && (series.kind === 'load' || series.kind === 'assisted' || series.kind === 'added_bodyweight')) {
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
