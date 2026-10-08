import type {
  CommandOf,
  EquipmentInstance,
  Exercise,
  Load,
  LoadConvention,
  Routine,
  SessionAggregate,
  SessionExercise,
  UserProfile,
  WorkoutSet,
  WeightUnit,
  ZonedTimestamp,
} from '@fizz/schemas';
import { isLoadAchievable, roundToAvailableLoad } from '../equipment';
import { convertMassExactly } from '../units';
import { resolveRestPreset } from '../rest';
import { buildExecutionOrder } from './order';

export type StartWarning =
  | { kind: 'equipment_not_in_gym'; routineExerciseId: string; equipmentId: string }
  | { kind: 'exercise_missing'; routineExerciseId: string; exerciseId: string }
  | {
      /** The planned load differs from the template (rounded, bounded, or converted to the equipment's unit). */
      kind: 'target_rounded';
      setTemplateId: string;
      requested: Load;
      planned: Load;
      bounded: 'min' | 'max' | null;
      converted: boolean;
    }
  | {
      /**
       * The template load can't be used here, so the set has no planned load and
       * the draft falls back to history or stays empty. `requested` keeps the
       * template target visible.
       */
      kind: 'target_dropped';
      setTemplateId: string;
      requested: Load;
      reason: 'convention_mismatch' | 'unit_not_convertible' | 'no_achievable_loads';
    };

export type PlannedLoadResult =
  | { load: Load | null; warning: null }
  | { load: Load | null; warning: Extract<StartWarning, { kind: 'target_rounded' | 'target_dropped' }> };

/**
 * Normalise a template load to the session exercise's unit and convention
 * (review B1, ADR 0003). Every non-null result is in exactly that unit and
 * convention, so the prefilled one-tap Log is always accepted.
 * - Convention differs: never converted (no machine-to-free-weight equivalence); dropped.
 * - Equipment present: rounded toward easier to an achievable load, converting
 *   units explicitly; the rounded load is used even on an exact hit.
 * - No equipment, unit differs: converted only if exact at display precision; otherwise dropped.
 */
export function planTemplateLoad(
  setTemplateId: string,
  target: Load | null,
  session: { unit: WeightUnit; convention: LoadConvention; equipment: EquipmentInstance | null },
): PlannedLoadResult {
  if (target === null) return { load: null, warning: null };
  const drop = (reason: Extract<StartWarning, { kind: 'target_dropped' }>['reason']): PlannedLoadResult => ({
    load: null,
    warning: { kind: 'target_dropped', setTemplateId, requested: target, reason },
  });
  if (target.convention !== session.convention) return drop('convention_mismatch');

  const eq = session.equipment;
  if (eq === null) {
    if (target.unit === session.unit) return { load: target, warning: null };
    const converted = convertMassExactly(target, session.unit);
    if (converted === null) return drop('unit_not_convertible');
    const planned: Load = { value: converted.value, unit: session.unit, convention: target.convention };
    return {
      load: planned,
      warning: { kind: 'target_rounded', setTemplateId, requested: target, planned, bounded: null, converted: true },
    };
  }

  if (isLoadAchievable(target, eq)) return { load: target, warning: null };
  const rounded = roundToAvailableLoad(target, eq, 'easier');
  if (!rounded.ok) return drop(rounded.reason === 'convention_mismatch' ? 'convention_mismatch' : 'no_achievable_loads');
  return {
    load: rounded.load,
    warning: {
      kind: 'target_rounded',
      setTemplateId,
      requested: target,
      planned: rounded.load,
      bounded: rounded.bounded,
      converted: rounded.convertedRequest !== null,
    },
  };
}

export interface StartWorkoutInput {
  opId: string;
  owner: UserProfile;
  gymId: string;
  /** Null for an empty workout. */
  routine: Routine | null;
  exercises: ReadonlyMap<string, Exercise>;
  /** Confirmed equipment of the selected gym, snapshotted into the session. */
  gymEquipment: readonly EquipmentInstance[];
  at: ZonedTimestamp;
  /** Injected ID generator (UUIDs in the app; deterministic in tests). */
  newId: () => string;
}

export interface StartWorkoutOutput {
  aggregate: SessionAggregate;
  warnings: StartWarning[];
}

/**
 * Snapshot a routine and the gym's equipment into a new resumable session.
 * Rest durations are resolved and snapshotted per set. Planned loads are
 * normalised to the session exercise's unit and convention by
 * `planTemplateLoad` (rounded toward easier, never above the max); every
 * change is reported so the original template target stays visible.
 * Missing equipment does not block logging; it is reported as a warning.
 */
