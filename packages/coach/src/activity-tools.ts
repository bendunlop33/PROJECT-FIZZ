import { addActivity, addDays, checkWeekProposal, daysBetween, deriveId, localDateOf, toMs, weekdayIndexOfDate, type WeekFacts } from '@fizz/domain';
import type { Activity, ActivityEffort, ActivityFields, ActivityKind, ActionDetail, ActionRecord, WeekBasis, ZonedTimestamp } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';
import { asksToLogActivity } from './request';

/**
 * (Ben, 20 Oct: "if I did or have planned a long run maybe we swap to a push
 * rather than shoulder and chest separately") Two coach tools.
 *
 * - `log_activity`: a run, ride, swim or sport Ben tells the coach about.
 *   When his own words tell it (`asksToLogActivity`, code's reading) it is
 *   logged at once, with Undo on the card; otherwise the call is saved as an
 *   offer (`proposed`) that his tap logs (rule 3). What he said wins over the
 *   model's reading: the day ("yesterday", "Saturday"), the distance, the
 *   time and the effort word. An effort he didn't say is never added (rule
 *   6). A date after today is planned, one before it done.
 * - `propose_week`: this week's remaining days merged or skipped, checked
 *   against the week's facts (`checkWeekProposal`) and saved as a proposal
 *   with its before/after list. Only Ben's Apply changes anything; Apply is
 *   refused as stale when the week moved on since (rule 5).
 */

// ---------------------------------------------------------------------------
// Ben's words

export interface ActivityWords {
  kind?: ActivityKind;
  date?: string;
  distanceM?: number;
  durationS?: number;
  effort?: ActivityEffort;
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY = /\b(mon|tues|tue|wednes|wed|thurs|thu|fri|satur|sat|sun)(?:day)?\b/;
const PAST = /\b(?:did|done|ran|rode|swam|had|was|went|played|finished|completed|last)\b/;

/** What Ben's words say about an activity, as local values (`today`: his local date). Parts he didn't say are absent. */
export function activityWords(text: string, today: string): ActivityWords {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const out: ActivityWords = {};
  if (/\b(?:run|ran|jog|jogged|jogging|parkrun|marathon|10k|5k)\b/.test(t)) out.kind = 'run';
  else if (/\b(?:ride|rode|cycle|cycled|cycling|bike)\b/.test(t)) out.kind = 'ride';
  else if (/\b(?:swim|swam|swimming)\b/.test(t)) out.kind = 'swim';
  else if (/\b(?:football|five-a-side|5-a-side|tennis|squash|padel|rugby|netball|basketball|hockey|cricket|golf)\b/.test(t)) out.kind = 'sport';
  // Distance: "18 km", "18k", "10 miles", "half marathon".
  const km = /\b(\d+(?:\.\d+)?) ?(km|kms|k|mi|mile|miles)\b/.exec(t);
  if (km?.[1] !== undefined) out.distanceM = Math.round(Number(km[1]) * (km[2]?.startsWith('m') === true ? 1609.344 : 1000));
  else if (/\bhalf marathon\b/.test(t)) out.distanceM = 21_097;
  else if (/\bmarathon\b/.test(t)) out.distanceM = 42_195;
  // Time: "90 min", "1.5 hours", "1h 30", "2 hour".
  const hours = /\b(\d+(?:\.\d+)?) ?(?:h|hr|hrs|hour|hours)\b/.exec(t);
  const mins = /\b(\d+) ?(?:m|min|mins|minute|minutes)\b(?! ?(?:i|il|ile|iles)\b)/.exec(t);
  const s = (hours?.[1] === undefined ? 0 : Number(hours[1]) * 3600) + (mins?.[1] === undefined ? 0 : Number(mins[1]) * 60);
  if (s > 0) out.durationS = Math.round(s);
  // Effort: his own word only.
  if (/\blong\b/.test(t)) out.effort = 'long';
  else if (/\b(?:hard|tempo|intervals?|race|raced)\b/.test(t)) out.effort = 'hard';
  else if (/\b(?:easy|recovery|gentle)\b/.test(t)) out.effort = 'easy';
  else if (/\b(?:moderate|steady)\b/.test(t)) out.effort = 'moderate';
  // Day.
  if (/\b(?:yesterday|last night)\b/.test(t)) out.date = addDays(today, -1);
  else if (/\b(?:tomorrow|tmrw|tmr)\b/.test(t)) out.date = addDays(today, 1);
  else if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) out.date = today;
  else {
    const w = WEEKDAY.exec(t);
    if (w?.[1] !== undefined) {
      const idx = WEEKDAYS.findIndex((d) => w[1]?.startsWith(d) === true);
      const todayIdx = weekdayIndexOfDate(today);
      if (idx >= 0) {
        const ahead = (idx - todayIdx + 7) % 7;
        const back = (todayIdx - idx + 7) % 7;
        // "Long run Saturday" is the next one; "did a long run Saturday" the last one. Today's weekday is today.
        out.date = ahead === 0 ? today : PAST.test(t) ? addDays(today, -back) : addDays(today, ahead);
      }
    }
  }
  return out;
}

