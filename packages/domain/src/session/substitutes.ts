import type { EquipmentInstance, Exercise, Load, PainFlag, RepRange, SetType, WeightUnit, ZonedTimestamp } from '@fizz/schemas';
import { dayMonthText, formatDuration, formatNumber, NBSP, repRangeText } from '../display';
import { loadDirection } from '../equipment';
import { matchExercise } from '../exercise-search';
import { needsNoEquipment } from '../exercise-equipment';
import { nextTargetsFor, plannedSetsFromTargets } from '../next-target';
import { mayHurtAccessibility, mayHurtConfirm, painFlagCovering } from '../pain-flags';
import type { HistorySession, PainStatus } from '../progression';
import { convertMass } from '../units';
import { toMs } from '../time';
import { loadCell } from './overview';
import { mapEquipment, snapPlanToGym, type SnapGym, type SnapMapping } from './snap';
import { swapSource, type SwapPlan } from './swap-plan';
import { addedSlotShape } from './today-shape';

/**
 * Swap today (overview-today-edits TE6, exercise-library EL4/EL9). Pure.
 *
 * - `substituteTargets`: a substitute's targets from **its own** comparable
 *   history through the built-in rule, else the slot's sets and reps with no
 *   load. Never converted from the original's load (rule 4; GS3).
 * - `rankSubstitutions`: the Swap sheet's rows: the catalogue's substitutions
 *   for the slot's exercise, then Ben's exercises of the same family, most
 *   recently done first; only what this gym can do; never something already
 *   in today's plan; pain-flagged ones marked and listed last (rule 9).
 *   Each row's target is fitted with the shared `snapPlanToGym` (mode
 *   `start`), so the row shows what the pick will plan and Start will create.
 *
 * No scores and no AI: the order is the catalogue's, then recency.
 */

export interface SubstituteContext {
  ownerId: string;
  /** Ben's unit, for a slot that ends up with no equipment. */
  unit: WeightUnit;
  gym: SnapGym;
  /** Ben's items at every gym, so a history row's item (and its kind) can be found. */
  knownEquipment: ReadonlyMap<string, EquipmentInstance>;
  /** GS3 step 2: the item an exercise last used at this gym. */
  lastUsedHere?: (exerciseId: string) => string | null;
  painFlags: readonly PainFlag[];
  /** Pain mentioned (no movement chosen) in today's check-in: holds every load. */
  sessionPain: PainStatus;
  at: ZonedTimestamp;
}

/** The slot being swapped: how many working sets it has, and its own sets and reps. */
export interface SubstituteSlot {
  workingSets: number;
  templates: readonly { setType: SetType; reps: RepRange | null; durationS: number | null }[];
}

const snapExercise = (e: Exercise) => ({ id: e.id, name: e.name, compatibleEquipment: e.compatibleEquipment, defaultLoadConvention: e.defaultLoadConvention });

/** The item this gym would give the exercise with no pin of its own (GS3 by kind), and how. */
export function equipmentHere(exercise: Exercise, ctx: Pick<SubstituteContext, 'gym' | 'lastUsedHere'>): { equipment: EquipmentInstance | null; mapping: SnapMapping } {
  return mapEquipment(snapExercise(exercise), swapSource(exercise, null, ctx.gym.id), ctx.gym, ctx.lastUsedHere);
}

/** Whether this gym has something to do the exercise on (bodyweight always passes). */
export function doableHere(exercise: Exercise, gym: SnapGym): boolean {
  if (needsNoEquipment(exercise)) return true;
  return equipmentHere(exercise, { gym }).equipment !== null;
}

/**
 * The newest comparable appearance of the substitute (with working sets): on
 * the same kind of item the gym would map it to, with no item for a
 * bodyweight exercise, or any item when this gym has none (the row then
 * reads `NO LOAD`). A FitNotes workout has no item recorded, so it matches
 * whatever this gym maps the exercise to, and its targets are made on that
 * item (B7; rule 4).
 */
export function comparableHistory(exercise: Exercise, history: readonly HistorySession[], ctx: Pick<SubstituteContext, 'gym' | 'lastUsedHere' | 'knownEquipment'>): { session: HistorySession; equipment: EquipmentInstance | null } | null {
  return comparableSessions(exercise, history, ctx)[0] ?? null;
}

/**
 * Every comparable appearance, newest first: the same test as
 * `comparableHistory`, which takes the first. The builder's load references
 * read the last few (workout-builder §8.5).
 */
