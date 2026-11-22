import { prefixTotals, stacksFor, type PlateKit, type PlateStack } from '../plate-path';
import { toScaled } from '../units';

/**
 * Plate-friendly warm-ups (WU8 amendment, Ben, 2 Nov; docs/training-guides/warm-up.md). Pure.
 *
 * "Warm ups should ideally be in multiples of 5kg … starting with 60kg, then 80kg then 100kg or 60 then 90 then 105 …
 * minimal unloading of weights is the goal." With `Simple warm-up weights` on, on a bar or plate-loaded machine:
 * - every warm-up is the bar plus whole 5 kg plates a side (10 kg steps; 20 lb steps in lb), no 2.5 or 1.25 kg plates;
 * - each warm-up only adds plates to the one before, and the working set only adds to the last warm-up: the warm-ups
 *   are the first few plates of one loading of the working set (`prefixTotals` of a stack), when such a ladder exists.
 *   Otherwise the same rules on simple loads alone (the plates then change somewhere; `Plates` shows how).
 *
 * `plateLadder` (WU4 for a bar, heavy band, not warmed, no WU11 short cut) replaces the 22 Oct table there:
 * - the first warm-up is the empty bar only when W ≤ 3 × the bar (60 kg on a 20 kg bar) and the lift isn't from the
 *   floor; otherwise the bar plus plates, at most the bar + 4 steps (60 kg; 125 lb) and at most ⅔ of W;
 * - then as few steps as the gap rule allows (no jump over `BAR_GAP`, 30 % of W, between steps or to W: Ben's 105 →
 *   60, 90): at least 2, 3 when R ≤ 3; a plate-friendly ladder may use one more, up to 3;
 * - the top step is within WU8 (c)–(d): 70–90 % of W, nearest 85 % (90 % when R ≤ 3), ties lighter;
 * - reps: the bar × 5, the first plates × 5, then × 3, the top × 2 (R ≤ 3: × 2 then a single).
 * `additivePass` moves a table's steps (WU4 warmed or short, WU5–WU7) to the nearest plate-friendly ones within one
 * grid step each, keeping their count, reps and WU8's checks, or leaves them.
 */

const EPS = 1e-6;

export interface LadderKit {
  kit: PlateKit;
  /** The simple grid's step (10 kg / 20 lb on bars, 10 kg / 20 lb on machines). */
  step: number;
  /** The lightest plate a warm-up uses. */
  minPlate: number;
  /** What the item makes (rule 4): every warm-up is one of these. */
  loads: readonly number[];
}

const onGrid = (v: number, base: number, step: number): boolean => {
  const n = (toScaled(v) - toScaled(base)) / toScaled(step);
  return n >= 0 && Number.isInteger(n);
};

function has(loads: readonly number[], v: number): boolean {
  return loads.some((l) => Math.abs(l - v) < EPS);
}

/** The warm-up points one loading of W gives: its first plates' totals that are simple, achievable and below W. */
function stackPoints(stack: PlateStack, W: number, k: LadderKit, withBase: boolean): number[] {
  const totals = prefixTotals(stack, k.kit);
  const out: number[] = [];
  for (let j = 0; j < totals.length - 1; j += 1) {
    const t = totals[j] ?? 0;
    if (j > 0 && (stack[j - 1] ?? 0) < k.minPlate - EPS) break;
    if (j === 0 && !withBase) continue;
    if (t >= W - EPS || !onGrid(t, k.kit.base, k.step) || (j > 0 && !has(k.loads, t))) continue;
    out.push(t);
  }
  return out;
}

/** Simple loads alone (no plate path): the grid loads the item makes below W. */
function gridPoints(W: number, k: LadderKit, withBase: boolean): number[] {
  const out = k.loads.filter((l) => l < W - EPS && onGrid(l, k.kit.base, k.step) && (withBase || l > k.kit.base + EPS));
  if (withBase && k.kit.base > 0 && !out.some((l) => Math.abs(l - k.kit.base) < EPS) && k.kit.base < W - EPS) out.unshift(k.kit.base);
  return [...new Set(out)].sort((a, b) => a - b);
}

