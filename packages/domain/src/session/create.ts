import type {
  CommandOf,
  EquipmentInstance,
  Exercise,
  Load,
  LoadConvention,
  PlannedSet,
  Routine,
  SessionAggregate,
  SessionCheckIn,
  SessionExercise,
  SetType,
  SnapReason,
  UserProfile,
  WorkoutSet,
  WeightUnit,
  ZonedTimestamp,
} from '@fizz/schemas';
import { EQUIPMENT_WORD } from '../display';
import { isLoadAchievable, roundToAvailableLoad } from '../equipment';
import { convertMassExactly } from '../units';
import { resolveRestPreset } from '../rest';
import { planTargetProvenance } from '../target-provenance';
import { buildExecutionOrder } from './order';
import { plannedSnapOf, snapPlanToGym, type SnapResult, type SnapSlotInput, type SnapSource } from './snap';

export type StartWarning =
  | {
      kind: 'equipment_not_in_gym';
      routineExerciseId: string;
      equipmentId: string;
      /**
       * This gym's available item of the same kind used instead (targets are
       * snapped and capped to it, the same rule as Repeat), or null when this
       * gym has none and the load targets are dropped.
       */
      substituteId: string | null;
    }
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
      /**
       * `equipment_not_in_gym`: the routine names equipment this gym doesn't
       * have (or has retired) and nothing here can stand in for it, so
       * there's nothing to check the load on (rule 4; the same rule as
       * Repeat, review slice-3 B1). The other reasons are `snapPlanToGym`'s.
       */
      reason: StartDropReason;
    };

/** Why a start (or Repeat) target was dropped: `snapPlanToGym`'s reasons, with `not_here` named for the routine's item. */
export type StartDropReason = Exclude<SnapReason, 'not_here'> | 'equipment_not_in_gym';

/** The fit's drop reason as a start warning reports it. */
export function startDropReason(reason: SnapReason | undefined): StartDropReason {
  if (reason === undefined) return 'no_achievable_loads';
  return reason === 'not_here' ? 'equipment_not_in_gym' : reason;
}

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
  /**
   * The equipment records the routine names (from any gym), so an item this gym
   * doesn't have is mapped to this gym's equipment by kind (`snapPlanToGym`
   * GS3; routines.md §2.2 "Targets will be capped"). Looked up before
   * `knownEquipment`; a pin found in neither is mapped by the exercise's kinds.
   */
  routineEquipment?: ReadonlyMap<string, EquipmentInstance>;
  at: ZonedTimestamp;
  /** Injected ID generator (UUIDs in the app; deterministic in tests). */
  newId: () => string;
  /**
   * The pre-workout check-in outcome, stored on the session in the same write
   * (check-in.md §6 `startWorkout(…, opts.checkIn)`). Omitted = not recorded.
   */
  checkIn?: SessionCheckIn | null;
  /**
   * Items a routine may be pinned to that aren't at this gym (the owner's
   * equipment at other gyms), so the pin can be mapped by kind (gym-switch
   * GS3). A pin that isn't known at all is mapped by the exercise's kinds.
   */
  knownEquipment?: ReadonlyMap<string, EquipmentInstance>;
  /** The gym's name, for notes. */
  gymName?: string;
  /** GS3 step 2: the item an exercise last used at this gym. */
  lastUsedHere?: (exerciseId: string) => string | null;
}

export interface StartWorkoutOutput {
  aggregate: SessionAggregate;
  warnings: StartWarning[];
  /** The shared fit (`snapPlanToGym`, mode `start` or `repeat`); slot IDs are routine exercise IDs, set IDs template IDs. */
  snap: SnapResult;
  /** The template each planned set came from (set ID → set template ID). */
  setTemplateIds: Record<string, string>;
}

function sourceFor(equipment: EquipmentInstance): SnapSource {
  return { id: equipment.id, kind: equipment.kind, name: equipment.name, gymId: equipment.gymId };
}

