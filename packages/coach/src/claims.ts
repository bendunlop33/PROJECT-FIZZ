import { formatNumber, setNumbersText } from '@fizz/domain';
import type { ActionKind, ActionRecord, CoachTarget, Load } from '@fizz/schemas';
import { normaliseForClaims } from './text';

/**
 * `checkReplyClaims` (coach-contract CC3–CC5, §6): the backstop that stops
 * the coach saying something changed when the app didn't save it. Pure.
 *
 * A finished sentence of model text is split into clauses. A clause that
 * states a change in the coach's voice (past or perfect tense, passive,
 * "done"/"all set", "is now …", "will be …" with a value, "I'll …"
 * promising a change, or a present-tense statement of a target's state such
 * as "Bench is down to 95" or "Pec deck replaces cable fly") is a claim. A claim is kept only if this turn's ledger
 * holds a committed, not-undone action of the same kind on the same sets or
 * exercises; if its numbers differ from the saved ones, the sentence is
 * replaced by the rendered line (CC4). When unsure, it hides: a hidden
 * suggestion costs little, a false "done" costs trust.
 *
 * Review r2 B1: negation only counts in the words before a trigger ("sets 3
 * and 4 are now 95 kg, not 100" is a claim); "should/will now show" states a
 * result; verbless plan lines ("Bench: 95 kg for sets 3 and 4", "pec deck in,
 * cable fly out", "no more cable fly") are claims; and, as a backstop, any
 * plain statement of a target value (a load with its unit, or a number with a
 * set, "the rest" or "next time" scope) is a claim unless it is a question,
 * suggestion, offer, history, a general fact or imperative advice. Free text
 * can lean on an `earlier` ledger entry only when the sentence cites its
 * token (CC5, review r2 S2).
 */

export interface LedgerEntry {
  /** The ref the tool returned (`a1`), usable as `[[a1]]`. */
  ref: string;
  record: ActionRecord;
  /** `earlier`: read through `get_recent_actions` in this turn (CC5). */
  origin: 'this_turn' | 'earlier';
}

export interface TurnLedger {
  turnId: string;
  entries: readonly LedgerEntry[];
  /** Exercise names in context (today's workout, the summary), so a claim about another exercise is caught. */
  knownExerciseNames: readonly string[];
}

export type ClaimReason = 'no_action' | 'not_committed' | 'mismatch' | 'numbers_differ';

export type ClaimCheck =
  | { keep: true; claim: boolean; matchedActionIds: string[] }
  | { keep: false; reason: ClaimReason; detail: string; replaceWith: string | null };

// ---------------------------------------------------------------------------
// Word lists

/** Past tense / participles of change verbs. */
const PAST = new Set([
  'changed', 'lowered', 'dropped', 'raised', 'increased', 'decreased', 'reduced', 'bumped', 'upped', 'updated', 'adjusted',
  'logged', 'saved', 'applied', 'removed', 'added', 'swapped', 'switched', 'replaced', 'moved', 'deleted', 'scaled', 'tweaked',
  'edited', 'corrected', 'undid', 'undone', 'reverted', 'restored', 'flagged', 'noted', 'recorded', 'marked', 'forgot',
  'forgotten', 'cleared', 'rescheduled', 'scheduled', 'taken', 'took', 'knocked', 'trimmed', 'shaved', 'pushed', 'made',
  'lightened', 'eased', 'dialled', 'dialed', 'modified', 'amended', 'locked', 'stored', 'remembered', 'written', 'wrote',
  'rewritten', 'reordered', 'rearranged', 'shifted', 'programmed', 'planned', 'queued', 'entered', 'capped', 'rounded',
  'halved', 'doubled', 'subbed', 'substituted', 'tracked', 'pencilled', 'penciled', 'booked', 'built', 'created', 'synced',
  'scrapped', 'ditched', 'deloaded', 'progressed', 'tweaked', 'fixed', 'sorted', 'reset', 'cut', 'put', 'set', 'upped', 'slotted',
  'memorised', 'memorized', 'jotted', 'filed',
]);
/** Same form as the base verb: only a claim after a subject or auxiliary, never sentence-initial (imperatives). */
const AMBIGUOUS_PAST = new Set(['cut', 'put', 'set', 'reset', 'sorted', 'fixed', 'made', 'planned', 'built', 'marked', 'locked']);

const BASE = new Set([
  'change', 'lower', 'drop', 'raise', 'increase', 'decrease', 'reduce', 'cut', 'bump', 'up', 'update', 'adjust', 'log', 'save',
  'apply', 'remove', 'add', 'swap', 'switch', 'replace', 'move', 'delete', 'scale', 'tweak', 'edit', 'correct', 'undo', 'revert',
  'restore', 'flag', 'note', 'record', 'mark', 'forget', 'clear', 'reset', 'reschedule', 'schedule', 'take', 'knock', 'trim',
  'shave', 'push', 'put', 'make', 'lighten', 'ease', 'dial', 'modify', 'amend', 'lock', 'store', 'remember', 'write', 'rewrite',
  'reorder', 'rearrange', 'shift', 'program', 'programme', 'plan', 'queue', 'enter', 'cap', 'round', 'halve', 'double', 'sub',
  'substitute', 'track', 'pencil', 'book', 'build', 'create', 'set', 'scrap', 'ditch', 'deload', 'progress', 'fix', 'sort', 'slot', 'go',
]);
const DOUBLING = new Set(['drop', 'cut', 'swap', 'up', 'log', 'flag', 'trim', 'sub', 'set', 'put', 'plan', 'cap', 'scrap', 'slot', 'program', 'reset', 'pencil', 'dial']);
function ing(v: string): string {
  if (DOUBLING.has(v)) return `${v}${v.charAt(v.length - 1)}ing`;
  if (v.endsWith('e') && !v.endsWith('ee')) return `${v.slice(0, -1)}ing`;
  return `${v}ing`;
}
const ING = new Set([...BASE].map(ing));

