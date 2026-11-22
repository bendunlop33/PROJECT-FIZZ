/**
 * Round-2 motion metrics (ADR 0017): M7v and M8 (velocity-vector frame steps),
 * J5 (IK joint acceleration), J6 (IK reach), C6 (seam velocity), declared
 * excursions and per-guide allowances, and the bake-rate option.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countTurns, GuideSchema, measureMotion, MOTION_CONFIG, motionReportOk, prepareGuide, seamVelocity, type Guide, type MotionConfig, type MotionReport } from '../src/figure/index';
import { baseGuide } from './figure-helpers';

const GUIDES = join(import.meta.dirname, '..', 'guides');
const GUIDE_IDS = readdirSync(GUIDES)
  .filter((d) => !d.startsWith('_') && existsSync(join(GUIDES, d, 'guide.json')))
  .sort();
const committed = (id: string): Guide => GuideSchema.parse(JSON.parse(readFileSync(join(GUIDES, id, 'guide.json'), 'utf8')));
const byId = (r: MotionReport, id: string) => r.metrics.find((m) => m.id === id);

/**
 * A planted-leg squat with stops only (one minimum-jerk stroke down, a hold, one up). `topY` sets how straight
 * the knee is at the top: 0.50 leaves it bent about 38°, 0.5295 nearly straight (reach 0.999).
 */
function legGuide(topY: number): Guide {
  return baseGuide({
    motion: 'phases',
    keyframes: [
      { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: topY, pelvisDeg: 5 }, ik: { footNear: { x: 0, y: 0, planted: true } }, ease: 'smooth' },
      { t: 0.5, label: 'Bottom', caption: 'Low', root: { x: -0.06, y: 0.36, pelvisDeg: 30 }, holdMs: 200, ease: 'smooth' },
      { t: 1, sameAs: 0 },
    ],
    checks: { planted: ['footNear'], romProfile: 'adult-default' },
  });
}

const config: MotionConfig = { main: [{ point: 'hip' }], primary: [], pairs: [] };

describe('velocity-vector frame steps and IK joint acceleration (M7v, M8, J5, J6)', () => {
  it('a clean minimum-jerk stroke on a bent knee passes all four', () => {
    const r = measureMotion(prepareGuide(legGuide(0.5)), { n: 600, config });
    for (const id of ['M7v', 'M8', 'J5']) {
      expect(byId(r, id)?.level, id).toBe('quality');
      expect(byId(r, id)?.ok, `${id} ${byId(r, id)?.where}`).toBe(true);
    }
    // Minimum-jerk frame steps stay near the ideal (the knee point's IK curvature adds a little).
    expect(byId(r, 'M7v')?.value ?? 9).toBeLessThan(2);
    expect(byId(r, 'J5')?.value ?? 9).toBeLessThan(1.5);
    expect(byId(r, 'J6')?.ok).toBe(true);
    expect(byId(r, 'J6')?.level).toBe('warn');
  });

  it('a near-straight knee at a stop whips into it: M8 and J5 fail, J6 warns', () => {
    const r = measureMotion(prepareGuide(legGuide(0.5295)), { n: 600, config });
    expect(byId(r, 'M8')?.ok, byId(r, 'M8')?.where).toBe(false);
    expect(byId(r, 'J5')?.ok, byId(r, 'J5')?.where).toBe(false);
    expect(byId(r, 'J5')?.where).toContain('kneeNear');
    expect(byId(r, 'J6')?.ok).toBe(false);
    expect(byId(r, 'J6')?.value ?? 0).toBeGreaterThan(0.99);
    expect(motionReportOk(r)).toBe(false);
  });

  it('an injected acceleration step (a linear key with a speed change) fails M7v', () => {
    const g = baseGuide({
      keyframes: [
        { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.5, pelvisDeg: 0 }, holdMs: 100, ease: 'smooth' },
        { t: 0.25, root: { x: 0, y: 0.47 }, ease: 'linear' },
        { t: 0.4, root: { x: 0, y: 0.3 }, ease: 'smooth' },
        { t: 0.6, label: 'Bottom', caption: 'Low', root: { x: 0, y: 0.25 }, holdMs: 100, ease: 'smooth' },
        { t: 1, sameAs: 0 },
      ],
    });
    const r = measureMotion(prepareGuide(g), { n: 600, config });
    expect(byId(r, 'M7v')?.ok, byId(r, 'M7v')?.where).toBe(false);
    expect(byId(r, 'M7v')?.value ?? 0).toBeGreaterThan(2.5);
  });

  it('measures at the bake rate asked for (60 fps halves the frame step, not the ratio)', () => {
    const p = prepareGuide(legGuide(0.5));
    const r30 = measureMotion(p, { n: 600, config });
    const r60 = measureMotion(p, { n: 600, config, fps: 60 });
    expect(r30.fps).toBe(30);
    expect(r60.fps).toBe(60);
    expect(byId(r60, 'M6')?.limit).toContain('60 fps');
    expect(byId(r60, 'M7v')?.value ?? 9).toBeLessThan(2);
    expect(byId(r60, 'M8')?.value ?? 1).toBeLessThan(byId(r30, 'M8')?.value ?? 0);
  });

  it('gait guides report the frame metrics as warnings (S1–S3 are their gates)', () => {
    const r = measureMotion(prepareGuide(committed('sled-push')), { n: 600 });
    for (const id of ['M7v', 'M8', 'J5', 'J6']) expect(byId(r, id)?.level, id).toBe('warn');
    expect(byId(r, 'S1')?.level).toBe('quality');
  });
});

