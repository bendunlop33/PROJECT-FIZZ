import type { Load, LoadConvention, SetType, WeightUnit } from '@fizz/schemas';
import { loadText, NBSP } from '../display';
import { isSetCountable } from '../exclusions';
import { RECORD_MIN_SESSIONS } from '../session/records';
import { convertMass } from '../units';
import type { ProgressSession, ProgressSet } from './projection';
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

export type ProgressRecordKind = 'heaviest' | 'most_reps_at_load';

export interface ProgressRecord {
  kind: ProgressRecordKind;
  sessionId: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  equipmentId: string | null;
  gymId: string | null;
  convention: LoadConvention;
  load: Load;
  reps: number;
  /** `Heaviest set` · `Most reps at 59 kg`. */
  label: string;
  /** `105 kg × 3` · `12`. */
  value: string;
  /** Records here are actual results; Est. 1RM records (slice B) set this. */
  isEstimate: false;
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

export function recordsInWindow(sessions: readonly ProgressSession[], window: DateRange, opts: { limit?: number } = {}): RecordsInWindow {
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
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        equipmentId: ex.equipmentId,
        gymId: ex.gymId,
        convention,
        load: shown.load,
        reps: shown.reps,
        label: kind === 'heaviest' ? 'Heaviest set' : `Most reps at ${loadWords}`,
        value: kind === 'heaviest' ? `${loadWords}${NBSP}×${NBSP}${String(shown.reps)}` : String(shown.reps),
        isEstimate: false,
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

  found.sort((a, b) => b.date.localeCompare(a.date) || b.startedMs - a.startedMs || a.order - b.order);
  const limit = opts.limit ?? 5;
  const items: ProgressRecord[] = found.slice(0, limit).map((r) => ({
    kind: r.kind,
    sessionId: r.sessionId,
    date: r.date,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    equipmentId: r.equipmentId,
    gymId: r.gymId,
    convention: r.convention,
    load: r.load,
    reps: r.reps,
    label: r.label,
    value: r.value,
    isEstimate: false,
  }));
  return { items, total: found.length };
}
