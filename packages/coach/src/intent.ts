/**
 * Coach v3 (ADR 0027, Ben 18 Oct): the model decides what Ben meant; code checks it.
 *
 * A today-change (`edit_today`, `rename_workout`; before it, `adjust_pending_sets` and `add_exercise_today`) applies at once
 * with Undo only when Ben asked for it (rule 3). The model says whether he did (`benAsked`) and
 * copies the words that ask (`benQuote`). Code never trusts the claim alone: the quote must be in
 * Ben's own message this turn, word for word. A tap (a chip, `Adjust` on an offer) is a request
 * by itself. Word lists (`mentionsTodaysSets` …) are only the fallback when the model makes no
 * claim, or a claim code can't verify. Words scoped to a later session stay a hard veto, decided
 * before any of this (`todayScopeRefused`).
 *
 * Pure.
 */

export interface AskClaim {
  benAsked?: boolean | null | undefined;
  benQuote?: string | null | undefined;
}

export type AskVerdict =
  | { asked: true; by: 'chip' | 'accepted_offer' | 'quote' | 'words' }
  | { asked: false; by: 'model_said_no' | 'no_request' | 'not_a_request' };

export interface AskInput {
  tool: string;
  /** Ben tapped a chip this turn (Too hard, Too easy, Pain, Lighter session): a request about today's sets only. */
  chip: boolean;
  /** Ben tapped `Adjust` (or said a bare yes) on the coach's offer to adjust today's sets (review S1: sets only). */
  acceptedOffer: boolean;
  /** Ben's message this turn; null for a tap. */
  words: string | null;
  claim: AskClaim;
  /** Code's own reading of Ben's words (the regex fallback). */
  fallback: () => boolean;
  /**
   * (`edit_today`) The call only changes set targets and counts. A tap is about today's sets, so it
   * asks for those only: a swap, add, removal or move after a chip is the coach's own idea (an offer).
   */
  setsOnly?: boolean;
}

/** Fewest words a quote needs, unless it is Ben's whole message ("Heavier"). */
export const MIN_QUOTE_WORDS = 2;

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .split(/[^\p{L}\p{N}'.]+/u)
    .map((w) => w.replace(/^[.']+|[.']+$/g, ''))
    .filter((w) => w.length > 0);
}

/**
 * Is `quote` Ben's own words, copied from `words`? Case, punctuation and spacing are ignored;
 * the words themselves must match in order, whole words only. At least `MIN_QUOTE_WORDS` words,
 * or the whole of his message.
 */
export function quoteInWords(quote: string | null | undefined, words: string | null): boolean {
  if (quote === null || quote === undefined || words === null) return false;
  const q = wordsOf(quote);
  const w = wordsOf(words);
  if (q.length === 0 || w.length === 0) return false;
  if (q.length < MIN_QUOTE_WORDS && q.length !== w.length) return false;
  for (let i = 0; i + q.length <= w.length; i += 1) {
    if (q.every((x, j) => w[i + j] === x)) return true;
  }
  return false;
}

/** A short answer that is his whole message ("Working set", "Heavier"): a reply to the coach's question. */
export const MAX_ANSWER_WORDS = 4;

/** Words that make a quote a request: a verb of change, a comparative, or a polite ask. */
const REQUEST_CUE =
  /\b(?:make|swap|switch|change|add|remove|drop|lower|raise|increase|decrease|reduce|bump|cut|skip|move|replace|put|give|go|try|adjust|set|use|take|do|let's|lets|can you|could you|would you|will you|please|i want|i'd like|i would like|want to|need to|heavier|lighter|harder|easier|more|less|fewer|instead|up|down|superset|pair (?:it|this|that|them|these|those|with|up))\b/;
/** His message asks for an opinion, not a change ("what do you think?"), unless it also asks outright. */
const OPINION_ONLY = /\b(?:what do you think|do you think|should i|would it be|is it (?:ok|okay|fine|worth)|thoughts|any (?:ideas|advice|tips)|what would you)\b/;
const ASKS_OUTRIGHT = /\b(?:can you|could you|would you|will you|please)\b/;

/**
 * (Review coach-v3 S3; ADR 0027) Is a quote that is Ben's own words also a request? His whole
 * message when it is a short answer ("Working set"); else the quote reads as a request (a verb of
 * change, a comparative, a polite ask) and his message isn't only asking for an opinion. "Bench
 * felt easy, what do you think?" quoted as "felt easy" is a statement: offered, not applied (rule 3).
 */
export function quoteAsks(quote: string, words: string): boolean {
  const q = wordsOf(quote).join(' ');
  const w = wordsOf(words).join(' ');
  if (q === w && wordsOf(words).length <= MAX_ANSWER_WORDS) return true;
  if (!REQUEST_CUE.test(q)) return false;
  return !OPINION_ONLY.test(w) || ASKS_OUTRIGHT.test(w);
}

/** (Review quickgym B1) Ben's message only asks the coach's opinion ("what do you think?"), with no outright ask. */
export function asksOpinionOnly(words: string): boolean {
  const w = wordsOf(words).join(' ');
  return OPINION_ONLY.test(w) && !ASKS_OUTRIGHT.test(w);
}

/** Does `text` contain an outright ask ("can you", "please")? */
export function asksOutright(text: string): boolean {
  return ASKS_OUTRIGHT.test(wordsOf(text).join(' '));
}

/**
 * Did Ben ask for this today-change? A tap counts (for today's sets). Then the model's claim, if its quote is in his
 * message and reads as a request (`quoteAsks`); a quote of his that doesn't is an offer. A claim of "he didn't ask" is taken (the call becomes an offer). No claim, or one code
 * can't verify: the word lists decide.
 */
export function verifyAsked(input: AskInput): AskVerdict {
  // A tap asks for a change to today's sets: the set tool, or (Coach v3) the edit tool that replaced it.
  const sets = input.tool === 'adjust_pending_sets' || (input.tool === 'edit_today' && input.setsOnly !== false);
  if (sets && input.chip) return { asked: true, by: 'chip' };
  if (sets && input.acceptedOffer) return { asked: true, by: 'accepted_offer' };
  const { benAsked, benQuote } = input.claim;
  if (benAsked === true && quoteInWords(benQuote, input.words) && benQuote != null && input.words !== null) {
    // His words, but a statement or a question for an opinion: the coach's idea, offered (review S3).
    return quoteAsks(benQuote, input.words) ? { asked: true, by: 'quote' } : { asked: false, by: 'not_a_request' };
  }
  if (benAsked === false) return { asked: false, by: 'model_said_no' };
  return input.fallback() ? { asked: true, by: 'words' } : { asked: false, by: 'no_request' };
}
