import { leadLiftOf, pbMoveWeek, linkedRoutineId, linkedVariants, isNotPlanDay, pbAppliedBuilder, pbWeekDaysOf, pbWeekdaysOf, planDayOf, type HistoryWorkout, type PbBlockWeek, type PlanDayLinkView, type PlanWeekDay, type PlanWeekWorkout } from '@fizz/domain';
import type { MuscleGroup, PlanDraft, Routine, SplitBodyPart } from '@fizz/schemas';

/**
 * (Ben, 28 Oct) This week's plan days as every reader counts them (Library › Plan, Progress, Today, the coach's week):
 * one shape for the days and the workouts, so `planDaysDoneThisWeek` (one workout, one plan day) reads the same
 * everywhere. Pure helpers over what each service already read.
 */

/** A plan template as this week's count reads it: its plan day, body parts and main lift. */
export function planWeekDayOf(plan: Pick<PlanDraft, 'id' | 'applied'>, r: Routine, bodyParts: readonly SplitBodyPart[]): PlanWeekDay & { name: string; dayIndex: number | null } {
  const made = plan.applied?.made.find((m) => m.routineId === r.id)?.dayIndex;
  const ref = planDayOf(r);
  const dayIndex = made ?? (ref?.planId === plan.id ? ref.dayIndex : null);
  return {
    routineId: r.id,
    name: r.name,
    createdFromSessionId: r.createdFromSessionId ?? null,
    bodyParts,
    dayIndex,
    mainLiftExerciseId: r.exercises.find((e) => e.main === true)?.exerciseId ?? r.planDay?.mainLiftExerciseId ?? null,
    planKey: dayIndex === null ? null : { planId: plan.id, dayIndex },
  };
}

/** A finished workout as this week's count reads it: its plan day (started as, or linked), what it led with, its muscles. */
export function planWeekWorkoutOf(a: HistoryWorkout, links: ReadonlyMap<string, PlanDayLinkView> | null, groups: (a: HistoryWorkout) => ReadonlyMap<MuscleGroup, number>): PlanWeekWorkout {
  const s = a.session;
  const pd = s.planDay;
  return {
    sessionId: s.id,
    routineId: linkedRoutineId(links, s.id, s.routineId ?? null),
    startedAtUtc: s.startedAt.utc,
    groups: isNotPlanDay(links, s.id) ? new Map<MuscleGroup, number>() : groups(a),
    planDay: pd === undefined ? null : { planId: pd.planId, dayIndex: pd.dayIndex, templateRoutineId: pd.templateRoutineId ?? null },
    leadExerciseId: leadLiftOf(a),
    variants: linkedVariants(links, s.id),
  };
}

/**
 * Set days plans: each template's weekday in the block's week now (moves applied); null on Any days, a coach plan or
 * no block.
 */
export function planWeekdaysNow(plan: PlanDraft, block: PbBlockWeek | null, days: readonly { routineId: string; dayIndex: number | null }[]): Map<string, number> | null {
  const b = pbAppliedBuilder(plan);
  if (b === null || block === null || block.done) return null;
  const indexes = pbWeekDaysOf(plan, block.week).map((d) => d.index);
  const map = pbWeekdaysOf(b.builder.answers, plan.moves, pbMoveWeek(block), indexes.length > 0 ? indexes : days.flatMap((d) => (d.dayIndex === null ? [] : [d.dayIndex])));
  if (map === null) return null;
  const out = new Map<string, number>();
  for (const d of days) {
    const wd = d.dayIndex === null ? undefined : map.get(d.dayIndex);
    if (wd !== undefined) out.set(d.routineId, wd);
  }
  return out;
}
