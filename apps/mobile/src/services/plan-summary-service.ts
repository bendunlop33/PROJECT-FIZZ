import type { PlanMuscleBar } from '@fizz/domain';

import { planSummaryView, type PlanSummaryExpect, type PlanSummaryOverview, type PlanSummaryView } from '../progress/plan-summary-view';

/**
 * (Ben, 2 Nov; docs/design/plan-summary.md) The plan summary opened from the plan in Progress. One read that puts
 * together what the app already says elsewhere, so the numbers agree: the plan in use (`plans.overview()`: its block,
 * weeks, days, done this week, Up next), Plan › Muscles' bars (`planMuscles.muscles()`) and the Gym goals table's
 * `What to expect` (the plan builder's own `expect` for the plan's answers). A part that can't be read is hidden,
 * never guessed (rule 6). Local only (rule 1); writes nothing.
 */

export interface PlanSummaryDeps {
  overview: () => Promise<PlanSummaryOverview | null>;
  /** Plan › Muscles' bars for this week; null: no plan, or none to show. */
  muscles: () => Promise<readonly PlanMuscleBar[] | null>;
  /** The plan builder's `What to expect` for this builder plan's own answers; null: not a builder plan, or unreadable. */
  expect: (planId: string) => Promise<PlanSummaryExpect | null>;
}

export function createPlanSummaryService(deps: PlanSummaryDeps) {
  return {
    /** The summary of the plan in use; null: no plan in use. */
    async read(): Promise<PlanSummaryView | null> {
      const overview = await deps.overview();
      if (overview === null) return null;
      const builder = overview.block != null;
      const [muscles, expect] = await Promise.all([deps.muscles().catch(() => null), builder ? deps.expect(overview.planId).catch(() => null) : Promise.resolve(null)]);
      return planSummaryView({ overview, muscles, expect });
    },
  };
}

export type PlanSummaryService = ReturnType<typeof createPlanSummaryService>;
