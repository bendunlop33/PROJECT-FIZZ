import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chainOutline,
  checkGuide,
  countHumps,
  fitCamera,
  frameOps,
  pointInPolygon,
  projectionFade,
  regionShapes,
  resolveFocus,
  shadeBands,
  type DrawOp,
  dist,
  effectiveProjection,
  flattenState,
  GuideSchema,
  hermite,
  measureMotion,
  motionPhases,
  poseAt,
  poseContinuity,
  prepareGuide,
  projector,
  reversal,
  splineSlopes,
  stateAt,
  suggestPassTimes,
  type Guide,
  type PreparedGuide,
  type Vec,
} from '../src/figure/index';
import { CatalogueEntrySchema } from '../src/entry-schema';
import { baseGuide } from './figure-helpers';

/** One channel of the interpolated state at t. */
const channelAt = (g: Guide, p: PreparedGuide, name: string, t: number): number => flattenState(stateAt(g, p.keys, t)).get(name) ?? NaN;
/** One-sided velocity (per unit of normalised time) just before (−1) or after (+1) t, second-order accurate. */
const velocity = (g: Guide, p: PreparedGuide, name: string, t: number, side: 1 | -1, h = 1e-5): number =>
  (side * (-3 * channelAt(g, p, name, t) + 4 * channelAt(g, p, name, t + side * h) - channelAt(g, p, name, t + 2 * side * h))) / (2 * h);
/** One-sided acceleration just before (−1) or after (+1) t. */
const acceleration = (g: Guide, p: PreparedGuide, name: string, t: number, side: 1 | -1, h = 1e-4): number =>
  (channelAt(g, p, name, t + 2 * side * h) - 2 * channelAt(g, p, name, t + side * h) + channelAt(g, p, name, t)) / (h * h);

const GUIDES = join(import.meta.dirname, '..', 'guides');
const GUIDE_IDS = readdirSync(GUIDES)
  .filter((d) => !d.startsWith('_') && existsSync(join(GUIDES, d, 'guide.json')))
  .sort();
const committed = (id: string): Guide => GuideSchema.parse(JSON.parse(readFileSync(join(GUIDES, id, 'guide.json'), 'utf8')));

/** Largest distance between the same points (and prop points) of two poses. */
function poseGap(a: ReturnType<typeof poseAt>, b: ReturnType<typeof poseAt>): number {
  let worst = 0;
  for (const [n, p] of Object.entries(a.points)) {
    const q = b.points[n];
    if (q !== undefined) worst = Math.max(worst, dist(p, q));
  }
  for (const [n, p] of Object.entries(a.propPoints)) {
    const q = b.propPoints[n];
    if (q !== undefined) worst = Math.max(worst, dist(p, q));
  }
  return worst;
}

/** A squat-like test guide: Start → Halfway → Bottom (hold) → Halfway → Start, all `smooth`. */
function repGuide(extra: Record<string, unknown> = {}, keyExtra: Record<number, Record<string, unknown>> = {}) {
  const keys: Record<string, unknown>[] = [
    { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.52, pelvisDeg: 0 }, joints: { lumbar: 0, kneeNear: 0, hipNear: 0 }, ease: 'smooth' },
    { t: 0.25, label: 'Halfway', caption: 'Down', root: { x: -0.03, y: 0.46, pelvisDeg: 20 }, joints: { kneeNear: 50, hipNear: 60 }, ease: 'smooth' },
    { t: 0.5, label: 'Bottom', caption: 'Low', root: { x: -0.08, y: 0.3, pelvisDeg: 40 }, joints: { kneeNear: 110, hipNear: 120 }, holdMs: 200, ease: 'smooth' },
    { t: 0.8, sameAs: 1, ease: 'smooth' },
    { t: 1, sameAs: 0 },
  ];
  return baseGuide({ keyframes: keys.map((k, i) => ({ ...k, ...(keyExtra[i] ?? {}) })), ...extra });
}

describe('motion metric helpers', () => {
  it('counts one hump for a bell and two for a double bell', () => {
    const bell = Array.from({ length: 101 }, (_, i) => Math.sin((Math.PI * i) / 100));
    expect(countHumps(bell)).toBe(1);
    const twin = Array.from({ length: 101 }, (_, i) => Math.abs(Math.sin((2 * Math.PI * i) / 100)));
    expect(countHumps(twin)).toBe(2);
    // A shallow dip (under 10% of the peak) is still one hump.
    const dimple = bell.map((x, i) => x - (i > 45 && i < 55 ? 0.05 * Math.sin((Math.PI * (i - 45)) / 10) : 0));
    expect(countHumps(dimple)).toBe(1);
  });

  it('measures backtracking against the net direction', () => {
    expect(reversal([0, 1, 2, 3])).toBe(0);
    expect(reversal([0, 2, 1.5, 3])).toBeCloseTo(0.5, 12);
    expect(reversal([3, 1, 1.4, 0])).toBeCloseTo(0.4, 12);
  });
});

