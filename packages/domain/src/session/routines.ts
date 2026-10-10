import type {
  EquipmentInstance,
  Exercise,
  Load,
  PlannedSet,
  RestSetting,
  Routine,
  RoutineExercise,
  SessionAggregate,
  SetTemplate,
  SetType,
  TargetProvenance,
  ZonedTimestamp,
} from '@fizz/schemas';
import { loadText } from '../display';
import { fitProvenance, startWarningNote } from '../target-provenance';
import { toMs } from '../time';
import { startWorkout, type StartWorkoutInput, type StartWorkoutOutput } from './create';
import { droppedNotes, fitLoadHere, pickEquipment, warningNotes, type RepeatNote } from './repeat';

/**
 * Routines (premium-feel §2.6, routines.md). Pure rules: building a routine
 * from a finished workout, starting a routine with next-session targets at
 * this gym, the simple rotation (D19, by what was trained last), and the
 * versioned, idempotent record changes (save, rename, delete, restore).
 * Routines are Your data (rule 10).
 */

export const ROUTINE_NAME_MAX = 120;

export type RoutineNameCheck =
  | { ok: true; name: string; note: string | null }
  | { ok: false; message: 'Give it a name' | 'Keep it under 120 characters' };

/**
 * The Save/Rename sheet's name check. A duplicate name is allowed with a
 * note, never blocked (premium-feel §2.6). `exceptId`: the routine being renamed.
 */
export function checkRoutineName(raw: string, existing: readonly Pick<Routine, 'id' | 'name' | 'deletedAtUtc'>[], exceptId: string | null = null): RoutineNameCheck {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, message: 'Give it a name' };
  if (name.length > ROUTINE_NAME_MAX) return { ok: false, message: 'Keep it under 120 characters' };
  const clash = existing.find((r) => r.id !== exceptId && !isDeleted(r) && r.name.trim().toLowerCase() === name.toLowerCase());
  return { ok: true, name, note: clash ? `You already have a routine called ${clash.name}.` : null };
}

export function isDeleted(r: Pick<Routine, 'deletedAtUtc'>): boolean {
  return r.deletedAtUtc !== undefined && r.deletedAtUtc !== null;
}

