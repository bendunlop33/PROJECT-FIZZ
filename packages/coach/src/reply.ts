import { setNumbersText } from '@fizz/domain';
import type { HiddenLine } from '@fizz/schemas';
import { BUILD_ASK_LINE, BUILD_OFFER_LINE, claimsNoBuildTool, claimsWorkoutBuilt } from './build-ask';
import { checkReplyClaims, isChangeClaim, type TurnLedger } from './claims';
import { mergeFacts, collectFacts, verifiedRecordStatement, verifySentence, type NumberFacts } from './numbers';
import { renderActionResult, type RenderSurface, type RenderedAction } from './render';
import { normaliseForClaims } from './text';
import { EXERCISE_WORD } from './vocab';
import { SentenceBuffer, splitSentences } from './sentences';
import { resolveActionTokens } from './tokens';
import { NO_PLAN_TOOL_DETAIL, PLAN_ASK_LINE, type PlanScope } from './plan-swap';

/**
 * The backstop for the coach's `message` (coach-contract CC3–CC9, PM
 * decision 10 Oct 2026). Honesty is structural: the model's words arrive
 * only as the `reply` function's `message` (reply-tool.ts), and every change
 * Ben sees is a card rendered from a committed `ActionRecord` by the turn
 * engine, never from these sentences. This filter is the backstop on top:
 * message text → finished sentences → `[[ref]]` tokens rendered from saved
 * records → claim check → shown or dropped. A sentence that still talks as
 * if it made a change is dropped whole (never rewritten), and listed in
 * `Why?` → `Not shown`.
 */

export type ReplyItem =
  /** A model sentence that passed the check (token-free text). */
  | { kind: 'sentence'; text: string }
  /** App text for a `[[ref]]` the coach cited. */
  | { kind: 'action_line'; ref: string; actionId: string; rendered: RenderedAction };

export interface HiddenLineDraft {
  sentence: string;
  reason: HiddenLine['reason'];
  detail: string;
}

export interface ClaimNote {
  /** `ClaimCheckNote` text (§5.2). */
  text: string;
  /** For voice turns only; null when rendered spoken lines already say what changed. */
  spoken: string | null;
}

export interface ReplyFilter {
  push(delta: string): ReplyItem[];
  /** `completed: false` when Ben stopped it, the stream stalled or the app closed mid-turn. */
  end(completed: boolean): ReplyItem[];
  readonly hiddenLines: readonly HiddenLineDraft[];
  /** Review S3: a "no tool for that" sentence was hidden on a live turn and `TODAY_ASK_LINE` shown in its place. */
  readonly noTodayToolHidden: boolean;
  /** At most one note per reply, after its last sentence. Null when nothing was hidden. */
  note(): ClaimNote | null;
}

/** `1 line hidden`, `2 lines hidden` (minimal copy W15). */
function linesSaid(n: number): string {
  return `${String(n)} ${n === 1 ? 'line' : 'lines'} hidden`;
}

/** Does this turn have a saved change that still stands? */
function liveThisTurn(ledger: TurnLedger) {
  return ledger.entries.filter((e) => e.origin === 'this_turn' && e.record.status === 'committed' && e.record.undoneBy === null);
}

