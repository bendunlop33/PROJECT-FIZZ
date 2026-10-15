import type {
  EquipmentInstance,
  Load,
  LoadConvention,
  Mass,
  PlateCount,
  WeightUnit,
} from '@fizz/schemas';
import { stableStringify } from './stable';
import { convertMass, fromScaled, toScaled } from './units';

/**
 * `resistance`: a bigger number is harder (barbell, dumbbells, stacks).
 * `assistance`: a bigger number is easier (assisted pull-up/dip machines).
 */
export type LoadDirection = 'resistance' | 'assistance';

export interface AchievableLoads {
  equipmentId: string;
  unit: WeightUnit;
  convention: LoadConvention;
  direction: LoadDirection;
  /** Distinct achievable loads, ascending by number (not by difficulty). */
  loads: number[];
}

export function loadDirection(convention: LoadConvention): LoadDirection {
  return convention === 'assistance' ? 'assistance' : 'resistance';
}

/** Distinct sums from using up to `maxUses[i]` of `items[i]` (scaled integers). */
function boundedSubsetSums(items: readonly { scaled: number; maxUses: number }[]): Set<number> {
  let sums = new Set<number>([0]);
  for (const item of items) {
    if (item.maxUses <= 0 || item.scaled <= 0) continue;
    const next = new Set<number>();
    for (const s of sums) {
      for (let k = 0; k <= item.maxUses; k += 1) next.add(s + k * item.scaled);
    }
    sums = next;
  }
  return sums;
}

function plateUnits(plates: readonly PlateCount[], sides: 1 | 2) {
  return plates.map((p) => ({ scaled: toScaled(p.mass) * sides, maxUses: Math.floor(p.count / sides) }));
}

function bounded(eq: EquipmentInstance, scaled: Iterable<number>, physicalMin: number): number[] {
  const min = Math.max(physicalMin, eq.minLoad === undefined ? -Infinity : toScaled(eq.minLoad));
  const max = eq.maxLoad === undefined ? Infinity : toScaled(eq.maxLoad);
  return [...new Set(scaled)]
    .filter((s) => s >= min && s <= max)
    .sort((a, b) => a - b)
    .map(fromScaled);
}

/** Last element matching `pred`, scanning from the end (ES2022 has no `findLast`). */
function findLastAscending(values: readonly number[], pred: (v: number) => boolean): number | undefined {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (v !== undefined && pred(v)) return v;
  }
  return undefined;
}

interface CachedLoads {
  achievable: AchievableLoads;
  /** Same loads as scaled integers, ascending. */
  scaled: number[];
  scaledSet: Set<number>;
}

/**
 * Small cache of computed load lists. The key is the equipment's full content
 * (not only `id` + `version`), so an instance edited without a version bump can
 * never be served a stale list: a stale list could put a target above a new max.
 */
const CACHE_LIMIT = 64;
const loadCache = new Map<string, CachedLoads>();

function computeLoads(eq: EquipmentInstance): number[] {
  switch (eq.kind) {
    case 'barbell': {
      const bar = toScaled(eq.barMass);
      const sums = boundedSubsetSums(plateUnits(eq.plates, 2));
      return bounded(eq, [...sums].map((s) => s + bar), bar);
    }
    case 'plate_loaded_machine': {
      const sums = boundedSubsetSums(plateUnits(eq.plates, eq.loadingSides));
      return bounded(eq, sums, 0);
    }
    case 'dumbbells':
      return bounded(eq, eq.loads.map(toScaled), 0);
    case 'weight_stack': {
      const addOnSums = boundedSubsetSums(eq.addOns.map((a) => ({ scaled: toScaled(a), maxUses: 1 })));
      const all: number[] = [];
      for (const s of eq.stackLoads) for (const a of addOnSums) all.push(toScaled(s) + a);
      return bounded(eq, all, 0);
    }
    case 'assisted_stack':
      return bounded(eq, eq.assistanceLoads.map(toScaled), 0);
    case 'bodyweight_station':
      return [];
  }
}

function cachedLoads(eq: EquipmentInstance): CachedLoads {
  const key = stableStringify(eq);
  const hit = loadCache.get(key);
  if (hit) {
    // Refresh recency so the active session's equipment stays cached.
    loadCache.delete(key);
    loadCache.set(key, hit);
    return hit;
  }
  const loads = computeLoads(eq);
  const scaled = loads.map(toScaled);
  const entry: CachedLoads = {
    achievable: {
      equipmentId: eq.id,
      unit: eq.unit,
      convention: eq.loadConvention,
      direction: loadDirection(eq.loadConvention),
      loads,
    },
    scaled,
    scaledSet: new Set(scaled),
  };
  loadCache.set(key, entry);
  if (loadCache.size > CACHE_LIMIT) {
    const oldest = loadCache.keys().next().value;
    if (oldest !== undefined) loadCache.delete(oldest);
  }
  return entry;
}

