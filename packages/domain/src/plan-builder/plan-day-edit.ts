import type { Load, RepRange, RoutineExercise, SetTemplate } from '@fizz/schemas';

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
}

export interface PlanDayEdit {
  /** The day's row IDs in their new order; null: the order stays. */
  order: string[] | null;
  rows: PlanDayRowChange[];
}

export interface PlanDayEditAsk {
  /** Every exercise of the day (exercise IDs), in the new order; null: the order stays. */
  order: readonly string[] | null;
  changes: readonly { exerciseId: string; sets: number | null; reps: RepRange | null; targetRpe: number | null; main: boolean | null; load: Load | null }[];
}

export type PlanDayEditPreview =
  | { kind: 'ok'; edit: PlanDayEdit }
  | { kind: 'order_mismatch'; missing: string[]; extra: string[] }
  | { kind: 'not_in_day'; exerciseIds: string[] }
  | { kind: 'splits_superset' }
  | { kind: 'no_change' };

type Row = Pick<RoutineExercise, 'id' | 'exerciseId' | 'order' | 'supersetGroup' | 'main' | 'setTemplates'>;

const working = (t: Pick<SetTemplate, 'setType'>): boolean => t.setType !== 'warmup';

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
  const out: PlanDayRowChange[] = [];
  for (const c of ask.changes) {
    const row = sorted.find((r) => r.exerciseId === c.exerciseId);
    if (row === undefined) continue;
    const work = row.setTemplates.filter(working);
    const change: PlanDayRowChange = { rowId: row.id };
    if (c.sets !== null && c.sets !== work.length) change.sets = c.sets;
    if (c.reps !== null && work.some((t) => t.targetReps === null || t.targetReps.min !== c.reps?.min || t.targetReps.max !== c.reps.max)) change.reps = { min: Math.min(c.reps.min, c.reps.max), max: Math.max(c.reps.min, c.reps.max) };
    if (c.targetRpe !== null && work.some((t) => t.targetRpe !== c.targetRpe)) change.targetRpe = c.targetRpe;
    if (c.main !== null && (row.main ?? false) !== c.main) change.main = c.main;
    if (c.load !== null && work.some((t) => t.targetLoad === null || t.targetLoad.value !== c.load?.value || t.targetLoad.unit !== c.load.unit)) change.load = c.load;
    if (Object.keys(change).length > 1 && !out.some((o) => o.rowId === row.id)) out.push(change);
  }
  if (order === null && out.length === 0) return { kind: 'no_change' };
  return { kind: 'ok', edit: { order, rows: out } };
}

/** The day's rows with the edit made (orders renumbered from 0). `setId`: a new working set's template ID. */
export function applyPlanDayEdit<R extends Row>(rows: readonly R[], edit: PlanDayEdit, setId: (rowId: string, n: number) => string): R[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const ordered = edit.order === null ? sorted : edit.order.map((id) => sorted.find((r) => r.id === id)).filter((r): r is R => r !== undefined);
  // An order that no longer names every row (the day changed since) leaves the order as it was; the caller checks versions first.
  const base = ordered.length === sorted.length ? ordered : sorted;
  return base.map((r, i) => {
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
          },
    );
    return { ...r, order: i, setTemplates: templates, ...(c.main !== undefined ? { main: c.main } : {}) };
  });
}
