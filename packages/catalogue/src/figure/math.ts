/** Small 2D maths for the figure rig. World units are body heights (H = 1), y up. */

export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerpVec = (a: Vec, b: Vec, s: number): Vec => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
export const perpCcw = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;

/**
 * Unit vector for a limb angle measured from straight down, positive towards
 * the front (+x when the figure faces right). 0 = hanging, 90 = forward, 180 = up.
 */
export const fromDown = (angleDeg: number): Vec => ({ x: Math.sin(rad(angleDeg)), y: -Math.cos(rad(angleDeg)) });

/** Unit vector for a trunk angle measured from straight up, positive leaning forward. */
export const fromUp = (angleDeg: number): Vec => ({ x: Math.sin(rad(angleDeg)), y: Math.cos(rad(angleDeg)) });

/** Inverse of `fromDown`: the from-down angle of a direction, in (-180, 180]. */
export const angleFromDown = (d: Vec): number => deg(Math.atan2(d.x, -d.y));

/** Wrap to (-180, 180]. */
export function wrapDeg(a: number): number {
  let r = a % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

export const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * `smooth` is not a per-segment curve: it is a C2 cubic spline through the
 * keyframes (continuous velocity and acceleration at mid-movement keys, no
 * overshoot), with zero velocity at holds and turning points. In a
 * `motion: "phases"` guide every channel shares one minimum-jerk progress per
 * phase instead (ADR 0015), and a channel that turns back at a pass key keeps
 * its acceleration continuous through the turn (`phaseTurnSlopes`, ADR 0017;
 * projection channels excepted). See `keyframes.ts`.
 */
export const EASES = ['linear', 'inSine', 'outSine', 'inOutSine', 'inOutCubic', 'smooth'] as const;
export type Ease = (typeof EASES)[number];

export function ease(name: Exclude<Ease, 'smooth'>, s: number): number {
  const x = clamp(s, 0, 1);
  switch (name) {
    case 'linear':
      return x;
    case 'inSine':
      return 1 - Math.cos((x * Math.PI) / 2);
    case 'outSine':
      return Math.sin((x * Math.PI) / 2);
    case 'inOutSine':
      return -(Math.cos(Math.PI * x) - 1) / 2;
    case 'inOutCubic':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

/** Shortest distance from point `p` to segment `a`–`b`. */
export function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 === 0) return dist(p, a);
  const s = clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2, 0, 1);
  return dist(p, lerpVec(a, b, s));
}

/** Point-in-convex-or-simple-polygon test (even-odd rule). */
export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Gap between two closed polygons: 0 when they touch or overlap (an edge
 * crosses, or one has a vertex inside the other), otherwise the shortest
 * vertex-to-edge distance. Used for the muscle-definition grooves (guides v2 §4.11.3).
 */
export function polygonGap(a: readonly Vec[], b: readonly Vec[]): number {
  if (a.length < 3 || b.length < 3) return Infinity;
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const a0 = a[i] as Vec;
    const a1 = a[(i + 1) % a.length] as Vec;
    for (let j = 0; j < b.length; j += 1) {
      const b0 = b[j] as Vec;
      const b1 = b[(j + 1) % b.length] as Vec;
      const d1 = (a1.x - a0.x) * (b0.y - a0.y) - (a1.y - a0.y) * (b0.x - a0.x);
      const d2 = (a1.x - a0.x) * (b1.y - a0.y) - (a1.y - a0.y) * (b1.x - a0.x);
      const d3 = (b1.x - b0.x) * (a0.y - b0.y) - (b1.y - b0.y) * (a0.x - b0.x);
      const d4 = (b1.x - b0.x) * (a1.y - b0.y) - (b1.y - b0.y) * (a1.x - b0.x);
      if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
      best = Math.min(best, pointSegmentDistance(a0, b0, b1), pointSegmentDistance(b0, a0, a1));
    }
  }
  return best;
}

