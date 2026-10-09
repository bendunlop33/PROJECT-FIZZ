/**
 * Guides v2 (exercise-guides-v2.md): contoured figure, smooth paths, detail
 * tiers, muscle focus, shading, work-phase emphasis and the focus checks.
 */
import { describe, expect, it } from 'vitest';

import { formatMuscleList, muscleFocusFor, muscleLegend, musclePlainLabel, muscleShortLabel, spokenMuscleList } from '../src/muscles';
import { bundledGuides } from '../src/guide-library';
import { lazyBundledCatalogue } from '../src/loader';
import { MUSCLES, type Muscle } from '../src/vocab';
import {
  ADULT_V1_PROFILES,
  catmullRom,
  checkGuide,
  DIRECTION_D_GUIDE_TOKENS,
  focusViewOf,
  frameOps,
  groupContours,
  guideStyleFromTokens,
  MUSCLE_INSET,
  MUSCLE_REGION_MAP,
  MUSCLE_REGION_TEXT,
  muscleOpacity,
  parseRegion,
  pathData,
  playbackTimes,
  pointInPolygon,
  pointSegmentDistance,
  poseAt,
  profileAt,
  regionShapes,
  renderSvg,
  resolveFocus,
  sampleTimes,
  shadeBands,
  STROKE_FLOORS_PT,
  workIntensityAt,
  type DrawOp,
  type Vec,
} from '../src/figure/index';
import type { CatalogueEntry } from '../src/entry-schema';
import { squatEntry, squatRaw } from './figure-helpers';

const catalogue = lazyBundledCatalogue();
const library = bundledGuides();
const GUIDE_KEYS = [...library.keys].sort();

function loaded(key: string) {
  const g = library.load(key);
  if (!g.ok) throw new Error(`${key} should load`);
  return g.value;
}
function entry(key: string): CatalogueEntry {
  const e = catalogue.entry(key);
  if (!e.ok) throw new Error(`${key} entry should load`);
  return e.entry;
}
const musclesOf = (key: string) => ({ primary: entry(key).primaryMuscles, secondary: entry(key).secondaryMuscles });

