/**
 * Geometry built on the body's segment frames (guides v2 §3.7, §3.8, §4.4):
 * muscle regions, soft-shading bands and anatomical lines. Everything is in
 * segment coordinates, so it moves with the pose and stays inside the
 * segment's own outline by construction. Pure.
 */
import { add, scale, sub, v, type Vec } from './math';
import { frameAt, handContours, segmentPoint, widthsAt, type BodyGroup, type BodySegment, type FigureBody } from './body';
import { UNCHECKED_PROJECTION } from './pose';
import { profileRange, type SegmentName } from './profiles';
import type { MuscleLevel, RegionSpec, ResolvedFocus } from './muscle-map';
import { counterClockwise, signedArea } from './paths';

/** Muscle regions stay this far inside the silhouette (design-system `guide.muscleInset`). */
export const MUSCLE_INSET = 0.0035;
/** Samples along a region's length (§4.4). */
const REGION_SAMPLES = 12;

/** Draw-order groups: side-view pelvis regions go after the near leg (§3.11 step 8). */
export type RegionGroup = BodyGroup | 'pelvis';

export interface RegionShape {
  group: RegionGroup;
  level: MuscleLevel;
  contour: Vec[];
}

const taper = (s: number, s0: number, s1: number): number => Math.max(0, Math.sin((Math.PI * (s - s0)) / (s1 - s0))) ** 0.6;

function sampleRange(s0: number, s1: number, n = REGION_SAMPLES): number[] {
  return Array.from({ length: n }, (_, i) => s0 + ((s1 - s0) * i) / (n - 1));
}

/** Offset across the segment at `s` (signed, along its front normal), clamped inside the inset outline. */
function across(seg: BodySegment, s: number, off: number): Vec {
  const { p, n } = frameAt(seg, s);
  const w = widthsAt(seg, s);
  const clamped = Math.min(w.front - MUSCLE_INSET, Math.max(-(w.back - MUSCLE_INSET), off));
  return add(p, scale(n, clamped));
}

/** Edge band (§4.4): along one edge, tapering to the edge at both ends like a muscle belly. */
function edgeBand(seg: BodySegment, x: 1 | -1, s0: number, s1: number, d: number): Vec[] {
  const ss = sampleRange(s0, s1);
  const outer = ss.map((s) => {
    const w = widthsAt(seg, s);
    return across(seg, s, x > 0 ? w.front - MUSCLE_INSET : -(w.back - MUSCLE_INSET));
  });
  const inner = ss.map((s) => {
    const w = widthsAt(seg, s);
    const half = x > 0 ? w.front : w.back;
    const depth = d * half * taper(s, s0, s1);
    return across(seg, s, x * Math.max(0, half - MUSCLE_INSET - depth));
  });
  return [...outer, ...inner.reverse()];
}

/** Face lens (§4.4): centred at `c` across the segment, `w` of its full width. */
function faceLens(seg: BodySegment, s0: number, s1: number, c: number, w: readonly [number, number]): Vec[] {
  const ss = sampleRange(s0, s1);
  const upper: Vec[] = [];
  const lower: Vec[] = [];
  for (const s of ss) {
    const wd = widthsAt(seg, s);
    const centre = c >= 0 ? c * wd.front : c * wd.back;
    const k = (s - s0) / (s1 - s0);
    const half = ((w[0] + (w[1] - w[0]) * k) * (wd.front + wd.back)) / 2 * taper(s, s0, s1);
    upper.push(across(seg, s, centre + half));
    lower.push(across(seg, s, centre - half));
  }
  return [...upper, ...lower.reverse()];
}

/** A polygon shrunk by `d` along its vertex normals (small insets of near-convex shapes). */
export function insetPolygon(points: readonly Vec[], d: number): Vec[] {
  const ccw = signedArea(points) >= 0;
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n] ?? p;
    const b = points[(i + 1) % n] ?? p;
    const t = sub(b, a);
    const l = Math.hypot(t.x, t.y) || 1;
    // Inward normal: left of the tangent for a counter-clockwise polygon.
    const inward = ccw ? v(-t.y / l, t.x / l) : v(t.y / l, -t.x / l);
    return add(p, scale(inward, d));
  });
}

function limbSides(body: FigureBody, focus: ResolvedFocus): ('Near' | 'Far')[] {
  // Side view: near-side limbs only; far limbs stay flat (§4.6, GV5).
  if (body.view === 'side') return ['Near'];
  if (focus.side === 'near') return ['Near'];
  if (focus.side === 'far') return ['Far'];
  return ['Near', 'Far'];
}

function segmentsFor(body: FigureBody, name: SegmentName, sides: readonly ('Near' | 'Far')[]): BodySegment[] {
  return body.segments.filter((s) => s.name === name && (s.side === null || sides.includes(s.side)));
}