/** Live routines in list order: creation order in this pass (premium-feel §2.6), then ID for ties. */
export function liveRoutines<R extends Pick<Routine, 'id' | 'createdAtUtc' | 'deletedAtUtc'>>(all: readonly R[]): R[] {
  return all
    .filter((r) => !isDeleted(r))
    .sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? -1 : a.createdAtUtc > b.createdAtUtc ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface RoutineFromSessionInput {
  id: string;
  ownerId: string;
  name: string;
  opId: string;
  source: SessionAggregate;
  at: ZonedTimestamp;
  newId: () => string;
}

/**
 * A routine from a finished workout (`Save as routine`). Keeps the exercise
 * order, equipment, set types, rep ranges (the plan's range when there was
 * one, else the reps done), rest by set type and supersets. Loads are the
 * actuals. Skipped and deleted sets aren't kept, a left/right pair counts
 * once, and an exercise with only warm-ups done is left out. Null when
 * nothing qualifies, or the workout isn't a finished one done in the app
 * (an imported workout's loads were never checked on equipment). The
 * workout itself is never changed.
 */
export function routineFromSession(input: RoutineFromSessionInput): Routine | null {
  const src = input.source;
  if (src.session.status !== 'finished' || src.session.source !== 'manual') return null;
  const exercises: RoutineExercise[] = [];
  for (const sx of [...src.exercises].sort((a, b) => a.order - b.order)) {
    const done = src.sets
      .filter((s) => s.sessionExerciseId === sx.id && s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null)
      .sort((a, b) => a.index - b.index);
    if (done.every((s) => s.setType === 'warmup')) continue;
    const templates: SetTemplate[] = [];
    const restBySetType: Partial<Record<SetType, RestSetting>> = {};
    for (const s of done) {
      const a = s.actual;
      if (a === null || (a.reps === null && a.durationS === null)) continue;
      const reps = a.reps === null ? null : (s.planned.reps && a.reps >= s.planned.reps.min && a.reps <= s.planned.reps.max ? { ...s.planned.reps } : { min: a.reps, max: a.reps });
      templates.push({
        id: input.newId(),
        setType: s.setType,
        targetLoad: a.load,
        targetReps: reps,
        targetDurationS: reps === null ? a.durationS : null,
        targetRpe: null,
        targetRir: null,
        restOverrideS: null,
      });
      if (restBySetType[s.setType] === undefined && s.rest.source !== 'not_recorded') restBySetType[s.setType] = { seconds: s.rest.seconds };
    }
    if (templates.length === 0) continue;
    exercises.push({
      id: input.newId(),
      exerciseId: sx.exerciseId,
      equipmentId: sx.equipmentId,
      order: exercises.length,
      supersetGroup: sx.supersetGroup,
      setTemplates: templates.slice(0, 30),
      restBySetType,
      transitionRestS: sx.transitionRestS,
      progressionRuleId: sx.progressionRuleId,
    });
  }
  if (exercises.length === 0) return null;
  return {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.name.trim(),
    exercises: exercises.slice(0, 40),
    createdFromSessionId: src.session.id,
    deletedAtUtc: null,
    lastOpId: input.opId,
  };
}

/** `3 exercises · 9 sets` for a routine (working and warm-up sets). */
export function routineCounts(r: Pick<Routine, 'exercises'>): { exercises: number; sets: number } {
  return { exercises: r.exercises.length, sets: r.exercises.reduce((n, e) => n + e.setTemplates.length, 0) };
}

/**
 * A change to a stored routine, or why there's none. `duplicate`: this
 * operation already wrote the current version (a retry), so nothing is
 * saved again. `expectedVersion` is what the save must find stored.
 */
export type RoutineChange = { kind: 'write'; next: Routine; expectedVersion: number } | { kind: 'duplicate'; current: Routine } | { kind: 'stale'; current: Routine } | { kind: 'invalid'; message: string };

function change(current: Routine, expectedVersion: number, opId: string, at: ZonedTimestamp, patch: Partial<Routine>): RoutineChange {
  if (current.lastOpId === opId) return { kind: 'duplicate', current };
  if (current.version !== expectedVersion) return { kind: 'stale', current };
  return { kind: 'write', next: { ...current, ...patch, version: current.version + 1, updatedAtUtc: at.utc, lastOpId: opId }, expectedVersion };
}

export function renameRoutine(current: Routine, name: string, expectedVersion: number, opId: string, at: ZonedTimestamp): RoutineChange {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { kind: 'invalid', message: 'Give it a name' };
  if (trimmed.length > ROUTINE_NAME_MAX) return { kind: 'invalid', message: 'Keep it under 120 characters' };
  return change(current, expectedVersion, opId, at, { name: trimmed });
}

/** Delete is a tombstone, so Undo (`restoreRoutine`) puts the same routine back. */
export function deleteRoutine(current: Routine, expectedVersion: number, opId: string, at: ZonedTimestamp): RoutineChange {
  return change(current, expectedVersion, opId, at, { deletedAtUtc: at.utc });
}

export function restoreRoutine(current: Routine, expectedVersion: number, opId: string, at: ZonedTimestamp): RoutineChange {
  return change(current, expectedVersion, opId, at, { deletedAtUtc: null });
}

/** A finished workout, as the rotation needs it. */
export interface FinishedRef {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
  tz: string;
}

/** Whether a finished workout counts as this routine's: started from it, or the workout it was saved from. */
export function isFromRoutine(ref: Pick<FinishedRef, 'sessionId' | 'routineId'>, r: Pick<Routine, 'id' | 'createdFromSessionId'>): boolean {
  return ref.routineId === r.id || (r.createdFromSessionId !== undefined && r.createdFromSessionId !== null && r.createdFromSessionId === ref.sessionId);
}

export type RotationPick<R> =
  | { kind: 'routine'; routine: R; basis: { kind: 'after'; routineName: string; atUtc: string; tz: string } | { kind: 'only' } }
  /** The last workout wasn't from a routine (or there are none): Up next stays that workout's next session. */
  | { kind: 'last_workout' };

/**
 * Up next with routines (premium-feel §2.6; D19 simplified): the routine
 * after the one most recently finished, in list order, wrapping round. With
 * one routine, that routine (`Your only routine`). When the most recent
 * workout wasn't from a routine, Up next stays that workout's next session.
 * `routines`: live routines in list order. `last`: the newest finished workout.
 */
export function nextInRotation<R extends Pick<Routine, 'id' | 'name' | 'createdFromSessionId'>>(routines: readonly R[], last: FinishedRef | null): RotationPick<R> {
  if (routines.length === 0 || last === null) return { kind: 'last_workout' };
  const at = routines.findIndex((r) => isFromRoutine(last, r));
  if (at < 0) return { kind: 'last_workout' };
  const done = routines[at];
  if (done === undefined) return { kind: 'last_workout' };
  if (routines.length === 1) return { kind: 'routine', routine: done, basis: { kind: 'only' } };
  const next = routines[(at + 1) % routines.length];
  if (next === undefined) return { kind: 'last_workout' };
  return { kind: 'routine', routine: next, basis: { kind: 'after', routineName: done.name, atUtc: last.startedAtUtc, tz: last.tz } };
}

/**
 * When each routine was last done (newest finished workout from it), or
 * null. `finished`: finished workouts, any order.
 */
export function routineLastDone(routines: readonly Pick<Routine, 'id' | 'createdFromSessionId'>[], finished: readonly FinishedRef[]): Map<string, FinishedRef | null> {
  const out = new Map<string, FinishedRef | null>();
  const newestFirst = [...finished].sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc));
  for (const r of routines) out.set(r.id, newestFirst.find((f) => isFromRoutine(f, r)) ?? null);
  return out;
}

