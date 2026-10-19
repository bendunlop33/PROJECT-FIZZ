import {
  EquipmentInstanceSchema,
  GymSchema,
  validate,
  type EquipmentInstance,
  type Exercise,
  type Gym,
  type GymEquipmentKind,
  type GymSetup,
  type Load,
  type PlateCount,
  type WeightUnit,
} from '@fizz/schemas';
import { formatNumber } from './display';
import { getAchievableLoads, isLoadAchievable } from './equipment';
import { isNotFor, needsNoEquipment } from './exercise-equipment';
import { loadRange, type EquipmentDraftBody, type GymDraft, type GymDraftItem } from './gym-presets';
import { fromScaled, toScaled } from './units';

/**
 * Quick gym setup (Ben, 20 Oct; ADR 0029): "assume a gym has lots of
 * dumbbells and plates. Just ask for the interval for dumbbells", "update as
 * we go and train the app for each gym".
 *
 * - A **full gym** is a name and one question, `Dumbbells go up in`. Every
 *   item it creates is *assumed* (`detailsSource: 'preset'`) until Ben edits
 *   or confirms it; snapping uses assumed items like any other (rule 4 still
 *   holds: loads come only from the item's list, never past its max).
 * - **Hotel / small** and **Home** ask `Dumbbells up to` and the step, and
 *   tick the few extras the gym has.
 * - **Learning as he trains** is a `GymEdit`: versioned writes with the
 *   content before, so Undo puts each record back (rule 5). `Not at this
 *   gym` marks the items that would be used for an exercise as not for it;
 *   a load the assumed rack or stack can't make offers one small fix.
 *
 * Pure. kg and lb are written natively (a lb gym has a 45 lb bar).
 */

export const DUMBBELL_STEPS: Readonly<Record<WeightUnit, readonly number[]>> = { kg: [1, 2, 2.5, 5], lb: [2.5, 5] };
export const DEFAULT_DUMBBELL_STEP: Readonly<Record<WeightUnit, number>> = { kg: 2.5, lb: 5 };
export const SMALL_DUMBBELL_MAX: Readonly<Record<WeightUnit, readonly number[]>> = { kg: [10, 15, 20, 25, 30, 40], lb: [20, 30, 40, 50, 60, 80] };
export const DEFAULT_SMALL_DUMBBELL_MAX: Readonly<Record<WeightUnit, number>> = { kg: 20, lb: 50 };
/** A full gym's heaviest dumbbell (per hand). */
export const FULL_DUMBBELL_MAX: Readonly<Record<WeightUnit, number>> = { kg: 50, lb: 120 };
/** The largest dumbbell step accepted from Ben or the coach. */
const MAX_DUMBBELL_STEP: Readonly<Record<WeightUnit, number>> = { kg: 10, lb: 20 };
/** Above these a typed load is taken as a typo, not a dumbbell or stack to add. */
const LEARN_CEILING: Readonly<Record<'dumbbells' | 'weight_stack', Record<WeightUnit, number>>> = {
  dumbbells: { kg: 100, lb: 220 },
  weight_stack: { kg: 400, lb: 900 },
};

const PLATES: Readonly<Record<WeightUnit, readonly number[]>> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
const BAR: Readonly<Record<WeightUnit, number>> = { kg: 20, lb: 45 };
const STACK: Readonly<Record<'cable' | 'machines' | 'small_cable' | 'assisted', Record<WeightUnit, { from: number; to: number; step: number }>>> = {
  cable: { kg: { from: 5, to: 100, step: 5 }, lb: { from: 10, to: 200, step: 10 } },
  machines: { kg: { from: 5, to: 120, step: 5 }, lb: { from: 10, to: 250, step: 10 } },
  small_cable: { kg: { from: 5, to: 60, step: 5 }, lb: { from: 10, to: 120, step: 10 } },
  assisted: { kg: { from: 5, to: 70, step: 5 }, lb: { from: 10, to: 150, step: 10 } },
};

const plates = (unit: WeightUnit, count: number): PlateCount[] => PLATES[unit].map((mass) => ({ mass, count }));

const common = (name: string, unit: WeightUnit) => ({
  name,
  unit,
  movementTags: [] as string[],
  availability: 'available' as const,
  detailsSource: 'preset' as const,
});

/** Every `step` from `step` up to `max` (the largest multiple not above it). */
export function dumbbellLoadsFor(unit: WeightUnit, step: number, max: number): number[] {
  if (!validDumbbellStep(unit, step)) throw new RangeError(`Dumbbell step ${String(step)} ${unit} is out of range`);
  const s = toScaled(step);
  const top = Math.floor(toScaled(max) / s) * s;
  return top < s ? [step] : loadRange(step, fromScaled(top), step);
}

