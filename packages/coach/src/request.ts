import type { CoachTurnKind } from '@fizz/schemas';
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
 * Review r5 B3: a difficulty or failed-rep report about another day ("Missed
 * a rep on Tuesday", "Couldn't do the last rep last week") isn't a report
 * about today's set; a report whose subject turns out to be something else
 * ("That was brutal, the traffic") isn't either. `if`/`unless` anywhere in
 * the sentence makes it a condition ("Add weight next time if it moves
 * well"), except a polite "if that's OK". Tempo and technique cues ("Lower
 * the weight under control", "Lower it to your chest"), rest times
 * ("Increase the rest to 3 minutes", "Add 30s rest"), the bar and the rack
 * ("Remove the bar from the rack") and set-type nouns ("Drop set on the last
 * one was fun") aren't set changes. A retraction after the last request,
 * in any clause ("I want it lighter but leave it", "Lower it. Never mind,
 * keep it", "Lower it. Don't"), takes the whole message back.
 *
 * Review r5 S1: plate talk ("Strip a plate", "Throw another 5 on"), easing
 * off ("Back it off a bit", "Dial it back", "Tone it down"), removing a set
 * ("Kill the last set", "Get rid of set 4", "Can we not do set 4"), "8 reps
 * instead", "Push me harder", and the rule 3 signals said in words ("RPE
 * 10", "0 RIR", "Barely got the last rep", "Had 5 more in the tank", "Felt
 * like a warmup") are recognised. Progression holds ("Hold bench where it
 * is", "Same weight next time", "Don't increase it next time") are their
 * own kind, `hold`, which opens no tool: next-session targets are written
 * only in the summary turn, which has `set_next_session_targets` anyway.
 * "Rule: …" and "Remember, …" are labelled lines.
 *
 * (12 Oct) `add`: an exercise added to today's workout ("add 3 sets of
 * lateral raises", "put in some curls", "stick some dips in", "can we do
 * some face pulls?"). The object must be an exercise, not a set, a load or
 * a set type: "add a set to bench", "add another set", "add 5 kg", "add a
 * drop set" aren't adds (the first two are `change`). Questions asking for a
 * view ("should I add curls?", "why can't you add curls?") aren't requests.
 *
 * Which kinds open which tools is `REQUEST_KINDS_BY_TOOL` in `registry.ts`.
 *
 * A bare "yes" / "do it" is not classified here: accepting a coach offer is
 * the `acceptedOffer` gate, set by the turn engine only when the previous
 * coach message was that offer.
 */

export type BenChip = 'too_hard' | 'too_easy' | 'pain' | 'lighter_session';

/**
 * `add_plan` (review r3 S1): an add today whose scope is unclear because it names a plan without a clear
 * future: a bare "the plan" ("add curls to the plan") or a routine/template/programme/split together with a
 * today word ("add curls to my routine now"). Always alongside `add`; it also opens the proposal tool.
 */
export type BenRequestKind = 'change' | 'difficulty' | 'structural' | 'memory' | 'playbook' | 'hold' | 'log' | 'correct' | 'build' | 'add' | 'add_plan';

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
const SET_OF_EXERCISE = `(?: (?:of|on|for) (?:the |my |some )?(?:\\w+ ){0,2}${EXERCISE_WORD})?`;
/** Review r5 B3: "of …" must be an exercise, so "Extra set of eyes would help" isn't a request. */
const ANOTHER_SET = new RegExp(`^(?:another|an extra|extra|one extra)(?: \\w+)? set${SET_OF_EXERCISE}${SIGN_OFF}$|^one more set${SET_OF_EXERCISE} (?:please|pls)${SIGN_OFF}$`);
/** Review r5 S1: plate talk, easing off, removing a set, reps instead, "push me harder". */
const PLAIN_TALK: readonly RegExp[] = [
  /^strip (?:off )?(?:a|one|two|the|\d+(?:\.\d+)?s?|that|another)(?: \w+)? plates?\b|^strip (?:it|the bar|them) (?:down|back)\b/,
  /^(?:pull|take|knock|whip|rip|slide) (?:a|one|two|the|another|\d+(?:\.\d+)?s?)(?: \w+)? plates? off\b|^(?:pull|take|knock|whip|slide) (?:off )?(?:a|one|two|\d+) plates?\b/,
  /^(?:throw|stick|slap|chuck|pop|put|whack|bang|add|load|slide) (?:on )?(?:(?:another|an extra|a|one|two)(?: \d+(?:\.\d+)?)?|\d+(?:\.\d+)?)(?: ?(?:kg|kgs|kilos|lb|lbs|pounds|s))?(?: (?:plates?|more))? (?:on|each side|a side|per side|either side|on each side|on either side)\b/,
  /^load (?:it|them|the bar|bar|up|it up|the bar up|them up)(?: up)? to \d/,
  /^back (?:it|them|that|the weight|the load|things) (?:off|down)\b|^back off (?:to \d|a bit|a little|a touch|a tad|slightly|\d|on (?:the|my) (?:weight|load))/,
  /^dial (?:it|them|that|things|the weight|the load)(?: \w+)? (?:back|down|up)\b|^dial (?:back|down) (?:the|a bit|a little|a touch|it)\b/,
  /^tone (?:it|them|that|things|the weight|the load) down\b/,
  new RegExp(`^(?:kill|lose|nix|bin|axe|chop|scratch|cross off|get rid of|do without|ditch) (?:the |my |that |this )?(?:last |final |next |extra |fourth |fifth |third |second |remaining |\\d+(?:st|nd|rd|th) )?(?:sets?(?: \\d+)?|one)(?: (?:of|on|for) (?:the |my )?(?:\\w+ )?${EXERCISE_WORD})?(?:$|\\b(?! (?:was|is|felt|went)\\b))`),
  /^not do (?:sets? \d+|the (?:last|final|next|extra) (?:set|one))\b/,
  /^\d+ reps?(?: (?:instead|please|pls|then|for (?:the rest|the last \w+|the next \w+|sets? \d+)|on (?:the )?(?:last|next|rest)\b.*|next (?:set|time)))+$/,
  /^push me (?:harder|more|a bit more|a bit harder)\b/,
];
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
  ...PLAIN_TALK,
];
const POLITE = /^(?:(?:please|pls|just|ok|okay|right|so|and|then|also|actually|yeah|yes|cool|fine|sure|alright|hey|yo|oi|oh|hmm|um|erm|coach),? )*/;
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
/** "Do dumbbells instead", "use the machine instead" (review r5 S1). */
const DO_INSTEAD = new RegExp(`^(?:do|use|go with|try|let me do|give me) (?:the |some |a |an )?(?:\\w+ ){0,2}${EXERCISE_WORD} instead\\b`);
const INSTEAD_OF = new RegExp(`\\binstead of (?:the |my )?(?:\\w+ ){0,2}${EX}\\b`);
/** A number as Ben says it: digits or a number word (the domain checks the values against his words again). */
const NUM = String.raw`(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|(?:a |one )?hundred)`;
/**
 * (11 Oct, coach tools) An explicit log command with a value: "log 100 for 8",
 * "can you record 60 kg for 10". A report ("I did 100 for 8") isn't one: Ben
 * logs with the Log button or says "log" (coach-sheet CS5).
 */
const LOG = new RegExp(`^(?:log|record|enter|put down|mark down|save)(?: (?:it|that|this|the set|this set|set ${NUM}|the last (?:set|one)))?(?: as| at)? ${NUM}\\b`);
/**
 * (11 Oct, coach tools) A correction of a named logged set: "set 2 was 95",
 * "the last set was 7 reps", "correct set 3 to 100 for 6", "fix set 2: 95".
 */
const SET_REF = String.raw`(?:set ${NUM}|(?:the |my |that )?last (?:set|one)|that set|the (?:first|second|third|fourth|fifth) set)`;
const CORRECT = new RegExp(`^(?:${SET_REF} (?:was|were) (?:actually |really |only )?${NUM}\\b|(?:correct|fix|change|update|edit|amend) ${SET_REF}(?: to| as)? ${NUM}\\b)`);

/** The future plan, not today: a removal or reorder only counts with one (11 Oct, coach tools; conservative). */
const FUTURE_SCOPE = /\b(?:next (?:time|session|week|workout)|from now on|going forward|for good|from (?:the |my )?(?:routine|workout|plan|session|programme|program))\b/;
/**
 * Taking an exercise out of the plan (11 Oct, coach tools): an imperative
 * with an exercise object and a future scope. "Drop bench to 95" is a load
 * change; "drop the pushdown" with no scope could mean today, so it isn't one.
 */
const REMOVE = new RegExp(`^(?:drop|remove|cut|ditch|lose|bin|take out|get rid of|leave out|scrap)(?: out)? (?:the |my |all )?(?:\\w+ ){0,2}${EX}s?\\b(?! (?:to|by|down|back|off) \\d)`);
/** Changing the order (11 Oct, coach tools): "do laterals first next time", "move squats to the end from now on", "reorder push day". */
const REORDER = new RegExp(`^(?:(?:do|put|move|start with|have) (?:the |my )?(?:\\w+ ){0,2}${EX}s?(?: (?:to|at))? (?:first|last|before|after|earlier|later|(?:the )?(?:start|end|beginning))\\b|reorder\\b|re-order\\b|(?:change|swap|switch) (?:the|my) order\\b)`);

/** A remove or reorder imperative (bare or after "can you" / "let's"), with a future scope where it needs one. */
function removeOrReorder(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  const body = ASK_PREFIX.exec(c)?.[1] ?? c;
  if (REMOVE.test(body) && FUTURE_SCOPE.test(body)) return true;
  if (/^(?:reorder|re-order|(?:change|swap|switch) (?:the|my) order)\b/.test(body)) return true;
  return REORDER.test(body) && FUTURE_SCOPE.test(body);
}
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
  /^(?:why|what|whats|what's|how|hows|how's|when|where|which|who|whose|is|are|was|were|do(?= (?:you|i|we|they|it|these|those|people|u|ya)\b)|does|did|should|shall i|shall we|am i|have i|has|any idea|wonder|i wonder|do you think|would it|would that|is it worth)\b/;
/** "Would you lower it if you were me?", "what would you change?": asking for the coach's view (review r3 B1). */
const OPINION_QUESTION = /\bwould (?:you|we|it)\b.*\bif\b|\bwhat would (?:you|we)\b|\bif you were me\b|\bin my (?:shoes|position)\b|\byour (?:view|opinion|take)\b/;
/**
 * "Remember to always deload every 5th week", "Remember to avoid lunges"
 * (coach-memory CM9, review coach-tools r3 S2): "remember to" followed by a
 * training instruction, or with a rule signal (a period, a deload), is a
 * memory request; `memoryTextKind` then routes the words to Your data, the
 * playbook or the split card. "Remember to bring chalk" and "Remember to log
 * 100" stay reminders, not requests.
 */
const REMEMBER_RULE =
  /^(?:please )?remember to (?:(?:always|never|not|try to|keep to) )?(?:deload|avoid|train|rest|progress|limit|cap|superset|prioriti[sz]e|include|rotate|alternate|skip)\b|^(?:please )?remember to\b.*(?:\bdeloads?\b|\bevery (?:\d+(?:st|nd|rd|th)?|\d+ ?[-–] ?\d+|other|few|couple of) (?:weeks?|sessions?|workouts?|cycles?|blocks?|months?)\b)/;
/** Ben asks for a general rule for the playbook (rule 10, review r3 S1, r4 S2). */
const PLAYBOOK =
  /\b(?:add|put|save|make|write|note) (?:(?:a|this|that|it|another|one more) (?:new )?(?:general )?(?:rule|principle)\b|(?:that|this|it) (?:in|into|to|as) (?:the |my )?(?:playbook|a (?:general )?rule)|(?:a )?(?:general )?(?:rule|principle) (?:to|in|into) (?:the |my )?playbook)|\bas a (?:general )?rule\b|\b(?:to|in|into) (?:the |my )?playbook\b|^(?:new|general) rule\b/;
/** A labelled line: what follows the colon is content, not a directive ("Add a rule: drop the weight when …"). */
const LABEL = /^(?:(?:please|ok|okay|hey|coach),? )*(add (?:a|this|that|another|one more) (?:new )?(?:general )?(?:rule|principle)|(?:new|general) (?:rule|principle)|rule|principle|playbook|for the playbook|remember|note|note to self|memory)\s*:\s*|^(?:(?:please|ok|okay|hey|coach),? )*(remember|note to self)\s*,\s*(?=(?:i|my|i'm|im|i've|ive|i'd|i'll)\b)/;
const NEGATORS = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|isn'?t|wasn'?t|aren'?t|weren'?t|won'?t|wouldn'?t|shouldn'?t|hardly|without|dont|doesnt|didnt|isnt|wasnt|arent|werent|wont|aint|ain'?t|nah|nope)\b/;
/** How many words back a negator cancels a structural phrase: "I'm not bored of", "don't change my routine". */
const NEGATION_WINDOW = 3;
/** A closing sentence that takes the request back: "Actually no, leave it", "never mind". */
const RETRACTION =
  /^(?:(?:actually|wait|hmm+|oh|um+|erm|ah|on second thoughts?|scratch that|no|nah|nope|sorry|ignore that|never ?mind|nvm|ok|okay|then|just)[, ]*)*(?:no|nah|nope|never ?mind|nvm|scratch that|forget (?:it|that|i said (?:that|anything|it))|(?:no )?(?:leave|keep) (?:it|them|that|everything)(?: (?:as (?:it is|is|it was|they are|they were|planned)|how (?:it|they) (?:is|was|are|were)|alone|be|the same|as before|for now))?|cancel(?: (?:it|that))?|don'?t(?: (?:bother|worry|do (?:it|that|anything)|change (?:it|that|anything)|touch (?:it|that)))?|do not|no (?:don'?t|wait|change)|not (?:now|yet|today)|maybe not|hold off|hang on|ignore (?:that|me|what i said)|as you were|it is fine|it'?s fine|all good|stop|on second thoughts?)$/;

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

/** Another day: a report about it isn't about today's set (review r5 B3). */
const PAST_DAY =
  /\b(?:last (?:week|time|session|night|month|workout|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|push|pull|legs|upper|lower)|yesterday|ago|the other day|used to|previously|before today|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)|this (?:morning|week) at|earlier this week)\b/;
/** The rule 3 signals said in words (review r5 S1): "RPE 10", "0 RIR", "barely got it", "had 5 more in the tank". */
const SIGNAL_SUBJECT = '(?:(?:that|it|this|(?:(?:that|this|the|my) )?(?:last |final )?(?:one|set|rep)|set \\d+|(?:\\w+ )?(?:bench|squat|deadlift|press|row|curl)) (?:was|felt like|felt|is|was like|was an?|felt like an?) )?';
const SIGNAL_WORDS: readonly RegExp[] = [
  new RegExp(`^${SIGNAL_SUBJECT}(?:an? )?(?:rpe|@) ?(?:9\\.5|10|[1-6](?:\\.5)?)(?: (?:for sure|easy|honestly|tbh|mate))?$`),
  new RegExp(`^${SIGNAL_SUBJECT}(?:0|zero|no) (?:rir|reps? (?:in reserve|left|in the tank))$|^${SIGNAL_SUBJECT}(?:rir )?(?:[4-9]|five|six) (?:rir)$`),
  /^(?:i )?(?:only )?(?:barely|just about|only just|scarcely) (?:got|made|finished|managed|squeezed out|ground out|hit|completed|locked out|moved)(?: (?:it|that|them|this|through|up|out|(?:the |that |my |all )?(?:last |final )?(?:rep|reps|set|one|lockout|lift|bar|weight|\d+))\b|$)/,
  /^(?:i )?(?:almost|nearly|very nearly|so nearly|close to) (?:failed|missed|dropped it|bailed|didn'?t (?:get|make|finish) it|died|lost it)(?:$| (?:it|that|them|(?:the |that |my )?(?:last |final )?(?:rep|reps|set|one|lift|lockout)|on (?:the )?(?:last )?(?:rep|set|one)|at the (?:end|top|bottom)|\d+)\b)/,
  /^(?:i )?(?:had|have|got|still had|easily had)(?: (?:at least|easily|like|about|maybe))? (?:\d+|a few|a couple|loads|plenty|heaps|two|three|four|five|several|lots)(?: more)?(?: reps?)?(?: left)? in (?:the|my) tank\b|^(?:i )?could have (?:done|gone|hit|got) (?:\d+|a few|a couple|loads|plenty|heaps|two|three|four|five) more\b/,
  /^(?:(?:that|it|this|that set|set \d+) )?(?:felt|was) like (?:a |my )?warm ?-?ups?\b|^(?:that|it) was nothing$/,
];
/** "That was brutal, the traffic": the next clause names what the report was about, and it isn't the set. */
function aboutSomethingElse(next: string | null): boolean {
  if (next === null) return false;
  const n = next.replace(POLITE, '');
  if (!/^(?:the|my|this|that|what a|all (?:the|that)|bloody|stupid|those|these) \w+/.test(n)) return false;
  return !new RegExp(`\\b(?:${TRAINING_NOUN}|${EXERCISE_WORD}|one|last|rep|reps|lockout|grind|set)\\b`).test(n);
}

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
  // Review r5 B3: another day, or something other than the set ("Drop sets are brutal" is about drop sets in general).
  if (PAST_DAY.test(clause.sentence) || aboutSomethingElse(clause.next)) return false;
  if (/^(?:drop|top|back-?off|warm-?up|cluster|myo|rest-?pause) ?sets are\b|^supersets are\b/.test(c)) return false;
  if (tooReport(c) || grindReport(c) || FAILED.test(c)) return true;
  return !NEGATORS.test(c.split(' ').slice(0, 2).join(' ')) && SIGNAL_WORDS.some((re) => re.test(c));
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
  /** The whole sentence the clause came from. */
  sentence: string;
  /** The next clause of the same sentence, if any. */
  next: string | null;
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
      // Review r2 S2: "I'd like to add curls" (straight or curly apostrophe) reads like "I would like to".
      .replace(/\bi'd like\b/g, 'i would like')
      .replace(/\bgimme\b/g, 'give me')
      .replace(/\bwanna\b/g, 'want to')
      .replace(/\blemme\b/g, 'let me')
      // (12 Oct, build 131) Text-speak: "can u make me a push sesh".
      // Review N1: a word on its own only, never "U-bar row".
      .replace(/(?<![\w-])u(?![\w-])/g, 'you')
      .replace(/(?<![\w-])ur(?![\w-])/g, 'your')
      .replace(/\bsesh(es)?\b/g, 'session$1')
      // Review r2 B2: "make me a push sess" (the build-131 thread title's own truncation).
      .replace(/\bsess\b/g, 'session'),
  );
}

function sentencesOf(text: string): { sentence: string; question: boolean }[] {
  const out: { sentence: string; question: boolean }[] = [];
  // A decimal point isn't a sentence end: "Stick 2.5 on each side" (review r5 S1).
  for (const m of lower(text).replace(/(\d)\.(\d)/g, '$1\u2024$2').matchAll(/[^.!?;\n]+[.!?;\n]*/g)) {
    const sentence = m[0].replace(/\u2024/g, '.');
    out.push({ sentence: sentence.replace(/[.!?;\n]+$/, '').replace(/\s+/g, ' ').trim(), question: /\?/.test(sentence) });
  }
  return out.filter((s) => s.sentence.length > 0);
}

/** "if that's OK", "if you can", "if you don't mind": politeness, not a condition. */
const POLITE_IF = /\bif (?:that is|that'?s|it is|it'?s|you) (?:ok|okay|alright|fine|possible|cool|can|could|would|don'?t mind|do not mind|please)\b|\bif possible\b|\bif you can\b|\bif poss\b/g;

function normalise(text: string): Clause[] {
  const out: Clause[] = [];
  for (const { sentence, question } of sentencesOf(text)) {
    const label = LABEL.exec(sentence);
    if (label !== null) {
      const kind = /rule|principle|playbook/.test(label[1] ?? label[2] ?? '') ? 'playbook' : 'memory';
      out.push({ text: sentence.replace(/\s*[:,]\s*/, ' '), question, endsQuestion: question, first: true, label: kind, conditional: false, sentence, next: null });
      continue;
    }
    const parts = sentence
      .split(/:\s*|,\s*|\s+-\s+|\s+(?:and|but|so|then)\s+(?=(?:please |can |could |just )?(?:[a-z]+)\b)/)
      .map((c) => c.replace(/\s+/g, ' ').trim())
      .filter((c) => c.length > 0);
    // Review r5 B3: "if"/"unless" anywhere makes it a condition, except a polite "if that's OK".
    const unpolite = sentence.replace(POLITE_IF, ' ');
    const conditional = /^(?:(?:and|so|but|ok|okay) )?(?:if|when|whenever|unless|in case|once)\b/.test(sentence) || /\b(?:if|unless|provided|as long as)\b/.test(unpolite);
    parts.forEach((p, i) =>
      out.push({ text: p, question, endsQuestion: question && i === parts.length - 1, first: i === 0, label: null, conditional, sentence, next: parts[i + 1] ?? null }),
    );
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
  // Review r5 B3: the bar and the rack, not a load ("Remove the bar from the rack first").
  if (/^(?:the |my |that )?(?:bar|barbell|dumbbells?|plates?|collars?|clips?|pins?|safeties|safety bars?|bench) (?:from|off|out of|onto|into|on to|on the (?:floor|ground|pins|safeties|rack|stand)|down (?:on|onto)|back (?:in|on|to)|to the (?:rack|floor|side|stand))\b/.test(rest)) return false;
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
/** Rest and timer lengths aren't set targets (review r5 B3): "Increase the rest to 3 minutes", "Add 30s rest". */
const REST_TIME = /\b(?:rest|break|breaks|timer|recovery|breather)\b/;
const DURATION = /\b\d+(?:\.\d+)? ?(?:s|sec|secs|seconds?|m|mins?|minutes?)\b|\b(?:a|one|two|three|another|half a|an extra|extra) (?:minute|min|second|sec)s?\b|\b(?:longer|shorter|more|less)\b.*\b(?:rest|break|breather)\b/;
/** Tempo and technique cues (review r5 B3): "Lower the weight under control", "Lower it to your chest". */
const TECHNIQUE_CUE =
  /\b(?:under control|slowly|slow|with control|controlled|on the way down|eccentric|tempo|to (?:your|my|the) (?:chest|sternum|floor|ground|knees?|shins?|hips?|thighs?|nipples?|belly|face|chin|forehead|collarbone|bottom|top)|for (?:\d+|one|two|three|four|five) (?:seconds|secs|count)|(?:till|until) (?:it|you|the bar)|(?:a|the) (?:bit )?(?:slower|faster))\b/;
/** Set-type nouns with a linking verb further on: "Drop set on the last one was fun" (review r5 B3). */
const SET_TYPE_NOUN = /^(?:drop|top|back-?off|warm-?up|working|cluster|myo|rest-?pause) ?sets?\b(?! \d)|^supersets?\b/;

/** Moving a seat, pad or pin, or the bench's angle, with no number: equipment set-up, not a load ("Raise the bench a notch"). */
const EQUIPMENT_SETTING =
  /^(?:raise|lower|drop|adjust|move|bump|change)(?: up| down)? (?:the |my )(?:bench|seat|pad|pads|pin|handle|handles|rack|safeties|safety bars?|hooks|j-?hooks|cable|pulley|backrest|back rest|footplate|incline)(?: (?:angle|height|position|seat|back|setting|incline))?(?: (?:a notch|a bit|a little|up|down|one|two|a hole|one hole|a click|a setting|a step|higher|lower|slightly|please|to (?:flat|incline|decline|\d+ degrees?)))*$/;

function isDirective(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (c.length === 0 || isOpinionQuestion(c)) return false;
  if (REST_TIME.test(c) && DURATION.test(c)) return false;
  if (/^(?:lower|raise|drop|bring|ease|control|take)\b/.test(c) && TECHNIQUE_CUE.test(c)) return false;
  if (SET_TYPE_NOUN.test(c)) return false;
  if (EQUIPMENT_SETTING.test(c)) return false;
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
  for (const re of [VARIETY, FED_UP, INSTEAD_OF, DO_INSTEAD]) {
    const m = re.exec(clause);
    if (m !== null && !negatedBefore(clause, m.index)) return true;
  }
  return removeOrReorder(clause) || futureAdd(clause);
}

/** Variety on its own ("I'm bored of incline press", "mix it up") is a request; a swap needs to be asked. */
function selfStandingStructural(clause: string): boolean {
  for (const re of [VARIETY, FED_UP, DO_INSTEAD]) {
    const m = re.exec(clause);
    if (m !== null && !negatedBefore(clause, m.index)) return true;
  }
  // Anchored imperatives, so a negator can only come before them as a prefix ("don't drop …" doesn't match).
  return removeOrReorder(clause) || futureAdd(clause);
}

/**
 * Progression holds (review r5 S1): "Hold bench where it is", "Same weight
 * next time", "Don't increase it next time", "Stop progressing bench". A
 * negated increase is the request here, so these are matched before the
 * negation checks that cancel other kinds.
 */
const HOLD: readonly RegExp[] = [
  new RegExp(`^(?:hold|keep|leave) (?:the |my )?(?:it|them|that|this|everything|(?:\\w+ )?${EXERCISE_WORD}|(?:the )?(?:weight|load)s?(?: on \\w+)?) (?:where (?:it is|they are)|as (?:it is|is)|the same|steady|there|at \\d+(?:\\.\\d+)?(?: ?(?:kg|kgs|lb|lbs))?) (?:next (?:time|session|week)|for (?:now|a (?:while|bit|few weeks?))|from now on)\\b|^(?:hold|keep) (?:the |my )?(?:\\w+ )?${EXERCISE_WORD} (?:where it is|as is|steady)$`),
  /^(?:same|the same) (?:weight|load|numbers|target|targets)(?: (?:and reps|again))? (?:next (?:time|session|week)|again next (?:time|session))\b/,
  /^(?:don'?t|do not|no) (?:increase|progress|raise|add weight to|bump|up|go up on|put up)(?: (?:it|them|that|the weight|the load|\w+))? next (?:time|session|week)\b|^no (?:increase|increases|progression|jump) (?:next (?:time|session|week)|on \w+)\b/,
  new RegExp(`^(?:stop|pause|hold off) (?:progressing|increasing|adding weight to|bumping|on progressing) (?:the |my )?(?:it|them|this|that|(?:\\w+ )?${EXERCISE_WORD})\\b`),
];

/**
 * (12 Oct, workout builder) Ben asks for a whole workout: "build me a
 * 45-minute push session for this gym", "make a leg workout", "Build a 45
 * min push workout" (the Build card's own words), "I want a quick upper
 * body session". The noun must be a workout, session or day; a programme
 * or a week is later (workout-builder §10) and isn't this kind. Only this
 * kind opens `propose_workout`.
 */
const BUILD_NOUN = '(?:workout|work-?out|session|routine|day|circuit|training session)';
// Review B1: only verbs that ask for something new. "get" and "sort (out)" read Ben's own records
// ("get my last session numbers", "sort out my session from yesterday"); they never build.
// Review S3: "program me a push day" is a verb here; "a programme" stays later (BUILD_LATER).
// Review r6 S2: "whip me up", "chuck together", "throw me together" (a "me"/"us" may sit inside the phrasal verb).
const BUILD_VERB_STRONG = '(?:build|plan|create|design|write|put together|(?:throw|chuck) (?:me |us )?together|(?:whip|knock) (?:me |us )?up|come up with|draft|knock together|program(?= (?:me|us)\\b)|programme(?= (?:me|us)\\b))';
// Review S3: "do me a push session", "sort me out a push session", "set me up a push workout". "do" and
// "sort" need "me"/"us": "can I do a push session today?" is a question, and "sort out my session" reads records.
// Review r3 S5: "sort me a push session" (no "out") is the same ask.
const BUILD_VERB_WEAK = '(?:make|give|set up|set (?:me|us) up|do(?= (?:me|us)\\b)|sort (?:me|us) out|sort(?= (?:me|us)\\b))';
// A new workout has an article or adjective; "the", "my" and "this" point at one that exists ("make the session easier").
const NEW_DET = '(?:a|an|another|one|new|quick|short|fresh)';
// `lower()` reads "today's" as "today is" (the apostrophe-s expansion), so both forms count (build 131).
const BUILD_DIRECT = new RegExp(
  `^(?:${BUILD_VERB_STRONG}(?: me| us| out)?(?: (?:${NEW_DET}|today'?s|tonight'?s|today is|tonight is))+|${BUILD_VERB_WEAK}(?: me| us)?(?: ${NEW_DET})+|${BUILD_VERB_WEAK} (?:me|us) (?:today'?s|tonight'?s|today is|tonight is))\\b.{0,80}?\\b${BUILD_NOUN}s?\\b`,
);
// Review r3 S5: "need a quick 30 min workout" (no "I").
const BUILD_WANT = new RegExp(`^(?:i )?(?:want|need|would like|'d like|fancy)(?: to do)? (?:a|an|another|one)\\b.{0,80}?\\b${BUILD_NOUN}s?\\b`);
/** The focus words of a workout ("push", "legs", "upper body"), for wording with no article (build 131). */
const FOCUS = '(?:push|pull|legs?|upper(?: body)?|lower(?: body)?|full[ -]body|chest|back|arms?|shoulders?|glutes?|core|abs|triceps|biceps|tris|bis|hamstrings?|quads?|calves|delts)';
const FOCUS_RUN = `${FOCUS}(?:(?: ?/ ?| and | & | \\+ | plus | )${FOCUS})*`;
/** "can I have / get a push session" (build 131): asking for one. "get me a workout" alone stays out (review B1). */
const BUILD_CAN_I = new RegExp(`^(?:can|could|may) i (?:please )?(?:have|get|grab) (?:${NEW_DET} )+.{0,80}?\\b${BUILD_NOUN}s?\\b`);
/** "make me push session", "give me a push/legs day" (build 131): a focus right before the noun. */
const BUILD_FOCUS = new RegExp(`^(?:make|give|build|plan|create|design|write|program)(?: me| us)?(?: (?:${NEW_DET}))* ${FOCUS_RUN} ${BUILD_NOUN}\\b`);
const GUARD_WORD = /\b(?:avoid|avoids|avoiding|without|except|around|easy on|easier on)\b/;
/** Review r6 S2: "Push and legs today please": a focus, a day and "please", the whole message. */
const BUILD_FOCUS_TODAY = new RegExp(`^${FOCUS_RUN}(?: (?:day|session|workout))? (?:today|tonight) please$`);
/** "push session please", "push workout for today please" (build 131): no verb, but a plain ask. */
const BUILD_PLEASE = new RegExp(
  `^(?:(?:a|an) )?(?:(?:quick|short) )?(?:${FOCUS_RUN} ${BUILD_NOUN}|(?:new|another|fresh)(?: ${FOCUS_RUN})? ${BUILD_NOUN})(?: for (?:today|tonight|tomorrow))? please$`,
);
/**
 * Review r2 B2: "add a push workout to the app", "can you add a push session to my workouts", "put a
 * push session in the app for me": a new workout (a determiner) placed in the app. The determiner
 * keeps exercise adds ("add curls to my workout") and records ("put my session in the app") out.
 */
const BUILD_PLACE = new RegExp(
  `^(?:add|put|save|load|stick|pop)(?: me| us)?(?: (?:${NEW_DET}))+\\b.{0,60}?\\b${BUILD_NOUN}s?(?: for (?:me|us|today|tonight|tomorrow))? (?:to|in|into|on|onto) (?:the app|this app|my workouts|my routines|my library|the workouts tab)\\b`,
);
/** Review r2 B2: "can you do a push session for me" ("do" with "for me" after the noun). */
const BUILD_DO_FOR = new RegExp(`^do (?:${NEW_DET} )+.{0,60}?\\b${BUILD_NOUN}s? for (?:me|us)\\b`);
/**
 * Review r3 S5: "build me something", "design me something for today": a strong build verb and
 * "something", the whole message. Review r4 B1 (PM, 13 Oct): "give/make/sort me something … today"
 * is gone: "give me something for my sore shoulder today" is a pain question, not a workout. Those
 * turns still have `propose_workout` offered (never forced); the model reads his words.
 */
// Review r6 S2: "make me something for today" (the whole message, so "… for my sore shoulder" stays out).
const BUILD_SOMETHING = /^(?:build|create|design|make|put together|throw together|whip up|knock up|program|programme) (?:me|us) (?:something|a thing)(?: (?:quick|short|new|good|decent))?(?: (?:for (?:today|tonight)|today|tonight|to do(?: today| tonight)?|for (?:the )?gym))?$/;
/** Review r3 S5: "push day today, can you sort it": a focus and a day, then "sort it" (the whole message). */
const BUILD_SORT_IT = new RegExp(`^${FOCUS_RUN} (?:day|session|workout)(?: (?:today|tonight))?,? (?:(?:can|could|would) you |please )?(?:sort|build|make|do|plan) (?:it|that|one|me one|me out|me something)(?: (?:for me|please|out))*$`);
/**
 * Review r5 S1: muscle groups named as a session's focus, not as Ben's body: a run of two or more
 * ("back and biceps", "chest/back") or one before a workout noun ("back session"), never after "my".
 * The run before a noun, or a list of two or more ending the clause ("a pull session, back and biceps").
 */
/**
 * Review r6 S3: a trailing list is a focus only straight after "session," / "workout," / "day,", and
 * only in the plural or group words ("back and biceps", "chest and shoulders"). A single "shoulder",
 * "arm" or "leg" there is a body part Ben may be guarding ("a back session, back and shoulder").
 */
const FOCUS_GROUP = '(?:push|pull|legs|upper(?: body)?|lower(?: body)?|full[ -]body|chest|back|arms|shoulders|glutes|core|abs|triceps|biceps|tris|bis|hamstrings|quads|calves|delts)';
const FOCUS_LIST = `${FOCUS_GROUP}(?:(?: ?/ ?| and | & | \\+ | plus |, ?)${FOCUS_GROUP})+`;
/** Review r6 S3: never a focus after a word that guards a body part ("avoiding back and shoulders", "easy on my back"). */
const GUARDED = '(?<!\\b(?:avoid|avoids|avoiding|without|except|not|no|around|easy on|easier on|go easy on|skip|skipping|spare|sparing|protect|protecting|rest|resting|nothing for|no work for|off) )';
const FOCUS_BEFORE_NOUN = new RegExp(`(?<!\\bmy )(?<!\\bmy [a-z]+ )${GUARDED}\\b${FOCUS_RUN} (?=${BUILD_NOUN}s?\\b)`, 'g');
const FOCUS_LIST_END = new RegExp(`(?<=\\b${BUILD_NOUN}s?, ?)${FOCUS_LIST}(?= *(?:please)? *(?:[.,!;]|$))`, 'g');
/** Review r6 S2: "Push and legs today please": a focus run that is the whole ask. */
const FOCUS_LEAD = new RegExp(`^${FOCUS_RUN}(?= (?:(?:day|session|workout) )?(?:today|tonight)(?: please)?[.!]*$)`);

/** Ben's words with a training focus ("back and biceps session") taken out, for reading pain words (review r5 S1). Pure. */
export function withoutFocusRuns(text: string): string {
  // Review r6 S3: a guard word anywhere means a body part may be Ben's own; nothing is stripped (rule 9).
  if (GUARD_WORD.test(lower(text))) return lower(text);
  return text.toLowerCase().replace(/[‘’]/g, "'").trim().replace(FOCUS_LEAD, '').replace(FOCUS_BEFORE_NOUN, '').replace(FOCUS_LIST_END, '');
}

/** "push and legs" inside one request: joined before the clause split reads "and" as a new clause (build 131). */
const FOCUS_AND = new RegExp(`\\b(${FOCUS}) (?:and|&|plus) (?=${FOCUS}\\b)`, 'gi');
// Build 131: "split" is later only as a programme split ("my upper/lower split"), never "split squats".
// Review S3: "program me a push day" is one session; "for next week" is when, not how long.
// Review r3 S5: "programme me a push session" is one session too; "this week" and "last week" are when.
const BUILD_LATER = /\b(?:programme(?! (?:me|us)\b)|program(?! (?:me|us)\b)|programs|programmes|mesocycle|block|weeks|weekly|(?<!(?:next|this|last|the other) )week|month|plan for the week|weekly plan|split(?! (?:squats?|stances?|lunges?|jerks?)\b))\b/;
/**
 * Not a new workout (review B1): a change to the one in hand ("a lighter session", "the rest of
 * the session"), a read of Ben's records ("a summary of my last session") or advice ("some tips
 * for leg day"), or a day without training ("a rest day").
 */
/**
 * Review r4 S2: more than one session ("a workout plan for this week", "a workout for each day this
 * week", "sessions for this week"). Multi-week and weekly plans aren't available yet (§10).
 */
const BUILD_MULTI = /\b(?:(?:each|every|per) (?:day|week)|(?:workouts|sessions|days)\b.{0,40}\b(?:this|next) week|(?:plan|schedule)\b.{0,30}\b(?:this|next) week|(?:this|next) week'?s (?:workouts|sessions|plan|schedule)|\d+ (?:days|sessions|workouts) a week)\b/;

/** Ben's words ask for a programme, a week or more of sessions (review r4 S2): never forced to one session. */
export function multiWeekScope(text: string): boolean {
  const t = lower(text);
  return BUILD_LATER.test(t) || BUILD_MULTI.test(t);
}
const BUILD_NOT = /\b(?:easier|lighter|harder|heavier|less intense|more intense|rest of|summary|recap|review|numbers|stats|tips|advice|ideas?|feedback|breakdown|rest day|off day|day off|recovery day)\b/;

function buildIn(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (BUILD_LATER.test(c) || BUILD_MULTI.test(c) || BUILD_NOT.test(c) || isOpinionQuestion(c)) return false;
  // Review r6 S2: "would you be able to make me …", "help me plan today's workout".
  const asked = ASK_PREFIX.exec(c)?.[1] ?? c;
  const body = asked.replace(/^(?:(?:(?:would|could|will|can) you )?be able to |are you able to |(?:you )?help (?:me|us) (?:to )?)/, '');
  return BUILD_DIRECT.test(body) || BUILD_FOCUS_TODAY.test(c) || BUILD_WANT.test(c) || BUILD_CAN_I.test(c) || BUILD_FOCUS.test(body) || BUILD_PLEASE.test(c) || BUILD_PLACE.test(body) || BUILD_DO_FOR.test(body) || BUILD_SOMETHING.test(body);
}

/**
 * (12 Oct) Adding an exercise to today's workout. A verb that adds ("add",
 * "put in", "throw in", "stick … in") with an exercise as its object, after
 * an optional amount ("some", "3 sets of", "3 sets of 12"). "Do / try some
 * curls" only counts after an ask ("let's", "can we", "I want to").
 */
/** A rep count or range after "N sets of" (review B1): "3 sets of 12", "3 sets of 10-12 reps of". */
// Review r2 S2: "on" only after a set count ("add 3 sets of 12 on lateral raises").
const ADD_REPS = '(?:\\d+(?: ?(?:-|–|to) ?\\d+)?(?: reps?)?(?: of| on)? )?';
const SET_COUNT = '(?:\\d+|one|two|three|four|five|six|a|some|a few|a couple(?: of)?|more)';
/** An amount of sets: "3 sets of 12", "some sets of", "sets for", "3x12". */
const ADD_SETS = `(?:(?:${SET_COUNT} )?(?:sets?|rounds?) (?:of|for) ${ADD_REPS}|\\d+ ?x ?\\d+(?: of| on)? )`;
const ADD_AMOUNT = `(?:${ADD_SETS}|(?:some|a few|a couple(?: of)?|a bit of|more|(?:another|an extra|extra|one more) (?:round|set|exercise) of) )?`;
const ADD_DET = '(?:(?:the|my|a|an|some) )?';
/** Words between the amount and the exercise word: never a preposition or a load, set or time word ("add weight to bench"). */
const ADD_FILLER = '(?:(?!(?:to|on|for|at|in|onto|into|with|weight|weights|load|loads|kg|kgs|kilos?|lbs?|pounds?|reps?|sets?|plates?|rest|time|seconds?|minutes?|something|anything|other|than|else|instead|different)\\b)[a-z-]+ ){0,3}';
const ADD_OBJECT = `(${ADD_FILLER}${EXERCISE_WORD})`;
const ADD_VERB = '(?:add(?: in| on)?|include|put in|throw in|chuck in|stick in|pop in|slot in|squeeze in|fit in|bang in|whack in|tack on|tag on|work in)';
const ADD_DIRECT = new RegExp(`^${ADD_VERB} ${ADD_AMOUNT}${ADD_DET}${ADD_OBJECT}\\b`);
const ADD_SPLIT = new RegExp(`^(?:put|throw|chuck|stick|pop|slot|squeeze|fit|bang|whack|work) ${ADD_AMOUNT}${ADD_DET}${ADD_OBJECT} (?:in|on)\\b`);
/**
 * Review B1: "create 3 sets of lateral raises" (Ben's own verb), "give me 3 sets of curls", "make 3
 * sets of curls". These verbs need an amount, so "make bench lighter" and "give me bench at 100"
 * stay set changes.
 */
const ADD_MAKE = new RegExp(`^(?:create|make|give me|do me|set up) (?:me )?(?:${ADD_SETS}|(?:some|a few|a couple(?: of)?) )${ADD_DET}${ADD_OBJECT}\\b`);
/** Review B1: "superset curls with bench". The coach adds the exercise; one already there is refused by the domain. */
const ADD_SUPERSET = new RegExp(`^superset (?:it |them )?(?:with )?${ADD_DET}${ADD_OBJECT}\\b`);
/** Review r2 S2: "pair curls with bench", "do curls as a superset with bench". */
const ADD_PAIR = new RegExp(`^pair (?:up )?${ADD_DET}${ADD_OBJECT} (?:with|and)\\b`);
const ADD_DO_SUPERSET = new RegExp(`^do ${ADD_AMOUNT}${ADD_DET}${ADD_OBJECT} (?:as|in) a superset\\b`);
/** Review r2 S2: an amount Ben wants or asks to get: "I'd like some curls", "can I get 3 sets of curls". */
const ADD_WANT = new RegExp(`^i (?:want|need|would like) (?:${ADD_SETS}|(?:some|a few|a couple(?: of)?) )${ADD_DET}${ADD_OBJECT}\\b`);
const ADD_GET = new RegExp(`^(?:get|have) (?:me )?(?:${ADD_SETS}|(?:some|a few|a couple(?: of)?) )${ADD_DET}${ADD_OBJECT}\\b`);
/** Review r2 S2: suggestion prefixes that ask for an add only ("we should add curls", "maybe add some curls"). */
const ADD_SUGGEST_PREFIX = /^(?:we should|maybe|always|perhaps|i think we should|we need to|we could|might as well) (.*)$/;
const ADD_DO = new RegExp(`^(?:do|hit|try|have) ${ADD_AMOUNT}${ADD_DET}${ADD_OBJECT}\\b`);
/** Set types and other things that are sets, not exercises: "add a drop set", "add a warm-up". */
const ADD_NOT_EXERCISE = /^(?:top ?sets?|back ?-?off(?: sets?)?|drop ?sets?|warm ?-?ups?|amrap|finisher)\b/;
/**
 * Review B2, r2 B1: an add with a future scope ("add curls next time", "to my routine", "from now on",
 * "to every push day", "permanently") changes the plan, not today: a structural proposal (rule 3),
 * never `add_exercise_today`. The list can't be complete, so the today tool's description says it is
 * today only. An add whose scope is unclear (`unclearAddScope`) also opens `propose_next_workout_change`;
 * a plain today add doesn't (review r3 S1).
 */
const ADD_FUTURE_TIME =
  /\b(?:next (?:time|sessions?|weeks?|workouts?|push|pull|legs|leg day|upper|lower|block|cycle|month)|tomorrow|from (?:now|today|here) on(?:wards?)?|from now|going forward|for good|permanently|always|in (?:the )?future|future (?:sessions?|workouts?|weeks?)|every (?:\w+ )?(?:week|time|session|workout|day)s?|each (?:\w+ )?(?:week|session|workout|day)|(?:push|pull|leg|legs|upper|lower|upper body|lower body|chest|back|arm|arms|shoulder|full body) days|for the rest of the (?:block|month|cycle|programme|program|phase|meso|mesocycle|year)|(?:rest of|for) the (?:block|programme|program|mesocycle))\b/;
/** "to my routine", "in the push template": future unless today is named ("to today's plan") or it is a bare "the plan" (review r2 S1). */
const ADD_FUTURE_PLAN = /\b(?:to|in|into|for|on|from) (?:the |my |our )?(?:[a-z]+ ){0,2}(?:routine|template|plan|programme|program|split)s?\b/;
const ADD_TODAY = /\b(?:today|tonight|this (?:workout|session)|now)\b/;
const ADD_BARE_PLAN = /^(?:to|in|into|for|on) (?:the )?plans?$/;

function futureScope(clause: string): boolean {
  if (ADD_FUTURE_TIME.test(clause)) return true;
  const plan = ADD_FUTURE_PLAN.exec(clause);
  if (plan === null) return false;
  // "add curls in the plan" is ambiguous: an add today, and the proposal tool is open too.
  if (ADD_BARE_PLAN.test(plan[0])) return false;
  return !ADD_TODAY.test(clause);
}

/**
 * Review r3 S1: an add today whose scope is unclear, so the proposal tool opens as well. A bare "the plan"
 * with no today word, or a routine/template/programme/split named with a today word. "today's plan" and "my plan today" are today.
 */
function unclearAddScope(clause: string): boolean {
  const plan = ADD_FUTURE_PLAN.exec(clause);
  if (plan === null) return false;
  if (ADD_BARE_PLAN.test(plan[0])) return !ADD_TODAY.test(clause);
  return ADD_TODAY.test(clause) && !/\bplans?$/.test(plan[0]);
}

/**
 * A clause that is only a future scope, split off an add: "add curls today and next time", "add curls
 * today, and to my routine too". The add stays today's; the proposal tool opens for the future part.
 */
function scopeOnly(clause: string): boolean {
  if (!futureScope(clause)) return false;
  const rest = clause
    .replace(new RegExp(ADD_FUTURE_TIME.source, 'g'), ' ')
    .replace(new RegExp(ADD_FUTURE_PLAN.source, 'g'), ' ')
    .replace(/\b(?:and|also|plus|too|as well|then|but|same|again|please|for|to|in|on|the|my|our)\b/g, ' ');
  return rest.trim() === '';
}

/** The add phrasing itself, anchored after polite words and an ask; no scope or structural check. */
function addMatch(clause: string): boolean {
  const c = clause.replace(POLITE, '');
  if (c.length === 0 || isOpinionQuestion(c)) return false;
  const asked = ASK_PREFIX.exec(c) ?? ADD_SUGGEST_PREFIX.exec(c);
  const body = (asked?.[1] ?? c).replace(POLITE, '');
  const m =
    ADD_DIRECT.exec(body) ??
    ADD_SPLIT.exec(body) ??
    ADD_MAKE.exec(body) ??
    ADD_SUPERSET.exec(body) ??
    ADD_PAIR.exec(body) ??
    ADD_DO_SUPERSET.exec(body) ??
    ADD_WANT.exec(c) ??
    (asked !== null ? (ADD_DO.exec(body) ?? ADD_GET.exec(body)) : null);
  return m !== null && !ADD_NOT_EXERCISE.test((m[1] ?? '').trim());
}

/** An add for the future plan (review B2): structural. */
function futureAdd(clause: string): boolean {
  return addMatch(clause) && futureScope(clause);
}

function addIn(clause: string): boolean {
  // A swap or variety request ("something other than cable fly") or a future add is structural, not an add today.
  return addMatch(clause) && !structuralIn(clause);
}

/**
 * With a coach draft in context (`Ask coach` on its overview, workout-builder
 * BD16), "make it shorter", "no barbell", "swap the pec deck", "drop the
 * dips", "add some core" change the draft: a new version, never today's sets.
 */
// Review S5: "no" and "without" count only with a thing to leave out: equipment, a body part or an exercise.
const DRAFT_THING = `(?:(?:the |any |more )?(?:barbells?|bars?|dumbbells?|dbs?|cables?|machines?|kettlebells?|kbs?|bands?|smith(?: machine)?|racks?|benches|bodyweight|free weights?|legs?|chest|back|shoulders?|arms?|biceps|triceps|core|abs|glutes|hamstrings?|hams|quads?|calves|cardio|${EXERCISE_WORD}|(?:\\w+ )?${EXERCISE_WORD}))\\b`;
const DRAFT_REVISION: readonly RegExp[] = [
  /^(?:make|keep) (?:it|this|that|the (?:workout|session|draft))\b.*\b(?:shorter|longer|harder|easier|lighter|heavier|quicker|simpler|different)\b/,
  new RegExp(`^(?:no|without) ${DRAFT_THING}`),
  /^(?:skip|drop|lose|ditch|remove|cut|swap|switch|replace|sub|add|include|use)\b/,
  /^change (?!nothing\b|anything\b|a thing\b|it\b)\w+/,
  /^(?:more|less|fewer) (?!thanks\b|than\b)\w+/,
  /^only (?!if\b|when\b|just\b|asking\b|joking\b|kidding\b)\w+/,
  /^(?:can|could) (?:you|we) (?:make|swap|switch|replace|drop|remove|add|change|use)\b/,
];

/** Whether Ben's words change the coach draft in context (BD16). Code, never the model's reading. */
export function revisesDraft(text: string): boolean {
  return normalise(text).some((c) => {
    const t = c.text.replace(POLITE, '');
    const asks = !c.question || /^(?:can|could|would|will) (?:you|we)\b/.test(t);
    return c.label === null && asks && !isOpinionQuestion(t) && DRAFT_REVISION.some((re) => re.test(t));
  });
}

/**
 * Classify Ben's own words (typed or spoken). Returns null when they don't ask for a change.
 * `turnKind`: a build clause drops its `change` reading only in a general turn, where
 * `propose_workout` lives; in a workout turn "make the session easier" stays a change to
 * today's sets (review B1, rule 3).
 */
export function classifyBenRequest(text: string, turnKind?: CoachTurnKind): BenRequest | null {
  const whole = lower(text).trim();
  const all = normalise(text);
  const kinds: BenRequestKind[] = [];
  const clauses = all.map((c) => c.text);
  // "Remember that time I hit 100?" is a question (review r3 S1); "Remember to bring chalk" is a reminder (r4 S2).
  if (all.some((c) => (c.label === 'memory' || (MEMORY.test(c.text) && !REMINDER.test(c.text)) || REMEMBER_RULE.test(c.text)) && !c.question)) kinds.push('memory');
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
  // A whole workout (workout builder): its own kind, never a change to today's sets.
  // Build 131: an "if" doesn't hold a build back ("… if I only have 45 mins"): it only makes a draft
  // Ben opens himself. A clause that is only the condition ("if it's too easy") never builds.
  const buildable = all.filter((c) => c.label === null && !PLAYBOOK.test(c.text) && !/^(?:(?:and|so|but|ok|okay) )?(?:if|when|whenever|unless|in case|once)\b/.test(c.text));
  // "make me a push and legs session": the focus words are joined first, so "and" doesn't split the request.
  const joinedBuilds = (c: Clause): boolean => {
    if (!c.first) return false;
    const joined = c.sentence.replace(FOCUS_AND, '$1/');
    return joined !== c.sentence && normalise(joined).some((x) => x.first && buildIn(x.text));
  };
  const building = buildable.filter((c) => buildIn(c.text) || joinedBuilds(c)).map((c) => c.text);
  if (building.length > 0 || BUILD_SORT_IT.test(whole.replace(/[.!]+$/, ''))) kinds.push('build');
  // (12 Oct) An exercise added today; a question only counts when it asks ("can you add curls?").
  const adds = open.filter((c) => addIn(c.text) && (!c.question || ASK_PREFIX.test(c.text.replace(POLITE, ''))));
  if (adds.length > 0) kinds.push('add');
  if (adds.length > 0 && (adds.some((c) => unclearAddScope(c.text)) || open.some((c) => scopeOnly(c.text)))) kinds.push('add_plan');
  // A clause that is only a swap ("swap cable fly") isn't also a load change; nor is a build, in a general turn.
  const buildOnly = turnKind === 'general' ? building : [];
  if (askingClauses.some((c) => !structuralIn(c) && !buildOnly.includes(c))) kinds.push('change');
  // "Is 95 too light?" asks for a view; "too easy, what next?" reports how it went.
  if (!isOpinionQuestion(clauses[0] ?? '') && open.some(difficultyIn)) kinds.push('difficulty');
  if (open.some((c) => !c.question && HOLD.some((re) => re.test(c.text.replace(POLITE, ''))))) kinds.push('hold');
  const bodyOf = (c: string) => {
    const t = c.replace(POLITE, '');
    return ASK_PREFIX.exec(t)?.[1] ?? t;
  };
  // A question only counts when it asks ("can you log 100 for 8?"), never "set 2 was 95?".
  if (open.some((c) => LOG.test(bodyOf(c.text)) && (!c.question || ASK_PREFIX.test(c.text.replace(POLITE, ''))))) kinds.push('log');
  if (open.some((c) => CORRECT.test(bodyOf(c.text)) && (!c.question || ASK_PREFIX.test(c.text.replace(POLITE, ''))))) kinds.push('correct');
  if (kinds.length === 0) return null;
  // Review r5 B3: a retraction in any clause after the last request takes it back ("I want it lighter
  // but leave it", "Lower it. Never mind, keep it", "Lower it. Don't"). A new request after a
  // retraction still counts ("Lower it. Actually no, raise it").
  let lastRequest = -1;
  all.forEach((c, i) => {
    if (c.label !== null || buildIn(c.text) || addIn(c.text) || isDirective(c.text) || isAsking(c.text) || difficultyIn(c) || structuralIn(c.text) || MEMORY.test(c.text) || REMEMBER_RULE.test(c.text) || PLAYBOOK.test(c.text) || HOLD.some((re) => re.test(c.text.replace(POLITE, ''))) || LOG.test(c.text.replace(POLITE, '')) || CORRECT.test(c.text.replace(POLITE, ''))) lastRequest = i;
  });
  if (all.slice(lastRequest + 1).some((c) => RETRACTION.test(c.text.replace(/,/g, '').trim()))) return null;
  return { source: 'words', kinds };
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

const MORE_SETS = /\b(?:more|extra|another|add (?:a|one|an))\b.{0,20}\b(?:sets?|volume)\b/;

/** A question that asks for something ("Can I have more sets?"), not for advice ("Should I do more sets?"). */
const REQUEST_QUESTION = /^(?:(?:can|could|may) (?:i|we) (?:have|get|do|add|try)|(?:can|could|will|would) you (?:add|give|put|make)|any chance)\b|\bplease\b/;

/**
 * Did Ben ask for more sets or volume (D1: +1 set next session only when he
 * asked)? His own words only, clause by clause; a negated ask ("I don't want
 * any more sets", "no extra sets please") is not one (review S7), nor is a
 * question asking for advice ("Should I do more sets?", review r2 N1).
 */
export function asksForMoreSets(text: string): boolean {
  const sentences = text.toLowerCase().replace(/[’]/g, "'").match(/[^.!?;]+[.!?;]*/g) ?? [];
  return sentences.some((sentence) => {
    if (/\?\s*$/.test(sentence) && !REQUEST_QUESTION.test(sentence.trim())) return false;
    return sentence.split(/[.!?;,]+|\b(?:but|though|although)\b/).some((c) => {
      const m = MORE_SETS.exec(c);
      if (m === null) return false;
      const before = c.slice(0, m.index).trim().split(/\s+/).slice(-6).join(' ');
      return !NEGATORS.test(before) && !/\b(?:any|enough|too many)\b/.test(`${before} ${m[0]}`) && !/^\s*no\b/.test(c);
    });
  });
}

/**
 * (14 Oct, PM decision pending Ben) Ben's words in a live workout that are about today's loads or
 * sets: weights, sets, reps, load, kg/lb, heavier, lighter, target, repopulate, recalculate, "based
 * on". A broad test on purpose: the classifier above kept missing real requests ("can you
 * repopulate the weights based on my maximum working weight recently?"). The today-tools are offered
 * on every live turn; a call in reply to words like these applies at once with Undo (rule 3), and a
 * call without them becomes an offer. Singular "set" alone ("set 2 felt good") doesn't count, nor
 * does a hold ("keep the weights as they are").
 */
const TODAY_SET_WORDS =
  /\b(?:weights?|sets|reps?|loads?|loading|kgs?|kilos?|lbs?|pounds|heavier|lighter|targets?|re-?populate|re-?calculate|based on)\b|\d\s?(?:kg|lb)s?\b/;

/** "Keep the weights as they are", "don't change the sets": a hold, not a request. */
const KEEP_AS_IS = /\b(?:keep|leave|hold)\b[^.?!]{0,30}\b(?:as (?:it is|they are|is)|the same|where (?:it is|they are))\b|\b(?:don'?t|do not|no need to) (?:change|touch|adjust|alter|move|update)\b/;

export function mentionsTodaysSets(text: string): boolean {
  const t = lower(text);
  return TODAY_SET_WORDS.test(t) && !KEEP_AS_IS.test(t);
}

const RENAME =
  /\b(?:re-?name)\b|\b(?:change|update|set|make|switch)\b[^.?!]{0,25}\bname\b|\bname (?:it|this|that|the (?:workout|session)|today'?s (?:workout|session)|my (?:workout|session))\b|\bcall (?:it|this|the (?:workout|session)|today'?s (?:workout|session))\b/;

/** (14 Oct) Ben asks to rename today's workout ("Change name of workout to Chest day", "call it Push B"). */
export function asksToRename(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const m = RENAME.exec(t);
  return m !== null && !NEGATORS.test(t.slice(Math.max(0, m.index - 12), m.index));
}

/** (14 Oct) Words that might add an exercise today: the app then sends what can be added (`addable`). */
export function mentionsAdding(text: string): boolean {
  return /\b(?:add|adding|another exercise|put in|throw in|chuck in|include|superset)\b/.test(lower(text));
}
