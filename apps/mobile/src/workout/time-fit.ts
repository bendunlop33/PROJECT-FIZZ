import { timeFitLineText, type TimeFitOffer } from '@fizz/domain';

/**
 * The `+N min` offer as shown (workout-table-v3 §5): the changes, then the
 * builder's estimate of the sets left before → after (an estimate, `≈`).
 * Nothing changes until Ben taps `Apply` (rule 3).
 */
export interface TimeFitPrompt {
  title: string;
  message: string;
  apply: string;
  /** The Undo toast after Apply. */
  applied: string;
}

export function timeFitPrompt(offer: TimeFitOffer, overByMinutes: number): TimeFitPrompt {
  const est = offer.status === 'over' ? `Shortest ≈ ${String(offer.afterMinutes)} min left` : `≈ ${String(offer.beforeMinutes)} → ${String(offer.afterMinutes)} min left`;
  return {
    title: `${String(overByMinutes)} min over`,
    message: [...offer.lines.map(timeFitLineText), '', est].join('\n'),
    apply: 'Apply',
    applied: offer.savedMinutes > 0 ? `Fitted · ≈ ${String(offer.savedMinutes)} min shorter` : 'Fitted',
  };
}
