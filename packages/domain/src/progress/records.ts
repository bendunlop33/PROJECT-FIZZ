import type { EquipmentKind, Load, LoadConvention, SetType, WeightUnit } from '@fizz/schemas';
import { formatNumber, loadText, NBSP } from '../display';
import { loadUnitText } from './text';
import { isSetCountable } from '../exclusions';
import { RECORD_MIN_SESSIONS } from '../session/records';
import { convertMass } from '../units';
import { chronological, keyOfRow, seriesIdOf, seriesKind, sessionBestSet, sessionE1rm, type ExerciseSeries, type SeriesSession } from './exercise';
import type { ProgressExercise, ProgressSession, ProgressSet } from './projection';
import { inRange, type DateRange } from './window';

/**
 * Records set inside a Progress window (progress.md PG10, PG30): `Heaviest
 * set` and `Most reps at <load>`, with exactly the rules of `findSetRecord`
 * (the Summary's record line), each set judged as it was logged against
 * everything done before that workout and the earlier sets of that exercise
 * that day:
 * - only workouts logged in the app make a claim (ADR 0016);
 * - a series is one exercise + equipment instance + load convention + unit,
 *   and needs ≥ `RECORD_MIN_SESSIONS` earlier logged sessions with a
 *   comparable set before anything counts;
 * - warm-ups and drop sets never count; assisted, bodyweight and timed
 *   exercises have no records (heavier isn't better there);
 * - sets Ben marked (`Spotted`, `Pain`, …) never are records and never the
 *   bar (PG21);
 * - a heavier imported set of the exercise (same convention, any unit,
 *   converted) suppresses the claim.
 * At most one record per exercise row per workout: the last heaviest, else
 * the last most-reps.
 *
 * One chronological pass with running maxima per series, instead of calling
 * `findSetRecord` with the whole history for every set (that was ~160 ms on a
 * 2-year history in Node and far more on the phone). The equivalence with
 * `findSetRecord` is property-tested (progress-records.test.ts). Pure.
 */

export type ProgressRecordKind = 'heaviest' | 'most_reps_at_load' | 'best_e1rm';

export interface ProgressRecord {
  kind: ProgressRecordKind;
  sessionId: string;
  date: string;
  /** The workout row it came from (one exercise can appear twice in a workout, e.g. after a gym switch). */
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  equipmentId: string | null;
  /** From the workout's snapshot: tells `BW + 10 kg` from `10 kg plates` for an `added` load. */
  equipmentKind: EquipmentKind | null;
  gymId: string | null;
  convention: LoadConvention;
  load: Load;
  reps: number;
  /** `Heaviest set` · `Most reps at 59 kg`. */
  label: string;
  /** `105 kg × 3` · `12`. */
  value: string;
  /** `best_e1rm` only: an estimate (`≈`, `Est.`); the others are actual results. */
  isEstimate: boolean;
  /** `best_e1rm`: the Est. 1RM value (in `load.unit`); null otherwise. */
  estimate: number | null;
}

export interface RecordsInWindow {
  /** Newest first, at most `limit`. */
  items: ProgressRecord[];
  total: number;
}

const WORKING_GROUP: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);

type Comparable = ProgressSet & { load: Load; reps: number };

/** `comparableSet` in `findSetRecord`: a working set with load and reps that counts for records. */
function isComparable(s: ProgressSet): s is Comparable {
  return WORKING_GROUP.has(s.setType) && isSetCountable(s, 'record') && s.load !== null && s.reps !== null;
}

interface Series {
  /** Earlier logged sessions with a comparable set. */
  sessions: number;
  maxLoad: number;
  /** Most reps at `maxLoad`. */
  maxReps: number;
}

const seriesKey = (exerciseId: string, equipmentId: string | null, convention: LoadConvention, unit: WeightUnit) => `${exerciseId}\u0000${equipmentId ?? ''}\u0000${equipmentId === null ? 'none' : 'id'}\u0000${convention}\u0000${unit}`;
const importKey = (exerciseId: string, convention: LoadConvention, unit: WeightUnit) => `${exerciseId}\u0000${convention}\u0000${unit}`;

function fold(series: Series | undefined, sets: readonly Comparable[]): Series {
  let { sessions, maxLoad, maxReps } = series ?? { sessions: 0, maxLoad: -Infinity, maxReps: -Infinity };
  for (const s of sets) {
    if (s.load.value > maxLoad) {
      maxLoad = s.load.value;
      maxReps = s.reps;
    } else if (s.load.value === maxLoad && s.reps > maxReps) {
      maxReps = s.reps;
    }
  }
  if (sets.length > 0) sessions += 1;
  return { sessions, maxLoad, maxReps };
}

