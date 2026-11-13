/**
 * Geometry built on the body's segment frames (guides v2 §3.7, §3.8, §4.4):
 * muscle regions, soft-shading bands and anatomical lines. Everything is in
 * segment coordinates, so it moves with the pose and stays inside the
 * segment's own outline by construction. Pure.
 */
import { add, bounds, dist, pointInPolygon, pointSegmentDistance, polygonGap, scale, sub, v, type Vec } from './math';
import { chainOutline, edgeCurve, frameAt, handContours, segmentPoint, trunkSegments, widthsAt, type BodyGroup, type BodySegment, type FigureBody } from './body';
import { profileRange, type SegmentName } from './profiles';
import { DEFINITION_FOLDS, DEFINITION_MAP, type DefinitionGroup, type FocusView, type MuscleLevel, type RegionEnds, type RegionSpec, type ResolvedFocus } from './muscle-map';
import { counterClockwise, signedArea } from './paths';
import type { Muscle } from '../vocab';

/** Muscle regions stay this far inside the silhouette (design-system `guide.muscleInset`). */
export const MUSCLE_INSET = 0.0035;
/**
 * Plain body tone between two faint definition shapes of one body group
 * (design-system `guide.definitionGroove`, guides v2 §4.11.3): the target, in H
 * (about 1.2 pt at 240 pt), and the floor the tests and `guide:check` hold.
 */
export const DEFINITION_GROOVE = 0.006;
export const DEFINITION_GROOVE_FLOOR = 0.004;
/** Samples along a region's length (§4.4). */
const REGION_SAMPLES = 12;

/** Draw-order groups: side-view pelvis regions go after the near leg (§3.11 step 8). */
export type RegionGroup = BodyGroup | 'pelvis';

export interface RegionShape {
  group: RegionGroup;
  level: MuscleLevel;
  /** The muscle the region colours. */
  muscle: Muscle;
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

/** A region's cross-section at `s` for a taper value: its two boundary points (edge band: edge, inner; lens: upper, lower). */
type Section = (s: number, t: number) => readonly [Vec, Vec];

/** Edge band cross-section (§4.4): the edge (inset), and a point `d × half-width × taper` in from it. */
function edgeSection(base: RegionBase, x: 1 | -1, d: number): Section {
  return (s, t) => {
    const w = base.widths(s);
    const half = x > 0 ? w.front : w.back;
    const outer = across(base, s, x > 0 ? w.front - MUSCLE_INSET : -(w.back - MUSCLE_INSET));
    const depth = d * half * t;
    return [outer, across(base, s, x * Math.max(0, half - MUSCLE_INSET - depth))];
  };
}

/** Face lens cross-section (§4.4): centred at `c`, `w` of the full width (each may run from one value at s0 to another at s1). */
function lensSection(base: RegionBase, s0: number, s1: number, c: readonly [number, number], w: readonly [number, number]): Section {
  return (s, t) => {
    const wd = base.widths(s);
    const k = (s - s0) / (s1 - s0);
    const ck = c[0] + (c[1] - c[0]) * k;
    const centre = ck >= 0 ? ck * wd.front : ck * wd.back;
    const half = ((w[0] + (w[1] - w[0]) * k) * (wd.front + wd.back)) / 2 * t;
    return [across(base, s, centre + half), across(base, s, centre - half)];
  };
}

/** A region's cross-section with the taper that runs along it (0 at a pointed end, 1 in the belly), plus extra samples for rounded caps. */
interface Sweep {
  section: Section;
  s: readonly [number, number];
  blunt: RegionEnds;
  tau: (s: number) => number;
  extra: readonly number[];
  /** Length of a rounded cap at `s`, in s units (also used where a fold cuts the shape short). */
  capAt: (s: number) => number;
}

/** Quarter ellipse from 0 at a blunt end to 1 one cap length in (`x` in cap lengths). */
const capRamp = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : Math.sqrt(1 - (1 - x) ** 2));
/** Where a rounded cap is sampled, in cap lengths from the end (the even samples alone would facet it). */
const CAP_SAMPLES = [0.03, 0.1, 0.2, 0.35, 0.55, 0.78];

