import { formatNumber, setNumbersText } from '@fizz/domain';
import type { ActionKind, ActionRecord, CoachTarget, Load } from '@fizz/schemas';
import { normaliseForClaims } from './text';
import { COMMON_EXERCISE_NAMES, EXERCISE_ABBREVIATIONS, EXERCISE_WORD } from './vocab';

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
 *
 * Review r3 B3: the backstop's vetoes are local. A suggestive, unchanged or
 * past word only vetoes when it comes before the value in the same
 * sub-clause (split on "rather than", "than", "which", "as", "so", "while"),
 * and history only in that sub-clause, so "Sets 3 and 4 have 95 kg rather
 * than the 100 you did" and "Given last week, you have 95 kg for the rest"
 * are claims. "Expect …", "see …" and "plan …" state the app's state, not
 * advice. "It's on your card", structural slang ("Squat first next time",
 * "Push A now opens with squat", "taking cable fly's spot", "Next Push A:
 * pec deck, not cable fly"), removal slang ("Binned set 4", "Set 4 is
 * history"), progression holds ("Overhead press is on hold while your
 * shoulder settles"), memory forms ("I've wiped that memory", "Consider it
 * noted", "I'll bear that in mind"), bare acknowledgements ("Will do.", "On
 * it.") and tag questions ("95 for the rest, yeah?") are claims. A generic
 * or plural exercise word ("presses", "dumbbells", "flyes") claims every
 * exercise it could mean.
 *
 * Review r4 B3: undo results ("Back to 100.", "Rolled back."), comparative
 * loads with a scope and no number ("Lighter for the last two"), sets added
 * or removed with no verb ("Extra set on the end", "No set 4 today", "Last
 * two: 95"), set types ("Last set is an AMRAP"), structural forms ("Pec deck
 * next time", "Pec deck replacing cable fly", "Squats lead next time"), more
 * holds ("OHP's on ice", "off the table", "Holding off on OHP"), memory and
 * generic forms ("I've let that go", "Handled.") are claims. Abbreviations
 * ("OHP", "RDL") name their exercise; an exercise outside the session, or
 * "all your sets", is a mismatch, never a pass. These lists still can't
 * promise recall on fresh phrasings: `needsNoChangeLine` in `reply.ts` is the
 * structural option awaiting Ben/PM approval (r4 spec issue 1).
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
  // Review r3 B3: removal and memory slang.
  'binned', 'chopped', 'axed', 'nixed', 'culled', 'canned', 'dumped', 'tossed', 'zapped', 'wiped', 'erased', 'scrubbed', 'paused',
  'frozen', 'held', 'parked', 'benched', 'shelved',
  // Review r4 B3.
  'reversed', 'retired', 'scratched', 'rewound',
  // workout-builder WB28: a workout started from chat (no tool can).
  'started', 'launched',
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
  'bin', 'chop', 'axe', 'nix', 'wipe', 'erase', 'pause', 'freeze', 'park', 'shelve', 'bear',
]);
const DOUBLING = new Set(['drop', 'cut', 'swap', 'up', 'log', 'flag', 'trim', 'sub', 'set', 'put', 'plan', 'cap', 'scrap', 'slot', 'program', 'reset', 'pencil', 'dial', 'bin', 'chop']);
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
  'optional', 'optionally',
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
const MENTION_WORDS = new Set([
  'incline', 'decline', 'seated', 'standing', 'smith', 'assisted', 'weighted', 'machine', 'cable', 'dumbbell', 'barbell', 'press', 'db',
  // Review r3 B3: movement words, matched in singular form ("presses", "flyes", "rows").
  'fly', 'row', 'curl', 'raise', 'squat', 'deadlift', 'pull', 'pulldown', 'extension', 'lunge', 'dip', 'deck', 'thrust',
]);
/** Words that mean the same equipment: "dumbbells" names "Incline DB press". */
const MENTION_SYNONYMS: Readonly<Record<string, readonly string[]>> = { dumbbell: ['db', 'dumbbell'], db: ['db', 'dumbbell'] };

