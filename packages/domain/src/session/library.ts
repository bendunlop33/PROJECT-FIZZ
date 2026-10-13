import type { EquipmentInstance, Exercise, Load, RepRange, RestSetting, Routine, RoutineExercise, SessionAggregate, SetTemplate, SetType, ZonedTimestamp } from '@fizz/schemas';

import { dayMonthText } from '../display';
import { weekdayOf } from '../calendar';
import { equipmentForExercise, needsNoEquipment } from '../exercise-equipment';

import { toMs } from '../time';
import { isDeleted, isDistanceSet, isInRotation, rotationRoutines, ROUTINE_NAME_MAX, routineCounts, routineWrite, withDefaultMain, type RoutineChange } from './routines';
import { formatLastDone, routineTypeKey, type SessionType } from './session-types';
import { blockSets, partRootOf } from './gym-switch';

/**
 * The Workouts library (routines.md Part A). Pure: creating, editing,
 * duplicating and the rotation membership of saved workouts, with
 * validation, change lines for the record, and the library list's view.
 * Code and data say `Routine`; only the UI says `Workouts` (WL1). Every
 * write is versioned and idempotent through `routineWrite` (WL10, rule 5).
 */

function exercisesWord(n: number): string {
  return `${String(n)} ${n === 1 ? 'exercise' : 'exercises'}`;
}

export const ROUTINE_MAX_EXERCISES = 40;
export const ROUTINE_MAX_SETS = 30;
/** Superset size (routines.md §4.3). */
export const SUPERSET_MAX = 4;

/** What a workout is made of in the editor. */
export interface RoutineEdit {
  name: string;
  exercises: readonly RoutineExercise[];
}

export type RoutineIssue =
  | 'Add a name'
  | 'Keep it under 120 characters'
  | 'Add an exercise'
  | 'Add at least one set.'
  | 'Reps: the first number must be the smaller one.'
  | 'Add a target to every set.'
  | 'Up to 40 exercises'
  | 'Up to 30 sets per exercise'
  | 'Can’t save distance yet';

/**
 * Whether an exercise is measured in distance. A saved workout's set
 * template has no distance target, so a distance slot is refused rather
 * than saved as reps (exercise-library EL-B13; review library-browse r2 S1).
 */
export type IsDistanceExercise = (exerciseId: string) => boolean;

/**
 * Why a workout can't be saved yet, first issue first (routines.md §3.3,
 * A6): a name, at least one exercise, at least one set each, reps min ≤
 * max, a rep or time target on every set, at most 40 exercises and 30 sets,
 * and no exercise measured in distance (`isDistance`, EL-B13).
 */
export function routineIssues(edit: RoutineEdit, isDistance?: IsDistanceExercise): RoutineIssue[] {
  const out: RoutineIssue[] = [];
  const name = edit.name.trim();
  if (name.length === 0) out.push('Add a name');
  else if (name.length > ROUTINE_NAME_MAX) out.push('Keep it under 120 characters');
  if (edit.exercises.length === 0) out.push('Add an exercise');
  if (edit.exercises.length > ROUTINE_MAX_EXERCISES) out.push('Up to 40 exercises');
  if (isDistance !== undefined && edit.exercises.some((e) => isDistance(e.exerciseId))) out.push('Can’t save distance yet');
  const sets = edit.exercises.flatMap((e) => e.setTemplates);
  if (edit.exercises.some((e) => e.setTemplates.length === 0)) out.push('Add at least one set.');
  if (sets.some((t) => t.targetReps !== null && t.targetReps.min > t.targetReps.max)) out.push('Reps: the first number must be the smaller one.');
  if (sets.some((t) => t.targetReps === null && t.targetDurationS === null)) out.push('Add a target to every set.');
  if (edit.exercises.some((e) => e.setTemplates.length > ROUTINE_MAX_SETS)) out.push('Up to 30 sets per exercise');
  return out;
}

const LETTERS = 'ABCDEFGH';

/**
 * Exercises as they are stored: `order` 0…n in array order, and supersets
 * as runs of neighbours (a label on members that aren't next to each other
 * is split; a group of one is no group), labelled `A`, `B`, … in order.
 */
