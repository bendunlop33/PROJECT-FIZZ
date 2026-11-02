import type { ActionDetail, SessionCommand, TrainingChange, UpdateWarmupPrefsArgs, WarmupPrefs } from '@fizz/schemas';
import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `update_warmup_prefs` (Ben, 1 Nov: "warm-ups should use simple, easy-to-load weights"; "cuff rotations should stay
 * easy"). His warm-up preferences on the training profile: `Simple warm-up weights`, and warm-ups off or on per
 * exercise. Offered in every chat whenever a profile exists (ADR 0039). Rule 3: it applies at once with Undo only
 * when Ben asked (the turn checks his words, `asksForWarmupChange`); otherwise nothing changes and the coach asks.
 *
 * The app checks the call (`prepare`): the exercises among those he has, the change on the profile version read,
 * and today's not-yet-done warm-ups planned again under the new preferences (an `adjust_pending_targets` under this
 * action's ID). Profile, workout and record are one write (rule 5); a stale profile or workout records it as stale.
 * Logged sets never change (rule 2).
 */

export interface PreparedWarmupPrefs {
  change: Extract<TrainingChange, { kind: 'warmup_prefs' }>;
  before: WarmupPrefs | null;
  after: WarmupPrefs | null;
  /** The training profile's ID and the version the checks read. */
  profileId: string;
  expectedVersion: number;
  /** One line per change: `Simple warm-up weights on`, `Face pull: no warm-ups`. */
  lines: string[];
  /** The open workout's warm-ups planned again, or null (none open, or nothing different). */
  session: { sessionId: string; command: SessionCommand; changedSetIds: string[]; removedSetIds: string[] } | null;
}

export interface WarmupPrefsDeps {
  store: CoachWriteStore;
  /** `actionId`: the record's ID, carried by every warm-up the change plans again (its Undo). */
  prepare(args: UpdateWarmupPrefsArgs, at: { actionId: string; opId: string; nowUtc: string; tz: string }): Promise<{ ok: true; prepared: PreparedWarmupPrefs } | { ok: false; line: string }>;
}

/** Sent while the tool is offered. */
export const WARMUP_PREFS_TOOL_LINE =
  'Warm-ups are yours to change: update_warmup_prefs sets Simple warm-up weights (easy-to-load jumps: bar, then 10 kg steps; dumbbells in 5s) and turns warm-ups off or back to normal per exercise, and re-plans today’s warm-ups not yet done. Never say you can’t change warm-ups or a plan-wide warm-up rule. Prehab and rotator cuff work has no warm-ups by default. benAsked true only when his message this turn asks, with benQuote his words copied exactly.\n' +
  'A standing cardio-first rule ("bike for 8 minutes first on leg days, rowing for 4 minutes first on other days", "5 min row before every workout") is update_warmup_prefs general, in one call: one entry per kind of day (legs, other, all) with the cardio exercise and minutes. It goes first in every workout he starts, whatever plan he is on, and counts in the workout’s time. Never a plan add or a plan-day edit for this, and never ask which days are leg days: code decides from each day’s exercises. A one-off for today only ("add a bike to today") is today’s workout edit, not this.';

/** Fed back when Ben didn't ask: nothing changed (rule 3). */
export const WARMUP_PREFS_NOT_ASKED_LINE = 'Not changed: Ben did not ask for this warm-up change. In reply, ask briefly if he wants it ("Want me to change your warm-ups?").';

/** Words that ask for a warm-up change: "simple warm-up weights", "no warm-ups on face pulls", "turn warm-ups back on for curls". */
const WARMUP_WORD = /\bwarm[\s-]?ups?\b/i;
const CHANGE_WORD = /\b(?:simple|simpler|easy|easier|round(?:ed)?|plate|no|off|skip|drop|remove|stop|turn|use|make|keep|back|on|again|fewer|change|set|always|never|don'?t|want|please)\b/i;
const QUESTION_ONLY = /^\s*(?:what|why|how|should i|do you think|is it|are)\b[^.!]*\?\s*$/i;

export function asksForWarmupChange(words: string): boolean {
  const w = words.trim();
  if (w === '' || QUESTION_ONLY.test(w)) return false;
  return (WARMUP_WORD.test(w) && CHANGE_WORD.test(w)) || asksForGeneralWarmup(w);
}

/** Cardio machines and words Ben uses for them. */
const CARDIO_WORD = /\b(?:bike|biking|cycle|cycling|spin|row|rowing|rower|erg|ski ?erg|treadmill|run|jog|walk|incline walk|cross ?trainer|elliptical|stair ?master|stairs|stepper|air ?bike|assault bike|cardio)\b/i;
const MINUTES_WORD = /\b\d+(?:[.,]\d+)?\s*(?:-|to)?\s*(?:min|mins|minute|minutes)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty) (?:min|mins|minute|minutes)\b/i;
const FIRST_WORD = /\b(?:first|before|start(?:ing)? with|to start|begin(?:ning)? with|at the start|warm(?:ing)? up)\b/i;
const EVERY_DAY_WORD = /\b(?:(?:leg|legs|push|pull|upper|lower|other|all|non[- ]?leg|training|gym) days|every (?:\w+ )?(?:day|session|workout|time)|each (?:\w+ )?(?:day|session|workout)|from now on|always|going forward|(?:in|on|to) (?:my|the) plan)\b/i;

/**
 * (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days") A standing general
 * (cardio) warm-up rule: a cardio word, minutes, first or before, and every day or a kind of day. Today only ("add a
 * bike to today") is not one. Code's reading of his words (rule 3).
 */
export function asksForGeneralWarmup(words: string): boolean {
  const w = words.trim();
  if (w === '' || QUESTION_ONLY.test(w)) return false;
  if (/\b(?:today|tonight|this (?:session|workout)|right now)\b/i.test(w) && !EVERY_DAY_WORD.test(w)) return false;
  return CARDIO_WORD.test(w) && MINUTES_WORD.test(w) && FIRST_WORD.test(w) && EVERY_DAY_WORD.test(w);
}

export function createWarmupPrefsExecutors(deps: WarmupPrefsDeps): CoachExecutors {
  return {
    update_warmup_prefs: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'update_warmup_prefs') throw new TypeError(call.tool);
      const actionId = actionIdFor(ctx.opId);
      const r = await deps.prepare(call.args, { actionId, opId: ctx.opId, nowUtc: ctx.now.utc, tz: ctx.now.tz });
      if (!r.ok) return { kind: 'refused', line: r.line };
      const p = r.prepared;
      const detail: ActionDetail = {
        kind: 'update_warmup_prefs',
        lines: p.lines.slice(0, 21),
        before: p.before,
        after: p.after,
        sessionId: p.session?.sessionId ?? null,
        changedSetIds: p.session?.changedSetIds.slice(0, 60) ?? [],
        removedSetIds: p.session?.removedSetIds.slice(0, 60) ?? [],
      };
      const action = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'warmup_prefs', id: p.profileId, before: p.expectedVersion, after: p.expectedVersion + 1 }] });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'warmup_prefs', action, change: p.change, expectedVersion: p.expectedVersion, session: p.session === null ? null : { sessionId: p.session.sessionId, command: p.session.command } });
      if (w.status !== 'conflict') return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
      const stale = newActionRecord({ ...ctx, opId: `${ctx.opId}:stale` }, detail, { status: 'stale', failure: 'your settings or workout changed' });
      const s = await deps.store.commit(ctx.ownerId, { kind: 'record', action: stale });
      if (s.status === 'conflict') throw new Error('Could not record the stale warm-up change');
      return { kind: 'action', record: s.action, replayed: s.status === 'replayed' };
    },
  };
}
