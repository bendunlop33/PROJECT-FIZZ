import type { CoachTarget, EquipmentInstance, GuardNote, GuardNoteKind, NextSessionTarget, NextSessionTargetRecord, PainFlag, PlannedSet, SessionAggregate, SessionExercise, SetType, TargetProvenance } from '@fizz/schemas';
import { formatNumber } from '../display';
import { compareDifficulty, loadDirection, stepLoad } from '../equipment';
import { activeFlag, AREA_WORD, isIncrease, sameTarget, snapLoad, validReps } from './adjust';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { deriveId } from '../stable';
import { usualTargetRpeOf, type TargetRpeSource } from './target-rpe';
import { nextTargetBlocks } from '../session/gym-switch';

/**
 * Next-session targets from the coach (ADR 0020 §4–5, playbook D21,
 * coach-adjustments CA8). Pure. The model's numbers are only a request:
 * - every load is snapped to the source workout's equipment and capped at
 *   its max, in its own unit and convention (rule 4);
 * - a pain-flagged movement never goes up (rule 9);
 * - `classifyNextSessionChange` decides what counts as a **small** change,
 *   which is saved by default, and what is **bigger**, which is a proposal
 *   Ben applies. An extra set he didn't ask for is bigger: offered with Apply
 *   (Ben, 23 Oct; was dropped, D1). A stall
 *   reset (playbook rule 8) is always bigger (Ben, 23 Oct, D2: stall resets
 *   always need Apply).
 */

export interface NextSessionBasis {
  /** The exercise as it was in the finished workout. */
  exercise: SessionExercise;
  equipment: EquipmentInstance | null;
  /**
   * The last working target (today's plan; today's top set when there was
   * none). Its `rpe` is the set's usual target RPE (`usualTargetRpeOf`: the
   * coach's, the routine's RPE or 10 − RIR, else the built-in rule's; review
   * target-rpe B1). Ben's own override is left out: it is for that workout
   * only (§4.8), so it is never the baseline for next time (r2 S1).
   */
  last: CoachTarget;
  /** Where `last.rpe` came from; absent when it has none. Never `ben`. */
  lastRpeSource?: TargetRpeSource | undefined;
  /** Ben's own target RPE for that workout, when he set one (not carried forward). */
  benRpe?: number | undefined;
  lastSets: number;
  /** The built-in rule's target for next time, for comparison; null when it plans nothing. */
  builtIn: { target: CoachTarget; sets: number } | null;
  /**
   * The lift is stalled (playbook rule 8: 2–3 sessions failing the same target): the built-in rule found
   * repeated misses at the same load (`failuresBeforeReduce` sessions in a row): its `reduce_load` decision, or
   * its hold at the lightest load this equipment has (`rule.stalled`; review v5offers 6). A coach change that
   * eases the load or changes the rep target on it is then a stall reset.
   */
  stalled?: boolean | undefined;
}

export interface NextSessionChangeContext {
  /** Ben asked for more sets or volume in this conversation (D1). */
  benAskedForMoreSets: boolean;
}

/** Per exercise: whether its lift is stalled (`NextSessionBasis.stalled`). */
export interface NextSessionChangeFacts extends NextSessionChangeContext {
  stalled?: boolean | undefined;
}

/** CA8's `bigger` reason for a stall reset (app text, behind `Why?`). */
export const STALL_RESET_REASON = 'A reset after a stall.';

/**
 * A stall reset (playbook rule 8: "a 5–10% reset or a rep-scheme change"): on a stalled lift, a coach target
 * that eases the load (less weight; more assistance on an assisted machine) or changes the rep target.
 */
export function isStallReset(last: CoachTarget, after: CoachTarget, stalled: boolean): boolean {
  if (!stalled) return false;
  const a = last.load;
  const b = after.load;
  const eased = a !== null && b !== null && a.unit === b.unit && a.convention === b.convention && compareDifficulty(b.value, a.value, loadDirection(b.convention)) < 0;
  const repsChanged = after.reps !== null && last.reps !== null && (after.reps.min !== last.reps.min || after.reps.max !== last.reps.max);
  return eased || repsChanged;
}

export type NextChangeSize = 'small' | 'bigger';

export interface NextChangeClass {
  size: NextChangeSize;
  /** Why it isn't small (app text, for `Why?`); empty when small. */
  reasons: string[];
  /** The set count to save. */
  setsAfter: number;
}

/** (Ben, 23 Oct; review v5offers SP1) CA8's `bigger` reason for a +1 set Ben didn't ask for (app text, behind `Why?`). */
export const EXTRA_SET_REASON = 'Extra set you didn’t ask for.';

