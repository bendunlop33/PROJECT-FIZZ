import type { PlannedSet, RepRange, SetType } from '@fizz/schemas';

import { SLOT_SET_LIMITS } from './routine-editor';

/**
 * The plan for an exercise added to a workout that is running (or empty),
 * with the `Sets [−] N [+]` count the picker's bar or the Library's Add sheet
 * gave (exercise-library §10.2, §9.5). Pure.
 *
 * Only the new exercise's **new, pending** sets are shaped here: nothing that
 * is already in the workout (and no completed set) is read or changed
 * (rule 2). Targets stay the exercise's own (its history through the
 * built-in rule, or the default starting plan); a set added to reach N copies
 * the last working set's target, and dropping removes working sets from the
 * end. Loads are never invented: a plan without loads stays without them.
 */

export interface AddShape {
  /** Non-warm-up sets wanted, 1–10. */
  workingSets: number;
  /** Warm-ups wanted (0–5); absent = keep the plan's own warm-ups. */
  warmups?: number;
  /** Ben's reps for every working set (the Add sheet's `Reps`); absent = keep the plan's. */
  reps?: RepRange;
  /** Ben's work time for a timed exercise; absent = keep the plan's. */
  durationS?: number;
  /** Ben's target effort for the working sets (`Target RPE` / `RIR`); absent = keep the plan's, null = none. */
  effort?: { scale: 'rpe' | 'rir'; value: number | null };
}

export type PlannedEntry = { setType: SetType; planned: PlannedSet };

const EMPTY: PlannedSet = { load: null, reps: null, durationS: null, rpe: null, rir: null };
const WARMUP_REPS: RepRange = { min: 5, max: 5 };

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.round(n)));

/**
 * `plan` is what the add would have used without a count (null = none: one
 * empty working set, as before §10.2). Returns warm-ups first, then the
 * working sets, in order.
 */
export function shapeAddPlan(plan: readonly PlannedEntry[] | null, shape: AddShape): PlannedEntry[] {
  const base: readonly PlannedEntry[] = plan !== null && plan.length > 0 ? plan : [{ setType: 'working', planned: { ...EMPTY } }];
  const warm = base.filter((p) => p.setType === 'warmup');
  let work = base.filter((p) => p.setType !== 'warmup');
  if (work.length === 0) work = [{ setType: 'working', planned: { ...EMPTY } }];
  const n = clamp(shape.workingSets, SLOT_SET_LIMITS.working.min, SLOT_SET_LIMITS.working.max);
  const last = work[work.length - 1] as PlannedEntry;
  const working: PlannedEntry[] = n <= work.length ? work.slice(0, n) : [...work, ...Array.from({ length: n - work.length }, () => ({ setType: last.setType, planned: { ...last.planned } }))];
  let warmups: PlannedEntry[] = [...warm];
  if (shape.warmups !== undefined) {
    const w = clamp(shape.warmups, SLOT_SET_LIMITS.warmups.min, SLOT_SET_LIMITS.warmups.max);
    const like = warm[warm.length - 1];
    const timed = last.planned.durationS !== null && last.planned.reps === null;
    const fresh = (): PlannedEntry => (like !== undefined ? { setType: 'warmup', planned: { ...like.planned } } : { setType: 'warmup', planned: { ...EMPTY, reps: timed ? null : { ...WARMUP_REPS }, durationS: timed ? last.planned.durationS : null } });
    warmups = w <= warm.length ? warm.slice(0, w) : [...warm, ...Array.from({ length: w - warm.length }, fresh)];
  }
  const shaped = working.map((p): PlannedEntry => {
    if (p.setType !== 'working') return p;
    let planned = p.planned;
    if (shape.reps !== undefined && planned.durationS === null) planned = { ...planned, reps: { ...shape.reps } };
    if (shape.durationS !== undefined && planned.reps === null) planned = { ...planned, durationS: Math.max(1, Math.round(shape.durationS)) };
    if (shape.effort !== undefined) planned = shape.effort.scale === 'rpe' ? { ...planned, rpe: shape.effort.value, rir: null } : { ...planned, rir: shape.effort.value, rpe: null };
    return { setType: p.setType, planned };
  });
  return [...warmups, ...shaped];
}
