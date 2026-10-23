import type { CoachAvailability } from '../coach/coach-service';
import { statusView } from '../coach/sheet-view';

/**
 * Library › Plan (Ben, 22 Oct; prototype `renderLibrary`; review gaps V1):
 * the plan in use (Your plan), `Set up a plan` with none, then `Previous`
 * plans with `Start again`. Words and the one routing rule; pure. Minimal
 * copy: values and actions.
 */

export const PLAN_TAB_COPY = {
  setUp: 'Set up a plan',
  previous: 'Previous',
  startAgain: 'Start again',
  /** Pre-typed in the coach (nothing is sent until Ben sends it). */
  coachDraft: 'Build me a plan',
  applied: 'Plan applied',
  undone: 'Undone',
  undo: 'Undo',
  loadFailed: 'Couldn’t load your plans.',
  tryAgain: 'Try again',
} as const;

/**
 * Where `Set up a plan ›` goes. THE hook the plan builder (plan-builder.md
 * §3) replaces: it will always open the builder. Until then (PM interim,
 * rule 1): the coach with `Build me a plan` pre-typed when it can answer
 * (connected; Offline is said in the coach itself), else the short state
 * on the row (`Coach not connected`) and the row opens Coach connection,
 * so it is never a dead end.
 */
export type PlanSetupRoute = { kind: 'coach'; draft: string } | { kind: 'connect'; state: string };

export function planSetupRoute(coach: CoachAvailability | null): PlanSetupRoute {
  if (coach === null) return { kind: 'connect', state: 'Coach not connected' };
  const v = statusView(coach);
  return v.canSend ? { kind: 'coach', draft: PLAN_TAB_COPY.coachDraft } : { kind: 'connect', state: v.placeholder };
}