/**
 * The taper of a region over `s0–s1` (§4.4): `τ(s) = sin(π·(s − s0)/(s1 − s0))^0.6`,
 * so both ends come to a point like a muscle belly. A **blunt** end (`blunt0`,
 * `blunt1`) instead keeps the full width up to the middle and rounds off over
 * one cap length: the shape's half-width there for a lens (about a
 * semicircle), its depth for an edge band (a quarter circle into the edge).
 */
function sweepOf(base: RegionBase, section: Section, s0: number, s1: number, blunt: RegionEnds | undefined, capScale: number): Sweep {
  const ends: RegionEnds = blunt ?? [false, false];
  const capAt = (s: number): number => {
    const [p, q] = section(s, 1);
    const ds = 1e-3;
    const hPerS = dist(base.frame(s - ds / 2).p, base.frame(s + ds / 2).p) / ds;
    return Math.max(1e-6, (dist(p, q) * capScale) / Math.max(hPerS, 1e-9));
  };
  if (!ends[0] && !ends[1]) return { section, s: [s0, s1], blunt: ends, tau: (s) => taper(s, s0, s1), extra: [], capAt };
  const mid = (s0 + s1) / 2;
  const cap0 = ends[0] ? Math.min(mid - s0, capAt(s0)) : 0;
  const cap1 = ends[1] ? Math.min(mid - s0, capAt(s1)) : 0;
  const tau = (s: number): number => (s < mid ? (ends[0] ? capRamp((s - s0) / cap0) : taper(s, s0, s1)) : ends[1] ? capRamp((s1 - s) / cap1) : taper(s, s0, s1));
  const extra = [...(ends[0] ? CAP_SAMPLES.map((x) => s0 + x * cap0) : []), ...(ends[1] ? CAP_SAMPLES.map((x) => s1 - x * cap1) : [])];
  return { section, s: [s0, s1], blunt: ends, tau, extra, capAt };
}

/**
 * A region swept along its `s0–s1`, tapering (or rounding off, at a blunt
 * end) like a muscle belly. `span` (a shape cut short at a folded joint)
 * keeps it to a sub-range, never growing past the full shape: each cut end
 * is a rounded cap, so two shapes cut at one fold end side by side instead
 * of in arrowheads. An end that wasn't cut keeps its own shape.
 */
function sweep(sw: Sweep, span?: readonly [number, number]): Vec[] {
  const [s0, s1] = sw.s;
  const [a, b] = span ?? [s0, s1];
  const m = (a + b) / 2;
  const cutA = span !== undefined && a > s0;
  const cutB = span !== undefined && b < s1;
  const capA = cutA ? Math.min(m - a, sw.capAt(a)) : 0;
  const capB = cutB ? Math.min(m - a, sw.capAt(b)) : 0;
  const cut = (s: number): number => (s < m ? (cutA ? capRamp((s - a) / capA) : 1) : cutB ? capRamp((b - s) / capB) : 1);
  const caps = [...(cutA ? CAP_SAMPLES.map((x) => a + x * capA) : []), ...(cutB ? CAP_SAMPLES.map((x) => b - x * capB) : [])];
  const ss = [...new Set([...sampleRange(a, b, samplesFor(a, b)), ...[...sw.extra, ...caps].filter((s) => s > a && s < b)])].sort((p, q) => p - q);
  const pairs = ss.map((s) => sw.section(s, Math.min(sw.tau(s), cut(s))));
  return [...pairs.map((p) => p[0]), ...pairs.map((p) => p[1]).reverse()];
}

/** Edge band sweep (§4.4): along one edge, tapering to the edge at both ends like a muscle belly. */
const edgeSweep = (base: RegionBase, x: 1 | -1, s0: number, s1: number, d: number, blunt?: RegionEnds): Sweep => sweepOf(base, edgeSection(base, x, d), s0, s1, blunt, 0.5);