describe('seam velocity (C6)', () => {
  it('every committed guide closes its loop without a velocity step', () => {
    for (const id of GUIDE_IDS) {
      const m = seamVelocity(prepareGuide(committed(id)));
      expect(m.ok, `${id} ${m.where}`).toBe(true);
      expect(m.value ?? 1, id).toBeLessThan(1e-3);
    }
  });

  it('fails a cycle that turns back at the seam at speed (linear segments)', () => {
    const g = baseGuide({
      keyframes: [
        { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.5, pelvisDeg: 0 }, ease: 'linear' },
        { t: 0.5, root: { x: 0, y: 0.4 }, ease: 'linear' },
        { t: 1, sameAs: 0 },
      ],
    });
    const m = seamVelocity(prepareGuide(g));
    expect(m.level).toBe('hard');
    expect(m.ok).toBe(false);
    // 0.1 H in 1.5 s each way: the hip goes from rising at 0.067 H/s to falling at 0.067 H/s.
    expect(m.value ?? 0).toBeCloseTo(0.1333, 3);
  });

  it('a ping-pong that is still at both ends passes; one moving at an end fails', () => {
    const still = baseGuide({
      loop: 'pingpong',
      keyframes: [
        { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.5, pelvisDeg: 0 }, ease: 'smooth' },
        { t: 1, label: 'Bottom', caption: 'Low', root: { x: 0, y: 0.4, pelvisDeg: 0 } },
      ],
    });
    expect(seamVelocity(prepareGuide(still)).ok).toBe(true);
    const moving = baseGuide({ loop: 'pingpong', keyframes: still.keyframes.map((k, i) => (i === 0 ? { ...k, ease: 'linear' as const } : k)) });
    expect(seamVelocity(prepareGuide(moving)).ok).toBe(false);
  });
});

/** A rep whose pelvis leans back and returns within each phase (0 → −5° → 0), like the overhead press. */
function leanGuide(leanDeg = -5): Guide {
  return baseGuide({
    motion: 'phases',
    keyframes: [
      { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.52, pelvisDeg: 0 }, ease: 'smooth' },
      { t: 0.2, pass: true, root: { x: 0, y: 0.47, pelvisDeg: leanDeg }, ease: 'smooth' },
      { t: 0.45, label: 'Low', caption: 'Low', root: { x: 0, y: 0.4, pelvisDeg: 0 }, holdMs: 150, ease: 'smooth' },
      { t: 0.8, sameAs: 1 },
      { t: 1, sameAs: 0 },
    ],
  });
}

