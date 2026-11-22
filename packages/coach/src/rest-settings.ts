import type { ActionDetail, RestSettings, TrainingChange, UpdateRestSettingsArgs } from '@fizz/schemas';
import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * (Ben, 2 Nov) `update_rest_settings`: Ben's rest settings (Profile › Rest times per set type, `Rest when short on
 * time`, `Shorten main lift too`). His settings, so it applies at once with Undo when he asks (rule 3: his words this
 * turn, `asksForRestChange`); otherwise nothing changes and the coach asks. The app's port checks the call with Rest
 * times' own limits (`restSettingsChange`) on the profile version read; profile and record are one write (rule 5). When a
 * workout is live and the change moves some of its pending rests, the card offers `Today too?` (its own change, with
 * its own Undo), as `Make main lift` offers `Every week?`. Done sets never change (rule 2).
 *
 * Offered only on turns whose words are about rest (coachtime's trimmed context, 1 Nov).
 */

export interface PreparedRestSettings {
  change: Extract<TrainingChange, { kind: 'rest_settings' }>;
  before: RestSettings;
  after: RestSettings;
  lines: string[];
  profileId: string;
  expectedVersion: number;
  /** The live workout when the change moves some of its pending rests (`Today too?`); null otherwise. */
  today: { sessionId: string; sets: number } | null;
}

export interface RestSettingsDeps {
  store: CoachWriteStore;
  /** `actionId`: the record's ID (`Today too` runs under it). */
  prepare(args: UpdateRestSettingsArgs, at: { actionId: string; opId: string; nowUtc: string; tz: string }): Promise<{ ok: true; prepared: PreparedRestSettings } | { ok: false; line: string }>;
}

/** Sent while the tool is offered. */
export const REST_SETTINGS_TOOL_LINE =
  'Rest settings are his to change: update_rest_settings sets his default rest per set type (workingMain = main lift, top, backoff, workingCompound and workingIsolation = accessories, round = superset round, warmup), Rest when short on time (normal, shorter, shortest) and Shorten main lift too. Seconds in 15 s steps from 30 to 360. If a workout is live the card offers Today too; never say you changed today’s sets. benAsked true only when his message this turn asks, with benQuote his words copied exactly.';

/** Fed back when Ben didn't ask: nothing changed (rule 3). */
export const REST_SETTINGS_NOT_ASKED_LINE = 'Not changed: Ben did not ask for this rest change. In reply, ask briefly if he wants it ("Want me to change your rest times?").';

/** Rest times, the `Shorten main lift too` switch, or `Rest when short on time` (not "I'm short on time today"). */
const REST_WORD = /\brest(?:s|ing)?\b|\bshorten (?:the )?main lift\b|\bwhen (?:i'?m |i am )?short (?:on|of) time\b/i;
const CHANGE_WORD = /\b(?:\d+|one|two|three|four|five|six|half|minute|minutes|min|mins|sec|secs|seconds|shorter|longer|less|more|turn|switch|on|off|set|make|use|change|reset|default|standard|medium|minimum|please|want|shorten|keep)\b/i;
const QUESTION_ONLY = /^\s*(?:what|why|how long|how much|should i|do you think|is it|are)\b[^.!]*\?\s*$/i;

/** "Rest day", "rest week": about the week, not rest times. */
const NOT_REST_TIMES = /\brest (?:day|week)s?\b/gi;

export function asksForRestChange(words: string): boolean {
  const w = words.trim();
  if (w === '' || QUESTION_ONLY.test(w)) return false;
  const t = w.replace(NOT_REST_TIMES, '');
  return REST_WORD.test(t) && CHANGE_WORD.test(t);
}

/** Ben's words are about rest times at all: the tool is offered on this turn. */
export function mentionsRestSettings(words: string): boolean {
  return REST_WORD.test(words.replace(NOT_REST_TIMES, ''));
}

export function createRestSettingsExecutors(deps: RestSettingsDeps): CoachExecutors {
  return {
    update_rest_settings: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'update_rest_settings') throw new TypeError(call.tool);
      const r = await deps.prepare(call.args, { actionId: actionIdFor(ctx.opId), opId: ctx.opId, nowUtc: ctx.now.utc, tz: ctx.now.tz });
      if (!r.ok) return { kind: 'refused', line: r.line };
      const p = r.prepared;
      const detail: ActionDetail = { kind: 'update_rest_settings', lines: p.lines.slice(0, 10), before: p.before, after: p.after, today: p.today };
      const action = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'rest_settings', id: p.profileId, before: p.expectedVersion, after: p.expectedVersion + 1 }] });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'rest_settings', action, change: p.change, expectedVersion: p.expectedVersion });
      if (w.status !== 'conflict') return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
      const stale = newActionRecord({ ...ctx, opId: `${ctx.opId}:stale` }, detail, { status: 'stale', failure: 'your settings changed' });
      const s = await deps.store.commit(ctx.ownerId, { kind: 'record', action: stale });
      if (s.status === 'conflict') throw new Error('Could not record the stale rest change');
      return { kind: 'action', record: s.action, replayed: s.status === 'replayed' };
    },
  };
}
