import type { Load, LoadConvention, SetType } from '@fizz/schemas';
import { loadText, type LoadContext } from '../display';
import type { HistorySession, HistorySet } from '../progression';
import { convertMass } from '../units';

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
 * claim rather than contradict it.
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
  set: { setType: SetType; load: Load | null; reps: number | null };
  /** Earlier sets of this exercise in the same workout, logged before this one. */
  earlierToday: readonly HistorySet[];
  /** Finished sessions with this exercise, excluding the current workout. */
  history: readonly HistorySession[];
}

const WORKING_GROUP: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);

function comparableSet(s: HistorySet, convention: LoadConvention, unit: Load['unit']): s is HistorySet & { load: Load; reps: number } {
  return WORKING_GROUP.has(s.setType) && s.load !== null && s.reps !== null && s.load.convention === convention && s.load.unit === unit;
}

export function findSetRecord(input: SetRecordInput): SetRecord | null {
  const { set, convention } = input;
  if (input.measurement !== 'reps' || convention === 'assistance' || convention === 'bodyweight') return null;
  if (!WORKING_GROUP.has(set.setType) || set.load === null || set.reps === null || set.reps <= 0) return null;
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
    .some((s) => s.load !== null && s.load.convention === convention && WORKING_GROUP.has(s.setType) && convertMass(s.load, unit).value > load.value + 1e-9);
  if (importedHeavier) return null;

  const name = input.exerciseName.toLowerCase();
  if (kind === 'heaviest') return { kind, text: input.gymName ? `Heaviest ${name} set at ${input.gymName} so far` : `Heaviest ${name} set so far` };
  return { kind, text: `Most reps at ${loadText(load, convention, input.equipment ?? null)} on ${name} so far` };
}
