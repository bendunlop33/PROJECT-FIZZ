import type {
  EquipmentInstance,
  Exercise,
  Load,
  PlannedSet,
  RestSetting,
  Routine,
  RoutineExercise,
  SessionAggregate,
  SessionTodayEdits,
  SetTemplate,
  SetType,
  TargetProvenance,
  ZonedTimestamp,
} from '@fizz/schemas';
import { formatNumber, loadText, NBSP, repRangeText } from '../display';
import { loadDirection } from '../equipment';
import { fitProvenance, startWarningNote } from '../target-provenance';
import { toMs } from '../time';
import { startWorkout, type StartWorkoutInput, type StartWorkoutOutput } from './create';
import { blockSets, partRootOf, partsOf } from './gym-switch';
import { boundWords, convertedWords, noLoadWords, roundedWords, withWas } from './fit-words';
import type { NextTargetEntry } from '../coach/next-session';
import type { RepeatNote } from './repeat';
import type { SnapResult } from './snap';
import { shapeOfTemplates, shapeTemplates, type ShapeBefore, type SlotShape } from './today-shape';

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
  return { ok: true, name, note: clash ? `You already have ${clash.name}.` : null };
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

/** In Ben's rotation (D19, RT9): absent means yes (every routine was, before the library). */
export function isInRotation(r: Pick<Routine, 'inRotation'>): boolean {
  return r.inRotation !== false;
}

/**
 * The rotation (D19, RT9): live routines in it, in rotation order (when
 * each joined; a routine from before the library joined when it was made).
 * `nextInRotation` and Up next read only these.
 */
export function rotationRoutines<R extends Pick<Routine, 'id' | 'createdAtUtc' | 'deletedAtUtc' | 'inRotation' | 'rotationAtUtc'>>(all: readonly R[]): R[] {
  const at = (r: R): string => r.rotationAtUtc ?? r.createdAtUtc;
  return all
    .filter((r) => !isDeleted(r) && isInRotation(r))
    .sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface RoutineFromSessionInput {
  id: string;
  ownerId: string;
  name: string;
  opId: string;
  source: SessionAggregate;
  at: ZonedTimestamp;
  newId: () => string;
  /**
   * Repeat's `Save to Workouts` (routines.md §4.6): the loads done become
   * Fixed. Otherwise every load is `Auto` (WL7): next targets come from the
   * coach or the built-in rule, using the source workout as history.
   */
  keepLoads?: boolean;
  /** `Add to rotation` on the save sheet (off by default, §A2.5). */
  inRotation?: boolean;
  /** For `Main` (WL9): whether an exercise is a compound one. Unknown = not. */
  isCompound?: (exerciseId: string) => boolean;
}

/**
 * A workout saved from a finished one (`Save to Workouts`, routines.md WL6,
 * WL7). Keeps the exercise order, set types and counts, rep ranges (the
 * plan's range when there was one, else the reps done), rest by set type
 * and supersets. Loads are `Auto` (null) unless `keepLoads`. Skipped and
 * deleted sets aren't kept, a left/right pair counts once, and an exercise
 * with only warm-ups done is left out. A workout done in the app keeps the
 * item it was last done on; an imported one (FitNotes) pins none and never
 * keeps a load (its loads were never checked on equipment). Null when
 * nothing qualifies or the workout isn't finished. The workout itself is
 * never changed.
 */
export function routineFromSession(input: RoutineFromSessionInput): Routine | null {
  const src = input.source;
  if (src.session.status !== 'finished') return null;
  const imported = src.session.source === 'import';
  const keepLoads = input.keepLoads === true && !imported;
  const exercises: RoutineExercise[] = [];
  // An exercise split across gyms (GS6) is one block of rows: one entry, its parts' done sets in execution order.
  const roots = [...src.exercises].sort((a, b) => a.order - b.order).filter((sx) => partRootOf(src.exercises, sx.id) === sx.id);
  for (const sx of roots) {
    const done = blockSets(src, sx.id).filter((s) => s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null);
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
        targetLoad: keepLoads ? a.load : null,
        targetReps: reps,
        targetDurationS: reps === null ? a.durationS : null,
        targetRpe: null,
        targetRir: null,
        restOverrideS: null,
      });
      if (restBySetType[s.setType] === undefined && s.rest.source !== 'not_recorded') restBySetType[s.setType] = { seconds: s.rest.seconds };
    }
    if (templates.length === 0) continue;
    // Pinned to the item it was last done on, as Repeat does: the latest part with done sets and equipment.
    const equipmentId = imported
      ? null
      : ([...partsOf(src.exercises, sx.id)]
          .reverse()
          .filter((p) => done.some((d) => d.sessionExerciseId === p.id))
          .map((p) => p.equipmentId)
          .find((e) => e !== null) ?? null);
    exercises.push({
      id: input.newId(),
      exerciseId: sx.exerciseId,
      equipmentId,
      order: exercises.length,
      supersetGroup: sx.supersetGroup,
      setTemplates: templates.slice(0, 30),
      restBySetType,
      transitionRestS: sx.transitionRestS,
      progressionRuleId: imported ? null : sx.progressionRuleId,
    });
  }
  if (exercises.length === 0) return null;
  const kept = exercises.slice(0, 40);
  return {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.name.trim(),
    exercises: withDefaultMain(kept, input.isCompound ?? (() => false)),
    createdFromSessionId: src.session.id,
    deletedAtUtc: null,
    lastOpId: input.opId,
    source: 'ben',
    inRotation: input.inRotation === true,
    ...(input.inRotation === true ? { rotationAtUtc: input.at.utc } : {}),
  };
}