/** Face lens sweep (§4.4): centred at `c` across the segment, `w` of its full width (each may run from one value at s0 to another at s1). */
const lensSweep = (base: RegionBase, s0: number, s1: number, c: readonly [number, number], w: readonly [number, number], blunt?: RegionEnds): Sweep =>
  sweepOf(base, lensSection(base, s0, s1, c, w), s0, s1, blunt, 0.5);

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
 * band, gives two contours (one each side of the body). `span` limits a limb
 * region to part of its range (definition shapes at a folded joint).
 */
function specContours(base: RegionBase, trunk: boolean, spec: Exclude<RegionSpec, { kind: 'hand' }>, span?: readonly [number, number]): Vec[][] {
  const [s0, s1] = spec.s;
  if (spec.kind === 'edge') {
    // Front/back views: a trunk segment's lateral edge is both sides of the body.
    if (trunk && (spec.surface === 'lat' || spec.surface === 'med')) return [sweep(edgeSweep(base, 1, s0, s1, spec.d, spec.blunt)), sweep(edgeSweep(base, -1, s0, s1, spec.d, spec.blunt))];
    return [sweep(limbSweep(base, spec), span)];
  }
  const out = [sweep(limbSweep(base, spec), span)];
  if (spec.mirror && trunk && spec.c.some((x) => x !== 0)) out.push(sweep(lensSweep(base, s0, s1, [-spec.c[0], -spec.c[1]], spec.w, spec.blunt)));
  return out;
}

/** A region's (first) sweep: its band or lens, for drawing and for the fold test (limb regions are one, never mirrored). */
function limbSweep(base: RegionBase, spec: Exclude<RegionSpec, { kind: 'hand' }>): Sweep {
  if (spec.kind === 'edge') return edgeSweep(base, spec.surface === 'front' || spec.surface === 'lat' ? 1 : -1, spec.s[0], spec.s[1], spec.d, spec.blunt);
  return lensSweep(base, spec.s[0], spec.s[1], spec.c, spec.w, spec.blunt);
}

/**
 * What a neighbouring segment of the same limb must keep clear of at a fold:
 * `seg`'s outline without its end caps, and without a groove-wide strip at
 * the joint it shares with that neighbour (`shared`). Faint shapes never
 * reach into that strip, and leaving it out means a straight joint cuts
 * nothing: shapes change only where the limb really folds.
 */
function foldOutline(seg: BodySegment, shared: 'start' | 'end' | null): Vec[] {
  const [lo, hi] = profileRange(seg.profile);
  const strip = DEFINITION_GROOVE / Math.max(seg.length, 1e-9);
  const from = shared === 'start' ? Math.max(lo, strip) : lo;
  const to = shared === 'end' ? Math.min(hi, 1 - strip) : hi;
  return [...edgeCurve(seg, 1, from, to), ...edgeCurve(seg, -1, from, to).reverse()];
}

/** Which end of `other` joins `seg` (the elbow is the upper arm's end and the forearm's start), if either. */
function sharedEnd(other: BodySegment, seg: BodySegment): 'start' | 'end' | null {
  if (dist(other.j1, seg.j0) < 1e-9) return 'end';
  if (dist(other.j0, seg.j1) < 1e-9) return 'start';
  return null;
}

/** A polygon with its bounds, for repeated nearness tests. */
interface Occluder {
  poly: Vec[];
  box: ReturnType<typeof bounds>;
}

