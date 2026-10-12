import type { EquipmentInstance, Exercise, Load, LoadConvention, Measurement, RepRange, RestSetting, RoutineExercise, SetTemplate, SetType, WeightUnit } from '@fizz/schemas';

import { formatDuration, formatNumber, loadText, NBSP, repRangeText, SET_TYPE_BADGE, SET_TYPE_WORD } from '../display';
import { getAchievableLoads, loadDirection, roundToAvailableLoad, stepLoad } from '../equipment';
import { equipmentForExercise } from '../exercise-equipment';
import { resolveRestPreset } from '../rest';
import type { StepTarget } from './active-view';
import { boundWords, droppedWords } from './fit-words';
import { normaliseRoutineExercises, ROUTINE_MAX_SETS, SUPERSET_MAX, type RoutineEdit } from './library';
import { defaultMain } from './routines';

/**
 * The workout editor's changes (routines.md §A2.3, v0.1 §2.3, §4.3). Pure:
 * each takes the exercises as they are in the editor and returns the next
 * list (normalised: order, contiguous supersets). Nothing is saved until
 * `Save` (`editRoutine` / `createRoutine`). Loads are `Auto` (null) unless
 * Ben pins a Fixed load; a replaced exercise's loads go back to `Auto`,
 * never converted (rule 4).
 */

export type EditorList = readonly RoutineExercise[];

const DEFAULT_REPS: RepRange = { min: 8, max: 10 };
const DEFAULT_WARMUP_REPS: RepRange = { min: 5, max: 5 };
const DEFAULT_WORK_S = 45;

function template(newId: () => string, setType: SetType, measurement: Measurement): SetTemplate {
  return {
    id: newId(),
    setType,
    targetLoad: null,
    targetReps: measurement === 'duration' ? null : setType === 'warmup' ? { ...DEFAULT_WARMUP_REPS } : { ...DEFAULT_REPS },
    targetDurationS: measurement === 'duration' ? DEFAULT_WORK_S : null,
    targetRpe: null,
    targetRir: null,
    restOverrideS: null,
  };
}

/** `＋ Add exercise`: three working sets, `Auto × 8–10` (or `0:45` for a timed one), at the end. */
export function addExercise(list: EditorList, exercise: { id: string; measurement: Measurement }, newId: () => string): RoutineExercise[] {
  const slot: RoutineExercise = {
    id: newId(),
    exerciseId: exercise.id,
    equipmentId: null,
    order: list.length,
    supersetGroup: null,
    setTemplates: [0, 1, 2].map(() => template(newId, 'working', exercise.measurement)),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  };
  return normaliseRoutineExercises([...list, slot]);
}

/** `Remove` (exercise `⋯`). */
export function removeExercise(list: EditorList, slotId: string): RoutineExercise[] {
  return normaliseRoutineExercises(list.filter((e) => e.id !== slotId));
}

/** `Move up` / `Move down` (also VoiceOver actions). Leaves a superset when it moves out of its run. */
export function moveExercise(list: EditorList, slotId: string, how: 'up' | 'down'): RoutineExercise[] {
  const i = list.findIndex((e) => e.id === slotId);
  const j = how === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  const a = next[i];
  const b = next[j];
  if (a === undefined || b === undefined) return [...list];
  // Moving past a neighbour in another group (or none) takes the moved one out of its own group.
  const moved: RoutineExercise = a.supersetGroup !== null && a.supersetGroup === b.supersetGroup ? a : { ...a, supersetGroup: null };
  next[i] = b;
  next[j] = moved;
  return normaliseRoutineExercises(next);
}

/**
 * `Replace` (exercise `⋯`, §4.3): the new exercise keeps set types, reps,
 * rest, `Main` and its superset; loads go back to `Auto` and the item and
 * built-in rule are cleared (never converted, rule 4).
 */
export function replaceExercise(list: EditorList, slotId: string, to: { id: string; measurement: Measurement }): RoutineExercise[] {
  return list.map((e) => {
    if (e.id !== slotId) return e;
    const sameMeasure = e.setTemplates.every((t) => (to.measurement === 'duration' ? t.targetDurationS !== null : t.targetReps !== null));
    return {
      ...e,
      exerciseId: to.id,
      equipmentId: null,
      progressionRuleId: null,
      setTemplates: e.setTemplates.map((t) =>
        sameMeasure
          ? { ...t, targetLoad: null }
          : { ...t, targetLoad: null, targetReps: to.measurement === 'duration' ? null : { ...DEFAULT_REPS }, targetDurationS: to.measurement === 'duration' ? DEFAULT_WORK_S : null },
      ),
    };
  });
}

