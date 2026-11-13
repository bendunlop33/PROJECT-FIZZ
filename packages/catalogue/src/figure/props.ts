/**
 * Prop geometry: flat shapes in world units, the points bodies hold or stand
 * on, and the solid shapes the checks test for penetration.
 */
import type { GuideProp } from './guide-schema';
import { add, fromUp, rad, scale, sub, v, type Vec } from './math';
import { roundedRect, ribbonOutline } from './paths';

/**
 * Paints map to design tokens in `style.ts` (never the accent or a status
 * colour). `shade` is the darkest neutral at partial opacity; `muscle` is the
 * one non-neutral paint, for muscle regions only (guides v2 §4.2).
 * `faintNeutral` and `faintTint` are the opaque muscle-definition fills
 * (§4.11), derived from the tokens by `guideStyleFromTokens`; only the body
 * drawing uses them, never a prop.
 */
export type Paint = 'implement' | 'frame' | 'frameFill' | 'trace' | 'cable' | 'nearBody' | 'farBody' | 'background' | 'shade' | 'muscle' | 'faintNeutral' | 'faintTint';

/** Draw order, back to front. */
export const LAYERS = ['back', 'far', 'mid', 'body', 'near', 'front'] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Stroke weights in body heights, shared by every prop and the body so line
 * weights stay consistent across guides.
 */
export const STROKE = {
  /** Knock-out halo around a limb silhouette (drawn outside its edge). */
  halo: 0.0075,
  /** Outlines of pads, frames and plates. */
  edge: 0.006,
  /** Fine detail: plate hubs, floor, cable. */
  hair: 0.004,
  /** Bars, poles and handles seen side-on. */
  bar: 0.014,
  /** Outline contour of the near body (M/L tier, guides v2 §3.8). */
  contour: 0.0035,
} as const;

/**
 * Detail tier a shape belongs to (guides v2 §3.10): `compact` only at the S
 * tier (thumbnails), `full` only at the M/L tier, untagged at both.
 */
export type Detail = 'compact' | 'full';

/**
 * `opacity` (0–1) softens secondary detail such as plates; colours still come
 * only from tokens. `detail` limits a shape to one tier. A `smooth` poly is
 * drawn as a curve through its points.
 */
export type Shape =
  | { kind: 'line'; layer: Layer; a: Vec; b: Vec; width: number; paint: Paint; dash?: readonly number[]; opacity?: number; detail?: Detail }
  | { kind: 'circle'; layer: Layer; c: Vec; r: number; fill?: Paint; stroke?: Paint; width?: number; opacity?: number; detail?: Detail }
  | { kind: 'poly'; layer: Layer; points: readonly Vec[]; fill?: Paint; stroke?: Paint; width?: number; opacity?: number; detail?: Detail; smooth?: boolean }
  /**
   * Tapered capsule (two radii); `outline` knocks it out from shapes behind
   * with a halo. Capsules sharing a `group` (one limb) are drawn as one
   * silhouette: every halo first, then every fill, so joints show no seams.
   */
  | { kind: 'capsule'; layer: Layer; a: Vec; b: Vec; ra: number; rb: number; paint: Paint; outline?: Paint; group?: string; detail?: Detail };

export interface Collider {
  propId: string;
  /** Closed polygon the body must not enter. */
  polygon: readonly Vec[];
}

export interface PropGeometry {
  id: string;
  shapes: Shape[];
  colliders: Collider[];
  /** Lowest point of round solids (plates, dumbbell heads, sled) for the floor check. */
  solidBottoms: number[];
}

export const PLATE_RADIUS = { none: 0, small: 0.075, medium: 0.1, large: 0.126 } as const;
const DUMBBELL_RADIUS = { small: 0.032, medium: 0.042, large: 0.052 } as const;

/** Rectangle from a base line `a`→`b` with thickness `t` on the CCW side. */
function slab(a: Vec, b: Vec, t: number): Vec[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const n = v((-dy / l) * t, (dx / l) * t);
  return [a, b, add(b, n), add(a, n)];
}

/** Tags shapes with a detail tier. */
const tier = (detail: Detail, shapes: Shape[]): Shape[] => shapes.map((x) => ({ ...x, detail }));