function groupOf(body: FigureBody, seg: BodySegment): RegionGroup {
  if (seg.name === 'pelvis' && body.view === 'side') return 'pelvis';
  return seg.group;
}

/** One region spec on one segment → contours (a mirrored trunk pair or trunk lat/med band gives two). */
function specContours(seg: BodySegment, spec: Exclude<RegionSpec, { kind: 'hand' }>): Vec[][] {
  if (seg.projection < UNCHECKED_PROJECTION) return [];
  const [s0, s1] = spec.s;
  if (spec.kind === 'edge') {
    const x = spec.surface === 'front' || spec.surface === 'lat' ? 1 : -1;
    // Front/back views: a trunk segment's lateral edge is both sides of the body.
    if (seg.side === null && (spec.surface === 'lat' || spec.surface === 'med')) return [edgeBand(seg, 1, s0, s1, spec.d), edgeBand(seg, -1, s0, s1, spec.d)];
    return [edgeBand(seg, x, s0, s1, spec.d)];
  }
  const out = [faceLens(seg, s0, s1, spec.c, spec.w)];
  if (spec.mirror && seg.side === null && spec.c !== 0) out.push(faceLens(seg, s0, s1, -spec.c, spec.w));
  return out;
}

/** Every muscle region for this frame, grouped for draw order. Regions on far side-view limbs never appear. */
export function regionShapes(body: FigureBody, focus: ResolvedFocus): RegionShape[] {
  const sides = limbSides(body, focus);
  const out: RegionShape[] = [];
  for (const r of focus.regions) {
    if (r.spec.kind === 'hand') {
      for (const hand of body.hands) {
        if (!sides.includes(hand.side)) continue;
        const forearm = body.segments.find((s) => s.name === 'forearm' && s.side === hand.side);
        if (forearm !== undefined && forearm.projection < UNCHECKED_PROJECTION) continue;
        for (const c of handContours(hand, body.view)) out.push({ group: hand.group, level: r.level, contour: insetPolygon(counterClockwise(c), MUSCLE_INSET) });
      }
      continue;
    }
    for (const seg of segmentsFor(body, r.spec.seg, sides)) {
      for (const contour of specContours(seg, r.spec)) out.push({ group: groupOf(body, seg), level: r.level, contour });
    }
  }
  return out;
}

/** Light direction for shading (§3.7), in the facing-right frame: above and slightly in front. */
export const LIGHT: Vec = (() => {
  const l = Math.hypot(0.35, 1);
  return v(0.35 / l, 1 / l);
})();

export interface ShadeBand {
  group: BodyGroup;
  contour: Vec[];
  from: Vec;
  to: Vec;
  /** Shade opacity at the edge (it fades to 0 at the band's inner edge). */
  opacity: number;
}

/** Depth of a shade band, as a fraction of the local half-width (§3.7). */
const BAND_DEPTH = 0.4;

/**
 * Soft shading bands (§3.7) for one body group: one per segment edge.
 * Side view: opacity 0.26 × clamp(0.2 − n·ℓ, 0, 1), continuous as a limb turns.
 * Front/back views: 0.18 on both lateral edges.
 */
export function shadeBands(body: FigureBody, group: BodyGroup): ShadeBand[] {
  const out: ShadeBand[] = [];
  for (const seg of body.segments) {
    if (seg.group !== group || seg.name === 'neck') continue;
    const [lo, hi] = profileRange(seg.profile);
    const s0 = Math.max(lo, seg.side === null ? lo : 0);
    const s1 = hi;
    const mid = (s0 + s1) / 2;
    for (const x of [1, -1] as const) {
      const nE = scale(frameAt(seg, mid).n, x);
      const opacity = body.view === 'side' ? 0.26 * Math.min(1, Math.max(0, 0.2 - (nE.x * LIGHT.x + nE.y * LIGHT.y))) : 0.18;
      if (opacity < 0.01) continue;
      const ss = sampleRange(s0, s1, 8);
      const edge = ss.map((s) => segmentPoint(seg, s, x));
      const inner = ss.map((s) => segmentPoint(seg, s, x * (1 - BAND_DEPTH)));
      out.push({ group, contour: [...edge, ...inner.reverse()], from: segmentPoint(seg, mid, x), to: segmentPoint(seg, mid, x * (1 - BAND_DEPTH)), opacity });
    }
  }
  return out;
}

/** A point of an anatomical line: segment, position along it, and `x` across it (+1 front/lateral edge … −1 back/medial). */
interface LinePoint {
  seg: SegmentName;
  s: number;
  x: number;
}
interface AnatomyLine {
  name: string;
  /** Limb lines repeat on each coloured-side limb; trunk lines are drawn once (a `mirror` pair twice). */
  limb: boolean;
  mirror?: boolean;
  points: readonly LinePoint[];
}

