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
 *   lunges". A "remember when …?" question is not a request.
 *
 * Which kinds open which tools is `REQUEST_KINDS_BY_TOOL` in `registry.ts`.
 *
 * A bare "yes" / "do it" is not classified here: accepting a coach offer is
 * the `acceptedOffer` gate, set by the turn engine only when the previous
 * coach message was that offer.
 */

export type BenChip = 'too_hard' | 'too_easy' | 'pain' | 'lighter_session';

export type BenRequestKind = 'change' | 'difficulty' | 'structural' | 'memory';

export type BenRequest = { source: 'chip'; chip: BenChip } | { source: 'words'; kinds: readonly BenRequestKind[] };

/** Verbs that are directives on their own at the start of a clause ("drop the weight", "lower it"). */
const STRONG_VERBS =
  'drop|lower|reduce|decrease|cut|raise|increase|bump|add|remove|delete|change|adjust|knock|skip|scrap|ditch|lighten|ease|swap|switch|replace|sub|substitute|reschedule|deload|scale|trim|shave|halve|update';
/** A linking verb right after the "verb" means it was a noun: "set 3 was fine", "drop sets are fun". */
const LINKING = "(?:was|is|are|were|felt|feels|feel|looks|look|looked|seems|seem|seemed|went|goes|sounds|sound|'s)";
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
const POLITE = /^(?:(?:please|pls|just|ok|okay|right|so|and|then|also|maybe|actually|yeah|yes|cool|fine|sure|alright),? )*/;
const STRONG = new RegExp(`^(?:${STRONG_VERBS})\\b`);
/** "can you …", "could we …", "let's …", "I want you to …": the rest of the clause must be a directive. */
const ASK_PREFIX = /^(?:.*?\b)?(?:(?:can|could|would|will) (?:you|we) (?:please |just )?|let'?s |i (?:want|need|would like|'d like|wanna) (?:you to |to )|go ahead and )(.*)$/;
/** "I want it lighter", "I'd like the last set at 95", "I want another set". */
const WANT_OBJECT = new RegExp(
  `\\bi (?:want|need|would like|'d like|wanna) (?:(?:some |a few |a couple )?(?:more|less|fewer|another|extra) |(?:it|them|that|this|the|a|an|some|sets?|my|everything|the rest)\\b.*\\b(?:${VALUE_WORDS}|at \\d))`,
);
const DIFFICULTY = /\b(?:too (?:heavy|hard|easy|light|much)|way too|that was a grind|(?:it|that|this|set \d+) (?:was|is|felt|feels) (?:a )?(?:grind|brutal|really hard|too)\b|couldn'?t (?:finish|get|hit|do)|failed (?:the|my|that|it|a) |missed (?:reps|the reps|a rep)|easy,? what next)/;
/** Variety or swap. A number after "swap/switch/replace" is a load change, not a swap ("switch to 95"). */
const STRUCTURAL =
  /\b(?:(?:swap|switch|replace|substitute|sub out)\b(?! (?:to |it to |them to |that to |back to )?\d)|something (?:else|different) (?:for|instead)|mix (?:it|things) up|some variety|more variety|bored (?:of|with)|change (?:the|my) (?:routine|split|programme|program|exercises?|order)|different exercise|instead of (?!\d))/;
/** Ben wants something remembered or forgotten. "Remember when …?" is a question, not a request. */
const MEMORY =
  /^(?:please )?(?:remember (?!(?:when|what|how|if|which|who|where|the time|last)\b)|note (?:that|down|this)\b|forget (?:that|about|what i said|my|the) \w|don'?t forget (?!to (?:breathe|brace|rest)\b))|\b(?:can you|could you|please) (?:remember (?!(?:when|what|how|if)\b)|note|forget)\b/;
/** A question asking for the coach's view, not for a change: "should I…", "why is…", "what do you think". */
const ADVICE_QUESTION = /^(?:why|what|how|when|where|which|who|is|are|was|were|do(?! \d)|does|did|should|shall i|am i|have i|has)\b/;
const NEGATORS = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|isn'?t|wasn'?t|aren'?t|won'?t|wouldn'?t|shouldn'?t|without|dont|doesnt|didnt|isnt|wasnt|arent|wont)\b/;
/** How many words back a negator cancels a structural phrase: "I'm not bored of", "don't change my routine". */
const NEGATION_WINDOW = 3;

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[.!?;\n]+|,\s*|\s+(?:and|but|so|then)\s+(?=(?:please |can |could |just )?(?:[a-z]+)\b)/)
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c.length > 0);
}

/** An imperative at the start of the clause, with an object or value for the noun-like verbs. */
function isDirective(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (c.length === 0 || ADVICE_QUESTION.test(c)) return false;
  // "set 3 was fine", "drop sets are fun", "up next is squat", "plan looks good".
  if (new RegExp(`^\\w+(?: \\w+){0,2} ${LINKING}\\b`).test(c) && !/\b(?:to|at) \d/.test(c)) return false;
  if (STRONG.test(c)) return true;
  return WEAK_DIRECTIVES.some((re) => re.test(c));
}

function isAsking(clause: string): boolean {
  const m = ASK_PREFIX.exec(clause);
  if (m !== null && isDirective(m[1] ?? '')) return true;
  if (/\bgo ahead\b/.test(clause) && !clause.endsWith('?')) return true;
  return WANT_OBJECT.test(clause);
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
  const whole = text.toLowerCase().replace(/[‘’]/g, "'").trim();
  const clauses = normalise(text);
  const kinds: BenRequestKind[] = [];
  if (clauses.some((c) => MEMORY.test(c))) kinds.push('memory');
  const askingClauses = clauses.filter((c) => isDirective(c) || isAsking(c));
  const structural =
    !/^(?:why|should i)\b/.test(whole) &&
    clauses.some((c) => structuralIn(c) && (askingClauses.includes(c) || /\b(?:bored|variety|mix (?:it|things) up)\b/.test(c)));
  if (structural) kinds.push('structural');
  // A clause that is only a swap ("swap cable fly") isn't also a load change.
  if (askingClauses.some((c) => !structuralIn(c) && !STRUCTURAL.test(c))) kinds.push('change');
  // "Is 95 too light?" asks for a view; "too easy, what next?" reports how it went.
  if (DIFFICULTY.test(whole) && !ADVICE_QUESTION.test(clauses[0] ?? '')) kinds.push('difficulty');
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
