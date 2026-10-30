import type { PlanBuilderAnswers, RoutineExercise } from '@fizz/schemas';

import { pbPrefLikes } from './engine';
import { PB_PREF_QUESTIONS } from './tables';

/**
 * (Ben, 30 Oct, build 486: "Error from coach app in live session won't change full plan. Also my preferences to
 * remove leg extension in setting as non preferred hasn't updated plan.") One exercise swapped in every plan day
 * where it appears, from now on. Pure.
 *
 * - `pbNotPreferred`: the exercises Ben marked not preferred on Any preferences (the listed option he didn't pick, and
 *   any `never`), less anything he picked or likes elsewhere. Catalogue keys.
 * - `planSwapDirection`: which way round a swap goes. A not-preferred exercise is never put in: when the coach's
 *   `add` is one and it is in his plan, it is the one that comes out (Ben, 30 Oct: "swap leg press and leg extension"
 *   with leg extension not preferred means leg extension out); otherwise the swap is refused.
 * - `planSwapPreview`: each plan day's one change (the row swapped; removed when the day already has the exercise
 *   going in), against each day's version as read (rule 5). Only that exercise changes: sets, reps, rest, position,
 *   superset and main mark stay (`oneExerciseChange`); nothing is re-fitted.
 * - `pbNotPreferredReplacement`: what replaces a not-preferred exercise: the option he picked on that question, else
 *   the first alternative for the same muscles that is usable, not held for pain and not itself not preferred.
 * - `notPreferredInPlan`: which not-preferred exercises are in which plan days (Settings' `In your plan: …` line).
 */

/** Not preferred on Any preferences (catalogue keys): the listed option not picked, and `never`; a like or pick wins. */
export function pbNotPreferred(a: Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>): Set<string> {
  const liked = new Set(pbPrefLikes(a));
  const out = new Set<string>();
  for (const [id, ans] of Object.entries(a.prefs)) {
    const q = PB_PREF_QUESTIONS.find((x) => x.id === id);
    if (q === undefined || ans === 'either') continue;
    q.opts.forEach((o, j) => {
      if (j !== ans) for (const k of o) out.add(k);
    });
  }
  for (const k of a.never) out.add(k);
  for (const k of liked) out.delete(k);
  return out;
}

export type PlanSwapDirection = { kind: 'ok'; remove: string; add: string; flipped: boolean } | { kind: 'refused'; reason: 'adds_not_preferred' | 'same' };

/**
 * Which way a swap goes. `notPreferred` and the IDs are in the same ID space. `inPlan`: whether an exercise is in any
 * plan day. The coach's `add` that is not preferred is never put in: it comes out instead when it is in the plan and
 * the other one isn't also not preferred; otherwise refused.
 */
export function planSwapDirection(req: { remove: string; add: string; notPreferred: ReadonlySet<string>; inPlan: (id: string) => boolean }): PlanSwapDirection {
  if (req.remove === req.add) return { kind: 'refused', reason: 'same' };
  if (!req.notPreferred.has(req.add)) return { kind: 'ok', remove: req.remove, add: req.add, flipped: false };
  if (!req.notPreferred.has(req.remove) && req.inPlan(req.add)) return { kind: 'ok', remove: req.add, add: req.remove, flipped: true };
  return { kind: 'refused', reason: 'adds_not_preferred' };
}

export interface PlanSwapDayInput {
  routineId: string;
  name: string;
  version: number;
  rows: readonly Pick<RoutineExercise, 'id' | 'exerciseId' | 'order'>[];
}

export interface PlanSwapEdit {
  /** `swap`: the row now does the exercise going in; `remove`: the day already has it, so the row goes. */
  kind: 'swap' | 'remove';
  rowId: string;
}

export interface PlanSwapDay {
  routineId: string;
  routineName: string;
  /** The day's version as read: Apply is refused on any other (rule 5). */
  versionBefore: number;
  edits: PlanSwapEdit[];
}

export type PlanSwapPreview = { kind: 'ok'; days: PlanSwapDay[] } | { kind: 'not_in_plan' } | { kind: 'same' };

/** Each plan day's change for `remove` → `add`, in plan order. Days without `remove` are untouched. */
export function planSwapPreview(days: readonly PlanSwapDayInput[], remove: string, add: string): PlanSwapPreview {
  if (remove === add) return { kind: 'same' };
  const out: PlanSwapDay[] = [];
  for (const d of days) {
    const rows = [...d.rows].sort((a, b) => a.order - b.order);
    const hits = rows.filter((r) => r.exerciseId === remove);
    if (hits.length === 0) continue;
    const hasAdd = rows.some((r) => r.exerciseId === add);
    // The day already has the exercise coming in: the row going out goes (never a second copy). A day is never emptied:
    // the exercise coming in is still there.
    const edits: PlanSwapEdit[] = hits.map((r) => ({ kind: hasAdd ? 'remove' : 'swap', rowId: r.id }));
    out.push({ routineId: d.routineId, routineName: d.name, versionBefore: d.version, edits });
  }
  return out.length === 0 ? { kind: 'not_in_plan' } : { kind: 'ok', days: out };
}

/** Which plan days hold each not-preferred exercise, in plan order (exercise IDs). Only those in some day. */
export function notPreferredInPlan(notPreferred: ReadonlySet<string>, days: readonly Pick<PlanSwapDayInput, 'name' | 'rows'>[]): { exerciseId: string; days: string[] }[] {
  const by = new Map<string, string[]>();
  for (const d of days) {
    for (const r of [...d.rows].sort((a, b) => a.order - b.order)) {
      if (!notPreferred.has(r.exerciseId)) continue;
      const list = by.get(r.exerciseId) ?? [];
      if (!list.includes(d.name)) list.push(d.name);
      by.set(r.exerciseId, list);
    }
  }
  return [...by.entries()].map(([exerciseId, names]) => ({ exerciseId, days: names }));
}

/**
 * What replaces a not-preferred exercise (catalogue keys): the option Ben picked on its question (`other` too), else
 * the first of `alternatives` (same muscles, best first) that is usable here, not held for pain and not itself not
 * preferred. Null: nothing fits.
 */
export function pbNotPreferredReplacement(key: string, a: Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>, ports: { usable: (key: string) => boolean; held: (key: string) => boolean; alternatives: readonly string[] }): string | null {
  const no = pbNotPreferred(a);
  const fits = (k: string): boolean => k !== key && !no.has(k) && ports.usable(k) && !ports.held(k);
  for (const q of PB_PREF_QUESTIONS) {
    if (!q.opts.some((o) => o.includes(key))) continue;
    const ans = a.prefs[q.id];
    if (ans === undefined || ans === 'either') continue;
    const picked = typeof ans === 'object' ? [ans.other] : [...q.opts[ans]];
    const k = picked.find(fits);
    if (k !== undefined) return k;
  }
  return ports.alternatives.find(fits) ?? null;
}
