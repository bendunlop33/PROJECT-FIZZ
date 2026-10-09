/**
 * Motion metrics for animated guides (ADR 0015): does each joint move in one
 * seamless motion? Pure (no fs): `guide:motion` prints them, `guide:check`
 * runs the hard ones and the unit tests use them. Every metric samples
 * `poseAt`, so it measures what is drawn, not the keyframe file.
 *
 * A **phase** is one stretch of movement between two stops: the holds, the
 * cycle's ends and keys where the main points turn back. Gait guides (a
 * scrolling floor) use half-strides from `MOTION_CONFIG`. τ is the normalised
 * time within a phase.
 *
 * Levels: `hard` metrics are bugs (a pose jump, a contact velocity jump,
 * interpolation overshoot); `quality` metrics are the acceptance thresholds
 * for "one seamless motion"; `warn` metrics are reported only.
 */
import { flattenState, stateAt } from './keyframes';
import { dist, type Vec } from './math';
import { playbackTimes, PLAYBACK_FPS } from './playback';
import { poseAt, type Pose, type PreparedGuide } from './pose';
import type { AngleName } from './rig';

export type PointRef = { point: string } | { prop: string };

export interface MotionConfig {
  /** Points whose speed should rise and fall once per phase (the bar, the hip, the grip). */
  main: readonly PointRef[];
  /** Joints the movement is about: one speed hump per phase and no backtracking. */
  primary: readonly AngleName[];
  /** Joints that should move in step (half-way at the same time). */
  pairs: readonly (readonly [AngleName, AngleName])[];
  /** Gait guides: phases in normalised time (half-strides) instead of stops. */
  phases?: readonly (readonly [number, number])[];
}

const pt = (point: string): PointRef => ({ point });
const prop = (id: string): PointRef => ({ prop: id });

/** Per-guide main points, primary joints and joint pairs (plan §6). */
export const MOTION_CONFIG: Readonly<Record<string, MotionConfig>> = {
  'barbell-back-squat': {
    main: [prop('bar'), pt('hip')],
    primary: ['hipNear', 'kneeNear', 'ankleNear', 'pelvis'],
    pairs: [
      ['hipNear', 'kneeNear'],
      ['kneeNear', 'ankleNear'],
    ],
  },
  'barbell-bench-press': { main: [prop('bar')], primary: ['shoulderNear', 'elbowNear'], pairs: [['shoulderNear', 'elbowNear']] },
  'barbell-overhead-press': { main: [prop('bar')], primary: ['shoulderNear', 'elbowNear'], pairs: [['shoulderNear', 'elbowNear']] },
  'barbell-romanian-deadlift': { main: [prop('bar'), pt('hip')], primary: ['pelvis', 'hipNear'], pairs: [] },
  'cable-lat-pulldown': { main: [prop('bar')], primary: ['shoulderNear', 'elbowNear'], pairs: [['shoulderNear', 'elbowNear']] },
  'cable-triceps-pushdown': { main: [pt('gripNear')], primary: ['elbowNear'], pairs: [] },
  'dumbbell-bulgarian-split-squat': { main: [pt('hip'), pt('kneeNear')], primary: ['kneeNear', 'hipNear', 'ankleNear', 'hipFar'], pairs: [['kneeNear', 'hipNear']] },
  'dumbbell-one-arm-row': { main: [pt('gripNear')], primary: ['shoulderNear', 'elbowNear'], pairs: [['shoulderNear', 'elbowNear']] },
  'machine-leg-press': { main: [prop('press'), pt('kneeNear')], primary: ['kneeNear', 'hipNear', 'ankleNear'], pairs: [['kneeNear', 'hipNear']] },
  'sled-push': {
    main: [pt('ankleNear'), pt('ankleFar')],
    primary: ['kneeNear', 'kneeFar', 'hipNear', 'hipFar'],
    pairs: [],
    phases: [
      [0, 0.5],
      [0.5, 1],
    ],
  },
};

/** The guide's config, or a default (its first barbell or leg-press prop, else the hip). */
export function motionConfig(prepared: PreparedGuide): MotionConfig {
  const known = MOTION_CONFIG[prepared.guide.exerciseKey];
  if (known !== undefined) return known;
  const p = prepared.guide.props.find((q) => q.type === 'barbell' || q.type === 'leg_press');
  return { main: [p === undefined ? pt('hip') : prop(p.id)], primary: [], pairs: [] };
}

