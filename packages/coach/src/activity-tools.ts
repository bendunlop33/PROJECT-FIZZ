import { addActivity, addDays, checkWeekProposal, daysBetween, deriveId, editActivity, isLongActivity, localDateOf, toMs, weekdayIndexOfDate, type WeekFacts } from '@fizz/domain';
import type { Activity, ActivityEffort, ActivityFields, ActivityKind, ActionDetail, ActionRecord, WeekBasis, ZonedTimestamp } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';
import { asksToLogActivity } from './request';

/**
 * (Ben, 20 Oct: "if I did or have planned a long run maybe we swap to a push
 * rather than shoulder and chest separately") Two coach tools.
 *
 * - `log_activity`: a run, ride, swim or sport Ben tells the coach about.
 *   When his own words ask (`asksToLogActivity`, code's reading) and his
 *   words for that one activity back the call (`readActivityCall`), it is
 *   logged at once, with Undo on the card; otherwise the call is saved as an
 *   offer (`proposed`) that his tap logs (rule 3). An effort he didn't say
 *   for it is never added (rule 6). A date after today is planned, one
 *   before it done. A done run on a day he had one planned marks it done.
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

/** The activity a clause names, or none. The swim is checked on its own words, so "swam … and a run" is never one kind for both (review B1). */
function kindIn(t: string): ActivityKind | undefined {
  if (/\b(?:run|ran|jog|jogged|jogging|parkrun|marathon|10k|5k)\b/.test(t) && !/\b(?:run|ran|running) (?:out|through|over|late|me|it|low)\b/.test(t)) return 'run';
  if (/\b(?:ride|rode|cycle|cycled|cycling|bike)\b/.test(t)) return 'ride';
  if (/\b(?:swim|swam|swimming)\b/.test(t)) return 'swim';
  if (/\b(?:football|five-a-side|5-a-side|tennis|squash|padel|rugby|netball|basketball|hockey|cricket|golf)\b/.test(t)) return 'sport';
  if (/\b(?:hike|hiked|hiking)\b/.test(t)) return 'other';
  return undefined;
}

function effortIn(t: string): ActivityEffort | undefined {
  if (/\blong\b/.test(t)) return 'long';
  if (/\b(?:hard|tempo|intervals?|race|raced)\b/.test(t)) return 'hard';
  if (/\b(?:easy|recovery|gentle)\b/.test(t)) return 'easy';
  if (/\b(?:moderate|steady)\b/.test(t)) return 'moderate';
  return undefined;
}

function distanceIn(t: string): number | undefined {
  const km = /\b(\d+(?:\.\d+)?) ?(km|kms|k|mi|mile|miles)\b/.exec(t);
  if (km?.[1] !== undefined) return Math.round(Number(km[1]) * (km[2]?.startsWith('m') === true ? 1609.344 : 1000));
  if (/\bhalf marathon\b/.test(t)) return 21_097;
  if (/\bmarathon\b/.test(t)) return 42_195;
  return undefined;
}

function durationIn(t: string): number | undefined {
  const hours = /\b(\d+(?:\.\d+)?) ?(?:h|hr|hrs|hour|hours)\b/.exec(t);
  const mins = /\b(\d+) ?(?:m|min|mins|minute|minutes)\b(?! ?(?:i|il|ile|iles)\b)/.exec(t);
  const s = (hours?.[1] === undefined ? 0 : Number(hours[1]) * 3600) + (mins?.[1] === undefined ? 0 : Number(mins[1]) * 60);
  return s > 0 ? Math.round(s) : undefined;
}

function dateIn(t: string, today: string, past: boolean): string | undefined {
  if (/\b(?:yesterday|last night)\b/.test(t)) return addDays(today, -1);
  if (/\b(?:tomorrow|tmrw|tmr)\b/.test(t)) return addDays(today, 1);
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return today;
  const w = WEEKDAY.exec(t);
  if (w?.[1] === undefined) return undefined;
  const idx = WEEKDAYS.findIndex((d) => w[1]?.startsWith(d) === true);
  if (idx < 0) return undefined;
  const todayIdx = weekdayIndexOfDate(today);
  const ahead = (idx - todayIdx + 7) % 7;
  const back = (todayIdx - idx + 7) % 7;
  // "Long run Saturday" is the next one; "did a long run Saturday" the last one. Today's weekday is today.
  return ahead === 0 ? today : past ? addDays(today, -back) : addDays(today, ahead);
}

