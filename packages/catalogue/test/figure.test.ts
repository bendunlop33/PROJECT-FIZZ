import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADULT_V1,
  capsuleOutline,
  checkGuide,
  DIRECTION_D_GUIDE_TOKENS,
  dist,
  fitCamera,
  GUIDE_PAINT_TOKENS,
  GuideMetaSchema,
  guideStyleFromTokens,
  hermite,
  monotoneSlope,
  poseAt,
  prepareGuide,
  renderSvg,
  resolveKeyframes,
  solveTwoBoneIk,
  stateAt,
  v,
  type CheckId,
  type Guide,
} from '../src/figure/index';
import { loadCatalogue } from '../src/loader';
import { baseGuide, squatEntry, squatRaw } from './figure-helpers';

const GUIDES = join(import.meta.dirname, '..', 'guides');
const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

function failed(raw: unknown, opts: { bytes?: number; dirKey?: string } = {}): CheckId[] {
  const r = checkGuide({ raw, bytes: opts.bytes ?? 2000, dirKey: opts.dirKey ?? 'barbell-back-squat', entry: squatEntry() });
  return r.items.filter((i) => !i.ok).map((i) => i.id);
}

function failedFor(guide: Guide, dirKey = 'test-guide'): CheckId[] {
  const entry = loadCatalogue([]).catalogue.byKey('none') ?? null;
  const items = checkGuide({ raw: guide, bytes: 1000, dirKey, entry }).items;
  if (process.env.DEBUG_CHECKS) console.log(items.filter((i) => !i.ok));
  return items
    .filter((i) => !i.ok)
    .map((i) => i.id)
    .filter((id) => id !== 'exercise-match' && id !== 'key-positions');
}

describe('two-bone IK', () => {
  it('reaches a reachable target with fixed bone lengths', () => {
    const root = v(0, 0.5);
    const target = v(0.1, 0.04);
    const s = solveTwoBoneIk(root, target, 0.245, 0.246, 'ccw');
    expect(s.reached).toBe(true);
    expect(close(dist(root, s.mid), 0.245)).toBe(true);
    expect(close(dist(s.mid, s.end), 0.246, 1e-6)).toBe(true);
    expect(close(dist(s.end, target), 0, 1e-6)).toBe(true);
  });

  it('puts the knee in front for ccw and behind for cw (facing right)', () => {
    const ccw = solveTwoBoneIk(v(0, 0.45), v(0, 0.04), 0.245, 0.246, 'ccw');
    const cw = solveTwoBoneIk(v(0, 0.45), v(0, 0.04), 0.245, 0.246, 'cw');
    expect(ccw.mid.x).toBeGreaterThan(0);
    expect(cw.mid.x).toBeLessThan(0);
  });

  it('reports an unreachable target instead of stretching', () => {
    const s = solveTwoBoneIk(v(0, 0.6), v(0, 0), 0.245, 0.246, 'ccw');
    expect(s.reached).toBe(false);
    expect(close(dist(v(0, 0.6), s.end), 0.491, 1e-6)).toBe(true);
  });
});