/** "presses" → "press", "flyes"/"flies" → "fly", "dumbbells" → "dumbbell", "dbs" → "db". */
function singular(w: string): string {
  if (w === 'flyes' || w === 'flies' || w === 'flys') return 'fly';
  if (/(?:ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  if (w === 'dbs') return 'db';
  return w;
}

const GENERIC_NAME_WORDS = new Set([
  'press', 'machine', 'cable', 'dumbbell', 'dumbbells', 'barbell', 'back', 'front', 'the', 'and', 'with', 'seated', 'standing',
  'single', 'arm', 'one', 'grip', 'close', 'wide', 'smith', 'assisted', 'weighted', 'incline', 'decline', 'flat',
]);

// ---------------------------------------------------------------------------

/** `workout_saved`: a workout saved, scheduled or started. No tool does that (BD15), so nothing can back it. */
type ClaimKind = ActionKind | 'log_set' | 'any' | 'workout_saved';
/**
 * An exercise the claim names. `all`: a generic or plural word ("presses",
 * "dumbbells") claims every exercise it could mean, so each must have
 * changed (review r3 B3); a specific name needs only one.
 */
interface Mention {
  names: string[];
  all: boolean;
}
/** `set_type`: an AMRAP, drop set or failure set. `adjust_pending_sets` can't change set types, so it never matches. */
type SetOp = 'change' | 'remove_set' | 'add_set' | 'set_type';
/**
 * How a number was said (review r5 B1a): `value` is a target now ("95 for
 * the rest"); `previous` is the old one ("from 100", "not 100", "instead of
 * 100"); `delta` is a difference ("took 5 off", "2 more reps").
 */
type NumberRole = 'value' | 'previous' | 'delta';

interface Claim {
  kinds: Set<ClaimKind>;
  op: SetOp;
  setNumbers: number[];
  /** Alias words found, each mapped to the names it could mean. */
  exerciseMentions: Mention[];
  loads: { value: number; unit: 'kg' | 'lb'; role: NumberRole }[];
  bareNumbers: { value: number; role: NumberRole }[];
  /** A load convention the reply named ("per side", "each dumbbell", "on the stack"); null when none. */
  convention: Load['convention'] | 'per_side' | null;
  conventionText: string | null;
  unverifiable: boolean;
  /** "All your sets are 95 now": every set, which a ledger of changed sets can't confirm (review r4 B3). */
  allSets: boolean;
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
  // Review r3 B3: the app's state with no number, memory forms.
  /\b(?:it|they|that|this|those|these|everything|all|which) (?:is|are) (?:now |all )?(?:on|in) (?:your|the) (?:card|cards|app|screen|plan|sheet|log|workout|session|list)\b/,
  /\bconsider it (?:noted|done|sorted|handled|saved|logged|changed|remembered|dealt with)\b/,
  /\b(?:bear|keep|hold|carry) (?:that|this|it|those|these) in mind\b/,
  /\b(?:on|in) (?:the|my|your) (?:radar|books|notes|list)\b/,
  // Review r4 B3.
  /\b(?:change|changes|update|updates|adjustment|adjustments|edit|edits) (?:is|are) (?:now )?(?:live|in|in place|active|on|through)\b/,
];

/** Past-tense progress talk ("your squat has increased since August") is history, not a change made now. */
/** The label of a set line: "sets 3_4", "last two", "the rest" (review r4 B3). */
const SET_LABEL = /^(?:sets? [\d_]+|(?:the |your )?(?:(?:last|final|remaining|next) (?:two|three|four|one|set|sets|\d+)(?: sets)?|remaining sets)|(?:the|your) rest)$/;
const SET_VALUE_LINE = /\bsets? [\d_]+\s*:\s*\d|^(?:(?:the |your )?(?:(?:last|final|remaining|next) (?:two|three|four|one|set|sets|\d+)(?: sets)?|remaining sets)|(?:the|your) rest)\s*:\s*\d/;
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
  // Review r5: "All your lifts are down 5".
  /\b(?:is|are) (?:now )?(?:down|up) (?:by )?\d/,
  /\b(?:is|are) (?:now )?(?:at |on )?\d/,
  /\b(?:you|we) are (?:now )?(?:at|on) \d/,
  /\b(?:is|are) (?:now )?(?:out|in|gone|off)(?: (?:for|of|instead|next|from|today|now)\b|$)/,
  /\b(?:replaces|swaps in for|takes over from|comes in for|stands in for|subs in for)\b/,
  /\b(?:you|we) are (?:now )?(?:doing|lifting|using|going|hitting|pressing|squatting|pulling|working with|working at|sitting at) \d/,
  /\b(?:is|are) (?:now )?(?:sitting|staying|sat) (?:at )?\d/,
  // Review r3 B3: removal slang ("Set 4 is history").
  /\b(?:is|are) (?:now )?(?:history|toast|binned|scrapped|ditched|axed|off the (?:list|plan|card|menu))\b/,
];

/**
 * Structural claims with no change verb (CC10, review r3 B3): "Squat first
 * next time", "Push A now opens with squat", "Pec deck's taking cable fly's
 * spot next time".
 */
const STRUCT_STATE: readonly RegExp[] = [
  /\b(?:first|last|second|third|next|after|before) \w* ?(?:next (?:time|session|week|workout|push|pull|legs)|from now on|going forward|from (?:here|today) on)\b/,
  /\b(?:now |will )?(?:opens?|starts?|leads?|begins?|ends?|finish(?:es)?|closes?|kicks? off) with\b/,
  /\b(?:slots?|slotted|slotting|steps?|stepping|comes?|coming|goes|going|swaps?|subs?|drops?|dropping) in (?:for|where|instead|in place|at)\b/,
  /\b(?:taking|takes|took|gets|getting|has|have|got|in) (?:over )?(?:(?:[a-z]+ ){0,3}[a-z]+'s |the |its |their |that |his )?(?:old )?(?:spot|place|slot)\b/,
  /\b(?:moves?|moved|bumped|goes|go) (?:up|down) (?:the order|a slot|one slot|one place|to (?:first|second|third|last))\b|\b(?:moves?|moved|goes|go) to the (?:front|top|start|end|back) of\b/,
];
/** "Next Push A: pec deck, not cable fly." A workout label, the new exercise and the old one (CC10). */
const STRUCT_LINE = /^(?:next |your next |for )?([a-z][a-z ]{1,30}?) ?: ?([a-z][a-z ]{1,40}?),? (?:not|instead of|in place of|over|replacing) ([a-z][a-z ]{1,40}?)$/;
/**
 * A progression hold on a movement (review r3 B3): "Overhead press is on
 * hold while your shoulder settles", "won't progress until your shoulder
 * settles". It reads as a saved pain flag.
 */
const PAIN_HOLD = /\b(?:is|are) (?:now )?(?:on hold|paused|frozen|blocked|parked|benched|shelved)\b|\bon hold\b|\b(?:holding|pausing|freezing|blocking|stopping|stopped|paused|froze|frozen|blocked) (?:its |the |your |any )?(?:progress(?:ion)?|increases?)\b|\bno (?:more )?(?:progress(?:ion)?|increases?) (?:on|for)\b/;
const PAIN_HOLD_SOFT = /\b(?:will not|won't|wont|not going to|cannot|can't|cant|isn't going to) (?:progress|go up|increase|move up)\b|\bstays? (?:at [\d.]+(?: kgs?| lbs?)? )?(?:till|until|while)\b/;
/**
 * More progression holds (review r4 B3): "OHP's on ice for now", "Overhead
 * press is off the table", "Leaving overhead press alone", "I won't push
 * overhead press", "No more overhead pressing till the shoulder settles".
 */
const PAIN_HOLD_R4 = /\bon ice\b|\boff the table\b|\b(?:leaving|i (?:have )?left) [a-z ]{1,30}? alone\b|\b(?:will not|won't|wont|not going to|not gonna) push (?!yourself|you\b)[a-z]|\bno more [a-z ]{0,20}?\w+ing\b.*\b(?:till|until|while)\b|\b(?:is|are) (?:now )?(?:resting|sidelined|benched|out) (?:for now|until|till|while)\b/;
/** Holds that need an exercise named: "Holding off on OHP", "OHP stays put while …", "I'll keep OHP light until it settles". */
const PAIN_HOLD_EX = new RegExp(`(?:\\bhold(?:ing)? off (?:on|with)\\b|\\bstays? put\\b|\\bkeep(?:ing)? [a-z ]{1,30}? (?:light|easy|where it is|as is|steady|there|flat) (?:until|till|while|for now)\\b)`);
const BODY_CONTEXT = /\b(?:pain|painful|hurts?|injur(?:y|ed)|flag(?:ged)?|shoulders?|elbows?|wrists?|knees?|back|hips?|ankles?|neck|settles?|heals?|recovers?|calms? down|better)\b/;

function painHoldClaim(clause: string, sentence: string): boolean {
  // "If your shoulder hurts, overhead press won't progress" explains a rule; it doesn't claim a flag.
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence) || /^(?:if|when|once|unless|should)\b|\b(?:if|unless)\b/.test(sentence)) return false;
  if (matchesUnnegated(PAIN_HOLD, clause) && !suggestiveBefore(clause, PAIN_HOLD)) return true;
  if (PAIN_HOLD_R4.test(clause) && !suggestiveBefore(clause, PAIN_HOLD_R4) && !clause.split(' ').some((w) => SUGGESTIVE.has(w))) return true;
  if (PAIN_HOLD_EX.test(clause) && new RegExp(`\\b${EXERCISE_WORD}\\b`).test(clause) && !clause.split(' ').some((w) => SUGGESTIVE.has(w))) return true;
  return PAIN_HOLD_SOFT.test(clause) && BODY_CONTEXT.test(sentence) && !suggestiveBefore(clause, PAIN_HOLD_SOFT);
}

function suggestiveBefore(clause: string, re: RegExp): boolean {
  const m = re.exec(clause);
  if (m === null) return false;
  const before = clause.slice(0, m.index).split(' ').filter((w) => w.length > 0);
  return suggestiveAt([...before, ''], before.length, 6);
}

function structuralStateClaim(clause: string, sentence: string): boolean {
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence)) return false;
  for (const re of STRUCT_STATE) {
    if (matchesUnnegated(re, clause) && !suggestiveBefore(clause, re) && !/\b(?:if|when|once|unless)\b/.test(clause)) return true;
  }
  return false;
}
/** "Bench now sits at 95", "your sets read 95 kg", "the app shows 95": a state read off the screen. History ("your log shows 100 last week") isn't. */
const SHOWN_STATE = /\b(?:sits?|sitting|reads?|reading|shows?|showing|says|displays?|displaying) (?:now )?(?:at |as )?\d/;
/** "95 kg for sets 3 and 4", "95 for the rest", "95 from here": a value stated as the plan, with no verb. */
const VALUE_FIRST = /^\d+(?:\.\d+)?(?: (?:kgs?|lbs?|kilos?|kilograms?|pounds?))?(?: x \d+)? (?:for (?:sets? |the |your |both|all|each|every)|from (?:here|now|next|today)|next (?:time|session|week)|it is\b|on (?:sets? |the |your |both|all))/;
/** "Pec deck in", "cable fly out": an exercise entering or leaving the plan with no verb (CC10). */
const BARE_IN_OUT = /^(?!(?:not|no|never|i|we|you|me|it|that|this|all|count|sets?|breathe|brace|knees|elbows|chest|chin|toes|hips|tuck|lock|squeeze|push|pull|log|sign|check|tap|zoom|work|time)\b)[a-z][a-z ]{1,40}? (?:in|out)$/;
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

/** "95 for the rest, yeah?": a statement with a tag, not a question (review r3 B3). */
const TAG_QUESTION = /,? (?:yeah|yep|yes|right|ok|okay|eh|innit|correct|alright|no|yeah no|got it|cool|done|ya|yup)\s*\?+\s*$/;

function isQuestion(sentence: string): boolean {
  return /\?\s*$/.test(sentence) && !TAG_QUESTION.test(sentence);
}

function presentStateClaim(clause: string, sentence: string): boolean {
  const shown = matchesUnnegated(SHOWN_STATE, clause) && !HISTORICAL.test(sentence);
  if (!shown && !PRESENT_STATE.some((re) => matchesUnnegated(re, clause))) return false;
  if (STATE_FACT_SUBJECT.test(clause)) return false;
  if (OFFER_TAIL.test(sentence)) return false;
  const words = clause.split(' ');
  if (words.some((w) => SUGGESTIVE.has(w))) return false;
  return !/\b(?:when|once|until)\b|\bafter (?!this\b|that\b|here\b|now\b)/.test(clause);
}

// ---------------------------------------------------------------------------
// Review r4 B3: forms the r3 lists still kept with nothing saved.