export interface LadderRules {
  W: number;
  reps: number;
  /** The empty bar may be the first warm-up. */
  barOk: boolean;
  /** WU9: the first step's floor (plates-on start), when known. */
  firstAtLeast: number | null;
}

interface Pick {
  loads: number[];
  cost: number;
}

/**
 * (Ben, 2 Nov) The largest jump on a bar's plate ladder, as a share of W: 30 %, from Ben's own "60 then 90 then 105"
 * (60 → 90 is 29 % of 105). WU4's 25 % stays for every other ladder.
 */
export const BAR_GAP = 0.3;

/**
 * How strict a pass is: `strict` is WU8 (c)–(d) and WU4's gap rule; `top` drops (d)'s 70 % floor; `grid` also lets a
 * jump be 30 % of W rounded up to whole grid steps (a light lift, where no 10 kg ladder meets 25 %: 55 kg → 30, 40).
 */
type Pass = 'strict' | 'top' | 'grid';

/** The ladder's targets and limits for W. */
function limits(r: LadderRules, k: LadderKit, pass: Pass) {
  const W = r.W;
  const cap = 0.9 * W;
  const low = pass === 'strict' ? 0.7 * W : 0;
  const gap = pass === 'grid' ? Math.ceil((BAR_GAP * W) / k.step - EPS) * k.step : BAR_GAP * W;
  const startHi = Math.min(k.kit.base + 4 * k.step, (2 / 3) * W);
  const startTarget = r.barOk ? k.kit.base : Math.min(k.kit.base + 4 * k.step, 0.6 * W);
  const topTarget = Math.min(cap, (r.reps <= 3 ? 0.9 : 0.85) * W);
  return { cap, low, gap, startHi, startTarget, topTarget };
}

/** On equal cost: the lighter top step, then the bigger early jumps (a heavier step lower down). */
const preferred = (a: readonly number[], b: readonly number[]): boolean => {
  const top = (a[a.length - 1] ?? 0) - (b[b.length - 1] ?? 0);
  if (Math.abs(top) > EPS) return top < 0;
  for (let j = 0; j < a.length; j += 1) {
    const d = (a[j] ?? 0) - (b[j] ?? 0);
    if (Math.abs(d) > EPS) return d > 0;
  }
  return false;
};

/** The best `n`-step ladder from `points` (ascending) under WU4's rules, or null. */
function bestOf(points: readonly number[], n: number, r: LadderRules, k: LadderKit, pass: Pass): Pick | null {
  const L = limits(r, k, pass);
  const W = r.W;
  const base = k.kit.base;
  let best: Pick | null = null;
  const cur: number[] = [];
  const costOf = (xs: readonly number[]): number => {
    const first = xs[0] ?? 0;
    const top = xs[xs.length - 1] ?? 0;
    if (xs.length === 1) return Math.abs(top - L.topTarget);
    let c = Math.abs(first - L.startTarget) + Math.abs(top - L.topTarget);
    for (let j = 1; j < xs.length - 1; j += 1) c += Math.abs((xs[j] ?? 0) - (first + ((L.topTarget - first) * j) / (xs.length - 1)));
    return c;
  };
  const go = (from: number): void => {
    if (cur.length === n) {
      const top = cur[cur.length - 1] ?? 0;
      if (top > L.cap + EPS || top < L.low - EPS || W - top > L.gap + EPS) return;
      const cost = costOf(cur);
      if (best === null || cost < best.cost - EPS || (Math.abs(cost - best.cost) <= EPS && preferred(cur, best.loads))) best = { loads: [...cur], cost };
      return;
    }
    for (let j = from; j < points.length; j += 1) {
      const p = points[j] ?? 0;
      if (cur.length === 0) {
        const isBar = Math.abs(p - base) < EPS;
        if (isBar ? !r.barOk : p > L.startHi + EPS) continue;
        if (r.firstAtLeast !== null && p < r.firstAtLeast - EPS) continue;
      } else {
        const prev = cur[cur.length - 1] ?? 0;
        if (p - prev > L.gap + EPS) break;
      }
      if (p > L.cap + EPS) break;
      cur.push(p);
      go(j + 1);
      cur.pop();
    }
  };
  go(0);
  return best;
}