/** Axis-aligned bounds of a point list. */
export function bounds(pts: readonly Vec[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Whether two closed polygons come within `d` of each other (or overlap). Cheaper than `polygonGap` when they are far apart. */
export function polygonsWithin(a: readonly Vec[], b: readonly Vec[], d: number): boolean {
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.minX > bb.maxX + d || bb.minX > ba.maxX + d || ba.minY > bb.maxY + d || bb.minY > ba.maxY + d) return false;
  return polygonGap(a, b) < d;
}

/** Depth of `p` inside a polygon (distance to the nearest edge), or 0 when outside. */
export function penetrationDepth(p: Vec, poly: readonly Vec[]): number {
  if (!pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, pointSegmentDistance(p, a, b));
  }
  return best;
}

/** Cubic Hermite between p0 and p1 over a span `h`, with end slopes m0 and m1 (value per unit time). */
export function hermite(p0: number, p1: number, m0: number, m1: number, s: number, h: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1;
}

/**
 * Monotone (Fritsch–Carlson style) slope at a keyframe from the slopes of the
 * segments either side: zero at a turning point, never more than 3× either
 * side's slope, so the curve doesn't overshoot the keyframe values.
 */
export function monotoneSlope(left: number | null, right: number | null, hLeft: number, hRight: number): number {
  if (left === null || right === null) return 0;
  if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) return 0;
  const m = (left * hRight + right * hLeft) / (hLeft + hRight);
  const cap = 3 * Math.min(Math.abs(left), Math.abs(right));
  return Math.sign(m) * Math.min(Math.abs(m), cap);
}

/** Knot slopes, plus where the result gives up continuity. */
export interface GuardedSlopes {
  slopes: number[];
  /**
   * Knots whose solved slope the guard changed (zeroed or capped). Their
   * slope is fixed at the clipped value, so velocity stays continuous there
   * but acceleration may jump.
   */
  clipped: number[];
  /**
   * Interior knots where acceleration may jump: clipped knots and fixed ones
   * (`splineSlopes` decouples the two sides of every fixed knot;
   * `phaseTurnSlopes` only those its constraints leave no room for).
   */
  kinks: number[];
}

/**
 * Does acceleration stay continuous at a knot? The C2 condition
 * mL/hL + 2m(1/hL + 1/hR) + mR/hR = 3(dL/hL + dR/hR), to rounding.
 */
function c2Holds(hl: number, hr: number, dl: number, dr: number, ml: number, m: number, mr: number): boolean {
  const terms = [ml / hl, 2 * m * (1 / hl + 1 / hr), mr / hr];
  const rhs = 3 * (dl / hl + dr / hr);
  const lhs = terms.reduce((a, b) => a + b, 0);
  return Math.abs(lhs - rhs) <= 1e-9 * Math.max(1, Math.abs(rhs), ...terms.map(Math.abs));
}

/**
 * Fritsch–Carlson guard for a solved slope `m` at a knot whose neighbouring
 * secants are `sides`: 0 where a side is flat or disagrees in sign, otherwise
 * at most 3× the smaller secant. Every segment whose end slopes pass this is
 * monotone, so it never leaves its knot values.
 */
function guardSlope(m: number, sides: readonly number[]): number {
  if (sides.some((s) => s === 0 || Math.sign(s) !== Math.sign(m))) return 0;
  const cap = 3 * Math.min(...sides.map(Math.abs));
  return Math.sign(m) * Math.min(Math.abs(m), cap);
}

/**
 * Slopes for a C2 cubic spline through (x[i], y[i]): continuous velocity and
 * acceleration at every free knot (ADR 0015). For per-channel keyframe
 * interpolation; `monotoneSlope` stays for body-width profiles.
 *
 * - `fixed[i]`: a slope to keep (0 at holds and turning points), or null to solve.
 * - Open spline: a free end has no acceleration (the natural end condition).
 * - `cyclic`: knot n − 1 is knot 0 again (`y[n−1] = y[0]`, `fixed[0]` applies); the spline wraps.
 *
 * Guard (Fritsch–Carlson): a free knot's slope becomes 0 where it disagrees in
 * sign with a neighbouring secant (or one is flat), and is capped at 3× the
 * smaller secant, so no segment overshoots its knot values. A clipped knot
 * keeps C1 but loses C2. A fixed knot decouples the two sides, so acceleration
 * generally jumps there too; `phaseTurnSlopes` keeps it continuous (ADR 0017).
 */