/**
 * `+ Warm-up`, `+ Working`, `+ More` (Top, Back-off, Drop): a copy of the
 * last set of that type (its own rest override dropped), else sensible
 * empty targets. Warm-ups go before the first non-warm-up; others at the end.
 */
export function addSet(list: EditorList, slotId: string, setType: SetType, measurement: Measurement, newId: () => string): RoutineExercise[] {
  return list.map((e) => {
    if (e.id !== slotId || e.setTemplates.length >= ROUTINE_MAX_SETS) return e;
    const like = [...e.setTemplates].reverse().find((t) => t.setType === setType);
    const added: SetTemplate = like ? { ...like, id: newId(), restOverrideS: null } : template(newId, setType, measurement);
    if (setType !== 'warmup') return { ...e, setTemplates: [...e.setTemplates, added] };
    const at = e.setTemplates.findIndex((t) => t.setType !== 'warmup');
    const sets = at < 0 ? [...e.setTemplates, added] : [...e.setTemplates.slice(0, at), added, ...e.setTemplates.slice(at)];
    return { ...e, setTemplates: sets };
  });
}

export type SetPatch = Partial<Pick<SetTemplate, 'setType' | 'targetLoad' | 'targetReps' | 'targetDurationS' | 'restOverrideS'>>;

/** The set sheet's changes (type, load Auto/Fixed, reps range/exact, work time, this set's rest). */
export function updateSet(list: EditorList, slotId: string, setId: string, patch: SetPatch): RoutineExercise[] {
  return list.map((e) => (e.id !== slotId ? e : { ...e, setTemplates: e.setTemplates.map((t) => (t.id === setId ? { ...t, ...patch } : t)) }));
}

/** `Delete set`. The last set can't go this way: the editor asks `Remove Bench press from Push A?` instead. */
export function deleteSet(list: EditorList, slotId: string, setId: string): { kind: 'ok'; list: RoutineExercise[] } | { kind: 'last_set' } {
  const slot = list.find((e) => e.id === slotId);
  if (slot === undefined) return { kind: 'ok', list: [...list] };
  if (slot.setTemplates.length <= 1 && slot.setTemplates.some((t) => t.id === setId)) return { kind: 'last_set' };
  return { kind: 'ok', list: list.map((e) => (e.id !== slotId ? e : { ...e, setTemplates: e.setTemplates.filter((t) => t.id !== setId) })) };
}

/** `Rest by set type` (§2.3): a preset for one set type, or null (`Use default`) so resolution falls through. */
export function setRestBySetType(list: EditorList, slotId: string, setType: SetType, rest: RestSetting | null): RoutineExercise[] {
  return list.map((e) => {
    if (e.id !== slotId) return e;
    const others = Object.fromEntries(Object.entries(e.restBySetType).filter(([k]) => k !== setType)) as RoutineExercise['restBySetType'];
    return { ...e, restBySetType: rest === null ? others : { ...others, [setType]: rest } };
  });
}

/** `Main` (WL9): Ben's choice, written down. `current` is what the chip shows now (stored or the rule's). */
export function setMain(list: EditorList, slotId: string, main: boolean): RoutineExercise[] {
  return list.map((e) => (e.id === slotId ? { ...e, main } : e));
}

/** What each `Main` chip shows: Ben's stored choice, else the rule over the list as it is now. */
export function editorMainFlags(list: EditorList, isCompound: (exerciseId: string) => boolean): boolean[] {
  const rule = defaultMain(list, isCompound);
  return list.map((e, i) => e.main ?? rule[i] ?? false);
}

/**
 * `Superset with next` (§4.3): this exercise and the next become one
 * superset (joining a group either is already in), up to 4 members.
 * Null when there's no next exercise or the group would be too big.
 */
export function supersetWithNext(list: EditorList, slotId: string): RoutineExercise[] | null {
  const i = list.findIndex((e) => e.id === slotId);
  const a = list[i];
  const b = list[i + 1];
  if (a === undefined || b === undefined) return null;
  if (a.supersetGroup !== null && a.supersetGroup === b.supersetGroup) return null;
  const size = (label: string | null) => (label === null ? 1 : list.filter((e) => e.supersetGroup === label).length);
  if (size(a.supersetGroup) + size(b.supersetGroup) > SUPERSET_MAX) return null;
  const label = a.supersetGroup ?? b.supersetGroup ?? '#new';
  const merged = list.map((e) => (e.id === a.id || e.id === b.id || (b.supersetGroup !== null && e.supersetGroup === b.supersetGroup) || (a.supersetGroup !== null && e.supersetGroup === a.supersetGroup) ? { ...e, supersetGroup: label } : e));
  return normaliseRoutineExercises(merged);
}

