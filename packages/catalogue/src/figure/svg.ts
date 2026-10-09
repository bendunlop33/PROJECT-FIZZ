/**
 * SVG output for a pose. Pure string building, no DOM. Used on Linux for the
 * PNG previews and checks; the app draws the same shapes with Skia later.
 * Frames contain no text (labels come from the app).
 */
import type { Pose } from './pose';
import type { PreparedGuide } from './pose';
import { poseAt } from './pose';
import { sampleTimes } from './keyframes';
import { add, dist, scale, sub, v, type Vec } from './math';
import { LAYERS, type Shape } from './props';
import { GUIDE_CORNER_FRACTION, type GuideStyle } from './style';

/** Square camera in world units. */
export interface Camera {
  cx: number;
  cy: number;
  size: number;
}

export interface RenderOptions {
  px: number;
  style: GuideStyle;
  camera: Camera;
  /** Static overlay: a dashed path (e.g. the bar path over the whole cycle). */
  trace?: readonly Vec[];
  /** Unique per frame when several frames share one SVG document. */
  idPrefix?: string;
}

const FLOOR_DASH = 0.05;

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Outline of a tapered capsule as a polygon (robust to mirroring, no arc flags). */
export function capsuleOutline(a: Vec, b: Vec, ra: number, rb: number, steps = 10): Vec[] {
  const d = dist(a, b);
  if (d < 1e-9 || d <= Math.abs(ra - rb)) {
    const c = ra >= rb ? a : b;
    const r = Math.max(ra, rb);
    return Array.from({ length: steps * 2 }, (_, i) => add(c, v(Math.cos((i / (steps * 2)) * 2 * Math.PI) * r, Math.sin((i / (steps * 2)) * 2 * Math.PI) * r)));
  }
  const u = scale(sub(b, a), 1 / d);
  const base = Math.atan2(u.y, u.x);
  const phi = Math.asin((ra - rb) / d);
  // Outer tangents touch both circles at ±(90° − φ) from the a→b direction.
  const half = Math.PI / 2 - phi;
  const pts: Vec[] = [];
  // Around b: from the +normal tangent point through +u to the −normal one.
  for (let i = 0; i <= steps; i += 1) {
    const ang = base + half - (i / steps) * (2 * half);
    pts.push(add(b, v(Math.cos(ang) * rb, Math.sin(ang) * rb)));
  }
  // Around a: from the −normal tangent point through −u back to the +normal one.
  for (let i = 0; i <= steps; i += 1) {
    const ang = base - half - (i / steps) * (2 * Math.PI - 2 * half);
    pts.push(add(a, v(Math.cos(ang) * ra, Math.sin(ang) * ra)));
  }
  return pts;
}

/** World → pixel transform for a camera (mirrors x when the figure faces left). */
export function projector(camera: Camera, px: number, facing: 'right' | 'left'): (p: Vec) => Vec {
  const k = px / camera.size;
  const left = camera.cx - camera.size / 2;
  const top = camera.cy + camera.size / 2;
  return (p) => {
    const x = facing === 'left' ? 2 * camera.cx - p.x : p.x;
    return v((x - left) * k, (top - p.y) * k);
  };
}

function pathOf(points: readonly Vec[], closed: boolean): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('') + (closed ? 'Z' : '');
}

function shapeSvg(s: Shape, P: (p: Vec) => Vec, k: number, style: GuideStyle): string {
  switch (s.kind) {
    case 'line': {
      const a = P(s.a);
      const b = P(s.b);
      const dash = s.dash ? ` stroke-dasharray="${s.dash.map((d) => f(d * k)).join(' ')}"` : '';
      return `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${style[s.paint]}" stroke-width="${f(s.width * k)}" stroke-linecap="round"${dash}/>`;
    }
    case 'circle': {
      const c = P(s.c);
      const fill = s.fill ? style[s.fill] : 'none';
      const stroke = s.stroke ? ` stroke="${style[s.stroke]}" stroke-width="${f((s.width ?? 0.005) * k)}"` : '';
      return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(s.r * k)}" fill="${fill}"${stroke}/>`;
    }
    case 'poly': {
      const fill = s.fill ? style[s.fill] : 'none';
      const stroke = s.stroke ? ` stroke="${style[s.stroke]}" stroke-width="${f((s.width ?? 0.005) * k)}" stroke-linejoin="round"` : '';
      return `<path d="${pathOf(s.points.map(P), true)}" fill="${fill}"${stroke}/>`;
    }
    case 'capsule': {
      const outline = s.outline ? ` stroke="${style[s.outline]}" stroke-width="${f(0.007 * k)}" stroke-linejoin="round"` : '';
      return `<path d="${pathOf(capsuleOutline(s.a, s.b, s.ra, s.rb).map(P), true)}" fill="${style[s.paint]}"${outline}/>`;
    }
  }
}

/** Frame content in pixel coordinates (0..px), without the `<svg>` wrapper. */
export function renderFrameBody(pose: Pose, opts: RenderOptions): string {
  const { px, style, camera } = opts;
  const k = px / camera.size;
  const P = projector(camera, px, pose.facing);
  const rect = `<rect width="${f(px)}" height="${f(px)}" rx="${f(px * GUIDE_CORNER_FRACTION)}"`;
  const clipId = `${opts.idPrefix ?? 'g'}-clip`;
  const parts: string[] = [`<defs><clipPath id="${clipId}">${rect}/></clipPath></defs>`, `${rect} fill="${style.background}"/>`];
  parts.push(`<g clip-path="url(#${clipId})">`);

  // Floor: dashed; on a scrolling floor the dashes move with the ground.
  const floorY = P(v(camera.cx, pose.groundY)).y;
  const offset = pose.groundOffset;
  const dash = FLOOR_DASH;
  const shift = ((((pose.facing === 'left' ? -offset : offset) % dash) + dash) % dash) * k;
  parts.push(
    `<line x1="${f(-dash * k + shift)}" y1="${f(floorY)}" x2="${f(px + dash * k)}" y2="${f(floorY)}" stroke="${style.trace}" stroke-width="${f(0.004 * k)}" stroke-dasharray="${f(dash * 0.6 * k)} ${f(dash * 0.4 * k)}"/>`,
  );
  for (const layer of LAYERS) {
    // The static path overlay sits above the body and below front implements, so it stays visible.
    if (layer === 'front' && opts.trace && opts.trace.length > 1) {
      parts.push(`<path d="${pathOf(opts.trace.map(P), false)}" fill="none" stroke="${style.trace}" stroke-width="${f(0.005 * k)}" stroke-dasharray="${f(0.012 * k)} ${f(0.01 * k)}" stroke-linecap="round"/>`);
    }
    for (const s of pose.shapes) if (s.layer === layer) parts.push(shapeSvg(s, P, k, style));
  }
  parts.push('</g>');
  return parts.join('');
}

export function renderSvg(pose: Pose, opts: RenderOptions): string {
  const px = f(opts.px);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${renderFrameBody(pose, opts)}</svg>`;
}

/** Bounding box of everything drawn in a pose (approximate for capsules: joint ± radius). */
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
  grow(v(minX, pose.groundY), 0);
  return { minX, maxX, minY, maxY };
}

/** A fixed square camera that fits every frame of the guide with a margin. */
export function fitCamera(prepared: PreparedGuide, margin = 0.08): Camera {
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