const NEGATORS = new Set(['not', 'never', 'no', 'nothing', 'none', 'neither', 'nor', 'without', 'cannot']);
const BARE_NEGATIONS = new Set(['didnt', 'havent', 'hasnt', 'wont', 'cant', 'couldnt', 'wasnt', 'werent', 'dont', 'doesnt', 'isnt', 'arent']);
const SUGGESTIVE = new Set([
  'would', 'could', 'should', 'might', 'may', 'can', 'if', 'try', 'trying', 'suggest', 'suggests', 'suggesting', 'recommend',
  'recommends', 'consider', 'maybe', 'perhaps', 'want', 'wants', 'worth', 'prefer', 'rather', 'option', 'unless', 'whether', 'ideally',
]);
const NOT_THE_COACH = new Set(['you', 'he', 'she', 'they', 'ben', 'u']);
const SUBJECT_OR_AUX = new Set(['i', 'we', 'have', 'has', 'had', 'is', 'are', 'was', 'were', 'been', 'be', 'being', 'get', 'got', 'gets']);
const SKIPPABLE = new Set(['just', 'already', 'also', 'now', 'all', 'both', 'quickly', 'gone', 'ahead', 'and', 'went', 'actually', 'simply', 'officially']);
const INTERJECTIONS = new Set(['ok', 'okay', 'right', 'great', 'sure', 'alright', 'cool', 'perfect', 'yes', 'yep', 'yeah', 'so', 'and', 'nice', 'good', 'got', 'it', 'no', 'problem', 'done']);
const FUTURE_MARKERS: readonly (readonly string[])[] = [
  ['i', 'will'], ['we', 'will'], ['i', 'am', 'going', 'to'], ['we', 'are', 'going', 'to'], ['i', 'am', 'gonna'], ['let', 'me'], ['let', 'us'],
  ['i', 'shall'], ['i', 'will', 'go', 'ahead', 'and'], ['i', 'am', 'about', 'to'],
];
const OFFER_TAIL = /\b(if you (want|like|would like|prefer|are happy|agree|say so)|want me to|should i|shall i|ok with you|your call|up to you)\b/;

/**
 * Generic name words that still say which exercise is meant when nothing more
 * specific is named: "Incline is 95 for the rest" names `Incline DB press`
 * (review r2 B1). Function words and "back"/"front" aren't here: "back to 95"
 * names nothing.
 */
const MENTION_WORDS = new Set(['incline', 'decline', 'seated', 'standing', 'smith', 'assisted', 'weighted', 'machine', 'cable', 'dumbbell', 'dumbbells', 'barbell', 'press']);

const GENERIC_NAME_WORDS = new Set([
  'press', 'machine', 'cable', 'dumbbell', 'dumbbells', 'barbell', 'back', 'front', 'the', 'and', 'with', 'seated', 'standing',
  'single', 'arm', 'one', 'grip', 'close', 'wide', 'smith', 'assisted', 'weighted', 'incline', 'decline', 'flat',
]);

// ---------------------------------------------------------------------------

type ClaimKind = ActionKind | 'log_set' | 'any';
type SetOp = 'change' | 'remove_set' | 'add_set';

interface Claim {
  kinds: Set<ClaimKind>;
  op: SetOp;
  setNumbers: number[];
  /** Alias words found, each mapped to the names it could mean. */
  exerciseMentions: string[][];
  loads: { value: number; unit: 'kg' | 'lb' }[];
  bareNumbers: number[];
  unverifiable: boolean;
}

function negatedAt(words: readonly string[], i: number, window = 4): boolean {
  for (let j = Math.max(0, i - window); j < i; j += 1) {
    const w = words[j] ?? '';
    if (NEGATORS.has(w) || w.endsWith("n't") || BARE_NEGATIONS.has(w)) return true;
  }
  return false;
}

function suggestiveAt(words: readonly string[], i: number, window = 5): boolean {
  for (let j = Math.max(0, i - window); j < i; j += 1) {
    const w = words[j] ?? '';
    if (SUGGESTIVE.has(w)) {
      // "I shall" is future, "shall I" is a question; both hide (see FUTURE_MARKERS), so only real modals count here.
      return true;
    }
    if ((w === 'how' || w === 'what') && words[j + 1] === 'about') return true;
    if (w === 'happy' && words[j + 1] === 'to') return true;
    if (w === 'able' && words[j + 1] === 'to') return true;
  }
  return false;
}

/** Index of the previous meaningful word, skipping adverbs like "just" and "already". */
function prevMeaningful(words: readonly string[], i: number): number {
  let j = i - 1;
  while (j >= 0 && SKIPPABLE.has(words[j] ?? '')) j -= 1;
  return j;
}

function isInitial(words: readonly string[], i: number): boolean {
  for (let j = 0; j < i; j += 1) if (!INTERJECTIONS.has(words[j] ?? '')) return false;
  return true;
}

function futureBefore(words: readonly string[], i: number): boolean {
  for (const marker of FUTURE_MARKERS) {
    for (let gap = 0; gap <= 2; gap += 1) {
      const start = i - marker.length - gap;
      if (start < 0) continue;
      if (marker.every((m, k) => words[start + k] === m)) {
        const between = words.slice(start + marker.length, i);
        if (between.every((w) => SKIPPABLE.has(w) || w === 'go' || w === 'also')) return true;
      }
    }
  }
  return false;
}

