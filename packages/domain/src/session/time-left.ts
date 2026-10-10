import type { SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { clockText } from '../calendar';
import { formatDuration, formatElapsed, NBSP } from '../display';
import { restRemainingMs } from '../rest';
import { toIso, toMs } from '../time';
import { isRoundEnd, nextPendingSet } from './order';
import { dateOnlyOf, getActiveDurationMs, getSessionPhase, pausedMsWithin } from './view';

/**
 * "About N min left" (active-workout §2.15). An estimate worked out by code
 * from the pending sets, their planned rest and Ben's own logged pace. Pure:
 * the clock is an argument. Never uses check-ins, coach output or any
 * readiness-style guess (rule 6), and never changes a set.
 */

/** Tokens from active-workout §9 (`pace.*`, `timing.timeLeftRefresh`). */
export const TIME_LEFT = {
  /** The line recomputes at most this often between events. */
  refreshMs: 60_000,
  defaultSetSeconds: 45,
  defaultChangeoverSeconds: 120,
  /** Gaps longer than this (after paused time is removed) never enter the pace. */
  maxGapMs: 15 * 60_000,
  /** Gaps of a kind needed before this workout's own pace is used for that kind. */
  minSamplesSession: 3,
  /** Finished workouts used for pace before that. */
  recentSessions: 5,
  /** ± on the default pace for the range. */
  defaultSpread: 0.25,
} as const;

/** Pace samples in seconds over planned rest: one list per kind of gap. */
export interface PaceSamples {
  /** Next set of the same exercise (or the next superset member). */
  set: number[];
  /** From an exercise's last set to the next exercise's first set. */
  changeover: number[];
}

export type PaceSource = 'this_workout' | 'recent_workouts' | 'default';

export interface Pace {
  /** Source of the per-set figure (the tag the sheet shows). */
  source: PaceSource;
  changeoverSource: PaceSource;
  secondsPerSet: number;
  changeoverSeconds: number;
  /** Samples behind the per-set figure (0 for `default`). */
  samples: number;
  /** 25th / 75th percentile figures behind the range (±25% on defaults). */
  low: { secondsPerSet: number; changeoverSeconds: number };
  high: { secondsPerSet: number; changeoverSeconds: number };
}

export interface TimeLeftEstimate {
  /** Raw estimate; `minutes` is the rounded display figure. */
  seconds: number;
  minutes: number;
  lowMinutes: number;
  highMinutes: number;
  /** `now + seconds`, rounded to 5 minutes. */
  endsAt: string;
  /** Ben's `Finish by` for today, when set. */
  finishBy: string | null;
  /** Rounded minutes past `finishBy`; null when on track or not set. */
  overByMinutes: number | null;
  pace: Pace;
  /** Planned rest still to come, including what's left of a running rest. */
  plannedRestSeconds: number;
  pendingSets: number;
  pendingExercises: number;
  /** The estimate is frozen while the workout is paused. */
  paused: boolean;
}

const live = (s: WorkoutSet) => s.status !== 'deleted';

function exerciseOf(state: SessionAggregate, set: WorkoutSet): SessionExercise | undefined {
  return state.exercises.find((e) => e.id === set.sessionExerciseId);
}

const sameSuperset = (a: SessionExercise | undefined, b: SessionExercise | undefined): boolean =>
  a !== undefined && b !== undefined && a.supersetGroup !== null && a.supersetGroup === b.supersetGroup;

/**
 * The rest the workout would plan after `set` when `next` follows it; the same
 * choice `log_set` makes when it starts the timer (superset member steps use
 * the transition; an exercise's last set uses its transition when one is set).
 */
function plannedRestBetween(state: SessionAggregate, set: WorkoutSet, next: WorkoutSet): number {
  const ex = exerciseOf(state, set);
  const nextEx = exerciseOf(state, next);
  if (!ex) return set.rest.seconds;
  if (ex.id === nextEx?.id) return set.rest.seconds;
  if (sameSuperset(ex, nextEx) && nextEx !== undefined && nextEx.order > ex.order) return ex.transitionRestS ?? 0;
  if (sameSuperset(ex, nextEx)) return set.rest.seconds;
  return ex.transitionRestS ?? set.rest.seconds;
}

/**
 * Ben's pace in one workout: for consecutive logged sets (in the order he
 * logged them), the time between the two commits minus paused time and the
 * planned rest between them. A move to another exercise (outside a superset)
 * is a changeover sample. Gaps over `maxGap` are left out; a date-only
 * (imported) workout has no times and gives none.
 */
export function paceSamplesOf(state: SessionAggregate, nowMs: number): PaceSamples {
  const out: PaceSamples = { set: [], changeover: [] };
  if (dateOnlyOf(state.session) !== null) return out;
  const done = state.sets
    .filter((s) => s.status === 'completed' && s.completedAt !== null)
    .map((s) => ({ s, t: toMs(s.completedAt?.utc ?? '') }))
    .sort((a, b) => a.t - b.t);
  for (let i = 1; i < done.length; i += 1) {
    const a = done[i - 1];
    const b = done[i];
    if (!a || !b) continue;
    const gapMs = b.t - a.t - pausedMsWithin(state, a.t, b.t, nowMs);
    if (gapMs <= 0 || gapMs > TIME_LEFT.maxGapMs) continue;
    const exA = exerciseOf(state, a.s);
    const exB = exerciseOf(state, b.s);
    const sample = Math.max(0, gapMs / 1000 - plannedRestBetween(state, a.s, b.s));
    if (exA?.id === exB?.id || sameSuperset(exA, exB)) out.set.push(sample);
    else out.changeover.push(sample);
  }
  return out;
}

/**
 * Samples from Ben's most recent finished workouts with real times (up to
 * `recentSessions`), newest first. Imported date-only workouts are skipped.
 */
export function recentPaceSamples(finished: readonly SessionAggregate[], limit: number = TIME_LEFT.recentSessions): PaceSamples {
  const timed = finished
    .filter((a) => a.session.status === 'finished' && dateOnlyOf(a.session) === null)
    .sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc))
    .slice(0, limit);
  const out: PaceSamples = { set: [], changeover: [] };
  for (const a of timed) {
    const end = a.session.endedAt ? toMs(a.session.endedAt.utc) : toMs(a.session.lastActivityAtUtc);
    const p = paceSamplesOf(a, end);
    out.set.push(...p.set);
    out.changeover.push(...p.changeover);
  }
  return out;
}