const MAX_STEPS = 6;

/**
 * Each plate a loading of W has beyond its fewest costs half a grid step (5 kg): a plate path never wins by piling on
 * small plates (a 90 kg row as 10 + 10 + 5 + 5 + 2.5 + 2.5 a side).
 */
function platePenalty(stack: PlateStack, fewest: number, k: LadderKit): number {
  return (Math.max(0, stack.length - fewest) * k.step) / 2;
}



/** Tier 1 (a plate path to W) at `n` steps: over W's loadings, the cheapest (plates included); ties the lighter ladder. */
function plateFriendly(n: number, r: LadderRules, k: LadderKit, pass: Pass): Pick | null {
  let best: Pick | null = null;
  const stacks = stacksFor(r.W, k.kit);
  const fewest = stacks[0]?.length ?? 0;
  for (const s of stacks) {
    const p = bestOf(stackPoints(s, r.W, k, r.barOk), n, r, k, pass);
    if (p === null) continue;
    const c = { loads: p.loads, cost: p.cost + platePenalty(s, fewest, k) };
    if (best === null || c.cost < best.cost - EPS || (Math.abs(c.cost - best.cost) <= EPS && preferred(c.loads, best.loads))) best = c;
  }
  return best;
}

/**
 * `plateLadder`: the WU4 ladder's loads for a bar (heavy band, not warmed), lightest first, or null when no ladder
 * fits (the 22 Oct table then applies).
 */
export function plateLadder(r: LadderRules, k: LadderKit): number[] | null {
  if (!(r.W > k.kit.base + EPS)) return null;
  const minN = r.reps <= 3 ? 3 : 2;
  const grid = gridPoints(r.W, k, r.barOk);
  for (const pass of ['strict', 'top', 'grid'] as const) {
    let n2: number | null = null;
    for (let n = minN; n <= MAX_STEPS && n2 === null; n += 1) if (bestOf(grid, n, r, k, pass) !== null) n2 = n;
    for (let n = minN - 1; n >= 1 && n2 === null; n -= 1) if (bestOf(grid, n, r, k, pass) !== null) n2 = n;
    if (n2 === null) continue;
    const nCap = n2 >= minN ? Math.max(n2, 3) : n2;
    for (let n = n2; n <= nCap; n += 1) {
      const t1 = plateFriendly(n, r, k, pass);
      if (t1 !== null) return t1.loads;
    }
    return bestOf(grid, n2, r, k, pass)?.loads ?? null;
  }
  return null;
}

/** `plateLadder`'s reps: the bar × 5, the first plates × 5, then × 3, the top × 2 (R ≤ 3: × 2 then a single). */
export function plateLadderReps(loads: readonly number[], base: number, reps: number): number[] {
  const plated = loads.filter((l) => l > base + EPS).length;
  let k = 0;
  return loads.map((l) => {
    if (l <= base + EPS) return 5;
    const j = k;
    k += 1;
    const fromTop = plated - 1 - j;
    if (reps <= 3 && plated >= 3) return fromTop === 0 ? 1 : fromTop === 1 ? 2 : j === 0 ? 5 : 3;
    if (fromTop === 0) return 2;
    return j === 0 ? 5 : 3;
  });
}