export function claimNoteFor(ledger: TurnLedger, hiddenCount: number, surface: RenderSurface, numberHidden = 0): ClaimNote | null {
  // Coach v3: a sentence hidden only for an unchecked number claimed no change, so the note says only that it was hidden.
  if (hiddenCount === 0) return numberHidden === 0 ? null : { text: linesSaid(numberHidden), spoken: null };
  hiddenCount += numberHidden;
  const live = liveThisTurn(ledger);
  // (Ben, 30 Oct, build 486) A plan swap's card this turn (a proposal, or the one line saying why not) already says
  // where things stand: the note only counts the hidden lines, never a second "Nothing changed" beside it.
  if (live.length === 0 && ledger.entries.some((e) => e.origin === 'this_turn' && e.record.detail.kind === 'propose_plan_swap')) return { text: linesSaid(hiddenCount), spoken: null };
  if (live.length === 0) return { text: `Nothing changed · ${linesSaid(hiddenCount)}`, spoken: 'Nothing changed.' };
  if (surface === 'summary') return { text: `Only the changes shown were made · ${linesSaid(hiddenCount)}`, spoken: null };
  if (surface === 'slot') {
    const numbers = live.flatMap((e) => (e.record.detail.kind === 'adjust_pending_sets' || e.record.detail.kind === 'edit_today' ? e.record.detail.exercises.flatMap((x) => x.changes.map((c) => c.setNumber)) : []));
    if (numbers.length > 0) {
      const which = setNumbersText(numbers);
      return { text: `Only ${which} ${numbers.length === 1 ? 'was' : 'were'} changed.`, spoken: null };
    }
  }
  return { text: `Only the changes shown were made · ${linesSaid(hiddenCount)}`, spoken: null };
}

/**
 * The fixed no-change line (review r4 spec issue 1, option a). Minimal copy
 * (CLAUDE.md, Ben 10 Oct): the shortest true statement.
 */
export const NO_CHANGE_SAVED_LINE = 'No change made.';

/**
 * Training content or acknowledgement words. With no live change this turn,
 * any of these in a statement gets the fixed line (review r4 spec issue 1,
 * widened in review r5 B1c): loads, sets, reps, exercises, the card or plan,
 * next time, undo forms, memories, flags and bare acknowledgements ("Got
 * that.", "Banked.", "In it goes.", "On the card now.").
 */
const CHANGE_TOPIC = new RegExp(
  `\\b(?:kgs?|lbs?|kilos?|pounds?|sets?|reps?|weights?|loads?|plates?|targets?|lighter|heavier|easier|harder|memory|memories|remember(?:ed)?|forgot(?:ten)?|noted|note|flag(?:ged|s)?|undo(?:ne)?|undid|revert(?:ed)?|rolled back|reversed|back (?:to|at|on)|as (?:you were|before|it was)|same as before|playbook|rules?|next (?:time|session|week|workout)|from now on|going forward|swap(?:ped)?|saved|stored|logged|changed|updated|adjusted|applied|card|plan|programme|program|routine|schedule|on (?:my|the|your) list|on file|filed|banked|bank|booked|locked|loaded|sorted|handled|done|dealt with|taken care of|on it|will do|got (?:that|this|it)|in (?:it|they|that) goes?|all in|good to go|ready to go|know (?:you|that you|your)|progress(?:ion|ing)?|increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|hold(?:ing)?|on hold|paused|amrap|failure|drop ?sets?|${EXERCISE_WORD})\\b`,
);
/** A statement with a tag ("95 for the rest, yeah?") isn't a question. */
const TAG_QUESTION = /,?\s*(?:yeah|yep|yes|right|ok|okay|eh|innit|correct|alright|no|got it|cool|done|ya|yup)\s*\?+\s*$/i;

function isPureQuestion(sentence: string): boolean {
  return /\?\s*$/.test(sentence) && !TAG_QUESTION.test(sentence);
}

export interface NoChangeLineContext {
  /**
   * Ben's own message (or chip) in this turn asked for a change
   * (`classifyBenRequest` / `chipRequest` returned a request). Any reply
   * that isn't only questions then gets the line when nothing was saved.
   */
  benAskedForChange?: boolean;
}

/**
 * Review r4 spec issue 1, option (a), widened and inverted for review r5
 * B1c. With no live committed change this turn, a reply gets the fixed line
 * unless it is only questions or has no training content at all. It doesn't
 * depend on recognising each phrasing, so a claim the word lists miss ("Back
 * at 100.", "Banked.", "95 it is.") is still contradicted on screen. The line
 * is always true when it shows (nothing was saved), so a false show costs
 * only a line of noise; a false miss lets a phantom change stand. Pure.
 */
