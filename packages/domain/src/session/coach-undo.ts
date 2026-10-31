import type { PlannedSet, SessionAggregate } from '@fizz/schemas';

/**
 * Whether a target is still the one a today-adjustment set (the coach's, or
 * the built-in rule's when the coach couldn't answer): it names the action
 * and its source is still that adjustment's. With `actionId`, only that one.
 */
export function carriesTodayAdjustment(planned: PlannedSet, actionId?: string): boolean {
  if (planned.coach === undefined) return false;
  if (actionId !== undefined && planned.coach.actionId !== actionId) return false;
  return planned.source === 'coach' || planned.source === 'built_in_rule';
}

/**
 * Whether the workout's gym (or its equipment) changed after a point in its
 * gym history, counting only changes still in effect: a switch and its Undo
 * cancel out, so the sets are back on the equipment they were on.
 */
export function gymChangedSince(session: Pick<SessionAggregate['session'], 'gymChanges'>, count: number): boolean {
  const later = (session.gymChanges ?? []).slice(count);
  const undone = new Set(later.flatMap((c) => (c.kind === 'undo' && c.undoOf !== undefined ? [c.undoOf] : [])));
  return later.some((c) => (c.kind === 'change' ? !undone.has(c.actionId) : !later.some((x) => x.kind === 'change' && x.actionId === c.undoOf)));
}

/**
 * Why a coach adjustment of today's sets can't be undone now; null when it
 * can (or when no set carries it). After a gym change its saved `before`
 * targets were fitted to the old gym's equipment, so putting them back could
 * leave a load the new gym can't make (rule 4). Undo is refused instead
 * (ADR 0020 §4.3, review coach-v1-final-r2 B1).
 */
export function coachUndoRefusal(state: Pick<SessionAggregate, 'session' | 'sets'>, actionId: string): 'gym_changed' | null {
  const carried = state.sets.find((s) => s.planned.coach?.actionId === actionId);
  if (carried?.planned.coach === undefined) return null;
  // Absent only on records from before the count was kept: treat as "from the start" (refuse if any change is in effect).
  return gymChangedSince(state.session, carried.planned.coach.gymChanges ?? 0) ? 'gym_changed' : null;
}