// ---------------------------------------------------------------------------
// Main lifts (WL9)

/**
 * `Main` by the rule (routines.md WL9): compound exercises in the first two
 * places are main; with none there, the first exercise is. Order is the
 * array's order.
 */
export function defaultMain(exercises: readonly Pick<RoutineExercise, 'exerciseId'>[], isCompound: (exerciseId: string) => boolean): boolean[] {
  const flags = exercises.map((e, i) => i < 2 && isCompound(e.exerciseId));
  if (exercises.length > 0 && !flags.some(Boolean)) flags[0] = true;
  return flags;
}

/** Each exercise's `Main`: Ben's stored choice, else the rule (older workouts, exercises not decided yet). */
export function mainFlags(exercises: readonly Pick<RoutineExercise, 'exerciseId' | 'main'>[], isCompound: (exerciseId: string) => boolean): boolean[] {
  const rule = defaultMain(exercises, isCompound);
  return exercises.map((e, i) => e.main ?? rule[i] ?? false);
}

/** The exercises with every `Main` written down (on create and save). */
export function withDefaultMain<E extends Pick<RoutineExercise, 'exerciseId' | 'main'>>(exercises: readonly E[], isCompound: (exerciseId: string) => boolean): E[] {
  const flags = mainFlags(exercises, isCompound);
  return exercises.map((e, i) => ({ ...e, main: flags[i] ?? false }));
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

/** One versioned, idempotent change to a stored routine (every library write goes through this). */
export function routineWrite(current: Routine, expectedVersion: number, opId: string, at: ZonedTimestamp, patch: Partial<Routine>): RoutineChange {
  return change(current, expectedVersion, opId, at, patch);
}

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
  /** Equipment from Ben's other gyms, so the shared fit can map the routine's item to this gym (GS3). */
  knownEquipment: ReadonlyMap<string, EquipmentInstance>;
  /**
   * Next targets per exercise ID from the routine's most recent finished
   * workout (the built-in rule, or later the coach). Exercises without an
   * entry, or in more than one slot of the routine, use the routine's own
   * templates.
   */
  targets?: ReadonlyMap<string, readonly NextTargetEntry[]>;
  at: ZonedTimestamp;
  newId: () => string;
  checkIn?: StartWorkoutInput['checkIn'];
  /** The gym's name, for notes and `planned.snap` (`No Olympic bar at Hotel`); absent = "this gym". */
  gymName?: string;
  /** GS3 step 2: the item an exercise last used at this gym. */
  lastUsedHere?: StartWorkoutInput['lastUsedHere'];
  /**
   * Today's shape per slot (`RoutineExercise.id`; overview-today-edits §11):
   * Ben's sets, reps and load for today, applied after the targets.
   */
  shape?: ReadonlyMap<string, SlotShape>;
}