/**
 * A plate seen face-on (guides v2 §3.9): rim band, inner face, rubber hub and
 * sleeve at the M/L tier; the v1 soft disc and ring at the S tier. Drawn
 * behind the body, so the figure still reads first.
 */
function plateFace(c: Vec, r: number, layer: Layer, stacked: boolean): Shape[] {
  return [
    ...tier('compact', [
      { kind: 'circle', layer, c, r, fill: 'frameFill', stroke: 'implement', width: STROKE.edge, opacity: 0.55 },
      { kind: 'circle', layer, c, r: r * 0.6, stroke: 'implement', width: STROKE.hair, opacity: 0.35 },
    ]),
    ...tier('full', [
      ...(stacked ? ([{ kind: 'circle', layer, c: add(c, v(0.006, -0.006)), r, stroke: 'implement', width: STROKE.hair, opacity: 0.3 }] satisfies Shape[]) : []),
      { kind: 'circle', layer, c, r, fill: 'frameFill', stroke: 'frame', width: STROKE.edge, opacity: 0.85 },
      { kind: 'circle', layer, c, r: r * 0.86, fill: 'frameFill', stroke: 'frame', width: STROKE.hair, opacity: 0.6 },
      { kind: 'circle', layer, c, r: r * 0.6, stroke: 'implement', width: STROKE.hair, opacity: 0.25 },
      { kind: 'circle', layer, c, r: 0.045, fill: 'frame', opacity: 0.8 },
      { kind: 'circle', layer, c, r: 0.025, fill: 'implement', opacity: 0.8 },
    ]),
  ];
}

/** A padded surface (guides v2 §3.9): rounded at M/L with an upholstery seam; a plain slab at S. */
function padSlab(a: Vec, b: Vec, t: number, layer: Layer): Shape[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = v((b.x - a.x) / len, (b.y - a.y) / len);
  const n = v((-u.y * t) / Math.abs(t), (u.x * t) / Math.abs(t));
  const at = (x: number, y: number): Vec => add(add(a, scale(u, x)), scale(n, y));
  const depth = Math.abs(t);
  const rr = roundedRect(0, 0, len, depth, Math.min(0.015, depth / 2)).map((p) => at(p.x, p.y));
  return [
    { kind: 'poly', layer, points: slab(a, b, t), fill: 'frameFill', stroke: 'frame', width: STROKE.edge, detail: 'compact' },
    { kind: 'poly', layer, points: rr, fill: 'frameFill', stroke: 'frame', width: STROKE.edge, detail: 'full' },
    { kind: 'line', layer, a: at(0.02, depth * 0.6), b: at(len - 0.02, depth * 0.6), width: STROKE.hair, paint: 'frame', opacity: 0.6, detail: 'full' },
  ];
}

/**
 * Front view: the bar runs across the picture with plates seen edge-on at
 * each end. Held in front of the body, so it is drawn in front of the figure
 * (`front`); seen from behind (`seenFrom: back`) the same bar is behind the
 * body (`mid`): the head and trunk hide its middle, the hands grip over it.
 */
