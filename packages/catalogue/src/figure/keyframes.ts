/**
 * Keyframe resolution and sampling. Resolution fills every keyframe with the
 * full state (values carry forward from the previous keyframe; `sameAs`
 * copies an earlier one). Sampling interpolates numeric channels with the
 * segment's easing (or a monotone cubic for `smooth`); IK modes are discrete
 * and taken from the segment start.
 */
import { PROJECTION_KEYS, type FootIk, type Guide, type HandIk, type IkLimb, type Projection } from './guide-schema';
import { ease, hermite, lerp, monotoneSlope, type Ease } from './math';
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

/** Numeric channels of a state (discrete fields such as IK modes stay out). */
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
  for (const key of PROJECTION_KEYS) {
    const value = s.proj[key];
    if (value !== undefined) c.set(`proj.${key}`, value);
  }
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

/** Slope of `channel` on segment i (key i → key i+1), or null if it isn't there. */
function segmentSlope(keys: readonly ResolvedKeyframe[], flat: readonly Channels[], i: number, channel: string): { slope: number; h: number } | null {
  const a = keys[i];
  const b = keys[i + 1];
  const va = flat[i]?.get(channel);
  const vb = flat[i + 1]?.get(channel);
  if (a === undefined || b === undefined || va === undefined || vb === undefined) return null;
  const h = b.t - a.holdEnd;
  return h > 0 ? { slope: (vb - va) / h, h } : null;
}

/** Slope at keyframe k for the `smooth` ease: zero at holds, turning points and open ends. */
function keySlope(guide: Guide, keys: readonly ResolvedKeyframe[], flat: readonly Channels[], k: number, channel: string): number {
  const last = keys.length - 1;
  const key = keys[k];
  if (key === undefined) return 0;
  const cycle = guide.loop === 'cycle';
  // In a cycle the first and last keyframes are the same moment.
  const holdHere = key.holdEnd > key.t || (cycle && k === last && (keys[0]?.holdEnd ?? 0) > 0);
  if (holdHere) return 0;
  const leftIdx = k === 0 ? (cycle ? last - 1 : -1) : k - 1;
  const rightIdx = k === last ? (cycle ? 0 : -1) : k;
  const left = leftIdx >= 0 ? segmentSlope(keys, flat, leftIdx, channel) : null;
  const right = rightIdx >= 0 ? segmentSlope(keys, flat, rightIdx, channel) : null;
  if (left === null || right === null) return 0;
  return monotoneSlope(left.slope, right.slope, left.h, right.h);
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
  const flat = keys.map((k) => flatten(k.state));
  const fa = flat[i] ?? new Map<string, number>();
  const fb = flat[i + 1] ?? new Map<string, number>();
  const out: Channels = new Map();
  for (const [name, va] of fa) {
    const limb = LIMB_OF_CHANNEL.exec(name)?.[1] as keyof FrameState['ik'] | undefined;
    const vb = fb.get(name);
    if (vb === undefined || (limb !== undefined && !sameMode(a.state.ik[limb], b.state.ik[limb]))) {
      out.set(name, va);
    } else if (a.ease === 'smooth') {
      out.set(name, hermite(va, vb, keySlope(guide, keys, flat, i, name), keySlope(guide, keys, flat, i + 1, name), s, span));
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
