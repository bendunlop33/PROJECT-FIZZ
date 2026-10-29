import type { Load, Measurement, PlanDayMove, PlanDraft, PlanWeekExerciseEdit, PlanWeekSkip, RoutineExercise, SetTemplate, ZonedTimestamp } from '@fizz/schemas';

import { deriveId } from '../stable';
import { replaceExercise } from '../session/routine-editor';
import { pbWeekDaysOf, pbWeekdaysOf, type PbEditBlock, type PlanMoveChange } from './edit';

/**
 * The day sheet's this-week changes (Ben, 29 Oct: "I don't find it easy to see what the plan for each day is and then
 * change what I plan on doing"; docs/design/day-sheet.md). Pure.
 *
 * - `pbWeekChange`: one versioned, idempotent write on the plan in use (rule 5) for one of `Do today instead` (two
 *   Set days swap weekdays), `Move to…` (a free weekday, today or later), `Skip this week`, or one exercise change
 *   for this week only (`Swap`, `Remove`, `Add`). Done days never change (rule 2). Each change is for this block
 *   week only (week 0 in the lead-in, as `Move day`); the next week is the plan as it was, with no write.
 * - `pbUndoWeekChange`: the one Undo, only while nothing moved on since (`versionAfter`).
 * - `pbDayWithEdits`: a plan day's exercises with this week's changes on top, nothing else recalculated: a swap keeps
 *   the row's sets, reps, rest, place and superset; a remove leaves the row out; an add goes after its row.
 * - `oneExerciseChange`: the same one change on a template (`Every week`), for the routine write.
 */

/** The week a change made now belongs to: 0 in the lead-in, else the block week (`pbMoveWeek`'s rule). */
export function pbChangeWeek(block: Pick<PbEditBlock, 'week' | 'leadIn'>): number {
  return block.leadIn === true ? 0 : block.week;
}

export type PbWeekChangeRequest =
  /** `Do today instead` on a Set days plan: `dayIndex` takes `withDayIndex`'s weekday and the other way round. */
  | { kind: 'swap_days'; dayIndex: number; withDayIndex: number }
  /** `Move to…`: `dayIndex` on `weekday` (Mon = 0) this week. */
  | { kind: 'move'; dayIndex: number; weekday: number }
  | { kind: 'skip'; dayIndex: number }
  | { kind: 'unskip'; dayIndex: number }
  | { kind: 'exercise'; edit: Omit<PlanWeekExerciseEdit, 'week' | 'opId' | 'atUtc'> };

export interface PbWeekChangeInput {
  expectedVersion: number;
  opId: string;
  at: ZonedTimestamp;
  block: PbEditBlock;
  /** Today's weekday (Mon = 0): a day never moves to a weekday already gone. */
  todayWeekday: number;
  change: PbWeekChangeRequest;
}

const remember = (opIds: readonly string[], opId: string): string[] => [...opIds, opId].slice(-200);

/** This week's skipped plan days. */
export function pbSkipsOf(plan: Pick<PlanDraft, 'weekSkips'>, week: number): Set<number> {
  return new Set((plan.weekSkips ?? []).filter((s) => s.week === week).map((s) => s.dayIndex));
}

/** This week's exercise changes for a plan day, oldest first. */
export function pbWeekEditsOf(plan: Pick<PlanDraft, 'weekEdits'>, week: number, dayIndex: number): PlanWeekExerciseEdit[] {
  return (plan.weekEdits ?? []).filter((e) => e.week === week && e.dayIndex === dayIndex);
}

/** Each plan day's weekday this week (Set days; moves applied, skipped days left out); null on Any days or a coach plan. */
export function pbWeekdaysThisWeek(plan: Pick<PlanDraft, 'versions' | 'currentVersion' | 'weekVersions' | 'applied' | 'moves' | 'weekSkips'>, block: Pick<PbEditBlock, 'week' | 'leadIn'>): Map<number, number> | null {
  const answers = plan.versions.find((v) => v.n === plan.currentVersion)?.builder?.answers ?? null;
  if (answers === null) return null;
  const week = pbChangeWeek(block);
  const map = pbWeekdaysOf(answers, plan.moves, week, pbWeekDaysOf(plan, block.week).map((d) => d.index));
  if (map === null) return null;
  for (const i of pbSkipsOf(plan, week)) map.delete(i);
  return map;
}

