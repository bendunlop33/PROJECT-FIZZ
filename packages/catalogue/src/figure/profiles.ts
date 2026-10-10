/**
 * Segment profiles for rig `adult-v1` (guides v2 §3.2–3.4): widths at
 * stations along each body segment, front and back separately, in body
 * heights (H). Drawing proportions only, tuned to read as an athletic adult
 * at 240 pt; they are not anthropometric data. The guide-maker may tune any
 * value by up to ±15% on renders; bigger changes go back to the spec table.
 *
 * Side view: `front` is the half-depth to the anterior edge, `back` to the
 * posterior edge. Front/back views: `front` is the lateral half-width and
 * `back` the medial one (trunk segments are symmetric).
 *
 * The rig's lengths, joints and IK are unchanged, so every guide.json stays
 * valid; only the drawing changed.
 */
import { hermite, monotoneSlope } from './math';

export interface Station {
  s: number;
  front: number;
  back: number;
}
export type Profile = readonly Station[];

export const SEGMENT_NAMES = ['pelvis', 'lumbar', 'thorax', 'neck', 'thigh', 'shank', 'upperArm', 'forearm'] as const;
export type SegmentName = (typeof SEGMENT_NAMES)[number];
export const TRUNK_SEGMENTS = ['pelvis', 'lumbar', 'thorax'] as const satisfies readonly SegmentName[];

const st = (s: readonly number[], front: readonly number[], back: readonly number[]): Profile =>
  s.map((x, i) => ({ s: x, front: front[i] ?? 0, back: back[i] ?? 0 }));
const sym = (s: readonly number[], half: readonly number[]): Profile => st(s, half, half);

export const ADULT_V1_PROFILES: Record<'side' | 'frontBack', Record<SegmentName, Profile>> = {
  side: {
    thigh: st([0, 0.15, 0.4, 0.65, 0.85, 1], [0.046, 0.05, 0.049, 0.043, 0.035, 0.031], [0.05, 0.048, 0.043, 0.036, 0.03, 0.029]),
    shank: st([0, 0.12, 0.28, 0.5, 0.75, 1], [0.029, 0.026, 0.024, 0.021, 0.018, 0.017], [0.029, 0.038, 0.041, 0.031, 0.021, 0.019]),
    upperArm: st([-0.12, 0, 0.2, 0.45, 0.65, 0.88, 1], [0.01, 0.029, 0.028, 0.025, 0.026, 0.021, 0.019], [0.012, 0.03, 0.029, 0.028, 0.024, 0.021, 0.021]),
    forearm: st([0, 0.22, 0.5, 0.8, 1], [0.02, 0.023, 0.02, 0.016, 0.014], [0.02, 0.021, 0.018, 0.015, 0.013]),
    pelvis: st([-0.7, -0.35, 0, 0.4, 0.8, 1], [0.028, 0.04, 0.046, 0.052, 0.052, 0.052], [0.04, 0.062, 0.068, 0.066, 0.058, 0.054]),
    lumbar: st([0, 0.5, 1], [0.052, 0.056, 0.058], [0.054, 0.047, 0.052]),
    thorax: st([0, 0.3, 0.6, 0.8, 0.92, 1], [0.058, 0.064, 0.07, 0.066, 0.056, 0.04], [0.052, 0.06, 0.066, 0.064, 0.052, 0.034]),
    neck: st([0, 0.45, 1], [0.03, 0.024, 0.022], [0.04, 0.029, 0.025]),
  },
  frontBack: {
    thigh: st([0, 0.15, 0.45, 0.75, 0.92, 1], [0.05, 0.054, 0.046, 0.038, 0.032, 0.03], [0.04, 0.046, 0.04, 0.033, 0.031, 0.029]),
    shank: st([0, 0.2, 0.5, 0.8, 1], [0.029, 0.03, 0.024, 0.018, 0.016], [0.029, 0.033, 0.025, 0.018, 0.016]),
    upperArm: st([-0.1, 0, 0.3, 0.6, 1], [0.014, 0.028, 0.026, 0.023, 0.02], [0.01, 0.02, 0.022, 0.022, 0.019]),
    forearm: st([0, 0.25, 0.6, 1], [0.022, 0.024, 0.019, 0.015], [0.021, 0.022, 0.017, 0.014]),
    pelvis: sym([-0.6, 0, 0.6, 1], [0.1, 0.105, 0.098, 0.088]),
    lumbar: sym([0, 0.5, 1], [0.088, 0.082, 0.09]),
    thorax: sym([0, 0.4, 0.75, 0.9, 1], [0.092, 0.1, 0.108, 0.1, 0.04]),
    neck: sym([0, 0.45, 1], [0.034, 0.029, 0.027]),
  },
};

/** Far-side limbs in a side view are drawn slightly narrower (a perspective cue, §3.2). */
export const FAR_PROFILE_SCALE = 0.96;

type Pick = (st: Station) => number;
const pickFront: Pick = (x) => x.front;
const pickBack: Pick = (x) => x.back;

/** Interval i's end slopes (m0, m1) for one edge: they depend only on the profile, so they're worked out once per profile. */
function intervalSlopes(profile: Profile, pick: Pick): Float64Array {
  const n = profile.length;
  const out = new Float64Array(Math.max(0, n - 1) * 2);
  const slope = (p: Station | undefined, q: Station | undefined): number | null => (p === undefined || q === undefined ? null : (pick(q) - pick(p)) / (q.s - p.s));
  for (let i = 0; i + 1 < n; i += 1) {
    const a = profile[i] as Station;
    const b = profile[i + 1] as Station;
    const h = b.s - a.s;
    const prev = profile[i - 1];
    const next = profile[i + 2];
    const sAB = slope(a, b);
    out[2 * i] = monotoneSlope(slope(prev, a), sAB, prev === undefined ? h : a.s - prev.s, h);
    out[2 * i + 1] = monotoneSlope(sAB, slope(b, next), h, next === undefined ? h : next.s - b.s);
  }
  return out;
}
const slopeCache = new WeakMap<Profile, { front: Float64Array; back: Float64Array }>();
function slopesOf(profile: Profile): { front: Float64Array; back: Float64Array } {
  let hit = slopeCache.get(profile);
  if (hit === undefined) {
    hit = { front: intervalSlopes(profile, pickFront), back: intervalSlopes(profile, pickBack) };
    slopeCache.set(profile, hit);
  }
  return hit;
}

/** Width at `s` by monotone cubic between stations (no kinks, no overshoot); clamped outside the stations. */
function interp(profile: Profile, s: number, pick: Pick, slopes: Float64Array): number {
  const n = profile.length;
  const first = profile[0];
  const last = profile[n - 1];
  if (first === undefined || last === undefined) return 0;
  if (s <= first.s) return pick(first);
  if (s >= last.s) return pick(last);
  let i = 0;
  while (i < n - 2 && (profile[i + 1]?.s ?? Infinity) < s) i += 1;
  const a = profile[i];
  const b = profile[i + 1];
  if (a === undefined || b === undefined) return pick(last);
  const h = b.s - a.s;
  return hermite(pick(a), pick(b), slopes[2 * i] ?? 0, slopes[2 * i + 1] ?? 0, (s - a.s) / h, h);
}

export function profileAt(profile: Profile, s: number): { front: number; back: number } {
  const slopes = slopesOf(profile);
  return { front: interp(profile, s, pickFront, slopes.front), back: interp(profile, s, pickBack, slopes.back) };
}

export function profileRange(profile: Profile): [number, number] {
  return [profile[0]?.s ?? 0, profile[profile.length - 1]?.s ?? 1];
}
