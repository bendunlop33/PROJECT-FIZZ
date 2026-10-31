import type { EquipmentInstance, SessionAggregate, SessionExercise, SetSide, SetValues, WorkoutSet } from '@fizz/schemas';

import { NBSP, rowLoadCell, rowValueCell, valuesText } from '../display';
import { withExclusionWords } from '../exclusions';
import { massWords } from '../progress/text';
import type { PreviousSession } from './active-view';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets } from './gym-switch';
import type { ComparableSet } from './view';

/**
 * The one "last time" rule (Ben, 26 Oct 2026; lock-screen-and-alerts §2.1–§2.2, workout-table-v3 last-time line).
 * Every place that shows what Ben did last time for a set reads it from `lastTimeMatch`: the table's per-row line,
 * the open row's `Last` header and `Copy last`, the Lock Screen's `Last …` line and the rest-done notification.
 *
 * - Last time = the last comparable session of that row (`lastComparableSession`: same exercise, same equipment
 *   item, same unit and load convention).
 * - Set n of today matches last time's n-th working set: warm-ups don't count, and the two sides of a single-side
 *   log count once (today: the other-side row shares its partner's number; last time: a left followed by a right).
 *   After a gym switch, sets are numbered across the parts on the same equipment item, as history stores them.
 * - No partner (a 4th set when last time had 3), a warm-up, or a load in another unit or convention gives null:
 *   nothing is shown rather than a guess (rule 6). Never the nearest set, never an estimate.
 * - (Ben, 26 Oct) The table's PREVIOUS column (`lastPerSet`) also shows a `W` row its own previous: today's n-th
 *   warm-up ↔ last time's n-th warm-up (`PreviousSession.warmups`), by the same like-for-like test. The Lock Screen
 *   and notification still name only working sets.
 *
 * Pure; nothing here is written.
 */

/** History for an exercise row of the workout: the last comparable session's working sets, or undefined (not read yet / none). */
export type LastComparableLookup = (sessionExerciseId: string) => readonly ComparableSet[] | undefined;

export interface LastTime {
  values: SetValues;
  /** `100 kg × 7`, `22.5 kg each × 10`, `BW × 12`, `0:45`; flagged sets keep their words (`· spotted`). */
  text: string;
}

const isSide = (s: SetSide | null | undefined): s is 'left' | 'right' => s === 'left' || s === 'right';

/** Today's sets numbered with the row's: the block's parts on the same equipment item (history buckets by item). */
function comparisonSets(state: Pick<SessionAggregate, 'exercises' | 'sets'>, ex: SessionExercise): WorkoutSet[] {
  const item = ex.equipmentId ?? null;
  const rows = new Map(state.exercises.map((e) => [e.id, e]));
  return blockSets(state, ex.id).filter((s) => (rows.get(s.sessionExerciseId)?.equipmentId ?? null) === item);
}

/** Today's working-set numbers (0-based): warm-ups have none; an other-side row shares its partner's. */
function todayOrdinals(sets: readonly WorkoutSet[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const s of sets) {
    if (s.setType === 'warmup' || s.pairedWithSetId !== null) continue;
    out.set(s.id, n);
    n += 1;
  }
  for (const s of sets) {
    if (s.pairedWithSetId === null || s.setType === 'warmup') continue;
    const k = out.get(s.pairedWithSetId);
    if (k !== undefined) out.set(s.id, k);
  }
  return out;
}

/** Last time's working-set numbers, in order: a one-side set straight after the other side is the same set. */
function historyOrdinals(sets: readonly ComparableSet[]): number[] {
  const out: number[] = [];
  let n = -1;
  let open: 'left' | 'right' | null = null;
  for (const c of sets) {
    const side = c.side ?? null;
    if (isSide(side) && open !== null && open !== side) {
      out.push(n);
      open = null;
      continue;
    }
    n += 1;
    out.push(n);
    open = isSide(side) ? side : null;
  }
  return out;
}

function compatible(c: ComparableSet, ex: Pick<SessionExercise, 'unit' | 'loadConvention'>): boolean {
  const load = c.values.load;
  // History in another unit or convention is never shown as if it were today's (review B1).
  return load === null || load.convention === 'bodyweight' || (load.unit === ex.unit && load.convention === ex.loadConvention);
}

function pick(set: WorkoutSet, k: number | undefined, last: readonly ComparableSet[], numbers: readonly number[], ex: SessionExercise): ComparableSet | null {
  if (k === undefined) return null;
  const candidates = last.filter((_, i) => numbers[i] === k);
  const match = (isSide(set.side) ? candidates.find((c) => c.side === set.side) : undefined) ?? candidates[0];
  return match !== undefined && compatible(match, ex) ? match : null;
}

/**
 * The set's working-set number (0-based) as last time's sets are numbered; null for a warm-up or an unknown set.
 * The other side of a single-side log shares its partner's number.
 */
export function workingOrdinal(state: Pick<SessionAggregate, 'exercises' | 'sets'>, setId: string): number | null {
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  return todayOrdinals(comparisonSets(state, ex)).get(setId) ?? null;
}

