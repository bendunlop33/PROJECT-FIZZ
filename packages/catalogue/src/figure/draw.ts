/**
 * Draw operations for one guide frame: the exact shapes, paints and draw
 * order, in pixel coordinates, with no output format attached. The Linux
 * renderer serialises them to SVG (`svg.ts`) and the app records them into
 * Skia pictures, so the preview Ben reviews and the in-app player draw the
 * same thing. Pure: no DOM, React or native imports. Frames contain no text.
 *
 * Guides v2 (exercise-guides-v2.md §3, §4, §7): the body is drawn from
 * contoured segment profiles as smooth outlines; muscle regions, soft shading,
 * outline contours and anatomical lines are layered on the near body; detail
 * depends on the drawn size (S tier below 160 pt, M/L at or above).
 *
 * The background and its rounded-corner clip are not ops: each renderer
 * draws them its own way (`GUIDE_CORNER_FRACTION`).
 */
import { BODY_GROUPS, groupContours, groupStrokeContours, soleBand, type BodyGroup } from './body';
import { add, dist, pointInPolygon, pointSegmentDistance, polygonsWithin, scale, sub, v, type Vec } from './math';
import { definitionGroupsFor, effectiveDefinition, focusViewOf, hasListedMuscles, resolveFocus, type MuscleDefinition, type MuscleInput, type MuscleLevel } from './muscle-map';
import { counterClockwise, signedArea } from './paths';
import type { Muscle } from '../vocab';
import type { Pose } from './pose';
import { STROKE, type Layer, type Paint, type Shape } from './props';
import { anatomyLines, definitionShapes, LIGHT, regionShapes, shadeBands, type DefinitionShape, type RegionGroup } from './regions';
import { MUSCLE_OPACITY } from './style';

/** Square camera in world units. */
export interface Camera {
  cx: number;
  cy: number;
  size: number;
}

/** Detail tiers (guides v2 §3.10): `compact` = S (thumbnails), `full` = M/L (every in-app player size). */
export type DetailTier = 'compact' | 'full';

/** Canvases narrower than this (in points) draw the S tier (design-system `guide.tierSmallBelow`). */
export const DETAIL_TIER_MIN_PT = 160;

/** S tier: visible width of the arm's occlusion edge at `COMPACT_REFERENCE_PT` (exercise-guides-v2 §3.6), points. */
export const COMPACT_ARM_EDGE_PT = 0.6;
/** The thumbnail size `COMPACT_ARM_EDGE_PT` is set for (Today and the library list, 115 pt). */
export const COMPACT_REFERENCE_PT = 115;

/** Forearm and grip supporting tints only from this drawn size up (below it they are spots on the hands), points. */
export const SUPPORT_DETAIL_MIN_PT = 240;
/** A supporting (soft) region smaller than this at the drawn size is left out, pt². */
export const SUPPORT_MIN_AREA_PT2 = 6;
const SMALL_SUPPORT: ReadonlySet<Muscle> = new Set<Muscle>(['grip', 'forearms']);

/** Minimum stroke widths in points at the drawn size (design-system `guide.strokeFloor.*`). */
export const STROKE_FLOORS_PT = {
  compact: { halo: 1.25, edge: 1, contour: 1, hair: 0.75 },
  full: { halo: 1, edge: 0.75, contour: 0.75, hair: 0.75 },
} as const satisfies Record<DetailTier, Record<'halo' | 'edge' | 'contour' | 'hair', number>>;

/** S tier: a cable is at least this wide, points (a hairline cable read as missing at 115 pt; visual review, round 4). */
export const CABLE_COMPACT_MIN_PT = 1.5;

export interface FrameOpsOptions {
  /** Output size in pixels (the app uses 1 and scales the recorded picture). */
  px: number;
  camera: Camera;
  /** Static overlay: a dashed path (e.g. the bar path over the whole cycle). */
  trace?: readonly Vec[];
  /** Size the frame is shown at, in points (default `px`). Picks the tier and the stroke floors. */
  pt?: number;
  /** Detail tier; default from `pt` (below `DETAIL_TIER_MIN_PT` → `compact`). */
  detail?: DetailTier;
  /**
   * The catalogue entry's muscles: primary drawn strong, secondary soft
   * (guides v2 §4). The guide's own `focus` overrides come with the pose.
   * Omitted or null: no muscle colour (e.g. the entry couldn't be read).
   */
  muscles?: MuscleInput | null;
  /** Soft shading bands at the M/L tier (default true; Ben to confirm, B5). */
  shading?: boolean;
  /**
   * Work-phase emphasis, 0–1 (§4.9): strong regions 0.80 → 1.0, soft 0.36 →
   * 0.50. Omitted = steady colour (1.0 / 0.45): stills, Reduce Motion, paused
   * posters and guides without a work phase.
   */
  pulse?: number;
  /** iOS Increase Contrast: steady colour (soft 0.60), stronger contours (§8). */
  increaseContrast?: boolean;
  /** iOS Differentiate Without Color: strong regions get a 1 pt outline (§4.3). */
  differentiateWithoutColor?: boolean;
  /**
   * Muscle definition (§4.11): a faint, steady shape for every muscle group
   * the view can show. Default `'off'`, so frames are exactly as before until
   * a caller opts in; the app uses `MUSCLE_DEFINITION`. The mode drawn is
   * `effectiveDefinition(...)`: M/L tier only, `tint` falls back to `neutral`
   * under Increase Contrast or Differentiate Without Color and to `off`
   * without the entry's muscles.
   */
  definition?: MuscleDefinition;
  /** Review only: draw definition at the S tier too (thumbnail comparison). Default false. */
  definitionCompact?: boolean;
}

