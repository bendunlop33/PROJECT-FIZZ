/**
 * Guide motion round 2 (ADR 0017), E5: a channel that turns back at a pass key
 * keeps its acceleration continuous through the turn; plus the interpolation
 * properties every guide relies on (key poses exact, velocity continuous at
 * mid keys, still only at stops and turns, smooth hold exits, a seamless loop
 * seam, planted contacts that never slide).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenState, GuideSchema, hermite, phaseTurnSlopes, prepareGuide, splineSlopes, stateAt, type Guide, type PreparedGuide } from '../src/figure/index';
import { baseGuide } from './figure-helpers';

const GUIDES = join(import.meta.dirname, '..', 'guides');
const GUIDE_IDS = readdirSync(GUIDES)
  .filter((d) => !d.startsWith('_') && existsSync(join(GUIDES, d, 'guide.json')))
  .sort();
const committed = (id: string): Guide => GuideSchema.parse(JSON.parse(readFileSync(join(GUIDES, id, 'guide.json'), 'utf8')));

const channelAt = (p: PreparedGuide, name: string, t: number): number => flattenState(stateAt(p.guide, p.keys, t)).get(name) ?? NaN;
/** One-sided velocity (per unit of normalised time), second-order accurate. */
const velocity = (p: PreparedGuide, name: string, t: number, side: 1 | -1, h = 1e-5): number =>
  (side * (-3 * channelAt(p, name, t) + 4 * channelAt(p, name, t + side * h) - channelAt(p, name, t + 2 * side * h))) / (2 * h);
/** One-sided acceleration, second-order accurate. */
const acceleration = (p: PreparedGuide, name: string, t: number, side: 1 | -1, h = 1e-4): number =>
  (2 * channelAt(p, name, t) - 5 * channelAt(p, name, t + side * h) + 4 * channelAt(p, name, t + 2 * side * h) - channelAt(p, name, t + 3 * side * h)) / (h * h);

/** Second derivative of Hermite segment i at its start (end = false) or end, per unit of x². */
function segmentAcc(x: readonly number[], y: readonly number[], m: readonly number[], i: number, end: boolean): number {
  const h = (x[i + 1] ?? 0) - (x[i] ?? 0);
  const p0 = y[i] ?? 0;
  const p1 = y[i + 1] ?? 0;
  const m0 = m[i] ?? 0;
  const m1 = m[i + 1] ?? 0;
  return end ? (6 * p0 - 6 * p1 + 2 * h * m0 + 4 * h * m1) / (h * h) : (-6 * p0 + 6 * p1 - 4 * h * m0 - 2 * h * m1) / (h * h);
}

/** Fixed slopes as phase mode sets them: 0 at an interior knot that turns back or has a flat side. */
function turnFixed(y: readonly number[]): (number | null)[] {
  return y.map((v, j) => {
    if (j === 0 || j === y.length - 1) return null;
    const a = v - (y[j - 1] ?? 0);
    const b = (y[j + 1] ?? 0) - v;
    return a === 0 || b === 0 || Math.sign(a) !== Math.sign(b) ? 0 : null;
  });
}