export function comparableSessions(exercise: Exercise, history: readonly HistorySession[], ctx: Pick<SubstituteContext, 'gym' | 'lastUsedHere' | 'knownEquipment'>): { session: HistorySession; equipment: EquipmentInstance | null }[] {
  const { equipment: here, mapping } = equipmentHere(exercise, ctx);
  const newest = [...history].filter((h) => h.sets.some((s) => s.setType !== 'warmup')).sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  const out: { session: HistorySession; equipment: EquipmentInstance | null }[] = [];
  for (const h of newest) {
    if (h.imported) {
      out.push({ session: h, equipment: here });
      continue;
    }
    const eq = h.equipmentId === null ? null : (ctx.gym.equipment.find((e) => e.id === h.equipmentId) ?? ctx.knownEquipment.get(h.equipmentId) ?? null);
    if (h.equipmentId !== null && eq === null) continue;
    if (mapping === 'none_needed' ? eq === null || eq.kind === 'bodyweight_station' : mapping === 'not_here' ? true : eq !== null && here !== null && sameItemKind(eq, here)) {
      out.push({ session: h, equipment: eq });
    }
  }
  return out;
}

/** Same kind; a barbell also needs the same bar mass (a different bar makes totals incomparable). */
function sameItemKind(a: EquipmentInstance, b: EquipmentInstance): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'barbell' || b.kind !== 'barbell') return true;
  return Math.abs(convertMass({ value: a.barMass, unit: a.unit }, 'kg').value - convertMass({ value: b.barMass, unit: b.unit }, 'kg').value) < 1e-6;
}

/**
 * `substituteTargets` (§6.2): comparable history → the built-in rule's next
 * targets with the slot's working-set count (provenance kept for `Why?`),
 * on the item that history was done on (`pin`). None → no plan: the slot's
 * own sets and reps with no load (`No history`).
 */
export function substituteTargets(slot: SubstituteSlot, exercise: Exercise, history: readonly HistorySession[], ctx: SubstituteContext): SwapPlan {
  const found = comparableHistory(exercise, history, ctx);
  if (found === null || exercise.measurement !== 'reps') return { exercise, pin: null, plan: null };
  const eq = found.equipment;
  const { result } = nextTargetsFor({
    ownerId: ctx.ownerId,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    measurement: exercise.measurement,
    unit: eq?.unit ?? ctx.unit,
    convention: eq?.loadConvention ?? exercise.defaultLoadConvention,
    equipment: eq,
    exercise,
    rule: null,
    workingSets: Math.max(1, slot.workingSets),
    history,
    painFlags: ctx.painFlags,
    sessionPain: ctx.sessionPain,
  });
  const plan = plannedSetsFromTargets(result, { history, equipment: eq, at: ctx.at });
  return plan === null ? { exercise, pin: null, plan: null } : { exercise, pin: eq, plan };
}

/**
 * `addTargets` (overview-today-edits §11.9, TE16): an added exercise's
 * targets through the same path as a swap substitute: its own comparable
 * history and the built-in rule with 3 working sets, else the default shape
 * (3 × its rule range, or 0:45) with no load (`No history`). Never derived
 * from another exercise's load.
 */
export function addTargets(exercise: Exercise, history: readonly HistorySession[], ctx: SubstituteContext): SwapPlan {
  const kind = equipmentHere(exercise, ctx).equipment?.kind ?? null;
  return substituteTargets(addedSlotShape(exercise, kind), exercise, history, ctx);
}

/** The sets a swap plans before the fit: the substitute's own, or the slot's sets and reps with no load. */
export function swapPlannedSets(plan: SwapPlan, slot: SubstituteSlot): { setType: SetType; load: Load | null; reps: RepRange | null; durationS: number | null }[] {
  if (plan.plan !== null && plan.plan.length > 0) return plan.plan.map((p) => ({ setType: p.setType, load: p.planned.load, reps: p.planned.reps, durationS: p.planned.durationS }));
  const working = slot.templates.filter((t) => t.setType !== 'warmup');
  return (working.length > 0 ? working : slot.templates).map((t) => ({ setType: t.setType, load: null, reps: t.reps, durationS: t.durationS }));
}

/** What a swap fits to at this gym: the first working set's target, as the shared fit gives it. */
export interface SwapFit {
  equipment: EquipmentInstance | null;
  mapping: SnapMapping;
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
  dropped: boolean;
  workingSets: number;
}