export interface RoutineStartOutput extends StartWorkoutOutput {
  notes: RepeatNote[];
  /** Each slot as planned before today's shape (`shape` given only), by `RoutineExercise.id`. */
  shapedFrom?: Record<string, ShapeBefore>;
}

/**
 * Start a routine (premium-feel §2.6): the structure (exercises, order,
 * supersets, rest, warm-ups) comes from the routine; loads and reps come
 * from `targets` where there are any. The routine's own item and the
 * unfitted loads go to `startWorkout`, whose shared fit (`snapPlanToGym`,
 * ADR 0019) maps the item to this gym (GS3: same item, last used here, same
 * kind, another kind the exercise lists, else none) and fits every load
 * toward easier, never above a max (rule 4). The intended target is kept on
 * the set (`planned.snap`), so a later gym switch back restores it (GS2).
 * Exercises added to an earlier workout from this routine aren't in it: the
 * routine is the structure, never the last workout.
 */
export function planRoutineStart(input: RoutineStartInput): RoutineStartOutput {
  const resolved: RoutineExercise[] = [];
  const targeted = new Set<string>();
  // Targets are per exercise, so an exercise in two slots (a heavy and a light bench) can't tell which slot's
  // targets are which: both keep the routine's own templates (review S7).
  const slots = new Map<string, number>();
  for (const rex of input.routine.exercises) slots.set(rex.exerciseId, (slots.get(rex.exerciseId) ?? 0) + 1);
  // Templates made from the built-in rule's targets. `Why?` then explains them as the rule's, never as the routine's own numbers (review B1.1).
  const ruleOf = new Map<string, PlannedSet>();
  // A routine from before the library (no `source`) stored last time's actuals as its loads: next targets
  // replace them, set for set, as they always have. A library workout's non-null load is Ben's Fixed pin.
  const legacy = input.routine.source === undefined;
  const shapedFrom: Record<string, ShapeBefore> = {};
  for (const rex of [...input.routine.exercises].sort((a, b) => a.order - b.order)) {
    const planned = (slots.get(rex.exerciseId) ?? 0) > 1 ? undefined : input.targets?.get(rex.exerciseId);
    const useTargets = planned !== undefined && planned.length > 0;
    if (useTargets) targeted.add(rex.exerciseId);
    const targetedTemplates: SetTemplate[] = useTargets ? routineTemplatesWithTargets(rex.setTemplates, planned, { legacy, newId: input.newId, ruleOf, editedAtUtc: rex.structureChangedAtUtc }) : rex.setTemplates;
    // Ben's today-only shape (§11) comes last: his choice for today wins over any target.
    const shape = input.shape?.get(rex.id);
    if (input.shape !== undefined) shapedFrom[rex.id] = shapeOfTemplates(targetedTemplates);
    const source =
      shape === undefined
        ? targetedTemplates
        : shapeTemplates(targetedTemplates, shape, {
            newId: input.newId,
            copied: (from, to) => {
              const rule = ruleOf.get(from);
              if (rule !== undefined) ruleOf.set(to, rule);
            },
            ownLoad: (id) => ruleOf.delete(id),
          });
    const templates = source.filter((t) => t.targetReps !== null || t.targetDurationS !== null);
    if (templates.length === 0) continue;
    // The routine's own item and unfitted loads: the shared fit does the mapping and fitting (S1, ADR 0019).
    resolved.push({ ...rex, order: resolved.length, setTemplates: templates });
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
    routineEquipment: input.knownEquipment,
    at: input.at,
    newId: input.newId,
    ...(input.gymName !== undefined ? { gymName: input.gymName } : {}),
    ...(input.lastUsedHere ? { lastUsedHere: input.lastUsedHere } : {}),
    ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
  });
  const notes = routineStartNotes(out.snap);
  const missing = out.warnings.filter((w) => w.kind === 'exercise_missing').length;
  if (missing > 0) notes.push({ exerciseName: 'Exercise', text: `${String(missing)} ${missing === 1 ? 'exercise' : 'exercises'} left out (not in your list)`, tone: 'warning' });
  const exerciseOf = new Map(out.aggregate.exercises.map((e) => [e.id, e.exerciseId]));
  const equipmentOfSlot = new Map(out.snap.slots.map((s) => [s.slotId, s.equipment]));
  const slotOfTemplate = new Map(resolved.flatMap((rex) => rex.setTemplates.map((t) => [t.id, rex.id] as const)));
  const warningOf = new Map(out.warnings.flatMap((w) => (w.kind === 'target_rounded' || w.kind === 'target_dropped' ? [[w.setTemplateId, w] as const] : [])));
  /** The rule's own provenance plus how it was fitted here; null when it wasn't stored (`Why?` then says `Not recorded`). */
  const ruleProvenance = (setId: string): TargetProvenance | null => {
    const templateId = out.setTemplateIds[setId];
    const rule = templateId === undefined ? undefined : ruleOf.get(templateId)?.provenance;
    if (templateId === undefined || rule === undefined) return null;
    const w = warningOf.get(templateId);
    const slotId = slotOfTemplate.get(templateId);
    const fit = w ? startWarningNote(w, (slotId === undefined ? null : equipmentOfSlot.get(slotId)) ?? null, 'Target') : null;
    return fitProvenance(fit === null ? rule : { ...rule, guardNotes: [...rule.guardNotes, fit] });
  };
  const aggregate: SessionAggregate = {
    ...out.aggregate,
    session: { ...out.aggregate.session, routineId: input.routine.id, routineName: input.routine.name },
    sets: out.aggregate.sets.map((s) => {
      const exId = exerciseOf.get(s.sessionExerciseId);
      // Targets from the rule say so; the routine's own templates (warm-ups, Fixed pins) carry no source.
      const templateId = out.setTemplateIds[s.id];
      if (exId === undefined || !targeted.has(exId) || s.setType === 'warmup' || templateId === undefined || !ruleOf.has(templateId)) return s;
      // A coach target for next time (D21) keeps its source and its own `Why?`.
      const fromCoach = ruleOf.get(templateId)?.source === 'coach';
      const plannedSet: PlannedSet = { ...s.planned, source: fromCoach ? 'coach' : 'built_in_rule' };
      const provenance = ruleProvenance(s.id);
      if (provenance === null) delete plannedSet.provenance;
      else plannedSet.provenance = provenance;
      return { ...s, planned: plannedSet };
    }),
  };
  return { aggregate, warnings: out.warnings, snap: out.snap, setTemplateIds: out.setTemplateIds, fits: out.fits, notes, ...(input.shape !== undefined ? { shapedFrom } : {}) };
}