describe('motion metrics on a guide', () => {
  it('splits a rep into a descent and an ascent around the hold', () => {
    const p = prepareGuide(repGuide());
    const phases = motionPhases(p);
    expect(phases).toHaveLength(2);
    expect(phases[0]?.from).toBe(0);
    expect(phases[0]?.to).toBe(0.5);
    expect(phases[1]?.from).toBeCloseTo(0.5 + 200 / 3000, 12);
    expect(phases[1]?.to).toBe(1);
  });

  it('reports every metric with a level, limit and location', () => {
    const report = measureMotion(prepareGuide(repGuide()), { n: 600 });
    const ids = report.metrics.map((m) => m.id);
    for (const id of ['C1', 'C2', 'C4', 'M1', 'M2', 'M3', 'M4.1', 'M4.2', 'M5', 'M6', 'J1', 'J2', 'J2.any', 'J2.pt', 'J3.t50', 'J3.gap', 'J4', 'J4.ω']) expect(ids).toContain(id);
    for (const m of report.metrics) {
      expect(['hard', 'quality', 'warn']).toContain(m.level);
      expect(m.limit.length).toBeGreaterThan(0);
    }
    expect(report.gait).toBe(false);
  });

  it('catches a pose jump at a key', () => {
    // An IK hand that switches from a free target to a fixed point snaps at the key.
    const g = repGuide({}, { 1: { ik: { handNear: { x: 0.3, y: 0.9 } } }, 2: { ik: { handNear: { x: 0.2, y: 0.5 } } } });
    const c1 = poseContinuity(prepareGuide(g));
    expect(c1.ok).toBe(false);
    expect(c1.value).toBeGreaterThan(0.002);
  });
});

describe('projection channels at every key (E1)', () => {
  it('every resolved key of every guide flattens to the same eight projection channels', () => {
    for (const id of GUIDE_IDS) {
      const p = prepareGuide(committed(id));
      for (const k of p.keys) {
        const proj = [...flattenState(k.state).keys()].filter((c) => c.startsWith('proj.')).sort();
        expect(proj, `${id} key ${k.index}`).toEqual(['proj.armFar', 'proj.armNear', 'proj.forearmFar', 'proj.forearmNear', 'proj.legFar', 'proj.legNear', 'proj.shankFar', 'proj.shankNear']);
      }
    }
  });

  it('effective values are what the pose already used: filling them changes no key pose', () => {
    for (const id of GUIDE_IDS) {
      const p = prepareGuide(committed(id));
      const filled: PreparedGuide = { guide: p.guide, keys: p.keys.map((k) => ({ ...k, state: { ...k.state, proj: effectiveProjection(k.state.proj) } })) };
      for (const k of p.keys) expect(poseGap(poseAt(p, k.t), poseAt(filled, k.t)), `${id} key ${k.index}`).toBe(0);
    }
  });

  it('a forearm projection set on one key blends in from the keys that leave it to the arm', () => {
    const g = baseGuide({
      projection: { armNear: 0.9 },
      keyframes: [
        { t: 0, label: 'Start', caption: 'a', root: { x: 0, y: 0.5, pelvisDeg: 0 }, joints: { shoulderNear: 20, elbowNear: 10 }, ease: 'smooth' },
        { t: 0.5, label: 'Mid', caption: 'b', joints: { shoulderNear: 80, elbowNear: 60 }, projection: { forearmNear: 0.5 }, ease: 'smooth' },
        { t: 1, sameAs: 0 },
      ],
    });
    const p = prepareGuide(g);
    expect(stateAt(g, p.keys, 0.25).proj.forearmNear).toBeGreaterThan(0.5);
    expect(stateAt(g, p.keys, 0.25).proj.forearmNear).toBeLessThan(0.9);
    // Before E1 the forearm stayed 0.5 after the key and snapped to 0.9 at the seam.
    expect(stateAt(g, p.keys, 0.75).proj.forearmNear).toBeGreaterThan(0.5);
    expect(poseContinuity(p).ok).toBe(true);
  });

  it('no committed guide jumps at a key, hold end or the loop seam', () => {
    for (const id of GUIDE_IDS) {
      const p = prepareGuide(committed(id));
      expect(poseContinuity(p).value ?? 0, id).toBeLessThanOrEqual(0.002);
      for (const k of p.keys) {
        if (k.t <= 0 || k.t >= 1) continue;
        expect(poseGap(poseAt(p, k.t - 1e-6), poseAt(p, k.t + 1e-6)), `${id} key ${k.index}`).toBeLessThan(0.002);
      }
    }
  });
});