export function frontBarbellShapes(id: string, c: Vec, plates: keyof typeof PLATE_RADIUS, layer: Layer = 'front'): PropGeometry {
  const r = PLATE_RADIUS[plates];
  const half = r > 0 ? 0.36 : 0.32;
  const shapes: Shape[] = [{ kind: 'line', layer, a: v(c.x - half, c.y), b: v(c.x + half, c.y), width: 0.014, paint: 'implement' }];
  if (r > 0) {
    for (const sx of [-1, 1]) {
      const x0 = c.x + sx * 0.3;
      const x1 = c.x + sx * 0.335;
      shapes.push({ kind: 'poly', layer, points: [v(x0, c.y - r), v(x1, c.y - r), v(x1, c.y + r), v(x0, c.y + r)], fill: 'implement', detail: 'compact' });
      // M/L: the plate edge-on as a profile (thick rim, thinner hub), a collar inside, the sleeve past it.
      const xm = (x0 + x1) / 2;
      const rim = 0.019;
      const hub = 0.012;
      const lip = r * 0.9;
      shapes.push({
        kind: 'poly',
        layer,
        points: [v(xm - sx * rim, c.y + r), v(xm + sx * rim, c.y + r), v(xm + sx * rim, c.y + lip), v(xm + sx * hub, c.y + lip - 0.01), v(xm + sx * hub, c.y - lip + 0.01), v(xm + sx * rim, c.y - lip), v(xm + sx * rim, c.y - r), v(xm - sx * rim, c.y - r), v(xm - sx * rim, c.y - lip), v(xm - sx * hub, c.y - lip + 0.01), v(xm - sx * hub, c.y + lip - 0.01), v(xm - sx * rim, c.y + lip)],
        fill: 'implement',
        detail: 'full',
      });
      shapes.push({ kind: 'poly', layer, points: roundedRect(x0 - sx * 0.026, c.y - 0.025, x0 - sx * 0.012, c.y + 0.025, 0.003), fill: 'implement', detail: 'full' });
      shapes.push({ kind: 'line', layer, a: v(x1, c.y), b: v(x1 + sx * 0.03, c.y), width: 0.02, paint: 'implement', detail: 'full' });
    }
  }
  return { id, shapes, colliders: [], solidBottoms: r > 0 ? [c.y - r] : [] };
}

/**
 * Side-view barbell: the bar end-on (a solid dot, in front of everything) and
 * its plates. The plates are drawn *behind* the body as a soft disc with a
 * thin ring, so the head, arms and grip stay readable at thumbnail size; the
 * bar dot still shows exactly where the bar sits.
 */
export function barbellShapes(id: string, c: Vec, plates: keyof typeof PLATE_RADIUS): PropGeometry {
  const r = PLATE_RADIUS[plates];
  const shapes: Shape[] = r > 0 ? plateFace(c, r, 'back', plates === 'large') : [];
  shapes.push({ kind: 'circle', layer: 'front', c, r: 0.019, fill: 'implement', stroke: 'background', width: STROKE.hair });
  return { id, shapes, colliders: [], solidBottoms: r > 0 ? [c.y - r] : [] };
}

export function dumbbellShapes(id: string, c: Vec, size: keyof typeof DUMBBELL_RADIUS, seen: 'end' | 'side' = 'end'): PropGeometry {
  const r = DUMBBELL_RADIUS[size];
  if (seen === 'side') {
    // Handle across the picture through the hand, a head at each end (rounded blocks).
    const half = 0.055;
    const w = r * 0.8;
    const shapes: Shape[] = [{ kind: 'line', layer: 'front', a: v(c.x - half, c.y), b: v(c.x + half, c.y), width: 0.012, paint: 'implement' }];
    for (const sx of [-1, 1]) {
      const x0 = c.x + sx * half;
      const x1 = c.x + sx * (half + w);
      shapes.push({ kind: 'capsule', layer: 'front', a: v((x0 + x1) / 2, c.y - r + w / 2), b: v((x0 + x1) / 2, c.y + r - w / 2), ra: w / 2, rb: w / 2, paint: 'implement', outline: 'background', detail: 'compact' });
      // M/L: rounded-rectangle heads with two plate lines.
      const head = roundedRect(x0, c.y - r, x1, c.y + r, 0.006);
      shapes.push({ kind: 'poly', layer: 'front', points: head, fill: 'implement', stroke: 'background', width: STROKE.hair, detail: 'full' });
      for (const f of [0.35, 0.65]) {
        const x = x0 + (x1 - x0) * f;
        shapes.push({ kind: 'line', layer: 'front', a: v(x, c.y - r + 0.006), b: v(x, c.y + r - 0.006), width: STROKE.hair, paint: 'background', detail: 'full' });
      }
    }
    return { id, shapes, colliders: [], solidBottoms: [c.y - r] };
  }
  return {
    id,
    shapes: [
      { kind: 'circle', layer: 'front', c, r, fill: 'implement' },
      { kind: 'circle', layer: 'front', c, r: r * 0.8, stroke: 'background', width: STROKE.hair, detail: 'full' },
      { kind: 'circle', layer: 'front', c, r: r * 0.45, fill: 'background' },
    ],
    colliders: [],
    solidBottoms: [c.y - r],
  };
}

