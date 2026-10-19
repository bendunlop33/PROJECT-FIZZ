import type { EquipmentInstance, Exercise } from '@fizz/schemas';

/**
 * Which of a gym's items an exercise can be logged on (the exercise picker).
 *
 * Bodyweight exercises (load convention `bodyweight`, listed for a
 * `bodyweight_station` or nothing) carry no external load, so there is no
 * load to check and they never need a gym equipment instance (slice-3
 * re-review nit). The catalogue keeps listing `bodyweight_station` (push-up,
 * plank, squat and so on); the picker just doesn't attach one. That also
 * stops a push-up being attached to the gym's `Pull-up bar`. Weighted dips
 * and pull-ups log the added mass with the `added` convention, which isn't
 * affected.
 */
type ExerciseEquipmentInfo = Pick<Exercise, 'defaultLoadConvention' | 'compatibleEquipment'>;

export function needsNoEquipment(exercise: ExerciseEquipmentInfo): boolean {
  return exercise.defaultLoadConvention === 'bodyweight' && exercise.compatibleEquipment.every((k) => k === 'bodyweight_station' || k === 'erg');
}

/**
 * A cardio machine (rower, bike, treadmill; catalogue kind `erg`). Gym
 * profiles don't list these (they carry no load to check), so one never
 * needs a gym item, like a bodyweight exercise (19 Oct).
 */
export function isMachineCardio(exercise: Pick<Exercise, 'compatibleEquipment'>): boolean {
  return exercise.compatibleEquipment.length > 0 && exercise.compatibleEquipment.every((k) => k === 'erg');
}

/** Available gym items the exercise can be logged on; empty for bodyweight exercises. */
export function equipmentForExercise<T extends Pick<EquipmentInstance, 'kind' | 'availability'>>(exercise: ExerciseEquipmentInfo, gym: readonly T[]): T[] {
  if (needsNoEquipment(exercise)) return [];
  return gym.filter((e) => e.availability === 'available' && exercise.compatibleEquipment.includes(e.kind));
}

/** The picker row's subtitle: the matching items, or why there are none. */
export function pickerEquipmentLabel(exercise: ExerciseEquipmentInfo, matches: readonly Pick<EquipmentInstance, 'name'>[]): string {
  if (matches.length > 0) return matches.map((e) => e.name).join(' · ');
  if (isMachineCardio(exercise)) return 'Cardio';
  if (needsNoEquipment(exercise)) return 'Bodyweight';
  if (exercise.compatibleEquipment.length === 0) return 'No equipment needed';
  return 'Not at this gym · loads won’t be checked';
}
