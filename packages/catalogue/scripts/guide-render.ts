/**
 * `npm run guide:render <id> [--frames]`: render a guide to PNG with
 * @resvg/resvg-js (dev-only, Linux/macOS, no browser).
 *
 * Writes `guides/<id>/preview.png`: a strip of the labelled key frames plus 6
 * in-between frames, in Direction D dark (top row) and light (bottom row).
 * Key frames carry the static bar-path trace. Labels sit under the frames
 * (frames themselves never contain text). The sheet is laid out in points
 * (each frame 240 pt, the legibility size) and rasterised at 3×, the scale a
 * phone draws it at (guides v2 §7.2), so the review shows the app's sharpness.
 * `--frames` also writes every 30 fps frame (400 pt at 2×) to
 * `guides/<id>/.frames/` (gitignored) for a closer look.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { GuideSchema } from '../src/figure/guide-schema.ts';
import { keyFrameStops, overlayTraces } from '../src/figure/playback.ts';
import { poseAt, prepareGuide } from '../src/figure/pose.ts';
import { DIRECTION_D_GUIDE_TOKENS, guideStyleFromTokens } from '../src/figure/style.ts';
import { fitCamera, renderFrameBody, renderSvg } from '../src/figure/svg.ts';
import type { Vec } from '../src/figure/math.ts';
import { loadGuideFile } from './lib/guides.ts';

/** Review-sheet backdrop and label colours: Direction D `bg.canvas` / `text.secondary` mirrors. */
const SHEET = {
  dark: { canvas: '#0D0C0B', label: '#B5ADA5', faint: '#948C84' },
  light: { canvas: '#F6F3EF', label: '#57504A', faint: '#6B645D' },
} as const;

/** Frame size in points, and the scale the sheet is rasterised at (an iPhone draws at 3×). */
const PX = 240;
const SCALE = 3;
/** `--frames`: the largest card canvas (design-system `guide.canvasMax`) at 2×. */
const FRAME_PX = 400;
const FRAME_SCALE = 2;
const GAP = 14;
const LABEL_H = 46;

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
if (id === undefined) {
  console.log('Usage: npm run guide:render -- <id> [--frames]');
  process.exit(1);
}
const file = loadGuideFile(id);
const parsed = GuideSchema.safeParse(file.raw);
if (!parsed.success) {
  for (const i of parsed.error.issues) console.log(`error ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const guide = parsed.data;
const prepared = prepareGuide(guide);
const camera = fitCamera(prepared);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Frames for the strip: first occurrence of each labelled keyframe, plus 6 in-betweens.
interface StripFrame {
  t: number;
  title: string;
  sub: string;
  key: boolean;
}
// The same key positions the app shows under Reduce Motion (`keyFrameStops`).
const frames: StripFrame[] = keyFrameStops(prepared).map((k) => ({ t: k.t, title: `${k.number} ${k.label}`, sub: k.caption ?? '', key: true }));
for (let i = 0; i < 6; i += 1) {
  const t = (i + 0.5) / 6;
  frames.push({ t, title: `${((t * guide.durationMs) / 1000).toFixed(2)} s`, sub: '', key: false });
}
frames.sort((a, b) => a.t - b.t);

// Static overlays: the path of each overlaid prop across the whole cycle.
const traces: Vec[][] = overlayTraces(prepared, 'static');

const width = GAP + frames.length * (PX + GAP);
const rowH = PX + LABEL_H + GAP;
const parts: string[] = [];
(['dark', 'light'] as const).forEach((scheme, row) => {
  const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme]);
  const sheet = SHEET[scheme];
  const y0 = row * rowH;
  parts.push(`<rect x="0" y="${y0}" width="${width}" height="${rowH}" fill="${sheet.canvas}"/>`);
  frames.forEach((fr, i) => {
    const x = GAP + i * (PX + GAP);
    const pose = poseAt(prepared, fr.t);
    const trace = fr.key ? traces[0] : undefined;
    const body = renderFrameBody(pose, { px: PX, style, camera, idPrefix: `${scheme}${i}`, ...(trace ? { trace } : {}) });
    parts.push(`<g transform="translate(${x} ${y0 + GAP})">${body}</g>`);
    const weight = fr.key ? '600' : '400';
    const colour = fr.key ? sheet.label : sheet.faint;
    parts.push(`<text x="${x + 4}" y="${y0 + GAP + PX + 18}" font-family="Inter, DejaVu Sans, sans-serif" font-size="14" font-weight="${weight}" fill="${colour}">${esc(fr.title)}</text>`);
    if (fr.sub) parts.push(`<text x="${x + 4}" y="${y0 + GAP + PX + 36}" font-family="Inter, DejaVu Sans, sans-serif" font-size="11.5" fill="${sheet.faint}">${esc(fr.sub)}</text>`);
  });
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rowH * 2}" viewBox="0 0 ${width} ${rowH * 2}">${parts.join('')}</svg>`;

function png(svgText: string, zoom: number): Buffer {
  return new Resvg(svgText, { fitTo: { mode: 'zoom', value: zoom }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

const out = join(file.dir, 'preview.png');
writeFileSync(out, png(svg, SCALE));
console.log(`Wrote ${out} (${frames.length} frames × dark/light at ${SCALE}×, camera ${camera.size.toFixed(3)} H).`);

if (args.includes('--frames')) {
  const dir = join(file.dir, '.frames');
  mkdirSync(dir, { recursive: true });
  const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark);
  const n = Math.round((guide.durationMs / 1000) * 30);
  for (let i = 0; i < n; i += 1) {
    const name = join(dir, `frame-${String(i).padStart(3, '0')}.png`);
    writeFileSync(name, png(renderSvg(poseAt(prepared, i / n), { px: FRAME_PX, style, camera }), FRAME_SCALE));
  }
  console.log(`Wrote ${n} frames to ${dir}.`);
}
