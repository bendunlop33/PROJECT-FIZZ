/**
 * Geometry built on the body's segment frames (guides v2 §3.7, §3.8, §4.4):
 * muscle regions, soft-shading bands and anatomical lines. Everything is in
 * segment coordinates, so it moves with the pose and stays inside the
 * segment's own outline by construction. Pure.
 */
import { add, pointInPolygon, scale, sub, v, type Vec } from './math';
import { chainOutline, frameAt, handContours, segmentPoint, trunkSegments, widthsAt, type BodyGroup, type BodySegment, type FigureBody } from './body';
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
  /** 0–1: fades out as its segment turns towards the camera (`projectionFade`). */
  alpha: number;
}

/**
 * How much of a segment's muscle colour and anatomical lines show at a
 * projection factor: none at 0.4 or below, all at 0.6 or above, smooth in
 * between. They used to vanish at 0.5 and blink as a limb swung past it
 * (ADR 0015); the ROM check still uses `UNCHECKED_PROJECTION`.
 */
export function projectionFade(projection: number): number {
  const x = Math.min(1, Math.max(0, (projection - 0.4) / 0.2));
  return x * x * (3 - 2 * x);
}

const taper = (s: number, s0: number, s1: number): number => Math.max(0, Math.sin((Math.PI * (s - s0)) / (s1 - s0))) ** 0.6;

function sampleRange(s0: number, s1: number, n = REGION_SAMPLES): number[] {
  return Array.from({ length: n }, (_, i) => s0 + ((s1 - s0) * i) / (n - 1));
}

/**
 * What a region is laid on: one body segment, or the whole trunk chain
 * (pelvis → lumbar → thorax) read as one segment, so a muscle that spans the
 * trunk is one smooth shape instead of a bead per segment.
 */
interface RegionBase {
  frame: (s: number) => { p: Vec; n: Vec };
  widths: (s: number) => { front: number; back: number };
}

const segmentBase = (seg: BodySegment): RegionBase => ({ frame: (s) => frameAt(seg, s), widths: (s) => widthsAt(seg, s) });

/**
 * The trunk chain as one region base. Chain position = segment index + local
 * `s`: pelvis −0.7…1 (its buttock end runs below the hip joint), lumbar 1…2,
 * thorax 2…3. The trunk outline is built from the same frames (blended normals
 * at the joints), so a chain region follows it without seams.
 */
function chainBase(chain: readonly BodySegment[]): RegionBase | null {
  if (chain.length === 0) return null;
  const at = (s: number): { seg: BodySegment; local: number } => {
    const i = Math.max(0, Math.min(chain.length - 1, Math.floor(s)));
    return { seg: chain[i] as BodySegment, local: s - i };
  };
  return {
    frame: (s) => {
      const { seg, local } = at(s);
      return frameAt(seg, local);
    },
    widths: (s) => {
      const { seg, local } = at(s);
      return widthsAt(seg, local);
    },
  };
}

/** Offset across the base at `s` (signed, along its front normal), clamped inside the inset outline. */
function across(base: RegionBase, s: number, off: number): Vec {
  const { p, n } = base.frame(s);
  const w = base.widths(s);
  const clamped = Math.min(w.front - MUSCLE_INSET, Math.max(-(w.back - MUSCLE_INSET), off));
  return add(p, scale(n, clamped));
}

/** Samples along a region: 12 per unit of `s`, at least 12 (a trunk-chain region spans up to 3.7 units). */
const samplesFor = (s0: number, s1: number): number => Math.max(REGION_SAMPLES, Math.ceil(REGION_SAMPLES * (s1 - s0)));

/** Edge band (§4.4): along one edge, tapering to the edge at both ends like a muscle belly. */
function edgeBand(base: RegionBase, x: 1 | -1, s0: number, s1: number, d: number): Vec[] {
  const ss = sampleRange(s0, s1, samplesFor(s0, s1));
  const outer = ss.map((s) => {
    const w = base.widths(s);
    return across(base, s, x > 0 ? w.front - MUSCLE_INSET : -(w.back - MUSCLE_INSET));
  });
  const inner = ss.map((s) => {
    const w = base.widths(s);
    const half = x > 0 ? w.front : w.back;
    const depth = d * half * taper(s, s0, s1);
    return across(base, s, x * Math.max(0, half - MUSCLE_INSET - depth));
  });
  return [...outer, ...inner.reverse()];
}

