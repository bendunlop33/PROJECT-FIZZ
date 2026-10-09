/**
 * Keyframe resolution and sampling. Resolution fills every keyframe with the
 * full state (values carry forward from the previous keyframe; `sameAs`
 * copies an earlier one; every projection factor is explicit). Sampling
 * interpolates numeric channels with the segment's easing; `smooth` is a C2
 * cubic spline per channel (continuous velocity and acceleration through
 * mid-movement keys, still at holds and turning points, no overshoot; ADR
 * 0015). IK modes are discrete and taken from the segment start.
 */
import { PROJECTION_KEYS, type FootIk, type Guide, type HandIk, type IkLimb, type Projection } from './guide-schema';
import { ease, hermite, lerp, splineSlopes, type Ease } from './math';
import { ADULT_V1, JOINT_NAMES, type JointName } from './rig';

export interface FootTarget {
  x: number;
  y: number;
  soleDeg: number;
  pivot: 'ankle' | 'ball';
  planted: boolean;
  prop: string | null;
  bend: 'ccw' | 'cw' | null;
}

export interface HandTarget {
  x: number;
  y: number;
  prop: string | null;
  bend: 'ccw' | 'cw' | null;
  contact: 'grip' | 'palm';
}

export interface FrameState {
  root: { x: number; y: number; pelvisDeg: number };
  joints: Record<JointName, number>;
  ik: { footNear: FootTarget | null; footFar: FootTarget | null; handNear: HandTarget | null; handFar: HandTarget | null };
  props: Record<string, { x: number; y: number; s: number }>;
  /** Foreshortening in effect (guide-level values overridden by keyframes). */
  proj: Projection;
}

export interface ResolvedKeyframe {
  index: number;
  /** Normalised start time and the end of its hold. */
  t: number;
  holdEnd: number;
  label: string | null;
  caption: string | null;
  ease: Ease;
  state: FrameState;
}

function zeroJoints(): Record<JointName, number> {
  const out = {} as Record<JointName, number>;
  for (const j of JOINT_NAMES) out[j] = 0;
  return out;
}

function cloneState(s: FrameState): FrameState {
  return {
    root: { ...s.root },
    joints: { ...s.joints },
    ik: {
      footNear: s.ik.footNear && { ...s.ik.footNear },
      footFar: s.ik.footFar && { ...s.ik.footFar },
      handNear: s.ik.handNear && { ...s.ik.handNear },
      handFar: s.ik.handFar && { ...s.ik.handFar },
    },
    props: Object.fromEntries(Object.entries(s.props).map(([k, p]) => [k, { ...p }])),
    proj: { ...s.proj },
  };
}

function mergeFoot(prev: FootTarget | null, k: FootIk, dt: number, scroll: number): FootTarget {
  const base: FootTarget = prev ?? { x: 0, y: 0, soleDeg: 0, pivot: 'ankle', planted: false, prop: null, bend: null };
  const planted = k.planted ?? base.planted;
  // A planted contact with no new x rides the floor: it moves back as the floor scrolls.
  const carriedX = prev?.planted === true && planted ? base.x - scroll * dt : base.x;
  return {
    x: k.x ?? carriedX,
    y: k.y ?? base.y,
    soleDeg: k.soleDeg ?? base.soleDeg,
    pivot: k.pivot ?? base.pivot,
    planted,
    prop: k.prop ?? base.prop,
    bend: k.bend ?? base.bend,
  };
}

function mergeHand(prev: HandTarget | null, k: HandIk): HandTarget {
  const base: HandTarget = prev ?? { x: 0, y: 0, prop: null, bend: null, contact: 'grip' };
  return { x: k.x ?? base.x, y: k.y ?? base.y, prop: k.prop ?? base.prop, bend: k.bend ?? base.bend, contact: k.contact ?? base.contact };
}