export function splineSlopes(x: readonly number[], y: readonly number[], fixed: readonly (number | null)[], cyclic: boolean): number[] {
  return guardedSplineSlopes(x, y, fixed, cyclic).slopes;
}

/** `splineSlopes`, also reporting which knots the guard clipped. */
function guardedSplineSlopes(x: readonly number[], y: readonly number[], fixed: readonly (number | null)[], cyclic: boolean): GuardedSlopes {
  const n = x.length;
  if (n < 2) return { slopes: Array.from({ length: n }, () => 0), clipped: [], kinks: [] };
  const K = cyclic ? n - 1 : n;
  const h = Array.from({ length: n - 1 }, (_, i) => (x[i + 1] ?? 0) - (x[i] ?? 0));
  const d = h.map((hi, i) => (hi > 0 ? ((y[i + 1] ?? 0) - (y[i] ?? 0)) / hi : 0));
  // Knot j's neighbouring segments (segment i runs from knot i to knot i + 1; in a cycle knot n − 1 is knot 0).
  const leftSeg = (j: number): number => (j > 0 ? j - 1 : cyclic ? n - 2 : -1);
  const rightSeg = (j: number): number => (j < n - 1 ? j : -1);
  const knot = (i: number): number => (cyclic && i === n - 1 ? 0 : i);
  const A = Array.from({ length: K }, () => new Array<number>(K + 1).fill(0));
  const free: boolean[] = [];
  for (let j = 0; j < K; j += 1) {
    const row = A[j] as number[];
    const L = leftSeg(j);
    const R = rightSeg(j);
    const hl = L >= 0 ? (h[L] ?? 0) : 0;
    const hr = R >= 0 ? (h[R] ?? 0) : 0;
    const f = fixed[j] ?? null;
    const degenerate = (L >= 0 && !(hl > 0)) || (R >= 0 && !(hr > 0)) || (L < 0 && R < 0) || (cyclic && K < 2);
    if (f !== null || degenerate) {
      row[j] = 1;
      row[K] = f ?? 0;
      free.push(false);
      continue;
    }
    free.push(true);
    if (L < 0) {
      // Natural start: 2·m0 + m1 = 3·d0.
      row[j] = (row[j] ?? 0) + 2 / hr;
      row[knot(R + 1)] = (row[knot(R + 1)] ?? 0) + 1 / hr;
      row[K] = (3 * (d[R] ?? 0)) / hr;
    } else if (R < 0) {
      // Natural end: m(n−2) + 2·m(n−1) = 3·d(n−2).
      row[knot(L)] = (row[knot(L)] ?? 0) + 1 / hl;
      row[j] = (row[j] ?? 0) + 2 / hl;
      row[K] = (3 * (d[L] ?? 0)) / hl;
    } else {
      row[knot(L)] = (row[knot(L)] ?? 0) + 1 / hl;
      row[j] = (row[j] ?? 0) + 2 * (1 / hl + 1 / hr);
      row[knot(R + 1)] = (row[knot(R + 1)] ?? 0) + 1 / hr;
      row[K] = 3 * ((d[L] ?? 0) / hl + (d[R] ?? 0) / hr);
    }
  }
  // Dense Gauss–Jordan with partial pivoting: at most 16 keys, solved once per channel and cached.
  for (let c = 0; c < K; c += 1) {
    let piv = c;
    for (let r = c + 1; r < K; r += 1) if (Math.abs(A[r]?.[c] ?? 0) > Math.abs(A[piv]?.[c] ?? 0)) piv = r;
    const pr = A[piv] as number[];
    A[piv] = A[c] as number[];
    A[c] = pr;
    const pv = pr[c] ?? 0;
    if (Math.abs(pv) < 1e-15) continue;
    for (let r = 0; r < K; r += 1) {
      const row = A[r] as number[];
      if (r === c || row[c] === 0) continue;
      const k = (row[c] ?? 0) / pv;
      for (let q = c; q <= K; q += 1) row[q] = (row[q] ?? 0) - k * (pr[q] ?? 0);
    }
  }
  const m = A.map((row, j) => (Math.abs(row[j] ?? 0) < 1e-15 ? 0 : (row[K] ?? 0) / (row[j] ?? 1)));
  const clipped: number[] = [];
  for (let j = 0; j < K; j += 1) {
    if (free[j] !== true) continue;
    const sides = [leftSeg(j), rightSeg(j)].filter((i) => i >= 0).map((i) => d[i] ?? 0);
    const mj = m[j] ?? 0;
    const g = guardSlope(mj, sides);
    if (g !== mj) clipped.push(j);
    m[j] = g;
  }
  // Kinks: interior knots where the final slopes break C2 (fixed knots, clipped ones and their neighbours).
  const kinks: number[] = [];
  for (let j = 0; j < K; j += 1) {
    const L = leftSeg(j);
    const R = rightSeg(j);
    if (L < 0 || R < 0) continue;
    const ok = c2Holds(h[L] ?? 1, h[R] ?? 1, d[L] ?? 0, d[R] ?? 0, m[knot(L)] ?? 0, m[j] ?? 0, m[knot(R + 1)] ?? 0);
    if (!ok) kinks.push(j);
  }
  return { slopes: Array.from({ length: n }, (_, i) => m[knot(i)] ?? 0), clipped, kinks };
}

