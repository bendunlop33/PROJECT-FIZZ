import { addDays, daysBetween, infoOrDefault, slotsOf, workingCount } from '@fizz/domain';
import type { ActivityEffort, ActivityKind, BuilderEditOp, PreSessionNudgeArgs, ReviewFact } from '@fizz/schemas';
import type { NumberFacts } from '../numbers';
import { checkCoachText } from './checked-text';
import type { BuilderCoachEnv, BuilderCoachSnapshot } from './edit-ops';
import { makeBuilderProposal, type BuilderProposal } from './proposal';

/**
 * The pre-session nudge (workout-builder-v3 §6.1; Ben, 20 Oct). Pure.
 * Readiness from REAL signals only (rule 6): logged RPEs, logged reps,
 * Ben's own check-in score, and a run he logged or told the coach about.
 * Silent unless a clear signal: 3 sessions in a row at RPE 9–10, a big rep
 * miss, a hard run yesterday, a low check-in. Only then is the coach asked
 * (the light model); it judges whether to speak and writes one line. The
 * offer is code's (one easing change, never heavier), applied only on
 * Ben's Apply (rule 3).
 */

export const NUDGE_RULES = {
  /** "3 sessions at RPE 9–10": the last three finished, each averaging this or more over logged working RPEs. */
  rpeSessions: 3,
  rpeAtLeast: 9,
  /** Sessions older than this aren't "recent". */
  recentDays: 14,
  /** A big rep miss: this many reps or more under the target's bottom. */
  repMissBy: 3,
  /** Accessories never go below this many working sets in an offer. */
  minAccessorySets: 2,
} as const;
const N = NUDGE_RULES;

export interface NudgeSet {
  working: boolean;
  reps: number | null;
  /** The target's bottom (`8` of 8–10); null: no rep target. */
  targetRepsMin: number | null;
  rpe: number | null;
}

export interface NudgeSession {
  sessionId: string;
  localDate: string;
  exercises: readonly { exerciseId: string; sets: readonly NudgeSet[] }[];
}

export interface NudgeActivity {
  id: string;
  localDate: string;
  kind: ActivityKind;
  effort: ActivityEffort | null;
  status: 'done' | 'planned';
}

export interface PreSessionInput {
  /** Today, local. */
  today: string;
  /** Finished workouts, newest first. */
  recent: readonly NudgeSession[];
  /** Today's check-in, if Ben did one. */
  checkIn: { id: string; score: number; localDate: string } | null;
  /** Check-in settings: offer a lighter session at or below this score; null: never. */
  offerAtOrBelow: number | null;
  /** Only activities Ben logged or told the coach about. */
  activities: readonly NudgeActivity[];
}

export type NudgeSignal =
  | { kind: 'rep_miss'; exerciseId: string; sessionId: string; localDate: string; targetReps: number; reps: number }
  | { kind: 'rpe_high'; sessionIds: string[]; meanRpe: number }
  | { kind: 'low_check_in'; checkInId: string; score: number }
  | { kind: 'hard_run'; activityId: string; localDate: string; effort: ActivityEffort };

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** `preSessionSignals`: the clear signals, strongest first (rep miss, RPE, check-in, run). Empty: stay silent. */
export function preSessionSignals(input: PreSessionInput, todayExerciseIds: ReadonlySet<string>, todayHasLegs: boolean): NudgeSignal[] {
  const out: NudgeSignal[] = [];
  const ago = (d: string): number => daysBetween(d, input.today);
  const recent = input.recent.filter((s) => ago(s.localDate) <= N.recentDays && ago(s.localDate) >= 0);

  // A big rep miss on something in today's workout, in the newest session that had it.
  const missed = (() => {
    for (const id of todayExerciseIds) {
      const s = recent.find((x) => x.exercises.some((e) => e.exerciseId === id));
      const ex = s?.exercises.find((e) => e.exerciseId === id);
      const set = ex?.sets.find((x) => x.working && x.reps !== null && x.targetRepsMin !== null && x.targetRepsMin - x.reps >= N.repMissBy);
      if (s !== undefined && set !== undefined && set.reps !== null && set.targetRepsMin !== null) return { kind: 'rep_miss' as const, exerciseId: id, sessionId: s.sessionId, localDate: s.localDate, targetReps: set.targetRepsMin, reps: set.reps };
    }
    return null;
  })();
  if (missed !== null) out.push(missed);

  // Three sessions in a row averaging RPE 9–10 over the RPEs Ben logged.
  const last = recent.slice(0, N.rpeSessions);
  const means = last.map((s) => {
    const rpes = s.exercises.flatMap((e) => e.sets.filter((x) => x.working && x.rpe !== null).map((x) => x.rpe ?? 0));
    return rpes.length === 0 ? null : rpes.reduce((m, r) => m + r, 0) / rpes.length;
  });
  if (last.length === N.rpeSessions && means.every((m) => m !== null && m >= N.rpeAtLeast)) {
    const all = means.filter((m): m is number => m !== null);
    out.push({ kind: 'rpe_high', sessionIds: last.map((s) => s.sessionId), meanRpe: round1(all.reduce((m, r) => m + r, 0) / all.length) });
  }

  const c = input.checkIn;
  if (c !== null && c.localDate === input.today && input.offerAtOrBelow !== null && c.score <= input.offerAtOrBelow) out.push({ kind: 'low_check_in', checkInId: c.id, score: c.score });

  // A hard or long run (or ride) yesterday, only on a day with legs in it.
  if (todayHasLegs) {
    const run = input.activities.find((a) => a.status === 'done' && a.localDate === addDays(input.today, -1) && (a.kind === 'run' || a.kind === 'ride') && (a.effort === 'hard' || a.effort === 'long'));
    if (run !== undefined && run.effort !== null) out.push({ kind: 'hard_run', activityId: run.id, localDate: run.localDate, effort: run.effort });
  }
  return out;
}