export function resolveKeyframes(guide: Guide): ResolvedKeyframe[] {
  const out: ResolvedKeyframe[] = [];
  const scroll = guide.ground.scrollPerCycle;
  let state: FrameState = {
    root: { x: 0, y: ADULT_V1.hipHeight, pelvisDeg: 0 },
    joints: zeroJoints(),
    ik: { footNear: null, footFar: null, handNear: null, handFar: null },
    props: {},
    proj: { ...(guide.projection ?? {}) },
  };
  let prevT = 0;
  guide.keyframes.forEach((k, index) => {
    const ref = k.sameAs === undefined ? undefined : out[k.sameAs];
    const dt = k.t - prevT;
    if (ref !== undefined) {
      state = cloneState(ref.state);
    } else {
      state = cloneState(state);
      if (k.root?.x !== undefined) state.root.x = k.root.x;
      if (k.root?.y !== undefined) state.root.y = k.root.y;
      if (k.root?.pelvisDeg !== undefined) state.root.pelvisDeg = k.root.pelvisDeg;
      for (const [name, value] of Object.entries(k.joints ?? {})) state.joints[name as JointName] = value;
      const ik = k.ik ?? {};
      for (const limb of ['footNear', 'footFar'] as const) {
        const spec = ik[limb];
        if (spec === null) state.ik[limb] = null;
        else if (spec !== undefined) state.ik[limb] = mergeFoot(state.ik[limb], spec, dt, scroll);
        else if (state.ik[limb]?.planted === true) state.ik[limb] = mergeFoot(state.ik[limb], {}, dt, scroll);
      }
      for (const limb of ['handNear', 'handFar'] as const) {
        const spec = ik[limb];
        if (spec === null) state.ik[limb] = null;
        else if (spec !== undefined) state.ik[limb] = mergeHand(state.ik[limb], spec);
      }
      for (const [id, p] of Object.entries(k.props ?? {})) {
        const prev = state.props[id] ?? { x: 0, y: 0, s: 0 };
        state.props[id] = { x: p.x ?? prev.x, y: p.y ?? prev.y, s: p.s ?? prev.s };
      }
      Object.assign(state.proj, k.projection ?? {});
    }
    const holdEnd = k.t + (k.holdMs ?? 0) / guide.durationMs;
    out.push({
      index,
      t: k.t,
      holdEnd,
      label: k.label ?? ref?.label ?? null,
      caption: k.caption ?? ref?.caption ?? null,
      ease: k.ease ?? 'inOutSine',
      state,
    });
    prevT = k.t;
  });
  return out;
}

type Channels = Map<string, number>;

/**
 * Every projection factor as `pose.ts` reads it: a missing arm or leg is 1,
 * a missing forearm follows its arm and a missing shank its leg. Each key
 * emits all eight as channels, so a value set on only some keys blends in
 * instead of snapping at the next key that sets it (the key poses don't change).
 */
export function effectiveProjection(p: Projection): Record<(typeof PROJECTION_KEYS)[number], number> {
  const armNear = p.armNear ?? 1;
  const armFar = p.armFar ?? 1;
  const legNear = p.legNear ?? 1;
  const legFar = p.legFar ?? 1;
  return {
    armNear,
    armFar,
    forearmNear: p.forearmNear ?? armNear,
    forearmFar: p.forearmFar ?? armFar,
    legNear,
    legFar,
    shankNear: p.shankNear ?? legNear,
    shankFar: p.shankFar ?? legFar,
  };
}

/** Numeric channels of a state (discrete fields such as IK modes stay out). */
export function flattenState(s: FrameState): ReadonlyMap<string, number> {
  return flatten(s);
}

