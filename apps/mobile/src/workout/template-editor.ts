import {
  addExercise,
  cardioValuesText,
  deleteSet,
  dropRoutineSlot,
  editableEdit,
  editorItemFor,
  editorLoadItem,
  editorMainFlags,
  fixedLoadFrame,
  fixedLoadSeed,
  fixedLoadSteps,
  isRefusedDistanceSlot,
  liveTime,
  moveExercise,
  NO_DISTANCE_IN_WORKOUTS,
  removeExercise,
  replaceExercise,
  ROUTINE_MAX_EXERCISES,
  setAddedWeight,
  gymLearnFor,
  type GymLearn,
  setMain,
  setRestBySetType,
  setSlotReps,
  setSlotTargetRpe,
  setWarmupCount,
  setWorkingSetCount,
  slotLoadConvention,
  slotRestOf,
  slotShapeOf,
  SLOT_REST_MAX_S,
  stepSlotRest,
  supersetWithNext,
  typedFixedLoad,
  ungroup,
  updateSet,
  type LiveTime,
  type RoutineEdit,
  type SlotShapeInput,
} from '@fizz/domain';
import type { EquipmentInstance, LoadConvention, Measurement, RepRange, RestSetting, Routine, RoutineExercise, SetTemplate, SetType, WeightUnit } from '@fizz/schemas';

import type { TemplateFact } from '../builder/builder-service';
import type { WorkoutRoundView, WorkoutRowView } from '../builder/builder-view';
import type { LibraryToastParam } from '../navigation/types';
import type { AppServices } from '../services/app-services';
import type { EditorExerciseInfo, LibrarySaveWrite, RoutineEditorData, RoutineEditWrite, RoutineWrite, SaveFrom, TemplateSwapWrite } from '../services/workout-services';
import { loadSpoken, loadText, restText, SET_TYPE_LABEL, type PopupRestRow, type PopupSetRow, type PopupView } from '../ui/exercise-popup-model';
import { LIBRARY_TOASTS } from './library-view';
import { saveEditRequest } from './save-edit-handoff';
import { shapeEffortRow, shapeRepsText, SET_SHAPE_COPY } from './set-shape-view';

/**
 * The one workout editor (Ben, 23 Oct: "Why does the plan builder's workout builder look so different to the usual
 * workout builder?"). A saved workout or a plan day's template is edited on Your workout's page: the same numbered
 * rounds, `3a/3b` supersets, `Exercise | Sets | Top set` rows, the shared exercise pop-up, swipe Delete / Swap, drag
 * and `＋ Add exercise`. What it edits is the workout's `RoutineExercise` list (loads `Auto` or Ben's Fixed ones,
 * reps ranges, rest by set type, a set's own rest, Main, Add weight), held on the page until `Save`, which writes one
 * version (opId, expectedVersion; rule 5) with an Undo record. Pure: values and edits; every rule is the domain's.
 */

export const TEMPLATE_COPY = {
  newTitle: 'New workout',
  name: 'Name',
  time: 'Time',
  minutes: (n: number) => `about ${String(n)} min`,
  /** (Ben, 26 Oct) `Time ±` couldn't get down to the length: the shortest it got. */
  fitOver: (n: number) => `Shortest: about ${String(n)} min`,
  fitNoChange: 'No change',
  save: 'Save',
  cancel: 'Cancel',
  main: 'Main',
  addWeight: 'Add weight',
  auto: 'Auto',
  repRange: 'Rep range',
  workTime: 'Time',
  distance: 'Distance',
  autoLoad: 'Auto load',
  restAfter: 'Rest after this set',
  useDefault: 'Default',
  deleted: (name: string) => `Deleted ${name}`,
  swapped: 'Swapped',
  undo: 'Undo',
  needsTarget: 'Add a time or distance',
  removeLastTitle: (exercise: string, workout: string) => `Remove ${exercise} from ${workout}?`,
} as const;

/** What the page knows about each exercise and the gym the workout is checked at. */
export interface TemplateEditorCtx {
  info: Readonly<Record<string, EditorExerciseInfo>>;
  facts: Readonly<Record<string, TemplateFact>>;
  gym: RoutineEditorData['gym'];
  unit: WeightUnit;
  globalDefault: RestSetting;
  effortScale: 'rpe' | 'rir' | null;
  /** The stored workout's slots: a distance slot saved before EL-B13 stays (review library-browse r3 S1). */
  stored: readonly RoutineExercise[];
}

