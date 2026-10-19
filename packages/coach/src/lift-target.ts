import { deriveId } from '@fizz/domain';
import type { ActionDetail, LiftTarget, SetLiftTargetArgs } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';
import { verifyAsked, type AskClaim } from './intent';

/**
 * `set_lift_target` (Ben approved 20 Oct: "Yeah let's do lift targets as something that can be
 * turned on or off"). Only while the Lift targets setting is on: the app wires this executor and
 * puts the targets in YOUR DATA then, and never otherwise.
 *
 * Rule 3: it applies at once with Undo only when Ben asked ("I want to bench 100 kg by March").
 * Code decides, from his own words: the model's claim (`benAsked` with his words in `benQuote`)
 * checked by `verifyAsked`, else `asksForLiftTarget`. When he didn't ask, nothing is saved and the
 * coach is told to ask him; a "yes" to that question is his request on the next turn.
 *
 * The app checks the call (`prepare`): the exercise among those he logs (his own included), its
 * convention from his sets (per hand for dumbbells, the stack for a machine; none for assisted or
 * bodyweight), kg/lb as given, a date not before today, at most 3 targets. The target and its record
 * are one write on the profile version read (rule 5); a repeated call replays.
 */

export interface PreparedLiftTarget {
  target: LiftTarget;
  /** The exercise's target it replaces, or null. */
  before: LiftTarget | null;
  /** The training profile version the checks read. */
  expectedVersion: number;
}

export interface LiftTargetDeps {
  store: CoachWriteStore;
  /** Checks the call against Ben's exercises, history and targets. `targetId`: the new target's ID (from the opId). */
  prepare(args: SetLiftTargetArgs, at: { targetId: string; nowUtc: string; tz: string }): Promise<{ ok: true; prepared: PreparedLiftTarget } | { ok: false; line: string }>;
}

/** The new target's ID: from the opId, so a replayed call builds the same one. */
export const liftTargetIdFor = (opId: string): string => deriveId(`lift-target:${opId}`);

/** Fed back when Ben didn't ask: nothing saved (rule 3). */
export const LIFT_TARGET_NOT_ASKED_LINE = 'Not set: Ben did not ask for this target. In reply, ask him if he wants it; it is set only if he says so.';

/** Sent while the tool is offered (Lift targets on). */
export const LIFT_TARGET_TOOL_LINE =
  'set_lift_target sets one of Ben’s lift targets (a 1RM or a weight for reps, an optional date; at most 3, one per exercise) when he asks for one. benAsked true only when his message this turn asks for it or says yes to your question about it, with benQuote his words copied exactly. Never set one he didn’t ask for: suggest it in reply instead.';

/** Sent when YOUR DATA has his lift targets (Lift targets on). */
export const LIFT_TARGET_PLANNING_LINE =
  'YOUR DATA training.liftTargets are Ben’s own goals. When you build or change his training you may choose the main lift, rep schemes and exercise order to serve them, within every existing limit (load caps, pain flags, his equipment, asking before changing). An estimated 1RM is always called an estimate; never predict when he will reach a target. A target counts as hit only when a logged set reaches it.';

/** Words that ask for a lift target: "I want to bench 100 kg by March", "set a target of 140 on squat", "my goal is a 200 kg deadlift". */
const TARGET_WORD = /\b(?:target|goal)\b/i;
const NUMBER = /\b\d{2,3}(?:[.,]\d+)?\s*(?:kg|kgs|kilos?|lb|lbs|pounds?)?\b/i;
const WANT_TO_LIFT = /\b(?:i want to|i'd like to|i would like to|i wanna|help me|get me to)\s+(?:\w+\s+){0,2}?(?:bench|squat|deadlift|press|pull|row|lift|hit|get)\b/i;
const NOT_A_REQUEST = /\b(?:what|how|why|should i|do you think|is it)\b[^.?!]*\?\s*$/i;

export function asksForLiftTarget(words: string): boolean {
  const w = words.trim();
  if (w === '' || NOT_A_REQUEST.test(w)) return false;
  if (!NUMBER.test(w)) return false;
  return TARGET_WORD.test(w) || WANT_TO_LIFT.test(w);
}

/** Did Ben ask for this target? His quote checked against his message, else his words. A tap never asks for one. */
export function liftTargetAsked(words: string | null, claim: AskClaim): boolean {
  return verifyAsked({ tool: 'set_lift_target', chip: false, acceptedOffer: false, words, claim, fallback: () => words !== null && asksForLiftTarget(words) }).asked;
}

export function createLiftTargetExecutors(deps: LiftTargetDeps): CoachExecutors {
  return {
    set_lift_target: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'set_lift_target') throw new TypeError(call.tool);
      const r = await deps.prepare(call.args, { targetId: liftTargetIdFor(ctx.opId), nowUtc: ctx.now.utc, tz: ctx.now.tz });
      if (!r.ok) return { kind: 'refused', line: r.line };
      const { target, before, expectedVersion } = r.prepared;
      const detail: ActionDetail = { kind: 'set_lift_target', exerciseId: target.exerciseId, exerciseName: target.exerciseName, before, after: target };
      const action = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'lift_target', id: target.id, before: expectedVersion, after: expectedVersion + 1 }] });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'lift_target', action, target, expectedVersion });
      if (w.status !== 'conflict') return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
      const stale = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord({ ...ctx, opId: `${ctx.opId}:stale` }, detail, { status: 'stale', failure: 'your targets changed' }) });
      if (stale.status === 'conflict') throw new Error('Could not record the stale lift target');
      return { kind: 'action', record: stale.action, replayed: stale.status === 'replayed' };
    },
  };
}
