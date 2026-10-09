/**
 * How each shared draw op (`frameOps`, ADR 0013) becomes Skia calls. Pure, so
 * the SVG-equivalent semantics are unit-tested in Node; `bake.ts` executes the
 * plan with Skia. Mirrors SVG: `opacity` applies to fill and stroke together
 * (a layer when both are drawn), stroke caps default to butt and joins to miter.
 */
import type { DrawOp, GuideStyle, Vec } from '@fizz/catalogue/figure';

export interface StrokeSpec {
  width: number;
  join: 'round' | 'miter';
  cap: 'round' | 'butt';
  dash: readonly number[] | null;
}

export type PlanStep = { draw: 'fill'; color: string; alpha: number } | { draw: 'stroke'; color: string; alpha: number; stroke: StrokeSpec };

export interface OpPlan {
  /** Draw the steps inside a layer with this alpha (fill and stroke overlap without doubling). */
  layerAlpha: number | null;
  steps: PlanStep[];
}

export function planOp(op: DrawOp, style: GuideStyle): OpPlan {
  const steps: { draw: 'fill' | 'stroke'; color: string; stroke?: StrokeSpec }[] = [];
  switch (op.kind) {
    case 'line':
      steps.push({ draw: 'stroke', color: style[op.paint], stroke: { width: op.width, join: 'miter', cap: op.cap, dash: op.dash } });
      break;
    case 'circle':
      if (op.fill) steps.push({ draw: 'fill', color: style[op.fill] });
      if (op.stroke) steps.push({ draw: 'stroke', color: style[op.stroke], stroke: { width: op.width, join: 'miter', cap: 'butt', dash: null } });
      break;
    case 'path':
      if (op.fill) steps.push({ draw: 'fill', color: style[op.fill] });
      if (op.stroke) steps.push({ draw: 'stroke', color: style[op.stroke], stroke: { width: op.width, join: op.join ?? 'miter', cap: op.cap ?? 'butt', dash: op.dash } });
      break;
  }
  const opacity = op.opacity;
  const layered = opacity < 1 && steps.length > 1;
  const alpha = layered ? 1 : opacity;
  return {
    layerAlpha: layered ? opacity : null,
    steps: steps.map((s): PlanStep => (s.draw === 'fill' || s.stroke === undefined ? { draw: 'fill', color: s.color, alpha } : { draw: 'stroke', color: s.color, alpha, stroke: s.stroke })),
  };
}

/** SVG path data for a polyline in unit coordinates (Skia parses it in one call). */
export function svgPathData(points: readonly Vec[], closed: boolean): string {
  const r = (n: number): string => String(Math.round(n * 1e5) / 1e5);
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)} ${r(p.y)}`).join('') + (closed ? 'Z' : '');
}