export function validDumbbellStep(unit: WeightUnit, step: number): boolean {
  return Number.isFinite(step) && step > 0 && toScaled(step) <= toScaled(MAX_DUMBBELL_STEP[unit]) && toScaled(step) % 250 === 0;
}

const stackRange = (r: { from: number; to: number; step: number }) => loadRange(r.from, r.to, r.step);

type Item = Omit<GymDraftItem, 'ticked'>;

const ITEMS = {
  dumbbells: (unit: WeightUnit, step: number, max: number): Item => ({
    key: 'dumbbells',
    label: 'Dumbbells',
    equipment: { ...common('Dumbbells', unit), kind: 'dumbbells', loadConvention: 'per_hand', loads: dumbbellLoadsFor(unit, step, max) },
  }),
  barbell: (unit: WeightUnit, count: number): Item => ({
    key: 'barbell',
    label: 'Barbell and plates',
    equipment: { ...common('Barbell and plates', unit), kind: 'barbell', loadConvention: 'total', barMass: BAR[unit], plates: plates(unit, count) },
  }),
  plate_loaded: (unit: WeightUnit): Item => ({
    key: 'plate_loaded',
    label: 'Plate-loaded machines',
    equipment: { ...common('Plate-loaded machines', unit), kind: 'plate_loaded_machine', loadConvention: 'added', loadingSides: 2, plates: plates(unit, 8) },
  }),
  cable: (unit: WeightUnit, small: boolean): Item => ({
    key: 'cable',
    label: 'Cables',
    equipment: { ...common('Cable station', unit), kind: 'weight_stack', loadConvention: 'stack', stackLoads: stackRange(STACK[small ? 'small_cable' : 'cable'][unit]), addOns: [] },
  }),
  machines: (unit: WeightUnit): Item => ({
    key: 'machines',
    label: 'Machines',
    equipment: { ...common('Machines', unit), kind: 'weight_stack', loadConvention: 'stack', stackLoads: stackRange(STACK.machines[unit]), addOns: [] },
  }),
  assisted: (unit: WeightUnit): Item => ({
    key: 'assisted',
    label: 'Assisted pull-up / dip machine',
    equipment: { ...common('Assisted pull-up / dip machine', unit), kind: 'assisted_stack', loadConvention: 'assistance', assistanceLoads: stackRange(STACK.assisted[unit]) },
  }),
  pull_up_bar: (unit: WeightUnit): Item => ({
    key: 'pull_up_bar',
    label: 'Pull-up bar',
    equipment: { ...common('Pull-up bar', unit), kind: 'bodyweight_station', loadConvention: 'bodyweight' },
  }),
};

/** A full gym's items, in the gym screen's order. */
function fullGymItems(unit: WeightUnit, dumbbellStep: number): Item[] {
  return [
    ITEMS.dumbbells(unit, dumbbellStep, FULL_DUMBBELL_MAX[unit]),
    ITEMS.barbell(unit, 8),
    ITEMS.plate_loaded(unit),
    ITEMS.cable(unit, false),
    ITEMS.machines(unit),
    ITEMS.assisted(unit),
    ITEMS.pull_up_bar(unit),
  ];
}

/** Extras a small or home gym can tick (no paragraphs: the label is the whole choice). */
export type QuickExtra = 'cable' | 'barbell' | 'machines' | 'pull_up_bar';

export const QUICK_EXTRAS: Readonly<Record<'small' | 'home', readonly { key: QuickExtra; label: string; on: boolean }[]>> = {
  small: [
    { key: 'cable', label: 'Cables', on: true },
    { key: 'barbell', label: 'Barbell', on: false },
    { key: 'machines', label: 'Machines', on: false },
  ],
  home: [
    { key: 'barbell', label: 'Barbell', on: false },
    { key: 'pull_up_bar', label: 'Pull-up bar', on: false },
    { key: 'cable', label: 'Cables', on: false },
  ],
};

export const QUICK_GYM_TYPES: readonly { setup: GymSetup; title: string }[] = [
  { setup: 'full', title: 'Full gym' },
  { setup: 'small', title: 'Hotel / small' },
  { setup: 'home', title: 'Home' },
];

export type QuickGymInput =
  | { setup: 'full'; unit: WeightUnit; dumbbellStep: number }
  | { setup: 'small' | 'home'; unit: WeightUnit; dumbbells: { max: number; step: number } | null; extras: readonly QuickExtra[] };