/** What one stretch of Ben's words says about an activity (`today`: his local date). Parts he didn't say are absent. */
export function activityWords(text: string, today: string): ActivityWords {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const out: ActivityWords = {};
  const kind = kindIn(t);
  if (kind !== undefined) out.kind = kind;
  const distanceM = distanceIn(t);
  if (distanceM !== undefined) out.distanceM = distanceM;
  const durationS = durationIn(t);
  if (durationS !== undefined) out.durationS = durationS;
  const effort = effortIn(t);
  if (effort !== undefined) out.effort = effort;
  const date = dateIn(t, today, PAST.test(t));
  if (date !== undefined) out.date = date;
  return out;
}

/** Clauses: sentences, then commas and joining words ("and", "also", "but", "then", "plus"). Decimals stay whole. */
function clausesOf(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\d)\.(\d)/g, '$1\u2024$2');
  return t
    .split(/[.!?;\n,]+|\b(?:and|also|but|then|plus|while)\b/)
    .map((c) => c.replace(/\u2024/g, '.').replace(/\s+/g, ' ').trim())
    .filter((c) => c !== '');
}

/**
 * Each activity Ben's message names, read from its own words only (review
 * B1): a clause that names an activity starts one; clauses after it with no
 * activity of their own add a day, distance or time it lacks ("did a run, 18
 * km"), never an effort ("hard" in "last session was hard" is about the gym).
 * Clauses before the first activity are about something else.
 */
export function activityMentions(text: string, today: string): ActivityWords[] {
  const out: ActivityWords[] = [];
  let open: { words: ActivityWords; text: string } | null = null;
  for (const c of clausesOf(text)) {
    if (kindIn(c) !== undefined) {
      open = { words: activityWords(c, today), text: c };
      out.push(open.words);
      continue;
    }
    if (open === null) continue;
    const w = open.words;
    // A day in a trailing clause reads past or future from the activity's own words too ("did a run, on Saturday").
    const past = PAST.test(`${open.text} ${c}`);
    const tail = { distanceM: distanceIn(c), durationS: durationIn(c), date: dateIn(c, today, past) };
    if (w.distanceM === undefined && tail.distanceM !== undefined) w.distanceM = tail.distanceM;
    if (w.durationS === undefined && tail.durationS !== undefined) w.durationS = tail.durationS;
    if (w.date === undefined && tail.date !== undefined) w.date = tail.date;
  }
  return out;
}

/** How far from today an activity may be dated. */
const MAX_DAYS_AWAY = 60;

type LogArgs = { kind: ActivityKind; status: 'done' | 'planned'; date: string; durationMin: number | null; distanceKm: number | null; effort: ActivityEffort | null };

/** Two readings of one number agree within a small margin (Ben's "18k" and the model's 18.0). */
const near = (a: number, b: number, abs: number): boolean => Math.abs(a - b) <= Math.max(abs, 0.03 * Math.max(a, b));

export interface ActivityReading {
  fields: ActivityFields;
  /**
   * Ben's own words for this activity back every value the model passed, and
   * his message names only this one. Only then is an asked-for activity
   * logged at once; otherwise it is an offer he taps (rule 3).
   */
  agrees: boolean;
}

/**
 * The model's call checked against Ben's words for that activity (review B1).
 * Values come from the model, with gaps filled from his words for it; where his
 * words for it say otherwise, his words are what the offer shows and `agrees`
 * is false. The effort is only ever his own word for it (rule 6): a model's
 * effort he didn't say is dropped (and makes it an offer), except `long` for a
 * run his numbers already make long. A day after today is planned, one before
 * it done. Null when the date is out of range.
 */
