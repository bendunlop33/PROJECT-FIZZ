/**
 * Guide motion and drawing, round 3 (ADR 0017 E7 and the review of 10 Oct
 * 2026): the leg drive (shin and knee as channels, hip by forward kinematics),
 * the re-posed squat, sled push, bench, row and leg press, and the drawing
 * fixes (thin S-tier arm edge, tapered occlusion strokes, kneecap fade, no
 * waist line, hip fillet, supporting tints, target legibility).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  anatomyLines,
  checkGuide,
  COMPACT_ARM_EDGE_PT,
  convexHull,
  driverFlexion,
  driverShin,
  drivePlan,
  drivenStateAt,
  fitCamera,
  flattenState,
  frameOps,
  groupContours,
  GuideSchema,
  hipFillet,
  hipFromLeg,
  kneecapFade,
  measureMotion,
  nearShinAndKnee,
  poseAt,
  prepareGuide,
  regionShapes,
  resolveFocus,
  signedArea,
  stateAt,
  SUPPORT_DETAIL_MIN_PT,
  taperedPieces,
  type DrawOp,
  type Guide,
  type MuscleInput,
} from '../src/figure/index';
import type { CatalogueEntry } from '../src/entry-schema';
import { lazyBundledCatalogue } from '../src/loader';

const GUIDES = join(import.meta.dirname, '..', 'guides');
const rawOf = (id: string): Record<string, unknown> => JSON.parse(readFileSync(join(GUIDES, id, 'guide.json'), 'utf8')) as Record<string, unknown>;
const committed = (id: string): Guide => GuideSchema.parse(rawOf(id));
const catalogue = lazyBundledCatalogue();
function entryOf(id: string): CatalogueEntry {
  const e = catalogue.entry(id);
  if (!e.ok) throw new Error(`${id} entry should load`);
  return e.entry;
}
const musclesOf = (id: string): MuscleInput => ({ primary: entryOf(id).primaryMuscles, secondary: entryOf(id).secondaryMuscles });
const LEG = { joint: 'legNear', solves: 'root.xy' } as const;
const isPath = (o: DrawOp): o is Extract<DrawOp, { kind: 'path' }> => o.kind === 'path';

/** Phases of a stop-to-stop guide in normalised time (descent, ascent). */
function phaseTimes(p: ReturnType<typeof prepareGuide>, n: number): number[][] {
  const stops = p.keys.filter((k) => !k.pass);
  const out: number[][] = [];
  for (let j = 0; j + 1 < stops.length; j += 1) {
    const a = stops[j]?.holdEnd ?? 0;
    const b = stops[j + 1]?.t ?? 1;
    out.push(Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n));
  }
  return out;
}

/** Largest backtrack of a series against its overall direction. */
function reversal(xs: readonly number[]): number {
  const up = (xs[xs.length - 1] ?? 0) >= (xs[0] ?? 0);
  let worst = 0;
  let best = xs[0] ?? 0;
  for (const x of xs) {
    best = up ? Math.max(best, x) : Math.min(best, x);
    worst = Math.max(worst, up ? best - x : x - best);
  }
  return worst;
}

