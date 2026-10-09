/**
 * How each shared draw op (`frameOps`, ADR 0013) becomes Skia calls. Pure, so
 * the SVG-equivalent semantics are unit-tested in Node; `bake.ts` executes the
 * plan with Skia. Mirrors SVG: `opacity` applies to fill and stroke together
 * (a layer when both are drawn), stroke caps default to butt and joins to miter.
 */
import { pathData, type DrawOp, type GuideStyle, type Vec } from '@fizz/catalogue/figure';

export interface StrokeSpec {
  width: number;
  join: 'round' | 'miter';
  cap: 'round' | 'butt';
  dash: readonly number[] | null;
}

/** A linear gradient fill (guides v2 shading): colours as `rgba(…)` with their stop opacity baked in. */
export interface GradientSpec {
  from: Vec;
  to: Vec;
  colors: string[];
  positions: number[];
}

export type PlanStep =
  | { draw: 'fill'; color: string; alpha: number; gradient?: GradientSpec }
  | { draw: 'stroke'; color: string; alpha: number; stroke: StrokeSpec };

/** `#RRGGBB` at an opacity, as a CSS colour Skia parses. */
export function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)}, ${String(Math.round(opacity * 1000) / 1000)})`;
}

export interface OpPlan {
  /** Draw the steps inside a layer with this alpha (fill and stroke overlap without doubling). */
  layerAlpha: number | null;
  steps: PlanStep[];
}

export function planOp(op: DrawOp, style: GuideStyle): OpPlan {
  const steps: { draw: 'fill' | 'stroke'; color: string; stroke?: StrokeSpec; gradient?: GradientSpec }[] = [];
  switch (op.kind) {
    case 'line':
      steps.push({ draw: 'stroke', color: style[op.paint], stroke: { width: op.width, join: 'miter', cap: op.cap, dash: op.dash } });
      break;
    case 'circle':
      if (op.fill) steps.push({ draw: 'fill', color: style[op.fill] });
      if (op.stroke) steps.push({ draw: 'stroke', color: style[op.stroke], stroke: { width: op.width, join: 'miter', cap: 'butt', dash: null } });
      break;
    case 'path':
      if (op.gradient) {
        const g = op.gradient;
        steps.push({ draw: 'fill', color: style[g.stops[0]?.paint ?? 'shade'], gradient: { from: g.from, to: g.to, colors: g.stops.map((st) => rgba(style[st.paint], st.opacity)), positions: g.stops.map((st) => st.at) } });
      } else if (op.fill) steps.push({ draw: 'fill', color: style[op.fill] });
      if (op.stroke) steps.push({ draw: 'stroke', color: style[op.stroke], stroke: { width: op.width, join: op.join ?? 'miter', cap: op.cap ?? 'butt', dash: op.dash } });
      break;
  }
  const opacity = op.opacity;
  const layered = opacity < 1 && steps.length > 1;
  const alpha = layered ? 1 : opacity;
  return {
    layerAlpha: layered ? opacity : null,
    steps: steps.map((s): PlanStep =>
      s.draw === 'fill' || s.stroke === undefined
        ? { draw: 'fill', color: s.color, alpha, ...(s.gradient ? { gradient: s.gradient } : {}) }
        : { draw: 'stroke', color: s.color, alpha, stroke: s.stroke },
    ),
  };
}

/**
 * SVG path data for a path op in unit coordinates (Skia parses it in one
 * call): the catalogue's own `pathData`, so smooth outlines are the same
 * cubic Béziers the SVG preview draws (guides v2 §7.2).
 */
export function opPathData(op: Extract<DrawOp, { kind: 'path' }>): string {
  return pathData(op.contours, op.closed, op.smooth, 5);
}
