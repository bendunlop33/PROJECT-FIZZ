import { classifyPainMention } from '@fizz/domain';
import type { ActionRecord, CoachMessage, CoachTurnKind } from '@fizz/schemas';
import { classifyBenRequest, multiWeekScope, requestHas, revisesDraft, withoutFocusRuns } from './request';

/**
 * Did Ben ask for a workout in the app? One decision, shared by the turn gate
 * (`gateFor`, which tools the model sees) and the app's build wiring
 * (`coach-service` `buildTurn`, which builds the context and the executor), so
 * the two can never disagree and withhold `propose_workout` as "not in this
 * build" (build 131 diagnosis).
 *
 * Code, never the model's say-so (coach-contract §6.1): only Ben's words and
 * what the thread already showed him are read. Three ways in:
 * - his words ask for one ("make me a push session", `classifyBenRequest` kind `build`);
 * - with a coach draft in context, his words change it (BD16, `revisesDraft`);
 * - a follow-up (build 131): the coach's last message described a session in
 *   text, or answered a build request without building, and Ben now agrees to
 *   have it in the app ("yes add it", "put that in the app", "save it",
 *   "Yes u can add in the app"). A bare "yes" counts only when the coach
 *   offered to build it.
 *
 * Every way in only opens `propose_workout`, which makes a draft: nothing is
 * started or saved without Ben's tap (BD12, BD15).
 */

/**
 * One prescribed exercise in a text plan: "3 × 6–8", "2 x 12-15", "3 sets of 8",
 * "3 sets of 6-8", "3 sets, 6-8 reps", "3 sets 8 reps" (review B3).
 */
const SETS_BY_REPS = /\b\d{1,2}\s*(?:[×x✕*]|sets?(?: of|,| x|:)?)\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*reps?)?\b(?!\s*(?:s|secs?|seconds?|m|mins?|minutes?)\b)/gi;

/** Review r3 S4: AMRAP, to-failure and timed lines ("Dips — 3 × AMRAP", "Plank 3 × 45 s", "3 sets of 30-45s"). */
const SETS_BY_OTHER =
  /\b\d{1,2}\s*(?:[×x✕*]|sets?(?: of|,| x|:)?)\s*(?:amrap|max(?: reps)?|to failure|\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\s*(?:s|secs?|seconds?|m|mins?|minutes?))(?![a-z])/gi;

/** Reps written before sets (review r2 S3): "6-8 reps, 3 sets", "8-12 reps x 3 sets", "10 reps for 3 sets". */
const REPS_BY_SETS = /\b\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\s*reps?,?\s*(?:[×x✕*]|for|of|over)?\s*\d{1,2}\s*sets?\b/gi;

/** Does this coach text lay out a session (two or more "sets × reps" lines)? Pure; the coach's words are data. */
export function describesWorkoutPlan(text: string): boolean {
  return (text.match(SETS_BY_REPS) ?? []).length + (text.match(REPS_BY_SETS) ?? []).length + (text.match(SETS_BY_OTHER) ?? []).length >= 2;
}

const OFFER_VERB = /\b(?:want|shall|should|like) (?:me|i) to (?:build|add|make|put|save|create|set up|set (?:it|that|this|them) up|turn|load)\b|\b(?:shall|should|can|could) i (?:build|add|make|put|save|create|set|load)\b|\b(?:do you |would you )?(?:want|like) (?:it|that|this|them|these)(?: (?:as|to be) (?:a |an )?(?:workout|session|draft|routine))? (?:in|on|into|added to|saved (?:in|to)) (?:the app|your workouts|workouts)\b|\b(?:do you |would you )?(?:want|like) (?:it|that|this|them|these) (?:as|to be) (?:a |an )?(?:workout|session|draft|routine)\b|\b(?:build|add|put|save|load) (?:it|that|this|them)(?: (?:in|into|to) (?:the app|your workouts))?\s*\?/i;
/** An offer as a statement (review r2 S3): "I can build it in the app if you like", "Happy to set that up if you want." */
const OFFER_STATEMENT =
  /\b(?:i can|i could|i'm happy to|happy to|glad to)\s+(?:build|add|make|put|save|create|set up|set (?:it|that|this|them) up|load|turn)\b[^.!?]*\b(?:if you (?:like|want|fancy|'d like|would like)|if that helps|if useful|just say(?: the word)?|(?:just )?let me know|say the word)\b/i;
const NOT_WORKOUT_OFFER = /\b(?:memor(?:y|ies)|note|remember)\b/i;
/** The offer is about a workout, not a memory or a note ("Want me to save that as a memory?" is not one). */
const OFFER_ABOUT_WORKOUT = /\b(?:build|app|workouts?|sessions?|routines?|drafts?|day)\b/i;

/**
 * Did the coach end by offering to build it ("Want me to build it in the app?",
 * or "Shall I add it?" right after a plan in the same message)? A bare
 * "yes" to this opens `propose_workout` (review B3: the coach's own offer is
 * the clear signal; the result is still only a draft, BD12, BD15).
 */
export function offersToBuild(text: string): boolean {
  const t = text.replace(/[’]/g, "'");
  const questions = t.match(/[^.!?]*\?/g) ?? [];
  const statements = t.match(/[^.!?]+[.!]?/g) ?? [];
  const plan = describesWorkoutPlan(text);
  const about = (q: string): boolean => !NOT_WORKOUT_OFFER.test(q) && (plan || OFFER_ABOUT_WORKOUT.test(q));
  return questions.some((q) => OFFER_VERB.test(q) && about(q)) || statements.some((q) => OFFER_STATEMENT.test(q) && about(q));
}

/** Yes-family words: agreement on their own ("yes", "go on then", "sounds great", "why not", "👍"). */
const YES_WORD =
  "(?:yes|yeah|yea|yeh|yep|yup|ya|y|aye|sure|sure thing|please|absolutely|definitely|deffo|go on|go ahead|go for it|do it|let's do it|lets do it|let's go|lets go|let's|go|deal|why not|sounds good|sounds great|sounds perfect|sounds fine|looks good|looks great|that works|works for me|love it|be great|would be great|that would be great|that'd be great|that'd be good|that would be good|please do|yes please|of course|course|ok go|okay go)";