/** The shared fit (`snapPlanToGym`, mode `start`) on a swap's plan: the same input Start gives it for that slot. */
export function fitSwap(plan: SwapPlan, slot: SubstituteSlot, ctx: Pick<SubstituteContext, 'gym' | 'lastUsedHere' | 'unit'>): SwapFit {
  const sets = swapPlannedSets(plan, slot);
  const snap = snapPlanToGym({
    mode: 'start',
    slots: [
      {
        slotId: 'swap',
        exercise: snapExercise(plan.exercise),
        sourceEquipment: swapSource(plan.exercise, plan.pin, ctx.gym.id),
        unit: ctx.unit,
        convention: plan.exercise.defaultLoadConvention,
        sets: sets.map((s, i) => ({ id: String(i), setType: s.setType, intended: s.load, current: null, reps: s.reps, durationS: s.durationS })),
      },
    ],
    gym: ctx.gym,
    ...(ctx.lastUsedHere ? { lastUsedHere: ctx.lastUsedHere } : {}),
    ownerUnit: ctx.unit,
  });
  const fitted = snap.slots[0];
  const firstAt = sets.findIndex((s) => s.setType !== 'warmup');
  const first = firstAt < 0 ? undefined : sets[firstAt];
  const firstFit = firstAt < 0 ? undefined : fitted?.sets[firstAt];
  return {
    equipment: fitted?.equipment ?? null,
    mapping: fitted?.mapping ?? 'none_needed',
    load: firstFit?.load ?? null,
    reps: first?.reps ?? null,
    durationS: first?.durationS ?? null,
    dropped: firstFit?.outcome === 'dropped',
    workingSets: sets.filter((s) => s.setType !== 'warmup').length,
  };
}

/** One row of the Swap sheet (§2.4). Every string is ready to show; the screen formats nothing. */
export interface SubstituteRow {
  exerciseId: string;
  name: string;
  /** `Dumbbells`, `Stack`, `Bodyweight`. */
  equipmentWord: string;
  /** `last 32.5 × 8 · 17 Sep` (an actual), or `No history`. */
  lastText: string;
  /** `32.5 kg each × 6–8`, `— × 6–8`, `BW × 12–15` (a target). */
  targetText: string;
  noHistory: boolean;
  /** `⚠ May hurt` (EL9): the pick asks first. Null when no active pain flag covers it. */
  mayHurt: { flagId: string; confirm: { title: string; message: string; confirm: 'Add anyway'; cancel: 'Choose another' } } | null;
  /** `Bench press · planned` (from `Swap again`): picking it is the same as `Undo swap`. */
  planned: boolean;
  accessibilityLabel: string;
  plan: SwapPlan;
  fit: SwapFit;
}

const KIND_WORD: Record<EquipmentInstance['kind'], string> = {
  barbell: 'Barbell',
  dumbbells: 'Dumbbells',
  weight_stack: 'Stack',
  assisted_stack: 'Assisted',
  plate_loaded_machine: 'Machine',
  bodyweight_station: 'Bodyweight',
};

/** A kind a gym can't hold an item of (a kettlebell, a band) reads `Equipment`. */
function kindWord(kind: Exercise['compatibleEquipment'][number] | undefined): string {
  return kind !== undefined && kind in KIND_WORD ? KIND_WORD[kind as EquipmentInstance['kind']] : 'Equipment';
}

const spokenUnit = (u: WeightUnit, n: number): string => (u === 'kg' ? (n === 1 ? 'kilogram' : 'kilograms') : n === 1 ? 'pound' : 'pounds');

/** `32.5` or `BW`: last time's top working set, as the sheet's `last` line shows it. */
function lastTopText(h: HistorySession): { text: string; spoken: string } | null {
  const working = h.sets.filter((s) => s.setType !== 'warmup' && s.reps !== null);
  if (working.length === 0) return null;
  const sign = (l: Load) => (loadDirection(l.convention) === 'assistance' ? -1 : 1) * convertMass(l, 'kg').value;
  let top = working[0];
  for (const s of working) if (top !== undefined && s.load !== null && s.load.convention !== 'bodyweight' && (top.load === null || top.load.convention === 'bodyweight' || sign(s.load) > sign(top.load))) top = s;
  if (top === undefined) return null;
  const reps = String(top.reps ?? 0);
  const at = dayMonthText(h.performedAtUtc, h.tz ?? 'UTC');
  if (top.load === null || top.load.convention === 'bodyweight') return { text: `last BW${NBSP}×${NBSP}${reps} · ${at}`, spoken: `last bodyweight for ${reps}` };
  const n = formatNumber(top.load.value);
  const each = top.load.convention === 'per_hand' ? ' each' : top.load.convention === 'assistance' ? ' of assistance' : '';
  return { text: `last ${n}${NBSP}×${NBSP}${reps} · ${at}`, spoken: `last ${n} ${spokenUnit(top.load.unit, top.load.value)}${each} for ${reps}` };
}

