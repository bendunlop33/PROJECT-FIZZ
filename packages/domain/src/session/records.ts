import type { Load, LoadConvention, SessionAggregate, SetType } from '@fizz/schemas';
import { loadText, type LoadContext } from '../display';
import type { HistorySession, HistorySet } from '../progression';
import { toMs } from '../time';
import { isSetCountable } from '../exclusions';
import { convertMass } from '../units';
import { equipmentOfRow } from './equipment-snapshot';
import { isPlatesAddedKind } from '../plates-added';

/**
 * The heaviest-set line (premium-feel §5.1), the app's only "PR". Pure.
 *
 * A just-logged set is a record only against **comparable** history: same
 * exercise (the caller passes that exercise's history), same equipment
 * instance, load convention, unit and set-type group, from at least
 * `RECORD_MIN_SESSIONS` earlier finished, logged sessions, so the first weeks
 * don't make every set a record. Warm-ups and drop sets never count, assisted
 * and bodyweight movements are passed over (heavier isn't better there), and
 * nothing is computed from an estimate. Imported history isn't comparable
 * (ADR 0016), but a heavier imported set of the same exercise suppresses the
 * claim rather than contradict it. A set Ben marked as not counting
 * (`Spotted`, `Pain`, …, active-workout §2.13) is never a record and never
 * the bar a record is measured against (check 45).
 */

export const RECORD_MIN_SESSIONS = 3;

export type SetRecord =
  | { kind: 'heaviest'; text: string }
  | { kind: 'most_reps_at_load'; text: string };

export interface SetRecordInput {
  exerciseName: string;
  gymName: string | null;
  equipmentId: string | null;
  convention: LoadConvention;
  /** Only exercises measured in reps have records. */
  measurement: string;
  equipment?: LoadContext;
  /** The set just logged. */
  set: { setType: SetType; load: Load | null; reps: number | null; exclusions?: HistorySet['exclusions'] };
  /** Earlier sets of this exercise in the same workout, logged before this one. */
  earlierToday: readonly HistorySet[];
  /** Finished sessions with this exercise, excluding the current workout. */
  history: readonly HistorySession[];
}

const WORKING_GROUP: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);

function comparableSet(s: HistorySet, convention: LoadConvention, unit: Load['unit']): s is HistorySet & { load: Load; reps: number } {
  return WORKING_GROUP.has(s.setType) && isSetCountable(s, 'record') && s.load !== null && s.reps !== null && s.load.convention === convention && s.load.unit === unit;
}

export function findSetRecord(input: SetRecordInput): SetRecord | null {
  const { set, convention } = input;
  if (input.measurement !== 'reps' || convention === 'assistance' || convention === 'bodyweight') return null;
  if (!WORKING_GROUP.has(set.setType) || !isSetCountable(set, 'record') || set.load === null || set.reps === null || set.reps <= 0) return null;
  if (set.load.convention !== convention) return null;
  const load = set.load;
  const unit = load.unit;

  const logged = input.history.filter((h) => !h.imported && h.equipmentId === input.equipmentId);
  const sessionsWith = logged.filter((h) => h.sets.some((s) => comparableSet(s, convention, unit)));
  if (sessionsWith.length < RECORD_MIN_SESSIONS) return null;

  const earlier = [...sessionsWith.flatMap((h) => h.sets), ...input.earlierToday].filter((s) => comparableSet(s, convention, unit));
  const maxLoad = Math.max(...earlier.map((s) => s.load.value));
  let kind: SetRecord['kind'];
  if (load.value > maxLoad) kind = 'heaviest';
  else if (load.value === maxLoad && set.reps > Math.max(...earlier.filter((s) => s.load.value === maxLoad).map((s) => s.reps))) kind = 'most_reps_at_load';
  else return null;

  // A heavier imported set of this exercise (any equipment, same convention) suppresses the claim.
  const importedHeavier = input.history
    .filter((h) => h.imported)
    .flatMap((h) => h.sets)
    .some((s) => s.load !== null && s.load.convention === convention && WORKING_GROUP.has(s.setType) && isSetCountable(s, 'record') && convertMass(s.load, unit).value > load.value + 1e-9);
  if (importedHeavier) return null;

  const name = input.exerciseName.toLowerCase();
  // With no equipment instance the comparison isn't tied to one gym, so the line doesn't name one (review N5).
  const gym = input.equipmentId === null ? null : input.gymName;
  if (kind === 'heaviest') return { kind, text: gym ? `Heaviest ${name} set at ${gym} so far` : `Heaviest ${name} set so far` };
  return { kind, text: `Most reps at ${loadText(load, convention, input.equipment ?? null)} on ${name} so far` };
}