/**
 * Finite list of loads the equipment can actually produce, bounded by its
 * min/max. Never extrapolates beyond inventory or a machine's maximum.
 * Memoised by equipment content; callers get their own copy of the list.
 */
export function getAchievableLoads(eq: EquipmentInstance): AchievableLoads {
  const { achievable } = cachedLoads(eq);
  return { ...achievable, loads: [...achievable.loads] };
}

/** `up`/`down`/`nearest` act on the number. `easier`/`harder` respect the load direction. */
export type RoundingPolicy = 'up' | 'down' | 'nearest' | 'easier' | 'harder';

export type RoundingFailure =
  | { reason: 'no_achievable_loads' }
  | { reason: 'convention_mismatch'; expected: LoadConvention; received: LoadConvention };

export type RoundingResult =
  | {
      ok: true;
      load: Load;
      /** True when the requested value was achievable as-is. */
      exact: boolean;
      /** Set when the request was outside the equipment's range and was clamped. */
      bounded: 'min' | 'max' | null;
      /** The request converted into the equipment's unit, if a conversion happened. */
      convertedRequest: Mass | null;
    }
  | ({ ok: false } & RoundingFailure);

function numericPolicy(policy: RoundingPolicy, direction: LoadDirection): 'up' | 'down' | 'nearest' {
  if (policy === 'easier') return direction === 'resistance' ? 'down' : 'up';
  if (policy === 'harder') return direction === 'resistance' ? 'up' : 'down';
  return policy;
}

/**
 * Round a requested load to one the equipment can make. The result is always
 * within the achievable list, so it never exceeds the maximum. Ties under
 * `nearest` go to the easier load.
 */
export function roundToAvailableLoad(
  target: Load,
  eq: EquipmentInstance,
  policy: RoundingPolicy,
): RoundingResult {
  if (target.convention !== eq.loadConvention) {
    return { ok: false, reason: 'convention_mismatch', expected: eq.loadConvention, received: target.convention };
  }
  const { achievable, scaled: scaledLoads, scaledSet } = cachedLoads(eq);
  const first = scaledLoads[0];
  const last = scaledLoads[scaledLoads.length - 1];
  if (first === undefined || last === undefined) return { ok: false, reason: 'no_achievable_loads' };

  const converted = target.unit === eq.unit ? null : convertMass(target, eq.unit);
  const requested = toScaled(converted ? converted.value : target.value);
  const mode = numericPolicy(policy, achievable.direction);

  const exactHit = scaledSet.has(requested);
  let chosen: number;
  let boundedTo: 'min' | 'max' | null = null;
  if (exactHit) {
    chosen = requested;
  } else if (requested > last) {
    chosen = last;
    boundedTo = 'max';
  } else if (requested < first) {
    chosen = first;
    boundedTo = 'min';
  } else {
    const above = scaledLoads.find((s) => s > requested) ?? last;
    const below = findLastAscending(scaledLoads, (s) => s < requested) ?? first;
    if (mode === 'up') chosen = above;
    else if (mode === 'down') chosen = below;
    else {
      const dAbove = above - requested;
      const dBelow = requested - below;
      if (dAbove === dBelow) chosen = achievable.direction === 'resistance' ? below : above;
      else chosen = dAbove < dBelow ? above : below;
    }
  }
  return {
    ok: true,
    load: { value: fromScaled(chosen), unit: eq.unit, convention: eq.loadConvention },
    exact: exactHit,
    bounded: boundedTo,
    convertedRequest: converted,
  };
}

/** True when the load is exactly achievable on this equipment in its own unit and convention. */
export function isLoadAchievable(load: Load, eq: EquipmentInstance): boolean {
  if (load.convention !== eq.loadConvention || load.unit !== eq.unit) return false;
  if (eq.kind === 'bodyweight_station') return load.value === 0;
  return cachedLoads(eq).scaledSet.has(toScaled(load.value));
}

export type StepResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'at_max' | 'at_min' | 'no_achievable_loads' };

/**
 * Next achievable number above (`increase`) or below (`decrease`) the current
 * value, for the stepper and keypad step keys (P5). On assisted machines
 * `increase` means more assistance (easier); the UI labels it so.
 */