/** Acknowledgements: agreement only after an offer, never after a refusal (review r2 S1). */
const ACK_WORD = '(?:ok|okay|k|kk|alright|aight|right|fine|ok then|okay then)';
/** Thanks, praise and sign-offs: never agreement on their own (review r2 S1). */
const SOFT_WORD = '(?:thanks|thank you|ta|cheers|cool|great|perfect|nice|lovely|brilliant|awesome|ace|mate|coach|then|now|x|xx|for me|though|tho|lol|lmao|haha+|hehe+|ha+)';
/** Review r4 N1: thanks in an acknowledgement ("ok thanks") is a sign-off, never a yes to build. */
const THANKS = /(?:^| )(?:thanks|thank you|ta|cheers)(?= |$)/;
// Review r5 S3: "can you not just add it", "can't you just add it" (pushback; "can you not add it" alone may mean "don't").
const FOLLOW_LEAD = "(?:(?:can|could|would|will) you (?:please |just )?|(?:can|could) you not just |(?:can't|cant|couldn't|couldnt) you (?:just )?|you can |please |just |go ahead and |now |then |and )*";
const FOLLOW_VERB = '(?:add|put|save|load|stick|pop|chuck|throw|turn|build|create|set|start|plug)';
/** Review r2 N1: these only with an object ("make it", never a bare "do"); "log it" means he did it, so it's out. */
const FOLLOW_VERB_WITH_OBJECT = '(?:make|do|get)';
const FOLLOW_OBJECT = '(?:it|that|this|them|those|these|(?:that|this|the|your) (?:one|session|workout|plan|routine|day)|(?:that|this|the) (?:push|pull|leg|legs|upper|lower|full body) (?:session|workout|day))';
const FOLLOW_PLACE =
  "(?:(?:in|into|to|on|onto) (?:the |my |your )?(?:app|workouts?|routines?|library|phone)|(?:as|into) (?:a |an )?(?:new )?(?:workout|session|routine|draft)|a (?:workout|session|routine|draft)|(?:to|for) today(?:'s| is)?(?: (?:workout|session|plan))?|today|in|up|on|for me)";
