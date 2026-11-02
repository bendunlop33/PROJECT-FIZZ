import type { PlanBuilderAnswers } from '@fizz/schemas';

import { PB_EFFORTS, PB_FOCUSES } from '../plan-builder/plan-builder-view';

/**
 * (Ben, 2 Nov: one plan screen) Library › Plan's header for a builder plan: the title `Muscle · 6 weeks` and the three
 * numbers under the week strip (days / week, minutes, effort). The minutes are the plan's own answer, never Profile's
 * session length (one plan time). Null on a coach plan (no answers): its header stays as it was. Words only; pure.
 */

export const PLAN_HEADER_COPY = {
  weeks: (n: number) => `${String(n)} weeks`,
  daysWeek: 'days / week',
  min: 'min',
  effort: 'effort',
} as const;

export interface PlanHeaderFact {
  key: 'days' | 'min' | 'effort';
  value: string;
  label: string;
  /** What VoiceOver says: `about 45 min`, `4 days / week`, `Standard effort`. */
  said: string;
}

export interface PlanHeaderView {
  /** `Muscle · 6 weeks`. */
  title: string;
  facts: PlanHeaderFact[];
}

export function planHeaderView(answers: Pick<PlanBuilderAnswers, 'focus' | 'weeks' | 'effort' | 'sessions' | 'minutes'> | null, name: string): PlanHeaderView | null {
  if (answers === null) return null;
  const focus = PB_FOCUSES.find((f) => f.key === answers.focus)?.label ?? null;
  const effort = PB_EFFORTS.find((x) => x.key === answers.effort)?.label ?? null;
  return {
    title: focus === null ? name : `${focus} · ${PLAN_HEADER_COPY.weeks(answers.weeks)}`,
    facts: [
      { key: 'days', value: String(answers.sessions), label: PLAN_HEADER_COPY.daysWeek, said: `${String(answers.sessions)} ${answers.sessions === 1 ? 'day' : 'days'} a week` },
      { key: 'min', value: `~${String(answers.minutes)}`, label: PLAN_HEADER_COPY.min, said: `about ${String(answers.minutes)} min` },
      ...(effort === null ? [] : [{ key: 'effort' as const, value: effort, label: PLAN_HEADER_COPY.effort, said: `${effort} effort` }]),
    ],
  };
}