export function recordsInWindow(sessions: readonly ProgressSession[], window: DateRange, opts: { limit?: number; estimates?: boolean } = {}): RecordsInWindow {
  const ordered = [...sessions].sort((a, b) => a.startedMs - b.startedMs || a.sessionId.localeCompare(b.sessionId));
  const series = new Map<string, Series>();
  /** Heaviest imported comparable value per exercise, convention and unit as stored. */
  const imported = new Map<string, number>();
  const found: (ProgressRecord & { order: number; startedMs: number })[] = [];

  // Sessions that started at the same instant don't see each other (`findSetRecord` takes history started strictly before).
  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (j < ordered.length && ordered[j]?.startedMs === ordered[i]?.startedMs) j += 1;
    const group = ordered.slice(i, j);
    for (const s of group) if (s.source === 'manual' && inRange(s.date, window)) judge(s);
    for (const s of group) learn(s);
    i = j;
  }

  function judge(s: ProgressSession): void {
    s.exercises.forEach((ex, order) => {
      const convention = ex.convention;
      if (ex.measurement !== 'reps' || convention === 'assistance' || convention === 'bodyweight' || ex.sets.length === 0) return;
      const today = new Map<string, Comparable[]>();
      let heaviest: Comparable | null = null;
      let mostReps: Comparable | null = null;
      for (const set of ex.sets) {
        if (isComparable(set) && set.reps > 0 && set.load.convention === convention) {
          const key = seriesKey(ex.exerciseId, ex.equipmentId, convention, set.load.unit);
          const before = series.get(key);
          if (before !== undefined && before.sessions >= RECORD_MIN_SESSIONS) {
            const earlier = fold({ ...before, sessions: 0 }, today.get(key) ?? []);
            let kind: ProgressRecordKind | null = null;
            if (set.load.value > earlier.maxLoad) kind = 'heaviest';
            else if (set.load.value === earlier.maxLoad && set.reps > earlier.maxReps) kind = 'most_reps_at_load';
            if (kind !== null && !importedHeavier(ex.exerciseId, convention, set.load)) {
              if (kind === 'heaviest') heaviest = set;
              else mostReps = set;
            }
          }
        }
        // Every set of the row is "earlier today" for the next one; only comparable ones of the same series count.
        if (isComparable(set) && set.load.convention === convention) {
          const key = seriesKey(ex.exerciseId, ex.equipmentId, convention, set.load.unit);
          today.set(key, [...(today.get(key) ?? []), set]);
        }
      }
      const shown = heaviest ?? mostReps;
      if (shown === null) return;
      const kind: ProgressRecordKind = heaviest !== null ? 'heaviest' : 'most_reps_at_load';
      const loadWords = loadText(shown.load, convention, ex.equipmentKind === null ? null : { kind: ex.equipmentKind });
      found.push({
        kind,
        sessionId: s.sessionId,
        date: s.date,
        sessionExerciseId: ex.sessionExerciseId,
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        equipmentId: ex.equipmentId,
        equipmentKind: ex.equipmentKind,
        gymId: ex.gymId,
        convention,
        load: shown.load,
        reps: shown.reps,
        label: kind === 'heaviest' ? 'Heaviest set' : `Most reps at ${loadWords}`,
        value: kind === 'heaviest' ? `${loadWords}${NBSP}×${NBSP}${String(shown.reps)}` : String(shown.reps),
        isEstimate: false,
        estimate: null,
        order,
        startedMs: s.startedMs,
      });
    });
  }

  function importedHeavier(exerciseId: string, convention: LoadConvention, load: Load): boolean {
    for (const unit of ['kg', 'lb'] as const) {
      const max = imported.get(importKey(exerciseId, convention, unit));
      if (max !== undefined && convertMass({ value: max, unit }, load.unit).value > load.value + 1e-9) return true;
    }
    return false;
  }

  function learn(s: ProgressSession): void {
    if (s.source === 'import') {
      for (const ex of s.exercises) {
        for (const set of ex.sets) {
          // As `findSetRecord`'s suppression: any counted working set with a load (reps not needed).
          if (!WORKING_GROUP.has(set.setType) || !isSetCountable(set, 'record') || set.load === null) continue;
          const key = importKey(ex.exerciseId, set.load.convention, set.load.unit);
          imported.set(key, Math.max(imported.get(key) ?? -Infinity, set.load.value));
        }
      }
      return;
    }
    // One session per series however many rows it had there (rows on one equipment form one history session).
    const bySeries = new Map<string, Comparable[]>();
    for (const ex of s.exercises) {
      for (const set of ex.sets) {
        if (!isComparable(set)) continue;
        const key = seriesKey(ex.exerciseId, ex.equipmentId, set.load.convention, set.load.unit);
        bySeries.set(key, [...(bySeries.get(key) ?? []), set]);
      }
    }
    for (const [key, sets] of bySeries) series.set(key, fold(series.get(key), sets));
  }

  if (opts.estimates === true) {
    // Slice B (PG30): `Best Est. 1RM` for a logged row with no actual record that day (one record per row per workout).
    const claimed = new Set(found.map((r) => r.sessionExerciseId));
    const rowOf = new Map<string, { s: ProgressSession; ex: ProgressSession['exercises'][number]; order: number }>();
    for (const s of ordered) s.exercises.forEach((ex, order) => rowOf.set(ex.sessionExerciseId, { s, ex, order }));
    for (const r of e1rmRecords(ordered)) {
      if (!inRange(r.date, window) || claimed.has(r.sessionExerciseId) || r.load === null || r.reps === null) continue;
      const hit = rowOf.get(r.sessionExerciseId);
      if (hit === undefined) continue;
      const { s, ex, order } = hit;
      found.push({
        kind: 'best_e1rm',
        sessionId: s.sessionId,
        date: s.date,
        sessionExerciseId: ex.sessionExerciseId,
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        equipmentId: ex.equipmentId,
        equipmentKind: ex.equipmentKind,
        gymId: ex.gymId,
        convention: ex.convention,
        load: r.load,
        reps: r.reps,
        label: 'Best Est. 1RM',
        value: `≈${formatNumber(r.value)}${NBSP}${loadUnitText(r.load.unit, ex.convention, ex.equipmentKind)}`,
        isEstimate: true,
        estimate: r.value,
        order,
        startedMs: s.startedMs,
      });
    }
  }
  found.sort((a, b) => b.date.localeCompare(a.date) || b.startedMs - a.startedMs || a.order - b.order);
  const limit = opts.limit ?? 5;
  const items: ProgressRecord[] = found.slice(0, limit).map((r) => ({
    kind: r.kind,
    sessionId: r.sessionId,
    date: r.date,
    sessionExerciseId: r.sessionExerciseId,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    equipmentId: r.equipmentId,
    equipmentKind: r.equipmentKind,
    gymId: r.gymId,
    convention: r.convention,
    load: r.load,
    reps: r.reps,
    label: r.label,
    value: r.value,
    isEstimate: r.isEstimate,
    estimate: r.estimate,
  }));
  return { items, total: found.length };
}

