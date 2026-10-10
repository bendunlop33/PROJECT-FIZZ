import type { EquipmentInstance, Exercise, Load, PlannedSet, Routine, RoutineExercise, SessionAggregate, SetTemplate, SetType, WorkoutSet } from '@fizz/schemas';
import { loadText, NBSP, repRangeText } from '../display';
import { loadDirection } from '../equipment';
import { convertMass } from '../units';
import { startWorkoutWithMode, type StartWorkoutInput, type StartWorkoutOutput } from './create';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, partRootOf, partsOf } from './gym-switch';
import { GENERIC_WORKOUT_NAME } from './first-run';
import { repeatNoteText } from './snap-text';

/**
 * `Repeat last workout` / `Start from a past workout` (routines.md RT4, §2.4,
 * §4.6): a new session whose sets are all **pending**, with each done set's
 * **actual** as the new **target** (`Target (as last time)`). Nothing is
 * marked done and progression isn't applied. Skipped and deleted sets aren't
 * copied; a left/right pair copies once.
 *
 * Every load goes through the same fit as a routine Start and a mid-workout
 * gym switch (`snapPlanToGym`, mode `repeat`; gym-switch GS1), so Repeat has
 * no equipment rules of its own (review B1 is closed by that shared path):
 * - the item last time is mapped to this gym's equipment (same item, else
 *   same kind, else another kind the exercise lists); none here means no
 *   load target, reps kept: `No Olympic bar at Hotel · Lisbon: no load
 *   target (last time 100 kg × 5).`;
 * - loads round toward easier and never above a max; one below the easiest
 *   load here is dropped, never rounded up;
 * - kg↔lb (review SP5): converted only through that rounding on today's
 *   equipment; with no equipment, a load in another unit is dropped.
 * Repeat never swaps an exercise by itself (gym-switch GS5).
 */

export interface RepeatInput {
  opId: string;
  owner: StartWorkoutInput['owner'];
  gymId: string;
  source: SessionAggregate;
  /** The exercise list now (rest defaults); a missing one falls back to the source's snapshot. */
  exercises: ReadonlyMap<string, Exercise>;
  gymEquipment: readonly EquipmentInstance[];
  at: StartWorkoutInput['at'];
  newId: () => string;
  checkIn?: StartWorkoutInput['checkIn'];
  /**
   * "Start next session" (audit B2): per exercise ID, the built-in rule's
   * next targets (`plannedSetsFromTargets`), used instead of last time's
   * actuals and labelled `built_in_rule`. Exercises without an entry are
   * copied as last time. Loads still go through this gym's check (rule 4).
   */
  targets?: ReadonlyMap<string, readonly { setType: SetType; planned: PlannedSet }[]>;
  /** The new workout's name; default: the source's. */
  name?: string;
  /** The gym's name, for notes (`No Olympic bar at Hotel · Lisbon …`); absent = "here". */
  gymName?: string;
  lastUsedHere?: StartWorkoutInput['lastUsedHere'];
}

export interface RepeatNote {
  exerciseName: string;
  text: string;
  /** `⚠` for a dropped load target, `ⓘ` for a fact (gym-switch §2.2 note rules). */
  tone: 'info' | 'warning';
}

export interface RepeatOutput extends StartWorkoutOutput {
  notes: RepeatNote[];
  /** `Not copied: 2 skipped sets (Cable fly)`. */
  notCopied: { exerciseName: string; skipped: number }[];
  /** Nothing to copy (no completed sets). */
  empty: boolean;
}

