import type { CommandOf, PainFlag, PlannedSet, SessionAggregate, SetType, WeightUnit, WorkoutSet, ZonedTimestamp } from '@fizz/schemas';
import type { PainStatus } from '../progression';
import { currentGymEquipment } from './equipment-snapshot';
import { snapPlanToGym } from './snap';
import type { SubstituteSlot } from './substitutes';
import { swapSource, type SwapPlan } from './swap-plan';

/**
 * Swap an exercise mid-workout (exercise-library EL4, backlog B3: Ben's own
 * pick applies at once with Undo). Pure.
 *
 * - `midSwapSlot`: the slot the Swap sheet ranks for: the row's **pending**
 *   sets only (done and skipped sets stay where they are, rule 2). The
 *   pending other side of a half-logged left/right pair stays too: it
 *   finishes that pair on the original exercise (review gaps S1).
 * - `swapPainCarry`: pain on the row being swapped holds the substitute
 *   for today (B5, accepted 11 Oct; rule 9).
 * - `buildSwapExerciseCommand`: one new pending set per pending set, same
 *   set type, its target from the substitute's own plan (`substituteTargets`,
 *   never the original's load, GS3), fitted with the shared `snapPlanToGym`
 *   (mode `start`) on the workout's current gym (rule 4: achievable, within
 *   min/max; a load that can't be made here is left blank).
 */

/**
 * The row's sets a swap moves: pending, and not the other side of a
 * left/right pair whose first side is logged (that set completes the pair
 * on the original exercise, as a gym switch leaves it; review gaps S1).
 */
export function pendingSetsOf(state: SessionAggregate, sessionExerciseId: string): WorkoutSet[] {
  return state.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status === 'pending' && s.pairedWithSetId === null).sort((a, b) => a.index - b.index);
}

/**
 * B5 (accepted 11 Oct; rule 9; exercise-library §7 check 13): after pain on
 * an exercise, a swap to a similar one doesn't go up today. Active when the
 * row being swapped (or any row it was itself swapped from today) has an
 * active pain flag, or a logged set on it is marked `pain`. The caller plans
 * the substitute with this as its session pain, so its targets are held.
 */
export function swapPainCarry(state: SessionAggregate, sessionExerciseId: string, painFlags: readonly PainFlag[]): PainStatus {
  const chain: string[] = [];
  let id: string | undefined = sessionExerciseId;
  while (id !== undefined && !chain.includes(id)) {
    chain.push(id);
    const row = state.exercises.find((e) => e.id === id);
    id = row?.swappedFrom?.sessionExerciseId;
  }
  const rows = state.exercises.filter((e) => chain.includes(e.id));
  const flags = painFlags.filter((f) => f.status === 'active' && rows.some((r) => r.exerciseId === f.exerciseId)).sort((a, b) => (a.reportedAt.utc < b.reportedAt.utc ? -1 : 1));
  const marked = state.sets
    .filter((s) => chain.includes(s.sessionExerciseId) && s.status === 'completed' && (s.exclusions ?? []).includes('pain'))
    .sort((a, b) => ((a.completedAt?.utc ?? '') < (b.completedAt?.utc ?? '') ? -1 : 1));
  const first = flags[0]?.reportedAt.utc ?? marked[0]?.completedAt?.utc ?? null;
  return flags.length > 0 || marked.length > 0 ? { active: true, reportedAtUtc: first } : { active: false, reportedAtUtc: null };
}

/** The Swap sheet's slot for a row mid-workout: its pending sets. Null when nothing is left to swap. */
export function midSwapSlot(state: SessionAggregate, sessionExerciseId: string): SubstituteSlot | null {
  const ex = state.exercises.find((e) => e.id === sessionExerciseId);
  if (!ex || ex.removed !== undefined || state.session.status !== 'active') return null;
  const pending = pendingSetsOf(state, sessionExerciseId);
  if (pending.length === 0) return null;
  return {
    workingSets: pending.filter((s) => s.setType !== 'warmup').length,
    templates: pending.map((s) => ({ setType: s.setType, reps: s.planned.reps, durationS: s.planned.durationS })),
  };
}

/** The plan's set for the n-th pending set of this type: same type in order, else the last of that type, else the last working one. */
function planSetFor(plan: SwapPlan['plan'], setType: SetType, nth: number): PlannedSet | null {
  if (plan === null || plan.length === 0) return null;
  const same = plan.filter((p) => p.setType === setType);
  const pick = same[nth] ?? same.at(-1) ?? (setType === 'warmup' ? undefined : plan.filter((p) => p.setType !== 'warmup').at(-1));
  return pick?.planned ?? null;
}