/** Face lens (§4.4): centred at `c` across the segment, `w` of its full width (each may run from one value at s0 to another at s1). */
function faceLens(base: RegionBase, s0: number, s1: number, c: readonly [number, number], w: readonly [number, number]): Vec[] {
  const ss = sampleRange(s0, s1, samplesFor(s0, s1));
  const upper: Vec[] = [];
  const lower: Vec[] = [];
  for (const s of ss) {
    const wd = base.widths(s);
    const k = (s - s0) / (s1 - s0);
    const ck = c[0] + (c[1] - c[0]) * k;
    const centre = ck >= 0 ? ck * wd.front : ck * wd.back;
    const half = ((w[0] + (w[1] - w[0]) * k) * (wd.front + wd.back)) / 2 * taper(s, s0, s1);
    upper.push(across(base, s, centre + half));
    lower.push(across(base, s, centre - half));
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

/**
 * One region spec on one base → contours. `trunk` is true for trunk segments
 * and the trunk chain: there a mirrored pair, or a front/back-view lat/med
 * band, gives two contours (one each side of the body).
 */
function specContours(base: RegionBase, trunk: boolean, spec: Exclude<RegionSpec, { kind: 'hand' }>): Vec[][] {
  const [s0, s1] = spec.s;
  if (spec.kind === 'edge') {
    const x = spec.surface === 'front' || spec.surface === 'lat' ? 1 : -1;
    // Front/back views: a trunk segment's lateral edge is both sides of the body.
    if (trunk && (spec.surface === 'lat' || spec.surface === 'med')) return [edgeBand(base, 1, s0, s1, spec.d), edgeBand(base, -1, s0, s1, spec.d)];
    return [edgeBand(base, x, s0, s1, spec.d)];
  }
  const out = [faceLens(base, s0, s1, spec.c, spec.w)];
  if (spec.mirror && trunk && spec.c.some((x) => x !== 0)) out.push(faceLens(base, s0, s1, [-spec.c[0], -spec.c[1]], spec.w));
  return out;
}

/** Every muscle region for this frame, grouped for draw order. Regions on far side-view limbs never appear. */
export function regionShapes(body: FigureBody, focus: ResolvedFocus): RegionShape[] {
  const sides = limbSides(body, focus);
  const out: RegionShape[] = [];
  const chain = chainBase(trunkSegments(body));
  for (const r of focus.regions) {
    if (r.spec.kind === 'hand') {
      for (const hand of body.hands) {
        if (!sides.includes(hand.side)) continue;
        const forearm = body.segments.find((s) => s.name === 'forearm' && s.side === hand.side);
        const alpha = forearm === undefined ? 1 : projectionFade(forearm.projection);
        if (alpha <= 0) continue;
        for (const c of handContours(hand, body.view)) out.push({ group: hand.group, level: r.level, contour: insetPolygon(counterClockwise(c), MUSCLE_INSET), alpha });
      }
      continue;
    }
    if (r.spec.seg === 'trunk') {
      // The whole trunk as one shape; drawn with the trunk (under the near leg), like the abs and lower back it carries.
      if (chain !== null) for (const contour of specContours(chain, true, r.spec)) out.push({ group: 'trunk', level: r.level, contour, alpha: 1 });
      continue;
    }
    for (const seg of segmentsFor(body, r.spec.seg, sides)) {
      const alpha = projectionFade(seg.projection);
      if (alpha <= 0) continue;
      for (const contour of specContours(segmentBase(seg), seg.side === null, r.spec)) out.push({ group: groupOf(body, seg), level: r.level, contour, alpha });
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
  /** The limb segment it shades (null for the trunk chain). */
  segment: SegmentName | null;
  contour: Vec[];
  from: Vec;
  to: Vec;
  /** Shade opacity at the edge (it fades to 0 at the band's inner edge). */
  opacity: number;
}

/** Depth of a shade band, as a fraction of the local half-width (§3.7). */
const BAND_DEPTH = 0.4;

/** Point on a region base: `x` across it (+1 front/lateral edge … −1 back/medial edge). */
function basePoint(base: RegionBase, s: number, x: number): Vec {
  const { p, n } = base.frame(s);
  const w = base.widths(s);
  return add(p, scale(n, x >= 0 ? x * w.front : x * w.back));
}

/** Share of a band's length over which it fades in and out at each end, so it never ends in a hard step. */
const BAND_FADE = 0.2;

/**
 * Soft shading bands (§3.7) for one body group: one per edge of each limb
 * segment, and one per edge of the whole trunk (the trunk chain, so the
 * shading runs through the waist without a step at each joint). Each band
 * fades to the edge at both ends instead of stopping square at a joint.
 * Side view: opacity 0.26 × clamp(0.2 − n·ℓ, 0, 1), continuous as a limb turns.
 * Front/back views: 0.18 on both lateral edges.
 */
export function shadeBands(body: FigureBody, group: BodyGroup): ShadeBand[] {
  const out: ShadeBand[] = [];
  /** `occluders`: the limb's other segments; each edge's band stops where its edge runs into one (no ghost edge at a crease). */
  const band = (base: RegionBase, segment: SegmentName | null, s0: number, s1: number, samples: number, occluders: readonly (readonly Vec[])[] = []): void => {
    const mid = (s0 + s1) / 2;
    for (const x of [1, -1] as const) {
      const nE = scale(base.frame(mid).n, x);
      const opacity = body.view === 'side' ? 0.26 * Math.min(1, Math.max(0, 0.2 - (nE.x * LIGHT.x + nE.y * LIGHT.y))) : 0.18;
      if (opacity < 0.01) continue;
      const range = clearRange(s0, s1, (s) => occluders.some((poly) => pointInPolygon(basePoint(base, s, x), poly)));
      if (range === null) continue;
      const [a, b] = range;
      const fade = (s: number): number => {
        const k = Math.min(s - a, b - s) / ((b - a) * BAND_FADE);
        const t = Math.min(1, Math.max(0, k));
        return t * t * (3 - 2 * t);
      };
      const ss = sampleRange(a, b, samples);
      const edge = ss.map((s) => basePoint(base, s, x));
      const inner = ss.map((s) => basePoint(base, s, x * (1 - BAND_DEPTH * fade(s))));
      out.push({ group, segment, contour: [...edge, ...inner.reverse()], from: basePoint(base, mid, x), to: basePoint(base, mid, x * (1 - BAND_DEPTH)), opacity });
    }
  };
  if (group === 'trunk') {
    const chain = trunkSegments(body);
    const base = chainBase(chain);
    const first = chain[0];
    const last = chain[chain.length - 1];
    if (base !== null && first !== undefined && last !== undefined) band(base, null, profileRange(first.profile)[0], chain.length - 1 + profileRange(last.profile)[1], 24);
    return out;
  }
  const limb = body.segments.filter((seg) => seg.group === group);
  for (const seg of limb) {
    const [, hi] = profileRange(seg.profile);
    band(segmentBase(seg), seg.name, 0, hi, 10, limb.filter((o) => o !== seg).map((o) => chainOutline([o])));
  }
  return out;
}

/** Fine steps used to find where a band's edge enters a neighbouring segment. */
const CLEAR_STEPS = 48;
/** A band shorter than this share of its segment range is dropped rather than drawn as a sliver. */
const MIN_BAND_SHARE = 0.15;

/**
 * The longest stretch of [s0, s1] where `blocked` is false, with its ends
 * refined by bisection (so a cut moves smoothly from frame to frame), or
 * null if that stretch is too short to draw.
 */
function clearRange(s0: number, s1: number, blocked: (s: number) => boolean): [number, number] | null {
  const ss = sampleRange(s0, s1, CLEAR_STEPS + 1);
  const free = ss.map((s) => !blocked(s));
  if (free.every((f) => f)) return [s0, s1];
  let best: [number, number] | null = null;
  for (let i = 0; i < ss.length; ) {
    if (free[i] !== true) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < ss.length && free[j + 1] === true) j += 1;
    if (best === null || j - i > best[1] - best[0]) best = [i, j];
    i = j + 1;
  }
  if (best === null) return null;
  const refine = (inside: number, outside: number): number => {
    let lo = inside;
    let hi = outside;
    for (let k = 0; k < 10; k += 1) {
      const m = (lo + hi) / 2;
      if (blocked(m)) hi = m;
      else lo = m;
    }
    return lo;
  };
  const a = best[0] > 0 ? refine(ss[best[0]] ?? s0, ss[best[0] - 1] ?? s0) : s0;
  const b = best[1] < ss.length - 1 ? refine(ss[best[1]] ?? s1, ss[best[1] + 1] ?? s1) : s1;
  return b - a >= MIN_BAND_SHARE * (s1 - s0) ? [a, b] : null;
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
  /** 0–1, the faintest of its segments' `projectionFade`. */
  alpha: number;
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
      let alpha = 1;
      for (const lp of line.points) {
        const seg = body.segments.find((s) => s.name === lp.seg && s.side === inst.side);
        if (seg === undefined) {
          alpha = 0;
          break;
        }
        alpha = Math.min(alpha, projectionFade(seg.projection));
        group = seg.group;
        pts.push(segmentPoint(seg, lp.s, lp.x * inst.flip, MUSCLE_INSET));
      }
      if (alpha > 0) out.push({ group, points: pts, alpha });
    }
  }
  return out;
}