export function normaliseRoutineExercises(exercises: readonly RoutineExercise[]): RoutineExercise[] {
  const runs: { label: string | null; members: number[] }[] = [];
  exercises.forEach((e, i) => {
    const last = runs[runs.length - 1];
    if (e.supersetGroup !== null && last !== undefined && last.label === e.supersetGroup && last.members.length < SUPERSET_MAX) last.members.push(i);
    else runs.push({ label: e.supersetGroup, members: [i] });
  });
  const labelOf = new Map<number, string | null>();
  let next = 0;
  for (const run of runs) {
    const grouped = run.label !== null && run.members.length > 1;
    const label = grouped ? (LETTERS[next] ?? null) : null;
    if (grouped) next += 1;
    for (const i of run.members) labelOf.set(i, label);
  }
  return exercises.map((e, i) => ({ ...e, order: i, supersetGroup: labelOf.get(i) ?? null }));
}

export type RoutineCreate = { kind: 'write'; next: Routine } | { kind: 'invalid'; message: RoutineIssue };

/** `New workout` → `Save` (routines.md §A4.2): source `ben`, `Main` written down, in the rotation only when asked. */
export function createRoutine(input: {
  id: string;
  ownerId: string;
  edit: RoutineEdit;
  opId: string;
  at: ZonedTimestamp;
  isCompound: (exerciseId: string) => boolean;
  /** Refuses distance slots (EL-B13). */
  isDistance?: IsDistanceExercise;
  inRotation?: boolean;
}): RoutineCreate {
  const issue = routineIssues(input.edit, input.isDistance)[0];
  if (issue !== undefined) return { kind: 'invalid', message: issue };
  const on = input.inRotation === true;
  return {
    kind: 'write',
    next: {
      id: input.id,
      ownerId: input.ownerId,
      version: 1,
      createdAtUtc: input.at.utc,
      updatedAtUtc: input.at.utc,
      name: input.edit.name.trim(),
      exercises: withDefaultMain(normaliseRoutineExercises(input.edit.exercises), input.isCompound),
      createdFromSessionId: null,
      deletedAtUtc: null,
      lastOpId: input.opId,
      source: 'ben',
      inRotation: on,
      ...(on ? { rotationAtUtc: input.at.utc } : {}),
    },
  };
}

/**
 * `Save to Workouts` → `Edit ›` → `Save` (routines.md §A2.5, WL-A18): the
 * unsaved copy `made` (from a finished workout, Repeat, an overview or a coach
 * draft) with the editor's name and exercises. Everything else `made` carries
 * stays: its ID, version 1, opId, rotation choice, history link and coach
 * draft link. Saving from the editor makes it Ben's (as `editRoutine`).
 */
export function withSaveEdit(made: Routine, edit: RoutineEdit, isCompound: (exerciseId: string) => boolean, isDistance?: IsDistanceExercise): RoutineCreate {
  const issue = routineIssues(edit, isDistance)[0];
  if (issue !== undefined) return { kind: 'invalid', message: issue };
  return {
    kind: 'write',
    next: { ...made, name: edit.name.trim(), exercises: withDefaultMain(normaliseRoutineExercises(edit.exercises), isCompound), source: 'ben' },
  };
}

/**
 * The editor's `Save` on a stored workout (§A4.2): name and exercises, with
 * `Main` written down. Saving makes a coach workout Ben's (WB8). The
 * rotation, history link and tombstone are untouched. A retry of the same
 * save is a duplicate; an older `expectedVersion` is stale (rule 5).
 */
export function editRoutine(
  current: Routine,
  edit: RoutineEdit,
  expectedVersion: number,
  opId: string,
  at: ZonedTimestamp,
  isCompound: (exerciseId: string) => boolean,
  isDistance?: IsDistanceExercise,
): RoutineChange {
  if (current.lastOpId === opId) return { kind: 'duplicate', current };
  if (current.version !== expectedVersion) return { kind: 'stale', current };
  const issue = routineIssues(edit, isDistance)[0];
  if (issue !== undefined) return { kind: 'invalid', message: issue };
  return routineWrite(current, expectedVersion, opId, at, {
    name: edit.name.trim(),
    exercises: withStructureTimes(editableExercises(current), withDefaultMain(normaliseRoutineExercises(edit.exercises), isCompound), at.utc),
    source: 'ben',
  });
}

