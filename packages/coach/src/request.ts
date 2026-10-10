/**
 * `classifyBenRequest`: does Ben's own message ask the coach to change
 * something, and what kind of change? This is the `ben_request` test of the
 * turn gate (coach-contract §6.1, "The ben_request test is code, not the
 * model's say-so"; review S3, r2 B2). Pure and deterministic, so it works
 * offline and can't be talked into firing by tool output, imported notes or
 * the context block: callers pass only Ben's typed or spoken words, or his
 * chip tap.
 *
 * "Ben sent a message" is not a request. A plain question ("why is set 3 at
 * 100?", "should I drop the weight?") or a remark ("set 2 felt good", "plan
 * looks good") gets the read tools only; the coach answers and may offer
 * ("Want me to adjust?"), and nothing applies until Ben asks or taps `Adjust`
 * (CLAUDE.md rule 3).
 *
 * Kinds (a message can carry more than one: "swap cable fly next time and
 * drop bench to 95" is structural and change):
 * - `change`: a directive with a target: "drop the weight for the last two",
 *   "please lower it", "can you take 5 kg off?", "I want it lighter", "let's
 *   go 95", "set 3 to 95". Verbs that are also nouns or fillers ("set",
 *   "up", "make", "go", "take", "use", "plan", "put", "give") only count with
 *   an object or a value after them, and never when a linking verb follows
 *   ("set 3 was fine", "up next is squat", "plan looks good").
 * - `difficulty`: a report the spec lists as Path A (coach-adjustments §4.1):
 *   "too heavy", "too easy, what next?", "that was a grind".
 * - `structural`: a variety or swap request (CC10): "swap cable fly", "mix it
 *   up", "I'm bored of incline press". A negator just before it cancels it
 *   ("I'm not bored of incline press", "don't change my routine").
 * - `memory`: "remember that I train before work", "forget that I hate
 *   lunges". A "remember when …?" or "remember that time …?" question is
 *   not a request (review r3 S1).
 * - `playbook`: Ben asks for a general training rule ("add a rule: …", "as a
 *   general rule, …", "put that in the playbook"). Only this kind opens
 *   `add_playbook_candidate`, so a personal memory request can't reach the
 *   playbook queue (CLAUDE.md rule 10, review r3 S1).
 *
 * Questions asking for the coach's view are never requests (review r3 B1): a
 * clause that starts with a wh-word ("why would you lower sets 3 and 4?",
 * "what would you change?"), or asks "would you … if …" ("would you lower it
 * if you were me?"). "Can you / could we / let's / I want you to" only count
 * at the start of the clause. "Change nothing", a bare verb ("Update: my
 * shoulder feels fine"), a noun with `'s` ("Lower back's a bit tight") and a
 * want with no training object ("I need more sleep") are not requests. When
 * unsure the answer is "not a request": the coach can still offer, and Ben
 * accepts with a tap (rule 3).
 *
 * Which kinds open which tools is `REQUEST_KINDS_BY_TOOL` in `registry.ts`.
 *
 * A bare "yes" / "do it" is not classified here: accepting a coach offer is
 * the `acceptedOffer` gate, set by the turn engine only when the previous
 * coach message was that offer.
 */

export type BenChip = 'too_hard' | 'too_easy' | 'pain' | 'lighter_session';

export type BenRequestKind = 'change' | 'difficulty' | 'structural' | 'memory' | 'playbook';

export type BenRequest = { source: 'chip'; chip: BenChip } | { source: 'words'; kinds: readonly BenRequestKind[] };

/** Verbs that are directives on their own at the start of a clause ("drop the weight", "lower it"). */
const STRONG_VERBS =
  'drop|lower|reduce|decrease|cut|raise|increase|bump|add|remove|delete|change|adjust|knock|skip|scrap|ditch|lighten|ease|swap|switch|replace|sub|substitute|reschedule|deload|scale|trim|shave|halve|update';
/** A linking verb right after the "verb" means it was a noun: "set 3 was fine", "drop sets are fun". */
const LINKING =
  '(?:was|is|are|were|felt|feels|feel|looks|look|looked|seems|seem|seemed|went|goes|sounds|sound|says|said|shows|showed|reads|has|had|does|did|keeps|kept|got|gets|getting|going|been)';