/** How far from today an activity may be dated. */
const MAX_DAYS_AWAY = 60;

/** The fields to log: Ben's words win; a day after today is planned, one before it done. Null when the date is out of range. */
export function activityFieldsFrom(args: { kind: ActivityKind; status: 'done' | 'planned'; date: string; durationMin: number | null; distanceKm: number | null }, words: ActivityWords, today: string): ActivityFields | null {
  const date = words.date ?? args.date;
  if (Math.abs(daysBetween(today, date)) > MAX_DAYS_AWAY) return null;
  const status = date > today ? 'planned' : date < today ? 'done' : args.status;
  return {
    kind: words.kind ?? args.kind,
    status,
    date,
    durationS: words.durationS ?? (args.durationMin === null ? null : args.durationMin * 60),
    distanceM: words.distanceM ?? (args.distanceKm === null ? null : Math.round(args.distanceKm * 1000)),
    effort: words.effort ?? null,
  };
}

// ---------------------------------------------------------------------------
// log_activity

export interface ActivityToolDeps {
  store: CoachWriteStore;
  /** Ben's zone (dates are local). */
  tz: string;
  /** Live activities on one local date (a second log of the same one is refused). */
  onDate(date: string): Promise<readonly Activity[]>;
}

/** The activity ID a call (or Ben's accept of an offer) writes: from its op ID, so a replay writes the same row. */
export const activityIdFor = (opId: string): string => deriveId(`activity:${opId}`);

async function record(store: CoachWriteStore, ownerId: string, action: ActionRecord): Promise<ToolResult> {
  const r = await store.commit(ownerId, { kind: 'record', action });
  if (r.status === 'conflict') throw new Error('Could not record the activity');
  return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
}

/** Log `fields` as an activity with its record, in one write. */
async function logIt(deps: ActivityToolDeps, base: { ownerId: string; turnId: string; opId: string; now: ZonedTimestamp }, fields: ActivityFields, extra: { proposalId?: string; reason: string | null }): Promise<ToolResult> {
  const detail = (over: Partial<Extract<ActionDetail, { kind: 'log_activity' }>>): ActionDetail => ({ kind: 'log_activity', activityId: null, fields, versionAfter: null, ...(extra.proposalId === undefined ? {} : { proposalId: extra.proposalId }), ...over });
  const refuse = (status: 'rejected' | 'stale', failure: string | null): Promise<ToolResult> => record(deps.store, base.ownerId, newActionRecord({ ...base, opId: `${base.opId}:refused` }, detail({}), { status, failure, reason: extra.reason }));
  const same = (await deps.onDate(fields.date)).find((a) => a.fields.kind === fields.kind && a.fields.status === fields.status && a.id !== activityIdFor(base.opId));
  if (same !== undefined) return refuse('rejected', 'it’s already logged');
  const c = addActivity({ id: activityIdFor(base.opId), ownerId: base.ownerId, fields, source: 'coach', opId: base.opId, at: base.now });
  if (c.kind !== 'write') return refuse('rejected', c.kind === 'invalid' ? c.reason : 'it was refused');
  const action = newActionRecord(base, detail({ activityId: c.next.id, versionAfter: c.next.version }), { reason: extra.reason, entityVersions: [{ entity: 'activity', id: c.next.id, before: null, after: c.next.version }] });
  const w = await deps.store.commit(base.ownerId, { kind: 'activity', action, activity: c.next, expectedVersion: null });
  if (w.status === 'conflict') return refuse('stale', null);
  return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
}

