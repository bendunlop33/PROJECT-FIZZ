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
 *
 * Guides v2: muscles come from the catalogue entry (primary strong,
 * secondary soft). Key frames are steady; the in-betweens show the
 * work-phase emphasis (`--steady` turns it off, `--no-shading` drops the soft
 * shading). Also writes `preview-thumbs.png`: the key positions at the S
 * tier, 115 pt at 3× (the 3-up thumbnail size on a 375 pt phone).
 *
 * Muscle definition (guides v2 §4.11): `--definition=off|neutral|tint` picks
 * the mode for `preview.png` and `--frames` (default: what the app ships,
 * `DEFAULT_MUSCLE_DEFINITION`); `--definition-compact` draws it on the
 * thumbnail sheet too (review only; the S tier has none). Always writes
 * `preview-definition.png`: the key positions at 240 pt in three pairs of
 * rows (Off, Neutral, Violet tint; each dark and light) at 3×, with the first
 * key position at 400 pt in each mode and scheme beside them, for B8.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { GuideSchema } from '../src/figure/guide-schema.ts';
import { keyFrameStops, overlayTraces, workIntensityAt } from '../src/figure/playback.ts';
import { poseAt, prepareGuide } from '../src/figure/pose.ts';
import { DIRECTION_D_GUIDE_TOKENS, guideStyleFromTokens } from '../src/figure/style.ts';
import { DEFAULT_MUSCLE_DEFINITION, MUSCLE_DEFINITIONS, type MuscleDefinition } from '../src/figure/muscle-map.ts';
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
/** Thumbnail sheet: the S tier at the 3-up size. */
const THUMB_PX = 115;
const SCALE = 3;
/** `--frames`: the largest card canvas (design-system `guide.canvasMax`) at 2×. */
const FRAME_PX = 400;
/** `preview-definition.png`: the large comparison frame (`guide.canvasMax`). */
const LARGE_PX = 400;
const FRAME_SCALE = 2;
const GAP = 14;
const LABEL_H = 46;

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
if (id === undefined) {
  console.log('Usage: npm run guide:render -- <id> [--frames] [--steady] [--no-shading] [--definition=off|neutral|tint] [--definition-compact]');
  process.exit(1);
}
const definitionArg = args.find((a) => a.startsWith('--definition='))?.slice('--definition='.length);
if (definitionArg !== undefined && !(MUSCLE_DEFINITIONS as readonly string[]).includes(definitionArg)) {
  console.log(`--definition must be one of ${MUSCLE_DEFINITIONS.join(', ')}`);
  process.exit(1);
}
const definition = (definitionArg ?? DEFAULT_MUSCLE_DEFINITION) as MuscleDefinition;
const definitionCompact = args.includes('--definition-compact');
const file = loadGuideFile(id);
const parsed = GuideSchema.safeParse(file.raw);
if (!parsed.success) {
  for (const i of parsed.error.issues) console.log(`error ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const guide = parsed.data;
const prepared = prepareGuide(guide);
const camera = fitCamera(prepared);
const steady = args.includes('--steady');
const shading = !args.includes('--no-shading');
// The entry is the only source of muscles (guides v2 §4.1); no entry, no colour.
const muscles = file.entry ? { primary: file.entry.primaryMuscles, secondary: file.entry.secondaryMuscles } : null;
const pulseAt = (t: number): { pulse?: number } => {
  const w = steady ? null : workIntensityAt(prepared, t);
  return w === null ? {} : { pulse: w };
};

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
    const body = renderFrameBody(pose, { px: PX, style, camera, muscles, shading, definition, idPrefix: `${scheme}${i}`, ...(trace ? { trace } : {}), ...(fr.key ? {} : pulseAt(fr.t)) });
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
console.log(`Wrote ${out} (${frames.length} frames × dark/light at ${SCALE}×, definition ${definition}, camera ${camera.size.toFixed(3)} H).`);

// Thumbnail sheet: key positions only, dark and light rows, at the S tier.
const stops = keyFrameStops(prepared);
const thumbW = GAP + stops.length * (THUMB_PX + GAP);
const thumbRow = THUMB_PX + 2 * GAP;
const thumbs: string[] = [];
(['dark', 'light'] as const).forEach((scheme, row) => {
  const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme]);
  const y0 = row * thumbRow;
  thumbs.push(`<rect x="0" y="${y0}" width="${thumbW}" height="${thumbRow}" fill="${SHEET[scheme].canvas}"/>`);
  stops.forEach((k, i) => {
    const body = renderFrameBody(poseAt(prepared, k.t), { px: THUMB_PX, style, camera, muscles, definition, definitionCompact, idPrefix: `t${scheme}${i}` });
    thumbs.push(`<g transform="translate(${GAP + i * (THUMB_PX + GAP)} ${y0 + GAP})">${body}</g>`);
  });
});
const thumbOut = join(file.dir, 'preview-thumbs.png');
writeFileSync(thumbOut, png(`<svg xmlns="http://www.w3.org/2000/svg" width="${thumbW}" height="${thumbRow * 2}" viewBox="0 0 ${thumbW} ${thumbRow * 2}">${thumbs.join('')}</svg>`, SCALE));
console.log(`Wrote ${thumbOut} (${stops.length} key positions at ${THUMB_PX} pt, S tier, ${SCALE}×${definitionCompact ? `, definition ${definition} (review only)` : ''}).`);

// Muscle definition comparison (§4.11.9, B8): Off · Neutral · Violet tint, each dark and light.
const MODE_LABEL: Record<MuscleDefinition, string> = { off: 'Off', neutral: 'Neutral (recommended)', tint: 'Violet tint' };
const TITLE_H = 30;
const smallW = GAP + stops.length * (PX + GAP);
const defW = smallW + 2 * (LARGE_PX + GAP);
const blockH = TITLE_H + 2 * (PX + GAP);
const defParts: string[] = [];
MUSCLE_DEFINITIONS.forEach((mode, b) => {
  const y0 = b * blockH;
  defParts.push(`<rect x="0" y="${y0}" width="${defW}" height="${TITLE_H}" fill="${SHEET.dark.canvas}"/>`);
  defParts.push(`<text x="${GAP}" y="${y0 + 21}" font-family="Inter, DejaVu Sans, sans-serif" font-size="15" font-weight="600" fill="${SHEET.dark.label}">${esc(`Muscle definition: ${MODE_LABEL[mode]}`)}</text>`);
  (['dark', 'light'] as const).forEach((scheme, row) => {
    const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme]);
    const y = y0 + TITLE_H + row * (PX + GAP);
    defParts.push(`<rect x="0" y="${y}" width="${smallW}" height="${PX + GAP}" fill="${SHEET[scheme].canvas}"/>`);
    stops.forEach((k, i) => {
      const body = renderFrameBody(poseAt(prepared, k.t), { px: PX, style, camera, muscles, shading, definition: mode, idPrefix: `d${mode}${scheme}${i}` });
      defParts.push(`<g transform="translate(${GAP + i * (PX + GAP)} ${y})">${body}</g>`);
    });
    // The first key position at the largest card size, dark then light side by side.
    const x = smallW + row * (LARGE_PX + GAP);
    defParts.push(`<rect x="${x}" y="${y0 + TITLE_H}" width="${LARGE_PX + GAP}" height="${2 * (PX + GAP)}" fill="${SHEET[scheme].canvas}"/>`);
    const first = stops[0]?.t ?? 0;
    const large = renderFrameBody(poseAt(prepared, first), { px: LARGE_PX, style, camera, muscles, shading, definition: mode, idPrefix: `dl${mode}${scheme}` });
    defParts.push(`<g transform="translate(${x} ${y0 + TITLE_H})">${large}</g>`);
  });
});
const defH = MUSCLE_DEFINITIONS.length * blockH;
const defOut = join(file.dir, 'preview-definition.png');
writeFileSync(defOut, png(`<svg xmlns="http://www.w3.org/2000/svg" width="${defW}" height="${defH}" viewBox="0 0 ${defW} ${defH}">${defParts.join('')}</svg>`, SCALE));
console.log(`Wrote ${defOut} (Off, Neutral, Violet tint × dark/light: ${stops.length} key positions at ${PX} pt + the first at ${LARGE_PX} pt, ${SCALE}×).`);

if (args.includes('--frames')) {
  const dir = join(file.dir, '.frames');
  mkdirSync(dir, { recursive: true });
  const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark);
  const n = Math.round((guide.durationMs / 1000) * 30);
  for (let i = 0; i < n; i += 1) {
    const name = join(dir, `frame-${String(i).padStart(3, '0')}.png`);
    writeFileSync(name, png(renderSvg(poseAt(prepared, i / n), { px: FRAME_PX, style, camera, muscles, shading, definition, ...pulseAt(i / n) }), FRAME_SCALE));
  }
  console.log(`Wrote ${n} frames to ${dir}.`);
}
