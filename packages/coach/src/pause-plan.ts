import { addDays, localDateOf, pausePlan, resumePlan, toMs, validPauseUntil, type PlanControlChange } from '@fizz/domain';
import type { ActionDetail, ActionRecord, PlanDraft } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `pause_plan` (Ben, 20 Oct: "should also be able to pause eg if go on
 * hols"). Offered only when Ben's own words ask to pause or resume his plan
 * (`plan_pause`), so it applies at once, with Undo (rule 3). The domain's
 * `pausePlan` / `resumePlan` decide against the stored plan (rule 5: the
 * version read, idempotent on the op ID), written with its record in one
 * transaction. A date Ben said outright ("till 3 Nov") wins over the
 * model's `until` (of several he said, the model's if it is one of them);
 * code checks it is after today and within a year.
 */

export interface PausePlanDeps {
  store: CoachWriteStore;
  /** The plan in use (applied), read fresh for each call; null: none. */
  loadPlan(): Promise<PlanDraft | null>;
  /** Ben's time zone (the `until` date is local). */
  tz: string;
}

const NO_ID = '00000000-0000-4000-8000-000000000000';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const DAY_MONTH = new RegExp(`\\b${DAY}(?: of)? ${MONTH}\\b(?:,? (\\d{4}))?`, 'g');
const MONTH_DAY = new RegExp(`\\b${MONTH} ${DAY}\\b(?:,? (\\d{4}))?`, 'g');
const THE_DAY = /\b(?:till|until|til|to|on) the (\d{1,2})(?:st|nd|rd|th)\b/g;
/** Words that name the date the pause ends at: "till 3 Nov", "to the 10th", "back on 3 Nov". */
const UNTIL_BEFORE = /\b(?:till|until|til|to|thru|through|back|back on|returning|return on)(?: the)?\s*$/;

const pad = (n: number): string => String(n).padStart(2, '0');

