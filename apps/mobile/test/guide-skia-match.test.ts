/**
 * SVG ↔ Skia pixel match (guides v2 §12.1 #9, D11; guides v2 review S6, motion review S4). The app's real bake code
 * (`recordOps` in bake.ts, with its paint, gradient, dash and path-text handling) runs against React Native Skia's own
 * web backend (`JsiSkApi`) on CanvasKit, and is compared with the resvg render of the same frame (the review previews).
 *
 * This catches what plan-only tests can't: an `rgba()` gradient stop Skia can't parse (RN Skia turns it black), path
 * text `MakeFromSVGString` rejects (the op silently disappears), or a stroke, dash or layer that draws differently.
 * CanvasKit is Skia compiled to wasm, so it is the same rasteriser family as the iPhone's, not the same build; the
 * device check (G-series) still applies.
 *
 * Threshold: a pixel differs when any channel differs by more than 25 % (64/255); at most 0.01 % of pixels may differ
 * (§12.1 #9). Anti-aliasing on thin straight strokes is what remains (ADR 0014).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import CanvasKitInit from 'canvaskit-wasm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { bundledGuides, lazyBundledCatalogue } from '@fizz/catalogue';
import { bakeFrame, DIRECTION_D_GUIDE_TOKENS, guideStyleFromTokens, poseAt, renderSvg, type GuideStyle } from '@fizz/catalogue/figure';

import type * as Bake from '../src/guide/bake';
import { opPathData, PATH_UNITS, planOp } from '../src/guide/draw-plan';

const require = createRequire(import.meta.url);
const PX = 240;
/** Per-channel difference that counts as a different pixel. */
const CHANNEL_THRESHOLD = 64;
/** Share of pixels allowed to differ (§12.1 #9: 0.01 %). */
const MAX_DIFF_SHARE = 0.0001;
const TIMES = [0, 0.37, 0.71];

interface SkiaApi {
  Surface: { Make: (w: number, h: number) => SkSurfaceLike | null };
  Path: { MakeFromSVGString: (s: string) => unknown };
  Color: (c: string) => Float32Array;
}
interface SkSurfaceLike {
  getCanvas: () => {
    drawColor: (c: Float32Array) => void;
    save: () => number;
    restore: () => void;
    scale: (x: number, y: number) => void;
    drawPicture: (p: unknown) => void;
  };
  flush: () => void;
  makeImageSnapshot: () => { readPixels: (x: number, y: number, info: object) => Uint8Array | Float32Array | null };
}

let bake: typeof Bake;
let Skia: SkiaApi;
let rgbaInfo: object;

beforeAll(async () => {
  const wasmDir = dirname(require.resolve('canvaskit-wasm/bin/canvaskit.wasm'));
  const CK = await CanvasKitInit({ locateFile: (file: string) => join(wasmDir, file) });
  // RN Skia's own JS API over CanvasKit (its web backend): the same Paint/Shader/Path/Color calls bake.ts makes.
  const skiaRoot = dirname(require.resolve('@shopify/react-native-skia/package.json'));
  const { JsiSkApi } = (await import(join(skiaRoot, 'lib/module/skia/web/JsiSkia.js'))) as { JsiSkApi: (ck: unknown) => SkiaApi };
  const types = (await import(join(skiaRoot, 'lib/module/skia/types/index.js'))) as Record<string, unknown>;
  Skia = JsiSkApi(CK);
  const api = Skia as unknown as { PictureRecorder: () => { beginRecording: (b?: unknown) => unknown; finishRecordingAsPicture: () => unknown } };
  vi.doMock('@shopify/react-native-skia', () => ({
    ...types,
    Skia,
    // As RN Skia's core/Picture.ts (which reads a global Skia), against this instance.
    createPicture: (draw: (canvas: unknown) => void, bounds?: unknown) => {
      const recorder = api.PictureRecorder();
      draw(recorder.beginRecording(bounds));
      return recorder.finishRecordingAsPicture();
    },
  }));
  const { ColorType, AlphaType } = types as { ColorType: { RGBA_8888: number }; AlphaType: { Unpremul: number } };
  rgbaInfo = { width: PX, height: PX, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  bake = await import('../src/guide/bake');
}, 60_000);

afterAll(() => {
  vi.doUnmock('@shopify/react-native-skia');
});

function skiaPixels(ops: ReturnType<typeof bakeFrame>, style: GuideStyle): Uint8Array {
  const surface = Skia.Surface.Make(PX, PX);
  if (surface === null) throw new Error('no CanvasKit surface');
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color(style.background));
  canvas.save();
  canvas.scale(PX, PX);
  canvas.drawPicture(bake.recordOps(ops, style, new Map()));
  canvas.restore();
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels(0, 0, rgbaInfo);
  if (!(px instanceof Uint8Array)) throw new Error('readPixels failed');
  return px;
}

function svgPixels(svg: string): Uint8Array {
  return new Resvg(svg).render().pixels;
}

/** Pixels whose largest channel difference is over the threshold, ignoring the rounded corners (Skia isn't clipped here). */
function differing(a: Uint8Array, b: Uint8Array, threshold = CHANNEL_THRESHOLD): number {
  const corner = Math.ceil(PX * 0.06) + 2;
  let n = 0;
  for (let y = 0; y < PX; y += 1) {
    for (let x = 0; x < PX; x += 1) {
      const inCorner = (x < corner || x >= PX - corner) && (y < corner || y >= PX - corner);
      if (inCorner) continue;
      const i = (y * PX + x) * 4;
      const d = Math.max(Math.abs((a[i] ?? 0) - (b[i] ?? 0)), Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)), Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)));
      if (d > threshold) n += 1;
    }
  }
  return n;
}

