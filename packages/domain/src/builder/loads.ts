import type { EquipmentInstance, Load, LoadConvention, WeightUnit } from '@fizz/schemas';
import { addedWeightEquipment } from '../added-weight';
import { compareDifficulty, isPresenceOnly, loadDirection } from '../equipment';
import { expectedLoad, referenceE1rm } from '../session/builder-loads';
import { fitOn, fitWithoutEquipment, type LoadFit } from '../session/snap';
import { convertMass } from '../units';
import type { AnchorLoad, BuilderLoadSourceKind, RoundedLoad, SlotLoadInput } from './types';

/**
 * Builder loads (workout-builder-v3 §3.1, §9 Q12). Pure.
 *
 * 1. Today's working load: the first source that has one, in Ben's order
 *    (Q12): the coach's target → the plan's first-week load → the built-in
 *    rule → est. max (own recent sets, an estimate) × the set's reps and
 *    target RPE → none (`—`, `Start light` ceiling). The rule's load is
 *    given at its own rep floor and is never scaled up (review B3).
 * 2. Every other set follows from that working load by reps and RPE: the
 *    anchor's e1RM by Epley with RIR = 10 − RPE (`referenceE1rm`), then
 *    `expectedLoad` for the set (100 × 6 @ 8 → 95 × 8 @ 8).
 * 3. Rounded DOWN (toward easier) to what this gym can load, through the
 *    same `fitOn` / `fitWithoutEquipment` that `snapPlanToGym` uses (§4.1):
 *    never past the item's max (rule 4); a request the item can't make
 *    without going harder is no load at all, never rounded up.
 *
 * Units (review B1): every load is worked out in the item's own unit (the
 * slot's unit becomes the item's, as in `snapPlanToGym`), so a kg target on
 * lb dumbbells is converted first and the rows are labelled lb. Without an
 * item, a load is kept only in the slot's own unit and convention.
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
  /** Unit and convention of `working`, `anchorE1rm` and `startLight` (the item's, see `loadFrameOf`). */
  unit: WeightUnit;
  convention: LoadConvention;
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
export function builderLoad(raw: SlotLoadInput, set: { reps: number; rpe: number }): BuilderLoadResult {
  const frame = loadFrameOf(raw);
  const input = inFrame(raw, frame);
  const u = { unit: frame.unit, convention: frame.convention };
  const formula = formulaApplies(input.convention);
  const anchored: [BuilderLoadSourceKind, AnchorLoad | null][] = [
    ['coach_target', input.coachTarget],
    ['plan', input.planFirstLoad],
    ['rule', input.ruleTarget],
  ];
  for (const [source, anchor] of anchored) {
    if (anchor === null || !Number.isFinite(anchor.value)) continue;
    if (!formula) return { ...u, source, working: anchor.value, anchorE1rm: null, estimate: false, startLight: null };
    const e1rm = anchorE1rmOf(anchor);
    const same = anchor.reps === set.reps && anchor.rpe === set.rpe;
    const derived = same || e1rm === null ? anchor.value : tidy(expectedLoad(e1rm, set.reps, set.rpe));
    // The built-in rule's load is the most it allows (ADR 0006): fewer reps than its prescription never scale it up (review B3).
    const working = source === 'rule' && derived > anchor.value ? anchor.value : derived;
    return { ...u, source, working, anchorE1rm: e1rm, estimate: false, startLight: null };
  }
  if (formula && input.e1rm !== null && Number.isFinite(input.e1rm) && input.e1rm > 0) {
    return { ...u, source: 'calc', working: tidy(expectedLoad(input.e1rm, set.reps, set.rpe)), anchorE1rm: input.e1rm, estimate: true, startLight: null };
  }
  return { ...u, source: 'none', working: null, anchorE1rm: null, estimate: false, startLight: input.startLightCeiling };
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

// ---------------------------------------------------------------------------
// Load frame: which item, unit and convention a slot's loads are worked out in

/**
 * - `item`: rounded on this item, in its unit. Weighted bodyweight lifts
 *   (dips, pull-ups with added weight) use the gym's dumbbells and plates
 *   (`addedWeightEquipment`, as `snapPlanToGym` does).
 * - `free`: no item needed (bodyweight, or added weight with no gym items
 *   given): the target is kept in the slot's own unit and convention.
 * - `none`: an equipped lift with no item here: no load (`—`).
 */
export type LoadFrame =
  | { kind: 'item'; unit: WeightUnit; convention: LoadConvention; equipment: EquipmentInstance; added: boolean }
  | { kind: 'free'; unit: WeightUnit; convention: LoadConvention }
  | { kind: 'none'; unit: WeightUnit; convention: LoadConvention };

export function loadFrameOf(input: SlotLoadInput): LoadFrame {
  const eq = input.equipment;
  const station = eq !== null && isPresenceOnly(eq);
  if (input.convention === 'added' && (input.bodyweightExercise === true || eq === null || station || eq.loadConvention !== 'added')) {
    const unit = eq?.unit ?? input.unit;
    const items = input.gymEquipment ?? (eq !== null && !station ? [eq] : null);
    if (items === null) return { kind: 'free', unit: input.unit, convention: 'added' };
    return { kind: 'item', unit, convention: 'added', equipment: addedWeightEquipment(items, unit, station ? eq : null, eq?.gymId ?? null), added: true };
  }
  if (eq === null || station) {
    const free = input.convention === 'bodyweight' || input.convention === 'added';
    return { kind: free ? 'free' : 'none', unit: input.unit, convention: input.convention };
  }
  if (eq.loadConvention !== input.convention) return { kind: 'none', unit: input.unit, convention: input.convention };
  return { kind: 'item', unit: eq.unit, convention: input.convention, equipment: eq, added: false };
}

/** A value in `from` as `to` (unrounded; rounding happens on the item). */
export function convertValue(value: number, from: WeightUnit, to: WeightUnit): number {
  return from === to ? value : tidy(convertMass({ value, unit: from }, to).value);
}

/** The load inputs with every value in the frame's unit. */
export function inFrame(input: SlotLoadInput, frame: LoadFrame): SlotLoadInput {
  if (input.unit === frame.unit) return input;
  const c = (v: number | null): number | null => (v === null ? null : convertValue(v, input.unit, frame.unit));
  const a = (x: AnchorLoad | null): AnchorLoad | null => (x === null ? null : { ...x, value: convertValue(x.value, input.unit, frame.unit) });
  return {
    ...input,
    unit: frame.unit,
    coachTarget: a(input.coachTarget),
    planFirstLoad: a(input.planFirstLoad),
    ruleTarget: a(input.ruleTarget),
    e1rm: c(input.e1rm),
    startLightCeiling: c(input.startLightCeiling),
    painCap: c(input.painCap),
  };
}

export interface RoundContext {
  /** Unit and convention of the requested value. */
  unit: WeightUnit;
  convention: LoadConvention;
  equipment: EquipmentInstance | null;
  /** No item needed: keep the value as asked (`fitWithoutEquipment`). */
  free?: boolean;
  /** Pain hold: no harder than this, in `unit` (rule 9). */
  painCap?: number | null;
}

/** The rounding context for a slot's load inputs (frame unit, pain cap converted). */
export function roundContextOf(input: SlotLoadInput): RoundContext {
  const frame = loadFrameOf(input);
  return {
    unit: frame.unit,
    convention: frame.convention,
    equipment: frame.kind === 'item' ? frame.equipment : null,
    free: frame.kind === 'free',
    painCap: input.painCap === null ? null : convertValue(input.painCap, input.unit, frame.unit),
  };
}

export type FitHereRefusal = 'lightest_is_harder' | 'not_loadable';

export type FitHere = { ok: true; load: RoundedLoad } | { ok: false; reason: FitHereRefusal; lightest: number | null };

/**
 * `fitHere`: a requested load rounded toward easier on this gym's item
 * (`fitOn`, the same rule `snapPlanToGym` applies). `lightest_is_harder`: the
 * easiest load here is harder than asked (`lightest`, for the UI).
 */
export function fitHere(requested: number, ctx: RoundContext): FitHere {
  if (!Number.isFinite(requested) || requested < 0) return { ok: false, reason: 'not_loadable', lightest: null };
  const eq = ctx.equipment;
  const dir = loadDirection(ctx.convention);
  const asked = tidy(requested);
  let value = asked;
  const cap = ctx.painCap ?? null;
  const capped = cap !== null && compareDifficulty(value, cap, dir) > 0;
  if (capped) value = cap;
  const target: Load = { value, unit: ctx.unit, convention: ctx.convention };
  let fit: LoadFit;
  if (eq !== null && !isPresenceOnly(eq)) fit = fitOn(target, eq);
  else if (ctx.free === true) fit = fitWithoutEquipment(target, ctx.unit, ctx.convention);
  else return { ok: false, reason: 'not_loadable', lightest: null };
  if (fit.load === null) return fit.reason === 'lightest_is_harder' ? { ok: false, reason: 'lightest_is_harder', lightest: fit.lightest?.value ?? null } : { ok: false, reason: 'not_loadable', lightest: null };
  const unit = fit.load.unit;
  const beforeRound = convertValue(value, ctx.unit, unit);
  return {
    ok: true,
    load: {
      value: fit.load.value,
      unit,
      requested: asked,
      requestedUnit: ctx.unit,
      rounded: Math.abs(fit.load.value - beforeRound) > 1e-6,
      bounded: fit.bounded,
      capped: capped ? 'pain' : null,
    },
  };
}

/** `roundDownHere`: `fitHere`, or null when nothing loadable here is as easy as asked. */
export function roundDownHere(requested: number, ctx: RoundContext): RoundedLoad | null {
  const r = fitHere(requested, ctx);
  return r.ok ? r.load : null;
}
