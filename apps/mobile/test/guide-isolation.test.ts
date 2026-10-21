/**
 * Review S1: a Skia failure must never take down the app. These pin the
 * structure that makes that true: Skia is reachable only through the guarded
 * player loader, How to is required lazily, bake.ts touches no Skia API at
 * module load, and a failed player becomes the cues with an honest notice.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createGuardedLoader } from '../src/guide/guarded-load';
import { buildHowToView, bundledHowToSources, howToLayout, STILLS_ONLY_NOTICE, type HowToView } from '../src/guide/how-to';

const SRC = join(import.meta.dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Value (non-type) imports of a module specifier matching `re`. */
function valueImporters(re: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((f) => [...readFileSync(f, 'utf8').matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)].some((m) => re.test(m[1] ?? '')))
    .map((f) => relative(SRC, f))
    .sort();
}

describe('guide isolation (review S1)', () => {
  it('only the player, the bake and Progress’s chart canvases import Skia, Reanimated or worklets', () => {
    expect(valueImporters(/^(@shopify\/react-native-skia|react-native-reanimated|react-native-worklets)$/)).toEqual(['guide/GuidePlayer.tsx', 'guide/bake.ts', 'progress/TrendCanvas.tsx', 'reviews/LiftsCanvas.tsx']);
  });

  it('Progress v3’s Lifts canvas is required behind the same guard, never imported directly', () => {
    expect(valueImporters(/\/LiftsCanvas$/)).toEqual([]);
    const charts = readFileSync(join(SRC, 'reviews/charts.tsx'), 'utf8');
    expect(charts).toContain('createGuardedLoader(() => {');
    expect(charts).toContain("require('./LiftsCanvas')");
  });

  it('Progress’s Skia chart canvas (activity line and trend chart) is required behind the same guard, never imported directly (progress.md §7.1)', () => {
    expect(valueImporters(/\/TrendCanvas$/)).toEqual([]);
    const loader = readFileSync(join(SRC, 'progress/load-charts.ts'), 'utf8');
    expect(loader).toContain('createGuardedLoader(() => {');
    expect(loader).toContain("require('./TrendCanvas')");
  });

  it('nothing imports the player or the bake directly; the player is required behind the guard', () => {
    expect(valueImporters(/\/GuidePlayer$/)).toEqual([]);
    expect(valueImporters(/\/bake$/)).toEqual(['guide/GuidePlayer.tsx']);
    const loader = readFileSync(join(SRC, 'guide/load-player.ts'), 'utf8');
    expect(loader).toContain("createGuardedLoader(() => {");
    expect(loader).toContain("require('./GuidePlayer')");
  });

  it('How to is loaded on first open, not at launch', () => {
    expect(valueImporters(/\/HowToScreen$/)).toEqual([]);
    const nav = readFileSync(join(SRC, 'navigation/AppNavigator.tsx'), 'utf8');
    expect(nav).toContain('name="HowTo" getComponent={loadHowToScreen}');
    expect(nav).toContain("require('../screens/workout/HowToScreen')");
  });

  it('bake.ts calls no Skia API at module load', async () => {
    const touched: string[] = [];
    const trap = (name: string) =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            touched.push(`${name}.${String(prop)}`);
            throw new Error(`Skia used at load: ${name}.${String(prop)}`);
          },
        },
      );
    vi.doMock('@shopify/react-native-skia', () => ({
      Skia: trap('Skia'),
      PaintStyle: trap('PaintStyle'),
      StrokeCap: trap('StrokeCap'),
      StrokeJoin: trap('StrokeJoin'),
      createPicture: () => {
        throw new Error('createPicture');
      },
    }));
    try {
      const bake = await import('../src/guide/bake');
      expect(touched).toEqual([]);
      // The stub is live: recording a frame does reach it (inside a task, where runSliced catches it).
      expect(() => bake.recordOps([], {} as never, new Map())).toThrow();
    } finally {
      vi.doUnmock('@shopify/react-native-skia');
    }
  });
});

describe('guarded loader', () => {
  it('loads once and returns the module', () => {
    let calls = 0;
    const load = createGuardedLoader(() => {
      calls += 1;
      return 'player';
    });
    expect(load()).toEqual({ ok: true, value: 'player' });
    expect(load()).toEqual({ ok: true, value: 'player' });
    expect(calls).toBe(1);
  });

  it('turns a throw into a result and remembers it (never retried, never thrown)', () => {
    let calls = 0;
    const boom = new Error('SkiaApi is not installed');
    const load = createGuardedLoader((): string => {
      calls += 1;
      throw boom;
    });
    expect(load()).toEqual({ ok: false, error: boom });
    expect(load()).toEqual({ ok: false, error: boom });
    expect(calls).toBe(1);
  });
});

describe('How to fallback when the player fails', () => {
  const src = bundledHowToSources();
  const squat = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, src);

  it('shows the player while it works', () => {
    expect(howToLayout(squat, false)).toEqual({ showPlayer: true, standaloneLegend: [], notices: [], textDraftLabel: null });
  });

  it('drops the player and keeps the cues, with one honest line', () => {
    const failed = howToLayout(squat, true);
    expect(failed).toMatchObject({ showPlayer: false, notices: ['The animated guide couldn’t be shown. The cues below still apply.'], textDraftLabel: 'Draft' });
    // The legend moves out of the (gone) player card, without swatches: nothing on screen is coloured.
    // `Not shown from this side` goes too: with no figure there is no side (guides v2 review S4).
    expect(squat.legend.map((l) => l.kind)).toEqual(['most', 'also', 'notShown']);
    expect(failed.standaloneLegend.map((l) => l.kind)).toEqual(['most', 'also']);
    expect(failed.standaloneLegend.every((l) => !l.swatch)).toBe(true);
  });

  it('never claims cues that are not there', () => {
    const bare: HowToView = { ...squat, guide: squat.guide && { ...squat.guide, stops: [] }, setup: [], execution: [], avoid: [], safety: { notes: [], stopIf: [] }, textDraftLabel: null, notice: null };
    expect(howToLayout(bare, true).notices).toEqual(['The animated guide couldn’t be shown.']);
  });

  it('stills only (Developer: animations off) keeps the player and says why it is still', () => {
    expect(howToLayout(squat, false, { stillsOnly: true })).toEqual({ showPlayer: true, standaloneLegend: [], notices: [STILLS_ONLY_NOTICE], textDraftLabel: null });
    // A failure still wins: the notice is about the player that isn't there.
    expect(howToLayout(squat, true, { stillsOnly: true }).notices).toEqual(['The animated guide couldn’t be shown. The cues below still apply.']);
  });

  it('without a guide nothing changes, failed or not', () => {
    const none = buildHowToView({ name: 'Landmine twist', catalogueKey: null }, src);
    expect(howToLayout(none, true)).toEqual({ showPlayer: false, standaloneLegend: [], notices: ['No how-to for Landmine twist yet.'], textDraftLabel: null });
  });
});