const P = (seg: SegmentName, s: number, x: number): LinePoint => ({ seg, s, x });
/** Side-view depth (0 front edge … 1 back edge, §3.8) to `x`, kept just inside the outline. */
const D = (seg: SegmentName, s: number, depth: number): LinePoint => P(seg, s, Math.max(-0.92, Math.min(0.92, 1 - 2 * depth)));

/**
 * Anatomical lines (§3.8): at most 8 per figure. Front view drops the
 * kneecap ovals and back view the calf lines to stay within that cap.
 */
export const ANATOMY_LINES: Record<'side' | 'front' | 'back', readonly AnatomyLine[]> = {
  side: [
    { name: 'deltoid', limb: true, points: [D('upperArm', 0.38, 0), D('upperArm', 0.45, 0.5), D('upperArm', 0.32, 1)] },
    { name: 'chest', limb: false, points: [D('thorax', 0.45, 0), D('thorax', 0.55, 0.3), D('thorax', 0.62, 0.5)] },
    { name: 'shoulderBlade', limb: false, points: [D('thorax', 0.85, 0.65), D('thorax', 0.7, 0.62), D('thorax', 0.55, 0.7)] },
    { name: 'gluteFold', limb: false, points: [D('pelvis', -0.6, 0.95), D('pelvis', -0.65, 0.7), D('pelvis', -0.55, 0.55)] },
    { name: 'kneecap', limb: true, points: [P('thigh', 0.95, 0.88), P('thigh', 1, 0.55), P('shank', 0.06, 0.88)] },
    { name: 'calf', limb: true, points: [D('shank', 0.15, 0.85), D('shank', 0.4, 0.75), D('shank', 0.62, 1)] },
    { name: 'iliacCrest', limb: false, points: [D('pelvis', 0.6, 0.15), D('pelvis', 0.65, 0.5), D('pelvis', 0.55, 0.85)] },
  ],
  front: [
    { name: 'deltoid', limb: true, points: [P('upperArm', 0.35, 0.9), P('upperArm', 0.33, 0), P('upperArm', 0.25, -0.9)] },
    { name: 'chest', limb: false, mirror: true, points: [P('thorax', 0.5, 0.04), P('thorax', 0.55, 0.4), P('thorax', 0.62, 0.9)] },
    { name: 'abs', limb: false, points: [P('lumbar', 0, 0), P('lumbar', 1, 0), P('thorax', 0.4, 0)] },
    { name: 'collarbone', limb: false, mirror: true, points: [P('thorax', 0.96, 0.35), P('thorax', 0.955, 0.65), P('thorax', 0.94, 0.95)] },
  ],
  back: [
    { name: 'deltoid', limb: true, points: [P('upperArm', 0.35, 0.9), P('upperArm', 0.33, 0), P('upperArm', 0.25, -0.9)] },
    { name: 'shoulderBlade', limb: false, mirror: true, points: [P('thorax', 0.88, 0.4), P('thorax', 0.72, 0.3), P('thorax', 0.55, 0.2)] },
    { name: 'spine', limb: false, points: [P('lumbar', 0, 0), P('lumbar', 1, 0), P('thorax', 0.85, 0)] },
    { name: 'gluteFold', limb: false, mirror: true, points: [P('pelvis', -0.6, 0.05), P('pelvis', -0.62, 0.4), P('pelvis', -0.6, 0.8)] },
  ],
};

export interface LineShape {
  group: BodyGroup;
  points: Vec[];
}

/** Anatomical lines for the drawn limbs (near only in a side view) and the trunk. */
export function anatomyLines(body: FigureBody): LineShape[] {
  const key = body.view === 'side' ? 'side' : body.seenFrom;
  const sides: ('Near' | 'Far')[] = body.view === 'side' ? ['Near'] : ['Near', 'Far'];
  const out: LineShape[] = [];
  for (const line of ANATOMY_LINES[key]) {
    const instances: { side: 'Near' | 'Far' | null; flip: number }[] = line.limb
      ? sides.map((side) => ({ side, flip: 1 }))
      : [{ side: null, flip: 1 }, ...(line.mirror ? [{ side: null, flip: -1 }] : [])];
    for (const inst of instances) {
      const pts: Vec[] = [];
      let group: BodyGroup = 'trunk';
      let hidden = false;
      for (const lp of line.points) {
        const seg = body.segments.find((s) => s.name === lp.seg && s.side === inst.side);
        if (seg === undefined) {
          hidden = true;
          break;
        }
        if (seg.projection < UNCHECKED_PROJECTION) hidden = true;
        group = seg.group;
        pts.push(segmentPoint(seg, lp.s, lp.x * inst.flip, MUSCLE_INSET));
      }
      if (!hidden) out.push({ group, points: pts });
    }
  }
  return out;
}
