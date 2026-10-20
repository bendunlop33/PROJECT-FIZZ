import type { EquipmentInstance, LoadConvention, WeightUnit } from '@fizz/schemas';
import { compareDifficulty, isPresenceOnly, loadDirection, roundToAvailableLoad } from '../equipment';
import { expectedLoad, referenceE1rm } from '../session/builder-loads';
import type { AnchorLoad, BuilderLoadSourceKind, RoundedLoad, SlotLoadInput } from './types';

/**
 * Builder loads (workout-builder-v3 §3.1, §9 Q12). Pure.
 *
 * 1. Today's working load: the first source that has one, in Ben's order
 *    (Q12): the coach's target → the plan's first-week load → the built-in
 *    rule → est. max (own recent sets, an estimate) × the set's reps and
 *    target RPE → none (`—`, `Start light` ceiling).
 * 2. Every other set follows from that working load by reps and RPE: the
 *    anchor's e1RM by Epley with RIR = 10 − RPE (`referenceE1rm`), then
 *    `expectedLoad` for the set (100 × 6 @ 8 → 95 × 8 @ 8).
 * 3. Rounded DOWN (toward easier) to what this gym can load; never past the
 *    item's max (rule 4). A request the item can't make without going
 *    harder is no load at all, never rounded up.
 *
 * Assisted and added-weight lifts have no formula (§2.4, §3.1.6): every
 * working set keeps the working kg.
 */

/** Conventions the reps/RPE formula applies to (same set as `loadReferences`' e1RM). */
const FORMULA_CONVENTIONS: ReadonlySet<LoadConvention> = new Set(['total', 'per_hand', 'stack']);

export function formulaApplies(convention: LoadConvention): boolean {
  return FORMULA_CONVENTIONS.has(convention);
}

/** Float noise from the formula (95.00000001) never pushes a load down a step. */
const tidy = (n: number): number => Math.round(n * 1000) / 1000;

export interface BuilderLoadResult {
  source: BuilderLoadSourceKind;
  /** The working load for the requested reps @ RPE, before rounding; null = unknown. */
  working: number | null;
  /** E1RM every other set derives from; null when the formula doesn't apply or there's no load. */
  anchorE1rm: number | null;
  /** `calc` loads are estimates (rule 6). */
  estimate: boolean;
  /** `Start light`: the safe cap for the machine, when there's no source. */
  startLight: number | null;
}

/**
 * `builderLoad`: the working load for a set of `reps` @ `rpe`, by the Q12
 * source order. A coach target given for the same reps and RPE is used as
 * is, whatever the est. max says.
 */
export function builderLoad(input: SlotLoadInput, set: { reps: number; rpe: number }): BuilderLoadResult {
  const formula = formulaApplies(input.convention);
  const anchored: [BuilderLoadSourceKind, AnchorLoad | null][] = [
    ['coach_target', input.coachTarget],
    ['plan', input.planFirstLoad],
    ['rule', input.ruleTarget],
  ];
  for (const [source, anchor] of anchored) {
    if (anchor === null || !Number.isFinite(anchor.value)) continue;
    if (!formula) return { source, working: anchor.value, anchorE1rm: null, estimate: false, startLight: null };
    const e1rm = anchorE1rmOf(anchor);
    const same = anchor.reps === set.reps && anchor.rpe === set.rpe;
    const working = same || e1rm === null ? anchor.value : tidy(expectedLoad(e1rm, set.reps, set.rpe));
    return { source, working, anchorE1rm: e1rm, estimate: false, startLight: null };
  }
  if (formula && input.e1rm !== null && Number.isFinite(input.e1rm) && input.e1rm > 0) {
    return { source: 'calc', working: tidy(expectedLoad(input.e1rm, set.reps, set.rpe)), anchorE1rm: input.e1rm, estimate: true, startLight: null };
  }
  return { source: 'none', working: null, anchorE1rm: null, estimate: false, startLight: input.startLightCeiling };
}

/** The e1RM a known load implies (Epley, RIR = 10 − RPE). Null outside 1–12 reps. */
export function anchorE1rmOf(anchor: AnchorLoad): number | null {
  return referenceE1rm([{ value: anchor.value, reps: anchor.reps, rpe: anchor.rpe }]);
}

/** The load for another set of the same exercise: by formula from the anchor, else the working kg. */
export function loadForSet(anchorE1rm: number | null, working: number | null, reps: number, rpe: number): number | null {
  if (anchorE1rm === null) return working;
  return tidy(expectedLoad(anchorE1rm, reps, rpe));
}

export interface RoundContext {
  unit: WeightUnit;
  convention: LoadConvention;
  equipment: EquipmentInstance | null;
  /** Pain hold: no harder than this (rule 9). */
  painCap?: number | null;
}

/**
 * `roundDownHere`: a requested load rounded toward easier to one this gym can
 * load (`roundToAvailableLoad`, policy `easier`). Never above the item's max
 * (rule 4). Null when there's no item, it carries no load, the convention
 * differs, or the only loadable value would be harder than asked (below a
 * stack's lightest plate, or more assistance than the machine has).
 */
export function roundDownHere(requested: number, ctx: RoundContext): RoundedLoad | null {
  const eq = ctx.equipment;
  if (eq === null || isPresenceOnly(eq) || !Number.isFinite(requested)) return null;
  const dir = loadDirection(ctx.convention);
  let value = tidy(requested);
  const cap = ctx.painCap ?? null;
  if (cap !== null && compareDifficulty(value, cap, dir) > 0) value = cap;
  const r = roundToAvailableLoad({ value, unit: ctx.unit, convention: ctx.convention }, eq, 'easier');
  if (!r.ok) return null;
  const asked = r.convertedRequest?.value ?? value;
  if (compareDifficulty(r.load.value, asked, dir) > 0 && Math.abs(r.load.value - asked) > 1e-6) return null;
  return { value: r.load.value, requested: tidy(requested), rounded: Math.abs(r.load.value - tidy(requested)) > 1e-6, bounded: r.bounded };
}
