import type { EquipmentInstance, SessionAggregate, SessionExercise, SetValues, WorkoutSet } from '@fizz/schemas';

import { NBSP, rowLoadCell, rowValueCell } from '../display';
import { massWords } from '../progress/text';
import type { PreviousSession } from './active-view';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, partRootOf } from './gym-switch';

/**
 * (Ben, 26 Oct; competitor pass 4 #1) Last time on every set row of the live table: the comparable set from the
 * last session of this exercise (`lastComparableSession`: the same equipment item, unit and load convention;
 * FitNotes history on unit and convention, B7), matched by working-set number. Set 1 shows last time's first
 * working set, set 2 the second, and so on; a set with no partner last time (an extra set, a warm-up) has none
 * and the row says `—` (rule 6: never the nearest set, never an estimate). Pure; nothing here is written.
 */

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

/** A row's working-set number (0-based) in its block; the other side of a single-side log shares its partner's. */
function workingOrdinals(sets: readonly WorkoutSet[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const s of sets) {
    if (s.setType === 'warmup' || s.pairedWithSetId !== null) continue;
    out.set(s.id, n);
    n += 1;
  }
  for (const s of sets) if (s.pairedWithSetId !== null && s.setType !== 'warmup') {
    const k = out.get(s.pairedWithSetId);
    if (k !== undefined) out.set(s.id, k);
  }
  return out;
}

/**
 * Every live set of the block `rowId` is in (all its gym-switch parts) → last time's comparable set, or null (`—`).
 * `previous` is keyed by session-exercise row, as `buildActiveSetView` reads it; a part with none of its own uses
 * the block's first part's.
 */
export function lastPerSet(state: Pick<SessionAggregate, 'exercises' | 'sets' | 'session'>, rowId: string, previous: Readonly<Record<string, PreviousSession | null>>): Map<string, SetLast | null> {
  const root = partRootOf(state.exercises, rowId);
  const sets = blockSets(state, root);
  const ordinals = workingOrdinals(sets);
  const out = new Map<string, SetLast | null>();
  for (const s of sets) {
    const ex = state.exercises.find((e) => e.id === s.sessionExerciseId);
    const prev = ex === undefined ? null : (previous[ex.id] ?? previous[root] ?? null);
    const k = ordinals.get(s.id);
    const c = k === undefined || prev === null ? undefined : prev.sets[k];
    if (ex === undefined || prev === null || c === undefined) {
      out.set(s.id, null);
      continue;
    }
    const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
    const values: SetValues = { ...c.values, rpe: null, rir: null };
    out.set(s.id, { text: setLastText(values, ex, eq), values, accessibilityLabel: spokenOf(values, ex, eq), performedAtUtc: prev.performedAtUtc, imported: prev.imported });
  }
  return out;
}
