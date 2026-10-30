import { deriveId, stableStringify } from '@fizz/domain';
import { COACH_TOOL_ARGS, type CoachToolCall, type CoachToolName } from '@fizz/schemas';
import type { z } from 'zod';
import type { TurnRegistry } from './registry';

/**
 * Turning a model function call into a typed `CoachToolCall`. Nothing the
 * model sends is trusted: the tool must be in this turn's registry, the
 * arguments must parse against the Zod schema, and any extra fields (for
 * example a programme change smuggled into `set_next_session_targets`, CC10)
 * are dropped and listed for `Why?` → `Not used`.
 */

export type ParsedToolCall =
  | { ok: true; call: CoachToolCall; opId: string; dropped: string[] }
  | { ok: false; error: 'not_allowed'; line: string }
  | { ok: false; error: 'invalid_args'; line: string; issues: string[] };

/**
 * Idempotency key (ADR 0020 §5): the same call in the same turn, e.g. replayed
 * after a dropped connection, gets the same opId and so changes nothing twice.
 * `parseToolCall` passes `semanticArgs`, so a retry that only rewords the
 * reason or quote is the same operation (review S4).
 */
export function toolOpId(turnId: string, tool: CoachToolName, args: unknown): string {
  return `${turnId}:${tool}:${deriveId(stableStringify(args))}`;
}

/** Text compared by meaning-preserving form: case, spacing, curly quotes and end punctuation don't make a new item. */
export function normaliseContentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:\s]+$/, '');
}

/**
 * The fields that decide what a call does. Free-text explanations (`reason`,
 * `quote`) are dropped; memory and playbook text is normalised; pain-flag
 * exercises are sorted.
 */
export function semanticArgs(call: CoachToolCall): unknown {
  switch (call.tool) {
    case 'adjust_pending_sets':
      return { baseVersion: call.args.baseVersion, exercises: call.args.exercises };
    case 'set_next_session_targets':
      return { ...call.args, targets: call.args.targets.map((t) => ({ exerciseId: t.exerciseId, target: t.target, sets: t.sets })) };
    case 'propose_next_workout_change':
      return { sourceSessionId: call.args.sourceSessionId, sourceVersion: call.args.sourceVersion, changes: call.args.changes };
    case 'propose_workout':
      // The message is explanation: a retry that only rewords it is the same workout. A new length, focus or gym isn't.
      return {
        exercises: call.args.exercises,
        ...(call.args.minutes == null ? {} : { minutes: call.args.minutes }),
        ...(call.args.focus == null ? {} : { focus: call.args.focus }),
        ...(call.args.gymName == null ? {} : { gymName: call.args.gymName.trim().toLowerCase() }),
      };
    case 'propose_exercise':
      // The reason is explanation; the name (by meaning) and fields are the exercise.
      return { ...call.args, name: normaliseContentText(call.args.name), reason: undefined };
    case 'ask_build_question':
      return { topic: call.args.topic, question: call.args.question.trim().toLowerCase(), answers: call.args.answers };
    case 'propose_plan':
      // As a workout build: the message is explanation; the days, length and gym are the plan.
      return {
        days: call.args.days,
        ...(call.args.minutes == null ? {} : { minutes: call.args.minutes }),
        ...(call.args.gymName == null ? {} : { gymName: call.args.gymName.trim().toLowerCase() }),
      };
    case 'log_set':
    case 'correct_set':
      return call.args;
    case 'rename_workout':
      return { baseVersion: call.args.baseVersion, name: call.args.name.trim() };
    case 'pause_plan':
      // The reason is explanation; pause or resume and the date are the change.
      return { action: call.args.action, until: call.args.until };
    case 'set_lift_target':
      // The ask claim is explanation; the exercise (by name), kind, load, reps and date are the target.
      return { exercise: call.args.exercise.trim().toLowerCase(), kind: call.args.kind, load: call.args.load, unit: call.args.unit, reps: call.args.reps, byDate: call.args.byDate };
    case 'log_activity':
      // (Ben, 20 Oct) The reason is explanation; what, when, how long, how far and how hard are the activity.
      return { ...call.args, reason: undefined };
    case 'propose_workout_edit':
    case 'fill_setup':
      // ADR 0039: Ben's own words are the request; the reason is explanation.
      return {};
    case 'propose_plan_swap':
      // (Ben, 30 Oct) The reason is explanation; what goes out and what comes in are the change.
      return { remove: call.args.remove, add: call.args.add };
    case 'propose_week':
      // The message is explanation; the merges and skips are the change.
      return { merges: call.args.merges.map((m) => ({ dayIds: m.dayIds, name: m.name.trim().toLowerCase() })), skips: [...call.args.skips].sort() };
    case 'edit_today':
      // Coach v3: the reason and the ask claim are explanation; the ops and the version are the change.
      return { baseVersion: call.args.baseVersion, ops: call.args.ops };
    case 'update_gym':
      // (20 Oct) The reason and the ask claim are explanation; the gym and the changes are the edit.
      return { gymName: call.args.gymName?.trim().toLowerCase() ?? null, changes: call.args.changes };
    case 'add_exercise_today':
      // The reason is explanation: a retry that only rewords it adds the same exercise.
      // Coach v3: so is the ask claim (`benAsked`, `benQuote`): who asked doesn't change what is added.
      return { ...call.args, reason: undefined, benAsked: undefined, benQuote: undefined };
    case 'set_pain_flag':
      return { exerciseIds: [...new Set(call.args.exerciseIds)].sort(), area: call.args.area };
    case 'save_memory':
    case 'suggest_memory':
      return { text: normaliseContentText(call.args.text) };
    case 'add_playbook_candidate':
      return { text: normaliseContentText(call.args.text), statedBy: call.args.statedBy };
    case 'forget_memory':
    case 'get_active_session':
    case 'get_recent_training':
    case 'get_training_overview':
    case 'get_progression_targets':
    case 'get_substitutions':
    case 'find_exercises':
    case 'get_recent_actions':
    case 'get_exercise_records':
    case 'get_recent_sessions':
      return call.args;
    case 'get_gym_equipment':
      return { exerciseId: call.args.exerciseId, gymName: call.args.gymName?.trim().toLowerCase() ?? null };
    case 'think_harder':
      return {};
  }
}

