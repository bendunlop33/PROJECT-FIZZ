/**
 * Viewing other sets from Focus and rest (F7; Ben, build 151): ‹ › buttons
 * and a horizontal swipe move through every set of the workout in order.
 * Viewing is screen state only: it never changes which set Log logs, until
 * Ben taps `Make current`; `Now` goes back. Pure, so it's tested; the
 * order and the set's words come from the domain (`setNavigation`,
 * `setGlance`).
 */
import type { SetGlance, SetNavigation } from '@fizz/domain';

/** A horizontal drag this far (pt), clearly more sideways than up or down, is a swipe. */
export const SWIPE_MIN_DX = 40;
const SIDEWAYS = 1.5;

/** Left swipe: the next set. Right swipe: the previous one. A mostly vertical drag (scrolling) is neither. */
export function swipeIntent(dx: number, dy: number): 'prev' | 'next' | null {
  if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < SIDEWAYS * Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** Whether a drag should be taken from the scroll view as a swipe (decided early, before it's a full swipe). */
export function claimsDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > 12 && Math.abs(dx) > SIDEWAYS * Math.abs(dy);
}

export type PagerEvent = { kind: 'prev' } | { kind: 'next' } | { kind: 'now' } | { kind: 'made_current' } | { kind: 'logged' };

/**
 * The set being viewed after an event: null means "the current set" (what
 * Log logs). Reaching the current set by ‹ › is the same as `Now`. A Log or
 * `Make current` always comes back to the current set.
 */
export function nextViewing(nav: Pick<SetNavigation, 'shownSetId' | 'prevSetId' | 'nextSetId' | 'currentSetId'>, e: PagerEvent): string | null {
  switch (e.kind) {
    case 'prev':
    case 'next': {
      const target = (e.kind === 'prev' ? nav.prevSetId : nav.nextSetId) ?? nav.shownSetId;
      return target === nav.currentSetId ? null : target;
    }
    case 'now':
    case 'made_current':
    case 'logged':
      return null;
  }
}

export interface PagerView {
  /** `Bench press · Set 2 of 4`. */
  title: string;
  /** `Working · Now`, `Warm-up · Done`, `Top set`. */
  detail: string;
  canPrev: boolean;
  canNext: boolean;
  /** Not on the current set: the `Now` button shows. */
  away: boolean;
  /** A set not done yet that isn't current: `Make current`. */
  canMakeCurrent: boolean;
  /** Done or not done yet (a skipped set has nothing to edit). */
  canEdit: boolean;
  accessibilityLabel: string;
}

export function pagerView(nav: SetNavigation, glance: SetGlance | null): PagerView | null {
  if (glance === null) return null;
  const state = glance.status === 'done' ? 'Done' : glance.status === 'skipped' ? 'Skipped' : glance.isCurrent ? 'Now' : null;
  return {
    title: `${glance.exerciseName} · Set ${String(glance.setNumber)} of ${String(glance.setCount)}`,
    detail: [glance.setTypeLabel, state].filter((x): x is string => x !== null).join(' · '),
    canPrev: nav.prevSetId !== null,
    canNext: nav.nextSetId !== null,
    away: !nav.atCurrent && nav.currentSetId !== null,
    canMakeCurrent: glance.status === 'pending' && !glance.isCurrent,
    canEdit: glance.status !== 'skipped',
    accessibilityLabel: `${glance.accessibilityLabel}. Set ${String(nav.position)} of ${String(nav.total)} in the workout.`,
  };
}