const SIGN_OFF = `(?:${SOFT_WORD}|please)`;
const FOLLOW = new RegExp(`^${FOLLOW_LEAD}(?:${FOLLOW_VERB}(?: ${FOLLOW_OBJECT})?|${FOLLOW_VERB_WITH_OBJECT} ${FOLLOW_OBJECT})(?: ${FOLLOW_PLACE})*$`);
/** "in the app please", "yes in the app", "to my workouts" (review r2 B1): the place alone, after the coach's plan. */
// Review r5 S3: "i want it in the app", "i'd like it in my workouts".
const PLACE_ONLY = /^(?:(?:can you |please )?(?:put it |add it |(?:i )?(?:want|need) (?:it|that|this|them) |i'd like (?:it|that|this|them) |i would like (?:it|that|this|them) )?)?(?:in|into|to|on|onto) (?:the |my |your )?(?:app|workouts?|routines?|library)$/;
/** Ben pushing back that the app can do it (build 131 review S2): "the app can do it", "it has a workout builder". */
const PUSHBACK =
  /^(?:(?:but|well|yes|yeah|no|nah|actually) )*(?:the app|this app|the app itself|you|it) (?:can|could|does|do|has|have|has got|should be able to)(?: (?:a|an|got))? (?:do (?:it|that|this)|(?:a )?(?:workout |session )?builder|build(?: (?:it|that|them|workouts?|sessions?))?|add(?: (?:it|that|them|workouts?|sessions?))?|make (?:it|that|workouts?|sessions?))(?: (?:in|on) (?:the |this )?app)?$/;
const WORD = `(?:${YES_WORD}|${ACK_WORD}|${SOFT_WORD})`;
const AGREE_ONLY = new RegExp(`^${WORD}(?: ${WORD})*$`);
const HAS_YES = new RegExp(`(?:^| )${YES_WORD}(?= |$)`);
const HAS_ACK = new RegExp(`(?:^| )${ACK_WORD}(?= |$)`);
const AGREE_LEAD = new RegExp(`^(?:${WORD} )+`);
const SIGN_OFF_TAIL = new RegExp(`(?: ${SIGN_OFF})+$`);
/** A length on its own ("45 mins", "an hour", "half an hour"): a change after a yes (review r2 B1). */
const LENGTH = /^(?:(?:make it|keep it|only|just|about|around|max|for) )?(?:\d{1,3} ?(?:m|min|mins|minutes?|h|hr|hrs|hours?)|(?:an|one|1|half an|an and a half|a half) hours?|(?:half|an) hour)\b/;
/** After "but" (or "and", or straight after a yes): a change Ben wants made in the draft ("make it 45 mins", "drop the calf raises", "without dips"). */
const CHANGE_TAIL = /^(?:make it|make that|make them|swap|switch|drop|lose|remove|cut|skip|add|replace|change|use|no|without|with|less|more|shorter|longer|only|just|keep|leave out|take out|instead|go|throw in|chuck in|stick in|put in|include)\b/;
/** After "but": a question, which is never a build ("yes, but why split squats?"). */
const QUESTION_TAIL = /^(?:why|what|how|when|where|which|who|is|are|was|were|do|does|did|can|could|should|would|will|isn't|aren't|don't)\b/;

/** Text-speak "u" as a word on its own; never "U-bar row" (review N1). */
export function expandTextSpeak(text: string): string {
  return text.replace(/(?<![\w-])u(?![\w-])/g, 'you').replace(/(?<![\w-])ur(?![\w-])/g, 'your');
}

/** Lower case, text-speak, thumbs-up as "yes", other emoji and punctuation as spaces. "why not" is agreement, not a question. */
function normaliseReply(text: string): string {
  return expandTextSpeak(text.toLowerCase().replace(/[‘’]/g, "'"))
    .replace(/(?:👍|👌|✅|💪|🙌|🤙)\p{Emoji_Modifier}?/gu, ' yes ')
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D/gu, ' ')
    .replace(/\bpls\b|\bplz\b/g, 'please')
    .replace(/\bwhy not\b/g, 'yes')
    .replace(/[.,!?;:…—–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A change Ben wants made after his yes ("45 mins", "without dips", "and add some biceps", "but make it 45 mins"). */
function isChange(rest: string): boolean {
  // Review r4 S3: "yes, maybe add curls" is a yes with a change.
  const r = rest.replace(/^(?:and|but|with|just|so|then|maybe|perhaps) /, '');
  return CHANGE_TAIL.test(r) || LENGTH.test(r);
}

function followCore(t: string): FollowKind | null {
  if (t === '') return null;
  if (AGREE_ONLY.test(t)) return HAS_YES.test(t) ? 'accept' : HAS_ACK.test(t) && !THANKS.test(t) ? 'ack' : null;
  const lead = AGREE_LEAD.exec(t)?.[0] ?? '';
  const body = t.slice(lead.length).replace(SIGN_OFF_TAIL, '').trim();
  if (FOLLOW.test(body) || PUSHBACK.test(body) || PLACE_ONLY.test(body)) return 'explicit';
  // Review r2 B1: "yes, 45 mins", "yes without dips", "yes and add some biceps" are a yes with a change.
  return HAS_YES.test(lead.trim()) && isChange(body) ? 'explicit' : null;
}

/**
 * How Ben's words read as agreement: `explicit` asks to have it in the app, `accept` is a yes
 * ("yes", "go on then", "👍"), `ack` is an acknowledgement ("ok", "alright") that counts only
 * after the coach offered. Thanks and praise on their own ("cool", "thanks mate") are none of these.
 */
export type FollowKind = 'explicit' | 'accept' | 'ack';

/**
 * Ben's words after the coach described a session: `explicit` asks to have it
 * in the app ("add it", "put that in the app", "yes u can add in the app",
 * "the app can do it", "yes but make it 45 mins", "yes without dips", "in the
 * app please"), `accept` is a yes ("yes", "go on then", "sounds great"),
 * `ack` an acknowledgement ("ok"), null is anything else (a question, a
 * change of topic, a "no", thanks or praise alone). The whole message must be
 * the follow-up: "yes, but why split squats?" is a question, not a build. A
 * change after a yes or an add is explicit: the model gets the change in his
 * words and makes a draft (BD16). Pure.
 */
export function buildFollowUp(text: string): FollowKind | null {
  const t = normaliseReply(text);
  if (t === '') return null;
  const but = /^(.*?) but (.+)$/.exec(t);
  if (but !== null) {
    const head = followCore((but[1] ?? '').trim());
    const tail = (but[2] ?? '').trim();
    if (head === null || text.includes('?') || QUESTION_TAIL.test(tail)) return null;
    return isChange(tail) ? 'explicit' : null;
  }
  return followCore(t);
}

/** "no", "not now", "later", "don't", "I'll do it myself": Ben turning the offer down. */
const REFUSAL =
  /^(?:no|nah|nope|naw|na|not|don't|dont|do not|never ?mind|forget it|leave it|skip it|hold (?:on|off)|wait|stop|i'm (?:good|ok|okay|fine|alright)|im (?:good|ok|okay|fine)|all good)\b|\b(?:later|not now|not yet|not today|not right now|not for now|another time|other time|no thanks|no thank you|no need|don't bother|dont bother|don't worry|dont worry|don't (?:add|build|make|put|save|need|want)|myself|i'll do it|ill do it)\b/;
/** A question anywhere, or a question word ("what about pull", "how long is it"). */
const QUESTION_WORD =
  /(?:^| )(?:why|what|how|when|where|which|who|whats|what's|hows|how's)(?= |$)|^(?:is|are|was|were|isn't|aren't) (?:it|that|this|there|they)(?= |$)|^(?:do|does|did|can|could|should|would|will|shall) (?:i|you|we|they)(?= |$)|^(?:does|did) (?:it|that|this)(?= |$)/;
/** A remark about the plan ("looks heavy", "that's a lot"): Ben talking, not agreeing. A pleased remark is agreement. */
const REMARK = /^(?:looks|seems|feels|sounds|that's|that is|thats|it's|it is|its|bit|a bit|quite|very|too|hmm|hm|um|erm)\b/;
/**
 * Review r3 S1: not a yes, not a no. Ben is holding off, stepping away or laughing ("maybe", "I'll think
 * about it", "not sure", "brb", "one sec", "lol"). Never a build.
 */
const HOLD_OFF =
  /^(?:maybe|perhaps|possibly|might|idk|dunno|i dunno|i don't know|i dont know|not sure|unsure|brb|bbs|one sec|1 sec|a sec|sec|one min|1 min|a min|one minute|hang on|hold up|gimme a (?:sec|min)|lol|lmao|haha+|ha+|hehe+)\b|\b(?:think about it|thinking about it|have a think|let me think|i'll see|ill see|we'll see|see how i feel|not sure|maybe|perhaps|brb|one sec|lol|haha+)\b/;
/** Replies longer than this aren't read as a "yes" to the offer: Ben has moved on to something else. */
const OFFER_REPLY_MAX_WORDS = 15;

/**
 * Ben's reply to the coach's own "Want me to build it in the app?" (review r2 B1). The offer is the
 * clear signal, so the rule is inverted: any reply that isn't a question, a refusal, a remark, a pain
 * mention or thanks/praise on its own opens `propose_workout` ("go on then", "aye", "yes, 45 mins",
 * "yes and add some biceps"). His words go to the model as the change; the result is only a draft
 * (BD12, BD15). Pure.
 */
export function acceptsBuildOffer(text: string): boolean {
  const t = normaliseReply(text);
  // Review r3 S1: a pain word, even an unclear one ("my shoulder feels a bit tight"), is asked about first (rule 9).
  if (t === '' || text.includes('?') || REFUSAL.test(t) || classifyPainMention(text) !== 'none') return false;
  if (buildFollowUp(text) !== null) return true;
  // Review r4 S3: "yes lol", "haha yes go on" are a yes; a hold-off counts only with no yes-family word.
  if (HOLD_OFF.test(t) && !HAS_YES.test(t)) return false;
  if (QUESTION_WORD.test(t) || AGREE_ONLY.test(t) || REMARK.test(t)) return false;
  return t.split(' ').length <= OFFER_REPLY_MAX_WORDS;
}

/** The coach's shown words on a stored message (what Ben saw), or null for Ben's own. */
function coachSentences(m: CoachMessage): string[] {
  return m.body.role === 'coach' ? m.body.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : [])) : [];
}

function benWords(m: CoachMessage | undefined): string | null {
  return m !== undefined && m.body.role === 'ben' && m.body.input.kind === 'words' ? m.body.input.text : null;
}

export interface BuildFollowUp {
  /** Ben's words that led to the coach's plan (the earlier request), quoted as data for length and focus. */
  priorBenText: string | null;
  /**
   * Ben's own words in the thread from that request on, newest first ("Yes but make it
   * 45 mins", then the request). Length and focus are read from these, never the coach's.
   */
  benTexts: string[];
  /** `loose`: offer the tool, but don't hold the text answer or force the call (review r3 S1). */
  strength: FollowStrength;
}

/** Review r3 S2: "yes you can", "you can though", "yes it can" (bare pushback after a "can't"). */
const PUSHBACK_BARE = /^(?:(?:yes|yeah|yep|yup|but|well|actually|no|nah|erm|um|mate|coach) )*(?:you|it|the app|this app|the coach) (?:(?:definitely|really|actually|totally|surely|do|does) )*(?:can|could|do|does|should be able to)(?: (?:though|tho|actually|really|now|too|mate|coach|man|lol|already))*$/;
/** Review r3 S2: "there is a workout builder", "the app does have a builder", "you do have a tool", "you do have access". */
const PUSHBACK_HAS = /^(?:(?:yes|yeah|yep|but|well|actually|no|nah|erm|um) )*(?:you|it|the app|this app|there|there's|theres|there is|there are) (?:(?:do|does|definitely|really|actually|totally|already) )*(?:(?:has|have|is|are|'s|s|got|has got|have got) )?(?:a |an |the |got |one|access)?(?: ?(?:workout|session|build|building|workout-?building|draft)[- ]?)?(?:builder|tool|feature|function|access|one)?(?: (?:for (?:that|this|it|workouts?|sessions?)|in (?:the|this) app|now|though|tho|mate|coach))*$/;
/** Review r3 S2: "use the workout builder", "use your tool". */
const USE_TOOL = /^(?:(?:just|please|can you|could you|then|so) )*use (?:the |your |a |that )?(?:workout |session |build |app'?s? )?(?:builder|tool|feature|function)(?: (?:then|please|for (?:it|that|this)|in the app))*$/;
/** Review r3 S2: retries ("try again", "can you try again", "just try", "yes try", "check again", "make a draft"). */
const RETRY =
  /^(?:(?:yes|yeah|yep|ok|okay|please|just|can you|could you|will you|would you|go on|then|and|so|now) )*(?:(?:try|check|look|have a go|give it a go|give it a try|give it another go|go)(?: it| that)?(?: (?:again|once more|one more time|now|properly))+|try(?: it| that)?|retry|make (?:a |the |me a |it a |it as a )?draft(?: of (?:it|that|this))?|build (?:a |the |me a )?draft(?: of (?:it|that|this))?|do (?:a|the) draft)(?: (?:please|then|for me|mate|coach|in the app))*$/;

/** Review r4 N2: a bare "try that" / "try it" may mean "I'll try that at the gym": a retry only after a refusal. */
const BARE_TRY = /^(?:(?:yes|yeah|yep|ok|okay|just|so|and|then) )*try(?: it| that)?$/;

/**
 * After a "can't" (or the app's ask line), Ben pushing back or asking for a retry (review r3 S2).
 * `afterRefusal: false` (his build request went unbuilt but the coach never said it couldn't): a
 * bare "try that" isn't a retry (review r4 N2).
 */
export function retriesBuild(text: string, opts: { afterRefusal?: boolean } = {}): boolean {
  const t = normaliseReply(text).replace(/\b(?:does|do) have\b/g, 'has');
  if (t === '') return false;
  if (opts.afterRefusal === false && BARE_TRY.test(t)) return false;
  return PUSHBACK_BARE.test(t) || PUSHBACK_HAS.test(t) || USE_TOOL.test(t) || RETRY.test(t);
}

/**
 * How firmly Ben's words follow up. `clear`: an explicit ask, a yes to an offer, a yes or a retry
 * after a "can't" or after his own build request went unbuilt. `loose`: only the inverted rule after
 * an offer read it as a yes ("I'm going at 6"); the tool is offered but the model isn't held to it
 * (review r3 S1).
 */
export type FollowStrength = 'clear' | 'loose';

/**
 * Do Ben's words follow up on the coach's last message (`last`, its shown sentences)?
 * - It offered to build: any reply that isn't a question, a refusal, a hold-off or thanks alone
 *   (`acceptsBuildOffer`); `clear` only when the words themselves agree.
 * - It said it couldn't, or answered Ben's own build request without a draft (`answeredAsk`, review
 *   r3 S3): an explicit ask, a yes ("yes", "ok go"), pushback or a retry ("yes you can", "try again");
 *   never "ok thanks" or "cool" (review r2 S1).
 * - Otherwise (a plan in text, no offer): only an explicit ask ("add it", "put that in the app").
 */
function followsUp(text: string, last: readonly string[], answeredAsk: boolean, refusedBuild: boolean): FollowStrength | null {
  const kind = buildFollowUp(text);
  if (kind === 'explicit') return 'clear';
  const refused = last.some((s) => claimsNoBuildTool(s, { generic: true }) || s === BUILD_ASK_LINE) || refusedBuild;
  if ((refused || answeredAsk) && (kind === 'accept' || retriesBuild(text, { afterRefusal: refused }))) return 'clear';
  if (offersToBuild(last.join(' '))) {
    if (!acceptsBuildOffer(text)) return null;
    // A yes, or the change he wants in it ("without the calf raises", "45 mins"), is clear.
    return kind === 'accept' || kind === 'ack' || isChange(normaliseReply(text)) ? 'clear' : 'loose';
  }
  return null;
}

/** How many coach messages back a follow-up may reach (review B2: one side question, or a refusal, in between). */
export const FOLLOW_UP_WINDOW = 3;

/**
 * Is Ben's message (`text`) a follow-up that asks to put the session the
 * coach described into the app? Reads back over the last `FOLLOW_UP_WINDOW`
 * coach messages for a plan in text, a coach offer to build, or an earlier
 * Ben build request the coach answered without building. Stops at a coach
 * message that saved something (a draft there has its own `Open` and BD15's
 * fixed line). A bare "yes" counts only when the last coach message offered
 * to build, or said it couldn't (Ben is agreeing to try again).
 */
export function buildFollowUpIn(history: readonly CoachMessage[], text: string, refusedBuildIds: ReadonlySet<string> = new Set()): BuildFollowUp | null {
  const sorted = [...history].sort((a, b) => a.ordinal - b.ordinal);
  // Review r4 S4: a refused or stale `build_workout` saved nothing, so its message reads like one with no action.
  const saved = (m: CoachMessage): boolean => m.body.role === 'coach' && m.body.actionIds.some((id) => !refusedBuildIds.has(id));
  const refusedBuild = (m: CoachMessage): boolean => m.body.role === 'coach' && m.body.actionIds.some((id) => refusedBuildIds.has(id));
  const coachAts = sorted.flatMap((m, i) => (m.body.role === 'coach' ? [i] : [])).reverse();
  const lastAt = coachAts[0];
  if (lastAt === undefined) return null;
  const lastMessage = sorted[lastAt] as CoachMessage;
  const last = coachSentences(lastMessage);
  // Review r3 S3: the coach answered Ben's own build request without making a draft (the held text plan).
  const lastBenAt = sorted.slice(0, lastAt).map((x) => x.body.role).lastIndexOf('ben');
  const lastBen = lastBenAt < 0 ? null : benWords(sorted[lastBenAt]);
  const answeredAsk = lastMessage.body.role === 'coach' && !saved(lastMessage) && lastBen !== null && requestHas(classifyBenRequest(lastBen, 'general'), 'build');
  const strength = followsUp(text, last, answeredAsk, refusedBuild(lastMessage));
  if (strength === null) return null;
  let anchorAt: number | null = null;
  let anchorBenAt: number | null = null;
  for (const at of coachAts.slice(0, FOLLOW_UP_WINDOW)) {
    const m = sorted[at];
    if (m === undefined || m.body.role !== 'coach' || saved(m)) break;
    const said = coachSentences(m).join(' ');
    const benAt = sorted.slice(0, at).map((x) => x.body.role).lastIndexOf('ben');
    const prior = benAt < 0 ? null : benWords(sorted[benAt]);
    const asked = prior !== null && requestHas(classifyBenRequest(prior, 'general'), 'build');
    if (describesWorkoutPlan(said) || asked || offersToBuild(said) || refusedBuild(m)) {
      anchorAt = at;
      anchorBenAt = benAt < 0 ? null : benAt;
    }
  }
  if (anchorAt === null) return null;
  const from = anchorBenAt ?? anchorAt;
  const benTexts = sorted
    .slice(from)
    .flatMap((m) => {
      const w = benWords(m);
      return w === null ? [] : [w];
    })
    .reverse();
  return { priorBenText: anchorBenAt === null ? null : benWords(sorted[anchorBenAt]), benTexts, strength };
}

export interface BuildAskInput {
  turnKind: CoachTurnKind;
  text: string;
  /** A coach draft is in context (BD16). */
  draftInContext: boolean;
  /** `buildFollowUpIn(thread, text)`. */
  followUp: BuildFollowUp | null;
}

/** The one decision: does this general turn get `propose_workout` and its build context? */
export function asksForBuild(input: BuildAskInput): boolean {
  if (input.turnKind !== 'general') return false;
  return requestHas(classifyBenRequest(input.text, 'general'), 'build') || (input.draftInContext && revisesDraft(input.text)) || input.followUp !== null;
}

/**
 * The words code reads the length and focus from (§8.2 `parseRequestedMinutes`
 * / `parseRequestedFocus`): Ben's own, the earlier ones first, then now. Never
 * the coach's text. Quoted as data (rule 8).
 */
export function buildRequestWords(text: string, followUp: BuildFollowUp | null): string {
  const earlier = followUp === null ? [] : [...followUp.benTexts].reverse();
  return [...earlier, text].join('\n').slice(-2000);
}

/**
 * Ben's words newest first (now, then the follow-up's earlier ones): the first that names a
 * length or focus wins, so "yes but make it 45 mins" beats the request's "an hour".
 */
export function buildWordsNewestFirst(text: string, followUp: BuildFollowUp | null): string[] {
  return [text, ...(followUp?.benTexts ?? [])];
}

const NO_BUILD_SUBJECT = "\\b(?:i|i'm|i am|the app|this app|this chat|there's|there is|we)\\b";
const NO_BUILD_CANNOT = "(?:don't|do not|doesn't|does not|can't|cannot|can not|won't|am unable to|'m unable to|unable to|am not able to|'m not able to|not able to|have no|has no|no)";
const NO_BUILD_LEAD = `${NO_BUILD_SUBJECT}[^.?!]{0,20}?\\b${NO_BUILD_CANNOT}\\b`;
/** A workout or session, with only articles or focus words before it ("a push workout", "today's session"); never "a programme". */
const WORKOUT_OBJECT =
  "(?:(?:a|an|the|this|that|these|those|your|my|any|new|custom|full|whole|complete|actual|proper|real|today's|today is|quick|short|push|pull|legs?|leg day|upper|lower|body|full-body|chest|back|arms?|shoulders?) ){0,3}(?:workouts?|sessions?|routines?)";
const BUILD_VERBS = '(?:create|creating|build|building|make|making|add|adding|put|putting|set up|setting up|load|loading|design|designing)';
/** "I can't build workouts here", "I can't put it into the app for you". */
/** Not a new workout: a change to one ("make the session easier") or a part of one ("the session timer"). */
const NOT_NEW = "(?![- ](?:easier|harder|lighter|heavier|shorter|longer|quicker|any|more|less|timer|notes?|data|history|log|count|length)\\b)";
const CANT_BUILD = new RegExp(
  `${NO_BUILD_LEAD}[^.?!]{0,12}?\\b${BUILD_VERBS} (?:${WORKOUT_OBJECT}\\b${NOT_NEW}|(?:it|that|this|them) (?:in|into|to|on|onto) (?:the |this |your )?(?:app|workouts)\\b)`,
);
/** "I don't have access to a workout-creation tool", "there's no tool for adding workouts". */
const NO_BUILD_TOOL = new RegExp(
  `${NO_BUILD_LEAD}[^.?!]{0,30}?\\b(?:(?:workout|session|routine)[- ](?:creation|creating|building|builder|creator)(?: (?:tool|feature|function))?|(?:tool|ability|way|feature|function|access) (?:to|for) (?:${BUILD_VERBS}|save|saving|store|storing) ${WORKOUT_OBJECT}\\b)`,
);
/**
 * A refusal that names no workout (review r2 S3): "I can't do that in the app.", "I don't have a tool
 * for that." Read as a no-build claim only where Ben asked for a build (`claimsNoBuildTool` `generic`).
 */
const GENERIC_NO_BUILD = new RegExp(
  `${NO_BUILD_LEAD}[^.?!]{0,12}?\\b(?:do (?:that|it|this)(?: for you)? (?:in|on|from|through|with) (?:the |this )?app\\b|(?:a |any )?(?:tool|way|function|feature|ability) (?:for|to do) (?:that|this|it)\\b)`,
);

/** Review r3 S4: "I can only describe workouts here, not add them." */
const ONLY_DESCRIBE = /\b(?:i|we) can only (?:describe|suggest|write(?: out)?|outline|list|plan|give|talk (?:about|through)|recommend|lay out|sketch)\b[^.?!]{0,40}?\b(?:not|but not|can't|cannot|rather than|instead of) (?:add|adding|build|building|create|creating|save|saving|put|putting|make|making|load|loading)\b/;
/** Review r3 S4: "adding it to the app isn't something I can do." */
const NOT_SOMETHING_I_CAN =
  /\b(?:adding|putting|building|creating|saving|loading|making|setting up)\b[^.?!]{0,25}?\b(?:app|workouts?|sessions?|routines?)\b[^.?!]{0,12}?\b(?:isn't|is not|'s not|isnt) (?:something|a thing|anything|possible)\b/;
/** Review r3 S4: "You'll need to add it in the app yourself." */
const DO_IT_YOURSELF = new RegExp(
  `\\byou(?:'ll| will|'d|'ll have| would)? ?(?:need|have|got) to (?:add|build|create|put|enter|set up|make|load|type)\\b (?:(?:it|that|this|them)\\b|${WORKOUT_OBJECT}\\b)[^.?!]{0,30}?\\b(?:yourself|manually|by hand)\\b`,
);
/** Review r3 S4 (generic only): "That's not something I can do from this chat." */
/** Review r4 N3 (generic only): "Sorry, that's outside what I can do here." */
const OUTSIDE_WHAT_I_CAN = /\b(?:that|this|it)(?:'s| is|s) (?:outside|beyond) (?:what (?:i|we) can do|my (?:abilities|scope|remit))\b/;
const NOT_SOMETHING_GENERIC = /\b(?:that|this|it)(?:'s not| is not| isn't|s not|'s|s| is) (?:not )?(?:something|a thing|anything) (?:i|we) (?:can|can't|cannot|can not|am able to|could) do\b/;
/** Review r3 S4 (generic only): "Unfortunately I can't save sessions." Generic, so a true "I can't save it for you" elsewhere stays. */
const CANT_SAVE = new RegExp(
  `${NO_BUILD_LEAD}[^.?!]{0,12}?\\b(?:save|saving|store|storing) (?:${WORKOUT_OBJECT}\\b${NOT_NEW}|(?:it|that|this|them) (?:in|into|to|on|onto) (?:the |this |your )?(?:app|workouts)\\b)`,
);

/**
 * The coach saying it can't build a workout or put one in the app ("I don't
 * have access to a workout-creation tool", "I can't build workouts here").
 * Only workout or session nouns count: "I can't add exercises to today's
 * workout", "I can't create a programme" and "I don't have your Health data"
 * are true limits and stay (review B1). The reply filter uses it only on a
 * general turn where the app can build one and no draft was made (`createReplyFilter`).
 * `generic` also reads a refusal that names no workout ("I can't do that in the app"):
 * only where Ben asked for a build, so "can you sync Garmin?" keeps its true answer.
 */
export function claimsNoBuildTool(sentence: string, opts: { generic?: boolean } = {}): boolean {
  const t = sentence.toLowerCase().replace(/[’]/g, "'");
  if (CANT_BUILD.test(t) || NO_BUILD_TOOL.test(t) || ONLY_DESCRIBE.test(t) || NOT_SOMETHING_I_CAN.test(t) || DO_IT_YOURSELF.test(t)) return true;
  // "I can't save it for you, open it and tap Save" is true (BD15): only a flat "can't save sessions" counts.
  const saveIsBens = /\bfor (?:you|him)\b|\btap\b|\bopen it\b|\byourself\b/.test(t);
  return opts.generic === true && (GENERIC_NO_BUILD.test(t) || NOT_SOMETHING_GENERIC.test(t) || OUTSIDE_WHAT_I_CAN.test(t) || (CANT_SAVE.test(t) && !saveIsBens));
}

/** Shown in place of a "can't build" sentence: what works (minimal copy). */
export const BUILD_ASK_LINE = 'Say "Build me a workout" to get a draft.';

/**
 * Shown once in place of a hidden promise or "can't build" sentence when the turn can't build (no
 * `propose_workout` on it), or in place of a "can't build" when it could: the fixed offer, which a
 * "yes" next turn accepts (`offersToBuild`). Review r4 B2, S5.
 */
export const BUILD_OFFER_LINE = 'Want me to build it in the app?';

/**
 * The place a new workout went: the app, the Workouts tab, drafts. Review r4 B2: never "in your
 * workout history", "in your workouts from Tuesday", "your workout log for last week".
 */
/** Review r6 B2: a place followed, in the same clause, by History or a log ("in the app under History", "in the app's History tab"). */
const PLACE_NOT_HISTORY = "(?![^.?!]{0,25}\\b(?:history|log|logs|logbook|calendar)\\b)";
const BUILT_PLACE =
  `(?:(?:in|into|to|on|onto|under) (?:the |this |your |my )?(?:app|workouts?(?: tab| list| page)?|routines?|library|drafts?)\\b(?![- ](?:history|log|logs|from|last|on (?:mon|tue|wed|thu|fri|sat|sun)|for (?:last|the last))\\b)${PLACE_NOT_HISTORY})`;
const BUILT_PRONOUN = '(?:it|that|this|them|one|the (?:workout|session|draft|routine)|your (?:workout|session|draft|routine))';
/** A pronoun's own tail that makes it a workout in the app (review r4 B2): never "make it quick", "put it simply". */
const PRONOUN_TAIL = `(?:up )?(?:for you|right now|now|together|${BUILT_PLACE})`;
const BUILT_VERB = '(?:set|put|add|get|save|load|build|create|make|pop|stick|throw|chuck|plug|slot|whip|knock)';
const BUILT_VERB_ING = '(?:setting|putting|adding|getting|saving|loading|building|creating|making|popping|sticking|throwing|plugging|slotting|whipping|knocking|drafting)';
const BUILT_VERB_ED = '(?:set up|put|added|saved|loaded|built|created|made|popped|stuck|thrown|plugged|slotted|whipped up|knocked up|drafted|sorted)';
/** A new workout as the object ("a push session", "your workout"), not a part or a change of one. */
const NEW_WORKOUT = `(?:${WORKOUT_OBJECT}\\b${NOT_NEW}(?! (?:from|history|log|last)\\b))`;
/** Either a workout, or a pronoun with a tail, or the place. */
const BUILT_OBJECT = `(?:(?:you |him )?${NEW_WORKOUT}|${BUILT_PRONOUN} ${PRONOUN_TAIL}|${BUILT_PRONOUN} up\\b[^.?!]{0,20}?${BUILT_PLACE}|[^.?!]{0,30}?${BUILT_PLACE})`;
const PRONOUN_SUBJECT = "(?:it's|it is|its|that's|that is|thats|this is|they're|they are|it has been|it's been|that's been|it has|that has)";
const NOUN_SUBJECT = `(?:${WORKOUT_OBJECT}(?: is|'s| has been| are|'s been))`;
const DONE_STATE = '(?:ready|built|created|set up|loaded|waiting|added|saved|made|done|sorted)';
/**
 * Review r6 B2: the subject of an explicit (every-turn) noun claim reads as a new workout: at the start
 * of the sentence (after "Done,", "OK,"), an indefinite article, or "your/the" with a focus ("Your pull
 * session"). Never a past one ("Last week's pull session", "Tuesday's leg session", "Your last
 * session", "Your session"): those are history answers. A routine is left out (Ben's saved routines
 * really are in Workouts).
 */
const NEW_SUBJECT =
  "^(?:(?:ok|okay|sure|right|great|cool|done|all done|yes|yep|perfect|there you go|here you go|and|so),? )*(?:(?:a|an|another|one more|new|fresh)(?: (?:new|fresh|quick|short))?(?: " +
  "(?:push|pull|legs?|leg day|upper|lower|upper body|lower body|full-body|full body|chest|back|arms?|shoulders?|\\d{1,3}[- ]?(?:min|minute)s?)){0,3}" +
  "|(?:your|the)(?: (?:new|fresh|quick|short))?(?: (?:push|pull|legs?|leg day|upper|lower|upper body|lower body|full-body|full body|chest|back|arms?|shoulders?|\\d{1,3}[- ]?(?:min|minute)s?)){1,3}) " +
  "(?:workout|session)(?: is|'s| has been|'s been)";
/**
 * Review r5 B2: a workout noun as the subject reads as a claim only with a build-ish state. "done" and
 * "made" are left out ("Once your workout is done, stretch", "The session is made up of five exercises").
 */
const NOUN_DONE_STATE = '(?:ready|built|created|set up|loaded|waiting|added|saved|sorted)';
/** Review r5 B2: the app itself or its Workouts tab, never "your routines", "History" or a log. */
const APP_PLACE =
  `(?:(?:in|into|to|on|onto|under) (?:the |this |your |my )?(?:app|workouts(?: tab| list| page)?|workout tab|drafts?)\\b(?![- ](?:history|log|logs|from|last|on (?:mon|tue|wed|thu|fri|sat|sun)|for (?:last|the last))\\b)${PLACE_NOT_HISTORY})`;
/** Not about a new workout: where a past one went ("saved in History", "in your log"). */
const NOT_HISTORY = '(?![^.?!]{0,20}\\b(?:history|log|logs|logbook|calendar)\\b)';
/**
 * Review r5 B2: a new workout with an indefinite article ("a pull session", "you another 45 min session").
 */
const NEW_INDEFINITE = "(?:(?:you|him) )?(?:a|an|another|one more|new|fresh)(?: (?:new|fresh|quick|short|full|whole|push|pull|legs?|leg day|upper|lower|body|full-body|chest|back|arms?|shoulders?|\\d{1,3}[- ]?(?:min|minute)s?)){0,3} (?:workout|session|routine)s?\\b";
const FIRST_PERSON_PROMISE = "(?:i'll|i will|i'm going to|i am going to|im going to|i'm gonna|gonna|let me|lemme|i can now|i'll go ahead and|i'll just)\\s+(?:go ahead and |just |now |quickly )?";

/**
 * Explicit claims: a new workout, draft or session built, added or saved in the app. Hidden on any
 * turn that can build and saved no draft. Review r4 B2: each needs a workout noun, or a pronoun with
 * "for you" or a place, after a promise, done or progress verb. Review r5 B2: a workout noun as the
 * subject counts here only with the app or the Workouts tab as the place.
 */
const EXPLICIT_CLAIMS: readonly RegExp[] = [
  // Promises: "I'll set that up for you", "Let me put that in the app", "I will build you a push session".
  new RegExp(`\\b${FIRST_PERSON_PROMISE}${BUILT_VERB}(?: up)? ${BUILT_OBJECT}`),
  // In progress: "I'm setting that up now", "I'm building your session".
  new RegExp(`\\b(?:i'm|i am|im|now)\\s+${BUILT_VERB_ING}(?: up)? ${BUILT_OBJECT}`),
  // In progress, no subject, only with a place: "Adding it to the app." ("Adding a set this week would help" stays.)
  new RegExp(`^(?:(?:ok|okay|sure|right|great|cool),? )?${BUILT_VERB_ING}(?: up)?\\b[^.?!]{0,30}?${BUILT_PLACE}`),
  // Done: "I've added it to your workouts", "I have set up the session", "I built a push session".
  new RegExp(`\\b(?:i've|i have|ive|i)\\s+(?:just |now |already )?${BUILT_VERB_ED}(?: up)? ${BUILT_OBJECT}`),
  // Ready in a place: "It's ready in your workouts".
  new RegExp(`\\b${PRONOUN_SUBJECT}\\s+(?:now |all |already |been )*${DONE_STATE}\\b[^.?!]{0,30}?${BUILT_PLACE}`),
  // A new workout ready in the app: "Your push session is ready in the Workouts tab", "A new pull session is saved in the app."
  new RegExp(`${NEW_SUBJECT}\\s+(?:now |all |already |been )*${NOUN_DONE_STATE}\\b[^.?!]{0,30}?${APP_PLACE}`),
  // A new workout in the app: "Your push session is in the app." Not a routine: Ben's saved routines really are in Workouts.
  new RegExp(`${NEW_SUBJECT}\\s+(?:now |all |already )*${APP_PLACE}`),
  // A promise of where to look: "You should see it in the app shortly", "You'll find it in Workouts".
  new RegExp(`\\byou(?:'ll| will| should| can now|'ll now)\\s+(?:now |soon )?(?:see|find|have)\\s+${BUILT_PRONOUN}\\b[^.?!]{0,20}?${BUILT_PLACE}`),
];

/** A claim of a new workout with an indefinite article ("I'll make you a new 45 min legs session"). */
const NEW_WORKOUT_CLAIMS: readonly RegExp[] = [
  new RegExp(`\\b${FIRST_PERSON_PROMISE}${BUILT_VERB}(?: up)? ${NEW_INDEFINITE}`),
  new RegExp(`\\b(?:i'm|i am|im|now)\\s+${BUILT_VERB_ING}(?: up)? ${NEW_INDEFINITE}`),
  new RegExp(`\\b(?:i've|i have|ive|i)\\s+(?:just |now |already )?${BUILT_VERB_ED}(?: up)? ${NEW_INDEFINITE}`),
];

/**
 * Claims that are about a workout only when one is being talked about (a build in play this turn):
 * "it's saved", "It's been added", "I've set it up", "On it!", "Coming right up", "Done!", "adding that
 * now", "Open it from Workouts", "It's in the app", "Your push session is ready." Review r4 S1, r5 B2.
 * Elsewhere they are ordinary words.
 */
const IN_PLAY_CLAIMS: readonly RegExp[] = [
  new RegExp(`\\b${PRONOUN_SUBJECT}\\s+(?:now |all |already |been )*${DONE_STATE}\\b(?: (?:for you|now|to go|and waiting|up))*\\s*[.!]*$`),
  new RegExp(`\\b(?:i've|i have|ive|i)\\s+(?:just |now |already )?${BUILT_VERB_ED}(?: up)? ${BUILT_PRONOUN}\\b(?: up)?(?: (?:for you|now|already))*\\s*[.!]*$`),
  new RegExp(`\\b(?:i've|i have|ive)\\s+(?:just |now |already )?(?:set|put|got) ${BUILT_PRONOUN} up\\b`),
  /^(?:(?:ok|okay|sure|right|great|cool|yes|yep),? )?(?:on it|coming (?:right )?up|done|all done|sorted|all sorted|here you go|there you go|there we go|consider it done)\s*[.!]*$/,
  new RegExp(`^(?:(?:ok|okay|sure|right|great|cool),? )?(?:i'm |im |now )?${BUILT_VERB_ING}(?: up)? ${BUILT_PRONOUN}\\b(?: up)?(?: (?:now|for you|right now))*\\s*[.!]*$`),
  new RegExp(`\\b${PRONOUN_SUBJECT}\\s+(?:now |all |already )*(?:${BUILT_PLACE}|there now)`),
  new RegExp(`\\byou(?:'ll| will| should| can now|'ll now| can)?\\s+(?:now |soon )?(?:see|find|have)\\s+${BUILT_PRONOUN}\\b[^.?!]{0,20}?${BUILT_PLACE}`),
  /\b(?:open|start) (?:it|that|this|the (?:draft|workout|session)) (?:from|in) (?:the |your )?workouts?(?: tab)?\b/,
  /\b(?:check|look in|head to|go to) (?:your |the )?workouts (?:tab|list|page)\b/,
  new RegExp(`\\b(?:should|will) (?:appear|show up|pop up|be there)\\b[^.?!]{0,30}?${BUILT_PLACE}`),
];
/**
 * Review r5 B2, r6 B2: a workout as the subject, read only with a build in play and never about a past
 * one ("Last week's pull session is in your workouts", "Your last session is saved").
 */
const IN_PLAY_NOUN_CLAIMS: readonly RegExp[] = [
  // Review r5 B2 (moved from the explicit claims): a workout ready, no place ("Your push session is ready.").
  new RegExp(`\\b${NOUN_SUBJECT}\\s+(?:now |all |already |been )*${NOUN_DONE_STATE}\\b${NOT_HISTORY}(?! up of\\b)`),
  // A workout in a place: "Your push session is in the app."
  new RegExp(`\\b${NOUN_SUBJECT}\\s+(?:now |all |already )*${BUILT_PLACE}`),
  // A workout ready in a looser place: "Your session is saved in your routines."
  new RegExp(`\\b${NOUN_SUBJECT}\\s+(?:now |all |already |been )*${NOUN_DONE_STATE}\\b[^.?!]{0,30}?${BUILT_PLACE}`),
];
/** Review r6 B2: a past workout as the subject ("Last week's", "Tuesday's", "Your last", "yesterday's", "finished"). */
const PAST_WORKOUT =
  /\b(?:last|previous|earlier|finished|completed|logged|yesterday's|(?:mon|tues|wednes|thurs|fri|satur|sun)day's|week's|night's|morning's|(?:mon|tue|wed|thu|fri|sat|sun)'s)(?: [a-z-]+){0,3} (?:workouts?|sessions?|routines?)\b/;
/** Statements that are an offer or a true limit, never a claim: "I can build it if you like", "Ben saves it himself". */
const NOT_BUILT_CLAIM = /\b(?:if you (?:like|want|fancy|'d like|would like)|let me know|say the word|just say|want me to|shall i|should i|you can (?:open|start|save)|you open|you start|you save|tap)\b|\b(?:can't|cannot|can not|couldn't|could not|wasn't|was not|isn't|is not|didn't|did not|won't|will not|not) /;

/**
 * Review r3 B1, r4 B2/S1: the coach promising or claiming a workout in the app ("Okay, I'll set that
 * up for you.", "Let me put that in the app.", "It's ready in your workouts."). Only true when this
 * turn saved a draft; the reply filter hides it otherwise. `inPlay`: a build is being talked about
 * this turn (Ben asked, or is following up), so short done-claims ("On it!", "It's saved") count too.
 * Questions and offers never count; history and advice ("It's in your workout history", "Let me put
 * it another way", "Adding a set would help") never do. Pure; the coach's words are data.
 */
export function claimsWorkoutBuilt(sentence: string, opts: { inPlay?: boolean } = {}): boolean {
  const t = sentence.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  if (t === '' || /\?\s*$/.test(t) || OFFER_STATEMENT.test(t) || NOT_BUILT_CLAIM.test(t)) return false;
  // Review r6 B1/B2: read only on a turn where a build is in play (asked, forced or followed up) and,
  // there, with every claim whether or not an older draft exists. Elsewhere never (history passes).
  if (opts.inPlay !== true) return false;
  if (EXPLICIT_CLAIMS.some((re) => re.test(t)) || NEW_WORKOUT_CLAIMS.some((re) => re.test(t))) return true;
  return IN_PLAY_CLAIMS.some((re) => re.test(t)) || (!PAST_WORKOUT.test(t) && IN_PLAY_NOUN_CLAIMS.some((re) => re.test(t)));
}

/**
 * Review r5 S1: the pain reading of a message that may ask for a session. Effort ("a hard push
 * session") is not pain, so it reads as `none`; a muscle-group focus ("a back and biceps session",
 * "a pull session, back and biceps") is a training focus, not Ben's body, so an `unclear` read only
 * from it is `none`. Anything else (pain, or an unclear word outside the focus) stands (rule 9). Pure.
 */
export function buildPainMention(text: string): 'none' | 'pain' | 'unclear' {
  const mention = classifyPainMention(text);
  if (mention === 'none' || mention === 'effort') return 'none';
  if (mention === 'pain') return 'pain';
  const rest = classifyPainMention(withoutFocusRuns(text));
  return rest === 'none' || rest === 'effort' ? 'none' : rest;
}

/**
 * Review r4 (PM, 13 Oct, pending Ben): `propose_workout` is forced (the text answer held, then the
 * call named) only on an unambiguous build request in Ben's own words: a build-kind request ("build /
 * make / plan me a … workout / session"), or a change to the draft in context (BD16). Never with a pain
 * word (rule 9, review r4 B1) and never for a programme or a week (review r4 S2). Every other general
 * turn with a gym only offers the tool. Pure.
 */
export function forcesBuild(text: string, opts: { draftInContext?: boolean } = {}): boolean {
  if (buildPainMention(text) !== 'none' || multiWeekScope(text)) return false;
  return requestHas(classifyBenRequest(text, 'general'), 'build') || (opts.draftInContext === true && revisesDraft(text));
}

/** The `build_workout` actions in the last few coach messages that saved nothing (refused or stale), for `buildFollowUpIn` (review r4 S4). */
export async function refusedBuildActionIds(history: readonly CoachMessage[], listTurnActions: (turnId: string) => Promise<readonly ActionRecord[]>): Promise<Set<string>> {
  const recent = [...history]
    .sort((a, b) => b.ordinal - a.ordinal)
    .filter((m) => m.body.role === 'coach')
    .slice(0, FOLLOW_UP_WINDOW)
    .filter((m) => m.body.role === 'coach' && m.body.actionIds.length > 0);
  const out = new Set<string>();
  for (const m of recent) {
    const actions = await listTurnActions(m.turnId).catch(() => [] as ActionRecord[]);
    for (const a of actions) if (a.detail.kind === 'build_workout' && (a.status === 'rejected' || a.status === 'stale')) out.add(a.actionId);
  }
  return out;
}

/** What a thread's latest clarifying questions say about this turn (workout-builder v2.1 BD17). */
export interface QuestionChain {
  /** Questions asked in this build request (the run of coach messages with a question, newest back). */
  asked: number;
  /** The question on the coach's last message, waiting for Ben's answer; null when there is none. */
  open: ActionRecord | null;
  /** Ben's words answer the open question (`Skip` included): a build follow-up, `clear`. */
  followUp: BuildFollowUp | null;
  /** Ben tapped `Skip`: build with the defaults, no further question. */
  skipped: boolean;
}

/** The `Skip` chip's words (§4.2). Typed "skip" reads the same: build with the defaults. */
export const SKIP_ANSWER = 'Skip';

/**
 * `buildQuestionChain(history, text, actionsOf)`: how many questions this
 * build request has asked, whether the coach's last message is a question
 * waiting for Ben, and (if so) the follow-up his answer makes, carrying his
 * original request's words for the length and focus (never the coach's).
 * Code only; nothing here reads the model's words.
 */
export async function buildQuestionChain(history: readonly CoachMessage[], text: string | null, listTurnActions: (turnId: string) => Promise<readonly ActionRecord[]>): Promise<QuestionChain> {
  const sorted = [...history].sort((a, b) => a.ordinal - b.ordinal);
  const coachAts = sorted.flatMap((m, i) => (m.body.role === 'coach' ? [i] : [])).reverse();
  let asked = 0;
  let open: ActionRecord | null = null;
  let firstAt: number | null = null;
  for (const [k, at] of coachAts.entries()) {
    const m = sorted[at];
    if (m === undefined || m.body.role !== 'coach') break;
    const ids = new Set(m.body.actionIds);
    const q = (await listTurnActions(m.turnId)).find((a) => ids.has(a.actionId) && a.detail.kind === 'build_question' && a.status === 'proposed');
    if (q === undefined) break;
    asked += 1;
    if (k === 0) open = q;
    firstAt = at;
  }
  if (open === null || firstAt === null || text === null) return { asked: open === null ? 0 : asked, open, followUp: null, skipped: false };
  const requestAt = sorted.slice(0, firstAt).map((x) => x.body.role).lastIndexOf('ben');
  const benTexts = sorted
    .slice(requestAt < 0 ? firstAt : requestAt)
    .flatMap((m) => {
      const w = benWords(m);
      return w === null ? [] : [w];
    })
    .reverse();
  const skipped = normaliseReply(text) === SKIP_ANSWER.toLowerCase();
  return { asked, open, followUp: { priorBenText: requestAt < 0 ? null : benWords(sorted[requestAt]), benTexts, strength: 'clear' }, skipped };
}
