import type { EquipmentInstance, Exercise, PlannedSet, SetType } from '@fizz/schemas';
import { EQUIPMENT_WORD } from '../display';
import { needsNoEquipment } from '../exercise-equipment';
import { deriveId } from '../stable';
import type { SnapSource } from './snap';
import type { RuleReps } from '../rep-range';

/**
 * A swapped slot's plan (`substituteTargets`): the substitute exercise, the
 * item its targets were worked out on (`pin`, from its own history; null with
 * none), and its planned sets (null: no comparable history, so the slot's
 * own sets and reps with no load).
 */
export interface SwapPlan {
  exercise: Exercise;
  pin: EquipmentInstance | null;
  plan: readonly { setType: SetType; planned: PlannedSet }[] | null;
  /** (Reps from history, 21 Oct) The built-in rule's reps for the exercise (`NextTargets.reps`), when it ran. */
  ruleReps?: RuleReps;
}

/** The pin ID a swap with no history starts from: no item, so the shared fit maps one by the exercise's kinds (GS3). */
export function swapPinId(exercise: Pick<Exercise, 'id'>): string {
  return deriveId(`today-swap-pin:${exercise.id}`);
}

/**
 * The equipment a swapped slot is planned from, as `startWorkout` resolves
 * its pin (the same shape, so the Swap sheet's fit equals Start's): the
 * history's item, else the exercise's first kind with no item (mapped at the
 * gym by kind), else none.
 */
export function swapSource(exercise: Pick<Exercise, 'id' | 'compatibleEquipment' | 'defaultLoadConvention'>, pin: EquipmentInstance | null, gymId: string): SnapSource | null {
  if (pin !== null) return { id: pin.id, kind: pin.kind, name: pin.name, gymId: pin.gymId };
  if (needsNoEquipment(exercise)) return null;
  const kind = exercise.compatibleEquipment[0];
  if (kind === undefined) return null;
  return { id: swapPinId(exercise), kind, name: kind in EQUIPMENT_WORD ? EQUIPMENT_WORD[kind as EquipmentInstance['kind']] : 'Equipment', gymId };
}

/** The pin a swapped routine slot carries into the planner (`RoutineExercise.equipmentId`). */
export function swapEquipmentId(sp: SwapPlan): string | null {
  if (sp.pin !== null) return sp.pin.id;
  if (needsNoEquipment(sp.exercise) || sp.exercise.compatibleEquipment.length === 0) return null;
  return swapPinId(sp.exercise);
}