/**
 * Snapshot a routine and the gym's equipment into a new resumable session.
 * Rest durations are resolved and snapshotted per set. Every target goes
 * through `snapPlanToGym` (gym-switch GS1): the pinned item is mapped to this
 * gym's equipment (same item, else same kind, else another kind the exercise
 * lists, else none), and each load is rounded toward easier to what that
 * item can make, never above its max. An equipped plan with no equipment
 * here gets no load target, reps kept (closes the routine-start gap, §6.6).
 * Every fit is stored on the set (`planned.snap`) and reported as a warning.
 * Every set with a target records where it came from (`planned.provenance`,
 * source `plan`, with any fit or drop as a guard note) for `Why?`.
 */
export function startWorkout(input: StartWorkoutInput): StartWorkoutOutput {
  return startWorkoutWithMode(input, 'start');
}

/** `startWorkout` for Repeat too, so both fit loads by the same code (GS1). */
export function startWorkoutWithMode(input: StartWorkoutInput, mode: 'start' | 'repeat'): StartWorkoutOutput {
  const sessionId = input.newId();
  const warnings: StartWarning[] = [];
  const equipmentById = new Map(input.gymEquipment.map((e) => [e.id, e]));
  const exercises: SessionExercise[] = [];
  const sets: WorkoutSet[] = [];
  const setTemplateIds: Record<string, string> = {};

  const routineExercises = input.routine ? [...input.routine.exercises].sort((a, b) => a.order - b.order) : [];
  const planned = routineExercises.flatMap((rex) => {
    const exercise = input.exercises.get(rex.exerciseId);
    if (!exercise) {
      warnings.push({ kind: 'exercise_missing', routineExerciseId: rex.id, exerciseId: rex.exerciseId });
      return [];
    }
    return [{ rex, exercise }];
  });

  /**
   * Slots pinned to an item found nowhere, on an exercise that lists no
   * equipment kinds: nothing anywhere can check their loads, so the load
   * targets are dropped (reps kept) rather than kept unchecked (rule 4,
   * review S2). They aren't kept as intended either: no gym could restore them.
   */
  const unresolvable = new Set<string>();
  const slots: SnapSlotInput[] = planned.map(({ rex, exercise }) => {
    let source: SnapSource | null = null;
    if (rex.equipmentId !== null) {
      const pinned = equipmentById.get(rex.equipmentId) ?? input.routineEquipment?.get(rex.equipmentId) ?? input.knownEquipment?.get(rex.equipmentId) ?? null;
      // A pin that can't be resolved anywhere is still a plan for equipment: map it by the exercise's kinds.
      const kind = pinned?.kind ?? exercise.compatibleEquipment[0];
      if (pinned) source = sourceFor(pinned);
      else if (kind !== undefined) source = { id: rex.equipmentId, kind, name: kind in EQUIPMENT_WORD ? EQUIPMENT_WORD[kind as EquipmentInstance['kind']] : 'Equipment', gymId: input.gymId };
      else unresolvable.add(rex.id);
    }
    const unchecked = unresolvable.has(rex.id);
    return {
      slotId: rex.id,
      exercise: { id: exercise.id, name: exercise.name, compatibleEquipment: exercise.compatibleEquipment, defaultLoadConvention: exercise.defaultLoadConvention },
      sourceEquipment: source,
      unit: input.owner.preferredUnit,
      convention: exercise.defaultLoadConvention,
      sets: rex.setTemplates.map((tpl) => ({ id: tpl.id, setType: tpl.setType, intended: unchecked ? null : tpl.targetLoad, current: null, reps: tpl.targetReps, durationS: tpl.targetDurationS })),
    };
  });
  const snap = snapPlanToGym({
    mode,
    slots,
    gym: { id: input.gymId, name: input.gymName ?? 'this gym', equipment: input.gymEquipment },
    ...(input.lastUsedHere ? { lastUsedHere: input.lastUsedHere } : {}),
    ownerUnit: input.owner.preferredUnit,
  });

  planned.forEach(({ rex, exercise }, position) => {
    const fit = snap.slots[position];
    if (!fit) return;
    if (rex.equipmentId !== null && fit.mapping !== 'same_item') {
      warnings.push({ kind: 'equipment_not_in_gym', routineExerciseId: rex.id, equipmentId: rex.equipmentId, substituteId: fit.equipment?.id ?? null });
    }
    const equipment = fit.equipment;
    const sessionExerciseId = input.newId();
    exercises.push({
      id: sessionExerciseId,
      sessionId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      measurement: exercise.measurement,
      laterality: exercise.laterality,
      equipmentId: equipment?.id ?? null,
      loadConvention: fit.convention,
      unit: fit.unit,
      order: position,
      supersetGroup: rex.supersetGroup,
      transitionRestS: rex.transitionRestS,
      progressionRuleId: rex.progressionRuleId,
    });

    rex.setTemplates.forEach((tpl, index) => {
      const result = fit.sets[index];
      const load = result?.load ?? null;
      let warning: Extract<StartWarning, { kind: 'target_rounded' | 'target_dropped' }> | null = null;
      if (result && tpl.targetLoad !== null) {
        if (unresolvable.has(rex.id)) {
          warning = { kind: 'target_dropped', setTemplateId: tpl.id, requested: tpl.targetLoad, reason: 'equipment_not_in_gym' };
        } else if (result.outcome === 'dropped') {
          warning = { kind: 'target_dropped', setTemplateId: tpl.id, requested: tpl.targetLoad, reason: startDropReason(result.reason) };
        } else if (load !== null && result.outcome !== 'exact') {
          warning = { kind: 'target_rounded', setTemplateId: tpl.id, requested: tpl.targetLoad, planned: load, bounded: result.bounded, converted: load.unit !== tpl.targetLoad.unit };
        }
      }
      if (warning) warnings.push(warning);
      const fitted = result ? plannedSnapOf(result, fit, mode, input.gymId) : null;
      const hasTarget = tpl.targetLoad !== null || tpl.targetReps !== null || tpl.targetDurationS !== null;
      const provenance =
        hasTarget && input.routine
          ? planTargetProvenance({ routineName: input.routine.name, at: input.at, requested: tpl.targetLoad, warning, equipment })
          : null;
      const setId = input.newId();
      setTemplateIds[setId] = tpl.id;
      sets.push({
        id: setId,
        sessionId,
        sessionExerciseId,
        index,
        setType: tpl.setType,
        status: 'pending',
        side: exercise.laterality === 'unilateral' ? 'both' : null,
        pairedWithSetId: null,
        planned: {
          load,
          reps: tpl.targetReps,
          durationS: tpl.targetDurationS,
          rpe: tpl.targetRpe,
          rir: tpl.targetRir,
          ...(fitted !== null ? { snap: fitted } : {}),
          ...(provenance !== null ? { provenance } : {}),
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
        pauses: [],
        lastActivityAtUtc: input.at.utc,
        checkIn: input.checkIn ?? null,
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
    snap,
    setTemplateIds,
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
  /** Planned sets (e.g. `plannedSetsFromTargets`); absent = one empty working set. */
  plan?: readonly { setType: SetType; planned: PlannedSet }[] | null | undefined;
  /** Ben's own default rest for this exercise (Your data), before the catalogue's. */
  exerciseRestS?: number | null | undefined;
}

/**
 * Build an `add_exercise` command from catalogue and profile data, so the
 * reducer (which has no catalogue access) gets a trustworthy snapshot. Rest
 * after the first set is resolved with the usual order (exercise default,
 * then global default).
 */
export function buildAddExerciseCommand(input: AddExerciseInput): CommandOf<'add_exercise'> {
  const { exercise } = input;
  const newSetId = input.newId();
  const plan = input.plan && input.plan.length > 0 ? input.plan.map((p, i) => ({ id: i === 0 ? newSetId : input.newId(), setType: p.setType, planned: p.planned })) : null;
  return {
    type: 'add_exercise',
    at: input.at,
    opId: input.opId,
    newSessionExerciseId: input.newId(),
    newSetId,
    ...(plan ? { plan } : {}),
    exercise: {
      exerciseId: exercise.id,
      name: exercise.name,
      measurement: exercise.measurement,
      laterality: exercise.laterality,
      defaultLoadConvention: exercise.defaultLoadConvention,
      compatibleEquipment: exercise.compatibleEquipment,
    },
    equipmentId: input.equipmentId,
    unit: input.owner.preferredUnit,
    rest: resolveRestPreset({
      setType: 'working',
      exerciseName: exercise.name,
      setOverrideS: null,
      routineSetTypePreset: null,
      exerciseDefaultS: input.exerciseRestS ?? exercise.defaultRestS ?? null,
      globalDefault: input.owner.defaultRest,
    }),
  };
}