/** One edit folded into this week's edits for its day: a second change to the same row replaces the first. */
function foldEdit(edits: readonly PlanWeekExerciseEdit[], next: PlanWeekExerciseEdit): PlanWeekExerciseEdit[] | null {
  const same = (e: PlanWeekExerciseEdit) => e.week === next.week && e.dayIndex === next.dayIndex && e.rowId === next.rowId;
  const prior = edits.find(same);
  const rest = edits.filter((e) => !same(e));
  if (next.kind === 'add') return prior === undefined ? [...rest, next] : null;
  if (prior === undefined) return [...rest, next];
  // A row added this week: a swap keeps it an add (of the new exercise); a remove takes the add away.
  if (prior.kind === 'add') return next.kind === 'remove' ? rest : [...rest, { ...prior, toExerciseId: next.toExerciseId, load: next.load ?? null, opId: next.opId, atUtc: next.atUtc }];
  if (prior.kind === 'remove') return null;
  // A swapped row: its first exercise stays the one the plan has; swapping back to it is no change at all.
  const from = prior.fromExerciseId;
  if (next.kind === 'swap' && next.toExerciseId === from) return rest;
  return [...rest, { ...next, fromExerciseId: from }];
}

/**
 * One day-sheet change, this block week only. Refused (`invalid`, nothing written): a day done this week (rule 2), a
 * day not in this week's plan, a weekday already gone or held by another day still to do, swapping days on Any days.
 */
export function pbWeekChange(current: PlanDraft, input: PbWeekChangeInput): PlanMoveChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'applied' || current.applied === null) return { kind: 'stale', current };
  const week = pbChangeWeek(input.block);
  const days = new Set(pbWeekDaysOf(current, input.block.week).map((d) => d.index));
  const done = new Set(input.block.doneThisWeek);
  const skips = current.weekSkips ?? [];
  const skipped = pbSkipsOf(current, week);
  const moves = current.moves ?? [];
  const edits = current.weekEdits ?? [];
  const open = (i: number) => days.has(i) && !done.has(i);
  let next: { moves: PlanDayMove[]; skips: PlanWeekSkip[]; edits: PlanWeekExerciseEdit[] } | null = null;
  const c = input.change;
  const moved = (list: readonly PlanDayMove[], i: number, weekday: number): PlanDayMove[] => [...list.filter((m) => !(m.week === week && m.dayIndex === i)), { week, dayIndex: i, weekday }].slice(-84);
  switch (c.kind) {
    case 'swap_days': {
      const map = pbWeekdaysThisWeek(current, input.block);
      const a = map?.get(c.dayIndex);
      const b = map?.get(c.withDayIndex);
      if (map === null || a === undefined || b === undefined || c.dayIndex === c.withDayIndex || !open(c.dayIndex) || !open(c.withDayIndex)) return { kind: 'invalid', current };
      next = { moves: moved(moved(moves, c.dayIndex, b), c.withDayIndex, a), skips, edits };
      break;
    }
    case 'move': {
      const map = pbWeekdaysThisWeek(current, input.block);
      if (map === null || !map.has(c.dayIndex) || !open(c.dayIndex) || c.weekday < input.todayWeekday || c.weekday > 6) return { kind: 'invalid', current };
      // Another day still to do this week holds that weekday: Move to… never doubles a day up.
      if ([...map].some(([i, d]) => i !== c.dayIndex && d === c.weekday && open(i))) return { kind: 'invalid', current };
      next = { moves: moved(moves, c.dayIndex, c.weekday), skips, edits };
      break;
    }
    case 'skip':
      if (!open(c.dayIndex) || skipped.has(c.dayIndex)) return { kind: 'invalid', current };
      next = { moves, skips: [...skips, { week, dayIndex: c.dayIndex }].slice(-84), edits };
      break;
    case 'unskip':
      if (!skipped.has(c.dayIndex)) return { kind: 'invalid', current };
      next = { moves, skips: skips.filter((s) => !(s.week === week && s.dayIndex === c.dayIndex)), edits };
      break;
    case 'exercise': {
      const e = c.edit;
      if (!open(e.dayIndex) || (e.kind !== 'remove' && e.toExerciseId === null) || (e.kind !== 'add' && e.fromExerciseId === null)) return { kind: 'invalid', current };
      const folded = foldEdit(edits, { ...e, week, opId: input.opId, atUtc: input.at.utc });
      if (folded === null) return { kind: 'invalid', current };
      next = { moves, skips, edits: folded.slice(-200) };
      break;
    }
  }
  const version = current.version + 1;
  return {
    kind: 'write',
    next: {
      ...current,
      moves: next.moves,
      weekSkips: next.skips,
      weekEdits: next.edits,
      lastWeekChange: { opId: input.opId, versionAfter: version, before: { moves: [...moves], skips: [...skips], edits: [...edits] } },
      opIds: remember(current.opIds, input.opId),
      version,
      updatedAtUtc: input.at.utc,
    },
    expectedVersion: current.version,
  };
}

/** The day-sheet change's Undo: the week exactly as before, only while the plan is still as that change left it. */
export function pbUndoWeekChange(current: PlanDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp }): PlanMoveChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  const u = current.lastWeekChange ?? null;
  if (current.version !== input.expectedVersion || u === null || u.versionAfter !== current.version) return { kind: 'stale', current };
  const version = current.version + 1;
  return { kind: 'write', next: { ...current, moves: u.before.moves, weekSkips: u.before.skips, weekEdits: u.before.edits, lastWeekChange: null, opIds: remember(current.opIds, input.opId), version, updatedAtUtc: input.at.utc }, expectedVersion: current.version };
}

