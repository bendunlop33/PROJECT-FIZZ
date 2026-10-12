/**
 * Muscle definition D6 (exercise-guides-v2.md §4.11.11), the heavy part: rasterises
 * every guide at every key frame. Moved to the perf lane (`npm run test:perf`) so
 * machine load can't fail `npm test`; the cheap D6 checks stay in definition.test.ts.
 */
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';

import { bundledGuides } from '../src/guide-library';
import { lazyBundledCatalogue } from '../src/loader';
import { DIRECTION_D_GUIDE_TOKENS, guideStyleFromTokens, keyFrameStops, poseAt, renderSvg } from '../src/figure/index';

const catalogue = lazyBundledCatalogue();
const library = bundledGuides();
const GUIDE_KEYS = [...library.keys].sort();

function loaded(key: string) {
  const g = library.load(key);
  if (!g.ok) throw new Error(`${key} should load`);
  return g.value;
}
function musclesOf(key: string) {
  const e = catalogue.entry(key);
  if (!e.ok) throw new Error(`${key} entry should load`);
  return { primary: e.entry.primaryMuscles, secondary: e.entry.secondaryMuscles };
}

describe('drawing (§4.11.6–4.11.7)', () => {
  // Rasterises every guide: 3× the old 60 s for a loaded machine (review progress-A r3 S1).
  it('D6: one paint per pixel: coloured pixels are the same whether the faint shapes show or not (steady and at the pulse low)', { timeout: 180_000 }, () => {
    const PX = 240;
    for (const key of GUIDE_KEYS) {
      const { prepared, camera } = loaded(key);
      const muscles = musclesOf(key);
      for (const scheme of ['dark', 'light'] as const) {
        const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme]);
        // Muscle paint white, everything else black: where colour is visible after occlusion.
        const maskStyle = Object.fromEntries(Object.keys(style).map((k) => [k, k === 'muscle' ? '#FFFFFF' : '#000000'])) as typeof style;
        const hidden = { ...style, faintNeutral: style.nearBody };
        for (const stop of keyFrameStops(prepared)) {
          for (const pulse of [undefined, 0]) {
            const pose = poseAt(prepared, stop.t);
            const draw = (st: typeof style) => new Resvg(renderSvg(pose, { px: PX, style: st, camera, muscles, definition: 'neutral', ...(pulse === undefined ? {} : { pulse }) })).render().pixels;
            const mask = draw(maskStyle);
            const shown = draw(style);
            const without = draw(hidden);
            const on = (x: number, y: number): boolean => (mask[(y * PX + x) * 4] ?? 0) > 70;
            let coloured = 0;
            let differ = 0;
            for (let y = 1; y < PX - 1; y += 1) {
              for (let x = 1; x < PX - 1; x += 1) {
                // Inside a coloured region, away from its anti-aliased edge.
                if (![-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => on(x + dx, y + dy)))) continue;
                coloured += 1;
                const i = (y * PX + x) * 4;
                if ([0, 1, 2].some((c) => Math.abs((shown[i + c] ?? 0) - (without[i + c] ?? 0)) > 1)) differ += 1;
              }
            }
            expect(coloured, `${key} ${scheme} ${stop.label}`).toBeGreaterThan(0);
            expect(differ, `${key} ${scheme} ${stop.label} pulse ${String(pulse)}`).toBe(0);
          }
        }
      }
    }
  });
});