/** Thresholds (plan §5). Ratios are fractions, angles degrees, distances H, speeds H/s. */
export const MOTION_LIMITS = {
  /** C1: max jump of any point at a key, hold end or the cycle seam (= `LIMITS.loopTolerance`). */
  continuity: 0.002,
  /** C2: ankle velocity jump where a foot lifts off or lands. */
  contactVelocity: 0.02,
  /** C4: how far a channel may leave its bracketing key values, as a share of its cycle range. */
  overshoot: 0.005,
  /** Humps: local maxima at least this share of the phase peak above their surroundings. */
  humpProminence: 0.1,
  /** M2: the speed peak sits in this part of the phase. */
  peakTau: [0.35, 0.65],
  /** M3: slowest speed over τ 0.2–0.8, as a share of the peak (ideal minimum-jerk: 0.41). */
  stall: 0.3,
  /** M4: speed in the 1st and 2nd baked frame next to a stop, as a share of the peak (ideal 0.017 / 0.062). */
  easeFirst: 0.05,
  easeSecond: 0.15,
  /** M5: acceleration jump at a pass key or hold edge, as a share of the phase's peak acceleration. */
  accelJump: 0.1,
  /** M6: worst frame-to-frame speed step at 30 fps over the ideal minimum-jerk step (3.08 / frames in the phase). */
  frameStep: 2.5,
  /** J2: backtracking against the phase's net direction. */
  reversalPrimaryDeg: 1,
  reversalAnyDeg: 2,
  reversalPoint: 0.005,
  /** J3: joint pairs half-way at most this far apart, and never further apart in progress than this. */
  syncMs: 100,
  syncGap: 0.25,
  /** J4 (warning): share of an IK joint's extension in the last 10% of the phase, and its speed at τ 0.95. */
  whipShare: 0.06,
  whipOmega: 0.35,
  /** S1–S3, gait guides. */
  gaitKneeStep: 0.4,
  gaitLiftOffDegPerS: 200,
  gaitToeOffReach: 0.97,
  /** P1 (warning): a pass key's authored time vs the chord-length suggestion, in cycles. */
  passTiming: 0.01,
  /** J1/J3/J4 only look at joints that move more than this in a phase. */
  movingDeg: 10,
} as const;

export type MetricLevel = 'hard' | 'quality' | 'warn';

export interface MotionMetric {
  id: string;
  name: string;
  level: MetricLevel;
  /** Worst value over the guide; null when the metric doesn't apply (n/a). */
  value: number | null;
  /** The limit as text (`≤ 0.002 H`, `= 1`, `0.35–0.65`). */
  limit: string;
  ok: boolean;
  /** Where the worst value is (phase, point or joint, time). */
  where: string;
}

export interface MotionPhase {
  /** Normalised start (a stop's hold end) and end (the next stop's time). */
  from: number;
  to: number;
}

export interface PassSuggestion {
  key: number;
  label: string | null;
  t: number;
  suggested: number;
  /** The key's chord-length share of its phase. */
  share: number;
}

export interface MotionReport {
  exerciseKey: string;
  motion: 'channels' | 'phases';
  gait: boolean;
  phases: MotionPhase[];
  metrics: MotionMetric[];
  suggestions: PassSuggestion[];
}

/** Dense sampling per cycle for the continuous metrics. */
export const MOTION_SAMPLES = 2400;
/** Step for one-sided derivatives at keys (normalised time). */
const H = 1e-4;
const EPS = 1e-6;

const f = (x: number, d = 3): string => x.toFixed(d);

function pointOf(pose: Pose, ref: PointRef): Vec | undefined {
  return 'point' in ref ? pose.points[ref.point] : pose.propPoints[ref.prop];
}

const refName = (ref: PointRef): string => ('point' in ref ? ref.point : `prop ${ref.prop}`);

function isGait(prepared: PreparedGuide, config: MotionConfig): boolean {
  return config.phases !== undefined || prepared.guide.ground.scrollPerCycle > 0;
}

/** Concatenated main-point coordinates of a pose. */
function mainVector(pose: Pose, main: readonly PointRef[]): number[] {
  const out: number[] = [];
  for (const ref of main) {
    const p = pointOf(pose, ref);
    if (p !== undefined) out.push(p.x, p.y);
  }
  return out;
}

/** Keys that end a phase: the ends, holds, and keys where the main points turn back. */
export function stopKeys(prepared: PreparedGuide, config: MotionConfig = motionConfig(prepared)): number[] {
  const { keys } = prepared;
  const last = keys.length - 1;
  const vec = keys.map((k) => mainVector(poseAt(prepared, k.t), config.main));
  const stops = [0];
  for (let k = 1; k < last; k += 1) {
    const key = keys[k];
    const a = vec[k - 1] ?? [];
    const b = vec[k] ?? [];
    const c = vec[k + 1] ?? [];
    const dot = b.reduce((s, x, i) => s + (x - (a[i] ?? x)) * ((c[i] ?? x) - x), 0);
    if ((key !== undefined && key.holdEnd > key.t) || dot <= 0) stops.push(k);
  }
  stops.push(last);
  return stops;
}

/** The guide's phases (see the module comment). */
export function motionPhases(prepared: PreparedGuide, config: MotionConfig = motionConfig(prepared)): MotionPhase[] {
  if (config.phases !== undefined) return config.phases.map(([from, to]) => ({ from, to }));
  const stops = stopKeys(prepared, config);
  const out: MotionPhase[] = [];
  for (let j = 0; j + 1 < stops.length; j += 1) {
    const a = prepared.keys[stops[j] ?? 0];
    const b = prepared.keys[stops[j + 1] ?? 0];
    if (a !== undefined && b !== undefined && b.t > a.holdEnd) out.push({ from: a.holdEnd, to: b.t });
  }
  return out;
}

/** Poses at t = i/n (i = 0…n), shared by the dense metrics. */
interface Dense {
  n: number;
  /** Cycle length in seconds. */
  sec: number;
  cycle: boolean;
  poses: Pose[];
}