export interface BenchSpec {
  x: number;
  length: number;
  height: number;
  angleDeg: number;
}

export function benchShapes(id: string, s: BenchSpec, groundY: number): PropGeometry {
  const pad = 0.045;
  const top = groundY + s.height;
  const shapes: Shape[] = [];
  const colliders: Collider[] = [];
  const seatLen = s.angleDeg > 0 ? Math.min(0.26, s.length * 0.4) : s.length;
  const seat = [v(s.x, top - pad), v(s.x + seatLen, top - pad), v(s.x + seatLen, top), v(s.x, top)];
  // Drawn pad (M/L: rounded, 0.05 deep, with a seam and a board strip under it); the collider stays the v1 slab.
  shapes.push(...padSlab(v(s.x, top), v(s.x + seatLen, top), -0.05, 'mid'));
  shapes.push({ kind: 'line', layer: 'mid', a: v(s.x + 0.02, top - 0.054), b: v(s.x + seatLen - 0.02, top - 0.054), width: 0.008, paint: 'frame', detail: 'full' });
  colliders.push({ propId: id, polygon: seat });
  if (s.angleDeg > 0) {
    const a = rad(s.angleDeg);
    const start = v(s.x + seatLen, top - pad);
    const end = add(start, v(Math.cos(a) * (s.length - seatLen), Math.sin(a) * (s.length - seatLen)));
    const back = slab(start, end, pad);
    shapes.push(...padSlab(add(start, scale(v(-Math.sin(a), Math.cos(a)), pad)), add(end, scale(v(-Math.sin(a), Math.cos(a)), pad)), -0.05, 'mid'));
    colliders.push({ propId: id, polygon: back });
    shapes.push({ kind: 'line', layer: 'back', a: v(end.x - 0.02, groundY), b: v(end.x - 0.02, end.y - 0.02), width: 0.014, paint: 'frame' });
    shapes.push({ kind: 'circle', layer: 'mid', c: start, r: 0.012, fill: 'frame', detail: 'full' });
  }
  const legL = s.x + 0.06;
  const legR = s.x + (s.angleDeg > 0 ? seatLen : s.length) - 0.06;
  for (const x of [legL, legR]) {
    shapes.push({ kind: 'line', layer: 'back', a: v(x, groundY), b: v(x, top - pad), width: 0.014, paint: 'frame', detail: 'compact' });
    // M/L: tapered uprights with rubber feet.
    shapes.push({ kind: 'poly', layer: 'back', points: [v(x - 0.007, groundY + 0.012), v(x + 0.007, groundY + 0.012), v(x + 0.009, top - pad), v(x - 0.009, top - pad)], fill: 'frame', detail: 'full' });
    shapes.push({ kind: 'poly', layer: 'back', points: roundedRect(x - 0.03, groundY, x + 0.03, groundY + 0.012, 0.004), fill: 'frame', detail: 'full' });
  }
  shapes.push({ kind: 'line', layer: 'back', a: v(legL - 0.05, groundY + 0.004), b: v(legR + 0.05, groundY + 0.004), width: 0.01, paint: 'frame', detail: 'compact' });
  return { id, shapes, colliders, solidBottoms: [] };
}

export interface CableStackSpec {
  x: number;
  pulleyY: number;
  /** null: the cable ends on another prop (no handle drawn). */
  handle: 'bar' | 'rope' | 'stirrup' | null;
  restLength: number | null;
  column: boolean;
}

/** A fixed padded block or roller, drawn as a rounded rectangle. */
export function padShapes(id: string, s: { x: number; y: number; w: number; h: number; front?: boolean | undefined }): PropGeometry {
  const r = Math.min(s.w, s.h) / 2;
  const horizontal = s.w >= s.h;
  const a = horizontal ? v(s.x - s.w / 2 + r, s.y) : v(s.x, s.y - s.h / 2 + r);
  const b = horizontal ? v(s.x + s.w / 2 - r, s.y) : v(s.x, s.y + s.h / 2 - r);
  return {
    id,
    shapes: [{ kind: 'capsule', layer: s.front === true ? 'front' : 'mid', a, b, ra: r, rb: r, paint: 'frameFill', outline: 'frame' }],

    colliders: [],
    solidBottoms: [],
  };
}