/**
 * Turn-independent content keys for the append tools (review S4). A `Try
 * again` starts a new turn, so the opId differs; the store (C3) must treat a
 * live item with the same key as already done and return it instead of
 * writing a second copy: an active pain flag on the same exercise, the same
 * memory text, the same playbook candidate text. Other tools return [] (they
 * are protected by their base version instead).
 */
/** The content key of a memory's text: the same words (case, spacing, punctuation aside) are the same memory. */
export function memoryContentKey(text: string): string {
  return `memory:${deriveId(normaliseContentText(text))}`;
}

/** The content key of a playbook candidate's text. */
export function playbookContentKey(text: string): string {
  return `playbook_candidate:${deriveId(normaliseContentText(text))}`;
}

export function appendContentKeys(call: CoachToolCall): string[] {
  switch (call.tool) {
    case 'set_pain_flag':
      return [...new Set(call.args.exerciseIds)].sort().map((id) => `pain_flag:${id}`);
    case 'save_memory':
    case 'suggest_memory':
      return [memoryContentKey(call.args.text)];
    case 'add_playbook_candidate':
      return [playbookContentKey(call.args.text)];
    case 'forget_memory':
    case 'adjust_pending_sets':
    case 'add_exercise_today':
    case 'update_gym':
    case 'edit_today':
    case 'rename_workout':
    case 'log_set':
    case 'correct_set':
    case 'set_next_session_targets':
    case 'propose_next_workout_change':
    case 'propose_workout':
    case 'ask_build_question':
    case 'propose_plan':
    case 'propose_exercise':
    case 'pause_plan':
    case 'set_lift_target':
    case 'log_activity':
    case 'propose_week':
    case 'propose_workout_edit':
    case 'fill_setup':
    case 'propose_plan_swap':
    case 'get_active_session':
    case 'get_recent_training':
    case 'get_training_overview':
    case 'get_gym_equipment':
    case 'get_progression_targets':
    case 'get_substitutions':
    case 'find_exercises':
    case 'get_recent_actions':
    case 'get_exercise_records':
    case 'get_recent_sessions':
    case 'think_harder':
      return [];
  }
}