/**
 * CA8: small = the load stays or moves exactly one achievable step on this
 * equipment, the rep range moves by at most 2 at either end, the set
 * count changes by at most one (+1 only when Ben asked: unasked it is bigger), and the target RPE
 * stays (a coach `rpe` that differs from the last target's is bigger, as CA8
 * says "effort targets … don't change"). Anything else is
 * bigger. With no equipment, any load change is bigger: a step can't be
 * measured (rule 4). A stall reset (`isStallReset`) is always bigger, even
 * one step (CA8; D2, 23 Oct), and so is a +1 set Ben didn't ask for (Ben, 23 Oct).
 */
export function classifyNextSessionChange(
  last: CoachTarget,
  lastSets: number,
  after: CoachTarget,
  afterSets: number,
  equipment: EquipmentInstance | null,
  ctx: NextSessionChangeFacts,
): NextChangeClass {
  const reasons: string[] = [];
  if (isStallReset(last, after, ctx.stalled === true)) reasons.push(STALL_RESET_REASON);
  const lastLoad = last.load;
  const nextLoad = after.load;
  if (nextLoad !== null && !(lastLoad !== null && lastLoad.unit === nextLoad.unit && lastLoad.convention === nextLoad.convention && lastLoad.value === nextLoad.value)) {
    if (lastLoad === null || lastLoad.unit !== nextLoad.unit || lastLoad.convention !== nextLoad.convention) reasons.push('The load changes how it is measured.');
    else if (equipment === null) reasons.push('No equipment is set to measure one step.');
    else {
      const up = stepLoad(lastLoad.value, equipment, 'increase');
      const down = stepLoad(lastLoad.value, equipment, 'decrease');
      const oneStep = (up.ok && up.value === nextLoad.value) || (down.ok && down.value === nextLoad.value);
      if (!oneStep) reasons.push('The load moves more than one step.');
    }
  }
  if (after.reps !== null) {
    if (last.reps === null) reasons.push('A rep target is new.');
    else if (Math.abs(after.reps.min - last.reps.min) > 2 || Math.abs(after.reps.max - last.reps.max) > 2) reasons.push('Reps move by more than 2.');
  }
  // CA8: effort targets don't change by default; a new target RPE is Ben's to apply.
  if (after.rpe != null && after.rpe !== (last.rpe ?? null)) reasons.push('The effort target changes.');
  const delta = afterSets - lastSets;
  if (Math.abs(delta) > 1) reasons.push('Sets change by more than one.');
  // (Ben, 23 Oct; D2, v5offers SP1) A +1 Ben didn't ask for is offered on the Summary with Apply / Skip, never dropped
  // and never saved by default; applying it counts as asking (playbook D1).
  else if (delta === 1 && !ctx.benAskedForMoreSets) reasons.push(EXTRA_SET_REASON);
  return { size: reasons.length === 0 ? 'small' : 'bigger', reasons, setsAfter: afterSets };
}

export interface NextSessionRow {
  exerciseId: string;
  exerciseName: string;
  /** The built-in rule's target (the comparison and the fallback). */
  builtIn: CoachTarget | null;
  builtInSets: number | null;
  after: CoachTarget;
  /** Working sets next time; null = keep today's count. */
  sets: number | null;
  size: NextChangeSize;
  reasons: string[];
  /** The coach's reason, as given (claim-checked by the caller). */
  reason: string;
  guardNotes: GuardNote[];
  /** Load change from the last working target, in % (one decimal); null with no load. */
  pctChange: number | null;
}

export interface NextSessionValidation {
  rows: NextSessionRow[];
  /** Notes for targets that were dropped whole (pain, unknown exercise, impossible load). */
  dropped: GuardNote[];
}

export interface NextSessionValidationInput {
  source: SessionAggregate;
  bases: readonly NextSessionBasis[];
  targets: readonly NextSessionTarget[];
  painFlags: readonly PainFlag[];
  gymName: string | null;
  ctx: NextSessionChangeContext;
}

function pct(last: CoachTarget, after: CoachTarget): number | null {
  const a = last.load;
  const b = after.load;
  if (a === null || b === null || a.unit !== b.unit || a.value === 0) return null;
  return Math.round(((b.value - a.value) / a.value) * 1000) / 10;
}

/** `+2.5%`, `−20%`, `0%`. */
export function pctText(p: number | null): string | null {
  if (p === null) return null;
  if (p === 0) return '0%';
  return `${p > 0 ? '+' : '−'}${formatNumber(Math.abs(p))}%`;
}