/** Column, pulley, weight stack (lifted by the extra cable length) and the cable to the hand. */
export function cableStackShapes(id: string, s: CableStackSpec, hand: Vec, groundY: number): PropGeometry {
  const w = 0.075;
  const pulley = v(s.x, s.pulleyY);
  const cableLen = Math.hypot(hand.x - pulley.x, hand.y - pulley.y);
  const lift = s.restLength === null ? 0 : Math.max(0, Math.min(0.3, cableLen - s.restLength));
  const column = [v(s.x - w / 2, groundY), v(s.x + w / 2, groundY), v(s.x + w / 2, s.pulleyY + 0.04), v(s.x - w / 2, s.pulleyY + 0.04)];
  const stackBottom = groundY + 0.05 + lift;
  const stack = [v(s.x - w / 2 + 0.012, stackBottom), v(s.x + w / 2 - 0.012, stackBottom), v(s.x + w / 2 - 0.012, stackBottom + 0.22), v(s.x - w / 2 + 0.012, stackBottom + 0.22)];
  const shapes: Shape[] = [];
  if (s.column) {
    shapes.push({ kind: 'poly', layer: 'back', points: column, fill: 'frameFill', stroke: 'frame', width: STROKE.edge });
    shapes.push({ kind: 'poly', layer: 'back', points: stack, fill: 'frame', detail: 'compact' });
    // M/L: guide rods, then individual plates with hair gaps, a thicker top plate and the selector pin.
    const sx0 = s.x - w / 2 + 0.012;
    const sx1 = s.x + w / 2 - 0.012;
    for (const x of [sx0 + 0.008, sx1 - 0.008]) shapes.push({ kind: 'line', layer: 'back', a: v(x, groundY + 0.05), b: v(x, s.pulleyY + 0.03), width: STROKE.hair, paint: 'frame', detail: 'full' });
    const plate = 0.022;
    for (let i = 0; i < 10; i += 1) {
      const y0 = stackBottom + i * plate;
      const top = i === 9;
      shapes.push({ kind: 'poly', layer: 'back', points: [v(sx0, y0), v(sx1, y0), v(sx1, y0 + plate - 0.003), v(sx0, y0 + plate - 0.003)], fill: 'frame', opacity: top ? 1 : 0.85, detail: 'full' });
    }
    shapes.push({ kind: 'circle', layer: 'back', c: v(sx1 - 0.006, stackBottom + 4.5 * plate), r: 0.005, fill: 'implement', detail: 'full' });
  }
  shapes.push({ kind: 'circle', layer: 'back', c: pulley, r: 0.022, fill: 'frameFill', stroke: 'frame', width: STROKE.edge });
  shapes.push({ kind: 'circle', layer: 'back', c: pulley, r: 0.012, stroke: 'frame', width: STROKE.hair, detail: 'full' });
  shapes.push({ kind: 'circle', layer: 'back', c: pulley, r: 0.004, fill: 'frame', detail: 'full' });
  if (!s.column) shapes.push({ kind: 'line', layer: 'back', a: pulley, b: v(pulley.x, pulley.y + 0.05), width: STROKE.edge, paint: 'frame', detail: 'full' });
  shapes.push({ kind: 'line', layer: 'mid', a: pulley, b: hand, width: STROKE.hair, paint: 'cable' });
  if (s.handle === 'rope') {
    // Clip a short way up the cable, rope strand down through the fist, knotted tail below it.
    const toPulley = scale(v(pulley.x - hand.x, pulley.y - hand.y), 1 / Math.max(1e-9, cableLen));
    const clip = add(hand, scale(toPulley, Math.min(0.06, cableLen)));
    const tail = add(hand, v(0, -0.035));
    const cable = shapes[shapes.length - 1];
    if (cable?.kind === 'line') shapes[shapes.length - 1] = { ...cable, b: clip };
    shapes.push({ kind: 'line', layer: 'mid', a: clip, b: hand, width: 0.011, paint: 'implement' });
    shapes.push({ kind: 'line', layer: 'front', a: hand, b: tail, width: 0.011, paint: 'implement' });
    shapes.push({ kind: 'circle', layer: 'front', c: tail, r: 0.011, fill: 'implement' });
    shapes.push({ kind: 'circle', layer: 'mid', c: clip, r: 0.008, fill: 'implement' });
  } else if (s.handle === 'bar') {
    shapes.push({ kind: 'circle', layer: 'front', c: hand, r: 0.016, fill: 'implement' });
  } else if (s.handle === 'stirrup') {
    shapes.push({ kind: 'circle', layer: 'front', c: hand, r: 0.03, stroke: 'implement', width: 0.008 });
  }
  return { id, shapes, colliders: [], solidBottoms: [] };
}