function withoutStructureTime(e: RoutineExercise): RoutineExercise {
  const out = { ...e };
  delete out.structureChangedAtUtc;
  return out;
}

function sameLoad(a: Load | null, b: Load | null): boolean {
  if (a === null || b === null) return a === b;
  return a.value === b.value && a.unit === b.unit && a.convention === b.convention;
}

function sameReps(a: RepRange | null, b: RepRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.min === b.min && a.max === b.max;
}

/**
 * Whether a slot's structure for a coach target (WL7) is the same: its
 * exercise and its sets' types, reps, work time and Fixed loads. Fields are
 * compared one by one, so key order never makes an unchanged slot "changed"
 * (review N12).
 */
export function sameStructure(a: RoutineExercise, b: RoutineExercise): boolean {
  if (a.exerciseId !== b.exerciseId || a.setTemplates.length !== b.setTemplates.length) return false;
  return a.setTemplates.every((t, i) => {
    const u = b.setTemplates[i];
    return u !== undefined && t.setType === u.setType && t.targetDurationS === u.targetDurationS && sameLoad(t.targetLoad, u.targetLoad) && sameReps(t.targetReps, u.targetReps);
  });
}

/**
 * Each slot's `structureChangedAtUtc` after an editor save (review S1): now
 * for a new slot or one whose structure changed, else as it was. Rest,
 * `Main`, supersets, order and the name don't count. `before`: the stored
 * workout as the editor opened it (`editableExercises`).
 */
export function withStructureTimes(before: readonly RoutineExercise[], after: readonly RoutineExercise[], atUtc: string): RoutineExercise[] {
  const was = new Map(before.map((e) => [e.id, e]));
  return after.map((e) => {
    const prior = was.get(e.id);
    const changed = prior === undefined || !sameStructure(prior, e);
    const keep = changed ? atUtc : prior.structureChangedAtUtc;
    return keep === undefined ? withoutStructureTime(e) : { ...e, structureChangedAtUtc: keep };
  });
}

/**
 * `Duplicate` (§4.4): a copy with new IDs throughout, named `<name> copy`,
 * source `ben`, linked to the original, never in the rotation and with no
 * history of its own (it starts `New`).
 */
export function duplicateRoutine(current: Routine, input: { id: string; opId: string; at: ZonedTimestamp; newId: () => string; isCompound: (exerciseId: string) => boolean }): Routine {
  const name = `${current.name.trim()} copy`.slice(0, ROUTINE_NAME_MAX).trim();
  // A copy has no history of its own, so no structure time either.
  const exercises = current.exercises.map(withoutStructureTime).map((e) => ({ ...e, id: input.newId(), setTemplates: e.setTemplates.map((t) => ({ ...t, id: input.newId() })) }));
  // A copy of a routine from before the library keeps no loads: they were last time's actuals, not Fixed pins.
  const plain = current.source === undefined ? exercises.map((e) => ({ ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: null })) })) : exercises;
  return {
    id: input.id,
    ownerId: current.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name,
    exercises: withDefaultMain(plain, input.isCompound),
    createdFromSessionId: null,
    createdFromRoutineId: current.id,
    deletedAtUtc: null,
    lastOpId: input.opId,
    source: 'ben',
    inRotation: false,
  };
}

/**
 * `Add to rotation` / `Remove from rotation` (RT9). Adding puts it at the
 * end, unless `placeAtUtc` (an Undo of a removal) puts it back where it was.
 */