const PHRASES: readonly RegExp[] = [
  /^(?:(?:ok|okay|right|great|sure|alright|cool|perfect|yes|yep|yeah|got it|no problem|and)\s*)*(?:done|all done|all set|sorted|consider it done)\b/,
  /\b(?:that|it|this|everything|all) (?:is|has been) (?:now )?(?:done|sorted|in|all set|taken care of|locked in|live|in place)\b/,
  /\btaken care of\b/,
  /\byou are (?:now |all )?set\b/,
  /\b(?:is|are) now\b/,
  /\bnow (?:at|reads|shows|set|down|up|on|showing|reading)\b/,
  /\b(?:you are|it is|that is|they are|sets? [\d_]+ (?:is|are)) (?:now )?(?:down|up) to\b/,
  /\bfrom now on\b/,
  /\bgoing forward\b/,
  /\bi have (?:got|put) you (?:down )?(?:for|at|on)\b/,
  /\bhere is your (?:new|updated|adjusted|revised)\b/,
  /\b(?:your|the) (?:new|updated|revised|adjusted|lowered|raised) (?:target|targets|plan|weight|weights|load|loads|sets?|session|workout)\b/,
  /\bkeep (?:that|this|it) in mind\b/,
  /\bmade a note\b/,
  /\bin (?:your |the |my )?(?:memory|memories|playbook)\b/,
  /\b(?:will not|won't|wont|shall not|never|not going to|not gonna) forget\b/,
  /\b(?:should|will) now (?:show|see|read|display|say|list|be)\b/,
  /\b(?:should|will) (?:show|read|display|list) .*\d/,
  /\b(?:i|we) have got (?:that|it|this) (?:down|noted|saved|stored|logged)\b|^got (?:that|it|this) (?:down|noted|saved|stored|logged)\b/,
  /^(?!.*\b(?:what|how|whatever|who|why|where)\b)[a-z0-9 .]{1,40} it is$/,
  /\b(?:pain )?flags? (?:is |are )?(?:now )?(?:on|active|set)\b/,
  /\bnow (?:has|have|includes?|uses?|contains?|starts?)\b/,
  /\b(?:is|are)\b.*\d.*\bnow\b/,
  /\bnow \d/,
  /\b(?:there|here) you go\b/,
  /\b(?:has|have) (?:come|gone) (?:down|up) to \d/,
  /\bmade (?:the|that|those|these|a|an|some|your) (?:change|changes|adjustment|adjustments|tweak|tweaks|update|updates|edit|edits)\b/,
  /\bmade (?:it|them|that|those|sets?|the rest|everything)\b.*\b(?:lighter|heavier|easier|harder)\b/,
  /\b(?:change|changes|adjustment|adjustments|update|updates|edit|edits) (?:made|done|applied|saved|in|complete|completed)\b/,
  /\b(?:is|are) (?:now )?(?:lighter|lower|heavier|higher|reduced)\b/,
  /(?:^|\b(?!you\b)[a-z]+ )did (?:that|it|so)\b/,
  /\b(?:gone|went) with\b/,
  /\bnext (?:session|time|workout|push|pull)\b.*\b(?:has|is|gets|are|will have)\b.*\d/,
  /\b(?:is|are|has|gets) (?:at )?\d.*\bnext (?:session|time|workout)\b/,
];

/** Past-tense progress talk ("your squat has increased since August") is history, not a change made now. */
const SET_VALUE_LINE = /\bsets? [\d_]+\s*:\s*\d/;
const HISTORICAL = /\b(?:since (?:january|february|march|april|may|june|july|august|september|october|november|december|last|the start|you started)|last (?:week|month|year|block|time|session)|this (?:month|year|block)|ago|over the (?:last|past)|in the last)\b/;
/** "… will be 95 kg", "you'll do 95 for the last two": a stated value in the future is a claim. */
const WILL_VALUE = /\b(?:will (?:now )?be|you will (?:now )?(?:be (?:doing|lifting|on|using|at)|do|lift|use|go|hit|start|have|see|get|find))\b.*\d/;

/**
 * Present-tense statements of a target's state ("Bench is down to 95",
 * "Sets 3 and 4 are 95 kg", "Squat goes to 120 next time", "Pec deck
 * replaces cable fly", "Cable fly is out"). Said by the coach, they read as a
 * change already made, so they are claims (review B1, coach-contract CC3).
 */
const PRESENT_STATE: readonly RegExp[] = [
  /\b(?:is|are|goes|go|comes|come|drops|moves|jumps) (?:now )?(?:down |up )?to \d/,
  /\b(?:is|are) (?:now )?(?:down|up) to\b/,
  /\b(?:is|are) (?:now )?(?:at |on )?\d/,
  /\b(?:you|we) are (?:now )?(?:at|on) \d/,
  /\b(?:is|are) (?:now )?(?:out|in|gone|off)(?: (?:for|of|instead|next|from|today|now)\b|$)/,
  /\b(?:replaces|swaps in for|takes over from|comes in for|stands in for|subs in for)\b/,
  /\b(?:you|we) are (?:now )?(?:doing|lifting|using|going|hitting|pressing|squatting|pulling|working with|working at|sitting at) \d/,
  /\b(?:is|are) (?:now )?(?:sitting|staying|sat) (?:at )?\d/,
];
/** "Bench now sits at 95", "your sets read 95 kg", "the app shows 95": a state read off the screen. History ("your log shows 100 last week") isn't. */
const SHOWN_STATE = /\b(?:sits?|sitting|reads?|reading|shows?|showing|says|displays?|displaying) (?:now )?(?:at |as )?\d/;
/** "95 kg for sets 3 and 4", "95 for the rest", "95 from here": a value stated as the plan, with no verb. */
const VALUE_FIRST = /^\d+(?:\.\d+)?(?: (?:kgs?|lbs?|kilos?|kilograms?|pounds?))?(?: x \d+)? (?:for (?:sets? |the |your |both|all|each|every)|from (?:here|now|next|today)|next (?:time|session|week)|it is\b|on (?:sets? |the |your |both|all))/;
/** "Pec deck in", "cable fly out": an exercise entering or leaving the plan with no verb (CC10). */
const BARE_IN_OUT = /^(?!(?:i|we|you|me|it|that|this|all|count|sets?|breathe|brace|knees|elbows|chest|chin|toes|hips|tuck|lock|squeeze|push|pull|log|sign|check|tap|zoom|work|time)\b)[a-z][a-z ]{1,40}? (?:in|out)$/;
/** "No more cable fly": an exercise dropped (CC10). "No more than 3 sets" is advice. */
const NO_MORE = /(?:^|, )no (?:more|longer)\b(?! than\b)/;
/** "Pec deck from next time": an exercise scheduled with no verb. */
/** "Pec deck instead of cable fly from next time": a swap with no verb (CC10). */
const BARE_INSTEAD = /^(?!(?:i|we|you|use|try|do|go|maybe|how|what|why|or|rather|perhaps)\b)[a-z][a-z ]{1,40}? instead of [a-z]/;
const BARE_FROM_NEXT = /^[a-z][a-z ]{1,40}? (?:from|starting) (?:next|now|today|tomorrow)\b/;
/** Left of a colon that is a fact label, not an exercise: "Rest: 3 min", "Tip: 3 sets is plenty". */
const LINE_LABELS = /^(?:rest|tempo|rpe|rir|time|best|pr|pb|e1rm|estimate|estimated 1rm|bar|note|tip|reminder|warm ?-?up|warmup|cue|form|why|reason|goal|today|yesterday|last (?:week|time|session)|history|total|volume)$/;
/** "Bench: 95 kg for sets 3 and 4", "Squat: 120 kg next time": a target line in the app's own format. */
const EXERCISE_VALUE_LINE = /^([a-z][a-z ]{1,40}?) ?: ?(\d+(?:\.\d+)?)(?: (?:kgs?|lbs?|kilos?|kilograms?|pounds?)|(?: x \d+)| for | next | from )/;
/** Subjects whose present-tense numbers are facts, not targets ("the bar is 20 kg", "your best set is 100 kg"). */
const STATE_FACT_SUBJECT = /\b(?:bar|barbell|plates?|e1rm|1rm|estimate|estimated|best|pr|pb|record|average|total|volume|bodyweight|rpe|rir)\b/;

function negatedBeforeIndex(clause: string, index: number, window = 4): boolean {
  const words = clause.slice(0, index).trim().split(' ').filter((w) => w.length > 0);
  return words.slice(-window).some((w) => NEGATORS.has(w) || w.endsWith("n't") || BARE_NEGATIONS.has(w));
}

/**
 * Does `re` match with no negator in the few words before the match? Only the
 * words before the trigger count: "nothing is now different" isn't a claim,
 * but "sets 3 and 4 are now 95 kg, not 100" is (review r2 B1).
 */
function matchesUnnegated(re: RegExp, clause: string): boolean {
  const m = re.exec(clause);
  return m !== null && !negatedBeforeIndex(clause, m.index);
}

function isQuestion(sentence: string): boolean {
  return /\?\s*$/.test(sentence);
}

function presentStateClaim(clause: string, sentence: string): boolean {
  const shown = matchesUnnegated(SHOWN_STATE, clause) && !HISTORICAL.test(sentence);
  if (!shown && !PRESENT_STATE.some((re) => matchesUnnegated(re, clause))) return false;
  if (STATE_FACT_SUBJECT.test(clause)) return false;
  if (OFFER_TAIL.test(sentence)) return false;
  const words = clause.split(' ');
  if (words.some((w) => SUGGESTIVE.has(w))) return false;
  return !/\b(?:when|once|after|until)\b/.test(clause);
}

function hasClaimTrigger(words: readonly string[], clause: string, sentence: string): boolean {
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i] ?? '';
    if (PAST.has(w)) {
      if (negatedAt(words, i) || suggestiveAt(words, i)) continue;
      const p = prevMeaningful(words, i);
      const prev = p >= 0 ? (words[p] ?? '') : '';
      const prevPrev = p >= 1 ? (words[p - 1] ?? '') : '';
      if (NOT_THE_COACH.has(prev) || (['have', 'had', 'has'].includes(prev) && NOT_THE_COACH.has(prevPrev))) continue;
      const coachSubject = prev === 'i' || prev === 'we' || ((prev === 'have' || prev === 'had') && (prevPrev === 'i' || prevPrev === 'we'));
      if (!coachSubject && HISTORICAL.test(sentence)) continue;
      if (AMBIGUOUS_PAST.has(w)) {
        if (SUBJECT_OR_AUX.has(prev)) return true;
        continue;
      }
      if (isInitial(words, i)) return true;
      // Any other subject or auxiliary before a change verb: a claim ("I've lowered", "sets 3–4 were lowered", "the app updated").
      if (p >= 0) return true;
    }
    if ((BASE.has(w) || ING.has(w)) && futureBefore(words, i) && !negatedAt(words, i)) {
      if (OFFER_TAIL.test(sentence)) continue;
      if (w === 'go' && !/\d/.test(clause)) continue;
      return true;
    }
    if (ING.has(w)) {
      // "Dropping you to 95 for the rest."
      if (isInitial(words, i) && !negatedAt(words, i)) return true;
      const p = prevMeaningful(words, i);
      if (p >= 1 && (words[p] === 'am' || words[p] === 'are') && (words[p - 1] === 'i' || words[p - 1] === 'we') && !negatedAt(words, i)) return true;
    }
  }
  // Negation only counts in the words before the trigger (review r2 B1): a
  // trailing "not 100" doesn't undo "sets 3 and 4 are now 95 kg".
  if (GENERIC_ONLY.test(clause)) return true;
  if (presentStateClaim(clause, sentence)) return true;
  if (PHRASES.some((re) => matchesUnnegated(re, clause))) {
    if (/\b(?:try|consider|maybe|suggest|recommend|would|could|should|might)\b/.test(clause) && /\bfrom now on|going forward\b/.test(clause)) return false;
    if (/\b(?:should|will) (?:now )?(?:show|see|read|display|say|list|be)\b/.test(clause) && (/\b(?:if|when|once|unless)\b/.test(clause) || OFFER_TAIL.test(sentence) || isQuestion(sentence))) return false;
    return true;
  }
  if (verblessClaim(clause, sentence)) return true;
  if (matchesUnnegated(WILL_VALUE, clause) && !/\b(?:would|could|should|might|may|if)\b/.test(clause)) return true;
  return valueStatement(words, clause, sentence);
}