/** `p` lies inside the occluder or within `d` of its edge. */
function nearOccluder(p: Vec, o: Occluder, d: number): boolean {
  const { box, poly } = o;
  if (p.x < box.minX - d || p.x > box.maxX + d || p.y < box.minY - d || p.y > box.maxY + d) return false;
  if (pointInPolygon(p, poly)) return true;
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % n] ?? a;
    // An edge wholly `d` or more away on one axis can't be within `d` (exact; skips most edges).
    if ((a.x <= p.x - d && b.x <= p.x - d) || (a.x >= p.x + d && b.x >= p.x + d) || (a.y <= p.y - d && b.y <= p.y - d) || (a.y >= p.y + d && b.y >= p.y + d)) continue;
    if (pointSegmentDistance(p, a, b) < d) return true;
  }
  return false;
}

/** A limb shape cut shorter than this share of its range is dropped (it has tapered to a sliver by then). */
const MIN_DEFINITION_SHARE = 0.04;
/** First-pass samples of the fold test (the cut is then refined by bisection, so it still moves smoothly). */
const DEFINITION_CLEAR_STEPS = 24;

type LimbSpec = Exclude<RegionSpec, { kind: 'hand' }>;

/** A limb shape's contours after the fold cut: unchanged, cut short, or null (nothing left). */
type FoldClip = (seg: BodySegment, spec: LimbSpec, contours: Vec[][]) => Vec[][] | null;

/**
 * Limb shapes stop short of the limb's other segments, so a folded elbow or
 * knee keeps a groove of body tone between the shapes either side of it
 * (§4.11.3), like the shading bands (ADR 0015). Straight limbs (the whole
 * shape already clear) are unchanged. The cut is found by bisection, so it
 * moves smoothly and a shape shrinks rather than pops. Used for faint shapes
 * and for muscle regions: two coloured bands meeting in a tight fold made
 * arrowhead spikes (the one-arm row's elbow; visual review of 9 Oct 2026).
 */
function foldClipper(body: FigureBody): FoldClip {
  const outlines = new Map<string, Occluder>();
  const outlineOf = (other: BodySegment, seg: BodySegment): Occluder => {
    const shared = sharedEnd(other, seg);
    const key = `${other.name}|${other.side ?? ''}|${shared ?? ''}`;
    let o = outlines.get(key);
    if (o === undefined) {
      const poly = foldOutline(other, shared);
      o = { poly, box: bounds(poly) };
      outlines.set(key, o);
    }
    return o;
  };
  return (seg, spec, contours) => {
    const box = bounds(contours.flat());
    const groove = DEFINITION_GROOVE;
    const near = body.segments
      .filter((o) => o !== seg && o.group === seg.group)
      .map((o) => outlineOf(o, seg))
      .filter((o) => !(o.box.minX > box.maxX + groove || box.minX > o.box.maxX + groove || o.box.minY > box.maxY + groove || box.minY > o.box.maxY + groove));
    if (near.length === 0) return contours;
    const base = segmentBase(seg);
    const sw = limbSweep(base, spec);
    const [s0, s1] = spec.s;
    const blocked = (s: number): boolean => sw.section(s, sw.tau(s)).some((p) => near.some((o) => nearOccluder(p, o, groove)));
    const range = clearRange(s0, s1, blocked, MIN_DEFINITION_SHARE, DEFINITION_CLEAR_STEPS);
    if (range === null) return null;
    return range[0] > s0 || range[1] < s1 ? specContours(base, false, spec, range) : contours;
  };
}

/** A region spec drawn on one frame's body: its contours, draw-order group and projection fade. */
interface SpecShape {
  group: RegionGroup;
  contour: Vec[];
  alpha: number;
}

/**
 * Contours of one region spec on the given limb sides (§4.4). Trunk-chain
 * regions are one shape drawn with the trunk; limb regions repeat on each
 * side, fade out as their segment turns towards the camera, and stop short
 * of the limb's other segments at a fold (`clip`).
 */