function sampleDense(prepared: PreparedGuide, n: number): Dense {
  return {
    n,
    sec: prepared.guide.durationMs / 1000,
    cycle: prepared.guide.loop === 'cycle',
    poses: Array.from({ length: n + 1 }, (_, i) => poseAt(prepared, i / n)),
  };
}

/** Index range of the dense samples inside a phase. */
function phaseRange(d: Dense, ph: MotionPhase): [number, number] {
  return [Math.ceil(ph.from * d.n - 1e-9), Math.floor(ph.to * d.n + 1e-9)];
}

/** Value series on the dense samples (wraps for cycles); null if any sample lacks it. */
function series<T>(d: Dense, get: (p: Pose) => T | undefined): T[] | null {
  const out: T[] = [];
  for (const p of d.poses) {
    const x = get(p);
    if (x === undefined) return null;
    out.push(x);
  }
  return out;
}

/** Neighbour indices for a central difference at i (wrapping a cycle, one-sided at open ends). */
function around(d: Dense, i: number): [number, number] {
  if (i <= 0) return [d.cycle ? d.n - 1 : 0, 1];
  if (i >= d.n) return [d.n - 1, d.cycle ? 1 : d.n];
  return [i - 1, i + 1];
}

/** Point speed (H/s) at each dense sample. */
function speeds(d: Dense, xs: readonly Vec[]): number[] {
  return xs.map((_, i) => {
    const [a, b] = around(d, i);
    const pa = xs[a];
    const pb = xs[b];
    if (pa === undefined || pb === undefined) return 0;
    const span = (b - a + (b < a ? d.n : 0)) / d.n;
    return span > 0 ? dist(pa, pb) / (span * d.sec) : 0;
  });
}

/** Angular speed (°/s, signed) at each dense sample. */
function omegas(d: Dense, xs: readonly number[]): number[] {
  return xs.map((_, i) => {
    const [a, b] = around(d, i);
    const span = (b - a + (b < a ? d.n : 0)) / d.n;
    return span > 0 ? ((xs[b] ?? 0) - (xs[a] ?? 0)) / (span * d.sec) : 0;
  });
}

/** Local maxima at least `prominence` × peak above the lower of their two surrounding minima. */
export function countHumps(xs: readonly number[], prominence: number = MOTION_LIMITS.humpProminence): number {
  const peak = Math.max(0, ...xs);
  if (!(peak > 0)) return 0;
  let count = 0;
  for (let i = 1; i + 1 < xs.length; i += 1) {
    const x = xs[i] ?? 0;
    if (!(x > (xs[i - 1] ?? 0) && x >= (xs[i + 1] ?? 0))) continue;
    // Ties: an equal peak to the left counts as higher, so twin peaks give one hump each only if a real dip parts them.
    let left = x;
    for (let k = i - 1; k >= 0; k -= 1) {
      const y = xs[k] ?? 0;
      if (y >= x) break;
      left = Math.min(left, y);
    }
    let right = x;
    for (let k = i + 1; k < xs.length; k += 1) {
      const y = xs[k] ?? 0;
      if (y > x) break;
      right = Math.min(right, y);
    }
    if (x - Math.max(left, right) >= prominence * peak) count += 1;
  }
  return count;
}

/** Largest backtrack against the net direction of `xs` (running extreme minus current value). */
export function reversal(xs: readonly number[]): number {
  const first = xs[0];
  const last = xs[xs.length - 1];
  if (first === undefined || last === undefined) return 0;
  const sign = last >= first ? 1 : -1;
  let ext = first;
  let worst = 0;
  for (const x of xs) {
    if ((x - ext) * sign > 0) ext = x;
    worst = Math.max(worst, (ext - x) * sign);
  }
  return worst;
}

/** Collects the worst value of one metric over every phase, point and joint. */
class Worst {
  value: number | null = null;
  where = '';
  bad: string[] = [];
  private readonly worse: (a: number, b: number) => boolean;
  constructor(worse: (a: number, b: number) => boolean) {
    this.worse = worse;
  }
  add(value: number, where: string, ok: boolean): void {
    if (this.value === null || this.worse(value, this.value)) {
      this.value = value;
      this.where = where;
    }
    if (!ok) this.bad.push(where);
  }
}

const higher = (): Worst => new Worst((a, b) => a > b);

function metric(id: string, name: string, level: MetricLevel, limit: string, w: Worst, fmt: (x: number) => string = (x) => f(x)): MotionMetric {
  if (w.value === null) return { id, name, level, value: null, limit, ok: true, where: 'n/a' };
  const where = w.bad.length > 1 ? `${w.where} (+${w.bad.length - 1} more)` : w.where;
  return { id, name, level, value: w.value, limit, ok: w.bad.length === 0, where: `${fmt(w.value)} at ${where}` };
}

const phaseName = (ph: MotionPhase): string => `phase ${f(ph.from)}–${f(ph.to)}`;

