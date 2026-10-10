import type { CoachTarget, EquipmentInstance, GuardNote, GuardNoteKind, NextSessionTarget, NextSessionTargetRecord, PainFlag, PlannedSet, SessionAggregate, SessionExercise, SetType } from '@fizz/schemas';
import { formatNumber } from '../display';
import { stepLoad } from '../equipment';
import { activeFlag, AREA_WORD, isIncrease, sameTarget, snapLoad, validReps } from './adjust';

/**
 * Next-session targets from the coach (ADR 0019 §4–5, playbook D21,
 * coach-adjustments CA8). Pure. The model's numbers are only a request:
 * - every load is snapped to the source workout's equipment and capped at
 *   its max, in its own unit and convention (rule 4);
 * - a pain-flagged movement never goes up (rule 9);
 * - `classifyNextSessionChange` decides what counts as a **small** change,
 *   which is saved by default, and what is **bigger**, which is a proposal
 *   Ben applies. An extra set he didn't ask for is dropped (D1).
 */

export interface NextSessionBasis {
  /** The exercise as it was in the finished workout. */
  exercise: SessionExercise;
  equipment: EquipmentInstance | null;
  /** The last working target (today's plan; today's top set when there was none). */
  last: CoachTarget;
  lastSets: number;
  /** The built-in rule's target for next time, for comparison; null when it plans nothing. */
  builtIn: { target: CoachTarget; sets: number } | null;
}

export interface NextSessionChangeContext {
  /** Ben asked for more sets or volume in this conversation (D1). */
  benAskedForMoreSets: boolean;
}

export type NextChangeSize = 'small' | 'bigger';

export interface NextChangeClass {
  size: NextChangeSize;
  /** Why it isn't small (app text, for `Why?`); empty when small. */
  reasons: string[];
  /** The set count to save: an unasked +1 is dropped back to the last count. */
  setsAfter: number;
  /** An extra set was dropped (D1). */
  droppedExtraSet: boolean;
}

/**
 * CA8: small = the load stays or moves exactly one achievable step on this
 * equipment, the rep range moves by at most 2 at either end, and the set
 * count changes by at most one (+1 only when Ben asked). Anything else is
 * bigger. With no equipment, any load change is bigger: a step can't be
 * measured (rule 4).
 */
export function classifyNextSessionChange(
  last: CoachTarget,
  lastSets: number,
  after: CoachTarget,
  afterSets: number,
  equipment: EquipmentInstance | null,
  ctx: NextSessionChangeContext,
): NextChangeClass {
  const reasons: string[] = [];
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
  let setsAfter = afterSets;
  let droppedExtraSet = false;
  const delta = afterSets - lastSets;
  if (Math.abs(delta) > 1) reasons.push('Sets change by more than one.');
  else if (delta === 1 && !ctx.benAskedForMoreSets) {
    setsAfter = lastSets;
    droppedExtraSet = true;
  }
  return { size: reasons.length === 0 ? 'small' : 'bigger', reasons, setsAfter, droppedExtraSet };
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
      const snapped = snapLoad(t.target.load, ex, basis.equipment, 'nearest', input.gymName);
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
    const after: CoachTarget = { load, reps };
    const wantSets = t.sets ?? basis.lastSets;
    const flag = activeFlag(input.painFlags, ex.exerciseId);
    if (flag !== null && (isIncrease(basis.last, after, ex.loadConvention) || wantSets > basis.lastSets)) {
      const area = flag.area ? AREA_WORD[flag.area] : '';
      drop('pain_blocked', area ? `Not increasing ${ex.exerciseName}: you flagged ${area} pain.` : `Not increasing ${ex.exerciseName}: you flagged pain on it.`);
      continue;
    }
    const cls = classifyNextSessionChange(basis.last, basis.lastSets, after, wantSets, basis.equipment, input.ctx);
    if (cls.droppedExtraSet) notes.push({ kind: 'too_many_sets', setIds: [], text: 'No extra set: only when you ask for more.' });
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
export function nextSessionBases(source: SessionAggregate, builtIn: ReadonlyMap<string, readonly { setType: string; planned: { load: CoachTarget['load']; reps: CoachTarget['reps'] } }[]>): NextSessionBasis[] {
  const out: NextSessionBasis[] = [];
  for (const ex of source.exercises) {
    if (ex.measurement !== 'reps' || out.some((b) => b.exercise.exerciseId === ex.exerciseId)) continue;
    const working = source.sets.filter((s) => s.sessionExerciseId === ex.id && s.setType !== 'warmup' && s.pairedWithSetId === null && s.status === 'completed');
    const first = working[0];
    if (first === undefined) continue;
    const planned = working.find((s) => s.planned.load !== null || s.planned.reps !== null)?.planned ?? null;
    const top = [...working].sort((a, b) => (b.actual?.load?.value ?? 0) - (a.actual?.load?.value ?? 0))[0] ?? first;
    // Field by field: today's plan where it had one, else what the top set did.
    const last: CoachTarget = {
      load: planned?.load ?? top.actual?.load ?? null,
      reps: planned?.reps ?? (top.actual?.reps == null ? null : { min: top.actual.reps, max: top.actual.reps }),
    };
    const plan = builtIn.get(ex.exerciseId) ?? null;
    const workingPlan = plan?.filter((p) => p.setType !== 'warmup') ?? [];
    const firstPlan = workingPlan[0];
    out.push({
      exercise: ex,
      equipment: ex.equipmentId === null ? null : (source.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null),
      last,
      lastSets: working.length,
      builtIn: firstPlan === undefined ? null : { target: { load: firstPlan.planned.load, reps: firstPlan.planned.reps }, sets: workingPlan.length },
    });
  }
  return out;
}

type PlanEntry = { setType: SetType; planned: PlannedSet };

/**
 * `nextTargetsOf` with the coach's saved targets (D21): for each exercise
 * with a row that is in use (`saved`, or `applied` by Ben), not used yet and
 * set on the workout as it still is, the working sets take the coach's
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
): Map<string, PlanEntry[]> {
  const out = new Map<string, PlanEntry[]>([...builtIn].map(([k, v]) => [k, [...v]]));
  if (ctx.painToday) return out;
  for (const row of rows) {
    if (row.status !== 'saved' && row.status !== 'applied') continue;
    if (row.usedBySessionId !== null || row.sourceVersion !== source.session.version || row.sourceSessionId !== source.session.id) continue;
    if (ctx.flaggedExerciseIds.has(row.exerciseId)) continue;
    const plan = builtIn.get(row.exerciseId) ?? [];
    const warmups = plan.filter((p) => p.setType === 'warmup');
    const working = plan.filter((p) => p.setType !== 'warmup');
    const lastWorking = source.sets.filter((s) => source.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId === row.exerciseId && s.setType !== 'warmup' && s.status === 'completed' && s.pairedWithSetId === null);
    const count = row.sets ?? (working.length > 0 ? working.length : lastWorking.length);
    if (count < 1) continue;
    const template = working[0]?.planned ?? lastWorking[0]?.planned ?? null;
    const setType: SetType = working[0]?.setType ?? lastWorking[0]?.setType ?? 'working';
    const planned: PlannedSet = { load: row.target.load, reps: row.target.reps, durationS: null, rpe: template?.rpe ?? null, rir: template?.rir ?? null, source: 'coach' };
    out.set(row.exerciseId, [...warmups, ...Array.from({ length: count }, () => ({ setType, planned }))]);
  }
  return out;
}
