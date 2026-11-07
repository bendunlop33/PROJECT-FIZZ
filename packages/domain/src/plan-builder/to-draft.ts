import type { BuildFocus, DraftLoad, DraftSetTemplate, DraftSlot, PlanBuilderAnswers, PlanDayDraft, PlanDraft, PlanDraftVersion, ZonedTimestamp } from '@fizz/schemas';
import { catalogueExerciseId } from '../catalogue-id';
import { deriveId } from '../stable';
import { newPlanDraft } from '../session/coach-plan';
import type { PbDay, PbExercise, PbPlan } from './engine';
import { fmt, type PlanKit } from './loads';
import type { PbKitOf } from './lifts';
import type { PbDayType } from './tables';

/**
 * A built plan as the app's plan model (plan-builder.md §4): one `PlanDraftVersion` whose days are checked
 * `DraftPlan`s, written through the same lifecycle as a coach plan (`newPlanDraft`, then `applyPlan` / `undoPlanApply`
 * / `endPlan`), so Undo, versioning and stale rejection (rule 5) are the same. Week-1 loads are stored as `plan` loads
 * (`Plan, week 1`), estimates flagged (rule 6); the routines Apply makes carry no loads of their own, so after the
 * first workout each day follows what Ben lifted. Pure.
 */

/** Builder days' split-day IDs: Profile's preset IDs where they match, else the day type's own. */
const DAY_ID: Readonly<Record<PbDayType, string>> = { Push: 'push', Pull: 'pull', Legs: 'legs', Upper: 'upper', Lower: 'lower', 'Full body': 'full_body', Chest: 'chest', Back: 'back', Shoulders: 'shoulders', Arms: 'arms' };
const DAY_FOCUS: Readonly<Record<PbDayType, BuildFocus>> = { Push: 'push', Pull: 'pull', Legs: 'legs', Upper: 'upper', Lower: 'lower', 'Full body': 'full_body', Chest: 'chest', Back: 'back', Shoulders: 'shoulders', Arms: 'coach_picks' };

export const pbDayName = (d: Pick<PbDay, 'focus' | 'variant'>): string => `${d.focus}${d.variant === null ? '' : ` ${d.variant}`}`;

/** The RPE the plan's sets aim at (top and back-offs @ 8, the builder's rule; accessories the same). */
export const PB_TARGET_RPE = 8;

function planLoad(value: number, kit: PlanKit, basis: string | null, estimate: boolean): DraftLoad {
  return {
    load: { value, unit: kit.unit, convention: kit.convention },
    source: 'plan',
    basis: basis === null ? null : basis.slice(0, 80),
    basisFromCoach: false,
    held: false,
    notes: [],
    notUsed: null,
    ...(estimate ? { estimate: true as const } : {}),
  };
}

function accRange(reps: number): { min: number; max: number } {
  return reps <= 12 ? { min: Math.min(reps, 8), max: 12 } : { min: 12, max: 15 };
}

function slotOf(e: PbExercise, order: number, slotKey: string, group: string | null, kitOf: PbKitOf): DraftSlot {
  const k = kitOf(e.key);
  const kit = k === null || k === 'bodyweight' ? null : k;
  const t: DraftSetTemplate[] = [];
  if (e.role === 'main' && e.main !== null && kit !== null) {
    const m = e.main;
    for (const w of m.warmup) t.push({ setType: 'warmup', reps: { min: w.reps, max: w.reps }, durationS: null, targetRpe: null, restS: null });
    const basis = m.start?.from?.kind === 'similar' ? 'Similar lift (est.)' : m.light ? 'A step lighter' : null;
    t.push({ setType: 'top', reps: { min: m.reps, max: m.reps }, durationS: null, targetRpe: PB_TARGET_RPE, restS: null, ...(m.top === null ? {} : { load: planLoad(m.top, kit, basis, m.estimate) }) });
    for (let i = 0; i < m.backs; i += 1) t.push({ setType: 'backoff', reps: { min: m.backReps, max: m.backReps }, durationS: null, targetRpe: PB_TARGET_RPE, restS: null, ...(m.back === null ? {} : { load: planLoad(m.back, kit, null, m.estimate) }) });
  } else {
    const reps = e.role === 'main' ? { min: e.reps, max: e.reps } : accRange(e.reps);
    const load = e.load.kind === 'kg' && kit !== null ? planLoad(e.load.value, kit, null, false) : null;
    for (let i = 0; i < Math.max(1, Math.min(10, e.sets)); i += 1) t.push({ setType: 'working', reps, durationS: null, targetRpe: PB_TARGET_RPE, restS: null, ...(load === null ? {} : { load }) });
  }
  return {
    slotKey,
    exerciseId: catalogueExerciseId(e.key),
    catalogueId: e.key,
    order,
    main: e.role === 'main',
    supersetGroup: group,
    setTemplates: t,
    checkedOn: kit === null ? null : { equipmentId: kit.equipmentId, kind: kit.kind, convention: kit.convention, unit: kit.unit, barKg: kit.barMass },
  };
}

