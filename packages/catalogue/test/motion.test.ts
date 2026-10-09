import { describe, expect, it } from 'vitest';
import { countHumps, measureMotion, motionPhases, poseContinuity, prepareGuide, reversal } from '../src/figure/index';
import { baseGuide } from './figure-helpers';

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
