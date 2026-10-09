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
import { add, dist, polygonsWithin, scale, sub, v, type Vec } from './math';
import { definitionGroupsFor, effectiveDefinition, focusViewOf, hasListedMuscles, resolveFocus, type MuscleDefinition, type MuscleInput, type MuscleLevel } from './muscle-map';
import { counterClockwise } from './paths';
import type { Pose } from './pose';
import { STROKE, type Layer, type Paint, type Shape } from './props';
import { anatomyLines, definitionShapes, regionShapes, shadeBands, type RegionGroup } from './regions';
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

/** Minimum stroke widths in points at the drawn size (design-system `guide.strokeFloor.*`). */
export const STROKE_FLOORS_PT = {
  compact: { halo: 1.25, edge: 1, contour: 1, hair: 0.75 },
  full: { halo: 1, edge: 0.75, contour: 0.75, hair: 0.75 },
} as const satisfies Record<DetailTier, Record<'halo' | 'edge' | 'contour' | 'hair', number>>;

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
      return { kind: 'line', a: P(s.a), b: P(s.b), width: c.sw(s.width, strokeClass(s.width)), paint: s.paint, cap: 'round', dash: s.dash ? s.dash.map((d) => d * k) : null, opacity: s.opacity ?? 1 };
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

/** Contours grouped by alpha, fully opaque first (almost always the only group). */
function byAlpha(items: readonly { alpha: number; points: Vec[] }[]): [number, Vec[][]][] {
  const groups = new Map<number, Vec[][]>();
  for (const it of items) groups.set(it.alpha, [...(groups.get(it.alpha) ?? []), it.points]);
  return [...groups.entries()].sort((a, b) => b[0] - a[0]);
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
  const halo = (g: BodyGroup): DrawOp => pathOp(cs(g), { smooth: true, fill: 'background', stroke: 'background', width: 2 * c.sw(STROKE.halo, 'halo'), join: 'round' });

  const view = focusViewOf({ view: body.view, seenFrom: body.seenFrom });
  const focus = opts.muscles ? resolveFocus(opts.muscles, pose.focus ?? undefined, view) : null;
  const regions = focus ? regionShapes(body, focus) : [];
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
    // Opaque composite at opacity 1 (fading only with a foreshortened segment): overlaps never stack, and it never pulses.
    for (const [alpha, fs] of byAlpha(faint.filter((f) => f.group === g).map((f) => ({ alpha: f.alpha, points: project(f.contour) })))) {
      ops.push(pathOp(fs, { smooth: true, fill: definition === 'tint' ? 'faintTint' : 'faintNeutral', opacity: alpha }));
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
        // With definition on, a translucent region that would sit on a faint shape, or strong on soft during the pulse (review
        // N3), gets an opaque body-tone underlay of its own path: one paint per pixel (§4.11.6). Elsewhere (an opaque region,
        // or nothing beneath) it would change only the anti-aliased edge, and hide the trunk's lines under side-view pelvis regions.
        const underlay = definition !== 'off' && opacity < 1 && (overlapsAny(world, faintWorld) || (level === 'strong' && overlapsAny(world, softWorld)));
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
    if (strokes.open.length > 0) ops.push(pathOp(strokes.open.map((pts) => pts.map(c.P)), { closed: false, smooth: true, stroke: 'shade', width, join: 'round', opacity }));
  };
  /** The limb's own separation: S-tier halo or M/L contour. Legs drawn after the trunk emit it before the trunk instead. */
  const outline = (g: BodyGroup): void => {
    if (!full && g !== 'trunk') ops.push(halo(g));
    if (full) contourOps(g);
  };

  const drawGroup = (g: BodyGroup, outlineDone = false): void => {
    const shapes = cs(g);
    if (shapes.length === 0) return;
    if (!outlineDone) outline(g);
    ops.push(pathOp(shapes, { smooth: true, fill: 'nearBody' }));
    faintOps(g);
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
    for (const [alpha, gl] of byAlpha(lines.filter((l) => l.group === g).map((l) => ({ alpha: l.alpha, points: l.points.map(c.P) })))) {
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
  // M/L: near-limb halos go under the trunk, so near limbs stand clear of the far side and props but not of their own body.
  if (full) for (const g of [...(legsFirst ? [] : legs), ...arms]) if (cs(g).length > 0) ops.push(halo(g));
  // Legs drawn over the trunk put their outline (S: halo, M/L: contour) under it too: the trunk fill hides the part
  // inside the pelvis, so the thigh joins the hip without a seam line, and the outline outside the trunk stays (ADR 0015).
  if (!legsFirst) for (const g of legs) if (cs(g).length > 0) outline(g);
  drawGroup('trunk');
  if (!legsFirst) for (const g of legs) drawGroup(g, true);
  // Pelvis regions after the near leg, so the thigh doesn't cut the glutes in half (§3.11 step 8); faint glutes first.
  if (side) {
    faintOps('pelvis');
    regionOps('pelvis');
  }
  for (const g of arms) drawGroup(g);
  emitLayer('body');
  emitLayer('near');
  // The static path overlay sits above the body and below front implements, so it stays visible.
  if (opts.trace && opts.trace.length > 1) {
    ops.push(pathOp([opts.trace.map(c.P)], { closed: false, stroke: 'trace', width: c.sw(0.005, 'edge'), cap: 'round', dash: [0.012 * k, 0.01 * k] }));
  }
  emitLayer('front');
  return ops;
}