/** Linear-interpolated percentile (0–1) of a non-empty list. */
export function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new RangeError('percentile of an empty list');
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

interface Figure {
  source: PaceSource;
  mid: number;
  low: number;
  high: number;
  samples: number;
}

function figure(session: readonly number[], recent: readonly number[], fallback: number): Figure {
  const pick = (list: readonly number[], source: PaceSource): Figure => ({
    source,
    mid: percentile(list, 0.5),
    low: percentile(list, 0.25),
    high: percentile(list, 0.75),
    samples: list.length,
  });
  if (session.length >= TIME_LEFT.minSamplesSession) return pick(session, 'this_workout');
  if (recent.length > 0) return pick(recent, 'recent_workouts');
  return {
    source: 'default',
    mid: fallback,
    low: fallback * (1 - TIME_LEFT.defaultSpread),
    high: fallback * (1 + TIME_LEFT.defaultSpread),
    samples: 0,
  };
}

/**
 * Pace by kind, in order: this workout once it has `minSamplesSession` gaps
 * of that kind; else Ben's recent finished workouts; else labelled defaults.
 */
export function resolvePace(session: PaceSamples, recent: PaceSamples): Pace {
  const set = figure(session.set, recent.set, TIME_LEFT.defaultSetSeconds);
  const ch = figure(session.changeover, recent.changeover, TIME_LEFT.defaultChangeoverSeconds);
  return {
    source: set.source,
    changeoverSource: ch.source,
    secondsPerSet: set.mid,
    changeoverSeconds: ch.mid,
    samples: set.samples,
    low: { secondsPerSet: set.low, changeoverSeconds: ch.low },
    high: { secondsPerSet: set.high, changeoverSeconds: ch.high },
  };
}

/** Display rounding: 10 min or more → nearest 5; under 10 → nearest minute. */
export function roundEstimateMinutes(seconds: number): number {
  const m = Math.max(0, seconds) / 60;
  return m >= 10 ? Math.round(m / 5) * 5 : Math.round(m);
}

const FIVE_MIN = 5 * 60_000;

/**
 * Pending sets in the order they'd be done, starting with the active set and
 * following `nextPendingSet` as each is (hypothetically) logged, so the order
 * matches what `log_set` would pick. Each step carries the rest planned after it.
 */
