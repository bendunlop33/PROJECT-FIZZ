import type { EquipmentInstance, WeightUnit } from '@fizz/schemas';
import { isBarLoaded } from './equipment';
import { stableStringify } from './stable';
import { fromScaled, toScaled } from './units';

/**
 * Plate paths (Ben, 2 Nov: "minimal unloading of weights is the goal"; "going from 100 kg to 97.5 on any set is a
 * hassle unless built them up properly"). Pure.
 *
 * A bar's (or plate-loaded machine's) loading is a **stack** per side: plates from the inside out, heaviest inside
 * (never a heavier plate outside a lighter one, except among the small change plates, 5 kg and under). Going up, plates go on the outside; coming down, the outermost come
 * off. `planPlateChain` picks one stack per set for a run of sets (warm-ups, then working sets) so that, in order:
 * 1. **hassle** is least: plates taken off on the way up, or put on on the way down (or any change between equal loads);
 * 2. then **moves** (plates on or off in all);
 * 3. then the fewest plates (the first candidate, `stacksFor`'s order).
 * So 60 → 80 → 100 → 90 kg on a 20 kg bar loads 100 as 20 + 10 + 5 + 5 a side: every warm-up only adds, and the
 * back-off only takes the outer 5s off. Every stack is made from the gym's real inventory (rule 4).
 */

export interface PlateKit {
  unit: WeightUnit;
  /** The bar's own mass for bars; 0 for plate-loaded and Smith machines (plates added, ADR 0030). */
  base: number;
  sides: 1 | 2;
  /** Plates each side can use (count per side), heaviest first. */
  plates: readonly { mass: number; perSide: number }[];
}

/** Plates on one side, inside → outside, never heavier further out (change plates in any order, `CHANGE_PLATE_MAX`). */
export type PlateStack = readonly number[];

/** The item's plate kit: bars (total load) and plate-loaded or Smith machines (plates added); null for anything else. */
export function plateKitOf(eq: EquipmentInstance | null | undefined): PlateKit | null {
  if (eq == null) return null;
  if (!isBarLoaded(eq) && eq.kind !== 'plate_loaded_machine' && eq.kind !== 'smith_machine') return null;
  const sides: 1 | 2 = eq.kind === 'plate_loaded_machine' ? eq.loadingSides : 2;
  const plates = eq.plates
    .map((p) => ({ mass: p.mass, perSide: Math.floor(p.count / sides) }))
    .filter((p) => p.mass > 0 && p.perSide > 0)
    .sort((a, b) => b.mass - a.mass);
  return { unit: eq.unit, base: isBarLoaded(eq) ? eq.barMass : 0, sides, plates };
}

/** At most this many plates a side in a candidate stack (a real setup has far fewer). */
const MAX_STACK_PLATES = 10;
/** At most this many heaviest-inside stacks per load (fewest plates first). */
const MAX_STACKS = 128;
/** Change plates are reordered only on stacks within this many plates of the fewest… */
const PERMUTE_WITHIN = 4;
/** …and at most this many reordered stacks per load. */
const MAX_REORDERED = 160;
/**
 * Change plates (5 kg and lighter; 10 lb and lighter) sit outside every bigger plate, but in any order among
 * themselves: 97.5 as 20 + 15 + 1.25 + 2.5 a side, so 92.5 is the 2.5s off; 107.5 as 20 + 10 + 5 + 2.5 + 1.25 + 5,
 * so 97.5 is the outer 5s off (Ben, 2 Nov: "unless the 1.25s were loaded on the outside").
 */
export const CHANGE_PLATE_MAX: Record<WeightUnit, number> = { kg: 5, lb: 10 };
/** The enumeration's node budget per load. */
const MAX_NODES = 40_000;
const CACHE_LIMIT = 256;
const stackCache = new Map<string, PlateStack[]>();
const chainCache = new Map<string, PlateChain>();

function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = make();
  cache.set(key, v);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return v;
}

