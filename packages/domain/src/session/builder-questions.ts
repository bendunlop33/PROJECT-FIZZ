import type { AskBuildQuestionArgs, BuildQuestionTopic, TrainingGoal, TrainingProfile } from '@fizz/schemas';
import { classifyPainMention } from '../coach/pain-words';
import { stableStringify, deriveId } from '../stable';
import { parseRequestedMinutes } from './coach-draft';

/**
 * Clarifying questions and known preferences for the workout builder
 * (workout-builder.md v2.1 BD17–BD20, §2.1, §8.2). Pure.
 *
 * - `knownPreferences`: what is already known from Ben's training details
 *   (goal, session length, main lift per split day, experience, age,
 *   gender, height, bodyweight), confirmed memories and the last 14 days'
 *   split days. It is the build context's `KNOWN` block: never asked again.
 * - `checkBuildQuestion`: code checks every question's **text**, whatever
 *   its topic label says (length, goal, pain or medical words, a stored
 *   main lift's name), refuses a known topic with the known value, and
 *   trims the answers (2–4, ≤ 24 characters, no duplicates; `main_lift`
 *   answers must be usable here, not pain-flagged and in the split).
 * - `parseBuildRequest`: code reads Ben's words for the length, a request
 *   for variety or another main lift today (BD19), and "heavier" (BD16).
 */

const GOAL_WORD: Readonly<Record<TrainingGoal, string>> = { strength: 'Strength', muscle: 'Muscle', both: 'Both' };

export interface KnownInput {
  profile: TrainingProfile | null;
  /** Ben's local `YYYY-MM-DD` for the goal's date. */
  goalDate: string | null;
  /** The split day built for and its stored main lift (Ben's own choice only; a recommendation isn't known). */
  day: { name: string; mainLift: { exerciseId: string; name: string } | null } | null;
  /** Finished workouts of the last 14 days by split day, newest first. */
  recentSplits: readonly { date: string; day: string }[];
  /** Confirmed (active) memories, with the date saved. Unconfirmed suggestions never go in. */
  memories: readonly { text: string; savedOn: string }[];
}

export interface KnownPreferences {
  goal: { value: TrainingGoal; word: string; since: string | null } | null;
  sessionMinutes: number | null;
  mainLift: { day: string; exerciseId: string; name: string } | null;
  recentSplits: { date: string; day: string }[];
  memories: { text: string; savedOn: string }[];
  /** What isn't set, listed as missing (never guessed, rule 6). */
  missing: string[];
}

/** `knownPreferences(ctx)` (§8.2): deterministic, so the same inputs give the same `KNOWN` block and hash (WB-P2). */
export function knownPreferences(input: KnownInput): KnownPreferences {
  const p = input.profile;
  const missing: string[] = [];
  const goal = p?.goal === undefined ? null : { value: p.goal, word: GOAL_WORD[p.goal], since: input.goalDate };
  if (goal === null) missing.push('goal');
  const sessionMinutes = p === null ? null : p.sessionMinutes;
  if (sessionMinutes === null) missing.push('session length');
  const mainLift = input.day === null || input.day.mainLift === null ? null : { day: input.day.name, ...input.day.mainLift };
  if (input.day !== null && mainLift === null) missing.push(`main lift (${input.day.name})`);
  return { goal, sessionMinutes, mainLift, recentSplits: input.recentSplits.slice(0, 14).map((r) => ({ ...r })), memories: input.memories.slice(0, 20).map((m) => ({ ...m })), missing };
}

/** The `KNOWN` block's hash (`Why?` `USED`). */
export function knownHash(k: KnownPreferences): string {
  return deriveId(`known:${stableStringify(k)}`);
}

// ---------------------------------------------------------------------------

export interface BuildRequestWords {
  /** Minutes in Ben's words (`parseRequestedMinutes`). */
  minutes: number | null;
  /** "something different", "no bench today", "incline as main": don't insert the stored main lift today (BD19). */
  skipMainInsert: boolean;
  /** "heavier", "more weight": one more step on step bounds (BD16). */
  askedHeavier: boolean;
}

const VARIETY = /\b(?:something|anything) (?:different|else|new)\b|\bmix (?:it|things) up\b|\bvariety\b|\bswitch (?:it|things) up\b|\bno [a-z][a-z -]{1,30} today\b|\bas (?:the |my )?main\b|\binstead of\b|\bskip (?:the )?(?:bench|squat|deadlift|main)\b/i;
const HEAVIER = /\bheavier\b|\bmore weight\b|\bpush (?:it|me|harder)\b|\bgo up\b/i;

/** `parseBuildRequest(text)` (§8.2): code reads Ben's words; the model's reading is never used. */
export function parseBuildRequest(text: string): BuildRequestWords {
  const t = text.replace(/[’]/g, "'");
  return { minutes: parseRequestedMinutes(t), skipMainInsert: VARIETY.test(t), askedHeavier: HEAVIER.test(t) };
}