/** The quick setup as a draft with every item ticked (saved with `materialiseGymDraft`, `setup` on the gym). */
export function buildQuickGymDraft(input: QuickGymInput): GymDraft {
  const { unit } = input;
  if (input.setup === 'full') return { presetId: 'full', unit, items: fullGymItems(unit, input.dumbbellStep).map((i) => ({ ...i, ticked: true })) };
  const has = new Set(input.extras);
  const items: Item[] = [];
  if (input.dumbbells !== null) items.push(ITEMS.dumbbells(unit, input.dumbbells.step, input.dumbbells.max));
  if (has.has('barbell')) items.push(ITEMS.barbell(unit, input.setup === 'home' ? 2 : 4));
  if (has.has('cable')) items.push(ITEMS.cable(unit, true));
  if (has.has('machines')) items.push(ITEMS.plate_loaded(unit), ITEMS.machines(unit));
  if (has.has('pull_up_bar')) items.push(ITEMS.pull_up_bar(unit));
  return { presetId: input.setup, unit, items: items.map((i) => ({ ...i, ticked: true })) };
}

// ---------------------------------------------------------------------------
// Assumed vs confirmed (rule 6: shown on the gym screen and in `Why?`, never as main-UI copy)

export function isAssumed(eq: Pick<EquipmentInstance, 'detailsSource'>): boolean {
  return eq.detailsSource === 'preset';
}

/** The gym screen's tag on an item: `Assumed`, or null once Ben confirmed it. */
export function assumedTag(eq: Pick<EquipmentInstance, 'detailsSource'>): string | null {
  return isAssumed(eq) ? 'Assumed' : null;
}

/** `Why?`'s Equipment line on a target made on an assumed item. */
export function assumedWhy(eq: Pick<EquipmentInstance, 'detailsSource' | 'kind'>): string | null {
  if (!isAssumed(eq)) return null;
  switch (eq.kind) {
    case 'weight_stack':
    case 'assisted_stack':
      return 'Assumed stack step';
    case 'dumbbells':
      return 'Assumed dumbbells';
    case 'barbell':
    case 'plate_loaded_machine':
      return 'Assumed plates';
    case 'bodyweight_station':
      return null;
  }
}

/** The coach's one-line view of a gym (`full gym (assumed)`); null for a gym set up item by item. */
export function gymSetupWords(gym: Pick<Gym, 'setup'>, equipment: readonly Pick<EquipmentInstance, 'detailsSource' | 'availability'>[]): string | null {
  if (gym.setup === undefined) return null;
  const word = gym.setup === 'full' ? 'full gym' : gym.setup === 'small' ? 'small gym' : 'home gym';
  return equipment.some((e) => e.availability === 'available' && isAssumed(e)) ? `${word} (assumed)` : word;
}

// ---------------------------------------------------------------------------
// Gym edits: versioned writes with the content before, so Undo can put each back

export interface GymEdit {
  gymId: string;
  /** The gym record's change (setup, missing kinds), or null. */
  gym: { before: Gym; after: Gym } | null;
  /** `before: null`: a new item (Undo retires it). */
  equipment: { before: EquipmentInstance | null; after: EquipmentInstance }[];
  /** Short app lines: `Leg press: not here`, `Added: Cables`. */
  lines: string[];
}

export interface GymWrite<T> {
  next: T;
  /** Null: a new record. */
  expectedVersion: number | null;
}

/** The writes that make an edit. */
export function gymEditWrites(edit: GymEdit): { gym: GymWrite<Gym> | null; equipment: GymWrite<EquipmentInstance>[] } {
  return {
    gym: edit.gym === null ? null : { next: edit.gym.after, expectedVersion: edit.gym.before.version },
    equipment: edit.equipment.map((e) => ({ next: e.after, expectedVersion: e.before?.version ?? null })),
  };
}

const sameContent = <T extends { version: number; updatedAtUtc: string }>(a: T, b: T): boolean => JSON.stringify({ ...a, updatedAtUtc: '', checkedAtUtc: '' }) === JSON.stringify({ ...b, updatedAtUtc: '', checkedAtUtc: '' });

/** True when every record already is what the edit saves (a retry after it landed: a duplicate, not a conflict). */
export function gymEditLanded(edit: GymEdit, current: { gym: Gym | null; equipment: (id: string) => EquipmentInstance | null }): boolean {
  if (edit.gym !== null && (current.gym === null || !sameContent(current.gym, edit.gym.after))) return false;
  return edit.equipment.every((e) => {
    const now = current.equipment(e.after.id);
    return now !== null && sameContent(now, e.after);
  });
}