/** Max displacement of any point or prop point between two poses. */
function poseJump(a: Pose, b: Pose): { d: number; name: string } {
  let worst = { d: 0, name: '' };
  for (const [name, p] of Object.entries(a.points)) {
    const q = b.points[name];
    if (q !== undefined && dist(p, q) > worst.d) worst = { d: dist(p, q), name };
  }
  for (const [name, p] of Object.entries(a.propPoints)) {
    const q = b.propPoints[name];
    if (q !== undefined && dist(p, q) > worst.d) worst = { d: dist(p, q), name: `prop ${name}` };
  }
  return worst;
}

/**
 * C1 `pose-continuity`: nothing jumps at a key, a hold end or the cycle seam
 * (`poseAt(t − ε)` against `poseAt(t + ε)`; the seam compares `1 − ε` with 0).
 */
export function poseContinuity(prepared: PreparedGuide): MotionMetric {
  const w = higher();
  const times = new Set<number>();
  for (const k of prepared.keys) {
    times.add(k.t);
    times.add(k.holdEnd);
  }
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t <= 0 || t >= 1) continue;
    const j = poseJump(poseAt(prepared, t - EPS), poseAt(prepared, t + EPS));
    w.add(j.d, `${j.name} t=${f(t)}`, j.d <= MOTION_LIMITS.continuity);
  }
  if (prepared.guide.loop === 'cycle') {
    const j = poseJump(poseAt(prepared, 1 - EPS), poseAt(prepared, 0));
    w.add(j.d, `${j.name} at the loop seam`, j.d <= MOTION_LIMITS.continuity);
  }
  return metric('C1', 'pose-continuity', 'hard', `≤ ${MOTION_LIMITS.continuity} H`, w, (x) => `${f(x, 4)} H`);
}

/** Times where a foot changes between planted and swinging (a segment is planted only if both its keys are). */
export function contactChanges(prepared: PreparedGuide): { limb: 'footNear' | 'footFar'; t: number; liftOff: boolean }[] {
  const { keys } = prepared;
  const last = keys.length - 1;
  const cycle = prepared.guide.loop === 'cycle';
  const out: { limb: 'footNear' | 'footFar'; t: number; liftOff: boolean }[] = [];
  const planted = (k: number, limb: 'footNear' | 'footFar'): boolean => keys[k]?.state.ik[limb]?.planted === true;
  for (const limb of ['footNear', 'footFar'] as const) {
    for (let k = 0; k <= last; k += 1) {
      if (cycle && k === last) continue;
      const prev = k === 0 ? (cycle ? last - 1 : -1) : k - 1;
      const next = k === last ? -1 : k + 1;
      if (prev < 0 || next < 0) continue;
      const before = planted(prev, limb) && planted(k, limb);
      const after = planted(k, limb) && planted(next, limb);
      if (before !== after) out.push({ limb, t: keys[k]?.t ?? 0, liftOff: before });
    }
  }
  return out;
}

const wrapT = (t: number): number => (t < 0 ? t + 1 : t > 1 ? t - 1 : t);

/**
 * C2 `contact-velocity`: a foot's ankle keeps its velocity where it lifts off
 * or lands (one-sided differences, H/s). On a scrolling floor a planted foot
 * moves with the floor, so it should leave and land at the floor's speed.
 */
export function contactVelocity(prepared: PreparedGuide): MotionMetric {
  const w = higher();
  const sec = prepared.guide.durationMs / 1000;
  const cycle = prepared.guide.loop === 'cycle';
  for (const c of contactChanges(prepared)) {
    const name = c.limb === 'footNear' ? 'ankleNear' : 'ankleFar';
    const at = (t: number): Vec | undefined => poseAt(prepared, cycle ? wrapT(t) : Math.min(1, Math.max(0, t))).points[name];
    // At the seam, t = 0 and t = 1 are the same pose.
    const p0 = at(c.t);
    const pm = at(c.t - H);
    const pp = at(c.t + H);
    if (p0 === undefined || pm === undefined || pp === undefined) continue;
    const vm = { x: (p0.x - pm.x) / (H * sec), y: (p0.y - pm.y) / (H * sec) };
    const vp = { x: (pp.x - p0.x) / (H * sec), y: (pp.y - p0.y) / (H * sec) };
    const jump = dist(vm, vp);
    w.add(jump, `${name} ${c.liftOff ? 'lift-off' : 'touch-down'} t=${f(c.t)}`, jump <= MOTION_LIMITS.contactVelocity);
  }
  return metric('C2', 'contact-velocity', 'hard', `≤ ${MOTION_LIMITS.contactVelocity} H/s`, w, (x) => `${f(x)} H/s`);
}

