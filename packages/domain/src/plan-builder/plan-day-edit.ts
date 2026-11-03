import type { Load, RepRange, RoutineExercise, SetTemplate } from '@fizz/schemas';

import { withOneMainLift } from '../session/main-lift';

/**
 * (Ben, 1 Nov, build 500: "I think we didn't adjust the plan considering the shoulders I just trained? Going forwards
 * plan B should be slightly different?") One plan day changed every week from now on: its order, and each named
 * exercise's working sets, reps, target RPE, main mark and a load Ben named. Pure.
 *
 * - `planDayEditPreview`: the coach's ask checked against the day as it is: an order must name every exercise of the
 *   day once; a change must name an exercise in the day; a reorder never splits a superset; nothing at all changing
 *   is `no_change`. Exercise IDs in, row IDs out (the write is against rows, rule 5).
 * - `applyPlanDayEdit`: the day's rows with the edit made. Only what was named changes: rests, supersets, set types and
 *   every other row stay. Warm-ups are never touched; extra working sets copy the last one.
 */

export interface PlanDayRowChange {
  rowId: string;
  /** Working sets (warm-ups not counted). */
  sets?: number | undefined;
  reps?: RepRange | undefined;
  targetRpe?: number | undefined;
  main?: boolean | undefined;
  /** Only a weight Ben named (kept as typed, rule 4). */
  load?: Load | undefined;
  /** (Ben, 3 Nov) A cardio or timed row's work time per set (seconds) and distance (metres). */
  durationS?: number | undefined;
  distanceM?: number | undefined;
  /** (Ben, 3 Nov) The row's warm-up mark on (true) or off (false); only on a cardio or timed row. */
  warmup?: boolean | undefined;
  /** (Ben, 3 Nov) The row was moved first in the day (the edit's `order` carries it); for the card's line. */
  first?: true | undefined;
}

export interface PlanDayEdit {
  /** The day's row IDs in their new order; null: the order stays. */
  order: string[] | null;
  rows: PlanDayRowChange[];
}

export interface PlanDayEditAsk {
  /** Every exercise of the day (exercise IDs), in the new order; null: the order stays. */
  order: readonly string[] | null;
  changes: readonly {
    exerciseId: string;
    sets: number | null;
    reps: RepRange | null;
    targetRpe: number | null;
    main: boolean | null;
    load: Load | null;
    /** (Ben, 3 Nov: "set the bike to 8 min on leg days") A cardio or timed row's time per set (seconds); null keeps it. */
    durationS?: number | null;
    distanceM?: number | null;
    /** (Ben, 3 Nov) The warm-up mark on or off (cardio or timed rows only); null keeps it. */
    warmup?: boolean | null;
    /** (Ben, 3 Nov) Put this exercise first in the day; null or false keeps its place. */
    first?: boolean | null;
  }[];
}

export type PlanDayEditPreview =
  | { kind: 'ok'; edit: PlanDayEdit }
  | { kind: 'order_mismatch'; missing: string[]; extra: string[] }
  | { kind: 'not_in_day'; exerciseIds: string[] }
  | { kind: 'splits_superset' }
  /** (Ben, 3 Nov) A time, distance or warm-up mark asked for on an exercise done for reps. */
  | { kind: 'not_timed'; exerciseIds: string[] }
  | { kind: 'no_change' };

type Row = Pick<RoutineExercise, 'id' | 'exerciseId' | 'order' | 'supersetGroup' | 'main' | 'setTemplates' | 'warmup'>;

const working = (t: Pick<SetTemplate, 'setType'>): boolean => t.setType !== 'warmup';

/** (Ben, 3 Nov) A cardio or timed plan row: every working set has a work time or a distance and no reps. */
export function planRowIsTimed(r: Pick<RoutineExercise, 'setTemplates'>): boolean {
  const work = r.setTemplates.filter(working);
  return work.length > 0 && work.every((t) => t.targetReps === null && (t.targetDurationS !== null || t.targetDistanceM != null));
}