const nameOf = (ctx: Pick<TemplateEditorCtx, 'info'>, exerciseId: string) => ctx.info[exerciseId]?.name ?? 'Exercise';
const measurementOf = (ctx: Pick<TemplateEditorCtx, 'info'>, slot: Pick<RoutineExercise, 'exerciseId'>): Measurement => ctx.info[slot.exerciseId]?.measurement ?? 'reps';
const isTimed = (t: Pick<SetTemplate, 'targetReps'>) => t.targetReps === null;
const restCtx = (slot: RoutineExercise, ctx: TemplateEditorCtx) => ({ exerciseName: nameOf(ctx, slot.exerciseId), exerciseDefaultRestS: ctx.info[slot.exerciseId]?.defaultRestS ?? null, globalDefault: ctx.globalDefault });

/** A slot's load frame at this gym: its convention, the item a Fixed load is checked on (rule 4), and its unit. */
export function slotLoadFrame(slot: RoutineExercise, ctx: Pick<TemplateEditorCtx, 'info' | 'gym' | 'unit'>): { convention: LoadConvention; frame: { unit: WeightUnit; convention: LoadConvention }; item: EquipmentInstance | null; display: EquipmentInstance | null; bodyweight: boolean } {
  const x = ctx.info[slot.exerciseId];
  const exerciseDefault = x?.defaultLoadConvention ?? 'total';
  const convention = slotLoadConvention(slot, exerciseDefault);
  const own = x !== undefined && ctx.gym !== null ? editorItemFor(slot, x, ctx.gym.equipment) : null;
  const item = x !== undefined && ctx.gym !== null ? editorLoadItem(slot, x, ctx.gym, ctx.unit) : null;
  const weighted = convention === 'added' && exerciseDefault === 'bodyweight';
  const frame = weighted ? { unit: ctx.unit, convention } : fixedLoadFrame(item, ctx.unit, convention);
  return { convention, frame, item, display: weighted ? own : item, bodyweight: convention === 'bodyweight' };
}

/** A set's load as the table shows it: `BW`, `Auto`, `100`, `30 each`, `25 assist`, `BW+10`; another unit inline. */
function loadCell(t: SetTemplate, bodyweight: boolean, headerUnit: WeightUnit): string {
  if (bodyweight) return 'BW';
  if (t.targetLoad === null) return TEMPLATE_COPY.auto;
  return loadText(t.targetLoad.value, t.targetLoad.unit, t.targetLoad.convention, headerUnit);
}

