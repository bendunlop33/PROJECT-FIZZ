/**
 * What `useWorkoutCoach` and the Workout screen's F4 effect decide after a
 * log, a correction, a chip or a coach turn, without React (review
 * coach-fallback S3, r2 S1), so the superset hold (F7), the correction
 * re-check (F4) and the rule fallback for Ben's chips are tested on the real
 * services. The hook and screen only call these.
 */

import type { CoachTurnResult } from '@fizz/coach';
import type { ActionRecord, SessionAggregate } from '@fizz/schemas';

import type { CoachAvailability, CoachService, WorkoutOffer } from './coach-service';
import { coachCouldNotAnswer, offerCandidates, ruleOfferOutcome } from './slot-view';

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

/** Ben's own `Too hard` / `Too easy` on an exercise. */
export interface RuleRequest {
  sessionExerciseId: string;
  intent: 'too_hard' | 'too_easy';
}

/** Ben's chip: the coach when it reads `ok` now; otherwise the built-in rule applies at once (no AI call). */
export function chipRoute(availability: CoachAvailability | null): 'coach' | 'rule' {
  return availability?.status === 'ok' ? 'coach' : 'rule';
}

type SlotOutcome = { text: string; retry: boolean } | null;

/**
 * The slot after a coach turn. Only when the coach couldn't answer (no
 * network, unavailable; not Ben's Cancel, not an answer of "no change"):
 * an `Adjust` on an offer gets the rule's offer for the same trigger (F3),
 * and Ben's own chip gets the rule's change applied now (r1 S1, opId = the
 * turn's id). A turn the coach answered always stands.
 */
export async function settleTurn(
  coach: Pick<CoachService, 'ruleOfferFor' | 'applyRuleRequest'>,
  input: {
    sessionId: string;
    turnId: string;
    result: CoachTurnResult | null;
    after: { adjustment: ActionRecord | null; outcome: SlotOutcome };
    offered: WorkoutOffer | null;
    request: RuleRequest | null;
  },
): Promise<{ adjustment: ActionRecord | null; outcome: SlotOutcome; offer: WorkoutOffer | null }> {
  const couldNotAnswer = input.after.adjustment === null && coachCouldNotAnswer(input.result);
  const offer = input.offered !== null && couldNotAnswer ? await coach.ruleOfferFor(input.offered).catch(() => null) : null;
  const ruled =
    input.request !== null && couldNotAnswer
      ? await coach.applyRuleRequest({ sessionId: input.sessionId, ...input.request, opId: input.turnId }).catch(() => ({ status: 'failed' as const }))
      : null;
  const adjustment = ruled?.status === 'applied' ? ruled.record : input.after.adjustment;
  const outcome = offer !== null || adjustment !== null ? null : ruled !== null && ruled.status !== 'applied' ? ruleOfferOutcome(ruled.status) : input.after.outcome;
  return { adjustment, outcome, offer };
}