export function readActivityCall(args: LogArgs, benWords: string | null, today: string): ActivityReading | null {
  const mentions = benWords === null ? [] : activityMentions(benWords, today);
  const sameKind = mentions.filter((m) => m.kind === args.kind);
  const m = sameKind.find((x) => x.date === args.date) ?? sameKind[0] ?? (mentions.length === 1 ? mentions[0] : undefined);
  const modelDuration = args.durationMin === null ? null : args.durationMin * 60;
  const modelDistance = args.distanceKm === null ? null : Math.round(args.distanceKm * 1000);
  const kind = m?.kind ?? args.kind;
  const date = m?.date ?? args.date;
  const durationS = m?.durationS ?? modelDuration;
  const distanceM = m?.distanceM ?? modelDistance;
  const effort = m?.effort ?? null;
  if (Math.abs(daysBetween(today, date)) > MAX_DAYS_AWAY) return null;
  const status = date > today ? 'planned' : date < today ? 'done' : args.status;
  const fields: ActivityFields = { kind, status, date, durationS, distanceM, effort };
  const impliedLong = isLongActivity({ kind, effort: null, durationS, distanceM });
  const agrees =
    m !== undefined &&
    mentions.length === 1 &&
    m.kind === args.kind &&
    (m.date === undefined || m.date === args.date) &&
    (m.distanceM === undefined || modelDistance === null || near(m.distanceM, modelDistance, 100)) &&
    (m.durationS === undefined || modelDuration === null || near(m.durationS, modelDuration, 60)) &&
    (args.effort === null || args.effort === m.effort || (args.effort === 'long' && m.effort === undefined && impliedLong));
  return { fields, agrees };
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

/**
 * Log `fields` as an activity with its record, in one write. A done activity
 * on a day Ben had the same kind planned marks that one done (an edit,
 * versioned, Undo puts the plan back) instead of adding a second (review S5);
 * his new values win, the planned ones fill the gaps.
 */
async function logIt(deps: ActivityToolDeps, base: { ownerId: string; turnId: string; opId: string; now: ZonedTimestamp }, fields: ActivityFields, extra: { proposalId?: string; reason: string | null }): Promise<ToolResult> {
  const detail = (over: Partial<Extract<ActionDetail, { kind: 'log_activity' }>>): ActionDetail => ({ kind: 'log_activity', activityId: null, fields, versionAfter: null, ...(extra.proposalId === undefined ? {} : { proposalId: extra.proposalId }), ...over });
  const refuse = (status: 'rejected' | 'stale', failure: string | null): Promise<ToolResult> => record(deps.store, base.ownerId, newActionRecord({ ...base, opId: `${base.opId}:refused` }, detail({}), { status, failure, reason: extra.reason }));
  const live = await deps.onDate(fields.date);
  const onDay = live.filter((a) => a.fields.kind === fields.kind && a.id !== activityIdFor(base.opId) && !a.opIds.includes(base.opId));
  // A replay of a mark-done finds the activity it already wrote: the store replays the record.
  const marked = live.find((a) => a.opIds.includes(base.opId) && a.id !== activityIdFor(base.opId));
  if (marked !== undefined) return record(deps.store, base.ownerId, newActionRecord(base, detail({ activityId: marked.id, versionAfter: marked.version, markedDone: true })));
  if (onDay.some((a) => a.fields.status === fields.status)) return refuse('rejected', 'it’s already logged');
  const planned = fields.status === 'done' ? onDay.find((a) => a.fields.status === 'planned') : undefined;
  if (planned !== undefined) {
    const p = planned.fields;
    const done: ActivityFields = { ...fields, durationS: fields.durationS ?? p.durationS, distanceM: fields.distanceM ?? p.distanceM, effort: fields.effort ?? p.effort };
    const c = editActivity(planned, { opId: base.opId, at: base.now, expectedVersion: planned.version, fields: done });
    if (c.kind !== 'write') return refuse(c.kind === 'stale' ? 'stale' : 'rejected', c.kind === 'invalid' ? c.reason : null);
    const action = newActionRecord(base, detail({ fields: done, activityId: c.next.id, versionAfter: c.next.version, markedDone: true }), { reason: extra.reason, entityVersions: [{ entity: 'activity', id: c.next.id, before: planned.version, after: c.next.version }] });
    const w = await deps.store.commit(base.ownerId, { kind: 'activity', action, activity: c.next, expectedVersion: c.expectedVersion });
    if (w.status === 'conflict') return refuse('stale', null);
    return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
  }
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
      const reading = readActivityCall(call.args, ctx.benWords, today);
      const reason = call.args.reason;
      if (reading === null) {
        const detail: ActionDetail = { kind: 'log_activity', activityId: null, fields: { kind: call.args.kind, status: call.args.status, date: today, durationS: null, distanceM: null, effort: null }, versionAfter: null };
        return record(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'rejected', failure: 'the date is too far away', reason }));
      }
      const fields = reading.fields;
      if (fields.durationS === null && fields.distanceM === null && fields.effort === null) {
        // Nothing but the kind and day: an effort would be invented (rule 6), so nothing is logged.
        const detail: ActionDetail = { kind: 'log_activity', activityId: null, fields, versionAfter: null };
        return record(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'rejected', failure: 'it needs a time, a distance or how hard it was', reason }));
      }
      // Logged at once only when Ben asked and his words for this one activity back the call (review B1);
      // otherwise (the coach raised it, his words say otherwise, or he named several) an offer he taps (rule 3).
      const asked = ctx.benWords !== null && asksToLogActivity(ctx.benWords) && reading.agrees;
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

