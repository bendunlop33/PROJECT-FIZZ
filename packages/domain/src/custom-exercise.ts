import { CustomExerciseFieldsSchema, muscleGroupOf, type CustomExerciseFields, type Exercise, type ExerciseEquipmentKind, type LoadConvention, type Measurement } from '@fizz/schemas';

import { EXERCISE_EQUIPMENT_WORD } from './exercise-browse';
import { normaliseSearchText } from './exercise-search';
import { deriveId } from './stable';

/**
 * Custom exercises (Ben, 19 Oct: "Why can't the chat function make exercises
 * not in the catalogue"; exercise-library §2.6). Pure. Ben makes one in
 * Library › ＋ New exercise, or taps Add on the coach's proposal card (rule 3:
 * a proposal until he does). Once saved it is a normal exercise row owned by
 * Ben (Your data, rule 10): pickers, the coach's lists, loads checked against
 * the gym's equipment (rule 4), Progress, backups. Writes are versioned and
 * idempotent by opId (rule 5); delete hides it and keeps its history.
 */

/** Equipment choices in the form's order, each with the load conventions that fit it (first = default). */
export const CUSTOM_EQUIPMENT: readonly { kind: ExerciseEquipmentKind; conventions: readonly LoadConvention[] }[] = [
  { kind: 'barbell', conventions: ['total', 'added'] },
  { kind: 'dumbbells', conventions: ['per_hand'] },
  { kind: 'weight_stack', conventions: ['stack'] },
  { kind: 'plate_loaded_machine', conventions: ['added'] },
  { kind: 'bodyweight_station', conventions: ['bodyweight', 'added'] },
  { kind: 'assisted_stack', conventions: ['assistance'] },
  { kind: 'kettlebell', conventions: ['per_hand', 'total'] },
  { kind: 'ez_bar', conventions: ['total'] },
  { kind: 'trap_bar', conventions: ['total', 'added'] },
  { kind: 'smith_machine', conventions: ['total'] },
  { kind: 'erg', conventions: ['bodyweight'] },
  { kind: 'band', conventions: ['bodyweight'] },
  { kind: 'sled', conventions: ['added'] },
  { kind: 'medicine_ball', conventions: ['total'] },
  { kind: 'sandbag', conventions: ['total'] },
];

/** Short words for how a load is counted (form chips and the proposal card). */
export const CONVENTION_WORD: Record<LoadConvention, string> = {
  total: 'Total',
  per_hand: 'Each hand',
  stack: 'Stack',
  added: 'Plates added',
  assistance: 'Assisted',
  bodyweight: 'Bodyweight',
};

export const MEASUREMENT_WORD: Record<Measurement, string> = { reps: 'Reps', duration: 'Time', distance: 'Distance', cardio: 'Cardio' };

/** The muscle stored for each group chip on the form (the group is what every view shows). */
export const GROUP_MUSCLE = {
  Chest: 'chest',
  Back: 'lats',
  Shoulders: 'front_delts',
  Biceps: 'biceps',
  Triceps: 'triceps',
  Quads: 'quads',
  Hamstrings: 'hamstrings',
  Glutes: 'glutes',
  Calves: 'calves',
  Core: 'abs',
  Forearms: 'forearms',
} as const satisfies Record<string, CustomExerciseFields['primaryMuscles'][number]>;

export function conventionsFor(kind: ExerciseEquipmentKind): readonly LoadConvention[] {
  return CUSTOM_EQUIPMENT.find((c) => c.kind === kind)?.conventions ?? ['total'];
}

export function defaultConventionFor(kind: ExerciseEquipmentKind): LoadConvention {
  return conventionsFor(kind)[0] ?? 'total';
}

export type CustomFieldsCheck = { ok: true; fields: CustomExerciseFields } | { ok: false; problem: string };