describe('C2 spline slopes (E2a)', () => {
  it('a free key between two stops gets 1.5× the secant (one speed hump, not two)', () => {
    const m = splineSlopes([0, 1, 2], [0, 1, 2], [0, null, 0], false);
    expect(m[1]).toBeCloseTo(1.5, 12);
    expect(m[0]).toBe(0);
    expect(m[2]).toBe(0);
  });

  it('never overshoots its knot values, even on uneven steps', () => {
    const x = [0, 0.1, 0.5, 0.55, 1];
    const y = [0, 0.8, 0.82, 1.6, 1.61];
    const m = splineSlopes(x, y, [0, null, null, null, 0], false);
    for (let i = 0; i + 1 < x.length; i += 1) {
      const lo = Math.min(y[i] ?? 0, y[i + 1] ?? 0);
      const hi = Math.max(y[i] ?? 0, y[i + 1] ?? 0);
      const h = (x[i + 1] ?? 0) - (x[i] ?? 0);
      for (let s = 0; s <= 1; s += 0.01) {
        const v = hermite(y[i] ?? 0, y[i + 1] ?? 0, m[i] ?? 0, m[i + 1] ?? 0, s, h);
        expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(v).toBeLessThanOrEqual(hi + 1e-12);
      }
    }
  });

  it('is zero at a turning point, honours a fixed non-zero slope, and is continuous in acceleration at free knots', () => {
    expect(splineSlopes([0, 1, 2], [0, 1, 0], [0, null, 0], false)[1]).toBe(0);
    expect(splineSlopes([0, 1, 2], [0, 1, 2], [0, -0.4, 0], false)[1]).toBe(-0.4);
    const x = [0, 1, 2.5, 3, 4];
    const y = [0, 1, 2, 2.6, 3];
    const m = splineSlopes(x, y, [0, null, null, null, 0], false);
    // Second derivative of each Hermite piece at its ends must agree at the interior knots.
    const acc = (i: number, end: boolean): number => {
      const h = (x[i + 1] ?? 0) - (x[i] ?? 0);
      const p0 = y[i] ?? 0;
      const p1 = y[i + 1] ?? 0;
      const m0 = m[i] ?? 0;
      const m1 = m[i + 1] ?? 0;
      return end ? (6 * p0 - 6 * p1 + 2 * h * m0 + 4 * h * m1) / (h * h) : (-6 * p0 + 6 * p1 - 4 * h * m0 - 2 * h * m1) / (h * h);
    };
    for (const k of [1, 2, 3]) expect(acc(k - 1, true)).toBeCloseTo(acc(k, false), 9);
  });

  it('solves a periodic spline when no knot is fixed', () => {
    const n = 12;
    const x = Array.from({ length: n + 1 }, (_, i) => i / n);
    // Shifted so no knot sits on a turn; the guard zeroes only the knots next to one.
    const y = x.map((t) => Math.sin(2 * Math.PI * (t + 0.04)));
    const m = splineSlopes(x, y, x.map(() => null), true);
    expect(m[n]).toBe(m[0]);
    // Knots on the falling flank follow the sine's own slope closely.
    expect(m[6]).toBeCloseTo(2 * Math.PI * Math.cos(2 * Math.PI * (0.5 + 0.04)), 0);
    expect(m[0]).toBeCloseTo(2 * Math.PI * Math.cos(2 * Math.PI * 0.04), 0);
  });

  it('mid-movement keys of every committed guide keep velocity continuous', () => {
    for (const id of GUIDE_IDS) {
      const g = committed(id);
      const p = prepareGuide(g);
      for (const k of p.keys) {
        if (k.t <= 0 || k.t >= 1 || k.holdEnd > k.t) continue;
        for (const name of flattenState(k.state).keys()) {
          if (name.startsWith('ik.foot') && g.ground.scrollPerCycle > 0) continue;
          const vm = velocity(g, p, name, k.t, -1);
          const vp = velocity(g, p, name, k.t, 1);
          expect(Math.abs(vp - vm), `${id} key ${k.index} ${name}`).toBeLessThan(1e-3 * Math.max(1, Math.abs(vm)));
        }
      }
    }
  });

  it('a monotone channel keeps moving through a mid key; it stops only at holds and turning points', () => {
    const g = repGuide();
    const p = prepareGuide(g);
    // Halfway (t 0.25): root.y keeps falling, so its velocity is not zero.
    expect(velocity(g, p, 'root.y', 0.25, -1)).toBeLessThan(-0.1);
    // Bottom (hold) and the top of the rep (a turning point at the loop seam) are still.
    expect(Math.abs(velocity(g, p, 'root.y', 0.5, -1))).toBeLessThan(1e-4);
    expect(Math.abs(velocity(g, p, 'root.y', 0, 1))).toBeLessThan(1e-4);
    expect(Math.abs(velocity(g, p, 'root.y', 1, -1))).toBeLessThan(1e-4);
    // Free mid keys are C2: acceleration continuous too.
    expect(acceleration(g, p, 'root.y', 0.25, -1)).toBeCloseTo(acceleration(g, p, 'root.y', 0.25, 1), 0);
  });

  it('every committed cycle closes without a velocity step at the seam', () => {
    for (const id of GUIDE_IDS) {
      const g = committed(id);
      if (g.loop !== 'cycle') continue;
      const p = prepareGuide(g);
      for (const name of flattenState(p.keys[0]?.state ?? stateAt(g, p.keys, 0)).keys()) {
        if (name.startsWith('ik.foot') && g.ground.scrollPerCycle > 0) continue;
        const v0 = velocity(g, p, name, 0, 1);
        const v1 = velocity(g, p, name, 1, -1);
        expect(Math.abs(v0 - v1), `${id} ${name}`).toBeLessThan(1e-3 * Math.max(1, Math.abs(v0)));
      }
    }
  });
});