/**
 * One routine exercise's templates with next targets (routines.md RT3, D21).
 * - A routine from before the library: the targets carry the working sets,
 *   after the routine's warm-ups, as they always have (coach targets too: D21
 *   lets its small changes add or drop a set).
 * - A library workout is the structure: its set types, counts, reps and rest
 *   (WL7). With the built-in rule, each `Auto` set takes the load of the
 *   target for the same set (the k-th of its type, else the last of its
 *   type, else the same place overall). A Fixed set keeps its load; an Auto
 *   set with no target keeps no load.
 * - A library workout with a coach target (review B1): the target goes on
 *   the Auto rep sets of its set type (or, when the workout has none of that
 *   type, its first working type); its other types, and timed sets, take the
 *   built-in rule's loads as above. Set types are never merged.
 *   - Slot not changed since the target became active (`editedAtUtc`, the
 *     slot's `structureChangedAtUtc`, absent or ≤ the target's time): the
 *     coach's load and reps, and its set count when it chose one and the
 *     working sets are all one type.
 *   - Changed since (Ben's later edit wins, WL7): the slot's own count and
 *     reps. The coach's load is used only where its reps fit the set's range;
 *     otherwise the built-in rule's load. `Why?` says what was kept.
 * `ruleOf` collects the templates whose load came from a target.
 */