/**
 * Undo of an edit: each record back to its content before, as a new version;
 * a new item is retired. Only while every record is still the version the edit
 * saved (rule 5: never applied over a newer change).
 */
export function planRevertGymEdit(
  edit: GymEdit,
  current: { gym: Gym | null; equipment: (id: string) => EquipmentInstance | null },
  atUtc: string,
): { gym: GymWrite<Gym> | null; equipment: GymWrite<EquipmentInstance>[] } | 'changed_since' {
  let gym: GymWrite<Gym> | null = null;
  if (edit.gym !== null) {
    const now = current.gym;
    if (now === null || now.version !== edit.gym.after.version) return 'changed_since';
    gym = { next: { ...edit.gym.before, version: now.version + 1, updatedAtUtc: atUtc }, expectedVersion: now.version };
  }
  const equipment: GymWrite<EquipmentInstance>[] = [];
  for (const e of edit.equipment) {
    const now = current.equipment(e.after.id);
    if (now === null || now.version !== e.after.version) return 'changed_since';
    const next: EquipmentInstance = e.before === null ? { ...now, availability: 'retired', version: now.version + 1, updatedAtUtc: atUtc } : { ...e.before, version: now.version + 1, updatedAtUtc: atUtc };
    equipment.push({ next, expectedVersion: now.version });
  }
  return { gym, equipment };
}

interface NewItemMeta {
  ownerId: string;
  gymId: string;
  atUtc: string;
  newId: () => string;
}

function materialiseItem(body: EquipmentDraftBody, meta: NewItemMeta): EquipmentInstance {
  const r = validate(EquipmentInstanceSchema, { ...body, id: meta.newId(), ownerId: meta.ownerId, gymId: meta.gymId, version: 1, createdAtUtc: meta.atUtc, updatedAtUtc: meta.atUtc });
  if (!r.ok) throw new Error(`Invalid quick gym item: ${r.issues[0]?.message ?? ''}`);
  return r.value;
}

function bumped<T extends { version: number; updatedAtUtc: string }>(doc: T, patch: Partial<T>, atUtc: string): T {
  return { ...doc, ...patch, version: doc.version + 1, updatedAtUtc: atUtc };
}

function validGym(gym: Gym): Gym {
  const r = validate(GymSchema, gym);
  if (!r.ok) throw new Error(`Invalid gym: ${r.issues[0]?.message ?? ''}`);
  return r.value;
}

function validItem(eq: EquipmentInstance): EquipmentInstance {
  const r = validate(EquipmentInstanceSchema, eq);
  if (!r.ok) throw new Error(`Invalid equipment: ${r.issues[0]?.message ?? ''}`);
  return r.value;
}

const KIND_WORD: Readonly<Record<GymEquipmentKind, string>> = {
  barbell: 'Barbell',
  dumbbells: 'Dumbbells',
  plate_loaded_machine: 'Plate-loaded machines',
  weight_stack: 'Cables and machines',
  assisted_stack: 'Assisted machine',
  bodyweight_station: 'Pull-up bar',
};

export function gymKindWord(kind: GymEquipmentKind): string {
  return KIND_WORD[kind];
}

/** A full gym's items of one kind (two stacks: cables and machines). */
function fullItemsOfKind(kind: GymEquipmentKind, unit: WeightUnit, dumbbellStep: number): Item[] {
  return fullGymItems(unit, dumbbellStep).filter((i) => i.equipment.kind === kind);
}

const available = (equipment: readonly EquipmentInstance[]) => equipment.filter((e) => e.availability === 'available');

/** `Make full gym` adds dumbbells, so the screen asks `Dumbbells go up in` first. */
export function makeFullNeedsDumbbellStep(gym: Pick<Gym, 'missingKinds'>, equipment: readonly EquipmentInstance[]): boolean {
  return !available(equipment).some((e) => e.kind === 'dumbbells') && !(gym.missingKinds ?? []).includes('dumbbells');
}

/**
 * `Make full gym` on an existing gym: keeps every item Ben has (confirmed or
 * not) and adds, assumed, each full-gym kind the gym has none of, except kinds
 * Ben said it doesn't have (`missingKinds`). The gym becomes `setup: 'full'`.
 */
