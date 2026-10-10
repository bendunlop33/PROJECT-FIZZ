import type { Exercise } from '@fizz/schemas';
import { catalogueExerciseId } from './catalogue-id';
import { deriveId } from './stable';

/**
 * A small starter exercise list (Coaching knowledge, no owner), so the
 * exercise picker works before the catalogue package is wired in. Every key
 * is an entry in `packages/catalogue/data/exercises/*.json`, IDs are the
 * catalogue's `catalogueExerciseId(key)`, and every field here equals the
 * catalogue's (`packages/catalogue/test/starter-ids.test.ts` fails on any
 * drift), so wiring the catalogue later keeps every ID (and so every logged
 * set's history and pain flag) stable (review B2). Seeding only adds missing
 * IDs, so a phone that already has a starter row keeps it as it was.
 *
 * Reps-based exercises only: timed exercises need the work-timer UI, which
 * isn't in this build. Rest defaults are starting points, not advice.
 */

type Starter = Pick<Exercise, 'name' | 'movementPattern' | 'primaryMuscles' | 'laterality' | 'compatibleEquipment' | 'defaultLoadConvention'> & {
  key: string;
  defaultRestS: number;
  mechanic: 'compound' | 'isolation';
  /** Catalogue family where the catalogue has one (substitutions, built-in rule category). */
  family?: string;
};

