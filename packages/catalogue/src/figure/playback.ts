/**
 * Playback helpers shared by the Linux preview renderer and the in-app player
 * (ADR 0013). Pure: the app bakes `bakeFrame` output into Skia pictures, the
 * renderer turns the same ops into SVG.
 */
import { frameOps, type Camera, type DrawOp, type FrameOpsOptions } from './draw';
import { sampleTimes } from './keyframes';
import type { Vec } from './math';
import { poseAt, type PreparedGuide } from './pose';

/**
 * Baked frames per second of guide time. 30 fps keeps a 3 s guide at 90
 * frames (research §5.4) and is smooth enough for a slow, deliberate rep.
 */
export const PLAYBACK_FPS = 30;

/** A labelled key position: what Reduce Motion shows instead of the animation. */
export interface KeyFrameStop {
  /** 1-based position in the strip (`1 Start · 2 Bottom`). */
  number: number;
  /** Index into the guide's keyframes. */
  keyframe: number;
  t: number;
  label: string;
  caption: string | null;
}

/**
 * The first occurrence of each labelled keyframe, in time order. The loop's
 * closing `sameAs` copies repeat an earlier label, so they are skipped.
 * These are the guide's key positions (`guide:check` keeps their labels equal
 * to the catalogue entry's `guideBrief.keyPositions`).
 */
export function keyFrameStops(prepared: PreparedGuide): KeyFrameStop[] {
  const out: KeyFrameStop[] = [];
  const seen = new Set<string>();
  for (const k of prepared.keys) {
    if (k.label === null || seen.has(k.label)) continue;
    seen.add(k.label);
    out.push({ number: out.length + 1, keyframe: k.index, t: k.t, label: k.label, caption: k.caption });
  }
  return out;
}

/** Which prop paths are overlaid in `mode`, and the times to sample them at (one cycle). */
export interface OverlayPlan {
  propId: string;
  times: number[];
}

export function overlayPlans(prepared: PreparedGuide, mode: 'static' | 'animated', fps = PLAYBACK_FPS): OverlayPlan[] {
  const { guide, keys } = prepared;
  const wanted = (guide.overlays ?? []).filter((o) => o.showIn.includes(mode));
  if (wanted.length === 0) return [];
  const times = sampleTimes(guide, keys, fps);
  return wanted.map((o) => ({ propId: o.of, times }));
}

/** One sample of an overlay path (the app samples in small slices so the UI never stalls). */
export function overlayPoint(prepared: PreparedGuide, propId: string, t: number): Vec | undefined {
  return poseAt(prepared, t).propPoints[propId];
}

/** Paths of the props overlaid in `mode` (e.g. the bar path on the static key frames), sampled over one cycle. */
export function overlayTraces(prepared: PreparedGuide, mode: 'static' | 'animated', fps = PLAYBACK_FPS): Vec[][] {
  return overlayPlans(prepared, mode, fps).map((plan) => plan.times.map((t) => overlayPoint(prepared, plan.propId, t)).filter((p): p is Vec => p !== undefined));
}

/**
 * Normalised times of the baked frames for one pass. A cycle's last pose
 * equals its first, so a cycle has `n` frames (t = i/n, i < n); a ping-pong
 * plays forwards then backwards and needs both ends (`n + 1`).
 */
export function playbackTimes(guide: PreparedGuide['guide'], fps = PLAYBACK_FPS): number[] {
  const n = Math.max(2, Math.round((guide.durationMs / 1000) * fps));
  const count = guide.loop === 'pingpong' ? n + 1 : n;
  return Array.from({ length: count }, (_, i) => i / n);
}

/** `frameOps` options for a bake (the camera, size and trace come from the bake itself). */
export type BakeOptions = Omit<FrameOpsOptions, 'px' | 'camera' | 'trace'>;

/** Size a bake's tier and stroke floors assume when the caller doesn't say (the legibility size). */
export const DEFAULT_BAKE_PT = 240;

/**
 * Draw ops for one frame in unit coordinates (the canvas is 1 × 1; the app
 * scales the recorded picture to its size), so one bake serves every width in
 * its tier. `opts.pt` is the size it will be shown at (tier and stroke floors).
 */
export function bakeFrame(prepared: PreparedGuide, camera: Camera, t: number, trace?: readonly Vec[], opts: BakeOptions = {}): DrawOp[] {
  return frameOps(poseAt(prepared, t), { ...opts, pt: opts.pt ?? DEFAULT_BAKE_PT, px: 1, camera, ...(trace && trace.length > 1 ? { trace } : {}) });
}

/** Length of the work-phase emphasis ramps, in ms of guide time (§4.9). */
export const WORK_RAMP_MS = 120;

const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Work-phase emphasis at normalised time `t` (§4.9): 0 outside the guide's
 * `focus.workPhase`, rising to 1 over the first 120 ms of each phase and
 * falling back over its last 120 ms (smoothstep, in guide time). `null` when
 * the guide has no work phase: draw steady colour.
 */
export function workIntensityAt(prepared: PreparedGuide, t: number): number | null {
  const phases = prepared.guide.focus?.workPhase;
  if (phases === undefined || phases.length === 0) return null;
  const ramp = Math.min(0.5, WORK_RAMP_MS / prepared.guide.durationMs);
  let best = 0;
  for (const ph of phases) {
    if (t < ph.from || t > ph.to) continue;
    const r = Math.min(ramp, (ph.to - ph.from) / 2);
    best = Math.max(best, Math.min(smoothstep((t - ph.from) / r), smoothstep((ph.to - t) / r)));
  }
  return best;
}