export function planMakeFullGym(input: {
  gym: Gym;
  equipment: readonly EquipmentInstance[];
  unit: WeightUnit;
  dumbbellStep: number;
  atUtc: string;
  newId: () => string;
}): { kind: 'edit'; edit: GymEdit } | { kind: 'nothing_to_add' } {
  const have = new Set(available(input.equipment).map((e) => e.kind));
  const skip = new Set<GymEquipmentKind>([...have, ...(input.gym.missingKinds ?? [])]);
  const meta = { ownerId: input.gym.ownerId, gymId: input.gym.id, atUtc: input.atUtc, newId: input.newId };
  const added = fullGymItems(input.unit, input.dumbbellStep)
    .filter((i) => !skip.has(i.equipment.kind))
    .map((i) => materialiseItem(i.equipment, meta));
  if (added.length === 0) return { kind: 'nothing_to_add' };
  const after = validGym(bumped(input.gym, { setup: 'full' }, input.atUtc));
  return {
    kind: 'edit',
    edit: { gymId: input.gym.id, gym: { before: input.gym, after }, equipment: added.map((a) => ({ before: null, after: a })), lines: added.map((a) => `Added: ${a.name}`) },
  };
}

// ---------------------------------------------------------------------------
// `Not at this gym` (mid-workout ⋯, or the coach on Ben's words)

type NotHereExercise = Pick<Exercise, 'id' | 'name' | 'compatibleEquipment' | 'defaultLoadConvention'>;

/**
 * Every available item the exercise could use here is marked not for it, so
 * no build, swap or picker maps it to this gym again. Other exercises on the
 * same items are untouched (a gym can have cables and no leg extension).
 */
export function planNotHere(input: { exercise: NotHereExercise; equipment: readonly EquipmentInstance[]; atUtc: string }): { kind: 'edit'; edit: GymEdit } | { kind: 'none_needed' } | { kind: 'already' } {
  const ex = input.exercise;
  if (needsNoEquipment(ex)) return { kind: 'none_needed' };
  const items = available(input.equipment).filter((e) => ex.compatibleEquipment.includes(e.kind) && !isNotFor(e, ex.id));
  const first = items[0];
  if (first === undefined) return { kind: 'already' };
  return {
    kind: 'edit',
    edit: {
      gymId: first.gymId,
      gym: null,
      equipment: items.map((e) => ({ before: e, after: validItem(bumped(e, { notFor: [...(e.notFor ?? []), ex.id] }, input.atUtc)) })),
      lines: [`${ex.name}: not here`],
    },
  };
}

/** The exercises Ben marked not at this gym (any available item lists them). */
export function notHereExerciseIds(equipment: readonly EquipmentInstance[]): string[] {
  return [...new Set(available(equipment).flatMap((e) => e.notFor ?? []))];
}

/** `Put back` on the gym screen: the exercise can use this gym's items again. */
export function planPutBack(input: { exerciseId: string; exerciseName: string; equipment: readonly EquipmentInstance[]; atUtc: string }): GymEdit | null {
  const items = available(input.equipment).filter((e) => isNotFor(e, input.exerciseId));
  const first = items[0];
  if (first === undefined) return null;
  return {
    gymId: first.gymId,
    gym: null,
    equipment: items.map((e) => ({ before: e, after: validItem(bumped(withNotFor(e, (e.notFor ?? []).filter((x) => x !== input.exerciseId)), {}, input.atUtc)) })),
    lines: [`${input.exerciseName}: back`],
  };
}

// ---------------------------------------------------------------------------
// Learning from a logged or typed load

export type GymLearn =
  | { kind: 'add_dumbbell'; equipmentId: string; unit: WeightUnit; value: number }
  | { kind: 'stack_step'; equipmentId: string; unit: WeightUnit; step: number }
  | { kind: 'stack_max'; equipmentId: string; unit: WeightUnit; max: number };

/** The chip: `Add 22 kg dumbbells here?`, `Stack goes up in 7 kg?`, `Stack goes to 110 kg?`. */
export function gymLearnText(l: GymLearn): string {
  switch (l.kind) {
    case 'add_dumbbell':
      return `Add ${formatNumber(l.value)} ${l.unit} dumbbells here?`;
    case 'stack_step':
      return `Stack goes up in ${formatNumber(l.step)} ${l.unit}?`;
    case 'stack_max':
      return `Stack goes to ${formatNumber(l.max)} ${l.unit}?`;
  }
}

/** After Ben's tap (toast and the edit's line): `Added 22 kg dumbbells`, `Stack: every 7 kg`, `Stack: to 110 kg`. */
export function gymLearnDoneText(l: GymLearn): string {
  switch (l.kind) {
    case 'add_dumbbell':
      return `Added ${formatNumber(l.value)} ${l.unit} dumbbells`;
    case 'stack_step':
      return `Stack: every ${formatNumber(l.step)} ${l.unit}`;
    case 'stack_max':
      return `Stack: to ${formatNumber(l.max)} ${l.unit}`;
  }
}

