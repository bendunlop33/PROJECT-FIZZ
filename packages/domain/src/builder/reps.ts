import { personalRepRange, type RepRangeValue, type RuleReps } from '../rep-range';
import { BUILDER_SET_RULES } from './set-rows';
import type { RepRangeT, SlotLoadInput } from './types';

/**
 * The load inputs a slot uses: a non-main slot of a main barbell lift reads
 * its rule as a secondary lift's (`SlotLoadInput.secondary`).
 */
export function slotLoadOf(load: SlotLoadInput, main: boolean): SlotLoadInput {
  if (main || load.secondary === undefined) return load;
  return { ...load, ruleTarget: load.secondary.ruleTarget, ruleReps: load.secondary.ruleReps };
}

/**
 * Builder slot reps from history (Ben, 21 Oct: shrugs planned at 8 reps
 * although he did 15 last time). Pure.
 *
 * - Main lift: the top set / back-offs scheme (§3.1.9: top at the bottom of
 *   6–8, back-offs at the top), as before; `slotRepsWhy` says when his last
 *   session's reps were far from it, so it never contradicts history silently.
 * - Any other slot with history: the built-in rule's reps (`RuleReps`, the
 *   same numbers Today, swaps, adds and `get_progression_targets` read). The
 *   slot's range is `aim … top of the rule's range`, so working sets are
 *   planned at `aim` and the rule's load is used for them as is.
 * - A main barbell lift used as a secondary lift: its rule read as a
 *   compound lift's (`slotLoadOf`). Without that reading (`fixed`, 3–6), the
 *   builder's accessory range follows his last reps the same way, planned at
 *   what he did; the load then follows from the rule load's e1RM
 *   (`AnchorLoad.repsMax`).
 * - No history: the builder's defaults (main 6–8, others 8–12).
 */
export function slotRepRange(main: boolean, load: Pick<SlotLoadInput, 'ruleReps'>): RepRangeT {
  if (main) return { ...BUILDER_SET_RULES.mainRange };
  const r = load.ruleReps ?? null;
  if (r === null || r.last === null) return { ...BUILDER_SET_RULES.accessoryRange };
  if (r.kind === 'fixed') {
    const goal = BUILDER_SET_RULES.accessoryRange;
    const p = personalRepRange(goal, r.last, goal.max + 3);
    const aim = Math.max(p.range.min, Math.min(p.range.max, r.last));
    return { min: aim, max: Math.max(aim, p.range.max) };
  }
  return { min: r.aim, max: Math.max(r.aim, r.range.max) };
}

const rangeText = (r: RepRangeValue): string => (r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`);

/**
 * The `Why?` line about a slot's reps; null with no history, or when his last
 * reps were inside the goal range. Minimal copy: values only.
 * - `Reps: last time 15`
 * - `Reps: last time 20 · toward 8–12`
 * - Main lift: `Last time 12 reps · main lift 6–8` when his last reps were outside the scheme.
 */
export function slotRepsWhy(main: boolean, ruleReps: RuleReps | null | undefined): string | null {
  const r = ruleReps ?? null;
  if (r === null || r.last === null) return null;
  if (main) {
    const m = BUILDER_SET_RULES.mainRange;
    return r.last < m.min || r.last > m.max ? `Last time ${String(r.last)} reps · main lift ${rangeText(m)}` : null;
  }
  if (r.kind === 'toward_goal') return `Reps: last time ${String(r.last)} · toward ${rangeText(r.goal)}`;
  // Inside the goal range the reps speak for themselves (`Last time` names the load).
  return r.kind === 'goal' ? null : `Reps: last time ${String(r.last)}`;
}