function specShapes(body: FigureBody, spec: RegionSpec, sides: readonly ('Near' | 'Far')[], chain: RegionBase | null, clip: FoldClip): SpecShape[] {
  const out: SpecShape[] = [];
  if (spec.kind === 'hand') {
    for (const hand of body.hands) {
      if (!sides.includes(hand.side)) continue;
      const forearm = body.segments.find((s) => s.name === 'forearm' && s.side === hand.side);
      const alpha = forearm === undefined ? 1 : projectionFade(forearm.projection);
      if (alpha <= 0) continue;
      for (const c of handContours(hand, body.view)) out.push({ group: hand.group, contour: insetPolygon(counterClockwise(c), MUSCLE_INSET), alpha });
    }
    return out;
  }
  if (spec.seg === 'trunk') {
    // The whole trunk as one shape; drawn with the trunk (under the near leg), like the abs and lower back it carries.
    if (chain !== null) for (const contour of specContours(chain, true, spec)) out.push({ group: 'trunk', contour, alpha: 1 });
    return out;
  }
  for (const seg of segmentsFor(body, spec.seg, sides)) {
    const alpha = projectionFade(seg.projection);
    if (alpha <= 0) continue;
    const trunk = seg.side === null;
    const all = specContours(segmentBase(seg), trunk, spec);
    const contours = trunk ? all : clip(seg, spec, all);
    for (const contour of contours ?? []) out.push({ group: groupOf(body, seg), contour, alpha });
  }
  return out;
}

/** Every muscle region for this frame, grouped for draw order. Regions on far side-view limbs never appear. */
export function regionShapes(body: FigureBody, focus: ResolvedFocus): RegionShape[] {
  const sides = limbSides(body, focus);
  const chain = chainBase(trunkSegments(body));
  const clip = foldClipper(body);
  return focus.regions.flatMap((r) => specShapes(body, r.spec, sides, chain, clip).map((sh) => ({ ...sh, level: r.level, muscle: r.muscle })));
}

/** One faint muscle-definition shape (guides v2 §4.11). */
export interface DefinitionShape {
  definition: DefinitionGroup;
  group: RegionGroup;
  contour: Vec[];
  /** 0–1, the segment's `projectionFade` (trunk shapes are always 1). */
  alpha: number;
}

/** The focus view a body is drawn in. */
export const bodyFocusView = (body: FigureBody): FocusView => (body.view === 'side' ? 'side' : body.seenFrom);

/**
 * Faint shapes of the given definition groups for this frame (§4.11.3,
 * §4.11.5), built like the muscle regions. Side view: near limbs and the
 * trunk only (far limbs stay flat). Front and back views: both sides,
 * whatever `focus.side` says, because definition is anatomy.
 */
