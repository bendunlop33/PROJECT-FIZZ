import { pbWeekdayOf, type PbPlanChangeRequest } from '@fizz/domain';
import type { ActionDetail, PlanChangeArg } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';

/**
 * (Ben, 2 Nov) `propose_plan_change`: plan-level changes to the plan in use from any chat (ADR 0039's one registry):
 * a lighter week (this or next), days a week ("go to 4 days a week"), the plan's length ("make the plan 8 weeks"), Set
 * days or Any days and which weekdays, and End ("end this plan"). Always a proposal with before/after, Apply and Undo
 * (rule 3: a broader future change). The app's port checks it against the plan and its block as stored and rebuilds
 * through the plan builder (never a fork of it); Apply is the plan's own `Apply changes` (or End) on the version read
 * (rule 5: a stale proposal is refused), with an op ID from the record so a double tap or a restart writes once.
 *
 * Offered only while a plan is in use and Ben's words ask for one of these (`asksPlanSettingChange`), so other turns
 * don't carry it (coachtime's trimmed context, 1 Nov).
 */

export type PlanChangeRequest = PbPlanChangeRequest | { kind: 'end' };

export type PlanChangePrepared = { kind: 'ok'; detail: Extract<ActionDetail, { kind: 'propose_plan_change' }> } | { kind: 'refused'; line: string };

export interface PlanChangeDeps {
  store: CoachWriteStore;
  /** Reads the plan in use and its block, checks the change and previews it; nothing is written here. */
  prepare(req: PlanChangeRequest): Promise<PlanChangePrepared>;
}

const NO_PLAN = '00000000-0000-4000-8000-000000000000';

/** The model's change as the domain's request (weekdays `mon` … `sun` as Monday = 0 …). */
export function planChangeRequestOf(c: PlanChangeArg): PlanChangeRequest {
  switch (c.kind) {
    case 'lighter_week':
      return { kind: 'lighter_week', week: c.week };
    case 'days_per_week':
      return { kind: 'days_per_week', days: c.days, weekdays: c.weekdays === null ? null : c.weekdays.map(pbWeekdayOf) };
    case 'length':
      return { kind: 'length', weeks: c.weeks };
    case 'schedule':
      return { kind: 'schedule', schedule: c.schedule, weekdays: c.weekdays === null ? null : c.weekdays.map(pbWeekdayOf) };
    case 'end':
      return { kind: 'end' };
  }
}

export function createPlanChangeExecutor(deps: PlanChangeDeps): CoachExecutors {
  const propose: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'propose_plan_change') throw new TypeError(call.tool);
    const req = planChangeRequestOf(call.args.change);
    const r = await deps.prepare(req).catch((): PlanChangePrepared => ({ kind: 'refused', line: 'Not proposed: the plan couldn’t be read just now.' }));
    if (r.kind === 'refused') {
      // One honest line on a card (`Plan not changed: …`), kept in the thread; the coach is told the same.
      const detail: ActionDetail = { kind: 'propose_plan_change', change: call.args.change.kind, planId: NO_PLAN, planName: '', planVersion: 1, blockWeek: 0, answers: null, lines: [] };
      const refused = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'rejected', failure: r.line.slice(0, 200), reason: call.args.reason.slice(0, 240) }) });
      if (refused.status === 'conflict') throw new Error('Could not record the refused plan change');
      return { kind: 'action', record: refused.action, replayed: refused.status === 'replayed' };
    }
    const saved = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, r.detail, { status: 'proposed', reason: call.args.reason.slice(0, 240) }) });
    if (saved.status === 'conflict') throw new Error('Could not record the plan change');
    return { kind: 'action', record: saved.action, replayed: saved.status === 'replayed' };
  };
  return { propose_plan_change: propose };
}

/** Sent while the tool is offered. */
export const PLAN_CHANGE_LINE =
  'The plan in use can be changed as a whole with propose_plan_change: a lighter (deload) week this or next week; days a week (the app rebuilds the split and keeps exercises where it can, never rewrite the days yourself); the plan’s length (4, 6, 8 or 12 weeks); Set days on named weekdays or Any days; or End the plan (his own workouts come back). It is a proposal he applies with Undo; the block’s start and done weeks never change. Never say you can’t change these.';

const LIGHTER = /\b(?:lighter|easier|easy|deload|recovery|back[- ]?off|rest) week\b|\bdeload\b|\b(?:week|it) (?:lighter|easier)\b|\blighter (?:this|next) week\b|\b(?:take|make|have) (?:this|next) week (?:light|lighter|easy|easier)\b/;
const DAYS = /\b(?:\d|one|two|three|four|five|six|seven)[- ]?(?:days?|sessions?)(?: a| per| each)? ?(?:week|wk)\b|\b(?:\d|two|three|four|five|six|seven) days\b|\b(?:fewer|more|less) (?:days|sessions)\b|\bdays? (?:a|per) week\b/;
const LENGTH = /\b(?:\d+|four|six|eight|twelve)[- ]?weeks?\b|\b(?:longer|shorter|extend|shorten|lengthen)\b[^.?!]{0,30}\b(?:plan|block|programme|program)\b|\b(?:plan|block)\b[^.?!]{0,30}\b(?:longer|shorter|extend(?:ed)?|shorten(?:ed)?)\b/;
const END = /\b(?:end|stop|finish|cancel|drop|quit|ditch|scrap)(?:ping)? (?:this|my|the|our) (?:training |workout |gym )?(?:plan|programme|program|block)\b/;
const SCHEDULE = /\b(?:set|fixed|any) days\b|\b(?:on|train(?:ing)?|lift(?:ing)?|gym) (?:on )?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:days?)?\b|\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b[^.?!]{0,40}\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b|\bwhich days\b|\bany day\b/;

/**
 * Ben's own words ask for a plan-level change this tool makes: a lighter week, days a week, plan length, End, Set or
 * Any days. Code's reading (rule 3: the tool is offered on these words; Apply is still his tap).
 */
export function asksPlanSettingChange(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  return LIGHTER.test(t) || DAYS.test(t) || LENGTH.test(t) || END.test(t) || SCHEDULE.test(t);
}