function dateOf(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${String(y)}-${pad(m)}-${pad(d)}`;
  // A day past the month's end (31 Nov) rolls over in `addDays`: not a date.
  return addDays(s, 0) === s ? s : null;
}

export interface PauseWordsDates {
  /** The date the pause ends at, as Ben said it: one after `till` / `until` / `to` / `back`, else the last he named. */
  date: string | null;
  /** Every date he named, in order. */
  all: string[];
}

/**
 * The dates Ben named in his words, as local `YYYY-MM-DD`: "3 Nov", "3rd of
 * November", "Nov 3", "November 3rd 2027", "till the 10th". A day and month
 * with no year is the next one on or after `today` (today itself stays
 * today, so "until 20 Oct" said on 20 Oct is refused, never a year away:
 * review plan-adapt S4). Of several ("from 25 Oct to 3 Nov") the one after
 * `till` / `until` / `to` wins, else the last.
 */
export function pauseDatesFromWords(text: string, today: string): PauseWordsDates {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const year = Number(today.slice(0, 4));
  const monthIndex = (w: string | undefined): number => MONTHS.findIndex((m) => w !== undefined && w.startsWith(m)) + 1;
  const pick = (m: number, d: number, y: string | undefined): string | null => {
    if (y !== undefined) return dateOf(Number(y), m, d);
    const first = dateOf(year, m, d);
    if (first === null) return dateOf(year + 1, m, d);
    return first >= today ? first : dateOf(year + 1, m, d);
  };
  const found: { at: number; date: string | null }[] = [];
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && x < b);
  for (const m of t.matchAll(DAY_MONTH)) {
    found.push({ at: m.index, date: pick(monthIndex(m[2]), Number(m[1]), m[3]) });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of t.matchAll(MONTH_DAY)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    found.push({ at: m.index, date: pick(monthIndex(m[1]), Number(m[2]), m[3]) });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of t.matchAll(THE_DAY)) {
    // "until the 25th of December" is the day and month above.
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const d = Number(m[1]);
    const mo = Number(today.slice(5, 7));
    const here = dateOf(year, mo, d);
    const date = here !== null && here > today ? here : mo === 12 ? dateOf(year + 1, 1, d) : dateOf(year, mo + 1, d);
    // "till the 10th": the words before the day are the `till`.
    found.push({ at: m.index + m[0].indexOf('the') + 4, date });
  }
  found.sort((a, b) => a.at - b.at);
  const all = found.map((f) => f.date).filter((d): d is string => d !== null);
  if (found.length === 0) return { date: null, all };
  const marked = found.find((f) => UNTIL_BEFORE.test(t.slice(0, f.at)));
  return { date: (marked ?? found[found.length - 1])?.date ?? null, all };
}

/** The date the pause ends at, as Ben said it (`pauseDatesFromWords`); null when he named none (or one that isn't a date). */
export function pauseDateFromWords(text: string, today: string): string | null {
  return pauseDatesFromWords(text, today).date;
}

const REFUSAL: Record<Extract<PlanControlChange, { kind: 'invalid' }>['reason'], string> = {
  not_a_day: 'that isn’t a day of your plan',
  bad_date: 'the date must be after today',
  not_paused: 'your plan isn’t paused',
  already_paused: 'your plan is already paused',
};

export function createPausePlanExecutor(deps: PausePlanDeps): CoachExecutors {
  return {
    pause_plan: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'pause_plan') throw new TypeError(call.tool);
      const plan = await deps.loadPlan();
      const today = localDateOf(toMs(ctx.now.utc), deps.tz);
      const action = call.args.action;
      // Ben's words win. When he named more than one date, the model's reading stands if it is one of them
      // (review plan-adapt S4); code still checks it is after today.
      const words = ctx.benWords === null ? { date: null, all: [] } : pauseDatesFromWords(ctx.benWords, today);
      const modelPicked = call.args.until !== null && words.all.length > 1 && words.all.includes(call.args.until);
      const until = action === 'resume' ? null : modelPicked ? call.args.until : (words.date ?? call.args.until);
      const detail: ActionDetail = { kind: 'pause_plan', planId: plan?.id ?? NO_ID, planName: plan?.name.slice(0, 120) ?? 'Plan', action, untilDate: until, versionAfter: null };
      const record = async (status: 'stale' | 'rejected', failure: string | null, opId = ctx.opId): Promise<ToolResult> => {
        const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord({ ...ctx, opId }, detail, { status, failure }) });
        if (r.status === 'conflict') throw new Error('Could not record the refused pause');
        return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
      };
      if (plan === null || plan.status !== 'applied') return record('rejected', 'no plan is in use');
      if (action === 'pause' && !validPauseUntil(until, toMs(ctx.now.utc), deps.tz)) return record('rejected', REFUSAL.bad_date);
      const change = action === 'pause' ? pausePlan(plan, { expectedVersion: plan.version, opId: ctx.opId, at: ctx.now, untilDate: until, tz: deps.tz }) : resumePlan(plan, { expectedVersion: plan.version, opId: ctx.opId, at: ctx.now, tz: deps.tz });
      if (change.kind === 'invalid') return record('rejected', REFUSAL[change.reason]);
      if (change.kind === 'stale') return record('stale', null);
      if (change.kind === 'duplicate') {
        // The same op already wrote (a replayed call): its record is returned by the store on the same op ID.
        const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail) });
        if (r.status === 'conflict') throw new Error('Could not read the earlier pause');
        return { kind: 'action', record: r.action, replayed: true };
      }
      const action_: ActionRecord = newActionRecord(ctx, { ...detail, versionAfter: change.next.version }, { entityVersions: [{ entity: 'plan', id: plan.id, before: plan.version, after: change.next.version }] });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'plan_control', action: action_, plan: change.next, expectedVersion: change.expectedVersion });
      if (w.status === 'conflict') return record('stale', null, `${ctx.opId}:refused`);
      return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
    },
  };
}
