/**
 * Figure drawing v2 (guides v2 §3): the body as contoured segments instead of
 * capsules. `poseAt` solves the joints exactly as before (rig lengths, IK and
 * angles are unchanged) and records a `FigureBody`; this module turns it into
 * outlines, muscle-region frames and anatomical lines. Pure TypeScript.
 *
 * Segment frame (§3.2): `j0` proximal (trunk: bottom), `j1` distal (top),
 * `u` the unit axis, `s ∈ [0,1]` along it (a profile may run past either end),
 * `n` the profile's "front": the anterior normal in a side view, the lateral
 * normal in front/back views. Poses are built facing right; the projector
 * mirrors them.
 */
import { add, dist, lerp, perpCcw, scale, sub, v, type Vec } from './math';
import { convexHull, ellipsePoints, ribbonOutline } from './paths';
import { ADULT_V1_PROFILES, FAR_PROFILE_SCALE, profileAt, profileRange, type Profile, type SegmentName } from './profiles';

export type BodySide = 'Near' | 'Far';
export type BodyGroup = 'trunk' | 'legNear' | 'legFar' | 'armNear' | 'armFar';
export type SeenFrom = 'front' | 'back';

export interface BodySegment {
  name: SegmentName;
  /** null for the trunk, neck and head. */
  side: BodySide | null;
  group: BodyGroup;
  j0: Vec;
  j1: Vec;
  u: Vec;
  n: Vec;
  length: number;
  profile: Profile;
  /** Width multiplier (far limbs in a side view: 0.96). */
  widthScale: number;
  /** Drawing foreshortening of this segment (1 = in the picture plane). */
  projection: number;
  /** Trunk chain only: the normal blends to these at the ends, so the spine bends without seams. */
  nStart: Vec;
  nEnd: Vec;
}

export interface BodyHand {
  side: BodySide;
  group: BodyGroup;
  kind: 'fist' | 'palm';
  wrist: Vec;
  /** Fist: unit direction wrist → knuckles. Palm: forward along the surface. */
  dir: Vec;
  /** Fist: wrist → knuckles length. Palm: wrist → fingertips. */
  length: number;
  /** Palm only: the surface contact (middle of the palm). */
  contact: Vec;
  /** The forearm's front normal (the thumb sits on this side). */
  front: Vec;
}

export interface BodyFoot {
  side: BodySide;
  group: BodyGroup;
  ankle: Vec;
  /** Foot frame: towards the toes, and up out of the sole. */
  u: Vec;
  n: Vec;
  ball: Vec;
  toe: Vec;
  /** Front view: +1 for the near (figure +x) foot, −1 for the far one. */
  sign: number;
}

export interface FigureBody {
  view: 'side' | 'front';
  seenFrom: SeenFrom;
  segments: BodySegment[];
  hands: BodyHand[];
  feet: BodyFoot[];
  head: { c: Vec; rx: number; ry: number; rot: number };
}

/** Head ellipse radii (§3.5): side view front-to-back × tall; front view wide × tall. */
export const HEAD = { side: { rx: 0.056, ry: 0.063 }, front: { rx: 0.05, ry: 0.063 } } as const;
/** Fist and flat-hand drawing sizes (§3.5), H. */
export const HAND = { fistHalf: 0.017, fistHalfFront: 0.02, knuckleRadius: 0.01, thumbRadius: 0.007, palmLength: 0.095 } as const;

const unit = (d: Vec): Vec => {
  const l = Math.hypot(d.x, d.y);
  return l < 1e-12 ? v(0, 1) : scale(d, 1 / l);
};
const perpCw = (a: Vec): Vec => v(a.y, -a.x);
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Builds one segment's frame. Side view: limbs n = perpCcw(u), trunk n = perpCw(u). Front/back: lateral. */
export function makeSegment(
  view: 'side' | 'front',
  name: SegmentName,
  side: BodySide | null,
  group: BodyGroup,
  j0: Vec,
  j1: Vec,
  projection = 1,
): BodySegment {
  const u = unit(sub(j1, j0));
  const trunk = side === null;
  let n: Vec;
  if (view === 'side') n = trunk ? perpCw(u) : perpCcw(u);
  else if (trunk) n = perpCw(u);
  else n = side === 'Near' ? perpCcw(u) : perpCw(u);
  const profile = ADULT_V1_PROFILES[view === 'side' ? 'side' : 'frontBack'][name];
  const widthScale = view === 'side' && side === 'Far' ? FAR_PROFILE_SCALE : 1;
  return { name, side, group, j0, j1, u, n, length: dist(j0, j1), profile, widthScale, projection, nStart: n, nEnd: n };
}

