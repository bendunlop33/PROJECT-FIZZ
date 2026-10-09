/**
 * Records guide frames into Skia pictures (ADR 0013). Runs on the JS thread in
 * small slices (`runSliced`); the UI thread then only swaps which picture is
 * drawn, so playback never runs the rig maths per display frame.
 *
 * Pictures are recorded at unit size and scaled by the canvas, so one bake
 * serves any width. A few bakes are cached for the app session, keyed by guide,
 * kind and colours (a theme change re-bakes).
 *
 * No Skia call may run at module load (review S1): this module is required
 * lazily with the player, and every Skia call happens inside a bake task,
 * where a throw is caught and the How to screen falls back to the cues.
 */
import { PaintStyle, Skia, StrokeCap, StrokeJoin, createPicture, type SkPaint, type SkPicture } from '@shopify/react-native-skia';

import type { LoadedGuide } from '@fizz/catalogue';
import { bakeFrame, overlayPlans, overlayPoint, playbackTimes, type DrawOp, type GuideStyle, type KeyFrameStop, type Vec } from '@fizz/catalogue/figure';

import { planOp, svgPathData, type PlanStep } from './draw-plan';

/** The recorded area in unit coordinates (with a margin for strokes at the edge). */
function unitBounds() {
  return Skia.XYWHRect(-0.25, -0.25, 1.5, 1.5);
}

function paintFor(step: PlanStep, cache: Map<string, SkPaint>): SkPaint {
  const key = step.draw === 'fill' ? `f|${step.color}|${String(step.alpha)}` : `s|${step.color}|${String(step.alpha)}|${String(step.stroke.width)}|${step.stroke.join}|${step.stroke.cap}|${step.stroke.dash?.join(',') ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(step.color));
  if (step.alpha < 1) paint.setAlphaf(step.alpha);
  if (step.draw === 'fill') {
    paint.setStyle(PaintStyle.Fill);
  } else {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(step.stroke.width);
    paint.setStrokeJoin(step.stroke.join === 'round' ? StrokeJoin.Round : StrokeJoin.Miter);
    paint.setStrokeCap(step.stroke.cap === 'round' ? StrokeCap.Round : StrokeCap.Butt);
    if (step.stroke.dash) paint.setPathEffect(Skia.PathEffect.MakeDash([...step.stroke.dash], 0));
  }
  cache.set(key, paint);
  return paint;
}

/** One frame's ops as a picture in unit coordinates. */
export function recordOps(ops: readonly DrawOp[], style: GuideStyle, paints: Map<string, SkPaint>): SkPicture {
  return createPicture((canvas) => {
    for (const op of ops) {
      const plan = planOp(op, style);
      if (plan.layerAlpha !== null) {
        const layer = Skia.Paint();
        layer.setAlphaf(plan.layerAlpha);
        canvas.saveLayer(layer);
      }
      const path = op.kind === 'path' ? Skia.Path.MakeFromSVGString(svgPathData(op.points, op.closed)) : null;
      for (const step of plan.steps) {
        const paint = paintFor(step, paints);
        if (op.kind === 'line') canvas.drawLine(op.a.x, op.a.y, op.b.x, op.b.y, paint);
        else if (op.kind === 'circle') canvas.drawCircle(op.c.x, op.c.y, op.r, paint);
        else if (path) canvas.drawPath(path, paint);
      }
      if (plan.layerAlpha !== null) canvas.restore();
    }
  }, unitBounds());
}

export type BakeKind = 'animation' | 'steps';

/**
 * Tasks that fill `out` with pictures: one per baked frame (animation), or
 * one per key position (steps, which show the static bar path like the review
 * preview). `out[i]` is frame or position i.
 */
export interface BakePlan {
  tasks: (() => void)[];
  /** Tasks to run before the first yield so `out[0]` exists at once (the poster). */
  firstSync: number;
}

export function bakeTasks(loaded: LoadedGuide, kind: BakeKind, stops: readonly KeyFrameStop[], style: GuideStyle, out: SkPicture[]): BakePlan {
  const { prepared, camera } = loaded;
  const paints = new Map<string, SkPaint>();
  const mode = kind === 'animation' ? 'animated' : 'static';
  const times = kind === 'animation' ? playbackTimes(prepared.guide) : stops.length > 0 ? stops.map((s) => s.t) : [0];
  const first = times[0] ?? 0;
  // Only the first overlay is drawn (as in the preview).
  const plan = overlayPlans(prepared, mode)[0];
  const trace: Vec[] = [];
  const tasks: (() => void)[] = [];
  if (plan) {
    // A trace needs ~a cycle of samples first. Draw frame 0 without it now, so
    // the canvas is never empty while they're taken (review N1); it's redrawn
    // with the trace below.
    tasks.push(() => {
      out[0] = recordOps(bakeFrame(prepared, camera, first, []), style, paints);
    });
    for (const t of plan.times) {
      tasks.push(() => {
        const p = overlayPoint(prepared, plan.propId, t);
        if (p) trace.push(p);
      });
    }
  }
  times.forEach((t, i) => {
    tasks.push(() => {
      out[i] = recordOps(bakeFrame(prepared, camera, t, trace), style, paints);
    });
  });
  return { tasks, firstSync: 1 };
}

const CACHE_SIZE = 4;
const cache = new Map<string, SkPicture[]>();

export function bakeKey(guideKey: string, kind: BakeKind, style: GuideStyle): string {
  return `${guideKey}|${kind}|${Object.values(style).join(',')}`;
}

export function cachedBake(key: string): SkPicture[] | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function storeBake(key: string, pictures: SkPicture[]): void {
  cache.delete(key);
  cache.set(key, pictures);
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
