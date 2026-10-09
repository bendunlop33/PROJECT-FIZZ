/**
 * Smooth outlines (guides v2 §7.2): centripetal Catmull-Rom curves through
 * sampled points, converted to cubic Béziers. Both renderers emit the same
 * path data from these helpers (SVG `C` in `svg.ts`; the app's Skia bake
 * parses the same string), so the preview and the player draw identical
 * curves. Pure: no DOM, React or native imports.
 */
import { add, dist, scale, sub, v, type Vec } from './math';

/** One cubic Bézier segment from the previous end point. */
export interface Cubic {
  c1: Vec;
  c2: Vec;
  to: Vec;
}

const ALPHA = 0.5;

/**
 * Bézier control points for the Catmull-Rom span p1 → p2 (neighbours p0, p3),
 * centripetal parameterisation (no cusps or self-intersections on uneven
 * spacing). Coincident neighbours fall back to a straight third.
 */
function span(p0: Vec, p1: Vec, p2: Vec, p3: Vec): Cubic {
  const d1 = dist(p0, p1) ** ALPHA;
  const d2 = dist(p1, p2) ** ALPHA;
  const d3 = dist(p2, p3) ** ALPHA;
  if (d2 < 1e-12) return { c1: p1, c2: p2, to: p2 };
  const third = scale(sub(p2, p1), 1 / 3);
  const c1 =
    d1 < 1e-12
      ? add(p1, third)
      : scale(add(add(scale(p2, d1 * d1), scale(p0, -d2 * d2)), scale(p1, 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2)), 1 / (3 * d1 * (d1 + d2)));
  const c2 =
    d3 < 1e-12
      ? sub(p2, third)
      : scale(add(add(scale(p1, d3 * d3), scale(p3, -d2 * d2)), scale(p2, 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2)), 1 / (3 * d3 * (d3 + d2)));
  return { c1, c2, to: p2 };
}

/** Drop consecutive duplicates (they would make zero-length spans). */
function dedupe(points: readonly Vec[], closed: boolean): Vec[] {
  const out: Vec[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last === undefined || dist(last, p) > 1e-9) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (closed && out.length > 1 && first !== undefined && last !== undefined && dist(first, last) <= 1e-9) out.pop();
  return out;
}

/** Cubic spans through every point (closed: back to the first point as well). */
export function catmullRom(points: readonly Vec[], closed: boolean): { start: Vec; spans: Cubic[] } | null {
  const pts = dedupe(points, closed);
  const n = pts.length;
  const first = pts[0];
  if (first === undefined) return null;
  const at = (i: number): Vec => {
    if (closed) return pts[((i % n) + n) % n] ?? first;
    return pts[Math.max(0, Math.min(n - 1, i))] ?? first;
  };
  const spans: Cubic[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i += 1) spans.push(span(at(i - 1), at(i), at(i + 1), at(i + 2)));
  return { start: first, spans };
}

/**
 * SVG path data for one or more contours (each a separate subpath, so
 * overlapping contours of one op fill as a union under the nonzero rule).
 * `digits` is the decimal precision (2 for pixel SVG, 5 for unit-size Skia).
 */
export function pathData(contours: readonly (readonly Vec[])[], closed: boolean, smooth: boolean, digits = 2): string {
  const m = 10 ** digits;
  const f = (n: number): string => String(Math.round(n * m) / m);
  const pt = (p: Vec): string => `${f(p.x)} ${f(p.y)}`;
  const parts: string[] = [];
  for (const c of contours) {
    if (c.length === 0) continue;
    if (smooth && c.length > 2) {
      const curve = catmullRom(c, closed);
      if (curve === null) continue;
      parts.push(`M${pt(curve.start)}${curve.spans.map((s) => `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.to)}`).join('')}${closed ? 'Z' : ''}`);
    } else {
      parts.push(c.map((p, i) => `${i === 0 ? 'M' : 'L'}${pt(p)}`).join('') + (closed ? 'Z' : ''));
    }
  }
  return parts.join('');
}

/** Signed area (positive = counter-clockwise with y up, clockwise on a y-down screen). */
export function signedArea(points: readonly Vec[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    if (p === undefined || q === undefined) continue;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** The same contour wound counter-clockwise (in its own coordinates), so contours of one op union. */
export function counterClockwise(points: readonly Vec[]): Vec[] {
  return signedArea(points) < 0 ? [...points].reverse() : [...points];
}

/** Points on an ellipse (centre, radii, rotation in radians), counter-clockwise. */
export function ellipsePoints(c: Vec, rx: number, ry: number, rot: number, steps = 16): Vec[] {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return v(c.x + x * cr - y * sr, c.y + x * sr + y * cr);
  });
}

/** A rounded rectangle (axis-aligned, world units) as a polygon with sampled corner arcs. */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, steps = 3): Vec[] {
  const rr = Math.max(0, Math.min(r, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2));
  const lx = Math.min(x0, x1);
  const hx = Math.max(x0, x1);
  const ly = Math.min(y0, y1);
  const hy = Math.max(y0, y1);
  const corners: [Vec, number][] = [
    [v(hx - rr, ly + rr), -Math.PI / 2],
    [v(hx - rr, hy - rr), 0],
    [v(lx + rr, hy - rr), Math.PI / 2],
    [v(lx + rr, ly + rr), Math.PI],
  ];
  const out: Vec[] = [];
  for (const [c, a0] of corners) {
    for (let i = 0; i <= steps; i += 1) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      out.push(v(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr));
    }
  }
  return out;
}

/**
 * A ribbon around an open axis polyline with a half-width per axis point
 * and round ends: used for thumbs, palms and grip sleeves.
 */
export function ribbonOutline(axis: readonly Vec[], halfWidths: readonly number[]): Vec[] {
  const n = axis.length;
  if (n < 2) return [];
  const normals: Vec[] = axis.map((p, i) => {
    const a = axis[Math.max(0, i - 1)] ?? p;
    const b = axis[Math.min(n - 1, i + 1)] ?? p;
    const d = sub(b, a);
    const l = Math.hypot(d.x, d.y) || 1;
    return v(-d.y / l, d.x / l);
  });
  const left: Vec[] = [];
  const right: Vec[] = [];
  axis.forEach((p, i) => {
    const w = halfWidths[i] ?? halfWidths[halfWidths.length - 1] ?? 0;
    const nn = normals[i] ?? v(0, 1);
    left.push(add(p, scale(nn, w)));
    right.push(add(p, scale(nn, -w)));
  });
  const cap = (c: Vec, dir: Vec, nn: Vec, w: number): Vec[] =>
    [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map((a) => add(c, add(scale(nn, Math.cos(a) * w), scale(dir, Math.sin(a) * w))));
  const endP = axis[n - 1] ?? v(0, 0);
  const startP = axis[0] ?? v(0, 0);
  const endDir = sub(endP, axis[n - 2] ?? endP);
  const startDir = sub(startP, axis[1] ?? startP);
  const unit = (d: Vec): Vec => scale(d, 1 / (Math.hypot(d.x, d.y) || 1));
  const nEnd = normals[n - 1] ?? v(0, 1);
  const nStart = normals[0] ?? v(0, 1);
  return [
    ...left,
    ...cap(endP, unit(endDir), nEnd, halfWidths[n - 1] ?? 0),
    ...right.reverse(),
    ...cap(startP, unit(startDir), scale(nStart, -1), halfWidths[0] ?? 0),
  ];
}
