import type { CoachMessage, CoachTurnKind } from '@fizz/schemas';
import { classifyBenRequest, requestHas, revisesDraft } from './request';

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
const SETS_BY_REPS = /\b\d{1,2}\s*(?:[×x✕*]|sets?(?: of|,| x|:)?)\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*reps?)?\b/gi;

/** Does this coach text lay out a session (two or more "sets × reps" lines)? Pure; the coach's words are data. */
export function describesWorkoutPlan(text: string): boolean {
  return (text.match(SETS_BY_REPS) ?? []).length >= 2;
}

const OFFER_VERB = /\b(?:want|shall|should|like) (?:me|i) to (?:build|add|make|put|save|create|set up|turn|load)\b|\b(?:build|add|put|save|load) (?:it|that|this|them)(?: (?:in|into|to) (?:the app|your workouts))?\s*\?/i;
/** The offer is about a workout, not a memory or a note ("Want me to save that as a memory?" is not one). */
const OFFER_ABOUT_WORKOUT = /\b(?:build|app|workouts?|sessions?|routines?|drafts?|day)\b/i;

/**
 * Did the coach end by offering to build it ("Want me to build it in the app?",
 * or "Shall I add it?" right after a plan in the same message)? A bare
 * "yes" to this opens `propose_workout` (review B3: the coach's own offer is
 * the clear signal; the result is still only a draft, BD12, BD15).
 */
export function offersToBuild(text: string): boolean {
  const questions = text.replace(/[’]/g, "'").match(/[^.!?]*\?/g) ?? [];
  const plan = describesWorkoutPlan(text);
  return questions.some((q) => OFFER_VERB.test(q) && !/\b(?:memor(?:y|ies)|note|remember)\b/i.test(q) && (plan || OFFER_ABOUT_WORKOUT.test(q)));
}

const ACCEPT_WORD = "(?:yes|yeah|yea|yep|yup|ya|sure|ok|okay|k|please|alright|right|cool|great|perfect|nice|lovely|brilliant|absolutely|definitely|go on|go ahead|go for it|do it|let's do it|lets do it|let's go|lets go|go|sounds good|looks good|that works|love it|thanks|thank you|cheers|mate|coach)";
const FOLLOW_LEAD = "(?:(?:can|could|would|will) you (?:please |just )?|you can |please |just |go ahead and |now |then |and )*";
const FOLLOW_VERB = '(?:add|put|save|load|stick|pop|chuck|throw|make|turn|build|create|set|log|start|do|plug|get)';
const FOLLOW_OBJECT = '(?:it|that|this|them|those|these|(?:that|this|the|your) (?:one|session|workout|plan|routine|day)|(?:that|this|the) (?:push|pull|leg|legs|upper|lower|full body) (?:session|workout|day))';
const FOLLOW_PLACE =
  "(?:(?:in|into|to|on|onto) (?:the |my |your )?(?:app|workouts?|routines?|library|phone)|(?:as|into) (?:a |an )?(?:new )?(?:workout|session|routine|draft)|a (?:workout|session|routine|draft)|(?:to|for) today(?:'s| is)?(?: (?:workout|session|plan))?|today|in|up|on|for me)";
const SIGN_OFF = '(?:please|thanks|thank you|cheers|mate|coach|now|then|for me|though|tho|x)';
const FOLLOW = new RegExp(`^${FOLLOW_LEAD}${FOLLOW_VERB}(?: ${FOLLOW_OBJECT})?(?: ${FOLLOW_PLACE})*$`);
/** Ben pushing back that the app can do it (build 131 review S2): "the app can do it", "it has a workout builder". */
const PUSHBACK =
  /^(?:(?:but|well|yes|yeah|no|nah|actually) )*(?:the app|this app|the app itself|you|it) (?:can|could|does|do|has|have|has got|should be able to)(?: (?:a|an|got))? (?:do (?:it|that|this)|(?:a )?(?:workout |session )?builder|build(?: (?:it|that|them|workouts?|sessions?))?|add(?: (?:it|that|them|workouts?|sessions?))?|make (?:it|that|workouts?|sessions?))(?: (?:in|on) (?:the |this )?app)?$/;
