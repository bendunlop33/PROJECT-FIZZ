import type { EquipmentInstance, Load, LoadConvention, ProgressionRule, WeightUnit } from '@fizz/schemas';
import { PLAYBOOK_DEFAULT_MAX_RPE } from '../default-rule';
import type { NextTargets, ProgressionDecision } from '../progression';
import { addedWeightEquipment } from '../added-weight';
import { compareDifficulty, isPresenceOnly, loadDirection } from '../equipment';
import { expectedLoad, referenceE1rm, returnCut } from '../session/builder-loads';
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
 *    the working load as is (review B3); other sets derive from it at the
 *    reps and RPE it's used at here (builder-loads review B1: reading it at
 *    the rule's 3-rep floor put back-offs ~10 % light), or from Ben's last
 *    session's est. max (gap-cut) when that's higher and the rule yields,
 *    never so high that a set of more reps is heavier than the top set.
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
 *
 * History wins over a stale anchor (builder loads, 21 Oct; Ben: "it knew my
 * history but wasn't using it"): an anchor marked `yieldsToHistory` (the
 * rule's load, a plan load older than the history) is replaced by the est.
 * max from Ben's last session (`lastE1rm`, review S1) when it implies an
 * e1RM below `HISTORY_WINS_SHARE` of it. The est. max is cut after a gap
 * (R1–R2) first. The rule's load is read at its own rep floor and target
 * RPE for this test (what the rule prescribes it for).
 * PROPOSED: the share and the order change await Ben's approval.
 */

/** An anchor implying an e1RM below this share of Ben's recent est. max gives way to it. Proposed, for Ben to approve. */
export const HISTORY_WINS_SHARE = 0.9;

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
    const history = historyOverride(anchor, e1rm, input);
    if (history !== null) return { ...u, source: 'calc', working: tidy(expectedLoad(history, set.reps, set.rpe)), anchorE1rm: history, estimate: true, startLight: null };
    const same = anchor.reps === set.reps && anchor.rpe === set.rpe;
    // The built-in rule's load is used as the rule gave it (ADR 0006, review B3) for a set of no more reps than the
    // rule's range; other sets derive from it at the reps it's used at (review B1), not the rule's floor. A set of more
    // reps (a main barbell lift's rule, 3–6, as a secondary lift at Ben's own 12; 21 Oct) follows from its e1RM.
    const inRange = anchor.repsMax === undefined || set.reps <= anchor.repsMax;
    if (source === 'rule' && e1rm !== null && inRange) return { ...u, source, working: anchor.value, anchorE1rm: ruleDerivedE1rm(anchor, set, input), estimate: false, startLight: null };
    const working = same || e1rm === null ? anchor.value : tidy(expectedLoad(e1rm, set.reps, set.rpe));
    return { ...u, source, working, anchorE1rm: e1rm, estimate: false, startLight: null };
  }
  if (formula && input.e1rm !== null && Number.isFinite(input.e1rm) && input.e1rm > 0) {
    return { ...u, source: 'calc', working: tidy(expectedLoad(input.e1rm, set.reps, set.rpe)), anchorE1rm: input.e1rm, estimate: true, startLight: null };
  }
  return { ...u, source: 'none', working: null, anchorE1rm: null, estimate: false, startLight: input.startLightCeiling };
}

/**
 * The est. max that replaces `anchor` (`HISTORY_WINS_SHARE`), cut after a
 * gap; null when the anchor stands. Resistance conventions only (`formulaApplies`).
 */
export function historyOverride(anchor: AnchorLoad, anchorE1rm: number | null, input: Pick<SlotLoadInput, 'e1rm' | 'lastE1rm' | 'e1rmGapDays'>): number | null {
  if (anchor.yieldsToHistory !== true || anchorE1rm === null) return null;
  const own = recentE1rm(input);
  return own !== null && anchorE1rm < HISTORY_WINS_SHARE * own ? own : null;
}

/** Ben's last session's est. max (`lastE1rm`, else `e1rm`), cut after a gap (R1–R2); null when unknown. */
export function recentE1rm(input: Pick<SlotLoadInput, 'e1rm' | 'lastE1rm' | 'e1rmGapDays'>): number | null {
  const raw = input.lastE1rm !== undefined ? input.lastE1rm : input.e1rm;
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw * (1 - returnCut(input.e1rmGapDays ?? 0));
}

/**
 * (Review B1) The e1RM other sets derive from when the rule's load is the
 * working (top) set at `set`: the load at the reps and RPE it's used at; when
 * the rule yields, Ben's last session's est. max (gap-cut) if higher. Capped
 * so a set of one more rep at the same RPE is never heavier than the top set.
 */
export function ruleDerivedE1rm(anchor: AnchorLoad, set: { reps: number; rpe: number }, input: Pick<SlotLoadInput, 'e1rm' | 'lastE1rm' | 'e1rmGapDays'>): number | null {
  const used = referenceE1rm([{ value: anchor.value, reps: set.reps, rpe: set.rpe }]);
  if (used === null) return anchorE1rmOf(anchor);
  const own = anchor.yieldsToHistory === true ? recentE1rm(input) : null;
  if (own === null || own <= used) return used;
  const cap = anchor.value * (1 + (set.reps + 1 + Math.max(0, 10 - set.rpe)) / 30);
  return Math.min(own, cap);
}

/** Rule decisions whose load gives way to clearly stronger recent sets; never a miss, a reduction or a pain hold. */
const RULE_YIELDS: ReadonlySet<ProgressionDecision> = new Set(['increase_load', 'increase_reps', 'hold', 'ceiling_reached']);

/** Whether a rule load with this decision gives way to clearly stronger recent sets (`HISTORY_WINS_SHARE`). */
export function ruleYieldsToHistory(decision: ProgressionDecision | null | undefined): boolean {
  return decision !== null && decision !== undefined && RULE_YIELDS.has(decision);
}

/**
 * `ruleAnchorOf`: the built-in rule's next target as the builder's anchor.
 * The rule's load is for its own rep floor (hold, add load, reduce: the floor
 * of the range; add reps: min = max) at the rule's target RPE (its progress
 * limit, never above the playbook's 9). Null when it has no load here.
 */
export function ruleAnchorOf(result: Pick<NextTargets, 'sets' | 'decision' | 'loadFeasibility'>, rule: ProgressionRule, convention: LoadConvention): AnchorLoad | null {
  const s = result.sets.find((x) => x.setType !== 'warmup' && x.load !== null);
  if (s?.load == null || result.loadFeasibility === 'infeasible' || s.load.convention !== convention) return null;
  const limit = rule.method === 'double_progression' ? rule.maxRpeToProgress : rule.topSet.maxRpeToProgress;
  const rpe = limit === null ? 8 : Math.min(limit, PLAYBOOK_DEFAULT_MAX_RPE);
  return { value: s.load.value, reps: s.reps.min, rpe, repsMax: Math.max(s.reps.min, s.reps.max), ...(RULE_YIELDS.has(result.decision) ? { yieldsToHistory: true } : {}) };
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
    ...(input.lastE1rm !== undefined ? { lastE1rm: c(input.lastE1rm) } : {}),
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
