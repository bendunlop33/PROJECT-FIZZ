/**
 * The bake plan (bake.ts) against a recording Skia stub: the real Skia never
 * loads in Node (ADR 0013). Pins review N1: the first picture exists after the
 * synchronous part of the bake, even when a bar-path trace must be sampled
 * first, so the Reduce Motion still view never opens on an empty canvas.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { bundledGuides, type LoadedGuide } from '@fizz/catalogue';
import { DIRECTION_D_GUIDE_TOKENS, guideStyleFromTokens, keyFrameStops, playbackTimes } from '@fizz/catalogue/figure';

import type * as Bake from '../src/guide/bake';

interface FakePicture {
  draws: number;
}

let bake: typeof Bake;

beforeAll(async () => {
  const paint = () => new Proxy({}, { get: () => () => undefined });
  vi.doMock('@shopify/react-native-skia', () => ({
    Skia: {
      XYWHRect: () => ({}),
      Paint: paint,
      Color: (c: string) => c,
      Path: { MakeFromSVGString: () => ({}) },
      PathEffect: { MakeDash: () => ({}) },
      Shader: { MakeLinearGradient: () => ({}) },
      Point: (x: number, y: number) => ({ x, y }),
    },
    PaintStyle: { Fill: 0, Stroke: 1 },
    TileMode: { Clamp: 0 },
    StrokeCap: { Round: 0, Butt: 1 },
    StrokeJoin: { Round: 0, Miter: 1 },
    createPicture: (draw: (canvas: unknown) => void): FakePicture => {
      const pic = { draws: 0 };
      const count = () => {
        pic.draws += 1;
      };
      draw({ drawLine: count, drawCircle: count, drawPath: count, saveLayer: () => undefined, restore: () => undefined });
      return pic;
    },
  }));
  bake = await import('../src/guide/bake');
});

afterAll(() => {
  vi.doUnmock('@shopify/react-native-skia');
});

function guide(key: string): LoadedGuide {
  const load = bundledGuides().load(key);
  if (!load.ok) throw new Error(key);
  return load.value;
}

const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark);
const steady: Bake.BakeConfig = { pt: 350, muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings'] }, pulse: false, increaseContrast: false, definition: 'neutral' };

describe('bake plan', () => {
  it('still view: position 1 is drawn first, before the trace samples, then redrawn with the trace (review N1)', () => {
    const squat = guide('barbell-back-squat');
    const stops = keyFrameStops(squat.prepared);
    const out: FakePicture[] = [];
    const plan = bake.bakeTasks(squat, 'steps', stops, style, out as never[], steady);
    expect(plan.firstSync).toBe(1);
    // The squat has a static bar-path trace, so there are samples to take.
    expect(plan.tasks.length).toBeGreaterThan(1 + stops.length + 10);
    plan.tasks[0]?.();
    expect(out).toHaveLength(1);
    const poster = out[0]?.draws ?? 0;
    expect(poster).toBeGreaterThan(0);
    for (const task of plan.tasks.slice(1)) task();
    expect(out).toHaveLength(stops.length);
    // The final position 1 carries the trace (one more path) on top of the same figure.
    expect(out[0]?.draws).toBeGreaterThan(poster);
  });

  it('animation without a trace: one task per frame, the first is the poster', () => {
    const squat = guide('barbell-back-squat');
    const out: FakePicture[] = [];
    const plan = bake.bakeTasks(squat, 'animation', [], style, out as never[], steady);
    const frames = playbackTimes(squat.prepared.guide).length;
    expect(plan.tasks).toHaveLength(frames);
    plan.tasks[0]?.();
    expect(out).toHaveLength(1);
    for (const task of plan.tasks.slice(1)) task();
    expect(out).toHaveLength(frames);
  });

  it('with the work-phase emphasis, a steady poster follows the frames for the Finished state (guides v2 §8)', () => {
    const squat = guide('barbell-back-squat');
    const out: FakePicture[] = [];
    const plan = bake.bakeTasks(squat, 'animation', [], style, out as never[], { ...steady, pulse: true });
    const frames = playbackTimes(squat.prepared.guide).length;
    expect(plan.steadyPoster).toBe(frames);
    for (const task of plan.tasks) task();
    expect(out).toHaveLength(frames + 1);
    // Stills never pulse, so they never need one.
    expect(bake.bakeTasks(squat, 'steps', keyFrameStops(squat.prepared), style, [], { ...steady, pulse: true }).steadyPoster).toBeNull();
  });

  it('the cache key changes with size, muscles, emphasis, Increase Contrast and the definition mode drawn', () => {
    const keys = new Set([
      bake.bakeKey('k', 'animation', style, steady),
      bake.bakeKey('k', 'animation', style, { ...steady, pt: 240 }),
      bake.bakeKey('k', 'animation', style, { ...steady, muscles: null }),
      bake.bakeKey('k', 'animation', style, { ...steady, pulse: true }),
      bake.bakeKey('k', 'animation', style, { ...steady, increaseContrast: true }),
      bake.bakeKey('k', 'animation', style, { ...steady, definition: 'off' }),
      bake.bakeKey('k', 'animation', style, { ...steady, definition: 'tint' }),
    ]);
    expect(keys.size).toBe(7);
  });

  it('bakes the faint groups into every frame (muscle definition, guides v2 §4.11)', () => {
    const squat = guide('barbell-back-squat');
    const draws = (definition: Bake.BakeConfig['definition']) => {
      const out: FakePicture[] = [];
      for (const task of bake.bakeTasks(squat, 'steps', keyFrameStops(squat.prepared), style, out as never[], { ...steady, definition }).tasks) task();
      return out.map((p) => p.draws);
    };
    const off = draws('off');
    const neutral = draws('neutral');
    expect(neutral).toHaveLength(off.length);
    neutral.forEach((n, i) => {
      expect(n).toBeGreaterThan(off[i] ?? 0);
    });
  });

  it('a guide with no labelled positions still bakes one still frame (P6)', () => {
    const squat = guide('barbell-back-squat');
    const out: FakePicture[] = [];
    const plan = bake.bakeTasks(squat, 'steps', [], style, out as never[], steady);
    for (const task of plan.tasks) task();
    expect(out).toHaveLength(1);
  });
});