/** C4 `overshoot`: every channel stays within its bracketing key values (plus 0.5% of its cycle range). */
export function channelOvershoot(prepared: PreparedGuide, n: number = MOTION_SAMPLES): MotionMetric {
  const { guide, keys } = prepared;
  const w = higher();
  const flat = keys.map((k) => flattenState(k.state));
  const range = new Map<string, number>();
  for (const name of flat[0]?.keys() ?? []) {
    const vs = flat.map((c) => c.get(name)).filter((x): x is number => x !== undefined);
    range.set(name, Math.max(...vs) - Math.min(...vs));
  }
  for (let i = 0; i + 1 < keys.length; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (a === undefined || b === undefined) continue;
    for (let s = Math.ceil(a.holdEnd * n); s / n < b.t; s += 1) {
      const t = s / n;
      if (t <= a.holdEnd) continue;
      const state = flattenState(stateAt(guide, keys, t));
      for (const [name, x] of state) {
        const va = flat[i]?.get(name);
        const vb = flat[i + 1]?.get(name);
        const r = range.get(name) ?? 0;
        if (va === undefined || vb === undefined || !(r > 1e-9)) continue;
        const over = Math.max(0, x - Math.max(va, vb), Math.min(va, vb) - x) / r;
        w.add(over, `${name} t=${f(t)}`, over <= MOTION_LIMITS.overshoot);
      }
    }
  }
  return metric('C4', 'overshoot', 'hard', `≤ ${MOTION_LIMITS.overshoot * 100}% of range`, w, (x) => `${f(x * 100, 2)}%`);
}

/** Instantaneous point speed (H/s) at t, central difference with step H. */
function speedAt(prepared: PreparedGuide, ref: PointRef, t: number): number {
  const sec = prepared.guide.durationMs / 1000;
  const cycle = prepared.guide.loop === 'cycle';
  const clampT = (x: number): number => (cycle ? wrapT(x) : Math.min(1, Math.max(0, x)));
  const a = pointOf(poseAt(prepared, clampT(t - H)), ref);
  const b = pointOf(poseAt(prepared, clampT(t + H)), ref);
  return a === undefined || b === undefined ? 0 : dist(a, b) / (2 * H * sec);
}

/** One-sided accelerations (H/s², vectors) just before and after t. */
function accelJump(prepared: PreparedGuide, ref: PointRef, t: number): number {
  const sec = prepared.guide.durationMs / 1000;
  const at = (x: number): Vec | undefined => pointOf(poseAt(prepared, Math.min(1, Math.max(0, x))), ref);
  const p = [at(t - 2 * H), at(t - H), at(t), at(t + H), at(t + 2 * H)];
  if (p.some((q) => q === undefined)) return 0;
  const [m2, m1, p0, p1, p2] = p as [Vec, Vec, Vec, Vec, Vec];
  const k = 1 / (H * sec) ** 2;
  const am = { x: (p0.x - 2 * m1.x + m2.x) * k, y: (p0.y - 2 * m1.y + m2.y) * k };
  const ap = { x: (p2.x - 2 * p1.x + p0.x) * k, y: (p2.y - 2 * p1.y + p0.y) * k };
  return dist(am, ap);
}

/** The baked frame times of one pass (30 fps), closed with t = 1 for a cycle. */
function frameTimes(prepared: PreparedGuide): number[] {
  const times = playbackTimes(prepared.guide);
  return prepared.guide.loop === 'cycle' ? [...times, 1] : times;
}

/** Per-frame speeds (H/s) between consecutive baked frames: entry f is the move from frame f − 1 to f. */
function frameSpeeds(prepared: PreparedGuide, ref: PointRef, times: readonly number[]): (number | null)[] {
  const sec = prepared.guide.durationMs / 1000;
  const pts = times.map((t) => pointOf(poseAt(prepared, t), ref));
  return pts.map((p, i) => {
    const q = pts[i - 1];
    const dt = (times[i] ?? 0) - (times[i - 1] ?? 0);
    return i === 0 || p === undefined || q === undefined || !(dt > 0) ? null : dist(p, q) / (dt * sec);
  });
}

/** Interior events of a phase: pass keys (or inferred mid keys) strictly inside, and hold edges at its ends. */
function phaseEvents(prepared: PreparedGuide, ph: MotionPhase): { t: number; what: string }[] {
  const out: { t: number; what: string }[] = [];
  for (const k of prepared.keys) {
    if (k.t > ph.from + 1e-9 && k.t < ph.to - 1e-9) out.push({ t: k.t, what: `key ${k.index}${k.label ? ` ${k.label}` : ''}` });
    if (k.holdEnd > k.t) {
      if (Math.abs(k.t - ph.to) < 1e-9) out.push({ t: k.t, what: `hold start (key ${k.index})` });
      if (Math.abs(k.holdEnd - ph.from) < 1e-9) out.push({ t: k.holdEnd, what: `hold end (key ${k.index})` });
    }
  }
  return out;
}

