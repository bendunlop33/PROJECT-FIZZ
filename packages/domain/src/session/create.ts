import type {
  EquipmentInstance,
  Exercise,
  Load,
  Routine,
  SessionAggregate,
  SessionExercise,
  UserProfile,
  WorkoutSet,
  ZonedTimestamp,
} from '@fizz/schemas';
import { roundToAvailableLoad } from '../equipment';
import { resolveRestPreset } from '../rest';
import { buildExecutionOrder } from './order';

export type StartWarning =
  | { kind: 'equipment_not_in_gym'; routineExerciseId: string; equipmentId: string }
  | { kind: 'exercise_missing'; routineExerciseId: string; exerciseId: string }
  | {
      kind: 'target_rounded';
      setTemplateId: string;
      requested: Load;
      planned: Load;
      bounded: 'min' | 'max' | null;
    }
  | { kind: 'target_not_checkable'; setTemplateId: string; reason: string };

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
 * rounded toward easier to what the equipment can make (never above its max);
 * each rounding is reported so the original template target stays visible.
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
    exercises.push({
      id: sessionExerciseId,
      sessionId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      measurement: exercise.measurement,
      equipmentId: equipment?.id ?? null,
      loadConvention: equipment?.loadConvention ?? exercise.defaultLoadConvention,
      unit: equipment?.unit ?? input.owner.preferredUnit,
      order: position,
      supersetGroup: rex.supersetGroup,
      transitionRestS: rex.transitionRestS,
      progressionRuleId: rex.progressionRuleId,
    });

    rex.setTemplates.forEach((tpl, index) => {
      let plannedLoad = tpl.targetLoad;
      if (plannedLoad !== null && equipment !== null) {
        const rounded = roundToAvailableLoad(plannedLoad, equipment, 'easier');
        if (!rounded.ok) {
          warnings.push({ kind: 'target_not_checkable', setTemplateId: tpl.id, reason: rounded.reason });
        } else if (!rounded.exact) {
          warnings.push({
            kind: 'target_rounded',
            setTemplateId: tpl.id,
            requested: plannedLoad,
            planned: rounded.load,
            bounded: rounded.bounded,
          });
          plannedLoad = rounded.load;
        }
      }
      sets.push({
        id: input.newId(),
        sessionId,
        sessionExerciseId,
        index,
        setType: tpl.setType,
        status: 'pending',
        planned: {
          load: plannedLoad,
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
      processedOps: {},
      revision: 1,
    },
    warnings,
  };
}