// ---------------------------------------------------------------------------

export interface QuestionContext {
  /** Minutes Ben's words or chips gave this build. */
  requestMinutes: number | null;
  /** The split day the build is for (a chip, or words), null with `Coach picks`. */
  dayName: string | null;
  /** Ben named a main lift for today in his words. */
  mainNamed: boolean;
  /** `main_lift` answers: usable here, not pain-flagged, in the split day's list (null: any usable). */
  mainLiftOk(catalogueId: string): boolean;
  /** The catalogue name for a `main_lift` answer (code shows it, not the model's label). */
  nameOf(catalogueId: string): string | null;
}

export type QuestionCheck = { ok: true; topic: BuildQuestionTopic; question: string; answers: { label: string; catalogueId: string | null }[] } | { ok: false; line: string };

const LENGTH = /\bhow long\b|\bminutes?\b|\bmins?\b|\bhours?\b|\bhrs?\b|\bsession length\b|\b\d+\s?(?:min|m)\b|\btime (?:do you have|have you got|you've got)\b|\bhow much time\b/i;
const GOAL = /\bgoals?\b|\btraining for\b|\bstrength\b|\bhypertrophy\b|\bmuscle or\b|\bbulk(?:ing)?\b|\bcutting\b|\bsize or\b/i;
const MEDICAL = /\binjur|\bdoctor\b|\bphysio|\bmedic|\bdiagnos|\bhurt|\bsore\b|\bsoreness\b|\bache\b|\baching\b|\bpain|\btweak|\bstrain|\bsprain|\bniggle/i;

/** `not allowed` (fed back to the model; no card shows). */
export const QUESTION_NOT_ALLOWED = 'not allowed';

/**
 * `checkBuildQuestion(args, known, request, gym)` (§8.2). Pure. Refuses
 * whatever the `topic` label says:
 * 1. text checks on the question and every answer: length words → `known:
 *    45 min` (or not allowed); goal words → `known: Strength` (or not
 *    allowed: the goal is code's to ask, BD20); a stored main lift's name →
 *    `known: <name>`; pain or medical words → not allowed;
 * 2. a topic already known (split from Ben's words or chips; the main lift
 *    stored or named) → `known: <value>`;
 * 3. the question ≤ 80 characters; answers trimmed to 2–4 of ≤ 24
 *    characters with no duplicates; `main_lift` answers must pass
 *    `mainLiftOk` and show the catalogue name. Fewer than 2 → not allowed.
 * A false positive only means building with defaults.
 */
export function checkBuildQuestion(args: AskBuildQuestionArgs, known: KnownPreferences, request: QuestionContext): QuestionCheck {
  const question = args.question.replace(/\s+/g, ' ').trim();
  const texts = [question, ...args.answers.map((a) => a.label)];
  const all = texts.join('\n');
  const length = known.sessionMinutes ?? request.requestMinutes;
  if (texts.some((t) => LENGTH.test(t))) return { ok: false, line: request.requestMinutes !== null ? `known: ${String(request.requestMinutes)} min` : length !== null ? `known: ${String(length)} min` : QUESTION_NOT_ALLOWED };
  if (texts.some((t) => GOAL.test(t))) return { ok: false, line: known.goal === null ? QUESTION_NOT_ALLOWED : `known: ${known.goal.word}` };
  if (texts.some((t) => MEDICAL.test(t) || classifyPainMention(t) === 'pain')) return { ok: false, line: QUESTION_NOT_ALLOWED };
  const main = known.mainLift;
  if (main !== null && all.toLowerCase().includes(main.name.toLowerCase())) return { ok: false, line: `known: ${main.name}` };
  if (args.topic === 'split' && request.dayName !== null) return { ok: false, line: `known: ${request.dayName}` };
  if (args.topic === 'main_lift' && main !== null) return { ok: false, line: `known: ${main.name}` };
  if (args.topic === 'main_lift' && request.mainNamed) return { ok: false, line: 'known: named in his request' };
  if (question.length === 0 || question.length > 80) return { ok: false, line: QUESTION_NOT_ALLOWED };

  const seen = new Set<string>();
  const answers: { label: string; catalogueId: string | null }[] = [];
  for (const a of args.answers) {
    if (answers.length >= 4) break;
    let label = a.label.replace(/\s+/g, ' ').trim();
    let catalogueId: string | null = null;
    if (args.topic === 'main_lift') {
      if (a.catalogueId === null || !request.mainLiftOk(a.catalogueId)) continue;
      const name = request.nameOf(a.catalogueId);
      if (name === null) continue;
      label = name;
      catalogueId = a.catalogueId;
    }
    if (label === '' || label.length > 24) continue;
    const key = catalogueId ?? label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push({ label, catalogueId });
  }
  if (answers.length < 2) return { ok: false, line: QUESTION_NOT_ALLOWED };
  return { ok: true, topic: args.topic, question, answers };
}