/** The committed sled push with the stance rule turned off (how it was before E2b), as a fixture. */
function sledWithoutStance(): Guide {
  const raw = JSON.parse(readFileSync(join(GUIDES, 'sled-push', 'guide.json'), 'utf8')) as { ground: Record<string, unknown> };
  delete raw.ground.matchFloorSpeed;
  return GuideSchema.parse(raw);
}

/** The committed sled push with the stance rule and the plan's stride (§4.10), as a fixture. */
function sledWithStance(stride: boolean): Guide {
  const raw = JSON.parse(readFileSync(join(GUIDES, 'sled-push', 'guide.json'), 'utf8')) as { ground: Record<string, unknown>; keyframes: { ik?: Record<string, Record<string, unknown>> }[] };
  raw.ground.matchFloorSpeed = true;
  // The four labelled keys by time (pass-through keys sit between them).
  const at = (t: number): number => (raw.keyframes as { t?: number }[]).findIndex((k) => k.t === t);
  const ik = (t: number, limb: string): Record<string, unknown> => raw.keyframes[at(t)]?.ik?.[limb] ?? {};
  if (stride) {
    ik(0, 'footNear').x = -0.235;
    ik(0, 'footFar').x = 0.04;
    ik(0.25, 'footNear').x = -0.09;
    ik(0.5, 'footNear').x = 0.04;
    ik(0.75, 'footFar').x = -0.09;
  }
  return GuideSchema.parse(raw);
}

describe('feet on a scrolling floor (E2b)', () => {
  it('without matchFloorSpeed a foot stops dead where it leaves the floor (the sled before the stance rule)', () => {
    const p = prepareGuide(sledWithoutStance());
    const m = measureMotion(p, { n: 600 }).metrics.find((x) => x.id === 'C2');
    expect(m?.ok).toBe(false);
    expect(m?.value).toBeCloseTo(0.262, 2);
  });

  it('with matchFloorSpeed the ankle keeps its velocity at every lift-off and touch-down', () => {
    const p = prepareGuide(sledWithStance(true));
    const report = measureMotion(p, { n: 600 });
    const c2 = report.metrics.find((x) => x.id === 'C2');
    expect(c2?.ok).toBe(true);
    expect(c2?.value ?? 1).toBeLessThan(0.005);
    expect(report.metrics.find((x) => x.id === 'C4')?.ok).toBe(true);
  });

  it('planted contacts ride the floor exactly: no slide in the ground frame', () => {
    for (const g of [committed('sled-push'), sledWithStance(true)]) {
      const p = prepareGuide(g);
      const scroll = g.ground.scrollPerCycle;
      for (const limb of ['footNear', 'footFar'] as const) {
        let anchor: number | null = null;
        for (let i = 0; i <= 400; i += 1) {
          const t = i / 400;
          const s = stateAt(g, p.keys, t);
          const f = s.ik[limb];
          if (f === null || !f.planted) {
            anchor = null;
            continue;
          }
          const ground = f.x + scroll * t;
          anchor ??= ground;
          expect(Math.abs(ground - anchor), `${limb} t=${t}`).toBeLessThan(1e-9);
        }
      }
      expect(checkFailures(g)).toEqual([]);
    }
  });

  it('matchFloorSpeed is rejected on a still floor', () => {
    expect(() => baseGuide({ ground: { y: 0, scrollPerCycle: 0, matchFloorSpeed: true } })).toThrow();
  });
});

