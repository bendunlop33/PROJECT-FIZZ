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
 * phase instead (ADR 0015). See `keyframes.ts`.
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
 * keeps C1 but loses C2.
 */
export function splineSlopes(x: readonly number[], y: readonly number[], fixed: readonly (number | null)[], cyclic: boolean): number[] {
  const n = x.length;
  if (n < 2) return Array.from({ length: n }, () => 0);
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
  for (let j = 0; j < K; j += 1) {
    if (free[j] !== true) continue;
    const sides = [leftSeg(j), rightSeg(j)].filter((i) => i >= 0).map((i) => d[i] ?? 0);
    const mj = m[j] ?? 0;
    if (sides.some((s) => s === 0 || Math.sign(s) !== Math.sign(mj))) {
      m[j] = 0;
      continue;
    }
    const cap = 3 * Math.min(...sides.map(Math.abs));
    m[j] = Math.sign(mj) * Math.min(Math.abs(mj), cap);
  }
  return Array.from({ length: n }, (_, i) => m[knot(i)] ?? 0);
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
