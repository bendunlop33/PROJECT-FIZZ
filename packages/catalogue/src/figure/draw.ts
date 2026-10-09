/**
 * Draw operations for one guide frame: the exact shapes, paints and draw
 * order, in pixel coordinates, with no output format attached. The Linux
 * renderer serialises them to SVG (`svg.ts`) and the app records them into
 * Skia pictures, so the preview Ben reviews and the in-app player draw the
 * same thing. Pure: no DOM, React or native imports. Frames contain no text.
 *
 * The background and its rounded-corner clip are not ops: each renderer
 * draws them its own way (`GUIDE_CORNER_FRACTION`).
 */
import type { Pose } from './pose';
import { add, dist, scale, sub, v, type Vec } from './math';
import { LAYERS, STROKE, type Paint, type Shape } from './props';

/** Square camera in world units. */
export interface Camera {
  cx: number;
  cy: number;
  size: number;
}

export interface FrameOpsOptions {
  /** Output size in pixels (the app uses 1 and scales the recorded picture). */
  px: number;
  camera: Camera;
  /** Static overlay: a dashed path (e.g. the bar path over the whole cycle). */
  trace?: readonly Vec[];
}

/**
 * - `line`: a stroked segment. `cap: 'butt'` only for the floor.
 * - `circle`: optional fill and stroke.
 * - `path`: a polyline or polygon with optional fill and stroke.
 * `opacity` (0–1) applies to the op as a whole (fill and stroke together).
 */
export type DrawOp =
  | { kind: 'line'; a: Vec; b: Vec; width: number; paint: Paint; cap: 'round' | 'butt'; dash: readonly number[] | null; opacity: number }
  | { kind: 'circle'; c: Vec; r: number; fill: Paint | null; stroke: Paint | null; width: number; opacity: number }
  | {
      kind: 'path';
      points: readonly Vec[];
      closed: boolean;
      fill: Paint | null;
      stroke: Paint | null;
      width: number;
      join: 'round' | null;
      cap: 'round' | null;
      dash: readonly number[] | null;
      opacity: number;
    };

const FLOOR_DASH = 0.05;

/** Outline of a tapered capsule as a polygon (robust to mirroring, no arc flags). */
export function capsuleOutline(a: Vec, b: Vec, ra: number, rb: number, steps = 10): Vec[] {
  const d = dist(a, b);
  if (d < 1e-9 || d <= Math.abs(ra - rb)) {
    const c = ra >= rb ? a : b;
    const r = Math.max(ra, rb);
    return Array.from({ length: steps * 2 }, (_, i) => add(c, v(Math.cos((i / (steps * 2)) * 2 * Math.PI) * r, Math.sin((i / (steps * 2)) * 2 * Math.PI) * r)));
  }
  const u = scale(sub(b, a), 1 / d);
  const base = Math.atan2(u.y, u.x);
  const phi = Math.asin((ra - rb) / d);
  // Outer tangents touch both circles at ±(90° − φ) from the a→b direction.
  const half = Math.PI / 2 - phi;
  const pts: Vec[] = [];
  // Around b: from the +normal tangent point through +u to the −normal one.
  for (let i = 0; i <= steps; i += 1) {
    const ang = base + half - (i / steps) * (2 * half);
    pts.push(add(b, v(Math.cos(ang) * rb, Math.sin(ang) * rb)));
  }
  // Around a: from the −normal tangent point through −u back to the +normal one.
  for (let i = 0; i <= steps; i += 1) {
    const ang = base - half - (i / steps) * (2 * Math.PI - 2 * half);
    pts.push(add(a, v(Math.cos(ang) * ra, Math.sin(ang) * ra)));
  }
  return pts;
}

/** World → pixel transform for a camera (mirrors x when the figure faces left). */
export function projector(camera: Camera, px: number, facing: 'right' | 'left'): (p: Vec) => Vec {
  const k = px / camera.size;
  const left = camera.cx - camera.size / 2;
  const top = camera.cy + camera.size / 2;
  return (p) => {
    const x = facing === 'left' ? 2 * camera.cx - p.x : p.x;
    return v((x - left) * k, (top - p.y) * k);
  };
}

type Capsule = Extract<Shape, { kind: 'capsule' }>;