function flatten(s: FrameState): Channels {
  const c: Channels = new Map();
  c.set('root.x', s.root.x);
  c.set('root.y', s.root.y);
  c.set('root.pelvisDeg', s.root.pelvisDeg);
  for (const j of JOINT_NAMES) c.set(`joints.${j}`, s.joints[j]);
  for (const limb of ['footNear', 'footFar'] as const) {
    const t = s.ik[limb];
    if (t === null) continue;
    c.set(`ik.${limb}.x`, t.x);
    c.set(`ik.${limb}.y`, t.y);
    c.set(`ik.${limb}.soleDeg`, t.soleDeg);
  }
  for (const limb of ['handNear', 'handFar'] as const) {
    const t = s.ik[limb];
    if (t === null) continue;
    c.set(`ik.${limb}.x`, t.x);
    c.set(`ik.${limb}.y`, t.y);
  }
  for (const [id, p] of Object.entries(s.props)) {
    c.set(`props.${id}.x`, p.x);
    c.set(`props.${id}.y`, p.y);
    c.set(`props.${id}.s`, p.s);
  }
  const proj = effectiveProjection(s.proj);
  for (const key of PROJECTION_KEYS) c.set(`proj.${key}`, proj[key]);
  return c;
}

function unflatten(base: FrameState, c: Channels): FrameState {
  const out = cloneState(base);
  out.root = { x: c.get('root.x') ?? base.root.x, y: c.get('root.y') ?? base.root.y, pelvisDeg: c.get('root.pelvisDeg') ?? base.root.pelvisDeg };
  for (const j of JOINT_NAMES) out.joints[j] = c.get(`joints.${j}`) ?? base.joints[j];
  for (const limb of ['footNear', 'footFar'] as const) {
    const t = out.ik[limb];
    if (t === null) continue;
    out.ik[limb] = { ...t, x: c.get(`ik.${limb}.x`) ?? t.x, y: c.get(`ik.${limb}.y`) ?? t.y, soleDeg: c.get(`ik.${limb}.soleDeg`) ?? t.soleDeg };
  }
  for (const limb of ['handNear', 'handFar'] as const) {
    const t = out.ik[limb];
    if (t === null) continue;
    out.ik[limb] = { ...t, x: c.get(`ik.${limb}.x`) ?? t.x, y: c.get(`ik.${limb}.y`) ?? t.y };
  }
  for (const [id, p] of Object.entries(out.props)) {
    out.props[id] = { x: c.get(`props.${id}.x`) ?? p.x, y: c.get(`props.${id}.y`) ?? p.y, s: c.get(`props.${id}.s`) ?? p.s };
  }
  for (const key of PROJECTION_KEYS) {
    const value = c.get(`proj.${key}`);
    if (value !== undefined) out.proj[key] = value;
  }
  return out;
}

const LIMB_OF_CHANNEL = /^ik\.(footNear|footFar|handNear|handFar)\./;

/** Same IK mode at both ends of a segment (otherwise the start's mode and values hold). */
function sameMode(a: FootTarget | HandTarget | null, b: FootTarget | HandTarget | null): boolean {
  if (a === null || b === null || a.prop !== b.prop) return false;
  return !('contact' in a) || !('contact' in b) || a.contact === b.contact;
}

/** Can `channel` be interpolated across segment i (key i → i+1)? Not if either end lacks it or an IK limb changes mode. */
function segmentUsable(keys: readonly ResolvedKeyframe[], flat: readonly Channels[], i: number, channel: string): boolean {
  const a = keys[i];
  const b = keys[i + 1];
  if (a === undefined || b === undefined || !flat[i]?.has(channel) || !flat[i + 1]?.has(channel)) return false;
  const limb = LIMB_OF_CHANNEL.exec(channel)?.[1] as keyof FrameState['ik'] | undefined;
  return limb === undefined || sameMode(a.state.ik[limb], b.state.ik[limb]);
}

/** A hold at key k (in a cycle the first and last keys are the same moment, so either one's hold counts for both). */
function holdsAt(guide: Guide, keys: readonly ResolvedKeyframe[], k: number): boolean {
  const last = keys.length - 1;
  const held = (i: number): boolean => {
    const key = keys[i];
    return key !== undefined && key.holdEnd > key.t;
  };
  if (held(k)) return true;
  return guide.loop === 'cycle' && (k === 0 || k === last) && (held(0) || held(last));
}

const FOOT_X = /^ik\.(footNear|footFar)\.x$/;