/** Objects that make a STRONG verb a non-request: "change nothing", "add me as a friend" (unless a value follows: "drop me to 95"). */
const NON_OBJECT = /^\w+ (?:nothing|anything|none|no|nada)\b/;
const PERSON_OBJECT = /^\w+ (?:me|you|him|her|us|ben|them all)\b/;
/** What Ben may want more or less of in a request: training things, never sleep, coffee, detail or cues. */
const TRAINING_OBJECT =
  '(?:weight|weights|load|loads|sets?|reps?|kgs?|kilos?|lbs?|pounds?|plates?|volume|bench|squat|squats|deadlifts?|press|presses|rows?|curls?|raises?|flyes|flys?|fly|pulldowns?|pull ?ups?|dips?|lunges?|extensions?|on the bar|\\d)';
const VALUE_WORDS = '\\d+|lighter|heavier|easier|harder|less|more|fewer|down|up|another|extra|one more|back to';
/**
 * Verbs that are also nouns or fillers. Each needs an object or a value after
 * it: "set it to 95", "up the weight", "make it lighter", "go 95", "take 5
 * off", "use 95", "put it at 95", "give me 95".
 */
const WEAK_DIRECTIVES: readonly RegExp[] = [
  /^set (?:it|them|that|this|those|these|everything|all|the rest|sets? [\d ,&-]+(?:and \d+ )?|[\d ,&-]+(?:and \d+ )?|[a-z]+(?: [a-z]+)?) (?:to|at) /,
  /^up (?:the|it|them|that|this|my|all|everything|sets?|reps?|weight|load|bench|squat|deadlift)\b/,
  /^make (?:it|them|that|this|those|these|the|my|sets?|everything|all)\b/,
  new RegExp(`^(?:go|do|try) (?:a bit |a little |slightly |much )?(?:${VALUE_WORDS}|it at \\d|them at \\d|the rest at \\d|with \\d|for \\d)`),
  /^take (?:\d+|it down|them down|a set off|one off|some off|\w+ off|off|out)\b/,
  /^use (?:\d+|the \d+|a lighter|a heavier|lighter|heavier|less|more)\b/,
  /^put (?:it|them|that|this|the rest|sets?|bench|squat|everything)\b.*\b(?:at|to|on|back|down|up)\b/,
  new RegExp(`^give me\\b.*\\b(?:${VALUE_WORDS})`),
  /^plan (?:me|my|a|an|the|next|tomorrow)\b/,
  /^build (?:me|a|an|my|the)\b/,
  /^double (?:it|them|the|my|sets?)\b/,
  /^correct (?:it|that|this|the|my|sets?)\b/,
  /^fix (?:it|that|this|the|my|sets?)\b/,
  /^move (?!on\b)(?:it|them|the|my|bench|squat|deadlift|\w+ (?:to|first|last|before|after))\b/,
];
const POLITE = /^(?:(?:please|pls|just|ok|okay|right|so|and|then|also|actually|yeah|yes|cool|fine|sure|alright|hey|oh|hmm|um|erm|coach),? )*/;
const STRONG = new RegExp(`^(?:${STRONG_VERBS})\\b`);
/**
 * "can you …", "could we …", "let's …", "I want you to …": anchored at the
 * start of the clause (after polite fillers only), and the rest must be a
 * directive. "Why would you lower it?" doesn't match (review r3 B1).
 */
const ASK_PREFIX = /^(?:(?:can|could|would|will) (?:you|we) (?:please |just |maybe )?|let'?s |let us |i (?:want|need|would like|'d like|wanna) (?:you to |to )|go ahead and )(.*)$/;
/**
 * "I want it lighter", "I'd like the last set at 95", "I want another set",
 * "I need more weight". The thing wanted must be training: "I need more
 * sleep", "I want more cues" are not requests (review r3 B1).
 */
