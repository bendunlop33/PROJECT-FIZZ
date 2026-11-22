import { declinesChange } from './request';

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
  | { asked: true; by: 'chip' | 'accepted_offer' | 'quote' | 'claim' | 'words' }
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
  /**
   * (21 Oct, Ben's Build B report) Code's own reading: Ben's whole message this turn is a clear request to
   * change today's workout (`asksLiveChange`: "It's too light given my set on Friday", "Fix them then"). A
   * claim of the model's whose quote is only part of it ("It's too light") then still counts as his ask.
   */
  benWordsAsk?: boolean;
  /**
   * ADR 0038: code's own reading of Ben's message this turn (`classifyBenRequest` and friends) says he asked
   * for a change (a change, an add, a swap, a difficulty, a build). With the model's claim, that is his ask.
   */
  benRequested?: boolean;
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
/**
 * (21 Oct; Ben's live Back workout: "shrugs at 8 reps, I did 15 last time" got an apology and nothing changed)
 * Ben contradicting a planned value with a number of his own asks for it to be put right: the quote says
 * what he did or what it should be, with a number ("I did 15", "should be 12"), and his message objects
 * to a planned value (a question, "why", "only", "wrong", "but", or a second, different number).
 * Review B1: plain statements ("Squats felt heavy last time", "Done, I did all the reps", "I did 100 kg
 * on bench last time, felt strong") are not corrections. Only ever read for a sets-only `edit_today`.
 */
const CORRECTION_CLAIM = /\b(?:i (?:did|got|hit|managed|lifted|usually do|normally do|always do|do)|should be|supposed to be|meant to be)(?: \S+){0,3}? \d+(?:\.\d+)?\b/;
const OBJECTION = /\?|\b(?:why|only|wrong|mistake|but|instead of|should be|supposed to be|meant to be)\b/;

function numbersIn(text: string): Set<string> {
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
}

/** Does Ben's quote correct a planned value (review B1: a number plus a contradiction)? */
export function quoteCorrects(quote: string, words: string): boolean {
  const q = wordsOf(quote).join(' ');
  if (!CORRECTION_CLAIM.test(q)) return false;
  const raw = words.toLowerCase();
  return OBJECTION.test(raw) || numbersIn(raw).size >= 2;
}
/** His message asks for an opinion, not a change ("what do you think?"), unless it also asks outright. */
const OPINION_ONLY = /\b(?:what do you think|do you think|should i|would it be|is it (?:ok|okay|fine|worth)|thoughts|any (?:ideas|advice|tips)|what would you)\b/;
const ASKS_OUTRIGHT = /\b(?:can you|could you|would you|will you|please)\b/;

/**
 * (Review coach-v3 S3; ADR 0027) Is a quote that is Ben's own words also a request? His whole
 * message when it is a short answer ("Working set"); else the quote reads as a request (a verb of
 * change, a comparative, a polite ask, or, with `correction` (a sets-only `edit_today` only), a
 * correction of a planned value: `quoteCorrects`) and his message isn't
 * only asking for an opinion. "Bench
 * felt easy, what do you think?" quoted as "felt easy" is a statement: offered, not applied (rule 3).
 */
