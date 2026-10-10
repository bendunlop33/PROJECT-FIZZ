import { setNumbersText } from '@fizz/domain';
import type { HiddenLine } from '@fizz/schemas';
import { checkReplyClaims, isChangeClaim, type TurnLedger } from './claims';
import { normaliseForClaims } from './text';
import { EXERCISE_WORD } from './vocab';
import { renderActionResult, type RenderSurface, type RenderedAction } from './render';
import { SentenceBuffer, splitSentences } from './sentences';
import { resolveActionTokens } from './tokens';

/**
 * The honesty pipeline for one coach reply (coach-contract CC1–CC9): streamed
 * text → finished sentences → tokens rendered from saved records → claim
 * check → shown, replaced or hidden. Nothing reaches the screen or the
 * speaker without passing through here.
 */

export type ReplyItem =
  /** A model sentence that passed the check (token-free text). */
  | { kind: 'sentence'; text: string }
  /** App text for a `[[ref]]` the coach cited. */
  | { kind: 'action_line'; ref: string; actionId: string; rendered: RenderedAction }
  /** A claim whose numbers differed from the saved ones, replaced by the rendered line (CC4). */
  | { kind: 'replaced'; actionId: string; rendered: RenderedAction };

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

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function linesSaid(n: number): string {
  const count = COUNT_WORDS[n] ?? String(n);
  return n === 1 ? `${count} line said otherwise and is hidden.` : `${count} lines said otherwise and are hidden.`;
}

/** Does this turn have a saved change that still stands? */
function liveThisTurn(ledger: TurnLedger) {
  return ledger.entries.filter((e) => e.origin === 'this_turn' && e.record.status === 'committed' && e.record.undoneBy === null);
}

export function claimNoteFor(ledger: TurnLedger, hiddenCount: number, surface: RenderSurface): ClaimNote | null {
  if (hiddenCount === 0) return null;
  const live = liveThisTurn(ledger);
  if (live.length === 0) return { text: `Nothing was changed. ${linesSaid(hiddenCount)}`, spoken: 'Nothing was changed.' };
  if (surface === 'summary') return { text: `Only the changes shown under Next time were made. ${linesSaid(hiddenCount)}`, spoken: null };
  if (surface === 'slot') {
    const numbers = live.flatMap((e) => (e.record.detail.kind === 'adjust_pending_sets' ? e.record.detail.exercises.flatMap((x) => x.changes.map((c) => c.setNumber)) : []));
    if (numbers.length > 0) {
      const which = setNumbersText(numbers);
      return { text: `Only ${which} ${numbers.length === 1 ? 'was' : 'were'} changed.`, spoken: null };
    }
  }
  return { text: `Only the changes shown here were made. ${linesSaid(hiddenCount)}`, spoken: null };
}

/** The fixed line for review r4 spec issue 1, option (a). */
export const NO_CHANGE_SAVED_LINE = 'No change was saved in this reply.';

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

export interface ReplyFilterOptions {
  /** The ledger as it is now; read again for every sentence, since tools commit during the turn. */
  ledger: () => TurnLedger;
  surface: RenderSurface;
  /**
   * Review r4 spec issue 1, option (a); on by default since review r5 B1c
   * (pending Ben/PM sign-off, see ADR 0019). `note()` returns `No change was
   * saved in this reply.` when no live change was saved this turn and the
   * reply makes a statement with training content, even if no sentence was
   * hidden. Pass `false` only in tests of the claim check on its own.
   */
  noChangeLine?: boolean;
  /** See `NoChangeLineContext.benAskedForChange`. */
  benAskedForChange?: boolean;
}

export function createReplyFilter(options: ReplyFilterOptions): ReplyFilter {
  const buffer = new SentenceBuffer();
  const hidden: HiddenLineDraft[] = [];
  const said: string[] = [];

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

    if (tokens.plainText.length > 0 && /[\p{L}\p{N}]/u.test(tokens.plainText)) {
      const check = checkReplyClaims(tokens.plainText, ledger, cited);
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
      if (check.reason === 'numbers_differ' && check.replaceWith !== null) {
        if (!cited.has(check.replaceWith)) {
          const entry = ledger.entries.find((e) => e.record.actionId === check.replaceWith);
          if (entry) out.push({ kind: 'replaced', actionId: entry.record.actionId, rendered: renderActionResult(entry.record, options.surface, { earlier: entry.origin === 'earlier' }) });
        }
        // Replaced, not hidden from Ben: the model's own sentence is still listed in Why? (CC9).
        hidden.push({ sentence: tokens.plainText, reason: 'numbers_differ', detail: check.detail });
      } else {
        hidden.push({ sentence: tokens.plainText, reason: check.reason, detail: check.detail });
      }
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
      // A replaced number is shown correctly, so it needs no note (§3 `Number mismatch`).
      const count = hidden.filter((h) => h.reason !== 'numbers_differ').length;
      const note = claimNoteFor(options.ledger(), count, options.surface);
      if (note === null && options.noChangeLine !== false && needsNoChangeLine(said.join(' '), options.ledger(), { benAskedForChange: options.benAskedForChange === true })) {
        return { text: NO_CHANGE_SAVED_LINE, spoken: null };
      }
      return note;
    },
  };
}

/** Stamp drafts for storage (`HiddenLine`, Your data). */
export function toHiddenLines(turnId: string, drafts: readonly HiddenLineDraft[], atUtc: string): HiddenLine[] {
  return drafts.map((d) => ({ turnId, sentence: d.sentence.slice(0, 2000), reason: d.reason, detail: d.detail, atUtc }));
}