/**
 * Stance rule (`ground.matchFloorSpeed`, ADR 0015): where a foot planted on a
 * scrolling floor lifts off or lands, its x leaves or meets the floor at the
 * floor's speed, so there is no velocity jump at the contact change.
 */
function stanceSlope(guide: Guide, keys: readonly ResolvedKeyframe[], k: number, channel: string): number | null {
  if (guide.ground.matchFloorSpeed !== true) return null;
  const limb = FOOT_X.exec(channel)?.[1] as 'footNear' | 'footFar' | undefined;
  if (limb === undefined) return null;
  const last = keys.length - 1;
  const cycle = guide.loop === 'cycle';
  const prev = k > 0 ? k - 1 : cycle ? last - 1 : -1;
  const next = k < last ? k + 1 : cycle ? 1 : -1;
  const here = keys[k]?.state.ik[limb];
  if (prev < 0 || next < 0 || here?.planted !== true || here.prop !== null) return null;
  const before = keys[prev]?.state.ik[limb]?.planted === true;
  const after = keys[next]?.state.ik[limb]?.planted === true;
  return before !== after ? -guide.ground.scrollPerCycle : null;
}

/**
 * Channel mode (`motion: "channels"`, the default): each channel is a C2
 * cubic spline through its key values in moving time (holds removed), so
 * velocity and acceleration are continuous at mid-movement keys. Slopes are 0
 * at holds, turning points, flat or missing sides and the open ends of a
 * ping-pong, and the monotone guard stops any overshoot (`splineSlopes`).
 */
function channelKnotSlopes(guide: Guide, keys: readonly ResolvedKeyframe[], flat: readonly Channels[], x: readonly number[], channel: string): number[] {
  const n = keys.length;
  const last = n - 1;
  const cycle = guide.loop === 'cycle';
  const y = flat.map((c) => c.get(channel) ?? 0);
  const usable = (i: number): boolean => segmentUsable(keys, flat, i, channel) && (x[i + 1] ?? 0) - (x[i] ?? 0) > 0;
  const secant = (i: number): number => ((y[i + 1] ?? 0) - (y[i] ?? 0)) / ((x[i + 1] ?? 0) - (x[i] ?? 0));
  const fixed: (number | null)[] = [];
  for (let k = 0; k < n; k += 1) {
    const stance = stanceSlope(guide, keys, k, channel);
    if (stance !== null) {
      fixed.push(stance);
      continue;
    }
    const L = k > 0 ? k - 1 : cycle ? last - 1 : -1;
    const R = k < last ? k : cycle ? 0 : -1;
    if (holdsAt(guide, keys, k) || L < 0 || R < 0 || !usable(L) || !usable(R)) {
      fixed.push(0);
      continue;
    }
    const dl = secant(L);
    const dr = secant(R);
    fixed.push(dl === 0 || dr === 0 || Math.sign(dl) !== Math.sign(dr) ? 0 : null);
  }
  return splineSlopes(x, y, fixed, cycle);
}

/** Planted feet ride the floor linearly in time (never eased), so the contact never slides. */
function ridePlanted(guide: Guide, a: FrameState, b: FrameState, tc: number, segStart: number, out: FrameState): void {
  for (const limb of ['footNear', 'footFar'] as const) {
    const fa = a.ik[limb];
    const fb = b.ik[limb];
    const o = out.ik[limb];
    if (fa?.planted === true && fb?.planted === true && fa.prop === null && fb.prop === null && o !== null) {
      out.ik[limb] = { ...o, x: fa.x - guide.ground.scrollPerCycle * (tc - segStart), y: fa.y };
    }
  }
}

/**
 * Everything sampling needs that depends only on the keys, built once per
 * resolved keyframe list: flattened channels, knot positions and (lazily,
 * per channel) the slopes at both ends of every segment. `stateAt` runs for
 * every sampled frame (the app bakes a whole cycle on Hermes, which has no
 * JIT), so per-frame work is one Hermite per channel. Resolved keyframes are
 * never mutated after `resolveKeyframes`.
 */