/** Main-point metrics M1–M6 for rep guides. */
function mainPointMetrics(prepared: PreparedGuide, d: Dense, phases: readonly MotionPhase[], config: MotionConfig): MotionMetric[] {
  const L = MOTION_LIMITS;
  const m1 = new Worst((a, b) => Math.abs(a - 1) > Math.abs(b - 1));
  const m2 = new Worst((a, b) => Math.abs(a - 0.5) > Math.abs(b - 0.5));
  const m3 = new Worst((a, b) => a < b);
  const m41 = higher();
  const m42 = higher();
  const m5 = higher();
  const m6 = higher();
  const frames = frameTimes(prepared);
  for (const ref of config.main) {
    const xs = series(d, (p) => pointOf(p, ref));
    if (xs === null) continue;
    const v = speeds(d, xs);
    const fv = frameSpeeds(prepared, ref, frames);
    for (const ph of phases) {
      const [i0, i1] = phaseRange(d, ph);
      if (i1 - i0 < 4) continue;
      const pv = v.slice(i0, i1 + 1);
      const peak = Math.max(...pv);
      if (!(peak > 1e-6)) continue;
      const span = ph.to - ph.from;
      const where = `${refName(ref)} ${phaseName(ph)}`;
      const humps = countHumps(pv);
      m1.add(humps, where, humps === 1);
      const iPeak = i0 + pv.indexOf(peak);
      const tau = (iPeak / d.n - ph.from) / span;
      m2.add(tau, where, tau >= L.peakTau[0] && tau <= L.peakTau[1]);
      let slow = Infinity;
      for (let i = i0; i <= i1; i += 1) {
        const tt = (i / d.n - ph.from) / span;
        if (tt >= 0.2 && tt <= 0.8) slow = Math.min(slow, v[i] ?? 0);
      }
      if (Number.isFinite(slow)) m3.add(slow / peak, where, slow / peak >= L.stall);
      // M4: the first two baked frames after the start and the last two before the end.
      const after = frames.filter((t) => t > ph.from + 1e-9 && t < ph.to).slice(0, 2);
      const before = frames.filter((t) => t < ph.to - 1e-9 && t > ph.from).slice(-2).reverse();
      for (const [list, side] of [
        [after, 'after start'],
        [before, 'before end'],
      ] as const) {
        const [first, second] = list;
        if (first !== undefined) {
          const r = speedAt(prepared, ref, first) / peak;
          m41.add(r, `${where} ${side} t=${f(first)}`, r <= L.easeFirst);
        }
        if (second !== undefined) {
          const r = speedAt(prepared, ref, second) / peak;
          m42.add(r, `${where} ${side} t=${f(second)}`, r <= L.easeSecond);
        }
      }
      // M5: acceleration jumps against the phase's peak acceleration (inside the phase only).
      let peakA = 0;
      for (let i = i0 + 1; i < i1; i += 1) {
        const a = xs[i - 1];
        const b = xs[i];
        const c = xs[i + 1];
        if (a === undefined || b === undefined || c === undefined) continue;
        const k = (d.n / d.sec) ** 2;
        peakA = Math.max(peakA, Math.hypot((c.x - 2 * b.x + a.x) * k, (c.y - 2 * b.y + a.y) * k));
      }
      if (peakA > 1e-9) {
        for (const e of phaseEvents(prepared, ph)) {
          const r = accelJump(prepared, ref, e.t) / peakA;
          m5.add(r, `${where} ${e.what} t=${f(e.t)}`, r <= L.accelJump);
        }
      }
      // M6: worst frame-to-frame speed step against the ideal minimum-jerk step.
      const inPhase: number[] = [];
      for (let i = 1; i < frames.length; i += 1) {
        const ta = frames[i - 1] ?? 0;
        const tb = frames[i] ?? 0;
        const s = fv[i];
        if (s !== null && s !== undefined && ta >= ph.from - 1e-9 && tb <= ph.to + 1e-9) inPhase.push(s);
      }
      const framePeak = Math.max(0, ...inPhase);
      if (inPhase.length > 2 && framePeak > 1e-9) {
        let step = 0;
        for (let i = 1; i < inPhase.length; i += 1) step = Math.max(step, Math.abs((inPhase[i] ?? 0) - (inPhase[i - 1] ?? 0)));
        const nFrames = span * prepared.guide.durationMs * (PLAYBACK_FPS / 1000);
        const ratio = step / framePeak / (3.08 / nFrames);
        m6.add(ratio, `${where} (${f((100 * step) / framePeak, 0)}% of peak in one frame)`, ratio <= L.frameStep);
      }
    }
  }
  const pc = (x: number): string => `${f(100 * x, 1)}%`;
  return [
    metric('M1', 'speed-humps', 'quality', '= 1 per phase', m1, (x) => f(x, 0)),
    metric('M2', 'peak-position', 'quality', `τ ${L.peakTau[0]}–${L.peakTau[1]}`, m2, (x) => `τ ${f(x, 2)}`),
    metric('M3', 'mid-stall', 'quality', `≥ ${pc(L.stall)} of peak`, m3, pc),
    metric('M4.1', 'stop-ease-1st-frame', 'quality', `≤ ${pc(L.easeFirst)} of peak`, m41, pc),
    metric('M4.2', 'stop-ease-2nd-frame', 'quality', `≤ ${pc(L.easeSecond)} of peak`, m42, pc),
    metric('M5', 'accel-jump', 'quality', `≤ ${pc(L.accelJump)} of peak`, m5, pc),
    metric('M6', 'frame-step', 'quality', `≤ ${L.frameStep}× ideal`, m6, (x) => `${f(x, 2)}×`),
  ];
}

/** Which knees and elbows are IK-solved at t (a foot or hand target). */
function ikJoints(pose: Pose): Set<AngleName> {
  const out = new Set<AngleName>();
  for (const foot of pose.feet) if (foot.wanted !== null) out.add(foot.limb === 'footNear' ? 'kneeNear' : 'kneeFar');
  for (const hand of pose.hands) out.add(hand.limb === 'handNear' ? 'elbowNear' : 'elbowFar');
  return out;
}

