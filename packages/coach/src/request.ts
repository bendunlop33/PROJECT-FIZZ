import { EXERCISE_WORD, TRAINING_NOUN } from './vocab';

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
 * Review r4 B1: a change verb only counts with a training object: a set, a
 * load, a value, an exercise or a pronoun ("lower it", "drop the last two",
 * "cut set 4"). "Change the music", "Cut sugar this week", "Delete that last
 * message", "Lower body day tomorrow" and a verb used as a noun ("Increase in
 * pain on set 3", "Update on my shoulder") are not requests. Swap verbs need
 * an exercise too ("Switch to dark mode" isn't structural). A difficulty
 * report counts only as a statement about a set: never negated ("It wasn't
 * too heavy"), never in a question or an `if` clause ("Set 3 was too
 * heavy?"), never with another subject or tail ("Way too early", "Too hard
 * to say", "Couldn't get a bench"). A closing "actually no, leave it"
 * cancels the change kinds before it.
 *
 * Review r4 S1/S2: verbless requests with a value and a scope ("95 for the
 * rest please", "Lighter please", "Sets 3 and 4 at 95", "Heavier next time"),
 * "can I …" + a directive, "bring it down", "another set please", "sick of
 * cable fly" and labelled lines ("Remember: no lunges", "Add a rule: …") are
 * recognised. A labelled line's content is data, not a directive. Reminders
 * ("Remember to bring chalk", "Don't forget to stretch") aren't memories.
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

/** Verbs that are directives at the start of a clause, given a training object ("drop the weight", "lower it"). */
const STRONG_VERBS =
  'drop|lower|reduce|decrease|cut|raise|increase|bump|add|remove|delete|change|adjust|knock|skip|scrap|ditch|lighten|ease|swap|switch|replace|sub|substitute|reschedule|deload|scale|trim|shave|halve|update';
/** A linking verb right after the "verb" means it was a noun: "set 3 was fine", "drop sets are fun". */
const LINKING =
  '(?:was|is|are|were|felt|feels|feel|looks|look|looked|seems|seem|seemed|went|goes|sounds|sound|says|said|shows|showed|reads|has|had|does|did|keeps|kept|got|gets|getting|going|been|reckons|thinks|reckon)';
/** Objects that make a STRONG verb a non-request: "change nothing". */
const NON_OBJECT = /^\w+ (?:nothing|anything|none|no|nada)\b/;
/** "Cut it out", "knock it off": stop, not a set change. */
const IDIOM_OBJECT = /^(?:cut it out|knock it off|scrap that|cut that out|drop it(?: mate)?,? (?:never ?mind|forget it)|raise the bar(?: \w+)?|lower the bar(?: \w+)?|cut to the chase)$/;
const VALUE_WORDS = '\\d+|lighter|heavier|easier|harder|less|more|fewer|down|up|another|extra|one more|back to';
const EX = EXERCISE_WORD;
const NOUN = TRAINING_NOUN;
/** Determiners and set qualifiers that may sit before the object: "the last two", "my remaining sets". */
const DETERMINERS = /^(?:(?:the|my|your|a|an|this|that|these|those|some|all|all of|both|each|every|any|today is|tonight is)\s+)*/;
const QUALIFIERS = /^(?:(?:last|next|final|first|second|third|fourth|fifth|remaining|other|following|top|working|heavy|light|back-?off|whole|rest of the|rest of my)\s+)*/;
/** After a pronoun object, what may follow: "lower it", "drop it to 95", "take them down", "cut that please". */
const PRONOUN_OBJECT = /^(?:it|them|that|this|those|these|everything|all|both|one)(?:$| (?:to|at|by|down|up|off|back|out|for|on|from|a bit|a little|slightly|a touch|a notch|lighter|heavier|easier|harder|please|pls|now|instead|again|\d))/;
/** A particle with nothing but an amount or a scope after it: "drop down a bit", "ease off", "knock 5 off". */
const PARTICLE = new RegExp(
  `^(?:down|up|off|back|out)(?:$| (?:to|by|a bit|a little|slightly|a touch|a notch|a few|some|please|pls|now|\\d|for (?:the (?:rest|last|next|remaining)|sets?|my|the)|on (?:the (?:rest|last|next|remaining)|sets?|${EX}|the ${EX})|(?:the |my )?${NOUN}\\b|(?:the |my )?${EX}\\b))`,
);
const SCOPE =
  '(?:(?:for|on) (?:the rest(?: of (?:it|them|the sets|my sets))?|(?:the |my )?(?:last|final|next|remaining) (?:two|three|four|one|set|sets|\\d)(?: sets)?|(?:the )?remaining(?: sets)?|sets? \\d+(?:(?: ?, ?| and | & |-| to )\\d+)*|both|all of them|(?:the |my )?\\w+ sets?|(?:the |my )?' +
  EX +
  ')|next (?:time|set|session|one|week|workout)|from (?:here|now)(?: on)?|today)';
const AMOUNT = '(?:(?:a bit|a little|slightly|much|a touch|a notch|a tad|way|even) )?(?:lighter|heavier|easier|harder|less weight|more weight|less load|more load|less|more|fewer reps|more reps|\\d+(?:\\.\\d+)?(?: ?(?:kg|kgs|kilos|lb|lbs|pounds))?)';
const SIGN_OFF = '(?: (?:please|pls|thanks|cheers|mate|coach|then|instead))*';
/** "Lighter please", "95 for the rest please", "Heavier next time", "Less weight next set" (review r4 S1). */
const VERBLESS_SCOPED = new RegExp(`^${AMOUNT} ${SCOPE}${SIGN_OFF}$`);
const VERBLESS_PLEASE = new RegExp(`^${AMOUNT}(?: ${SCOPE})?(?: (?:please|pls))${SIGN_OFF}$`);
/** "Sets 3 and 4 at 95", "Last two at 95", "The rest at 92.5 please". */
const SETS_AT = new RegExp(
  `^(?:sets? \\d+(?:(?: ?, ?| and | & |-| to )\\d+)*|(?:the |my )?(?:last|final|remaining|next) (?:two|three|four|one|set|sets|\\d)(?: sets)?|(?:the )?rest|both|all of them) (?:at|to|@) \\d+(?:\\.\\d+)?(?: ?(?:kg|kgs|kilos|lb|lbs|pounds))?${SIGN_OFF}$`,
);
/** "Two more reps on the last set", "One fewer set next time". */
const MORE_REPS = new RegExp(`^(?:one|two|three|a couple|a few|\\d+) (?:more|fewer|less|extra) (?:reps?|sets?)(?: of \\w+(?: \\w+)?)? ${SCOPE}${SIGN_OFF}$`);
/** "Another set please", "Extra set", "An extra set of curls". A bare "One more set" is a countdown, so it needs "please". */
const ANOTHER_SET = new RegExp(`^(?:another|an extra|extra|one extra)(?: \\w+)? set(?: of [a-z ]+| on [a-z ]+| for [a-z ]+)?${SIGN_OFF}$|^one more set(?: of [a-z ]+)? (?:please|pls)${SIGN_OFF}$`);
/**
 * Verbs that are also nouns or fillers. Each needs an object or a value after
 * it: "set it to 95", "up the weight", "make it lighter", "go 95", "take 5
 * off", "use 95", "put it at 95", "give me 95", "bring it down".
 */
const WEAK_DIRECTIVES: readonly RegExp[] = [
  /^set (?:it|them|that|this|those|these|everything|all|the rest|sets? [\d ,&-]+(?:and \d+ )?|[\d ,&-]+(?:and \d+ )?|[a-z]+(?: [a-z]+)?) (?:to|at) \d/,
  new RegExp(`^up (?:it|them|that|this|everything|all)(?:$| (?:to|by|a bit|a little|a notch|\\d))|^up (?:(?:the|my|all|all the) )?(?:(?:last|next|remaining|final) \\w+ |\\w+ )?(?:${NOUN}|${EX})\\b`),
  new RegExp(`^make (?:it|them|that|this|those|these|the [a-z ]+|my [a-z ]+|sets?[^,]*|everything|all)\\b.*\\b(?:${VALUE_WORDS}|lower|higher)\\b`),
  new RegExp(`^(?:go|do|try) (?:a bit |a little |slightly |much )?(?:${VALUE_WORDS}|it at \\d|them at \\d|the rest at \\d|with \\d|for \\d)`),
  /^take (?:\d+|it down|them down|a set off|one off|some off|\w+ off|off|out)\b/,
  /^use (?:\d+|the \d+|a lighter|a heavier|lighter|heavier|less|more)\b/,
  /^put (?:it|them|that|this|the rest|sets?|bench|squat|everything)\b.*\b(?:at|to|on|back|down|up)\b/,
  /^put me (?:down |in )?(?:for|at|on) \d/,
  new RegExp(`^give me\\b.*\\b(?:${VALUE_WORDS})`),
  new RegExp(`^bring (?:it|them|that|this|those|these|everything|all|the rest|(?:the |my )?(?:last|remaining|next) \\w+|(?:the |my )?${NOUN}|(?:the |my )?${EX})\\b.*\\b(?:down|up|back)\\b`),
  /^plan (?:me|my|a|an|the|next|tomorrow)\b/,
  /^build (?:me|a|an|my|the)\b/,
  /^double (?:it|them|the|my|sets?)\b/,
  /^correct (?:it|that|this|the|my|sets?)\b/,
  /^fix (?:it|that|this|the|my|sets?)\b/,
  /^move (?!on\b)(?:it|them|the|my|bench|squat|deadlift|\w+ (?:to|first|last|before|after))\b/,
  VERBLESS_SCOPED,
  VERBLESS_PLEASE,
  SETS_AT,
  MORE_REPS,
  ANOTHER_SET,
];
const POLITE = /^(?:(?:please|pls|just|ok|okay|right|so|and|then|also|actually|yeah|yes|cool|fine|sure|alright|hey|oh|hmm|um|erm|coach),? )*/;
const STRONG = new RegExp(`^(?:${STRONG_VERBS})\\b`);
/**
 * "can you …", "could we …", "can I …", "let's …", "I want you to …":
 * anchored at the start of the clause (after polite fillers only), and the
 * rest must be a directive. "Why would you lower it?" doesn't match (review
 * r3 B1).
 */
const ASK_PREFIX = /^(?:(?:can|could|would|will) (?:you|we) (?:please |just |maybe )?|(?:can|could|may) i (?:please |just )?|let'?s |let us |i (?:want|need|would like|'d like|wanna) (?:you to |to )|go ahead and )(.*)$/;
/**
 * "I want it lighter", "I'd like the last set at 95", "I want another set",
 * "I need more weight". The thing wanted must be training: "I need more
 * sleep", "I want more cues" are not requests (review r3 B1).
 */
const WANT_OBJECT = new RegExp(
  `^i (?:want|need|would like|'d like|wanna) (?:(?:some |a few |a couple |a bit |a little |one )?(?:more|less|fewer|another|extra) (?:\\w+ )?(?:${NOUN}|volume|${EX}|\\d)\\b|(?:it|them|that|this|those|these|everything|the rest|sets?|reps?|(?:the|my|a|an|some|this|that) (?:\\w+ ){0,2}(?:${NOUN}|${EX}))\\b.*\\b(?:${VALUE_WORDS}|at \\d))`,
);
/** Variety or swap. A number after "swap/switch/replace" is a load change, not a swap ("switch to 95"). */
const SWAP_VERB = /\b(?:swap|switch|replace|substitute|sub)(?: (?:out|over|in))?\b/;
const SWAP_OBJECT = new RegExp(
  `^(?:(?:it|them|that|this|those|these|one|things)(?:$| (?:out|for|with|to|up|over|instead|around)\\b)|(?:to |for |with |in |out )?(?:the |my |a |an |some |this |that |these |those |your )*(?:(?:\\w+ ){0,2}${EX}\\b|routine|split|programme|program|plan|order|exercises?|something|anything))`,
);
const VARIETY = /\b(?:something (?:else|different|other than)|mix (?:it|things) up|switch (?:it|things) up|change (?:it|things) up|some variety|more variety|a bit of variety|change (?:the|my) (?:routine|split|programme|program|exercises?|order)|different exercises?|new exercises?)\b/;
const FED_UP = new RegExp(`\\b(?:bored|sick|tired|fed up) (?:of|with) (?:(?:the|my|this|these|those|doing|all|the same|same) )*(?:(?:\\w+ ){0,2}${EX}\\b|routine|split|programme|program|plan|workouts?|sessions?|exercises?|same (?:old )?\\w+|(?:it|this|these|them|that)$)`);
const INSTEAD_OF = new RegExp(`\\binstead of (?:the |my )?(?:\\w+ ){0,2}${EX}\\b`);
/**
 * Ben wants something remembered or forgotten. "Remember when …?" is a
 * question; "Remember to bring chalk" and "Don't forget to stretch" are
 * reminders, not facts about him (review r4 S2).
 */
const MEMORY =
  /^(?:please )?(?:remember (?!(?:when|what|how|if|which|who|where|the time|that time|last|whether|to)\b)|note (?:that|down|this)\b|forget (?:that|about|what i said|my|the) \w|don'?t forget (?!(?:to|the|your)\b))|\b(?:can you|could you|please) (?:remember (?!(?:when|what|how|if|to)\b)|note|forget)\b/;
/** "Remember my belt next time": an item and a time, no fact. */
const REMINDER = /^(?:please )?(?:remember|don'?t forget) (?:my|the|your|to)\b(?!.*\b(?:is|are|was|were|hurts?|gets?|has|have|had|can'?t|cannot|doesn'?t|don'?t|isn'?t|likes?|hates?|prefers?|trains?|works?|always|never)\b)/;
/** A question asking for the coach's view, not for a change: "should I…", "why is…", "what do you think". */
const ADVICE_QUESTION =
  /^(?:why|what|whats|what's|how|hows|how's|when|where|which|who|whose|is|are|was|were|do(?! \d)|does|did|should|shall i|shall we|am i|have i|has|any idea|wonder|i wonder|do you think|would it|would that|is it worth)\b/;
/** "Would you lower it if you were me?", "what would you change?": asking for the coach's view (review r3 B1). */
const OPINION_QUESTION = /\bwould (?:you|we|it)\b.*\bif\b|\bwhat would (?:you|we)\b|\bif you were me\b|\bin my (?:shoes|position)\b|\byour (?:view|opinion|take)\b/;
/** Ben asks for a general rule for the playbook (rule 10, review r3 S1, r4 S2). */
const PLAYBOOK =
  /\b(?:add|put|save|make|write|note) (?:(?:a|this|that|it|another|one more) (?:new )?(?:general )?(?:rule|principle)\b|(?:that|this|it) (?:in|into|to|as) (?:the |my )?(?:playbook|a (?:general )?rule)|(?:a )?(?:general )?(?:rule|principle) (?:to|in|into) (?:the |my )?playbook)|\bas a (?:general )?rule\b|\b(?:to|in|into) (?:the |my )?playbook\b|^(?:new|general) rule\b/;
/** A labelled line: what follows the colon is content, not a directive ("Add a rule: drop the weight when …"). */
const LABEL = /^(?:(?:please|ok|okay|hey|coach),? )*(add (?:a|this|that|another|one more) (?:new )?(?:general )?(?:rule|principle)|(?:new|general) (?:rule|principle)|playbook|for the playbook|remember|note|note to self|memory)\s*:\s*/;
const NEGATORS = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|isn'?t|wasn'?t|aren'?t|weren'?t|won'?t|wouldn'?t|shouldn'?t|hardly|without|dont|doesnt|didnt|isnt|wasnt|arent|werent|wont|aint|ain'?t|nah|nope)\b/;
/** How many words back a negator cancels a structural phrase: "I'm not bored of", "don't change my routine". */
const NEGATION_WINDOW = 3;
/** A closing sentence that takes the request back: "Actually no, leave it", "never mind". */
const RETRACTION =
  /^(?:(?:actually|wait|hmm|oh|on second thought|on second thoughts|scratch that|no|nah|nope|sorry|ignore that)[, ]*)*(?:no|nah|nope|never ?mind|nvm|scratch that|forget (?:it|that)|leave it(?: as (?:it is|is))?|keep it(?: as (?:it is|is))?|cancel (?:it|that)|don'?t bother|ignore (?:that|me)|as you were|it'?s fine|it is fine)$/;

// ---------------------------------------------------------------------------
// Difficulty (coach-adjustments §4.1, review r4 B1)

const DIFF_ADJ = '(?:heavy|hard|easy|light|much)';
const ADVERBS = /^(?:(?:way|far|much|a bit|a little|bit|slightly|a touch|a tad|just|definitely|really|probably|honestly|kinda|kind of|still|a lot|bloody|so|super|wayyy?|actually|too)\s+)*/;
/** Who a difficulty report may be about: the set, the load, the lift. Never "the rest" of the day or the gym. */
const DIFF_SUBJECT = new RegExp(
  `^(?:it|that|this|those|these|they|everything|all|both|that one|this one|the last (?:one|set|two|rep|few)|last (?:one|set|two|rep)|(?:that|this|the|my) (?:set|rep|lift|one|weight|load|bar)|(?:the )?(?:weight|load)|sets? \\d+(?:(?: ?, ?| and | & |-)\\d+)*|(?:the )?\\d+(?:\\.\\d+)?(?: ?(?:kg|kgs|kilos|lb|lbs))?|(?:the |my )?(?:\\w+ )?${EX}|i(?:'m| am|m| was)? (?:find|finding|found) (?:it|that|this|them))(?: (?:today|now|just now))?$`,
);
const DIFF_LINK = /^(?:(?:it|that|this) )?(?:is|was|are|were|felt|feels|feel|feeling|seemed|seems|went|got|getting|has been|had been|is getting|was getting|is feeling|was feeling|is way|felt way|looked|looks|moved|moving)$/;
const LIFT_VERB = '(?:finish|lock (?:it )?out|complete|get|hit|do|move|press|squat|pull|control|keep|grind)';
const DIFF_TAIL = new RegExp(
  `^(?:$| (?:for me|for that|for this|for today|today|now|tbh|honestly|mate|again|still|lol|haha|though|there|by far|to ${LIFT_VERB}\\b.*|(?:of )?(?:a )?(?:weight|load)|on (?:that|this|the|my|set|sets|bench|squat)\\b.*|for (?:set|sets|the last|the rest)\\b.*|at (?:\\d|the end)\\b.*|(?:from|after|by) (?:set|rep) \\d.*)+$)`,
);
const GRIND_WORDS = '(?:(?:a )?(?:real |total |proper |bit of a |massive |serious |right )?(?:grind|struggle|battle|slog|killer|nightmare)|brutal|savage|really hard|so hard|very hard|super hard|brutally hard|really tough|so tough|really heavy|so heavy|super heavy)';
const GRIND = new RegExp(`^(?:(.+?) )?${GRIND_WORDS}(.*)$`);
const SET_OBJECT = '(?:(?:the|my|that|this|all|all the|the last|my last|a|an|one|two|three|a couple of|some|\\d+) )*(?:set|sets|rep|reps|lift|lockout|depth|last one|last rep|last two|\\d+)\\b';
const FAILED = new RegExp(
  `^(?:i |just |i just )?(?:(?:couldn'?t|could not|didn'?t|did not|failed to) (?:${LIFT_VERB}|make|grind out)(?:$| ${SET_OBJECT}| (?:at|on) (?:rep|set) \\d)|(?:couldn'?t|could not|didn'?t|did not) (?:finish|get|grind out) (?:it|them)(?: (?:up|out))?$|failed (?:on |at )?${SET_OBJECT}|failed$|missed ${SET_OBJECT}|missed (?:a |the |one |two |\\d+ )?reps?\\b|bailed (?:on )?${SET_OBJECT})`,
);

const TRAILING_ADVERB = /(?:^|\s+)(?:way|far|much|a bit|a little|bit|slightly|a touch|a tad|just|definitely|really|probably|honestly|kinda|kind of|still|a lot|bloody|so|super)$/;

function stripTrailingAdverbs(head: string): string {
  let h = head;
  while (TRAILING_ADVERB.test(h)) h = h.replace(TRAILING_ADVERB, '');
  return h.trim();
}

/** "too heavy", "way too heavy", "set 3 was too heavy", "that's too much": a report about a set. */
function tooReport(c: string): boolean {
  const re = new RegExp(`\\btoo ${DIFF_ADJ}\\b`, 'g');
  for (const m of c.matchAll(re)) {
    const tail = c.slice(m.index + m[0].length);
    if (!DIFF_TAIL.test(tail)) continue;
    // "too much" needs a training sense: end of clause, "for me", "on the last set", "weight".
    let head = c.slice(0, m.index).trim();
    if (NEGATORS.test(head)) continue;
    head = stripTrailingAdverbs(`${head} `.replace(ADVERBS, '').trim());
    if (head === '' || DIFF_LINK.test(head)) return true;
    // Subject + linking verb: "set 3 was", "bench felt way", "i am finding it".
    const words = head.split(' ');
    for (let cut = words.length; cut >= 1; cut -= 1) {
      const subj = words.slice(0, cut).join(' ');
      const rest = stripTrailingAdverbs(words.slice(cut).join(' '));
      if (DIFF_SUBJECT.test(subj) && (rest === '' || DIFF_LINK.test(rest))) return true;
    }
  }
  return false;
}

/** "that was a grind", "set 3 was brutal", "a real grind". */
function grindReport(c: string): boolean {
  const m = GRIND.exec(c);
  if (m === null) return false;
  const head = stripTrailingAdverbs(`${(m[1] ?? '').trim()} `.replace(ADVERBS, '').trim());
  const tail = m[2] ?? '';
  if (NEGATORS.test(head) || !DIFF_TAIL.test(tail)) return false;
  if (head === '' || DIFF_LINK.test(head)) return true;
  const words = head.split(' ');
  for (let cut = words.length; cut >= 1; cut -= 1) {
    const subj = words.slice(0, cut).join(' ');
    const rest = words.slice(cut).join(' ');
    if (DIFF_SUBJECT.test(subj) && (rest === '' || DIFF_LINK.test(rest))) return true;
  }
  return false;
}

/** A difficulty report in this clause: a statement about a set, not a question, an `if` or a remark. */
function difficultyIn(clause: Clause): boolean {
  const c = clause.text.replace(POLITE, '');
  if (c.length === 0 || clause.endsQuestion || isOpinionQuestion(c)) return false;
  if (/\b(?:if|unless|whether|in case|when|whenever|once|might|may|could be|would be)\b/.test(c)) return false;
  return tooReport(c) || grindReport(c) || FAILED.test(c);
}

// ---------------------------------------------------------------------------

interface Clause {
  text: string;
  /** The sentence it came from ended with `?`. */
  question: boolean;
  /** The clause is the last one of a sentence ending with `?` ("too easy, what next?" → only "what next" is). */
  endsQuestion: boolean;
  /** The clause starts its sentence. */
  first: boolean;
  /** The sentence starts with "if", "when" or "unless". */
  conditional: boolean;
  /** Content after a label ("Add a rule: …", "Remember: …"): data, never a directive. */
  label: 'playbook' | 'memory' | null;
}

/** `knee's` → `knee is`, so "Lower back's a bit tight" reads as a remark (review r3 B1). Keeps "let's". */
function expandApostropheS(text: string): string {
  return text.replace(/\b(?!let's\b)([a-z]+)'s\b/g, '$1 is');
}

function lower(text: string): string {
  return expandApostropheS(
    text
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\bgimme\b/g, 'give me')
      .replace(/\bwanna\b/g, 'want to')
      .replace(/\blemme\b/g, 'let me'),
  );
}

function sentencesOf(text: string): { sentence: string; question: boolean }[] {
  const out: { sentence: string; question: boolean }[] = [];
  for (const m of lower(text).matchAll(/[^.!?;\n]+[.!?;\n]*/g)) {
    const sentence = m[0];
    out.push({ sentence: sentence.replace(/[.!?;\n]+$/, '').replace(/\s+/g, ' ').trim(), question: /\?/.test(sentence) });
  }
  return out.filter((s) => s.sentence.length > 0);
}

function normalise(text: string): Clause[] {
  const out: Clause[] = [];
  for (const { sentence, question } of sentencesOf(text)) {
    const label = LABEL.exec(sentence);
    if (label !== null) {
      const kind = /rule|principle|playbook/.test(label[1] ?? '') ? 'playbook' : 'memory';
      out.push({ text: sentence.replace(/\s*:\s*/, ' '), question, endsQuestion: question, first: true, label: kind, conditional: false });
      continue;
    }
    const parts = sentence
      .split(/:\s*|,\s*|\s+-\s+|\s+(?:and|but|so|then)\s+(?=(?:please |can |could |just )?(?:[a-z]+)\b)/)
      .map((c) => c.replace(/\s+/g, ' ').trim())
      .filter((c) => c.length > 0);
    const conditional = /^(?:(?:and|so|but|ok|okay) )?(?:if|when|whenever|unless|in case|once)\b/.test(sentence);
    parts.forEach((p, i) => out.push({ text: p, question, endsQuestion: question && i === parts.length - 1, first: i === 0, label: null, conditional }));
  }
  return out;
}

/** Asking for the coach's view: a wh-question, "would you … if …", "what would you …" (review r3 B1). */
function isOpinionQuestion(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  return ADVICE_QUESTION.test(c) || OPINION_QUESTION.test(c);
}

/**
 * Does the text after a strong verb start with a training object (review r4
 * B1)? A pronoun, a value, a particle with an amount, a set, a load word or
 * an exercise. Not "the music", "sugar", "your game" or "that last message".
 */
function hasTrainingObject(rest: string): boolean {
  if (rest === '' || /^(?:in|of|on|for|about|with)\b/.test(rest)) return false;
  if (PRONOUN_OBJECT.test(rest) || PARTICLE.test(rest)) return true;
  if (/^(?:to |by |back to |down to |up to )?\d/.test(rest)) return true;
  if (/^me\b/.test(rest)) return new RegExp(`\\b(?:${VALUE_WORDS}|to \\d|at \\d)\\b`).test(rest.slice(2));
  if (/^(?:a|one|another|an extra|extra|two|three)\s+(?:more\s+)?(?:set|rep|round)s?\b/.test(rest)) return true;
  const r = rest.replace(DETERMINERS, '').replace(QUALIFIERS, '');
  if (/^(?:two|three|four|one|\d+)(?:$| (?:sets?|reps?|to|at|by|for|please|down|off)\b)/.test(r) && r !== rest) return true;
  if (/^rest\b/.test(r)) return !/^rest (?:timer|period|periods|time|times|day|days|break|breaks|between)\b/.test(r);
  if (/^sets? \d/.test(r)) return true;
  return new RegExp(`^(?:\\w+ )?(?:${NOUN}|${EX})\\b`).test(r) && !/^(?:\w+ )?(?:bar|rest) (?:timer|music|app)\b/.test(r);
}

/** An imperative at the start of the clause, with a training object (review r4 B1). */
function isDirective(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (c.length === 0 || isOpinionQuestion(c)) return false;
  // "set 3 was fine", "drop sets are fun", "up next is squat", "plan looks good", "scale says 80".
  if (new RegExp(`^\\w+(?: \\w+){0,2} ${LINKING}\\b`).test(c) && !/\b(?:to|at) \d/.test(c)) return false;
  if (STRONG.test(c)) {
    if (!/^\w+ \S/.test(c) || NON_OBJECT.test(c) || IDIOM_OBJECT.test(c)) return false;
    return hasTrainingObject(c.replace(/^\w+\s*/, ''));
  }
  return WEAK_DIRECTIVES.some((re) => re.test(c));
}

/**
 * "can you …", "can I …", "let's …", "I want …". A bare "go ahead" is not
 * here: it is an acceptance, and only the turn engine's `acceptedOffer` may
 * treat it as one (review r3 B1).
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

/** A swap with an exercise object, or a variety request, not negated (review r4 B1). */
function structuralIn(clause: string): boolean {
  const swap = SWAP_VERB.exec(clause);
  if (swap !== null && !negatedBefore(clause, swap.index)) {
    const rest = clause.slice(swap.index + swap[0].length).trim();
    // "switch to 95" is a load change.
    if (!/^(?:(?:it|them|that|back) )?(?:to |for )?\d/.test(rest) && SWAP_OBJECT.test(rest)) return true;
  }
  for (const re of [VARIETY, FED_UP, INSTEAD_OF]) {
    const m = re.exec(clause);
    if (m !== null && !negatedBefore(clause, m.index)) return true;
  }
  return false;
}

/** Variety on its own ("I'm bored of incline press", "mix it up") is a request; a swap needs to be asked. */
function selfStandingStructural(clause: string): boolean {
  for (const re of [VARIETY, FED_UP]) {
    const m = re.exec(clause);
    if (m !== null && !negatedBefore(clause, m.index)) return true;
  }
  return false;
}

/** Classify Ben's own words (typed or spoken). Returns null when they don't ask for a change. */
export function classifyBenRequest(text: string): BenRequest | null {
  const sentences = sentencesOf(text);
  const whole = lower(text).trim();
  const all = normalise(text);
  const kinds: BenRequestKind[] = [];
  // "Can you lower it? Actually no, leave it.": the last sentence takes the change back (review r4 nit).
  const last = sentences[sentences.length - 1];
  const retracted = sentences.length > 1 && last !== undefined && RETRACTION.test(last.sentence.replace(/,/g, '').trim());
  if (retracted) return null;
  const clauses = all.map((c) => c.text);
  // "Remember that time I hit 100?" is a question (review r3 S1); "Remember to bring chalk" is a reminder (r4 S2).
  if (all.some((c) => (c.label === 'memory' || (MEMORY.test(c.text) && !REMINDER.test(c.text))) && !c.question)) kinds.push('memory');
  if (
    all.some((c) => {
      if (c.label === 'playbook') return true;
      const m = PLAYBOOK.exec(c.text);
      return m !== null && !(c.question && isOpinionQuestion(c.text)) && !negatedBefore(c.text, m.index);
    })
  ) {
    kinds.push('playbook');
  }
  // Content after a label, and a playbook clause, is data: never a set change.
  // "If it's too easy, add weight" states a condition, not a request for now: the coach can offer.
  const open = all.filter((c) => c.label === null && !PLAYBOOK.test(c.text) && !c.conditional);
  // A bare imperative asked as a question ("Drop it?") is asking for a view; "can you drop it?" is a request.
  const askingClauses = open.filter((c) => (isDirective(c.text) && !c.question) || isAsking(c.text)).map((c) => c.text);
  const structural =
    !/^(?:why|should i|what|how)\b/.test(whole) &&
    open.some(
      (c) =>
        structuralIn(c.text) &&
        !isOpinionQuestion(c.text) &&
        (askingClauses.includes(c.text) || selfStandingStructural(c.text) || ASK_PREFIX.test(c.text.replace(POLITE, '')) || (!c.question && SWAP_VERB.test(c.text.replace(POLITE, '').split(' ')[0] ?? ''))),
    );
  if (structural) kinds.push('structural');
  // A clause that is only a swap ("swap cable fly") isn't also a load change.
  if (askingClauses.some((c) => !structuralIn(c))) kinds.push('change');
  // "Is 95 too light?" asks for a view; "too easy, what next?" reports how it went.
  if (!isOpinionQuestion(clauses[0] ?? '') && open.some(difficultyIn)) kinds.push('difficulty');
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
