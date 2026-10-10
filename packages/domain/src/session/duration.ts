import type { SessionAggregate, WorkoutSet } from '@fizz/schemas';
import { toMs } from '../time';
import { buildExecutionOrder, isRoundEnd } from './order';

/**
 * `estimateRemainingDuration` (active-workout §2.15.2), the part Today and
 * the routine sheet need: how long the pending sets take, from planned rest
 * and Ben's own pace. Always shown as an estimate (`about 45 min`). Pure.
 *
 * - What's left: pending sets in execution order.
 * - Planned rest: each pending set's resolved rest, except after the final
 *   set; between superset members mid-round, only the transition.
 * - Pace: `per set` = median over consecutive sets of one exercise of (gap
 *   between the two commits − the planned rest between them); `changeover`
 *   = median of (last set of one exercise → first of the next − planned
 *   rest). From this workout once it has 3 samples of that kind, else
 *   Ben's recent finished workouts, else defaults (45 s, 2 min).
 * - Gaps over 15 min, and gaps that overlap a pause, are left out.
 * - Never uses check-ins, coach output or any readiness guess.
 */

export const PACE_DEFAULT_SET_S = 45;
export const PACE_DEFAULT_CHANGEOVER_S = 120;
export const PACE_MIN_SAMPLES = 3;
export const PACE_MAX_GAP_MS = 15 * 60 * 1000;

export type PaceSource = 'this_workout' | 'recent_workouts' | 'default';

export interface DurationEstimate {
  /** Rounded: 10 min or more to the nearest 5, under 10 to the nearest minute. 0 when nothing is left. */
  minutes: number;
  seconds: number;
  pace: { source: PaceSource; secondsPerSet: number; changeoverSeconds: number; samples: number };
  plannedRestSeconds: number;
  pendingSets: number;
  pendingExercises: number;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length === 0) return 0;
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Rest planned after `set`, given the set that follows it (null: the last). */
function restAfter(state: SessionAggregate, set: WorkoutSet): number {
  if (isRoundEnd(set, state.exercises, state.sets)) return set.rest.seconds;
  return state.exercises.find((e) => e.id === set.sessionExerciseId)?.transitionRestS ?? 0;
}

function overlapsPause(state: SessionAggregate, fromMs: number, toMsValue: number): boolean {
  const pauses = [...state.session.pauses, ...(state.session.pause ? [{ startUtc: state.session.pause.pausedAtUtc, endUtc: state.session.pause.pausedAtUtc }] : [])];
  return pauses.some((p) => toMs(p.startUtc) < toMsValue && toMs(p.endUtc) >= fromMs);
}

/** Pace samples from one workout's logged sets, in commit order. */
export function paceSamples(state: SessionAggregate): { perSet: number[]; changeover: number[] } {
  const done = state.sets
    .filter((s) => s.status === 'completed' && s.completedAt !== null && s.pairedWithSetId === null)
    .sort((a, b) => toMs(a.completedAt?.utc ?? '') - toMs(b.completedAt?.utc ?? ''));
  const perSet: number[] = [];
  const changeover: number[] = [];
  const groupOf = (s: WorkoutSet) => state.exercises.find((e) => e.id === s.sessionExerciseId)?.supersetGroup ?? null;
  for (let i = 1; i < done.length; i += 1) {
    const a = done[i - 1];
    const b = done[i];
    if (!a || !b) continue;
    const from = toMs(a.completedAt?.utc ?? '');
    const to = toMs(b.completedAt?.utc ?? '');
    const gap = to - from;
    if (gap <= 0 || gap > PACE_MAX_GAP_MS || overlapsPause(state, from, to)) continue;
    const net = Math.max(0, gap / 1000 - restAfter(state, a));
    const sameBlock = a.sessionExerciseId === b.sessionExerciseId || (groupOf(a) !== null && groupOf(a) === groupOf(b));
    (sameBlock ? perSet : changeover).push(net);
  }
  return { perSet, changeover };
}

function pick(own: readonly number[], recent: readonly number[], fallback: number): { value: number; source: PaceSource; samples: number } {
  if (own.length >= PACE_MIN_SAMPLES) return { value: median(own), source: 'this_workout', samples: own.length };
  if (recent.length >= PACE_MIN_SAMPLES) return { value: median(recent), source: 'recent_workouts', samples: recent.length };
  return { value: fallback, source: 'default', samples: 0 };
}

export function roundEstimateMinutes(seconds: number): number {
  if (seconds <= 0) return 0;
  const m = seconds / 60;
  return m >= 10 ? Math.round(m / 5) * 5 : Math.max(1, Math.round(m));
}

/** `recent`: Ben's last few finished workouts (5 in the spec), newest first; their pace is used when this one has too little. */
export function estimateRemainingDuration(state: SessionAggregate, opts: { recent?: readonly SessionAggregate[] } = {}): DurationEstimate {
  const own = paceSamples(state);
  const recent = (opts.recent ?? []).map(paceSamples);
  const set = pick(own.perSet, recent.flatMap((r) => r.perSet), PACE_DEFAULT_SET_S);
  const change = pick(own.changeover, recent.flatMap((r) => r.changeover), PACE_DEFAULT_CHANGEOVER_S);
  const byId = new Map(state.sets.map((s) => [s.id, s]));
  const pending = buildExecutionOrder(state.exercises, state.sets)
    .map((id) => byId.get(id))
    .filter((s): s is WorkoutSet => s !== undefined && s.status === 'pending');
  let rest = 0;
  let changeovers = 0;
  let work = 0;
  const groupOf = (s: WorkoutSet) => state.exercises.find((e) => e.id === s.sessionExerciseId)?.supersetGroup ?? null;
  pending.forEach((s, i) => {
    work += set.value + (s.planned.durationS ?? 0);
    const next = pending[i + 1];
    if (!next) return;
    rest += restAfter(state, s);
    const sameBlock = s.sessionExerciseId === next.sessionExerciseId || (groupOf(s) !== null && groupOf(s) === groupOf(next));
    if (!sameBlock) changeovers += 1;
  });
  const seconds = work + rest + changeovers * change.value;
  return {
    minutes: roundEstimateMinutes(seconds),
    seconds,
    pace: { source: set.source === 'default' && change.source !== 'default' ? change.source : set.source, secondsPerSet: set.value, changeoverSeconds: change.value, samples: set.samples + change.samples },
    plannedRestSeconds: rest,
    pendingSets: pending.length,
    pendingExercises: new Set(pending.map((s) => s.sessionExerciseId)).size,
  };
}