describe('interpolation', () => {
  it('monotone slopes never overshoot and are zero at turning points', () => {
    expect(monotoneSlope(1, -1, 1, 1)).toBe(0);
    expect(monotoneSlope(0.1, 10, 1, 1)).toBeCloseTo(0.3);
    for (let s = 0; s <= 1; s += 0.05) {
      const y = hermite(0, 1, 3, 3, s, 1);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('carries values forward, copies sameAs and holds still during holdMs', () => {
    const g = baseGuide({
      keyframes: [
        { t: 0, label: 'A', caption: 'a', root: { x: 0, y: 0.5, pelvisDeg: 0 }, joints: { kneeNear: 10 } },
        { t: 0.5, label: 'B', caption: 'b', root: { y: 0.4 }, holdMs: 300, ease: 'linear' },
        { t: 1, sameAs: 0 },
      ],
    });
    const keys = resolveKeyframes(g);
    expect(keys[1]?.state.joints.kneeNear).toBe(10);
    expect(keys[1]?.state.root.x).toBe(0);
    expect(keys[2]?.state.root.y).toBe(0.5);
    expect(keys[2]?.label).toBe('A');
    const h0 = stateAt(g, keys, 0.5);
    const h1 = stateAt(g, keys, 0.5 + 0.09);
    expect(h0.root.y).toBe(0.4);
    expect(h1.root.y).toBe(0.4);
    expect(stateAt(g, keys, 0.8).root.y).toBeGreaterThan(0.4);
  });

  it('smooth easing passes through keyframes with no overshoot in the squat', () => {
    const p = prepareGuide(squatEntryGuide());
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i <= 200; i += 1) {
      const y = poseAt(p, i / 200).points.hip?.y ?? 0;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const ys = p.keys.map((k) => k.state.root.y);
    expect(minY).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
    expect(maxY).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
  });
});

function squatEntryGuide(): Guide {
  const r = checkGuide({ raw: squatRaw(), bytes: 0, dirKey: 'barbell-back-squat', entry: squatEntry() });
  if (r.guide === null) throw new Error('squat guide invalid');
  return r.guide;
}

describe('rig and pose conventions', () => {
  it('a straight standing leg puts the sole on the floor and every angle at zero', () => {
    const p = poseAt(prepareGuide(baseGuide({ keyframes: [
      { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: ADULT_V1.hipHeight, pelvisDeg: 0 } },
      { t: 1, sameAs: 0 },
    ] })), 0);
    const foot = p.feet[0];
    expect(foot && close(foot.heel.y, 0, 1e-3) && close(foot.toe.y, 0, 1e-3)).toBe(true);
    expect(foot && foot.toe.x > foot.heel.x).toBe(true);
    expect(p.angles.kneeNear).toBeCloseTo(0);
    expect(p.angles.hipNear).toBeCloseTo(0);
    expect(p.angles.ankleNear).toBeCloseTo(0);
    expect(p.points.shoulderNear?.y).toBeCloseTo(0.818, 2);
    expect((p.points.head?.y ?? 0) + ADULT_V1.headRadius).toBeCloseTo(1, 1);
  });

  it('flexion is positive: hip flexion brings the knee forward, knee flexion folds the shank back', () => {
    const p = poseAt(prepareGuide(baseGuide({ keyframes: [
      { t: 0, label: 'Start', caption: 'Sit', root: { x: 0, y: 0.6, pelvisDeg: 0 }, joints: { hipNear: 90, kneeNear: 90, elbowNear: 90 } },
      { t: 1, sameAs: 0 },
    ] })), 0);
    expect(p.points.kneeNear?.x).toBeGreaterThan(0.2);
    expect(p.points.ankleNear?.y).toBeLessThan(p.points.kneeNear?.y ?? 0);
    expect(p.points.wristNear?.x).toBeGreaterThan(p.points.elbowNear?.x ?? 0);
    expect(p.angles.hipNear).toBeCloseTo(90);
    expect(p.angles.kneeNear).toBeCloseTo(90);
  });

  it('limbs never stretch over a cycle', () => {
    const p = prepareGuide(squatEntryGuide());
    for (let i = 0; i <= 50; i += 1) {
      const pose = poseAt(p, i / 50);
      expect(dist(pose.points.hipNear ?? v(0, 0), pose.points.kneeNear ?? v(0, 0))).toBeCloseTo(ADULT_V1.thigh, 6);
      expect(dist(pose.points.kneeNear ?? v(0, 0), pose.points.ankleNear ?? v(0, 0))).toBeCloseTo(ADULT_V1.shank, 6);
    }
  });

  it('front view is mirror-symmetric with elbows outside the grip line', () => {
    const g = baseGuide({
      view: 'front',
      keyframes: [
        {
          t: 0, label: 'Start', caption: 'Reach', root: { x: 0, y: 0.45, pelvisDeg: 0 },
          ik: { handNear: { x: 0.24, y: 1.0 }, handFar: { x: -0.24, y: 1.0 } },
        },
        { t: 1, sameAs: 0 },
      ],
    });
    const p = poseAt(prepareGuide(g), 0);
    const en = p.points.elbowNear;
    const ef = p.points.elbowFar;
    expect(en && ef && close(en.x, -ef.x, 1e-9) && close(en.y, ef.y, 1e-9)).toBe(true);
    // Elbows bend outwards: right of the shoulder→hand line on the figure's left (+x) side.
    const sh = p.points.shoulderNear ?? v(0, 0);
    const cross = (0.24 - sh.x) * ((en?.y ?? 0) - sh.y) - (1.0 - sh.y) * ((en?.x ?? 0) - sh.x);
    expect(cross).toBeLessThan(0);
    expect(p.hands.every((h) => h.reached)).toBe(true);
  });

  it('projection shortens a limb and reports its fold as out of plane', () => {
    const p = poseAt(prepareGuide(squatEntryGuide()), 0);
    expect(p.outOfPlane).toContain('elbowNear');
    expect(p.angles.elbowNear).toBeGreaterThan(0);
  });
});

describe('props', () => {
  it('a dumbbell hangs from the hand', () => {
    const g = baseGuide({
      props: [{ id: 'db', type: 'dumbbell', size: 'medium', anchor: { kind: 'hand', hand: 'near' } }],
    });
    const p = poseAt(prepareGuide(g), 0);
    expect(p.propPoints.db).toEqual(p.points.gripNear);
    expect(p.shapes.some((s) => s.kind === 'circle' && s.layer === 'front')).toBe(true);
  });

  it('a lying figure rests on the bench; lowering it through the pad fails the check', () => {
    const lying = (y: number) =>
      baseGuide({
        props: [{ id: 'bench', type: 'bench', x: -0.3, length: 0.68, height: 0.24 }],
        keyframes: [
          { t: 0, label: 'Start', caption: 'Lie', root: { x: 0.15, y, pelvisDeg: -90 }, joints: { hipNear: 60, kneeNear: 100, hipFar: 60, kneeFar: 100 } },
          { t: 1, sameAs: 0 },
        ],
      });
    expect(failedFor(lying(0.24 + 0.068))).not.toContain('no-penetration');
    expect(failedFor(lying(0.2))).toContain('no-penetration');
  });

  it('leg press: feet sit flat on the moving plate', () => {
    const g = baseGuide({
      props: [{ id: 'press', type: 'leg_press', x: 0.27, y: 0.62, railDeg: 45, seatX: 0, seatY: 0.3, seatDeg: 30, plates: 'large' }],
      keyframes: [
        { t: 0, label: 'Start', caption: 'Press', root: { x: 0.02, y: 0.37, pelvisDeg: -60 }, props: { press: { s: 0.12 } }, ik: { footNear: { prop: 'press' }, footFar: { prop: 'press' } } },
        { t: 0.5, label: 'Bottom', caption: 'Lower', props: { press: { s: 0 } } },
        { t: 1, sameAs: 0 },
      ],
    });
    const prepared = prepareGuide(g);
    for (const t of [0, 0.25, 0.5]) {
      const p = poseAt(prepared, t);
      const foot = p.feet[0];
      expect(foot?.reached).toBe(true);
      // Sole (heel → toe) is perpendicular to the 45° rail.
      const sole = foot ? v(foot.toe.x - foot.heel.x, foot.toe.y - foot.heel.y) : v(0, 0);
      expect(close(sole.x * Math.cos(Math.PI / 4) + sole.y * Math.sin(Math.PI / 4), 0, 1e-9)).toBe(true);
    }
    expect(failedFor(g)).toEqual([]);
  });

  it('cable stack: the cable ends at the hand and the stack lifts as the cable lengthens', () => {
    const at = (elbow: number) =>
      poseAt(prepareGuide(baseGuide({
        props: [{ id: 'cable', type: 'cable_stack', x: 0.3, pulleyY: 1.1, hand: 'near', handle: 'bar', restLength: 0.4 }],
        keyframes: [
          { t: 0, label: 'Start', caption: 'Push', root: { x: 0, y: 0.53, pelvisDeg: 5 }, joints: { shoulderNear: 10, elbowNear: elbow } },
          { t: 1, sameAs: 0 },
        ],
      })), 0);
    const top = at(100);
    const bottom = at(5);
    const cable = top.shapes.find((s) => s.kind === 'line' && s.paint === 'cable');
    expect(cable?.kind === 'line' && cable.b).toEqual(top.points.gripNear);
    const stackY = (p: typeof top) => {
      const s = p.shapes.find((x) => x.kind === 'poly' && x.fill === 'frame');
      return s?.kind === 'poly' ? (s.points[0]?.y ?? 0) : 0;
    };
    expect(stackY(bottom)).toBeGreaterThan(stackY(top));
  });

  it('push sled on a scrolling floor: a planted forefoot rides the floor, hands stay on the poles', () => {
    const sled = (stanceX2: number | undefined) =>
      baseGuide({
        ground: { y: 0, scrollPerCycle: 0.2 },
        props: [{ id: 'sled', type: 'push_sled', x: 0.68, gripY: 0.75, plates: 'small' }],
        keyframes: [
          {
            t: 0, label: 'Drive', caption: 'Drive', root: { x: 0, y: 0.5, pelvisDeg: 45 },
            ik: { footNear: { x: 0.05, y: 0, planted: true, pivot: 'ball', soleDeg: 15 }, handNear: { prop: 'sled', bend: 'cw' }, handFar: { prop: 'sled', bend: 'cw' } },
          },
          { t: 0.5, label: 'Switch', caption: 'Switch', ik: { footNear: stanceX2 === undefined ? { planted: true } : { x: stanceX2, planted: true } } },
          { t: 0.75, ik: { footNear: { planted: false, x: 0, y: 0.06 } } },
          { t: 1, sameAs: 0 },
        ],
        checks: { planted: ['footNear'], romProfile: 'adult-default' },
      });
    const riding = sled(undefined);
    const p = poseAt(prepareGuide(riding), 0.5);
    expect(p.feet[0]?.ball.x).toBeCloseTo(0.05 - 0.2 * 0.5, 6);
    expect(p.groundOffset).toBeCloseTo(-0.1);
    expect(failedFor(riding)).toEqual([]);
    // Holding the foot still while the floor moves is a slide.
    expect(failedFor(sled(0.05))).toContain('planted-feet');
  });
});

describe('guide checks', () => {
  it('the committed squat guide passes every check', () => {
    const r = checkGuide({ raw: squatRaw(), bytes: 2000, dirKey: 'barbell-back-squat', entry: squatEntry() });
    expect(r.items.filter((i) => !i.ok)).toEqual([]);
  });

  it('schema failure stops before the other checks', () => {
    expect(failed({ ...squatRaw(), rig: 'robot' })).toEqual(['schema']);
  });

  it('catches duration, size, captions, labels, folder and loop problems', () => {
    expect(failed({ ...squatRaw(), durationMs: 7000 })).toEqual(['duration']);
    expect(failed(squatRaw(), { bytes: 9000 })).toEqual(['file-size']);
    expect(failed(squatRaw(), { dirKey: 'barbell-front-squat' })).toEqual(['exercise-match']);
    const keys = structuredClone(squatRaw().keyframes) as Record<string, unknown>[];
    const noCaption = keys.map((k, i) => (i === 2 ? { ...k, caption: undefined } : k));
    expect(failed({ ...squatRaw(), keyframes: JSON.parse(JSON.stringify(noCaption)) as unknown })).toEqual(['captions']);
    const relabelled = keys.map((k, i) => (i === 2 ? { ...k, label: 'Hole' } : k));
    expect(failed({ ...squatRaw(), keyframes: relabelled })).toEqual(['key-positions']);
    const open = keys.map((k, i) => (i === keys.length - 1 ? { t: 1, root: { y: 0.45 } } : k));
    expect(failed({ ...squatRaw(), keyframes: open })).toContain('loop-continuity');
  });

  it('catches bar drift, unreachable planted feet and hyperextension', () => {
    expect(failed({ ...squatRaw(), checks: { ...(squatRaw().checks as object), barDriftMax: 0.0001 } })).toEqual(['bar-drift']);
    const keys = structuredClone(squatRaw().keyframes) as { ik?: Record<string, unknown>; joints?: Record<string, number> }[];
    const farFoot = structuredClone(keys);
    if (farFoot[0]?.ik) farFoot[0].ik.footFar = { x: -0.3, y: 0, planted: true };
    expect(failed({ ...squatRaw(), keyframes: farFoot })).toContain('planted-feet');
    // Knee hyperextension (legs are in the picture plane, so the sign is checked).
    const hyper = structuredClone(keys);
    if (hyper[0]?.ik) hyper[0].ik.footNear = null;
    if (hyper[0]?.joints) Object.assign(hyper[0].joints, { hipNear: 0, kneeNear: -30 });
    expect(failed({ ...squatRaw(), keyframes: hyper })).toContain('rom');
  });

  it('every committed guide passes and its meta.json is current-format', () => {
    const entries = loadCatalogue(
      readdirSync(join(import.meta.dirname, '..', 'data', 'exercises')).map(
        (f) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'exercises', f), 'utf8')) as unknown,
      ),
    ).catalogue;
    const ids = readdirSync(GUIDES).filter((d) => !d.startsWith('_') && !d.startsWith('.'));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const path = join(GUIDES, id, 'guide.json');
      const r = checkGuide({ raw: JSON.parse(readFileSync(path, 'utf8')), bytes: statSync(path).size, dirKey: id, entry: entries.byKey(id) ?? null });
      expect(r.items.filter((i) => !i.ok), id).toEqual([]);
      const meta = GuideMetaSchema.parse(JSON.parse(readFileSync(join(GUIDES, id, 'meta.json'), 'utf8')));
      expect(meta.check.status).toBe('pass');
    }
  });
});