export function routineTemplatesWithTargets(
  templates: readonly SetTemplate[],
  planned: readonly NextTargetEntry[],
  o: { legacy: boolean; newId: () => string; ruleOf: Map<string, PlannedSet>; editedAtUtc?: string | undefined },
): SetTemplate[] {
  const coachEntry = planned.find((p) => p.planned.source === 'coach' && p.setType !== 'warmup');
  if (o.legacy) return legacyTemplates(templates, planned, o);
  if (coachEntry === undefined) return withRuleLoads(templates, planned, o);
  const working = templates.filter((t) => t.setType !== 'warmup');
  const matchType = working.some((t) => t.setType === coachEntry.setType) ? coachEntry.setType : working[0]?.setType;
  if (matchType === undefined) return [...templates];
  const meta = coachEntry.coach;
  const uniform = working.every((t) => t.setType === matchType);
  const unedited = o.editedAtUtc === undefined || (meta !== undefined && toMs(o.editedAtUtc) <= toMs(meta.setAtUtc));
  const shaped = unedited && meta !== undefined && meta.sets !== null && uniform ? withSetCount(templates, matchType, meta.sets, o.newId) : [...templates];
  const coachPlan = coachEntry.planned;
  const coachReps = coachPlan.reps;
  // Ben's later edit: one short `Why?` line for what of the coach's target wasn't used.
  const ofType = working.filter((t) => t.setType === matchType);
  const kept: string[] = [];
  if (!unedited && meta !== undefined && meta.sets !== null && uniform && meta.sets !== ofType.length) kept.push(`${String(ofType.length)} ${ofType.length === 1 ? 'set' : 'sets'}`);
  if (!unedited && coachReps !== null) {
    const ranges = [...new Set(ofType.flatMap((t) => (t.targetLoad === null && t.targetReps !== null && !sameRange(t.targetReps, coachReps) ? [repRangeText(t.targetReps)] : [])))];
    if (ranges.length > 0) kept.push(`${ranges.join(', ')} reps`);
  }
  const note = kept.length > 0 ? `Kept your edit: ${kept.join(', ')}` : null;
  const coachHere = note === null ? coachPlan : withGuardNote(coachPlan, note);
  const coached = shaped.map((t) => {
    if (t.setType !== matchType || t.targetLoad !== null || t.targetReps === null) return t;
    // Changed since: the coach's load only where its reps fit Ben's range (else the built-in rule's, below).
    if (!unedited && (coachReps === null || !fitsRange(coachReps, t.targetReps))) return t;
    const id = o.newId();
    o.ruleOf.set(id, coachHere);
    return unedited ? { ...t, id, targetLoad: coachPlan.load, targetReps: coachReps ?? t.targetReps } : { ...t, id, targetLoad: coachPlan.load };
  });
  // The workout's other set types (a back-off after a top set), its timed sets and, after Ben's edit,
  // sets the coach's reps don't fit keep the built-in rule's loads.
  const builtIn = meta?.builtIn ?? planned.filter((p) => p.planned.source !== 'coach');
  const fromCoach = new Set(coached.filter((t) => o.ruleOf.get(t.id)?.source === 'coach').map((t) => t.id));
  const before = new Set(coached.map((t) => t.id));
  const out = withRuleLoads(coached, builtIn, o, (t) => !fromCoach.has(t.id));
  if (note !== null) {
    for (const t of out) {
      const rule = t.setType === matchType && !before.has(t.id) ? o.ruleOf.get(t.id) : undefined;
      if (rule !== undefined) o.ruleOf.set(t.id, withGuardNote(rule, note));
    }
  }
  return out;
}

const sameRange = (a: { min: number; max: number }, b: { min: number; max: number }): boolean => a.min === b.min && a.max === b.max;
/** The coach's reps sit inside Ben's range (so the load it chose for them suits his sets). */
const fitsRange = (coach: { min: number; max: number }, range: { min: number; max: number }): boolean => coach.min >= range.min && coach.max <= range.max;

function withGuardNote(p: PlannedSet, note: string): PlannedSet {
  if (p.provenance === undefined) return p;
  return { ...p, provenance: { ...p.provenance, guardNotes: [...p.provenance.guardNotes, note].slice(-10) } };
}