function removeAt(value: unknown, path: readonly PropertyKey[], keys: readonly string[]): void {
  let node: unknown = value;
  for (const p of path) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<PropertyKey, unknown>)[p];
  }
  if (node === null || typeof node !== 'object') return;
  for (const k of keys) Reflect.deleteProperty(node, k);
}

/** `value` must be the caller's own copy (fresh from `JSON.parse`): unknown keys are deleted in place. */
function parseArgs(schema: z.ZodType, value: unknown): { ok: true; value: unknown; dropped: string[] } | { ok: false; issues: string[] } {
  const dropped: string[] = [];
  // Unknown keys are removed one round at a time (nested objects surface after their parents parse).
  for (let round = 0; round < 8; round += 1) {
    const r = schema.safeParse(value);
    if (r.success) return { ok: true, value: r.data, dropped };
    const unknownKeys = r.error.issues.filter((i) => i.code === 'unrecognized_keys');
    if (unknownKeys.length === 0 || unknownKeys.length !== r.error.issues.length) {
      return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    for (const issue of unknownKeys) {
      removeAt(value, issue.path, issue.keys);
      for (const k of issue.keys) dropped.push([...issue.path.map(String), k].join('.'));
    }
  }
  return { ok: false, issues: ['too many unknown fields'] };
}

/** Tools whose unknown fields fail the call rather than being dropped (a field there could carry a number the app must decide). */
const STRICT_TOOLS: ReadonlySet<CoachToolName> = new Set<CoachToolName>(['propose_workout']);

/** Words that tie a text to Ben himself: first person or his name. */
const OWNER_WORDS = /\b(?:i|i'm|im|i've|ive|i'd|i'll|me|my|mine|myself|ben|ben's|bens)\b/;
/** "your knee", "your left shoulder": a body part that belongs to someone, so a personal fact. */
const OWNED_BODY =
  /\byour (?:(?:left|right|lower|upper|bad|dodgy) )?(?:shoulders?|elbows?|wrists?|hands?|fingers?|knees?|ankles?|hips?|back|neck|spine|groin|feet|foot|achilles|hamstrings?|quads?|calf|calves|glutes?|chest|pecs?|ribs?|traps?|lats?|biceps?|triceps?|forearms?|shins?|heels?|toes?)\b/;

/**
 * Is this playbook candidate really a personal fact? (CLAUDE.md rule 10,
 * review r3 S1.) The playbook holds general training rules (Coaching
 * knowledge); anything about Ben himself ("my left knee is dodgy on
 * lunges", "Ben trains before work", "your knee hurts on lunges") belongs in
 * Your data, so the call is refused rather than trusting the model's
 * reading of the tool description. A refusal only costs a rephrase.
 * Third-person facts ("He trains before work", "The left knee is dodgy on
 * lunges") are refused too (review r4 S2).
 */
const BODY_WORD =
  '(?:shoulders?|elbows?|wrists?|hands?|fingers?|knees?|ankles?|hips?|back|neck|spine|groin|feet|foot|achilles|hamstrings?|quads?|calf|calves|glutes?|chest|pecs?|ribs?|traps?|lats?|biceps?|triceps?|forearms?|shins?|heels?|toes?|delts?|hip flexors?)';
/**
 * A particular body part rather than a general one (review r4 S2): a side
 * ("the left knee", "a dodgy right shoulder") or a state word that describes
 * one person's joint ("a dodgy knee", "the bad shoulder"). General rules talk
 * about "the knee" or "a painful joint", which stay allowed.
 */
const PARTICULAR_BODY = new RegExp(
  `\\b(?:(?:the|a|an|his|her|their) )?(?:(?:left|right)\\b(?: \\w+)? ${BODY_WORD}|(?:dodgy|bad|gammy|dicky|wonky|iffy|cranky|grumpy|niggly|old|injured|operated|repaired|reconstructed) (?:(?:left|right|lower|upper) )?${BODY_WORD})\\b`,
);
/** A third-person subject that can only mean one person: "He trains before work", "The owner trains fasted". */
const THIRD_PERSON = /\b(?:he|him|his|she|her|hers|himself|herself|the (?:owner|user|athlete in question|client)|this (?:user|owner|lifter|athlete|client))\b/;
/** "Owner prefers machines", "user trains fasted": the owner or user, with or without "the" (review r5 S3). */
const OWNER_NOUN = /\b(?:owner|owner's|user|user's|client|client's)\b/;
/**
 * A sentence that starts with a third-person verb has a dropped subject:
 * "Trains fasted before work", "Prefers machines", "Usually lifts at 6"
 * (review r5 S3). General rules start with an imperative ("Deload every 6
 * weeks") or a noun ("Pause reps build strength").
 */
const BARE_THIRD_PERSON_VERB =
  /^(?:(?:usually|always|often|never|sometimes|normally|mostly|generally|typically|still|also|now|only|rarely) )?(?:trains|prefers|likes|loves|hates|dislikes|enjoys|avoids|has|had|works|lifts|gets|struggles|runs|finds|wants|needs|does|doesn't|doesnt|feels|sleeps|eats|lives|uses|tends|can't|cant|cannot|is|was|isn't|isnt|wasn't|wasnt|goes|walks|cycles|swims|plays|rides|wakes|commutes|sits|stands|travels|fasts|drinks|takes|tolerates|responds|recovers|reacts|gets|misses|skips|manages|suffers|injured|tore|broke|had|reports|says|said|mentioned|wanted|asked|prefers)\b/;

/**
 * "Until the shoulder settles", "till the knee heals": one person's joint
 * recovering, so a personal constraint (review coach-tools r3 S1).
 */
const BODY_UNTIL_SETTLED = new RegExp(
  `\\b(?:until|till|til|while) (?:the |my |his |her |it |that )?(?:(?:left|right|lower|upper) )?(?:${BODY_WORD} )?(?:settles?|heals?|calms? down|recovers?|(?:is|feels|gets) better|improves?|is sorted|clears? up)\\b`,
);

export function personalPlaybookText(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'").trim();
  return OWNER_WORDS.test(t) || OWNED_BODY.test(t) || PARTICULAR_BODY.test(t) || THIRD_PERSON.test(t) || OWNER_NOUN.test(t) || BARE_THIRD_PERSON_VERB.test(t) || BODY_UNTIL_SETTLED.test(t);
}

/** An instruction: starts with an imperative training verb ("Deload every 5th week", "Always rest 3 minutes on squats"). */
const IMPERATIVE_RULE =
  /^(?:(?:always|never|don't|dont|do not|try to|make sure to|remember to) )?(?:deload|train|lift|rest(?! days?\b)|use|add|increase|decrease|drop|reduce|progress|keep|avoid|take|stop|start|push|aim|warm|stretch|superset|program|programme|cycle|swap|pick|choose|prioriti[sz]e|focus|include|limit|cap|finish|perform|do|repeat|switch|rotate|retest|bump|alternate)\b/;
/** Advice wording that is a rule whoever reads it: "should", "it's best to", "rule of thumb". */
const ADVICE_WORDS = /\b(?:should|shouldn't|ought to|it's best to|best to|it's better to|is best|works best|rule of thumb|as a rule)\b/;
/** "must", "need to", "always", "never": a rule, or one person's constraint ("Sessions must be under 45 minutes"). */
const SOFT_ADVICE = /\b(?:must|mustn't|need to|needs to|have to|has to)\b|^(?:always|never)\b/;
/** A period: "every 5th week", "every 4-6 weeks", "every other session". */
const EVERY_PERIOD = /\bevery (?:\d+(?:st|nd|rd|th)?|\d+ ?[-–] ?\d+|other|few|couple of) (?:weeks?|sessions?|workouts?|cycles?|blocks?|months?)\b/;
/** "Always/never … every N weeks", or a deload on a period: a rule (review coach-tools r2 S2). */
const PERIODIC_RULE = new RegExp(`(?:^(?:always|never)\\b|\\bdeloads?\\b).*${EVERY_PERIOD.source}`);
/** A claim about what works for anyone: "helps recovery", "builds strength". */
const GENERAL_CLAIM =
  /\b(?:helps?|builds?|improves?|increases?|reduces?|drives?|prevents?|boosts?|speeds? up|maximi[sz]es?)\b(?: \w+)? (?:recovery|strength|hypertrophy|muscle|growth|gains|injur(?:y|ies)|fatigue|progress|performance|power|endurance|technique)\b/;
/** A whole class of lifts or lifters, not one exercise Ben does: "heavy compounds", "lifters". */
const CLASS_WORDS =
  /\b(?:compounds?|compound (?:lifts?|movements?|exercises?)|isolation (?:work|lifts?|exercises?)|accessor(?:y|ies)(?: work| lifts?)?|heavy sets|big lifts|main lifts|each muscle|every muscle|muscle groups?|lifters|athletes|beginners|trainees|everyone|anyone|people)\b/;
/**
 * One person's week, day or time: a schedule constraint is Ben's, not a
 * training rule ("Keep sessions under 45 minutes on weekdays", "Finish by
 * 7:30 to get to work", "Train before work").
 */
const SCHEDULE_CONTEXT =
  /\b(?:weekdays?|weekends?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|work|shifts?|commute|school|kids|lunch(?:time)?|mornings?|evenings?|tonight|today|tomorrow|home)\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2} ?(?:am|pm)\b|\b(?:sessions?|workouts?|training) (?:\w+ ){0,2}(?:under|over|less than|at most|no longer than|within) \d+/;

/**
 * Where a memory's words belong (CLAUDE.md rule 10, coach-memory CM9;
 * review coach-tools r2 S1, S2):
 * - `personal`: about Ben (first person, a dropped-subject fact, his
 *   schedule, or no rule wording at all): a memory.
 * - `rule`: clear rule wording with no one in particular ("Always deload
 *   every 5th week", "You should never train to failure", "Compound lifts
 *   first", "A deload every 4-6 weeks helps recovery"): the playbook.
 * - `unclear`: an instruction that could be either ("Avoid lunges", "Use
 *   straps for deadlifts"): Ben picks on the card (CM9's split).
 */
export type MemoryTextKind = 'personal' | 'rule' | 'unclear';

/**
 * Who asked: `coach` for the coach's own `suggest_memory` (clear rule
 * wording is refused there), `ben` for Ben's "remember …" (`save_memory`).
 * Ben's words go to the playbook without a card only on the strongest
 * signals (review coach-tools r3 S1); anything weaker gets the CM9 split.
 */
export type MemoryAsker = 'coach' | 'ben';

/** A dropped subject before "should": "Should keep sessions short" is about Ben, like "Prefers dumbbells" (r3 S1). */
const LEADING_SHOULD = /^(?:(?:probably|really|definitely|still|also) )?(?:should(?:n't| not)?|ought(?:n't)? to)\b/;
/** Class words that name lifters or a class of lifts, not a kind of set Ben might do ("heavy sets"). */
const STRONG_CLASS_WORDS =
  /\b(?:compounds?|compound (?:lifts?|movements?|exercises?)|isolation (?:work|lifts?|exercises?)|accessor(?:y|ies)(?: work| lifts?)?|big lifts|main lifts|each muscle|every muscle|muscle groups?|lifters|athletes|beginners|trainees|everyone|anyone|people)\b/;
/** Wording that only a general rule uses. */
const RULE_PHRASE = /\b(?:works best|rule of thumb|as a rule)\b/;

/** Unmistakably general: a periodic rule, a claim about what works, a class of lifts or lifters, rule phrasing. */
function strongRuleSignal(t: string): boolean {
  return PERIODIC_RULE.test(t) || GENERAL_CLAIM.test(t) || STRONG_CLASS_WORDS.test(t) || RULE_PHRASE.test(t);
}

export function memoryTextKind(text: string, asker: MemoryAsker = 'coach'): MemoryTextKind {
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/^remember (?:that |to )?/, '');
  if (personalPlaybookText(t)) return 'personal';
  const strong = strongRuleSignal(t);
  if (LEADING_SHOULD.test(t)) return strong ? 'unclear' : 'personal';
  const clear = ADVICE_WORDS.test(t) || PERIODIC_RULE.test(t) || GENERAL_CLAIM.test(t) || ((IMPERATIVE_RULE.test(t) || SOFT_ADVICE.test(t) || /^(?:\w+ )?(?:lifts?|movements?|exercises?|work) (?:first|last)\b/.test(t)) && CLASS_WORDS.test(t));
  const schedule = SCHEDULE_CONTEXT.test(t);
  if (clear) return schedule || (asker === 'ben' && !strong) ? 'unclear' : 'rule';
  if (schedule) return 'personal';
  if (IMPERATIVE_RULE.test(t) || SOFT_ADVICE.test(t) || EVERY_PERIOD.test(t)) return 'unclear';
  return 'personal';
}

/** Clear rule wording only (see `memoryTextKind`); unclear text is not a rule here. */
export function generalRuleMemoryText(text: string): boolean {
  return memoryTextKind(text) === 'rule';
}

/** The app line when the coach suggests a general rule as a memory (minimal copy). */
export const RULE_NOT_MEMORY_LINE = 'Rule, not a memory. Nothing changed.';

export function parseToolCall(turnId: string, name: string, rawArguments: string, registry: TurnRegistry): ParsedToolCall {
  const decl = registry.tools.find((t) => t.name === name);
  if (decl === undefined) return { ok: false, error: 'not_allowed', line: `Not allowed: ${name}` };
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return { ok: false, error: 'invalid_args', line: `Couldn't read the coach's request for ${name}. Nothing changed.`, issues: ['not JSON'] };
  }
  const schema: z.ZodType = COACH_TOOL_ARGS[decl.name];
  // workout-builder BD1, WB3: `propose_workout` has no load, minutes, gym or equipment field, and one
  // smuggled in (`load`, `weight`, `minutes` …) fails the call instead of being dropped.
  if (STRICT_TOOLS.has(decl.name)) {
    const strict = schema.safeParse(raw);
    if (!strict.success) {
      return { ok: false, error: 'invalid_args', line: `Couldn't read the coach's request for ${name}. Nothing changed.`, issues: strict.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
  }
  const parsed = parseArgs(schema, raw);
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_args', line: `Couldn't read the coach's request for ${name}. Nothing changed.`, issues: parsed.issues };
  }
  const call = { tool: decl.name, args: parsed.value } as CoachToolCall;
  if (call.tool === 'add_playbook_candidate' && personalPlaybookText(call.args.text)) {
    return {
      ok: false,
      error: 'invalid_args',
      line: "That's about you, not a general rule, so it wasn't added to the playbook. Nothing changed.",
      issues: ['text: personal fact, not a general rule (rule 10)'],
    };
  }
  // A coach suggestion in clear rule wording is refused: the coach can't add to the playbook unasked
  // (add_playbook_candidate needs Ben's request). Ben's own "remember …" of a rule goes to the playbook
  // instead (the save_memory executor). Unclear text becomes a card with both choices (CM9).
  if (call.tool === 'suggest_memory' && memoryTextKind(call.args.text) === 'rule') {
    return { ok: false, error: 'invalid_args', line: RULE_NOT_MEMORY_LINE, issues: ['text: general training rule, not a personal fact (rule 10)'] };
  }
  return { ok: true, call, opId: toolOpId(turnId, decl.name, semanticArgs(call)), dropped: parsed.dropped };
}
