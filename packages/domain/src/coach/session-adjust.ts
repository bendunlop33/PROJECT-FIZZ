import type { AdjustPendingSetsArgs, CoachTarget, EquipmentInstance, GuardNote, Load, PainFlag, PendingSetChange, RepRange, RuleDecision, SessionAggregate, WorkoutSet } from '@fizz/schemas';
import { formatNumber, loadText, NBSP, repRangeText } from '../display';
import { compareDifficulty, loadDirection, roundToAvailableLoad, stepLoad } from '../equipment';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { buildExecutionOrder } from '../session/order';
import { convertMass } from '../units';
import { activeFlag, isIncrease, validateTodayAdjustment, type AdjustIntent, type ExerciseAdjustmentPlan } from './adjust';
import type { CoachTriggerKind } from './trigger';

/**
 * `evaluateSessionAdjustment` (brief §7 service list; build 108 fix F2,
 * coach-adjustments CA6 revised): the built-in rule's change to today's
 * remaining sets of one exercise, for when the coach can't answer. Pure and
 * deterministic: no AI call, no network.
 *
 * It only ever offers. Nothing changes until Ben taps `Adjust` (CLAUDE.md
 * rule 3), and the change goes through the same `validateTodayAdjustment`
 * guardrail and versioned, idempotent write as the coach's, with Undo.
 *
 * The size of the change follows the approved playbook rules (rule 5 "too
 * hard", rule 6 "too easy", D22, equipment-aware progression §9):
 * - Too hard: ≈ 2% per RPE point over the set's target (the low end of rule
 *   5's 2–4%), at least 5% and at most 10% (D22), rounded down to an
 *   achievable load, same reps. With no effort logged (a rep miss), or Ben's
 *   own `Too hard`, the 5% minimum. If that
 *   load is more than 10% lighter, or there is none, the same load with
 *   fewer reps instead: the reps Ben just managed (`reps_short`), or one
 *   fewer than he managed (`rpe_high`). Never an increase, never a removed
 *   or added set.
 * - Assisted machines: one assistance step easier (or harder), since the %
 *   needs bodyweight (playbook 7 step 6, D5).
 * - Too easy: the next achievable load if it is at most 5% heavier (rule 6),
 *   else +1 rep. Never with a pain flag on the movement, or pain mentioned at
 *   check-in (rule 9).
 */

export const BUILT_IN_SESSION_RULE = {
  /** Rule 5 / D22 minimum drop (%), rounded down to an achievable load. */
  loadDropPct: 5,
  /** Rule 5: % lighter per RPE point over the target (the low end of 2–4%). */
  loadDropPctPerRpePoint: 2,
  /** Rule 5 guardrail: a bigger drop than this switches to fewer reps (%). */
  maxLoadDropPct: 10,
  /** Rule 6 lower bound for the step up (%); a bigger next step switches to reps. */
  maxLoadRisePct: 5,
  /** Rule 6's smallest reps step. */
  repsUp: 1,
} as const;

export const BUILT_IN_SESSION_RULE_NAME = {
  too_hard: 'Too hard: lighter or fewer reps (playbook rule 5)',
  too_easy: 'Too easy: next step up (playbook rule 6)',
} as const;

export interface SessionAdjustmentInput {
  aggregate: SessionAggregate;
  /**
   * What asked for the change: a trigger that fired on a logged set, or Ben's
   * own `Too hard` / `Too easy` chip on an exercise when the coach can't
   * answer (review coach-fallback S1; CA6, CLAUDE.md rule 3).
   */
  trigger: SessionAdjustmentTrigger;
  painFlags: readonly PainFlag[];
  /** The check-in said `Pain` with no movement chosen (rule 9: no increases today). */
  sessionPainUnspecified: boolean;
  gymName: string | null;
}

export type SessionAdjustmentTrigger =
  /** `targetRpe` / `loggedRpe`: from the trigger (`CoachTrigger`), for the size of a too-hard drop. */
  | { kind: CoachTriggerKind; setId: string; fact: string; targetRpe?: number | null; loggedRpe?: number | null }
  /** `fact`: app text for the request (`Too hard`). Fewer reps, when used, is one fewer than the planned top. */
  | { kind: 'ben_asked'; intent: 'too_hard' | 'too_easy'; sessionExerciseId: string; fact: string };

export interface SessionAdjustment {
  sessionExerciseId: string;
  intent: Extract<AdjustIntent, 'too_hard' | 'too_easy'>;
  /** The request as the guardrail saw it (`baseVersion` = the workout's version now). */
  args: AdjustPendingSetsArgs;
  /** `validateTodayAdjustment`'s plan: what Apply writes. */
  plan: ExerciseAdjustmentPlan[];
  guardNotes: GuardNote[];
  touchedSetIds: string[];
  /** `Next sets: 57.5 kg × 3–6` (app text, shown on the offer). */
  change: string;
  /** The recorded reason (app text; the rule's, never the model's). */
  reason: string;
  /** For each changed set's `Why?` (`source: 'rule'`). */
  rule: { name: string; decision: RuleDecision; summary: string; facts: string[] };
}