describe('declared excursions (J2) and allowances', () => {
  it('counts direction changes, ignoring wobbles under the deadband', () => {
    expect(countTurns([0, -1, -3, -5, -3, 0])).toBe(1);
    expect(countTurns([0, 1, 2, 3])).toBe(0);
    expect(countTurns([0, -2, 0, -2, 0])).toBe(3);
    expect(countTurns([0, 0.01, 0, 0.02, 1])).toBe(0);
  });

  it('an undeclared out-and-back fails J2.any; declared within its amplitude it passes, with the reason in the report', () => {
    const p = prepareGuide(leanGuide());
    const bare = measureMotion(p, { n: 600, config });
    expect(byId(bare, 'J2.any')?.ok).toBe(false);
    expect(byId(bare, 'J2.any')?.where).toContain('pelvis');
    const declared = measureMotion(p, { n: 600, config: { ...config, excursions: { pelvis: { maxDeg: 6, why: 'lean back' } } } });
    expect(byId(declared, 'J2.any')?.ok).toBe(true);
    expect(byId(declared, 'J2.any')?.allowance).toContain('pelvis out-and-back 5.00° ≤ 6°');
    expect(byId(declared, 'J2.any')?.allowance).toContain('lean back');
  });

  it('a bigger excursion than declared still fails', () => {
    const p = prepareGuide(leanGuide(-8));
    const r = measureMotion(p, { n: 600, config: { ...config, excursions: { pelvis: { maxDeg: 6, why: 'lean back' } } } });
    expect(byId(r, 'J2.any')?.ok).toBe(false);
    expect(byId(r, 'J2.any')?.allowance).toBeUndefined();
  });

  it('the overhead press declares its lean-back', () => {
    expect(MOTION_CONFIG['barbell-overhead-press']?.excursions?.pelvis?.maxDeg).toBe(6);
    const r = measureMotion(prepareGuide(committed('barbell-overhead-press')), { n: 600 });
    expect(byId(r, 'J2.any')?.ok).toBe(true);
    expect(byId(r, 'J2.any')?.allowance).toContain('clear the face');
  });

  it('an allowance relaxes a quality limit for one guide and says so; it changes nothing else', () => {
    const p = prepareGuide(committed('cable-lat-pulldown'));
    // The committed config carries the allowance (plan r2 §2.4 (b)); measure without it, then with it.
    expect(MOTION_CONFIG['cable-lat-pulldown']?.allowance?.limits).toEqual({ syncMs: 300, syncGap: 0.35 });
    const committedConfig = MOTION_CONFIG['cable-lat-pulldown'] as MotionConfig;
    const base: MotionConfig = { main: committedConfig.main, primary: committedConfig.primary, pairs: committedConfig.pairs };
    const strict = measureMotion(p, { n: 600, config: base });
    expect(byId(strict, 'J3.gap')?.ok).toBe(false);
    const relaxed = measureMotion(p, { n: 600, config: { ...base, allowance: { limits: { syncMs: 300, syncGap: 0.35 }, why: 'front-view IK with a vertical bar' } } });
    expect(byId(relaxed, 'J3.gap')?.ok).toBe(true);
    expect(byId(relaxed, 'J3.t50')?.ok).toBe(true);
    expect(byId(relaxed, 'J3.gap')?.limit).toContain('35.0%');
    expect(byId(relaxed, 'J3.gap')?.allowance).toBe('syncGap 0.35 instead of 0.25: front-view IK with a vertical bar');
    expect(byId(relaxed, 'M7v')?.allowance).toBeUndefined();
    expect(byId(relaxed, 'M7v')?.value).toBe(byId(strict, 'M7v')?.value);
  });
});