export interface LegPressSpec {
  x: number;
  y: number;
  railDeg: number;
  seatX: number;
  seatY: number;
  seatDeg: number;
  plates: keyof typeof PLATE_RADIUS;
}

export interface LegPressContact {
  /** Foot-plate centre (the sole contact point). */
  point: Vec;
  /** Sole angle that puts the sole flat on the plate. */
  soleDeg: number;
}

/** Leg press: a carriage that slides `travel` along the rail. Feet go flat on its plate. */
export function legPressGeometry(id: string, s: LegPressSpec, travel: number, groundY: number): { geometry: PropGeometry; contact: LegPressContact } {
  const r = rad(s.railDeg);
  const rail = v(Math.cos(r), Math.sin(r));
  const along = v(-Math.sin(r), Math.cos(r));
  const plateCentre = add(v(s.x, s.y), scale(rail, travel));
  const plateA = add(plateCentre, scale(along, -0.16));
  const plateB = add(plateCentre, scale(along, 0.16));
  const plate = slab(plateA, plateB, -0.03);
  const railStart = add(v(s.x, s.y), scale(rail, -0.05));
  const railEnd = add(v(s.x, s.y), scale(rail, 0.55));
  const sr = rad(s.seatDeg);
  const seatBase = v(s.seatX, s.seatY);
  const backEnd = add(seatBase, v(-Math.cos(sr) * 0.42, Math.sin(sr) * 0.42));
  const seatEnd = add(seatBase, v(0.2, 0));
  const back = slab(backEnd, seatBase, -0.05);
  const seat = slab(seatBase, seatEnd, -0.05);
  const hornBase = add(plateCentre, scale(rail, 0.07));
  const shapes: Shape[] = [
    { kind: 'line', layer: 'back', a: railStart, b: railEnd, width: 0.02, paint: 'frame' },
    { kind: 'line', layer: 'back', a: v(railStart.x, groundY), b: railStart, width: 0.016, paint: 'frame' },
    { kind: 'line', layer: 'back', a: v(railEnd.x, groundY), b: railEnd, width: 0.016, paint: 'frame' },
    { kind: 'line', layer: 'back', a: v(Math.min(backEnd.x, railStart.x) - 0.05, groundY + 0.005), b: v(railEnd.x + 0.05, groundY + 0.005), width: 0.01, paint: 'frame' },
    { kind: 'line', layer: 'back', a: v(seatBase.x, groundY), b: seatBase, width: 0.016, paint: 'frame' },
    ...padSlab(backEnd, seatBase, -0.05, 'mid'),
    ...padSlab(seatBase, seatEnd, -0.05, 'mid'),
    { kind: 'poly', layer: 'mid', points: plate, fill: 'frameFill', stroke: 'implement', width: 0.008 },
    // M/L: a side handle at the front of the seat.
    { kind: 'capsule', layer: 'mid', a: add(seatEnd, v(-0.02, -0.075)), b: add(seatEnd, v(0.03, -0.075)), ra: 0.008, rb: 0.008, paint: 'implement', detail: 'full' },
  ];
  const pr = PLATE_RADIUS[s.plates];
  if (pr > 0) {
    // Plates on the carriage horn: soft disc behind the figure, like barbell plates.
    shapes.push({ kind: 'line', layer: 'back', a: plateCentre, b: hornBase, width: STROKE.bar, paint: 'implement' });
    shapes.push(...plateFace(hornBase, pr * 0.8, 'back', false));
  }
  // Sole on the plate: the foot's "up" points away from the plate (back down the rail).
  const soleDeg = (Math.atan2(-Math.cos(r), -Math.sin(r)) * 180) / Math.PI;
  return {
    geometry: { id, shapes, colliders: [{ propId: id, polygon: back }, { propId: id, polygon: seat }], solidBottoms: [] },
    contact: { point: plateCentre, soleDeg },
  };
}