/** Share of pixels that differ from the background (the figure and props). */
function drawnShare(px: Uint8Array, style: GuideStyle): number {
  const bg = parseInt(style.background.slice(1, 7), 16);
  const rgb = [(bg >> 16) & 255, (bg >> 8) & 255, bg & 255];
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (Math.max(...rgb.map((c, k) => Math.abs((px[i + k] ?? 0) - c))) > 8) n += 1;
  return n / (PX * PX);
}

describe('SVG ↔ Skia (CanvasKit) pixel match, definition neutral (D11, §12.1 #9)', () => {
  const library = bundledGuides();
  const catalogue = lazyBundledCatalogue();

  it('every bundled guide, both schemes, 3 frames: at most 0.01% of pixels differ by more than 25% per channel', () => {
    let worst = { share: 0, what: '' };
    let frames = 0;
    let loose = 0;
    for (const key of library.keys) {
      const g = library.load(key);
      if (!g.ok) throw new Error(`${key} should load`);
      const entry = catalogue.entry(key);
      const muscles = entry.ok ? { primary: entry.entry.primaryMuscles, secondary: entry.entry.secondaryMuscles } : null;
      for (const scheme of ['dark', 'light'] as const) {
        const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme], scheme);
        for (const t of TIMES) {
          const opts = { pt: PX, muscles, definition: 'neutral' as const };
          const ops = bakeFrame(g.value.prepared, g.value.camera, t, [], opts);
          // Every path's text parses: a null here silently drops the op on device.
          expect(ops.filter((op) => op.kind === 'path').length).toBeGreaterThan(0);
          const svg = renderSvg(poseAt(g.value.prepared, t), { px: PX, style, camera: g.value.camera, ...opts });
          const sk = skiaPixels(ops, style);
          const sv = svgPixels(svg);
          // Not vacuous: the figure covers a good share of the canvas in both renders.
          expect(drawnShare(sk, style), `${key} ${scheme} skia`).toBeGreaterThan(0.03);
          expect(drawnShare(sv, style), `${key} ${scheme} svg`).toBeGreaterThan(0.03);
          const n = differing(sk, sv);
          loose = Math.max(loose, differing(sk, sv, 25) / (PX * PX));
          const share = n / (PX * PX);
          if (share > worst.share) worst = { share, what: `${key} ${scheme} t=${String(t)} (${String(n)} px)` };
          frames += 1;
        }
      }
    }
    expect(frames).toBe([...library.keys].length * 2 * TIMES.length);
    process.stdout.write(`skia-match worst: ${(worst.share * 100).toFixed(4)}% ${worst.what}; at a 10% channel threshold ${(loose * 100).toFixed(4)}%\n`);
    expect(worst.share, worst.what).toBeLessThanOrEqual(MAX_DIFF_SHARE);
  }, 120_000);

  it('the harness catches the device failure it exists for: rgba() stops parsed as black, or a path dropped', () => {
    const g = library.load('barbell-back-squat');
    if (!g.ok) throw new Error('squat should load');
    const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark, 'dark');
    const opts = { pt: PX, muscles: { primary: ['quads' as const], secondary: ['core' as const] }, definition: 'neutral' as const };
    const ops = bakeFrame(g.value.prepared, g.value.camera, 0.37, [], opts);
    const svg = svgPixels(renderSvg(poseAt(g.value.prepared, 0.37), { px: PX, style, camera: g.value.camera, ...opts }));
    const color = Skia.Color.bind(Skia);
    try {
      Skia.Color = (c: string) => (c.startsWith('rgba(') ? color('black') : color(c));
      expect(differing(skiaPixels(ops, style), svg) / (PX * PX)).toBeGreaterThan(MAX_DIFF_SHARE);
    } finally {
      Skia.Color = color;
    }
    // MakeFromSVGString returning null drops the op: here, for the muscle-coloured paths only.
    const parse = Skia.Path.MakeFromSVGString.bind(Skia.Path);
    const muscleTexts = new Set(ops.flatMap((op) => (op.kind === 'path' && op.fill === 'muscle' ? [opPathData(op)] : [])));
    expect(muscleTexts.size).toBeGreaterThan(0);
    try {
      Skia.Path.MakeFromSVGString = (text: string) => (muscleTexts.has(text) ? null : parse(text));
      expect(differing(skiaPixels(ops, style), svg) / (PX * PX)).toBeGreaterThan(MAX_DIFF_SHARE);
    } finally {
      Skia.Path.MakeFromSVGString = parse;
    }
  });

  it('every path op parses in Skia, and every gradient rgba() stop parses to its own colour (never black)', () => {
    const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark, 'dark');
    let gradients = 0;
    for (const key of library.keys) {
      const g = library.load(key);
      if (!g.ok) throw new Error(`${key} should load`);
      const ops = bakeFrame(g.value.prepared, g.value.camera, 0.37, [], { pt: PX, muscles: { primary: ['quads', 'lats'], secondary: ['core'] }, definition: 'neutral' });
      for (const op of ops) {
        if (op.kind !== 'path') continue;
        expect(Skia.Path.MakeFromSVGString(opPathData(op)), key).not.toBeNull();
        for (const step of planOp(op, style, PATH_UNITS).steps) {
          if (step.draw !== 'fill' || !step.gradient) continue;
          gradients += 1;
          for (const c of step.gradient.colors) {
            const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(c);
            if (m === null) throw new Error(`${key}: unexpected stop colour ${c}`);
            const got = Array.from(Skia.Color(c));
            const want = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, Number(m[4])];
            got.forEach((v, k) => {
              expect(v, `${key} ${c}`).toBeCloseTo(want[k] ?? NaN, 3);
            });
          }
        }
      }
    }
    expect(gradients).toBeGreaterThan(0);
  });
});
