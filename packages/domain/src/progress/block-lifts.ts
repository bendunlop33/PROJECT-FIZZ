import type { EquipmentKind, Load, LoadConvention, SetExclusion, SetType, WeightUnit } from '@fizz/schemas';

import { formatNumber } from '../display';
import { isPlatesAddedKind } from '../plates-added';
import { KG_PER_LB, toScaled } from '../units';
import { estimateOneRepMax } from './e1rm';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Is each main lift going up across the block? Pure.
 *
 * - **Best set** of a lift in a week (`weekBestSet`): the heaviest working load, then the most reps at that load.
 *   Warm-ups and sets Ben marked as not counting (`Spotted`, `Pain`, `Form broke`, `Other equipment`) are left out.
 *   On an assisted machine less assistance is heavier; on a bodyweight-plus lift the added load is what is compared
 *   (bodyweight alone is added 0).
 * - **Up**: more load, or more reps at the same load, than the best so far. **Held**: equal. **Stalled**: no gain for
 *   2 or more trained weeks in a row. A deload week and a week with no session of the lift never count as a stall and
 *   never break one; they are skipped. The lead-in (week 0) is shown but never compared.
 * - **Δ** from week 1's best to the block's best: Est. 1RM % on loaded lifts (`+5%`), the added load on bodyweight-plus
 *   lifts (`+5 kg`), the assistance on assisted ones (`Assist −5 kg`). kg/lb and `ea` (per hand) stay explicit.
 */

export const BLOCK_LIFT_COPY = {
  stalled: 'Stalled',
  stalledWeeks: (n: number) => `Stalled ${String(n)} weeks`,
  leadIn: 'Lead-in',
  est: 'est.',
  ea: 'ea',
} as const;

/** How a lift's load is compared: a loaded lift, a bodyweight-plus lift (added load), an assisted one (less is heavier). */
export type BlockLoadKind = 'load' | 'bodyweight_plus' | 'assisted';

/** A completed set as the block reads it (a `ProgressSet`). */
export interface BlockSetInput {
  setType: SetType;
  load: Load | null;
  reps: number | null;
  exclusions?: readonly SetExclusion[] | undefined;
}

/** One week's best set of a lift. */
export interface BlockBestSet {
  kind: BlockLoadKind;
  /** As logged: total, per hand, stack, added or assistance; 0 for bodyweight alone. */
  value: number;
  unit: WeightUnit;
  convention: LoadConvention;
  reps: number;
  /** Est. 1RM (always an estimate, rule 6) in `unit`; null where it isn't meaningful (bodyweight, assisted, > 10 reps). */
  e1rm: number | null;
}

/** The lift's comparison kind from its sets' conventions (assisted, bodyweight-plus, else loaded). */
export function blockLoadKind(conventions: readonly LoadConvention[], equipmentKind: EquipmentKind | null = null): BlockLoadKind {
  if (conventions.includes('assistance')) return 'assisted';
  if (conventions.some((c) => c === 'bodyweight' || (c === 'added' && !isPlatesAddedKind(equipmentKind)))) return 'bodyweight_plus';
  return 'load';
}

const kgOf = (value: number, unit: WeightUnit): number => (unit === 'kg' ? value : value * KG_PER_LB);

/** The comparable strength of a set's load, scaled (heavier is larger): assistance counts negative. */
function strength(b: Pick<BlockBestSet, 'kind' | 'value' | 'unit'>): number {
  const kg = toScaled(kgOf(b.value, b.unit));
  return b.kind === 'assisted' ? -kg : kg;
}

/** Positive: `a` is the better set (load first, then reps at that load); 0: equal. */
export function compareBest(a: Pick<BlockBestSet, 'kind' | 'value' | 'unit' | 'reps'>, b: Pick<BlockBestSet, 'kind' | 'value' | 'unit' | 'reps'>): number {
  const d = strength(a) - strength(b);
  if (d !== 0) return d;
  return a.reps - b.reps;
}

function fitsKind(load: Load | null, kind: BlockLoadKind, equipmentKind: EquipmentKind | null): boolean {
  const c = load?.convention ?? null;
  switch (kind) {
    case 'assisted':
      return c === 'assistance';
    case 'bodyweight_plus':
      return c === null || c === 'bodyweight' || (c === 'added' && !isPlatesAddedKind(equipmentKind));
    case 'load':
      return c !== null && c !== 'assistance' && c !== 'bodyweight' && !(c === 'added' && !isPlatesAddedKind(equipmentKind));
  }
}

/** Working sets that count: not warm-ups, reps logged, nothing marked against them, of the lift's kind. */
export function countingSets<T extends BlockSetInput>(sets: readonly T[], kind: BlockLoadKind, equipmentKind: EquipmentKind | null = null): T[] {
  return sets.filter((s) => s.setType !== 'warmup' && s.reps !== null && Number.isInteger(s.reps) && s.reps >= 1 && (s.exclusions?.length ?? 0) === 0 && fitsKind(s.load, kind, equipmentKind));
}