const ACCEPT_ONLY = new RegExp(`^${ACCEPT_WORD}(?: ${ACCEPT_WORD})*$`);
const ACCEPT_LEAD = new RegExp(`^(?:${ACCEPT_WORD} )+`);
const SIGN_OFF_TAIL = new RegExp(`(?: ${SIGN_OFF})+$`);
/** After "but": a change Ben wants made in the draft ("make it 45 mins", "drop the calf raises", "swap … for …"). */
const CHANGE_TAIL = /^(?:make it|make that|make them|swap|switch|drop|lose|remove|cut|skip|add|replace|change|use|no|without|with|less|more|shorter|longer|only|just|keep|leave out|take out|instead|go)\b/;
/** After "but": a question, which is never a build ("yes, but why split squats?"). */
const QUESTION_TAIL = /^(?:why|what|how|when|where|which|who|is|are|was|were|do|does|did|can|could|should|would|will|isn't|aren't|don't)\b/;

/** Text-speak "u" as a word on its own; never "U-bar row" (review N1). */
export function expandTextSpeak(text: string): string {
  return text.replace(/(?<![\w-])u(?![\w-])/g, 'you').replace(/(?<![\w-])ur(?![\w-])/g, 'your');
}

function followCore(t: string): 'explicit' | 'accept' | null {
  if (t === '') return null;
  if (ACCEPT_ONLY.test(t)) return 'accept';
  const body = t.replace(ACCEPT_LEAD, '').replace(SIGN_OFF_TAIL, '').trim();
  return FOLLOW.test(body) || PUSHBACK.test(body) ? 'explicit' : null;
}

/**
 * Ben's words after the coach described a session: `explicit` asks to have it
 * in the app ("add it", "put that in the app", "yes u can add in the app",
 * "the app can do it", "yes but make it 45 mins"), `accept` is only agreement
 * ("yes", "ok go"), null is anything else (a question, a change of topic, a
 * "no"). The whole message must be the follow-up: "yes, but why split
 * squats?" is a question, not a build. A "but <change>" after a yes or an add
 * is explicit: the model gets the change in his words and makes a draft (BD16). Pure.
 */
export function buildFollowUp(text: string): 'explicit' | 'accept' | null {
  const t = expandTextSpeak(text.toLowerCase().replace(/[‘’]/g, "'"))
    .replace(/\bpls\b|\bplz\b/g, 'please')
    .replace(/[.,!?;:…—–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t === '') return null;
  const but = /^(.*?) but (.+)$/.exec(t);
  if (but !== null) {
    const head = followCore((but[1] ?? '').trim());
    const tail = (but[2] ?? '').trim();
    if (head === null || text.includes('?') || QUESTION_TAIL.test(tail)) return null;
    return CHANGE_TAIL.test(tail) ? 'explicit' : null;
  }
  return followCore(t);
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
export function buildFollowUpIn(history: readonly CoachMessage[], text: string): BuildFollowUp | null {
  const kind = buildFollowUp(text);
  if (kind === null) return null;
  const sorted = [...history].sort((a, b) => a.ordinal - b.ordinal);
  const coachAts = sorted.flatMap((m, i) => (m.body.role === 'coach' ? [i] : [])).reverse();
  const lastAt = coachAts[0];
  if (lastAt === undefined) return null;
  let anchorAt: number | null = null;
  let anchorBenAt: number | null = null;
  for (const at of coachAts.slice(0, FOLLOW_UP_WINDOW)) {
    const m = sorted[at];
    if (m === undefined || m.body.role !== 'coach' || m.body.actionIds.length > 0) break;
    const said = coachSentences(m).join(' ');
    const benAt = sorted.slice(0, at).map((x) => x.body.role).lastIndexOf('ben');
    const prior = benAt < 0 ? null : benWords(sorted[benAt]);
    const asked = prior !== null && requestHas(classifyBenRequest(prior, 'general'), 'build');
    if (describesWorkoutPlan(said) || asked || offersToBuild(said)) {
      anchorAt = at;
      anchorBenAt = benAt < 0 ? null : benAt;
    }
  }
  if (anchorAt === null) return null;
  if (kind === 'accept') {
    const last = coachSentences(sorted[lastAt] as CoachMessage);
    if (!offersToBuild(last.join(' ')) && !last.some((s) => claimsNoBuildTool(s) || s === BUILD_ASK_LINE)) return null;
  }
  const from = anchorBenAt ?? anchorAt;
  const benTexts = sorted
    .slice(from)
    .flatMap((m) => {
      const w = benWords(m);
      return w === null ? [] : [w];
    })
    .reverse();
  return { priorBenText: anchorBenAt === null ? null : benWords(sorted[anchorBenAt]), benTexts };
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
  `${NO_BUILD_LEAD}[^.?!]{0,30}?\\b(?:(?:workout|session|routine)[- ](?:creation|creating|building|builder|creator)(?: (?:tool|feature|function))?|(?:tool|ability|way|feature|function|access) (?:to|for) ${BUILD_VERBS} ${WORKOUT_OBJECT}\\b)`,
);

/**
 * The coach saying it can't build a workout or put one in the app ("I don't
 * have access to a workout-creation tool", "I can't build workouts here").
 * Only workout or session nouns count: "I can't add exercises to today's
 * workout", "I can't create a programme" and "I don't have your Health data"
 * are true limits and stay (review B1). The reply filter uses it only on a
 * general turn where the app can build one and no draft was made (`createReplyFilter`).
 */
export function claimsNoBuildTool(sentence: string): boolean {
  const t = sentence.toLowerCase().replace(/[’]/g, "'");
  return CANT_BUILD.test(t) || NO_BUILD_TOOL.test(t);
}

/** Shown in place of a "can't build" sentence: what works (minimal copy). */
export const BUILD_ASK_LINE = 'Say "Build me a workout" to get a draft.';
