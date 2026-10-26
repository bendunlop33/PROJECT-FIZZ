import type { SessionAggregate, SetValues } from '@fizz/schemas';

import { valuesText } from '../display';
import { withExclusionWords } from '../exclusions';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets } from './gym-switch';
import type { ComparableSet } from './view';

/**
 * "Last time" for one set of the workout in progress (Ben, 26 Oct 2026;
 * lock-screen-and-alerts §2.1, §2.2): the same working set of the last
 * comparable session (same exercise, equipment instance, unit and
 * convention: `lastComparableSession`). Pure. An actual result, never an
 * estimate (rule 6), and never stretched: no matching set (a 4th set when
 * last time had 3), a warm-up, or a load in another unit or convention gives
 * null, so the lock screen shows nothing rather than a guess.
 */

export interface LastTime {
  values: SetValues;
  /** `100 kg × 7`, `22.5 kg each × 10`, `BW × 12`, `0:45`; flagged sets keep their words (`· spotted`). */
  text: string;
}

/** History for an exercise row of the workout: the last comparable session's working sets, or undefined (not read yet / none). */
export type LastComparableLookup = (sessionExerciseId: string) => readonly ComparableSet[] | undefined;

/**
 * The set's position among its row's working sets (0-based), as the last
 * comparable session's sets are numbered (warm-ups and the other-side row of
 * a left/right pair don't count). Null for a warm-up or an other-side row.
 */
export function workingOrdinal(state: Pick<SessionAggregate, 'exercises' | 'sets'>, setId: string): number | null {
  const set = state.sets.find((s) => s.id === setId);
  if (!set || set.setType === 'warmup' || set.pairedWithSetId !== null) return null;
  const own = blockSets(state, set.sessionExerciseId).filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.setType !== 'warmup' && s.pairedWithSetId === null);
  const i = own.findIndex((s) => s.id === set.id);
  return i < 0 ? null : i;
}

/** Last time for `setId`, from that row's last comparable sets; null when there is no like-for-like set. */
export function lastTimeOfSet(state: SessionAggregate, setId: string, lastComparable: readonly ComparableSet[] | undefined): LastTime | null {
  if (lastComparable === undefined || lastComparable.length === 0) return null;
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  const ordinal = workingOrdinal(state, setId);
  if (ordinal === null) return null;
  const match = lastComparable.find((c) => c.index === ordinal);
  if (!match) return null;
  const load = match.values.load;
  // History in another unit or convention is never shown as if it were today's (review B1).
  if (load !== null && load.convention !== 'bodyweight' && (load.unit !== ex.unit || load.convention !== ex.loadConvention)) return null;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const text = withExclusionWords(valuesText(match.values, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }), match.exclusions);
  return { values: match.values, text };
}
