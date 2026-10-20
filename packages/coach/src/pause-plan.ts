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
 * model's `until`; code checks it is after today and within a year.
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
const DAY_MONTH = new RegExp(`\\b${DAY}(?: of)? ${MONTH}\\b(?:,? (\\d{4}))?`);
const MONTH_DAY = new RegExp(`\\b${MONTH} ${DAY}\\b(?:,? (\\d{4}))?`);
const THE_DAY = /\b(?:till|until|til|to|on) the (\d{1,2})(?:st|nd|rd|th)\b/;

const pad = (n: number): string => String(n).padStart(2, '0');

function dateOf(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${String(y)}-${pad(m)}-${pad(d)}`;
  // A day past the month's end (31 Nov) rolls over in `addDays`: not a date.
  return addDays(s, 0) === s ? s : null;
}

/**
 * The date Ben named in his words, as a local `YYYY-MM-DD` after `today`:
 * "3 Nov", "3rd of November", "Nov 3", "November 3rd 2027", "till the
 * 10th". A day and month with no year is the next one after today. Null
 * when he named none (or one that isn't a date).
 */
export function pauseDateFromWords(text: string, today: string): string | null {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const year = Number(today.slice(0, 4));
  const monthIndex = (w: string | undefined): number => MONTHS.findIndex((m) => w !== undefined && w.startsWith(m)) + 1;
  const pick = (m: number, d: number, y: string | undefined): string | null => {
    if (y !== undefined) return dateOf(Number(y), m, d);
    const first = dateOf(year, m, d);
    if (first === null) return dateOf(year + 1, m, d);
    return first > today ? first : dateOf(year + 1, m, d);
  };
  const dm = DAY_MONTH.exec(t);
  if (dm !== null) return pick(monthIndex(dm[2]), Number(dm[1]), dm[3]);
  const md = MONTH_DAY.exec(t);
  if (md !== null) return pick(monthIndex(md[1]), Number(md[2]), md[3]);
  const the = THE_DAY.exec(t);
  if (the !== null) {
    const d = Number(the[1]);
    const m = Number(today.slice(5, 7));
    const here = dateOf(year, m, d);
    if (here !== null && here > today) return here;
    return m === 12 ? dateOf(year + 1, 1, d) : dateOf(year, m + 1, d);
  }
  return null;
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
      // Ben's words win; the model's date only when it is a real date after today.
      const fromWords = ctx.benWords === null ? null : pauseDateFromWords(ctx.benWords, today);
      const until = action === 'resume' ? null : (fromWords ?? call.args.until);
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