function checkFailures(g: Guide): string[] {
  const entry = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'exercises', `${g.exerciseKey}.json`), 'utf8')) as unknown;
  const parsed = CatalogueEntrySchema.parse(entry);
  return checkGuide({ raw: g, bytes: 1000, dirKey: g.exerciseKey, entry: parsed })
    .items.filter((i) => !i.ok)
    .map((i) => i.id);
}

/** The test rep in phases mode: Halfway (and its sameAs on the way up) is a pass key. */
function phaseGuide(keyExtra: Record<number, Record<string, unknown>> = {}, extra: Record<string, unknown> = {}): Guide {
  return repGuide({ motion: 'phases', ...extra }, { 1: { pass: true }, ...keyExtra });
}

describe('phase timing (E3, motion "phases")', () => {
  const g = phaseGuide();
  const p = prepareGuide(g);
  const channels = [...flattenState(p.keys[0]?.state ?? stateAt(g, p.keys, 0)).keys()];
  const stops = [0, 0.5, 0.5 + 200 / 3000, 1];

  it('resolves pass keys through sameAs; an explicit false overrides', () => {
    expect(p.keys.map((k) => k.pass)).toEqual([false, true, false, true, false]);
    const off = prepareGuide(phaseGuide({ 3: { pass: false } }));
    expect(off.keys.map((k) => k.pass)).toEqual([false, true, false, false, false]);
    // Without motion "phases" nothing is a pass key.
    expect(prepareGuide(repGuide()).keys.every((k) => !k.pass)).toBe(true);
  });

  it('every channel leaves and reaches each stop with zero velocity and zero acceleration', () => {
    for (const t of stops) {
      for (const name of channels) {
        for (const side of [-1, 1] as const) {
          if ((t === 0 && side < 0) || (t === 1 && side > 0)) continue;
          expect(Math.abs(velocity(g, p, name, t, side)), `${name} v t=${t} ${side}`).toBeLessThan(1e-3);
          // Peak accelerations here are hundreds of units; at a stop it is ~0 (it grows linearly away from it).
          expect(Math.abs(acceleration(g, p, name, t, side, 1e-6)), `${name} a t=${t} ${side}`).toBeLessThan(0.5);
        }
      }
    }
  });

  it('passes through a pass key without stopping: its pose is the key pose, velocity and acceleration are continuous', () => {
    for (const k of p.keys.filter((x) => x.pass)) {
      expect(poseGap(poseAt(p, k.t), poseAt({ guide: g, keys: p.keys }, k.t))).toBe(0);
      expect(flattenState(stateAt(g, p.keys, k.t))).toEqual(flattenState(k.state));
      const vm = velocity(g, p, 'root.y', k.t, -1);
      expect(Math.abs(vm)).toBeGreaterThan(0.1);
      expect(velocity(g, p, 'root.y', k.t, 1)).toBeCloseTo(vm, 2);
      expect(acceleration(g, p, 'root.y', k.t, 1)).toBeCloseTo(acceleration(g, p, 'root.y', k.t, -1), -1);
    }
  });

  it('eases out of a hold: the first frames after it barely move (minimum jerk)', () => {
    const report = measureMotion(p, { n: 1200 });
    const byId = (id: string) => report.metrics.find((m) => m.id === id);
    expect(byId('M4.1')?.value ?? 1).toBeLessThan(0.05);
    expect(byId('M4.2')?.value ?? 1).toBeLessThan(0.15);
    expect(byId('M5')?.value ?? 1).toBeLessThan(0.1);
    expect(byId('C1')?.ok).toBe(true);
    expect(byId('C4')?.ok).toBe(true);
  });

  it('re-timed pass keys give each phase one centred speed hump', () => {
    const raw = phaseGuide();
    const suggestions = suggestPassTimes(prepareGuide(raw));
    expect(suggestions.map((x) => x.key)).toEqual([1, 3]);
    const keys = raw.keyframes.map((k, i) => ({ ...k, t: suggestions.find((x) => x.key === i)?.suggested ?? k.t }));
    const retimed = GuideSchema.parse({ ...raw, keyframes: keys });
    const config = { main: [{ point: 'hip' }], primary: [], pairs: [] };
    const report = measureMotion(prepareGuide(retimed), { n: 1200, config });
    expect(report.metrics.find((m) => m.id === 'M1')?.value).toBe(1);
    const m2 = report.metrics.find((m) => m.id === 'M2')?.value ?? 0;
    expect(m2).toBeGreaterThan(0.35);
    expect(m2).toBeLessThan(0.65);
    expect(report.metrics.find((m) => m.id === 'P1')?.ok).toBe(true);
  });

  it('the loop seam is a still point: nothing moves at t = 0 and t = 1', () => {
    for (const name of channels) {
      expect(Math.abs(velocity(g, p, name, 0, 1)), name).toBeLessThan(1e-3);
      expect(Math.abs(velocity(g, p, name, 1, -1)), name).toBeLessThan(1e-3);
    }
    expect(poseGap(poseAt(p, 0), poseAt(p, 1 - 1e-6))).toBeLessThan(1e-6);
  });

  it('channel mode is unchanged by the format: a guide without motion keeps channel slopes', () => {
    const c = repGuide();
    const pc = prepareGuide(c);
    // Channel mode keeps moving through Halfway at its spline speed; it is not still at t = 0.25.
    expect(Math.abs(velocity(c, pc, 'root.y', 0.25, 1))).toBeGreaterThan(0.1);
    expect(c.motion).toBeUndefined();
  });
});