export function setRoutineRotation(current: Routine, on: boolean, expectedVersion: number, opId: string, at: ZonedTimestamp, placeAtUtc: string | null = null): RoutineChange {
  if (current.lastOpId === opId) return { kind: 'duplicate', current };
  if (current.version !== expectedVersion) return { kind: 'stale', current };
  if (isDeleted(current)) return { kind: 'invalid', message: 'That workout was deleted.' };
  if (isInRotation(current) === on) return { kind: 'invalid', message: on ? 'Already in your rotation.' : 'Not in your rotation.' };
  return routineWrite(current, expectedVersion, opId, at, on ? { inRotation: true, rotationAtUtc: placeAtUtc ?? at.utc } : { inRotation: false, rotationAtUtc: current.rotationAtUtc ?? current.createdAtUtc });
}

/**
 * The editor as it opens a stored workout: a routine from before the
 * library shows `Auto` loads (its stored loads were last time's actuals,
 * which next targets always replaced; saving would otherwise pin them).
 */
export function editableExercises(r: Routine): RoutineExercise[] {
  const sorted = [...r.exercises].sort((a, b) => a.order - b.order);
  return r.source === undefined ? sorted.map((e) => ({ ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: null })) })) : sorted;
}

/**
 * A stored workout as the editor works on it (`editableExercises`). Both the
 * editor's base and a newer version for `Keep both` go through it, so a
 * workout from before the library compares Auto with Auto and its stale
 * actual loads never become Fixed pins (review S3).
 */
export function editableEdit(r: Routine): RoutineEdit {
  return { name: r.name, exercises: editableExercises(r) };
}