const timedText = (t: SetTemplate) => cardioValuesText({ durationS: t.targetDurationS, distanceM: t.targetDistanceM ?? null });
const repsText = (r: RepRange) => (r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`);

// ---------------------------------------------------------------------------
// The table (Your workout's rows)

export interface TemplateTableView {
  rounds: WorkoutRoundView[];
  topHeader: string;
  canAdd: boolean;
  empty: boolean;
}

/** Numbered rounds, a superset as one box lettered `a, b, c`; `Exercise | Sets | Top set (kg)` (workout-builder-v3 §2.3). */
export function templateTableView(list: readonly RoutineExercise[], ctx: TemplateEditorCtx): TemplateTableView {
  const mains = editorMainFlags(list, (id) => ctx.info[id]?.compound ?? false);
  const isDistance = (id: string) => ctx.info[id]?.measurement === 'distance';
  const runs: { start: number; slots: RoutineExercise[] }[] = [];
  list.forEach((s, i) => {
    const last = runs[runs.length - 1];
    if (last !== undefined && s.supersetGroup !== null && last.slots[0]?.supersetGroup === s.supersetGroup) last.slots.push(s);
    else runs.push({ start: i, slots: [s] });
  });
  const rounds = runs.map((run, ri): WorkoutRoundView => {
    const superset = run.slots.length > 1;
    return {
      n: ri + 1,
      superset,
      rows: run.slots.map((s, si): WorkoutRowView => {
        const at = run.start + si;
        const f = ctx.facts[s.exerciseId];
        const name = nameOf(ctx, s.exerciseId);
        const label = superset ? `${String(ri + 1)}${'abcd'.charAt(si)}` : String(ri + 1);
        const warm = s.setTemplates.filter((t) => t.setType === 'warmup').length;
        const working = s.setTemplates.length - warm;
        const top = s.setTemplates.find((t) => t.setType === 'top') ?? s.setTemplates.find((t) => t.setType !== 'warmup') ?? null;
        const lf = slotLoadFrame(s, ctx);
        const load = top === null ? '—' : loadCell(top, lf.bodyweight, ctx.unit);
        const topText = top === null ? '—' : isTimed(top) ? (top.targetLoad === null ? timedText(top) : `${timedText(top)} · ${load}`) : load;
        const issue = isRefusedDistanceSlot(s, isDistance, ctx.stored) ? NO_DISTANCE_IN_WORKOUTS : null;
        const actions: WorkoutRowView['actions'] = [
          { name: 'delete', label: 'Delete' },
          { name: 'swap', label: 'Swap' },
          ...(at > 0 ? [{ name: 'move_up' as const, label: 'Move up' }] : []),
          ...(at < list.length - 1 ? [{ name: 'move_down' as const, label: 'Move down' }] : []),
          ...(supersetWithNext(list, s.id) !== null ? [{ name: 'superset_next' as const, label: 'Superset with next' }] : []),
          ...(s.supersetGroup !== null ? [{ name: 'unlink' as const, label: 'Unlink' }] : []),
        ];
        const main = mains[at] ?? false;
        const topSpoken = top === null ? 'no sets' : isTimed(top) ? timedText(top) : lf.bodyweight ? 'bodyweight' : top.targetLoad === null ? 'top set auto' : `top set ${loadSpoken(top.targetLoad.value, top.targetLoad.unit, top.targetLoad.convention)}`;
        const spoken = [label, name, superset ? 'superset' : null, main ? 'main lift' : null, `${String(working)} ${working === 1 ? 'set' : 'sets'}`, warm > 0 ? `plus ${String(warm)} warm-up` : null, topSpoken, f?.mayHurt === true ? 'May hurt' : null, f?.notHere === true ? 'Not at this gym' : null, issue].filter((x): x is string => x !== null);
        return {
          slotKey: s.id,
          exerciseId: s.exerciseId,
          label,
          name,
          works: f?.works ?? null,
          setsText: String(working),
          warmText: warm > 0 ? `+${String(warm)} W` : null,
          topText,
          main,
          mayHurt: f?.mayHurt === true,
          notHere: f?.notHere === true,
          issue,
          linkedToNext: superset && si < run.slots.length - 1,
          accessibilityLabel: spoken.join(', '),
          actions,
        };
      }),
    };
  });
  return { rounds, topHeader: `Top set (${ctx.unit})`, canAdd: list.length < ROUTINE_MAX_EXERCISES, empty: list.length === 0 };
}

// ---------------------------------------------------------------------------
// The pop-up (the shared ExercisePopup over one slot)

export type TemplateRowAction = 'reps_range' | 'time' | 'distance' | 'auto_load' | 'rest_after';

/** The pop-up's options for a saved workout: `Main`, `Add weight` (bodyweight), the slot's `Reps` and `Target RPE`. */
export interface TemplateOptionsView {
  main: boolean;
  /** Null: not a bodyweight exercise (no `Add weight`). */
  addedWeight: boolean | null;
  reps: { label: string; text: string };
  /** Null: the effort scale is off. */
  effort: { label: string; text: string } | null;
}

export interface TemplatePopupView extends PopupView {
  options: TemplateOptionsView;
}

const REST_ORDER: readonly { type: SetType; label: string }[] = [
  { type: 'warmup', label: 'Warm-ups' },
  { type: 'top', label: 'Top set' },
  { type: 'backoff', label: 'Back-offs' },
  { type: 'working', label: 'Working sets' },
  { type: 'drop', label: 'Drops' },
];

export function templatePopupView(list: readonly RoutineExercise[], slotId: string, ctx: TemplateEditorCtx): TemplatePopupView | null {
  const at = list.findIndex((e) => e.id === slotId);
  const slot = list[at];
  if (slot === undefined) return null;
  const x = ctx.info[slot.exerciseId];
  const f = ctx.facts[slot.exerciseId];
  const lf = slotLoadFrame(slot, ctx);
  const measurement = measurementOf(ctx, slot);
  const cardio = measurement === 'cardio';
  const perSide = x?.laterality === 'unilateral';
  const shape = slotShapeOf(slot);
  const scale = ctx.effortScale;
  let n = 0;
  let w = 0;
  const rows = slot.setTemplates.map((t, i): PopupSetRow & { extraActions: { name: TemplateRowAction; label: string }[] } => {
    const mark = t.setType === 'warmup' ? 'W' : String((n += 1));
    const spokenName = t.setType === 'warmup' ? `Warm-up ${String((w += 1))}` : `Set ${mark}`;
    const timed = isTimed(t);
    // A Fixed load in another unit than the column's stays explicit: shown as `45 lb`, typed over in the column's unit.
    const otherUnit = t.targetLoad !== null && t.targetLoad.unit !== lf.frame.unit;
    const load = lf.bodyweight || t.targetLoad === null || otherUnit ? null : t.targetLoad.value;
    const rpe = scale === 'rir' ? t.targetRir : t.targetRpe;
    const reps = t.targetReps === null ? (timed ? timedText(t) : '—') : repsText(t.targetReps);
    const extra: { name: TemplateRowAction; label: string }[] = [
      ...(t.targetReps !== null ? [{ name: 'reps_range' as const, label: TEMPLATE_COPY.repRange }] : []),
      ...(timed || measurement === 'duration' || cardio ? [{ name: 'time' as const, label: TEMPLATE_COPY.workTime }] : []),
      ...(cardio ? [{ name: 'distance' as const, label: TEMPLATE_COPY.distance }] : []),
      ...(t.targetLoad !== null && !lf.bodyweight ? [{ name: 'auto_load' as const, label: TEMPLATE_COPY.autoLoad }] : []),
      { name: 'rest_after', label: TEMPLATE_COPY.restAfter },
    ];
    const loadWords = lf.bodyweight ? 'bodyweight' : t.targetLoad === null ? 'auto load' : loadSpoken(t.targetLoad.value, t.targetLoad.unit, t.targetLoad.convention);
    return {
      key: t.id,
      index: i,
      mark,
      type: t.setType,
      typeText: `${SET_TYPE_LABEL[t.setType]}${t.restOverrideS === null ? '' : ` · ${restText(t.restOverrideS)}`}`,
      reps: t.targetReps === null ? null : t.targetReps.min,
      repsText: reps,
      kgText: loadCell(t, lf.bodyweight, lf.frame.unit),
      load,
      kgEditable: !lf.bodyweight,
      kgPlaceholder: lf.bodyweight ? 'BW' : otherUnit ? loadCell(t, false, lf.frame.unit) : TEMPLATE_COPY.auto,
      rpeText: rpe === null ? '–' : String(rpe),
      rpe,
      done: false,
      editable: true,
      noRpe: t.setType === 'warmup' || scale === null,
      canDelete: slot.setTemplates.length > 1,
      canMoveUp: false,
      canMoveDown: false,
      draggable: false,
      extraActions: extra,
      accessibilityLabel: `${spokenName}, ${SET_TYPE_LABEL[t.setType]}, ${timed ? reps : `${reps.replace('–', ' to ')} reps`}, ${loadWords}${rpe === null || scale === null ? '' : `, RIR ${String(scale === 'rpe' ? Math.max(0, Math.round((10 - rpe) * 100) / 100) : rpe)}`}${t.restOverrideS === null ? '' : `, rest after ${restText(t.restOverrideS)}`}`,
      spokenName,
    };
  });
  const rests = REST_ORDER.filter((r) => slot.setTemplates.some((t) => t.setType === r.type)).map((r): PopupRestRow => {
    const rest = slotRestOf(slot, r.type, restCtx(slot, ctx));
    return { kind: r.type, label: r.label, seconds: rest.seconds, text: restText(rest.seconds), canMinus: rest.seconds > 0, canPlus: rest.seconds < SLOT_REST_MAX_S, own: rest.own };
  });
  const table = templateTableView(list, ctx);
  const row = table.rounds.flatMap((r) => r.rows).find((r) => r.slotKey === slotId);
  const has = (name: WorkoutRowView['actions'][number]['name']) => row?.actions.some((a) => a.name === name) === true;
  const effort = shapeEffortRow(shape, scale);
  return {
    name: nameOf(ctx, slot.exerciseId),
    works: f?.works ?? null,
    kgHeader: lf.frame.unit === 'kg' ? 'Kg' : 'Lb',
    effortHeader: scale === 'rir' ? 'RIR' : 'RPE',
    rows,
    canAddWarmup: shape.warmupsUp !== null,
    canAddSet: shape.setsUp !== null,
    rests,
    canMoveUp: has('move_up'),
    canMoveDown: has('move_down'),
    canSupersetNext: has('superset_next'),
    canUnlink: has('unlink'),
    mayHurt: f?.mayHurt === true,
    canSwap: true,
    deleteLabel: 'Delete',
    canDeleteExercise: true,
    options: {
      main: row?.main ?? false,
      addedWeight: x?.defaultLoadConvention === 'bodyweight' ? slot.addedWeight === true : null,
      reps: { label: shape.reps === null && shape.durationS !== null ? (cardio ? TEMPLATE_COPY.workTime : SET_SHAPE_COPY.workTime) : SET_SHAPE_COPY.reps, text: shapeRepsText(shape, perSide) },
      effort,
    },
  };
}

/**
 * The Kg cell's `−` / `+` (§2.7): the next load this gym's item can load, up or down (rule 4); 2.5 kg / 5 lb with none.
 * From an `Auto` cell (`value` null), the last logged working load snapped here (design pass 5.1), else the lightest.
 */
export function templateKgStep(list: readonly RoutineExercise[], slotId: string, value: number | null, dir: 1 | -1, ctx: Pick<TemplateEditorCtx, 'info' | 'gym' | 'unit'>): number | null {
  const slot = list.find((e) => e.id === slotId);
  if (slot === undefined) return null;
  const lf = slotLoadFrame(slot, ctx);
  if (lf.bodyweight) return null;
  if (value === null) return fixedLoadSeed(ctx.info[slot.exerciseId]?.lastLoad ?? null, lf.frame, lf.item);
  const s = fixedLoadSteps(value, lf.frame, lf.item, lf.display);
  const t = dir === 1 ? s.up : s.down;
  return t.enabled ? t.value : null;
}

// ---------------------------------------------------------------------------
// Edits (each one the domain's; held on the page until Save)

type ExerciseRef = { id: string; measurement: Measurement };

export type TemplateEditOp =
  | { kind: 'cell'; slotId: string; setId: string; field: 'reps' | 'kg' | 'rpe'; value: number }
  | { kind: 'set_type'; slotId: string; setId: string; type: SetType }
  | { kind: 'delete_set'; slotId: string; setId: string }
  | { kind: 'add_warmup'; slotId: string }
  | { kind: 'add_set'; slotId: string }
  | { kind: 'rest_step'; slotId: string; setType: SetType; dir: 1 | -1 }
  | { kind: 'rest_default'; slotId: string; setType: SetType }
  | { kind: 'set_rest'; slotId: string; setId: string; seconds: number | null }
  | { kind: 'auto_load'; slotId: string; setId: string }
  | { kind: 'set_reps'; slotId: string; setId: string; reps: RepRange }
  | { kind: 'set_time'; slotId: string; setId: string; seconds: number }
  | { kind: 'set_distance'; slotId: string; setId: string; metres: number | null }
  | { kind: 'move'; slotId: string; dir: 'up' | 'down' }
  | { kind: 'superset_next'; slotId: string }
  | { kind: 'unlink'; slotId: string }
  | { kind: 'delete_exercise'; slotId: string }
  | { kind: 'swap'; slotId: string; exercise: ExerciseRef }
  | { kind: 'add_exercise'; exercise: ExerciseRef; shape?: SlotShapeInput }
  | { kind: 'drop'; slotId: string; targetId: string; edge: 'before' | 'after' | 'onto' }
  | { kind: 'main'; slotId: string; on: boolean }
  | { kind: 'added_weight'; slotId: string; on: boolean }
  | { kind: 'slot_reps'; slotId: string; value: Parameters<typeof setSlotReps>[2] }
  | { kind: 'slot_effort'; slotId: string; value: number | null };

/** One edit on the page's list: the next list and a line for the pop-up (`At Start 25 kg each`), else null. */
export function applyTemplateEdit(list: readonly RoutineExercise[], op: TemplateEditOp, ctx: TemplateEditorCtx, newId: () => string): { list: RoutineExercise[]; note: string | null; /** (Ben, 27 Oct) What the gym learns from a kg typed off its kit. */ learn?: GymLearn } {
  const same = { list: [...list], note: null };
  const slot = 'slotId' in op ? list.find((e) => e.id === op.slotId) : undefined;
  if ('slotId' in op && slot === undefined) return same;
  const set = slot !== undefined && 'setId' in op ? slot.setTemplates.find((t) => t.id === op.setId) : undefined;
  if ('setId' in op && set === undefined) return same;
  const ok = (l: RoutineExercise[]) => ({ list: l, note: null });
  switch (op.kind) {
    case 'cell': {
      if (slot === undefined || set === undefined || !Number.isFinite(op.value)) return same;
      if (op.field === 'reps') {
        if (set.targetReps === null) return same;
        const r = Math.max(1, Math.min(100, Math.round(op.value)));
        return ok(updateSet(list, op.slotId, op.setId, { targetReps: { min: r, max: r } }));
      }
      if (op.field === 'rpe') {
        if (ctx.effortScale === null || set.setType === 'warmup') return same;
        if (ctx.effortScale === 'rir') return ok(updateSet(list, op.slotId, op.setId, { targetRir: Math.max(0, Math.min(10, Math.round(op.value))), targetRpe: null }));
        return ok(updateSet(list, op.slotId, op.setId, { targetRpe: Math.max(1, Math.min(10, Math.round(op.value * 2) / 2)), targetRir: null }));
      }
      const lf = slotLoadFrame(slot, ctx);
      // (Ben, 27 Oct) kg on a bodyweight exercise is added weight (`Add weight`), then the load as typed.
      if (lf.bodyweight) {
        const weighted = setAddedWeight(list, op.slotId, true);
        const wf = slotLoadFrame(weighted.find((e) => e.id === op.slotId) ?? slot, ctx);
        return { list: updateSet(weighted, op.slotId, op.setId, { targetLoad: typedFixedLoad(op.value, wf.frame, wf.item, wf.display).load }), note: null };
      }
      const typed = typedFixedLoad(op.value, lf.frame, lf.item, lf.display);
      // Off the gym's known kit: kept as typed, and the gym learns it (the editor writes it with Undo).
      const learn = lf.item === null || lf.frame.convention === 'added' ? null : gymLearnFor(lf.item, typed.load, { id: slot.exerciseId, name: ctx.info[slot.exerciseId]?.name ?? 'Exercise' }, { typed: true });
      return { list: updateSet(list, op.slotId, op.setId, { targetLoad: typed.load }), note: typed.note, ...(learn === null ? {} : { learn }) };
    }
    case 'set_type':
      return ok(updateSet(list, op.slotId, op.setId, { setType: op.type }));
    case 'delete_set': {
      const r = deleteSet(list, op.slotId, op.setId);
      return r.kind === 'ok' ? ok(r.list) : same;
    }
    case 'add_warmup':
      return slot === undefined ? same : ok(setWarmupCount(list, op.slotId, slotShapeOf(slot).warmups + 1, measurementOf(ctx, slot), newId));
    case 'add_set':
      return slot === undefined ? same : ok(setWorkingSetCount(list, op.slotId, slotShapeOf(slot).workingSets + 1, newId));
    case 'rest_step':
      return slot === undefined ? same : ok(stepSlotRest(list, op.slotId, op.setType, op.dir, restCtx(slot, ctx)));
    case 'rest_default':
      return ok(setRestBySetType(list, op.slotId, op.setType, null));
    case 'set_rest':
      return ok(updateSet(list, op.slotId, op.setId, { restOverrideS: op.seconds === null ? null : Math.max(0, Math.min(SLOT_REST_MAX_S, Math.round(op.seconds))) }));
    case 'auto_load':
      return ok(updateSet(list, op.slotId, op.setId, { targetLoad: null }));
    case 'set_reps': {
      const lo = Math.max(1, Math.min(100, Math.round(Math.min(op.reps.min, op.reps.max))));
      const hi = Math.max(1, Math.min(100, Math.round(Math.max(op.reps.min, op.reps.max))));
      return ok(updateSet(list, op.slotId, op.setId, { targetReps: { min: lo, max: hi }, targetDurationS: null }));
    }
    case 'set_time':
      return ok(updateSet(list, op.slotId, op.setId, { targetDurationS: Math.max(1, Math.round(op.seconds)), targetReps: null }));
    case 'set_distance': {
      // A cardio set needs a time or a distance.
      if (op.metres === null && set?.targetDurationS === null) return { list: [...list], note: TEMPLATE_COPY.needsTarget };
      return ok(updateSet(list, op.slotId, op.setId, { targetDistanceM: op.metres === null ? null : Math.max(0, op.metres) }));
    }
    case 'move':
      return ok(moveExercise(list, op.slotId, op.dir));
    case 'superset_next':
      return ok(supersetWithNext(list, op.slotId) ?? [...list]);
    case 'unlink':
      return ok(ungroup(list, op.slotId));
    case 'delete_exercise':
      return ok(removeExercise(list, op.slotId));
    case 'swap':
      return ok(replaceExercise(list, op.slotId, op.exercise));
    case 'add_exercise':
      return list.length >= ROUTINE_MAX_EXERCISES ? same : ok(addExercise(list, op.exercise, newId, op.shape));
    case 'drop':
      return ok(dropRoutineSlot(list, op.slotId, op.targetId, op.edge) ?? [...list]);
    case 'main':
      return ok(setMain(list, op.slotId, op.on));
    case 'added_weight':
      return ok(setAddedWeight(list, op.slotId, op.on));
    case 'slot_reps':
      return ok(setSlotReps(list, op.slotId, op.value));
    case 'slot_effort':
      return ctx.effortScale === null ? same : ok(setSlotTargetRpe(list, op.slotId, op.value, ctx.effortScale));
  }
}

/** The Add / Swap sheet's search: a distance exercise isn't offered, a workout can't save it yet (EL-B13). */
export function templateSearchable(x: Pick<EditorExerciseInfo, 'measurement'>): boolean {
  return x.measurement !== 'distance';
}

/** `8-12`, `8–12`, `8 to 12` or `8`: a rep target 1–100 (ends swapped when typed high first); null when it isn't one. */
export function parseRepRange(text: string): RepRange | null {
  const m = /^\s*(\d{1,3})\s*(?:(?:-|–|—|to)\s*(\d{1,3}))?\s*$/i.exec(text);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (a < 1 || b < 1 || a > 100 || b > 100) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** `1:30` → 90, `45` → 45 s, `20:00` → 1200; null when it isn't a time. */
export function parseClock(text: string): number | null {
  const m = /^\s*(?:(\d{1,3}):)?(\d{1,4})\s*$/.exec(text);
  if (m === null) return null;
  const s = (m[1] === undefined ? 0 : Number(m[1]) * 60) + Number(m[2]);
  if (m[1] !== undefined && Number(m[2]) >= 60) return null;
  return s > 0 ? s : null;
}

/** Metres typed (`5000`, `5,000`); empty clears it; null when it isn't a distance. */
export function parseMetres(text: string): { metres: number | null } | null {
  const t = text.replace(/[,\s]/g, '');
  if (t === '') return { metres: null };
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? { metres: v } : null;
}

// ---------------------------------------------------------------------------
// Open, Save and Undo (rule 5)

/** What the editor was opened for (the route's params). */
export type TemplateTarget =
  /** `New workout` (Library `＋`), or Exercise detail's `New workout` with that exercise (`draft`). */
  | { kind: 'new' }
  /** A saved workout or a plan day's template; `copy`: a fresh `Duplicate` (its Undo deletes the copy). */
  | { kind: 'edit'; routineId: string; copy: boolean }
  /** The Save sheet's `Edit ›` (§A2.5): the sheet's own save, with its opId (`save-edit-handoff`). */
  | { kind: 'save_as'; key: string };

export function templateTarget(p: { routineId: string | null; copyToast?: unknown; saveAs?: string | undefined }): TemplateTarget {
  if (p.routineId !== null) return { kind: 'edit', routineId: p.routineId, copy: p.copyToast !== undefined };
  return p.saveAs !== undefined ? { kind: 'save_as', key: p.saveAs } : { kind: 'new' };
}

export interface TemplateOpened {
  data: RoutineEditorData;
  /** What `dirty` and `Keep both` compare against. */
  base: RoutineEdit;
  name: string;
  list: RoutineExercise[];
  info: Record<string, EditorExerciseInfo>;
  facts: Record<string, TemplateFact>;
}

/** The Workouts library service calls the editor makes (the UI says "workout", WL1). */
export interface TemplateLibraryPort {
  editor(req: { routineId: string | null; gymId: string | null }): Promise<RoutineEditorData | null>;
  exerciseInfo(ids: readonly string[]): Promise<Record<string, EditorExerciseInfo>>;
  create(req: { edit: RoutineEdit; opId: string }): Promise<LibrarySaveWrite>;
  update(req: { routineId: string; edit: RoutineEdit; expectedVersion: number; opId: string }): Promise<RoutineEditWrite>;
  saveFrom(req: { from: SaveFrom; name: string; addToRotation: boolean; opId: string; edit?: RoutineEdit }): Promise<LibrarySaveWrite>;
  revert(req: { actionId: string; opId: string }): Promise<TemplateSwapWrite>;
  remove(req: { routineId: string; expectedVersion: number; opId: string }): Promise<RoutineWrite>;
}

type GymPort = Pick<AppServices['yourData'], 'currentGym'>;
type FactsPort = Pick<AppServices['builder'], 'templateFacts'>;
type OpenPorts = { yourData: GymPort; routines: Pick<TemplateLibraryPort, 'editor' | 'exerciseInfo'>; builder: FactsPort };

/** Opens the editor at the current gym: the stored workout (or the draft it was opened with) and each exercise's facts. Null: it couldn't. */
export async function openTemplate(s: OpenPorts, req: { routineId: string | null; draft?: { name: string; exercises: RoutineExercise[] } | undefined; saveAs?: string | undefined }): Promise<TemplateOpened | null> {
  const gym = await s.yourData.currentGym().catch(() => null);
  const data = await s.routines.editor({ routineId: req.routineId, gymId: gym?.id ?? null }).catch(() => null);
  if (data === null) return null;
  let base: RoutineEdit = { name: data.routine?.name ?? '', exercises: data.exercises };
  let name = base.name;
  let list = [...data.exercises];
  let info = { ...data.info };
  if (data.routine === null && req.draft !== undefined) {
    name = req.draft.name;
    list = [...req.draft.exercises];
    // The Save sheet's unsaved copy (WL-A18): unchanged, Cancel goes straight back to the sheet.
    if (req.saveAs !== undefined) base = { name: req.draft.name, exercises: req.draft.exercises };
    info = { ...info, ...(await s.routines.exerciseInfo(req.draft.exercises.map((e) => e.exerciseId)).catch(() => ({}))) };
  }
  const facts = await s.builder.templateFacts({ gymId: data.gym?.id ?? null, exerciseIds: list.map((e) => e.exerciseId) }).catch(() => ({}));
  return { data, base, name, list, info, facts };
}

export type TemplateSaveOutcome =
  | { kind: 'saved'; routine: Routine; toast: LibraryToastParam }
  /** The Save sheet's save landed; its host shows the toast (`settleSaveEdit`). */
  | { kind: 'saved_as'; routine: Routine }
  /** A newer version was saved meanwhile: nothing written (rule 5); the conflict sheet shows it. */
  | { kind: 'stale'; current: Routine; lines: string[]; changedAtUtc: string }
  | { kind: 'failed'; message: string };

type SavePorts = Pick<TemplateLibraryPort, 'create' | 'update' | 'saveFrom'>;

/**
 * `Save`: one write under `opId` (a retry is the same save). New: `create` (Undo deletes it). A saved workout or plan
 * day: `update` at `expectedVersion` (Undo puts the version before back; a fresh Duplicate's Undo deletes the copy);
 * an older version writes nothing (`stale`). The Save sheet's `Edit ›`: `saveFrom` with the sheet's own opId.
 */
export async function saveTemplate(s: SavePorts, req: { target: TemplateTarget; edit: RoutineEdit; expectedVersion: number | null; opId: string }): Promise<TemplateSaveOutcome> {
  const edit = { ...req.edit, name: req.edit.name.trim() };
  switch (req.target.kind) {
    case 'save_as': {
      const held = saveEditRequest(req.target.key);
      if (held === null) return { kind: 'failed', message: 'Couldn’t save. Try again.' };
      const r = await s.saveFrom({ from: held.from, name: edit.name, addToRotation: held.addToRotation, opId: held.opId, edit });
      return r.ok ? { kind: 'saved_as', routine: r.routine } : { kind: 'failed', message: r.message };
    }
    case 'new': {
      const r = await s.create({ edit, opId: req.opId });
      if (!r.ok) return { kind: 'failed', message: r.message };
      return { kind: 'saved', routine: r.routine, toast: { key: req.opId, text: LIBRARY_TOASTS.saved(r.routine.name), undo: { kind: 'delete', routineId: r.routine.id, version: r.routine.version } } };
    }
    case 'edit': {
      if (req.expectedVersion === null) return { kind: 'failed', message: 'Couldn’t save. Try again.' };
      const r = await s.update({ routineId: req.target.routineId, edit, expectedVersion: req.expectedVersion, opId: req.opId });
      if (r.ok) {
        const undo = req.target.copy ? { kind: 'delete' as const, routineId: r.routine.id, version: r.routine.version } : r.actionId === null ? null : { kind: 'revert' as const, actionId: r.actionId };
        return { kind: 'saved', routine: r.routine, toast: { key: req.opId, text: LIBRARY_TOASTS.saved(r.routine.name), undo } };
      }
      if (r.reason === 'stale') return { kind: 'stale', current: r.current, lines: r.lines, changedAtUtc: r.changedAtUtc };
      return { kind: 'failed', message: r.message };
    }
  }
}

/** The Save toast's `Undo`: the version before back (only while the workout is still at the saved one), or the new workout deleted. */
export async function undoTemplateSave(s: Pick<TemplateLibraryPort, 'revert' | 'remove'>, undo: NonNullable<LibraryToastParam['undo']>, opId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = undo.kind === 'revert' ? await s.revert({ actionId: undo.actionId, opId }) : await s.remove({ routineId: undo.routineId, expectedVersion: undo.version, opId });
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

/** `Keep both` after a stale Save (v0.1 §3.3): the newer version as the editor sees it, never raw (review S3). */
export function editableOf(r: Routine): RoutineEdit {
  return editableEdit(r);
}

/**
 * (Ben, 27 Oct: "if I add an exercise without changing the time it changes the time automatically") The editor's Time
 * row: the live estimate of the list on the page (the workout services' `estimate`, the one estimate the plan and Today's
 * card use), held to `length` (the plan day's, or the length `Time ±` last fitted to; null: none, so never over).
 * The editor's fit works from the list on the page (`fitTemplate`), so with no live fit `−` steps below the estimate;
 * with one, below its length (`liveTime`). Null: no estimate yet (`—`). Pure.
 */
export function editorTimeView(i: { estimate: number | null; length: number | null; fitted: boolean }): LiveTime | null {
  if (i.estimate === null) return null;
  const length = i.length ?? i.estimate;
  return liveTime({ estimate: i.estimate, length, floor: i.fitted ? length : i.estimate });
}