/** The target as the row will show it: `32.5 kg each × 6–8`. */
export function swapTargetText(fit: SwapFit, exercise: Exercise): { text: string; spoken: string } {
  const cell = loadCell(fit.load, fit.equipment?.loadConvention ?? exercise.defaultLoadConvention, fit.equipment?.kind ?? null, fit.dropped);
  const load = cell.unit === null ? cell.value : `${cell.value}${NBSP}${cell.unit}`;
  const amount = fit.reps !== null ? repRangeText(fit.reps) : fit.durationS !== null ? formatDuration(fit.durationS) : null;
  const spokenAmount = fit.reps === null ? (fit.durationS !== null ? formatDuration(fit.durationS) : '') : fit.reps.min === fit.reps.max ? `${String(fit.reps.min)} reps` : `${String(fit.reps.min)} to ${String(fit.reps.max)} reps`;
  return { text: amount === null ? load : `${load}${NBSP}×${NBSP}${amount}`, spoken: `${cell.spoken}${spokenAmount === '' ? '' : `, ${spokenAmount}`}` };
}

/** One Swap sheet row for an exercise: its plan, its fit here, and the words. */
export function substituteRow(exercise: Exercise, slot: SubstituteSlot, history: readonly HistorySession[], ctx: SubstituteContext & { nowMs: number }, planned = false): SubstituteRow {
  const plan = substituteTargets(slot, exercise, history, ctx);
  const fit = fitSwap(plan, slot, ctx);
  const found = comparableHistory(exercise, history, ctx);
  const last = found === null ? null : lastTopText(found.session);
  const covering = painFlagCovering([...ctx.painFlags], exercise.id, ctx.nowMs, ctx.at.tz);
  const equipmentWord = fit.equipment !== null ? KIND_WORD[fit.equipment.kind] : needsNoEquipment(exercise) ? 'Bodyweight' : kindWord(exercise.compatibleEquipment[0]);
  const target = swapTargetText(fit, exercise);
  const lastText = last?.text ?? 'No history';
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    equipmentWord,
    lastText,
    targetText: target.text,
    noHistory: plan.plan === null,
    mayHurt: covering === null ? null : { flagId: covering.flag.id, confirm: mayHurtConfirm({ ...covering.flag, exerciseName: exercise.name }) },
    planned,
    accessibilityLabel: [
      planned ? `${exercise.name}, planned` : exercise.name,
      equipmentWord.toLowerCase(),
      last?.spoken ?? 'no history',
      `target ${target.spoken.replace(/^target /, '')}`,
      covering === null ? null : mayHurtAccessibility(covering.flag),
    ]
      .filter((x): x is string => x !== null)
      .join(', '),
    plan,
    fit,
  };
}

export const MAX_SUBSTITUTES = 8;

export interface RankInput extends SubstituteContext {
  /** The slot's exercise (today's original, never the current substitute). */
  slotExercise: Exercise;
  slot: SubstituteSlot;
  /** Ben's exercises and the catalogue's rows (deduplicated by ID by the caller or here). */
  exercises: readonly Exercise[];
  /** The slot exercise's catalogue substitutions (`variations.substitutions[].key`), in catalogue order. */
  catalogueSubstitutions: readonly (string | null)[];
  /** Exercises in today's edited plan (skipped ones included): never offered. */
  excludeExerciseIds: ReadonlySet<string>;
  /** History by exercise ID, newest first or any order (only candidates need it). */
  histories: ReadonlyMap<string, readonly HistorySession[]>;
  nowMs: number;
  /**
   * `Swap again`: the slot's planned exercise is listed first as `· planned`,
   * with the target the plan gives it without the swap (what Undo restores).
   */
  planned?: { targetText: string; spoken: string } | null;
}

/**
 * `rankSubstitutions` (§6.2): (1) the slot exercise's catalogue substitutions
 * resolved to exercises by `catalogueKey`, in catalogue order; (2) exercises
 * with the same `family`, most recently done first (never done: by name).
 * Left out: anything in today's plan, anything this gym can't do, anything
 * measured differently, unresolved keys. Pain-flagged candidates are kept,
 * marked, and listed last. At most 8 (plus the planned row on `Swap again`).
 */
