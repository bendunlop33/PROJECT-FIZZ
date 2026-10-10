/**
 * Joint drive (ADR 0017, E6): the near knee drives the hip height in a
 * planted-leg phases guide. Schema rules, exact key poses, planted feet, the
 * seam, the drive-miss and drive-line (D1) checks, and the lockout snap it
 * removes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkGuide,
  driveKeyLines,
  driverFlexion,
  drivePlan,
  drivenStateAt,
  flattenState,
  GuideSchema,
  measureMotion,
  nearKneeFlexion,
  plantedAnkleTarget,
  poseAt,
  prepareGuide,
  seamVelocity,
  stateAt,
  type Guide,
  type MotionConfig,
} from '../src/figure/index';
import { loadCatalogue } from '../src/loader';
import { baseGuide } from './figure-helpers';

const GUIDES = join(import.meta.dirname, '..', 'guides');
const GUIDE_IDS = readdirSync(GUIDES)
  .filter((d) => !d.startsWith('_') && existsSync(join(GUIDES, d, 'guide.json')))
  .sort();
const rawOf = (id: string): Record<string, unknown> => JSON.parse(readFileSync(join(GUIDES, id, 'guide.json'), 'utf8')) as Record<string, unknown>;
const DRIVE = { joint: 'kneeNear', solves: 'root.y' } as const;

/** Stops-only planted-leg squat (as in motion-metrics-r2): `topY` 0.5295 leaves the top knee near straight (reach 0.999). */
function legGuide(topY: number, extra: Record<string, unknown> = {}, pass?: Record<string, unknown>): Guide {
  return baseGuide({
    motion: 'phases',
    keyframes: [
      { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: topY, pelvisDeg: 5 }, ik: { footNear: { x: 0, y: 0, planted: true } }, ease: 'smooth' },
      ...(pass === undefined ? [] : [pass]),
      { t: 0.5, label: 'Bottom', caption: 'Low', root: { x: -0.06, y: 0.36, pelvisDeg: 30 }, holdMs: 200, ease: 'smooth' },
      { t: 1, sameAs: 0 },
    ],
    checks: { planted: ['footNear'], romProfile: 'adult-default' },
    ...extra,
  });
}

/** The committed squat with `drive` turned on (data unchanged). */
const drivenSquat = (): Guide => GuideSchema.parse({ ...rawOf('barbell-back-squat'), drive: DRIVE });

type RawKey = { label?: string; sameAs?: number; root?: { y: number } };
/** The committed squat cut down to its labelled keys (one pass key per phase), so each pass key can be put on its line. */
function labelledSquat(): { keyframes: RawKey[] } {
  const raw = structuredClone(rawOf('barbell-back-squat')) as { keyframes: RawKey[] };
  const all = raw.keyframes;
  const keep = all.map((_, i) => i).filter((i) => all[i]?.label !== undefined || all[all[i]?.sameAs ?? -1]?.label !== undefined);
  raw.keyframes = keep.map((i) => {
    const k: RawKey = { ...all[i] };
    if (k.sameAs !== undefined) k.sameAs = keep.indexOf(k.sameAs);
    return k;
  });
  return raw;
}
const config: MotionConfig = { main: [{ point: 'hip' }], primary: [], pairs: [] };