const EPS = 1e-9;

function liveInOrder(state: SessionAggregate, sessionExerciseId: string): WorkoutSet[] {
  const order = buildExecutionOrder(state.exercises, state.sets);
  const pos = new Map(order.map((id, i) => [id, i]));
  return state.sets
    .filter((s) => s.sessionExerciseId === sessionExerciseId && s.status !== 'deleted')
    .sort((a, b) => (pos.get(a.id) ?? a.index + 1e6) - (pos.get(b.id) ?? b.index + 1e6));
}

function inUnit(load: Load, eq: EquipmentInstance): number {
  return load.unit === eq.unit ? load.value : convertMass(load, eq.unit).value;
}

type Lever = 'load' | 'reps';

/**
 * Rule 5 / D22: the % to ask for, from how far logged effort was over the
 * target (2% per point, at least 5%, at most 10%). No effort to go by: 5%.
 */
export function tooHardDropPct(targetRpe: number | null | undefined, loggedRpe: number | null | undefined): number {
  const r = BUILT_IN_SESSION_RULE;
  const over = targetRpe == null || loggedRpe == null ? 0 : loggedRpe - targetRpe;
  return Math.min(r.maxLoadDropPct, Math.max(r.loadDropPct, over * r.loadDropPctPerRpePoint));
}

/** Too hard: the load step, or null when rule 5 says fewer reps instead. */
function easierLoad(cur: Load, eq: EquipmentInstance, dropPct: number): Load | null {
  const direction = loadDirection(eq.loadConvention);
  const now = inUnit(cur, eq);
  if (direction === 'assistance') {
    const step = stepLoad(now, eq, 'increase');
    return step.ok ? { value: step.value, unit: eq.unit, convention: eq.loadConvention } : null;
  }
  if (now <= 0) return null;
  const asked: Load = { value: now * (1 - dropPct / 100), unit: eq.unit, convention: eq.loadConvention };
  const r = roundToAvailableLoad(asked, eq, 'easier');
  if (!r.ok || compareDifficulty(r.load.value, now, direction) >= 0) return null;
  const drop = (now - r.load.value) / now;
  return drop <= BUILT_IN_SESSION_RULE.maxLoadDropPct / 100 + EPS ? r.load : null;
}

/** Too easy: the next achievable step up, if rule 6 allows it. */
function harderLoad(cur: Load, eq: EquipmentInstance): Load | null {
  const direction = loadDirection(eq.loadConvention);
  const now = inUnit(cur, eq);
  if (direction === 'assistance') {
    const step = stepLoad(now, eq, 'decrease');
    return step.ok ? { value: step.value, unit: eq.unit, convention: eq.loadConvention } : null;
  }
  if (now <= 0) return null;
  const step = stepLoad(now, eq, 'increase');
  if (!step.ok) return null;
  return (step.value - now) / now <= BUILT_IN_SESSION_RULE.maxLoadRisePct / 100 + EPS ? { value: step.value, unit: eq.unit, convention: eq.loadConvention } : null;
}

function fewerReps(kind: SessionAdjustmentTrigger['kind'], planned: RepRange, achieved: number | null): RepRange | null {
  // Ben asked with no logged set to go by: one fewer than the planned top.
  const base = kind === 'ben_asked' ? planned.max : achieved;
  if (base === null) return null;
  const n = Math.max(1, kind === 'reps_short' ? base : base - 1);
  if (n >= planned.max) return null;
  return { min: Math.min(planned.min, n), max: n };
}

function phrase(t: CoachTarget, convention: SessionAggregate['exercises'][number]['loadConvention'], eq: EquipmentInstance | null): string {
  const reps = t.reps === null ? null : repRangeText(t.reps);
  const load = t.load === null || convention === 'bodyweight' ? null : loadText(t.load, t.load.convention, eq);
  if (load !== null && reps !== null) return `${load}${NBSP}×${NBSP}${reps}`;
  if (load !== null) return load;
  return reps === null ? '—' : `${reps}${NBSP}reps`;
}

function pct(from: Load, to: Load): number {
  if (from.value === 0) return 0;
  const a = from.unit === to.unit ? from.value : convertMass(from, to.unit).value;
  return Math.abs(to.value - a) / a * 100;
}