/** Total load of a stack on this kit. */
export function stackTotal(stack: PlateStack, kit: PlateKit): number {
  return fromScaled(toScaled(kit.base) + kit.sides * stack.reduce((n, m) => n + toScaled(m), 0));
}

/** The totals on the way up a stack: the bare base, then after each plate (the last is the stack's total). */
export function prefixTotals(stack: PlateStack, kit: PlateKit): number[] {
  const out = [kit.base];
  let side = 0;
  for (const m of stack) {
    side += toScaled(m);
    out.push(fromScaled(toScaled(kit.base) + kit.sides * side));
  }
  return out;
}

/**
 * Every way (bounded) to make `total` on this kit: the heaviest-inside stacks first (fewest plates, then heavier plates
 * first), then, for those near the fewest plates, their change plates in other orders (`CHANGE_PLATE_MAX`). Empty when
 * it can't be made. Memoised by kit and total.
 */
export function stacksFor(total: number, kit: PlateKit): PlateStack[] {
  return remember(stackCache, `${stableStringify(kit)}|${String(toScaled(total))}`, () => enumerate(total, kit));
}

function enumerate(total: number, kit: PlateKit): PlateStack[] {
  const extra = toScaled(total) - toScaled(kit.base);
  if (extra < 0 || extra % kit.sides !== 0) return [];
  const target = extra / kit.sides;
  if (target === 0) return [[]];
  const plates = kit.plates.map((p) => ({ m: toScaled(p.mass), n: p.perSide }));
  const out: number[][] = [];
  const cur: number[] = [];
  let nodes = 0;
  const go = (i: number, left: number): void => {
    nodes += 1;
    if (nodes > MAX_NODES || out.length >= MAX_STACKS * 8) return;
    if (left === 0) {
      out.push([...cur]);
      return;
    }
    const p = plates[i];
    if (p === undefined || cur.length >= MAX_STACK_PLATES) return;
    const most = Math.min(p.n, Math.floor(left / p.m), MAX_STACK_PLATES - cur.length);
    for (let k = most; k >= 0; k -= 1) {
      for (let j = 0; j < k; j += 1) cur.push(p.m);
      go(i + 1, left - k * p.m);
      cur.length -= k;
    }
  };
  go(0, target);
  out.sort((a, b) => a.length - b.length || lexDesc(a, b));
  const canonical = out.slice(0, MAX_STACKS);
  // Then, for stacks within a few plates of the fewest, their change plates in their other orders.
  const small = toScaled(CHANGE_PLATE_MAX[kit.unit]);
  const fewest = canonical[0]?.length ?? 0;
  const seen = new Set(canonical.map((s) => s.join(',')));
  const reordered: number[][] = [];
  for (const s of canonical) {
    if (s.length > fewest + PERMUTE_WITHIN || reordered.length >= MAX_REORDERED) break;
    const k = s.findIndex((m) => m <= small);
    if (k < 0) continue;
    for (const t of orders(s.slice(k))) {
      const st = [...s.slice(0, k), ...t];
      const key = st.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      reordered.push(st);
    }
  }
  return [...canonical, ...reordered.slice(0, MAX_REORDERED)].map((s) => s.map(fromScaled));
}

/** The distinct orders of a few change plates, the given (heaviest-first) order first. */
function orders(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [[...xs]];
  if (xs.length > 5) return [[...xs]];
  const out: number[][] = [];
  const seen = new Set<string>();
  const used = xs.map(() => false);
  const cur: number[] = [];
  const go = (): void => {
    if (cur.length === xs.length) {
      const key = cur.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        out.push([...cur]);
      }
      return;
    }
    for (let j = 0; j < xs.length; j += 1) {
      if (used[j] === true) continue;
      used[j] = true;
      cur.push(xs[j] ?? 0);
      go();
      cur.pop();
      used[j] = false;
    }
  };
  go();
  return out;
}

