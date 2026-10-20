import { PLAN_VERDICT_WORD, type PlannedVsDoneRow, type PlanVerdict, type WorkoutSummary } from '@fizz/domain';

/** The verdict Tag's icon beside its word (never colour alone). */
export const VERDICT_ICON: Readonly<Record<PlanVerdict, 'checkmark' | 'arrow.down' | 'arrow.up'>> = { hit: 'checkmark', short: 'arrow.down', over: 'arrow.up' };

type SummaryExercise = Pick<WorkoutSummary['exercises'][number], 'setsText' | 'unitNote' | 'skipped' | 'sides'>;

/**
 * An exercise's third Summary line (design pass 3.1, 20 Oct). Against the plan:
 * `3/3 · of 8 · 100 kg planned · 1 skipped` (plan tracker v1; the verdict is the header's Tag).
 * With no plan: `4 sets · 1 skipped`. Uneven sides go on it too, so an exercise is at most 3 lines.
 * The unit note sits on the results line, not here.
 */
export function summaryPlanLine(e: SummaryExercise, plan: Pick<PlannedVsDoneRow, 'short' | 'verdict'> | null): { text: string; spoken: string } {
  if (plan !== null) {
    const text = e.sides === null ? plan.short : `${plan.short} · ${e.sides}`;
    return { text, spoken: `Plan: ${text.replaceAll(' · ', ', ')}. ${PLAN_VERDICT_WORD[plan.verdict]}.` };
  }
  const count = e.unitNote === '' ? e.setsText : e.setsText.replace(` ${e.unitNote}`, '');
  const text = [count, e.skipped > 0 ? `${String(e.skipped)} skipped` : null, e.sides].filter((x): x is string => x !== null).join(' · ');
  return { text, spoken: text.replaceAll(' · ', ', ') };
}

/** The results line with the unit note after it: `100×8 · 100×8 (kg each)`; '' with nothing logged. */
export function summaryResultsLine(e: Pick<WorkoutSummary['exercises'][number], 'results' | 'unitNote'>): string {
  if (e.results === '') return '';
  return e.unitNote === '' ? e.results : `${e.results} ${e.unitNote}`;
}
