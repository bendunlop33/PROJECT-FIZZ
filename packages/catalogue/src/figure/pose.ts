/**
 * Pose solving: interpolated keyframe state → joint positions, effective
 * angles, body capsules and prop shapes. Pure and deterministic; the same
 * code feeds the Linux renderer/checks and (later) the in-app Skia player.
 *
 * Angle conventions (figure facing right; `facing: left` only mirrors the drawing):
 * - `root.pelvisDeg`: pelvis tilt from vertical, forward lean positive.
 *   Front view: sideways tilt, towards the figure's left (+x) positive.
 * - `lumbar`, `thoracic`, `neck`: flexion (forward bend) relative to the parent.
 * - `hip*`: thigh relative to the pelvis, 0 = in line, flexion (knee forward) positive.
 * - `knee*`: 0 = straight, flexion positive (shank folds back).
 * - `ankle*`: dorsiflexion positive (0 = foot at 90° to the shank).
 * - `shoulder*`: upper arm relative to the trunk, 0 = hanging, 90 = forward, 180 = overhead.
 * - `elbow*`: 0 = straight, flexion positive (forearm folds forward/up).
 * - Front view: `shoulder*`/`hip*` are abduction (outward positive), `elbow*`/`knee*` bend outward positive.
 *
 * A limb with a `projection` factor below 1 points partly at the camera, so
 * its projected joint angle has no meaningful sign; it is reported as the
 * fold magnitude and marked in `outOfPlane`.
 */
import type { Guide, GuideProp } from './guide-schema';
import { solveTwoBoneIk } from './ik';
import { resolveKeyframes, stateAt, type FootTarget, type FrameState, type HandTarget, type ResolvedKeyframe } from './keyframes';
import { add, angleFromDown, dist, fromDown, fromUp, perpCcw, rad, scale, sub, v, wrapDeg, type Vec } from './math';
import {
  barbellShapes,
  benchShapes,
  cableStackShapes,
  dumbbellShapes,
  frontBarbellShapes,
  legPressGeometry,
  pushSledGeometry,
  type Collider,
  type LegPressContact,
  type PropGeometry,
  type Shape,
} from './props';
import { ADULT_V1, type AngleName } from './rig';

const R = ADULT_V1;

export interface FootContact {
  limb: 'footNear' | 'footFar';
  heel: Vec;
  ball: Vec;
  toe: Vec;
  /** Ankle where IK wanted it, and where it ended up. */
  wanted: Vec | null;
  ankle: Vec;
  planted: boolean;
  /** Which sole point is the contact: under the ankle (flat foot) or the ball. */
  pivot: 'ankle' | 'ball';
  reached: boolean;
}

export interface HandContact {
  limb: 'handNear' | 'handFar';
  prop: string | null;
  wanted: Vec;
  actual: Vec;
  reached: boolean;
}

export interface Pose {
  t: number;
  view: Guide['view'];
  facing: Guide['facing'];
  /** Named joint positions (world units). */
  points: Record<string, Vec>;
  angles: Partial<Record<AngleName, number>>;
  outOfPlane: AngleName[];
  shapes: Shape[];
  head: { c: Vec; r: number };
  feet: FootContact[];
  hands: HandContact[];
  /** Prop reference points (bar centre, dumbbell centre, sled grip). */
  propPoints: Record<string, Vec>;
  colliders: Collider[];
  solidBottoms: number[];
  groundY: number;
  /** Floor pattern offset for scrolling floors (world units, already wrapped by the renderer). */
  groundOffset: number;
}

/** A guide prepared for sampling: keyframes resolved once. */
export interface PreparedGuide {
  guide: Guide;
  keys: ResolvedKeyframe[];
}

export function prepareGuide(guide: Guide): PreparedGuide {
  return { guide, keys: resolveKeyframes(guide) };
}

interface Trunk {
  hip: Vec;
  lumbarBase: Vec;
  thoraxBase: Vec;
  c7: Vec;
  neckTop: Vec;
  head: Vec;
  leans: { pelvis: number; lumbar: number; thorax: number; neck: number };
  shoulderNear: Vec;
  shoulderFar: Vec;
  hipNear: Vec;
  hipFar: Vec;
}