/**
 * A routine from before the library is planned set for set from its last
 * workout's next targets. A set count Ben changed for that day only (§11,
 * `todayEdits.edited` with `sets`) isn't the workout's: those slots go back
 * to the routine's own working-set count (TE-B13, review S1). Extra targets
 * are dropped from the end; missing ones repeat the last working target.
 * Library workouts are already planned from their own structure: unchanged.
 */
export function withoutTodayOnlySets(
  targets: ReadonlyMap<string, readonly NextTargetEntry[]>,
  routine: Pick<Routine, 'exercises' | 'source'>,
  lastTodayEdits: Pick<SessionTodayEdits, 'edited'> | undefined,
): Map<string, readonly NextTargetEntry[]> {
  const out = new Map(targets);
  if (routine.source !== undefined) return out;
  for (const e of lastTodayEdits?.edited ?? []) {
    if (!e.kinds.includes('sets')) continue;
    const rex = routine.exercises.find((x) => x.id === e.slotKey);
    const planned = rex === undefined ? undefined : out.get(rex.exerciseId);
    if (rex === undefined || planned === undefined) continue;
    const want = rex.setTemplates.filter((t) => t.setType !== 'warmup').length;
    const working = planned.filter((p) => p.setType !== 'warmup');
    const last = working.at(-1);
    if (want < 1 || last === undefined || working.length === want) continue;
    const kept = working.length > want ? working.slice(0, want) : [...working, ...Array.from({ length: want - working.length }, () => last)];
    out.set(rex.exerciseId, [...planned.filter((p) => p.setType === 'warmup'), ...kept]);
  }
  return out;
}