export function validateNextSessionTargets(input: NextSessionValidationInput): NextSessionValidation {
  const rows: NextSessionRow[] = [];
  const dropped: GuardNote[] = [];
  const drop = (kind: GuardNoteKind, text: string): void => {
    dropped.push({ kind, setIds: [], text });
  };
  const seen = new Set<string>();
  for (const t of input.targets) {
    const basis = input.bases.find((b) => b.exercise.exerciseId === t.exerciseId);
    if (basis === undefined || seen.has(t.exerciseId)) {
      drop('unknown_target', 'Not used: the coach named an exercise that isn’t in this workout.');
      continue;
    }
    seen.add(t.exerciseId);
    const ex = basis.exercise;
    const notes: GuardNote[] = [];
    let load = basis.last.load;
    if (t.target.load !== null) {
      const snapped = snapLoad(t.target.load, ex, basis.equipment, 'nearest');
      if (!snapped.ok) {
        drop(snapped.note.kind, snapped.note.text.replace('Load unchanged.', 'Not used.'));
        continue;
      }
      if (snapped.note) notes.push({ ...snapped.note, setIds: [] });
      if (snapped.extra) notes.push({ ...snapped.extra, setIds: [] });
      load = snapped.load;
    }
    let reps = basis.last.reps;
    if (t.target.reps !== null) {
      if (!validReps(t.target.reps)) {
        drop('invalid_reps', `Not used: ${String(t.target.reps.min)}–${String(t.target.reps.max)} reps isn't a usable target.`);
        continue;
      }
      reps = t.target.reps;
    }
    // A target RPE that restates the plan's or the built-in rule's is no change: next time's plan
    // gives the same value again, so it isn't stored as the coach's (review target-rpe B1). Ben's
    // own value for the day isn't the baseline (r2 S1): repeating it is a change Ben applies.
    const restated = t.target.rpe != null && t.target.rpe === basis.last.rpe && (basis.lastRpeSource === 'rule' || basis.lastRpeSource === 'plan');
    const after: CoachTarget = { load, reps, ...(t.target.rpe != null && !restated ? { rpe: t.target.rpe } : {}) };
    const wantSets = t.sets ?? basis.lastSets;
    const flag = activeFlag(input.painFlags, ex.exerciseId);
    if (flag !== null && (isIncrease(basis.last, after, ex.loadConvention) || wantSets > basis.lastSets)) {
      const area = flag.area ? AREA_WORD[flag.area] : '';
      drop('pain_blocked', area ? `Not increasing ${ex.exerciseName}: you flagged ${area} pain.` : `Not increasing ${ex.exerciseName}: you flagged pain on it.`);
      continue;
    }
    const cls = classifyNextSessionChange(basis.last, basis.lastSets, after, wantSets, basis.equipment, { ...input.ctx, stalled: basis.stalled === true });
    const builtIn = basis.builtIn?.target ?? null;
    // Same as the built-in rule and the same set count: nothing for the coach to change.
    if (builtIn !== null && sameTarget(builtIn, after) && cls.setsAfter === (basis.builtIn?.sets ?? basis.lastSets)) continue;
    rows.push({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      builtIn,
      builtInSets: basis.builtIn?.sets ?? null,
      after,
      sets: cls.setsAfter === basis.lastSets && t.sets === null ? null : cls.setsAfter,
      size: cls.size,
      reasons: cls.reasons,
      reason: t.reason,
      guardNotes: notes,
      pctChange: pct(basis.last, after),
    });
  }
  return { rows, dropped };
}

/**
 * The basis per exercise of a finished workout: equipment from its snapshot,
 * the last working target (today's plan, or the top set when there was no
 * plan) and the built-in rule's plan for comparison. Exercises with no
 * completed working set have no basis (nothing to progress from).
 */
