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

// ---------------------------------------------------------------------------
// (Ben, 27 Oct; redesign-27oct.md §E2) The Summary's order: Saved line, New best card, Time / Sets / Exercises, one
// Next time list, Exercises done, Feel, Health line, Ask about this workout, Done; Edit times, Save as workout and
// Delete in ⋯. Pure helpers; the screen only lays them out.

/** `Saved 18:49` (the workout's end, in its own zone); a date-only workout has no time: `Saved`. */
export function summarySavedLine(endedMs: number | null, timeText: (ms: number) => string): string {
  return endedMs === null ? 'Saved' : `Saved ${timeText(endedMs)}`;
}

/**
 * The stat strip: `Time` (the active time; none for a date-only workout), `Sets` done of planned (`15/16`; with no
 * plan, the working sets logged) and `Exercises` done of listed (`5/5`).
 */
export function summaryStatItems(facts: Pick<WorkoutSummary['facts'], 'activeText' | 'exercisesDone' | 'exercisesTotal' | 'workingSets'>, plan: { doneSets: number; plannedSets: number } | null): { label: string; value: string }[] {
  return [
    ...(facts.activeText !== null ? [{ label: 'Time', value: facts.activeText }] : []),
    { label: 'Sets', value: plan === null ? String(facts.workingSets) : `${String(plan.doneSets)}/${String(plan.plannedSets)}` },
    { label: 'Exercises', value: `${String(facts.exercisesDone)}/${String(facts.exercisesTotal)}` },
  ];
}

/** How many `Exercises · done` rows show before `N more`. */
export const SUMMARY_EXERCISES_SHOWN = 3;

export interface SummaryDoneRow {
  key: string;
  exerciseId: string;
  sessionExerciseId: string;
  name: string;
  /** `4/4` against the plan, else `3 sets`; '' with nothing to count. */
  count: string;
  /** `80×8 · 82.5×6 (kg each)`; '' with nothing logged. */
  results: string;
  /** (Ben, 30 Oct) The one line beside the name: `3×8 @ 80 kg`, `4 sets · best 102.5×5 kg`; else the results. */
  line: string;
  /** Beside the line: `3/4` when fewer sets were done than planned (with no plan, `1 skipped`); '' otherwise. */
  aside: string;
  spoken: string;
}

/**
 * (Ben, 30 Oct) One line per exercise: the name, then its sets said once (`3×8 @ 80 kg`, `4 sets · best 102.5×5 kg`;
 * `doneLine`), with `3/4` beside it only when fewer sets were done than planned (no plan: `1 skipped`). Sets that can't be said that way
 * (sides, flagged sets, two gyms, mixed units) keep the logged results (`summaryResultsLine`).
 */
export function summaryDoneRows(exercises: readonly WorkoutSummary['exercises'][number][], plan: readonly Pick<PlannedVsDoneRow, 'sessionExerciseId' | 'doneSets' | 'plannedSets'>[] | null): SummaryDoneRow[] {
  return exercises.map((e) => {
    const p = plan?.find((r) => r.sessionExerciseId === e.sessionExerciseId) ?? null;
    const count = p !== null ? `${String(p.doneSets)}/${String(p.plannedSets)}` : summaryPlanLine(e, null).text;
    const results = summaryResultsLine(e);
    const short = p !== null && p.doneSets < p.plannedSets;
    const aside = short ? count : p === null && e.skipped > 0 ? `${String(e.skipped)} skipped` : '';
    const line = e.line?.text ?? results;
    const spokenLine = e.line?.spoken ?? results;
    const spoken = [e.name, p !== null ? `${String(p.doneSets)} of ${String(p.plannedSets)} sets` : e.line !== null ? '' : count, spokenLine].filter((x) => x !== '').join(', ');
    return { key: e.sessionExerciseId, exerciseId: e.exerciseId, sessionExerciseId: e.sessionExerciseId, name: e.name, count, results, line, aside, spoken };
  });
}

/** The rows shown and the `N more` link (null: every row shows). */
export function summaryShownRows<T>(rows: readonly T[], expanded: boolean): { shown: T[]; more: string | null } {
  if (expanded || rows.length <= SUMMARY_EXERCISES_SHOWN) return { shown: [...rows], more: null };
  return { shown: rows.slice(0, SUMMARY_EXERCISES_SHOWN), more: `${String(rows.length - SUMMARY_EXERCISES_SHOWN)} more` };
}

export type SummaryMenuId = 'edit_times' | 'save' | 'rename' | 'link_health' | 'delete';

export const SUMMARY_MENU_COPY = {
  editTimes: 'Edit times',
  save: 'Save as workout',
  rename: 'Rename',
  delete: 'Delete workout',
} as const;

/**
 * The Summary's `⋯`, in order: `Edit times` (not for a date-only workout), `Save as workout` (until saved), `Rename`,
 * `Link activity from Health` (when Health has one to link), `Delete workout` (when it can be deleted; last).
 */
export function summaryMenu(o: { dateOnly: boolean; saved: boolean; canDelete: boolean; healthChoices: number; linkLabel: string }): { id: SummaryMenuId; label: string; destructive?: true }[] {
  return [
    ...(o.dateOnly ? [] : [{ id: 'edit_times' as const, label: SUMMARY_MENU_COPY.editTimes }]),
    ...(o.saved ? [] : [{ id: 'save' as const, label: SUMMARY_MENU_COPY.save }]),
    { id: 'rename' as const, label: SUMMARY_MENU_COPY.rename },
    ...(o.healthChoices > 0 ? [{ id: 'link_health' as const, label: o.linkLabel }] : []),
    ...(o.canDelete ? [{ id: 'delete' as const, label: SUMMARY_MENU_COPY.delete, destructive: true as const }] : []),
  ];
}

/** `Last: 80 × 6 · 20 Oct` under a new best (the best it beat); null when none is named. */
export function newBestLastLine(last: { set: string; atMs: number } | undefined, dayText: (ms: number) => string): string | null {
  return last === undefined ? null : `Last: ${last.set} · ${dayText(last.atMs)}`;
}