// ---------------------------------------------------------------------------
// Records (PG10, PG30)

export type ExerciseRecordKind = 'heaviest' | 'most_reps_at_load' | 'best_e1rm' | 'most_reps';

export interface ExerciseRecord {
  kind: ExerciseRecordKind;
  sessionId: string;
  /** The workout row it came from (Summary opens on it). */
  sessionExerciseId: string;
  date: string;
  startedMs: number;
  /** Est. 1RM value, the heaviest load, or the reps. */
  value: number;
  load: Load | null;
  reps: number | null;
  isEstimate: boolean;
}

/**
 * Est. 1RM records (PG30 `Best Est. 1RM`, PG10): a logged session's Est. 1RM
 * that is strictly above every earlier logged session of the same series,
 * after ≥ `RECORD_MIN_SESSIONS` earlier logged sessions with a value. Imported
 * history never makes one, but an imported Est. 1RM of the same exercise and
 * convention (any unit, converted) at or above it suppresses the claim.
 */
export function e1rmRecords(sessions: readonly ProgressSession[], exerciseIds?: ReadonlySet<string>): ExerciseRecord[] {
  return sequentialRecords(sessions, exerciseIds, 'e1rm');
}

/** Bodyweight `Most reps` records, with the same history rules. */
export function bodyweightRepRecords(sessions: readonly ProgressSession[], exerciseIds?: ReadonlySet<string>): ExerciseRecord[] {
  return sequentialRecords(sessions, exerciseIds, 'reps');
}

