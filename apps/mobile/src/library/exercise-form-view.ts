import { checkCustomExerciseFields, CONVENTION_WORD, conventionsFor, CUSTOM_EQUIPMENT, EXERCISE_EQUIPMENT_WORD, GROUP_MUSCLE, MEASUREMENT_WORD } from '@fizz/domain';
import { MUSCLE_GROUPS, muscleGroupOf, type CustomExerciseFields, type ExerciseEquipmentKind, type Measurement, type MuscleGroup } from '@fizz/schemas';

/**
 * Library › ＋ New exercise and Edit (exercise-library §2.6; Ben, 19 Oct).
 * Pure: the form's copy, its choices and its edits. Values and actions only
 * (minimal UI copy, 10 Oct); the checks are the domain's.
 */

export const EXERCISE_FORM_COPY = {
  newTitle: 'New exercise',
  editTitle: 'Edit exercise',
  name: 'Name',
  equipment: 'Equipment',
  load: 'Load',
  muscles: 'Muscles',
  measured: 'Measured by',
  sides: 'Sides',
  both: 'Both together',
  each: 'Each side',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete exercise',
  deleteConfirm: (name: string) => `Delete ${name}?`,
  useIt: 'Use it ›',
  locked: 'Locked',
  newExercise: 'New exercise',
  createNamed: (q: string) => `Create “${q}”`,
} as const;

/** The form's fields as edited (muscles may be empty until one is picked). */
export type ExerciseFormFields = Omit<CustomExerciseFields, 'primaryMuscles'> & { primaryMuscles: CustomExerciseFields['primaryMuscles'][number][] };

export function newFormFields(name = ''): ExerciseFormFields {
  return { name: name.trim().slice(0, 80), equipment: 'barbell', loadConvention: 'total', primaryMuscles: [], measurement: 'reps', laterality: 'bilateral' };
}

export const equipmentOptions = (): { key: ExerciseEquipmentKind; label: string }[] => CUSTOM_EQUIPMENT.map((c) => ({ key: c.kind, label: EXERCISE_EQUIPMENT_WORD[c.kind] }));

export const loadOptions = (kind: ExerciseEquipmentKind) => conventionsFor(kind).map((c) => ({ key: c, label: CONVENTION_WORD[c] }));

export const measuredOptions = (): { key: Measurement; label: string }[] => (['reps', 'duration', 'distance', 'cardio'] as const).map((m) => ({ key: m, label: MEASUREMENT_WORD[m] }));

export const muscleOptions = (): { key: MuscleGroup; label: MuscleGroup }[] => MUSCLE_GROUPS.map((g) => ({ key: g, label: g }));

/** The groups the fields' muscles are in (what the chips show selected). */
export function selectedGroups(f: Pick<ExerciseFormFields, 'primaryMuscles'>): MuscleGroup[] {
  return [...new Set(f.primaryMuscles.flatMap((m) => muscleGroupOf(m) ?? []))];
}

/** A new equipment keeps the load choice when it fits, else takes the equipment's usual one. */
export function withEquipment(f: ExerciseFormFields, kind: ExerciseEquipmentKind): ExerciseFormFields {
  const fits = conventionsFor(kind);
  return { ...f, equipment: kind, loadConvention: fits.includes(f.loadConvention) ? f.loadConvention : (fits[0] ?? 'total'), ...(kind === 'erg' ? { measurement: 'cardio' as const } : {}) };
}

/** A muscle chip: on (at most 3) or off. An existing muscle in that group is kept as it was. */
export function toggledMuscle(f: ExerciseFormFields, group: MuscleGroup): ExerciseFormFields {
  const inGroup = f.primaryMuscles.filter((m) => muscleGroupOf(m) === group);
  if (inGroup.length > 0) return { ...f, primaryMuscles: f.primaryMuscles.filter((m) => muscleGroupOf(m) !== group) };
  if (selectedGroups(f).length >= 3) return f;
  return { ...f, primaryMuscles: [...f.primaryMuscles, GROUP_MUSCLE[group]] };
}

/** Save is on when the domain's checks pass. */
export function canSaveForm(f: ExerciseFormFields): boolean {
  return checkCustomExerciseFields(f).ok;
}