describe('profiles and smooth paths', () => {
  it('profiles pass through every station without overshooting between them', () => {
    for (const view of ['side', 'frontBack'] as const) {
      for (const [name, profile] of Object.entries(ADULT_V1_PROFILES[view])) {
        profile.forEach((st, i) => {
          expect(profileAt(profile, st.s).front, `${view} ${name}`).toBeCloseTo(st.front, 9);
          const next = profile[i + 1];
          if (next === undefined) return;
          for (let k = 1; k < 10; k += 1) {
            const w = profileAt(profile, st.s + ((next.s - st.s) * k) / 10);
            expect(w.front).toBeGreaterThanOrEqual(Math.min(st.front, next.front) - 1e-12);
            expect(w.front).toBeLessThanOrEqual(Math.max(st.front, next.front) + 1e-12);
            expect(w.back).toBeGreaterThanOrEqual(Math.min(st.back, next.back) - 1e-12);
          }
        });
      }
    }
  });

  it('Catmull-Rom spans run through every point and become SVG cubics', () => {
    const pts: Vec[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const curve = catmullRom(pts, true);
    expect(curve?.spans.map((s) => s.to)).toEqual([pts[1], pts[2], pts[3], pts[0]]);
    const d = pathData([pts], true, true, 2);
    expect(d.startsWith('M0 0C')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(4);
    // Two contours are two subpaths of one path (they fill as one shape).
    expect((pathData([pts, pts], true, false).match(/M/g) ?? []).length).toBe(2);
  });
});

describe('figure drawing v2', () => {
  it('keeps the rig: joints are where v1 put them, the shoe sits on the floor', () => {
    const pose = poseAt(loaded('barbell-back-squat').prepared, 0);
    const foot = pose.body.feet.find((f) => f.side === 'Near');
    expect(foot).toBeDefined();
    const shoe = groupContours(pose.body, 'legNear')[2] ?? [];
    expect(Math.min(...shoe.map((q) => q.y))).toBeCloseTo(0, 3);
    expect(pose.body.head.rx).toBeCloseTo(0.056, 6);
    expect(pose.body.head.ry).toBeCloseTo(0.063, 6);
    // One trunk contour from pelvis to thorax (plus neck and head).
    expect(groupContours(pose.body, 'trunk')).toHaveLength(3);
  });

  it('far limbs are 0.96 as wide, drawn flat with no muscle colour', () => {
    const { prepared } = loaded('barbell-back-squat');
    const pose = poseAt(prepared, 0.3);
    const thigh = (side: 'Near' | 'Far') => pose.body.segments.find((s) => s.name === 'thigh' && s.side === side);
    expect(thigh('Far')?.widthScale).toBe(0.96);
    expect(thigh('Near')?.widthScale).toBe(1);
    const regions = regionShapes(pose.body, resolveFocus(musclesOf('barbell-back-squat'), undefined, 'side'));
    expect(regions.some((r) => r.group === 'legFar' || r.group === 'armFar')).toBe(false);
    expect(regions.some((r) => r.group === 'legNear')).toBe(true);
  });

  it('M/L tier: contour under the fill, shading gradients and anatomical lines; S tier: v1 halos, none of those', () => {
    const { prepared, camera } = loaded('barbell-back-squat');
    const pose = poseAt(prepared, 0.4);
    const full = frameOps(pose, { px: 240, camera, muscles: musclesOf('barbell-back-squat') });
    const compact = frameOps(pose, { px: 115, camera, muscles: musclesOf('barbell-back-squat') });
    const isPath = (o: DrawOp): o is Extract<DrawOp, { kind: 'path' }> => o.kind === 'path';
    expect(full.filter(isPath).some((o) => o.gradient !== null)).toBe(true);
    expect(full.filter(isPath).some((o) => o.stroke === 'shade' && !o.closed)).toBe(true);
    expect(compact.filter(isPath).some((o) => o.gradient !== null || o.stroke === 'shade')).toBe(false);
    // S keeps the halo right before each near limb; M/L puts near halos before the trunk fill.
    const haloIdx = (ops: DrawOp[]) => ops.map((o, i) => (isPath(o) && o.fill === 'background' && o.stroke === 'background' ? i : -1)).filter((i) => i >= 0);
    const trunkFill = (ops: DrawOp[]) => ops.findIndex((o) => isPath(o) && o.fill === 'nearBody');
    expect(haloIdx(full).filter((i) => i > trunkFill(full))).toEqual([]);
    expect(haloIdx(compact).filter((i) => i > trunkFill(compact)).length).toBe(2);
    // Both tiers carry the muscle colour (§3.10).
    expect(compact.some((o) => isPath(o) && o.fill === 'muscle')).toBe(true);
    // shading: false drops only the gradients.
    expect(frameOps(pose, { px: 240, camera, shading: false }).filter(isPath).some((o) => o.gradient !== null)).toBe(false);
  });

  it('trunk shading is one band per edge, and every band fades out at its ends (no step at a joint)', () => {
    for (const [key, t] of [['barbell-romanian-deadlift', 0.5], ['cable-lat-pulldown', 0.3]] as const) {
      const body = poseAt(loaded(key).prepared, t).body;
      expect(shadeBands(body, 'trunk').length, key).toBeLessThanOrEqual(2);
      for (const g of ['trunk', 'legNear', 'armNear'] as const) {
        for (const b of shadeBands(body, g)) {
          const n = b.contour.length / 2;
          // Edge points run out, inner points run back: the band's first and last inner points sit on the edge.
          const gap = (i: number, j: number): number => Math.hypot((b.contour[i]?.x ?? 0) - (b.contour[j]?.x ?? 0), (b.contour[i]?.y ?? 0) - (b.contour[j]?.y ?? 0));
          expect(gap(0, 2 * n - 1), `${key} ${g}`).toBeLessThan(1e-9);
          expect(gap(n - 1, n), `${key} ${g}`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('strokes never fall under the tier floors in points', () => {
    const { prepared, camera } = loaded('barbell-back-squat');
    for (const [pt, tier] of [[115, 'compact'], [240, 'full'], [400, 'full']] as const) {
      const ops = frameOps(poseAt(prepared, 0.2), { px: pt * 3, pt, camera });
      const minHair = STROKE_FLOORS_PT[tier].hair * 3;
      for (const o of ops) {
        if (o.kind === 'line' || (o.kind === 'path' && o.stroke !== null)) expect(o.width, `${String(pt)} ${o.kind}`).toBeGreaterThanOrEqual(minHair - 1e-9);
      }
    }
  });

  it('no frame of any guide exceeds 220 draw ops at the M/L tier (§12.1 #11)', () => {
    for (const key of GUIDE_KEYS) {
      const { prepared, camera } = loaded(key);
      const e = catalogue.entry(key);
      const muscles = e.ok ? { primary: e.entry.primaryMuscles, secondary: e.entry.secondaryMuscles } : null;
      for (const t of playbackTimes(prepared.guide).filter((_, i) => i % 3 === 0)) {
        expect(frameOps(poseAt(prepared, t), { px: 1, pt: 400, camera, muscles }).length, key).toBeLessThanOrEqual(220);
      }
    }
  });

  it('SVG output: gradients are defined per op, paths are cubic, only guide colours appear', () => {
    const { prepared, camera } = loaded('barbell-back-squat');
    for (const scheme of ['dark', 'light'] as const) {
      const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS[scheme]);
      const svg = renderSvg(poseAt(prepared, 0.5), { px: 240, style, camera, muscles: musclesOf('barbell-back-squat') });
      expect(svg).toContain('<linearGradient');
      expect(svg).toMatch(/d="M[^"]*C/);
      const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g));
      for (const c of colours) expect(Object.values(style)).toContain(c);
      expect(colours.has(style.muscle)).toBe(true);
      expect(style.muscle).toBe(scheme === 'dark' ? '#7A4AF0' : '#9B7BF7');
    }
  });
});

describe('muscle region map (§4.5)', () => {
  it('has a row for every vocabulary muscle in side, front and back views, and every cell parses (§12.1 #1)', () => {
    expect(Object.keys(MUSCLE_REGION_MAP).sort()).toEqual([...MUSCLES].sort());
    for (const m of MUSCLES) {
      for (const view of ['side', 'front', 'back'] as const) {
        const text = MUSCLE_REGION_TEXT[m][view];
        const parsed = MUSCLE_REGION_MAP[m][view];
        expect(parsed === null, `${m} ${view}`).toBe(text === null);
        expect(parsed?.length ?? 0, `${m} ${view}`).toBe(text?.length ?? 0);
      }
    }
  });

  it('parses the notation and rejects nonsense', () => {
    expect(parseRegion('thorax.back 0.10–0.70 d0.5')).toEqual({ kind: 'edge', seg: 'thorax', surface: 'back', s: [0.1, 0.7], d: 0.5 });
    expect(parseRegion('thorax.face 0.50–0.88 ±c0.45 w0.55')).toEqual({ kind: 'face', seg: 'thorax', s: [0.5, 0.88], c: [0.45, 0.45], w: [0.55, 0.55], mirror: true });
    expect(parseRegion('upperArm.front −0.10–0.35 d0.7')).toMatchObject({ s: [-0.1, 0.35] });
    expect(parseRegion('hand.full')).toEqual({ kind: 'hand' });
    for (const bad of ['', 'head.front 0–1 d0.5', 'thigh.front 0.5–0.2 d0.5', 'thigh.front 0–1', 'thigh.face 0–1 d0.5', 'thigh.front 0–1 d0.5 junk']) expect(parseRegion(bad), bad).toBeNull();
    // `trunk` is the pelvis–lumbar–thorax chain as one segment: s runs to 3 there, to 1.5 on a single segment.
    expect(parseRegion('trunk.front 0.3–2.35 d0.45')).toEqual({ kind: 'edge', seg: 'trunk', surface: 'front', s: [0.3, 2.35], d: 0.45 });
    // `cA>B` moves the lens centre along its length (a lat sweeping from the waist out to the armpit).
    expect(parseRegion('trunk.face 1.3–2.88 ±c0.3>0.6 w0.25>0.5')).toMatchObject({ seg: 'trunk', mirror: true, c: [0.3, 0.6], w: [0.25, 0.5] });
    expect(parseRegion('trunk.face 1.3–2.88 c0.3>1.2 w0.5')).toBeNull();
    expect(parseRegion('thigh.front 0–2 d0.5')).toBeNull();
    expect(parseRegion('trunk.front 0–3.2 d0.5')).toBeNull();
  });

  it('a muscle that spans the trunk is one calm shape, not a bead per segment (review of 9 Oct 2026)', () => {
    const body = poseAt(loaded('barbell-back-squat').prepared, 0.3).body;
    for (const m of ['abs', 'obliques', 'core', 'spinal_erectors', 'lats', 'traps'] as const) {
      expect(regionShapes(body, resolveFocus({ primary: [], secondary: [m] }, undefined, 'side')), m).toHaveLength(1);
    }
    // Behind: one strap or wing each side.
    const pulldown = poseAt(loaded('cable-lat-pulldown').prepared, 0).body;
    for (const m of ['lats', 'spinal_erectors'] as const) {
      expect(regionShapes(pulldown, resolveFocus({ primary: [m], secondary: [] }, undefined, 'back')), m).toHaveLength(2);
    }
  });
});

describe('muscle focus (§4)', () => {
  /** §4.5 coverage table. */
  const NOT_SHOWN: Record<string, Muscle[]> = {
    'barbell-back-squat': ['adductors'],
    'barbell-romanian-deadlift': ['adductors'],
    'machine-leg-press': ['adductors'],
    // The hanging arm covers the front of the trunk, so the guide hides core (focus.hide) rather than draw slivers either side of it.
    'dumbbell-bulgarian-split-squat': ['adductors', 'core'],
    // Seen from behind (B3, provisional): the arm flexors face away from the camera.
    'cable-lat-pulldown': ['biceps', 'brachialis'],
    'barbell-bench-press': [],
    'barbell-overhead-press': [],
    'dumbbell-one-arm-row': [],
    'cable-triceps-pushdown': [],
    'sled-push': [],
  };

  it.each(Object.keys(NOT_SHOWN))('%s: strong = primary, soft = secondary (hidden ones included), Not shown per the coverage table (§12.1 #2)', (key) => {
    const e = entry(key);
    const g = loaded(key).guide;
    const f = muscleFocusFor(e, g);
    expect(f.strong).toEqual(e.primaryMuscles);
    expect(f.soft).toEqual(e.secondaryMuscles);
    expect(f.notShown).toEqual(NOT_SHOWN[key]);
    for (const m of g.focus?.hide ?? []) expect(f.notShown).toContain(m);
    expect([...f.drawn, ...f.notShown].sort()).toEqual([...e.primaryMuscles, ...e.secondaryMuscles].sort());
  });

  it('grip is drawn soft even when primary; a hidden muscle stays in its list and is also Not shown; overrides never add an unlisted muscle', () => {
    const r = resolveFocus({ primary: ['grip', 'quads'], secondary: ['glutes'] }, { hide: ['glutes'], add: [{ muscle: 'lats', region: 'thorax.back 0.1–0.7 d0.5' }] }, 'side');
    expect(r.regions.filter((x) => x.muscle === 'grip').every((x) => x.level === 'soft')).toBe(true);
    expect(r.regions.filter((x) => x.muscle === 'quads').every((x) => x.level === 'strong')).toBe(true);
    expect(r.strong).toEqual(['grip', 'quads']);
    expect(r.soft).toEqual(['glutes']);
    expect(r.drawn).toEqual(['grip', 'quads']);
    expect(r.notShown).toEqual(['glutes']);
    expect(r.regions.some((x) => x.muscle === 'lats' || x.muscle === 'glutes')).toBe(false);
    // Unknown names from a caller are ignored, not drawn.
    expect(resolveFocus({ primary: ['quads', 'heart'], secondary: [] }, undefined, 'side').strong).toEqual(['quads']);
  });

  it('the split squat colours only the near (front) leg, thigh and shank, and the trunk (§12.1 #7)', () => {
    const { prepared } = loaded('dumbbell-bulgarian-split-squat');
    const focus = resolveFocus(musclesOf('dumbbell-bulgarian-split-squat'), prepared.guide.focus, 'side');
    for (const t of sampleTimes(prepared.guide, prepared.keys, 10)) {
      const groups = new Set(regionShapes(poseAt(prepared, t).body, focus).map((r) => r.group));
      expect(groups.has('legFar')).toBe(false);
      expect(groups.has('armFar')).toBe(false);
      expect(groups.has('legNear')).toBe(true);
    }
  });

  it('regions lie inside the silhouette at every frame of every guide (§12.1 #6)', () => {
    const inside = (p: Vec, polys: readonly (readonly Vec[])[]): boolean =>
      polys.some((poly) => pointInPolygon(p, poly)) ||
      polys.some((poly) => poly.some((a, i) => pointSegmentDistance(p, a, poly[(i + 1) % poly.length] ?? a) < MUSCLE_INSET * 0.5));
    for (const key of GUIDE_KEYS) {
      const { prepared } = loaded(key);
      const focus = resolveFocus({ primary: [...MUSCLES], secondary: [] }, undefined, focusViewOf(prepared.guide));
      for (const t of sampleTimes(prepared.guide, prepared.keys, 10)) {
        const body = poseAt(prepared, t).body;
        for (const r of regionShapes(body, focus)) {
          const polys = groupContours(body, r.group === 'pelvis' ? 'trunk' : r.group);
          for (const p of r.contour) expect(inside(p, polys), `${key} t=${t.toFixed(3)} ${r.group}`).toBe(true);
        }
      }
    }
  });

  it('steady colour unless a pulse is given; Increase Contrast is always steady (§12.1 #8)', () => {
    expect(muscleOpacity('strong', {})).toBe(1);
    expect(muscleOpacity('soft', {})).toBe(0.45);
    expect(muscleOpacity('soft', { increaseContrast: true, pulse: 0 })).toBe(0.6);
    expect(muscleOpacity('strong', { pulse: 0 })).toBeCloseTo(0.8, 9);
    expect(muscleOpacity('strong', { pulse: 1 })).toBeCloseTo(1, 9);
    expect(muscleOpacity('soft', { pulse: 1 })).toBeCloseTo(0.5, 9);
    const { prepared, camera } = loaded('barbell-back-squat');
    const opacities = new Set<number>();
    for (const t of [0, 0.3, 0.7, 0.9]) {
      for (const o of frameOps(poseAt(prepared, t), { px: 240, camera, muscles: musclesOf('barbell-back-squat') })) if (o.kind === 'path' && o.fill === 'muscle') opacities.add(o.opacity);
    }
    expect([...opacities].sort()).toEqual([0.45, 1]);
  });

  it('work-phase emphasis ramps over 120 ms of guide time, 0 outside, null without a phase (§4.9)', () => {
    const squat = loaded('barbell-back-squat').prepared;
    const [phase] = squat.guide.focus?.workPhase ?? [];
    if (!phase) throw new Error('squat should have a work phase');
    const ramp = 120 / squat.guide.durationMs;
    expect(workIntensityAt(squat, phase.from - 0.01)).toBe(0);
    expect(workIntensityAt(squat, phase.from)).toBe(0);
    expect(workIntensityAt(squat, phase.from + ramp / 2)).toBeCloseTo(0.5, 6);
    expect(workIntensityAt(squat, (phase.from + phase.to) / 2)).toBe(1);
    expect(workIntensityAt(squat, phase.to)).toBe(0);
    expect(workIntensityAt(loaded('sled-push').prepared, 0.3)).toBeNull();
    // Continuous: no jump bigger than one 30 fps frame of smoothstep allows.
    const ts = playbackTimes(squat.guide);
    for (let i = 1; i < ts.length; i += 1) expect(Math.abs((workIntensityAt(squat, ts[i] ?? 0) ?? 0) - (workIntensityAt(squat, ts[i - 1] ?? 0) ?? 0))).toBeLessThan(0.7);
  });
});

describe('legend text (§5.3)', () => {
  it('plain names first, gym term in brackets, shared phrases merged, first item capitalised', () => {
    expect(musclePlainLabel('quads')).toBe('front of thighs (quads)');
    expect(musclePlainLabel('glutes')).toBe('glutes');
    expect(muscleShortLabel('adductors')).toBe('inner thighs');
    expect(formatMuscleList(['quads', 'glutes'])).toBe('Front of thighs (quads), glutes');
    expect(formatMuscleList(['upper_back', 'biceps', 'brachialis', 'rear_delts'])).toBe('Upper back, front of upper arms (biceps, brachialis), back of shoulders (rear delts)');
    expect(formatMuscleList(['biceps', 'brachialis'], { short: true })).toBe('Front of upper arms');
    expect(spokenMuscleList(['quads', 'glutes'])).toBe('front of thighs, quads, and glutes');
  });

  it('squat and pulldown legends', () => {
    const squat = muscleLegend(muscleFocusFor(entry('barbell-back-squat'), loaded('barbell-back-squat').guide));
    expect(squat.map((l) => `${l.label} ${l.list}`)).toEqual([
      'Feel it most: Front of thighs (quads), glutes',
      'Also works: Inner thighs (adductors), back of thighs (hamstrings), lower back (spinal erectors), core',
      'Not shown from this side: inner thighs',
    ]);
    expect(squat.map((l) => l.swatch)).toEqual([true, true, false]);
    expect(squat[0]?.accessibilityLabel).toBe('Feel it most: front of thighs, quads, and glutes.');
    const pulldown = muscleLegend(muscleFocusFor(entry('cable-lat-pulldown'), loaded('cable-lat-pulldown').guide));
    expect(pulldown[2]).toMatchObject({ label: 'Not shown from behind:', list: 'front of upper arms' });
    // The split-squat guide hides core (focus.hide): it stays under Also works and is named under Not shown too (§4.7).
    const split = muscleLegend(muscleFocusFor(entry('dumbbell-bulgarian-split-squat'), loaded('dumbbell-bulgarian-split-squat').guide));
    expect(split.map((l) => `${l.label} ${l.list}`)).toEqual([
      'Feel it most: Front of thighs (quads), glutes',
      'Also works: Inner thighs (adductors), back of thighs (hamstrings), outer hips (abductors), core, grip',
      'Not shown from this side: inner thighs, core',
    ]);
    expect(split.map((l) => l.swatch)).toEqual([true, true, false]);
    expect(split[1]?.accessibilityLabel).toBe('Also works: inner thighs, adductors, back of thighs, hamstrings, outer hips, abductors, core, and grip.');
    // No guide: the lines without swatches, and no Not shown line.
    const noGuide = muscleLegend(muscleFocusFor(entry('barbell-back-squat'), null));
    expect(noGuide.map((l) => [l.kind, l.swatch])).toEqual([
      ['most', false],
      ['also', false],
    ]);
  });

  it('a hidden secondary muscle keeps its Also works line; the swatch shows only if a muscle on the line is drawn (§4.7)', () => {
    const e = { primaryMuscles: ['quads'] as Muscle[], secondaryMuscles: ['core'] as Muscle[] };
    const legend = muscleLegend(muscleFocusFor(e, { view: 'side', focus: { hide: ['core'] } }));
    expect(legend.map((l) => [l.kind, l.list, l.swatch])).toEqual([
      ['most', 'Front of thighs (quads)', true],
      ['also', 'Core', false],
      ['notShown', 'core', false],
    ]);
    // Hiding the only primary as well: both lines stay, neither has a swatch.
    const allHidden = muscleLegend(muscleFocusFor(e, { view: 'side', focus: { hide: ['quads', 'core'] } }));
    expect(allHidden.map((l) => [l.kind, l.list, l.swatch])).toEqual([
      ['most', 'Front of thighs (quads)', false],
      ['also', 'Core', false],
      ['notShown', 'front of thighs, core', false],
    ]);
  });
});

describe('guide:check focus (§4.8)', () => {
  const run = (focus: unknown) => {
    const raw = { ...squatRaw(), focus };
    return checkGuide({ raw, bytes: 2000, dirKey: 'barbell-back-squat', entry: squatEntry() }).items.find((i) => i.id === 'focus');
  };

  it('accepts overrides on listed muscles and prints the focus table', () => {
    expect(run({ hide: ['adductors'], adjust: { glutes: { s: [-0.6, 0.6] } } })).toMatchObject({ ok: true });
    expect(run(undefined)?.detail).toContain('adductors soft (not shown)');
  });

  it('fails hide/adjust/add naming a muscle the entry does not list (§12.1 #3), big adjusts and bad regions', () => {
    expect(run({ hide: ['lats'] })?.ok).toBe(false);
    expect(run({ add: [{ muscle: 'chest', region: 'thorax.front 0.4–0.8 d0.5' }] })?.ok).toBe(false);
    expect(run({ adjust: { lats: { d: 0.5 } } })?.ok).toBe(false);
    expect(run({ adjust: { glutes: { s: [-0.2, 0.75] } } })?.ok).toBe(false);
    expect(run({ add: [{ muscle: 'quads', region: 'thigh.sideways 0–1 d0.5' }] })?.ok).toBe(false);
  });

  it('rejects seenFrom on a side view, and overlapping work phases', () => {
    const items = (extra: Record<string, unknown>) => checkGuide({ raw: { ...squatRaw(), ...extra }, bytes: 2000, dirKey: 'barbell-back-squat', entry: squatEntry() }).items;
    expect(items({ seenFrom: 'back' })[0]?.ok).toBe(false);
    expect(items({ focus: { workPhase: [{ from: 0.2, to: 0.6 }, { from: 0.5, to: 0.9 }] } })[0]?.ok).toBe(false);
    expect(items({ focus: { workPhase: [{ from: 0.6, to: 0.2 }] } })[0]?.ok).toBe(false);
  });
});