const EX = EXERCISE_WORD;
/** Undo stated as a result: "Back to 100.", "Rolled back.", "Reversed.", "Back how it was." */
const UNDO_STATE = /^back to \d|\bback (?:how|as|the way) (?:it|they|things) (?:was|were)\b|^back where (?:we|it|you|they) (?:started|was|were)\b|\b(?:is|are|goes|go|went|it is|that is) (?:now |all )?back (?:to\b|how\b|as (?:it|they) (?:was|were)\b|the way\b)|\brolled (?:it |them |that |those |everything )?back\b|^reversed$/;
/** Sets added or removed with no verb: "Extra set on the end for you", "No set 4 today", "Bench gets a fourth set". */
const EXTRA_SET = /\b(?:an? )?(?:extra|bonus|additional|fourth|fifth|sixth) sets?\b|\bone more set\b.*\b(?:on the (?:card|end)|for you|added|next time|today)\b|\bgets? (?:a|an|one|another|an extra) (?:\w+ )?(?:set|rep)s?\b/;
const NO_SET = /^no (?:sets? [\d_]+|(?:third|fourth|fifth|sixth|last|final|extra) sets?)\b/;
/** A set's type stated as the plan: "Last set is an AMRAP". */
const SET_TYPE = /\b(?:is|are) (?:now )?(?:an? )?(?:amrap|drop ?set|back-?off(?: set)?|myo ?reps?|rest-?pause|cluster(?: set)?|top set|failure set)\b/;
/** "Pec deck next time", "Squats lead next time", "Squat kicks off next session" (CC10). */
const EX_NEXT = new RegExp(`^(?:your |the )?(?:[a-z]+ ){0,2}${EX}(?: [a-z]+){0,2} (?:next (?:time|session|week|workout|push|pull|legs)|from next (?:time|session|week))$`);
/** "Your next Push A has pec deck instead of cable fly", "Pec deck takes over next time", "Pec deck replacing cable fly". */
const STRUCT_R4: readonly RegExp[] = [
  /\b(?:has|have|gets|get|includes?|features?|uses?) [a-z ]{1,40}? instead of [a-z]/,
  /\btakes? over\b|\b(?:goes|go|slots?|moves?|sits?) (?:in )?where\b/,
  /\bgets? (?:a|the) (?:rest|break|week off|breather|holiday)\b/,
  /\bnow (?:leads?|opens?|starts?|kicks? off|heads? up|closes?|finish(?:es)?)\b/,
  /^(?!replacing|subbing|standing|filling)[a-z ]+ (?:replacing|subbing (?:in )?for|standing in for|filling in for|in place of)\b/,
  /\b(?:leads?|opens?|kicks? off|goes first|comes first|is first|starts?)\b.*\bnext (?:time|session|week|workout)\b/,
];
/** "Your plan now reflects that." */
const REFLECTS = /\b(?:now )?(?:reflects?|matches|mirrors) (?:that|this|it|the change|the changes|your request|what you asked)\b/;
/** "Let that go", "Gone from memory". */
const MEMORY_R4 = /\blet (?:that|it|this|those) go\b|\b(?:gone from|out of|removed from|deleted from) (?:my |the |your )?memor(?:y|ies)\b/;
/** A comparative load with a scope and no number: "Lighter for the last two", "Easier sets from here", "Bench goes up a notch next time". */
const COMPARATIVE = /\b(?:lighter|heavier|easier|harder|a notch|a touch|less weight|more weight|a bit less|a bit more|(?:down|up) (?:a |one |two )?(?:plate|plates|notch|touch|step|jump)|(?:a|one|two|\d+) plates? (?:less|more|lighter|heavier|down|up|off))\b/;
const COMPARATIVE_SCOPE =
  /\b(?:for|on) (?:the |your )?(?:rest|last (?:two|three|one|set|sets|\d+)|remaining(?: sets)?|next (?:set|one|two))\b|\b(?:the |your )?(?:last|final) (?:two|three|\d+|set|sets)\b|\bsets? [\d_]+\b|\bfrom (?:here|now)(?: on)?\b|\bnext (?:time|session|week|workout)\b|\bfor you\b|\bthe rest\b|\bremaining\b/;
/** Before a comparative, these make it a feeling, a past fact, a prediction or a comparison, not a change. */
const COMPARATIVE_VETO = /\b(?:felt|feel|feels|feeling|looked|looks|moved|moves|seemed|seems|was|were|did|went|should|would|could|might|may|will|if|than|when|once)\b/;