// ---------------------------------------------------------------------------
// A plan day with this week's changes

const working = (t: Pick<SetTemplate, 'setType'>) => t.setType !== 'warmup';

/** A swapped-in exercise's sets: the row's own, its load Ben's typed one (else none: his history decides). */
function withLoad(templates: readonly SetTemplate[], load: Load | null | undefined): SetTemplate[] {
  return templates.map((t) => ({ ...t, targetLoad: load != null && working(t) ? { value: load.value, unit: load.unit, convention: load.convention } : null }));
}

/** A row the day sheet's `Add` makes: `sets` working sets of `reps`, nothing else (no superset, not a main lift). */
export function pbAddedRow(e: Pick<PlanWeekExerciseEdit, 'rowId' | 'toExerciseId' | 'sets' | 'reps' | 'load'>, order: number, measurement: Measurement = 'reps'): RoutineExercise | null {
  if (e.toExerciseId === null) return null;
  const n = e.sets ?? 3;
  const timed = measurement === 'duration' || measurement === 'cardio';
  const reps = e.reps ?? { min: 8, max: 12 };
  const setTemplates: SetTemplate[] = Array.from({ length: n }, (_, i) => ({
    id: deriveId(`week-add-set:${e.rowId}:${String(i)}`),
    setType: 'working',
    targetLoad: e.load == null ? null : { value: e.load.value, unit: e.load.unit, convention: e.load.convention },
    targetReps: timed ? null : { min: Math.min(reps.min, reps.max), max: Math.max(reps.min, reps.max) },
    targetDurationS: timed ? 45 : null,
    targetRpe: null,
    targetRir: null,
    restOverrideS: null,
  }));
  return { id: e.rowId, exerciseId: e.toExerciseId, equipmentId: null, order, supersetGroup: null, setTemplates, restBySetType: {}, transitionRestS: null, progressionRuleId: null, main: false };
}

/** One change on a list of rows (the template for `Every week`, or this week's copy). Unknown rows change nothing. */
export function oneExerciseChange(rows: readonly RoutineExercise[], e: Pick<PlanWeekExerciseEdit, 'kind' | 'rowId' | 'fromExerciseId' | 'toExerciseId' | 'afterRowId' | 'sets' | 'reps' | 'load'>, measurementOf: (exerciseId: string) => Measurement = () => 'reps'): RoutineExercise[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const at = (id: string) => sorted.findIndex((r) => r.id === id);
  switch (e.kind) {
    case 'swap': {
      const i = at(e.rowId);
      const row = sorted[i];
      if (row === undefined || e.toExerciseId === null) return sorted;
      const to = e.toExerciseId;
      const swapped = replaceExercise([row], row.id, { id: to, measurement: measurementOf(to) })[0] ?? row;
      // Only the exercise changes: the row's place, superset, main mark, rests and set shapes stay as they were.
      return sorted.map((r, k) => (k === i ? { ...swapped, setTemplates: withLoad(swapped.setTemplates, e.load) } : r));
    }
    case 'remove': {
      const out = sorted.filter((r) => r.id !== e.rowId);
      return out.length === 0 ? sorted : out.map((r, k) => ({ ...r, order: k }));
    }
    case 'add': {
      const made = pbAddedRow(e, 0, e.toExerciseId === null ? 'reps' : measurementOf(e.toExerciseId));
      if (made === null || at(e.rowId) >= 0) return sorted;
      const after = e.afterRowId == null ? -1 : at(e.afterRowId);
      const k = after < 0 ? sorted.length : after + 1;
      return [...sorted.slice(0, k), made, ...sorted.slice(k)].map((r, n) => ({ ...r, order: n }));
    }
  }
}

/**
 * A plan day's rows this week: the template with this week's changes on top, in the order they were made. `changed`:
 * the rows a change touched (the small changed mark). Nothing else moves (no refit, no reorder, no re-pairing).
 */
export function pbDayWithEdits(rows: readonly RoutineExercise[], edits: readonly PlanWeekExerciseEdit[], measurementOf?: (exerciseId: string) => Measurement): { rows: RoutineExercise[]; changed: Set<string>; removed: string[] } {
  let out = [...rows].sort((a, b) => a.order - b.order);
  const changed = new Set<string>();
  const removed: string[] = [];
  for (const e of edits) {
    const before = out;
    out = oneExerciseChange(out, e, measurementOf);
    if (out === before || JSON.stringify(out) === JSON.stringify(before)) continue;
    if (e.kind === 'remove') {
      if (e.fromExerciseId !== null) removed.push(e.fromExerciseId);
    } else changed.add(e.rowId);
  }
  return { rows: out, changed, removed };
}