/** Joins trunk segments into one chain: normals at each joint are the bisector of the two segments. */
export function chainTrunk(segments: BodySegment[]): void {
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const a = segments[i];
    const b = segments[i + 1];
    if (a === undefined || b === undefined) continue;
    const mid = unit(add(a.n, b.n));
    a.nEnd = mid;
    b.nStart = mid;
  }
}

const BLEND = 0.25;

/** Axis point and front normal at `s` (the normal blends to the chain bisectors near trunk joints). */
export function frameAt(seg: BodySegment, s: number): { p: Vec; n: Vec } {
  const p = add(seg.j0, scale(seg.u, s * seg.length));
  let n = seg.n;
  if (s < BLEND && seg.nStart !== seg.n) n = unit(add(scale(seg.nStart, 1 - smoothstep(Math.max(0, s) / BLEND)), scale(seg.n, smoothstep(Math.max(0, s) / BLEND))));
  else if (s > 1 - BLEND && seg.nEnd !== seg.n) {
    const k = smoothstep((Math.min(1, s) - (1 - BLEND)) / BLEND);
    n = unit(add(scale(seg.n, 1 - k), scale(seg.nEnd, k)));
  }
  return { p, n };
}

export function widthsAt(seg: BodySegment, s: number): { front: number; back: number } {
  const w = profileAt(seg.profile, s);
  return { front: w.front * seg.widthScale, back: w.back * seg.widthScale };
}

/**
 * A point in segment coordinates: `x ∈ [−1, 1]` across the segment, +1 on the
 * front edge (side view; lateral in front/back views), −1 on the back
 * (medial) edge, 0 on the axis. `inset` pulls an edge point inwards.
 */
export function segmentPoint(seg: BodySegment, s: number, x: number, inset = 0): Vec {
  const { p, n } = frameAt(seg, s);
  const w = widthsAt(seg, s);
  const off = x >= 0 ? x * Math.max(0, w.front - inset) : x * Math.max(0, w.back - inset);
  return add(p, scale(n, off));
}

/** Station-aligned samples along a profile range (stations plus midpoints), so curves follow every bulge. */
export function sampleS(profile: Profile, from?: number, to?: number): number[] {
  const [a, b] = profileRange(profile);
  const lo = from ?? a;
  const hi = to ?? b;
  const xs = new Set<number>([lo, hi]);
  profile.forEach((st, i) => {
    if (st.s > lo && st.s < hi) xs.add(st.s);
    const nxt = profile[i + 1];
    if (nxt !== undefined) {
      const m = (st.s + nxt.s) / 2;
      if (m > lo && m < hi) xs.add(m);
    }
  });
  return [...xs].sort((p, q) => p - q);
}

