import type { Routine, SessionAggregate } from '@fizz/schemas';
import { planDayKeyOf, samePlanDay, type PlanDayKeySplit, type PlanDayRef } from './coach-plan';

/**
 * (Ben, 27 Oct; redesign-27oct.md §E3) The mid-workout Swap sheet on the main lift lists the plan's main-lift
 * alternatives first (the plan day's main-lift options, as Today's main-lift chips), then everything else. Pure.
 */

/**
 * The main-lift options of a plan day, in plan order: each of the day's templates' main lift (`planDayKeyOf`, as
 * `todayPlanDays` reads it), once each. Empty when the workout wasn't started from a plan day, or the day has none.
 */
export function planDayMainLifts(input: { planDay: PlanDayRef | null | undefined; templates: readonly (Pick<Routine, 'exercises'> & Partial<Pick<Routine, 'planDay' | 'createdFromPlan'>>)[] } & PlanDayKeySplit): string[] {
  const out: string[] = [];
  if (input.planDay == null) return out;
  for (const r of input.templates) {
    const key = planDayKeyOf(r, input.split, input.mainLifts);
    if (key === null || !samePlanDay(key, input.planDay)) continue;
    const main = key.mainLiftExerciseId ?? r.exercises.find((e) => e.main === true)?.exerciseId ?? null;
    if (main !== null && !out.includes(main)) out.push(main);
  }
  return out;
}

/**
 * Whether a row is the workout's main lift: its exercise (or, after a swap, the exercise it was swapped from, all
 * the way back) is one of `mains` (the draft's main slots, else the plan day's main lift at Start).
 */
export function isMainLiftRow(a: Pick<SessionAggregate, 'exercises'>, sessionExerciseId: string, mains: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  let id: string | undefined = sessionExerciseId;
  while (id !== undefined && !seen.has(id)) {
    seen.add(id);
    const row = a.exercises.find((e) => e.id === id);
    if (row === undefined) return false;
    if (mains.has(row.exerciseId)) return true;
    id = row.swappedFrom?.sessionExerciseId;
  }
  return false;
}

/** The main lifts a workout was started with: the draft's main slots, else the plan day's main lift. */
export function workoutMainLifts(a: Pick<SessionAggregate, 'session'>, draftMains: ReadonlySet<string>): Set<string> {
  if (draftMains.size > 0) return new Set(draftMains);
  const m = a.session.planDay?.mainLiftExerciseId ?? null;
  return new Set(m === null ? [] : [m]);
}

export const MAIN_SWAP_COPY = { heading: 'Main lift' } as const;

/**
 * The Swap sheet's sections with the main-lift alternatives first (`MAIN_SWAP_COPY.heading`), in the plan's order,
 * then every other section without them (a section left empty goes). No alternatives: the sections as they were.
 */
export function mainLiftFirst<T extends { exerciseId: string }>(sections: readonly { focus: string; items: readonly T[] }[], alternatives: readonly T[]): { focus: string; items: T[] }[] {
  const rest = sections.map((s) => ({ focus: s.focus, items: [...s.items] }));
  if (alternatives.length === 0) return rest;
  const first = alternatives.filter((x, i) => alternatives.findIndex((y) => y.exerciseId === x.exerciseId) === i);
  const ids = new Set(first.map((x) => x.exerciseId));
  return [{ focus: MAIN_SWAP_COPY.heading, items: first }, ...rest.map((s) => ({ focus: s.focus, items: s.items.filter((x) => !ids.has(x.exerciseId)) })).filter((s) => s.items.length > 0)];
}
