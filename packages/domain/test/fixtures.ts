import {
  EquipmentInstanceSchema,
  ExerciseSchema,
  ProgressionRuleSchema,
  RoutineSchema,
  UserProfileSchema,
  type EquipmentInstance,
  type Exercise,
  type Load,
  type LoadConvention,
  type ProgressionRule,
  type Routine,
  type RoutineExercise,
  type SetTemplate,
  type SetValues,
  type UserProfile,
  type WeightUnit,
  type ZonedTimestamp,
} from '@fizz/schemas';
import { toIso, toMs } from '../src/time';

export const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function idGen(start = 10_000): () => string {
  let n = start;
  return () => id(n++);
}

export const OWNER = id(1);
export const GYM = id(2);
export const T0 = '2026-10-08T06:00:00.000Z';
export const TZ = 'Pacific/Auckland';
export const T0_MS = toMs(T0);

/** Zoned timestamp `seconds` after T0. */
export const at = (seconds = 0): ZonedTimestamp => ({ utc: toIso(T0_MS + seconds * 1000), tz: TZ });
export const ms = (seconds: number): number => T0_MS + seconds * 1000;

const meta = (n: number) => ({ id: id(n), ownerId: OWNER, version: 1, createdAtUtc: T0, updatedAtUtc: T0 });

const common = (n: number, name: string, unit: WeightUnit = 'kg') => ({
  ...meta(n),
  gymId: GYM,
  name,
  unit,
  movementTags: [],
  availability: 'available' as const,
});

export function barbell(over: Partial<Extract<EquipmentInstance, { kind: 'barbell' }>> = {}): EquipmentInstance {
  return EquipmentInstanceSchema.parse({
    ...common(100, 'Olympic bar'),
    kind: 'barbell',
    loadConvention: 'total',
    barMass: 20,
    plates: [
      { mass: 25, count: 2 },
      { mass: 20, count: 4 },
      { mass: 10, count: 2 },
      { mass: 5, count: 2 },
      { mass: 2.5, count: 2 },
      { mass: 1.25, count: 2 },
    ],
    ...over,
  });
}

export function dumbbells(over: Partial<Extract<EquipmentInstance, { kind: 'dumbbells' }>> = {}): EquipmentInstance {
  return EquipmentInstanceSchema.parse({
    ...common(101, 'Home dumbbells'),
    kind: 'dumbbells',
    loadConvention: 'per_hand',
    loads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30],
    ...over,
  });
}

export function stack(over: Partial<Extract<EquipmentInstance, { kind: 'weight_stack' }>> = {}): EquipmentInstance {
  return EquipmentInstanceSchema.parse({
    ...common(102, 'Cable stack'),
    kind: 'weight_stack',
    loadConvention: 'stack',
    stackLoads: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    addOns: [],
    ...over,
  });
}

export function assisted(over: Partial<Extract<EquipmentInstance, { kind: 'assisted_stack' }>> = {}): EquipmentInstance {
  return EquipmentInstanceSchema.parse({
    ...common(103, 'Assisted pull-up'),
    kind: 'assisted_stack',
    loadConvention: 'assistance',
    assistanceLoads: [5, 10, 15, 20, 25, 30, 35, 40],
    ...over,
  });
}

export function plateMachine(
  over: Partial<Extract<EquipmentInstance, { kind: 'plate_loaded_machine' }>> = {},
): EquipmentInstance {
  return EquipmentInstanceSchema.parse({
    ...common(104, 'Leg press'),
    kind: 'plate_loaded_machine',
    loadConvention: 'added',
    loadingSides: 2,
    plates: [
      { mass: 20, count: 6 },
      { mass: 10, count: 2 },
    ],
    ...over,
  });
}

export function bodyweightStation(): EquipmentInstance {
  return EquipmentInstanceSchema.parse({
    ...common(105, 'Dip station'),
    kind: 'bodyweight_station',
    loadConvention: 'bodyweight',
  });
}

export function profile(over: Partial<UserProfile> = {}): UserProfile {
  return UserProfileSchema.parse({
    ...meta(1),
    timezone: TZ,
    preferredUnit: 'kg',
    defaultRest: { seconds: 90, presetName: 'Standard' },
    restPresets: [
      { seconds: 60, presetName: 'Warm-up' },
      { seconds: 90, presetName: 'Standard' },
      { seconds: 180, presetName: 'Heavy' },
    ],
    effortScale: 'rpe',
    ...over,
  });
}

export function exercise(n: number, name: string, over: Partial<Exercise> = {}): Exercise {
  return ExerciseSchema.parse({
    id: id(n),
    ownerId: null,
    source: 'catalogue',
    name,
    movementPattern: 'push',
    primaryMuscles: [],
    measurement: 'reps',
    laterality: 'bilateral',
    compatibleEquipment: ['barbell'],
    defaultLoadConvention: 'total',
    version: 1,
    createdAtUtc: T0,
    updatedAtUtc: T0,
    ...over,
  });
}

export const kg = (value: number, convention: LoadConvention = 'total'): Load => ({ value, unit: 'kg', convention });
export const lb = (value: number, convention: LoadConvention = 'total'): Load => ({ value, unit: 'lb', convention });

export function template(n: number, over: Partial<SetTemplate> = {}): SetTemplate {
  return {
    id: id(n),
    setType: 'working',
    targetLoad: null,
    targetReps: { min: 6, max: 8 },
    targetDurationS: null,
    targetRpe: null,
    targetRir: null,
    restOverrideS: null,
    ...over,
  };
}

export function routineExercise(n: number, over: Partial<RoutineExercise> & { exerciseId: string }): RoutineExercise {
  return {
    id: id(n),
    equipmentId: null,
    order: 0,
    supersetGroup: null,
    setTemplates: [template(n * 10)],
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
    ...over,
  };
}

export function routine(exercises: RoutineExercise[]): Routine {
  return RoutineSchema.parse({ ...meta(300), name: 'Push A', exercises });
}

export function values(load: Load | null, reps: number | null, over: Partial<SetValues> = {}): SetValues {
  return { load, reps, durationS: null, rpe: null, rir: null, ...over };
}

export function doubleProgression(over: Partial<Extract<ProgressionRule, { method: 'double_progression' }>> = {}): ProgressionRule {
  return ProgressionRuleSchema.parse({
    ...meta(400),
    name: 'Double progression 6–8',
    method: 'double_progression',
    repRange: { min: 6, max: 8 },
    workingSets: 3,
    loadIncrement: { value: 2.5, unit: 'kg' },
    startingLoad: null,
    failuresBeforeReduce: 2,
    reducePercent: 10,
    maxLoadJump: null,
    maxRpeToProgress: 9,
    minRirToProgress: null,
    ceilingRepCap: 12,
    ...over,
  });
}

export function topSetBackoff(over: Partial<Extract<ProgressionRule, { method: 'top_set_backoff' }>> = {}): ProgressionRule {
  return ProgressionRuleSchema.parse({
    ...meta(401),
    name: 'Top set + back-off',
    method: 'top_set_backoff',
    topSet: { repRange: { min: 3, max: 5 }, maxRpeToProgress: 9, minRirToProgress: null },
    backoff: { sets: 2, percentOfTop: 90, repRange: { min: 6, max: 8 } },
    loadIncrement: { value: 2.5, unit: 'kg' },
    startingLoad: null,
    failuresBeforeReduce: 2,
    reducePercent: 10,
    maxLoadJump: null,
    ceilingRepCap: 8,
    ...over,
  });
}
