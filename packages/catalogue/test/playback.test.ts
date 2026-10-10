import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  bakeFrame,
  DIRECTION_D_GUIDE_TOKENS,
  fitCamera,
  frameOps,
  guideStyleFromTokens,
  heldFrames,
  keyFrameStops,
  overlayTraces,
  playbackTimes,
  poseAt,
  prepareGuide,
  renderFrameBody,
  type DrawOp,
} from '../src/figure/index';
import { bundledGuides, createGuideLibrary } from '../src/guide-library';
import { BUNDLED_GUIDE_FILES } from '../src/generated/guide-files';
import { createLazyCatalogue, lazyBundledCatalogue } from '../src/loader';
import { baseGuide, squatRaw } from './figure-helpers';

const GUIDES = join(import.meta.dirname, '..', 'guides');
const guideFolders = readdirSync(GUIDES)
  .filter((d) => !d.startsWith('_') && !d.startsWith('.') && existsSync(join(GUIDES, d, 'guide.json')))
  .sort();

function squat() {
  const loaded = bundledGuides().load('barbell-back-squat');
  if (!loaded.ok) throw new Error('squat guide should load');
  return loaded.value;
}

describe('frame ops (shared by the SVG preview and the app player)', () => {
  it('start with the dashed floor, then draw each limb group halos-first', () => {
    const { prepared, camera } = squat();
    const ops = frameOps(poseAt(prepared, 0.3), { px: 240, camera });
    const floor = ops[0];
    expect(floor).toMatchObject({ kind: 'line', paint: 'trace', cap: 'butt' });
    expect(floor?.kind === 'line' && floor.dash?.length).toBe(2);
    // A halo is a filled+stroked path in the background paint; every fill of its limb comes after it.
    const haloIdx = ops.findIndex((o) => o.kind === 'path' && o.fill === 'background' && o.stroke === 'background');
    const firstLimbFill = ops.findIndex((o, i) => i > haloIdx && o.kind === 'path' && o.fill !== 'background' && o.stroke === null);
    expect(haloIdx).toBeGreaterThan(0);
    expect(firstLimbFill).toBeGreaterThan(haloIdx);
  });

  it('the SVG body is exactly one element per op (nothing drawn outside the ops)', () => {
    const { prepared, camera } = squat();
    const pose = poseAt(prepared, 0.5);
    const ops = frameOps(pose, { px: 240, camera });
    const body = renderFrameBody(pose, { px: 240, camera, style: guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark) });
    const inner = body.slice(body.indexOf('<g clip-path'));
    expect((inner.match(/<(line|circle|path) /g) ?? []).length).toBe(ops.length);
  });

  it('unit-size ops scale linearly to any canvas size (one bake serves every width)', () => {
    const { prepared, camera } = squat();
    const unit = bakeFrame(prepared, camera, 0.4);
    const big = frameOps(poseAt(prepared, 0.4), { px: 240, camera });
    expect(unit.length).toBe(big.length);
    const coords = (o: DrawOp): number[] =>
      o.kind === 'line' ? [o.a.x, o.a.y, o.b.x, o.b.y, o.width] : o.kind === 'circle' ? [o.c.x, o.c.y, o.r, o.width] : [...o.contours.flat().flatMap((p) => [p.x, p.y]), o.width];
    unit.forEach((o, i) => {
      const b = big[i];
      if (b === undefined) throw new Error('missing op');
      expect(o.kind).toBe(b.kind);
      coords(o).forEach((c, j) => {
        expect(c * 240).toBeCloseTo(coords(b)[j] ?? NaN, 9);
      });
    });
  });

  it('adds the trace overlay only when there is a path to draw', () => {
    const { prepared, camera } = squat();
    const [trace] = overlayTraces(prepared, 'static');
    const isTrace = (o: DrawOp) => o.kind === 'path' && !o.closed && o.stroke === 'trace';
    expect(bakeFrame(prepared, camera, 0).some(isTrace)).toBe(false);
    expect(bakeFrame(prepared, camera, 0, [{ x: 0, y: 0 }]).some(isTrace)).toBe(false);
    expect(bakeFrame(prepared, camera, 0, trace).some(isTrace)).toBe(true);
  });

  it('back view: the trace is drawn under the trunk and head, never over them (guides v2 review B1)', () => {
    const loaded = bundledGuides().load('cable-lat-pulldown');
    if (!loaded.ok) throw new Error('pulldown guide should load');
    const { prepared, camera } = loaded.value;
    expect(prepared.guide.seenFrom).toBe('back');
    const [trace] = overlayTraces(prepared, 'static');
    expect(trace?.length).toBeGreaterThan(1);
    const isTrace = (o: DrawOp) => o.kind === 'path' && !o.closed && o.stroke === 'trace';
    for (const stop of keyFrameStops(prepared)) {
      const ops = bakeFrame(prepared, camera, stop.t, trace);
      const at = ops.findIndex(isTrace);
      expect(at).toBeGreaterThan(-1);
      const t = ops[at];
      if (t?.kind !== 'path') throw new Error('trace op');
      const ys = t.contours.flat().map((p) => p.y);
      const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
      const x = t.contours.flat()[0]?.x ?? NaN;
      // Every body fill the trace passes through (trunk, head) comes after it, so the body hides it as it hides the bar.
      const covering = ops
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => {
          if (o.kind !== 'path' || o.fill !== 'nearBody') return false;
          const pts = o.contours.flat();
          const [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
          const [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
          return x0 < x && x < x1 && y0 < bottom && top < y1;
        });
      expect(covering.length).toBeGreaterThan(0);
      for (const { i } of covering) expect(i).toBeGreaterThan(at);
    }
  });

  it('side view: the trace stays above the body (squat)', () => {
    const { prepared, camera } = squat();
    const [trace] = overlayTraces(prepared, 'static');
    const ops = bakeFrame(prepared, camera, 0, trace);
    const at = ops.findIndex((o) => o.kind === 'path' && !o.closed && o.stroke === 'trace');
    const lastBody = ops.reduce((m, o, i) => (o.kind === 'path' && o.fill === 'nearBody' ? i : m), -1);
    expect(at).toBeGreaterThan(lastBody);
  });

  it('heldFrames: a frame marked as a repeat draws exactly the ops of the frame it repeats (every guide)', () => {
    let repeats = 0;
    for (const key of bundledGuides().keys) {
      const g = bundledGuides().load(key);
      if (!g.ok) continue;
      const { prepared, camera } = g.value;
      const times = playbackTimes(prepared.guide);
      const held = heldFrames(prepared, times);
      expect(held).toHaveLength(times.length);
      const opts = { pt: 348, muscles: { primary: ['quads', 'lats'], secondary: ['core'] }, definition: 'neutral' } as const;
      held.forEach((j, i) => {
        if (j < 0) return;
        repeats += 1;
        expect(j).toBeLessThan(i);
        expect(held[j]).toBe(-1);
        expect(JSON.stringify(bakeFrame(prepared, camera, times[i] ?? NaN, undefined, opts))).toBe(JSON.stringify(bakeFrame(prepared, camera, times[j] ?? NaN, undefined, opts)));
      });
      if (prepared.guide.ground.scrollPerCycle !== 0) expect(held.every((j) => j === -1)).toBe(true);
    }
    // Holds exist on the rep guides, so the rule does save work.
    expect(repeats).toBeGreaterThan(20);
  });

  it('uses only guide paints, never an accent', () => {
    const paints = new Set<string>();
    for (const key of bundledGuides().keys) {
      const g = bundledGuides().load(key);
      if (!g.ok) continue;
      for (const o of bakeFrame(g.value.prepared, g.value.camera, 0.25, undefined, { muscles: { primary: ['quads', 'chest', 'lats', 'triceps', 'front_delts'], secondary: ['core'] } })) {
        if (o.kind === 'line') paints.add(o.paint);
        else {
          if (o.fill) paints.add(o.fill);
          if (o.stroke) paints.add(o.stroke);
          if (o.kind === 'path') for (const st of o.gradient?.stops ?? []) paints.add(st.paint);
        }
      }
    }
    expect([...paints].sort()).toEqual(expect.arrayContaining(['nearBody', 'trace', 'shade', 'muscle']));
    for (const p of paints) expect(['background', 'nearBody', 'farBody', 'implement', 'trace', 'cable', 'frame', 'frameFill', 'shade', 'muscle']).toContain(p);
  });
});