/** The signals as stored review facts (code only, rule 6). */
export function nudgeReviewFacts(signals: readonly NudgeSignal[]): ReviewFact[] {
  return signals.map((s): ReviewFact => {
    switch (s.kind) {
      case 'rep_miss':
        return { kind: 'rep_miss', exerciseId: s.exerciseId, sessionId: s.sessionId, targetReps: s.targetReps, reps: s.reps };
      case 'rpe_high':
        return { kind: 'rpe_drift', exerciseId: null, sessions: s.sessionIds.length, meanRpe: Math.min(10, Math.max(1, s.meanRpe)), targetRpe: 8 };
      case 'low_check_in':
        return { kind: 'check_in', checkInId: s.checkInId };
      case 'hard_run':
        return { kind: 'activity', activityId: s.activityId };
    }
  });
}

/** The signal in words for the coach (and the facts its line is checked against). */
export function signalLine(s: NudgeSignal, nameOf: (exerciseId: string) => string): string {
  switch (s.kind) {
    case 'rep_miss':
      return `${nameOf(s.exerciseId)} on ${s.localDate}: ${String(s.reps)} reps against a target of ${String(s.targetReps)}`;
    case 'rpe_high':
      return `Last ${String(s.sessionIds.length)} sessions averaged RPE ${String(s.meanRpe)}`;
    case 'low_check_in':
      return `Check-in today: ${String(s.score)} of 5`;
    case 'hard_run':
      return `${s.effort === 'long' ? 'Long' : 'Hard'} run yesterday (${s.localDate})`;
  }
}

export interface NudgeOffer {
  /** `nudge:<signal kind>`. */
  id: string;
  ops: BuilderEditOp[];
  proposal: BuilderProposal;
}

/**
 * Code's one offer for the strongest signal: a lift one step lighter (rep
 * miss on it; RPE high on the main lift), or one set fewer on accessories
 * (low check-in; legs after a hard run), never below 2. Null when it would
 * change nothing.
 */
export function nudgeOffer(signals: readonly NudgeSignal[], snapshot: BuilderCoachSnapshot, env: BuilderCoachEnv, facts: NumberFacts): NudgeOffer | null {
  const slots = slotsOf(snapshot.workout.blocks);
  const fewer = (pick: (exerciseId: string) => boolean): BuilderEditOp[] =>
    slots.filter((s) => !s.main && pick(s.exerciseId) && workingCount(s) > N.minAccessorySets).map((s): BuilderEditOp => ({ op: 'sets', slotKey: s.key, workingSets: workingCount(s) - 1 }));
  for (const sig of signals) {
    let ops: BuilderEditOp[] = [];
    switch (sig.kind) {
      case 'rep_miss': {
        const s = slots.find((x) => x.exerciseId === sig.exerciseId);
        if (s !== undefined) ops = [{ op: 'load', slotKey: s.key, direction: 'lighter', value: null, unit: null }];
        break;
      }
      case 'rpe_high': {
        const main = slots.find((x) => x.main);
        ops = main !== undefined ? [{ op: 'load', slotKey: main.key, direction: 'lighter', value: null, unit: null }] : fewer(() => true);
        break;
      }
      case 'low_check_in':
        ops = fewer(() => true);
        break;
      case 'hard_run':
        ops = fewer((id) => infoOrDefault(env.ctx.info, id).group === 'Legs');
        break;
    }
    if (ops.length === 0) continue;
    const id = `nudge:${sig.kind}`;
    const r = makeBuilderProposal({ id: `${snapshot.draftId}:${String(snapshot.draftVersion)}:${id}`, snapshot, ops, words: null, facts, env });
    if (r.proposal !== null) return { id, ops, proposal: r.proposal };
  }
  return null;
}

export type CheckedNudge = { speak: false } | { speak: true; line: string; offer: NudgeOffer | null };

/**
 * `checkNudge`: the coach's call, checked. Silent when it chose silence,
 * wrote nothing, or its line has a number not in the facts (never shown
 * unchecked, rule 1 and 6). When it speaks, code's offer goes with the line
 * as `Apply` (§6.1: one line with Apply), so a restart that reuses the
 * stored line shows the same offer; it is still only an offer (rule 3).
 */
export function checkNudge(args: PreSessionNudgeArgs, offer: NudgeOffer | null, facts: NumberFacts): CheckedNudge {
  if (!args.speak) return { speak: false };
  const c = checkCoachText(args.line, facts);
  if (c.shown === null || c.hidden.length > 0) return { speak: false };
  return { speak: true, line: c.shown, offer };
}