export function startWorkoutFromSession(input: RepeatInput): RepeatOutput {
  const src = input.source;
  const notCopied: RepeatOutput['notCopied'] = [];
  const exercises = new Map<string, Exercise>();
  const routineExercises: RoutineExercise[] = [];
  /** The item each copied exercise was done on last time (it may be at another gym). */
  const knownEquipment = new Map<string, EquipmentInstance>();
  const sorted = [...src.exercises].sort((a, b) => a.order - b.order);
  // An exercise split across gyms (GS6) is one block of rows: it is copied once,
  // its parts' done sets in execution order (review B1).
  const roots = sorted.filter((sx) => partRootOf(src.exercises, sx.id) === sx.id);

  for (const sx of roots) {
    const parts = partsOf(src.exercises, sx.id);
    const own = blockSets(src, sx.id);
    // A left/right pair is one prescribed set: the companion row isn't copied again.
    const done = own.filter((s) => s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null);
    const skipped = own.filter((s) => s.status === 'skipped').length;
    if (skipped > 0) notCopied.push({ exerciseName: sx.exerciseName, skipped });
    if (done.length === 0) continue;
    const known = input.exercises.get(sx.exerciseId);
    // The item it was last done on: the latest part that had equipment (a part with none,
    // e.g. bench at a gym with no bar, doesn't unpin the exercise).
    const sourceEq =
      [...parts]
        .reverse()
        .filter((p) => done.some((d) => d.sessionExerciseId === p.id))
        .map((p) => equipmentOfRow(src.session.equipmentSnapshot, p))
        .find((e) => e !== null) ?? null;
    const exercise: Exercise = known ?? {
      id: sx.exerciseId,
      ownerId: null,
      source: 'catalogue',
      name: sx.exerciseName,
      movementPattern: 'unknown',
      primaryMuscles: [],
      measurement: sx.measurement,
      laterality: sx.laterality,
      compatibleEquipment: sourceEq ? [sourceEq.kind] : [],
      defaultLoadConvention: sx.loadConvention,
      version: 1,
      createdAtUtc: src.session.startedAt.utc,
      updatedAtUtc: src.session.startedAt.utc,
    };
    exercises.set(exercise.id, exercise);
    if (sourceEq) knownEquipment.set(sourceEq.id, sourceEq);

    const doneWithReps = done.filter((s) => s.actual !== null && (s.actual.reps !== null || s.actual.durationS !== null));
    const planned = input.targets?.get(sx.exerciseId);
    const sources: { setType: SetType; load: Load | null; reps: { min: number; max: number } | null; durationS: number | null }[] =
      planned && planned.length > 0
        ? planned.map((p) => ({ setType: p.setType, load: p.planned.load, reps: p.planned.reps, durationS: p.planned.durationS }))
        : doneWithReps.flatMap((s) => (s.actual === null ? [] : [{ setType: s.setType, load: s.actual.load, reps: s.actual.reps === null ? null : { min: s.actual.reps, max: s.actual.reps }, durationS: s.actual.durationS }]));
    const templates: SetTemplate[] = [];
    for (const a of sources) {
      templates.push({
        id: input.newId(),
        setType: a.setType,
        // The intended target (last time's actual, or the rule's next target); the shared fit decides what this gym can make.
        targetLoad: a.load,
        targetReps: a.reps,
        targetDurationS: a.durationS,
        targetRpe: null,
        targetRir: null,
        restOverrideS: null,
      });
    }
    if (templates.length === 0) continue;
    routineExercises.push({
      id: input.newId(),
      exerciseId: exercise.id,
      // Pinned to last time's item: `snapPlanToGym` maps it to this gym (GS3).
      equipmentId: sourceEq?.id ?? null,
      order: routineExercises.length,
      supersetGroup: sx.supersetGroup,
      setTemplates: templates,
      restBySetType: {},
      transitionRestS: sx.transitionRestS,
      progressionRuleId: null,
    });
  }

  const routine: Routine = {
    id: input.newId(),
    ownerId: input.owner.id,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.name ?? src.session.routineName ?? GENERIC_WORKOUT_NAME,
    exercises: routineExercises,
  };
  // Ben's own per-exercise rest defaults come first (rest-state §2.4).
  const restOwner = input.owner.exerciseRestS ?? {};
  const withRest = new Map([...exercises].map(([k, e]) => [k, restOwner[k] === undefined ? e : { ...e, defaultRestS: restOwner[k] }]));
  const out = startWorkoutWithMode(
    {
      opId: input.opId,
      owner: input.owner,
      gymId: input.gymId,
      routine,
      exercises: withRest,
      gymEquipment: input.gymEquipment,
      at: input.at,
      newId: input.newId,
      knownEquipment,
      ...(input.gymName !== undefined ? { gymName: input.gymName } : {}),
      ...(input.lastUsedHere ? { lastUsedHere: input.lastUsedHere } : {}),
      ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
    },
    'repeat',
  );

  // One note per exercise per outcome, in workout order, from fixed wording (gym-switch §5).
  const notes: RepeatNote[] = [];
  const seen = new Set<string>();
  for (const slot of out.snap.slots) {
    for (const note of slot.notes) {
      const text = repeatNoteText(note, slot, input.gymName ?? null);
      if (text === null) continue;
      const key = `${slot.exerciseName}|${text}`;
      if (!seen.has(key)) notes.push({ exerciseName: slot.exerciseName, text, tone: note.kind === 'dropped' ? 'warning' : 'info' });
      seen.add(key);
    }
  }
  const aggregate: SessionAggregate = {
    ...out.aggregate,
    session: { ...out.aggregate.session, routineId: null },
    sets: out.aggregate.sets.map((s) => {
      const exerciseId = out.aggregate.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId;
      const fromRule = exerciseId !== undefined && (input.targets?.get(exerciseId)?.length ?? 0) > 0;
      return { ...s, planned: { ...s.planned, source: fromRule ? ('built_in_rule' as const) : ('repeat' as const) } };
    }),
  };
  return { aggregate, warnings: out.warnings, snap: out.snap, notes, notCopied, empty: routineExercises.length === 0 };
}

