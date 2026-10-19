import type { Exercise } from '@fizz/schemas';
import { MUSCLE_GROUPS, muscleGroupOf } from '@fizz/schemas';

import { EXERCISE_EQUIPMENT_WORD } from './exercise-browse';
import { matchExercise, normaliseSearchText } from './exercise-search';

/**
 * `find_exercises` (Ben, 19 Oct: "Why can't I add it"). The coach's prompt
 * carries a capped list of what it can use here; this pure search runs over
 * the whole list (every exercise doable at the gym, not pain-flagged) so an
 * exercise Ben names is never out of reach because it fell off the cap.
 * Name and alias matches first (the Library's matcher: aliases, one typo per
 * long word), then exercises whose main muscle the query names, filtered by
 * an optional muscle and equipment word. At most `cap` results.
 */

export interface FindableExercise {
  /** The ID the coach uses (catalogue key, else Ben's exercise ID). */
  catalogueId: string;
  exercise: Pick<Exercise, 'name' | 'primaryMuscles' | 'compatibleEquipment' | 'defaultLoadConvention' | 'measurement' | 'source'>;
  aliases: readonly string[];
}

export interface FoundExercise {
  catalogueId: string;
  name: string;
  equipment: string;
  measured: 'reps' | 'time' | 'distance' | 'cardio';
  muscles: string[];
  /** Ben's own exercise (Your data), not the catalogue's. */
  yours: boolean;
}

export const FIND_EXERCISES_CAP = 20;

const MEASURED: Record<Exercise['measurement'], FoundExercise['measured']> = { reps: 'reps', duration: 'time', distance: 'distance', cardio: 'cardio' };

/** A muscle or group word ("calves", "calf", "hams", "Back") → the muscle groups it names. */
function groupsNamedBy(text: string): Set<string> {
  const words = normaliseSearchText(text).split(' ').filter((w) => w !== '');
  const out = new Set<string>();
  const stem = (w: string) => w.replace(/(ves|s)$/, '').replace(/f$/, '');
  for (const w of words) {
    for (const g of MUSCLE_GROUPS) {
      const gw = g.toLowerCase();
      if (w === gw || stem(w) === stem(gw) || (w.length >= 4 && gw.startsWith(w))) out.add(g);
    }
    for (const m of Object.keys(MUSCLE_TO_GROUP_WORDS)) {
      if (w === m || stem(w) === stem(m)) out.add(MUSCLE_TO_GROUP_WORDS[m] as string);
    }
  }
  return out;
}

/** Muscle words (and a few gym names for them) → group. */
const MUSCLE_TO_GROUP_WORDS: Record<string, string> = {
  pecs: 'Chest',
  lats: 'Back',
  traps: 'Back',
  delts: 'Shoulders',
  quad: 'Quads',
  hams: 'Hamstrings',
  hamstring: 'Hamstrings',
  glute: 'Glutes',
  abs: 'Core',
  obliques: 'Core',
  calf: 'Calves',
  forearm: 'Forearms',
  grip: 'Forearms',
};

function equipmentMatches(e: FindableExercise['exercise'], word: string): boolean {
  const q = normaliseSearchText(word);
  if (q === '') return true;
  const kinds = e.compatibleEquipment.length === 0 || e.defaultLoadConvention === 'bodyweight' ? [...e.compatibleEquipment, 'bodyweight_station' as const] : e.compatibleEquipment;
  return kinds.some((k) => {
    const label = normaliseSearchText(EXERCISE_EQUIPMENT_WORD[k]);
    const raw = normaliseSearchText(k);
    return label.includes(q) || raw.includes(q) || q.includes(raw) || (q.includes('cable') && k === 'weight_stack') || (q.includes('machine') && (k === 'plate_loaded_machine' || k === 'weight_stack' || k === 'assisted_stack')) || (q.includes('plate') && k === 'plate_loaded_machine');
  });
}

function view(f: FindableExercise): FoundExercise {
  const e = f.exercise;
  const first = e.compatibleEquipment[0];
  return {
    catalogueId: f.catalogueId,
    name: e.name,
    equipment: e.defaultLoadConvention === 'bodyweight' || first === undefined ? 'bodyweight' : first.replaceAll('_', ' '),
    measured: MEASURED[e.measurement],
    muscles: e.primaryMuscles.slice(0, 3),
    yours: e.source === 'custom',
  };
}

/** Pure: the best matches for the query in `pool`, best first then A–Z, at most `cap`. */
export function findExercises(pool: readonly FindableExercise[], args: { query: string; muscle: string | null; equipment: string | null }, cap = FIND_EXERCISES_CAP): FoundExercise[] {
  const muscleGroups = args.muscle === null ? null : groupsNamedBy(args.muscle);
  const filtered = pool.filter((f) => {
    if (muscleGroups !== null && muscleGroups.size > 0 && !f.exercise.primaryMuscles.some((m) => muscleGroups.has(muscleGroupOf(m) ?? ''))) return false;
    if (args.equipment !== null && !equipmentMatches(f.exercise, args.equipment)) return false;
    return true;
  });
  const q = normaliseSearchText(args.query);
  const byName = (a: FindableExercise, b: FindableExercise) => a.exercise.name.localeCompare(b.exercise.name);
  if (q === '') return [...filtered].sort(byName).slice(0, cap).map(view);
  const ranked: { f: FindableExercise; rank: number }[] = [];
  const queryGroups = groupsNamedBy(args.query);
  // "seated calf raises": the plural is the same exercise.
  const singular = q.replace(/(?<=\w)(es|s)\b/g, '');
  for (const f of filtered) {
    const m = matchExercise(q, f.exercise.name, f.aliases) ?? (singular !== q ? matchExercise(singular, f.exercise.name, f.aliases) : null);
    if (m !== null) {
      ranked.push({ f, rank: m.rank });
      continue;
    }
    if (queryGroups.size > 0 && f.exercise.primaryMuscles.some((mu) => queryGroups.has(muscleGroupOf(mu) ?? ''))) ranked.push({ f, rank: 10 });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || byName(a.f, b.f))
    .slice(0, cap)
    .map((x) => view(x.f));
}