/** `Ungroup`: every member of this exercise's superset goes back to a plain exercise. */
export function ungroup(list: EditorList, slotId: string): RoutineExercise[] {
  const label = list.find((e) => e.id === slotId)?.supersetGroup ?? null;
  if (label === null) return [...list];
  return normaliseRoutineExercises(list.map((e) => (e.supersetGroup === label ? { ...e, supersetGroup: null } : e)));
}

// ---------------------------------------------------------------------------
// What the editor shows

export interface EditorSetRow {
  /** `1`, `3–5`: identical neighbouring sets collapse into one row. */
  numbers: string;
  setIds: string[];
  badge: string | null;
  typeWord: string;
  /** `Auto × 6–8`, `60 kg × 5`, `37.5 kg each × 8`, `Auto · 0:45`. */
  target: string;
  /** `2:00`, the rest after these sets as it resolves at Start. */
  rest: string;
  /** This set's own rest (`●`; VoiceOver "this set's own rest"). */
  ownRest: boolean;
  accessibilityLabel: string;
}

export interface EditorRowContext {
  exerciseName: string;
  convention: LoadConvention;
  equipment: Pick<EquipmentInstance, 'kind'> | null;
  /** Rest resolution steps 3 and 4 (rest-state §4.2). */
  exerciseDefaultRestS: number | null;
  globalDefault: RestSetting;
  perSide: boolean;
}

/** A template's target in words: `Auto × 6–8`, `60 kg × 5`, `Auto · 0:45`. */
export function templateTargetText(t: Pick<SetTemplate, 'targetLoad' | 'targetReps' | 'targetDurationS'>, ctx: Pick<EditorRowContext, 'convention' | 'equipment' | 'perSide'>): string {
  const load = ctx.convention === 'bodyweight' ? 'BW' : t.targetLoad === null ? 'Auto' : loadText(t.targetLoad, t.targetLoad.convention, ctx.equipment);
  if (t.targetReps !== null) return `${load}${NBSP}×${NBSP}${repRangeText(t.targetReps)}${ctx.perSide ? `${NBSP}per side` : ''}`;
  if (t.targetDurationS !== null) return `${load} · ${formatDuration(t.targetDurationS)}`;
  return load;
}

/** The set rows of one exercise card (§2.3 row rules). */
export function editorSetRows(slot: Pick<RoutineExercise, 'setTemplates' | 'restBySetType'>, ctx: EditorRowContext): EditorSetRow[] {
  const shaped = slot.setTemplates.map((t, i) => {
    const rest = resolveRestPreset({
      setType: t.setType,
      exerciseName: ctx.exerciseName,
      setOverrideS: t.restOverrideS,
      routineSetTypePreset: slot.restBySetType[t.setType] ?? null,
      exerciseDefaultS: ctx.exerciseDefaultRestS,
      globalDefault: ctx.globalDefault,
    });
    return { n: i + 1, t, target: templateTargetText(t, ctx), rest: formatDuration(rest.seconds), own: rest.source === 'set_override' };
  });
  const rows: EditorSetRow[] = [];
  let run: typeof shaped = [];
  const flush = () => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) return;
    const numbers = run.length === 1 ? String(first.n) : `${String(first.n)}–${String(last.n)}`;
    const typeWord = SET_TYPE_WORD[first.t.setType];
    rows.push({
      numbers,
      setIds: run.map((x) => x.t.id),
      badge: SET_TYPE_BADGE[first.t.setType],
      typeWord,
      target: first.target,
      rest: first.rest,
      ownRest: first.own,
      accessibilityLabel: `${run.length === 1 ? `Set ${numbers}` : `Sets ${numbers.replace('–', ' to ')}`}, ${typeWord}, ${first.target.replaceAll(NBSP, ' ').replace('×', 'times')}, rest ${first.rest}${first.own ? ", this set's own rest" : ''}`,
    });
    run = [];
  };
  for (const x of shaped) {
    const prev = run[run.length - 1];
    if (prev !== undefined && (prev.t.setType !== x.t.setType || prev.target !== x.target || prev.rest !== x.rest || prev.own !== x.own)) flush();
    run.push(x);
  }
  flush();
  return rows;
}

