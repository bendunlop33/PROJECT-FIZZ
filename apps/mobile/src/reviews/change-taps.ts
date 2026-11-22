import type { ChangeTap } from '@fizz/domain';

import type { ProposalOutcome, WeeklyReviewService } from './weekly-review-service';

/**
 * (Review v5offers B2) The service call a change row's button makes: the button's own action (`changeRowTaps`), so
 * Redo on an undone offer is a Redo, never an Apply that refuses a row that isn't open. Plain TypeScript, so the
 * tests run the same wiring the screens use.
 */
export function runChangeTap(reviews: Pick<WeeklyReviewService, 'applyProposal' | 'skipProposal' | 'undoProposal' | 'redoProposal'>, tap: ChangeTap, req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
  switch (tap) {
    case 'apply':
      return reviews.applyProposal(req);
    case 'skip':
      return reviews.skipProposal(req);
    case 'undo':
      return reviews.undoProposal(req);
    case 'redo':
      return reviews.redoProposal(req);
  }
}
