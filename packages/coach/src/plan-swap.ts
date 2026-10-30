import type { ActionDetail, CoachMessage } from '@fizz/schemas';

import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';

/**
 * (Ben, 30 Oct, build 486) From a live workout's chat Ben asked to swap leg press and leg extension across his plan.
 * His words read as `structural` only, so no plan tool was offered; the coach said it couldn't change the plan here,
 * that sentence was hidden and replaced with `Want me to change this week?`, and "Yes" then ran nothing. A loop.
 *
 * - `propose_plan_swap`: offered whenever a plan is in use (ADR 0039's registry, `planInUse`), in every chat. `remove`
 *   and `add` make the direction explicit. The app's port checks it (the plan in use, each day's version, his gym,
 *   pain flags, and never an exercise he marked not preferred: when the coach's `add` is one, it is the one that comes
 *   out) and the record is always a proposal: before/after per day, Apply and Undo (rule 3: a structural change).
 * - `planScopeOf`: what Ben's words aim at: the plan (every week), this week, or today. The hidden "can't change it
 *   here" line is replaced by the offer that matches (`Want me to change your plan?` after "full plan"; the week's line
 *   only when this week is the target).
 * - `offerContinuationOf`: "Yes" (or a short scope like "full plan") to the coach's own offer is his request: the turn
 *   reads it with the words that led to the offer, so the tool is offered and used.
 */

/** Fed back to the coach when the swap can't be proposed: one short honest line, never a loop. */
export type PlanSwapPrepared =
  | { kind: 'ok'; detail: Extract<ActionDetail, { kind: 'propose_plan_swap' }> }
  /** `line`: why, as app text ("Leg extension is not preferred in your plan settings"); `names`: for the card. */
  | { kind: 'refused'; line: string; names?: { remove: string; add: string } };

const NO_PLAN = '00000000-0000-4000-8000-000000000000';

export interface PlanSwapDeps {
  store: CoachWriteStore;
  /** Reads the plan in use and checks the swap; nothing is written here. */
  prepare(req: { remove: string; add: string }): Promise<PlanSwapPrepared>;
}

export function createPlanSwapExecutor(deps: PlanSwapDeps): CoachExecutors {
  const propose: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'propose_plan_swap') throw new TypeError(call.tool);
    const r = await deps.prepare({ remove: call.args.remove.trim(), add: call.args.add.trim() }).catch((): PlanSwapPrepared => ({ kind: 'refused', line: 'Not proposed: the plan couldn’t be read just now.' }));
    if (r.kind === 'refused') {
      // One honest line on a card (`Not changed: …`), kept in the thread; the coach is told the same.
      const detail: ActionDetail = { kind: 'propose_plan_swap', planId: NO_PLAN, planName: '', removeId: call.args.remove.slice(0, 64), removeName: (r.names?.remove ?? call.args.remove).slice(0, 120), addId: call.args.add.slice(0, 64), addName: (r.names?.add ?? call.args.add).slice(0, 120), days: [] };
      const refused = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'rejected', failure: r.line.slice(0, 200), reason: call.args.reason.slice(0, 240) }) });
      if (refused.status === 'conflict') throw new Error('Could not record the refused plan swap');
      return { kind: 'action', record: refused.action, replayed: refused.status === 'replayed' };
    }
    const saved = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, r.detail, { status: 'proposed', reason: call.args.reason.slice(0, 240) }) });
    if (saved.status === 'conflict') throw new Error('Could not record the plan swap');
    return { kind: 'action', record: saved.action, replayed: saved.status === 'replayed' };
  };
  return { propose_plan_swap: propose };
}

/** Sent when `propose_plan_swap` is offered (a plan in use). */
export const PLAN_SWAP_LINE = [
  'To swap one exercise in every day of Ben’s plan from now on ("swap leg press for leg extension in my plan", "across the full plan", "every week"), call propose_plan_swap in this turn: `remove` is the exercise going out, `add` the one coming in, catalogueIds from YOUR DATA plan.inUse.days or find_exercises. Only that exercise changes in each day. It is always a proposal Ben applies with Undo: never say it changed.',
  'If he says "swap A and B" without saying which goes, and one of them is in YOUR DATA notPreferred, that one comes out. Never put an exercise from notPreferred into his plan or a workout: if he asks for one, say in one short line that it is marked not preferred in his plan settings.',
  'This week only is propose_week; today only is edit_today. After "full plan" or "every week", never offer to change only this week.',
].join('\n');

export type PlanScope = 'plan' | 'week' | 'today';