describe('phase timing schema rules', () => {
  const issues = (raw: Record<string, unknown>): string[] => {
    const r = GuideSchema.safeParse(raw);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  const rawPhases = (keyExtra: Record<number, Record<string, unknown>> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const g = phaseGuide();
    return { ...g, ...extra, keyframes: g.keyframes.map((k, i) => ({ ...k, ...(keyExtra[i] ?? {}) })) };
  };

  it('accepts a valid phases guide', () => {
    expect(issues(rawPhases())).toEqual([]);
  });

  it('rejects a pass key with a hold, and pass on the first or last key', () => {
    expect(issues(rawPhases({ 1: { holdMs: 100 } }))).toContain('A pass key has no hold');
    expect(issues(rawPhases({ 0: { pass: true } }))).toContain('The first and last keyframes are stops, not pass keys');
    expect(issues(rawPhases({ 4: { pass: true } }))).toContain('The first and last keyframes are stops, not pass keys');
  });

  it('rejects a scrolling floor, a non-smooth ease and pass keys without motion "phases"', () => {
    expect(issues(rawPhases({}, { ground: { y: 0, scrollPerCycle: 0.5 } }))).toContain('motion "phases" needs a still floor (scrollPerCycle 0)');
    expect(issues(rawPhases({ 1: { ease: 'linear' } }))).toContain('motion "phases" keyframes use the smooth ease');
    expect(issues(rawPhases({}, { motion: 'channels' }))).toContain('pass keys need motion "phases"');
  });

  it('rejects an IK mode change at a pass key but allows it at a stop', () => {
    const atPass = issues(rawPhases({ 1: { ik: { handNear: { x: 0.3, y: 0.9 } } } }));
    expect(atPass.some((m) => m.includes('handNear changes IK mode at a pass key'))).toBe(true);
    const planted = issues(rawPhases({ 0: { ik: { footNear: { x: 0, y: 0, planted: true } } }, 1: { ik: { footNear: { planted: false } } } }));
    expect(planted.some((m) => m.includes('footNear changes IK mode at a pass key'))).toBe(true);
    // Allowed at a stop: the hand target appears at Bottom, stays through the ascent pass key, and goes at the end stop.
    const g = phaseGuide();
    const keys = g.keyframes.map((k) => ({ ...k }));
    keys[2] = { ...keys[2], t: 0.5, ik: { handNear: { x: 0.3, y: 0.9 } } };
    keys[3] = { t: 0.8, pass: true, root: { x: -0.03, y: 0.46, pelvisDeg: 20 }, joints: { kneeNear: 50, hipNear: 60 }, ease: 'smooth' };
    expect(issues({ ...g, keyframes: keys })).toEqual([]);
  });
});

/**
 * The committed RDL with its bar keyframed separately again (how it was before E4): the bar sits
 * exactly where the hang anchor puts it at every authored key, and is interpolated on its own in between.
 */
function rdlKeyframedBar(): Guide {
  const raw = JSON.parse(readFileSync(join(GUIDES, 'barbell-romanian-deadlift', 'guide.json'), 'utf8')) as { props: Record<string, unknown>[]; keyframes: { sameAs?: number; props?: Record<string, unknown> }[] };
  const hanging = prepareGuide(GuideSchema.parse(raw));
  for (const p of raw.props) if (p.id === 'bar') p.anchor = { kind: 'keyframed' };
  raw.keyframes.forEach((k, i) => {
    const key = hanging.keys[i];
    if (k.sameAs !== undefined || key === undefined) return;
    const bar = poseAt(hanging, key.t).propPoints.bar;
    if (bar !== undefined) k.props = { ...k.props, bar: { x: bar.x, y: bar.y } };
  });
  return GuideSchema.parse(raw);
}

/** The committed RDL with its bar on a `hang` anchor (plan §4.4) instead of keyframed positions. */
function rdlHanging(elbowDeg = 13): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(GUIDES, 'barbell-romanian-deadlift', 'guide.json'), 'utf8')) as { props: Record<string, unknown>[]; keyframes: { props?: Record<string, unknown> }[] };
  for (const p of raw.props) if (p.id === 'bar') p.anchor = { kind: 'hang', x: 0.035, elbowDeg };
  for (const k of raw.keyframes) {
    if (k.props !== undefined) {
      delete k.props.bar;
      if (Object.keys(k.props).length === 0) delete k.props;
    }
  }
  return raw;
}