/**
 * Slopes for one movement phase (an open spline in the phase's progress u)
 * where some interior knots have a fixed slope, usually 0 where a channel
 * turns back at a pass key (ADR 0017, E5). `splineSlopes` decouples the two
 * sides of such a knot, so the channel's acceleration jumps there (a visible
 * hitch at the key). This returns instead the minimum-curvature cubic for the
 * phase (minimises Σ∫P''² over the segments) with:
 *
 * - every fixed slope kept exactly (a turning knot keeps slope 0, so values
 *   never overshoot the turn);
 * - acceleration continuous at every free interior knot (as `splineSlopes`)
 *   and at every fixed one the guard and the other constraints leave room
 *   for. Two turns in a row with one free knot between them can't all be C2,
 *   nor can a small rise into a turn followed by a long, steep fall without
 *   overshooting; such a knot is decoupled as in `splineSlopes` and reported
 *   in `kinks`;
 * - the same guard as `splineSlopes` (sign check, at most 3× the smaller
 *   neighbouring secant). A knot the guard clips becomes fixed at the clipped
 *   slope and gives up acceleration continuity; the rest are solved again,
 *   one clip per round (at most n + 1 rounds).
 *
 * With no fixed interior knot this is exactly `splineSlopes(x, y, fixed,
 * false)` (the natural spline), as it is for a degenerate span. Dense KKT
 * solve (at most about 3n unknowns), run once per channel and phase and
 * cached by the caller.
 */
export function phaseTurnSlopes(x: readonly number[], y: readonly number[], fixed: readonly (number | null)[]): GuardedSlopes {
  const n = x.length;
  const interiorFixed = fixed.some((f, j) => j > 0 && j < n - 1 && f !== null);
  const h = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (x[i + 1] ?? 0) - (x[i] ?? 0));
  if (n < 3 || !interiorFixed || h.some((hi) => !(hi > 0))) return guardedSplineSlopes(x, y, fixed, false);
  const d = h.map((hi, i) => ((y[i + 1] ?? 0) - (y[i] ?? 0)) / hi);
  // A fixed knot that can't keep C2 within the guard (a small rise into a turn and a long, steep fall, say) is
  // decoupled as `splineSlopes` would, and the phase solved again without it, so the failed attempt doesn't bend
  // the rest of the phase (clipping its ends).
  const decoupled = new Set<number>();
  for (let attempt = 0; attempt < n; attempt += 1) {
    const r = clippedMinCurvature(h, d, fixed, decoupled);
    if (r === null) return guardedSplineSlopes(x, y, fixed, false);
    const lost = r.kinks.filter((j) => (fixed[j] ?? null) !== null && !decoupled.has(j));
    if (lost.length === 0) return r;
    for (const j of lost) decoupled.add(j);
  }
  return guardedSplineSlopes(x, y, fixed, false);
}

