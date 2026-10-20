import { deriveId, planGymUpdate, type GymUpdateChange } from '@fizz/domain';
import type { ActionDetail, EquipmentInstance, Exercise, Gym, WeightUnit } from '@fizz/schemas';
import { newActionRecord, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';
import { quoteAsks, quoteInWords, type AskClaim } from './intent';

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

/** Ben stating what a gym has or lacks (his facts about his gym are his say-so). */
const GYM_FACT =
  /\b(?:no|doesn'?t have|does not have|don'?t have|do not have|hasn'?t got|has no|have no|there(?:'s| is| are)|they(?:'ve| have) got|has (?:a|an|got)|go(?:es)? up in|only go(?:es)? (?:up )?to|up to \d|in \d+(?:\.\d+)? ?(?:kg|lb|kilos?|pounds?)? ?(?:steps|jumps|increments)|steps? of \d|isn'?t (?:here|there)|aren'?t (?:here|there)|not (?:here|there|at this gym)|broken|out of order)\b/i;
/** A plain ask to change the gym's profile. */
const GYM_REQUEST = /\b(?:add|remove|take off|update|change|set|mark|make)\b[^.?!]*\b(?:gym|dumbbells?|stack|machines?|cables?|barbell|plates?)\b/i;

const GYM_PLACE = /\b(?:gym|here|this place)\b/i;
const EQUIPMENT_NOUN = /\b(?:dumbbells?|dbs|plates?|barbells?|bars?|racks?|stacks?|cables?|machines?|leg press|smith|kettlebells?|benches?|pull-?up bar|dip bars?|equipment)\b/i;
const STEP_WORDS = /\b(?:go(?:es)? up in|only go(?:es)? (?:up )?to|up to \d|steps? of|increments?|jumps? of)\b/i;

/**
 * (20 Oct, ADR 0029) Ben's words are about what a gym has: the place and a
 * fact or an ask ("this gym has no leg press", "no smith machine here"), or
 * an item and its steps ("dumbbells go up in 2s"). Opens `update_gym` for
 * the turn; whether a call applies is `gymChangeAsked`'s call.
 */
export function mentionsGymSetup(words: string): boolean {
  return (GYM_PLACE.test(words) && (GYM_FACT.test(words) || GYM_REQUEST.test(words))) || (EQUIPMENT_NOUN.test(words) && STEP_WORDS.test(words));
}

/**
 * Did Ben tell the app this about his gym? His words (a verified quote, else
 * the whole message) state a gym fact or ask for the change. A model claim
 * that he didn't ask is taken (an offer). No words (a tap): never.
 */
export function gymChangeAsked(words: string | null, claim: AskClaim): boolean {
  if (words === null || claim.benAsked === false) return false;
  if (claim.benAsked === true && claim.benQuote != null && quoteInWords(claim.benQuote, words)) {
    return quoteAsks(claim.benQuote, words) || GYM_FACT.test(claim.benQuote) || GYM_REQUEST.test(claim.benQuote);
  }
  return GYM_FACT.test(words) || GYM_REQUEST.test(words);
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
