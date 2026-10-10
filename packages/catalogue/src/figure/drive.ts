/**
 * Joint-driven channel (ADR 0017, E6): a guide may let the near knee drive the
 * hip height (`"drive": { "joint": "kneeNear", "solves": "root.y" }`).
 *
 * Why: with a planted foot the knee is solved by IK from the hip. Near a
 * straight knee its angle is about 2·acos(r) for the leg's reach r, so
 * dθ/dr = 2/√(1 − r²) is huge: a hip easing into a straight-knee stop on its
 * minimum-jerk path keeps the knee turning fast until the last 2–3 frames and
 * then stops it dead (the squat's lockout snap, M8 44%, J5 3.67×). Driving the
 * hip height from the knee angle instead makes the *knee* follow the phase's
 * minimum-jerk progress, so it eases into the lockout.
 *
 * How, per phase (stop to stop, phases mode): the knee flexion θ at each key
 * comes from the resolved key pose (law of cosines on |hip → ankle target|
 * with the projected thigh and shank). θ is a C2 spline in the phase's
 * minimum-jerk progress u through those values (the same rules as the
 * channels: natural ends, turning knots kept C2 as in E5, the monotone
 * guard). At time t the hip height is solved in closed form so the leg's IK
 * gives exactly θ; root.x, the pelvis and every other channel stay on their
 * own splines, so the bar's horizontal path doesn't change.
 *
 * Guarantees: at a stop (and at every key time) the state is the authored key
 * state, bit for bit; velocity and acceleration are zero at stops (du/dt and
 * d²u/dt² are), so holds and the loop seam stay seamless. Planted feet don't
 * move (the ankle target is untouched). A frame with no solution (the wanted
 * hip-to-ankle distance is shorter than their horizontal gap) keeps the
 * Cartesian height and counts as a `drive-miss` (a hard check failure).
 *
 * Pure: `pose.ts` applies it (`drivenStateAt`), `guide:check` and
 * `guide:motion` measure it. The plan is cached per resolved key list.
 */
import { effectiveProjection, phaseSpans, type FootTarget, type FrameState, type PhaseSpan, type ResolvedKeyframe } from './keyframes';
import type { Guide } from './guide-schema';
import { deg, hermite, minimumJerk, phaseTurnSlopes, rad, splineSlopes, v, type Vec } from './math';
import { ADULT_V1 } from './rig';

const R = ADULT_V1;

/** One phase of the driver: knot progress, key flexion (degrees) and slopes (per unit u). */
export interface DrivePhase {
  span: PhaseSpan;
  /** Knee flexion at each key of the phase, degrees (0 = straight). */
  theta: number[];
  slopes: number[];
  /** Keys of this phase whose pose the drive can't reproduce (leg over-reached or hip below the ankle). */
  unreachable: number[];
}

export interface DrivePlan {
  joint: 'kneeNear';
  solves: 'root.y';
  phases: DrivePhase[];
}

/** Outcome of driving one sampled state. */
export type DriveResult = 'off' | 'driven' | 'miss';

/** The near ankle's wanted position for a planted floor contact (side view), as `poseAt` computes it. */
export function plantedAnkleTarget(target: FootTarget): Vec {
  const c = Math.cos(rad(target.soleDeg));
  const s = Math.sin(rad(target.soleDeg));
  // Foot frame: u towards the toes (c, −s), n up out of the sole (s, c).
  const lx = target.pivot === 'ball' ? R.foot.ball : 0;
  return v(target.x - c * lx + s * R.foot.ankleHeight, target.y + s * lx + c * R.foot.ankleHeight);
}

/** Projected near thigh and shank lengths in this state. */
export function nearLegLengths(state: FrameState): { thigh: number; shank: number } {
  const p = effectiveProjection(state.proj);
  return { thigh: R.thigh * p.legNear, shank: R.shank * p.shankNear };
}

/** Near knee flexion (degrees, 0 = straight) the leg's IK gives in this state, or null if the leg can't reach. */
export function nearKneeFlexion(state: FrameState): number | null {
  const foot = state.ik.footNear;
  if (foot === null) return null;
  const W = plantedAnkleTarget(foot);
  const { thigh, shank } = nearLegLengths(state);
  const d = Math.hypot(state.root.x - W.x, state.root.y - W.y);
  if (d > thigh + shank || d < Math.abs(thigh - shank)) return null;
  const c = (thigh * thigh + shank * shank - d * d) / (2 * thigh * shank);
  return 180 - deg(Math.acos(Math.max(-1, Math.min(1, c))));
}

/** Hip height that gives knee flexion `theta` with the hip at `rootX` over ankle target W; null if there is none. */
export function rootYForFlexion(state: FrameState, theta: number, rootX: number = state.root.x): number | null {
  const foot = state.ik.footNear;
  if (foot === null) return null;
  const W = plantedAnkleTarget(foot);
  const { thigh, shank } = nearLegLengths(state);
  const d2 = thigh * thigh + shank * shank + 2 * thigh * shank * Math.cos(rad(theta));
  const dx = rootX - W.x;
  if (!(d2 > dx * dx)) return null;
  return W.y + Math.sqrt(d2 - dx * dx);
}

/**
 * Slopes for one phase's driver values, with the channel rules: natural ends,
 * a turning or flat interior knot has slope 0 and stays C2 (E5), the monotone
 * guard keeps every segment inside its key values.
 */