export interface GradientStop {
  at: number;
  paint: Paint;
  opacity: number;
}

/** A linear gradient in output coordinates (soft shading, §3.7). */
export interface Gradient {
  from: Vec;
  to: Vec;
  stops: readonly GradientStop[];
}

/**
 * - `line`: a stroked segment. `cap: 'butt'` only for the floor.
 * - `circle`: optional fill and stroke.
 * - `path`: one or more contours (subpaths; overlapping contours fill as one
 *   shape), straight or `smooth` (cubic Béziers through the points, §7.2),
 *   filled with a paint or a `gradient`, optionally stroked.
 * `opacity` (0–1) applies to the op as a whole (fill and stroke together).
 */
export type DrawOp =
  | { kind: 'line'; a: Vec; b: Vec; width: number; paint: Paint; cap: 'round' | 'butt'; dash: readonly number[] | null; opacity: number }
  | { kind: 'circle'; c: Vec; r: number; fill: Paint | null; stroke: Paint | null; width: number; opacity: number }
  | {
      kind: 'path';
      contours: readonly (readonly Vec[])[];
      closed: boolean;
      smooth: boolean;
      fill: Paint | null;
      /** When set, the fill is this gradient (and `fill` is null). */
      gradient: Gradient | null;
      stroke: Paint | null;
      width: number;
      join: 'round' | null;
      cap: 'round' | null;
      dash: readonly number[] | null;
      opacity: number;
    };

const FLOOR_DASH = 0.05;

/** Outline of a tapered capsule as a polygon (robust to mirroring, no arc flags). Props only since v2. */
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
  for (let i = 0; i <= steps; i += 1) {
    const ang = base + half - (i / steps) * (2 * half);
    pts.push(add(b, v(Math.cos(ang) * rb, Math.sin(ang) * rb)));
  }
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

const pathOp = (contours: readonly (readonly Vec[])[], o: Partial<Extract<DrawOp, { kind: 'path' }>>): DrawOp => ({
  kind: 'path',
  contours,
  closed: true,
  smooth: false,
  fill: null,
  gradient: null,
  stroke: null,
  width: 0,
  join: null,
  cap: null,
  dash: null,
  opacity: 1,
  ...o,
});

/** Resolved frame settings shared by the op builders. */
interface Ctx {
  P: (p: Vec) => Vec;
  k: number;
  tier: DetailTier;
  /** Stroke width in output units: the H width scaled, never under the tier's floor. */
  sw: (widthH: number, cls: 'halo' | 'edge' | 'contour' | 'hair') => number;
  /** One point in output units. */
  ptPx: number;
}

const strokeClass = (widthH: number): 'hair' | 'edge' => (widthH <= STROKE.hair + 1e-9 ? 'hair' : 'edge');

function shapeOp(s: Shape, c: Ctx): DrawOp {
  const { P, k } = c;
  switch (s.kind) {
    case 'line':
      return { kind: 'line', a: P(s.a), b: P(s.b), width: Math.max(c.sw(s.width, strokeClass(s.width)), s.paint === 'cable' && c.tier === 'compact' ? CABLE_COMPACT_MIN_PT * c.ptPx : 0), paint: s.paint, cap: 'round', dash: s.dash ? s.dash.map((d) => d * k) : null, opacity: s.opacity ?? 1 };
    case 'circle': {
      const w = s.width ?? STROKE.edge;
      return { kind: 'circle', c: P(s.c), r: s.r * k, fill: s.fill ?? null, stroke: s.stroke ?? null, width: c.sw(w, strokeClass(w)), opacity: s.opacity ?? 1 };
    }
    case 'poly': {
      const w = s.width ?? STROKE.edge;
      return pathOp([s.points.map(P)], { smooth: s.smooth === true, fill: s.fill ?? null, stroke: s.stroke ?? null, width: c.sw(w, strokeClass(w)), join: 'round' });
    }
    case 'capsule':
      return pathOp([capsuleOutline(s.a, s.b, s.ra, s.rb).map(P)], { fill: s.paint });
  }
}