/** A capsule's halo: its outline grown by `STROKE.halo` in the outline paint. */
function capsuleHaloOp(s: Capsule, P: (p: Vec) => Vec, k: number): DrawOp | null {
  if (!s.outline) return null;
  return { kind: 'path', points: capsuleOutline(s.a, s.b, s.ra, s.rb).map(P), closed: true, fill: s.outline, stroke: s.outline, width: 2 * STROKE.halo * k, join: 'round', cap: null, dash: null, opacity: 1 };
}

function shapeOp(s: Shape, P: (p: Vec) => Vec, k: number): DrawOp {
  switch (s.kind) {
    case 'line':
      return { kind: 'line', a: P(s.a), b: P(s.b), width: s.width * k, paint: s.paint, cap: 'round', dash: s.dash ? s.dash.map((d) => d * k) : null, opacity: s.opacity ?? 1 };
    case 'circle':
      return { kind: 'circle', c: P(s.c), r: s.r * k, fill: s.fill ?? null, stroke: s.stroke ?? null, width: (s.width ?? STROKE.edge) * k, opacity: s.opacity ?? 1 };
    case 'poly':
      return { kind: 'path', points: s.points.map(P), closed: true, fill: s.fill ?? null, stroke: s.stroke ?? null, width: (s.width ?? STROKE.edge) * k, join: 'round', cap: null, dash: null, opacity: s.opacity ?? 1 };
    case 'capsule':
      return { kind: 'path', points: capsuleOutline(s.a, s.b, s.ra, s.rb).map(P), closed: true, fill: s.paint, stroke: null, width: 0, join: null, cap: null, dash: null, opacity: 1 };
  }
}

/**
 * Ops of one layer in draw order. A capsule group (one limb) is drawn where
 * its first capsule appears: all of its halos, then all of its fills, so the
 * limb reads as one smooth silhouette with no seams at the joints.
 */
function layerOps(shapes: readonly Shape[], P: (p: Vec) => Vec, k: number): DrawOp[] {
  const out: (DrawOp | null)[] = [];
  const done = new Set<string>();
  for (const s of shapes) {
    if (s.kind === 'capsule' && s.group !== undefined) {
      if (done.has(s.group)) continue;
      done.add(s.group);
      const members = shapes.filter((m): m is Capsule => m.kind === 'capsule' && m.group === s.group);
      for (const m of members) out.push(capsuleHaloOp(m, P, k));
      for (const m of members) out.push(shapeOp(m, P, k));
    } else if (s.kind === 'capsule') {
      out.push(capsuleHaloOp(s, P, k), shapeOp(s, P, k));
    } else {
      out.push(shapeOp(s, P, k));
    }
  }
  return out.filter((x): x is DrawOp => x !== null);
}

/** Every op for one frame, back to front: floor, then each layer (trace just below `front`). */
export function frameOps(pose: Pose, opts: FrameOpsOptions): DrawOp[] {
  const { px, camera } = opts;
  const k = px / camera.size;
  const P = projector(camera, px, pose.facing);
  const ops: DrawOp[] = [];

  // Floor: dashed; on a scrolling floor the dashes move with the ground.
  const floorY = P(v(camera.cx, pose.groundY)).y;
  const offset = pose.groundOffset;
  const dash = FLOOR_DASH;
  const shift = ((((pose.facing === 'left' ? -offset : offset) % dash) + dash) % dash) * k;
  ops.push({ kind: 'line', a: v(-dash * k + shift, floorY), b: v(px + dash * k, floorY), width: STROKE.hair * k, paint: 'trace', cap: 'butt', dash: [dash * 0.6 * k, dash * 0.4 * k], opacity: 1 });
  for (const layer of LAYERS) {
    // The static path overlay sits above the body and below front implements, so it stays visible.
    if (layer === 'front' && opts.trace && opts.trace.length > 1) {
      ops.push({ kind: 'path', points: opts.trace.map(P), closed: false, fill: null, stroke: 'trace', width: 0.005 * k, join: null, cap: 'round', dash: [0.012 * k, 0.01 * k], opacity: 1 });
    }
    ops.push(...layerOps(pose.shapes.filter((s) => s.layer === layer), P, k));
  }
  return ops;
}