/** `5 exercises · ≈ 55 min at Main gym` (live, under the name). */
export function editorSummaryLine(exercises: number, minutes: number | null, gymName: string | null): string {
  const n = `${String(exercises)} ${exercises === 1 ? 'exercise' : 'exercises'}`;
  if (minutes === null) return n;
  return `${n} · ≈ ${String(minutes)} min${gymName === null ? '' : ` at ${gymName}`}`;
}

// ---------------------------------------------------------------------------
// Fixed loads (§2.3 set sheet)

/**
 * What a Fixed load will be at Start on this item (rule 4: never past its
 * max; snapped toward easier): `Max here 30 kg each`, `At Start 27.5 kg each`,
 * or a reason it can't be checked. Null when it's achievable as is. Saving
 * is always allowed; Start fits it (ADR 0003 B1).
 */
export function fixedLoadNote(load: Load, eq: EquipmentInstance | null): string | null {
  if (eq === null || eq.kind === 'bodyweight_station') return null;
  const r = roundToAvailableLoad(load, eq, 'easier');
  if (!r.ok) return droppedWords(r.reason, { unit: load.unit });
  if (r.exact && r.convertedRequest === null) return null;
  const words = loadText(r.load, r.load.convention, eq);
  if (r.bounded !== null) return boundWords(r.bounded, words, loadDirection(eq.loadConvention) === 'assistance');
  return `At Start ${words}`;
}

/** The new Fixed load's unit and convention: the item's at this gym, else Ben's unit and the exercise's own. */
export function fixedLoadFrame(eq: EquipmentInstance | null, unit: WeightUnit, convention: LoadConvention): { unit: WeightUnit; convention: LoadConvention } {
  return eq === null || eq.kind === 'bodyweight_station' ? { unit, convention } : { unit: eq.unit, convention: eq.loadConvention };
}

/** The set sheet's load stepper: achievable loads on this item (P5); without one, 2.5 kg / 5 lb steps. */
export function fixedLoadSteps(value: number | null, frame: { unit: WeightUnit; convention: LoadConvention }, eq: EquipmentInstance | null): { down: StepTarget; up: StepTarget } {
  const fmt = (v: number) => loadText({ value: v, unit: frame.unit, convention: frame.convention }, frame.convention, eq);
  if (eq !== null && eq.kind !== 'bodyweight_station') {
    const loads = getAchievableLoads(eq).loads;
    if (loads.length === 0) return { down: { enabled: false, reason: 'No loads set up here' }, up: { enabled: false, reason: 'No loads set up here' } };
    if (value === null) {
      const first = loads[0] ?? 0;
      return { down: { enabled: false, reason: 'No load entered' }, up: { enabled: true, value: first, label: fmt(first) } };
    }
    const up = stepLoad(value, eq, 'increase');
    const down = stepLoad(value, eq, 'decrease');
    return {
      up: up.ok ? { enabled: true, value: up.value, label: fmt(up.value) } : { enabled: false, reason: `Max ${fmt(loads[loads.length - 1] ?? value)}` },
      down: down.ok ? { enabled: true, value: down.value, label: fmt(down.value) } : { enabled: false, reason: `Min ${fmt(loads[0] ?? value)}` },
    };
  }
  const step = frame.unit === 'kg' ? 2.5 : 5;
  const v = value ?? 0;
  const upV = Number(formatNumber(v + step));
  const downV = Number(formatNumber(v - step));
  return {
    up: { enabled: true, value: upV, label: fmt(upV) },
    down: value === null || downV < 0 ? { enabled: false, reason: 'Min 0' } : { enabled: true, value: downV, label: fmt(downV) },
  };
}

/**
 * The item a Fixed load is checked on in the editor (§2.3): the slot's own
 * item when it is at this gym, else the first compatible one here, else
 * none (`Fixed` is then saved unchecked and fitted at Start).
 */