/**
 * The names of a workout's exercises with at least one done set, in workout order,
 * once per exercise: an exercise split across gyms (GS6) is listed once (review B1).
 */
export function doneExerciseNames(state: SessionAggregate): string[] {
  const doneRows = new Set(state.sets.filter((s) => s.status === 'completed' && s.pairedWithSetId === null).map((s) => s.sessionExerciseId));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const e of [...state.exercises].sort((a, b) => a.order - b.order)) {
    if (!doneRows.has(e.id)) continue;
    const root = partRootOf(state.exercises, e.id);
    if (seen.has(root)) continue;
    seen.add(root);
    names.push(e.exerciseName);
  }
  return names;
}

/** The hardest loaded set (working sets first) by convention: most resistance, or least assistance. */
export function lastTimeTopSet(done: readonly WorkoutSet[]): WorkoutSet | null {
  const loaded = done.filter((s) => s.actual?.load);
  const working = loaded.filter((s) => s.setType !== 'warmup');
  const pool = working.length > 0 ? working : loaded;
  const convention = pool.at(-1)?.actual?.load?.convention;
  if (convention === undefined) return null;
  const sameKind = pool.filter((s) => s.actual?.load?.convention === convention);
  const harder = loadDirection(convention) === 'assistance' ? -1 : 1;
  const kgOf = (s: WorkoutSet): number => {
    const l = s.actual?.load;
    return l ? convertMass(l, 'kg').value : 0;
  };
  let top: WorkoutSet | null = null;
  for (const s of sameKind) if (top === null || harder * (kgOf(s) - kgOf(top)) >= 0) top = s;
  return top;
}

/** One line per exercise for the Repeat preview: `3 sets · Target (as last time) 100 kg × 8, 8, 7`. */
export function repeatPreviewLines(state: SessionAggregate): { exerciseName: string; equipmentName: string | null; line: string }[] {
  return [...state.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
      const sets = state.sets.filter((s) => s.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index);
      const parts = sets.map((s) => {
        const load = s.planned.load ? loadText(s.planned.load, ex.loadConvention, eq) : null;
        const reps = s.planned.reps ? repRangeText(s.planned.reps) : null;
        const badge = s.setType === 'warmup' ? 'W ' : '';
        return `${badge}${load ?? ''}${load && reps ? `${NBSP}×${NBSP}` : ''}${reps ?? ''}`.trim();
      });
      return { exerciseName: ex.exerciseName, equipmentName: eq?.name ?? null, line: `${String(sets.length)} ${sets.length === 1 ? 'set' : 'sets'} · ${parts.join(' · ')}` };
    });
}
