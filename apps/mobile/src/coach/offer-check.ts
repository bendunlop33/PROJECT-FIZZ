/**
 * What `useWorkoutCoach` and the Workout screen's F4 effect decide after a
 * log, a correction, a chip or a coach turn, without React (review
 * coach-fallback S3, r2 S1), so the superset hold (F7), the correction
 * re-check (F4) and the rule fallback for Ben's chips are tested on the real
 * services. The hook and screen only call these.
 */

import type { CoachTurnResult } from '@fizz/coach';
import type { ActionRecord, SessionAggregate } from '@fizz/schemas';

import { liveCoachReachable, type CoachAvailability, type CoachService, type WorkoutOffer } from './coach-service';
import { coachAskedInstead, coachCouldNotAnswer, offerCandidates, ruleOfferOutcome } from './slot-view';

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
  coach: Pick<CoachService, 'availability' | 'offerAfterLog' | 'triggerKindOf'>,
  input: { aggregate: SessionAggregate; check: readonly string[]; resting: boolean; pending: boolean; shown?: WorkoutOffer | null },
): Promise<{ availability: CoachAvailability; offer: WorkoutOffer | null }> {
  const availability = await coach.availability();
  for (const setId of input.check) {
    const offer = await coach.offerAfterLog({ aggregate: input.aggregate, setId, resting: input.resting, coachReachable: liveCoachReachable(availability), pending: input.pending });
    if (offer !== null) return { availability, offer };
  }
  // r3 N3: an effort chip (or a correction) re-checks the set whose offer is showing. CA4 won't offer the same
  // kind twice, so keep the one on screen while that set still triggers it; drop it once it doesn't.
  const shown = input.shown ?? null;
  if (shown !== null && input.resting && input.check.includes(shown.setId)) {
    const kind = await coach.triggerKindOf(input.aggregate, shown.setId).catch(() => null);
    if (kind === shown.kind) return { availability, offer: shown };
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

/** Ben's chip: the coach when it reads `ok` now (with his mid-workout model listed, review S7); otherwise the built-in rule applies at once (no AI call). */
export function chipRoute(availability: CoachAvailability | null): 'coach' | 'rule' {
  return liveCoachReachable(availability) ? 'coach' : 'rule';
}

/** One chip at a time (r3 N5): held from the tap until the chip has been sent to the coach or the rule's write is done. */
export interface ChipGate {
  busy: boolean;
}

/**
 * A `Too hard` / `Too easy` tap. Not `ok` as last read: read again first
 * (`Offline` lapses once the network is back). A second tap while the first
 * is still being read or written does nothing (r3 N5: it applied a second
 * reduction with its own opId).
 */
export async function routeChip(
  coach: Pick<CoachService, 'availability'>,
  gate: ChipGate,
  known: CoachAvailability | null,
  go: { coach: () => void; rule: () => Promise<void>; availability?: (now: CoachAvailability) => void },
): Promise<'coach' | 'rule' | 'busy'> {
  if (gate.busy) return 'busy';
  gate.busy = true;
  try {
    let now = known;
    if (chipRoute(now) !== 'coach') {
      now = await coach.availability().catch(() => known);
      if (now !== null) go.availability?.(now);
    }
    if (chipRoute(now) === 'coach') {
      go.coach();
      return 'coach';
    }
    await go.rule();
    return 'rule';
  } finally {
    gate.busy = false;
  }
}

type SlotOutcome = { text: string; retry: boolean } | null;

/**
 * The slot after a coach turn. Only when the coach couldn't answer (no
 * network, unavailable; not Ben's Cancel, not an answer of "no change"):
 * an `Adjust` on an offer gets the rule's offer for the same trigger (F3),
 * and Ben's own chip gets the rule's change applied now (r1 S1, opId = the
 * turn's id). Also (review S5) when the coach answered Ben's chip with a
 * question and no change: the rule's change applies now. Any other answer
 * the coach gave stands.
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
  // Review S5: Ben's chip, and the coach asked a question instead of changing anything: the rule acts on his tap.
  const askedInstead = input.request !== null && input.after.adjustment === null && coachAskedInstead(input.result);
  const offer = input.offered !== null && couldNotAnswer ? await coach.ruleOfferFor(input.offered).catch(() => null) : null;
  const ruled =
    input.request !== null && (couldNotAnswer || askedInstead)
      ? await coach.applyRuleRequest({ sessionId: input.sessionId, ...input.request, opId: input.turnId }).catch(() => ({ status: 'failed' as const }))
      : null;
  const adjustment = ruled?.status === 'applied' ? ruled.record : input.after.adjustment;
  // When the coach asked and the rule couldn't change anything either, the coach's turn stands as it was.
  const outcome = offer !== null || adjustment !== null ? null : ruled !== null && ruled.status !== 'applied' && !askedInstead ? ruleOfferOutcome(ruled.status) : input.after.outcome;
  return { adjustment, outcome, offer };
}
