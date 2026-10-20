import { deriveId, planGymUpdate, type GymUpdateChange } from '@fizz/domain';
import type { ActionDetail, EquipmentInstance, Exercise, Gym, WeightUnit } from '@fizz/schemas';
import { newActionRecord, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';
import { asksOpinionOnly, asksOutright, quoteInWords, type AskClaim } from './intent';

/**
 * `update_gym` (Ben, 20 Oct: "update as we go and train the app for each
 * gym"; ADR 0029). The coach changes a gym's profile: a kind it has or
 * hasn't, the dumbbells' top and step, a stack's step, or an exercise the gym
 * can't do. The app plans every number (`planGymUpdate`); the model's
 * arguments are only a request.
 *
 * Rule 3: when Ben said it ("this gym has no leg press", "dumbbells go up in
 * 2s here") it applies at once with Undo; when it is the coach's own idea it
 * is a card with exactly what would apply, and nothing changes until Ben taps
 * Apply. Versioned and idempotent (rule 5): the edit carries the records
 * before, so a newer gym refuses it, and the store replays the same opId.
 */

/** Loose: opens `update_gym` for the turn (an offer is harmless). Never decides that a call applies. */
const GYM_TALK =
  /\b(?:no|doesn'?t have|does not have|don'?t have|do not have|hasn'?t got|has no|have no|there(?:'s| is| are)|they(?:'ve| have) got|has (?:a|an|got)|go(?:es)? up in|only go(?:es)? (?:up )?to|up to \d|in \d+(?:\.\d+)? ?(?:kg|lb|kilos?|pounds?)? ?(?:steps|jumps|increments)|steps? of \d|isn'?t (?:here|there)|aren'?t (?:here|there)|not (?:here|there|at this gym)|broken|out of order)\b/i;
/** A plain ask to change the gym's profile (loose, for opening the tool). */
const GYM_REQUEST_TALK = /\b(?:add|remove|take off|update|change|set|mark|make)\b[^.?!]*\b(?:gym|dumbbells?|stack|machines?|cables?|barbell|plates?)\b/i;

const GYM_PLACE = /\b(?:gym|here|this place)\b/i;
const EQUIPMENT_NOUN = /\b(?:dumbbells?|dbs|plates?|barbells?|bars?|racks?|stacks?|cables?|machines?|leg press|smith|kettlebells?|benches?|pull-?up bar|dip bars?|equipment)\b/i;
const STEP_WORDS = /\b(?:go(?:es)? up in|only go(?:es)? (?:up )?to|up to \d|steps? of|increments?|jumps? of)\b/i;

/**
 * Strict (review quickgym B1): what counts as Ben *stating* a fact about the
 * gym's equipment. A negation or "has" right next to an equipment noun ("no
 * leg press", "doesn't have a smith machine", "there's a leg extension"), an
 * equipment noun that isn't here, or an item and its steps with a number.
 * "No idea …", "there is a queue for …" and "broken" (temporary) never count.
 */
const NOUN = String.raw`(?:dumbbells?|dbs|plates?|barbells?|bars?|racks?|stacks?|cables?|cable (?:station|machine)s?|machines?|leg press(?:es)?|leg extensions?|leg curls?|lat pull-?downs?|chest press(?:es)?|pec decks?|hack squats?|smith(?: machines?)?|kettlebells?|benches|bench|pull-?up bars?|dip (?:bars?|stations?)|trap bars?|ez bars?)`;
const NEGATED = new RegExp(String.raw`\b(?:no|doesn'?t have|does not have|don'?t have|do not have|hasn'?t got|haven'?t got|has no|have no|there(?:'s| is| are) no|without)\s+(?:(?:a|an|any)\s+)?(?:[\w-]+\s+)?${NOUN}\b`, 'i');
const HAS = new RegExp(String.raw`\b(?:has|have|there(?:'s| is| are)|they(?:'ve| have) got|has got|have got)\s+(?:(?:a|an|some)\s+)?(?:[\w-]+\s+)?${NOUN}\b`, 'i');
const NOT_HERE = new RegExp(String.raw`\b${NOUN}\s+(?:isn'?t|aren'?t|is not|are not)\s+(?:here|there|at this gym)\b`, 'i');
const NOUN_RE = new RegExp(String.raw`\b${NOUN}\b`, 'i');
const STEP_FACT = /\b(?:go(?:es)? up in|go(?:es)? up to|only go(?:es)? (?:up )?to|steps? of|in \d+(?:\.\d+)? ?(?:kg|lb|kilos?|pounds?)? ?(?:steps|jumps|increments)|up to)\b[^.?!]*\d|\d[^.?!]*\b(?:steps|jumps|increments)\b/i;
/** An outright ask to change the profile: a verb of change near an equipment noun or the gym. */
const GYM_REQUEST = new RegExp(String.raw`\b(?:add|remove|take off|update|change|set|mark)\b[^.?!]*\b(?:gym|${NOUN})\b`, 'i');
/** Hedges and doubt: Ben isn't stating it (an offer). */
const HEDGE = /\b(?:maybe|might|perhaps|probably|possibly|not sure|unsure|i think|i guess|no idea|i wonder|wondering|do you know|reckon)\b/i;
/** A sentence that opens like a question, with or without its `?`. */
const QUESTION_OPENER = /^\s*(?:does|do|did|is|are|was|were|has|have|can|could|would|should|will|what|where|which|how|why|who)\b/i;

/**
 * (20 Oct, ADR 0029) Ben's words are about what a gym has: the place and a
 * fact or an ask ("this gym has no leg press", "no smith machine here"), or
 * an item and its steps ("dumbbells go up in 2s"). Opens `update_gym` for
 * the turn; whether a call applies is `gymChangeAsked`'s call.
 */
export function mentionsGymSetup(words: string): boolean {
  return (GYM_PLACE.test(words) && (GYM_TALK.test(words) || GYM_REQUEST_TALK.test(words))) || (EQUIPMENT_NOUN.test(words) && STEP_WORDS.test(words));
}

function sentencesOf(words: string): string[] {
  return words
    .replace(/[‘’`´]/g, "'")
    .split(/(?<=[.!?\n])\s*/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** One sentence of Ben's states a gym fact: not a question, not hedged. */
function statesGymFact(sentence: string): boolean {
  if (sentence.endsWith('?') || QUESTION_OPENER.test(sentence) || HEDGE.test(sentence)) return false;
  if (NEGATED.test(sentence) || HAS.test(sentence) || NOT_HERE.test(sentence)) return true;
  return NOUN_RE.test(sentence) && STEP_FACT.test(sentence);
}

/** One sentence of Ben's asks outright for a gym change ("add 22 kg dumbbells to this gym", "can you mark the leg press gone?"). */
function asksGymChange(sentence: string): boolean {
  if (HEDGE.test(sentence) || !GYM_REQUEST.test(sentence)) return false;
  return asksOutright(sentence) || (!sentence.endsWith('?') && !QUESTION_OPENER.test(sentence));
}

const sentenceAsks = (s: string) => statesGymFact(s) || asksGymChange(s);

/**
 * Did Ben tell the app this about his gym (rule 3; review quickgym B1)? Like
 * `verifyAsked`: a model claim that he didn't is taken; a claim is trusted
 * only when its quote is his own words this turn, and then the sentence it
 * sits in must state a gym fact or ask outright. No claim: some sentence of
 * his must. A question, a hedge, or a message that only asks the coach's
 * opinion is never his say-so: the change is offered. No words (a tap): never.
 */
export function gymChangeAsked(words: string | null, claim: AskClaim): boolean {
  if (words === null || claim.benAsked === false) return false;
  if (asksOpinionOnly(words)) return false;
  const sentences = sentencesOf(words);
  if (claim.benAsked === true && claim.benQuote != null && quoteInWords(claim.benQuote, words)) {
    const quote = claim.benQuote;
    return sentences.some((s) => quoteInWords(quote, s) && sentenceAsks(s));
  }
  return sentences.some(sentenceAsks);
}

export interface GymUpdatePlace {
  gym: Gym;
  equipment: EquipmentInstance[];
  unit: WeightUnit;
}

export interface GymUpdateDeps {
  store: CoachWriteStore;
  /** The saved gym the call names, else the workout's gym, else Ben's selected gym; null when none. */
  gym(name: string | null): Promise<GymUpdatePlace | null>;
  /** An exercise by catalogue ID or Ben's own exercise's ID (null when unknown, never a guess). */
  exercise(idOrKey: string): Promise<Exercise | null>;
}

export function createGymUpdateExecutor(deps: GymUpdateDeps): ToolExecutor {
  return async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'update_gym') throw new TypeError(call.tool);
    const a = call.args;
    const refuse = async (detail: ActionDetail, status: 'rejected' | 'stale', failure: string | null): Promise<ToolResult> => {
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure, reason: a.reason }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused gym change');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    const place = await deps.gym(a.gymName);
    const empty = (gym: Gym | null): ActionDetail => ({
      kind: 'update_gym',
      gymId: gym?.id ?? '00000000-0000-4000-8000-000000000000',
      gymName: gym?.name ?? (a.gymName?.trim() || 'Gym'),
      lines: ['No change'],
      edit: { gymId: gym?.id ?? '00000000-0000-4000-8000-000000000000', gym: null, equipment: [], lines: [] },
    });
    if (place === null) return refuse(empty(null), 'rejected', a.gymName === null ? 'there is no gym saved' : `there is no saved gym called ${a.gymName}`);
    const known = new Map<string, Pick<Exercise, 'id' | 'name' | 'compatibleEquipment' | 'defaultLoadConvention'>>();
    for (const c of a.changes) {
      if (c.op !== 'not_here' || known.has(c.exerciseId)) continue;
      const e = await deps.exercise(c.exerciseId).catch(() => null);
      if (e !== null) known.set(c.exerciseId, e);
    }
    // The model names an exercise by catalogue ID; the plan marks it by its row ID.
    const changes: GymUpdateChange[] = a.changes.map((c) => (c.op === 'not_here' ? { op: 'not_here', exerciseId: known.get(c.exerciseId)?.id ?? c.exerciseId } : c));
    const byId = new Map([...known.values()].map((e) => [e.id, e]));
    let n = 0;
    const plan = planGymUpdate({
      gym: place.gym,
      equipment: place.equipment,
      unit: place.unit,
      changes,
      exercise: (id) => byId.get(id) ?? null,
      atUtc: ctx.now.utc,
      // Derived from the opId, so a replayed call plans the same item IDs.
      newId: () => deriveId(`coach-gym-item:${ctx.opId}:${String((n += 1))}`),
    });
    if (!plan.ok) return refuse(empty(place.gym), 'rejected', plan.reason);
    const detail: ActionDetail = { kind: 'update_gym', gymId: place.gym.id, gymName: place.gym.name, lines: plan.edit.lines.length > 0 ? plan.edit.lines : ['No change'], edit: plan.edit };
    const entityVersions = [
      ...(plan.edit.gym === null ? [] : [{ entity: 'gym', id: place.gym.id, before: plan.edit.gym.before.version, after: plan.edit.gym.after.version }]),
      ...plan.edit.equipment.map((e) => ({ entity: 'equipment', id: e.after.id, before: e.before?.version ?? null, after: e.after.version })),
    ];
    if (!gymChangeAsked(ctx.benWords, { benAsked: a.benAsked ?? null, benQuote: a.benQuote ?? null })) {
      // The coach's own idea (rule 3): a card holding exactly what Apply saves.
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'proposed', reason: a.reason, entityVersions }) });
      if (r.status === 'conflict') throw new Error('Could not record the gym suggestion');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    }
    const w = await deps.store.commit(ctx.ownerId, { kind: 'gym_edit', action: newActionRecord(ctx, detail, { reason: a.reason, entityVersions }), edit: plan.edit });
    if (w.status !== 'conflict') return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
    return refuse(detail, w.reason === 'stale_version' ? 'stale' : 'rejected', w.reason === 'stale_version' ? null : 'the gym wasn’t found');
  };
}