/** THE rule: last time's set for `setId` from that row's last comparable sets, or null when there is no like-for-like set. */
export function lastTimeMatch(state: Pick<SessionAggregate, 'exercises' | 'sets'>, setId: string, lastComparable: readonly ComparableSet[] | undefined): ComparableSet | null {
  if (lastComparable === undefined || lastComparable.length === 0) return null;
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  return pick(set, todayOrdinals(comparisonSets(state, ex)).get(setId), lastComparable, historyOrdinals(lastComparable), ex);
}

/** Last time for `setId` with its unit (`100 kg × 7`): the Lock Screen, the rest-done notification and the open row's `Last`. */
export function lastTimeOfSet(state: SessionAggregate, setId: string, lastComparable: readonly ComparableSet[] | undefined): LastTime | null {
  const match = lastTimeMatch(state, setId, lastComparable);
  if (match === null) return null;
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!ex) return null;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  return { values: match.values, text: withExclusionWords(valuesText(match.values, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }), match.exclusions) };
}

/** A table row's last-time line (`100 × 8`, the unit is in the column header), from `lastTimeMatch`. */
export interface SetLast {
  /** `100 × 8`, `BW × 12`, `0:45`, `20:00 · 4,800 m`, as the row's own cells read (the unit is in the header). */
  text: string;
  /** What a tap copies into the row (load and reps, time or distance; effort is never copied). */
  values: SetValues;
  /** VoiceOver: "Last time 100 kilograms, 8 reps". */
  accessibilityLabel: string;
  performedAtUtc: string;
  /** From FitNotes (B7): kept as data, it reads like any other. */
  imported: boolean;
}

const TIMES = `${NBSP}×${NBSP}`;

/** `100 × 8` for a set's values, the way its row's cells read them; no unit (the column header has it). */
export function setLastText(values: Pick<SetValues, 'load' | 'reps' | 'durationS' | 'distanceM'>, ex: Pick<SessionExercise, 'measurement' | 'loadConvention'>, eq: Pick<EquipmentInstance, 'kind'> | null): string {
  const value = rowValueCell({ load: values.load, reps: values.reps, durationS: values.durationS, rpe: null, rir: null, ...(values.distanceM !== undefined ? { distanceM: values.distanceM } : {}) }, ex.measurement);
  const load = ex.measurement === 'cardio' ? null : rowLoadCell(values.load, ex.loadConvention, eq);
  return load === null ? value : `${load}${TIMES}${value}`;
}

function spokenOf(values: SetValues, ex: Pick<SessionExercise, 'measurement' | 'loadConvention'>, eq: Pick<EquipmentInstance, 'kind'> | null): string {
  const parts: string[] = [];
  if (ex.loadConvention !== 'bodyweight' && values.load !== null && values.load.convention !== 'bodyweight') parts.push(massWords(values.load, eq?.kind ?? null));
  if (ex.measurement === 'reps' && values.reps !== null) parts.push(`${String(values.reps)} reps`);
  else parts.push(setLastText(values, ex, eq).replaceAll(NBSP, ' '));
  return `Last time ${parts.join(', ')}`;
}

/** Today's n-th warm-up ↔ last time's n-th warm-up (same unit and convention), else null. */
function warmupPick(set: WorkoutSet, todayWarmups: readonly string[], last: readonly ComparableSet[], ex: SessionExercise): ComparableSet | null {
  const k = todayWarmups.indexOf(set.id);
  const match = k < 0 ? undefined : last[k];
  return match !== undefined && compatible(match, ex) ? match : null;
}

/**
 * Every live set of the block `rowId` is in (all its gym-switch parts) → its last-time line, or null (`—`).
 * `previous` is keyed by session-exercise row, as `buildActiveSetView` reads it. A part with no comparable session
 * of its own has none: another item's history is never borrowed.
 */
export function lastPerSet(state: Pick<SessionAggregate, 'exercises' | 'sets' | 'session'>, rowId: string, previous: Readonly<Record<string, PreviousSession | null>>): Map<string, SetLast | null> {
  const out = new Map<string, SetLast | null>();
  const rows = new Map(state.exercises.map((e) => [e.id, e]));
  const groups = new Map<string, { ordinals: Map<string, number>; warmups: string[] }>();
  for (const s of blockSets(state, rowId)) {
    const ex = rows.get(s.sessionExerciseId);
    const prev = ex === undefined ? null : (previous[ex.id] ?? null);
    if (ex === undefined || prev === null) {
      out.set(s.id, null);
      continue;
    }
    const key = ex.equipmentId ?? '';
    let g = groups.get(key);
    if (g === undefined) {
      const today = comparisonSets(state, ex);
      g = { ordinals: todayOrdinals(today), warmups: today.filter((x) => x.setType === 'warmup' && x.status !== 'deleted').map((x) => x.id) };
      groups.set(key, g);
    }
    // (Ben, 26 Oct) A warm-up row shows last time's warm-up in the same place (n-th warm-up), if there was one.
    const c = s.setType === 'warmup' ? warmupPick(s, g.warmups, prev.warmups ?? [], ex) : pick(s, g.ordinals.get(s.id), prev.sets, historyOrdinals(prev.sets), ex);
    if (c === null) {
      out.set(s.id, null);
      continue;
    }
    const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
    const values: SetValues = { ...c.values, rpe: null, rir: null };
    out.set(s.id, { text: setLastText(values, ex, eq), values, accessibilityLabel: spokenOf(values, ex, eq), performedAtUtc: prev.performedAtUtc, imported: prev.imported });
  }
  return out;
}
