import { deriveId } from '@fizz/domain';
import type { ActionDetail, ActionRecord, LiftTarget, SetLiftTargetArgs, ZonedTimestamp } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';
import { MAX_ANSWER_WORDS, verifyAsked, type AskClaim } from './intent';

/**
 * `set_lift_target` (Ben approved 20 Oct: "Yeah let's do lift targets as something that can be
 * turned on or off"). Only while the Lift targets setting is on: the app wires this executor and
 * puts the targets in YOUR DATA then, and never otherwise.
 *
 * Rule 3: it applies at once with Undo only when Ben asked ("I want to bench 100 kg by March").
 * Code decides, from his own words: the model's claim (`benAsked` with his words in `benQuote`)
 * checked by `verifyAsked`, else `asksForLiftTarget`. A short answer ("Yes") never asks for a target
 * itself (review B1). When he didn't ask, the checked target is saved as a `proposed` record (an
 * offer, exactly what would apply) and nothing else; his `Apply` or bare "yes" on the next turn
 * applies that record (`acceptLiftTargetOffer`), with no model call, refused as stale when his targets
 * changed since.
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

/** Fed back when Ben didn't ask: offered, not set (rule 3). */
export const LIFT_TARGET_NOT_ASKED_LINE = 'Not set: Ben did not ask for this target. He now sees it as an offer to apply; in reply, ask briefly if he wants it. Only that exact target is set, and only if he accepts.';

/** Sent while the tool is offered (Lift targets on). */
export const LIFT_TARGET_TOOL_LINE =
  'set_lift_target sets one of Ben’s lift targets (a 1RM or a weight for reps, an optional date; at most 3, one per exercise) when he asks for one. Dumbbell loads are per hand, machines the stack, barbells the total; repeat the saved convention ("each") in reply. benAsked true only when his message this turn asks for it, with benQuote his words copied exactly. Your own idea: benAsked false; he sees it as an offer and his yes applies exactly that.';

/** Sent when YOUR DATA has his lift targets (Lift targets on). */
export const LIFT_TARGET_PLANNING_LINE =
  'YOUR DATA training.liftTargets are Ben’s own goals. When you build or change his training you may choose the main lift, rep schemes and exercise order to serve them, within every existing limit (load caps, pain flags, his equipment, asking before changing). An estimated 1RM is always called an estimate; never predict when he will reach a target. A target counts as hit only when a logged set reaches it. historyUnreadable: where he is now and any hit are unknown; never say he hasn’t reached it.';

/** Words that ask for a lift target: "I want to bench 100 kg by March", "set a target of 140 on squat", "my goal is a 200 kg deadlift". */
const TARGET_WORD = /\b(?:target|goal)\b/i;
const NUMBER = /\b\d{2,3}(?:[.,]\d+)?\s*(?:kg|kgs|kilos?|lb|lbs|pounds?)?\b/i;
const WANT_TO_LIFT = /\b(?:i want to|i'd like to|i would like to|i wanna|help me|get me to)\s+(?:\w+\s+){0,2}?(?:bench|squat|deadlift|press|pull|row|lift|hit|get)\b/i;
const NOT_A_REQUEST = /\b(?:what|how|why|should i|do you think|is it)\b[^.?!]*\?\s*$/i;

const wordCount = (text: string): number => text.trim().split(/\s+/).filter((w) => w !== '').length;

export function asksForLiftTarget(words: string): boolean {
  const w = words.trim();
  if (w === '' || NOT_A_REQUEST.test(w)) return false;
  if (!NUMBER.test(w)) return false;
  return TARGET_WORD.test(w) || WANT_TO_LIFT.test(w);
}

/** Did Ben ask for this target? His quote checked against his message, else his words. A tap never asks for one. */
export function liftTargetAsked(words: string | null, claim: AskClaim): boolean {
  // Review B1: a short answer ("Yes", "Sure, 110") accepts only a stored offer, never a new model call.
  if (words !== null && wordCount(words) <= MAX_ANSWER_WORDS && !asksForLiftTarget(words)) return false;
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
      const versions = [{ entity: 'lift_target' as const, id: target.id, before: expectedVersion, after: expectedVersion + 1 }];
      // Rule 3 (review B1): an offer saves exactly what would apply, on the version read, and nothing else.
      if (ctx.propose === true) return recordOnly(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'proposed', entityVersions: versions }), 'lift target offer');
      return commitTarget(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { entityVersions: versions }), target, expectedVersion, ctx);
    },
  };
}

async function recordOnly(store: CoachWriteStore, ownerId: string, action: ActionRecord, what: string): Promise<ToolResult> {
  const r = await store.commit(ownerId, { kind: 'record', action });
  if (r.status === 'conflict') throw new Error(`Could not record the ${what}`);
  return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
}

/** The target and its record in one write on the version read; a newer profile records it as stale (rule 5). */
async function commitTarget(store: CoachWriteStore, ownerId: string, action: ActionRecord, target: LiftTarget, expectedVersion: number, ctx: { turnId: string; opId: string; now: ZonedTimestamp }): Promise<ToolResult> {
  const w = await store.commit(ownerId, { kind: 'lift_target', action, target, expectedVersion });
  if (w.status !== 'conflict') return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
  return recordOnly(store, ownerId, newActionRecord({ ...ctx, opId: `${ctx.opId}:stale` }, action.detail, { status: 'stale', failure: 'your targets changed' }), 'stale lift target');
}

/** The latest lift-target offer (`proposed`) among a turn's records, if any. */
export function liftTargetOfferIn(records: readonly ActionRecord[]): ActionRecord | null {
  return [...records].reverse().find((r) => r.status === 'proposed' && r.detail.kind === 'set_lift_target') ?? null;
}

/** The opId of Ben's accept of one target offer: a double tap applies once. */
export const acceptLiftTargetOpId = (proposalActionId: string): string => `accept:${proposalActionId}`;

/**
 * Ben's `Apply` (or a bare "yes") on the coach's target offer (review B1): the stored target applies
 * exactly as offered, on the profile version the offer read, with no model call. Refused as stale
 * when his targets changed since (rule 5); a repeated accept replays.
 */
export async function acceptLiftTargetOffer(store: CoachWriteStore, proposal: ActionRecord, ctx: { ownerId: string; turnId: string; now: ZonedTimestamp }): Promise<ToolResult> {
  const d = proposal.detail;
  const version = proposal.entityVersions.find((v) => v.entity === 'lift_target');
  if (d.kind !== 'set_lift_target' || proposal.status !== 'proposed' || version === undefined || version.before === null) return { kind: 'refused', line: 'There is no target to apply.' };
  const base = { turnId: ctx.turnId, opId: acceptLiftTargetOpId(proposal.actionId), now: ctx.now };
  const action = newActionRecord(base, d, { reason: proposal.reason, entityVersions: [version] });
  return commitTarget(store, ctx.ownerId, action, d.after, version.before, base);
}
