import type { PlanBuilderAnswers } from '@fizz/schemas';

import { PB_FOCUSES, PB_WEEKDAYS } from '../plan-builder/plan-builder-view';

/**
 * (Redesign 27 Oct, D4) Library › Plan's full-width `Edit plan` → the **Change plan** sheet: `Days and time` (its
 * summary line), `Goal`, `A day's exercises` (each plan day → that day's editor), `✦ Ask the coach`, and `End plan`
 * (red; confirm `End plan?` · `Week 3 of 6 · history kept` · End plan / Keep plan). Days and time and Goal open the
 * plan builder's own pages on the plan in use and end on its Changes review (Accept / Reject per line, Apply to,
 * Apply with Undo); nothing is written before Apply (rule 2). Words and routing only; pure.
 */

export const CHANGE_PLAN_COPY = {
  title: 'Change plan',
  daysAndTime: 'Days and time',
  goal: 'Goal',
  dayExercises: 'A day’s exercises',
  askCoach: 'Ask the coach',
  endPlan: 'End plan',
  endTitle: 'End plan?',
  keepPlan: 'Keep plan',
  close: 'Close',
  historyKept: 'history kept',
  editPlan: 'Edit plan',
  reviewChanges: 'Review changes',
  changes: 'Changes',
} as const;

/** `3 a week · 45 min · Mon Wed Sat` (Set days), `3 a week · 45 min · Any days`. */
export function daysAndTimeLine(a: Pick<PlanBuilderAnswers, 'sessions' | 'minutes' | 'schedule' | 'days'>): string {
  const days = a.schedule === 'set' && a.days.length > 0 ? [...a.days].sort((x, y) => x - y).map((d) => PB_WEEKDAYS[d] ?? '').filter((x) => x !== '').join(' ') : 'Any days';
  return [`${String(a.sessions)} a week`, `${String(a.minutes)} min`, days].join(' · ');
}

/** `Muscle`, `Strength · Chest, Back` (the plan's main focus, then its priorities). */
export function goalLine(a: Pick<PlanBuilderAnswers, 'focus' | 'priorities'>): string {
  const focus = PB_FOCUSES.find((f) => f.key === a.focus)?.label ?? 'Balanced';
  return a.priorities.length === 0 ? focus : `${focus} · ${a.priorities.join(', ')}`;
}

/** `Week 3 of 6 · history kept`; a plan with no weeks: `History kept`. */
export function endPlanLine(block: { current: number; of: number } | null): string {
  if (block === null || block.of <= 0) return 'History kept';
  return `Week ${String(Math.min(block.current, block.of))} of ${String(block.of)} · ${CHANGE_PLAN_COPY.historyKept}`;
}

export type ChangePlanAction = { kind: 'week' } | { kind: 'goal' } | { kind: 'day'; routineId: string } | { kind: 'coach' } | { kind: 'end' };

export interface ChangePlanView {
  /** Null on a coach plan (no builder answers to change): Goal opens Profile › Training instead. */
  daysAndTime: string | null;
  goal: string | null;
  /** Goal opens the plan builder (a builder plan) or Profile › Training (a coach plan). */
  goalOpens: 'builder' | 'profile';
  days: { name: string; routineId: string }[];
  endLine: string;
}

export function changePlanView(i: { answers: PlanBuilderAnswers | null; editable: boolean; goalText: string | null; days: readonly { name: string; routineId: string | null }[]; block: { current: number; of: number } | null }): ChangePlanView {
  const builder = i.answers !== null && i.editable;
  const seen = new Set<string>();
  const days: { name: string; routineId: string }[] = [];
  for (const d of i.days) {
    if (d.routineId === null || seen.has(d.routineId)) continue;
    seen.add(d.routineId);
    days.push({ name: d.name, routineId: d.routineId });
  }
  return {
    daysAndTime: builder && i.answers !== null ? daysAndTimeLine(i.answers) : null,
    goal: builder && i.answers !== null ? goalLine(i.answers) : (i.goalText?.replace(/^Goal: /, '') ?? null),
    goalOpens: builder ? 'builder' : 'profile',
    days,
    endLine: endPlanLine(i.block),
  };
}