/** Joint metrics J1–J4 for rep guides. */
function jointMetrics(prepared: PreparedGuide, d: Dense, phases: readonly MotionPhase[], config: MotionConfig): MotionMetric[] {
  const L = MOTION_LIMITS;
  const j1 = new Worst((a, b) => Math.abs(a - 1) > Math.abs(b - 1));
  const j2 = higher();
  const j2any = higher();
  const j2pt = higher();
  const j3t = higher();
  const j3g = higher();
  const j4s = higher();
  const j4w = higher();
  const skip = new Set<string>(prepared.guide.checks.romSkip?.angles ?? []);
  const names = Object.keys(d.poses[0]?.angles ?? {}) as AngleName[];
  const angle = (name: AngleName): number[] | null => series(d, (p) => p.angles[name]);
  const all = new Map<AngleName, number[]>();
  for (const name of names) {
    const xs = angle(name);
    if (xs !== null) all.set(name, xs);
  }
  for (const ph of phases) {
    const [i0, i1] = phaseRange(d, ph);
    if (i1 - i0 < 4) continue;
    const span = ph.to - ph.from;
    const ms = span * prepared.guide.durationMs;
    const pn = phaseName(ph);
    const unchecked = new Set<string>();
    for (let i = i0; i <= i1; i += 1) for (const a of d.poses[i]?.unchecked ?? []) unchecked.add(a);
    const ik = ikJoints(d.poses[Math.round((i0 + i1) / 2)] ?? (d.poses[0] as Pose));
    for (const [name, xs] of all) {
      if (skip.has(name) || unchecked.has(name)) continue;
      const slice = xs.slice(i0, i1 + 1);
      const r = reversal(slice);
      j2any.add(r, `${name} ${pn}`, r <= L.reversalAnyDeg);
      if (!config.primary.includes(name)) continue;
      j2.add(r, `${name} ${pn}`, r <= L.reversalPrimaryDeg);
      const net = (slice[slice.length - 1] ?? 0) - (slice[0] ?? 0);
      if (Math.abs(net) <= L.movingDeg) continue;
      const w = omegas(d, xs).slice(i0, i1 + 1).map(Math.abs);
      const humps = countHumps(w);
      j1.add(humps, `${name} ${pn}`, humps === 1);
      // J4: an IK joint straightening into lockout (its magnitude falls over the phase).
      const startMag = Math.abs(slice[0] ?? 0);
      const endMag = Math.abs(slice[slice.length - 1] ?? 0);
      if (ik.has(name) && endMag < startMag) {
        const at = (tau: number): number => slice[Math.round(tau * (slice.length - 1))] ?? 0;
        const share = Math.abs(at(1) - at(0.9)) / Math.abs(net);
        j4s.add(share, `${name} ${pn}`, share <= L.whipShare);
        const peakW = Math.max(...w);
        const w95 = (w[Math.round(0.95 * (w.length - 1))] ?? 0) / (peakW || 1);
        j4w.add(w95, `${name} ${pn}`, w95 <= L.whipOmega);
      }
    }
    for (const name of ['kneeNear', 'kneeFar', 'elbowNear', 'elbowFar']) {
      const xs = series(d, (p) => p.points[name]);
      if (xs === null) continue;
      const a = xs[i0];
      const b = xs[i1];
      if (a === undefined || b === undefined) continue;
      const chord = dist(a, b);
      if (chord < L.reversalPoint) continue;
      const ux = (b.x - a.x) / chord;
      const uy = (b.y - a.y) / chord;
      const along = xs.slice(i0, i1 + 1).map((p) => (p.x - a.x) * ux + (p.y - a.y) * uy);
      const r = reversal(along);
      j2pt.add(r, `${name} point ${pn}`, r <= L.reversalPoint);
    }
    for (const [an, bn] of config.pairs) {
      const xa = all.get(an)?.slice(i0, i1 + 1);
      const xb = all.get(bn)?.slice(i0, i1 + 1);
      if (xa === undefined || xb === undefined) continue;
      const na = (xa[xa.length - 1] ?? 0) - (xa[0] ?? 0);
      const nb = (xb[xb.length - 1] ?? 0) - (xb[0] ?? 0);
      if (Math.abs(na) <= L.movingDeg || Math.abs(nb) <= L.movingDeg) continue;
      const progA = xa.map((x) => (x - (xa[0] ?? 0)) / na);
      const progB = xb.map((x) => (x - (xb[0] ?? 0)) / nb);
      const t50 = (p: number[]): number => Math.max(0, p.findIndex((x) => x >= 0.5)) / (p.length - 1);
      const gapMs = Math.abs(t50(progA) - t50(progB)) * ms;
      j3t.add(gapMs, `${an}–${bn} ${pn}`, gapMs <= L.syncMs);
      const gap = Math.max(...progA.map((x, i) => Math.abs(x - (progB[i] ?? x))));
      j3g.add(gap, `${an}–${bn} ${pn}`, gap <= L.syncGap);
    }
  }
  const pc = (x: number): string => `${f(100 * x, 1)}%`;
  const deg = (x: number): string => `${f(x, 2)}°`;
  return [
    metric('J1', 'joint-humps', 'quality', '= 1 per moving joint', j1, (x) => f(x, 0)),
    metric('J2', 'joint-reversal', 'quality', `≤ ${L.reversalPrimaryDeg}° primary`, j2, deg),
    metric('J2.any', 'any-angle-reversal', 'quality', `≤ ${L.reversalAnyDeg}°`, j2any, deg),
    metric('J2.pt', 'knee-elbow-backtrack', 'quality', `≤ ${L.reversalPoint} H`, j2pt, (x) => `${f(x, 4)} H`),
    metric('J3.t50', 'pair-half-way', 'quality', `≤ ${L.syncMs} ms`, j3t, (x) => `${f(x, 0)} ms`),
    metric('J3.gap', 'pair-progress-gap', 'quality', `≤ ${pc(L.syncGap)}`, j3g, pc),
    metric('J4', 'lockout-share', 'warn', `≤ ${pc(L.whipShare)} in last 10%`, j4s, pc),
    metric('J4.ω', 'lockout-speed', 'warn', `≤ ${pc(L.whipOmega)} of peak at τ 0.95`, j4w, pc),
  ];
}

