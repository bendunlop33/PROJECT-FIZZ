/**
 * SVG output for a pose. Pure string building, no DOM. Used on Linux for the
 * PNG previews and checks, and by the web review page. The shapes and their
 * order come from `frameOps` (`draw.ts`), which the app's Skia player draws too.
 * Frames contain no text (labels come from the app).
 */
import type { Pose } from './pose';
import type { PreparedGuide } from './pose';
import { poseAt } from './pose';
import { bodyOutlinePoints } from './body';
import { sampleTimes } from './keyframes';
import { v, type Vec } from './math';
import { pathData } from './paths';
import { frameOps, type Camera, type DrawOp, type FrameOpsOptions } from './draw';
import { GUIDE_CORNER_FRACTION, type GuideStyle } from './style';

/** `frameOps` options plus the colours (with `muscle` and `shade`) and an id prefix. */
export interface RenderOptions extends FrameOpsOptions {
  style: GuideStyle;
  /** Unique per frame when several frames share one SVG document (clip and gradient ids). */
  idPrefix?: string;
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

const opacityAttr = (o: number): string => (o >= 1 ? '' : ` opacity="${f(o)}"`);
const dashAttr = (dash: readonly number[] | null): string => (dash ? ` stroke-dasharray="${dash.map(f).join(' ')}"` : '');

function opSvg(op: DrawOp, style: GuideStyle, id: string): string {
  switch (op.kind) {
    case 'line': {
      const cap = op.cap === 'round' ? ' stroke-linecap="round"' : '';
      return `<line x1="${f(op.a.x)}" y1="${f(op.a.y)}" x2="${f(op.b.x)}" y2="${f(op.b.y)}" stroke="${style[op.paint]}" stroke-width="${f(op.width)}"${cap}${dashAttr(op.dash)}${opacityAttr(op.opacity)}/>`;
    }
    case 'circle': {
      const fill = op.fill ? style[op.fill] : 'none';
      const stroke = op.stroke ? ` stroke="${style[op.stroke]}" stroke-width="${f(op.width)}"` : '';
      return `<circle cx="${f(op.c.x)}" cy="${f(op.c.y)}" r="${f(op.r)}" fill="${fill}"${stroke}${opacityAttr(op.opacity)}/>`;
    }
    case 'path': {
      let defs = '';
      let fill = op.fill ? style[op.fill] : 'none';
      if (op.gradient) {
        const g = op.gradient;
        const stops = g.stops.map((s) => `<stop offset="${f(s.at)}" stop-color="${style[s.paint]}" stop-opacity="${f(s.opacity)}"/>`).join('');
        defs = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.from.x)}" y1="${f(g.from.y)}" x2="${f(g.to.x)}" y2="${f(g.to.y)}">${stops}</linearGradient></defs>`;
        fill = `url(#${id})`;
      }
      const stroke = op.stroke
        ? ` stroke="${style[op.stroke]}" stroke-width="${f(op.width)}"${dashAttr(op.dash)}${op.join === 'round' ? ' stroke-linejoin="round"' : ''}${op.cap === 'round' ? ' stroke-linecap="round"' : ''}`
        : '';
      return `${defs}<path d="${pathData(op.contours, op.closed, op.smooth, 2)}" fill="${fill}"${stroke}${opacityAttr(op.opacity)}/>`;
    }
  }
}

/** Frame content in pixel coordinates (0..px), without the `<svg>` wrapper. */
export function renderFrameBody(pose: Pose, opts: RenderOptions): string {
  const { px, style } = opts;
  const prefix = opts.idPrefix ?? 'g';
  const rect = `<rect width="${f(px)}" height="${f(px)}" rx="${f(px * GUIDE_CORNER_FRACTION)}"`;
  const clipId = `${prefix}-clip`;
  const parts: string[] = [`<defs><clipPath id="${clipId}">${rect}/></clipPath></defs>`, `${rect} fill="${style.background}"/>`];
  parts.push(`<g clip-path="url(#${clipId})">`);
  frameOps(pose, opts).forEach((op, i) => parts.push(opSvg(op, style, `${prefix}-g${String(i)}`)));
  parts.push('</g>');
  return parts.join('');
}

export function renderSvg(pose: Pose, opts: RenderOptions): string {
  const px = f(opts.px);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${renderFrameBody(pose, opts)}</svg>`;
}

/** Bounding box of everything drawn in a pose (the v2 body outline plus props; capsules approximated by joint ± radius). */
export function poseBounds(pose: Pose): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const grow = (p: Vec, r: number): void => {
    minX = Math.min(minX, p.x - r);
    maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r);
    maxY = Math.max(maxY, p.y + r);
  };
  for (const s of pose.shapes) {
    if (s.kind === 'line') {
      grow(s.a, s.width);
      grow(s.b, s.width);
    } else if (s.kind === 'circle') {
      grow(s.c, s.r);
    } else if (s.kind === 'poly') {
      for (const p of s.points) grow(p, 0);
    } else {
      grow(s.a, s.ra);
      grow(s.b, s.rb);
    }
  }
  for (const p of bodyOutlinePoints(pose.body)) grow(p, 0);
  grow(v(minX, pose.groundY), 0);
  return { minX, maxX, minY, maxY };
}

/** A fixed square camera that fits every frame of the guide with a margin (guides v2 §7.2: 0.06 H). */
export function fitCamera(prepared: PreparedGuide, margin = 0.06): Camera {
  if (prepared.guide.camera) return prepared.guide.camera;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of sampleTimes(prepared.guide, prepared.keys, 15)) {
    const b = poseBounds(poseAt(prepared, t));
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  const size = Math.max(maxX - minX, maxY - minY) + 2 * margin;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size };
}