const LOAD_VALUE = /\b\d+(?:\.\d+)? (?:kgs?|lbs?|kilos?|kilograms?|pounds?)\b/;
const TARGET_SCOPE =
  /\b(?:sets? [\d_]+|the rest|your rest|rest of|remaining|(?:the |your )?last (?:two|three|four|\d+|one|set|sets)|final (?:set|two|\d+)|next (?:time|session|week|workout|one|set)|from (?:here|now)|for (?:the |your )?(?:last|remaining|next))\b/;
/** Advice in the imperative ("Aim for 95 kg on the last two") tells Ben what to do; it doesn't claim the app changed. */
const IMPERATIVE_START = new Set([
  'aim', 'try', 'rest', 'keep', 'go', 'take', 'use', 'drop', 'lower', 'start', 'stick', 'hold', 'stay', 'add', 'do', 'hit', 'get',
  'push', 'work', 'focus', 'pick', 'grab', 'load', 'warm', 'finish', 'leave', 'think', 'let', 'plan', 'expect', 'remember', 'see',
]);
/** "Still 100 kg", "stays at 100": unchanged, so not a claim of change. "Was/were" is a past fact ("set 2 was 100 kg"). */
const UNCHANGED_OR_PAST = /\b(?:still|stays?|staying|unchanged|as planned|as before|was|were|did|hit|lifted|managed|got through)\b|(?<!\bnow )\b(?:planned|programmed|scheduled|written)\b/;
/** General equipment and training facts ("plates go up in 1.25 kg steps", "most people use 2.5 kg jumps"). */
const GENERAL_FACT = /\b(?:people|usually|typically|generally|normally|often|steps?|jumps?|increments?|maxes|max|maximum|minimum|plates?|rack|stack|pin)\b/;

