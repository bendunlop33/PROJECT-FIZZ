import type { EquipmentKind, Load, LoadConvention } from '@fizz/schemas';
import { loadText, NBSP } from '../display';
import { isSetCountable } from '../exclusions';
import type { NewBestClaim, NewBestRecords } from '../review/progress-page';
import { roundEstimate } from './e1rm';
import { convertMass } from '../units';
import type { ExerciseSeries } from './exercise';
import type { ProgressExercise, ProgressSession } from './projection';
import { inRange, type DateRange } from './window';

/**
 * Progress's `RECORDS` (Training's list, Lifts and Exercise detail, the monthly recap's count). (Ben, 26 Oct: one
 * definition of best) A record is a `New best`, exactly as the Summary, the table's `PB` mark and Overview's PB ring
 * judge it (`newBestClaims`, `sessionNewBests`): a tracked lift, at its tracked reps, a real set heavier (assisted:
 * less assistance) than every earlier real one; the same machine for stacks and plate-loaded. So:
 * - a lift that isn't tracked has no records (Lifts and Exercise detail hide the section);
 * - an estimate (Est. 1RM) is never a record: it stays on the chart and stat line, labelled;
 * - a lift's first top set isn't one, an imported workout never claims one (ADR 0016), and a lift whose older
 *   history couldn't be read claims none (rule 6).
 * Replaces the earlier `Heaviest set`, `Most reps at <load>`, `Best Est. 1RM`, bodyweight `Most reps` and
 * `Least assistance` lists (progress.md PG10, PG30). Pure.
 */

export type ProgressRecordKind = 'new_best';

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
  /** In Ben's unit, as the Summary's `New best` says it. */
  load: Load;
  reps: number;
  /** `New best`. */
  label: string;
  /** `102.5 kg × 8`. */
  value: string;
  /** Always false: an estimate is never a record. */
  isEstimate: false;
  estimate: null;
}

export interface RecordsInWindow {
  /** Newest first, at most `limit`. */
  items: ProgressRecord[];
  total: number;
}

export const RECORD_LABEL = 'New best';

const WORKING = new Set(['working', 'top', 'backoff']);

/** The workout row a claim's set was done on: the row of that lift holding a counted set at those reps and load. */
function rowOfClaim(s: ProgressSession, c: NewBestClaim): { ex: ProgressExercise; order: number } | null {
  let first: { ex: ProgressExercise; order: number } | null = null;
  for (const [order, ex] of s.exercises.entries()) {
    if (ex.exerciseId !== c.exerciseId) continue;
    first ??= { ex, order };
    const hit = ex.sets.some((x) => {
      if (!WORKING.has(x.setType) || !isSetCountable(x, 'record') || x.load === null || x.reps !== c.reps || x.load.convention !== c.convention) return false;
      return roundEstimate(convertMass({ value: x.load.value, unit: x.load.unit }, c.unit).value, c.unit) === c.load;
    });
    if (hit) return { ex, order };
  }
  return first;
}

function recordOf(s: ProgressSession, c: NewBestClaim): (ProgressRecord & { order: number; startedMs: number }) | null {
  const at = rowOfClaim(s, c);
  if (at === null) return null;
  const { ex, order } = at;
  const load: Load = { value: c.load, unit: c.unit, convention: c.convention };
  const words = loadText(load, c.convention, ex.equipmentKind === null ? null : { kind: ex.equipmentKind });
  return {
    kind: 'new_best',
    sessionId: s.sessionId,
    date: s.date,
    sessionExerciseId: ex.sessionExerciseId,
    exerciseId: c.exerciseId,
    exerciseName: ex.exerciseName,
    equipmentId: ex.equipmentId,
    equipmentKind: ex.equipmentKind,
    gymId: ex.gymId,
    convention: c.convention,
    load,
    reps: c.reps,
    label: RECORD_LABEL,
    value: `${words}${NBSP}×${NBSP}${String(c.reps)}`,
    isEstimate: false,
    estimate: null,
    order,
    startedMs: s.startedMs,
  };
}

/** The records (`New best`s) set in a window, newest first. Only workouts in `sessions` that were logged in the app. */
export function recordsInWindow(sessions: readonly ProgressSession[], window: DateRange, opts: { limit?: number; bests: NewBestRecords }): RecordsInWindow {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const found: (ProgressRecord & { order: number; startedMs: number })[] = [];
  for (const c of opts.bests.claims) {
    if (!inRange(c.date, window)) continue;
    const s = byId.get(c.sessionId);
    if (s === undefined || s.source === 'import') continue;
    const r = recordOf(s, c);
    if (r !== null) found.push(r);
  }
  found.sort((a, b) => b.date.localeCompare(a.date) || b.startedMs - a.startedMs || a.order - b.order);
  const limit = opts.limit ?? 5;
  const items: ProgressRecord[] = found.slice(0, limit).map((r) => {
    const out: ProgressRecord & { order?: number; startedMs?: number } = { ...r };
    delete out.order;
    delete out.startedMs;
    return out;
  });
  return { items, total: found.length };
}

// ---------------------------------------------------------------------------
// One exercise's records (Lifts, Exercise detail)

export type ExerciseRecordKind = 'new_best';

export interface ExerciseRecord {
  kind: ExerciseRecordKind;
  sessionId: string;
  /** The workout row it came from (Summary opens on it). */
  sessionExerciseId: string;
  date: string;
  startedMs: number;
  /** The load (in Ben's unit). */
  value: number;
  load: Load;
  reps: number;
  isEstimate: false;
}

/**
 * Every record (`New best`) of one exercise in this series' workouts, newest first. `tracked: false`: the lift isn't
 * tracked, so it has no records at all (the section is hidden rather than saying `No records yet`).
 */
export function exerciseRecords(series: ExerciseSeries, bests: NewBestRecords): { items: ExerciseRecord[]; tracked: boolean } {
  const id = series.key.exerciseId;
  if (!bests.tracked.has(id)) return { items: [], tracked: false };
  const items: ExerciseRecord[] = [];
  for (const c of bests.claims) {
    if (c.exerciseId !== id) continue;
    const ss = series.sessions.find((x) => x.sessionId === c.sessionId);
    if (ss === undefined || ss.source !== 'app') continue;
    const row = ss.rows.find((r) => r.sets.some((x) => x.load?.convention === c.convention && x.reps === c.reps)) ?? ss.rows.find((r) => r.convention === c.convention);
    if (row === undefined) continue;
    items.push({ kind: 'new_best', sessionId: c.sessionId, sessionExerciseId: row.sessionExerciseId, date: c.date, startedMs: c.startedMs, value: c.load, load: { value: c.load, unit: c.unit, convention: c.convention }, reps: c.reps, isEstimate: false });
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || b.startedMs - a.startedMs);
  return { items, tracked: true };
}
