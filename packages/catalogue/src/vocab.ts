/**
 * Fixed catalogue vocabularies (research exercise-bank-and-visuals §4.3,
 * exercise-library §2.3). Catalogue entries may only use these values; the
 * validator rejects anything else. Add a value here (and to the spec) before
 * using it in an entry.
 */
import { z } from 'zod';

/** Muscle filter groups shown as chips in the exercise library (11 groups). */
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

export type Muscle = keyof typeof MUSCLE_TO_GROUP;
export const MUSCLES = Object.keys(MUSCLE_TO_GROUP) as [Muscle, ...Muscle[]];
export const MuscleSchema = z.enum(MUSCLES);

export const MOVEMENT_PATTERNS = [
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'squat',
  'hinge',
  'lunge',
  'carry',
  'core',
  'arms',
  'calves',
  'conditioning',
] as const;
export const MovementPatternSchema = z.enum(MOVEMENT_PATTERNS);
export type MovementPattern = z.infer<typeof MovementPatternSchema>;

/** What a gym must have; an entry needs all listed stations (batch-01 reading). */
export const STATIONS = [
  'rack',
  'bench',
  'incline_bench',
  'pullup_bar',
  'dip_station',
  'cable_column',
  'specific_machine',
  'sled_track',
  'wall_target',
] as const;
export const StationSchema = z.enum(STATIONS);
export type Station = z.infer<typeof StationSchema>;

/** Licences we may copy record fields from (research §1.1, recommendation 2). */
export const LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0'] as const;
export const LicenceSchema = z.enum(LICENCES);
export type Licence = z.infer<typeof LicenceSchema>;

/** Variant groups. Free-form snake_case so a new family needs no code change. */
export const FamilySchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, { message: 'Families are lower-case snake_case' });

/**
 * The load convention each equipment kind normally implies. Used only for a
 * validator warning when an entry's `defaultLoadConvention` disagrees.
 */
export const USUAL_CONVENTIONS = {
  barbell: ['total'],
  plate_loaded_machine: ['added'],
  dumbbells: ['per_hand'],
  weight_stack: ['stack'],
  assisted_stack: ['assistance'],
  bodyweight_station: ['bodyweight', 'added'],
  kettlebell: ['per_hand', 'total'],
  sled: ['added'],
  erg: ['bodyweight'],
  medicine_ball: ['total'],
  sandbag: ['total'],
  band: ['bodyweight'],
  ez_bar: ['total'],
  trap_bar: ['total'],
} as const;