export function startWorkout(input: StartWorkoutInput): StartWorkoutOutput {
  const sessionId = input.newId();
  const warnings: StartWarning[] = [];
  const equipmentById = new Map(input.gymEquipment.map((e) => [e.id, e]));
  const exercises: SessionExercise[] = [];
  const sets: WorkoutSet[] = [];

  const routineExercises = input.routine ? [...input.routine.exercises].sort((a, b) => a.order - b.order) : [];
  routineExercises.forEach((rex, position) => {
    const exercise = input.exercises.get(rex.exerciseId);
    if (!exercise) {
      warnings.push({ kind: 'exercise_missing', routineExerciseId: rex.id, exerciseId: rex.exerciseId });
      return;
    }
    let equipment: EquipmentInstance | null = null;
    if (rex.equipmentId !== null) {
      equipment = equipmentById.get(rex.equipmentId) ?? null;
      if (!equipment || equipment.availability === 'retired') {
        equipment = null;
        warnings.push({ kind: 'equipment_not_in_gym', routineExerciseId: rex.id, equipmentId: rex.equipmentId });
      }
    }
    const sessionExerciseId = input.newId();
    const loadConvention = equipment?.loadConvention ?? exercise.defaultLoadConvention;
    const unit = equipment?.unit ?? input.owner.preferredUnit;
    exercises.push({
      id: sessionExerciseId,
      sessionId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      measurement: exercise.measurement,
      equipmentId: equipment?.id ?? null,
      loadConvention,
      unit,
      order: position,
      supersetGroup: rex.supersetGroup,
      transitionRestS: rex.transitionRestS,
      progressionRuleId: rex.progressionRuleId,
    });

    rex.setTemplates.forEach((tpl, index) => {
      const planned = planTemplateLoad(tpl.id, tpl.targetLoad, { unit, convention: loadConvention, equipment });
      if (planned.warning) warnings.push(planned.warning);
      sets.push({
        id: input.newId(),
        sessionId,
        sessionExerciseId,
        index,
        setType: tpl.setType,
        status: 'pending',
        planned: {
          load: planned.load,
          reps: tpl.targetReps,
          durationS: tpl.targetDurationS,
          rpe: tpl.targetRpe,
          rir: tpl.targetRir,
        },
        rest: resolveRestPreset({
          setType: tpl.setType,
          exerciseName: exercise.name,
          setOverrideS: tpl.restOverrideS,
          routineSetTypePreset: rex.restBySetType[tpl.setType] ?? null,
          exerciseDefaultS: exercise.defaultRestS ?? null,
          globalDefault: input.owner.defaultRest,
        }),
        actual: null,
        draft: null,
        completedAt: null,
        completedByOpId: null,
        undoCount: 0,
        flags: [],
        edited: false,
        version: 1,
      });
    });
  });

  const order = buildExecutionOrder(exercises, sets);
  return {
    aggregate: {
      session: {
        id: sessionId,
        ownerId: input.owner.id,
        routineId: input.routine?.id ?? null,
        routineName: input.routine?.name ?? null,
        gymId: input.gymId,
        startOperationId: input.opId,
        status: 'active',
        source: 'manual',
        startedAt: input.at,
        endedAt: null,
        version: 1,
        activeSetId: order[0] ?? null,
        equipmentSnapshot: [...input.gymEquipment],
        pause: null,
        pausedTotalMs: 0,
        lastActivityAtUtc: input.at.utc,
      },
      exercises,
      sets,
      restTimer: null,
      workInterval: null,
      audit: [],
      timingAudit: [],
      processedOps: {},
      revision: 1,
    },
    warnings,
  };
}

export interface AddExerciseInput {
  opId: string;
  owner: UserProfile;
  exercise: Exercise;
  /** Must be in the session's equipment snapshot; null = no equipment. */
  equipmentId: string | null;
  at: ZonedTimestamp;
  newId: () => string;
}

/**
 * Build an `add_exercise` command from catalogue and profile data, so the
 * reducer (which has no catalogue access) gets a trustworthy snapshot. Rest
 * after the first set is resolved with the usual order (exercise default,
 * then global default).
 */
export function buildAddExerciseCommand(input: AddExerciseInput): CommandOf<'add_exercise'> {
  const { exercise } = input;
  return {
    type: 'add_exercise',
    at: input.at,
    opId: input.opId,
    newSessionExerciseId: input.newId(),
    newSetId: input.newId(),
    exercise: {
      exerciseId: exercise.id,
      name: exercise.name,
      measurement: exercise.measurement,
      laterality: exercise.laterality,
      defaultLoadConvention: exercise.defaultLoadConvention,
    },
    equipmentId: input.equipmentId,
    unit: input.owner.preferredUnit,
    rest: resolveRestPreset({
      setType: 'working',
      exerciseName: exercise.name,
      setOverrideS: null,
      routineSetTypePreset: null,
      exerciseDefaultS: exercise.defaultRestS ?? null,
      globalDefault: input.owner.defaultRest,
    }),
  };
}
