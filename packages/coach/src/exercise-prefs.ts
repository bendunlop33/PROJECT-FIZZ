import type { ActionDetail, PlanDraft, SetExercisePreferenceArgs } from '@fizz/schemas';

import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `set_exercise_preference` (Ben, 2 Nov: "I don't like leg extensions, take them out"; on 1 Nov his stated dislike
 * changed nothing in his plan). One exercise's preference on the plan builder's **Any preferences** (the plan in use's
 * answers: what the builder, the plan swap and Rebalance read), set or cleared. Offered only on Ben's own like/dislike
 * words while a builder plan is in use (ADR 0039's registry, a targeted tool group so other turns don't grow).
 *
 * Rule 3: it is his stated preference, so it applies at once with Undo (the turn checks his words this turn,
 * `asksExercisePreference`). The plan is never changed by it: when a newly not-preferred exercise is in his plan, the
 * same card carries a **plan swap proposal** (the `propose_plan_swap` engine and card: each day's change, Apply, Undo),
 * its substitute the coach's from get_substitutions or the app's pick for the same muscles, never pain-flagged, not
 * preferred or unavailable here. One versioned write for the preference and its record (rule 5); the proposal after it.
 */

export interface PreparedExercisePref {
  /** The plan in use with the new preferences, and the version it was read at. */
  plan: PlanDraft;
  expectedVersion: number;
  detail: Omit<Extract<ActionDetail, { kind: 'set_exercise_preference' }>, 'kind' | 'swapActionId'>;
  /** The plan swap to offer with it (checked against the new preferences); null: none fits, or it isn't in the plan. */
  swap: Extract<ActionDetail, { kind: 'propose_plan_swap' }> | null;
  /** Why no swap is offered although the exercise is in the plan (for the coach); null otherwise. */
  noSwap: string | null;
}

export type ExercisePrefPrepared =
  | { kind: 'ok'; prepared: PreparedExercisePref }
  /** Already so: nothing to write; a swap may still be offered (Ben set it on Plan setup before, the plan still has it). */
  | { kind: 'already'; name: string; line: string; swap: Extract<ActionDetail, { kind: 'propose_plan_swap' }> | null }
  | { kind: 'refused'; line: string };

export interface ExercisePrefDeps {
  store: CoachWriteStore;
  /** Reads the plan in use, checks the exercise and makes the change and its swap; nothing is written here. */
  prepare(args: SetExercisePreferenceArgs, at: { opId: string; nowUtc: string; tz: string }): Promise<ExercisePrefPrepared>;
}

/** Sent while the tool is offered. */
export const EXERCISE_PREF_TOOL_LINE =
  'Exercise likes and dislikes are Ben’s to set: when he says he doesn’t like, wants rid of, or likes an exercise, call set_exercise_preference (not_preferred, preferred, or none to clear it). It is saved at once with Undo, on his plan’s Any preferences. With not_preferred, when his plan has it, the same card offers a swap in every plan day (a proposal he applies): swapTo is a substitute from get_substitutions for the same muscles, or null for the app’s pick; don’t also call propose_plan_swap for it. benAsked true only when his message this turn says it, with benQuote his words copied exactly.';

/** Fed back when Ben didn't state it this turn: nothing changed (rule 3). */
export const EXERCISE_PREF_NOT_ASKED_LINE = 'Not changed: Ben did not state this preference. In reply, ask briefly ("Want me to mark it not preferred?").';

/**
 * Ben's own words state a like or dislike of an exercise: "I don't like leg extensions", "I hate lunges", "not a fan of
 * dips", "no more leg extensions", "I like hack squats", "I prefer the leg press", "clear my dislike of lunges". A
 * question only ("should I drop lunges?") doesn't.
 */
// A plain "remove" or "take it out" is a change to the plan or today (the swap and edit tools), not a stated preference.
const DISLIKE = /\b(?:don['’]?t|do not|didn['’]?t|never)\s+(?:really\s+)?(?:like|enjoy|want|fancy)\b|\b(?:dislike|hate|loathe|detest|can['’]?t stand|not a fan|no fan|no more|not preferred|non[\s-]?preferred)\b/i;
const LIKE = /\b(?:i\s+(?:really\s+)?(?:like|love|enjoy|prefer)|prefer(?:red)?|(?:i['’]?m )?a (?:big )?fan of)\b/i;
const CLEAR = /\b(?:clear|reset|undo|forget|no longer)\b.*\b(?:dislike|preference|not preferred|like)\b|\b(?:ok|fine|happy)\s+(?:with|doing)\b/i;
const QUESTION_ONLY = /^\s*(?:what|why|how|should i|do you think|is it|are|would|could)\b[^.!]*\?\s*$/i;

export function asksExercisePreference(words: string): boolean {
  const w = words.trim();
  if (w === '' || QUESTION_ONLY.test(w)) return false;
  return DISLIKE.test(w) || LIKE.test(w) || CLEAR.test(w);
}

/** The swap proposal's op ID and record ID, from the preference's: a retry or restart makes it once (rule 5). */
export const prefSwapOpId = (opId: string): string => `${opId}:swap`;

export function createExercisePrefExecutors(deps: ExercisePrefDeps): CoachExecutors {
  return {
    set_exercise_preference: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'set_exercise_preference') throw new TypeError(call.tool);
      const r = await deps.prepare(call.args, { opId: ctx.opId, nowUtc: ctx.now.utc, tz: ctx.now.tz }).catch((): ExercisePrefPrepared => ({ kind: 'refused', line: 'Your plan couldn’t be read just now.' }));
      if (r.kind === 'refused') return { kind: 'refused', line: r.line };
      if (r.kind === 'already') {
        if (r.swap === null) return { kind: 'refused', line: r.line };
        // Already so (set on Plan setup): the swap he still needs is its own proposal card in this turn.
        const saved = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord({ ...ctx, opId: prefSwapOpId(ctx.opId) }, r.swap, { status: 'proposed', reason: `${r.name} is not preferred.` }) });
        if (saved.status === 'conflict') throw new Error('Could not record the plan swap');
        return { kind: 'action', record: saved.action, replayed: saved.status === 'replayed', line: `${r.line} The plan swap is shown as a card with Apply.` };
      }
      const p = r.prepared;
      const swapActionId = p.swap === null ? null : actionIdFor(prefSwapOpId(ctx.opId));
      const detail: ActionDetail = { kind: 'set_exercise_preference', ...p.detail, swapActionId };
      const action = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'exercise_pref', id: p.plan.id, before: p.expectedVersion, after: p.expectedVersion + 1 }] });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'exercise_pref', action, plan: p.plan, expectedVersion: p.expectedVersion });
      if (w.status === 'conflict') {
        const stale = newActionRecord({ ...ctx, opId: `${ctx.opId}:stale` }, { ...detail, swapActionId: null }, { status: 'stale', failure: 'your plan changed' });
        const s = await deps.store.commit(ctx.ownerId, { kind: 'record', action: stale });
        if (s.status === 'conflict') throw new Error('Could not record the stale preference');
        return { kind: 'action', record: s.action, replayed: s.status === 'replayed' };
      }
      let line: string | undefined = p.noSwap ?? undefined;
      if (p.swap !== null) {
        // The swap is a proposal shown inside this card (no turn of its own), so the thread has one card for both.
        const proposal = { ...newActionRecord({ ...ctx, opId: prefSwapOpId(ctx.opId) }, p.swap, { status: 'proposed', reason: `${p.detail.name} is not preferred.` }), turnId: null };
        const s = await deps.store.commit(ctx.ownerId, { kind: 'record', action: proposal });
        if (s.status === 'conflict') line = 'Saved. The plan swap couldn’t be made just now.';
        else {
          const sd = p.swap;
          line = `Saved: ${p.detail.name} not preferred. The same card offers ${sd.removeName ?? p.detail.name} → ${sd.addName} in ${sd.days.map((d) => d.routineName).join(', ')} (a proposal he applies).`;
        }
      }
      return { kind: 'action', record: w.action, replayed: w.status === 'replayed', ...(line === undefined ? {} : { line }) };
    },
  };
}