describe('key-frame stops (the Reduce Motion frames)', () => {
  it('lists each labelled keyframe once, in order, skipping the loop-closing copies', () => {
    const stops = keyFrameStops(squat().prepared);
    expect(stops.map((s) => [s.number, s.label])).toEqual([
      [1, 'Start'],
      [2, 'Halfway'],
      [3, 'Bottom'],
    ]);
    expect(stops[2]?.caption).toBe('Hips just below knees, heels down');
    expect(stops.map((s) => s.t)).toEqual([0, 0.28, 0.5714]);
  });

  it('match the catalogue entry key positions for every bundled guide', () => {
    const catalogue = lazyBundledCatalogue();
    for (const key of bundledGuides().keys) {
      const g = bundledGuides().load(key);
      const e = catalogue.entry(key);
      if (!g.ok || !e.ok || e.entry.tier !== 'rich') throw new Error(`${key}: guide and rich entry should load`);
      expect(keyFrameStops(g.value.prepared).map((s) => s.label), key).toEqual(e.entry.guideBrief.keyPositions.map((p) => p.label));
    }
  });

  it('a guide with no labels has no stops', () => {
    const g = baseGuide({ keyframes: [{ t: 0, root: { x: 0, y: 0.5, pelvisDeg: 0 } }, { t: 1, sameAs: 0 }] });
    expect(keyFrameStops(prepareGuide(g))).toEqual([]);
  });
});