function phaseSlopes(u: readonly number[], y: readonly number[]): number[] {
  const n = y.length;
  const secant = (j: number): number => {
    const h = (u[j + 1] ?? 0) - (u[j] ?? 0);
    return h > 0 ? ((y[j + 1] ?? 0) - (y[j] ?? 0)) / h : 0;
  };
  const fixed: (number | null)[] = [];
  for (let j = 0; j < n; j += 1) {
    if (j === 0 || j === n - 1) {
      fixed.push(null);
      continue;
    }
    const a = secant(j - 1);
    const b = secant(j);
    fixed.push(a === 0 || b === 0 || Math.sign(a) !== Math.sign(b) ? 0 : null);
  }
  const turning = fixed.some((m) => m !== null);
  return turning ? phaseTurnSlopes(u, y, fixed).slopes : splineSlopes(u, y, fixed, false);
}

const planCache = new WeakMap<readonly ResolvedKeyframe[], DrivePlan | null>();

/** The driver for a guide with `drive` (null otherwise), cached per resolved key list. */
export function drivePlan(guide: Guide, keys: readonly ResolvedKeyframe[]): DrivePlan | null {
  if (planCache.has(keys)) return planCache.get(keys) ?? null;
  let plan: DrivePlan | null = null;
  if (guide.drive !== undefined && guide.motion === 'phases' && guide.view === 'side') {
    const phases: DrivePhase[] = [];
    for (const span of phaseSpans(keys)) {
      const theta: number[] = [];
      const unreachable: number[] = [];
      for (let k = span.from; k <= span.to; k += 1) {
        const st = keys[k]?.state;
        const th = st === undefined ? null : nearKneeFlexion(st);
        const W = st?.ik.footNear;
        if (th === null || st === undefined || W == null || st.root.y < plantedAnkleTarget(W).y) unreachable.push(k);
        theta.push(th ?? 0);
      }
      phases.push({ span, theta, slopes: unreachable.length > 0 ? theta.map(() => 0) : phaseSlopes(span.u, theta), unreachable });
    }
    plan = { joint: guide.drive.joint, solves: guide.drive.solves, phases };
  }
  planCache.set(keys, plan);
  return plan;
}

/** Driver flexion at normalised time t inside a phase (A < t < B), from its spline in u. */
export function driverFlexion(ph: DrivePhase, t: number): number {
  const { A, B, u: knots } = ph.span;
  const u = B > A ? minimumJerk((t - A) / (B - A)) : 1;
  let i = 0;
  while (i < knots.length - 2 && (knots[i + 1] ?? 1) <= u) i += 1;
  const u0 = knots[i] ?? 0;
  const h = (knots[i + 1] ?? 1) - u0;
  return hermite(ph.theta[i] ?? 0, ph.theta[i + 1] ?? 0, ph.slopes[i] ?? 0, ph.slopes[i + 1] ?? 0, h > 0 ? (u - u0) / h : 1, h);
}

/**
 * Drive `state` (sampled at normalised time t by `stateAt`) in place: sets the
 * hip height so the near knee has the driver's flexion. Untouched at stops,
 * holds, key times and outside drive guides.
 */
export function applyDrive(guide: Guide, keys: readonly ResolvedKeyframe[], state: FrameState, t: number): DriveResult {
  const plan = drivePlan(guide, keys);
  if (plan === null) return 'off';
  const ph = plan.phases.find((p) => t > p.span.A && t < p.span.B);
  if (ph === undefined) return 'off';
  // Exactly the key pose at a key time (stateAt already returns it bit for bit).
  for (let k = ph.span.from; k <= ph.span.to; k += 1) if (keys[k]?.t === t) return 'off';
  if (ph.unreachable.length > 0) return 'miss';
  const y = rootYForFlexion(state, driverFlexion(ph, t));
  if (y === null) return 'miss';
  state.root.y = y;
  return 'driven';
}

/** D1 and the authoring aid: each pass key's flexion against its phase's stop-to-stop line in u. */
export interface DriveKeyLine {
  key: number;
  label: string | null;
  t: number;
  /** Authored flexion at the key and the line's value at its progress, degrees. */
  theta: number;
  line: number;
  /** Authored root.y and the root.y that puts the key on the line (null if there is none). */
  rootY: number;
  suggestedRootY: number | null;
}

/**
 * For drive guides: every pass key's knee flexion against the straight line
 * from its phase's first stop to its last in u. Keys on the line make the
 * driver exactly linear in u (a C2 spline through collinear knots is that
 * line), the best-measured shape (plan §1.2); `suggestedRootY` puts the key
 * there without moving root.x or the pelvis.
 */
export function driveKeyLines(guide: Guide, keys: readonly ResolvedKeyframe[]): DriveKeyLine[] {
  const plan = drivePlan(guide, keys);
  if (plan === null) return [];
  const out: DriveKeyLine[] = [];
  for (const ph of plan.phases) {
    const n = ph.theta.length;
    const a = ph.theta[0] ?? 0;
    const b = ph.theta[n - 1] ?? 0;
    for (let j = 1; j < n - 1; j += 1) {
      const key = keys[ph.span.from + j];
      if (key === undefined || !key.pass) continue;
      const line = a + (b - a) * (ph.span.u[j] ?? 0);
      const y = rootYForFlexion(key.state, line);
      out.push({ key: key.index, label: key.label, t: key.t, theta: ph.theta[j] ?? 0, line, rootY: key.state.root.y, suggestedRootY: y === null ? null : Number(y.toFixed(4)) });
    }
  }
  return out;
}
