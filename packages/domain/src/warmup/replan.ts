import type { CommandOf, Load, SessionAggregate, TrainingChange, WarmupPrefs, WorkoutSet, ZonedTimestamp } from '@fizz/schemas';
import { stableStringify } from '../stable';
import type { ResolvedWarmupPrefs } from '../training-profile';
import { replanPendingWarmups, type WarmupLookup } from './session';

/**
 * (Ben, 1 Nov) A change to his warm-up preferences, applied to the open workout: its not-yet-done planner warm-ups
 * planned again (`replanPendingWarmups`) as one `adjust_pending_targets` under `actionId`, so one Undo
 * (`revert_target_adjustment` on that ID) puts back exactly the sets still pending. Logged sets never change (rule 2).
 * Pure. Used by Profile › Training's switch and the coach's `update_warmup_prefs`.
 */

/** The rule words on each re-planned warm-up's `Why?` (Ben's setting, not a coach or progression change). */
export const WARMUP_PREFS_RULE = {
  name: 'Warm-up settings',
  decision: 'hold',
  summary: 'Warm-ups planned again for your warm-up settings',
  facts: [] as string[],
} as const;

export interface WarmupPrefsCommandInput {
  aggregate: SessionAggregate;
  /** What the first working set shows (its target, else what it would prefill); the planner's W. */
  workingLoad: (set: WorkoutSet) => Load | null;
  /** The lookup with the new preferences in `prefs`. */
  lookup: WarmupLookup & { prefs: ResolvedWarmupPrefs };
  opId: string;
  actionId: string;
  at: ZonedTimestamp;
}

/** The command, or null when no pending warm-up changes (nothing open, or nothing different). */
export function warmupPrefsCommand(input: WarmupPrefsCommandInput): CommandOf<'adjust_pending_targets'> | null {
  if (input.aggregate.session.status !== 'active') return null;
  const r = replanPendingWarmups(input.aggregate, input.workingLoad, input.lookup);
  if (r.changes.length === 0 && r.removeSetIds.length === 0) return null;
  return {
    type: 'adjust_pending_targets',
    at: input.at,
    opId: input.opId,
    expectedVersion: input.aggregate.session.version,
    actionId: input.actionId,
    reason: null,
    rule: { name: WARMUP_PREFS_RULE.name, decision: WARMUP_PREFS_RULE.decision, summary: WARMUP_PREFS_RULE.summary, facts: [] },
    changes: r.changes.slice(0, 40).map((c) => ({ setId: c.setId, target: { load: c.load, reps: { min: c.reps, max: c.reps } } })),
    removeSetIds: r.removeSetIds.slice(0, 12),
    addSets: [],
  };
}

/** The stored `warmups` field after a change (null: the defaults). */
export function warmupPrefsAfter(before: WarmupPrefs | null | undefined, change: Extract<TrainingChange, { kind: 'warmup_prefs' }>): WarmupPrefs | null {
  const simpleLoads = change.simpleLoads ?? before?.simpleLoads ?? true;
  const per: Record<string, 'off' | 'normal'> = { ...(before?.perExercise ?? {}) };
  for (const [id, v] of Object.entries(change.perExercise ?? {})) {
    if (v === null) delete per[id];
    else per[id] = v;
  }
  const out: WarmupPrefs = { ...(simpleLoads ? {} : { simpleLoads: false }), ...(Object.keys(per).length === 0 ? {} : { perExercise: per }) };
  return Object.keys(out).length === 0 ? null : out;
}

/** The change that puts `before` back over `after` (Undo). */
export function warmupPrefsRevert(before: WarmupPrefs | null, after: WarmupPrefs | null): Extract<TrainingChange, { kind: 'warmup_prefs' }> {
  const ids = new Set([...Object.keys(before?.perExercise ?? {}), ...Object.keys(after?.perExercise ?? {})]);
  const perExercise: Record<string, 'off' | 'normal' | null> = {};
  for (const id of ids) perExercise[id] = before?.perExercise?.[id] ?? null;
  return { kind: 'warmup_prefs', simpleLoads: before?.simpleLoads ?? true, ...(ids.size === 0 ? {} : { perExercise }) };
}

export const sameWarmupPrefs = (a: WarmupPrefs | null | undefined, b: WarmupPrefs | null | undefined): boolean => stableStringify(a ?? null) === stableStringify(b ?? null);