describe('playback times', () => {
  it('a cycle bakes n frames and never repeats t = 1 (it equals t = 0)', () => {
    const t = playbackTimes(baseGuide({ durationMs: 3000 }));
    expect(t).toHaveLength(90);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBeCloseTo(89 / 90, 12);
  });

  it('a ping-pong bakes both ends', () => {
    const t = playbackTimes(baseGuide({ durationMs: 2000, loop: 'pingpong' }));
    expect(t).toHaveLength(61);
    expect(t.at(-1)).toBe(1);
  });

  it('follows the guide tempo (frame count scales with duration and fps)', () => {
    expect(playbackTimes(baseGuide({ durationMs: 2100 }))).toHaveLength(63);
    expect(playbackTimes(baseGuide({ durationMs: 2100 }), 60)).toHaveLength(126);
  });
});

describe('bundled guide library', () => {
  it('bundles exactly the guide folders, and every one loads with its fitted camera', () => {
    expect([...bundledGuides().keys].sort()).toEqual(guideFolders);
    for (const key of guideFolders) {
      const g = bundledGuides().load(key);
      if (!g.ok) throw new Error(`${key} should load`);
      const fitted = fitCamera(g.value.prepared);
      expect(g.value.camera.cx).toBeCloseTo(fitted.cx, 6);
      expect(g.value.camera.cy).toBeCloseTo(fitted.cy, 6);
      expect(g.value.camera.size).toBeCloseTo(fitted.size, 6);
    }
  });

  it('every bundled guide has a rich catalogue entry (so a guide always comes with cues)', () => {
    for (const f of BUNDLED_GUIDE_FILES) expect(lazyBundledCatalogue().tierHint(f.key), f.key).toBe('rich');
  });

  it('reports a missing, broken or mismatched guide instead of throwing, and memoises', () => {
    const raw = squatRaw();
    const lib = createGuideLibrary([
      { key: 'barbell-back-squat', raw, camera: null },
      { key: 'broken', raw: { ...raw, durationMs: 'slow' }, camera: null },
      { key: 'other-key', raw, camera: null },
    ]);
    const ok = lib.load('barbell-back-squat');
    expect(ok.ok).toBe(true);
    // No precomputed camera: it is fitted at load time.
    if (ok.ok) expect(ok.value.camera).toEqual(fitCamera(ok.value.prepared));
    expect(lib.load('barbell-back-squat')).toBe(ok);
    expect(lib.load('broken')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(lib.load('other-key')).toMatchObject({ ok: false, reason: 'invalid', message: 'Guide is for barbell-back-squat, not other-key' });
    expect(lib.load('nope')).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('lazy catalogue', () => {
  it('reads tier hints without validating, and validates one entry on demand', () => {
    const lazy = createLazyCatalogue([{ key: 'a', tier: 'rich' }, { key: 'b', tier: 'basic' }, { key: 'c' }, 'junk', { key: 'a', tier: 'basic' }]);
    expect([...lazy.keys].sort()).toEqual(['a', 'b', 'c']);
    expect(lazy.tierHint('a')).toBe('rich');
    expect(lazy.tierHint('b')).toBe('basic');
    expect(lazy.tierHint('c')).toBeNull();
    expect(lazy.tierHint('zzz')).toBeNull();
    expect(lazy.entry('a')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(lazy.entry('zzz')).toEqual({ ok: false, reason: 'missing' });
  });

  it('agrees with the full loader for every bundled entry', () => {
    const lazy = lazyBundledCatalogue();
    expect(lazy.keys.size).toBe(135);
    const squatEntry = lazy.entry('barbell-back-squat');
    expect(squatEntry.ok && squatEntry.entry.name).toBe('Back squat');
    expect(lazy.entry('barbell-back-squat')).toBe(squatEntry);
  });
});
