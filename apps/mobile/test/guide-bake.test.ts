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

describe('bake plan', () => {
  it('still view: position 1 is drawn first, before the trace samples, then redrawn with the trace (review N1)', () => {
    const squat = guide('barbell-back-squat');
    const stops = keyFrameStops(squat.prepared);
    const out: FakePicture[] = [];
    const plan = bake.bakeTasks(squat, 'steps', stops, style, out as never[]);
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
    const plan = bake.bakeTasks(squat, 'animation', [], style, out as never[]);
    const frames = playbackTimes(squat.prepared.guide).length;
    expect(plan.tasks).toHaveLength(frames);
    plan.tasks[0]?.();
    expect(out).toHaveLength(1);
    for (const task of plan.tasks.slice(1)) task();
    expect(out).toHaveLength(frames);
  });

  it('a guide with no labelled positions still bakes one still frame (P6)', () => {
    const squat = guide('barbell-back-squat');
    const out: FakePicture[] = [];
    const plan = bake.bakeTasks(squat, 'steps', [], style, out as never[]);
    for (const task of plan.tasks) task();
    expect(out).toHaveLength(1);
  });
});