/** A week's best set, or null with no counting set. */
export function weekBestSet(sets: readonly BlockSetInput[], kind: BlockLoadKind, equipmentKind: EquipmentKind | null = null, unit: WeightUnit = 'kg'): BlockBestSet | null {
  let best: BlockBestSet | null = null;
  for (const s of countingSets(sets, kind, equipmentKind)) {
    const load = s.load;
    const reps = s.reps ?? 0;
    const value = load === null || load.convention === 'bodyweight' ? 0 : load.value;
    const u = load?.unit ?? unit;
    const convention: LoadConvention = load?.convention ?? 'bodyweight';
    const est = kind === 'load' && load !== null ? estimateOneRepMax(load, reps, equipmentKind) : null;
    const b: BlockBestSet = { kind, value, unit: u, convention, reps, e1rm: est !== null && est.eligible ? est.value : null };
    if (best === null || compareBest(b, best) > 0) best = b;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Week by week

/** One block week of a lift, as the caller read it. */
export interface LiftWeekInput {
  /** 0: the lead-in; 1…N the block's weeks. */
  week: number;
  deload: boolean;
  /** The week has started (it is the current week or before). */
  reached: boolean;
  /** Its best set; null: no session of the lift that week. */
  best: BlockBestSet | null;
  /** Working sets of the lift that week. */
  sets: number;
}

/**
 * - `base`: the first trained week (week 1's best, or the first after it); `up`, `held`; `dip`: below the best so far,
 *   not (yet) a stall; `stalled`: in a run of 2+ trained weeks with no gain;
 * - `deload` (never a stall), `none` (no session of the lift), `todo` (not reached), `lead_in` (week 0, not compared).
 */
export type LiftWeekState = 'base' | 'up' | 'held' | 'dip' | 'stalled' | 'deload' | 'none' | 'todo' | 'lead_in';

export interface LiftWeek extends LiftWeekInput {
  state: LiftWeekState;
  /** 0…1 for the mini bar's height within this lift (trained weeks); null: no bar value. */
  level: number | null;
}

export type BlockDelta = { kind: 'pct'; value: number } | { kind: 'added'; value: number; unit: WeightUnit } | { kind: 'assist'; value: number; unit: WeightUnit } | { kind: 'reps'; value: number };

export type LiftBlockStatus = 'up' | 'held' | 'stalled' | 'started' | 'none';

export interface LiftBlockProgress {
  weeks: LiftWeek[];
  /** Week 1's best (or the first trained week's); null: not trained yet. */
  first: BlockBestSet | null;
  /** The block's best so far (trained, non-deload weeks); null: not trained yet. */
  best: BlockBestSet | null;
  /** The week `first` came from. */
  firstWeek: number | null;
  /** Trained weeks in a row, up to the latest, with no gain (2+: stalled). */
  noGainRun: number;
  status: LiftBlockStatus;
  delta: BlockDelta | null;
}

/** The change from `a` to `b` (same kind), or null when they can't be compared. */
export function blockDelta(a: BlockBestSet, b: BlockBestSet): BlockDelta | null {
  if (a.kind !== b.kind) return null;
  if (a.kind === 'bodyweight_plus' || a.kind === 'assisted') {
    const unit = b.unit;
    const av = a.unit === unit ? a.value : unit === 'kg' ? kgOf(a.value, a.unit) : a.value / KG_PER_LB;
    const d = Math.round((b.value - av) * 10) / 10;
    if (d === 0 && a.reps !== b.reps) return { kind: 'reps', value: b.reps - a.reps };
    return a.kind === 'assisted' ? { kind: 'assist', value: d, unit } : { kind: 'added', value: d, unit };
  }
  const x = a.e1rm !== null && b.e1rm !== null ? { from: kgOf(a.e1rm, a.unit), to: kgOf(b.e1rm, b.unit) } : { from: kgOf(a.value, a.unit), to: kgOf(b.value, b.unit) };
  if (x.from <= 0) return null;
  if (a.e1rm === null || b.e1rm === null) {
    // No estimate (more than 10 reps): the load's change; the same load is a reps change.
    if (toScaled(x.from) === toScaled(x.to) && a.reps !== b.reps) return { kind: 'reps', value: b.reps - a.reps };
  }
  return { kind: 'pct', value: Math.round(((x.to - x.from) / x.from) * 100) };
}

const TRAINED: ReadonlySet<LiftWeekState> = new Set(['base', 'up', 'held', 'dip', 'stalled']);

export function liftBlockProgress(input: readonly LiftWeekInput[]): LiftBlockProgress {
  const sorted = [...input].sort((a, b) => a.week - b.week);
  const states: LiftWeekState[] = [];
  let bestSoFar: BlockBestSet | null = null;
  let first: BlockBestSet | null = null;
  let firstWeek: number | null = null;
  let run: number[] = [];
  for (const [i, w] of sorted.entries()) {
    if (w.week === 0) {
      states[i] = 'lead_in';
      continue;
    }
    // A deload week reads as one whether reached or not (the dashed bar).
    if (w.deload) {
      states[i] = 'deload';
      continue;
    }
    if (!w.reached) {
      states[i] = 'todo';
      continue;
    }
    if (w.best === null) {
      states[i] = 'none';
      continue;
    }
    if (bestSoFar === null) {
      states[i] = 'base';
      bestSoFar = w.best;
      first = w.best;
      firstWeek = w.week;
      continue;
    }
    const c = compareBest(w.best, bestSoFar);
    if (c > 0) {
      states[i] = 'up';
      bestSoFar = w.best;
      run = [];
      continue;
    }
    states[i] = c === 0 ? 'held' : 'dip';
    run.push(i);
    // A run of 2+ weeks with no gain is a stall: every week of it reads stalled.
    if (run.length >= 2) for (const j of run) states[j] = 'stalled';
  }
  const trained = sorted.filter((_w, i) => TRAINED.has(states[i] ?? 'none'));
  // Bar heights: Est. 1RM when every trained week has one (so fewer reps at a load reads lower), else the load.
  const byEstimate = trained.every((w) => w.best?.e1rm != null);
  const barValue = (b: BlockBestSet) => (byEstimate && b.e1rm !== null ? kgOf(b.e1rm, b.unit) : strength(b));
  const values = trained.map((w) => (w.best === null ? 0 : barValue(w.best)));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const weeks: LiftWeek[] = sorted.map((w, i) => {
    const state = states[i] ?? 'none';
    const counts = w.best !== null && TRAINED.has(state);
    const level = !counts || w.best === null ? null : hi === lo ? 1 : (barValue(w.best) - lo) / (hi - lo);
    return { ...w, state, level };
  });
  const noGainRun = run.length;
  const lastTrained = [...weeks].reverse().find((w) => TRAINED.has(w.state));
  const status: LiftBlockStatus =
    first === null ? 'none' : noGainRun >= 2 ? 'stalled' : lastTrained?.state === 'base' ? 'started' : lastTrained?.state === 'up' ? 'up' : bestSoFar !== null && compareBest(bestSoFar, first) > 0 ? 'up' : 'held';
  const delta = first === null || bestSoFar === null || firstWeek === null || lastTrained?.week === firstWeek ? null : blockDelta(first, bestSoFar);
  return { weeks, first, best: bestSoFar, firstWeek, noGainRun, status, delta };
}

// ---------------------------------------------------------------------------
// Words

/** `100×6`, `32×8` (per hand: the `ea` goes at the line's end), `BW×8`, `BW+5×8`, `Assist 30×8`. */
export function bestSetText(b: Pick<BlockBestSet, 'kind' | 'value' | 'reps'>): string {
  const n = formatNumber(b.value);
  switch (b.kind) {
    case 'bodyweight_plus':
      return b.value === 0 ? `BW×${String(b.reps)}` : `BW+${n}×${String(b.reps)}`;
    case 'assisted':
      return `Assist ${n}×${String(b.reps)}`;
    case 'load':
      return `${n}×${String(b.reps)}`;
  }
}

const unitTail = (b: BlockBestSet): string => (b.kind === 'bodyweight_plus' && b.value === 0 ? '' : ` ${b.unit}`);

/** One set with its unit: `100×6 kg`, `34×8 kg ea`, `BW×8`, `BW+5×8 kg`. */
export function bestSetWithUnit(b: BlockBestSet): string {
  return `${bestSetText(b)}${unitTail(b)}${b.convention === 'per_hand' ? ` ${BLOCK_LIFT_COPY.ea}` : ''}`;
}

/**
 * `100×6 → 105×6 kg`, `32×8 → 34×8 kg ea`, `BW×8 → BW+5×8 kg`: the unit (and `ea`) once at the end when both sides
 * share it, else on each side.
 */
export function blockLineText(a: BlockBestSet, b: BlockBestSet): string {
  const tailA = unitTail(a);
  const tailB = unitTail(b);
  const ea = (x: BlockBestSet) => (x.convention === 'per_hand' ? ` ${BLOCK_LIFT_COPY.ea}` : '');
  const sameTail = (tailA === '' || tailB === '' || a.unit === b.unit) && ea(a) === ea(b);
  if (sameTail) return `${bestSetText(a)} → ${bestSetText(b)}${tailB === '' ? tailA : tailB}${ea(b)}`;
  return `${bestSetWithUnit(a)} → ${bestSetWithUnit(b)}`;
}

const signed = (v: number): string => (v > 0 ? `+${formatNumber(v)}` : v < 0 ? `−${formatNumber(-v)}` : '0');

/** `+5%`, `0%`, `−2%`, `+5 kg`, `Assist −5 kg`, `+2 reps`. Held reads with no `+`. */
export function blockDeltaText(d: BlockDelta): string {
  switch (d.kind) {
    case 'pct':
      return `${signed(d.value)}%`;
    case 'added':
      return `${signed(d.value)} ${d.unit}`;
    case 'assist':
      return `Assist ${signed(d.value)} ${d.unit}`;
    case 'reps':
      return `${signed(d.value)} ${Math.abs(d.value) === 1 ? 'rep' : 'reps'}`;
  }
}

/** Whether a delta is a gain (green); an assisted lift gains when assistance goes down. */
export function blockDeltaIsGain(d: BlockDelta): boolean {
  return d.kind === 'assist' ? d.value < 0 : d.value > 0;
}