export interface RoutineStartInput {
  opId: string;
  owner: StartWorkoutInput['owner'];
  gymId: string;
  routine: Routine;
  exercises: ReadonlyMap<string, Exercise>;
  gymEquipment: readonly EquipmentInstance[];
  /** Equipment from Ben's other gyms, to find the same kind here when the routine's item isn't at this gym. */
  knownEquipment: ReadonlyMap<string, EquipmentInstance>;
  /**
   * Next targets per exercise ID from the routine's most recent finished
   * workout (the built-in rule, or later the coach). Exercises without an
   * entry, or in more than one slot of the routine, use the routine's own
   * templates.
   */
  targets?: ReadonlyMap<string, readonly { setType: SetType; planned: PlannedSet }[]>;
  at: ZonedTimestamp;
  newId: () => string;
  checkIn?: StartWorkoutInput['checkIn'];
}

export interface RoutineStartOutput extends StartWorkoutOutput {
  notes: RepeatNote[];
}

/**
 * Start a routine (premium-feel §2.6): the structure (exercises, order,
 * supersets, rest, warm-ups) comes from the routine; loads and reps come
 * from `targets` where there are any. Every load is checked on this gym's
 * equipment: the routine's item if it's here, else one of the same kind,
 * rounded toward easier and never above a max (rule 4). With no such
 * equipment here, loads are dropped and reps kept, with a note. Exercises
 * added to an earlier workout from this routine aren't in it: the routine
 * is the structure, never the last workout.
 */