export function evaluateSessionAdjustment(input: SessionAdjustmentInput): SessionAdjustment | null {
  const state = input.aggregate;
  if (state.session.status !== 'active') return null;
  const t = input.trigger;
  const logged = t.kind === 'ben_asked' ? null : state.sets.find((s) => s.id === t.setId);
  if (logged === undefined) return null;
  const ex = state.exercises.find((e) => e.id === (t.kind === 'ben_asked' ? t.sessionExerciseId : logged?.sessionExerciseId));
  if (ex === undefined) return null;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const intent: SessionAdjustment['intent'] = t.kind === 'ben_asked' ? t.intent : t.kind === 'rpe_low' ? 'too_easy' : 'too_hard';
  if (intent === 'too_easy' && (activeFlag(input.painFlags, ex.exerciseId) !== null || input.sessionPainUnspecified)) return null;
  // (PM, 23 Oct) A deload week is easy on purpose: an easy set there raises no offer. Ben can still ask.
  if (t.kind === 'rpe_low' && state.session.deload !== undefined) return null;

  const achieved = logged?.actual?.reps ?? null;
  const dropPct = t.kind === 'ben_asked' ? BUILT_IN_SESSION_RULE.loadDropPct : tooHardDropPct(t.targetRpe, t.loggedRpe);
  const pending = liveInOrder(state, ex.id).filter((s) => s.status === 'pending' && s.setType !== 'warmup');
  const changes: PendingSetChange[] = [];
  const levers = new Set<Lever>();
  const loadPcts: number[] = [];
  for (const set of pending) {
    const cur = set.planned.load;
    const reps = set.planned.reps;
    let after: CoachTarget | null = null;
    const loaded = cur !== null && cur.convention !== 'bodyweight' && ex.loadConvention !== 'bodyweight' && eq !== null && cur.convention === eq.loadConvention;
    const step = loaded ? (intent === 'too_hard' ? easierLoad(cur, eq, dropPct) : harderLoad(cur, eq)) : null;
    if (step !== null && cur !== null) {
      after = { load: step, reps };
      levers.add('load');
      loadPcts.push(pct(cur, step));
    } else if (reps !== null) {
      const r = intent === 'too_hard' ? fewerReps(input.trigger.kind, reps, achieved) : { min: reps.min + BUILT_IN_SESSION_RULE.repsUp, max: Math.min(100, reps.max + BUILT_IN_SESSION_RULE.repsUp) };
      if (r !== null) {
        after = { load: cur, reps: r };
        levers.add('reps');
      }
    }
    if (after === null) continue;
    // Never raise after a miss or a hard set (CLAUDE.md rule 3, rule 5); checked here as well as by the guardrail's snapping.
    if (intent === 'too_hard' && isIncrease({ load: cur, reps }, after, ex.loadConvention)) continue;
    changes.push({ setId: set.id, target: after });
  }
  if (changes.length === 0) return null;

  const lever = levers.has('load') ? (levers.has('reps') ? 'load and reps' : 'load') : 'reps';
  const pctText = loadPcts.length === 0 ? '' : ` (${formatNumber(Math.round(Math.min(...loadPcts) * 10) / 10)}${loadPcts.some((p) => Math.abs(p - (loadPcts[0] ?? 0)) > 0.05) ? `–${formatNumber(Math.round(Math.max(...loadPcts) * 10) / 10)}` : ''}%)`;
  const summary =
    intent === 'too_hard'
      ? lever === 'reps'
        ? 'Same load, fewer reps for the remaining sets.'
        : `Lighter load for the remaining sets${pctText}.`
      : lever === 'reps'
        ? `${String(BUILT_IN_SESSION_RULE.repsUp)} more rep for the remaining sets.`
        : `Next step up for the remaining sets${pctText}.`;
  const reason = `${input.trigger.fact}. ${summary}`.slice(0, 240);
  const decision: RuleDecision = intent === 'too_hard' ? (levers.has('load') ? 'reduce_load' : 'hold_after_miss') : levers.has('load') ? 'increase_load' : 'increase_reps';

  const args: AdjustPendingSetsArgs = {
    baseVersion: state.session.version,
    exercises: [{ sessionExerciseId: ex.id, sets: changes, addSet: null, removeSetId: null }],
    reason,
  };
  const checked = validateTodayAdjustment({ aggregate: state, args, intent, opId: `built-in:${t.kind === 'ben_asked' ? `asked:${t.sessionExerciseId}` : t.setId}`, painFlags: input.painFlags, sessionPainUnspecified: input.sessionPainUnspecified, gymName: input.gymName, messagePain: null });
  if (checked.status !== 'apply') return null;
  const applied = checked.exercises.flatMap((e) => e.changes).filter((c) => c.before !== null && c.after !== null);
  if (applied.length === 0) return null;
  const phrases = applied.map((c) => ({ n: c.setNumber, text: c.after === null ? '—' : phrase(c.after, ex.loadConvention, eq) }));
  const firstText = phrases[0]?.text ?? '—';
  const change = phrases.every((p) => p.text === firstText)
    ? `${phrases.length === 1 ? 'Next set' : 'Next sets'}: ${firstText}`
    : phrases.map((p) => `Set ${String(p.n)}: ${p.text}`).join(' · ');
  return {
    sessionExerciseId: ex.id,
    intent,
    args,
    plan: checked.exercises,
    guardNotes: checked.guardNotes,
    touchedSetIds: checked.touchedSetIds,
    change,
    reason,
    rule: { name: BUILT_IN_SESSION_RULE_NAME[intent], decision, summary, facts: [input.trigger.fact] },
  };
}