export function nextSessionBases(
  source: SessionAggregate,
  builtIn: ReadonlyMap<string, readonly { setType: string; planned: { load: CoachTarget['load']; reps: CoachTarget['reps']; provenance?: { rule?: { decision: string; stalled?: true | undefined } | undefined } | null | undefined } }[]>,
  /** The built-in rule's target RPE per session exercise (`ruleTargetRpes`), the last fallback of `last.rpe`. */
  ruleTargetRpe: Readonly<Record<string, number>> = {},
): NextSessionBasis[] {
  const out: NextSessionBasis[] = [];
  // One basis per exercise block: an exercise split across gyms (gym-switch GS6) reads its
  // deciding part, on that part's item, the same as the built-in rule's `Next time`.
  for (const block of nextTargetBlocks(source)) {
    const ex = block.decider;
    if (block.copy || ex.measurement !== 'reps' || out.some((b) => b.exercise.exerciseId === ex.exerciseId)) continue;
    const working = source.sets.filter((s) => s.sessionExerciseId === ex.id && s.setType !== 'warmup' && s.pairedWithSetId === null && s.status === 'completed');
    const first = working[0];
    if (first === undefined) continue;
    const plannedSet = working.find((s) => s.planned.load !== null || s.planned.reps !== null) ?? null;
    const planned = plannedSet?.planned ?? null;
    const top = [...working].sort((a, b) => (b.actual?.load?.value ?? 0) - (a.actual?.load?.value ?? 0))[0] ?? first;
    // Field by field: today's plan where it had one, else what the top set did.
    // The target RPE it was planned at: the coach's, the routine's (RIR as 10 − RIR), else the built-in
    // rule's (review target-rpe B1). Ben's override is for that workout only, so it isn't the baseline (r2 S1).
    const basisSet = plannedSet ?? first;
    const lastRpe = usualTargetRpeOf(basisSet, ruleTargetRpe[ex.id] ?? null);
    const benRpe = basisSet.setType === 'warmup' || basisSet.setType === 'drop' ? undefined : basisSet.planned.rpeOverride;
    const last: CoachTarget = {
      load: planned?.load ?? top.actual?.load ?? null,
      reps: planned?.reps ?? (top.actual?.reps == null ? null : { min: top.actual.reps, max: top.actual.reps }),
      ...(lastRpe !== null ? { rpe: lastRpe.rpe } : {}),
    };
    const plan = builtIn.get(ex.exerciseId) ?? null;
    const workingPlan = plan?.filter((p) => p.setType !== 'warmup') ?? [];
    const firstPlan = workingPlan[0];
    out.push({
      exercise: ex,
      equipment: block.equipment ?? equipmentOfRow(source.session.equipmentSnapshot, ex),
      last,
      ...(lastRpe !== null ? { lastRpeSource: lastRpe.source } : {}),
      ...(benRpe !== undefined ? { benRpe } : {}),
      lastSets: block.workingSets,
      builtIn: firstPlan === undefined ? null : { target: { load: firstPlan.planned.load, reps: firstPlan.planned.reps }, sets: workingPlan.length },
      // Rule 8's stall, as the built-in rule saw it: repeated misses at the same load, reduced or not (review v5offers 6).
      ...(firstPlan?.planned.provenance?.rule?.decision === 'reduce_load' || firstPlan?.planned.provenance?.rule?.stalled === true ? { stalled: true } : {}),
    });
  }
  return out;
}

type PlanEntry = { setType: SetType; planned: PlannedSet };

/**
 * A next-session plan entry. A coach entry (D21) also carries what a library
 * workout needs to keep its own structure (review B1): the set count the
 * coach chose (null: it kept the count), when the target became active
 * (saved, or Applied by Ben; its `updatedAtUtc`), and the
 * built-in rule's plan for the same exercise (for the workout's other set
 * types). Not stored anywhere.
 */
/**
 * `coach.rpe`: the coach's own target RPE (null: it set none). `planned.rpe`
 * falls back to the built-in plan's, so it can't tell them apart; only the
 * coach's own goes with its load on a saved workout (WL7, review S2).
 */
export type NextTargetEntry = PlanEntry & { coach?: { sets: number | null; setAtUtc: string; builtIn: readonly PlanEntry[]; rpe?: number | null | undefined } | undefined };

/**
 * What the coach's next-session targets were worked out from: the source
 * workout's sets as they stand (each set's ID, status and version). A rename
 * or a time edit on the Summary leaves it as it is; a corrected set changes
 * it (CA10, rule 5).
 */
export function nextTargetSourceBasis(source: Pick<SessionAggregate, 'sets'>): string {
  return deriveId(`next-target-basis:${source.sets.map((s) => `${s.id}:${s.status}:${String(s.version)}`).sort().join(',')}`);
}

/**
 * Whether a saved row still fits its source workout as it is now: the same
 * sets (`sourceBasis`), or, for rows saved before that existed, the same
 * session version.
 */
export function nextTargetFitsSource(row: Pick<NextSessionTargetRecord, 'sourceVersion' | 'sourceBasis'>, source: { version: number | null; basis: string | null }): boolean {
  if (row.sourceBasis !== undefined && source.basis !== null) return row.sourceBasis === source.basis;
  return row.sourceVersion === source.version;
}

/** (Ben, 23 Oct) Ben's answer to the built-in rule's own stall reset, stored with the coach's rows (`origin: 'rule'`). */
export function isRuleResetRow(r: Pick<NextSessionTargetRecord, 'origin'>): boolean {
  return r.origin === 'rule';
}

