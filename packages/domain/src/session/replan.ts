import type { CommandOf, PlannedSet, SessionAggregate, SessionCommand, SessionExercise, SetType, WorkoutSet, ZonedTimestamp } from '@fizz/schemas';
import { stableStringify } from '../stable';
import { earlierWorkOf, type WorkContext } from '../in-session-fatigue';
import { equipmentOfRow } from './equipment-snapshot';

/**
 * SF6 (Ben, 8 Nov): when Ben reorders, skips, swaps, adds or removes an exercise today, the built-in targets of the
 * exercises not started yet are worked out again for the new order (SF1–SF3), the way warm-ups follow "already warm".
 * Pure: which rows qualify and which sets change; the caller works out each row's targets with `nextTargetsFor`.
 * Ben's typed values (an edited set has no `source`), coach targets (`source: 'coach'`), drafts and any row with a
 * set done or skipped are never touched. Undo of the reorder puts the order back; working the targets out again from
 * it gives the old ones back (they are a function of the order and history).
 */

/** Commands after which today's built-in targets are worked out again (SF6). */
export const REPLAN_AFTER: ReadonlySet<SessionCommand['type']> = new Set(['move_exercise', 'skip_exercise', 'swap_exercise', 'remove_exercise', 'add_exercise', 'undo_op', 'link_superset', 'split_superset']);

export interface ReplanCandidate {
  row: SessionExercise;
  /** Its pending sets, in order. */
  sets: WorkoutSet[];
  /** Its context in today's order (SF1: done so far plus what's still planned before it). */
  today: WorkContext | null;
  /** Pending working sets: the count the new targets are worked out for. */
  workingSets: number;
}

/** Rows whose targets are all still the built-in rule's and that haven't started: the ones SF6 may work out again. */
export function replanCandidates(state: SessionAggregate): ReplanCandidate[] {
  if (state.session.status !== 'active') return [];
  const out: ReplanCandidate[] = [];
  for (const row of state.exercises) {
    if (row.removed !== undefined || row.measurement !== 'reps' || row.continuesFromId !== undefined) continue;
    const live = state.sets.filter((s) => s.sessionExerciseId === row.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
    if (live.length === 0 || live.some((s) => s.status !== 'pending')) continue;
    const counted = live.filter((s) => s.setType !== 'warmup');
    if (counted.length === 0 || counted.some((s) => s.planned.source !== 'built_in_rule' || s.draft !== null)) continue;
    out.push({ row, sets: live, today: earlierWorkOf(state, row.exerciseId, { planned: true }), workingSets: counted.filter((s) => s.setType === 'working').length });
  }
  return out;
}

const valuesOf = (p: PlannedSet) => stableStringify({ load: p.load, reps: p.reps });

/**
 * The sets that change: the candidate's non-warm-up sets paired in order with the new plan's (same count and set
 * types, else nothing: a different shape is never forced onto today's sets), where the load or reps differ.
 */
export function replanEntries(c: ReplanCandidate, plan: readonly { setType: SetType; planned: PlannedSet }[] | null): CommandOf<'replan_built_in_targets'>['sets'] {
  if (plan === null) return [];
  const mine = c.sets.filter((s) => s.setType !== 'warmup');
  const next = plan.filter((p) => p.setType !== 'warmup');
  if (mine.length !== next.length || mine.some((s, i) => s.setType !== next[i]?.setType)) return [];
  const out: CommandOf<'replan_built_in_targets'>['sets'] = [];
  mine.forEach((s, i) => {
    const p = next[i]?.planned;
    if (p === undefined || p.source !== 'built_in_rule' || valuesOf(p) === valuesOf(s.planned)) return;
    out.push({ setId: s.id, expectedSetVersion: s.version, planned: p });
  });
  return out;
}

/** The command for the changed sets, or null when nothing changes. */
export function replanCommand(state: SessionAggregate, sets: CommandOf<'replan_built_in_targets'>['sets'], op: { opId: string; at: ZonedTimestamp }): CommandOf<'replan_built_in_targets'> | null {
  if (sets.length === 0) return null;
  return { type: 'replan_built_in_targets', at: op.at, opId: op.opId, expectedVersion: state.session.version, sets: [...sets].slice(0, 120) };
}

/** The row's equipment in the workout's snapshot (what its targets are fitted to). */
export function replanEquipmentOf(state: SessionAggregate, row: SessionExercise) {
  return equipmentOfRow(state.session.equipmentSnapshot, row);
}