const WEEK_SCOPE = /\b(?:this|the) week\b|\bthis week'?s\b|\bfor the week\b|\bweek only\b/;
const PLAN_SCOPE =
  /\b(?:full|whole|entire|overall) plan\b|\bacross (?:the|my|all) (?:whole |full |entire )?(?:plan|days|weeks|program(?:me)?)\b|\bthroughout\b|\bevery (?:week|day of (?:my|the) plan|plan day)\b|\ball (?:the |my )?(?:weeks|plan days)\b|\bfrom now on\b|\bpermanent(?:ly)?\b|\bplan[- ]wide\b|\b(?:in|to|on|from|for) (?:the|my) plan\b|\b(?:the|my) plan\b|\bgoing forward\b|\bfor good\b/;
const TODAY_SCOPE = /\btoday\b|\bright now\b|\bthis (?:workout|session)\b/;

/** What Ben's words aim a change at, or null. This week wins over "my plan" ("change my plan this week"). */
export function planScopeOf(text: string): PlanScope | null {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  if (WEEK_SCOPE.test(t)) return 'week';
  if (PLAN_SCOPE.test(t)) return 'plan';
  if (TODAY_SCOPE.test(t)) return 'today';
  return null;
}

/** The scope of his words now, else of his last message in the thread that had one. */
export function threadPlanScope(text: string | null, earlierBen: readonly string[]): PlanScope | null {
  const now = text === null ? null : planScopeOf(text);
  if (now !== null) return now;
  for (const w of [...earlierBen].reverse()) {
    const s = planScopeOf(w);
    if (s !== null) return s;
  }
  return null;
}

/** Shown once in place of a hidden "can't change your plan here" sentence when the plan swap is offered. */
export const PLAN_ASK_LINE = 'Want me to change your plan?';

/** `Why?` → `Not shown` for a sentence saying the coach can't change his plan when it can. */
export const NO_PLAN_TOOL_DETAIL = 'The coach can change your plan.';

/** A bare acceptance of the coach's last offer ("yes", "do it"). Anything longer is classified on its own. */
export const BARE_ACCEPT = /^(?:yes|yeah|yep|yup|sure|ok|okay|please|do it|go on|go ahead|go for it|sounds good|yes please|ok do it|ok go|let'?s do it)[.!\s]*$/i;

export function isBareAccept(text: string): boolean {
  return BARE_ACCEPT.test(text.trim().replace(/[’]/g, "'"));
}

/** A coach question offering to act: "Want me to …?", "Shall I …?", "Should I …?", "Do you want me to …?". */
const OFFER_QUESTION = /\b(?:want me to|shall i|should i|would you like me to|do you want me to|happy for me to|ok if i)\b[^?]*\?\s*$/i;

export interface OfferContinuation {
  /** Ben's words that led to the offer, then his answer: read as his request this turn. */
  request: string;
  /** The coach's offer, as shown. */
  offer: string;
}

/**
 * Ben answers the coach's own offer ("Yes", or a short scope like "full plan") in the next message: his request is the
 * words that led to it plus his answer. Null when the last message isn't the coach's offer, or his words are more than
 * an answer (classified on their own).
 */
export function offerContinuationOf(history: readonly CoachMessage[], said: string): OfferContinuation | null {
  const text = said.trim();
  const short = text.split(/\s+/).filter((w) => w !== '').length <= 5;
  if (!isBareAccept(text) && !(short && planScopeOf(text) !== null)) return null;
  const sorted = [...history].sort((a, b) => a.ordinal - b.ordinal);
  const last = sorted.at(-1);
  if (last === undefined || last.body.role !== 'coach') return null;
  const sentences = last.body.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));
  const offer = sentences.at(-1);
  if (offer === undefined || !OFFER_QUESTION.test(offer.trim())) return null;
  // The words that led to it: his last message in words before that offer, skipping earlier bare answers.
  const before = sorted.filter((m) => m.ordinal < last.ordinal && m.body.role === 'ben');
  const words = before.flatMap((m) => (m.body.role === 'ben' && m.body.input.kind === 'words' ? [m.body.input.text] : []));
  const asked = [...words].reverse().find((w) => !isBareAccept(w) && w.trim().split(/\s+/).length > 3) ?? null;
  const scopes = [...words.filter((w) => w !== asked && planScopeOf(w) !== null).slice(-2), text];
  return { request: [asked ?? '', ...scopes].filter((w) => w.trim() !== '').join('\n'), offer };
}

/** Sent on a turn that answers the coach's own offer: act on it now. */
export function offerAcceptedLine(c: OfferContinuation): string {
  return `Ben's message answers your last offer ("${c.offer.slice(0, 200)}"): he asked for it. Do it now with the matching tool in this turn, in the scope he gave; do not ask again.`;
}