export interface SwapCommandInput {
  aggregate: SessionAggregate;
  sessionExerciseId: string;
  /** The picked row's plan (`SubstituteRow.plan`). */
  plan: SwapPlan;
  gymName: string;
  ownerUnit: WeightUnit;
  /** Exercise IDs with an active pain flag: their loads are held (rule 9). */
  painFlagged?: ReadonlySet<string>;
  lastUsedHere?: (exerciseId: string) => string | null;
  opId: string;
  at: ZonedTimestamp;
  newId: () => string;
}

export type SwapCommandResult = { ok: true; command: CommandOf<'swap_exercise'> } | { ok: false; reason: 'nothing_pending' | 'same_exercise' | 'measurement' };

export function buildSwapExerciseCommand(input: SwapCommandInput): SwapCommandResult {
  const { aggregate: state, plan } = input;
  const ex = state.exercises.find((e) => e.id === input.sessionExerciseId);
  const pending = pendingSetsOf(state, input.sessionExerciseId);
  if (!ex || ex.removed !== undefined || pending.length === 0) return { ok: false, reason: 'nothing_pending' };
  if (plan.exercise.id === ex.exerciseId) return { ok: false, reason: 'same_exercise' };
  if (plan.exercise.measurement !== ex.measurement) return { ok: false, reason: 'measurement' };

  const seen = new Map<SetType, number>();
  const raw = pending.map((s) => {
    const nth = seen.get(s.setType) ?? 0;
    seen.set(s.setType, nth + 1);
    const p = planSetFor(plan.plan, s.setType, nth);
    // No plan of its own: the slot's sets and reps (or time, or distance) with no load (`No history`).
    const base: PlannedSet = p ?? { load: null, reps: s.planned.reps, durationS: s.planned.durationS, rpe: null, rir: null, ...(s.planned.distanceM !== undefined && s.planned.distanceM !== null ? { distanceM: s.planned.distanceM } : {}) };
    return { set: s, planned: base };
  });
  const exercise = plan.exercise;
  const snapped = snapPlanToGym({
    mode: 'start',
    slots: [
      {
        slotId: 'mid-swap',
        exercise: { id: exercise.id, name: exercise.name, compatibleEquipment: exercise.compatibleEquipment, defaultLoadConvention: exercise.defaultLoadConvention },
        sourceEquipment: state.session.gymId === null ? null : swapSource(exercise, plan.pin, state.session.gymId),
        unit: input.ownerUnit,
        convention: exercise.defaultLoadConvention,
        sets: raw.map((r) => ({ id: r.set.id, setType: r.set.setType, intended: r.planned.load, current: null, reps: r.planned.reps, durationS: r.planned.durationS })),
      },
    ],
    gym: { id: state.session.gymId ?? 'no-gym', name: input.gymName, equipment: currentGymEquipment(state.session) },
    ...(input.lastUsedHere ? { lastUsedHere: input.lastUsedHere } : {}),
    ...(input.painFlagged ? { painFlagged: input.painFlagged } : {}),
    ownerUnit: input.ownerUnit,
  });
  const slot = snapped.slots[0];
  const equipment = slot?.equipment ?? null;
  return {
    ok: true,
    command: {
      type: 'swap_exercise',
      at: input.at,
      opId: input.opId,
      sessionExerciseId: ex.id,
      expectedVersion: state.session.version,
      newSessionExerciseId: input.newId(),
      exercise: {
        exerciseId: exercise.id,
        name: exercise.name,
        measurement: exercise.measurement,
        laterality: exercise.laterality,
        defaultLoadConvention: exercise.defaultLoadConvention,
        compatibleEquipment: exercise.compatibleEquipment,
      },
      equipmentId: equipment?.id ?? null,
      unit: slot?.unit ?? input.ownerUnit,
      loadConvention: slot?.convention ?? exercise.defaultLoadConvention,
      sets: raw.map((r, i) => {
        const fitted = slot?.sets[i];
        // A dropped load (can't be made here, past the max) stays blank: Ben enters it (rule 4).
        const load = fitted === undefined || fitted.outcome === 'dropped' ? null : fitted.load;
        return { newSetId: input.newId(), fromSetId: r.set.id, planned: { ...r.planned, load } };
      }),
    },
  };
}