export function needsNoChangeLine(replyText: string, ledger: TurnLedger, context: NoChangeLineContext = {}): boolean {
  if (liveThisTurn(ledger).length > 0) return false;
  const statements = splitSentences(replyText).filter((s) => /[\p{L}\p{N}]/u.test(s) && !isPureQuestion(s));
  if (statements.length === 0) return false;
  if (context.benAskedForChange === true) return true;
  const t = normaliseForClaims(statements.join(' '));
  // Coach v3 (ADR 0027): a number alone ("your best is 100 kg × 5") is no longer a change topic; numbers are checked against the facts instead.
  if (CHANGE_TOPIC.test(t)) return true;
  if (statements.some((s) => isChangeClaim(s))) return true;
  return ledger.knownExerciseNames.some((n) => t.includes(n.toLowerCase()));
}

/** Any card at all this turn (committed, proposed or not done): the card already says what happened. */
function anyCardThisTurn(ledger: TurnLedger): boolean {
  return ledger.entries.some((e) => e.origin === 'this_turn');
}

/**
 * The structural no-change line (PM decision 10 Oct 2026). Ben's own words
 * or chip asked for a change (`classifyBenRequest` / `chipRequest`), the turn
 * produced no card at all, and the reply says something other than
 * questions (emoji included): `No change made.` It reads no phrase list, so
 * an unrecognised acknowledgement ("Boom.", "👍") can't stand in for a card.
 */
export function needsStructuralNoChangeLine(replyText: string, ledger: TurnLedger, benAskedForChange: boolean): boolean {
  if (!benAskedForChange || anyCardThisTurn(ledger)) return false;
  return splitSentences(replyText).some((s) => s.trim().length > 0 && !isPureQuestion(s));
}

/**
 * When the fixed line shows:
 * - `structural` (default): `needsStructuralNoChangeLine`.
 * - `topic`: the r5 phrase-based rule (`needsNoChangeLine`), kept so Ben/PM
 *   can compare; it adds the line to any reply with training words.
 * - `off`: claim check only (tests of the claim check on its own).
 */
/** `Why?` → `Not shown` for a sentence that restated a saved change in its own words. */
export const CARD_ONLY_DETAIL = 'Changes show on their cards, not in the reply.';

/** `Why?` → `Not shown` for a sentence saying the app can't build a workout (build 131). */
export const NO_BUILD_TOOL_DETAIL = 'The app can build a workout draft.';

/** `Why?` → `Not shown` for a sentence saying the coach can't change today's workout (review S3). */
export const NO_TODAY_TOOL_DETAIL = 'The coach can change today’s workout.';

/** Shown once in place of a hidden "no tool" sentence on a live turn; the turn makes it an offer (Adjust). */
export const TODAY_ASK_LINE = 'Want me to adjust?';