export function createActivityExecutor(deps: ActivityToolDeps): CoachExecutors {
  return {
    log_activity: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'log_activity') throw new TypeError(call.tool);
      const today = localDateOf(toMs(ctx.now.utc), deps.tz);
      const words = ctx.benWords === null ? {} : activityWords(ctx.benWords, today);
      const fields = activityFieldsFrom(call.args, words, today);
      const reason = call.args.reason;
      if (fields === null) {
        const detail: ActionDetail = { kind: 'log_activity', activityId: null, fields: { kind: call.args.kind, status: call.args.status, date: today, durationS: null, distanceM: null, effort: null }, versionAfter: null };
        return record(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'rejected', failure: 'the date is too far away', reason }));
      }
      if (fields.durationS === null && fields.distanceM === null && fields.effort === null) {
        // Nothing but the kind and day: an effort would be invented (rule 6), so nothing is logged.
        const detail: ActionDetail = { kind: 'log_activity', activityId: null, fields, versionAfter: null };
        return record(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'rejected', failure: 'it needs a time, a distance or how hard it was', reason }));
      }
      const asked = ctx.benWords !== null && asksToLogActivity(ctx.benWords);
      // Rule 3: the coach raised it, so it is an offer Ben taps to log.
      if (!asked) return record(deps.store, ctx.ownerId, newActionRecord(ctx, { kind: 'log_activity', activityId: null, fields, versionAfter: null }, { status: 'proposed', reason }));
      return logIt(deps, ctx, fields, { reason });
    },
  };
}

/** The op ID of Ben's tap on an offer: a double tap logs once. */
export const acceptActivityOpId = (proposalActionId: string): string => `accept:${proposalActionId}`;

/** Ben's `Log` on the coach's offer: exactly the offered fields, logged under a record of its own. */
export async function acceptActivityOffer(deps: ActivityToolDeps, proposal: ActionRecord, ctx: { ownerId: string; turnId: string; now: ZonedTimestamp }): Promise<ToolResult> {
  const d = proposal.detail;
  if (d.kind !== 'log_activity' || proposal.status !== 'proposed') return { kind: 'refused', line: 'There is no offer to log.' };
  return logIt(deps, { ownerId: ctx.ownerId, turnId: ctx.turnId, opId: acceptActivityOpId(proposal.actionId), now: ctx.now }, d.fields, { proposalId: proposal.actionId, reason: proposal.reason });
}

// ---------------------------------------------------------------------------
// propose_week

/** The week as `propose_week` checks it, read fresh for each call. */
export interface WeekToolContext {
  facts: WeekFacts;
  basis: WeekBasis;
  factsKey: string;
}

export interface WeekToolDeps {
  store: CoachWriteStore;
  week(): Promise<WeekToolContext | null>;
}

export function createWeekExecutor(deps: WeekToolDeps): CoachExecutors {
  return {
    propose_week: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'propose_week') throw new TypeError(call.tool);
      const w = await deps.week();
      const base = (over: Partial<Extract<ActionDetail, { kind: 'propose_week' }>>): ActionDetail => ({
        kind: 'propose_week',
        weekMonday: w?.facts.monday ?? localDateOf(toMs(ctx.now.utc), 'UTC'),
        basis: w?.basis ?? { kind: 'split' },
        merges: [],
        skips: [],
        before: [],
        after: [],
        factsKey: w?.factsKey ?? 'none',
        ...over,
      });
      if (w === null || w.facts.remaining.length === 0) return record(deps.store, ctx.ownerId, newActionRecord(ctx, base({}), { status: 'rejected', failure: 'no days are left this week' }));
      const check = checkWeekProposal(call.args, w.facts);
      if (!check.ok) return record(deps.store, ctx.ownerId, newActionRecord(ctx, base({}), { status: 'rejected', failure: check.failure }));
      const detail = base({ merges: check.merges, skips: check.skips, before: check.before, after: check.after });
      return record(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'proposed', reason: call.args.message.trim() === '' ? null : call.args.message.trim().slice(0, 240) }));
    },
  };
}

