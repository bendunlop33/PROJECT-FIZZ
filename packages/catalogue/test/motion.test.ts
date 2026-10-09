import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkGuide,
  countHumps,
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
  reversal,
  splineSlopes,
  stateAt,
  type Guide,
  type PreparedGuide,
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

/** The committed sled push with the stance rule and the plan's stride (§4.10), as a fixture. */
function sledWithStance(stride: boolean): Guide {
  const raw = JSON.parse(readFileSync(join(GUIDES, 'sled-push', 'guide.json'), 'utf8')) as { ground: Record<string, unknown>; keyframes: { ik?: Record<string, Record<string, unknown>> }[] };
  raw.ground.matchFloorSpeed = true;
  const ik = (k: number, limb: string): Record<string, unknown> => raw.keyframes[k]?.ik?.[limb] ?? {};
  if (stride) {
    ik(0, 'footNear').x = -0.235;
    ik(0, 'footFar').x = 0.04;
    ik(1, 'footNear').x = -0.09;
    ik(2, 'footNear').x = 0.04;
    ik(3, 'footFar').x = -0.09;
  }
  return GuideSchema.parse(raw);
}

describe('feet on a scrolling floor (E2b)', () => {
  it('without matchFloorSpeed a foot stops dead where it leaves the floor (the sled today)', () => {
    const p = prepareGuide(committed('sled-push'));
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