export function rankSubstitutions(input: RankInput): SubstituteRow[] {
  const byKey = new Map<string, Exercise>();
  const byId = new Map<string, Exercise>();
  for (const e of input.exercises) {
    if (!byId.has(e.id)) byId.set(e.id, e);
    if (e.catalogueKey && !byKey.has(e.catalogueKey)) byKey.set(e.catalogueKey, e);
  }
  const lastDone = (id: string): number => {
    const hs = input.histories.get(id) ?? [];
    return hs.reduce((m, h) => Math.max(m, toMs(h.performedAtUtc)), -Infinity);
  };
  const slotId = input.slotExercise.id;
  const ordered: Exercise[] = [];
  const seen = new Set<string>();
  const consider = (e: Exercise | undefined) => {
    if (e === undefined || seen.has(e.id)) return;
    seen.add(e.id);
    if (e.id === slotId || input.excludeExerciseIds.has(e.id)) return;
    if (e.measurement !== input.slotExercise.measurement) return;
    if (!doableHere(e, input.gym)) return;
    ordered.push(e);
  };
  for (const key of input.catalogueSubstitutions) if (key !== null) consider(byKey.get(key));
  const family = input.slotExercise.family;
  if (family !== undefined) {
    const kin = [...byId.values()]
      .filter((e) => e.family === family)
      .sort((a, b) => lastDone(b.id) - lastDone(a.id) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    for (const e of kin) consider(e);
  }
  const rows = ordered.map((e) => substituteRow(e, input.slot, input.histories.get(e.id) ?? [], input));
  const safe = rows.filter((r) => r.mayHurt === null);
  const flagged = rows.filter((r) => r.mayHurt !== null);
  const out = [...safe, ...flagged].slice(0, MAX_SUBSTITUTES);
  if (input.planned === undefined || input.planned === null) return out;
  const own = substituteRow(input.slotExercise, input.slot, input.histories.get(slotId) ?? [], input, true);
  const label = own.accessibilityLabel.replace(/target .*?(, May hurt.*)?$/, `target ${input.planned.spoken.replace(/^target /, '')}$1`);
  return [{ ...own, targetText: input.planned.targetText, accessibilityLabel: label }, ...out];
}


/** Most rows the Add exercise list builds targets for at once (search narrows it). */
export const MAX_ADD_CANDIDATES = 30;

/**
 * The Add exercise list (overview-today-edits §11.4, TE16): exercises not in
 * today's plan (skipped ones included), only what this gym can do unless
 * `showAll`, matching the search; Ben's recently done first, then by name.
 * Pain-flagged ones stay, marked by their row (`substituteRow`), and go last.
 * Returns the exercises to build rows for; no scores and no AI.
 */
export function rankAddCandidates(input: {
  exercises: readonly Exercise[];
  excludeExerciseIds: ReadonlySet<string>;
  query: string;
  gym: SnapGym;
  showAll: boolean;
  histories: ReadonlyMap<string, readonly HistorySession[]>;
  painFlags: readonly PainFlag[];
  nowMs: number;
  tz: string;
  limit?: number;
  /** Other names to search by (catalogue aliases, Ben's own; exercise-library EL1). */
  aliasesOf?: (e: Exercise) => readonly string[];
}): Exercise[] {
  const q = input.query.trim().toLowerCase();
  const seen = new Set<string>();
  const lastDone = (id: string): number => (input.histories.get(id) ?? []).reduce((m, h) => Math.max(m, toMs(h.performedAtUtc)), -Infinity);
  // The shared search (EL1: aliases, one typo per long word), plus any part of the name as before.
  const rankOf = (e: Exercise): number | null => {
    if (q === '') return 0;
    const m = matchExercise(q, e.name, input.aliasesOf?.(e) ?? []);
    return m !== null ? m.rank : e.name.toLowerCase().includes(q) ? 7 : null;
  };
  const ranks = new Map<string, number>();
  const pool = input.exercises.filter((e) => {
    if (seen.has(e.id) || input.excludeExerciseIds.has(e.id)) return false;
    seen.add(e.id);
    const rank = rankOf(e);
    if (rank === null) return false;
    ranks.set(e.id, rank);
    return input.showAll || doableHere(e, input.gym);
  });
  const flagged = (e: Exercise) => painFlagCovering([...input.painFlags], e.id, input.nowMs, input.tz) !== null;
  return pool
    .map((e) => ({ e, last: lastDone(e.id), hurt: flagged(e), rank: ranks.get(e.id) ?? 0 }))
    .sort((a, b) => Number(a.hurt) - Number(b.hurt) || a.rank - b.rank || b.last - a.last || a.e.name.localeCompare(b.e.name))
    .slice(0, input.limit ?? MAX_ADD_CANDIDATES)
    .map((x) => x.e);
}
