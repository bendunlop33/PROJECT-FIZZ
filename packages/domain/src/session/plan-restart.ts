import type { PlanApplyMode, PlanDraft, Routine, ZonedTimestamp } from '@fizz/schemas';

import { dayMonthText } from '../display';
import { deriveId } from '../stable';
import { toMs } from '../time';
import { applyPlan, currentPlanVersion, planExpiry, type PlanApplyChange } from './coach-plan';

/**
 * Library › Plan › Previous (Ben, 22–23 Oct, D7: no saved plans; prototype
 * `renderLibrary`). Pure.
 *
 * - `previousPlans`: the plans Ben used before (ended by him, or by a newer
 *   plan's Apply), newest first, each once.
 * - `restartPlan`: `Start again` on one. The plan builder (plan-builder.md
 *   §3) will open with that plan's answers; until it ships, the plan comes
 *   back as a fresh copy of its last version, applied through the same
 *   `applyPlan` as a coach card's Apply (rule 3: Ben's tap; rule 5: the
 *   source as read, idempotent on the op ID). Its Undo is the copy's
 *   `undoPlanApply`, which also puts back the plan in use before.
 */

/** A plan stops being in use by Ben's `End plan` or a newer plan's Apply. */
const USED_STATUSES: ReadonlySet<PlanDraft['status']> = new Set(['applied', 'ended', 'superseded']);

/** When a previous plan stopped being in use; null while it is in use (or never was). */
export function planEndedAtUtc(p: Pick<PlanDraft, 'status' | 'ended' | 'supersededBy'>): string | null {
  if (p.status === 'ended') return p.ended?.atUtc ?? null;
  if (p.status === 'superseded') return p.supersededBy?.atUtc ?? null;
  return null;
}

export interface PreviousPlan {
  planId: string;
  /** The stored version `Start again` must find (rule 5). */
  planVersion: number;
  name: string;
  /** Day names in plan order: `Push / Pull / Legs`. */
  days: string[];
  endedAtUtc: string;
}

/** The longest Previous list (newest first). */
export const PREVIOUS_PLANS_MAX = 12;

/**
 * Ben's earlier plans, newest end first. A plan that was started again
 * (a copy that was applied, and maybe ended since) shows once: as its
 * newest copy. A copy whose Apply was undone doesn't count, so the plan
 * it came from is listed again.
 */
export function previousPlans(plans: readonly PlanDraft[], ownerId: string): PreviousPlan[] {
  const mine = plans.filter((p) => p.ownerId === ownerId);
  const restarted = new Set(mine.filter((p) => USED_STATUSES.has(p.status) && p.restartedFrom != null).map((p) => p.restartedFrom?.planId ?? ''));
  const out: PreviousPlan[] = [];
  for (const p of mine) {
    const at = planEndedAtUtc(p);
    if (at === null || p.applied === null || restarted.has(p.id)) continue;
    out.push({ planId: p.id, planVersion: p.version, name: p.name, days: currentPlanVersion(p).days.map((d) => d.name), endedAtUtc: at });
  }
  return out.sort((a, b) => toMs(b.endedAtUtc) - toMs(a.endedAtUtc) || (a.planId < b.planId ? -1 : 1)).slice(0, PREVIOUS_PLANS_MAX);
}

/** `Push / Pull / Legs · ended 20 Sep` (prototype row). */
export function previousPlanLine(p: Pick<PreviousPlan, 'days' | 'endedAtUtc'>, tz: string): string {
  const days = p.days.join(' / ');
  return `${days === '' ? '' : `${days} · `}ended ${dayMonthText(p.endedAtUtc, tz)}`;
}

/** The copy's ID: from the op, so a retried `Start again` finds the same plan. */
export const restartedPlanIdFor = (opId: string): string => deriveId(`plan-restart:${opId}`);

export type PlanRestartChange =
  /** `copy`: the new plan as made (version 1, open); `apply`: its Apply, as `applyPlan` decided it. */
  | { kind: 'write'; copy: PlanDraft; apply: Extract<PlanApplyChange, { kind: 'write' }> }
  /** The source isn't as the screen read it (another version, or in use again): nothing changes (rule 5). */
  | { kind: 'stale'; current: PlanDraft };

/**
 * `Start again` on a previous plan: a new plan with the source's current
 * version (its days, slots and checked loads; a day's first workout
 * re-checks them against newer history, pain and the gym, `planFirstLoads`),
 * applied at once in `mode`. Any plan in use is superseded by the Apply
 * and comes back with its Undo. The source is never changed.
 */
export function restartPlan(
  source: PlanDraft,
  input: { expectedVersion: number; mode: PlanApplyMode; opId: string; at: ZonedTimestamp; live: readonly Routine[]; applied: readonly PlanDraft[] },
): PlanRestartChange {
  if (source.version !== input.expectedVersion || planEndedAtUtc(source) === null || source.applied === null) return { kind: 'stale', current: source };
  const v = currentPlanVersion(source);
  const copy: PlanDraft = {
    id: restartedPlanIdFor(input.opId),
    ownerId: source.ownerId,
    status: 'open',
    name: source.name,
    currentVersion: 1,
    versions: [{ ...v, n: 1, parentN: null, status: 'current' }],
    applied: null,
    undoneAtUtc: null,
    restartedFrom: { planId: source.id, opId: input.opId, atUtc: input.at.utc },
    opIds: [`${input.opId}:copy`],
    createdAt: input.at,
    tz: input.at.tz,
    expiresAtUtc: planExpiry(input.at.utc),
    version: 1,
    updatedAtUtc: input.at.utc,
  };
  const apply = applyPlan(copy, { expectedVersion: 1, versionN: 1, mode: input.mode, opId: input.opId, at: input.at, live: input.live, applied: input.applied });
  // A fresh open copy at version 1 always applies; anything else is a bug, kept as no change.
  if (apply.kind !== 'write') return { kind: 'stale', current: source };
  return { kind: 'write', copy, apply };
}