/** Whether every superset's members stand next to each other in this order. */
function supersetsTogether(rows: readonly Pick<Row, 'supersetGroup'>[]): boolean {
  const seen = new Set<string>();
  let last: string | null = null;
  for (const r of rows) {
    const g = r.supersetGroup;
    if (g !== null && g !== last && seen.has(g)) return false;
    if (g !== null) seen.add(g);
    last = g;
  }
  return true;
}

export function planDayEditPreview(rows: readonly Row[], ask: PlanDayEditAsk): PlanDayEditPreview {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  let order: string[] | null = null;
  if (ask.order !== null) {
    // Each exercise ID takes the day's next unused row of it (a day can hold an exercise twice).
    const free = [...sorted];
    const ids: string[] = [];
    const extra: string[] = [];
    for (const x of ask.order) {
      const i = free.findIndex((r) => r.exerciseId === x);
      if (i < 0) extra.push(x);
      else ids.push(free.splice(i, 1)[0]?.id ?? '');
    }
    if (extra.length > 0 || free.length > 0) return { kind: 'order_mismatch', missing: free.map((r) => r.exerciseId), extra };
    const moved = ids.map((id) => sorted.find((r) => r.id === id)).filter((r): r is Row => r !== undefined);
    if (!supersetsTogether(moved)) return { kind: 'splits_superset' };
    order = ids.every((id, i) => sorted[i]?.id === id) ? null : ids;
  }
  const notIn = ask.changes.filter((c) => !sorted.some((r) => r.exerciseId === c.exerciseId)).map((c) => c.exerciseId);
  if (notIn.length > 0) return { kind: 'not_in_day', exerciseIds: notIn };
  // (Ben, 3 Nov) A time, distance or warm-up mark only on a cardio or timed row (never turns a lift into one).
  const notTimed = ask.changes.filter((c) => (c.durationS != null || c.distanceM != null || c.warmup === true) && !planRowIsTimed(sorted.find((r) => r.exerciseId === c.exerciseId) ?? { setTemplates: [] })).map((c) => c.exerciseId);
  if (notTimed.length > 0) return { kind: 'not_timed', exerciseIds: notTimed };
  // (Ben, 3 Nov: "bike first") An exercise asked first goes first (the rest keep their order); never splits a superset.
  const firstId = ask.changes.find((c) => c.first === true)?.exerciseId ?? null;
  const firstRow = firstId === null ? undefined : sorted.find((r) => r.exerciseId === firstId);
  let movedFirst = false;
  if (firstRow !== undefined) {
    const base = order ?? sorted.map((r) => r.id);
    if (base[0] !== firstRow.id) {
      const ids = [firstRow.id, ...base.filter((id) => id !== firstRow.id)];
      const moved = ids.map((id) => sorted.find((r) => r.id === id)).filter((r): r is Row => r !== undefined);
      if (!supersetsTogether(moved)) return { kind: 'splits_superset' };
      order = ids.every((id, i) => sorted[i]?.id === id) ? null : ids;
      movedFirst = true;
    }
  }
  const out: PlanDayRowChange[] = [];
  for (const c of ask.changes) {
    const row = sorted.find((r) => r.exerciseId === c.exerciseId);
    if (row === undefined) continue;
    const work = row.setTemplates.filter(working);
    const change: PlanDayRowChange = { rowId: row.id };
    if (c.durationS != null && c.durationS > 0 && work.some((t) => t.targetDurationS !== c.durationS)) change.durationS = Math.round(c.durationS);
    if (c.distanceM != null && c.distanceM > 0 && work.some((t) => (t.targetDistanceM ?? null) !== c.distanceM)) change.distanceM = c.distanceM;
    if (c.warmup != null && (row.warmup === true) !== c.warmup) change.warmup = c.warmup;
    if (movedFirst && row === firstRow) change.first = true;
    if (c.sets !== null && c.sets !== work.length) change.sets = c.sets;
    if (c.reps !== null && work.some((t) => t.targetReps === null || t.targetReps.min !== c.reps?.min || t.targetReps.max !== c.reps.max)) change.reps = { min: Math.min(c.reps.min, c.reps.max), max: Math.max(c.reps.min, c.reps.max) };
    if (c.targetRpe !== null && work.some((t) => t.targetRpe !== c.targetRpe)) change.targetRpe = c.targetRpe;
    if (c.main !== null && (row.main ?? false) !== c.main) change.main = c.main;
    if (c.load !== null && work.some((t) => t.targetLoad === null || t.targetLoad.value !== c.load?.value || t.targetLoad.unit !== c.load.unit)) change.load = c.load;
    if (Object.keys(change).length > 1 && !out.some((o) => o.rowId === row.id)) out.push(change);
  }
  if (order === null && out.length === 0) return { kind: 'no_change' };
  // A row only moved first still gets its line (`Exercise bike: first`).
  if (movedFirst && firstRow !== undefined && !out.some((o) => o.rowId === firstRow.id)) out.push({ rowId: firstRow.id, first: true });
  return { kind: 'ok', edit: { order, rows: out } };
}