/**
 * The backstop (review r2 B1, structural rule): a plain statement of a target
 * value (a load with its unit, or a number with a set or "rest of"/"next time"
 * scope) is treated as a claim, so it must be backed by a saved change. This
 * catches phrasings no verb list names ("you've got 95 for the last two",
 * "last two sets at 95 kg"). Questions, suggestions, offers, history, facts
 * about the bar or a best, unchanged values and imperative advice stay.
 */
function valueStatement(words: readonly string[], clause: string, sentence: string): boolean {
  const scrubbed = clause.replace(/\b(?:rpe|rir|@) ?\d+(?:\.\d+)?\b/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  const values = scrubbed.replace(/\bsets? [\d_]+\b/g, ' ').replace(/\b(?:last|final|first|next|remaining|other|those|these|both|the|all) \d+\b/g, ' ');
  if (!/\d/.test(values)) return false;
  if (!LOAD_VALUE.test(scrubbed) && !TARGET_SCOPE.test(scrubbed)) return false;
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence) || HISTORICAL.test(sentence)) return false;
  if (words.some((w) => SUGGESTIVE.has(w)) || STATE_FACT_SUBJECT.test(clause) || UNCHANGED_OR_PAST.test(clause) || GENERAL_FACT.test(clause)) return false;
  if (/\b(?:if|when|once|until|unless|before|after)\b/.test(clause) || /^(?:if|when|once|unless)\b/.test(sentence)) return false;
  const first = words.find((w) => !INTERJECTIONS.has(w)) ?? '';
  if (IMPERATIVE_START.has(first)) return false;
  // Ben's own past ("you logged 100 kg × 8") is history, not a change.
  if (/\byou (?:\w+ed|did|hit|lifted|got|went|had|made|ran)\b|\byou have (?:\w+ed|done|hit|lifted|gone|had|made|run)\b/.test(clause)) return false;
  return true;
}

/** Verbless plan lines (review r2 B1): "95 for the rest", "pec deck in, cable fly out", "no more cable fly". */
function verblessClaim(clause: string, sentence: string): boolean {
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence) || /\b(?:if|when|once|unless)\b/.test(sentence)) return false;
  if (clause.split(' ').some((w) => SUGGESTIVE.has(w))) return false;
  if (VALUE_FIRST.test(clause)) return true;
  if (BARE_IN_OUT.test(clause)) return true;
  if (BARE_INSTEAD.test(clause) && !/\b(?:is|are|was|were|has|have|had|does|do|did|feels?|looks?|works?)\b/.test(clause)) return true;
  if (NO_MORE.test(clause) && clause.split(' ').length <= 6) return true;
  return BARE_FROM_NEXT.test(clause) && NO_MORE.test(sentence);
}