describe('drive: schema', () => {
  const ok = (extra: Record<string, unknown>, pass?: Record<string, unknown>) => {
    try {
      legGuide(0.5, extra, pass);
      return true;
    } catch {
      return false;
    }
  };

  it('accepts the knee-drives-hip-height pair on a planted-leg phases side view', () => {
    expect(ok({ drive: DRIVE })).toBe(true);
    expect(drivenSquat().drive).toEqual(DRIVE);
  });

  it('rejects other joints or channels, channel mode, a front view and a foot that is not planted on the floor at every key', () => {
    expect(ok({ drive: { joint: 'elbowNear', solves: 'root.y' } })).toBe(false);
    expect(ok({ drive: { joint: 'kneeNear', solves: 'root.x' } })).toBe(false);
    expect(ok({ drive: DRIVE, motion: 'channels' })).toBe(false);
    expect(ok({ drive: DRIVE, view: 'front' })).toBe(false);
    expect(ok({ drive: DRIVE }, { t: 0.2, pass: true, ik: { footNear: { planted: false } } })).toBe(false);
    expect(ok({ drive: DRIVE }, { t: 0.2, pass: true, ik: { footNear: null } })).toBe(false);
    const noFoot = { keyframes: [{ t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.5, pelvisDeg: 0 } }, { t: 1, sameAs: 0 }] };
    expect(ok({ drive: DRIVE, ...noFoot })).toBe(false);
  });

  it('every committed guide stays valid without it (schemaVersion 1, optional field)', () => {
    for (const id of GUIDE_IDS) expect(GuideSchema.safeParse(rawOf(id)).success, id).toBe(true);
  });
});

describe('drive: sampling', () => {
  it('key poses are exactly the authored keys, bit for bit', () => {
    const p = prepareGuide(drivenSquat());
    for (const k of p.keys) expect([...flattenState(drivenStateAt(p, k.t))], `key ${k.index}`).toStrictEqual([...flattenState(k.state)]);
  });

  it('only the hip height changes, and the near knee follows the driver exactly', () => {
    const p = prepareGuide(drivenSquat());
    const plan = drivePlan(p.guide, p.keys);
    expect(plan?.phases.length).toBe(2);
    for (let i = 1; i < 200; i += 1) {
      const t = i / 200;
      const ph = plan?.phases.find((q) => t > q.span.A && t < q.span.B);
      const plain = flattenState(stateAt(p.guide, p.keys, t));
      const driven = flattenState(drivenStateAt(p, t));
      for (const [name, x] of plain) if (name !== 'root.y') expect(driven.get(name), `${name} t=${t}`).toBe(x);
      if (ph === undefined) continue;
      expect(nearKneeFlexion(drivenStateAt(p, t))).toBeCloseTo(driverFlexion(ph, t), 9);
      expect(Math.abs(poseAt(p, t).angles.kneeNear ?? NaN)).toBeCloseTo(driverFlexion(ph, t), 6);
    }
  });

  it('guides without drive are untouched: drivenStateAt is stateAt on all committed guides', () => {
    for (const id of GUIDE_IDS) {
      const p = prepareGuide(GuideSchema.parse(rawOf(id)));
      expect(drivePlan(p.guide, p.keys), id).toBeNull();
      for (let i = 0; i <= 40; i += 1) expect([...flattenState(drivenStateAt(p, i / 40))], `${id} t=${i / 40}`).toStrictEqual([...flattenState(stateAt(p.guide, p.keys, i / 40))]);
    }
  });

  it('planted feet never move (the ankle target is untouched)', () => {
    const p = prepareGuide(drivenSquat());
    const at0 = poseAt(p, 0).feet.map((f) => f.ankle);
    for (let i = 0; i <= 300; i += 1) {
      const pose = poseAt(p, i / 300);
      pose.feet.forEach((f, j) => {
        expect(f.ankle.x).toBeCloseTo(at0[j]?.x ?? NaN, 9);
        expect(f.ankle.y).toBeCloseTo(at0[j]?.y ?? NaN, 9);
      });
      const W = drivenStateAt(p, i / 300).ik.footNear;
      if (W !== null) expect(pose.feet[0]?.ankle.y).toBeCloseTo(plantedAnkleTarget(W).y, 9);
    }
  });

  it('the seam and every hold stay seamless (C1, C6, zero speed leaving a hold) and the squat passes guide:check', () => {
    const p = prepareGuide(drivenSquat());
    expect(seamVelocity(p).ok).toBe(true);
    const r = checkGuide({ raw: drivenSquat(), bytes: 2000, dirKey: 'barbell-back-squat', entry: loadCatalogue([]).catalogue.byKey('barbell-back-squat') ?? null });
    expect(r.items.filter((i) => !i.ok && i.id !== 'exercise-match' && i.id !== 'key-positions' && i.id !== 'focus').map((i) => i.id)).toEqual([]);
    expect(r.items.find((i) => i.id === 'drive')?.ok).toBe(true);
    const bottom = p.keys.find((k) => k.holdEnd > k.t);
    expect(bottom).toBeDefined();
    const h = 1e-5;
    const y = (t: number): number => drivenStateAt(p, t).root.y;
    const e = bottom?.holdEnd ?? 0;
    // Speed and acceleration both ~0 leaving the hold (no lurch): one-sided second differences.
    expect(Math.abs(y(e + h) - y(e)) / h).toBeLessThan(1e-3);
    expect(Math.abs(y(e + 2 * h) - 2 * y(e + h) + y(e)) / (h * h)).toBeLessThan(5);
  });
});

