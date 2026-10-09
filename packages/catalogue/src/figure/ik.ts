import { add, dist, perpCcw, scale, sub, type Vec } from './math';

export interface TwoBoneSolution {
  /** Middle joint (knee or elbow). */
  mid: Vec;
  /** End effector as placed (equals the target when `reached`). */
  end: Vec;
  /** False when the target was out of reach (too far or too close); the chain then points at it. */
  reached: boolean;
}

/**
 * Analytic two-bone IK in the plane (law of cosines). `bend` picks which of
 * the two solutions: the middle joint lies counter-clockwise (`ccw`) or
 * clockwise of the root→target line. Out-of-reach targets give the closest
 * pose along the root→target line and `reached: false` (the checks catch it).
 */
export function solveTwoBoneIk(root: Vec, target: Vec, l1: number, l2: number, bend: 'ccw' | 'cw'): TwoBoneSolution {
  const d = sub(target, root);
  const raw = dist(root, target);
  const maxReach = l1 + l2;
  const minReach = Math.abs(l1 - l2);
  const eps = 1e-9;
  const dir = raw > eps ? scale(d, 1 / raw) : { x: 0, y: -1 };
  const reach = Math.min(Math.max(raw, minReach + eps), maxReach - eps);
  // Distance from root to the foot of the mid joint's perpendicular, and its height.
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const side = bend === 'ccw' ? 1 : -1;
  const mid = add(add(root, scale(dir, a)), scale(perpCcw(dir), h * side));
  const end = add(root, scale(dir, reach));
  const reached = raw <= maxReach + 1e-6 && raw >= minReach - 1e-6;
  return { mid, end: reached ? target : end, reached };
}