describe('leg drive (E7)', () => {
  it('schema: legNear solves root.xy on a planted-leg phases side view; other pairings are rejected', () => {
    const ok = (drive: unknown, extra: Record<string, unknown> = {}): boolean =>
      GuideSchema.safeParse({ ...rawOf('barbell-back-squat'), drive, ...extra }).success;
    expect(ok(LEG)).toBe(true);
    expect(ok({ joint: 'legNear', solves: 'root.y' })).toBe(false);
    expect(ok({ joint: 'kneeNear', solves: 'root.xy' })).toBe(false);
    expect(ok(LEG, { motion: 'channels' })).toBe(false);
    expect(committed('barbell-back-squat').drive).toEqual(LEG);
  });

  it('key poses are exact; between keys the shin and knee are exactly the driver splines, and the hip is their forward kinematics', () => {
    const p = prepareGuide(committed('barbell-back-squat'));
    for (const k of p.keys) expect([...flattenState(drivenStateAt(p, k.t))], `key ${k.index}`).toStrictEqual([...flattenState(k.state)]);
    const plan = drivePlan(p.guide, p.keys);
    expect(plan?.joint).toBe('legNear');
    for (let i = 1; i < 300; i += 1) {
      const t = i / 300;
      const ph = plan?.phases.find((q) => t > q.span.A && t < q.span.B);
      const s = drivenStateAt(p, t);
      const plain = flattenState(stateAt(p.guide, p.keys, t));
      // Only the hip moves off its own spline.
      for (const [name, x] of flattenState(s)) if (name !== 'root.x' && name !== 'root.y') expect(x, `${name} t=${t}`).toBe(plain.get(name));
      if (ph === undefined || p.keys.some((k) => k.t === t)) continue;
      const sk = nearShinAndKnee(s);
      expect(sk?.phi).toBeCloseTo(driverShin(ph, t), 6);
      expect(sk?.theta).toBeCloseTo(driverFlexion(ph, t), 6);
      const hip = hipFromLeg(s, driverShin(ph, t), driverFlexion(ph, t));
      expect(hip?.x).toBeCloseTo(s.root.x, 12);
      expect(hip?.y).toBeCloseTo(s.root.y, 12);
    }
  });

  it('the planted foot never moves and the seam is seamless', () => {
    const p = prepareGuide(committed('barbell-back-squat'));
    const a0 = poseAt(p, 0).feet.map((f) => f.ankle);
    for (let i = 0; i <= 300; i += 1) {
      poseAt(p, i / 300).feet.forEach((f, j) => {
        expect(f.ankle.x).toBeCloseTo(a0[j]?.x ?? NaN, 9);
        expect(f.ankle.y).toBeCloseTo(a0[j]?.y ?? NaN, 9);
      });
    }
    const r = measureMotion(p, { n: 600 });
    expect(r.metrics.find((m) => m.id === 'C6')?.ok).toBe(true);
    expect(r.metrics.find((m) => m.id === 'D2')?.ok).toBe(true);
  });
});