/** `phaseTurnSlopes` with a set of fixed knots left without C2: solve, clip the worst guard violation, solve again. */
function clippedMinCurvature(h: readonly number[], d: readonly number[], fixed: readonly (number | null)[], decoupled: ReadonlySet<number>): GuardedSlopes | null {
  const n = h.length + 1;
  const fix: (number | null)[] = Array.from({ length: n }, (_, j) => fixed[j] ?? null);
  const clipped: number[] = [];
  for (let round = 0; round <= n; round += 1) {
    const solved = minCurvatureSlopes(h, d, fix, new Set([...clipped, ...decoupled]));
    if (solved === null) return null;
    const m = solved.slopes;
    // Clip one knot per round, the worst (a sign flip, then the largest share over its cap), and solve again: clipping
    // one knot often brings its neighbours back inside the guard.
    let worst: { j: number; g: number; over: number } | null = null;
    for (let j = 0; j < n; j += 1) {
      if (fix[j] !== null) continue;
      const sides = [j - 1, j].filter((i) => i >= 0 && i < n - 1).map((i) => d[i] ?? 0);
      const mj = m[j] ?? 0;
      const g = guardSlope(mj, sides);
      if (g === mj) continue;
      // A slope over the cap by rounding only is set to the cap and stays free (its neighbours keep C2 to ~1e-12).
      if (Math.abs(g - mj) <= 1e-12 * Math.max(1, Math.abs(mj))) {
        m[j] = g;
        continue;
      }
      const over = Math.abs(g - mj) / Math.abs(mj);
      if (worst === null || over > worst.over) worst = { j, g, over };
    }
    if (worst === null) {
      const kinks = Array.from({ length: n }, (_, j) => j).filter((j) => j > 0 && j < n - 1 && !solved.c2[j]);
      return { slopes: m, clipped: clipped.sort((a, b) => a - b), kinks };
    }
    fix[worst.j] = worst.g;
    clipped.push(worst.j);
  }
  return null;
}

/**
 * Minimise Σ∫P''² over the Hermite segments (segment i: span h[i], secant
 * d[i]) subject to the fixed slopes and continuous acceleration (C2) at the
 * interior knots not in `noC2`. Per segment
 * ∫P''² = (4/h)(m₀² + m₀m₁ + m₁²) − (12d/h)(m₀ + m₁) + const, and C2 at knot j is
 * m(j−1)/h(j−1) + 2m(j)(1/h(j−1) + 1/h(j)) + m(j+1)/h(j) = 3(d(j−1)/h(j−1) + d(j)/h(j)).
 *
 * Constraints are taken in order (fixed slopes, then C2 at free knots, then C2
 * at fixed knots) and one that depends on those already taken is left out,
 * so the KKT system is never singular: the energy is positive definite. A C2
 * row left out still holds if it was consistent; `c2` says where it holds.
 * Null only on a numerical failure.
 */