export interface PassRules {
  W: number;
  /** WU8 (c)'s cap on every step. */
  cap: number;
  /** WU4's gap rule (heavy band ladders). */
  gap: boolean;
  /** WU8 (f): a step before the top stays below 60 % of W (rep band). */
  repBand: boolean;
}

/**
 * `additivePass`: `loads` (ascending) moved, each by at most one grid step, to a ladder whose plates only go on, up to
 * W; the nearest such ladder, ties the fewer plates. Unchanged when they already are, or none fits WU8's checks.
 */
export function additivePass(loads: readonly number[], r: PassRules, k: LadderKit): number[] {
  if (loads.length === 0 || !(r.W > k.kit.base + EPS)) return [...loads];
  const W = r.W;
  const withBase = loads.some((l) => Math.abs(l - k.kit.base) < EPS);
  const topWas = loads[loads.length - 1] ?? 0;
  const keepLow = topWas >= 0.7 * W - EPS;
  const gapOk = (xs: readonly number[]): boolean => {
    const pts = [...xs, W];
    for (let j = 1; j < pts.length; j += 1) if ((pts[j] ?? 0) - (pts[j - 1] ?? 0) > 0.25 * W + EPS) return false;
    return true;
  };
  const checkGap = r.gap && gapOk(loads);
  const found: { best: { loads: number[]; cost: number } | null } = { best: null };
  const stacks = stacksFor(W, k.kit);
  const fewest = stacks[0]?.length ?? 0;
  for (const s of stacks) {
    const pts = stackPoints(s, W, k, withBase);
    const cur: number[] = [];
    const go = (i: number, cost: number): void => {
      if (found.best !== null && cost >= found.best.cost - EPS) return;
      if (i === loads.length) {
        const top = cur[cur.length - 1] ?? 0;
        if (top > r.cap + EPS || (keepLow && top < 0.7 * W - EPS)) return;
        if (r.repBand && cur.slice(0, -1).some((x) => x >= 0.6 * W - EPS)) return;
        if (checkGap && !gapOk(cur)) return;
        found.best = { loads: [...cur], cost };
        return;
      }
      const want = loads[i] ?? 0;
      const prev = cur[cur.length - 1] ?? -Infinity;
      for (const p of [...pts].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)) {
        if (p <= prev + EPS || Math.abs(p - want) > k.step + EPS) continue;
        cur.push(p);
        go(i + 1, cost + Math.abs(p - want));
        cur.pop();
      }
    };
    go(0, platePenalty(s, fewest, k));
  }
  return found.best === null ? [...loads] : found.best.loads;
}

/**
 * `warmPlateStep` (WU2/WU4 warmed on a bar, Ben 2 Nov): an already-warm heavy lift gets one step, the load nearest
 * 80 % of W within 70–90 %, plates only going on to W where a loading allows it (else a simple load alone), ties the
 * lighter; null when none fits.
 */
export function warmPlateStep(W: number, k: LadderKit): number | null {
  const ok = (p: number): boolean => p >= 0.7 * W - EPS && p <= 0.9 * W + EPS && p < W - EPS;
  const nearest = (pts: readonly number[]): number | null => {
    let best: number | null = null;
    for (const p of pts) if (ok(p) && (best === null || Math.abs(p - 0.8 * W) < Math.abs(best - 0.8 * W) - EPS)) best = p;
    return best;
  };
  const stacks = stacksFor(W, k.kit);
  const fewest = stacks[0]?.length ?? 0;
  let found: { load: number; cost: number } | null = null;
  for (const s of stacks) {
    const p = nearest(stackPoints(s, W, k, false));
    if (p === null) continue;
    const cost = Math.abs(p - 0.8 * W) + platePenalty(s, fewest, k);
    if (found === null || cost < found.cost - EPS || (Math.abs(cost - found.cost) <= EPS && p < found.load)) found = { load: p, cost };
  }
  return found?.load ?? nearest(gridPoints(W, k, false));
}