describe('squat: one seamless motion (review of 10 Oct 2026, problems 1–3, 6)', () => {
  const p = prepareGuide(committed('barbell-back-squat'));
  const phases = phaseTimes(p, 600);

  it('the shin and knee never stall or turn back mid-phase, and the knee point keeps moving', () => {
    for (const ts of phases) {
      const poses = ts.map((t) => poseAt(p, t));
      expect(reversal(poses.map((q) => q.angles.ankleNear ?? 0))).toBeLessThanOrEqual(0.1);
      expect(reversal(poses.map((q) => q.angles.kneeNear ?? 0))).toBeLessThanOrEqual(0.1);
      // The knee travels one way only (forward going down, back coming up).
      expect(reversal(poses.map((q) => q.points.kneeNear?.x ?? 0))).toBeLessThan(1e-6);
      const knee = poses.map((q) => q.points.kneeNear ?? { x: 0, y: 0 });
      const speed = knee.slice(1).map((k, i) => Math.hypot(k.x - (knee[i]?.x ?? 0), k.y - (knee[i]?.y ?? 0)));
      const peak = Math.max(...speed);
      const mid = speed.filter((_, i) => (i + 0.5) / speed.length >= 0.2 && (i + 0.5) / speed.length <= 0.8);
      expect(Math.min(...mid) / peak).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('passes every motion gate (J3 shin–knee in step, bar and hip one bell, no mid-stall)', () => {
    const r = measureMotion(p, { n: 1200 });
    const failing = r.metrics.filter((m) => !m.ok && m.level !== 'warn').map((m) => m.id);
    expect(failing).toEqual([]);
    for (const id of ['M1', 'M3', 'J1', 'J2', 'J3.t50', 'J3.gap', 'M7v', 'M8', 'J5', 'P1']) expect(r.metrics.find((m) => m.id === id)?.ok, id).toBe(true);
  });

  it('the bar stays within its drift limit', () => {
    const r = checkGuide({ raw: rawOf('barbell-back-squat'), bytes: 2000, dirKey: 'barbell-back-squat', entry: entryOf('barbell-back-squat') });
    expect(r.items.find((i) => i.id === 'bar-drift')?.ok).toBe(true);
  });
});

describe('sled push: the trailing knee folds into the swing (problem 4)', () => {
  it('the heel rises before lift-off, so the knee barely extends after it; contacts stay put', () => {
    const p = prepareGuide(committed('sled-push'));
    const k0 = poseAt(p, 0).angles.kneeNear ?? 0;
    let min = k0;
    for (let i = 0; i <= 100; i += 1) min = Math.min(min, poseAt(p, i / 1000).angles.kneeNear ?? 0);
    // Was 5.4° of extension over 75 ms after toe-off, then 1.9° (round 3); now none (motion and definition review).
    expect(k0 - min).toBeLessThan(0.1);
    const r = measureMotion(p, { n: 1200 });
    expect(r.metrics.find((m) => m.id === 'M7v')?.ok).toBe(true);
    expect(r.metrics.find((m) => m.id === 'M8')?.ok).toBe(true);
    expect(r.metrics.find((m) => m.id === 'C2')?.ok).toBe(true);
    expect(r.metrics.find((m) => m.id === 'S1')?.ok).toBe(true);
  });
});

describe('sled push: the drive knee extends in one sweep and turns at toe-off (motion and definition review)', () => {
  const p = prepareGuide(committed('sled-push'));
  const D = p.guide.durationMs / 1000;
  const N = 600;
  const knee = (t: number): number => poseAt(p, ((t % 1) + 1) % 1).angles.kneeNear ?? NaN;
  /** Flexion speed (°/s, negative while extending) at t. */
  const speed = (t: number): number => ((knee(t + 0.5 / N) - knee(t - 0.5 / N)) * N) / D;

  it('stance (touch-down 0.5 → toe-off 1.0): extension speed rises to one peak, then falls to zero at toe-off', () => {
    const ext = Array.from({ length: N / 2 + 1 }, (_, i) => -speed(0.5 + i / N));
    const peak = ext.indexOf(Math.max(...ext));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(ext.length - 1);
    // One hump: never slows by more than 1 °/s before the peak, never speeds up again after it (was a dip to 29 °/s and a second rise to 64 at toe-off).
    for (let i = 1; i <= peak; i += 1) expect(ext[i] ?? 0).toBeGreaterThan((ext[i - 1] ?? 0) - 1);
    for (let i = peak + 1; i < ext.length; i += 1) expect(ext[i] ?? 0).toBeLessThan((ext[i - 1] ?? 0) + 1);
    expect(Math.abs(ext[ext.length - 1] ?? 9)).toBeLessThan(2);
  });

  it('swing: the knee flexes from toe-off in one sweep, without extending first', () => {
    const flex = Array.from({ length: Math.round(0.2 * N) }, (_, i) => speed(i / N));
    expect(flex.slice(1).every((w) => w > -0.5)).toBe(true);
    const peak = flex.indexOf(Math.max(...flex));
    for (let i = 1; i <= peak; i += 1) expect(flex[i] ?? 0).toBeGreaterThan((flex[i - 1] ?? 0) - 1);
  });

  it('keeps the gait gates and improves the knee jerk (J5 3.02 → 2.2)', () => {
    const r = measureMotion(p, { n: 1200 });
    for (const id of ['C1', 'C2', 'C4', 'C6', 'S1', 'S2', 'S3', 'M7v', 'M8']) expect(r.metrics.find((m) => m.id === id)?.ok, id).toBe(true);
    expect(r.metrics.find((m) => m.id === 'J5')?.value ?? 9).toBeLessThan(2.5);
  });
});

describe('re-posed guides (problems 8, 13, 15)', () => {
  it('bench: the bar touches the lower chest with the forearm vertical and the elbow above the pad', () => {
    const g = committed('barbell-bench-press');
    const p = prepareGuide(g);
    const bottom = p.keys.find((k) => k.label === 'Chest touch');
    const q = poseAt(p, bottom?.t ?? 0);
    const bench = g.props.find((x) => x.type === 'bench');
    const padTop = bench !== undefined && 'height' in bench ? (bench.height ?? 0.24) : 0.24;
    expect(q.points.elbowNear?.y ?? 0).toBeGreaterThanOrEqual(padTop);
    expect(Math.abs((q.points.elbowNear?.x ?? 0) - (q.points.wristNear?.x ?? 1))).toBeLessThan(0.005);
    // Lower chest: about 0.09 H footward of the shoulder joint (was 0.05, over the clavicle).
    expect((q.propPoints.bar?.x ?? 0) - (q.points.shoulderNear?.x ?? 0)).toBeGreaterThan(0.08);
    // The arms are not exempt from the bench collider any more.
    expect(g.checks.besideProps ?? []).not.toContain('armNear');
  });

  it('row: at the top the upper arm sits inside the torso outline, not along the back line', () => {
    const p = prepareGuide(committed('dumbbell-one-arm-row'));
    const top = p.keys.find((k) => k.label === 'Top');
    expect(top?.state.joints.shoulderNear).toBeGreaterThanOrEqual(-12);
    const q = poseAt(p, top?.t ?? 0);
    const c7 = q.points.c7;
    const base = q.points.thoraxBase;
    const elbow = q.points.elbowNear;
    if (c7 === undefined || base === undefined || elbow === undefined) throw new Error('missing points');
    // Signed distance of the elbow above the thorax axis (back side up): under the back line (about 0.05 H).
    const ux = base.x - c7.x;
    const uy = base.y - c7.y;
    const l = Math.hypot(ux, uy);
    const above = ((elbow.x - c7.x) * -uy + (elbow.y - c7.y) * ux) / l;
    expect(Math.abs(above)).toBeLessThan(0.03);
  });

  it('leg press: the bottom keeps the knee near 90° and the hip open (no butt wink), the pelvis pinned', () => {
    const p = prepareGuide(committed('machine-leg-press'));
    const bottom = p.keys.find((k) => k.label === 'Bottom');
    const q = poseAt(p, bottom?.t ?? 0);
    expect(q.angles.kneeNear ?? 0).toBeLessThanOrEqual(92);
    const hip = q.points.hip;
    const knee = q.points.kneeNear;
    const lumbar = q.points.lumbarBase;
    if (hip === undefined || knee === undefined || lumbar === undefined) throw new Error('missing points');
    const a = Math.atan2(knee.y - hip.y, knee.x - hip.x);
    const b = Math.atan2(lumbar.y - hip.y, lumbar.x - hip.x);
    let inc = Math.abs(((a - b) * 180) / Math.PI);
    if (inc > 180) inc = 360 - inc;
    expect(inc).toBeGreaterThanOrEqual(50);
    // Hip and pelvis don't move: the sacrum stays on the pad.
    for (let i = 0; i <= 50; i += 1) {
      const s = drivenStateAt(p, i / 50);
      const r0 = p.keys[0]?.state.root;
      expect(s.root.x).toBeCloseTo(r0?.x ?? NaN, 12);
      expect(s.root.y).toBeCloseTo(r0?.y ?? NaN, 12);
      expect(s.root.pelvisDeg).toBeCloseTo(r0?.pelvisDeg ?? NaN, 10);
    }
  });
});

describe('drawing (problems 9–12, 16)', () => {
  it('S tier: the arm over the body is a thin body-shade edge, never a background halo; it scales with the size', () => {
    const p = prepareGuide(committed('cable-triceps-pushdown'));
    const camera = fitCamera(p);
    const pose = poseAt(p, 0.3);
    for (const pt of [115, 150]) {
      const ops = frameOps(pose, { px: pt, pt, camera, muscles: musclesOf('cable-triceps-pushdown') }).filter(isPath);
      const trunkFill = ops.findIndex((o) => o.fill === 'nearBody');
      expect(ops.filter((o, i) => i > trunkFill && o.fill === 'background').length).toBe(0);
      const edges = ops.filter((o) => o.stroke === 'shade');
      expect(edges.length).toBeGreaterThan(0);
      const visible = Math.min(1, COMPACT_ARM_EDGE_PT * (pt / 115));
      for (const e of edges) expect(e.width).toBeLessThanOrEqual(2 * visible + 1e-9);
    }
  });

  it('open limb strokes fade out at both ends in three steps and keep their whole path', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: i, y: 0 }));
    const pieces = taperedPieces(pts, 3);
    expect(pieces.map((x) => x.alpha)).toEqual([0.2, 0.45, 0.7, 1, 0.7, 0.45, 0.2]);
    const len = (ps: readonly { x: number; y: number }[]): number => ps.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - (ps[i]?.x ?? 0), q.y - (ps[i]?.y ?? 0)), 0);
    expect(pieces.reduce((a, x) => a + len(x.points), 0)).toBeCloseTo(20, 9);
    expect(len(pieces[0]?.points ?? [])).toBeCloseTo(1, 9);
    // Each piece starts where the last one ended.
    for (let i = 1; i < pieces.length; i += 1) expect(pieces[i]?.points[0]).toEqual(pieces[i - 1]?.points.at(-1));
    // Too short to taper: left whole.
    expect(taperedPieces(pts.slice(0, 4), 3)).toHaveLength(1);
  });

  it('no waist line, and the kneecap line fades out past 55–70° of knee flexion', () => {
    const p = prepareGuide(committed('barbell-back-squat'));
    const standing = poseAt(p, 0).body;
    const deep = poseAt(p, 0.6).body;
    expect(kneecapFade(standing, 'Near')).toBe(1);
    expect(kneecapFade(deep, 'Near')).toBe(0);
    // Standing: deltoid, chest, shoulder blade, glute fold, kneecap, calf; no iliac crest (the belt line).
    expect(anatomyLines(standing)).toHaveLength(6);
    expect(anatomyLines(deep)).toHaveLength(5);
  });

  it('a convex hip fillet joins the buttock to the near thigh in side views only', () => {
    const squat = poseAt(prepareGuide(committed('barbell-back-squat')), 0.3).body;
    const fillet = hipFillet(squat);
    expect(fillet).not.toBeNull();
    expect(convexHull(fillet ?? [])).toHaveLength(fillet?.length ?? 0);
    expect(groupContours(squat, 'legNear')[0]).toEqual(fillet);
    const front = poseAt(prepareGuide(committed('cable-lat-pulldown')), 0.3).body;
    expect(hipFillet(front)).toBeNull();
  });

  it('side view: faint pelvis shapes go under the near leg colour; forearm and grip tints only from 240 pt', () => {
    const p = prepareGuide(committed('dumbbell-bulgarian-split-squat'));
    const camera = fitCamera(p);
    const pose = poseAt(p, 0.55);
    const muscles = musclesOf('dumbbell-bulgarian-split-squat');
    const ops = frameOps(pose, { px: 400, camera, muscles, definition: 'neutral' }).filter(isPath);
    const lastFaint = ops.map((o, i) => (o.gradient?.stops.some((st) => st.paint === 'faintNeutral') === true ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const muscleOps = ops.map((o, i) => (o.fill === 'muscle' ? i : -1)).filter((i) => i >= 0);
    // Every faint shape is drawn before the last muscle colour op of the near leg and pelvis.
    expect(lastFaint).toBeLessThan(Math.max(...muscleOps));
    const legColour = muscleOps.filter((i) => i > lastFaint);
    expect(legColour.length).toBeGreaterThan(0);
    // The row lists grip: its hand and forearm tint are drawn from 240 pt, left out just below.
    const row = prepareGuide(committed('dumbbell-one-arm-row'));
    const rowMuscles = musclesOf('dumbbell-one-arm-row');
    const focus = resolveFocus(rowMuscles, undefined, 'side');
    expect(regionShapes(poseAt(row, 0.2).body, focus).some((r) => r.muscle === 'grip')).toBe(true);
    const contours = (pt: number): number =>
      frameOps(poseAt(row, 0.2), { px: pt, pt, camera: fitCamera(row), muscles: rowMuscles })
        .filter(isPath)
        .filter((o) => o.fill === 'muscle')
        .reduce((a, o) => a + o.contours.length, 0);
    expect(contours(SUPPORT_DETAIL_MIN_PT)).toBeGreaterThan(contours(SUPPORT_DETAIL_MIN_PT - 1));
  });

  it('target-legible: a primary muscle that is a sliver at 115 pt fails; every committed guide passes', () => {
    const entry = entryOf('barbell-back-squat');
    const tiny = { ...entry, primaryMuscles: ['brachialis'] as typeof entry.primaryMuscles, secondaryMuscles: [] as typeof entry.secondaryMuscles };
    const r = checkGuide({ raw: rawOf('barbell-back-squat'), bytes: 2000, dirKey: 'barbell-back-squat', entry: tiny });
    expect(r.items.find((i) => i.id === 'target-legible')?.ok).toBe(false);
    const ids = readdirSync(GUIDES).filter((d) => !d.startsWith('_') && existsSync(join(GUIDES, d, 'guide.json')));
    for (const id of ids) {
      const c = checkGuide({ raw: rawOf(id), bytes: 2000, dirKey: id, entry: entryOf(id) });
      expect(c.items.find((i) => i.id === 'target-legible')?.ok, id).toBe(true);
    }
    // The triceps (pushdown) cover the back half of the upper arm: well over the floor at 115 pt.
    const pushdown = prepareGuide(committed('cable-triceps-pushdown'));
    const focus = resolveFocus(musclesOf('cable-triceps-pushdown'), undefined, 'side');
    const k = 115 / fitCamera(pushdown).size;
    const area = regionShapes(poseAt(pushdown, 0).body, focus)
      .filter((x) => x.level === 'strong')
      .reduce((a, x) => a + Math.abs(signedArea(x.contour)), 0);
    expect(area * k * k).toBeGreaterThan(15);
    // Checks every committed guide: CPU-bound, ~6 s under a full parallel `npm run check`, so not the 5 s default.
  }, 60_000);

});