interface SamplingPlan {
  flat: readonly Channels[];
  /** Knot of each key in moving time (holds removed): segment i spans `keys[i].holdEnd` → `keys[i + 1].t`. */
  x: readonly number[];
  /** Per channel: [slope at the start of segment 0, at its end, at the start of segment 1, …]. */
  slopes: Map<string, Float64Array>;
}

const planCache = new WeakMap<readonly ResolvedKeyframe[], SamplingPlan>();

function samplingPlan(keys: readonly ResolvedKeyframe[]): SamplingPlan {
  let plan = planCache.get(keys);
  if (plan === undefined) {
    const x: number[] = [];
    let held = 0;
    for (const k of keys) {
      x.push(k.t - held);
      held += k.holdEnd - k.t;
    }
    plan = { flat: keys.map((k) => flatten(k.state)), x, slopes: new Map() };
    planCache.set(keys, plan);
  }
  return plan;
}

function segmentSlopes(guide: Guide, keys: readonly ResolvedKeyframe[], plan: SamplingPlan, channel: string): Float64Array {
  let m = plan.slopes.get(channel);
  if (m === undefined) {
    const knots = channelKnotSlopes(guide, keys, plan.flat, plan.x, channel);
    m = new Float64Array(2 * Math.max(0, keys.length - 1));
    for (let i = 0; i + 1 < keys.length; i += 1) {
      m[2 * i] = knots[i] ?? 0;
      m[2 * i + 1] = knots[i + 1] ?? 0;
    }
    plan.slopes.set(channel, m);
  }
  return m;
}

/** The interpolated state at normalised time `t` (0–1). */
export function stateAt(guide: Guide, keys: readonly ResolvedKeyframe[], t: number): FrameState {
  const first = keys[0];
  if (first === undefined) throw new Error('A guide needs keyframes');
  const tc = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.t ?? Infinity) <= tc) i += 1;
  const a = keys[i] ?? first;
  const b = keys[i + 1];
  if (b === undefined) return cloneState(a.state);
  if (tc <= a.holdEnd) {
    const held = cloneState(a.state);
    ridePlanted(guide, a.state, b.state, tc, a.t, held);
    return held;
  }
  const span = b.t - a.holdEnd;
  const s = span <= 0 ? 1 : (tc - a.holdEnd) / span;
  const plan = samplingPlan(keys);
  const fa = plan.flat[i] ?? new Map<string, number>();
  const fb = plan.flat[i + 1] ?? new Map<string, number>();
  const out: Channels = new Map();
  for (const [name, va] of fa) {
    const vb = fb.get(name);
    if (vb === undefined || !segmentUsable(keys, plan.flat, i, name)) {
      out.set(name, va);
    } else if (a.ease === 'smooth') {
      const m = segmentSlopes(guide, keys, plan, name);
      out.set(name, hermite(va, vb, m[2 * i] ?? 0, m[2 * i + 1] ?? 0, s, span));
    } else {
      out.set(name, lerp(va, vb, ease(a.ease, s)));
    }
  }
  const state = unflatten(a.state, out);
  // A foot is planted mid-segment only if it is planted at both ends (lift-off and touch-down move).
  for (const limb of ['footNear', 'footFar'] as const) {
    const f = state.ik[limb];
    if (f !== null && b.state.ik[limb]?.planted !== true) state.ik[limb] = { ...f, planted: false };
  }
  ridePlanted(guide, a.state, b.state, tc, a.t, state);
  return state;
}

/** Frame times for a given rate, plus every keyframe time (and hold end), sorted and unique. */
export function sampleTimes(guide: Guide, keys: readonly ResolvedKeyframe[], fps: number): number[] {
  const n = Math.max(2, Math.round((guide.durationMs / 1000) * fps));
  const times = new Set<number>();
  for (let i = 0; i <= n; i += 1) times.add(i / n);
  for (const k of keys) {
    times.add(k.t);
    times.add(Math.min(1, k.holdEnd));
  }
  return [...times].sort((a, b) => a - b);
}

export type { IkLimb };
