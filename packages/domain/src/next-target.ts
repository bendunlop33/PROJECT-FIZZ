import type { CheckIn, EquipmentInstance, LoadConvention, Measurement, PainFlag, PlannedSet, ProgressionRule, SetType, WeightUnit } from '@fizz/schemas';
import { painMentionedNotFlagged, painStatusFor } from './checkin';
import { builtInDefaultRule, ruleCategory, type RuleExerciseInfo } from './default-rule';
import { calculateNextTargets, type HistorySession, type NextTargets, type PainStatus } from './progression';
import { ruleTargetProvenance, type RuleProvenanceInput } from './target-provenance';

/**
 * One place that decides an exercise's next targets with the built-in rule,
 * used both by the Summary's `Next time` and when that exercise is next added
 * to a workout (review workout-loop S3, PM decision: prefill, labelled
 * `built-in rule`). Computed from the same inputs each time rather than
 * stored, so a later correction (brief scenario 5) changes the next targets
 * too, and nothing can go stale.
 */

/** PM decision (review SP3): `Pain` with no movement chosen holds every exercise of that workout. */
export function unspecifiedPain(checkIn: Pick<CheckIn, 'reasons' | 'painFlagIds' | 'recordedAt' | 'deletedAtUtc'> | null): PainStatus {
  if (checkIn === null || checkIn.deletedAtUtc !== undefined || !painMentionedNotFlagged(checkIn)) return { active: false, reportedAtUtc: null };
  return { active: true, reportedAtUtc: checkIn.recordedAt.utc };
}

export interface NextTargetRequest {
  ownerId: string;
  exerciseId: string;
  exerciseName: string;
  measurement: Measurement;
  unit: WeightUnit;
  convention: LoadConvention;
  equipment: EquipmentInstance | null;
  /** Catalogue info for the default rule's category; null = unknown (accessory range). */
  exercise: RuleExerciseInfo | null;
  /** The exercise's own rule (routine), else the built-in default applies. */
  rule: ProgressionRule | null;
  /** Working sets to aim for (this workout's, or the last comparable workout's). */
  workingSets: number;
  history: readonly HistorySession[];
  painFlags: readonly PainFlag[];
  /** Pain mentioned without a movement in the workout the targets come from. */
  sessionPain: PainStatus;
  /** See `NextTargetsInput.fitLater` (Start next session from a FitNotes workout). */
  fitLater?: boolean;
}

export function nextTargetsFor(req: NextTargetRequest): { result: NextTargets; rule: ProgressionRule } {
  const category = ruleCategory(req.exercise, req.equipment?.kind ?? null, req.convention);
  const rule = req.rule ?? builtInDefaultRule(req.ownerId, req.unit, req.workingSets, category);
  const flagged = painStatusFor(req.painFlags, req.exerciseId);
  const pain = flagged.active ? flagged : req.sessionPain;
  const result = calculateNextTargets({
    exerciseName: req.exerciseName,
    measurement: req.measurement,
    history: req.history,
    rule,
    equipment: req.equipment,
    unit: req.unit,
    convention: req.convention,
    pain,
    ...(req.fitLater === true ? { fitLater: true } : {}),
  });
  return { result, rule };
}

const PLANNABLE = new Set<NextTargets['decision']>(['increase_load', 'increase_reps', 'hold', 'hold_after_miss', 'reduce_load', 'ceiling_reached', 'halted_pain']);

/**
 * Planned sets for an exercise being added, from its next targets. Null when
 * the rule has nothing to say (no history, unsupported, no feasible load):
 * the exercise then starts with one empty set, as before.
 *
 * With `why` (the history and equipment the targets were worked out from),
 * each set also records its provenance for `Why?` (active-workout §2.12):
 * the basis workout, the rule's own words and the equipment step, stored
 * now so the card never re-runs the rule to explain it.
 */
export function plannedSetsFromTargets(t: NextTargets, why?: Omit<RuleProvenanceInput, 'result'>): { setType: SetType; planned: PlannedSet }[] | null {
  if (!PLANNABLE.has(t.decision) || t.sets.length === 0 || t.loadFeasibility === 'infeasible') return null;
  return t.sets.map((s) => ({
    setType: s.setType,
    planned: {
      load: s.load,
      reps: s.reps,
      durationS: null,
      rpe: null,
      rir: null,
      source: 'built_in_rule' as const,
      ...(why ? { provenance: ruleTargetProvenance({ ...why, result: t }, s) } : {}),
    },
  }));
}