function pendingPlan(state: SessionAggregate): { set: WorkoutSet; restAfter: number; changeover: boolean }[] {
  let sets = state.sets.filter(live);
  const pending = sets.filter((s) => s.status === 'pending');
  if (pending.length === 0) return [];
  const active = state.session.activeSetId;
  let cur: string | null = active !== null && pending.some((s) => s.id === active) ? active : nextPendingSet(null, state.exercises, sets);
  const plan: { set: WorkoutSet; restAfter: number; changeover: boolean }[] = [];
  const guard = pending.length + 1;
  while (cur !== null && plan.length < guard) {
    const id = cur;
    const set = sets.find((s) => s.id === id);
    if (!set) break;
    sets = sets.map((s) => (s.id === id ? { ...s, status: 'completed' as const } : s));
    const nextId = nextPendingSet(id, state.exercises, sets);
    const next = nextId === null ? undefined : sets.find((s) => s.id === nextId);
    let restAfter = 0;
    let changeover = false;
    if (next) {
      const ex = exerciseOf(state, set);
      const nextEx = exerciseOf(state, next);
      const exerciseHasMore = sets.some((s) => s.sessionExerciseId === set.sessionExerciseId && s.status === 'pending');
      if (ex && !isRoundEnd(set, state.exercises, sets)) restAfter = ex.transitionRestS ?? 0;
      else if (ex && !exerciseHasMore && ex.transitionRestS !== null) restAfter = ex.transitionRestS;
      else restAfter = set.rest.seconds;
      changeover = ex?.id !== nextEx?.id && !sameSuperset(ex, nextEx);
    }
    plan.push({ set, restAfter, changeover });
    cur = nextId;
  }
  return plan;
}

export interface EstimateOptions {
  nowMs: number;
  /** Samples from Ben's recent finished workouts (`recentPaceSamples`). */
  recent?: PaceSamples;
  /** Today's `Finish by` (UTC), when Ben set one. */
  finishByUtc?: string | null;
}

/**
 * `estimateRemainingDuration` (§2.15.2). Per pending set: Ben's per-set
 * figure (plus the planned duration of a timed set), the planned rest after
 * it (none after the last), and a changeover when the next set is another
 * exercise outside a superset; plus what's left of a running rest. Null when
 * the workout isn't active or nothing is pending (the line is hidden).
 */
export function estimateRemainingDuration(state: SessionAggregate, opts: EstimateOptions): TimeLeftEstimate | null {
  if (state.session.status !== 'active') return null;
  const plan = pendingPlan(state);
  if (plan.length === 0) return null;
  const paused = state.session.pause !== null;
  // While paused the estimate is frozen at the moment of the pause.
  const nowMs = paused && state.session.pause ? toMs(state.session.pause.pausedAtUtc) : opts.nowMs;
  const pace = resolvePace(paceSamplesOf(state, nowMs), opts.recent ?? { set: [], changeover: [] });

  const timer = state.restTimer;
  const phase = getSessionPhase(state, nowMs);
  const currentRestS = timer && (phase.kind === 'resting' || timer.status === 'paused') ? restRemainingMs(timer, nowMs) / 1000 : 0;

  let restS = currentRestS;
  let workS = 0;
  // A move to a new exercise that hasn't happened yet: the last logged set
  // was another exercise (outside a superset) and the next set starts one.
  const lastDone = state.sets
    .filter((s) => s.status === 'completed' && s.completedAt !== null)
    .sort((a, b) => toMs(b.completedAt?.utc ?? '') - toMs(a.completedAt?.utc ?? ''))[0];
  const first = plan[0]?.set;
  const lastEx = lastDone ? exerciseOf(state, lastDone) : undefined;
  const firstEx = first ? exerciseOf(state, first) : undefined;
  let changeovers = lastEx !== undefined && lastEx.id !== firstEx?.id && !sameSuperset(lastEx, firstEx) ? 1 : 0;
  for (const step of plan) {
    restS += step.restAfter;
    const ex = exerciseOf(state, step.set);
    if (ex?.measurement === 'duration') workS += step.set.planned.durationS ?? 0;
    if (step.changeover) changeovers += 1;
  }
  const total = (perSet: number, changeover: number) => restS + workS + plan.length * perSet + changeovers * changeover;
  const seconds = total(pace.secondsPerSet, pace.changeoverSeconds);
  const lowS = total(pace.low.secondsPerSet, pace.low.changeoverSeconds);
  const highS = total(pace.high.secondsPerSet, pace.high.changeoverSeconds);

  const endMs = nowMs + seconds * 1000;
  const finishBy = opts.finishByUtc ?? null;
  let overByMinutes: number | null = null;
  if (finishBy !== null) {
    const over = roundEstimateMinutes((endMs - toMs(finishBy)) / 1000);
    overByMinutes = endMs > toMs(finishBy) && over > 0 ? over : null;
  }
  return {
    seconds,
    minutes: roundEstimateMinutes(seconds),
    lowMinutes: roundEstimateMinutes(Math.min(lowS, seconds)),
    highMinutes: roundEstimateMinutes(Math.max(highS, seconds)),
    endsAt: toIso(Math.round(endMs / FIVE_MIN) * FIVE_MIN),
    finishBy,
    overByMinutes,
    pace,
    plannedRestSeconds: restS,
    pendingSets: plan.length,
    pendingExercises: new Set(plan.map((p) => p.set.sessionExerciseId)).size,
    paused,
  };
}