/** One offer per load idea: the chip isn't shown again after Ben answers it (this workout). */
export function gymLearnKey(l: GymLearn): string {
  return `${l.equipmentId}:${l.kind}:${formatNumber(l.kind === 'add_dumbbell' ? l.value : l.kind === 'stack_step' ? l.step : l.max)}`;
}

/** Stack steps tried for an off-step load, most common first. */
const STACK_STEPS: Readonly<Record<WeightUnit, readonly number[]>> = { kg: [5, 2.5, 10, 7, 4.5, 7.5, 6, 4, 3, 2], lb: [10, 5, 15, 12.5, 7.5, 20, 2.5] };

/** The most common gap between neighbouring loads. */
function usualGap(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (let i = 1; i < values.length; i += 1) {
    const d = toScaled(values[i] ?? 0) - toScaled(values[i - 1] ?? 0);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: [number, number] | null = null;
  for (const [d, n] of counts) if (best === null || n > best[1] || (n === best[1] && d < best[0])) best = [d, n];
  return best === null ? null : best[0];
}

/**
 * What a load the item can't make suggests about the gym, or null. Dumbbells:
 * that dumbbell is there (any rack). A stack Ben hasn't confirmed: it goes
 * higher (the load is on its step, above the top), or it steps in another
 * size the load is a multiple of. Units and conventions must match; a load
 * past a sane ceiling is a typo, never a suggestion.
 */
export function gymLearnFor(eq: EquipmentInstance, load: Load | null): GymLearn | null {
  if (load === null || load.unit !== eq.unit || load.convention !== eq.loadConvention || !(load.value > 0)) return null;
  if (isLoadAchievable(load, eq)) return null;
  const v = toScaled(load.value);
  if (eq.kind === 'dumbbells') {
    if (v > toScaled(LEARN_CEILING.dumbbells[eq.unit]) || v % 250 !== 0) return null;
    return { kind: 'add_dumbbell', equipmentId: eq.id, unit: eq.unit, value: load.value };
  }
  if (eq.kind !== 'weight_stack' || !isAssumed(eq) || v > toScaled(LEARN_CEILING.weight_stack[eq.unit])) return null;
  const top = eq.stackLoads.at(-1);
  const gap = usualGap(eq.stackLoads);
  if (top !== undefined && gap !== null && v > toScaled(top) && (v - toScaled(top)) % gap === 0) {
    return { kind: 'stack_max', equipmentId: eq.id, unit: eq.unit, max: load.value };
  }
  const step = STACK_STEPS[eq.unit].find((s) => toScaled(s) !== gap && v % toScaled(s) === 0);
  return step === undefined ? null : { kind: 'stack_step', equipmentId: eq.id, unit: eq.unit, step };
}

/**
 * The learned change on the item as saved now (not the workout's snapshot).
 * Null when it no longer applies (it already makes the load, or the item
 * changed kind or unit). The item becomes confirmed: Ben told us.
 */
export function planGymLearn(eq: EquipmentInstance, learn: GymLearn, atUtc: string): GymEdit | null {
  if (eq.id !== learn.equipmentId || eq.unit !== learn.unit || eq.availability !== 'available') return null;
  const confirmed = { detailsSource: 'user' as const, checkedAtUtc: atUtc };
  let after: EquipmentInstance;
  if (learn.kind === 'add_dumbbell') {
    if (eq.kind !== 'dumbbells' || eq.loads.some((l) => toScaled(l) === toScaled(learn.value))) return null;
    const loads = [...eq.loads, learn.value].sort((a, b) => a - b);
    after = bumped(eq, { ...confirmed, loads, ...(eq.maxLoad !== undefined && eq.maxLoad < learn.value ? { maxLoad: learn.value } : {}) }, atUtc);
  } else {
    if (eq.kind !== 'weight_stack') return null;
    const top = eq.stackLoads.at(-1) ?? 0;
    let stackLoads: number[];
    if (learn.kind === 'stack_max') {
      const gap = usualGap(eq.stackLoads);
      if (gap === null || toScaled(learn.max) <= toScaled(top)) return null;
      stackLoads = [...eq.stackLoads, ...loadRange(fromScaled(toScaled(top) + gap), learn.max, fromScaled(gap))];
    } else {
      const s = toScaled(learn.step);
      const newTop = Math.floor(toScaled(top) / s) * s;
      if (newTop < s) return null;
      stackLoads = loadRange(learn.step, fromScaled(newTop), learn.step);
    }
    const maxLoad = eq.maxLoad !== undefined && eq.maxLoad < (stackLoads.at(-1) ?? 0) ? { maxLoad: stackLoads.at(-1) } : {};
    after = bumped(eq, { ...confirmed, stackLoads, ...maxLoad }, atUtc);
  }
  const valid = validItem(after);
  if (getAchievableLoads(valid).loads.length === 0) return null;
  return { gymId: eq.gymId, gym: null, equipment: [{ before: eq, after: valid }], lines: [gymLearnDoneText(learn)] };
}

// ---------------------------------------------------------------------------
// The coach's `update_gym` (applied on Ben's words, else offered as a card)

export type GymUpdateChange =
  /** The gym has this kind after all: the full-gym items of it, assumed. */
  | { op: 'add'; equipment: GymEquipmentKind }
  /** The gym has none of this kind: its items retired; `Make full gym` won't add it back. */
  | { op: 'remove'; equipment: GymEquipmentKind }
  /** The dumbbell rack's top and/or step (per hand). */
  | { op: 'dumbbells'; max: number | null; step: number | null }
  /** A stack's step (the item named, else every stack at the gym). */
  | { op: 'stack_step'; step: number; itemName: string | null }
  /** One exercise isn't possible here ("this gym has no leg press"). */
  | { op: 'not_here'; exerciseId: string };

export type GymUpdatePlan = { ok: true; edit: GymEdit } | { ok: false; reason: string };

/**
 * The coach's changes on the gym as saved now, in order, as one edit. Every
 * number is checked here (steps in range, dumbbells and stacks only from
 * ranges, never past a ceiling); the model's arguments are only a request.
 */
export function planGymUpdate(input: {
  gym: Gym;
  equipment: readonly EquipmentInstance[];
  unit: WeightUnit;
  changes: readonly GymUpdateChange[];
  exercise: (id: string) => NotHereExercise | null;
  atUtc: string;
  newId: () => string;
}): GymUpdatePlan {
  const { atUtc } = input;
  let gym = input.gym;
  let gymTouched = false;
  /** Working copies by ID: the edit's first `before` and latest `after`. */
  const items = new Map<string, EquipmentInstance>(input.equipment.map((e) => [e.id, e]));
  const before = new Map<string, EquipmentInstance | null>();
  const lines: string[] = [];
  const meta = { ownerId: gym.ownerId, gymId: gym.id, atUtc, newId: input.newId };
  const put = (next: EquipmentInstance, prev: EquipmentInstance | null) => {
    if (!before.has(next.id)) before.set(next.id, prev);
    items.set(next.id, next);
  };
  /** One version bump per record per edit, however many changes touch it. */
  const edit = (e: EquipmentInstance, patch: Partial<EquipmentInstance>): EquipmentInstance => {
    const orig = before.has(e.id) ? before.get(e.id) : e;
    const base = orig === null || orig === undefined ? e : orig;
    return validItem({ ...e, ...patch, version: base.version + (orig === null ? 0 : 1), updatedAtUtc: atUtc } as EquipmentInstance);
  };
  const live = () => [...items.values()].filter((e) => e.availability === 'available');

  for (const c of input.changes) {
    switch (c.op) {
      case 'add': {
        const missing = (gym.missingKinds ?? []).filter((k) => k !== c.equipment);
        if (missing.length !== (gym.missingKinds ?? []).length) {
          gym = withMissingKinds(gym, missing);
          gymTouched = true;
        }
        if (live().some((e) => e.kind === c.equipment)) {
          lines.push(`${gymKindWord(c.equipment)}: already here`);
          break;
        }
        for (const i of fullItemsOfKind(c.equipment, input.unit, DEFAULT_DUMBBELL_STEP[input.unit])) {
          const made = materialiseItem(i.equipment, meta);
          put(made, null);
        }
        lines.push(`Added: ${gymKindWord(c.equipment)}`);
        break;
      }
      case 'remove': {
        for (const e of live().filter((x) => x.kind === c.equipment)) put(edit(e, { availability: 'retired' }), e);
        const kinds = new Set(gym.missingKinds ?? []);
        if (!kinds.has(c.equipment)) {
          gym = withMissingKinds(gym, [...kinds, c.equipment]);
          gymTouched = true;
        }
        lines.push(`${gymKindWord(c.equipment)}: not here`);
        break;
      }
      case 'dumbbells': {
        const rack = live().find((e) => e.kind === 'dumbbells');
        if (rack === undefined) return { ok: false, reason: 'no dumbbells at this gym' };
        const step = c.step ?? usualGapValue(rack.loads) ?? DEFAULT_DUMBBELL_STEP[rack.unit];
        if (!validDumbbellStep(rack.unit, step)) return { ok: false, reason: `a ${formatNumber(step)} ${rack.unit} dumbbell step isn’t possible` };
        const max = c.max ?? rack.loads.at(-1) ?? FULL_DUMBBELL_MAX[rack.unit];
        if (!(max >= step) || toScaled(max) > toScaled(LEARN_CEILING.dumbbells[rack.unit])) return { ok: false, reason: `dumbbells up to ${formatNumber(max)} ${rack.unit} isn’t possible` };
        const loads = dumbbellLoadsFor(rack.unit, step, max);
        put(edit(rack, { loads, detailsSource: 'user', checkedAtUtc: atUtc }), rack);
        lines.push(`Dumbbells: ${formatNumber(loads[0] ?? step)}–${formatNumber(loads.at(-1) ?? max)} ${rack.unit}, every ${formatNumber(step)}`);
        break;
      }
      case 'stack_step': {
        const name = c.itemName?.trim().toLowerCase() ?? '';
        const stacks = live().filter((e) => e.kind === 'weight_stack' && (name === '' || e.name.toLowerCase().includes(name)));
        if (stacks.length === 0) return { ok: false, reason: name === '' ? 'no stack at this gym' : `no stack called ${c.itemName ?? ''} at this gym` };
        for (const s of stacks) {
          if (s.kind !== 'weight_stack') continue;
          const step = toScaled(c.step);
          if (!(c.step > 0) || step % 250 !== 0 || c.step > (s.unit === 'kg' ? 25 : 50)) return { ok: false, reason: `a ${formatNumber(c.step)} ${s.unit} stack step isn’t possible` };
          const top = Math.floor(toScaled(s.stackLoads.at(-1) ?? 0) / step) * step;
          if (top < step) return { ok: false, reason: `a ${formatNumber(c.step)} ${s.unit} step is above ${s.name}’s top` };
          put(edit(s, { stackLoads: loadRange(c.step, fromScaled(top), c.step), detailsSource: 'user', checkedAtUtc: atUtc }), s);
        }
        lines.push(`${stacks.length === 1 ? (stacks[0]?.name ?? 'Stack') : 'Stacks'}: every ${formatNumber(c.step)} ${stacks[0]?.unit ?? input.unit}`);
        break;
      }
      case 'not_here': {
        const ex = input.exercise(c.exerciseId);
        if (ex === null) return { ok: false, reason: 'that exercise isn’t known' };
        const p = planNotHere({ exercise: ex, equipment: live(), atUtc });
        if (p.kind === 'none_needed') return { ok: false, reason: `${ex.name} needs no equipment` };
        if (p.kind === 'already') {
          lines.push(`${ex.name}: already not here`);
          break;
        }
        for (const e of p.edit.equipment) {
          const cur = e.before ?? e.after;
          put(edit(cur, { notFor: e.after.notFor ?? [] }), cur);
        }
        lines.push(...p.edit.lines);
        break;
      }
    }
  }
  const equipment = [...before.entries()].flatMap(([id, prev]) => {
    const after = items.get(id);
    return after === undefined ? [] : [{ before: prev, after }];
  });
  const gymAfter = gymTouched ? validGym({ ...gym, version: input.gym.version + 1, updatedAtUtc: atUtc }) : null;
  if (equipment.length === 0 && gymAfter === null) return { ok: false, reason: lines.length > 0 ? lines.join(', ').toLowerCase() : 'nothing to change' };
  return { ok: true, edit: { gymId: input.gym.id, gym: gymAfter === null ? null : { before: input.gym, after: gymAfter }, equipment, lines: lines.slice(0, 6) } };
}

/** The record with `notFor` set, or without the key when empty (stored documents stay as before). */
function withNotFor(e: EquipmentInstance, ids: readonly string[]): EquipmentInstance {
  const copy: EquipmentInstance = { ...e };
  if (ids.length > 0) copy.notFor = [...ids];
  else delete copy.notFor;
  return copy;
}

function withMissingKinds(gym: Gym, kinds: readonly GymEquipmentKind[]): Gym {
  const copy: Gym = { ...gym };
  if (kinds.length > 0) copy.missingKinds = [...kinds];
  else delete copy.missingKinds;
  return copy;
}

function usualGapValue(values: readonly number[]): number | null {
  const g = usualGap(values);
  return g === null ? null : fromScaled(g);
}