/** A routine from before the library: the targets are the working sets (a stored load can't be told from a pin, so none is kept). */
function legacyTemplates(templates: readonly SetTemplate[], planned: readonly NextTargetEntry[], o: { newId: () => string; ruleOf: Map<string, PlannedSet> }): SetTemplate[] {
  return [
    ...templates.filter((t) => t.setType === 'warmup'),
    ...planned.map((p) => {
      const id = o.newId();
      o.ruleOf.set(id, p.planned);
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
  ];
}

/**
 * The workout's templates with the built-in rule's loads on its Auto sets
 * (only those `include` picks; all by default). Fixed sets and warm-ups
 * stay as they are.
 */
function withRuleLoads(
  templates: readonly SetTemplate[],
  planned: readonly { setType: SetType; planned: PlannedSet }[],
  o: { newId: () => string; ruleOf: Map<string, PlannedSet> },
  include: (t: SetTemplate) => boolean = () => true,
): SetTemplate[] {
  const work = planned.filter((p) => p.setType !== 'warmup' && p.planned.source !== 'coach');
  const seen = new Map<SetType, number>();
  let overall = 0;
  return templates.map((t) => {
    if (t.setType === 'warmup') return t;
    const k = seen.get(t.setType) ?? 0;
    seen.set(t.setType, k + 1);
    const place = overall;
    overall += 1;
    if (t.targetLoad !== null || !include(t)) return t;
    const sameType = work.filter((p) => p.setType === t.setType);
    const target = sameType[k] ?? sameType[sameType.length - 1] ?? work[place] ?? work[work.length - 1];
    if (target === undefined || target.planned.load === null) return t;
    const id = o.newId();
    o.ruleOf.set(id, target.planned);
    return { ...t, id, targetLoad: target.planned.load };
  });
}

/**
 * The coach's set count on a one-type workout: extra sets copy the last set
 * of that type (as Auto), placed after it; fewer sets drop Auto sets from
 * the end. Fixed sets are Ben's and never dropped; at least one set stays.
 */
function withSetCount(templates: readonly SetTemplate[], setType: SetType, count: number, newId: () => string): SetTemplate[] {
  const ofType = templates.filter((t) => t.setType === setType);
  const last = ofType[ofType.length - 1];
  if (last === undefined || count === ofType.length) return [...templates];
  if (count > ofType.length) {
    const at = templates.indexOf(last) + 1;
    const extra = Array.from({ length: count - ofType.length }, () => ({ ...last, id: newId(), targetLoad: null }));
    return [...templates.slice(0, at), ...extra, ...templates.slice(at)];
  }
  const drop = new Set<string>();
  for (const t of [...ofType].reverse()) {
    if (ofType.length - drop.size <= Math.max(1, count)) break;
    if (t.targetLoad === null) drop.add(t.id);
  }
  return templates.filter((t) => !drop.has(t.id));
}

/** A load as plain text (`32.5 kg each`, `Assist 30 kg`). */
function loadWord(l: Load, eq: EquipmentInstance | null = null): string {
  return loadText(l, l.convention, eq).replaceAll(NBSP, ' ');
}

/**
 * Routine Start's notes from the shared fit, one per exercise and text, in
 * workout order. Worded against the plan (never "last time"); a restore or a
 * pain hold says nothing at Start.
 */
export function routineStartNotes(snap: SnapResult): RepeatNote[] {
  const notes: RepeatNote[] = [];
  const seen = new Set<string>();
  for (const slot of snap.slots) {
    const eq = slot.equipment;
    for (const note of slot.notes) {
      const top = note.top;
      const req = top.intended;
      let text: string | null = null;
      if (req !== null) {
        const assisted = loadDirection(req.convention) === 'assistance';
        const plan = loadWord(req);
        switch (note.kind) {
          case 'rounded':
            text = top.load ? roundedWords({ was: 'plan', load: plan }) : null;
            break;
          case 'converted':
            text = top.load ? convertedWords(plan) : null;
            break;
          case 'capped':
            // Held at the easy end: the most a bar makes, the least assistance a machine gives.
            text = top.load ? withWas(boundWords(assisted ? 'min' : 'max', assisted ? `${formatNumber(top.load.value)} ${top.load.unit}` : loadWord(top.load, eq), assisted), 'plan', plan) : null;
            break;
          case 'restored':
          case 'pain':
            text = null;
            break;
          case 'dropped':
            if (note.reason === 'pain_flag') {
              text = null;
              break;
            }
            text = noLoadWords(note.reason, { equipmentName: note.equipmentName, unit: req.unit, requested: assisted ? `${formatNumber(req.value)} ${req.unit}` : plan, assisted });
            if (note.reason !== 'lightest_is_harder') text = withWas(text, 'plan', plan);
            break;
        }
      }
      if (text === null) continue;
      const key = `${slot.exerciseName}|${text}`;
      if (!seen.has(key)) notes.push({ exerciseName: slot.exerciseName, text, tone: note.kind === 'dropped' ? 'warning' : 'info' });
      seen.add(key);
    }
  }
  return notes;
}

/**
 * `Change Push A too ›` → Apply (overview-today-edits TE4): the routine with
 * one slot's exercise replaced. Its item is cleared (the shared fit maps one
 * at each gym, GS3) and its template loads go back to automatic: never
 * converted from the old exercise's load (rule 4). Sets, reps, effort and
 * rest are kept. Versioned and idempotent like every routine change.
 */
export function swapRoutineSlot(
  current: Routine,
  slotKey: string,
  to: Pick<Exercise, 'id' | 'name'>,
  expectedVersion: number,
  opId: string,
  at: ZonedTimestamp,
): RoutineChange | { kind: 'invalid'; message: string } {
  if (current.lastOpId === opId) return { kind: 'duplicate', current };
  // A card shown before the routine moved is out of date, whatever it would change (CR4).
  if (current.version !== expectedVersion) return { kind: 'stale', current };
  const slot = current.exercises.find((e) => e.id === slotKey);
  if (slot === undefined) return { kind: 'invalid', message: 'That exercise isn’t in the workout any more.' };
  if (slot.exerciseId === to.id) return { kind: 'invalid', message: 'Already in the workout.' };
  const replaced: RoutineExercise = {
    ...slot,
    exerciseId: to.id,
    equipmentId: null,
    progressionRuleId: null,
    setTemplates: slot.setTemplates.map((t) => ({ ...t, targetLoad: null })),
    structureChangedAtUtc: at.utc,
  };
  return change(current, expectedVersion, opId, at, { exercises: current.exercises.map((e) => (e.id === slotKey ? replaced : e)) });
}