/** Split into clauses so a fact ("set 2 was RPE 10") isn't read as part of a claim. */
function clausesOf(normalised: string): string[] {
  const verbs = [...PAST, ...BASE].filter((v) => !AMBIGUOUS_PAST.has(v)).join('|');
  const andVerb = new RegExp(`\\s+(?:and|then|plus)\\s+(?=(?:i|we|also|then|${verbs})\\b)`, 'g');
  return normalised
    .split(/\s*(?:[;:,!]|\s-\s|\.\.\.)\s*|\s+(?:but|so|because|while|whereas|since)\s+/)
    .flatMap((c) => c.split(andVerb))
    .map((c) => c.trim().replace(/[.?!]+$/, ''))
    .filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// What a claim is about

const NEXT_WORDS = /\b(?:next (?:time|session|workout|week|push|pull|legs|day)|for next|from now on|going forward|in future|future sessions?|next \w+ day)\b/;
const TODAY_WORDS = /\b(?:today|this session|this workout|remaining|rest of|last two|last 2|sets? \d)/;
const MEMORY_WORDS = /\b(?:remember(?:ed)?|memory|memories|noted|note|keep (?:that|this|it) in mind|stored|memori[sz]ed|jotted|got (?:that|it|this) down)\b/;
const FORGET_WORDS = /\b(?:forgot|forgotten|forget|forgetting)\b/;
/** "I won't forget that" is a promise to remember, not a forget. */
const NOT_FORGET = /\b(?:will not|won't|wont|shall not|never|not going to|not gonna) forget\b/;
const PAIN_WORDS = /\b(?:flag(?:ged)?|pain flag|flagging)\b/;
const PLAYBOOK_WORDS = /\bplaybook\b|\brule\b/;
const UNDO_WORDS = /\b(?:undid|undone|undo|undoing|revert(?:ed|ing)?|restor(?:ed|e|ing)|put (?:it |them |that )?back|back to)\b/;
const STRUCT_VERBS = /\b(?:swap(?:ped|ping|s)?|switch(?:ed|ing|es)?|replac(?:ed|es?|ing)|substitut(?:ed|es?|ing)|sub(?:bed|bing|s)?|reorder(?:ed|ing|s)?|rearrang(?:ed|es?|ing)|slot(?:ted|s)?|takes over from|comes in for|stands in for)\b/;
/** "Cable fly is out", "pec deck is in for cable fly": an exercise entering or leaving the plan (CC10). */
const IN_OUT = /\b(?:is|are) (?:now )?(?:out|in)(?: (?:for|of|instead|next|from|today|now)\b|$)/;
const ADD_REMOVE = /\b(?:add(?:ed|ing)?|remov(?:ed|e|ing)|dropp(?:ed|ing)|drop|delet(?:ed|e|ing)|cut|scrap(?:ped)?|ditch(?:ed)?|took out|taken out|knocked off)\b/;
const LOG_WORDS = /\b(?:logged|log|logging|recorded|entered|tracked)\b/;
const GENERIC_ONLY = /^(?:(?:ok|okay|right|great|sure|alright|cool|perfect|yes|yep|yeah|got it|no problem|and)\s*)*(?:done|all done|all set|sorted|consider it done|(?:all |both |everything is |everything has been |it is |that is |they are )?(?:saved|applied|updated|changed|adjusted|sorted|done)|that is done|it is done|everything is (?:done|updated|set)|taken care of)$/;

function aliasesOf(name: string): string[] {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
  const full = name.toLowerCase();
  return [full, ...words, ...words.map((w) => `${w}s`)];
}

function exerciseMentions(clause: string, names: readonly string[]): string[][] {
  const byAlias = new Map<string, Set<string>>();
  for (const n of names) {
    for (const a of aliasesOf(n)) {
      const set = byAlias.get(a) ?? new Set<string>();
      set.add(n.toLowerCase());
      byAlias.set(a, set);
    }
  }
  const found: string[][] = [];
  const sortedAliases = [...byAlias.keys()].sort((a, b) => b.length - a.length);
  let rest = ` ${clause} `;
  for (const a of sortedAliases) {
    const re = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(rest)) {
      found.push([...(byAlias.get(a) ?? [])]);
      rest = rest.replace(re, ' ');
    }
  }
  if (found.length > 0) return found;
  // Nothing specific named: a generic word from a known name still names it (review r2 B1).
  for (const w of rest.split(/[^a-z0-9]+/)) {
    if (!MENTION_WORDS.has(w)) continue;
    const singular = w.endsWith('s') && w !== 'press' ? w.slice(0, -1) : w;
    const matches = names.filter((n) => n.toLowerCase().split(/[^a-z0-9]+/).some((x) => x === w || x === singular)).map((n) => n.toLowerCase());
    if (matches.length > 0) found.push(matches);
  }
  return found;
}

function setNumbersIn(clause: string): number[] {
  const out: number[] = [];
  for (const m of clause.matchAll(/\bsets? ([\d_]+)\b/g)) {
    for (const n of (m[1] ?? '').split('_')) if (n !== '') out.push(Number(n));
  }
  return out;
}

function numbersIn(clause: string): { loads: Claim['loads']; bare: number[]; unverifiable: boolean } {
  let rest = clause;
  const loads: Claim['loads'] = [];
  rest = rest.replace(/\b(\d+(?:\.\d+)?) (kgs?|kilos?|kilograms?|lbs?|pounds?)\b/g, (_m, n: string, u: string) => {
    loads.push({ value: Number(n), unit: u.startsWith('k') ? 'kg' : 'lb' });
    return ' ';
  });
  let unverifiable = false;
  rest = rest.replace(/\b(\d+(?:\.\d+)?) ?(?:%|percent|per cent)/g, () => {
    unverifiable = true;
    return ' ';
  });
  rest = rest
    .replace(/\bsets? [\d_]+\b/g, ' ')
    .replace(/\b(?:last|final|first|next|remaining|other|those|these|both|the) \d+\b/g, ' ')
    .replace(/\b(?:rpe|rir|@) ?\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b(?:set|rep|round) (?:\d+) of (?:\d+)\b/g, ' ');
  const bare = [...rest.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => Number(m[0]));
  return { loads, bare, unverifiable };
}

function kindsOf(clause: string, sentence: string): { kinds: Set<ClaimKind>; op: SetOp } {
  const kinds = new Set<ClaimKind>();
  const hasSetWord = /\b(?:sets?|a set|another set|one more set|extra set)\b/.test(clause);
  let op: SetOp = 'change';
  if (GENERIC_ONLY.test(clause)) return { kinds: new Set<ClaimKind>(['any']), op };
  if (PAIN_WORDS.test(clause)) kinds.add('set_pain_flag');
  if (NOT_FORGET.test(clause)) kinds.add('save_memory');
  else if (FORGET_WORDS.test(clause)) kinds.add('forget_memory');
  else if (MEMORY_WORDS.test(clause)) kinds.add('save_memory');
  if (PLAYBOOK_WORDS.test(clause)) kinds.add('add_playbook_candidate');
  if (UNDO_WORDS.test(clause)) kinds.add('undo');
  // "Next session, bench will be 97.5": the scope may sit in another clause of the sentence.
  const next = NEXT_WORDS.test(clause) || (NEXT_WORDS.test(sentence) && !TODAY_WORDS.test(clause));
  const aboutValues = /\b(?:weight|load|kg|lb|kilos|pounds|reps?|to \d)\b/.test(clause);
  // Adding or removing something that isn't a set is an exercise change: structural, never a set target (CC10).
  const structural =
    STRUCT_VERBS.test(clause) ||
    (IN_OUT.test(clause) && !hasSetWord) ||
    (ADD_REMOVE.test(clause) && !hasSetWord && !aboutValues) ||
    (BARE_IN_OUT.test(clause) && !hasSetWord) ||
    (BARE_INSTEAD.test(clause) && !hasSetWord && !aboutValues) ||
    (NO_MORE.test(clause) && !hasSetWord && !aboutValues) ||
    (BARE_FROM_NEXT.test(clause) && NO_MORE.test(sentence));
  if (structural) kinds.add('propose_next_workout_change');
  if (ADD_REMOVE.test(clause) && hasSetWord && !aboutValues) {
    op = /\badd(?:ed|ing)?\b/.test(clause) ? 'add_set' : 'remove_set';
  }
  if (/\bpain\b/.test(clause) && (MEMORY_WORDS.test(clause) || PAIN_WORDS.test(clause))) kinds.add('set_pain_flag');
  if (LOG_WORDS.test(clause) && !MEMORY_WORDS.test(clause)) kinds.add('log_set');
  const meta: readonly ClaimKind[] = ['set_pain_flag', 'save_memory', 'forget_memory', 'add_playbook_candidate', 'log_set'];
  const onlyMeta = kinds.size > 0 && [...kinds].every((k) => meta.includes(k));
  if (!onlyMeta && !structural) kinds.add(next ? 'set_next_session_targets' : 'adjust_pending_sets');
  if (kinds.has('undo')) kinds.add('adjust_pending_sets');
  return { kinds, op };
}

function parseClaim(clause: string, sentence: string, names: readonly string[]): Claim {
  const { kinds, op } = kindsOf(clause, sentence);
  const { loads, bare, unverifiable } = numbersIn(clause);
  return { kinds, op, setNumbers: setNumbersIn(clause), exerciseMentions: exerciseMentions(clause, names), loads, bareNumbers: bare, unverifiable };
}

// ---------------------------------------------------------------------------
// Matching a claim to the ledger

interface RecordFacts {
  names: Set<string>;
  changedSets: Set<number>;
  removedSets: Set<number>;
  addedSets: Set<number>;
  loads: Load[];
  numbers: Set<string>;
  primaryLoad: Load | null;
}

function addTarget(f: RecordFacts, t: CoachTarget | null): void {
  if (t === null) return;
  if (t.load !== null) {
    f.loads.push(t.load);
    f.numbers.add(formatNumber(t.load.value));
  }
  if (t.reps !== null) {
    f.numbers.add(String(t.reps.min));
    f.numbers.add(String(t.reps.max));
  }
}

function factsOf(record: ActionRecord): RecordFacts {
  const f: RecordFacts = { names: new Set(), changedSets: new Set(), removedSets: new Set(), addedSets: new Set(), loads: [], numbers: new Set(), primaryLoad: null };
  const d = record.detail;
  switch (d.kind) {
    case 'adjust_pending_sets':
      for (const ex of d.exercises) {
        f.names.add(ex.exerciseName.toLowerCase());
        for (const c of ex.changes) {
          f.numbers.add(String(c.setNumber));
          if (c.after === null) f.removedSets.add(c.setNumber);
          else if (c.before === null) f.addedSets.add(c.setNumber);
          else f.changedSets.add(c.setNumber);
          addTarget(f, c.before);
          addTarget(f, c.after);
          if (f.primaryLoad === null && c.after?.load) f.primaryLoad = c.after.load;
        }
      }
      break;
    case 'undo':
      for (const ex of d.restored) {
        f.names.add(ex.exerciseName.toLowerCase());
        for (const c of ex.changes) {
          f.changedSets.add(c.setNumber);
          f.numbers.add(String(c.setNumber));
          addTarget(f, c.before);
          addTarget(f, c.after);
          if (f.primaryLoad === null && c.after?.load) f.primaryLoad = c.after.load;
        }
      }
      break;
    case 'set_next_session_targets':
      for (const r of d.rows) {
        if (record.status === 'committed' && r.size !== 'small') continue;
        f.names.add(r.exerciseName.toLowerCase());
        addTarget(f, r.before);
        addTarget(f, r.after);
        if (r.setsAfter !== null) f.numbers.add(String(r.setsAfter));
        if (r.setsBefore !== null) f.numbers.add(String(r.setsBefore));
        if (f.primaryLoad === null && r.after.load) f.primaryLoad = r.after.load;
      }
      break;
    case 'set_pain_flag':
      for (const n of d.exerciseNames) f.names.add(n.toLowerCase());
      break;
    case 'propose_next_workout_change':
    case 'save_memory':
    case 'forget_memory':
    case 'add_playbook_candidate':
      break;
  }
  return f;
}

function liveCommitted(e: LedgerEntry): boolean {
  return e.record.status === 'committed' && e.record.undoneBy === null;
}

function kindMatches(claim: Claim, record: ActionRecord): boolean {
  return claim.kinds.has('any') || claim.kinds.has(record.detail.kind);
}

type EntityResult = { ok: true } | { ok: false; detail: string };

function entitiesMatch(claim: Claim, record: ActionRecord, f: RecordFacts): EntityResult {
  for (const mention of claim.exerciseMentions) {
    if (f.names.size > 0 && !mention.some((n) => f.names.has(n))) {
      return { ok: false, detail: `It named ${mention[0] ?? 'another exercise'}; only ${[...f.names].join(', ')} changed.` };
    }
    if (f.names.size === 0 && record.detail.kind !== 'save_memory' && record.detail.kind !== 'forget_memory' && record.detail.kind !== 'add_playbook_candidate') {
      return { ok: false, detail: `It named ${mention[0] ?? 'an exercise'}; that wasn't changed.` };
    }
  }
  if (record.detail.kind === 'adjust_pending_sets' || record.detail.kind === 'undo') {
    const pool = claim.op === 'remove_set' ? f.removedSets : claim.op === 'add_set' ? f.addedSets : record.detail.kind === 'undo' ? f.changedSets : new Set([...f.changedSets, ...f.addedSets]);
    if ((claim.op === 'remove_set' || claim.op === 'add_set') && pool.size === 0) {
      return { ok: false, detail: claim.op === 'remove_set' ? 'It said a set was removed; none was.' : 'It said a set was added; none was.' };
    }
    const outside = claim.setNumbers.filter((n) => !pool.has(n));
    if (outside.length > 0) {
      const changed = [...f.changedSets, ...f.removedSets, ...f.addedSets];
      return { ok: false, detail: `It named ${setNumbersText(outside)}; only ${setNumbersText(changed)} changed.` };
    }
  }
  return { ok: true };
}

function numbersMatch(claim: Claim, f: RecordFacts): { ok: true } | { ok: false; detail: string } {
  const said = (n: number, unit?: string): string => `${formatNumber(n)}${unit ? ` ${unit}` : ''}`;
  const saved = f.primaryLoad ? `${formatNumber(f.primaryLoad.value)} ${f.primaryLoad.unit}` : 'different';
  for (const l of claim.loads) {
    if (!f.loads.some((x) => x.unit === l.unit && formatNumber(x.value) === formatNumber(l.value))) {
      return { ok: false, detail: `The saved load is ${saved}; the reply said ${said(l.value, l.unit)}.` };
    }
  }
  for (const n of claim.bareNumbers) {
    if (!f.numbers.has(formatNumber(n))) return { ok: false, detail: `The saved values don't include ${said(n)}, which the reply said.` };
  }
  if (claim.unverifiable) return { ok: false, detail: 'The reply gave a percentage; the saved change is shown instead.' };
  return { ok: true };
}

const NO_ACTION = 'No change was saved in this reply.';

/** "Bench: 95 kg for sets 3 and 4" (not "Rest: 3 min", not a question). */
function exerciseValueLine(normalised: string): boolean {
  const m = EXERCISE_VALUE_LINE.exec(normalised);
  if (m === null || isQuestion(normalised)) return false;
  const label = (m[1] ?? '').trim();
  return !LINE_LABELS.test(label) && label.split(' ').length <= 4;
}

function checkClaim(claim: Claim, ledger: TurnLedger, cited: ReadonlySet<string>): ClaimCheck {
  // CC5 (review r2 S2): an earlier action backs free text only when this sentence cites its token.
  const candidates = ledger.entries.filter((e) => (e.origin === 'this_turn' || cited.has(e.record.actionId)) && kindMatches(claim, e.record));
  if (candidates.length === 0) return { keep: false, reason: 'no_action', detail: NO_ACTION, replaceWith: null };
  const live = candidates.filter(liveCommitted);
  if (live.length === 0) {
    const first = candidates[0]?.record;
    const detail =
      first?.status === 'proposed'
        ? "That change was only suggested; it isn't applied."
        : first?.status === 'committed'
          ? 'That change was undone.'
          : "That change didn't go through.";
    return { keep: false, reason: 'not_committed', detail, replaceWith: null };
  }
  let entityFailure: string | null = null;
  for (const e of live) {
    const f = factsOf(e.record);
    const ent = entitiesMatch(claim, e.record, f);
    if (!ent.ok) {
      entityFailure ??= ent.detail;
      continue;
    }
    const valueKinds: readonly ActionKind[] = ['adjust_pending_sets', 'undo', 'set_next_session_targets'];
    if (valueKinds.includes(e.record.detail.kind)) {
      const nums = numbersMatch(claim, f);
      if (!nums.ok) return { keep: false, reason: 'numbers_differ', detail: nums.detail, replaceWith: e.record.actionId };
    } else if (claim.loads.length > 0 || claim.unverifiable) {
      continue;
    }
    return { keep: true, claim: true, matchedActionIds: [e.record.actionId] };
  }
  return { keep: false, reason: 'mismatch', detail: entityFailure ?? NO_ACTION, replaceWith: null };
}

/**
 * Check one finished sentence (with `[[ref]]` tokens already removed) against
 * this turn's ledger. `citedActionIds` are the actions whose tokens the
 * sentence carried: only those let an `earlier` entry back its words (CC5).
 */
export function checkReplyClaims(sentence: string, ledger: TurnLedger, citedActionIds: ReadonlySet<string> = new Set()): ClaimCheck {
  const normalised = normaliseForClaims(sentence);
  if (normalised.length === 0) return { keep: true, claim: false, matchedActionIds: [] };
  const names = [...new Set([...ledger.knownExerciseNames, ...ledger.entries.flatMap((e) => [...factsOf(e.record).names])])];
  const matched: string[] = [];
  let anyClaim = false;
  // "Sets 3 and 4: 95 kg." states targets in the app's own format: treated as a claim about those sets.
  const listed = SET_VALUE_LINE.test(normalised) || exerciseValueLine(normalised);
  for (const clause of clausesOf(normalised)) {
    const words = clause.split(' ').filter((w) => w.length > 0);
    const isListLine = listed && (/^sets? [\d_]+$/.test(clause) || clause === EXERCISE_VALUE_LINE.exec(normalised)?.[1]?.trim());
    if (isListLine) {
      anyClaim = true;
      const result = checkClaim(parseClaim(normalised.replace(/[.?!]+$/, ''), normalised, names), ledger, citedActionIds);
      if (!result.keep) return result;
      matched.push(...result.matchedActionIds);
      continue;
    }
    if (!hasClaimTrigger(words, clause, normalised)) continue;
    anyClaim = true;
    const result = checkClaim(parseClaim(clause, normalised, names), ledger, citedActionIds);
    if (!result.keep) return result;
    matched.push(...result.matchedActionIds);
  }
  return { keep: true, claim: anyClaim, matchedActionIds: [...new Set(matched)] };
}

/** Exposed for the corpus test's report: does this sentence read as a claim at all? */
export function isChangeClaim(sentence: string): boolean {
  const normalised = normaliseForClaims(sentence);
  if (SET_VALUE_LINE.test(normalised) || exerciseValueLine(normalised)) return true;
  return clausesOf(normalised).some((c) => hasClaimTrigger(c.split(' ').filter((w) => w.length > 0), c, normalised));
}