const WANT_OBJECT = new RegExp(
  `^i (?:want|need|would like|'d like|wanna) (?:(?:some |a few |a couple |a bit |a little |one )?(?:more|less|fewer|another|extra) (?:\\w+ )?${TRAINING_OBJECT}\\b|(?:it|them|that|this|those|these|everything|the rest|sets?|reps?|(?:the|my|a|an|some|this|that) (?:\\w+ ){0,2}${TRAINING_OBJECT})\\b.*\\b(?:${VALUE_WORDS}|at \\d))`,
);
const DIFFICULTY = /\b(?:too (?:heavy|hard|easy|light|much(?=$|[,.!?]| weight| load| for (?:me|that|this|today)| on (?:the|that|this|my)| today))|way too|that was a grind|(?:it|that|this|set \d+) (?:was|is|felt|feels) (?:a )?(?:grind|brutal|really hard|too)\b|couldn'?t (?:finish|get|hit|do)|failed (?:the|my|that|it|a) |missed (?:reps|the reps|a rep)|easy,? what next)/;
/** Variety or swap. A number after "swap/switch/replace" is a load change, not a swap ("switch to 95"). */
const STRUCTURAL =
  /\b(?:(?:swap|switch|replace|substitute|sub out)\b(?! (?:to |it to |them to |that to |back to )?\d)|something (?:else|different) (?:for|instead)|mix (?:it|things) up|some variety|more variety|bored (?:of|with)|change (?:the|my) (?:routine|split|programme|program|exercises?|order)|different exercise|instead of (?!\d))/;
/** Ben wants something remembered or forgotten. "Remember when …?" is a question, not a request. */
const MEMORY =
  /^(?:please )?(?:remember (?!(?:when|what|how|if|which|who|where|the time|that time|last|whether)\b)|note (?:that|down|this)\b|forget (?:that|about|what i said|my|the) \w|don'?t forget (?!to (?:breathe|brace|rest)\b))|\b(?:can you|could you|please) (?:remember (?!(?:when|what|how|if)\b)|note|forget)\b/;
/** A question asking for the coach's view, not for a change: "should I…", "why is…", "what do you think". */
const ADVICE_QUESTION =
  /^(?:why|what|whats|what's|how|hows|how's|when|where|which|who|whose|is|are|was|were|do(?! \d)|does|did|should|shall i|shall we|am i|have i|has|any idea|wonder|i wonder|do you think|would it|would that|is it worth)\b/;
/** "Would you lower it if you were me?", "what would you change?": asking for the coach's view (review r3 B1). */
const OPINION_QUESTION = /\bwould (?:you|we|it)\b.*\bif\b|\bwhat would (?:you|we)\b|\bif you were me\b|\bin my (?:shoes|position)\b|\byour (?:view|opinion|take)\b/;
/** Ben asks for a general rule for the playbook (rule 10, review r3 S1). */
const PLAYBOOK =
  /\b(?:add|put|save|make|write|note) (?:(?:a|this|that|it) (?:general )?(?:rule|principle) |(?:that|this|it) (?:in|into|to|as) (?:the |my )?(?:playbook|a (?:general )?rule)|(?:a )?(?:general )?(?:rule|principle) (?:to|in|into) (?:the |my )?playbook)|\bas a (?:general )?rule\b|\b(?:to|in|into) (?:the |my )?playbook\b/;
const NEGATORS = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|isn'?t|wasn'?t|aren'?t|won'?t|wouldn'?t|shouldn'?t|without|dont|doesnt|didnt|isnt|wasnt|arent|wont)\b/;
/** How many words back a negator cancels a structural phrase: "I'm not bored of", "don't change my routine". */
const NEGATION_WINDOW = 3;

interface Clause {
  text: string;
  /** The sentence it came from ended with `?`. */
  question: boolean;
  /** The clause starts its sentence. */
  first: boolean;
}

/** `knee's` → `knee is`, so "Lower back's a bit tight" reads as a remark (review r3 B1). Keeps "let's". */
function expandApostropheS(text: string): string {
  return text.replace(/\b(?!let's\b)([a-z]+)'s\b/g, '$1 is');
}

function normalise(text: string): Clause[] {
  const lowered = expandApostropheS(text.toLowerCase().replace(/[‘’]/g, "'"));
  const out: Clause[] = [];
  for (const m of lowered.matchAll(/[^.!?;\n]+[.!?;\n]*/g)) {
    const sentence = m[0];
    const question = /\?/.test(sentence);
    const parts = sentence
      .replace(/[.!?;\n]+$/, '')
      .split(/:\s*|,\s*|\s+-\s+|\s+(?:and|but|so|then)\s+(?=(?:please |can |could |just )?(?:[a-z]+)\b)/)
      .map((c) => c.replace(/\s+/g, ' ').trim())
      .filter((c) => c.length > 0);
    parts.forEach((p, i) => out.push({ text: p, question, first: i === 0 }));
  }
  return out;
}

/** Asking for the coach's view: a wh-question, "would you … if …", "what would you …" (review r3 B1). */
function isOpinionQuestion(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  return ADVICE_QUESTION.test(c) || OPINION_QUESTION.test(c);
}

/** An imperative at the start of the clause, with an object or value for the noun-like verbs. */
function isDirective(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (c.length === 0 || isOpinionQuestion(c)) return false;
  // "set 3 was fine", "drop sets are fun", "up next is squat", "plan looks good", "scale says 80".
  if (new RegExp(`^\\w+(?: \\w+){0,2} ${LINKING}\\b`).test(c) && !/\b(?:to|at) \d/.test(c)) return false;
  if (STRONG.test(c)) {
    // A bare verb ("Update:", "Remove?") or "change nothing" asks for nothing.
    if (!/^\w+ \S/.test(c) || NON_OBJECT.test(c)) return false;
    // "add me as a friend" isn't a request; "drop me to 95", "bump me up" are.
    if (PERSON_OBJECT.test(c) && !new RegExp(`\\b(?:${VALUE_WORDS}|to \\d|at \\d)\\b`).test(c.replace(/^\w+ \w+/, ''))) return false;
    return true;
  }
  return WEAK_DIRECTIVES.some((re) => re.test(c));
}

/**
 * "can you …", "let's …", "I want …". A bare "go ahead" is not here: it is
 * an acceptance, and only the turn engine's `acceptedOffer` may treat it as
 * one (review r3 B1).
 */
function isAsking(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (isOpinionQuestion(c)) return false;
  const m = ASK_PREFIX.exec(c);
  if (m !== null && isDirective(m[1] ?? '')) return true;
  return WANT_OBJECT.test(c);
}

function negatedBefore(clause: string, index: number): boolean {
  const before = clause.slice(0, index).trim().split(' ').filter((w) => w.length > 0);
  return NEGATORS.test(before.slice(-NEGATION_WINDOW).join(' '));
}

function structuralIn(clause: string): boolean {
  const m = STRUCTURAL.exec(clause);
  return m !== null && !negatedBefore(clause, m.index);
}

/** Classify Ben's own words (typed or spoken). Returns null when they don't ask for a change. */
export function classifyBenRequest(text: string): BenRequest | null {
  const whole = expandApostropheS(text.toLowerCase().replace(/[‘’]/g, "'").trim());
  const all = normalise(text);
  const clauses = all.map((c) => c.text);
  const kinds: BenRequestKind[] = [];
  // "Remember that time I hit 100?" is a question (review r3 S1).
  if (all.some((c) => MEMORY.test(c.text) && !c.question)) kinds.push('memory');
  if (all.some((c) => PLAYBOOK.test(c.text) && !(c.question && isOpinionQuestion(c.text)) && !negatedBefore(c.text, PLAYBOOK.exec(c.text)?.index ?? 0))) kinds.push('playbook');
  // A bare imperative asked as a question ("Drop it?") is asking for a view; "can you drop it?" is a request.
  // A playbook clause ("add this as a general rule") isn't a set change.
  const askingClauses = all.filter((c) => !PLAYBOOK.test(c.text) && ((isDirective(c.text) && !c.question) || isAsking(c.text))).map((c) => c.text);
  const structural =
    !/^(?:why|should i|what|how)\b/.test(whole) &&
    clauses.some((c) => structuralIn(c) && !isOpinionQuestion(c) && (askingClauses.includes(c) || /\b(?:bored|variety|mix (?:it|things) up)\b/.test(c)));
  if (structural) kinds.push('structural');
  // A clause that is only a swap ("swap cable fly") isn't also a load change.
  if (askingClauses.some((c) => !structuralIn(c) && !STRUCTURAL.test(c))) kinds.push('change');
  // "Is 95 too light?" asks for a view; "too easy, what next?" reports how it went.
  if (DIFFICULTY.test(whole) && !isOpinionQuestion(clauses[0] ?? '')) kinds.push('difficulty');
  return kinds.length === 0 ? null : { source: 'words', kinds };
}

/** A chip tap is always Ben's own request for today's sets (CA1). */
export function chipRequest(chip: BenChip): BenRequest {
  return { source: 'chip', chip };
}

/** Does this request include `kind`? A chip counts as `change` only (CA1). */
export function requestHas(r: BenRequest | null, kind: BenRequestKind): boolean {
  if (r === null) return false;
  if (r.source === 'chip') return kind === 'change';
  return r.kinds.includes(kind);
}

/** Structural tools (CC10) need a structural request, not just any request. */
export function isStructuralRequest(r: BenRequest | null): boolean {
  return requestHas(r, 'structural');
}