const NO_TOOL_LEAD = String.raw`(?:\b(?:i|we) (?:do not|don't|dont|can't|cant|cannot|can not|am not able to|'m not able to|am unable to|'m unable to|have no|lack|won't be able to)|\bthere(?:'s| is) no|\bi(?:'m| am) not able)`;
const NO_TODAY_TOOL = new RegExp(`${NO_TOOL_LEAD}[^.?!]{0,30}?\\b(?:tool|tools|ability|function|access|option)\\b`);
const CANT_DO_HERE = /\b(?:i|we) (?:can't|cant|cannot|can not|am unable to|'m unable to|am not able to|'m not able to) (?:directly )?(?:change|adjust|update|edit|modify|repopulate|recalculate|set|add|rename|alter|raise|lower|increase|decrease|apply)\b[^.?!]{0,40}?\b(?:here|directly|from (?:here|this chat)|in (?:the|this) (?:app|chat)|for you)\b/;
const DO_IT_YOURSELF_TODAY = /\byou(?:'ll| will)? ?(?:need|have) to (?:change|adjust|update|edit|enter|set|add|rename)\b[^.?!]{0,40}?\b(?:yourself|manually|by hand)\b/;

/**
 * Review S3 (build 151: "I don't have a tool to repopulate them directly here."): on a live turn the
 * coach can change today's sets, add and rename, so saying it can't is false. Hidden and replaced.
 */
export function claimsNoTodayTool(sentence: string): boolean {
  const t = sentence.toLowerCase().replace(/[‘’]/g, "'");
  return NO_TODAY_TOOL.test(t) || CANT_DO_HERE.test(t) || DO_IT_YOURSELF_TODAY.test(t);
}

/** `Why?` → `Not shown` for a sentence saying the coach can't change this week (ADR 0039). */
export const NO_WEEK_TOOL_DETAIL = 'The coach can change this week.';

/** Shown once in place of a hidden "no week tool" sentence (ADR 0039). */
export const WEEK_ASK_LINE = 'Want me to change this week?';

const WEEK_WORDS = /\b(?:week|weekly|weeks|plan|planning|schedule|rest day|days|sessions|workouts)\b/;
const NOT_AVAILABLE_HERE = /\b(?:not|isn't|is not|aren't|are not)\b[^.?!]{0,20}\bavailable\b[^.?!]{0,20}\b(?:here|in this chat|from this chat|in this thread)\b/;
const IN_THIS_CHAT = /\b(?:in|from) this (?:chat|thread)\b/;

/**
 * ADR 0039: "I don't have a weekly-plan editing tool available in this chat", "I can't change your plan here":
 * false wherever `propose_week` is offered (every chat with a week). Only about his week or plan: a true limit
 * ("multi-week blocks aren't available yet") names no chat and no missing tool, and is kept.
 */
export function claimsNoWeekTool(sentence: string): boolean {
  const t = sentence.toLowerCase().replace(/[‘’]/g, "'");
  if (!WEEK_WORDS.test(t) || /\bmulti-?week\b|\bblocks?\b|\bdeloads?\b/.test(t)) return false;
  return claimsNoTodayTool(t) || NOT_AVAILABLE_HERE.test(t) || (IN_THIS_CHAT.test(t) && new RegExp(NO_TOOL_LEAD).test(t));
}

const WEEK_AIM = /\b(?:this|the) week\b|\bweekly\b|\bweek'?s\b|\brest day\b|\bthis week'?s days\b/;

/**
 * (Ben, 30 Oct) What a hidden "can't change it here" sentence was about: Ben's own scope wins (after "full plan" it is
 * the plan, whatever the sentence says); with none, the sentence's own words (the week, else his plan). Pure.
 */
export function noToolAim(sentence: string, scope: PlanScope | null): 'week' | 'plan' {
  if (scope === 'plan') return 'plan';
  if (scope === 'week') return 'week';
  const t = sentence.toLowerCase().replace(/[‘’]/g, "'");
  return WEEK_AIM.test(t) || !/\bplan\b/.test(t) ? 'week' : 'plan';
}

/** `Why?` → `Not shown` for a sentence saying a change failed when nothing this turn says so (21 Oct). */
export const FAILURE_CLAIM_DETAIL = 'It said a change didn’t go through; no tool result this turn says so.';

// Review coach-fail S3: a bare pronoun ("it didn't land well with your elbow") is a claim only with a verb
// that can only mean a change landing; a change noun takes any of them. Neither counts when "well" follows.
const CHANGE_NOUN = '(?:adjustment|adjustments|change|changes|edit|edits|update|updates|tweak|tweaks|request)';
const PRONOUN = '(?:it|that|this|they|those|these|them)';
const FAILED_VERB = '(?:didn\'?t|did not|hasn\'?t|has not|haven\'?t|have not|wasn\'?t|was not|weren\'?t|were not|couldn\'?t|could not|won\'?t|wouldn\'?t|isn\'?t|is not|failed to|never)';
const LANDED = '(?:go(?:ne)? through|went through|appl(?:y|ied)|stick|stuck|save|saved|land|landed|register|registered|accepted|allowed)';
const PRONOUN_LANDED = '(?:go(?:ne)? through|went through|appl(?:y|ied)|save|saved|register|registered)';
// "I couldn't apply it", "I wasn't able to change the sets": an app noun or a bare pronoun object, never
// "completed/logged sets" (a true rule-2 statement) and never "make that call".
const ACTION_VERB = '(?:apply|save|make|update|change|adjust|push|get|set)';
const ACTION_OBJECT = `(?:(?:the|that|this|your|my|those|these) )?(?:${CHANGE_NOUN}|(?:new |heavier |lighter )?(?:weights?|loads?|targets?|numbers?))\\b|${PRONOUN}(?= ?(?:[.,;:!]|$| (?:through|to (?:apply|save|stick)|stick|apply|go through)\\b))`;
const FAILURE_CLAIM: readonly RegExp[] = [
  // "The adjustment didn't go through", "it wasn't applied", "that change failed to save"
  new RegExp(`\\b(?:the |that |this |your |my )?${CHANGE_NOUN} (?:still )?${FAILED_VERB} (?:\\w+ )?${LANDED}\\b(?! well)`),
  new RegExp(`\\b${PRONOUN} (?:still )?${FAILED_VERB} (?:\\w+ )?${PRONOUN_LANDED}\\b(?! well)`),
  new RegExp(`\\b(?:adjustment|change|changes|edit|edits|update|request)s? (?:failed|errored|bounced)\\b`),
  // "it was rejected", "the change got blocked"
  /\b(?:adjustment|change|changes|edit|edits|update|request|it|that|they|those) (?:was|were|got|gets|has been|have been|is being|are being|keeps? (?:being|getting)) (?:rejected|refused|blocked|declined|denied)\b/,
  // "the app is rejecting changes", "the app won't let me"
  /\b(?:app|system|tool|it) (?:is |was |keeps |kept )?(?:rejecting|refusing|blocking|declining|not accepting|not letting|won'?t (?:accept|let|allow)|wouldn'?t (?:accept|let|allow)|didn'?t (?:accept|let|allow))\b/,
  new RegExp(`\\bi (?:couldn'?t|could not|can'?t|cannot|wasn'?t able to|was unable to|am unable to|failed to|didn'?t manage to) ${ACTION_VERB} (?:${ACTION_OBJECT})`),
];

/**
 * (21 Oct, Ben's Build B report: "The adjustment didn't go through" with no tool call behind it) The
 * sentence says a change failed, was rejected or didn't apply. Pure; questions and conditionals
 * ("If it doesn't apply, …") aren't claims.
 */
export function claimsChangeFailed(sentence: string): boolean {
  const t = sentence.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
  if (/\?\s*$/.test(t) || /^\s*(?:if|unless|when|in case)\b/.test(t)) return false;
  return FAILURE_CLAIM.some((re) => re.test(t));
}

/** `Why?` → `Not shown` for a sentence promising or claiming a workout in the app when none was built (review r3 B1). */
export const NO_DRAFT_BUILT_DETAIL = 'No workout was built.';

export type NoChangeLineMode = 'structural' | 'topic' | 'off';

export interface ReplyFilterOptions {
  /** The ledger as it is now; read again for every sentence, since tools commit during the turn. */
  ledger: () => TurnLedger;
  surface: RenderSurface;
  /** Default `structural`. */
  noChangeLine?: NoChangeLineMode;
  /**
   * Default true: a sentence that states a change is kept only when it cites
   * that change's `[[ref]]` and matches it. False restores the r1–r6
   * behaviour (any committed change this turn can back a claim), for
   * tests of the ledger matching.
   */
  claimsNeedToken?: boolean;
  /** See `NoChangeLineContext.benAskedForChange`. */
  benAskedForChange?: boolean;
  /**
   * Build 131, review B1: a general turn where the app can build a workout. A sentence saying
   * it can't (`claimsNoBuildTool`) is then false, so it is hidden and `BUILD_ASK_LINE` shown once,
   * unless this turn already made a draft card. Review r3 B1: a promise or done-claim about a workout in
   * the app (`claimsWorkoutBuilt`) is hidden too unless this turn saved a draft. Default false: elsewhere such a sentence goes
   * through the usual check, and true limits are never replaced.
   */
  noBuildToolLine?: boolean;
  /**
   * Review r2 S3: Ben asked for a build this turn, or is following one up (a build in play). A refusal
   * that names no workout ("I can't do that in the app", "I don't have a tool for that") is then the
   * same false claim, and short done-claims ("On it!", "It's saved") are read as claims about a
   * workout (review r4 S1). Only read with `noBuildToolLine`.
   */
  buildAsked?: boolean;
  /**
   * Review r4 S5: `propose_workout` was offered on this turn. A hidden "can't build" is then replaced
   * by the fixed offer (`BUILD_OFFER_LINE`), and a hidden false promise is only dropped. Without the
   * tool, a hidden promise is replaced by the offer and a "can't build" by `BUILD_ASK_LINE`.
   */
  toolOffered?: boolean;
  /** Review S3: the today-tools were offered (a live workout). A "no tool" sentence is then false (`claimsNoTodayTool`). */
  todayToolsOffered?: boolean;
  /**
   * ADR 0039 (Ben, 29 Oct: "I don't have a weekly-plan editing tool available in this chat"): `propose_week` was
   * offered. A sentence saying the coach can't change his week or plan here (`claimsNoWeekTool`) is then false: hidden,
   * and `WEEK_ASK_LINE` shown once in its place.
   */
  weekToolOffered?: boolean;
  /**
   * (Ben, 30 Oct, build 486) `propose_plan_swap` was offered (a plan in use). A sentence saying the coach can't change
   * his plan is then false: hidden, and `PLAN_ASK_LINE` shown once in its place (never the week's line for a plan ask).
   */
  planToolOffered?: boolean;
  /**
   * (Ben, 30 Oct) What Ben's words (now, else his last in the thread with one) aim at (`threadPlanScope`). The hidden
   * "can't" sentence is replaced by the offer that matches: the week's line only when this week is the target or his
   * words name none and the sentence is about the week; never after "full plan" or "every week".
   */
  planScope?: PlanScope | null;
  /**
   * Coach v3 (ADR 0027): the numbers the coach was given (context, tool outputs, Ben's words),
   * read again for every sentence. A sentence with a number not among them (or in this turn's
   * cards) is hidden (`unverified_number`). Absent: numbers aren't checked.
   */
  facts?: () => NumberFacts;
  /**
   * (21 Oct) Whether a tool result this turn wasn't applied (refused, out of date, invalid, offered). A
   * sentence saying a change failed (`claimsChangeFailed`) is kept only then; otherwise it is hidden.
   * Absent: such sentences aren't checked.
   */
  failureBacked?: () => boolean;
}

export function createReplyFilter(options: ReplyFilterOptions): ReplyFilter {
  const buffer = new SentenceBuffer();
  const hidden: HiddenLineDraft[] = [];
  const said: string[] = [];
  let askLineShown = false;
  let noTodayToolHidden = false;
  let weekAskShown = false;
  const todayKinds = new Set(['adjust_pending_sets', 'add_exercise_today', 'edit_today', 'rename_workout']);

  const process = (sentence: string): ReplyItem[] => {
    const ledger = options.ledger();
    said.push(sentence);
    const tokens = resolveActionTokens(sentence, ledger, options.surface);
    for (const ref of tokens.unknownRefs) {
      hidden.push({ sentence, reason: 'unknown_token', detail: `It cited a change (${ref}) that wasn't saved.` });
    }
    const out: ReplyItem[] = [];
    const cited = new Set<string>();
    const actions = tokens.segments.filter((s) => s.kind === 'action');
    for (const a of actions) cited.add(a.actionId);

    // Build 131: on a general turn where the app can build one, "I can't build workouts here" is false.
    // The sentence is hidden (listed in Why?) and the reply says, once, what works instead.
    const draftThisTurn = ledger.entries.some((e) => e.origin === 'this_turn' && (e.record.detail.kind === 'build_workout' || e.record.detail.kind === 'build_plan'));
    const toolOffered = options.toolOffered === true;
    if (options.noBuildToolLine === true && !draftThisTurn && claimsNoBuildTool(tokens.plainText, { generic: options.buildAsked === true })) {
      hidden.push({ sentence: tokens.plainText, reason: 'no_action', detail: NO_BUILD_TOOL_DETAIL });
      if (!askLineShown) out.push({ kind: 'sentence', text: toolOffered ? BUILD_OFFER_LINE : BUILD_ASK_LINE });
      askLineShown = true;
      for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
      return out;
    }
    // ADR 0039: the week tool is in every chat with a week; "not in this chat" is false. (Ben, 30 Oct) The offer that
    // replaces it matches what he asked: his plan (every week) or this week. A plan ask never gets the week's line, and
    // with no plan tool (no plan in use) a "can't change your plan" sentence is true and kept.
    const aim = claimsNoWeekTool(tokens.plainText) ? noToolAim(tokens.plainText, options.planScope ?? null) : null;
    const weekOffered = options.weekToolOffered === true && aim === 'week';
    const planOffered = options.planToolOffered === true && aim === 'plan';
    if (weekOffered || planOffered) {
      hidden.push({ sentence: tokens.plainText, reason: 'no_action', detail: planOffered ? NO_PLAN_TOOL_DETAIL : NO_WEEK_TOOL_DETAIL });
      const kinds = planOffered ? ['propose_plan_swap', 'build_plan'] : ['propose_week'];
      const changed = ledger.entries.some((e) => e.origin === 'this_turn' && kinds.includes(e.record.detail.kind));
      if (!changed && !weekAskShown) out.push({ kind: 'sentence', text: planOffered ? PLAN_ASK_LINE : WEEK_ASK_LINE });
      weekAskShown = true;
      for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
      return out;
    }
    if (options.todayToolsOffered === true && aim !== 'plan' && claimsNoTodayTool(tokens.plainText)) {
      hidden.push({ sentence: tokens.plainText, reason: 'no_action', detail: NO_TODAY_TOOL_DETAIL });
      const changed = ledger.entries.some((e) => e.origin === 'this_turn' && todayKinds.has(e.record.detail.kind) && e.record.status === 'committed' && e.record.undoneBy === null);
      if (!changed && !noTodayToolHidden) out.push({ kind: 'sentence', text: TODAY_ASK_LINE });
      noTodayToolHidden = noTodayToolHidden || !changed;
      for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
      return out;
    }
    // 21 Oct: "The adjustment didn't go through" with nothing this turn that wasn't applied is invented.
    if (options.failureBacked !== undefined && !options.failureBacked() && claimsChangeFailed(tokens.plainText)) {
      hidden.push({ sentence: tokens.plainText, reason: 'no_action', detail: FAILURE_CLAIM_DETAIL });
      for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
      return out;
    }
    // Review r3 B1, r4 B2/S1: with no saved draft this turn (no tool, the tool not used, or `propose_workout`
    // refused), "I'll set that up for you" and "It's ready in your workouts" are false. Hidden. Only on a
    // turn without the tool does the reply ask, once, "Want me to build it in the app?"; with the tool the
    // false claim is just dropped, and a refused build's card already says what happened.
    const draftSaved = ledger.entries.some((e) => e.origin === 'this_turn' && (e.record.detail.kind === 'build_workout' || e.record.detail.kind === 'build_plan') && e.record.status === 'committed' && e.record.undoneBy === null);
    if (options.noBuildToolLine === true && options.buildAsked === true && !draftSaved && actions.length === 0 && claimsWorkoutBuilt(tokens.plainText, { inPlay: true })) {
      hidden.push({ sentence: tokens.plainText, reason: 'no_action', detail: NO_DRAFT_BUILT_DETAIL });
      if (!askLineShown && !toolOffered && !draftThisTurn) out.push({ kind: 'sentence', text: BUILD_OFFER_LINE });
      askLineShown = true;
      return out;
    }
    if (tokens.plainText.length > 0 && /[\p{L}\p{N}]/u.test(tokens.plainText)) {
      // Structural (PM decision 10 Oct): the card is how a change is shown, so the message may
      // describe a change only in a sentence that cites that change's token. Every other
      // change-shaped sentence is checked against an empty ledger, i.e. dropped, whatever this
      // turn saved ("Also sorted your knee." beside a real bench change, review r6 B1).
      const claimLedger = options.claimsNeedToken === false ? ledger : { ...ledger, entries: ledger.entries.filter((e) => cited.has(e.record.actionId)) };
      const raw = checkReplyClaims(tokens.plainText, claimLedger, cited);
      const facts = options.facts === undefined ? null : factsWithCards(options.facts(), ledger, options.surface);
      // Coach v3: a checked statement of a record or past result ("Your heaviest bench is 102.5 kg × 6") isn't a change claim.
      const check: typeof raw = !raw.keep && raw.reason === 'no_action' && actions.length === 0 && facts !== null && verifiedRecordStatement(tokens.plainText, facts) ? { keep: true, claim: false, matchedActionIds: [] } : raw;
      const numbers = check.keep && facts !== null ? verifySentence(tokens.plainText, facts) : ({ ok: true } as const);
      if (!numbers.ok) {
        hidden.push({ sentence: tokens.plainText, reason: 'unverified_number', detail: numbers.detail });
        for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
        return out;
      }
      if (check.keep) {
        for (const seg of tokens.segments) {
          if (seg.kind === 'text') {
            const t = seg.text.trim();
            if (t.length > 0) out.push({ kind: 'sentence', text: t });
          } else {
            out.push({ kind: 'action_line', ref: seg.ref, actionId: seg.actionId, rendered: seg.rendered });
          }
        }
        return out;
      }
      // Dropped whole, whatever the reason; a wrong number is never rewritten into the model's sentence.
      // The card shows the saved values. The sentence stays in Why? (CC9), with the most specific reason:
      // what the whole ledger says about it, or that it restated a saved change without citing it.
      const full = claimLedger === ledger ? check : checkReplyClaims(tokens.plainText, ledger, cited);
      if (full.keep) hidden.push({ sentence: tokens.plainText, reason: 'mismatch', detail: CARD_ONLY_DETAIL });
      else hidden.push({ sentence: tokens.plainText, reason: full.reason, detail: full.detail });
    }
    // App lines for cited actions are always true, so they show even when the words around them were hidden.
    for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
    return out;
  };

  return {
    push(delta) {
      return buffer.push(delta).flatMap(process);
    },
    end(completed) {
      return buffer.end(completed).flatMap(process);
    },
    get hiddenLines() {
      return hidden;
    },
    get noTodayToolHidden() {
      return noTodayToolHidden;
    },
    note() {
      const numberHidden = hidden.filter((h) => h.reason === 'unverified_number').length;
      const note = claimNoteFor(options.ledger(), hidden.length - numberHidden, options.surface, numberHidden);
      if (note !== null) return note;
      const mode = options.noChangeLine ?? 'structural';
      const text = said.join(' ');
      const asked = options.benAskedForChange === true;
      const line =
        mode === 'structural'
          ? needsStructuralNoChangeLine(text, options.ledger(), asked)
          : mode === 'topic' && needsNoChangeLine(text, options.ledger(), { benAskedForChange: asked });
      return line ? { text: NO_CHANGE_SAVED_LINE, spoken: null } : null;
    },
  };
}

/** The facts plus the text of every card this turn and earlier ones in the ledger (app text, from saved records). */
function factsWithCards(facts: NumberFacts, ledger: TurnLedger, surface: RenderSurface): NumberFacts {
  if (ledger.entries.length === 0) return facts;
  return mergeFacts(facts, collectFacts(ledger.entries.map((e) => ({ text: renderActionResult(e.record, surface, { earlier: e.origin === 'earlier' }).text, setsDone: false }))));
}

/** Stamp drafts for storage (`HiddenLine`, Your data). */
export function toHiddenLines(turnId: string, drafts: readonly HiddenLineDraft[], atUtc: string): HiddenLine[] {
  return drafts.map((d) => ({ turnId, sentence: d.sentence.slice(0, 2000), reason: d.reason, detail: d.detail, atUtc }));
}