function r4FormClaim(words: readonly string[], clause: string, sentence: string): boolean {
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence)) return false;
  if (/^(?:if|when|once|unless)\b/.test(sentence) || /\b(?:if|unless)\b/.test(clause)) return false;
  if (words.some((w) => SUGGESTIVE.has(w))) return false;
  const first = words.find((w) => !INTERJECTIONS.has(w)) ?? '';
  if (IMPERATIVE_START.has(first) && first !== 'back') return false;
  if (matchesUnnegated(UNDO_STATE, clause)) return true;
  if (NO_SET.test(clause)) return true;
  if (matchesUnnegated(EXTRA_SET, clause) && !COMPARATIVE_VETO.test(clause) && !UNCHANGED_OR_PAST.test(clause)) return true;
  if (matchesUnnegated(SET_TYPE, clause) && !STATE_FACT_SUBJECT.test(clause)) return true;
  if (EX_NEXT.test(clause)) return true;
  if (STRUCT_R4.some((re) => matchesUnnegated(re, clause))) return true;
  if (matchesUnnegated(REFLECTS, clause)) return true;
  if (matchesUnnegated(MEMORY_R4, clause)) return true;
  // "Your remaining bench sets went down": a change stated as having happened, not Ben's history.
  if (/\b(?:sets?|weights?|loads?|targets?|numbers?|it|they|that|everything)\b.*\b(?:went|have gone|has gone|came|have come|has come) (?:down|up)\b/.test(clause) && !HISTORICAL.test(sentence) && !/\byou\b/.test(clause)) return true;
  // "Ok, 95." / "Easy does it from here: 95.": a bare value as a whole clause states the target.
  if (/^\d+(?:\.\d+)?(?: (?:kgs?|lbs?|kilos?|kilograms?|pounds?))?$/.test(clause) && !HISTORICAL.test(sentence) && !/\b(?:rpe|rir|rest|reps?|set|sets|tempo|time|best|pr|pb|e1rm|bar)\s*:?\s*[\d_]*\s*[:,]\s*\d/.test(sentence)) return true;
  const comp = COMPARATIVE.exec(clause);
  if (comp !== null && COMPARATIVE_SCOPE.test(clause) && !negatedBeforeIndex(clause, comp.index)) {
    const before = clause.slice(0, comp.index);
    if (!COMPARATIVE_VETO.test(before) && !HISTORICAL.test(sentence) && !UNCHANGED_OR_PAST.test(before)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Review r5 B1b: forms the r4 lists still kept with nothing saved. The lists
// can't promise recall; `needsNoChangeLine` in `reply.ts` is the backstop.

const UNDO_R5 = /\bback (?:at|on|to) \d|^(?:it is |that is |they are |we are |you are )?(?:all )?(?:now )?same as (?:before|it was|they were)(?: now)?$|^as you were$|\bundo (?:worked|went through|is done|done|complete|stuck)\b|\bback to (?:normal|how it was|the original|where it was|the old|what it was)\b/;
/** "Losing set 4", "Killed set 4", "Bye bye set 4", "Four sets becomes three", "Only three sets today". */
const REMOVE_R5 =
  /\b(?:losing|lose|killed|killing|lost|bye bye|goodbye|so long|ditching|binning|nuking|nuked|zapping|skipping|skipped|scratching|dropping|cutting) (?:the |your )?(?:sets? [\d_]+|(?:last|final|extra|\w+th) sets?)\b|\b\d+ sets? (?:becomes?|turns? into|is now|are now|goes to|go to|now|down to|drops? to) \d+\b|\b\d+ sets? (?:today |now )?instead of \d+\b|\bonly \d+ sets?\b(?! (?:to go|left)\b)/;
const ADD_R5 = /\b(?:tacked|tacking|tack|stuck|bolted|bolting|chucked|chucking|tagged|tagging|threw|throwing|whacked|slapped|added) (?:on )?(?:a|an|one|another|an extra)(?: \w+)? set\b/;
/** "AMRAP on the last set", "Last set to failure", "Drop set on the end". */
const SET_TYPE_R5 = /\b(?:amrap|to failure|drop ?set|rest-?pause|myo ?reps?|cluster(?: set)?|failure set)\b.*\b(?:on|for) (?:the )?(?:last|final|end|sets? [\d_]+)\b|\b(?:last|final) set (?:to|is|as|goes to) (?:failure|an? amrap|amrap)\b|\b(?:drop ?set|amrap|failure set) (?:on|at) the end\b/;
/** "Two sets at 95 to go", "Rest of bench at 95", "Hack squat at 95 now", "Bench stays 95 next session". */
const VALUE_R5 = /\bsets? (?:at|@) \d+(?:\.\d+)?(?: \w+)? (?:to go|left|remaining)\b|^(?:the )?rest of (?:the |your )?\w+(?: \w+)? (?:at|@|on) \d|\bat \d+(?:\.\d+)?(?: (?:kgs?|lbs?|kilos?|pounds?))? now\b|\b(?:stays?|staying|holds?|holding|sticks?|sticking|remains?) (?:at |on )?\d+(?:\.\d+)?(?: (?:kgs?|lbs?|kilos?|pounds?))? (?:next|for next|from now|going forward)\b|\bnext (?:session|time|week|workout)\b.*\b(?:stays?|holds?|remains?|sticks?) (?:at |on )?\d/;
/** "Pec deck in for cable fly", "Pec deck for cable fly next time", "Cable fly → pec deck", "Pec deck > cable fly from now" (CC10). */
const STRUCT_R5: readonly RegExp[] = [
  new RegExp(`^(?:[a-z]+ ){0,2}${EX}(?: [a-z]+)? (?:is )?in for (?:the |your )?(?:[a-z]+ ){0,2}${EX}\\b`),
  new RegExp(`^(?:[a-z]+ ){0,2}${EX}(?: [a-z]+)? for (?:the |your )?(?:[a-z]+ ){0,2}${EX}\\b.*\\b(?:next (?:time|session|week|workout|push|pull|legs)|from now(?: on)?|going forward|from here)\\b`),
  new RegExp(`(?:[a-z]+ ){0,2}${EX}(?: [a-z]+)? ?(?:→|->|=>|>|⇒|➔) ?(?:[a-z]+ ){0,2}${EX}\\b`),
  /\b(?:won'?t|will not|wont|never) (?:show up|appear|feature|come up|be (?:in|on|back)|turn up|pop up)\b.*\bagain\b|\b(?:won'?t|will not|wont|never) see (?:[a-z]+ ){1,3}again\b/,
];
/** "Same for squat", "Squat got the same treatment", "Incline as well": the last change, claimed for another exercise. */
const SAME_FOR_R5: readonly RegExp[] = [
  new RegExp(`^(?:and |also |plus |oh and )?(?:the )?same (?:for|with|goes for|on|applies to) (?:the |your )?(?:[a-z]+ ){0,2}${EX}\\b`),
  /\b(?:got|gets|had|has|getting) the same (?:treatment|change|drop|cut|bump|deal|thing)\b/,
  new RegExp(`^(?:and |also |plus |oh and )?(?:the |your )?(?:[a-z]+ ){0,2}${EX}(?: [a-z]+)? (?:too|as well|also)$`),
  /\brest (?:at|@) \d/,
];

/** "Shoulder flag's up", "OHP won't go up for now", "I'll keep OHP where it is". */
const PAIN_R5 =
  /\bflags? (?:is |are )?(?:now )?(?:up|raised|in place|live|in)\b|\b(?:will not|won't|wont|not going to|isn't going to|is not going to) (?:go up|progress|increase|move up|climb)\b.*\b(?:for now|for a while|for the time being|until|till|this week|next time|for a bit)\b|\b(?:i will|we will|i am going to|we are going to|i have|we have) (?:keep|hold|leave|park|freeze|pause|lock) [a-z ]{1,30}? (?:where (?:it|they) (?:is|are)|as (?:it|they) (?:is|are)|as is|steady|flat|there|alone|on hold|at \d+(?:\.\d+)?)\b/;
/** "Locked OHP at 50": past tense sentence-initial with a value. */
const LOCKED_R5 = /^(?:locked|pinned|fixed|parked|capped|held|kept|left) (?:in )?(?:[a-z]+ ){1,3}(?:at|to|on) \d/;
/** "I know you train before work now", "I've got that", "Got that", "Playbook has it now". */
const MEMORY_R5 =
  /^i (?:now )?know (?:that )?(?:you|your)\b.*\bnow$|^(?:i have |i've |we have )?got (?:that|this)(?: down| noted| saved)?$|^i have got (?:it|that|this)$|\bplaybook (?:has|holds|contains|includes|now has) (?:it|that|this|those)\b|\b(?:it is|that is|they are) (?:now )?in (?:the|your|my) (?:playbook|memory|notes|book|head)\b|^(?:filed|noted|logged|saved|stored|remembered)(?: away| that| it)?$/;
/** Bare acknowledgements that read as "saved": "In it goes", "On the card now", "Banked". */
const GENERIC_R5 =
  /^(?:(?:ok|okay|right|great|sure|alright|cool|perfect|yes|yep|yeah|nice|boom|bang|there|and)\s*)*(?:in (?:it|they|that) goes?|on (?:the|your) card(?: now)?|locked and loaded|in the bank|banked|booked in|all in|all locked in|in the system|in the app|on file|on there now|it is on there|that is on there|it is in|that is in|it is on|that is on|it is live|that is live|live now|that is live now|good to go|ready to go|you are good to go|you are ready|all good to go|you are sorted|you are all sorted|you are on)$/;

function r5FormClaim(words: readonly string[], clause: string, sentence: string): boolean {
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence)) return false;
  if (/^(?:if|when|once|unless)\b/.test(sentence) || /\b(?:if|unless)\b/.test(clause)) return false;
  if (words.some((w) => SUGGESTIVE.has(w))) return false;
  if (GENERIC_R5.test(clause) || MEMORY_R5.test(clause)) return true;
  const first = words.find((w) => !INTERJECTIONS.has(w)) ?? '';
  // "Rest of bench at 95" and "Drop set on the end" state the plan; "Rest 3 minutes" and "Drop the weight" are advice.
  const statesPlan = (first === 'rest' && /\brest of\b/.test(clause)) || (first === 'drop' && /^(?:\w+ )*?drop ?sets?\b/.test(clause));
  if (IMPERATIVE_START.has(first) && first !== 'back' && first !== 'keep' && !statesPlan) return false;
  if (HISTORICAL.test(sentence) && !/\bnow\b/.test(clause)) return false;
  return [UNDO_R5, REMOVE_R5, ADD_R5, SET_TYPE_R5, VALUE_R5, PAIN_R5, LOCKED_R5, ...SAME_FOR_R5, ...STRUCT_R5].some((re) => matchesUnnegated(re, clause) || (re === STRUCT_R5[3] && re.test(clause)));
}

/**
 * Review S5: a future or kept state stated as fact needs a saved change
 * behind it, like any other claim: "Next push day you start on 100.",
 * "Squat stays where it is for the rest.", "Your squat stays at 100."
 * Advice ("Keep the squat where it is"), conditions and questions are not.
 */
const NEXT_START = /\b(?:you (?:will |ll )?)?(?:start|open|begin|kick off)s? (?:on|at|with|from) \d/;
const STAYS_STATE = /\b(?:stays?|remains?|is staying|are staying|will stay|is kept|are kept|is held|are held) (?:where (?:it|they) (?:is|are)|as (?:it|they) (?:is|are)|the same|unchanged|put|at \d)/;
const FUTURE_STATE_VETO = /\b(?:if|unless|would|could|should|might|may|when|once|until|till|while|try|maybe|perhaps|suggest|recommend|let|keep|aim)\b/;

function futureStateClaim(clause: string, sentence: string): boolean {
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence) || FUTURE_STATE_VETO.test(sentence)) return false;
  if (HISTORICAL.test(sentence) || STATE_FACT_SUBJECT.test(clause) || /^(?:the |your )?rest\b/.test(clause)) return false;
  // "Start on 95 next time" is advice (imperative); "you start on 100" states the plan.
  if (matchesUnnegated(NEXT_START, clause) && /\bnext\b/.test(sentence) && !/^(?:start|open|begin|kick off)\b/.test(clause)) return true;
  return matchesUnnegated(STAYS_STATE, clause);
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
  if (matchesUnnegated(RENAMED_WORKOUT, clause) && !isQuestion(sentence) && !OFFER_TAIL.test(sentence)) return true;
  if (presentStateClaim(clause, sentence)) return true;
  if (painHoldClaim(clause, sentence)) return true;
  if (structuralStateClaim(clause, sentence)) return true;
  if (futureStateClaim(clause, sentence)) return true;
  if (PHRASES.some((re) => matchesUnnegated(re, clause))) {
    if (/\b(?:try|consider|maybe|suggest|recommend|would|could|should|might)\b/.test(clause) && /\bfrom now on|going forward\b/.test(clause)) return false;
    if (/\b(?:should|will) (?:now )?(?:show|see|read|display|say|list|be)\b/.test(clause) && (/\b(?:if|when|once|unless)\b/.test(clause) || OFFER_TAIL.test(sentence) || isQuestion(sentence))) return false;
    return true;
  }
  if (verblessClaim(clause, sentence)) return true;
  if (WILL_VALUE.test(clause) && valueSubClauses(clause).some((sub) => matchesUnnegated(WILL_VALUE, sub) && !/\b(?:would|could|should|might|may|if)\b/.test(sub.slice(0, firstValueIndex(sub))))) return true;
  if (r4FormClaim(words, clause, sentence)) return true;
  if (r5FormClaim(words, clause, sentence)) return true;
  return valueStatement(words, clause, sentence);
}

const LOAD_VALUE = /\b\d+(?:\.\d+)? (?:kgs?|lbs?|kilos?|kilograms?|pounds?)\b/;
const TARGET_SCOPE =
  /\b(?:sets? left|left at|to go at|sets? [\d_]+|the rest|your rest|rest of|remaining|(?:the |your )?last (?:two|three|four|\d+|one|set|sets)|final (?:set|two|\d+)|next (?:time|session|week|workout|one|set)|from (?:here|now)|for (?:the |your )?(?:last|remaining|next))\b/;