describe('hang barbell anchor (E4)', () => {
  it('holds the elbow at elbowDeg and the bar over one x through the whole hinge', () => {
    const g = GuideSchema.parse(rdlHanging(13));
    const p = prepareGuide(g);
    for (let i = 0; i <= 30; i += 1) {
      const pose = poseAt(p, i / 30);
      expect(Math.abs(pose.angles.elbowNear ?? NaN), `t=${i / 30}`).toBeCloseTo(13, 6);
      expect(pose.propPoints.bar?.x).toBeCloseTo(0.035, 12);
    }
    expect(checkFailures(g)).toEqual([]);
  });

  it('removes the arm wobble of a separately keyframed bar', () => {
    const before = measureMotion(prepareGuide(rdlKeyframedBar()), { n: 600 }).metrics.find((m) => m.id === 'J2.any');
    const after = measureMotion(prepareGuide(GuideSchema.parse(rdlHanging())), { n: 600 }).metrics.find((m) => m.id === 'J2.any');
    expect(before?.value ?? 0).toBeGreaterThan(2);
    expect(after?.value ?? 1).toBeLessThan(0.5);
  });

  it('is only for a side-view barbell without keyframed positions', () => {
    const keyed = rdlHanging() as { keyframes: { props?: Record<string, unknown> }[] };
    const first = keyed.keyframes[0];
    if (first !== undefined) first.props = { bar: { y: 0.4 } };
    expect(GuideSchema.safeParse(keyed).success).toBe(false);
    const front = { ...rdlHanging(), view: 'front' };
    expect(GuideSchema.safeParse(front).success).toBe(false);
  });
});