/** Heavier plates first (inside out). */
function lexDesc(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function commonPrefix(a: PlateStack, b: PlateStack): number {
  let k = 0;
  while (k < a.length && k < b.length && Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-9) k += 1;
  return k;
}

/** One change of stacks: plates off (the outermost first) and on. */
export interface PlateChange {
  off: number;
  on: number;
  /** Plates off on the way up, on on the way down, or any change between equal loads. */
  hassle: number;
}

/** The change from `a` (total `ta`) to `b` (total `tb`). */
export function plateChange(a: PlateStack, ta: number, b: PlateStack, tb: number): PlateChange {
  const k = commonPrefix(a, b);
  const off = a.length - k;
  const on = b.length - k;
  const up = tb > ta + 1e-9;
  const down = tb < ta - 1e-9;
  return { off, on, hassle: up ? off : down ? on : off + on };
}

export interface PlateChain {
  /** One stack per load (null: this kit can't make it; the chain starts again after it). */
  stacks: (PlateStack | null)[];
  /** The changes' total hassle and plates moved (see `plateChange`). */
  hassle: number;
  moves: number;
}

/**
 * `planPlateChain`: one stack per load in order (warm-ups, then working sets), least hassle, then fewest moves, then
 * fewest plates. Loads the kit can't make get null and break the chain (the next set loads from scratch).
 */
export function planPlateChain(loads: readonly (number | null)[], kit: PlateKit): PlateChain {
  return remember(chainCache, `${stableStringify(kit)}|${loads.map((l) => (l === null ? 'x' : String(toScaled(l)))).join(',')}`, () => chainOf(loads, kit));
}

interface Cell {
  hassle: number;
  moves: number;
  from: number;
}

const better = (a: Cell, b: Cell | null): boolean => b === null || a.hassle < b.hassle || (a.hassle === b.hassle && a.moves < b.moves);

function chainOf(loads: readonly (number | null)[], kit: PlateKit): PlateChain {
  const stacks: (PlateStack | null)[] = loads.map(() => null);
  let hassle = 0;
  let moves = 0;
  // Runs of makeable loads, each planned on its own.
  let k = 0;
  while (k < loads.length) {
    const start = k;
    const cands: PlateStack[][] = [];
    while (k < loads.length) {
      const l = loads[k];
      const c = l === null || l === undefined ? [] : stacksFor(l, kit);
      if (c.length === 0) break;
      cands.push(c);
      k += 1;
    }
    if (cands.length > 0) {
      const run = runOf(loads.slice(start, start + cands.length) as number[], cands);
      run.stacks.forEach((s, j) => (stacks[start + j] = s));
      hassle += run.hassle;
      moves += run.moves;
    }
    if (k === start) k += 1;
  }
  return { stacks, hassle, moves };
}

function runOf(loads: readonly number[], cands: readonly PlateStack[][]): { stacks: PlateStack[]; hassle: number; moves: number } {
  // Viterbi over candidate stacks; ties keep the earlier candidate (fewer plates).
  let prev: Cell[] = (cands[0] ?? []).map((s) => ({ hassle: 0, moves: s.length, from: -1 }));
  const back: Cell[][] = [prev];
  for (let i = 1; i < cands.length; i += 1) {
    const here = cands[i] ?? [];
    const before = cands[i - 1] ?? [];
    const ta = loads[i - 1] ?? 0;
    const tb = loads[i] ?? 0;
    const next: Cell[] = here.map((b) => {
      let best: Cell = { hassle: Infinity, moves: Infinity, from: -1 };
      for (let ai = 0; ai < before.length; ai += 1) {
        const a = before[ai];
        const p = prev[ai];
        if (a === undefined || p === undefined) continue;
        const c = plateChange(a, ta, b, tb);
        const cell = { hassle: p.hassle + c.hassle, moves: p.moves + c.off + c.on, from: ai };
        if (better(cell, best)) best = cell;
      }
      return best;
    });
    back.push(next);
    prev = next;
  }
  let end = 0;
  for (let j = 1; j < prev.length; j += 1) {
    const c = prev[j];
    const e = prev[end];
    if (c !== undefined && e !== undefined && better(c, e)) end = j;
  }
  const out: PlateStack[] = [];
  let j = end;
  for (let i = cands.length - 1; i >= 0; i -= 1) {
    out.unshift(cands[i]?.[j] ?? []);
    j = back[i]?.[j]?.from ?? 0;
  }
  const last = prev[end];
  return { stacks: out, hassle: last?.hassle ?? 0, moves: last?.moves ?? 0 };
}

// ---------------------------------------------------------------------------
// Drops between working sets

export interface StripDropInput {
  /** The drop's load as worked out (its reps and RPE, the D4 band, ~78 % for a drop), already rounded down on the item. */
  value: number;
  /** The sets before it, in order (warm-ups included); the last is the set it drops from. */
  before: readonly (number | null)[];
  kit: PlateKit;
  /** What the item makes, ascending (rule 4). */
  loads: readonly number[];
}

/** How far below the worked-out load a plate-friendly drop may go: 5 % of it, or one step of the item when bigger. */
export const STRIP_TOLERANCE = 0.05;

/**
 * `stripFriendlyDrop` (Ben, 2 Nov): a lighter working set (a back-off after the top set, a drop set) is planned at a
 * load reached by taking the outer plates off the set before, where one is near. In order:
 * 1. the worked-out load, when some loading of the sets so far reaches it by taking plates off (the top set is loaded
 *    with the smaller plates outermost, `planPlateChain`);
 * 2. else the heaviest load within `STRIP_TOLERANCE` (or one item step) below it that does;
 * 3. else the worked-out load as it was (the plates change; `Plates` shows how).
 * Never heavier than the worked-out load (so never past its reps and RPE, a pain hold or the item's max: rule 4).
 */
export function stripFriendlyDrop(i: StripDropInput): number {
  const prev = [...i.before].reverse().find((l): l is number => l !== null) ?? null;
  if (prev === null || !(i.value < prev - 1e-9)) return i.value;
  const hassleOf = (v: number): number => planPlateChain([...i.before, v], i.kit).hassle;
  const own = hassleOf(i.value);
  const base = planPlateChain(i.before, i.kit).hassle;
  if (own <= base) return i.value;
  const below = [...i.loads].filter((l) => l < i.value - 1e-9).pop();
  const tol = Math.max(STRIP_TOLERANCE * i.value, below === undefined ? 0 : i.value - below);
  // The heaviest below it whose plates only come off; a load that only swaps fewer plates isn't one.
  for (const l of [...i.loads].reverse()) {
    if (l >= i.value - 1e-9) continue;
    if (l < i.value - tol - 1e-9) break;
    if (hassleOf(l) <= base) return l;
  }
  return i.value;
}

// ---------------------------------------------------------------------------
// Showing the plates

/** A set's place in its exercise's run of sets, for `platesInChain`: each set's load (null: none, or not this item's). */
export interface PlateChainContext {
  loads: readonly ({ value: number; unit: WeightUnit; convention: string } | null)[];
  at: number;
}

/**
 * `platesInChain` (Ben, 2 Nov): the plates a side for `value` as loaded in its run of sets (`planPlateChain`), so the
 * order matches how the bar is built up and taken down: smaller plates outermost when they come off next. Null
 * when the item isn't plate-loaded, the context doesn't hold this load, or the kit can't make it.
 */
export function platesInChain(value: number, eq: EquipmentInstance, chain: PlateChainContext | null | undefined): PlateStack | null {
  const kit = plateKitOf(eq);
  if (kit === null || chain == null) return null;
  const loads = chain.loads.map((l) => (l !== null && l.unit === eq.unit && l.convention === eq.loadConvention ? l.value : null));
  if (chain.at < 0 || chain.at >= loads.length) return null;
  loads[chain.at] = value;
  return planPlateChain(loads, kit).stacks[chain.at] ?? null;
}