function sequentialRecords(sessions: readonly ProgressSession[], exerciseIds: ReadonlySet<string> | undefined, what: 'e1rm' | 'reps'): ExerciseRecord[] {
  const running = new Map<string, { sessions: number; max: number }>();
  const imported = new Map<string, number>();
  const out: ExerciseRecord[] = [];
  const ordered = [...sessions].sort(chronological);
  for (const s of ordered) {
    const seen = new Set<string>();
    for (const ex of s.exercises) {
      if (exerciseIds !== undefined && !exerciseIds.has(ex.exerciseId)) continue;
      const key = keyOfRow(s, ex);
      const id = seriesIdOf(key);
      if (seen.has(id)) continue;
      seen.add(id);
      const rows = s.exercises.filter((r) => r.exerciseId === ex.exerciseId && seriesIdOf(keyOfRow(s, r)) === id);
      const ss: SeriesSession = { sessionId: s.sessionId, date: s.date, startedMs: s.startedMs, source: key.source, name: s.name, rows, sets: rows.flatMap((r) => r.sets), edited: false };
      const kind = seriesKind(key.convention, ex.equipmentKind, key.measurement);
      const v = what === 'e1rm' ? sessionE1rm(ss, { key, kind, equipmentKind: ex.equipmentKind }) : kind === 'bodyweight' ? sessionBestSet(ss) : null;
      if (v === null) continue;
      const impKey = `${ex.exerciseId}|${key.convention}`;
      if (key.source === 'import') {
        const asKg = what === 'e1rm' ? convertMass({ value: v.value, unit: key.unit }, 'kg').value : v.value;
        imported.set(impKey, Math.max(imported.get(impKey) ?? -Infinity, asKg));
        continue;
      }
      const before = running.get(id);
      if (before !== undefined && before.sessions >= RECORD_MIN_SESSIONS && v.value > before.max) {
        const imp = imported.get(impKey);
        const mine = what === 'e1rm' ? convertMass({ value: v.value, unit: key.unit }, 'kg').value : v.value;
        if (imp === undefined || imp < mine - 1e-9) {
          out.push({
            kind: what === 'e1rm' ? 'best_e1rm' : 'most_reps',
            sessionId: s.sessionId,
            sessionExerciseId: (rows[0] as ProgressExercise).sessionExerciseId,
            date: s.date,
            startedMs: s.startedMs,
            value: v.value,
            load: v.fromSet?.load ?? null,
            reps: v.fromSet?.reps ?? null,
            isEstimate: what === 'e1rm',
          });
        }
      }
      running.set(id, { sessions: (before?.sessions ?? 0) + 1, max: Math.max(before?.max ?? -Infinity, v.value) });
    }
  }
  return out;
}

const ALL_TIME: DateRange = { from: '0000-01-01', to: '9999-12-31' };

/**
 * `exerciseRecords` (§6.2): every record of the series, newest first:
 * `Heaviest set` and `Most reps at <load>` exactly as the home and the
 * Summary judge them (`recordsInWindow`, `findSetRecord`), `Best Est. 1RM`
 * (an estimate) and, for bodyweight, `Most reps`. Imported series never have
 * records (they can only suppress one). `sessions` may be every workout or
 * only those with this exercise.
 */
export function exerciseRecords(sessions: readonly ProgressSession[], series: ExerciseSeries): { items: ExerciseRecord[]; loggedSessions: number } {
  const loggedSessions = series.key.source === 'app' ? series.sessions.length : 0;
  if (series.key.source === 'import') return { items: [], loggedSessions };
  const ids = new Set([series.key.exerciseId]);
  // Only this exercise's rows: records and import suppression never look at other exercises.
  const mine = sessions.flatMap((s) => {
    const rows = s.exercises.filter((e) => e.exerciseId === series.key.exerciseId);
    return rows.length === 0 ? [] : [{ ...s, exercises: rows }];
  });
  const items: ExerciseRecord[] = [];
  if (series.kind === 'load' || series.kind === 'added_bodyweight') {
    const actual: ProgressRecord[] = recordsInWindow(mine, ALL_TIME, { limit: Number.POSITIVE_INFINITY }).items;
    const startedOf = new Map(mine.map((s) => [s.sessionId, s.startedMs]));
    for (const r of actual) {
      if (r.equipmentId !== series.key.equipmentId || r.convention !== series.key.convention || r.load.unit !== series.key.unit || r.exerciseId !== series.key.exerciseId) continue;
      items.push({ kind: r.kind, sessionId: r.sessionId, sessionExerciseId: r.sessionExerciseId, date: r.date, startedMs: startedOf.get(r.sessionId) ?? 0, value: r.kind === 'heaviest' ? r.load.value : r.reps, load: r.load, reps: r.reps, isEstimate: false });
    }
  }
  const inSeries = (r: ExerciseRecord) => series.sessions.some((s) => s.sessionId === r.sessionId && s.rows.some((row) => row.sessionExerciseId === r.sessionExerciseId));
  if (series.kind === 'load') items.push(...e1rmRecords(mine, ids).filter(inSeries));
  if (series.kind === 'bodyweight') items.push(...bodyweightRepRecords(mine, ids).filter(inSeries));
  const rank: Record<ExerciseRecordKind, number> = { heaviest: 0, most_reps_at_load: 1, most_reps: 2, best_e1rm: 3 };
  items.sort((a, b) => b.date.localeCompare(a.date) || b.startedMs - a.startedMs || rank[a.kind] - rank[b.kind]);
  return { items, loggedSessions };
}