const frontOf = (leanDeg: number): Vec => v(Math.cos(rad(leanDeg)), -Math.sin(rad(leanDeg)));

function solveTrunk(s: FrameState, view: Guide['view']): Trunk {
  const hip = v(s.root.x, s.root.y);
  const lp = s.root.pelvisDeg;
  const ll = lp + s.joints.lumbar;
  const lt = ll + s.joints.thoracic;
  const ln = lt + s.joints.neck;
  const lumbarBase = add(hip, scale(fromUp(lp), R.pelvis));
  const thoraxBase = add(lumbarBase, scale(fromUp(ll), R.lumbar));
  const c7 = add(thoraxBase, scale(fromUp(lt), R.thorax));
  const neckTop = add(c7, scale(fromUp(ln), R.neck));
  const shoulderLine = add(thoraxBase, scale(fromUp(lt), R.thorax * R.shoulderAt));
  if (view === 'side') {
    const shoulder = add(shoulderLine, scale(frontOf(lt), R.shoulderForward));
    const head = add(add(neckTop, scale(fromUp(ln), R.headOffset)), scale(frontOf(ln), R.headForward));
    return { hip, lumbarBase, thoraxBase, c7, neckTop, head, leans: { pelvis: lp, lumbar: ll, thorax: lt, neck: ln }, shoulderNear: shoulder, shoulderFar: shoulder, hipNear: hip, hipFar: hip };
  }
  // Front view: "front of" a lean is the figure's left (+x on screen).
  const head = add(neckTop, scale(fromUp(ln), R.headOffset));
  return {
    hip,
    lumbarBase,
    thoraxBase,
    c7,
    neckTop,
    head,
    leans: { pelvis: lp, lumbar: ll, thorax: lt, neck: ln },
    shoulderNear: add(shoulderLine, scale(frontOf(lt), R.front.shoulderHalf)),
    shoulderFar: add(shoulderLine, scale(frontOf(lt), -R.front.shoulderHalf)),
    hipNear: add(hip, scale(frontOf(lp), R.front.hipHalf)),
    hipFar: add(hip, scale(frontOf(lp), -R.front.hipHalf)),
  };
}

function segmentAnchor(trunk: Trunk, segment: 'pelvis' | 'lumbar' | 'thorax' | 'neck', at: number, along: number, front: number): Vec {
  const spans = {
    pelvis: [trunk.hip, trunk.leans.pelvis, R.pelvis],
    lumbar: [trunk.lumbarBase, trunk.leans.lumbar, R.lumbar],
    thorax: [trunk.thoraxBase, trunk.leans.thorax, R.thorax],
    neck: [trunk.c7, trunk.leans.neck, R.neck],
  } as const;
  const [start, lean, length] = spans[segment];
  return add(add(start, scale(fromUp(lean), at * length + along)), scale(frontOf(lean), front));
}

/** Foot frame from a sole angle: u towards the toes, v up out of the sole. */
function footFrame(soleDeg: number): { u: Vec; n: Vec } {
  const u = v(Math.cos(rad(soleDeg)), -Math.sin(rad(soleDeg)));
  return { u, n: perpCcw(u) };
}

const inFoot = (ankle: Vec, u: Vec, n: Vec, a: number, b: number): Vec => add(add(ankle, scale(u, a)), scale(n, b));

