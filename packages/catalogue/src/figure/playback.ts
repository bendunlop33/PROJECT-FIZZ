/**
 * Playback helpers shared by the Linux preview renderer and the in-app player
 * (ADR 0013). Pure: the app bakes `bakeFrame` output into Skia pictures, the
 * renderer turns the same ops into SVG.
 */
import { frameOps, type Camera, type DrawOp } from './draw';
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

/** Paths of the props overlaid in `mode` (e.g. the bar path on the static key frames), sampled over one cycle. */
export function overlayTraces(prepared: PreparedGuide, mode: 'static' | 'animated', fps = PLAYBACK_FPS): Vec[][] {
  const { guide, keys } = prepared;
  const times = sampleTimes(guide, keys, fps);
  const out: Vec[][] = [];
  for (const o of guide.overlays ?? []) {
    if (!o.showIn.includes(mode)) continue;
    out.push(times.map((t) => poseAt(prepared, t).propPoints[o.of]).filter((p): p is Vec => p !== undefined));
  }
  return out;
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

/**
 * Draw ops for one frame in unit coordinates (the canvas is 1 × 1; the app
 * scales the recorded picture to its size), so one bake serves any width.
 */
export function bakeFrame(prepared: PreparedGuide, camera: Camera, t: number, trace?: readonly Vec[]): DrawOp[] {
  return frameOps(poseAt(prepared, t), { px: 1, camera, ...(trace && trace.length > 1 ? { trace } : {}) });
}
