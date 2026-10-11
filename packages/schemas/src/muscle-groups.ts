/**
 * The 11 body-part groups and which group each muscle belongs to
 * (exercise-library §2.3; progress.md PG26). Coaching knowledge, not personal
 * data. A dependency-free leaf in `@fizz/schemas` so the domain (Progress
 * counts by group) and `@fizz/catalogue` (validator, exercise library) share
 * one table without the catalogue loading the whole domain barrel.
 */
export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Forearms',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** Each muscle maps to exactly one filter group. */
export const MUSCLE_TO_GROUP = {
  chest: 'Chest',
  upper_chest: 'Chest',
  lats: 'Back',
  upper_back: 'Back',
  traps: 'Back',
  spinal_erectors: 'Back',
  front_delts: 'Shoulders',
  side_delts: 'Shoulders',
  rear_delts: 'Shoulders',
  biceps: 'Biceps',
  brachialis: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Glutes',
  abductors: 'Glutes',
  calves: 'Calves',
  abs: 'Core',
  obliques: 'Core',
  core: 'Core',
  forearms: 'Forearms',
  grip: 'Forearms',
} as const satisfies Record<string, MuscleGroup>;

/** The group of a muscle word, or null for a word outside the vocabulary (older custom exercises may have one). */
export function muscleGroupOf(muscle: string): MuscleGroup | null {
  return Object.hasOwn(MUSCLE_TO_GROUP, muscle) ? MUSCLE_TO_GROUP[muscle as keyof typeof MUSCLE_TO_GROUP] : null;
}