describe('drive: what it fixes and what it checks', () => {
  it('a near-straight knee eases into its stop: M8 and J5 pass with drive, fail without', () => {
    const without = measureMotion(prepareGuide(legGuide(0.5295)), { n: 600, config });
    const withDrive = measureMotion(prepareGuide(legGuide(0.5295, { drive: DRIVE })), { n: 600, config });
    const get = (r: typeof without, id: string) => r.metrics.find((m) => m.id === id);
    expect(get(without, 'M8')?.ok).toBe(false);
    expect(get(without, 'J5')?.ok).toBe(false);
    expect(get(withDrive, 'M8')?.ok).toBe(true);
    expect(get(withDrive, 'J5')?.ok).toBe(true);
    // A driven knee is not reported as an undriven IK reach (J6).
    expect(get(withDrive, 'J6')?.where ?? '').not.toContain('kneeNear');
    expect(get(withDrive, 'D2')?.ok).toBe(true);
  });

  it('D1: a pass key off its stop-to-stop driver line fails; the suggested root.y puts it on the line', () => {
    const raw = labelledSquat();
    const p = prepareGuide(GuideSchema.parse({ ...raw, drive: DRIVE }));
    const r = measureMotion(p, { n: 600 });
    expect(r.metrics.find((m) => m.id === 'D1')?.ok).toBe(false);
    expect(r.drive.length).toBe(2);
    const key = r.drive[0];
    const y = key?.suggestedRootY;
    expect(typeof y).toBe('number');
    const fixed = structuredClone(raw);
    const k1 = fixed.keyframes[key?.key ?? 1];
    if (k1?.root !== undefined) k1.root.y = y ?? 0;
    const g = GuideSchema.parse({ ...fixed, drive: DRIVE });
    const lines = driveKeyLines(g, prepareGuide(g).keys);
    // The suggestion is rounded to 0.0001 H, a few hundredths of a degree.
    for (const l of lines) expect(Math.abs(l.theta - l.line)).toBeLessThan(0.05);
    expect(measureMotion(prepareGuide(g), { n: 600 }).metrics.find((m) => m.id === 'D1')?.ok).toBe(true);
    // Guides without drive: D1 and D2 don't apply.
    const plain = measureMotion(prepareGuide(GuideSchema.parse(rawOf('barbell-back-squat'))), { n: 300 });
    expect(plain.metrics.find((m) => m.id === 'D1')?.where).toBe('n/a');
    expect(plain.drive).toEqual([]);
  });

  it('a key the leg cannot reach is a drive-miss and fails guide:check', () => {
    const g = legGuide(0.5, { drive: DRIVE }, { t: 0.25, pass: true, label: 'Mid', caption: 'Mid', root: { y: 0.6 } });
    const r = checkGuide({ raw: g, bytes: 1000, dirKey: 'test-guide', entry: null });
    const item = r.items.find((i) => i.id === 'drive');
    expect(item?.ok).toBe(false);
    expect(item?.detail).toContain('kneeNear');
    expect(measureMotion(prepareGuide(g), { n: 200, config }).metrics.find((m) => m.id === 'D2')?.ok).toBe(false);
  });
});