export interface TimeLeftLineView {
  /** `About 35 min left · ends about 19:40` */
  text: string;
  accessibilityLabel: string;
}

const MIN = `${NBSP}min`;

/** `TimeLeftLine` wording (§2.15.1). Always "about"; never seconds. */
export function timeLeftLine(e: TimeLeftEstimate, tz: string): TimeLeftLineView {
  const m = String(e.minutes);
  const spokenMin = e.minutes === 1 ? 'minute' : 'minutes';
  if (e.paused) {
    return {
      text: `Paused · about ${m}${MIN} left after you resume`,
      accessibilityLabel: `Workout estimate: paused, about ${m} ${spokenMin} left after you resume.`,
    };
  }
  if (e.seconds < 120) {
    return { text: `Under 2${MIN} left`, accessibilityLabel: 'Workout estimate: under 2 minutes left.' };
  }
  const head = `About ${m}${MIN} left`;
  const spokenHead = `Workout estimate: about ${m} ${spokenMin} left`;
  if (e.pendingSets === 1) return { text: head, accessibilityLabel: `${spokenHead}.` };
  if (e.finishBy !== null) {
    const by = clockText(toMs(e.finishBy), tz);
    if (e.overByMinutes === null) return { text: `${head} · on track for ${by}`, accessibilityLabel: `${spokenHead}, on track for ${by}.` };
    const o = String(e.overByMinutes);
    return {
      text: `${head} · about ${o}${MIN} past ${by}`,
      accessibilityLabel: `${spokenHead}, about ${o} ${e.overByMinutes === 1 ? 'minute' : 'minutes'} past ${by}.`,
    };
  }
  const ends = clockText(toMs(e.endsAt), tz);
  return { text: `${head} · ends about ${ends}`, accessibilityLabel: `${spokenHead}, ending about ${ends}.` };
}

export const PACE_SOURCE_LABEL: Record<PaceSource, string> = {
  this_workout: 'From this workout',
  recent_workouts: 'Your last 5 workouts',
  default: 'Default',
};

export interface TimeLeftSheetView {
  /** `About 35 min · likely 30–40 min` */
  headline: string;
  /** `Ends about 19:40`; null while paused. */
  endsLine: string | null;
  leftToDo: string;
  plannedRest: string;
  pace: string;
  paceSource: string;
  /** Shown only when the changeover figure comes from a different source. */
  changeoverSource: string | null;
  soFar: string;
  finishBy: string;
  footnote: string;
}

function shortDuration(seconds: number): string {
  const s = Math.round(seconds);
  return s % 60 === 0 ? `${String(s / 60)}${MIN}` : formatDuration(s);
}

/** `Time left` sheet text (§2.15.3). Facts and the estimate are worded apart. */
export function timeLeftSheet(e: TimeLeftEstimate, state: SessionAggregate, nowMs: number, tz: string): TimeLeftSheetView {
  const range = e.lowMinutes < e.highMinutes ? ` · likely ${String(e.lowMinutes)}–${String(e.highMinutes)}${MIN}` : '';
  const sets = `${String(e.pendingSets)} ${e.pendingSets === 1 ? 'set' : 'sets'}`;
  const exs = `${String(e.pendingExercises)} ${e.pendingExercises === 1 ? 'exercise' : 'exercises'}`;
  const changeoverSource = e.pace.changeoverSource === e.pace.source ? null : PACE_SOURCE_LABEL[e.pace.changeoverSource];
  return {
    headline: e.seconds < 120 ? `Under 2${MIN}` : `About ${String(e.minutes)}${MIN}${range}`,
    endsLine: e.paused ? null : `Ends about ${clockText(toMs(e.endsAt), tz)}`,
    leftToDo: `${sets} · ${exs}`,
    plannedRest: `${String(Math.round(e.plannedRestSeconds / 60))}${MIN}`,
    pace: `${formatDuration(e.pace.secondsPerSet)} a set · ${shortDuration(e.pace.changeoverSeconds)} between exercises`,
    paceSource: PACE_SOURCE_LABEL[e.pace.source],
    changeoverSource,
    soFar: `${formatElapsed(getActiveDurationMs(state, nowMs))} active`,
    finishBy: e.finishBy === null ? 'Not set' : clockText(toMs(e.finishBy), tz),
    footnote: 'This is an estimate from your pace and rest settings. It doesn’t change your sets.',
  };
}