export interface PushSledSpec {
  x: number;
  gripY: number;
  plates: keyof typeof PLATE_RADIUS;
  poleDeg?: number | undefined;
}

/** Floor sled seen from the side: low body, a pole rising back towards the athlete, plates stacked flat. */
export function pushSledGeometry(id: string, s: PushSledSpec, groundY: number): { geometry: PropGeometry; grip: Vec } {
  const h = 0.1;
  const body = [v(s.x, groundY), v(s.x + 0.4, groundY), v(s.x + 0.37, groundY + h), v(s.x + 0.03, groundY + h)];
  const poleBase = v(s.x + 0.06, groundY + h);
  const lean = s.poleDeg ?? 24;
  const grip = add(poleBase, scale(fromUp(-lean), (s.gripY - poleBase.y) / Math.cos(rad(lean))));
  // The pole carries on a little above the hands.
  const poleTop = add(grip, scale(fromUp(-lean), 0.07));
  const shapes: Shape[] = [
    { kind: 'poly', layer: 'mid', points: body, fill: 'frameFill', stroke: 'implement', width: 0.009 },
    // M/L: a runner (skid) under the body with an upturned front tip.
    { kind: 'poly', layer: 'mid', points: [v(s.x + 0.02, groundY), v(s.x + 0.4, groundY), v(s.x + 0.44, groundY + 0.03), v(s.x + 0.425, groundY + 0.034), v(s.x + 0.39, groundY + 0.01), v(s.x + 0.02, groundY + 0.01)], fill: 'implement', detail: 'full' },
    { kind: 'line', layer: 'mid', a: poleBase, b: poleTop, width: 0.016, paint: 'implement' },
    { kind: 'line', layer: 'mid', a: v(s.x + 0.26, groundY + h), b: v(s.x + 0.26, groundY + h + 0.12), width: 0.014, paint: 'implement' },
  ];
  // M/L: a grip sleeve on the pole around the hands.
  const poleU = scale(sub(poleTop, poleBase), 1 / Math.max(1e-9, Math.hypot(poleTop.x - poleBase.x, poleTop.y - poleBase.y)));
  shapes.push({ kind: 'poly', layer: 'mid', points: ribbonOutline([add(grip, scale(poleU, -0.03)), add(grip, scale(poleU, 0.03))], [0.011, 0.011]), fill: 'implement', stroke: 'background', width: STROKE.hair, detail: 'full' });
  const n = { none: 0, small: 1, medium: 2, large: 3 }[s.plates];
  for (let i = 0; i < n; i += 1) {
    const y = groundY + h + 0.012 + i * 0.026;
    shapes.push({ kind: 'line', layer: 'mid', a: v(s.x + 0.14, y), b: v(s.x + 0.38, y), width: 0.02, paint: 'implement' });
    // M/L: the rim edges of each stacked plate.
    for (const x of [s.x + 0.15, s.x + 0.37]) shapes.push({ kind: 'line', layer: 'mid', a: v(x, y - 0.007), b: v(x, y + 0.007), width: STROKE.hair, paint: 'background', detail: 'full' });
  }
  return { geometry: { id, shapes, colliders: [], solidBottoms: [groundY] }, grip };
}

export function propsOfType<T extends GuideProp['type']>(props: readonly GuideProp[], type: T): Extract<GuideProp, { type: T }>[] {
  return props.filter((p): p is Extract<GuideProp, { type: T }> => p.type === type);
}