const S: readonly Starter[] = [
  { key: 'barbell-bench-press', name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 180, mechanic: 'compound', family: 'bench_press' },
  { key: 'barbell-back-squat', name: 'Back squat', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 180, mechanic: 'compound', family: 'squat' },
  { key: 'barbell-deadlift', name: 'Deadlift', movementPattern: 'hinge', primaryMuscles: ['glutes', 'hamstrings', 'spinal_erectors'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 180, mechanic: 'compound', family: 'deadlift' },
  { key: 'barbell-overhead-press', name: 'Overhead press', movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 150, mechanic: 'compound', family: 'overhead_press' },
  { key: 'barbell-romanian-deadlift', name: 'Romanian deadlift', movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 150, mechanic: 'compound', family: 'romanian_deadlift' },
  { key: 'barbell-bent-over-row', name: 'Barbell row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 120, mechanic: 'compound', family: 'row' },
  { key: 'barbell-incline-bench-press', name: 'Incline bench press', movementPattern: 'horizontal_push', primaryMuscles: ['upper_chest', 'front_delts'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 150, mechanic: 'compound', family: 'bench_press' },
  { key: 'barbell-hip-thrust', name: 'Hip thrust', movementPattern: 'hinge', primaryMuscles: ['glutes'], laterality: 'bilateral', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', defaultRestS: 120, mechanic: 'compound', family: 'hip_thrust' },
  { key: 'dumbbell-bench-press', name: 'Dumbbell bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 120, mechanic: 'compound', family: 'bench_press' },
  { key: 'dumbbell-incline-bench-press', name: 'Incline dumbbell press', movementPattern: 'horizontal_push', primaryMuscles: ['upper_chest', 'front_delts'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 120, mechanic: 'compound', family: 'bench_press' },
  { key: 'dumbbell-seated-shoulder-press', name: 'Dumbbell shoulder press', movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 120, mechanic: 'compound', family: 'overhead_press' },
  { key: 'dumbbell-one-arm-row', name: 'One-arm dumbbell row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], laterality: 'unilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 90, mechanic: 'compound', family: 'row' },
  { key: 'dumbbell-bulgarian-split-squat', name: 'Bulgarian split squat', movementPattern: 'lunge', primaryMuscles: ['quads', 'glutes'], laterality: 'unilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 90, mechanic: 'compound', family: 'split_squat' },
  { key: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian deadlift', movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 120, mechanic: 'compound', family: 'romanian_deadlift' },
  { key: 'dumbbell-goblet-squat', name: 'Goblet squat', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 90, mechanic: 'compound', family: 'goblet_squat' },
  { key: 'dumbbell-curl', name: 'Dumbbell curl', movementPattern: 'arms', primaryMuscles: ['biceps'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 60, mechanic: 'isolation', family: 'curl' },
  { key: 'dumbbell-lateral-raise', name: 'Lateral raise', movementPattern: 'vertical_push', primaryMuscles: ['side_delts'], laterality: 'bilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', defaultRestS: 60, mechanic: 'isolation', family: 'lateral_raise' },
  { key: 'cable-lat-pulldown', name: 'Lat pulldown', movementPattern: 'vertical_pull', primaryMuscles: ['lats'], laterality: 'bilateral', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', defaultRestS: 90, mechanic: 'compound', family: 'pulldown' },
  { key: 'cable-seated-row', name: 'Seated cable row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], laterality: 'bilateral', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', defaultRestS: 90, mechanic: 'compound', family: 'row' },
  { key: 'cable-triceps-pushdown', name: 'Triceps pushdown', movementPattern: 'arms', primaryMuscles: ['triceps'], laterality: 'bilateral', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', defaultRestS: 60, mechanic: 'isolation', family: 'triceps_pushdown' },
  { key: 'cable-face-pull', name: 'Face pull', movementPattern: 'horizontal_pull', primaryMuscles: ['rear_delts', 'upper_back'], laterality: 'bilateral', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', defaultRestS: 60, mechanic: 'isolation', family: 'face_pull' },
  { key: 'machine-leg-extension', name: 'Leg extension', movementPattern: 'squat', primaryMuscles: ['quads'], laterality: 'bilateral', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', defaultRestS: 60, mechanic: 'isolation', family: 'leg_extension' },
  { key: 'machine-seated-leg-curl', name: 'Seated leg curl', movementPattern: 'hinge', primaryMuscles: ['hamstrings'], laterality: 'bilateral', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', defaultRestS: 60, mechanic: 'isolation', family: 'leg_curl' },
  { key: 'machine-leg-press', name: 'Leg press', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], laterality: 'bilateral', compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added', defaultRestS: 120, mechanic: 'compound', family: 'leg_press' },
  { key: 'machine-assisted-pull-up', name: 'Assisted pull-up', movementPattern: 'vertical_pull', primaryMuscles: ['lats'], laterality: 'bilateral', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', defaultRestS: 90, mechanic: 'compound', family: 'pull_up' },
  { key: 'machine-assisted-dip', name: 'Assisted dip', movementPattern: 'vertical_push', primaryMuscles: ['chest', 'triceps'], laterality: 'bilateral', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', defaultRestS: 90, mechanic: 'compound', family: 'dip' },
  { key: 'bodyweight-pull-up', name: 'Pull-up', movementPattern: 'vertical_pull', primaryMuscles: ['lats'], laterality: 'bilateral', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', defaultRestS: 120, mechanic: 'compound', family: 'pull_up' },
  { key: 'bodyweight-dip', name: 'Dip', movementPattern: 'vertical_push', primaryMuscles: ['chest', 'triceps'], laterality: 'bilateral', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', defaultRestS: 120, mechanic: 'compound', family: 'dip' },
  { key: 'bodyweight-push-up', name: 'Push-up', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], laterality: 'bilateral', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', defaultRestS: 60, mechanic: 'compound', family: 'push_up' },
];

/** The catalogue's own ID scheme (UUIDv5 of the key), so wiring the catalogue keeps every ID and its history. */
export function starterExerciseId(key: string): string {
  return catalogueExerciseId(key);
}

/** The starter list as catalogue `Exercise` records (no owner: Coaching knowledge). */
export function starterExercises(atUtc: string): Exercise[] {
  return S.map((s) => ({
    id: starterExerciseId(s.key),
    ownerId: null,
    source: 'catalogue',
    name: s.name,
    movementPattern: s.movementPattern,
    primaryMuscles: [...s.primaryMuscles],
    measurement: 'reps',
    laterality: s.laterality,
    compatibleEquipment: [...s.compatibleEquipment],
    defaultLoadConvention: s.defaultLoadConvention,
    defaultRestS: s.defaultRestS,
    catalogueKey: s.key,
    mechanic: s.mechanic,
    ...(s.family === undefined ? {} : { family: s.family }),
    version: 1,
    createdAtUtc: atUtc,
    updatedAtUtc: atUtc,
  }));
}

/**
 * IDs the first workout-loop build (before review B2) gave the starter list:
 * `deriveId('catalogue:<old key>')`. A phone that ran that build has these
 * rows; the app removes the ones no workout or pain flag refers to, so the
 * picker doesn't show each exercise twice. Referenced ones are kept (history).
 */
export const LEGACY_STARTER_IDS: readonly string[] = [
  'barbell-bench-press', 'barbell-back-squat', 'barbell-deadlift', 'barbell-overhead-press', 'barbell-romanian-deadlift', 'barbell-row',
  'barbell-incline-bench-press', 'barbell-hip-thrust', 'dumbbell-bench-press', 'dumbbell-incline-press', 'dumbbell-shoulder-press',
  'dumbbell-one-arm-row', 'dumbbell-bulgarian-split-squat', 'dumbbell-romanian-deadlift', 'dumbbell-goblet-squat', 'dumbbell-curl',
  'dumbbell-lateral-raise', 'cable-lat-pulldown', 'cable-seated-row', 'cable-triceps-pushdown', 'cable-face-pull', 'machine-leg-extension',
  'machine-leg-curl', 'machine-leg-press', 'assisted-pull-up', 'assisted-dip', 'bodyweight-pull-up', 'bodyweight-dip', 'bodyweight-push-up',
].map((key) => deriveId(`catalogue:${key}`));

/** Simple, forgiving search: every word of the query must start a word of the name. */
export function searchExercises<T extends Pick<Exercise, 'name'>>(list: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (words.length === 0) return sorted;
  return sorted.filter((e) => {
    const nameWords = e.name.toLowerCase().split(/[^a-z0-9]+/);
    return words.every((w) => nameWords.some((n) => n.startsWith(w)));
  });
}

/** The common lifts (the starter list), in the order the picker shows them first. */
export const COMMON_EXERCISE_IDS: readonly string[] = S.map((s) => starterExerciseId(s.key));

export interface PickerSection<T> {
  title: 'Recent' | 'Common lifts' | 'All exercises' | 'Matches';
  items: T[];
}

/**
 * The exercise picker's list (audit F4): with no query, recently done
 * exercises, then the common lifts, then everything else A–Z, each shown
 * once. With a query, every match A–Z. Pure.
 */
export function pickerSections<T extends { exercise: Pick<Exercise, 'id' | 'name'> }>(list: readonly T[], query: string, recentIds: readonly string[]): PickerSection<T>[] {
  const matched = searchExercises(
    list.map((p) => ({ name: p.exercise.name, p })),
    query,
  ).map((x) => x.p);
  if (query.trim() !== '') return matched.length === 0 ? [] : [{ title: 'Matches', items: matched }];
  const byId = new Map(matched.map((p) => [p.exercise.id, p]));
  const seen = new Set<string>();
  const take = (ids: readonly string[]): T[] => {
    const out: T[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p && !seen.has(id)) {
        seen.add(id);
        out.push(p);
      }
    }
    return out;
  };
  const recent = take(recentIds);
  const common = take(COMMON_EXERCISE_IDS);
  const rest = matched.filter((p) => !seen.has(p.exercise.id));
  const sections: PickerSection<T>[] = [];
  if (recent.length > 0) sections.push({ title: 'Recent', items: recent });
  if (common.length > 0) sections.push({ title: 'Common lifts', items: common });
  if (rest.length > 0) sections.push({ title: 'All exercises', items: rest });
  return sections;
}