export function editorItemFor(slot: Pick<RoutineExercise, 'equipmentId'>, exercise: Pick<Exercise, 'defaultLoadConvention' | 'compatibleEquipment'>, gym: readonly EquipmentInstance[]): EquipmentInstance | null {
  const own = slot.equipmentId === null ? undefined : gym.find((e) => e.id === slot.equipmentId && e.availability === 'available');
  return own ?? equipmentForExercise(exercise, gym)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Save conflict (v0.1 §3.3, WL-A6; rule 5)

/** One thing both Ben's edits and the newer version changed: Ben picks one. */
export type RoutineConflict = { kind: 'name'; mine: string; theirs: string } | { kind: 'slot'; slotId: string; exerciseId: string; mine: RoutineExercise | null; theirs: RoutineExercise | null };

export interface RoutineMerge {
  /** Ben's edits re-applied on the newer version, with each conflict as picked (default: the newer version's). */
  merged: RoutineEdit;
  conflicts: RoutineConflict[];
}

const conflictKey = (c: RoutineConflict): string => (c.kind === 'name' ? 'name' : c.slotId);

/**
 * `Keep both` (v0.1 §3.3): Ben's edits (`mine`, from `base`) re-applied on
 * the version that was saved meanwhile (`theirs`). A slot or the name that
 * only one side changed takes that side; one both changed differently is a
 * conflict, resolved by `picks` (`'mine'` / `'theirs'`, by slot ID or
 * `name`; unpicked = theirs, so nothing newer is lost by default). Ben's
 * order wins when he reordered; added slots keep their place in his list.
 * Pure: the caller saves the result against `theirs`' version.
 */
export function mergeRoutineEdits(base: RoutineEdit, mine: RoutineEdit, theirs: RoutineEdit, picks: Readonly<Record<string, 'mine' | 'theirs'>> = {}): RoutineMerge {
  const same = (a: RoutineExercise | undefined, b: RoutineExercise | undefined): boolean => {
    if (a === undefined || b === undefined) return a === b;
    const strip = (e: RoutineExercise) => ({ ...e, order: 0 });
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
  };
  const conflicts: RoutineConflict[] = [];
  const nameMine = mine.name.trim() !== base.name.trim();
  const nameTheirs = theirs.name.trim() !== base.name.trim();
  let name = nameMine ? mine.name : theirs.name;
  if (nameMine && nameTheirs && mine.name.trim() !== theirs.name.trim()) {
    const c: RoutineConflict = { kind: 'name', mine: mine.name.trim(), theirs: theirs.name.trim() };
    conflicts.push(c);
    name = picks[conflictKey(c)] === 'mine' ? mine.name : theirs.name;
  }
  const b = new Map(base.exercises.map((e) => [e.id, e]));
  const m = new Map(mine.exercises.map((e) => [e.id, e]));
  const t = new Map(theirs.exercises.map((e) => [e.id, e]));
  const chosen = new Map<string, RoutineExercise | null>();
  for (const id of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const was = b.get(id);
    const mx = m.get(id);
    const tx = t.get(id);
    if (was === undefined) {
      // Added on one side (IDs are new, so never on both).
      chosen.set(id, mx ?? tx ?? null);
      continue;
    }
    const mineChanged = !same(was, mx);
    const theirsChanged = !same(was, tx);
    if (mineChanged && theirsChanged && !same(mx, tx)) {
      const c: RoutineConflict = { kind: 'slot', slotId: id, exerciseId: was.exerciseId, mine: mx ?? null, theirs: tx ?? null };
      conflicts.push(c);
      chosen.set(id, picks[conflictKey(c)] === 'mine' ? (mx ?? null) : (tx ?? null));
    } else chosen.set(id, mineChanged ? (mx ?? null) : (tx ?? null));
  }
  const order = (list: RoutineEdit) => list.exercises.map((e) => e.id).filter((id) => b.has(id));
  const reordered = JSON.stringify(order(mine)) !== JSON.stringify(order(base));
  const lead = reordered ? mine.exercises : theirs.exercises;
  const other = reordered ? theirs.exercises : mine.exercises;
  const ids: string[] = lead.map((e) => e.id);
  // Slots only the other list has: at the end when they were added at its end, else after the slot they follow there.
  const leadIds = new Set(ids);
  other.forEach((e, i) => {
    if (ids.includes(e.id)) return;
    const trailing = other.slice(i + 1).every((x) => !leadIds.has(x.id));
    const prev = other[i - 1];
    const at = trailing || prev === undefined ? (trailing ? ids.length - 1 : -1) : ids.indexOf(prev.id);
    ids.splice(at + 1, 0, e.id);
  });
  const exercises = ids.flatMap((id) => {
    const e = chosen.get(id);
    return e === null || e === undefined ? [] : [e];
  });
  return { merged: { name, exercises: normaliseRoutineExercises(exercises) }, conflicts };
}