describe('SVG output and style', () => {
  const style = guideStyleFromTokens(DIRECTION_D_GUIDE_TOKENS.dark);

  it('is deterministic and uses only guide tokens (never the accent)', () => {
    const p = prepareGuide(squatEntryGuide());
    const camera = fitCamera(p);
    const a = renderSvg(poseAt(p, 0.3), { px: 240, style, camera });
    const b = renderSvg(poseAt(p, 0.3), { px: 240, style, camera });
    expect(a).toBe(b);
    const colours = new Set(a.match(/#[0-9A-Fa-f]{6}/g));
    const allowed = new Set(Object.values(style));
    for (const c of colours) expect(allowed.has(c)).toBe(true);
    expect(a.includes('#EDE5DA')).toBe(false);
    expect(a.includes('<text')).toBe(false);
  });

  it('mirrors when facing left', () => {
    const g = squatEntryGuide();
    const right = prepareGuide(g);
    const left = prepareGuide({ ...g, facing: 'left' });
    const camera = fitCamera(right);
    expect(renderSvg(poseAt(left, 0), { px: 240, style, camera })).not.toBe(renderSvg(poseAt(right, 0), { px: 240, style, camera }));
  });

  it('capsule outlines touch both end circles', () => {
    const pts = capsuleOutline(v(0, 0), v(1, 0), 0.2, 0.1);
    const maxX = Math.max(...pts.map((p) => p.x));
    const minX = Math.min(...pts.map((p) => p.x));
    expect(maxX).toBeCloseTo(1.1, 2);
    expect(minX).toBeCloseTo(-0.2, 2);
  });

  it('the Direction D mirror matches apps/mobile theme tokens', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile', 'src', 'theme', 'tokens.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const PREMIUM_DIRECTION'));
    const dark = block.slice(block.indexOf('dark: {'), block.indexOf('light: {'));
    const light = block.slice(block.indexOf('light: {'), block.indexOf('type: {'));
    const value = (part: string, token: string): string | undefined => new RegExp(`'${token.replace('.', '\\.')}': '(#[0-9A-Fa-f]{6})'`).exec(part)?.[1];
    for (const token of Object.keys(DIRECTION_D_GUIDE_TOKENS.dark) as (keyof typeof DIRECTION_D_GUIDE_TOKENS.dark)[]) {
      expect(DIRECTION_D_GUIDE_TOKENS.dark[token], token).toBe(value(dark, token));
      expect(DIRECTION_D_GUIDE_TOKENS.light[token], token).toBe(value(light, token));
    }
    expect(Object.values(GUIDE_PAINT_TOKENS)).not.toContain('accent');
  });
});