export function definitionShapes(body: FigureBody, groups: readonly DefinitionGroup[]): DefinitionShape[] {
  const view = bodyFocusView(body);
  const sides: ('Near' | 'Far')[] = body.view === 'side' ? ['Near'] : ['Near', 'Far'];
  const chain = chainBase(trunkSegments(body));
  const clip = foldClipper(body);
  // Folds (§4.11.3): while all their groups are faint, one shape stands for them, drawn as the first group.
  const folds = DEFINITION_FOLDS.filter((f) => f.view === view && f.groups.every((g) => groups.includes(g)));
  const specsOf = (g: DefinitionGroup): readonly RegionSpec[] => {
    const fold = folds.find((f) => f.groups.includes(g));
    if (fold === undefined) return DEFINITION_MAP[g][view] ?? [];
    return fold.groups[0] === g ? [fold.region] : [];
  };
  return groups.flatMap((g) => specsOf(g).flatMap((spec) => specShapes(body, spec, sides, chain, clip).map((sh) => ({ definition: g, ...sh }))));
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
    const boxes = occluders.map((poly) => ({ poly, box: bounds(poly) }));
    for (const x of [1, -1] as const) {
      const nE = scale(base.frame(mid).n, x);
      const opacity = body.view === 'side' ? 0.26 * Math.min(1, Math.max(0, 0.2 - (nE.x * LIGHT.x + nE.y * LIGHT.y))) : 0.18;
      if (opacity < 0.01) continue;
      const range: [number, number] | null =
        boxes.length === 0
          ? [s0, s1]
          : clearRange(s0, s1, (s) => {
              const q = basePoint(base, s, x);
              return boxes.some((o) => q.x >= o.box.minX && q.x <= o.box.maxX && q.y >= o.box.minY && q.y <= o.box.maxY && pointInPolygon(q, o.poly));
            });
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
function clearRange(s0: number, s1: number, blocked: (s: number) => boolean, minShare = MIN_BAND_SHARE, steps = CLEAR_STEPS): [number, number] | null {
  const ss = sampleRange(s0, s1, steps + 1);
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
  return b - a >= minShare * (s1 - s0) ? [a, b] : null;
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

/** Knee flexion (degrees) of one leg from its thigh and shank axes; 0 without both. */
function kneeFlexion(body: FigureBody, side: 'Near' | 'Far' | null): number {
  const thigh = body.segments.find((s) => s.name === 'thigh' && s.side === side);
  const shank = body.segments.find((s) => s.name === 'shank' && s.side === side);
  if (thigh === undefined || shank === undefined) return 0;
  const c = thigh.u.x * shank.u.x + thigh.u.y * shank.u.y;
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * The kneecap line fades out between 55° and 70° of knee flexion: past that
 * the thigh and shank outlines round the knee and the short stroke across
 * them reads as a kink (review of 10 Oct 2026).
 */
export function kneecapFade(body: FigureBody, side: 'Near' | 'Far' | null): number {
  const x = Math.min(1, Math.max(0, (kneeFlexion(body, side) - KNEECAP_FADE_DEG[0]) / (KNEECAP_FADE_DEG[1] - KNEECAP_FADE_DEG[0])));
  return 1 - x * x * (3 - 2 * x);
}
export const KNEECAP_FADE_DEG = [55, 70] as const;

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
        if (line.name === 'kneecap') alpha = Math.min(alpha, kneecapFade(body, inst.side));
        group = seg.group;
        pts.push(segmentPoint(seg, lp.s, lp.x * inst.flip, MUSCLE_INSET));
      }
      if (alpha > 0) out.push({ group, points: pts, alpha });
    }
  }
  return out;
}

/** The narrowest groove between two faint shapes of one body group in a frame (side-view pelvis shapes belong to the trunk). */
export interface DefinitionGroove {
  /** H; 0 when they overlap. */
  gap: number;
  a: DefinitionGroup;
  b: DefinitionGroup;
  group: BodyGroup;
}

/**
 * Within each body group (the trunk, one leg, one arm), the closest pair of
 * faint shapes (§4.11.3: never overlapping, at least `DEFINITION_GROOVE`
 * apart). Shapes in different body groups may overlap: the nearer one is
 * drawn in front, and faint fills are opaque. Null with fewer than two shapes.
 */
export function narrowestDefinitionGroove(shapes: readonly DefinitionShape[]): DefinitionGroove | null {
  let best: DefinitionGroove | null = null;
  const bodyGroup = (g: RegionGroup): BodyGroup => (g === 'pelvis' ? 'trunk' : g);
  const boxes = shapes.map((sh) => bounds(sh.contour));
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      const a = shapes[i] as DefinitionShape;
      const b = shapes[j] as DefinitionShape;
      if (bodyGroup(a.group) !== bodyGroup(b.group)) continue;
      // The boxes' gap is a lower bound: a pair that can't beat the narrowest so far is skipped.
      const ba = boxes[i] as ReturnType<typeof bounds>;
      const bb = boxes[j] as ReturnType<typeof bounds>;
      const bound = Math.hypot(Math.max(0, ba.minX - bb.maxX, bb.minX - ba.maxX), Math.max(0, ba.minY - bb.maxY, bb.minY - ba.maxY));
      if (best !== null && bound >= best.gap) continue;
      const gap = polygonGap(a.contour, b.contour);
      if (best === null || gap < best.gap) best = { gap, a: a.definition, b: b.definition, group: bodyGroup(a.group) };
    }
  }
  return best;
}
