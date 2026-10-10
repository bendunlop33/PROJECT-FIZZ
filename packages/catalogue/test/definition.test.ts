/**
 * Muscle definition (exercise-guides-v2.md §4.11): one faint, steady shape for
 * every muscle group the view can show. Checks D1–D3 and D5–D11 of §4.11.11;
 * the contrast floors (D4) and the How to legend (D12–D13) are in apps/mobile.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';

import { bundledGuides } from '../src/guide-library';
import { lazyBundledCatalogue } from '../src/loader';
import { DEFINITION_TINT_LEGEND, muscleFocusFor, muscleLegend } from '../src/muscles';
import { MUSCLES, type Muscle } from '../src/vocab';
import {
  checkGuide,
  DEFAULT_MUSCLE_DEFINITION,
  DEFINITION_GROOVE,
  DEFINITION_GROOVE_FLOOR,
  DEFINITION_GROUPS,
  DEFINITION_FOLDS,
  DEFINITION_MAP,
  DEFINITION_TEXT,
  definitionGroupsFor,
  definitionReplacedBy,
  definitionShapes,
  DIRECTION_D_GUIDE_TOKENS,
  effectiveDefinition,
  focusViewOf,
  frameOps,
  groupContours,
  guideStyleFromTokens,
  hasListedMuscles,
  keyFrameStops,
  MUSCLE_INSET,
  MUSCLE_REGION_TEXT,
  narrowestDefinitionGroove,
  parseRegion,
  playbackTimes,
  pointInPolygon,
  pointSegmentDistance,
  polygonGap,
  poseAt,
  regionShapes,
  signedArea,
  renderSvg,
  resolveFocus,
  type DefinitionGroup,
  type DrawOp,
  type FocusView,
  type FrameOpsOptions,
  type MuscleDefinition,
  type RegionSpec,
  type ResolvedFocus,
  type Vec,
} from '../src/figure/index';
import { squatEntry, squatRaw } from './figure-helpers';

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

type PathOp = Extract<DrawOp, { kind: 'path' }>;
const isPath = (o: DrawOp): o is PathOp => o.kind === 'path';
const isFaintPaint = (paint: string | null | undefined): boolean => paint === 'faintNeutral' || paint === 'faintTint';
/** Faint definition ops: gradient fills in a faint paint (round 4: one per shape, along its long axis). */
const faintOps = (ops: readonly DrawOp[]): PathOp[] => ops.filter(isPath).filter((o) => isFaintPaint(o.fill) || (o.gradient !== null && o.gradient.stops.every((st) => isFaintPaint(st.paint))));
const ops = (key: string, t: number, o: Partial<FrameOpsOptions> = {}): DrawOp[] => {
  const { prepared, camera } = loaded(key);
  return frameOps(poseAt(prepared, t), { px: 240, camera, muscles: musclesOf(key), ...o });
};

const VIEWS = ['side', 'front', 'back'] as const;