function capsuleHaloOp(s: Capsule, c: Ctx): DrawOp | null {
  if (!s.outline) return null;
  return pathOp([capsuleOutline(s.a, s.b, s.ra, s.rb).map(c.P)], { fill: s.outline, stroke: s.outline, width: 2 * c.sw(STROKE.halo, 'halo'), join: 'round' });
}

/**
 * Prop ops of one layer in draw order. A capsule group is drawn where its
 * first capsule appears: all of its halos, then all of its fills.
 */
function layerOps(shapes: readonly Shape[], c: Ctx): DrawOp[] {
  const out: (DrawOp | null)[] = [];
  const done = new Set<string>();
  for (const s of shapes) {
    if (s.kind === 'capsule' && s.group !== undefined) {
      if (done.has(s.group)) continue;
      done.add(s.group);
      const members = shapes.filter((m): m is Capsule => m.kind === 'capsule' && m.group === s.group);
      for (const m of members) out.push(capsuleHaloOp(m, c));
      for (const m of members) out.push(shapeOp(m, c));
    } else if (s.kind === 'capsule') {
      out.push(capsuleHaloOp(s, c), shapeOp(s, c));
    } else {
      out.push(shapeOp(s, c));
    }
  }
  return out.filter((x): x is DrawOp => x !== null);
}

/**
 * Muscle opacity for a level (§4.3, §4.9): steady unless a pulse value is
 * given (never under Increase Contrast). With `tint` definition, soft stays
 * steady at 0.45: at its pulse low it would sit only ~1.17:1 from faint
 * violet (§4.11.7). Pass the effective definition mode.
 */
export function muscleOpacity(level: MuscleLevel, opts: Pick<FrameOpsOptions, 'pulse' | 'increaseContrast' | 'definition'>): number {
  if (opts.increaseContrast === true) return level === 'strong' ? MUSCLE_OPACITY.strong : MUSCLE_OPACITY.softIncreaseContrast;
  if (opts.pulse === undefined || (level === 'soft' && opts.definition === 'tint')) return level === 'strong' ? MUSCLE_OPACITY.strong : MUSCLE_OPACITY.soft;
  const w = Math.min(1, Math.max(0, opts.pulse));
  const [lo, hi] = MUSCLE_OPACITY.pulse[level];
  return lo + (hi - lo) * w;
}

/** Length over which an open limb stroke fades at each end (about one upper-arm width), H. */
export const TAPER_LENGTH = 0.05;
/** Opacity of the end pieces of a tapered stroke, from the inside out. */
const TAPER_STEPS = [0.7, 0.45, 0.2] as const;

/** Cut a polyline at arc length `d` from its start: [head, tail] (the cut point is in both). */
function cutAt(pts: readonly Vec[], d: number): [Vec[], Vec[]] {
  let run = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Vec;
    const b = pts[i] as Vec;
    const l = dist(a, b);
    if (run + l >= d && l > 0) {
      const m = add(a, scale(sub(b, a), (d - run) / l));
      return [[...pts.slice(0, i), m], [m, ...pts.slice(i)]];
    }
    run += l;
  }
  return [[...pts], [pts[pts.length - 1] as Vec]];
}

/**
 * An open stroke as pieces with opacity: full in the middle, fading in
 * `TAPER_STEPS` over `fade` (output units) at each end. Strokes shorter than
 * three fades are left whole.
 */
export function taperedPieces(pts: readonly Vec[], fade: number): { alpha: number; points: Vec[] }[] {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += dist(pts[i - 1] as Vec, pts[i] as Vec);
  if (pts.length < 2 || total < 3 * fade || fade <= 0) return [{ alpha: 1, points: [...pts] }];
  const step = fade / TAPER_STEPS.length;
  const out: { alpha: number; points: Vec[] }[] = [];
  let rest: Vec[] = [...pts];
  // Start: faintest first.
  for (let i = TAPER_STEPS.length - 1; i >= 0; i -= 1) {
    const [head, tail] = cutAt(rest, step);
    out.push({ alpha: TAPER_STEPS[i] ?? 1, points: head });
    rest = tail;
  }
  // End: cut the same from the far end.
  const reversed = [...rest].reverse();
  let restR = reversed;
  const ends: { alpha: number; points: Vec[] }[] = [];
  for (let i = TAPER_STEPS.length - 1; i >= 0; i -= 1) {
    const [head, tail] = cutAt(restR, step);
    ends.push({ alpha: TAPER_STEPS[i] ?? 1, points: head.reverse() });
    restR = tail;
  }
  out.push({ alpha: 1, points: restR.reverse() });
  return [...out, ...ends.reverse()];
}