export interface RoutineChangeLine {
  change: 'swap' | 'add' | 'remove' | 'reorder' | 'edit';
  text: string;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The parts of a slot the editor changes, for comparing (IDs and order aside). */
function slotShape(e: RoutineExercise): unknown {
  return {
    exerciseId: e.exerciseId,
    main: e.main ?? null,
    supersetGroup: e.supersetGroup,
    rest: e.restBySetType,
    sets: e.setTemplates.map((t: SetTemplate) => [t.setType, t.targetLoad, t.targetReps, t.targetDurationS, t.restOverrideS]),
  };
}

/**
 * What an editor save changed, as the record's lines (1–6): renamed,
 * exercises added, removed, replaced and reordered, then `N edited`.
 */
export function routineChangeLines(before: RoutineEdit, after: RoutineEdit, nameOf: (exerciseId: string) => string): RoutineChangeLine[] {
  const lines: RoutineChangeLine[] = [];
  if (before.name.trim() !== after.name.trim()) lines.push({ change: 'edit', text: `Renamed to ${after.name.trim()}`.slice(0, 200) });
  const beforeIds = new Map(before.exercises.map((e) => [e.id, e]));
  const afterIds = new Set(after.exercises.map((e) => e.id));
  for (const e of after.exercises) {
    const was = beforeIds.get(e.id);
    if (was === undefined) lines.push({ change: 'add', text: `Added ${nameOf(e.exerciseId)}` });
    else if (was.exerciseId !== e.exerciseId) lines.push({ change: 'swap', text: `${nameOf(was.exerciseId)} → ${nameOf(e.exerciseId)}` });
  }
  for (const e of before.exercises) if (!afterIds.has(e.id)) lines.push({ change: 'remove', text: `Removed ${nameOf(e.exerciseId)}` });
  const kept = (list: readonly RoutineExercise[]) => [...list].sort((a, b) => a.order - b.order).filter((e) => beforeIds.has(e.id) && afterIds.has(e.id)).map((e) => e.id);
  if (!sameJson(kept(before.exercises), kept(after.exercises))) lines.push({ change: 'reorder', text: 'New order' });
  const edited = after.exercises.filter((e) => {
    const was = beforeIds.get(e.id);
    return was !== undefined && was.exerciseId === e.exerciseId && !sameJson(slotShape(was), slotShape(e));
  });
  if (edited.length === 1 && edited[0] !== undefined) lines.push({ change: 'edit', text: `${nameOf(edited[0].exerciseId)} edited` });
  else if (edited.length > 1) lines.push({ change: 'edit', text: `${String(edited.length)} exercises edited` });
  if (lines.length === 0) lines.push({ change: 'edit', text: 'Saved' });
  if (lines.length > 6) return [...lines.slice(0, 5), { change: 'edit', text: `${String(lines.length - 5)} more changes` }];
  return lines.map((l) => ({ ...l, text: l.text.slice(0, 200) }));
}

/** Whether the editor's workout differs from the stored one (Save reads `No changes` otherwise). */
export function routineEditDirty(stored: RoutineEdit, edit: RoutineEdit): boolean {
  if (stored.name.trim() !== edit.name.trim()) return true;
  if (stored.exercises.length !== edit.exercises.length) return true;
  return stored.exercises.some((e, i) => {
    const o = edit.exercises[i];
    return o === undefined || o.id !== e.id || !sameJson(slotShape(e), slotShape(o));
  });
}

// ---------------------------------------------------------------------------
// Save what the overview shows (routines.md §A2.6, WL6, WL7)

export interface RoutineFromPlanInput {
  id: string;
  ownerId: string;
  name: string;
  opId: string;
  /** The overview's planned workout (`planWithTodayEdits`' aggregate): today's edits applied, nothing started. */
  plan: SessionAggregate;
  at: ZonedTimestamp;
  newId: () => string;
  isCompound: (exerciseId: string) => boolean;
  inRotation?: boolean;
  /** Sets whose load Ben set by hand today (overview-today-edits §11, slice B): kept as Fixed. Every other load is `Auto`. */
  fixedSetIds?: ReadonlySet<string>;
  /** A next session's source workout, so the new workout keeps its history (WL5). Null for a routine's plan. */
  createdFromSessionId?: string | null;
  /** The saved workout's own settings, when the plan is a saved workout's (`planSettingsOfRoutine`; review S2). */
  fromRoutine?: PlanRoutineSettings;
  /**
   * Keep each working set's planned target RPE (workout-builder BD12: a coach
   * draft's RPE is part of its structure). Warm-ups and drop sets keep none.
   */
  keepTargetRpe?: boolean;
}

/**
 * What a saved workout's plan keeps from the workout itself when it is saved
 * as a new one (review S2, N9): Ben's Fixed pins (by planned set, the
 * workout's own unfitted load), and per row its `Main` and its item (null:
 * mapped at each gym).
 */
export interface PlanRoutineSettings {
  pins: ReadonlyMap<string, Load>;
  rows: ReadonlyMap<string, { main: boolean | undefined; equipmentId: string | null }>;
}

/**
 * `PlanRoutineSettings` for a saved workout's plan: `slotOf` (session row →
 * `RoutineExercise.id`) and `setTemplateIds` (planned set → template) from
 * the planner. A row swapped today keeps its `Main` but not the pins or the
 * item (they belong to the other exercise). A workout from before the
 * library has no pins (its stored loads are last time's actuals).
 */
export function planSettingsOfRoutine(routine: Pick<Routine, 'exercises' | 'source'>, plan: Pick<SessionAggregate, 'exercises' | 'sets'>, slotOf: Readonly<Record<string, string>>, setTemplateIds: Readonly<Record<string, string>>): PlanRoutineSettings {
  const slots = new Map(routine.exercises.map((e) => [e.id, e]));
  const pins = new Map<string, Load>();
  const rows = new Map<string, { main: boolean | undefined; equipmentId: string | null }>();
  for (const sx of plan.exercises) {
    const key = slotOf[sx.id];
    const slot = key === undefined ? undefined : slots.get(key);
    if (slot === undefined) continue;
    const same = slot.exerciseId === sx.exerciseId;
    rows.set(sx.id, { main: slot.main, equipmentId: same ? slot.equipmentId : null });
    if (!same || routine.source === undefined) continue;
    const templates = new Map(slot.setTemplates.map((t) => [t.id, t]));
    for (const set of plan.sets) {
      if (set.sessionExerciseId !== sx.id) continue;
      const templateId = setTemplateIds[set.id];
      const load = templateId === undefined ? null : (templates.get(templateId)?.targetLoad ?? null);
      if (load !== null) pins.set(set.id, load);
    }
  }
  return { pins, rows };
}

/**
 * `routineFromPlan` (§A6): a new workout from exactly what the overview
 * shows. Slots in shown order; skipped slots and skipped sets left out (any
 * reason); set types and counts, rep ranges or work time, rest by set type
 * and supersets as planned. Loads are `Auto` except the sets in
 * `fixedSetIds` and a saved workout's own Fixed pins (`fromRoutine`, which
 * also keeps each row's `Main` and item). Rest: only the workout's own
 * set-type presets and per-set overrides are copied; rest from the
 * exercise or global default is left to fall through (review S5). An
 * exercise with only warm-ups left is left out. Null when nothing is left
 * (`Nothing to save`). The plan is never changed.
 */
export function routineFromPlan(input: RoutineFromPlanInput): Routine | null {
  const src = input.plan;
  const fixed = input.fixedSetIds ?? new Set<string>();
  const roots = [...src.exercises].sort((a, b) => a.order - b.order).filter((sx) => partRootOf(src.exercises, sx.id) === sx.id);
  const exercises: RoutineExercise[] = [];
  for (const sx of roots) {
    const sets = blockSets(src, sx.id).filter((s) => s.status === 'pending' && s.pairedWithSetId === null);
    if (sets.every((s) => s.setType === 'warmup')) continue;
    const templates: SetTemplate[] = [];
    const restBySetType: Partial<Record<SetType, RestSetting>> = {};
    const row = input.fromRoutine?.rows.get(sx.id);
    for (const s of sets) {
      const p = s.planned;
      if ((p.reps === null && p.durationS === null) || isDistanceSet(sx, p)) continue;
      const pin = input.fromRoutine?.pins.get(s.id) ?? null;
      templates.push({
        id: input.newId(),
        setType: s.setType,
        targetLoad: fixed.has(s.id) ? p.load : pin,
        targetReps: p.reps === null ? null : { ...p.reps },
        targetDurationS: p.reps === null ? p.durationS : null,
        targetRpe: input.keepTargetRpe === true && s.setType !== 'warmup' && s.setType !== 'drop' ? p.rpe : null,
        targetRir: null,
        restOverrideS: s.rest.source === 'set_override' ? s.rest.seconds : null,
      });
      if (restBySetType[s.setType] === undefined && s.rest.source === 'routine_set_type') restBySetType[s.setType] = { seconds: s.rest.seconds };
    }
    if (templates.length === 0 || templates.every((t) => t.setType === 'warmup')) continue;
    exercises.push({
      id: input.newId(),
      exerciseId: sx.exerciseId,
      equipmentId: row === undefined ? sx.equipmentId : row.equipmentId,
      ...(row?.main !== undefined ? { main: row.main } : {}),
      order: exercises.length,
      supersetGroup: sx.supersetGroup,
      setTemplates: templates.slice(0, ROUTINE_MAX_SETS),
      restBySetType,
      transitionRestS: sx.transitionRestS,
      progressionRuleId: sx.progressionRuleId,
    });
  }
  if (exercises.length === 0) return null;
  const on = input.inRotation === true;
  return {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.name.trim().slice(0, ROUTINE_NAME_MAX),
    exercises: withDefaultMain(normaliseRoutineExercises(exercises.slice(0, ROUTINE_MAX_EXERCISES)), input.isCompound),
    createdFromSessionId: input.createdFromSessionId ?? null,
    deletedAtUtc: null,
    lastOpId: input.opId,
    source: 'ben',
    inRotation: on,
    ...(on ? { rotationAtUtc: input.at.utc } : {}),
  };
}

/**
 * `⚠ 1 not here` (§A2.1): exercises that need equipment this gym has none
 * of. An exercise missing from Ben's list and the catalogue counts too (it
 * can't be checked at all).
 */
export function routineGymIssues(r: Pick<Routine, 'exercises'>, exercises: ReadonlyMap<string, Pick<Exercise, 'defaultLoadConvention' | 'compatibleEquipment'>>, gym: readonly EquipmentInstance[]): number {
  return r.exercises.filter((e) => {
    const info = exercises.get(e.exerciseId);
    if (info === undefined) return true;
    return !needsNoEquipment(info) && equipmentForExercise(info, gym).length === 0;
  }).length;
}

const WEEKDAY_WORD: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** The save sheet's name for a workout with none (§A2.5): `Workout · Sun 11 Oct`. */
export function unnamedWorkoutName(at: ZonedTimestamp): string {
  return `Workout · ${WEEKDAY_WORD[weekdayOf(toMs(at.utc), at.tz)] ?? ''} ${dayMonthText(at.utc, at.tz)}`;
}

/** What the save sheet will save (§A2.5): `5 exercises · 15 sets`. */
export function saveSheetDetail(r: Pick<Routine, 'exercises'>): string {
  const c = routineCounts(r);
  return `${exercisesWord(c.exercises)} · ${String(c.sets)} ${c.sets === 1 ? 'set' : 'sets'}`;
}

// ---------------------------------------------------------------------------
// The list (routines.md §A2.1)

export interface LibraryRoutineInput {
  routine: Routine;
  /** `≈ N min` at the selected gym (`estimateRemainingDuration`), or null. */
  minutes: number | null;
  /** Exercises with no equipment for them at the selected gym (`⚠ 1 not here`). */
  gymIssues: number;
}

export type LibrarySort = 'recent' | 'az';

export interface LibraryViewInput {
  /** Live workouts. */
  routines: readonly LibraryRoutineInput[];
  /** `deriveSessionTypes` (routines first; a history type matching a workout's name is that workout's, WL5). */
  types: readonly SessionType[];
  /** The rotation's Up next, when it is a workout. */
  upNextRoutineId: string | null;
  now: ZonedTimestamp;
  sort: LibrarySort;
  /** `Show all (14)` tapped. */
  showAllHistory: boolean;
}

export interface LibraryRow {
  routineId: string;
  name: string;
  version: number;
  inRotation: boolean;
  upNext: boolean;
  /** `Coach` / `Imported`; Ben's own carry none (minimal copy). */
  sourceTag: 'Coach' | 'Imported' | null;
  exercises: number;
  sets: number;
  minutes: number | null;
  lastDone: ZonedTimestamp | null;
  /** Line 2 without the gym problem: `6 exercises · ≈ 60 min · 6 days ago`, `New · 4 exercises · ≈ 40 min`. */
  detail: string;
  /** `1 not here` (shown with the warning icon in place of last done), or null. */
  issue: string | null;
  accessibilityLabel: string;
}

export interface LibraryHistoryRow {
  key: string;
  label: string;
  sourceSessionId: string;
  exercises: number;
  lastDone: ZonedTimestamp;
  /** A row tap opens its overview; an imported-only type can't be started yet (P-I3), only saved. */
  startable: boolean;
  detail: string;
  accessibilityLabel: string;
}

export interface LibraryView {
  rotation: LibraryRow[];
  all: LibraryRow[];
  history: LibraryHistoryRow[];
  /** History rows behind `Show all (N)`: N is the full count; 0 when all show. */
  historyTotal: number;
  state: 'empty' | 'history_only' | 'normal';
}

/** History rows shown before `Show all (N)` (§A2.1). */
export const LIBRARY_HISTORY_CAP = 10;

const minutesWord = (m: number): string => `≈ ${String(m)} min`;

function sayLastDone(at: ZonedTimestamp | null, now: ZonedTimestamp): string {
  return at === null ? 'not done yet' : `last done ${formatLastDone(at, now)}`;
}

/**
 * The Workouts list (§A2.1): `YOUR ROTATION` in order from Up next, `ALL
 * WORKOUTS` (the rest; `Recent` = most recently done or made first, or
 * `A–Z`), then `FROM HISTORY` (history types that aren't saved workouts,
 * longest gap first, 10 then `Show all`). Last done counts every workout
 * of the type (WL5). Values only; the screen formats nothing.
 */
export function buildLibraryView(input: LibraryViewInput): LibraryView {
  const typeOf = new Map(input.types.map((t) => [t.key, t]));
  const row = (x: LibraryRoutineInput): LibraryRow => {
    const r = x.routine;
    const c = routineCounts(r);
    const lastDone = typeOf.get(routineTypeKey(r.id))?.lastDone ?? null;
    const upNext = input.upNextRoutineId === r.id && isInRotation(r);
    const sourceTag = r.source === 'coach' ? 'Coach' : r.source === 'imported' ? 'Imported' : null;
    const issue = x.gymIssues > 0 ? `${String(x.gymIssues)} not here` : null;
    const parts = lastDone === null ? ['New', exercisesWord(c.exercises), ...(x.minutes === null ? [] : [minutesWord(x.minutes)])] : [exercisesWord(c.exercises), ...(x.minutes === null ? [] : [minutesWord(x.minutes)]), ...(issue === null ? [formatLastDone(lastDone, input.now)] : [])];
    const said = [
      r.name,
      ...(upNext ? ['up next'] : []),
      ...(sourceTag === null ? [] : [`made by ${sourceTag === 'Coach' ? 'the coach' : 'import'}`]),
      exercisesWord(c.exercises),
      ...(x.minutes === null ? [] : [`about ${String(x.minutes)} minutes`]),
      ...(issue === null ? [] : [`${issue} at this gym`]),
      sayLastDone(lastDone, input.now),
    ];
    return {
      routineId: r.id,
      name: r.name,
      version: r.version,
      inRotation: isInRotation(r),
      upNext,
      sourceTag,
      exercises: c.exercises,
      sets: c.sets,
      minutes: x.minutes,
      lastDone,
      detail: parts.join(' · '),
      issue,
      accessibilityLabel: said.join(', '),
    };
  };
  const live = input.routines.filter((x) => !isDeleted(x.routine));
  const byId = new Map(live.map((x) => [x.routine.id, x]));
  const inOrder = rotationRoutines(live.map((x) => x.routine));
  const start = inOrder.findIndex((r) => r.id === input.upNextRoutineId);
  const fromNext = start <= 0 ? inOrder : [...inOrder.slice(start), ...inOrder.slice(0, start)];
  const rotation = fromNext.flatMap((r) => {
    const x = byId.get(r.id);
    return x === undefined ? [] : [row(x)];
  });
  const rest = live.filter((x) => !isInRotation(x.routine)).map((x) => ({ x, r: row(x) }));
  const activity = (e: { x: LibraryRoutineInput; r: LibraryRow }): number => Math.max(toMs(e.x.routine.createdAtUtc), e.r.lastDone === null ? 0 : toMs(e.r.lastDone.utc));
  const all = [...rest]
    .sort((a, b) => (input.sort === 'az' ? a.r.name.localeCompare(b.r.name, 'en', { sensitivity: 'base' }) || a.r.routineId.localeCompare(b.r.routineId) : activity(b) - activity(a) || a.r.routineId.localeCompare(b.r.routineId)))
    .map((e) => e.r);

  const historyTypes = input.types
    .filter((t): t is SessionType & { lastDone: ZonedTimestamp; sourceSessionId: string } => t.routineId === null && t.lastDone !== null && t.sourceSessionId !== null)
    .sort((a, b) => toMs(a.lastDone.utc) - toMs(b.lastDone.utc) || a.key.localeCompare(b.key));
  const shown = input.showAllHistory ? historyTypes : historyTypes.slice(0, LIBRARY_HISTORY_CAP);
  const history = shown.map((t) => ({
    key: t.key,
    label: t.label,
    sourceSessionId: t.sourceSessionId,
    exercises: t.exerciseCount,
    lastDone: t.lastDone,
    startable: t.startable,
    detail: `${exercisesWord(t.exerciseCount)} · ${formatLastDone(t.lastDone, input.now)}`,
    accessibilityLabel: [t.label, exercisesWord(t.exerciseCount), sayLastDone(t.lastDone, input.now)].join(', '),
  }));
  const state = live.length > 0 ? 'normal' : historyTypes.length > 0 ? 'history_only' : 'empty';
  return { rotation, all, history, historyTotal: historyTypes.length > shown.length ? historyTypes.length : 0, state };
}