/** The day's rows with the edit made (orders renumbered from 0). `setId`: a new working set's template ID. */
export function applyPlanDayEdit<R extends Row>(rows: readonly R[], edit: PlanDayEdit, setId: (rowId: string, n: number) => string): R[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const ordered = edit.order === null ? sorted : edit.order.map((id) => sorted.find((r) => r.id === id)).filter((r): r is R => r !== undefined);
  // An order that no longer names every row (the day changed since) leaves the order as it was; the caller checks versions first.
  const base = ordered.length === sorted.length ? ordered : sorted;
  const out = base.map((r, i) => {
    const c = edit.rows.find((x) => x.rowId === r.id);
    if (c === undefined) return { ...r, order: i };
    let templates = [...r.setTemplates];
    if (c.sets !== undefined) {
      const work = templates.filter(working);
      const last = work.at(-1);
      if (c.sets < work.length) {
        const drop = new Set(work.slice(c.sets).map((t) => t.id));
        templates = templates.filter((t) => !drop.has(t.id));
      } else if (last !== undefined) {
        for (let n = work.length; n < c.sets; n += 1) templates.push({ ...last, id: setId(r.id, n) });
      }
    }
    templates = templates.map((t) =>
      !working(t)
        ? t
        : {
            ...t,
            ...(c.reps !== undefined && t.targetDurationS === null ? { targetReps: { ...c.reps } } : {}),
            ...(c.targetRpe !== undefined ? { targetRpe: c.targetRpe, targetRir: null } : {}),
            ...(c.load !== undefined ? { targetLoad: { ...c.load } } : {}),
            // (Ben, 3 Nov) A cardio or timed row's time and distance (never a set done for reps).
            ...(c.durationS !== undefined && t.targetReps === null ? { targetDurationS: c.durationS } : {}),
            ...(c.distanceM !== undefined && t.targetReps === null ? { targetDistanceM: c.distanceM } : {}),
          },
    );
    const next = { ...r, order: i, setTemplates: templates, ...(c.main !== undefined ? { main: c.main } : {}) };
    if (c.warmup === true) return { ...next, warmup: true as const };
    if (c.warmup === false) {
      const { warmup: _off, ...rest } = next;
      return rest as typeof next;
    }
    return next;
  });
  // (Ben, 1 Nov) One main lift per day, as `Make main lift`: a row made main is the only one (`withOneMainLift`).
  const made = edit.rows.find((x) => x.main === true);
  const one = made === undefined ? out : withOneMainLift(out, made.rowId);
  return one === null || one === 'same' ? out : one;
}
