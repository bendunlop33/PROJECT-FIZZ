import { pbPlanChange, pbWeekDaysOf } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionRecord, PlanDraft, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { PlanChangePrepared, PlanChangeRequest } from '@fizz/coach';

import type { PlanBuilderService } from './plan-builder-service';
import type { PlanServices } from './plan-services';

/**
 * (Ben, 2 Nov) The coach's `propose_plan_change`: a lighter week, days a week, plan length, Set/Any days or End for the
 * plan in use. Local only. Nothing here forks the plan builder or the plan model:
 *
 * - `prepare`: the plan in use and its block as stored; the change as new builder answers (`pbPlanChange`), previewed by
 *   the builder's own `Edit plan` session (the engine re-fits the split and keeps exercises where it can). End is the
 *   plan's own End. Nothing is written; the coach saves the proposal (rule 3).
 * - `card`, `apply`, `undo`: Apply is `Apply changes` on the plan as read (its version and block week must not have
 *   moved: `Out of date`, rule 5), with an op ID derived from the proposal so a double tap or a restart writes once; the
 *   block's start, lead-in, week numbers, done weeks and this week's done days stay (30 Oct rule). Undo is that edit's
 *   own Undo (or End's: the plan in use again). Done workouts are their own records and never change (rule 2).
 *   (LW1–LW2) A lighter week and the planned deload it turns into a normal week are one set of answers, so one Apply
 *   writes both and one Undo restores both; a stale proposal applies neither.
 */

export interface PlanChangeServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  planBuilder: Pick<PlanBuilderService, 'open' | 'applyEdit' | 'undoEdit'>;
  plans: Pick<PlanServices, 'end' | 'resume'>;
}

export type PlanChangeDetail = Extract<ActionRecord['detail'], { kind: 'propose_plan_change' }>;
export type PlanChangeCardState = { kind: 'open' | 'applied' | 'undone' } | { kind: 'gone' };

export const PLAN_CHANGE_COPY = {
  apply: 'Apply',
  skip: 'Skip',
  undo: 'Undo',
  applied: 'Applied',
  skipped: 'Skipped',
  undone: 'Undone',
  stale: 'Out of date. Ask again.',
  failed: 'Couldn’t save. Try again.',
  notUndone: 'Not undone.',
} as const;

/** Apply's and Undo's op IDs for a proposal: the same on a double tap or after a restart (rule 5). */
export const planChangeOpId = (actionId: string): string => `plan-change:${actionId}`;
export const planChangeUndoOpId = (actionId: string): string => `plan-change-undo:${actionId}`;

const MAX_NAMES = 7;
const namesLine = (names: readonly string[]): string => names.slice(0, MAX_NAMES).join(', ');

