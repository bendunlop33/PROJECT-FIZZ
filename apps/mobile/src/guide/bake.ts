/**
 * Records guide frames into Skia pictures (ADR 0013). Runs on the JS thread in
 * small slices (`runSliced`); the UI thread then only swaps which picture is
 * drawn, so playback never runs the rig maths per display frame.
 *
 * Pictures are recorded at unit size and scaled by the canvas, so one bake
 * serves any width. A few bakes are cached for the app session, keyed by guide,
 * kind and colours (a theme change re-bakes).
 */
import { PaintStyle, Skia, StrokeCap, StrokeJoin, createPicture, type SkPaint, type SkPicture } from '@shopify/react-native-skia';

import type { LoadedGuide } from '@fizz/catalogue';
import { bakeFrame, overlayPlans, overlayPoint, playbackTimes, type DrawOp, type GuideStyle, type KeyFrameStop, type Vec } from '@fizz/catalogue/figure';

import { planOp, svgPathData, type PlanStep } from './draw-plan';

const UNIT = Skia.XYWHRect(-0.25, -0.25, 1.5, 1.5);

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
  }, UNIT);
}

export type BakeKind = 'animation' | 'steps';

/**
 * Tasks that fill `out` with pictures: one per baked frame (animation), or
 * the overlay trace samples and then one picture per key frame (steps, which
 * show the static bar path like the review preview).
 */
export interface BakePlan {
  tasks: (() => void)[];
  /** Index of the first picture task (overlay samples come before it). */
  firstFrame: number;
}

export function bakeTasks(loaded: LoadedGuide, kind: BakeKind, stops: readonly KeyFrameStop[], style: GuideStyle, out: SkPicture[]): BakePlan {
  const { prepared, camera } = loaded;
  const paints = new Map<string, SkPaint>();
  const mode = kind === 'animation' ? 'animated' : 'static';
  // Only the first overlay is drawn (as in the preview).
  const plan = overlayPlans(prepared, mode)[0];
  const trace: Vec[] = [];
  const tasks: (() => void)[] = [];
  if (plan) {
    for (const t of plan.times) {
      tasks.push(() => {
        const p = overlayPoint(prepared, plan.propId, t);
        if (p) trace.push(p);
      });
    }
  }
  const firstFrame = tasks.length;
  const times = kind === 'animation' ? playbackTimes(prepared.guide) : stops.length > 0 ? stops.map((s) => s.t) : [0];
  for (const t of times) {
    tasks.push(() => {
      out.push(recordOps(bakeFrame(prepared, camera, t, trace), style, paints));
    });
  }
  return { tasks, firstFrame };
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
