/**
 * What `useWorkoutCoach.afterLog` and the Workout screen's F4 effect do
 * after a log or a correction, without React (review coach-fallback S3), so
 * the superset hold (F7) and the correction re-check (F4) are tested on the
 * real services. The hook and screen only call these.
 */

import type { SessionAggregate } from '@fizz/schemas';

import type { CoachAvailability, CoachService, WorkoutOffer } from './coach-service';
import { offerCandidates } from './slot-view';

/** Sets logged with no rest running, held for the next rest (F7). Per workout. */
export interface HeldSets {
  sessionId: string | null;
  ids: string[];
}

export const NO_HELD_SETS: HeldSets = { sessionId: null, ids: [] };

/** Which sets to check after logging `setId`, and what stays held. Pure. */
export function planOfferCheck(held: HeldSets, aggregate: SessionAggregate, setId: string): { check: string[]; held: HeldSets; resting: boolean } {
  const sid = aggregate.session.id;
  const resting = aggregate.restTimer?.status === 'running';
  const { check, held: ids } = offerCandidates(held.sessionId === sid ? held.ids : [], setId, resting);
  return { check, held: { sessionId: sid, ids }, resting };
}

/**
 * The first offer among `check`, newest first. Availability is read again
 * each time (`Offline` lapses once the network is back); not reachable means
 * the built-in rule offers (CA6 revised). No AI call.
 */
export async function findOffer(
  coach: Pick<CoachService, 'availability' | 'offerAfterLog'>,
  input: { aggregate: SessionAggregate; check: readonly string[]; resting: boolean; pending: boolean },
): Promise<{ availability: CoachAvailability; offer: WorkoutOffer | null }> {
  const availability = await coach.availability();
  for (const setId of input.check) {
    const offer = await coach.offerAfterLog({ aggregate: input.aggregate, setId, resting: input.resting, coachReachable: availability.status === 'ok', pending: input.pending });
    if (offer !== null) return { availability, offer };
  }
  return { availability, offer: null };
}

/** F4: the corrected set to check on return from the correction sheet, once it is saved as logged; else null. */
export function correctedSetToCheck(corrected: { setId: string } | undefined, aggregate: SessionAggregate | null | undefined): string | null {
  if (corrected === undefined || aggregate == null) return null;
  return aggregate.sets.some((x) => x.id === corrected.setId && x.status === 'completed') ? corrected.setId : null;
}
