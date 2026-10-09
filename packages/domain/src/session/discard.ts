import type { SessionAggregate } from '@fizz/schemas';

/**
 * What `Discard workout` must ask before it calls `discard` (active-workout
 * §4.9; competitor-failure pack (e), LiftTrack's "no second step"). Discard
 * has no Undo, so with any logged set it always confirms first; with nothing
 * logged there is nothing to lose and it discards at once. The workout
 * screen's menu and the finish sheet both use this; Today's stale-workout
 * card offers Discard only when nothing is logged (`endedAboutUtc` null).
 *
 * Logged = completed rows; deleted and skipped sets don't count. The confirm
 * must be dispatched with the `expectedVersion` it was shown for, so a set
 * logged while the alert is open (Live Activity, voice) makes it fail as
 * stale instead of discarding a set Ben never saw counted.
 */
export type DiscardConfirmation =
  | { required: false; loggedSets: 0; expectedVersion: number }
  | { required: true; loggedSets: number; expectedVersion: number; message: string };

export function discardConfirmation(state: SessionAggregate): DiscardConfirmation {
  const loggedSets = state.sets.filter((s) => s.status === 'completed').length;
  const expectedVersion = state.session.version;
  if (loggedSets === 0) return { required: false, loggedSets: 0, expectedVersion };
  return {
    required: true,
    loggedSets,
    expectedVersion,
    message: `${String(loggedSets)} logged ${loggedSets === 1 ? 'set' : 'sets'} will be discarded. This can’t be undone.`,
  };
}