function minCurvatureSlopes(h: readonly number[], d: readonly number[], fix: readonly (number | null)[], noC2: ReadonlySet<number>): { slopes: number[]; c2: boolean[] } | null {
  const n = fix.length;
  const c2Row = (j: number): { coef: number[]; rhs: number } => {
    const hl = h[j - 1] ?? 1;
    const hr = h[j] ?? 1;
    const coef = new Array<number>(n).fill(0);
    coef[j - 1] = 1 / hl;
    coef[j] = 2 * (1 / hl + 1 / hr);
    coef[j + 1] = 1 / hr;
    return { coef, rhs: 3 * ((d[j - 1] ?? 0) / hl + (d[j] ?? 0) / hr) };
  };
  const rows: { coef: number[]; rhs: number }[] = [];
  // Orthonormal basis of the rows taken so far (modified Gram–Schmidt), to leave out dependent ones.
  const basis: number[][] = [];
  const take = (row: { coef: number[]; rhs: number }): boolean => {
    const r = [...row.coef];
    const norm = Math.hypot(...r);
    for (const b of basis) {
      const dot = r.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
      for (let i = 0; i < n; i += 1) r[i] = (r[i] ?? 0) - dot * (b[i] ?? 0);
    }
    const rest = Math.hypot(...r);
    if (!(rest > 1e-9 * norm)) return false;
    basis.push(r.map((x) => x / rest));
    rows.push(row);
    return true;
  };
  fix.forEach((f, j) => {
    if (f !== null) take({ coef: Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)), rhs: f });
  });
  const interior = Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1).filter((j) => !noC2.has(j));
  for (const j of [...interior.filter((k) => fix[k] === null), ...interior.filter((k) => fix[k] !== null)]) take(c2Row(j));
  // KKT system [Q Cᵀ; C 0][m; λ] = [−g; r].
  const S = n + rows.length;
  const A = Array.from({ length: S }, () => new Array<number>(S + 1).fill(0));
  for (let i = 0; i + 1 < n; i += 1) {
    const hi = h[i] ?? 1;
    const ri = A[i] as number[];
    const rn = A[i + 1] as number[];
    ri[i] = (ri[i] ?? 0) + 8 / hi;
    ri[i + 1] = (ri[i + 1] ?? 0) + 4 / hi;
    rn[i] = (rn[i] ?? 0) + 4 / hi;
    rn[i + 1] = (rn[i + 1] ?? 0) + 8 / hi;
    ri[S] = (ri[S] ?? 0) + (12 * (d[i] ?? 0)) / hi;
    rn[S] = (rn[S] ?? 0) + (12 * (d[i] ?? 0)) / hi;
  }
  rows.forEach((r, k) => {
    const row = A[n + k] as number[];
    r.coef.forEach((c, j) => {
      if (c === 0) return;
      row[j] = c;
      (A[j] as number[])[n + k] = c;
    });
    row[S] = r.rhs;
  });
  // Gauss–Jordan with partial pivoting.
  for (let c = 0; c < S; c += 1) {
    let piv = c;
    for (let r = c + 1; r < S; r += 1) if (Math.abs(A[r]?.[c] ?? 0) > Math.abs(A[piv]?.[c] ?? 0)) piv = r;
    const pr = A[piv] as number[];
    A[piv] = A[c] as number[];
    A[c] = pr;
    const pv = pr[c] ?? 0;
    if (Math.abs(pv) < 1e-14) return null;
    for (let r = 0; r < S; r += 1) {
      const row = A[r] as number[];
      if (r === c || row[c] === 0) continue;
      const k = (row[c] ?? 0) / pv;
      for (let q = c; q <= S; q += 1) row[q] = (row[q] ?? 0) - k * (pr[q] ?? 0);
    }
  }
  // Fixed slopes exactly as given (the solve returns them only to rounding).
  const slopes = Array.from({ length: n }, (_, j) => fix[j] ?? (A[j]?.[S] ?? 0) / (A[j]?.[j] ?? 1));
  if (!slopes.every(Number.isFinite)) return null;
  const c2 = Array.from({ length: n }, (_, j) => j > 0 && j < n - 1 && c2Holds(h[j - 1] ?? 1, h[j] ?? 1, d[j - 1] ?? 0, d[j] ?? 0, slopes[j - 1] ?? 0, slopes[j] ?? 0, slopes[j + 1] ?? 0));
  return { slopes, c2 };
}

/** Minimum-jerk progress 10s³ − 15s⁴ + 6s⁵ on [0, 1]: zero velocity and acceleration at both ends. */
export function minimumJerk(s: number): number {
  const x = clamp(s, 0, 1);
  return x * x * x * (10 + x * (-15 + 6 * x));
}

/** Inverse of `minimumJerk` on [0, 1] (bisection; it is strictly increasing). */
export function minimumJerkInverse(p: number): number {
  const target = clamp(p, 0, 1);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (minimumJerk(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