export function planRoutineStart(input: RoutineStartInput): RoutineStartOutput {
  const notes: RepeatNote[] = [];
  const resolved: RoutineExercise[] = [];
  const targeted = new Set<string>();
  const byGym = new Map(input.gymEquipment.map((e) => [e.id, e]));
  // Targets are per exercise, so an exercise in two slots (a heavy and a light bench) can't tell which slot's
  // targets are which: both keep the routine's own templates (review S7).
  const slots = new Map<string, number>();
  for (const rex of input.routine.exercises) slots.set(rex.exerciseId, (slots.get(rex.exerciseId) ?? 0) + 1);
  // Templates made from the built-in rule's targets: the rule's planned set, the equipment here, and why a load was dropped.
  // `Why?` then explains them as the rule's, never as the routine's own numbers (review B1.1).
  const ruleOf = new Map<string, { planned: PlannedSet; eq: EquipmentInstance | null; dropNote: string | null }>();
  for (const rex of [...input.routine.exercises].sort((a, b) => a.order - b.order)) {
    const exercise = input.exercises.get(rex.exerciseId);
    const name = exercise?.name ?? 'Exercise';
    let eq: EquipmentInstance | null = null;
    let missing: string | null = null;
    if (rex.equipmentId !== null) {
      const here = byGym.get(rex.equipmentId);
      const known = here ?? input.knownEquipment.get(rex.equipmentId) ?? null;
      eq = here && here.availability === 'available' ? here : known === null ? null : pickEquipment(known, input.gymEquipment, { compatibleEquipment: exercise?.compatibleEquipment ?? [known.kind] });
      if (eq === null) missing = known?.name ?? 'equipment';
    }
    const sessionUnit = eq?.unit ?? input.owner.preferredUnit;
    const planned = (slots.get(rex.exerciseId) ?? 0) > 1 ? undefined : input.targets?.get(rex.exerciseId);
    const useTargets = planned !== undefined && planned.length > 0;
    if (useTargets) targeted.add(rex.exerciseId);
    const warmups = useTargets ? rex.setTemplates.filter((t) => t.setType === 'warmup') : [];
    const fromRule = new Map<string, PlannedSet>();
    const source: SetTemplate[] = useTargets
      ? [
          ...warmups,
          ...planned.map((p) => {
            const id = input.newId();
            fromRule.set(id, p.planned);
            return {
              id,
              setType: p.setType,
              targetLoad: p.planned.load,
              targetReps: p.planned.reps,
              targetDurationS: p.planned.durationS,
              targetRpe: p.planned.rpe,
              targetRir: p.planned.rir,
              restOverrideS: null,
            };
          }),
        ]
      : rex.setTemplates;
    let unitDropped: Parameters<typeof droppedNotes>[2] = null;
    let harderDropped: Parameters<typeof droppedNotes>[3] = null;
    const templates = source
      .filter((t) => t.targetReps !== null || t.targetDurationS !== null)
      .map((t) => {
        const fit = fitLoadHere(missing !== null ? null : t.targetLoad, eq, sessionUnit);
        unitDropped ??= fit.unitDropped;
        harderDropped ??= fit.harderDropped;
        const id = input.newId();
        const rulePlanned = fromRule.get(t.id);
        if (rulePlanned !== undefined) ruleOf.set(id, { planned: rulePlanned, eq, dropNote: ruleDropNote(missing, t.targetLoad, fit, eq, sessionUnit) });
        return { ...t, id, targetLoad: fit.load };
      });
    if (missing !== null && source.some((t) => t.targetLoad !== null)) notes.push({ exerciseName: name, text: `No ${missing} here: no load target.` });
    notes.push(...droppedNotes(name, sessionUnit, unitDropped, harderDropped));
    if (templates.length === 0) continue;
    resolved.push({ ...rex, equipmentId: eq?.id ?? null, order: resolved.length, setTemplates: templates });
  }

  const routine: Routine = { ...input.routine, exercises: resolved };
  // Ben's own per-exercise rest defaults come first (rest-state §2.4).
  const restOwner = input.owner.exerciseRestS ?? {};
  const withRest = new Map([...input.exercises].map(([k, e]) => [k, restOwner[k] === undefined ? e : { ...e, defaultRestS: restOwner[k] }]));
  const out = startWorkout({
    opId: input.opId,
    owner: input.owner,
    gymId: input.gymId,
    routine,
    exercises: withRest,
    gymEquipment: input.gymEquipment,
    at: input.at,
    newId: input.newId,
    ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
  });
  notes.push(...warningNotes(out.warnings, resolved, input.exercises));
  for (const w of out.warnings) {
    if (w.kind === 'exercise_missing') notes.push({ exerciseName: 'Exercise', text: 'An exercise in this routine is no longer in your list, so it was left out.' });
  }
  const exerciseOf = new Map(out.aggregate.exercises.map((e) => [e.id, e.exerciseId]));
  const warningOf = new Map(out.warnings.flatMap((w) => (w.kind === 'target_rounded' || w.kind === 'target_dropped' ? [[w.setTemplateId, w] as const] : [])));
  /** The rule's own provenance plus how it was fitted here; null when it wasn't stored (`Why?` then says `Not recorded`). */
  const ruleProvenance = (setId: string): TargetProvenance | null => {
    const templateId = out.setTemplateIds[setId];
    const from = templateId === undefined ? undefined : ruleOf.get(templateId);
    const rule = from?.planned.provenance;
    if (from === undefined || templateId === undefined || rule === undefined) return null;
    const w = warningOf.get(templateId);
    const fit = from.dropNote ?? (w ? startWarningNote(w, from.eq, 'Target') : null);
    return fitProvenance(fit === null ? rule : { ...rule, guardNotes: [...rule.guardNotes, fit] });
  };
  const aggregate: SessionAggregate = {
    ...out.aggregate,
    session: { ...out.aggregate.session, routineId: input.routine.id, routineName: input.routine.name },
    sets: out.aggregate.sets.map((s) => {
      const exId = exerciseOf.get(s.sessionExerciseId);
      // Targets from the rule say so; the routine's own templates carry no source (a routine template).
      if (exId === undefined || !targeted.has(exId) || s.setType === 'warmup') return s;
      const plannedSet: PlannedSet = { ...s.planned, source: 'built_in_rule' };
      const provenance = ruleProvenance(s.id);
      if (provenance === null) delete plannedSet.provenance;
      else plannedSet.provenance = provenance;
      return { ...s, planned: plannedSet };
    }),
  };
  return { aggregate, warnings: out.warnings, setTemplateIds: out.setTemplateIds, notes };
}

/** Why a rule target's load was dropped at this gym, said against the target (`Why?` Equipment row). */
function ruleDropNote(missing: string | null, requested: Load | null, fit: ReturnType<typeof fitLoadHere>, eq: EquipmentInstance | null, sessionUnit: string): string | null {
  const word = (l: Load) => loadText(l, l.convention, eq);
  if (missing !== null && requested !== null) return `No load target: no ${missing} here.`;
  if (fit.unitDropped) return `No load target: the target was ${word(fit.unitDropped)}, and there’s no equipment here to check a ${sessionUnit} load on.`;
  if (fit.harderDropped) return `No load target: the target was ${word(fit.harderDropped.requested)}, and the easiest here is ${word(fit.harderDropped.lightest)}.`;
  return null;
}