describe('drawing seams (ADR 0015, V1–V3)', () => {
  const isPath = (o: DrawOp): o is Extract<DrawOp, { kind: 'path' }> => o.kind === 'path';

  it('the near leg is outlined under the trunk, so the thigh joins the hip without a seam line', () => {
    const p = prepareGuide(committed('barbell-back-squat'));
    const camera = fitCamera(p);
    const ops = frameOps(poseAt(p, 0.5), { px: 240, camera }).filter(isPath);
    const fills = ops.map((o, i) => (o.fill === 'nearBody' ? i : -1)).filter((i) => i >= 0);
    const [trunkFill, legFill] = fills;
    const contours = ops.map((o, i) => (o.stroke === 'shade' && o.width > 1 && o.fill === null && o.gradient === null ? i : -1)).filter((i) => i >= 0);
    // Leg contour, trunk contour, trunk fill, … leg fill (no contour right before it), arm contours, arm fill.
    expect(contours.filter((i) => i < (trunkFill ?? 0)).length).toBe(2);
    expect(contours.some((i) => i > (trunkFill ?? 0) && i < (legFill ?? 0))).toBe(false);
  });

  it('arm segments are stroked as open paths without their proximal cap; hands stay closed', () => {
    const p = prepareGuide(committed('dumbbell-one-arm-row'));
    const ops = frameOps(poseAt(p, 0.2), { px: 240, camera: fitCamera(p) }).filter(isPath);
    // The outline contour is the 0.5-opacity shade stroke (anatomical lines are 0.35).
    const contour = ops.filter((o) => o.stroke === 'shade' && o.opacity === 0.5 && o.fill === null);
    const open = contour.filter((o) => !o.closed);
    // Arm strokes are open paths: tapered at both ends and, over the torso, a soft occlusion edge (round 4), so the
    // full-strength 0.5 op holds only the parts outside the torso.
    const strokes = ops.filter((o) => o.stroke === 'shade' && !o.closed && o.fill === null && o.width === open[0]?.width);
    expect(open.length).toBeLessThanOrEqual(1);
    expect(strokes.length).toBeGreaterThan(3);
    expect(strokes.every((o) => o.opacity <= 0.5 + 1e-9)).toBe(true);
    const seg = poseAt(p, 0.2).body.segments.find((x) => x.name === 'upperArm' && x.side === 'Near');
    if (seg === undefined) throw new Error('no upper arm');
    // No stroke runs across the shoulder: the outline's proximal cap (its last 3 points) is in none of the pieces.
    const P = projector(fitCamera(p), 240, p.guide.facing);
    const cap = chainOutline([seg]).slice(-3).map(P);
    const near = (a: Vec, b: Vec): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
    expect(strokes.flatMap((o) => o.contours).some((c) => c.some((q) => cap.some((k) => near(q, k))))).toBe(false);
    // The fist (and thumb) outline stays closed.
    expect(contour.some((o) => o.closed && o.contours.length >= 1)).toBe(true);
  });

  it('limb shade bands stop where their edge runs into the other segment of the limb (no ghost edge at a bent knee)', () => {
    for (const id of ['barbell-back-squat', 'machine-leg-press', 'cable-lat-pulldown']) {
      const p = prepareGuide(committed(id));
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const body = poseAt(p, t).body;
        for (const group of ['legNear', 'armNear'] as const) {
          const limb = body.segments.filter((x) => x.group === group);
          for (const band of shadeBands(body, group)) {
            const edge = band.contour.slice(0, band.contour.length / 2);
            for (const other of limb.filter((x) => x.name !== band.segment)) {
              const poly = chainOutline([other]);
              // The cut is refined to ~0.1% of the segment, so allow the very end point to touch the neighbour.
              for (const q of edge.slice(0, -1).slice(1)) expect(pointInPolygon(q, poly), `${id} t=${t} ${band.segment ?? ''} in ${other.name}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('muscle colour fades with a segment turning towards the camera instead of blinking at 0.5', () => {
    expect(projectionFade(0.4)).toBe(0);
    expect(projectionFade(0.5)).toBeCloseTo(0.5, 12);
    expect(projectionFade(0.6)).toBe(1);
    expect(projectionFade(1)).toBe(1);
    const p = prepareGuide(committed('barbell-overhead-press'));
    const entry = CatalogueEntrySchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'exercises', 'barbell-overhead-press.json'), 'utf8')));
    const muscles = { primary: entry.primaryMuscles, secondary: entry.secondaryMuscles };
    const focus = resolveFocus(muscles, p.guide.focus, 'side');
    // Sweep the press: an arm region's alpha changes by small steps, never 0 → 1 between neighbouring samples.
    let prev: number | null = null;
    let biggest = 0;
    for (let i = 0; i <= 400; i += 1) {
      const pose = poseAt(p, i / 400);
      const arm = regionShapes(pose.body, focus).filter((r) => r.group === 'armNear');
      const alpha = arm.length === 0 ? 0 : Math.max(...arm.map((r) => r.alpha));
      if (prev !== null) biggest = Math.max(biggest, Math.abs(alpha - prev));
      prev = alpha;
    }
    expect(biggest).toBeLessThan(0.2);
    // Faded regions are drawn at muscle opacity × alpha.
    const t = p.keys[1]?.t ?? 0.2;
    const ops = frameOps(poseAt(p, t), { px: 240, camera: fitCamera(p), muscles }).filter(isPath);
    const alphas = regionShapes(poseAt(p, t).body, focus).map((r) => r.alpha);
    if (alphas.some((a) => a < 1)) expect(ops.some((o) => o.fill === 'muscle' && o.opacity < 0.45)).toBe(true);
  });
});