/** Gait metrics S1–S3 (a scrolling floor). */
function gaitMetrics(prepared: PreparedGuide, d: Dense): MotionMetric[] {
  const L = MOTION_LIMITS;
  const s1 = higher();
  const s2 = higher();
  const s3 = higher();
  const frames = frameTimes(prepared);
  for (const side of ['Near', 'Far'] as const) {
    const fv = frameSpeeds(prepared, { point: `knee${side}` }, frames).filter((x): x is number => x !== null);
    const peak = Math.max(0, ...fv);
    if (peak > 1e-9) {
      let worst = 0;
      let at = 0;
      for (let i = 1; i < fv.length; i += 1) {
        const step = Math.abs((fv[i] ?? 0) - (fv[i - 1] ?? 0)) / peak;
        if (step > worst) {
          worst = step;
          at = frames[i + 1] ?? 0;
        }
      }
      s1.add(worst, `knee${side} point t=${f(at)}`, worst <= L.gaitKneeStep);
    }
  }
  for (const c of contactChanges(prepared)) {
    if (!c.liftOff) continue;
    const side = c.limb === 'footNear' ? 'Near' : 'Far';
    const xs = series(d, (p) => p.angles[`knee${side}`]);
    if (xs !== null) {
      const w = omegas(d, xs);
      let worst = 0;
      for (let i = 0; i <= d.n; i += 1) {
        const t = i / d.n;
        const off = Math.min(Math.abs(t - c.t), 1 - Math.abs(t - c.t));
        if (off <= 0.03) worst = Math.max(worst, Math.abs(w[i] ?? 0));
      }
      s2.add(worst, `knee${side} around lift-off t=${f(c.t)}`, worst <= L.gaitLiftOffDegPerS);
    }
    const pose = poseAt(prepared, c.t);
    const hip = pose.points[`hip${side}`];
    const knee = pose.points[`knee${side}`];
    const ankle = pose.points[`ankle${side}`];
    const foot = pose.feet.find((q) => q.limb === c.limb);
    if (hip !== undefined && knee !== undefined && ankle !== undefined) {
      const reach = dist(hip, foot?.wanted ?? ankle) / (dist(hip, knee) + dist(knee, ankle));
      s3.add(reach, `leg${side} toe-off t=${f(c.t)}`, reach <= L.gaitToeOffReach);
    }
  }
  const pc = (x: number): string => `${f(100 * x, 1)}%`;
  return [
    metric('S1', 'gait-knee-step', 'quality', `≤ ${pc(L.gaitKneeStep)} of peak`, s1, pc),
    metric('S2', 'gait-lift-off-knee', 'quality', `≤ ${L.gaitLiftOffDegPerS} °/s`, s2, (x) => `${f(x, 0)} °/s`),
    metric('S3', 'gait-toe-off-reach', 'quality', `≤ ${L.gaitToeOffReach}`, s3, (x) => f(x, 3)),
  ];
}

/** Every metric for one guide (hard, quality and warnings). */
export function measureMotion(prepared: PreparedGuide, opts: { n?: number; config?: MotionConfig } = {}): MotionReport {
  const config = opts.config ?? motionConfig(prepared);
  const n = opts.n ?? MOTION_SAMPLES;
  const gait = isGait(prepared, config);
  const phases = motionPhases(prepared, config);
  const d = sampleDense(prepared, n);
  const metrics: MotionMetric[] = [
    poseContinuity(prepared),
    contactVelocity(prepared),
    channelOvershoot(prepared, n),
    ...(gait ? gaitMetrics(prepared, d) : [...mainPointMetrics(prepared, d, phases, config), ...jointMetrics(prepared, d, phases, config)]),
  ];
  return { exerciseKey: prepared.guide.exerciseKey, motion: 'channels', gait, phases, metrics, suggestions: [] };
}

/** Exit status for `guide:motion`: any failed hard or quality metric fails the guide (warnings never do). */
export function motionReportOk(report: MotionReport): boolean {
  return report.metrics.every((m) => m.ok || m.level === 'warn');
}