/** Advice in the imperative ("Aim for 95 kg on the last two") tells Ben what to do; it doesn't claim the app changed. */
const IMPERATIVE_START = new Set([
  'aim', 'try', 'rest', 'keep', 'go', 'take', 'use', 'drop', 'lower', 'start', 'stick', 'hold', 'stay', 'add', 'do', 'hit', 'get',
  'push', 'work', 'focus', 'pick', 'grab', 'load', 'warm', 'finish', 'leave', 'think', 'let',
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
function scrubValues(text: string): string {
  return text.replace(/\b(?:rpe|rir|@) ?\d+(?:\.\d+)?\b/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
}

/** Index of the first value number in `text` (a load or a target number, not a set number), or the length. */
function firstValueIndex(text: string): number {
  const masked = scrubValues(text)
    .replace(/\bsets? [\d_]+\b/g, (m) => ' '.repeat(m.length))
    .replace(/\b(?:last|final|first|next|remaining|other|those|these|both|the|all) \d+\b/g, (m) => ' '.repeat(m.length));
  const m = /\d/.exec(masked);
  return m === null ? text.length : m.index;
}

/** Sub-clauses a veto word can't cross (review r3 B3): "95 kg rather than the 100 you did", "95 for the rest which may feel light". */
function valueSubClauses(clause: string): string[] {
  return clause
    .split(/\s+(?:rather than|other than|than|which|as|so|while|whereas|instead of|compared to|compared with|versus|vs)\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Does this sub-clause state a target value with no veto before the value?
 * Suggestive, unchanged and past words only count before the value; history
 * ("last week") and general facts anywhere in the sub-clause.
 */
function subClauseStatesValue(sub: string): boolean {
  const scrubbed = scrubValues(sub);
  const values = scrubbed.replace(/\bsets? [\d_]+\b/g, ' ').replace(/\b(?:last|final|first|next|remaining|other|those|these|both|the|all) \d+\b/g, ' ');
  if (!/\d/.test(values)) return false;
  if (!LOAD_VALUE.test(scrubbed) && !TARGET_SCOPE.test(scrubbed)) return false;
  const before = sub.slice(0, firstValueIndex(sub));
  const beforeWords = before.split(' ').filter((w) => w.length > 0);
  if (beforeWords.some((w) => SUGGESTIVE.has(w)) || UNCHANGED_OR_PAST.test(before)) return false;
  // "95 on the bar" is a target; "the bar is 20 kg" is a fact.
  const facts = sub.replace(/\b(?:on|onto|off) the bar\b/g, ' ');
  if (HISTORICAL.test(sub) || STATE_FACT_SUBJECT.test(facts) || GENERAL_FACT.test(sub.replace(/\bon the (?:stack|pin)\b/g, ' '))) return false;
  // Ben's own past ("you logged 100 kg × 8") is history, not a change.
  if (/\byou (?:\w+ed|did|hit|lifted|got|went|had|made|ran)\b|\byou have (?:\w+ed|done|hit|lifted|gone|had|made|run)\b/.test(before)) return false;
  return true;
}

function valueStatement(words: readonly string[], clause: string, sentence: string): boolean {
  if (isQuestion(sentence) || OFFER_TAIL.test(sentence)) return false;
  // "Your squat has increased by 10 kg since August": a history phrase split off by "since" still
  // belongs to this clause. One in an earlier clause ("Given last week, you have 95 kg") doesn't.
  const at = sentence.indexOf(clause);
  const after = at >= 0 ? sentence.slice(at + clause.length) : '';
  if (/^\s*(?:since|over the|in the last|ago|from|last|this)\b/.test(after) && HISTORICAL.test(after)) return false;
  if (/\b(?:if|when|once|until|unless|before|after)\b/.test(clause) || /^(?:if|when|once|unless)\b/.test(sentence)) return false;
  const first = words.find((w) => !INTERJECTIONS.has(w)) ?? '';
  if (IMPERATIVE_START.has(first)) return false;
  return valueSubClauses(clause).some(subClauseStatesValue);
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

const NEXT_WORDS = /\b(?:next (?:time|session|workout|week|push|pull|legs|day)|for next|from now on|going forward|in future|future sessions?|next \w+ day|rest of the week|later this week|this week|from (?:tomorrow|next))\b/;
const TODAY_WORDS = /\b(?:today|this session|this workout|remaining|rest of|last two|last 2|sets? \d)/;
const MEMORY_WORDS = /\b(?:remember(?:ed)?|memory|memories|noted|note|(?:keep|bear|hold|carry) (?:that|this|it|those|these) in mind|stored|memori[sz]ed|jotted|got (?:that|it|this) down|on (?:the|my) radar)\b/;
const FORGET_WORDS = /\b(?:forgot|forgotten|forget|forgetting)\b|\blet (?:that|it|this|those) go\b|\b(?:gone from|out of|off|removed from|deleted from) (?:my |the |your )?memor(?:y|ies)\b|\b(?:wiped|erased|cleared|deleted|removed|scrubbed|binned|dropped|ditched)\b.*\b(?:memory|memories|note|notes)\b/;
/** "I won't forget that" is a promise to remember, not a forget. */
const NOT_FORGET = /\b(?:will not|won't|wont|shall not|never|not going to|not gonna) forget\b/;
const PAIN_WORDS = /\b(?:flag(?:ged)?|pain flag|flagging)\b/;
const PLAYBOOK_WORDS = /\bplaybook\b|\brule\b/;
const UNDO_WORDS = /\bback (?:at|on) \d|\bsame as (?:before|it was|they were)\b|^as you were$|\bundo (?:worked|went through|is done|done|complete)\b|\bback to (?:normal|how it was|the original|where it was|the old|what it was)\b|\b(?:undid|undone|undo|undoing|revert(?:ed|ing)?|restor(?:ed|e|ing)|revers(?:ed|e|ing)|rewound|rewind|rolled (?:it |them |that |those |everything )?back|put (?:it |them |that )?back|back to|back (?:how|as|the way) (?:it|they|things) (?:was|were))\b/;
const STRUCT_VERBS = /\b(?:swap(?:ped|ping|s)?|switch(?:ed|ing|es)?|replac(?:ed|es?|ing)|substitut(?:ed|es?|ing)|sub(?:bed|bing|s)?|reorder(?:ed|ing|s)?|rearrang(?:ed|es?|ing)|slot(?:ted|s)?|takes over from|comes in for|stands in for)\b/;
/** "Cable fly is out", "pec deck is in for cable fly": an exercise entering or leaving the plan (CC10). */
const IN_OUT = /\b(?:is|are) (?:now )?(?:out|in)(?: (?:for|of|instead|next|from|today|now)\b|$)/;
const ADD_REMOVE =
  /\b(?:add(?:ed|ing)?|remov(?:ed|e|ing)|dropp(?:ed|ing)|drop|delet(?:ed|e|ing)|cut|scrap(?:ped)?|ditch(?:ed)?|took out|taken out|knocked off|binned|chopped|axed|nixed|culled|canned|dumped|tossed|zapped|retired|scratched|struck|crossed off|is history|are history|is toast|off the (?:list|plan|card|menu)|gets? (?:a|the) (?:rest|break|week off|breather|holiday))\b/;
const LOG_WORDS = /\b(?:logged|log|logging|recorded|entered|tracked)\b/;
const GENERIC_ONLY = /^(?:(?:ok|okay|right|great|sure|alright|cool|perfect|yes|yep|yeah|got it|no problem|and|boom|bang|there|right then|nice|easy)\s*)*(?:handled|all handled|squared away|all squared away|say no more|done and done|done deal|dealt with|actioned|consider it handled|that is handled|it is handled|nailed it|sorted mate|job done|all sorted|(?:all )?fixed(?: up)?|as you wish|your wish is my command|you are sorted|done|all done|all set|sorted|consider it done|will do|on it|i am on it|you got it|can do|coming (?:right )?up|leave it with me|roger(?: that)?|wilco|copy that|consider it noted|(?:all |both |everything is |everything has been |it is |that is |they are )?(?:saved|applied|updated|changed|adjusted|sorted|done)|that is done|it is done|everything is (?:done|updated|set)|taken care of)$/;

function plurals(w: string): string[] {
  if (w.endsWith('y')) return [`${w}s`, `${w}es`, `${w.slice(0, -1)}ies`];
  if (/(?:s|x|ch|sh)$/.test(w)) return [`${w}es`];
  return [`${w}s`];
}

function aliasesOf(name: string): string[] {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
  const full = name.toLowerCase();
  // "OHP" names "Overhead press", "RDL" names "Romanian deadlift" (review r4 B3).
  const abbreviations = Object.entries(EXERCISE_ABBREVIATIONS).flatMap(([canonical, abbrs]) =>
    full.includes(canonical) ? abbrs.map((a) => full.replace(canonical, a)).concat(abbrs.filter((a) => !GENERIC_NAME_WORDS.has(a))) : [],
  );
  return [...new Set([full, ...words, ...words.flatMap(plurals), ...abbreviations])];
}

/** Movement words that, matching no known name, name an exercise outside the session (review r4 B3). */
const UNKNOWN_MOVEMENT_WORDS = new Set(['fly', 'row', 'curl', 'squat', 'deadlift', 'pulldown', 'extension', 'lunge', 'deck', 'thrust', 'shrug', 'pushdown', 'dip']);
/** "All your sets", "every set": a claim about sets the ledger can't confirm (review r4 B3). */
/** The whole session or every exercise (review r5 B1b). */
const ALL_SESSION =
  /\b(?:(?:every|each) (?:single )?|all (?:of )?(?:your |the |today's |todays )?)(?:exercises?|lifts?|movements?)\b|\ball (?:of )?today\b|\b(?:the |your )?(?:whole|entire|full) (?:session|workout|day)\b|\bacross the board\b|\b(?:the )?rest of (?:today|the (?:session|workout|day)|your (?:session|workout|day))\b|\b(?:all|every) (?:of )?(?:your |the )?(?:weights|loads|targets)\b/;
const ALL_SETS = /\b(?:all (?:of )?(?:your |the |my )?sets|every set|each set|all of them|all your (?:sets|work)|every single set)\b/;

/** Does a word of an exercise name match a generic word (after singular and synonyms)? */
function nameHasWord(name: string, word: string): boolean {
  const forms = MENTION_SYNONYMS[word] ?? [word];
  return name.toLowerCase().split(/[^a-z0-9]+/).some((x) => forms.includes(x) || forms.includes(singular(x)));
}

function exerciseMentions(clause: string, names: readonly string[]): Mention[] {
  const byAlias = new Map<string, Set<string>>();
  for (const n of names) {
    for (const a of aliasesOf(n)) {
      const set = byAlias.get(a) ?? new Set<string>();
      set.add(n.toLowerCase());
      byAlias.set(a, set);
    }
  }
  const found: Mention[] = [];
  const sortedAliases = [...byAlias.keys()].sort((a, b) => b.length - a.length);
  let rest = ` ${clause} `;
  for (const a of sortedAliases) {
    const re = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(rest)) {
      found.push({ names: [...(byAlias.get(a) ?? [])], all: false });
      rest = rest.replace(re, ' ');
    }
  }
  // A generic word from a known name still names it (review r2 B1): "Incline is 95". Plural and
  // generic words claim every exercise they could mean (review r3 B3), unless one of those was
  // already named ("bench presses" names bench, not every press).
  // An exercise outside the session ("OHP", "lat pulldown", "leg press") is named as itself, so it
  // can't pass as the changed one (review r4 B3).
  const known = new Set(names.map((n) => n.toLowerCase()));
  for (const common of [...COMMON_EXERCISE_NAMES].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${common.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (!re.test(rest)) continue;
    if (!known.has(common)) found.push({ names: [common], all: false });
    rest = rest.replace(re, ' ');
  }
  const named = new Set(found.flatMap((m) => m.names));
  const raws = rest.split(/[^a-z0-9]+/);
  for (const [i, raw] of raws.entries()) {
    const w = singular(raw);
    if (!MENTION_WORDS.has(w)) continue;
    const matches = names.filter((n) => nameHasWord(n, w)).map((n) => n.toLowerCase());
    if (matches.length === 0) {
      // "in a row" isn't the exercise.
      if (UNKNOWN_MOVEMENT_WORDS.has(w) && !(w === 'row' && raws[i - 1] === 'a')) found.push({ names: [w], all: false });
      continue;
    }
    if (matches.some((n) => named.has(n))) continue;
    found.push({ names: matches, all: true });
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

/** Words just before a number that make it the old value. */
const PREVIOUS_BEFORE = /\b(?:from|not|instead of|rather than|was|were|previously|used to be|down from|up from|off from|over)\s*$/;
/** Words around a number that make it a difference: "took 5 off", "by 5", "5 lighter", "2 more reps". */
const DELTA_BEFORE = /\b(?:by|took|take|taken|taking|knocked|knock|knocking|shaved|shave|dropped|drop|trimmed|added|add|adding|plus|minus|another|extra|an extra|coming|came|went|gone|down|up|off)\s*$/;
const DELTA_AFTER = /^\s*(?:(?:kgs?|lbs?|kilos?|kilograms?|pounds?)\s+)?(?:off|less|lighter|heavier|more|fewer|down|up|on|extra)\b/;

function roleOf(clause: string, index: number, length: number): NumberRole {
  const before = clause.slice(0, index);
  const after = clause.slice(index + length);
  if (PREVIOUS_BEFORE.test(before)) return 'previous';
  if (DELTA_AFTER.test(after) || DELTA_BEFORE.test(before)) return 'delta';
  return 'value';
}

/** "per side", "a side", "each dumbbell", "on the stack", "of assistance": the convention a reply named (review r5 B1a). */
function conventionIn(clause: string): { convention: Claim['convention']; text: string | null } {
  const m = /\b(?:per|a|each|on each|either) side\b|\b(?:per|a|each|in each) (?:hand|arm|dumbbell|db|bell)\b|\bper dumbbell\b|\b(?:on the )?stack\b|\bof (?:assistance|help)\b|\bassist(?:ance|ed)?\b|\b(?:added|extra) (?:weight|load)\b|\bon the belt\b|\bon (?:a|the) (?:dip )?belt\b|\b(?:in )?total\b|\ball in\b/.exec(clause);
  if (m === null) return { convention: null, text: null };
  const w = m[0];
  if (/side/.test(w)) return { convention: 'per_side', text: w };
  if (/hand|arm|dumbbell|db|bell/.test(w)) return { convention: 'per_hand', text: w };
  if (/stack/.test(w)) return { convention: 'stack', text: w };
  if (/assist|help/.test(w)) return { convention: 'assistance', text: w };
  if (/added|extra|belt/.test(w)) return { convention: 'added', text: w };
  return { convention: 'total', text: w };
}

function numbersIn(clause: string): { loads: Claim['loads']; bare: Claim['bareNumbers']; unverifiable: boolean } {
  const loads: Claim['loads'] = [];
  let unverifiable = false;
  // Mask rather than delete, so each number keeps its position for `roleOf`.
  const blank = (m: string): string => ' '.repeat(m.length);
  let rest = clause.replace(/\b(\d+(?:\.\d+)?) (kgs?|kilos?|kilograms?|lbs?|pounds?)\b/g, (m: string, n: string, u: string, at: number) => {
    loads.push({ value: Number(n), unit: u.startsWith('k') ? 'kg' : 'lb', role: roleOf(clause, at, m.length) });
    return blank(m);
  });
  rest = rest.replace(/\b(\d+(?:\.\d+)?) ?(?:%|percent|per cent)/g, (m: string) => {
    unverifiable = true;
    return blank(m);
  });
  rest = rest
    .replace(/\bsets? [\d_]+\b/g, blank)
    .replace(/\b(?:last|final|first|next|remaining|other|those|these|both|the) \d+\b/g, blank)
    .replace(/\b(?:rpe|rir|@) ?\d+(?:\.\d+)?\b/g, blank)
    .replace(/\b\d{1,2}:\d{2}\b/g, blank)
    .replace(/\b(?:set|rep|round) (?:\d+) of (?:\d+)\b/g, blank);
  const bare = [...rest.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => ({ value: Number(m[0]), role: roleOf(clause, m.index, m[0].length) }));
  return { loads, bare, unverifiable };
}

/**
 * workout-builder BD1, BD15, WB28: "I've built you a push workout" is backed
 * only by a committed `build_workout` this turn; "I've saved it to your
 * workouts" or "I've started the workout" by nothing (Ben taps Save and Start).
 */
const BUILT_WORKOUT =
  /\b(?:built|made|created|drafted|designed|put together|written|wrote|set up|planned|prepared|whipped up)(?: you| for you)?(?: (?:a|an|your|the|this|that|today's|you a|you an))?(?: (?:new|quick|short|\d+[- ]?min(?:ute)?s?|push|pull|legs?|upper|lower|full[- ]body|body))* (?:workout|draft)\b/;
const SAVED_WORKOUT =
  /\b(?:saved|stored|added|scheduled|booked|filed|put)(?: it| this| that| the workout| your workout| the draft| this workout)? (?:to|in|into|as|on) (?:your |the )?(?:workouts|library|routines|rotation|calendar|schedule)\b|\b(?:started|kicked off|launched|begun) (?:it|the workout|your workout|this workout|the draft|that workout)\b|\b(?:workout|draft) (?:is|has been|was|got) (?:now )?(?:saved|started|scheduled|booked)\b/;

/**
 * Review S2: "I've renamed the workout to Chest day", "It's now called Chest day": backed only by a
 * committed `rename_workout` the sentence cites.
 */
const RENAMED_WORKOUT =
  /\b(?:re-?named|(?:changed|updated|switched|set) (?:the |its |your |today's )?(?:(?:workout|session)(?:'s| is)? )?name|(?:is|it is|it's|workout is|session is) now (?:called|named)|(?:called|named) it)\b/;

function kindsOf(clause: string, sentence: string): { kinds: Set<ClaimKind>; op: SetOp } {
  if (RENAMED_WORKOUT.test(clause)) return { kinds: new Set<ClaimKind>(['rename_workout']), op: 'change' };
  if (SAVED_WORKOUT.test(clause)) return { kinds: new Set<ClaimKind>(['workout_saved']), op: 'change' };
  if (BUILT_WORKOUT.test(clause)) return { kinds: new Set<ClaimKind>(['build_workout']), op: 'change' };
  const kinds = new Set<ClaimKind>();
  const hasSetWord = /\b(?:sets?|a set|another set|one more set|extra set)\b/.test(clause);
  let op: SetOp = 'change';
  if (GENERIC_ONLY.test(clause)) return { kinds: new Set<ClaimKind>(['any']), op };
  if (PAIN_WORDS.test(clause) || PAIN_HOLD.test(clause) || PAIN_HOLD_SOFT.test(clause)) kinds.add('set_pain_flag');
  if (NOT_FORGET.test(clause)) kinds.add('save_memory');
  else if (FORGET_WORDS.test(clause)) kinds.add('forget_memory');
  else if (MEMORY_WORDS.test(clause)) kinds.add('save_memory');
  if (PLAYBOOK_WORDS.test(clause)) kinds.add('add_playbook_candidate');
  if (UNDO_WORDS.test(clause)) kinds.add('undo');
  // "Next session, bench will be 97.5": the scope may sit in another clause of the sentence.
  const next = NEXT_WORDS.test(clause) || (NEXT_WORDS.test(sentence) && !TODAY_WORDS.test(clause));
  const aboutValues = /\b(?:weight|load|kg|lb|kilos|pounds|reps?|to \d+(?:\.\d+)?)\b/.test(clause);
  // Adding or removing something that isn't a set is an exercise change: structural, never a set target (CC10).
  const structural =
    STRUCT_VERBS.test(clause) ||
    STRUCT_STATE.some((re) => re.test(clause)) ||
    (IN_OUT.test(clause) && !hasSetWord) ||
    (ADD_REMOVE.test(clause) && !hasSetWord && !aboutValues) ||
    (BARE_IN_OUT.test(clause) && !hasSetWord) ||
    (BARE_INSTEAD.test(clause) && !hasSetWord && !aboutValues) ||
    (NO_MORE.test(clause) && !hasSetWord && !aboutValues) ||
    (BARE_FROM_NEXT.test(clause) && NO_MORE.test(sentence)) ||
    STRUCT_R4.some((re) => re.test(clause)) ||
    STRUCT_R5.some((re) => re.test(clause));
  if (structural) kinds.add('propose_next_workout_change');
  // (12 Oct) "Added lateral raises [[a1]]": an exercise added to today's workout is backed by its own record.
  if (structural && !next) kinds.add('add_exercise_today');
  // "Pec deck next time" may be a swap or a target for an exercise already there.
  if (EX_NEXT.test(clause) && !hasSetWord) kinds.add('propose_next_workout_change');
  if (PAIN_HOLD_R4.test(clause) || PAIN_HOLD_EX.test(clause)) kinds.add('set_pain_flag');
  if (MEMORY_R4.test(clause) && !FORGET_WORDS.test(clause)) kinds.add('forget_memory');
  if (ADD_REMOVE.test(clause) && hasSetWord && !aboutValues) {
    op = /\badd(?:ed|ing)?\b/.test(clause) ? 'add_set' : 'remove_set';
  }
  // "No set 4 today", "Extra set on the end" (review r4 B3).
  if (PAIN_R5.test(clause)) kinds.add('set_pain_flag');
  if (MEMORY_R5.test(clause)) kinds.add('save_memory');
  if (GENERIC_R5.test(clause)) return { kinds: new Set<ClaimKind>(['any']), op };
  if (SET_TYPE.test(clause) || SET_TYPE_R5.test(clause)) op = 'set_type';
  else if (REMOVE_R5.test(clause)) op = 'remove_set';
  else if (ADD_R5.test(clause)) op = 'add_set';
  else if (NO_SET.test(clause)) op = 'remove_set';
  else if (EXTRA_SET.test(clause)) op = 'add_set';
  if (/\bpain\b/.test(clause) && (MEMORY_WORDS.test(clause) || PAIN_WORDS.test(clause))) kinds.add('set_pain_flag');
  if (LOG_WORDS.test(clause) && !MEMORY_WORDS.test(clause)) kinds.add('log_set');
  const meta: readonly ClaimKind[] = ['set_pain_flag', 'save_memory', 'forget_memory', 'add_playbook_candidate', 'log_set'];
  const onlyMeta = kinds.size > 0 && [...kinds].every((k) => meta.includes(k));
  if (!onlyMeta && !structural) kinds.add(next ? 'set_next_session_targets' : 'adjust_pending_sets');
  return { kinds, op };
}

function parseClaim(clause: string, sentence: string, names: readonly string[], structuralLine = false): Claim {
  const { kinds, op } = structuralLine ? { kinds: new Set<ClaimKind>(['propose_next_workout_change']), op: 'change' as const } : kindsOf(clause, sentence);
  const { loads, bare, unverifiable } = numbersIn(clause);
  const { convention, text: conventionText } = conventionIn(clause);
  const allSets =
    (ALL_SETS.test(clause) && !/\b(?:remaining|rest|left|last|other)\b/.test(clause)) ||
    // Review r5 B1b: "Everything's 95 now", "Every exercise is lighter", "Whole session is lighter".
    ALL_SESSION.test(clause) ||
    (/\beverything\b/.test(clause) && /\d|\b(?:lighter|heavier|easier|harder|less|more|down|up)\b/.test(clause));
  return { kinds, op, setNumbers: setNumbersIn(clause), exerciseMentions: exerciseMentions(clause, names), loads, bareNumbers: bare, convention, conventionText, unverifiable, allSets };
}

// ---------------------------------------------------------------------------
// Matching a claim to the ledger

interface RecordFacts {
  names: Set<string>;
  changedSets: Set<number>;
  removedSets: Set<number>;
  addedSets: Set<number>;
  /** Loads as they are now (the `after` side). Review r5 B1a: the old value is never a match. */
  loads: Load[];
  /** Numbers as they are now: after-loads, after-reps, set numbers, sets after. */
  numbers: Set<string>;
  /** Values that were replaced (the `before` side): only match a number said as the old one ("from 100", "not 100"). */
  previous: Set<string>;
  /** Differences between before and after ("took 5 off", "2 more reps"): only match a number said as a change. */
  deltas: Set<string>;
  primaryLoad: Load | null;
}

function addAfter(f: RecordFacts, t: CoachTarget | null): void {
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

function addBefore(f: RecordFacts, before: CoachTarget | null, after: CoachTarget | null): void {
  if (before === null) return;
  if (before.load !== null) {
    f.previous.add(formatNumber(before.load.value));
    if (after?.load && after.load.unit === before.load.unit) f.deltas.add(formatNumber(Math.abs(after.load.value - before.load.value)));
  }
  if (before.reps !== null) {
    f.previous.add(String(before.reps.min));
    f.previous.add(String(before.reps.max));
    if (after?.reps) {
      f.deltas.add(String(Math.abs(after.reps.min - before.reps.min)));
      f.deltas.add(String(Math.abs(after.reps.max - before.reps.max)));
    }
  }
}

function factsOf(record: ActionRecord): RecordFacts {
  const f: RecordFacts = {
    names: new Set(),
    changedSets: new Set(),
    removedSets: new Set(),
    addedSets: new Set(),
    loads: [],
    numbers: new Set(),
    previous: new Set(),
    deltas: new Set(),
    primaryLoad: null,
  };
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
          addAfter(f, c.after);
          addBefore(f, c.before, c.after);
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
          // `after` is the value the undo restored, so it is what's on the card now.
          addAfter(f, c.after);
          addBefore(f, c.before, c.after);
          if (f.primaryLoad === null && c.after?.load) f.primaryLoad = c.after.load;
        }
      }
      break;
    case 'set_next_session_targets':
      for (const r of d.rows) {
        if (record.status === 'committed' && r.size !== 'small') continue;
        f.names.add(r.exerciseName.toLowerCase());
        addAfter(f, r.after);
        addBefore(f, r.before, r.after);
        if (r.setsAfter !== null) f.numbers.add(String(r.setsAfter));
        if (r.setsBefore !== null) {
          f.previous.add(String(r.setsBefore));
          if (r.setsAfter !== null) f.deltas.add(String(Math.abs(r.setsAfter - r.setsBefore)));
        }
        if (f.primaryLoad === null && r.after.load) f.primaryLoad = r.after.load;
      }
      break;
    case 'set_pain_flag':
      for (const n of d.exerciseNames) f.names.add(n.toLowerCase());
      break;
    case 'log_set':
    case 'correct_set': {
      // A logged set's actual values, as targets for the number check (11 Oct, coach tools).
      const asTarget = (v: { load: CoachTarget['load']; reps: number | null }): CoachTarget => ({ load: v.load, reps: v.reps === null ? null : { min: v.reps, max: v.reps } });
      const after = d.kind === 'log_set' ? d.values : d.after;
      f.names.add(d.exerciseName.toLowerCase());
      f.numbers.add(String(d.setNumber));
      f.changedSets.add(d.setNumber);
      addAfter(f, asTarget(after));
      if (after.rpe !== null) f.numbers.add(formatNumber(after.rpe));
      if (d.kind === 'correct_set') addBefore(f, asTarget(d.before), asTarget(d.after));
      if (after.load !== null) f.primaryLoad = after.load;
      break;
    }
    case 'add_exercise_today':
      // (12 Oct) The added exercise, its set count and its first set's target as saved.
      f.names.add(d.exerciseName.toLowerCase());
      f.numbers.add(String(d.sets));
      addAfter(f, d.target);
      if (d.target?.rpe != null) f.numbers.add(formatNumber(d.target.rpe));
      if (d.durationS !== null) f.numbers.add(String(d.durationS));
      if (d.target?.load) f.primaryLoad = d.target.load;
      break;
    case 'rename_workout':
    case 'propose_next_workout_change':
    case 'update_routine':
    case 'fit_today':
    case 'build_workout':
    case 'build_question':
    case 'save_memory':
    case 'suggest_memory':
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
  // Review r5 B1: an undo said with no value ("Rolled back", "As you were") is backed only by a saved
  // undo, never by the change it claims to have undone (still live when the undo went stale). With a
  // value ("Bench is back to 95", "Back at 100") the value is checked against what the card shows now.
  if (claim.kinds.has('undo') && record.detail.kind !== 'undo' && claim.loads.length === 0 && claim.bareNumbers.length === 0) return false;
  return claim.kinds.has('any') || claim.kinds.has(record.detail.kind);
}

type EntityResult = { ok: true } | { ok: false; detail: string };

function entitiesMatch(claim: Claim, record: ActionRecord, f: RecordFacts): EntityResult {
  for (const mention of claim.exerciseMentions) {
    const covered = mention.all ? mention.names.every((n) => f.names.has(n)) : mention.names.some((n) => f.names.has(n));
    if (f.names.size > 0 && !covered) {
      const missing = mention.names.find((n) => !f.names.has(n)) ?? mention.names[0] ?? 'another exercise';
      return { ok: false, detail: `It named ${missing}; only ${[...f.names].join(', ')} changed.` };
    }
    if (f.names.size === 0 && record.detail.kind !== 'save_memory' && record.detail.kind !== 'forget_memory' && record.detail.kind !== 'add_playbook_candidate') {
      return { ok: false, detail: `It named ${mention.names[0] ?? 'an exercise'}; that wasn't changed.` };
    }
  }
  if (record.detail.kind === 'adjust_pending_sets' || record.detail.kind === 'undo') {
    if (claim.allSets) {
      const changed = [...f.changedSets, ...f.removedSets, ...f.addedSets];
      return { ok: false, detail: `It said every set; only ${setNumbersText(changed)} changed.` };
    }
    const pool = claim.op === 'remove_set' ? f.removedSets : claim.op === 'add_set' ? f.addedSets : record.detail.kind === 'undo' ? f.changedSets : new Set([...f.changedSets, ...f.addedSets]);
    if (claim.op === 'set_type') return { ok: false, detail: "It said a set's type changed; set types can't be changed by the coach." };
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

function conventionWord(c: Load['convention']): string {
  switch (c) {
    case 'per_hand':
      return 'per dumbbell';
    case 'stack':
      return 'on the stack';
    case 'assistance':
      return 'of assistance';
    case 'added':
      return 'added';
    case 'total':
      return 'total';
    case 'bodyweight':
      return 'bodyweight';
  }
}

function numbersMatch(claim: Claim, f: RecordFacts): { ok: true } | { ok: false; detail: string } {
  const said = (n: number, unit?: string): string => `${formatNumber(n)}${unit ? ` ${unit}` : ''}`;
  const saved = f.primaryLoad ? `${formatNumber(f.primaryLoad.value)} ${f.primaryLoad.unit}` : 'different';
  /** A number said as the old value or as a difference may match those; anything else must be the value now (review r5 B1a). */
  const fits = (n: number, role: NumberRole): boolean => {
    const k = formatNumber(n);
    if (f.numbers.has(k)) return role !== 'previous' || f.previous.has(k);
    if (role === 'previous') return f.previous.has(k);
    if (role === 'delta') return f.deltas.has(k);
    return false;
  };
  for (const l of claim.loads) {
    const unitOk = f.loads.some((x) => x.unit === l.unit) || (f.loads.length === 0 && l.role !== 'value');
    if (!unitOk || !fits(l.value, l.role)) {
      return { ok: false, detail: `The saved load is ${saved}; the reply said ${said(l.value, l.unit)}.` };
    }
  }
  for (const n of claim.bareNumbers) {
    if (!fits(n.value, n.role)) return { ok: false, detail: `The saved values don't include ${said(n.value)}, which the reply said.` };
  }
  // Review r5 B1a: "95 per side" when 95 kg is the total tells Ben to load the wrong bar.
  if (claim.convention !== null && f.primaryLoad !== null && claim.convention !== f.primaryLoad.convention) {
    return { ok: false, detail: `The saved load is ${saved} ${conventionWord(f.primaryLoad.convention)}; the reply said ${claim.conventionText ?? 'a different convention'}.` };
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

/** "Next Push A: pec deck, not cable fly." (not "Cue: chest up, not out", not a question). */
/** "Next time: pec deck." A next-session label and an exercise (CC10, review r4 B3). */
const NEXT_COLON = new RegExp(`^(?:your )?(?:next (?:time|session|week|workout|push(?: [a-z])?|pull(?: [a-z])?|legs(?: [a-z])?)|from next (?:time|session|week)) ?: ?(?:[a-z]+ )?${EX}(?: [a-z]+)?$`);

function structuralLine(normalised: string): boolean {
  if (isQuestion(normalised) || /\d/.test(normalised)) return false;
  if (NEXT_COLON.test(normalised.replace(/[.!]+$/, ''))) return true;
  const m = STRUCT_LINE.exec(normalised.replace(/[.!]+$/, ''));
  if (m === null) return false;
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
  // "Next Push A: pec deck, not cable fly." A structural plan line (CC10, review r3 B3).
  if (structuralLine(normalised)) {
    const result = checkClaim(parseClaim(normalised.replace(/[.?!]+$/, ''), normalised, names, true), ledger, citedActionIds);
    return result.keep ? { keep: true, claim: true, matchedActionIds: result.matchedActionIds } : result;
  }
  // Review r5 B1: "Bench is still 100" after bench was lowered this turn contradicts the card.
  const contradiction = contradictsLiveChange(normalised, ledger, names);
  if (contradiction !== null) {
    const live = ledger.entries.find((e) => e.origin === 'this_turn' && liveCommitted(e) && (e.record.detail.kind === 'adjust_pending_sets' || e.record.detail.kind === 'set_next_session_targets'));
    return { keep: false, reason: 'numbers_differ', detail: contradiction, replaceWith: live?.record.actionId ?? null };
  }
  // "Sets 3 and 4: 95 kg." states targets in the app's own format: treated as a claim about those sets.
  const listed = SET_VALUE_LINE.test(normalised) || exerciseValueLine(normalised);
  for (const clause of clausesOf(normalised)) {
    const words = clause.split(' ').filter((w) => w.length > 0);
    const isListLine = listed && (SET_LABEL.test(clause) || clause === EXERCISE_VALUE_LINE.exec(normalised)?.[1]?.trim());
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

/**
 * "Bench is still 100", "Sets 3 and 4 are unchanged", "I've left sets 3 and 4
 * alone": a statement that something did NOT change. Kept when nothing about
 * it changed; hidden when the live ledger changed that set or exercise this
 * turn (review r5 B1), since it contradicts the card.
 */
const UNCHANGED_CLAIM =
  /\b(?:still|unchanged|untouched|as planned|as they were|as it was|same as before|stays?|staying|remains?|left (?:[a-z_0-9 ]{1,30} )?(?:alone|as (?:is|they were|it was))|(?:have |has )?not (?:changed|touched)|(?:haven't|hasn't|didn't|did not) (?:change|touch))\b/;

function contradictsLiveChange(normalised: string, ledger: TurnLedger, names: readonly string[]): string | null {
  if (isQuestion(normalised) || OFFER_TAIL.test(normalised) || /\b(?:if|unless|would|could|should|might|may)\b/.test(normalised)) return null;
  for (const clause of clausesOf(normalised)) {
    if (!UNCHANGED_CLAIM.test(clause) || HISTORICAL.test(clause)) continue;
    const sets = setNumbersIn(clause);
    const mentions = exerciseMentions(clause, names);
    for (const e of ledger.entries) {
      if (e.origin !== 'this_turn' || !liveCommitted(e)) continue;
      const kind = e.record.detail.kind;
      if (kind !== 'adjust_pending_sets' && kind !== 'set_next_session_targets') continue;
      const nextScope = NEXT_WORDS.test(clause);
      if ((kind === 'set_next_session_targets') !== nextScope) continue;
      const f = factsOf(e.record);
      const changed = new Set([...f.changedSets, ...f.removedSets, ...f.addedSets]);
      const setHit = sets.some((n) => changed.has(n));
      const nameHit = mentions.some((m) => m.names.some((n) => f.names.has(n)));
      if (setHit || (nameHit && sets.length === 0)) return `It said that was unchanged; the saved change is shown instead.`;
    }
  }
  return null;
}

/** Exposed for the corpus test's report: does this sentence read as a claim at all? */
export function isChangeClaim(sentence: string): boolean {
  const normalised = normaliseForClaims(sentence);
  if (SET_VALUE_LINE.test(normalised) || exerciseValueLine(normalised) || structuralLine(normalised)) return true;
  return clausesOf(normalised).some((c) => hasClaimTrigger(c.split(' ').filter((w) => w.length > 0), c, normalised));
}