/** The coach's own next-session rows: never Ben's answers to the rule's reset. */
export function coachTargetRows<T extends Pick<NextSessionTargetRecord, 'origin'>>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isRuleResetRow(r));
}

/**
 * (Ben, 23 Oct; review v5offers SP2) The exercises whose rule stall reset Ben applied on this source workout's
 * Summary and that still stand: `applied`, not used by a workout started from it, set on the workout as it still is
 * (a corrected set makes the rule decide afresh). The rule lowers their load (`acceptReset`); every other stall holds.
 */
export function acceptedRuleResets(rows: readonly NextSessionTargetRecord[], source: SessionAggregate): Set<string> {
  const fits = { version: source.session.version, basis: nextTargetSourceBasis(source) };
  return new Set(rows.filter((r) => isRuleResetRow(r) && r.status === 'applied' && r.usedBySessionId === null && r.sourceSessionId === source.session.id && nextTargetFitsSource(r, fits)).map((r) => r.exerciseId));
}

/**
 * `nextTargetsOf` with the coach's saved targets (D21): for each exercise
 * with a row that is in use (`saved`, or `applied` by Ben), not used yet and
 * set on the workout as it still is (its sets; a rename doesn't count), the working sets take the coach's
 * target (source `coach`) and count; warm-ups stay as the built-in rule
 * plans them. Everything else keeps the built-in rule's plan, which is
 * always the fallback. A pain flag set since, or pain in today's check-in,
 * means the built-in rule decides (it holds loads; rule 9).
 */
export function withCoachTargets(
  builtIn: ReadonlyMap<string, readonly PlanEntry[]>,
  rows: readonly NextSessionTargetRecord[],
  source: SessionAggregate,
  ctx: { flaggedExerciseIds: ReadonlySet<string>; painToday: boolean },
): Map<string, NextTargetEntry[]> {
  const out = new Map<string, NextTargetEntry[]>([...builtIn].map(([k, v]) => [k, [...v]]));
  if (ctx.painToday) return out;
  const fits = { version: source.session.version, basis: nextTargetSourceBasis(source) };
  for (const row of rows) {
    // Ben's answer to the rule's own reset isn't a coach target: the rule itself plans it (`acceptReset`).
    if (isRuleResetRow(row) || (row.status !== 'saved' && row.status !== 'applied')) continue;
    if (row.usedBySessionId !== null || !nextTargetFitsSource(row, fits) || row.sourceSessionId !== source.session.id) continue;
    if (ctx.flaggedExerciseIds.has(row.exerciseId)) continue;
    const plan = builtIn.get(row.exerciseId) ?? [];
    const warmups = plan.filter((p) => p.setType === 'warmup');
    const working = plan.filter((p) => p.setType !== 'warmup');
    const lastWorking = source.sets.filter((s) => source.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId === row.exerciseId && s.setType !== 'warmup' && s.status === 'completed' && s.pairedWithSetId === null);
    const count = row.sets ?? (working.length > 0 ? working.length : lastWorking.length);
    if (count < 1) continue;
    const template = working[0]?.planned ?? lastWorking[0]?.planned ?? null;
    const setType: SetType = working[0]?.setType ?? lastWorking[0]?.setType ?? 'working';
    // `Why?` (§2.12): set by the coach after that workout, its reason in quotes, the rule's `Last time` kept.
    // `setAt` is when the target became active (saved, or Applied later by Ben), the same time the WL7 comparison uses (review N14).
    const provenance: TargetProvenance = {
      source: 'coach',
      setAt: { utc: row.updatedAtUtc, tz: source.session.startedAt.tz },
      routineName: source.session.routineName,
      requestedLoad: row.target.load,
      basis: working[0]?.planned.provenance?.basis ?? null,
      coach: { actionId: row.actionId, scope: 'next_session', reason: row.reason },
      guardNotes: row.guardNotes.map((n) => n.text).slice(0, 10),
    };
    const planned: PlannedSet = { load: row.target.load, reps: row.target.reps, durationS: null, rpe: row.target.rpe ?? template?.rpe ?? null, rir: row.target.rpe != null ? null : (template?.rir ?? null), source: 'coach', provenance };
    // When the target became active (saved, or Applied later by Ben): a slot changed before that is not "since" (review S1).
    const coach = { sets: row.sets, setAtUtc: row.updatedAtUtc, builtIn: plan, rpe: row.target.rpe ?? null };
    out.set(row.exerciseId, [...warmups, ...Array.from({ length: count }, () => ({ setType, planned, coach }))]);
  }
  return out;
}
