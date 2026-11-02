import type { ActionDetail, ProposeWorkoutFixArgs } from '@fizz/schemas';

import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `propose_workout_fix` (Ben, 2 Nov): fixing past workouts from any chat. "That Tuesday pull was actually Monday",
 * "delete the duplicate push workout from Saturday", "pair my Garmin run on Thursday with the planned run". Always a
 * proposal with the before and after, Apply and Undo (rule 2: a done workout is never changed silently); Apply writes
 * on the versions proposed, so a workout or pairing changed since is refused as stale (rule 5).
 *
 * Offered only on Ben's own words about a past workout's date, a duplicate, or pairing (`asksPastWorkoutFix`), so an
 * ordinary turn carries neither the tool nor its line (the trimmed context). The app's port (`prepare`) reads the
 * workout or Health workout, checks the change with the existing rules (the reducer's time checks, History's delete
 * rules, the day sheet's pairing choices) and writes nothing; this saves the proposal or one honest refusal line.
 */

export type WorkoutFixPrepared =
  | { kind: 'ok'; detail: Extract<ActionDetail, { kind: 'fix_workout' }> }
  /** `line`: why not, as app text (`Not one of Thursday's workouts it can pair with`); `title`: for the card. */
  | { kind: 'refused'; line: string; title?: string };

export interface WorkoutFixDeps {
  store: CoachWriteStore;
  /** Reads and checks the fix; nothing is written here. */
  prepare(args: ProposeWorkoutFixArgs): Promise<WorkoutFixPrepared>;
}

/** Sent while the tool is offered (Ben's words are about fixing a past workout). */
export const WORKOUT_FIX_LINE = [
  'Fixing past workouts: propose_workout_fix moves a workout’s date or times, deletes a duplicate or wrong workout, or pairs/unpairs a Health (Garmin, watch) workout, always as a card Ben applies, with Undo. Never say it changed before he taps Apply.',
  'Find the workout first: get_recent_sessions with date (YYYY-MM-DD) for the day he named; it lists that day’s workouts (sessionId, title, time, source) and its Health workouts (healthId, link). Use those IDs exactly; when two could match, ask which.',
  '"That Tuesday pull was actually Monday": op move, workoutId, date the new day (time kept unless he gave one). "Delete the duplicate": op delete on the copy (the later one, or the one with fewer sets). A Health workout: op pair with healthId and the app workoutId; with Ben’s planned run that day (it then counts as done with the run’s recorded time and distance), workoutId null; with two runs that day, ask which. op unpair with healthId takes it off again. "These two are the same workout": a Health workout and an app workout → pair; two app workouts can’t be merged, so propose deleting the duplicate.',
].join('\n');

/** Ben's words ask to fix a past workout: its day or time, a duplicate or wrong one, or a Health pairing. */
const DAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?';
const WORKOUT = '(?:workout|session|pull|push|legs?|upper|lower|full[ -]body|run|ride|swim|lift)';
const MOVE = new RegExp(`\\b(?:was|were)\\s+(?:actually|really|on)\\s+(?:on\\s+)?(?:${DAY}|yesterday|the\\s+\\d)|\\bwrong\\s+(?:day|date|time)\\b|\\b(?:move|change|shift|put)\\b[^.?!]*\\b${WORKOUT}s?\\b[^.?!]*\\b(?:to|on)\\s+(?:${DAY}|yesterday|the\\s+\\d|\\d)|\\b(?:date|time)\\s+of\\s+(?:my|that|the)\\b[^.?!]*\\b${WORKOUT}|\\bnot\\s+(?:on\\s+)?${DAY}\\b`, 'i');
const DELETE = new RegExp(`\\b(?:delete|remove|get\\s+rid\\s+of|bin|scrap)\\b[^.?!]*\\b(?:${WORKOUT}s?|duplicate|copy)\\b|\\bduplicate\\b|\\blogged\\s+(?:it\\s+)?twice\\b|\\btwo\\s+copies\\b`, 'i');
const PAIR = /\b(?:un)?pair(?:ed|ing)?\b|\b(?:un)?link\b[^.?!]*\b(?:garmin|watch|health|run|workout)\b|\bsame\s+(?:workout|session|run)\b|\bmerge\b/i;

export function asksPastWorkoutFix(words: string): boolean {
  const w = words.trim();
  if (w === '') return false;
  return MOVE.test(w) || DELETE.test(w) || PAIR.test(w);
}

export function createWorkoutFixExecutor(deps: WorkoutFixDeps): CoachExecutors {
  return {
    propose_workout_fix: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'propose_workout_fix') throw new TypeError(call.tool);
      const a = call.args;
      const r = await deps.prepare(a).catch((): WorkoutFixPrepared => ({ kind: 'refused', line: 'Not proposed: your workouts couldn’t be read just now' }));
      if (r.kind === 'refused') {
        // One honest line on a card (`Not changed: …`); the coach is told the same.
        const detail: ActionDetail = { kind: 'fix_workout', op: a.op, sessionId: null, sessionVersion: null, title: (r.title ?? 'Workout').slice(0, 120), before: '–', after: '–' };
        const refused = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'rejected', failure: r.line.slice(0, 200), reason: a.reason.slice(0, 240) }) });
        if (refused.status === 'conflict') throw new Error('Could not record the refused workout fix');
        return { kind: 'action', record: refused.action, replayed: refused.status === 'replayed' };
      }
      const saved = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, r.detail, { status: 'proposed', reason: a.reason.slice(0, 240) }) });
      if (saved.status === 'conflict') throw new Error('Could not record the workout fix');
      return { kind: 'action', record: saved.action, replayed: saved.status === 'replayed' };
    },
  };
}