/** Small deterministic PRNG (mulberry32) for the property test. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('phaseTurnSlopes (E5)', () => {
  it('keeps acceleration continuous through an unclipped turning knot, with zero slope there', () => {
    const x = [0, 0.3, 0.6, 1];
    const y = [0, 1, 0.8, 0.2];
    const r = phaseTurnSlopes(x, y, turnFixed(y));
    expect(r.clipped).toEqual([]);
    expect(r.kinks).toEqual([]);
    expect(r.slopes[1]).toBe(0);
    for (const k of [1, 2]) {
      const a = segmentAcc(x, y, r.slopes, k - 1, true);
      const b = segmentAcc(x, y, r.slopes, k, false);
      expect(Math.abs(a - b)).toBeLessThan(1e-9 * Math.max(1, Math.abs(a)));
    }
    // splineSlopes decouples the two sides of the same knot: acceleration jumps there.
    const old = splineSlopes(x, y, turnFixed(y), false);
    expect(Math.abs(segmentAcc(x, y, old, 0, true) - segmentAcc(x, y, old, 1, false))).toBeGreaterThan(1);
  });

  it('with no fixed interior knot it is splineSlopes, bit for bit', () => {
    const cases: [number[], number[]][] = [
      [
        [0, 0.2, 0.7, 1],
        [0, 0.4, 0.9, 1],
      ],
      [
        [0, 0.1, 0.5, 0.55, 1],
        [0, 0.8, 0.82, 1.6, 1.61],
      ],
      [
        [0, 1],
        [3, -2],
      ],
    ];
    for (const [x, y] of cases) {
      const fixed = x.map(() => null);
      expect(phaseTurnSlopes(x, y, fixed).slopes).toStrictEqual(splineSlopes(x, y, fixed, false));
    }
    // A fixed end slope alone is not an interior knot either.
    expect(phaseTurnSlopes([0, 0.5, 1], [0, 1, 2], [0, null, null]).slopes).toStrictEqual(splineSlopes([0, 0.5, 1], [0, 1, 2], [0, null, null], false));
  });

  it('a knot the guard clips is reported, fixed at the clipped slope, and the rest are solved again with continuous acceleration', () => {
    // Up to a turn at knot 1, then a short and a long fall: the minimum-curvature slope at knot 2 is too steep for its short secant.
    const x = [0, 1, 2, 3];
    const y = [0, 1, 0.9, 0];
    const r = phaseTurnSlopes(x, y, turnFixed(y));
    expect(r.clipped).toEqual([2]);
    expect(r.kinks).toEqual([2]);
    // Capped at 3× the smaller neighbouring secant (−0.1).
    expect(r.slopes[2]).toBeCloseTo(-0.3, 12);
    // Knot 1 (the turn, not clipped) still has continuous acceleration.
    expect(Math.abs(segmentAcc(x, y, r.slopes, 0, true) - segmentAcc(x, y, r.slopes, 1, false))).toBeLessThan(1e-9);
  });

  it('never lets a segment leave its key range, and keeps acceleration continuous everywhere but the reported kinks (1000 random phases)', () => {
    const rand = rng(17);
    let turns = 0;
    let continuous = 0;
    for (let c = 0; c < 1000; c += 1) {
      const n = 3 + Math.floor(rand() * 6);
      const x = [0];
      for (let i = 1; i < n; i += 1) x.push((x[i - 1] ?? 0) + 0.02 + rand());
      const span = x[n - 1] ?? 1;
      const u = x.map((v) => v / span);
      // Half the cases monotone, half with turns (and the odd flat step).
      const monotone = rand() < 0.5;
      const y = [0];
      for (let i = 1; i < n; i += 1) {
        const step = rand() < 0.08 ? 0 : (0.05 + rand()) * (monotone ? 1 : rand() < 0.5 ? -1 : 1);
        y.push((y[i - 1] ?? 0) + step);
      }
      const fixed = turnFixed(y);
      const r = phaseTurnSlopes(u, y, fixed);
      fixed.forEach((f, j) => {
        if (f !== null) expect(r.slopes[j]).toBeCloseTo(f, 12);
      });
      // Only clipped knots and fixed ones lose continuity. Without a fixed interior knot this is splineSlopes, which
      // doesn't solve again after clipping, so a clipped knot's neighbours lose it too.
      const turning = fixed.some((f) => f !== null);
      for (const j of r.kinks) {
        const explained = r.clipped.includes(j) || fixed[j] !== null || (!turning && (r.clipped.includes(j - 1) || r.clipped.includes(j + 1)));
        expect(explained, `case ${c} kink ${j}`).toBe(true);
      }
      for (let i = 0; i + 1 < n; i += 1) {
        const lo = Math.min(y[i] ?? 0, y[i + 1] ?? 0);
        const hi = Math.max(y[i] ?? 0, y[i + 1] ?? 0);
        const h = (u[i + 1] ?? 0) - (u[i] ?? 0);
        for (let s = 0; s <= 1; s += 0.02) {
          const v = hermite(y[i] ?? 0, y[i + 1] ?? 0, r.slopes[i] ?? 0, r.slopes[i + 1] ?? 0, s, h);
          expect(v, `case ${c} segment ${i}`).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(v, `case ${c} segment ${i}`).toBeLessThanOrEqual(hi + 1e-9);
        }
      }
      for (let j = 1; j < n - 1; j += 1) {
        if (fixed[j] !== null) turns += 1;
        if (r.kinks.includes(j)) continue;
        const a = segmentAcc(u, y, r.slopes, j - 1, true);
        const b = segmentAcc(u, y, r.slopes, j, false);
        expect(Math.abs(a - b), `case ${c} knot ${j}`).toBeLessThan(1e-7 * Math.max(1, Math.abs(a)));
        if (fixed[j] !== null) continuous += 1;
      }
    }
    // Not vacuous: many turning knots, and a good share kept continuous even in these random zigzags (consecutive
    // turns can't all be C2 without overshoot; those stay decoupled, as before E5).
    expect(turns).toBeGreaterThan(500);
    expect(continuous).toBeGreaterThan(0.3 * turns);
  });

  it('a phase with one pass key that turns (the common case) always keeps acceleration continuous there', () => {
    const rand = rng(3);
    for (let c = 0; c < 500; c += 1) {
      const u = [0, 0.1 + 0.8 * rand(), 1];
      const y = [0, 0.05 + rand(), (rand() - 0.5) * 2];
      const fixed = turnFixed(y);
      const r = phaseTurnSlopes(u, y, fixed);
      if (fixed[1] === null) continue;
      expect(r.kinks, `case ${c}`).toEqual([]);
      expect(Math.abs(segmentAcc(u, y, r.slopes, 0, true) - segmentAcc(u, y, r.slopes, 1, false))).toBeLessThan(1e-7 * Math.max(1, Math.abs(segmentAcc(u, y, r.slopes, 0, true))));
    }
  });
});

/** A rep in phases mode whose pelvis turns at the descent pass key (an overhead-press lean-back). */
function turnGuide(): Guide {
  return baseGuide({
    motion: 'phases',
    keyframes: [
      { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.52, pelvisDeg: 0 }, joints: { kneeNear: 0, hipNear: 0 }, ease: 'smooth' },
      { t: 0.22, label: 'Halfway', caption: 'Down', pass: true, root: { x: -0.03, y: 0.46, pelvisDeg: -5 }, joints: { kneeNear: 50, hipNear: 60 }, ease: 'smooth' },
      { t: 0.5, label: 'Bottom', caption: 'Low', root: { x: -0.08, y: 0.3, pelvisDeg: 0 }, joints: { kneeNear: 110, hipNear: 120 }, holdMs: 200, ease: 'smooth' },
      { t: 0.8, sameAs: 1 },
      { t: 1, sameAs: 0 },
    ],
  });
}

