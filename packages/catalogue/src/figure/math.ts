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
 * `smooth` is not a per-segment curve: it is a monotone cubic through the
 * neighbouring keyframes (continuous velocity, no overshoot), with zero
 * velocity at holds and turning points. See `keyframes.ts`.
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