export function poseAt(prepared: PreparedGuide, t: number): Pose {
  const { guide, keys } = prepared;
  const s = stateAt(guide, keys, t);
  const view = guide.view;
  const groundY = guide.ground.y;
  const trunk = solveTrunk(s, view);
  const shapes: Shape[] = [];
  const colliders: Collider[] = [];
  const solidBottoms: number[] = [];
  const propPoints: Record<string, Vec> = {};
  const legPress: Record<string, LegPressContact> = {};
  const angles: Partial<Record<AngleName, number>> = {
    pelvis: s.root.pelvisDeg,
    lumbar: s.joints.lumbar,
    thoracic: s.joints.thoracic,
    neck: s.joints.neck,
  };
  const outOfPlane: AngleName[] = [];
  const addGeometry = (g: PropGeometry): void => {
    shapes.push(...g.shapes);
    colliders.push(...g.colliders);
    solidBottoms.push(...g.solidBottoms);
  };

  // 1. Props that don't depend on the limbs.
  const later: GuideProp[] = [];
  for (const p of guide.props) {
    switch (p.type) {
      case 'barbell':
      case 'dumbbell': {
        const a = p.anchor;
        let c: Vec | null = null;
        if (a.kind === 'fixed') c = v(a.x, a.y);
        else if (a.kind === 'keyframed') c = v(s.props[p.id]?.x ?? 0, s.props[p.id]?.y ?? 0);
        else if (a.kind === 'segment') c = segmentAnchor(trunk, a.segment, a.at, a.along ?? 0, a.front ?? 0);
        if (c === null) later.push(p);
        else propPoints[p.id] = c;
        break;
      }
      case 'bench':
        addGeometry(benchShapes(p.id, { x: p.x, length: p.length ?? 0.68, height: p.height ?? 0.24, angleDeg: p.angleDeg ?? 0 }, groundY));
        break;
      case 'leg_press': {
        const lp = legPressGeometry(p.id, p, s.props[p.id]?.s ?? 0, groundY);
        addGeometry(lp.geometry);
        legPress[p.id] = lp.contact;
        propPoints[p.id] = lp.contact.point;
        break;
      }
      case 'push_sled': {
        const sled = pushSledGeometry(p.id, p, groundY);
        addGeometry(sled.geometry);
        propPoints[p.id] = sled.grip;
        break;
      }
      case 'cable_stack':
        later.push(p);
        break;
    }
  }

  const proj = s.proj;
  const points: Record<string, Vec> = {
    hip: trunk.hip,
    lumbarBase: trunk.lumbarBase,
    thoraxBase: trunk.thoraxBase,
    c7: trunk.c7,
    neckTop: trunk.neckTop,
    head: trunk.head,
  };
  const feet: FootContact[] = [];
  const hands: HandContact[] = [];
  const sideSign = (side: 'Near' | 'Far'): number => (view === 'front' && side === 'Far' ? -1 : 1);
  const flipBend = (bend: 'ccw' | 'cw', side: 'Near' | 'Far'): 'ccw' | 'cw' => (sideSign(side) < 0 ? (bend === 'ccw' ? 'cw' : 'ccw') : bend);
  const lean = view === 'side' ? trunk.leans.pelvis : 0;
  const thoraxLean = view === 'side' ? trunk.leans.thorax : 0;

  // 2. Legs.
  for (const side of ['Near', 'Far'] as const) {
    const sign = sideSign(side);
    const limb = `foot${side}` as const;
    const hipPt = side === 'Near' ? trunk.hipNear : trunk.hipFar;
    const k = proj[`leg${side}`] ?? 1;
    const thighL = R.thigh * k;
    const shankL = R.shank * k;
    const target: FootTarget | null = s.ik[limb];
    let knee: Vec;
    let ankle: Vec;
    let u: Vec;
    let n: Vec;
    let wanted: Vec | null = null;
    let reached = true;
    let footPivot: 'ankle' | 'ball' = 'ankle';
    if (target !== null) {
      let contact = v(target.x, target.y);
      let soleDeg = target.soleDeg;
      let pivot = target.pivot;
      if (target.prop !== null) {
        const c = legPress[target.prop];
        if (c !== undefined) {
          contact = c.point;
          soleDeg = c.soleDeg;
          pivot = 'ankle';
        }
      }
      ({ u, n } = footFrame(view === 'side' ? soleDeg : 0));
      footPivot = view === 'side' ? pivot : 'ankle';
      const lx = footPivot === 'ball' ? R.foot.ball : 0;
      wanted = sub(sub(contact, scale(u, lx)), scale(n, -R.foot.ankleHeight));
      const bend = target.bend ?? (view === 'side' ? 'ccw' : 'cw');
      const sol = solveTwoBoneIk(hipPt, wanted, thighL, shankL, flipBend(bend, side));
      knee = sol.mid;
      ankle = sol.end;
      reached = sol.reached;
    } else {
      const aThigh = view === 'side' ? s.joints[`hip${side}`] - lean : sign * s.joints[`hip${side}`];
      knee = add(hipPt, scale(fromDown(aThigh), thighL));
      const aShank = view === 'side' ? aThigh - s.joints[`knee${side}`] : aThigh + sign * s.joints[`knee${side}`];
      ankle = add(knee, scale(fromDown(aShank), shankL));
      const aFoot = aShank + 90 + s.joints[`ankle${side}`];
      u = view === 'side' ? fromDown(aFoot) : v(1, 0);
      n = perpCcw(u);
    }
    const aThigh = angleFromDown(sub(knee, hipPt));
    const aShank = angleFromDown(sub(ankle, knee));
    const kneeAngle = view === 'side' ? wrapDeg(aThigh - aShank) : sign * wrapDeg(aShank - aThigh);
    angles[`hip${side}`] = view === 'side' ? wrapDeg(aThigh + lean) : sign * wrapDeg(aThigh);
    angles[`knee${side}`] = k < 1 ? Math.abs(kneeAngle) : kneeAngle;
    if (k < 1) outOfPlane.push(`knee${side}`);
    angles[`ankle${side}`] = view === 'side' ? wrapDeg(angleFromDown(u) - aShank - 90) : 0;
    const heel = view === 'side' ? inFoot(ankle, u, n, R.foot.heel, -R.foot.ankleHeight) : add(ankle, v(-0.03 * sign, -R.foot.ankleHeight));
    const ball = view === 'side' ? inFoot(ankle, u, n, R.foot.ball, -R.foot.ankleHeight) : ankle;
    let toe = view === 'side' ? inFoot(ankle, u, n, R.foot.toe, -R.foot.ankleHeight) : add(ankle, v(0.035 * sign, -R.foot.ankleHeight));
    // Toes bend at the ball: on a raised heel they stay flat instead of dipping below the ball.
    if (view === 'side' && toe.y < ball.y && target?.prop == null) toe = add(ball, v(Math.sign(u.x || 1) * (R.foot.toe - R.foot.ball), 0));
    feet.push({ limb, heel, ball, toe, wanted, ankle, planted: target?.planted ?? false, pivot: footPivot, reached });
    points[`hip${side}`] = hipPt;
    points[`knee${side}`] = knee;
    points[`ankle${side}`] = ankle;
    points[`heel${side}`] = heel;
    points[`toe${side}`] = toe;
    const layer = view === 'side' && side === 'Far' ? 'far' : 'near';
    const paint = layer === 'far' ? 'farBody' : 'nearBody';
    const rr = R.radius;
    const group = `leg${side}`;
    const limbCap = (a: Vec, b: Vec, ra: number, rb: number): Shape => ({ kind: 'capsule', layer, a, b, ra, rb, paint, outline: 'background', group });
    shapes.push(limbCap(hipPt, knee, rr.thighHip, rr.thighKnee));
    shapes.push(limbCap(knee, ankle, rr.shankKnee, rr.shankAnkle));
    if (view === 'side') {
      const heelTop = inFoot(ankle, u, n, R.foot.heel + 0.012, -R.foot.ankleHeight + rr.foot);
      const ballTop = inFoot(ankle, u, n, R.foot.ball, -R.foot.ankleHeight + rr.foot * 0.85);
      const toeDir = scale(sub(toe, ball), 1 / Math.max(1e-9, dist(toe, ball)));
      const toeTop = add(add(toe, scale(toeDir, -rr.foot * 0.5)), scale(perpCcw(toeDir), Math.sign(toeDir.x || 1) * rr.foot * 0.7));
      shapes.push(limbCap(ballTop, toeTop, rr.foot * 0.85, rr.foot * 0.7));
      shapes.push(limbCap(heelTop, ballTop, rr.foot, rr.foot * 0.85));
      shapes.push(limbCap(ankle, heelTop, rr.shankAnkle, rr.foot));
    } else {
      shapes.push(limbCap(ankle, add(ankle, v(0.012 * sign, -R.foot.ankleHeight + rr.foot)), rr.shankAnkle, rr.foot * 1.4));
    }
  }

  // 3. Arms.
  for (const side of ['Near', 'Far'] as const) {
    const sign = sideSign(side);
    const limb = `hand${side}` as const;
    const shoulder = side === 'Near' ? trunk.shoulderNear : trunk.shoulderFar;
    const ku = proj[`arm${side}`] ?? 1;
    const kf = proj[`forearm${side}`] ?? ku;
    const k = Math.min(ku, kf);
    const upperL = R.upperArm * ku;
    const foreL = R.forearm * kf;
    const gripL = R.grip * kf;
    const target: HandTarget | null = s.ik[limb];
    let elbow: Vec;
    let wrist: Vec;
    let grip: Vec;
    if (target !== null) {
      const propPt = target.prop === null ? undefined : gripPoint(guide, target.prop, propPoints, side);
      const wanted = propPt ?? v(target.x, target.y);
      const bend = target.bend ?? (view === 'side' ? 'ccw' : 'cw');
      const sol = solveTwoBoneIk(shoulder, wanted, upperL, foreL + gripL, flipBend(bend, side));
      elbow = sol.mid;
      grip = sol.end;
      const fd = sub(grip, elbow);
      wrist = add(elbow, scale(fd, foreL / (foreL + gripL)));
      hands.push({ limb, prop: target.prop, wanted, actual: grip, reached: sol.reached });
    } else {
      const aUpper = view === 'side' ? s.joints[`shoulder${side}`] - thoraxLean : sign * s.joints[`shoulder${side}`];
      elbow = add(shoulder, scale(fromDown(aUpper), upperL));
      const aFore = aUpper + sign * s.joints[`elbow${side}`];
      wrist = add(elbow, scale(fromDown(aFore), foreL));
      grip = add(wrist, scale(fromDown(aFore + sign * s.joints[`wrist${side}`]), gripL));
    }
    const aUpper = angleFromDown(sub(elbow, shoulder));
    const aFore = angleFromDown(sub(wrist, elbow));
    const elbowAngle = sign * wrapDeg(aFore - aUpper);
    angles[`shoulder${side}`] = view === 'side' ? wrapDeg(aUpper + thoraxLean) : sign * wrapDeg(aUpper);
    angles[`elbow${side}`] = k < 1 ? Math.abs(elbowAngle) : elbowAngle;
    if (k < 1) outOfPlane.push(`elbow${side}`);
    angles[`wrist${side}`] = target === null ? s.joints[`wrist${side}`] : 0;
    points[`shoulder${side}`] = shoulder;
    points[`elbow${side}`] = elbow;
    points[`wrist${side}`] = wrist;
    points[`grip${side}`] = grip;
    const layer = view === 'side' && side === 'Far' ? 'far' : 'near';
    const paint = layer === 'far' ? 'farBody' : 'nearBody';
    const rr = R.radius;
    const gripDir = scale(sub(grip, wrist), 1 / Math.max(1e-9, dist(grip, wrist)));
    const handEnd = add(grip, scale(gripDir, (R.hand - R.grip) * kf));
    const group = `arm${side}`;
    shapes.push({ kind: 'capsule', layer, a: shoulder, b: elbow, ra: rr.upperArmShoulder, rb: rr.upperArmElbow, paint, outline: 'background', group });
    shapes.push({ kind: 'capsule', layer, a: elbow, b: wrist, ra: rr.forearmElbow, rb: rr.forearmWrist, paint, outline: 'background', group });
    shapes.push({ kind: 'capsule', layer, a: wrist, b: handEnd, ra: rr.hand, rb: rr.hand * 0.9, paint, outline: 'background', group });
  }

  // 4. Props that hang from the hands, and the cable.
  for (const p of later) {
    if (p.type === 'dumbbell' && p.anchor.kind === 'hand') {
      const c = points[p.anchor.hand === 'near' ? 'gripNear' : 'gripFar'];
      if (c !== undefined) {
        propPoints[p.id] = c;
        addGeometry(dumbbellShapes(p.id, c, p.size));
      }
    } else if (p.type === 'barbell' && p.anchor.kind === 'hand') {
      const c = points[p.anchor.hand === 'near' ? 'gripNear' : 'gripFar'];
      if (c !== undefined) propPoints[p.id] = c;
    } else if (p.type === 'cable_stack') {
      const hand = points[p.hand === 'near' ? 'gripNear' : 'gripFar'];
      if (hand !== undefined) {
        propPoints[p.id] = hand;
        addGeometry(cableStackShapes(p.id, { x: p.x, pulleyY: p.pulleyY, handle: p.handle, restLength: p.restLength ?? null }, hand, groundY));
      }
    }
  }
  for (const p of guide.props) {
    const c = propPoints[p.id];
    if (c === undefined) continue;
    if (p.type === 'barbell') addGeometry(view === 'front' ? frontBarbellShapes(p.id, c, p.plates) : barbellShapes(p.id, c, p.plates));
    if (p.type === 'dumbbell' && p.anchor.kind !== 'hand') addGeometry(dumbbellShapes(p.id, c, p.size));
  }

  // 5. Trunk, neck and head (drawn between the far and near limbs).
  const rr = R.radius;
  if (view === 'side') {
    shapes.push({ kind: 'capsule', layer: 'body', a: trunk.hip, b: trunk.lumbarBase, ra: rr.pelvis, rb: rr.lumbar, paint: 'nearBody' });
    shapes.push({ kind: 'capsule', layer: 'body', a: trunk.lumbarBase, b: trunk.thoraxBase, ra: rr.lumbar, rb: rr.thoraxLow, paint: 'nearBody' });
    shapes.push({ kind: 'capsule', layer: 'body', a: trunk.thoraxBase, b: add(trunk.c7, scale(fromUp(trunk.leans.thorax), -0.025)), ra: rr.thoraxLow, rb: rr.thoraxHigh, paint: 'nearBody' });
  } else {
    const w = (lean: number, half: number, at: Vec, dy = 0): [Vec, Vec] => [add(at, add(scale(frontOf(lean), half), v(0, dy))), add(at, add(scale(frontOf(lean), -half), v(0, dy)))];
    const [hl, hr] = w(trunk.leans.pelvis, 0.1, trunk.hip, -0.03);
    const [wl, wr] = w(trunk.leans.lumbar, 0.085, trunk.thoraxBase);
    const [sl, sr] = w(trunk.leans.thorax, 0.125, trunk.c7, -0.03);
    shapes.push({ kind: 'poly', layer: 'body', points: [hl, wl, sl, sr, wr, hr], fill: 'nearBody', stroke: 'nearBody', width: 0.05 });
  }
  shapes.push({ kind: 'capsule', layer: 'body', a: trunk.c7, b: trunk.neckTop, ra: rr.neck, rb: rr.neck, paint: 'nearBody' });
  const head = { c: trunk.head, r: R.headRadius };
  shapes.push({ kind: 'circle', layer: 'body', c: head.c, r: head.r, fill: 'nearBody' });

  const scroll = guide.ground.scrollPerCycle;
  return {
    t,
    view,
    facing: guide.facing,
    points,
    angles,
    outOfPlane,
    shapes,
    head,
    feet,
    hands,
    propPoints,
    colliders,
    solidBottoms,
    groundY,
    groundOffset: -scroll * t,
  };
}

export type { PropGeometry, Shape };

/** Where a hand holds a prop. In the front view a bar is held either side of its centre. */
function gripPoint(guide: Guide, propId: string, propPoints: Record<string, Vec>, side: 'Near' | 'Far'): Vec | undefined {
  const c = propPoints[propId];
  if (c === undefined) return undefined;
  const prop = guide.props.find((p) => p.id === propId);
  if (guide.view === 'front' && prop?.type === 'barbell') {
    const half = prop.gripHalfWidth ?? 0.24;
    return add(c, v(side === 'Near' ? half : -half, 0));
  }
  return c;
}