describe('turning pass keys in a guide (E5)', () => {
  it('a channel that turns at a pass key stops there with continuous acceleration; monotone channels keep moving', () => {
    const p = prepareGuide(turnGuide());
    for (const k of p.keys.filter((x) => x.pass)) {
      expect(Math.abs(velocity(p, 'root.pelvisDeg', k.t, -1))).toBeLessThan(1e-3);
      expect(Math.abs(velocity(p, 'root.pelvisDeg', k.t, 1))).toBeLessThan(1e-3);
      const am = acceleration(p, 'root.pelvisDeg', k.t, -1);
      const ap = acceleration(p, 'root.pelvisDeg', k.t, 1);
      expect(Math.abs(am)).toBeGreaterThan(10);
      expect(Math.abs(ap - am)).toBeLessThan(0.01 * Math.abs(am));
      expect(Math.abs(velocity(p, 'root.y', k.t, -1))).toBeGreaterThan(0.1);
    }
  });

  it('is still only at stops and at its own turns: the velocity of a monotone channel never reaches zero inside a phase', () => {
    const p = prepareGuide(turnGuide());
    const phases: [number, number][] = [
      [0, 0.5],
      [0.5 + 200 / 3000, 1],
    ];
    for (const [a, b] of phases) {
      let minY = Infinity;
      let peakY = 0;
      let pelvisSignChanges = 0;
      let prev = 0;
      for (let i = 1; i < 200; i += 1) {
        const t = a + ((b - a) * i) / 200;
        const vy = Math.abs(velocity(p, 'root.y', t, 1));
        peakY = Math.max(peakY, vy);
        // Away from the stops (minimum-jerk progress is near still in the first and last 10%).
        if (i >= 20 && i <= 180) minY = Math.min(minY, vy);
        const vp = velocity(p, 'root.pelvisDeg', t, 1);
        if (Math.abs(vp) > 1e-6) {
          if (prev !== 0 && Math.sign(vp) !== Math.sign(prev)) pelvisSignChanges += 1;
          prev = vp;
        }
      }
      expect(minY).toBeGreaterThan(0.05 * peakY);
      // The pelvis turns once per phase, at the pass key, and nowhere else.
      expect(pelvisSignChanges).toBe(1);
    }
  });

  it('every committed guide: key poses are exactly the resolved keys', () => {
    for (const id of GUIDE_IDS) {
      const p = prepareGuide(committed(id));
      for (const k of p.keys) expect([...flattenState(stateAt(p.guide, p.keys, k.t))], `${id} key ${k.index}`).toStrictEqual([...flattenState(k.state)]);
    }
  });

  it('every committed phases guide: a body channel that turns at a pass key keeps its acceleration (projection channels excepted)', () => {
    let checked = 0;
    for (const id of GUIDE_IDS) {
      const g = committed(id);
      if (g.motion !== 'phases') continue;
      const p = prepareGuide(g);
      const stops = p.keys.filter((k) => !k.pass);
      for (let j = 0; j + 1 < stops.length; j += 1) {
        const A = stops[j]?.holdEnd ?? 0;
        const B = stops[j + 1]?.t ?? 1;
        const pass = p.keys.filter((k) => k.pass && k.t > A && k.t < B);
        for (const k of pass) {
          for (const name of flattenState(k.state).keys()) {
            if (name.startsWith('proj.')) continue;
            const before = flattenState(p.keys[k.index - 1]?.state ?? k.state).get(name) ?? 0;
            const here = flattenState(k.state).get(name) ?? 0;
            const after = flattenState(p.keys[k.index + 1]?.state ?? k.state).get(name) ?? 0;
            const turns = (here - before) * (after - here) < 0;
            if (!turns || Math.abs(here - before) < 1e-3 || Math.abs(after - here) < 1e-3) continue;
            // Peak |acceleration| over the phase, for scale.
            let peak = 0;
            for (let i = 1; i < 100; i += 1) peak = Math.max(peak, Math.abs(acceleration(p, name, A + ((B - A) * i) / 100, 1)));
            const jump = Math.abs(acceleration(p, name, k.t, 1) - acceleration(p, name, k.t, -1));
            expect(jump / peak, `${id} key ${k.index} ${name}`).toBeLessThan(0.02);
            checked += 1;
          }
        }
      }
    }
    // The overhead press pelvis (69% before E5) and the split squat root.x (28%) are among them.
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('every committed phases guide leaves each hold with zero velocity and acceleration (no lurch)', () => {
    for (const id of GUIDE_IDS) {
      const g = committed(id);
      if (g.motion !== 'phases') continue;
      const p = prepareGuide(g);
      for (const k of p.keys.filter((x) => x.holdEnd > x.t)) {
        for (const name of flattenState(k.state).keys()) {
          expect(Math.abs(velocity(p, name, k.holdEnd, 1)), `${id} ${name} after hold ${k.index}`).toBeLessThan(1e-3);
          expect(Math.abs(acceleration(p, name, k.holdEnd, 1, 1e-6)), `${id} ${name} after hold ${k.index}`).toBeLessThan(0.5);
        }
      }
    }
  });

  it('every committed guide: planted contacts never slide (ground frame)', () => {
    for (const id of GUIDE_IDS) {
      const g = committed(id);
      const p = prepareGuide(g);
      const scroll = g.ground.scrollPerCycle;
      for (const limb of ['footNear', 'footFar'] as const) {
        let anchor: { x: number; y: number } | null = null;
        for (let i = 0; i <= 600; i += 1) {
          const t = i / 600;
          const f = stateAt(g, p.keys, t).ik[limb];
          if (f === null || !f.planted || f.prop !== null) {
            anchor = null;
            continue;
          }
          const ground = { x: f.x + scroll * t, y: f.y };
          anchor ??= ground;
          expect(Math.hypot(ground.x - anchor.x, ground.y - anchor.y), `${id} ${limb} t=${t}`).toBeLessThan(1e-9);
        }
      }
    }
  });
});