export function stepLoad(current: number, eq: EquipmentInstance, step: 'increase' | 'decrease'): StepResult {
  const loads = cachedLoads(eq).scaled;
  if (loads.length === 0) return { ok: false, reason: 'no_achievable_loads' };
  const cur = toScaled(current);
  if (step === 'increase') {
    const next = loads.find((l) => l > cur);
    return next === undefined ? { ok: false, reason: 'at_max' } : { ok: true, value: fromScaled(next) };
  }
  const prev = findLastAscending(loads, (l) => l < cur);
  return prev === undefined ? { ok: false, reason: 'at_min' } : { ok: true, value: fromScaled(prev) };
}

export interface PlateSetup {
  ok: true;
  total: Mass;
  /** Bar mass for barbells; 0 for plate-loaded machines (added-plates convention). */
  base: Mass;
  sides: 1 | 2;
  /** Plates for ONE side, heaviest first. */
  perSide: PlateCount[];
}

export type PlateSetupFailure = {
  ok: false;
  reason: 'not_plate_loaded' | 'below_base' | 'above_max' | 'not_achievable';
  nearestBelow: number | null;
  nearestAbove: number | null;
};

/**
 * Balanced plate setup for a total load, using the fewest plates (ties go to
 * heavier plates). Returns a clear infeasible result rather than an
 * approximation, with the nearest achievable totals for the UI.
 */
export function buildPlateSetup(totalLoad: Mass, eq: EquipmentInstance): PlateSetup | PlateSetupFailure {
  if (eq.kind !== 'barbell' && eq.kind !== 'plate_loaded_machine') {
    return { ok: false, reason: 'not_plate_loaded', nearestBelow: null, nearestAbove: null };
  }
  const requested = toScaled(convertMass(totalLoad, eq.unit).value);
  const loads = cachedLoads(eq).scaled;
  const nearestBelow = findLastAscending(loads, (l) => l <= requested);
  const nearestAbove = loads.find((l) => l >= requested);
  const near = {
    nearestBelow: nearestBelow === undefined ? null : fromScaled(nearestBelow),
    nearestAbove: nearestAbove === undefined ? null : fromScaled(nearestAbove),
  };

  const sides = eq.kind === 'barbell' ? 2 : eq.loadingSides;
  const base = eq.kind === 'barbell' ? toScaled(eq.barMass) : 0;
  if (requested < base) return { ok: false, reason: 'below_base', ...near };
  const highest = loads[loads.length - 1];
  if (highest === undefined || requested > highest) return { ok: false, reason: 'above_max', ...near };
  if (!loads.includes(requested)) return { ok: false, reason: 'not_achievable', ...near };

  const perSideTarget = (requested - base) / sides;
  const plates = [...eq.plates]
    .map((p) => ({ scaled: toScaled(p.mass), available: Math.floor(p.count / sides) }))
    .filter((p) => p.available > 0)
    .sort((a, b) => b.scaled - a.scaled);

  // Fewest-plates search over the bounded inventory, heaviest plates first.
  const found: { counts: number[] | null; used: number } = { counts: null, used: Infinity };
  const counts = plates.map(() => 0);
  const search = (i: number, remaining: number, used: number): void => {
    if (used >= found.used) return;
    if (remaining === 0) {
      found.counts = [...counts];
      found.used = used;
      return;
    }
    const plate = plates[i];
    if (plate === undefined) return;
    const maxK = Math.min(plate.available, Math.floor(remaining / plate.scaled));
    for (let k = maxK; k >= 0; k -= 1) {
      counts[i] = k;
      search(i + 1, remaining - k * plate.scaled, used + k);
    }
    counts[i] = 0;
  };
  search(0, perSideTarget, 0);

  const best = found.counts;
  if (best === null) return { ok: false, reason: 'not_achievable', ...near };
  const perSide: PlateCount[] = [];
  plates.forEach((p, i) => {
    const count = best[i] ?? 0;
    if (count > 0) perSide.push({ mass: fromScaled(p.scaled), count });
  });
  return {
    ok: true,
    total: { value: fromScaled(requested), unit: eq.unit },
    base: { value: fromScaled(base), unit: eq.unit },
    sides,
    perSide,
  };
}

/** Compare loads by difficulty: negative if `a` is easier than `b`. Same unit/convention assumed. */
export function compareDifficulty(a: number, b: number, direction: LoadDirection): number {
  const d = toScaled(a) - toScaled(b);
  return direction === 'resistance' ? d : -d;
}

/** Achievable loads ordered from easiest to hardest. */
export function loadsByDifficulty(achievable: AchievableLoads): number[] {
  return achievable.direction === 'resistance' ? [...achievable.loads] : [...achievable.loads].reverse();
}
