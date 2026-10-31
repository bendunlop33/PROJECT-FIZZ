import type { SessionAggregate, SessionExercise } from '@fizz/schemas';

/**
 * `Superset with…` and `Remove superset` on a live exercise (Ben, 19 Oct: "I want the option to
 * add superset to an existing set", "Even if it's the same exercise with different or no weight").
 * Pure: what the `⋯` menu offers, the exercises already in the workout it can pair with, and the
 * set count a new partner starts with. The writes are `link_superset`, `split_superset` and
 * `add_exercise` with `supersetWithSessionExerciseId`; their checks are the reducer's.
 */

export interface SupersetMenu {
  /** `Superset with…`: the row has a set not done yet and no parts at another gym. */
  canPair: boolean;
  /** `Remove superset`: the row is in a superset. */
  inSuperset: boolean;
}

export interface SupersetPartner {
  sessionExerciseId: string;
  exerciseName: string;
  /** `2 sets left`, `Superset B · 1 set left`. */
  detail: string;
}

const live = (state: SessionAggregate): SessionExercise[] => state.exercises.filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order);
const pendingOf = (state: SessionAggregate, id: string): number => state.sets.filter((s) => s.sessionExerciseId === id && s.status === 'pending' && s.pairedWithSetId === null).length;
const parted = (rows: readonly SessionExercise[], e: SessionExercise): boolean => e.continuesFromId !== undefined || rows.some((x) => x.continuesFromId === e.id);

export function supersetMenu(state: SessionAggregate, sessionExerciseId: string): SupersetMenu {
  const rows = live(state);
  const row = rows.find((e) => e.id === sessionExerciseId);
  if (row === undefined || state.session.status !== 'active') return { canPair: false, inSuperset: false };
  return { canPair: pendingOf(state, row.id) > 0 && !parted(rows, row), inSuperset: row.supersetGroup !== null };
}

/** The other exercises in the workout this one can pair with: a set left, not split across gyms, not in another superset when this one is in one. */
export function supersetPartners(state: SessionAggregate, sessionExerciseId: string): SupersetPartner[] {
  const rows = live(state);
  const row = rows.find((e) => e.id === sessionExerciseId);
  if (row === undefined) return [];
  return rows
    .filter((e) => e.id !== row.id && pendingOf(state, e.id) > 0 && !parted(rows, e))
    .filter((e) => row.supersetGroup === null || e.supersetGroup === null)
    .map((e) => {
      const n = pendingOf(state, e.id);
      const left = `${String(n)} ${n === 1 ? 'set' : 'sets'} left`;
      return { sessionExerciseId: e.id, exerciseName: e.exerciseName, detail: e.supersetGroup === null ? left : `Superset ${e.supersetGroup} · ${left}` };
    });
}

/** A new partner's working sets: as many as the exercise has left (its working sets not done yet), 1 to 10. */
export function supersetPartnerSets(state: SessionAggregate, sessionExerciseId: string): number {
  const n = state.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status === 'pending' && s.pairedWithSetId === null && s.setType !== 'warmup').length;
  return Math.min(10, Math.max(1, n));
}