/**
 * The record lines for a whole workout (premium-feel §5.1, Summary
 * Comparison region; review S3): for each exercise, in order, at most one
 * line: the last heaviest-set record logged, else the last most-reps one
 * (each judged as it was logged, against earlier sets that day too). Only history from before this workout started counts,
 * so an old Summary says what was true then. None for an imported workout.
 */
export function sessionRecords(input: SessionRecordsInput): string[] {
  return sessionRecordItems(input).map((r) => r.text);
}

export interface SessionRecordsInput {
  aggregate: SessionAggregate;
  gymName: string | null;
  /** Gym names by ID: a part of a workout done at another gym (gym switch) names its own gym. */
  gymNames?: Readonly<Record<string, string>>;
  /** Finished sessions by exercise ID (this workout is filtered out here). */
  history: Readonly<Record<string, readonly HistorySession[]>>;
}

/** (Ben, 22 Nov) One exercise's record in a workout, as values: the Summary's `Heaviest yet · 80 kg × 12` highlight. */
export interface SessionRecordItem {
  exerciseId: string;
  sessionExerciseId: string;
  name: string;
  kind: SetRecord['kind'];
  /** The record line (`Heaviest bench press set at Main Gym so far`). */
  text: string;
  load: Load;
  reps: number;
  convention: LoadConvention;
  /** An `added` load on a plate-loaded machine: the plates. */
  plates: boolean;
}

/** `sessionRecords` as values, one per exercise at most, in exercise order. */
export function sessionRecordItems(input: SessionRecordsInput): SessionRecordItem[] {
  const { aggregate: state } = input;
  if (state.session.source === 'import') return [];
  const startedMs = toMs(state.session.startedAt.utc);
  const out: SessionRecordItem[] = [];
  for (const ex of [...state.exercises].sort((a, b) => a.order - b.order)) {
    const done = state.sets
      .filter((s) => s.sessionExerciseId === ex.id && s.status === 'completed' && s.actual !== null && s.completedAt !== null)
      .sort((a, b) => (a.completedAt?.utc ?? '').localeCompare(b.completedAt?.utc ?? '') || a.index - b.index);
    if (done.length === 0) continue;
    const history = (input.history[ex.exerciseId] ?? []).filter((h) => h.sessionId !== state.session.id && toMs(h.performedAtUtc) < startedMs);
    const equipment = equipmentOfRow(state.session.equipmentSnapshot, ex);
    // Records are per equipment item, so a part at another gym (gym-switch GS6) names that gym.
    const partGym = equipment !== null && (state.session.gymChanges?.length ?? 0) > 0 ? (input.gymNames?.[equipment.gymId] ?? null) : null;
    const earlierToday: HistorySet[] = [];
    let heaviest: { rec: SetRecord; load: Load; reps: number } | null = null;
    let mostReps: { rec: SetRecord; load: Load; reps: number } | null = null;
    for (const s of done) {
      const actual = s.actual;
      if (actual === null) continue;
      const rec = findSetRecord({
        exerciseName: ex.exerciseName,
        gymName: partGym ?? input.gymName,
        equipmentId: ex.equipmentId,
        convention: ex.loadConvention,
        measurement: ex.measurement,
        equipment,
        set: { setType: s.setType, load: actual.load, reps: actual.reps, ...(s.exclusions ? { exclusions: s.exclusions } : {}) },
        earlierToday,
        history,
      });
      // A record always has a load and reps (`findSetRecord`).
      if (rec !== null && actual.load !== null && actual.reps !== null) {
        if (rec.kind === 'heaviest') heaviest = { rec, load: actual.load, reps: actual.reps };
        else mostReps = { rec, load: actual.load, reps: actual.reps };
      }
      earlierToday.push({ setType: s.setType, side: s.side, load: actual.load, reps: actual.reps, rpe: null, rir: null, ...(s.exclusions ? { exclusions: s.exclusions } : {}) });
    }
    const shown = heaviest ?? mostReps;
    if (shown !== null) {
      out.push({ exerciseId: ex.exerciseId, sessionExerciseId: ex.id, name: ex.exerciseName, kind: shown.rec.kind, text: shown.rec.text, load: shown.load, reps: shown.reps, convention: ex.loadConvention, plates: isPlatesAddedKind(equipment?.kind) });
    }
  }
  return out;
}