/** A day's exercises in order, each superset's two members side by side (adjacent members share a letter). */
function inOrder(d: PbDay): PbExercise[] {
  const out: PbExercise[] = [];
  for (const e of d.exercises) {
    if (out.includes(e)) continue;
    out.push(e);
    const pair = e.pair;
    if (pair?.endsWith('1') === true) {
      const mate = d.exercises.find((x) => x.pair === `${pair.slice(0, 1)}2`);
      if (mate !== undefined && !out.includes(mate)) out.push(mate);
    }
  }
  return out;
}

export function pbDayDrafts(plan: PbPlan, answers: Pick<PlanBuilderAnswers, 'minutes'>, kitOf: PbKitOf, seed: string): PlanDayDraft[] {
  return plan.days.flatMap((d): PlanDayDraft[] => {
    const list = inOrder(d);
    if (list.length === 0) return [];
    const slots = list.map((e, i) => slotOf(e, i, deriveId(`pb-slot:${seed}:${String(d.index)}:${e.key}`), e.pair === null ? null : e.pair.slice(0, 1), kitOf));
    return [{ index: d.index, name: pbDayName(d).slice(0, 30), splitDayId: DAY_ID[d.focus], focus: DAY_FOCUS[d.focus], minutes: answers.minutes, plan: { slots }, checks: [] }];
  });
}

export interface PbDraftInput {
  plan: PbPlan;
  answers: PlanBuilderAnswers;
  kitOf: PbKitOf;
  ownerId: string;
  gymId: string | null;
  equipmentVersion: string;
  /** The Build tap's op ID: the plan's ID follows from it, so a retry finds the same plan. */
  opId: string;
  at: ZonedTimestamp;
}

/** The plan's ID for a Build: from its op ID. */
export const pbPlanIdFor = (opId: string): string => deriveId(`plan-builder:${opId}`);

/**
 * One builder version of plan `planId`. Slot keys follow from the plan's ID, the day and the exercise, so the same
 * answers and records give the same days (a rebuild that changes nothing is seen as no change).
 */
export function pbPlanVersion(input: Omit<PbDraftInput, 'ownerId'> & { planId: string }): PlanDraftVersion {
  const days = pbDayDrafts(input.plan, input.answers, input.kitOf, input.planId);
  if (days.length === 0) throw new Error('A plan needs at least one day');
  const startReps = pbStartReps(input.plan, input.planId);
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: deriveId(`plan-builder-action:${input.opId}`),
    turnId: 'plan-builder',
    request: { text: '', gymId: input.gymId, origin: 'builder' },
    rawArgs: '',
    days,
    checks: [],
    rationale: null,
    contextHash: 'plan-builder',
    equipmentVersion: input.equipmentVersion.slice(0, 128) || 'none',
    createdAt: input.at,
    builder: { engine: 1, answers: input.answers, gymId: input.gymId, ...(Object.keys(startReps).length === 0 ? {} : { startReps }) },
  };
}

/** (Ben, 23 Oct: plan length = block 1) Each accessory slot's week-1 reps, by slot key (the weekly progression's start). */
export function pbStartReps(plan: PbPlan, seed: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of plan.days) {
    for (const e of d.exercises) {
      if (e.role === 'main') continue;
      out[deriveId(`pb-slot:${seed}:${String(d.index)}:${e.key}`)] = Math.max(1, Math.min(50, Math.round(e.reps)));
    }
  }
  return out;
}

/** A new open plan (not applied) from a built plan. Apply and Undo are the plan model's own. */
export function pbNewPlanDraft(input: PbDraftInput): PlanDraft {
  const planId = pbPlanIdFor(input.opId);
  return newPlanDraft({ id: planId, ownerId: input.ownerId, version: pbPlanVersion({ ...input, planId }), opId: input.opId, at: input.at });
}

/** Whether two versions plan the same days (a rebuild that changed nothing writes nothing). */
export function pbSameDays(a: Pick<PlanDraftVersion, 'days'>, b: Pick<PlanDraftVersion, 'days'>): boolean {
  return JSON.stringify(a.days) === JSON.stringify(b.days);
}

/** A row's load as the day view shows it (`100`, `24 each`). */
export function pbLoadText(e: PbExercise): string {
  if (e.load.kind === 'bodyweight') return 'BW';
  if (e.load.kind === 'none') return '—';
  return `${fmt(e.load.value)}${e.load.convention === 'per_hand' ? ' each' : ''}`;
}
