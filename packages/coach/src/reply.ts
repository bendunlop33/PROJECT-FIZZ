import { setNumbersText } from '@fizz/domain';
import type { HiddenLine } from '@fizz/schemas';
import { BUILD_ASK_LINE, BUILD_OFFER_LINE, claimsNoBuildTool, claimsWorkoutBuilt } from './build-ask';
import { checkReplyClaims, isChangeClaim, type TurnLedger } from './claims';
import { normaliseForClaims } from './text';
import { EXERCISE_WORD } from './vocab';
import { type RenderSurface, type RenderedAction } from './render';
import { SentenceBuffer, splitSentences } from './sentences';
import { resolveActionTokens } from './tokens';

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

export function claimNoteFor(ledger: TurnLedger, hiddenCount: number, surface: RenderSurface): ClaimNote | null {
  if (hiddenCount === 0) return null;
  const live = liveThisTurn(ledger);
  if (live.length === 0) return { text: `Nothing changed · ${linesSaid(hiddenCount)}`, spoken: 'Nothing changed.' };
  if (surface === 'summary') return { text: `Only the changes shown were made · ${linesSaid(hiddenCount)}`, spoken: null };
  if (surface === 'slot') {
    const numbers = live.flatMap((e) => (e.record.detail.kind === 'adjust_pending_sets' ? e.record.detail.exercises.flatMap((x) => x.changes.map((c) => c.setNumber)) : []));
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
  if (/\d/.test(t) || CHANGE_TOPIC.test(t)) return true;
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
  /**
   * Review r5 B2: a coach draft already exists in this thread (or is in context). "It's ready in
   * Workouts" is then true, so only a claim of another new workout is hidden.
   */
  draftExists?: boolean;
}

export function createReplyFilter(options: ReplyFilterOptions): ReplyFilter {
  const buffer = new SentenceBuffer();
  const hidden: HiddenLineDraft[] = [];
  const said: string[] = [];
  let askLineShown = false;

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
    const draftThisTurn = ledger.entries.some((e) => e.origin === 'this_turn' && e.record.detail.kind === 'build_workout');
    const toolOffered = options.toolOffered === true;
    if (options.noBuildToolLine === true && !draftThisTurn && claimsNoBuildTool(tokens.plainText, { generic: options.buildAsked === true })) {
      hidden.push({ sentence: tokens.plainText, reason: 'no_action', detail: NO_BUILD_TOOL_DETAIL });
      if (!askLineShown) out.push({ kind: 'sentence', text: toolOffered ? BUILD_OFFER_LINE : BUILD_ASK_LINE });
      askLineShown = true;
      for (const a of actions) out.push({ kind: 'action_line', ref: a.ref, actionId: a.actionId, rendered: a.rendered });
      return out;
    }
    // Review r3 B1, r4 B2/S1: with no saved draft this turn (no tool, the tool not used, or `propose_workout`
    // refused), "I'll set that up for you" and "It's ready in your workouts" are false. Hidden. Only on a
    // turn without the tool does the reply ask, once, "Want me to build it in the app?"; with the tool the
    // false claim is just dropped, and a refused build's card already says what happened.
    const draftSaved = ledger.entries.some((e) => e.origin === 'this_turn' && e.record.detail.kind === 'build_workout' && e.record.status === 'committed' && e.record.undoneBy === null);
    if (options.noBuildToolLine === true && !draftSaved && actions.length === 0 && claimsWorkoutBuilt(tokens.plainText, { inPlay: options.buildAsked === true, draftExists: options.draftExists === true })) {
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
      const check = checkReplyClaims(tokens.plainText, claimLedger, cited);
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
    note() {
      const note = claimNoteFor(options.ledger(), hidden.length, options.surface);
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

/** Stamp drafts for storage (`HiddenLine`, Your data). */
export function toHiddenLines(turnId: string, drafts: readonly HiddenLineDraft[], atUtc: string): HiddenLine[] {
  return drafts.map((d) => ({ turnId, sentence: d.sentence.slice(0, 2000), reason: d.reason, detail: d.detail, atUtc }));
}