/**
 * Opacity of an arm's occlusion edge where it lies over the torso, against
 * its silhouette edge (1). A full-strength outline over the chest read as a
 * stitched seam or a crossed-arm X (visual review, round 4): over the torso
 * only a soft edge separates the arm from the body it belongs to.
 */
export const ARM_OVER_TRUNK_EDGE = 0.22;
/** Depth inside the torso outline over which an arm edge fades from the silhouette strength to `ARM_OVER_TRUNK_EDGE`, H. */
export const ARM_EDGE_RAMP = 0.02;
/** Alpha levels the fade is quantised to (one op per level). */
const EDGE_LEVELS = 5;

/** Polygons with their bounds, for repeated depth tests. */
interface Occluders {
  polys: { pts: readonly Vec[]; minX: number; maxX: number; minY: number; maxY: number }[];
}

function occludersOf(polys: readonly (readonly Vec[])[]): Occluders {
  return {
    polys: polys
      .filter((pts) => pts.length >= 3)
      .map((pts) => ({ pts, minX: Math.min(...pts.map((q) => q.x)), maxX: Math.max(...pts.map((q) => q.x)), minY: Math.min(...pts.map((q) => q.y)), maxY: Math.max(...pts.map((q) => q.y)) })),
  };
}

/**
 * Distance from `p` to the nearest edge of the occluders, negative inside
 * one of them, clamped to ±`cap` (polygons further than `cap` are skipped).
 */
function signedDepth(p: Vec, occ: Occluders, cap: number): number {
  let d = cap;
  let inside = false;
  for (const o of occ.polys) {
    if (p.x < o.minX - cap || p.x > o.maxX + cap || p.y < o.minY - cap || p.y > o.maxY + cap) continue;
    if (!inside && p.x >= o.minX && p.x <= o.maxX && p.y >= o.minY && p.y <= o.maxY && pointInPolygon(p, o.pts)) inside = true;
    const n = o.pts.length;
    for (let i = 0; i < n; i += 1) d = Math.min(d, pointSegmentDistance(p, o.pts[i] as Vec, o.pts[(i + 1) % n] as Vec));
  }
  return inside ? -d : d;
}

/** A polyline with extra points so no step is longer than `step`. */
function densify(pts: readonly Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  pts.forEach((b, i) => {
    const a = pts[i - 1];
    if (a !== undefined) {
      const n = Math.ceil(dist(a, b) / step);
      for (let j = 1; j < n; j += 1) out.push(add(a, scale(sub(b, a), j / n)));
    }
    out.push(b);
  });
  return out;
}

/**
 * Splits stroke pieces where they run over the occluders (the torso, in
 * output units): full strength outside, fading over `ramp` inside to `soft`.
 * Alpha is quantised to `EDGE_LEVELS` steps, so each level is one op.
 */
export function softenOver(pieces: readonly { alpha: number; points: Vec[] }[], occluders: readonly (readonly Vec[])[], ramp: number, soft: number = ARM_OVER_TRUNK_EDGE): { alpha: number; points: Vec[] }[] {
  if (occluders.length === 0 || ramp <= 0) return pieces.map((p) => ({ alpha: p.alpha, points: [...p.points] }));
  const occ = occludersOf(occluders);
  const out: { alpha: number; points: Vec[] }[] = [];
  const level = (p: Vec): number => {
    const depth = -signedDepth(p, occ, ramp);
    const x = Math.min(1, Math.max(0, depth / ramp));
    const f = 1 - (1 - soft) * x * x * (3 - 2 * x);
    return Math.round(f * EDGE_LEVELS) / EDGE_LEVELS;
  };
  for (const piece of pieces) {
    const pts = densify(piece.points, ramp / 3);
    const lv = pts.map(level);
    // No flicker along an edge that runs close to the outline: a run shorter than one ramp takes its neighbour's level.
    const minRun = 3;
    for (let i = 0; i < lv.length; ) {
      let j = i;
      while (j + 1 < lv.length && lv[j + 1] === lv[i]) j += 1;
      if (j - i + 1 < minRun && i > 0) for (let q = i; q <= j; q += 1) lv[q] = lv[i - 1] as number;
      i = j + 1;
    }
    let run: Vec[] = [];
    let cur = -1;
    pts.forEach((p, i) => {
      const l = lv[i] as number;
      if (l !== cur && run.length > 0) {
        run.push(p);
        if (run.length > 1 && cur > 0) out.push({ alpha: piece.alpha * cur, points: run });
        run = [];
      }
      cur = l;
      run.push(p);
    });
    if (run.length > 1 && cur > 0) out.push({ alpha: piece.alpha * cur, points: run });
  }
  return out;
}

/**
 * Lines faded by the share of their points that lie inside the occluders:
 * an arm's groove line over the torso or head reads as a seam on the body,
 * so it fades out as the arm moves over it (gone from 60% inside).
 */