describe('definition map (§4.11.3, D1)', () => {
  /** The §4.11.3 table as written in the spec, cell by cell. */
  function specTable(): Map<string, { replacedBy: string; side: string; front: string; back: string }> {
    const text = readFileSync(join(import.meta.dirname, '../../../docs/design/exercise-guides-v2.md'), 'utf8');
    const section = text.slice(text.indexOf('#### 4.11.3'), text.indexOf('#### 4.11.4'));
    const rows = new Map<string, { replacedBy: string; side: string; front: string; back: string }>();
    for (const line of section.split('\n')) {
      const m = /^\| `(\w+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/.exec(line);
      if (m) rows.set(m[1] ?? '', { replacedBy: (m[2] ?? '').trim(), side: (m[3] ?? '').trim(), front: (m[4] ?? '').trim(), back: (m[5] ?? '').trim() });
    }
    return rows;
  }
  /** A spec cell → the region text it stands for (`= §4.5 x` is the highlight's own cell; notes in brackets dropped). */
  function cellText(cell: string, view: FocusView): readonly string[] | null {
    if (cell.startsWith('—')) return null;
    const ref = /^= §4\.5 `(\w+)`/.exec(cell);
    if (ref) return MUSCLE_REGION_TEXT[ref[1] as Muscle][view];
    return [cell.replace(/\s*\(.*\)\s*$/, '').replace(/−/g, '-')];
  }

  it('matches the spec table line by line, including the — cells', () => {
    const table = specTable();
    expect([...table.keys()]).toEqual([...DEFINITION_GROUPS]);
    for (const g of DEFINITION_GROUPS) {
      const row = table.get(g);
      if (row === undefined) throw new Error(g);
      for (const view of VIEWS) expect(DEFINITION_TEXT[g][view], `${g} ${view}`).toEqual(cellText(row[view], view));
      // `spinal_erectors; back view also core`
      const [all, extra] = row.replacedBy.split(';');
      expect(DEFINITION_TEXT[g].replacedBy, g).toEqual((all ?? '').split(',').map((x) => x.trim()));
      if (extra !== undefined) expect(definitionReplacedBy(g, 'back'), g).toContain(/back view also (\w+)/.exec(extra)?.[1]);
    }
  });

  it('every cell parses, 14 groups from the side, 12 from the front, 11 from behind', () => {
    for (const g of DEFINITION_GROUPS) {
      for (const view of VIEWS) expect(DEFINITION_MAP[g][view]?.length ?? 0, `${g} ${view}`).toBe(DEFINITION_TEXT[g][view]?.length ?? 0);
    }
    const counts = VIEWS.map((view) => DEFINITION_GROUPS.filter((g) => DEFINITION_MAP[g][view] !== null).length);
    expect(counts).toEqual([14, 12, 11]);
  });

  it('every one of the 23 vocabulary muscles is in some replacedBy list; sub-parts and composites have no group of their own', () => {
    const covered = new Set(DEFINITION_GROUPS.flatMap((g) => VIEWS.flatMap((v) => definitionReplacedBy(g, v))));
    expect([...MUSCLES].filter((m) => !covered.has(m))).toEqual([]);
    expect(MUSCLES).toHaveLength(23);
    for (const m of ['upper_chest', 'brachialis', 'core', 'grip']) expect(DEFINITION_GROUPS as readonly string[]).not.toContain(m);
    // Core from behind is the erectors and obliques, so it replaces the lower back there only.
    expect(definitionReplacedBy('lowerBack', 'back')).toContain('core');
    expect(definitionReplacedBy('lowerBack', 'side')).not.toContain('core');
  });
});

describe('which groups are faint (§4.11.5, D3)', () => {
  /** §4.11.5 "Faint groups" column. */
  const FAINT: Record<string, DefinitionGroup[]> = {
    'barbell-back-squat': ['chest', 'lats', 'upperBack', 'deltoid', 'frontArm', 'triceps', 'forearm', 'calves'],
    'barbell-romanian-deadlift': ['chest', 'abs', 'obliques', 'lats', 'deltoid', 'frontArm', 'triceps', 'quads', 'calves'],
    'machine-leg-press': ['chest', 'abs', 'obliques', 'lowerBack', 'lats', 'upperBack', 'deltoid', 'frontArm', 'triceps', 'forearm', 'calves'],
    'dumbbell-bulgarian-split-squat': ['chest', 'lowerBack', 'lats', 'upperBack', 'deltoid', 'frontArm', 'triceps', 'calves'],
    'barbell-bench-press': ['abs', 'obliques', 'lowerBack', 'lats', 'upperBack', 'glutes', 'frontArm', 'forearm', 'quads', 'hamstrings', 'calves'],
    'barbell-overhead-press': ['lowerBack', 'lats', 'glutes', 'frontArm', 'forearm', 'quads', 'hamstrings', 'calves'],
    'dumbbell-one-arm-row': ['chest', 'abs', 'obliques', 'lowerBack', 'glutes', 'triceps', 'quads', 'hamstrings', 'calves'],
    'cable-triceps-pushdown': ['chest', 'abs', 'obliques', 'lowerBack', 'lats', 'upperBack', 'glutes', 'deltoid', 'frontArm', 'forearm', 'quads', 'hamstrings', 'calves'],
    'sled-push': ['chest', 'lowerBack', 'lats', 'upperBack', 'deltoid', 'frontArm', 'forearm'],
    // Behind: hamstrings and adductors too (they fade only where the thigh points at the camera).
    'cable-lat-pulldown': ['obliques', 'lowerBack', 'glutes', 'triceps', 'forearm', 'hamstrings', 'adductors', 'calves'],
  };

  it.each(Object.keys(FAINT))('%s', (key) => {
    const { guide } = loaded(key);
    const view = focusViewOf(guide);
    const focus = resolveFocus(musclesOf(key), guide.focus, view);
    const faint = definitionGroupsFor(view, focus, guide.focus?.hide ?? []);
    expect(new Set(faint)).toEqual(new Set(FAINT[key]));
    // A group is faint or coloured, never both.
    for (const g of faint) expect(definitionReplacedBy(g, view).some((m) => focus.drawn.includes(m)), g).toBe(false);
  });

  it('the pushdown is the stress case (13 faint, only triceps coloured); the split squat hides core, so no faint abs or obliques', () => {
    expect(FAINT['cable-triceps-pushdown']).toHaveLength(13);
    expect(resolveFocus(musclesOf('cable-triceps-pushdown'), undefined, 'side').drawn).toEqual(['triceps']);
    const split = loaded('dumbbell-bulgarian-split-squat').guide;
    const faint = definitionGroupsFor('side', resolveFocus(musclesOf('dumbbell-bulgarian-split-squat'), split.focus, 'side'), split.focus?.hide ?? []);
    expect(faint).not.toContain('abs');
    expect(faint).not.toContain('obliques');
  });

  it('no entry: every group the view can show is faint', () => {
    expect(definitionGroupsFor('side', null)).toHaveLength(14);
    expect(definitionGroupsFor('front', null)).toHaveLength(12);
    expect(definitionGroupsFor('back', null)).toHaveLength(11);
  });

  it('guide:check writes the faint groups to meta.json', () => {
    const report = checkGuide({ raw: squatRaw(), bytes: 2000, dirKey: 'barbell-back-squat', entry: squatEntry() });
    expect(report.faintGroups).toEqual(FAINT['barbell-back-squat']);
    expect(report.items.find((i) => i.id === 'definition')).toMatchObject({ ok: true });
  });
});

describe('geometry (§4.11.3, D2)', () => {
  const inside = (p: Vec, polys: readonly (readonly Vec[])[]): boolean =>
    polys.some((poly) => pointInPolygon(p, poly)) || polys.some((poly) => poly.some((a, i) => pointSegmentDistance(p, a, poly[(i + 1) % poly.length] ?? a) < MUSCLE_INSET * 0.5));

  // Every group of the view (the no-entry case), a superset of any guide's faint groups.
  it('at every key frame of every guide, faint shapes sit inside the silhouette and keep a groove within each body group', { timeout: 20_000 }, () => {
    for (const key of GUIDE_KEYS) {
      const { prepared } = loaded(key);
      for (const stop of keyFrameStops(prepared)) {
        const body = poseAt(prepared, stop.t).body;
        const shapes = definitionShapes(body, definitionGroupsFor(focusViewOf(prepared.guide), null));
        expect(shapes.length, key).toBeGreaterThan(5);
        for (const sh of shapes) {
          const polys = groupContours(body, sh.group === 'pelvis' ? 'trunk' : sh.group);
          for (const p of sh.contour) expect(inside(p, polys), `${key} ${stop.label} ${sh.definition}`).toBe(true);
        }
        const groove = narrowestDefinitionGroove(shapes);
        expect(groove?.gap ?? Infinity, `${key} ${stop.label} ${groove?.a ?? ''}/${groove?.b ?? ''}`).toBeGreaterThanOrEqual(DEFINITION_GROOVE_FLOOR);
      }
    }
  });

  it('a folded elbow keeps its groove: faint shapes and muscle colour stop short of the other segment, and only there', () => {
    const forearmRegion = (body: ReturnType<typeof poseAt>['body']) => regionShapes(body, resolveFocus({ primary: ['forearms'], secondary: [] }, undefined, 'side'))[0]?.contour;
    // The squat's bar hold folds the elbow tight: the shapes are cut back so the groove holds, and the forearm, which lies
    // across the upper arm there, has nothing left to draw.
    const fold = poseAt(loaded('barbell-back-squat').prepared, 0).body;
    const shapes = definitionShapes(fold, ['triceps', 'frontArm', 'forearm']);
    expect(narrowestDefinitionGroove(shapes)?.gap ?? Infinity).toBeGreaterThanOrEqual(DEFINITION_GROOVE);
    expect(shapes.map((s) => s.definition)).toEqual(['triceps', 'frontArm']);
    // Muscle colour is cut the same way: at the row's top the biceps and the grip band met in the elbow fold as arrowhead
    // spikes (visual review of 9 Oct 2026). Now the upper-arm colour keeps the groove from the forearm colour.
    const top = poseAt(loaded('dumbbell-one-arm-row').prepared, 0.37).body;
    const colour = (m: Muscle) => regionShapes(top, resolveFocus({ primary: [], secondary: [m] }, undefined, 'side')).map((r) => r.contour);
    for (const upper of [...colour('biceps'), ...colour('brachialis')]) {
      for (const fore of colour('grip')) expect(polygonGap(upper, fore)).toBeGreaterThanOrEqual(DEFINITION_GROOVE_FLOOR);
    }
    // A straight arm (the pushdown's lockout) keeps the full shape: the highlight's own §4.5 forearm.
    const pushdown = loaded('cable-triceps-pushdown').prepared;
    const lockout = keyFrameStops(pushdown).find((s) => /bottom|lockout/i.test(s.label));
    if (lockout === undefined) throw new Error('pushdown should have a lockout position');
    const straight = poseAt(pushdown, lockout.t).body;
    expect(definitionShapes(straight, ['forearm']).map((s) => s.contour)).toEqual([forearmRegion(straight)]);
  });

  it('polygonGap: 0 when overlapping or touching, the distance otherwise', () => {
    const sq = (x: number): Vec[] => [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 1 }, { x, y: 1 }];
    expect(polygonGap(sq(0), sq(0.5))).toBe(0);
    expect(polygonGap(sq(0), sq(1.25))).toBeCloseTo(0.25, 9);
    expect(polygonGap(sq(0), [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.3, y: 0.4 }])).toBe(0);
  });
});

describe('drawing (§4.11.6–4.11.7)', () => {
  it('D5: off (the default) draws exactly what it did before', () => {
    const { prepared, camera } = loaded('barbell-back-squat');
    const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark);
    for (const t of [0, 0.4]) {
      const base = { px: 240, style, camera, muscles: musclesOf('barbell-back-squat'), pulse: 0.5 };
      expect(renderSvg(poseAt(prepared, t), { ...base, definition: 'off' })).toBe(renderSvg(poseAt(prepared, t), base));
      expect(faintOps(ops('barbell-back-squat', t))).toEqual([]);
    }
  });

  it('D6: faint ops are gradient fills in the faint paint, never stroked; a translucent region over a faint shape gets a body-tone underlay of its own path', () => {
    let underlays = 0;
    for (const key of GUIDE_KEYS) {
      const frame = ops(key, 0.3, { definition: 'neutral', pulse: 0.2 });
      expect(faintOps(frame).length, key).toBeGreaterThan(0);
      // One gradient op per shape (shapes of one body group never overlap), lit end strongest, both ends fading out.
      for (const f of faintOps(frame)) {
        const stops = f.gradient?.stops ?? [];
        expect(f.stroke === null && f.fill === null && stops.every((st) => st.paint === 'faintNeutral'), key).toBe(true);
        expect(stops[0]?.opacity ?? 1, key).toBe(0);
        expect(stops[stops.length - 1]?.opacity ?? 1, key).toBe(0);
      }
      frame.forEach((o, i) => {
        const under = frame[i - 1];
        if (isPath(o) && o.fill === 'muscle' && under && isPath(under) && under.fill === 'nearBody' && under.contours === o.contours) underlays += 1;
      });
    }
    expect(underlays).toBeGreaterThan(0);
  });

  it('D6: one paint per pixel: coloured pixels are the same whether the faint shapes show or not (steady and at the pulse low)', { timeout: 60_000 }, () => {
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

  it('D6: the faint paints are pre-composited opaque colours from the live tokens', () => {
    const dark = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark);
    const light = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.light);
    // design-system §2.3, look D.
    expect([dark.faintNeutral, dark.faintTint, light.faintNeutral, light.faintTint]).toEqual(['#CBC4BC', '#AA9BB3', '#47413C', '#635869']);
  });

  it('D7: faint shapes never pulse; with tint, soft stays at 0.45 while strong still pulses', () => {
    const key = 'barbell-back-squat';
    const strip = (os: DrawOp[]) => faintOps(os).map((o) => [o.fill, o.opacity]);
    for (const t of [0.1, 0.7]) expect(strip(ops(key, t, { definition: 'neutral', pulse: 0 }))).toEqual(strip(ops(key, t, { definition: 'neutral', pulse: 1 })));
    // Trunk shapes never fade, so they're opacity 1 in every frame.
    for (const t of playbackTimes(loaded(key).prepared.guide)) for (const f of faintOps(ops(key, t, { definition: 'neutral' }))) expect(f.opacity).toBeLessThanOrEqual(1);
    const muscleOpacities = (o: Partial<FrameOpsOptions>, level: 'soft' | 'strong') =>
      new Set(ops(key, 0.6, o).filter(isPath).filter((x) => x.fill === 'muscle').map((x) => Math.round(x.opacity * 1000) / 1000).filter((x) => (level === 'strong' ? x >= 0.7 : x < 0.7)));
    expect(muscleOpacities({ definition: 'tint', pulse: 0 }, 'soft')).toEqual(new Set([0.45]));
    expect(muscleOpacities({ definition: 'tint', pulse: 0 }, 'strong')).toEqual(new Set([0.8]));
    expect(muscleOpacities({ definition: 'neutral', pulse: 0 }, 'soft')).toEqual(new Set([0.36]));
  });

  it('D8: tint draws as neutral under Increase Contrast or Differentiate Without Color; with no entry tint draws nothing and neutral every group', () => {
    const { prepared, camera } = loaded('cable-triceps-pushdown');
    const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.light);
    const pose = poseAt(prepared, 0.2);
    const base = { px: 240, style, camera, muscles: musclesOf('cable-triceps-pushdown') };
    for (const a11y of [{ increaseContrast: true }, { differentiateWithoutColor: true }]) {
      expect(renderSvg(pose, { ...base, ...a11y, definition: 'tint' })).toBe(renderSvg(pose, { ...base, ...a11y, definition: 'neutral' }));
    }
    expect(faintOps(frameOps(pose, { px: 240, camera, muscles: null, definition: 'tint' }))).toEqual([]);
    expect(faintOps(frameOps(pose, { px: 240, camera, muscles: { primary: [], secondary: [] }, definition: 'tint' }))).toEqual([]);
    const all = faintOps(frameOps(pose, { px: 240, camera, muscles: null, definition: 'neutral' }));
    expect(all.flatMap((o) => o.contours)).toHaveLength(definitionShapes(pose.body, definitionGroupsFor('side', null)).length);
  });

  it('D9: no faint shape on far side-view limbs; front and back views draw both sides whatever focus.side says', () => {
    for (const key of GUIDE_KEYS.filter((k) => loaded(k).guide.view === 'side')) {
      const body = poseAt(loaded(key).prepared, 0.3).body;
      expect(definitionShapes(body, DEFINITION_GROUPS).some((s) => s.group === 'legFar' || s.group === 'armFar'), key).toBe(false);
    }
    const { prepared } = loaded('cable-lat-pulldown');
    const pose = { ...poseAt(prepared, 0.2), focus: { ...(prepared.guide.focus ?? {}), side: 'near' as const } };
    const groups = new Set(definitionShapes(pose.body, ['triceps', 'forearm']).map((s) => s.group));
    expect(groups).toEqual(new Set(['armNear', 'armFar']));
  });

  it('D10: no definition at the S tier unless definitionCompact (review only)', () => {
    expect(faintOps(ops('cable-triceps-pushdown', 0.2, { px: 115, definition: 'neutral' }))).toEqual([]);
    expect(faintOps(ops('cable-triceps-pushdown', 0.2, { px: 115, definition: 'neutral', definitionCompact: true })).length).toBeGreaterThan(0);
  });

  it('D11: with definition on, no frame exceeds 220 ops, growth stays under 20, and no faint op is stroked', () => {
    for (const key of GUIDE_KEYS) {
      const { prepared, camera } = loaded(key);
      for (const t of playbackTimes(prepared.guide).filter((_, i) => i % 3 === 0)) {
        const muscles = musclesOf(key);
        const off = frameOps(poseAt(prepared, t), { px: 1, pt: 400, camera, muscles });
        for (const definition of ['neutral', 'tint'] as const) {
          const on = frameOps(poseAt(prepared, t), { px: 1, pt: 400, camera, muscles, definition });
          expect(on.length, key).toBeLessThanOrEqual(220);
          expect(on.length - off.length, key).toBeLessThan(20);
          for (const f of faintOps(on)) expect(f.stroke).toBeNull();
        }
      }
    }
  });

  it('SVG output with definition on uses only the guide paints', () => {
    const { prepared, camera } = loaded('cable-lat-pulldown');
    for (const scheme of ['dark', 'light'] as const) {
      const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme]);
      for (const definition of ['neutral', 'tint'] as const) {
        const svg = renderSvg(poseAt(prepared, 0.5), { px: 240, style, camera, muscles: musclesOf('cable-lat-pulldown'), definition });
        for (const c of new Set(svg.match(/#[0-9A-Fa-f]{6}/g))) expect(Object.values(style)).toContain(c);
        expect(svg).toContain(definition === 'neutral' ? style.faintNeutral : style.faintTint);
      }
    }
  });
});

describe('visual review of 9 Oct 2026: calmer shapes', () => {
  type Body = ReturnType<typeof poseAt>['body'];
  /** One soft region on its own, so its contour can be compared with a variant. */
  const one = (body: Body, spec: RegionSpec): Vec[] => {
    const focus: ResolvedFocus = { view: 'side', side: 'near', strong: [], soft: ['side_delts'], drawn: ['side_delts'], notShown: [], regions: [{ muscle: 'side_delts', level: 'soft', spec }] };
    const shape = regionShapes(body, focus)[0];
    if (shape === undefined) throw new Error('region should draw');
    return shape.contour;
  };
  /** Position along a segment's axis, 0 at j0 and 1 at j1. */
  const along = (seg: Body['segments'][number], p: Vec): number => ((p.x - seg.j0.x) * seg.u.x + (p.y - seg.j0.y) * seg.u.y) / seg.length;

  it('blunt0 / blunt1 parse; a duplicate is rejected and plain regions parse exactly as before', () => {
    expect(parseRegion('upperArm.face −0.02–0.32 c0 w0.9 blunt0')).toEqual({ kind: 'face', seg: 'upperArm', s: [-0.02, 0.32], c: [0, 0], w: [0.9, 0.9], mirror: false, blunt: [true, false] });
    expect(parseRegion('trunk.back 0.85–1.9 d0.42 blunt1')).toStrictEqual({ kind: 'edge', seg: 'trunk', surface: 'back', s: [0.85, 1.9], d: 0.42, blunt: [false, true] });
    expect(parseRegion('thigh.front 0–1 d0.5 blunt0 blunt1')).toMatchObject({ blunt: [true, true] });
    expect(parseRegion('thigh.front 0–1 d0.5 blunt0 blunt0')).toBeNull();
    expect(parseRegion('thigh.front 0–1 d0.5 blunt2')).toBeNull();
    expect(parseRegion('thorax.back 0.10–0.70 d0.5')).toStrictEqual({ kind: 'edge', seg: 'thorax', surface: 'back', s: [0.1, 0.7], d: 0.5 });
  });

  it('a blunt end is a rounded cap: more of the shape near that end, the same point at the other end', () => {
    const body = poseAt(loaded('cable-triceps-pushdown').prepared, 0).body;
    const arm = body.segments.find((sg) => sg.name === 'upperArm' && sg.side === 'Near');
    if (arm === undefined) throw new Error('near upper arm');
    for (const text of ['upperArm.face −0.02–0.32 c0 w0.9', 'upperArm.back 0.36–0.86 d0.74']) {
      const pointed = parseRegion(text);
      const blunt = parseRegion(`${text} blunt0`);
      if (pointed === null || blunt === null || pointed.kind === 'hand') throw new Error(text);
      const [s0, s1] = pointed.s;
      const mid = (s0 + s1) / 2;
      const p = one(body, pointed);
      const b = one(body, blunt);
      expect(Math.abs(signedArea(b)), text).toBeGreaterThan(Math.abs(signedArea(p)) * 1.04);
      // Both still start at s0, and the far half is untouched.
      expect(Math.min(...b.map((q) => along(arm, q))), text).toBeCloseTo(Math.min(...p.map((q) => along(arm, q))), 3);
      const farHalf = (c: Vec[]) => c.filter((q) => along(arm, q) > mid + 0.01);
      expect(farHalf(b), text).toEqual(farHalf(p));
    }
  });

  it('the faint deltoid starts at the joint with a rounded top, not up the shoulder cap', () => {
    for (const key of ['barbell-back-squat', 'barbell-romanian-deadlift', 'cable-triceps-pushdown']) {
      const body = poseAt(loaded(key).prepared, 0).body;
      const arm = body.segments.find((sg) => sg.name === 'upperArm' && sg.side === 'Near');
      const delt = definitionShapes(body, ['deltoid'])[0];
      if (arm === undefined || delt === undefined) throw new Error(key);
      expect(Math.min(...delt.contour.map((q) => along(arm, q))), key).toBeGreaterThan(-0.02 - 1e-6);
    }
    expect(DEFINITION_MAP.deltoid.side?.[0]).toMatchObject({ s: [-0.02, 0.32], blunt: [true, false] });
  });

  it('side view: abs and obliques fold into one band while both are faint, and only then', () => {
    expect(DEFINITION_FOLDS).toEqual([{ view: 'side', groups: ['abs', 'obliques'], region: parseRegion('trunk.front 0.3–2.35 d0.75') }]);
    const body = poseAt(loaded('barbell-bench-press').prepared, 0.549).body;
    const both = definitionShapes(body, ['abs', 'obliques']);
    expect(both.map((sh) => sh.definition)).toEqual(['abs']);
    // Either one alone (the other coloured or hidden) keeps its own shape.
    expect(definitionShapes(body, ['obliques']).map((sh) => sh.contour)).not.toEqual(both.map((sh) => sh.contour));
    expect(definitionShapes(body, ['abs']).map((sh) => sh.contour)).not.toEqual(both.map((sh) => sh.contour));
    // Front and back views don't fold.
    const pulldown = poseAt(loaded('cable-lat-pulldown').prepared, 0).body;
    expect(new Set(definitionShapes(pulldown, ['obliques', 'lowerBack']).map((sh) => sh.definition))).toEqual(new Set(['obliques', 'lowerBack']));
  });

  it('the split squat\'s abductors sit beside the glutes, not on top of them (no two-tone hip)', () => {
    const { prepared, guide } = loaded('dumbbell-bulgarian-split-squat');
    const focus = resolveFocus(musclesOf('dumbbell-bulgarian-split-squat'), guide.focus, 'side');
    for (const stop of keyFrameStops(prepared)) {
      const body = poseAt(prepared, stop.t).body;
      const regions = regionShapes(body, focus);
      const glutes = regionShapes(body, { ...focus, regions: focus.regions.filter((r) => r.muscle === 'glutes') });
      const abductors = regionShapes(body, { ...focus, regions: focus.regions.filter((r) => r.muscle === 'abductors') });
      expect(regions.length).toBeGreaterThan(glutes.length + abductors.length - 1);
      for (const a of abductors) for (const g of glutes) expect(polygonGap(a.contour, g.contour), stop.label).toBeGreaterThan(0);
    }
  });

  it('strong over soft gets its underlay in every mode, so one pixel never shows two violets during the pulse (§4.3)', () => {
    // Bench: chest strong overlaps upper chest soft.
    for (const definition of ['off', 'neutral'] as const) {
      const frame = ops('barbell-bench-press', 0.5, { muscles: { primary: ['chest'], secondary: ['upper_chest'] }, definition, pulse: 0 });
      const strong = frame.findIndex((o) => isPath(o) && o.fill === 'muscle' && Math.abs(o.opacity - 0.8) < 1e-9);
      const under = frame[strong - 1];
      expect(strong, definition).toBeGreaterThan(0);
      expect(under && isPath(under) && under.fill === 'nearBody' && under.contours === (frame[strong] as PathOp).contours, definition).toBe(true);
    }
  });
});

describe('effective mode and legend (§4.11.8–4.11.9)', () => {
  it('effectiveDefinition holds every fallback rule', () => {
    const full = { tier: 'full' as const, hasMuscles: true };
    const cases: [MuscleDefinition, Parameters<typeof effectiveDefinition>[1], MuscleDefinition][] = [
      ['off', full, 'off'],
      ['neutral', full, 'neutral'],
      ['tint', full, 'tint'],
      ['neutral', { ...full, tier: 'compact' }, 'off'],
      ['tint', { ...full, tier: 'compact', definitionCompact: true }, 'tint'],
      ['tint', { ...full, increaseContrast: true }, 'neutral'],
      ['tint', { ...full, differentiateWithoutColor: true }, 'neutral'],
      ['tint', { ...full, hasMuscles: false }, 'off'],
      ['neutral', { ...full, hasMuscles: false }, 'neutral'],
    ];
    for (const [mode, ctx, want] of cases) expect(effectiveDefinition(mode, ctx), `${mode} ${JSON.stringify(ctx)}`).toBe(want);
    expect(hasListedMuscles(null)).toBe(false);
    expect(hasListedMuscles({ primary: ['heart'], secondary: [] })).toBe(false);
    expect(hasListedMuscles({ primary: [], secondary: ['calves'] })).toBe(true);
    expect(DEFAULT_MUSCLE_DEFINITION).toBe('neutral');
  });

  it('tint adds one line after Also works and before Not shown, with no swatch; neutral leaves the legend alone (D12)', () => {
    const e = catalogue.entry('barbell-back-squat');
    if (!e.ok) throw new Error('entry');
    const focus = muscleFocusFor(e.entry, loaded('barbell-back-squat').guide);
    expect(muscleLegend(focus, { definition: 'neutral' })).toEqual(muscleLegend(focus));
    const tint = muscleLegend(focus, { definition: 'tint' });
    expect(tint.map((l) => l.kind)).toEqual(['most', 'also', 'definition', 'notShown']);
    expect(tint[2]).toEqual({ kind: 'definition', label: 'Faint violet:', list: 'other muscles, for reference', swatch: false, accessibilityLabel: 'Faint violet: other muscles, for reference.' });
    // No guide: nothing is drawn, so no line.
    expect(muscleLegend(muscleFocusFor(e.entry, null), { definition: 'tint' }).some((l) => l.kind === 'definition')).toBe(false);
  });

  it('D13: the copy never calls faint groups inactive, unused, resting or a little', () => {
    const copy = `${DEFINITION_TINT_LEGEND.label} ${DEFINITION_TINT_LEGEND.list}`;
    for (const word of ['inactive', 'not used', 'unused', 'resting', 'a little', '%']) expect(copy.toLowerCase()).not.toContain(word);
  });
});
