import { timeFitLineText, type TimeFitOffer } from '@fizz/domain';

/**
 * The `+N min` offer as shown (workout-table-v3 §5; review build-a SP-3):
 * a small sheet, not an alert. Title `N min over`, one line per change with
 * before → after (rule 2), then the builder's estimate of the sets left
 * (`≈`): `≈ 33 → 28 min left`, or `Saves ≈ 9 min` when it can't make up the
 * whole overrun. Nothing changes until Ben taps `Apply` (rule 3).
 */
export interface TimeFitSheetView {
  title: string;
  lines: string[];
  estimate: string;
  apply: string;
  notNow: string;
  timeLeft: string;
  /** The Undo toast after Apply. */
  applied: string;
}

export const TIME_FIT_COPY = {
  apply: 'Apply',
  notNow: 'Not now',
  timeLeft: 'Time left ›',
  /** `⋯` while the fit can still be undone (review S1). */
  undoMenu: 'Undo fit to time',
  undone: 'Fit undone',
} as const;

export function timeFitSheet(offer: TimeFitOffer, overByMinutes: number): TimeFitSheetView {
  const estimate = offer.status === 'over' ? `Saves ≈ ${String(offer.savedMinutes)} min` : `≈ ${String(offer.beforeMinutes)} → ${String(offer.afterMinutes)} min left`;
  return {
    title: `${String(overByMinutes)} min over`,
    lines: offer.lines.map(timeFitLineText),
    estimate,
    apply: TIME_FIT_COPY.apply,
    notNow: TIME_FIT_COPY.notNow,
    timeLeft: TIME_FIT_COPY.timeLeft,
    applied: offer.savedMinutes > 0 ? `Fitted · ≈ ${String(offer.savedMinutes)} min shorter` : 'Fitted',
  };
}