export function quoteAsks(quote: string, words: string, opts: { correction?: boolean } = {}): boolean {
  const q = wordsOf(quote).join(' ');
  const w = wordsOf(words).join(' ');
  if (q === w && wordsOf(words).length <= MAX_ANSWER_WORDS) return true;
  if (!REQUEST_CUE.test(q) && !(opts.correction === true && quoteCorrects(quote, words))) return false;
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
 * ADR 0038 (Ben, 28 Oct: "It fails to make the changes I want"): a verb of change that starts a sentence or
 * follows a polite ask ("can you make", "please swap", "I want to add", "let's do"). Read on Ben's whole
 * message, so a paraphrase in the model's quote doesn't matter. A statement ("set 2 felt good", "that went up
 * nicely") has none.
 */
const ASK_VERB =
  /(?:^|[.!?;:,\n]\s*|\b(?:can|could|would|will) (?:you|we|i) (?:please |just |maybe )?|\bplease |\bi (?:want|need|would like|'d like) (?:you to |to )?|\blet'?s |\blet us |\bgo ahead and |\bjust )(?:make|swap|switch|change|add|remove|drop|lower|raise|increase|decrease|reduce|bump|cut|skip|move|replace|put|give|use|adjust|build|fill|update|superset|pair|go|bring|start|finish|ramp|work up|build up|knock|sub|substitute|take out|get rid of|have)\b/;
/** "Rows instead of pull-ups", "Heavier please", "more weight on curls": asking without a verb. */
const ASK_NO_VERB = /\binstead\b|\b(?:heavier|lighter|harder|easier|more|less|fewer) (?:please|pls|then|today|for|on)\b|\bplease\s*[.!]?$/;

/**
 * ADR 0038: does Ben's message this turn ask for a change? A short answer to the coach's question ("Working set",
 * "Heavier"), a verb of change at a sentence's start or after a polite ask, or a verbless ask ("instead",
 * "heavier please"); with `correction`, a planned value he contradicts with a number ("I did 15, why 8?").
 * A message that only asks the coach's opinion ("should I go heavier?") doesn't, unless it also asks outright.
 */
export function benMessageAsks(words: string, opts: { correction?: boolean; structural?: boolean } = {}): boolean {
  const list = wordsOf(words);
  if (list.length === 0) return false;
  const w = list.join(' ');
  if (OPINION_ONLY.test(w) && !ASKS_OUTRIGHT.test(w)) return false;
  if (list.length <= MAX_ANSWER_WORDS) return true;
  const raw = words.toLowerCase().replace(/[‘’`´]/g, "'").trim();
  // A swap, add, removal or move must be what he asked for, not only a change of some kind ("it's too light" asks for loads).
  if (opts.structural === true) return STRUCTURAL_ASK.test(raw);
  if (ASK_VERB.test(raw) || ASK_NO_VERB.test(raw) || ASKS_OUTRIGHT.test(w)) return true;
  return opts.correction === true && quoteCorrects(words, words);
}

/** ADR 0038: words that ask for a swap, add, removal, move or superset (a structural edit of today's workout). */
const STRUCTURAL_ASK = /\b(?:swap|switch|replace|substitute|sub|instead|remove|drop|take out|get rid of|skip|add|put in|stick in|throw in|move|reorder|superset|pair|something else|something different|different exercise|alternative)\b/;

/**
 * Did Ben ask for this today-change? A tap counts (for today's sets). ADR 0038 (Ben, 28 Oct): decided once per
 * turn, leniently. The model says he asked (`benAsked`) and his message this turn asks for a change
 * (`benMessageAsks`, code's own reading `benRequested`, or a quote of his that reads as a request): asked, whatever
 * the quote's exact wording. A claim of "he didn't ask" is taken (the call becomes an offer), and so is a message
 * that asks for nothing (a statement, a question for an opinion): the coach raising a change itself is an offer.
 * No claim: the word lists decide.
 */
export function verifyAsked(input: AskInput): AskVerdict {
  // A tap asks for a change to today's sets: the set tool, or (Coach v3) the edit tool that replaced it.
  const sets = input.tool === 'adjust_pending_sets' || (input.tool === 'edit_today' && input.setsOnly !== false);
  if (sets && input.chip) return { asked: true, by: 'chip' };
  if (sets && input.acceptedOffer) return { asked: true, by: 'accepted_offer' };
  const { benAsked, benQuote } = input.claim;
  // Review coach-fail B2: Ben declined or deferred ("I'll fix it myself", "don't bump it", "not now"): his words never
  // ask, whatever the model quotes or the word lists say (rule 3). The call becomes an offer.
  if (input.words !== null && declinesChange(input.words)) return { asked: false, by: benAsked === false ? 'model_said_no' : 'not_a_request' };
  if (benAsked === false) return { asked: false, by: 'model_said_no' };
  if (benAsked === true && input.words !== null) {
    // Review B1: a correction ("I did 15") asks only for today's set targets, never a structural edit or a lift target.
    const correction = input.tool === 'edit_today' && input.setsOnly === true;
    if (benQuote != null && quoteInWords(benQuote, input.words) && quoteAsks(benQuote, input.words, { correction })) return { asked: true, by: 'quote' };
    if (input.benWordsAsk === true) return { asked: true, by: 'words' };
    if (asksOpinionOnly(input.words)) return { asked: false, by: 'not_a_request' };
    if (input.benRequested === true || benMessageAsks(input.words, { correction, structural: input.tool === 'edit_today' && input.setsOnly === false })) return { asked: true, by: 'claim' };
    return { asked: false, by: 'not_a_request' };
  }
  return input.fallback() ? { asked: true, by: 'words' } : { asked: false, by: 'no_request' };
}
