import type { PlannedSet, SessionAggregate, SetType } from '@fizz/schemas';
import { formatNumber, NBSP } from '../display';
import { builtInTargetRpe, ruleCategory, type RuleExerciseInfo } from '../default-rule';
import { equipmentOfRow } from '../session/equipment-snapshot';

/**
 * Target RPE for every working set (CHANGELOG 2026-10-11 "Offers follow the
 * target RPE", Ben). Pure. In order:
 * 1. `ben`: Ben's own override (`planned.rpeOverride`, `set_target_rpe`);
 * 2. `coach`: the coach's recommendation (`planned.rpe` on a coach target);
 * 3. `plan`: the routine's `rpe` (or `rir`, read as 10 − RIR);
 * 4. `rule`: the built-in rule's rep-range profile value for the exercise's
 *    category (`builtInTargetRpe`).
 *
 * Warm-up and drop sets carry no target: they aren't working sets and never
 * trigger an offer (CA5).
 */

export type TargetRpeSource = 'ben' | 'coach' | 'plan' | 'rule';

export interface TargetRpe {
  rpe: number;
  source: TargetRpeSource;
}

const NO_TARGET: ReadonlySet<SetType> = new Set<SetType>(['warmup', 'drop']);

/** `ruleRpe`: the built-in value for the set's exercise (`ruleTargetRpes`), or null when unknown. */
export function targetRpeOf(set: { setType: SetType; planned: Pick<PlannedSet, 'rpe' | 'rir' | 'rpeOverride' | 'source'> }, ruleRpe: number | null): TargetRpe | null {
  if (NO_TARGET.has(set.setType)) return null;
  const p = set.planned;
  if (p.rpeOverride !== undefined) return { rpe: p.rpeOverride, source: 'ben' };
  if (p.rpe !== null) return { rpe: p.rpe, source: p.source === 'coach' ? 'coach' : 'plan' };
  if (p.rir !== null) return { rpe: Math.max(1, 10 - p.rir), source: p.source === 'coach' ? 'coach' : 'plan' };
  return ruleRpe === null ? null : { rpe: ruleRpe, source: 'rule' };
}

/**
 * The built-in target RPE of each exercise row in a workout, keyed by
 * session exercise ID. `info` looks up the catalogue entry: null when the
 * exercise has none (the accessory profile, as the default rule does),
 * undefined when it hasn't been read (the row is left out rather than guessed).
 */
export function ruleTargetRpes(aggregate: Pick<SessionAggregate, 'exercises' | 'session'>, info: (exerciseId: string) => RuleExerciseInfo | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ex of aggregate.exercises) {
    const known = info(ex.exerciseId);
    if (known === undefined) continue;
    const eq = equipmentOfRow(aggregate.session.equipmentSnapshot, ex);
    out[ex.id] = builtInTargetRpe(ruleCategory(known, eq?.kind ?? null, ex.loadConvention));
  }
  return out;
}

/** `@ RPE 8`, `@ RPE 8.5` (the target line; minimal copy). */
export function targetRpeText(rpe: number): string {
  return `@${NBSP}RPE${NBSP}${formatNumber(rpe)}`;
}

/** The values Ben can pick as a target (RPE half steps 6–10). */
export const TARGET_RPE_CHOICES: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