/** Semicircle-like cap points between two edge points, bulging `depth` along `dir` (excludes the ends). */
function capPoints(c: Vec, nrm: Vec, dir: Vec, halfWidth: number, depth: number, from: 1 | -1): Vec[] {
  return [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map((a) => add(c, add(scale(nrm, from * Math.cos(a) * halfWidth), scale(dir, Math.sin(a) * depth))));
}

/**
 * Closed outline of a run of segments sharing one edge chain (§3.2): along
 * the front edge, an end cap, back along the back edge, a start cap. One
 * segment for a limb; pelvis + lumbar + thorax for the trunk (§3.5).
 * `capDepth` flattens a cap (0–1 of its half-width); limbs use round caps.
 */
export function chainOutline(chain: readonly BodySegment[], caps: { start: number; end: number } = { start: 1, end: 1 }): Vec[] {
  const parts = chainParts(chain, caps);
  return parts === null ? [] : [...parts.front, ...parts.endCap, ...parts.back, ...parts.startCap];
}

/**
 * A limb segment's outline without its proximal cap, as an open path: along
 * the front edge, round the distal cap, back along the back edge. The M/L
 * contour strokes arm segments with it, so no line is drawn across the
 * shoulder or inside the elbow where the segment joins its parent (ADR 0015).
 */
export function openSegmentOutline(seg: BodySegment): Vec[] {
  const parts = chainParts([seg], { start: 1, end: 1 });
  return parts === null ? [] : [...parts.front, ...parts.endCap, ...parts.back];
}

/** The pieces of `chainOutline`: front edge (proximal → distal), end cap, back edge (distal → proximal), start cap. */
function chainParts(chain: readonly BodySegment[], caps: { start: number; end: number }): { front: Vec[]; endCap: Vec[]; back: Vec[]; startCap: Vec[] } | null {
  const front: Vec[] = [];
  const back: Vec[] = [];
  chain.forEach((seg, i) => {
    const ss = sampleS(seg.profile);
    for (const s of ss) {
      // Shared joints: the next segment starts where this one ends; keep one sample.
      if (i > 0 && s <= 0 && seg.profile[0] !== undefined && seg.profile[0].s >= 0) continue;
      front.push(segmentPoint(seg, s, 1));
      back.push(segmentPoint(seg, s, -1));
    }
  });
  const first = chain[0];
  const last = chain[chain.length - 1];
  if (first === undefined || last === undefined) return null;
  const [s0] = profileRange(first.profile);
  const [, s1] = profileRange(last.profile);
  const endF = widthsAt(last, s1);
  const endFrame = frameAt(last, s1);
  const endC = add(endFrame.p, scale(endFrame.n, (endF.front - endF.back) / 2));
  const endHalf = (endF.front + endF.back) / 2;
  const startF = widthsAt(first, s0);
  const startFrame = frameAt(first, s0);
  const startC = add(startFrame.p, scale(startFrame.n, (startF.front - startF.back) / 2));
  const startHalf = (startF.front + startF.back) / 2;
  return {
    front,
    endCap: capPoints(endC, endFrame.n, last.u, endHalf, endHalf * caps.end, 1),
    back: back.reverse(),
    startCap: capPoints(startC, startFrame.n, scale(first.u, -1), startHalf, startHalf * caps.start, -1),
  };
}

/** One edge of a segment between `from` and `to` (x = +1 front, −1 back), shifted inwards by `inset`. */
export function edgeCurve(seg: BodySegment, x: 1 | -1, from?: number, to?: number, inset = 0): Vec[] {
  return sampleS(seg.profile, from, to).map((s) => segmentPoint(seg, s, x, inset));
}

/** Fist (§3.5): a rounded box from the wrist to the knuckles, plus a thumb on the front side. */
export function handContours(hand: BodyHand, view: 'side' | 'front'): Vec[][] {
  if (hand.kind === 'palm') {
    // Flat hand: a tapered slab from the wrist down onto the surface and forward to the fingertips.
    const surfaceY = hand.contact.y;
    const heel = v(hand.contact.x - 0.012, surfaceY + 0.007);
    const dy = hand.wrist.y - (surfaceY + 0.004);
    const reach = Math.sqrt(Math.max(0, HAND.palmLength ** 2 - dy * dy));
    const tip = v(hand.wrist.x + reach * Math.sign(hand.dir.x || 1), surfaceY + 0.004);
    const slab = ribbonOutline([hand.wrist, heel, tip], [0.009, 0.007, 0.004]);
    const thumb = ribbonOutline([v(lerp(hand.wrist.x, heel.x, 0.5), surfaceY + 0.012), v(heel.x + 0.01 * Math.sign(hand.dir.x || 1), surfaceY + 0.01)], [HAND.thumbRadius * 0.8, HAND.thumbRadius * 0.7]);
    return [slab, thumb];
  }
  const half = view === 'front' ? HAND.fistHalfFront : HAND.fistHalf;
  const L = hand.length;
  const u = hand.dir;
  // The box's thumb side follows the forearm's front, whichever way the hand points.
  const nn = dot(perpCcw(u), hand.front) >= 0 ? perpCcw(u) : perpCw(u);
  const at = (s: number, x: number): Vec => add(add(hand.wrist, scale(u, s * L)), scale(nn, x));
  const h = (s: number): number => half * (s < 0.4 ? lerp(0.85, 1, s / 0.4) : lerp(1, 0.94, (s - 0.4) / 0.6));
  const r = Math.min(HAND.knuckleRadius, L * 0.3);
  const box: Vec[] = [];
  for (const s of [0, 0.2, 0.4, 0.6]) box.push(at(s, h(s)));
  const hk = h(1);
  const rs = r / L;
  // Knuckle corners: quarter arcs of radius r.
  for (const a of [0, Math.PI / 4, Math.PI / 2]) box.push(at(1 - rs + (Math.sin(a) * r) / L, hk - r + Math.cos(a) * r));
  for (const a of [Math.PI / 2, (3 * Math.PI) / 4, Math.PI]) box.push(at(1 - rs + (Math.sin(a) * r) / L, -hk + r + Math.cos(a) * r));
  for (const s of [0.6, 0.4, 0.2, 0]) box.push(at(s, -h(s)));
  box.push(at(-0.12, 0));
  const thumb = ribbonOutline([at(0.3, h(0.3) - 0.003), at(0.7, h(0.7) - 0.004)], [HAND.thumbRadius, HAND.thumbRadius * 0.85]);
  return view === 'front' ? [box] : [box, thumb];
}

/** Training-shoe outline in the foot frame (§3.5): x towards the toes, y up, origin at the ankle. */
export const SHOE_OUTLINE: readonly [number, number][] = [
  [-0.046, -0.039],
  [0.02, -0.039],
  [0.085, -0.039],
  [0.113, -0.031],
  [0.108, -0.022],
  [0.085, -0.018],
  [0.04, -0.002],
  [0.014, 0.014],
  [-0.03, 0.01],
  [-0.052, -0.02],
];
const BALL_X = 0.085;
const SOLE_Y = -0.039;
export const SOLE_BAND = 0.008;

/** The foot frame and the toe frame (toes bend at the ball, as in v1). */
function footMapper(foot: BodyFoot): (x: number, y: number) => Vec {
  const toeU = unit(sub(foot.toe, foot.ball));
  const toeN = dot(perpCcw(toeU), foot.n) >= 0 ? perpCcw(toeU) : perpCw(toeU);
  const ballBottom = add(add(foot.ankle, scale(foot.u, BALL_X)), scale(foot.n, SOLE_Y));
  return (x, y) => {
    if (x <= BALL_X) return add(add(foot.ankle, scale(foot.u, x)), scale(foot.n, y));
    return add(add(ballBottom, scale(toeU, x - BALL_X)), scale(toeN, y - SOLE_Y));
  };
}

export function footContour(foot: BodyFoot, view: 'side' | 'front'): Vec[] {
  if (view === 'front') {
    const cx = foot.ankle.x + 0.012 * foot.sign;
    const top = foot.ankle.y + 0.004;
    const bottom = foot.ankle.y - 0.039;
    return [v(cx - 0.03, top), v(cx + 0.03, top), v(cx + 0.04, bottom + 0.016), v(cx + 0.045, bottom + 0.006), v(cx + 0.036, bottom), v(cx - 0.036, bottom), v(cx - 0.045, bottom + 0.006), v(cx - 0.04, bottom + 0.016)];
  }
  const m = footMapper(foot);
  return SHOE_OUTLINE.map(([x, y]) => m(x, y));
}

/** Sole band (§3.5): a strip along the bottom of the shoe. */
export function soleBand(foot: BodyFoot, view: 'side' | 'front'): Vec[] {
  if (view === 'front') {
    const cx = foot.ankle.x + 0.012 * foot.sign;
    const bottom = foot.ankle.y - 0.039;
    return [v(cx - 0.044, bottom + SOLE_BAND), v(cx + 0.044, bottom + SOLE_BAND), v(cx + 0.045, bottom + 0.006), v(cx + 0.036, bottom), v(cx - 0.036, bottom), v(cx - 0.045, bottom + 0.006)];
  }
  const m = footMapper(foot);
  const t = SOLE_BAND;
  return [m(-0.05, SOLE_Y + 0.006), m(-0.046, SOLE_Y), m(0.02, SOLE_Y), m(BALL_X, SOLE_Y), m(0.113, -0.031), m(0.109, -0.031 + t * 0.6), m(BALL_X, SOLE_Y + t), m(0.02, SOLE_Y + t), m(-0.049, SOLE_Y + t)];
}

export function headContour(body: FigureBody): Vec[] {
  const h = body.head;
  return ellipsePoints(h.c, h.rx, h.ry, h.rot, 16);
}

/** The trunk chain (pelvis → lumbar → thorax) and the neck. */
export function trunkSegments(body: FigureBody): BodySegment[] {
  return body.segments.filter((s) => s.side === null && s.name !== 'neck');
}

/** Trunk outline caps: the buttocks round off; the front view's pelvis bottom stays flat between the thighs. */
export function trunkOutline(body: FigureBody): Vec[] {
  return chainOutline(trunkSegments(body), { start: body.view === 'side' ? 0.55 : 0.25, end: 0.6 });
}

/** Every closed contour of a body group, in drawing order within the group. */
export function groupContours(body: FigureBody, group: BodyGroup): Vec[][] {
  if (group === 'trunk') {
    const neck = body.segments.find((s) => s.name === 'neck');
    return [trunkOutline(body), ...(neck ? [chainOutline([neck])] : []), headContour(body)];
  }
  const out: Vec[][] = [];
  const fillet = group === 'legNear' ? hipFillet(body) : null;
  if (fillet !== null) out.push(fillet);
  for (const seg of body.segments) if (seg.group === group) out.push(chainOutline([seg]));
  for (const f of body.feet) if (f.group === group) out.push(footContour(f, body.view));
  for (const h of body.hands) if (h.group === group) out.push(...handContours(h, body.view));
  return out;
}

export const BODY_GROUPS: readonly BodyGroup[] = ['trunk', 'legNear', 'legFar', 'armNear', 'armFar'];

/** Hip fillet reach: buttock outline within this distance of the hip joint, and the thigh's back edge over this share of its length. */
const FILLET_RADIUS = 0.16;
const FILLET_THIGH_S = 0.35;

/**
 * Side view: a convex patch from the buttock's back outline to the top of the
 * near thigh's back edge, drawn with the near leg, so the glute blends into
 * the thigh instead of meeting it with a notch (review of 10 Oct 2026). Its
 * outline is the leg's, so the silhouette stroke runs round it without a
 * seam. Null in front/back views or without a near thigh.
 */
export function hipFillet(body: FigureBody): Vec[] | null {
  if (body.view !== 'side') return null;
  const thigh = body.segments.find((s) => s.name === 'thigh' && s.side === 'Near');
  const pelvis = body.segments.find((s) => s.name === 'pelvis');
  if (thigh === undefined || pelvis === undefined) return null;
  const hip = thigh.j0;
  // Behind the pelvis axis (its front normal points the other way) and near the hip joint.
  const buttock = trunkOutline(body).filter((p) => dist(p, hip) < FILLET_RADIUS && dot(sub(p, hip), pelvis.n) < 0);
  if (buttock.length < 2) return null;
  const back = edgeCurveOf(thigh, -1, 0, FILLET_THIGH_S);
  return convexHull([...buttock, ...back, hip]);
}

/** `edgeCurve` without the forward reference (defined below). */
function edgeCurveOf(seg: BodySegment, x: 1 | -1, from: number, to: number): Vec[] {
  return sampleS(seg.profile, from, to).map((s) => segmentPoint(seg, s, x));
}

/**
 * What the M/L outline contour strokes for a group: closed contours, except
 * arm segments, which are open (`openSegmentOutline`) so the arm joins the
 * shoulder and the forearm joins the upper arm without a stroked seam. The
 * arm's edges over the torso are real occlusion edges and keep their line.
 */
export function groupStrokeContours(body: FigureBody, group: BodyGroup): { open: Vec[][]; closed: Vec[][] } {
  if (group !== 'armNear' && group !== 'armFar') return { open: [], closed: groupContours(body, group) };
  const open: Vec[][] = [];
  for (const seg of body.segments) if (seg.group === group) open.push(openSegmentOutline(seg));
  const closed: Vec[][] = [];
  for (const h of body.hands) if (h.group === group) closed.push(...handContours(h, body.view));
  return { open, closed };
}

/** Every outline point of the figure (bounds, collision reports). */
export function bodyOutlinePoints(body: FigureBody): Vec[] {
  return BODY_GROUPS.flatMap((g) => groupContours(body, g).flat());
}