export function fadeOver(pieces: readonly { alpha: number; points: Vec[] }[], occluders: readonly (readonly Vec[])[]): { alpha: number; points: Vec[] }[] {
  const out: { alpha: number; points: Vec[] }[] = [];
  for (const piece of pieces) {
    const pts = densify(piece.points, Math.max(1e-6, dist(piece.points[0] as Vec, piece.points[piece.points.length - 1] as Vec) / 12));
    const share = pts.filter((p) => occluders.some((o) => o.length >= 3 && pointInPolygon(p, o))).length / Math.max(1, pts.length);
    const x = Math.min(1, Math.max(0, (share - 0.1) / 0.5));
    const a = piece.alpha * (1 - x * x * (3 - 2 * x));
    if (a > 0.01) out.push({ alpha: Math.round(a * 20) / 20, points: [...piece.points] });
  }
  return out;
}

/** How far a trunk line keeps from the near arm's outline, H (`clearOf`). */
export const LINE_ARM_CLEARANCE = 0.025;

/**
 * Line pieces with the parts inside or within `margin` of the occluders cut
 * out (output units); a piece left shorter than a third of its line is dropped.
 */
export function clearOf(pieces: readonly { alpha: number; points: Vec[] }[], occluders: readonly (readonly Vec[])[], margin: number): { alpha: number; points: Vec[] }[] {
  if (occluders.length === 0) return pieces.map((p) => ({ alpha: p.alpha, points: [...p.points] }));
  const occ = occludersOf(occluders);
  const out: { alpha: number; points: Vec[] }[] = [];
  for (const piece of pieces) {
    let total = 0;
    for (let i = 1; i < piece.points.length; i += 1) total += dist(piece.points[i - 1] as Vec, piece.points[i] as Vec);
    const pts = densify(piece.points, Math.max(margin / 3, 1e-6));
    const runs: Vec[][] = [];
    let run: Vec[] = [];
    for (const p of pts) {
      if (signedDepth(p, occ, 2 * margin) > margin) run.push(p);
      else {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (run.length > 1) runs.push(run);
    for (const r of runs) {
      let len = 0;
      for (let i = 1; i < r.length; i += 1) len += dist(r[i - 1] as Vec, r[i] as Vec);
      if (len >= total / 3) out.push({ alpha: piece.alpha, points: r });
    }
  }
  return out;
}

/** Contours grouped by alpha, fully opaque first (almost always the only group). */
function byAlpha(items: readonly { alpha: number; points: Vec[] }[]): [number, Vec[][]][] {
  const groups = new Map<number, Vec[][]>();
  for (const it of items) groups.set(it.alpha, [...(groups.get(it.alpha) ?? []), it.points]);
  return [...groups.entries()].sort((a, b) => b[0] - a[0]);
}

/**
 * Opacity along a faint definition shape's long axis, from its lit end (guides
 * v2 §4.11.6, round 4): both ends fade to nothing and the lit half is fuller,
 * so a shape reads as a muscle belly catching the light rather than a flat,
 * evenly lit disc (a round pale patch read as a stain; visual review).
 */
export const DEFINITION_STOPS: readonly { at: number; k: number }[] = [
  { at: 0, k: 0 },
  { at: 0.3, k: 1 },
  { at: 0.62, k: 0.8 },
  { at: 1, k: 0 },
];
/** Faint glute and outer-hip shapes are drawn at this share: their large pale patch on the hip read as a stain (visual review, round 4). */
export const DEFINITION_HIP_SCALE = 0.7;
const HIP_GROUPS: ReadonlySet<string> = new Set(['glutes', 'outerHip']);

/** A faint shape's gradient in world units: its long axis (lit end first) and the stops with the shape's alpha applied. Null for a degenerate shape. */
export function definitionGradient(f: DefinitionShape): { from: Vec; to: Vec; stops: { at: number; opacity: number }[] } | null {
  const pts = f.contour;
  if (pts.length < 3) return null;
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const farthest = (from: Vec): Vec => pts.reduce((best, p) => (dist(p, from) > dist(best, from) ? p : best), pts[0] as Vec);
  const a = farthest(v(cx, cy));
  const b = farthest(a);
  if (dist(a, b) < 1e-6) return null;
  const lit = a.x * LIGHT.x + a.y * LIGHT.y >= b.x * LIGHT.x + b.y * LIGHT.y;
  const alpha = f.alpha * (HIP_GROUPS.has(f.definition) ? DEFINITION_HIP_SCALE : 1);
  return { from: lit ? a : b, to: lit ? b : a, stops: DEFINITION_STOPS.map((st) => ({ at: st.at, opacity: st.k * alpha })) };
}

/** Every op for one frame, back to front (guides v2 §3.11). */
export function frameOps(pose: Pose, opts: FrameOpsOptions): DrawOp[] {
  const { px, camera } = opts;
  const pt = opts.pt ?? px;
  const tier: DetailTier = opts.detail ?? (pt < DETAIL_TIER_MIN_PT ? 'compact' : 'full');
  const full = tier === 'full';
  const k = px / camera.size;
  const ptPx = px / pt;
  const floors = STROKE_FLOORS_PT[tier];
  const c: Ctx = { P: projector(camera, px, pose.facing), k, tier, ptPx, sw: (w, cls) => Math.max(w * k, floors[cls] * ptPx) };
  const ic = opts.increaseContrast === true;
  const shading = full && opts.shading !== false;
  const ops: DrawOp[] = [];
  const body = pose.body;
  const side = body.view === 'side';
  const project = (pts: readonly Vec[]): Vec[] => counterClockwise(pts.map(c.P));
  const emitLayer = (layer: Layer): void => {
    ops.push(...layerOps(pose.shapes.filter((s) => s.layer === layer && (s.detail === undefined || s.detail === tier)), c));
  };

  // Floor: dashed; on a scrolling floor the dashes move with the ground.
  const floorY = c.P(v(camera.cx, pose.groundY)).y;
  const offset = pose.groundOffset;
  const dash = FLOOR_DASH;
  const shift = ((((pose.facing === 'left' ? -offset : offset) % dash) + dash) % dash) * k;
  ops.push({ kind: 'line', a: v(-dash * k + shift, floorY), b: v(px + dash * k, floorY), width: c.sw(STROKE.hair, 'hair'), paint: 'trace', cap: 'butt', dash: [dash * 0.6 * k, dash * 0.4 * k], opacity: 1 });

  const contours = new Map<BodyGroup, Vec[][]>(BODY_GROUPS.map((g) => [g, groupContours(body, g).map(project)]));
  const cs = (g: BodyGroup): Vec[][] => contours.get(g) ?? [];
  // The torso and neck in output units (not the head: an arm in front of the face keeps its edge): arm edges over
  // them are soft occlusion edges (`softenOver`). The head is the trunk group's last contour.
  const trunkPx = cs('trunk').slice(0, -1);
  // The near arm(s) in output units: trunk lines keep clear of them (`clearOf`).
  const armPx = side ? cs('armNear') : [...cs('armNear'), ...cs('armFar')];
  const halo = (g: BodyGroup): DrawOp => pathOp(cs(g), { smooth: true, fill: 'background', stroke: 'background', width: 2 * c.sw(STROKE.halo, 'halo'), join: 'round' });

  const view = focusViewOf({ view: body.view, seenFrom: body.seenFrom });
  const focus = opts.muscles ? resolveFocus(opts.muscles, pose.focus ?? undefined, view) : null;
  // Supporting colour that can't read as an anatomical shape is left out (§4.3): forearm and grip tints below
  // `SUPPORT_DETAIL_MIN_PT` (spots on the hands), and any soft region under `SUPPORT_MIN_AREA_PT2` at the drawn size.
  const ptPerH = k / ptPx;
  const regions = (focus ? regionShapes(body, focus) : []).filter(
    (r) => r.level === 'strong' || ((pt >= SUPPORT_DETAIL_MIN_PT || !SMALL_SUPPORT.has(r.muscle)) && Math.abs(signedArea(r.contour)) * ptPerH * ptPerH * r.alpha >= SUPPORT_MIN_AREA_PT2),
  );
  // Muscle definition (§4.11): faint shapes for the groups the colour doesn't take, one opaque op per region group.
  const definition = effectiveDefinition(opts.definition ?? 'off', {
    tier,
    definitionCompact: opts.definitionCompact === true,
    increaseContrast: ic,
    differentiateWithoutColor: opts.differentiateWithoutColor === true,
    hasMuscles: hasListedMuscles(opts.muscles),
  });
  const faint = definition === 'off' ? [] : definitionShapes(body, definitionGroupsFor(view, focus, pose.focus?.hide ?? []));
  const faintOps = (g: RegionGroup): void => {
    // One gradient op per shape along its long axis, lit end strongest, both ends fading out (`definitionGradient`);
    // it never pulses. Shapes of one body group never overlap (the groove), so nothing stacks within a group.
    const paint = definition === 'tint' ? 'faintTint' : 'faintNeutral';
    for (const f of faint.filter((x) => x.group === g)) {
      const gr = definitionGradient(f);
      if (gr === null) continue;
      ops.push(pathOp([project(f.contour)], { smooth: true, gradient: { from: c.P(gr.from), to: c.P(gr.to), stops: gr.stops.map((st) => ({ at: st.at, paint, opacity: st.opacity })) } }));
    }
  };
  // What a region could otherwise stack on: faint shapes (any group) and, for strong, soft regions.
  const faintWorld = faint.map((f) => f.contour);
  const softWorld = regions.filter((r) => r.level === 'soft').map((r) => r.contour);
  const overlapsAny = (cs: readonly Vec[][], others: readonly Vec[][]): boolean => cs.some((c) => others.some((o) => polygonsWithin(c, o, 1e-9)));
  const regionOps = (g: RegionGroup): void => {
    for (const level of ['soft', 'strong'] as const) {
      // One op per level (merged, so overlapping regions never stack), split only while a segment fades with its projection.
      for (const [alpha, world] of byAlpha(regions.filter((r) => r.group === g && r.level === level).map((r) => ({ alpha: r.alpha, points: r.contour })))) {
        const rs = world.map(project);
        const opacity = muscleOpacity(level, { ...opts, definition }) * alpha;
        // A translucent region that would sit on a faint shape (definition on), or strong on soft during the pulse in any
        // mode (review N3; with definition off too, so one pixel never shows two violets, §4.3), gets an opaque body-tone
        // underlay of its own path: one paint per pixel (§4.11.6). Elsewhere (an opaque region, or nothing beneath) it would
        // change only the anti-aliased edge, and hide the trunk's lines under side-view pelvis regions.
        const underlay = opacity < 1 && ((definition !== 'off' && overlapsAny(world, faintWorld)) || (level === 'strong' && overlapsAny(world, softWorld)));
        if (underlay) ops.push(pathOp(rs, { smooth: true, fill: 'nearBody', opacity: alpha }));
        ops.push(pathOp(rs, { smooth: true, fill: 'muscle', opacity }));
        // Differentiate Without Color: strong regions also get a 1 pt outline in text.primary at 0.6.
        if (level === 'strong' && opts.differentiateWithoutColor === true) ops.push(pathOp(rs, { smooth: true, stroke: 'implement', width: ptPx, join: 'round', opacity: 0.6 * alpha }));
      }
    }
  };
  const lines = full ? anatomyLines(body) : [];

  /**
   * M/L outline contour, stroked under the fill so only its outer half shows.
   * Arm segments are open paths without their proximal cap (no seam across
   * the shoulder or inside the elbow; ADR 0015).
   */
  const contourOps = (g: BodyGroup): void => {
    const width = 2 * c.sw(STROKE.contour, 'contour');
    const opacity = ic ? 0.7 : 0.5;
    const strokes = groupStrokeContours(body, g);
    if (strokes.closed.length > 0) ops.push(pathOp(strokes.closed.map(project), { smooth: true, stroke: 'shade', width, join: 'round', opacity }));
    openStrokeOps(strokes.open, width, opacity, null);
  };
  /**
   * Open limb strokes (an arm's occlusion edge) fade out over their last
   * `TAPER_LENGTH` at both ends, where the segment joins its parent, in
   * `TAPER_STEPS` pieces: the edge stops softly at the shoulder and inside the
   * elbow instead of ending in a hard tick that crosses the deltoid line.
   */
  const openStrokeOps = (open: readonly Vec[][], width: number, opacity: number, cap: 'round' | null): void => {
    const pieces: { alpha: number; points: Vec[] }[] = [];
    for (const pts of open) pieces.push(...taperedPieces(pts.map(c.P), TAPER_LENGTH * k));
    for (const [alpha, ps] of byAlpha(softenOver(pieces, trunkPx, ARM_EDGE_RAMP * k))) ops.push(pathOp(ps, { closed: false, smooth: true, stroke: 'shade', width, join: 'round', cap, opacity: opacity * alpha }));
  };
  /**
   * S tier, arms: the occlusion edge where an arm crosses the body, as a thin
   * body-shade stroke under the arm (only its outer half shows), open at the
   * shoulder like the M/L contour. A background-colour halo here read as a
   * hole cut through the body at thumbnail size (light theme: a white loop).
   * Width scales with the drawn size: 0.6 pt visible at 115 pt, at most 1 pt.
   */
  const compactArmEdge = (g: BodyGroup): void => {
    const width = 2 * Math.min(1, COMPACT_ARM_EDGE_PT * (pt / COMPACT_REFERENCE_PT)) * ptPx;
    const strokes = groupStrokeContours(body, g);
    const opacity = ic ? 0.85 : 0.6;
    if (strokes.closed.length > 0) ops.push(pathOp(strokes.closed.map(project), { smooth: true, stroke: 'shade', width, join: 'round', opacity }));
    openStrokeOps(strokes.open, width, opacity, 'round');
  };
  /** The limb's own separation: S-tier halo (arms: a thin shade edge) or M/L contour. Legs drawn after the trunk emit it before the trunk instead. */
  const outline = (g: BodyGroup): void => {
    if (!full && (g === 'armNear' || g === 'armFar')) compactArmEdge(g);
    else if (!full && g !== 'trunk') ops.push(halo(g));
    if (full) contourOps(g);
  };

  const drawGroup = (g: BodyGroup, outlineDone = false, faintAlso: readonly RegionGroup[] = []): void => {
    const shapes = cs(g);
    if (shapes.length === 0) return;
    if (!outlineDone) outline(g);
    ops.push(pathOp(shapes, { smooth: true, fill: 'nearBody' }));
    faintOps(g);
    // Faint shapes drawn over this group (the side-view pelvis over the near thigh) go under its colour, never across it.
    for (const f of faintAlso) faintOps(f);
    regionOps(g);
    if (shading) {
      for (const band of shadeBands(body, g)) {
        ops.push(
          pathOp([project(band.contour)], {
            gradient: { from: c.P(band.from), to: c.P(band.to), stops: [{ at: 0, paint: 'shade', opacity: band.opacity }, { at: 1, paint: 'shade', opacity: 0 }] },
          }),
        );
      }
    }
    if (full && (g === 'legNear' || g === 'legFar')) {
      const soles = body.feet.filter((f) => f.group === g).map((f) => project(soleBand(f, body.view)));
      if (soles.length > 0) ops.push(pathOp(soles, { fill: 'shade', opacity: 0.35 }));
    }
    const groupLines = lines.filter((l) => l.group === g).map((l) => ({ alpha: l.alpha, points: l.points.map(c.P) }));
    // Arm lines over the torso or head fade out with the share of them that lies there; trunk lines stop short of the near arm instead of
    // running out from under it (with the arm's edge they read as a crossed X on the chest; visual review, round 4).
    const shown = g === 'armNear' || g === 'armFar' ? fadeOver(groupLines, cs('trunk')) : g === 'trunk' ? clearOf(groupLines, armPx, LINE_ARM_CLEARANCE * k) : groupLines;
    for (const [alpha, gl] of byAlpha(shown)) {
      ops.push(pathOp(gl, { closed: false, smooth: true, stroke: 'shade', width: c.sw(STROKE.hair, 'hair'), join: 'round', cap: 'round', opacity: (ic ? 0.5 : 0.35) * alpha }));
    }
  };

  emitLayer('back');
  if (side) {
    // Far limbs: flat, slightly narrower, with halos; no shading, contours or muscle colour.
    for (const g of ['legFar', 'armFar'] as const) {
      if (cs(g).length === 0) continue;
      ops.push(halo(g), pathOp(cs(g), { smooth: true, fill: 'farBody' }));
    }
  }
  emitLayer('far');
  const legs: BodyGroup[] = side ? ['legNear'] : ['legFar', 'legNear'];
  const arms: BodyGroup[] = side ? ['armNear'] : ['armFar', 'armNear'];
  // Seen from behind, the buttocks and the seat are nearer the camera than the legs: legs go first, under the mid props and the trunk.
  const legsFirst = !side && body.seenFrom === 'back';
  if (legsFirst) {
    for (const g of legs) {
      if (full && cs(g).length > 0) ops.push(halo(g));
      drawGroup(g);
    }
  }
  emitLayer('mid');
  const traceOp = (): void => {
    if (opts.trace && opts.trace.length > 1) {
      ops.push(pathOp([opts.trace.map(c.P)], { closed: false, stroke: 'trace', width: c.sw(0.005, 'edge'), cap: 'round', dash: [0.012 * k, 0.01 * k] }));
    }
  };
  // Seen from behind, the implement's path is on the far side of the body, like the bar itself: the trace goes with the mid props,
  // under the trunk and head, so it never reads as a path behind the neck (guides v2 review B1, §3.11).
  if (legsFirst) traceOp();
  // M/L: near-limb halos go under the trunk, so near limbs stand clear of the far side and props but not of their own body.
  if (full) for (const g of [...(legsFirst ? [] : legs), ...arms]) if (cs(g).length > 0) ops.push(halo(g));
  // Legs drawn over the trunk put their outline (S: halo, M/L: contour) under it too: the trunk fill hides the part
  // inside the pelvis, so the thigh joins the hip without a seam line, and the outline outside the trunk stays (ADR 0015).
  if (!legsFirst) for (const g of legs) if (cs(g).length > 0) outline(g);
  drawGroup('trunk');
  // Side view: the faint pelvis shapes go with the near leg, after its fill and before its colour, so a faint glute or
  // hip shape never cuts the quads into islands; the pelvis colour still goes after the leg, so the thigh doesn't cut
  // the glutes in half (§3.11 step 8).
  if (!legsFirst) for (const g of legs) drawGroup(g, true, side && g === 'legNear' ? ['pelvis'] : []);
  if (side) {
    if (legs.every((g) => cs(g).length === 0)) faintOps('pelvis');
    regionOps('pelvis');
  }
  for (const g of arms) drawGroup(g);
  emitLayer('body');
  emitLayer('near');
  // Side and front views: the static path overlay sits above the body and below front implements, so it stays visible.
  if (!legsFirst) traceOp();
  emitLayer('front');
  return ops;
}