/** Schema plus the pairing rules: a convention that fits the equipment, muscles once each. */
export function checkCustomExerciseFields(input: unknown): CustomFieldsCheck {
  const r = CustomExerciseFieldsSchema.safeParse(input);
  if (!r.success) return { ok: false, problem: r.error.issues[0]?.path[0] === 'name' ? 'Name needed.' : r.error.issues[0]?.path[0] === 'primaryMuscles' ? 'Pick 1 to 3 muscles.' : 'Check the fields.' };
  const f = { ...r.data, name: r.data.name.replace(/\s+/g, ' ') };
  // A bench or rack is presence only (ADR 0030): never an exercise's load equipment.
  if (!CUSTOM_EQUIPMENT.some((c) => c.kind === f.equipment)) return { ok: false, problem: 'Check the fields.' };
  if (!conventionsFor(f.equipment).includes(f.loadConvention)) return { ok: false, problem: `${EXERCISE_EQUIPMENT_WORD[f.equipment]} can’t be ${CONVENTION_WORD[f.loadConvention].toLowerCase()}.` };
  if (new Set(f.primaryMuscles).size !== f.primaryMuscles.length) return { ok: false, problem: 'Pick each muscle once.' };
  return { ok: true, fields: f };
}

/** A name compared by meaning: case, punctuation and plurals ("raises") aside. */
export function exerciseNameKey(name: string): string {
  return normaliseSearchText(name)
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('es') && /(ss|sh|ch|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

export interface ClashCandidate {
  id: string;
  name: string;
  aliases: readonly string[];
  source: Exercise['source'];
  archived: boolean;
}

/**
 * An exercise already in Ben's list under this name or one of its other names (archived ones
 * aside): "Seated calf raise is already in your exercises". `selfId`: the exercise being edited.
 */
export function exerciseNameClash<T extends ClashCandidate>(name: string, pool: readonly T[], selfId: string | null = null): T | null {
  const key = exerciseNameKey(name);
  if (key === '') return null;
  const hits = pool.filter((e) => e.id !== selfId && !e.archived && (exerciseNameKey(e.name) === key || e.aliases.some((a) => exerciseNameKey(a) === key)));
  return hits.find((e) => exerciseNameKey(e.name) === key && e.source === 'catalogue') ?? hits.find((e) => exerciseNameKey(e.name) === key) ?? hits[0] ?? null;
}

/** Words that don't change which exercise a name means ("Seated calf raise machine", "Calf raise (seated)"). */
const FILLER_WORDS = new Set(['machine', 'the', 'a', 'an', 'with', 'on', 'using', 'exercise', 'movement', 'variation']);

function nameWords(name: string): Set<string> {
  return new Set(
    exerciseNameKey(name)
      .split(' ')
      .filter((w) => w !== '' && !FILLER_WORDS.has(w)),
  );
}

/** One name against another, by meaning: the same words in any order (filler aside), or the proposed name's 2+ words all in the other with one word to spare. */
function nearlyNamed(proposed: Set<string>, other: Set<string>): boolean {
  if (proposed.size === 0 || other.size === 0) return false;
  const inOther = [...proposed].every((w) => other.has(w));
  if (inOther && proposed.size === other.size) return true;
  return inOther && proposed.size >= 2 && other.size - proposed.size === 1;
}

/**
 * (Review exlist S3) The coach's duplicate guard: an exact clash first (`exerciseNameClash`), else an
 * exercise whose name or other name means the same ("Seated calf raise machine", "Calf raise (seated)",
 * "Machine seated calf" all mean Seated calf raise). `near` says which. A name with more words than an
 * existing one ("Meadows barbell row" vs "Barbell row") is a different exercise. Pure.
 */
export function exerciseNearDuplicate<T extends ClashCandidate>(name: string, pool: readonly T[], selfId: string | null = null): { hit: T; near: boolean } | null {
  const exact = exerciseNameClash(name, pool, selfId);
  if (exact !== null) return { hit: exact, near: false };
  const words = nameWords(name);
  const live = pool.filter((e) => e.id !== selfId && !e.archived);
  const byName = live.filter((e) => nearlyNamed(words, nameWords(e.name)));
  const hit = byName.find((e) => e.source === 'catalogue') ?? byName[0] ?? live.find((e) => e.aliases.some((a) => nearlyNamed(words, nameWords(a)))) ?? null;
  return hit === null ? null : { hit, near: true };
}

export const clashLine = (existingName: string): string => `${existingName} is already in your exercises.`;

/** The ID a custom exercise gets: from the coach's proposal (one exercise per card), else from Ben's form operation. */
export function customExerciseIdOf(ownerId: string, from: { proposalActionId: string } | { opId: string }): string {
  return 'proposalActionId' in from ? deriveId(`custom-exercise:${ownerId}:coach:${from.proposalActionId}`) : deriveId(`custom-exercise:${ownerId}:library:${from.opId}`);
}

export function isArchivedExercise(e: Pick<Exercise, 'archivedAtUtc'>): boolean {
  return e.archivedAtUtc !== undefined;
}

/** Version 1 of a custom exercise. */
export function newCustomExercise(fields: CustomExerciseFields, at: { id: string; ownerId: string; atUtc: string; opId: string }): Exercise {
  return {
    id: at.id,
    ownerId: at.ownerId,
    source: 'custom',
    name: fields.name,
    movementPattern: 'other',
    primaryMuscles: [...fields.primaryMuscles],
    catalogueKey: null,
    measurement: fields.measurement,
    laterality: fields.laterality,
    compatibleEquipment: [fields.equipment],
    defaultLoadConvention: fields.loadConvention,
    lastOpId: at.opId,
    version: 1,
    createdAtUtc: at.atUtc,
    updatedAtUtc: at.atUtc,
  };
}

/** The form's fields for an existing custom exercise (Edit). */
export function customFieldsOf(e: Exercise): CustomExerciseFields {
  const equipment = e.compatibleEquipment[0] ?? (e.defaultLoadConvention === 'bodyweight' ? 'bodyweight_station' : 'barbell');
  const muscles = e.primaryMuscles.filter((m): m is CustomExerciseFields['primaryMuscles'][number] => muscleGroupOf(m) !== null).slice(0, 3);
  return { name: e.name, equipment, loadConvention: e.defaultLoadConvention, primaryMuscles: muscles.length === 0 ? ['chest'] : muscles, measurement: e.measurement, laterality: e.laterality };
}

export type CustomEdit = { ok: true; exercise: Exercise } | { ok: false; reason: 'not_custom' | 'locked'; message: string };

export const CUSTOM_LOCKED_LINE = 'In use already: equipment, load, measure and sides stay. Make a new exercise to change them.';

/**
 * A new version with Ben's edit (EL3): once it is in use (a set logged with it, or it is in a workout,
 * routine, draft, plan or next-session target; review exlist S4: their loads are in its convention), the
 * equipment, how the load is counted, the measure and the sides stay; the name and muscles change.
 */
export function editedCustomExercise(existing: Exercise, fields: CustomExerciseFields, at: { atUtc: string; opId: string; inUse: boolean }): CustomEdit {
  if (existing.source !== 'custom') return { ok: false, reason: 'not_custom', message: 'Only your own exercises can be edited.' };
  const before = customFieldsOf(existing);
  const shapeChanged = before.equipment !== fields.equipment || before.loadConvention !== fields.loadConvention || before.measurement !== fields.measurement || before.laterality !== fields.laterality;
  if (at.inUse && shapeChanged) return { ok: false, reason: 'locked', message: CUSTOM_LOCKED_LINE };
  return {
    ok: true,
    exercise: {
      ...existing,
      name: fields.name,
      primaryMuscles: [...fields.primaryMuscles],
      measurement: fields.measurement,
      laterality: fields.laterality,
      compatibleEquipment: [fields.equipment],
      defaultLoadConvention: fields.loadConvention,
      lastOpId: at.opId,
      version: existing.version + 1,
      updatedAtUtc: at.atUtc,
    },
  };
}

/** Delete: hidden from pickers and the coach; history kept and still named. */
export function archivedCustomExercise(existing: Exercise, at: { atUtc: string; opId: string }): Exercise {
  return { ...existing, archivedAtUtc: at.atUtc, lastOpId: at.opId, version: existing.version + 1, updatedAtUtc: at.atUtc };
}

const MEASURED_SHORT: Record<Measurement, string> = { reps: 'reps', duration: 'time', distance: 'distance', cardio: 'cardio' };
const CONVENTION_SHORT: Record<LoadConvention, string> = { total: 'total load', per_hand: 'each hand', stack: 'stack', added: 'plates added', assistance: 'assisted', bodyweight: 'bodyweight' };

/** The proposal card's one line: "Meadows row · Barbell · total load · Back, Biceps · reps". */
export function customExerciseLine(f: CustomExerciseFields): string {
  const groups = [...new Set(f.primaryMuscles.map((m) => muscleGroupOf(m) ?? m))];
  const sides = f.laterality === 'unilateral' ? ' · each side' : '';
  return `${f.name} · ${EXERCISE_EQUIPMENT_WORD[f.equipment]} · ${CONVENTION_SHORT[f.loadConvention]} · ${groups.join(', ')} · ${MEASURED_SHORT[f.measurement]}${sides}`;
}