export function createPlanChangeService(deps: PlanChangeServiceDeps) {
  const repo = () => deps.store().repos.planDrafts;

  async function proposal(actionId: string): Promise<{ p: UserProfile; d: PlanChangeDetail } | null> {
    const p = await deps.profile().catch(() => null);
    const record = await deps.store().repos.coach.getAction(actionId).catch(() => null);
    if (p === null || record === null || record.detail.kind !== 'propose_plan_change' || record.status !== 'proposed') return null;
    return { p, d: record.detail };
  }

  async function planOf(p: UserProfile, planId: string): Promise<PlanDraft | null> {
    const plan = await repo().get(planId).catch(() => null);
    return plan === null || plan.ownerId !== p.id ? null : plan;
  }

  return {
    async prepare(req: PlanChangeRequest): Promise<PlanChangePrepared> {
      const p = await deps.profile().catch(() => null);
      if (p === null) return { kind: 'refused', line: 'No plan in use' };
      const plan = await repo().applied(p.id).catch(() => null);
      if (plan === null) return { kind: 'refused', line: 'No plan in use' };
      const name = plan.name.slice(0, 120);
      if (req.kind === 'end') {
        const back = plan.applied?.rotationOff.length ?? 0;
        return { kind: 'ok', detail: { kind: 'propose_plan_change', change: 'end', planId: plan.id, planName: name, planVersion: plan.version, blockWeek: 0, answers: null, lines: [`End ${name}`, ...(back > 0 ? [`${String(back)} of your workouts back`] : [])] } };
      }
      const session = await deps.planBuilder.open({ editPlanId: plan.id }).catch(() => null);
      const run = session?.running ?? null;
      if (session === null || run === null || run.planId !== plan.id) {
        return { kind: 'refused', line: 'This plan has no weeks to change (not made with the plan builder, or its block is done); for days a week use propose_plan' };
      }
      const r = pbPlanChange(session.answers, req, { week: run.week, leadIn: run.leadIn });
      if (r.kind === 'refused') return { kind: 'refused', line: r.line };
      const view = run.preview(r.answers, new Set(), { kind: 'from', week: run.week });
      if (view.tooShort) return { kind: 'refused', line: `Already in week ${String(run.week)}` };
      const lines = [...r.lines];
      if (req.kind === 'days_per_week' || req.kind === 'schedule') {
        // The days as they are this week and as they will be from next week (this week's done days stay).
        const before = pbWeekDaysOf(plan, run.week).map((d) => d.name);
        const after = (view.views[Math.min(run.week, view.views.length - 1)]?.days ?? []).map((d) => d.name);
        if (after.length > 0 && namesLine(before) !== namesLine(after)) lines.push(`${namesLine(before)} → ${namesLine(after)}`);
      }
      return {
        kind: 'ok',
        detail: { kind: 'propose_plan_change', change: req.kind, planId: plan.id, planName: name, planVersion: plan.version, blockWeek: run.week, answers: r.answers, lines: lines.map((l) => l.slice(0, 200)).slice(0, 12) },
      };
    },

    async card(actionId: string): Promise<PlanChangeCardState> {
      const x = await proposal(actionId);
      if (x === null) return { kind: 'gone' };
      const plan = await planOf(x.p, x.d.planId);
      if (plan === null) return { kind: 'gone' };
      if (plan.opIds.includes(planChangeUndoOpId(actionId))) return { kind: 'undone' };
      if (x.d.change === 'end') return { kind: plan.status === 'ended' && plan.ended?.opId === planChangeOpId(actionId) ? 'applied' : 'open' };
      return { kind: plan.opIds.includes(planChangeOpId(actionId)) ? 'applied' : 'open' };
    },

    /** Apply (Ben's tap): the plan's own `Apply changes` (or End) on the plan as read, or `Out of date` (rule 5). */
    async apply(actionId: string): Promise<{ ok: true } | { ok: false; line: string }> {
      const x = await proposal(actionId);
      if (x === null) return { ok: false, line: PLAN_CHANGE_COPY.stale };
      const op = planChangeOpId(actionId);
      const plan = await planOf(x.p, x.d.planId);
      if (plan === null) return { ok: false, line: PLAN_CHANGE_COPY.stale };
      if (plan.opIds.includes(op)) return { ok: true };
      if (plan.version !== x.d.planVersion || plan.status !== 'applied') return { ok: false, line: PLAN_CHANGE_COPY.stale };
      if (x.d.change === 'end') {
        const r = await deps.plans.end({ planId: plan.id, expectedVersion: x.d.planVersion, opId: op }).catch(() => null);
        return r?.ok === true ? { ok: true } : { ok: false, line: r === null || r.reason === 'failed' ? PLAN_CHANGE_COPY.failed : PLAN_CHANGE_COPY.stale };
      }
      if (x.d.answers === null) return { ok: false, line: PLAN_CHANGE_COPY.stale };
      const session = await deps.planBuilder.open({ editPlanId: plan.id }).catch(() => null);
      const run = session?.running ?? null;
      if (session === null || run === null || run.planVersion !== x.d.planVersion || run.week !== x.d.blockWeek) return { ok: false, line: PLAN_CHANGE_COPY.stale };
      const r = await deps.planBuilder.applyEdit(session, x.d.answers, new Set(), { kind: 'from', week: run.week }, op).catch(() => null);
      if (r === null) return { ok: false, line: PLAN_CHANGE_COPY.failed };
      return r.ok ? { ok: true } : { ok: false, line: r.reason === 'failed' ? PLAN_CHANGE_COPY.failed : PLAN_CHANGE_COPY.stale };
    },

    /** Undo of that Apply: the plan exactly as before it, only while nothing changed since (rule 5). */
    async undo(actionId: string): Promise<boolean> {
      const x = await proposal(actionId);
      if (x === null) return false;
      const plan = await planOf(x.p, x.d.planId);
      const op = planChangeOpId(actionId);
      if (plan === null || !plan.opIds.includes(op)) return false;
      if (x.d.change === 'end') {
        if (plan.status !== 'ended' || plan.ended?.opId !== op) return false;
        const r = await deps.plans.resume({ planId: plan.id, expectedVersion: plan.version, opId: planChangeUndoOpId(actionId) }).catch(() => null);
        return r?.ok === true;
      }
      if (plan.lastEdit?.opId !== op) return false;
      const r = await deps.planBuilder.undoEdit({ planId: plan.id, expectedVersion: plan.version, opId: planChangeUndoOpId(actionId) }).catch(() => null);
      return r?.ok === true;
    },
  };
}

export type PlanChangeService = ReturnType<typeof createPlanChangeService>;
