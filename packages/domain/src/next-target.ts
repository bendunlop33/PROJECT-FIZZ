import type { CheckIn, EquipmentInstance, LoadConvention, Measurement, PainFlag, PlannedSet, ProgressionRule, SetType, WeightUnit } from '@fizz/schemas';
import { painMentionedNotFlagged, painStatusFor } from './checkin';
import { builtInDefaultRule, ruleCategory, type RuleExerciseInfo } from './default-rule';
import { calculateNextTargets, latestJudgedSession, type HistorySession, type NextTargets, type PainStatus } from './progression';
import { aimReps, PERSONAL_REPS, personalRepRange, personalRuleName, ruleRepsFact, typicalReps, type RuleReps } from './rep-range';
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
  /** See `NextTargetsInput.comparableEquipmentIds` (other items of the same kind and bar mass). */
  comparableEquipmentIds?: ReadonlySet<string>;
  /**
   * (Reps from history, 21 Oct) The exercise is a secondary lift in this workout: a main barbell lift's
   * built-in rule is read as a compound lift's, so its reps follow Ben's last session (a barbell row after
   * the main lift at his usual 12, not 3–6).
   */
  accessory?: boolean;
}

export function nextTargetsFor(req: NextTargetRequest): { result: NextTargets; rule: ProgressionRule } {
  const own = ruleCategory(req.exercise, req.equipment?.kind ?? null, req.convention);
  const category = req.accessory === true && own === 'main_barbell' ? 'compound' : own;
  const base = req.rule ?? builtInDefaultRule(req.ownerId, req.unit, req.workingSets, category);
  const flagged = painStatusFor(req.painFlags, req.exerciseId);
  const pain = flagged.active ? flagged : req.sessionPain;
  const input = {
    exerciseName: req.exerciseName,
    measurement: req.measurement,
    history: req.history,
    rule: base,
    equipment: req.equipment,
    unit: req.unit,
    convention: req.convention,
    pain,
    ...(req.fitLater === true ? { fitLater: true } : {}),
    ...(req.comparableEquipmentIds !== undefined ? { comparableEquipmentIds: req.comparableEquipmentIds } : {}),
  };
  if (req.measurement !== 'reps' || base.method !== 'double_progression') return { result: calculateNextTargets(input), rule: base };
  // Reps from history (21 Oct): the built-in rule's range follows Ben's last session of this exercise, except
  // on a main barbell lift (its top set / back-offs scheme) or a rule of his own (`fixed`).
  const latest = latestJudgedSession(input);
  const last = latest === null ? null : typicalReps(latest.reps);
  const personal = req.rule === null && category !== 'main_barbell';
  const loadable = (req.equipment?.loadConvention ?? req.convention) !== 'bodyweight';
  const p = personal ? personalRepRange(base.repRange, last, base.ceilingRepCap, loadable) : { range: { ...base.repRange }, kind: 'fixed' as const };
  const moved = p.kind === 'history' || p.kind === 'toward_goal';
  // A loaded lift's cap is never below the range (more reps there means more load); bodyweight keeps room to add reps.
  const cap = loadable ? Math.max(base.ceilingRepCap, p.range.max) : Math.max(base.ceilingRepCap, p.range.max + PERSONAL_REPS.width);
  const rule: ProgressionRule = moved ? { ...base, repRange: p.range, ceilingRepCap: cap, name: personalRuleName(p.range, base.maxRpeToProgress) } : base;
  const result = calculateNextTargets({ ...input, rule });
  const first = result.sets.find((s) => s.setType !== 'warmup');
  const aim = aimReps(result.decision, first?.reps ?? p.range, last, latest === null ? null : { from: latest.load, to: first?.load?.value ?? null, direction: latest.direction });
  const reps: RuleReps = { last, goal: { ...base.repRange }, range: p.range, kind: p.kind, aim };
  const fact = ruleRepsFact(reps);
  const explanation = fact === null ? result.explanation : { ...result.explanation, facts: [fact, ...result.explanation.facts] };
  return { result: { ...result, explanation, reps }, rule };
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
