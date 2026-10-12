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

/** "3 × 6–8", "2 x 12-15", "3 sets of 8": one prescribed exercise in a text plan. */
const SETS_BY_REPS = /\b\d{1,2}\s*(?:[×x✕*]|sets? of)\s*\d{1,3}\b/gi;

/** Does this coach text lay out a session (two or more "sets × reps" lines)? Pure; the coach's words are data. */
export function describesWorkoutPlan(text: string): boolean {
  return (text.match(SETS_BY_REPS) ?? []).length >= 2;
}

/** Did the coach end by offering to build or add it ("Want me to build that in the app?")? */
export function offersToBuild(text: string): boolean {
  const questions = text.replace(/[’]/g, "'").match(/[^.!?]*\?/g) ?? [];
  return questions.some((q) => /\b(?:want|shall|should|like) (?:me|i) to (?:build|add|make|put|save|create|set up|turn|load)\b|\b(?:build|add|put|save|load) (?:it|that|this|them)(?: (?:in|into|to) (?:the app|your workouts))?\s*\?/i.test(q));
}

const ACCEPT_WORD = "(?:yes|yeah|yea|yep|yup|ya|sure|ok|okay|k|please|alright|right|cool|great|perfect|nice|lovely|brilliant|absolutely|definitely|go on|go ahead|go for it|do it|let's do it|lets do it|let's go|lets go|go|sounds good|looks good|that works|love it|thanks|thank you|cheers|mate|coach)";
const FOLLOW_LEAD = "(?:(?:can|could|would|will) you (?:please |just )?|you can |please |just |go ahead and |now |then |and )*";
const FOLLOW_VERB = '(?:add|put|save|load|stick|pop|chuck|throw|make|turn|build|create|set|log|start|do|plug|get)';
const FOLLOW_OBJECT = '(?:it|that|this|them|those|these|(?:that|this|the|your) (?:one|session|workout|plan|routine|day)|(?:that|this) (?:push|pull|leg|legs|upper|lower|full body) (?:session|workout|day))';
const FOLLOW_PLACE = '(?:(?:in|into|to|on|onto) (?:the |my |your )?(?:app|workouts?|routines?|library|phone)|(?:as|into) (?:a |an )?(?:new )?(?:workout|session|routine|draft)|a (?:workout|session|routine|draft)|in|up|on|for me|for today)';
const SIGN_OFF = '(?:please|thanks|thank you|cheers|mate|coach|now|then|for me|x)';
const FOLLOW = new RegExp(`^${FOLLOW_LEAD}${FOLLOW_VERB}(?: ${FOLLOW_OBJECT})?(?: ${FOLLOW_PLACE})*$`);
const ACCEPT_ONLY = new RegExp(`^${ACCEPT_WORD}(?: ${ACCEPT_WORD})*$`);
const ACCEPT_LEAD = new RegExp(`^(?:${ACCEPT_WORD} )+`);
const SIGN_OFF_TAIL = new RegExp(`(?: ${SIGN_OFF})+$`);

/**
 * Ben's words after the coach described a session: `explicit` asks to have it
 * in the app ("add it", "put that in the app", "yes u can add in the app"),
 * `accept` is only agreement ("yes", "ok go"), null is anything else (a
 * question, a change of topic, a "no"). The whole message must be the
 * follow-up: "yes, but why split squats?" is a question, not a build. Pure.
 */
export function buildFollowUp(text: string): 'explicit' | 'accept' | null {
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\bu\b/g, 'you')
    .replace(/\bpls\b|\bplz\b/g, 'please')
    .replace(/[.,!?;:…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t === '') return null;
  if (ACCEPT_ONLY.test(t)) return 'accept';
  const body = t.replace(ACCEPT_LEAD, '').replace(SIGN_OFF_TAIL, '').trim();
  return FOLLOW.test(body) ? 'explicit' : null;
}

/** The coach's shown words on a stored message (what Ben saw), or null for Ben's own. */
function coachText(m: CoachMessage): string | null {
  return m.body.role === 'coach' ? m.body.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : [])).join(' ') : null;
}

export interface BuildFollowUp {
  /** Ben's words that led to the coach's plan (the earlier request), quoted as data for length and focus. */
  priorBenText: string | null;
}

/**
 * Is Ben's message (`text`) a follow-up that asks to put the session the
 * coach just described into the app? Reads only the thread's last coach
 * message and the Ben message before it. Not when that coach turn already
 * saved something (a draft there has its own `Open` and BD15's fixed line).
 */
export function buildFollowUpIn(history: readonly CoachMessage[], text: string): BuildFollowUp | null {
  const sorted = [...history].sort((a, b) => a.ordinal - b.ordinal);
  const lastCoachAt = sorted.map((m) => m.body.role).lastIndexOf('coach');
  if (lastCoachAt < 0) return null;
  const lastCoach = sorted[lastCoachAt];
  if (lastCoach === undefined || lastCoach.body.role !== 'coach' || lastCoach.body.actionIds.length > 0) return null;
  const said = coachText(lastCoach) ?? '';
  const prior = sorted.slice(0, lastCoachAt).reverse().find((m) => m.body.role === 'ben');
  const priorBenText = prior !== undefined && prior.body.role === 'ben' && prior.body.input.kind === 'words' ? prior.body.input.text : null;
  const askedBefore = priorBenText !== null && requestHas(classifyBenRequest(priorBenText, 'general'), 'build');
  if (!describesWorkoutPlan(said) && !askedBefore) return null;
  const kind = buildFollowUp(text);
  if (kind === 'explicit' || (kind === 'accept' && offersToBuild(said))) return { priorBenText };
  return null;
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
 * / `parseRequestedFocus`): Ben's own, now and (for a follow-up) the request
 * that led to the plan. Never the coach's text.
 */
export function buildRequestWords(text: string, followUp: BuildFollowUp | null): string {
  return followUp?.priorBenText == null ? text : `${followUp.priorBenText}\n${text}`;
}

/**
 * The coach saying it can't put a workout in the app ("I don't have access to
 * a workout-creation tool", "I can't put it into the app for you from here").
 * Never true while the app can build one: the sentence is hidden and the reply
 * shows `BUILD_ASK_LINE` instead (build 131).
 */
export function claimsNoBuildTool(sentence: string): boolean {
  const t = sentence.toLowerCase().replace(/[’]/g, "'");
  const subject = "\\b(?:i|i'm|i am|the app|this chat|there's|there is|we)\\b";
  const cannot = "(?:don't|do not|doesn't|does not|can't|cannot|can not|am unable to|'m unable to|unable to|am not able to|'m not able to|not able to|have no|has no|no)";
  const lead = `${subject}[^.?!]{0,20}?\\b${cannot}\\b`;
  // "I don't have access to a workout-creation tool", "there's no tool for adding workouts".
  const noTool = new RegExp(`${lead}[^.?!]{0,40}?\\b(?:access|tools?|ability)\\b[^.?!]{0,60}?\\b(?:app|workouts?|routines?|sessions?|tools?|workout[- ](?:creation|building))\\b`);
  // "I can't put it into the app", "I'm unable to add that to your workouts". Not "I can't make the session easier".
  const notInApp = new RegExp(`${lead}[^.?!]{0,10}?\\b(?:add|create|put|save|build|load|set up|make)\\b[^.?!]{0,40}?\\b(?:in|into|to|on|onto) (?:the |your |this )?(?:app|workouts|routines|library)\\b`);
  return noTool.test(t) || notInApp.test(t);
}

/** Shown in place of a "no tool" sentence: what works (minimal copy). */
export const BUILD_ASK_LINE = 'Say "Build me a workout" to get a draft.';
