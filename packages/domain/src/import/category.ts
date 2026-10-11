/**
 * FitNotes `Category` cells as a ranking hint for name suggestions (ADR 0016
 * follow-up, real-file run 11 Oct 2026). Pure.
 *
 * The category is the exercise's muscle group as Ben filed it in FitNotes. It
 * is user-editable (research `fitnotes-export-format.md` §3.4), so it is only
 * ever a hint: it can drop or demote a word suggestion whose primary muscles
 * contradict it (`Barbell Leg Curls` under Legs is never the barbell curl),
 * never make a match, and never change a stored value. A category this table
 * doesn't know (`Cardio`, `Other`, a custom or translated one, blank) gives no
 * hint. Categories are data, never instructions (rule 8).
 *
 * Covers FitNotes (Android) defaults (Abs, Back, Biceps, Cardio, Chest, Legs,
 * Shoulders, Triceps) and FitNotes 2 (iPhone) muscle-level categories
 * (`Quadriceps`, `Hamstrings`, `Lats`, `Trapezius`, `Pectorals`,
 * `Back (Lower)`, `Calves`, …). Muscles are the catalogue vocabulary
 * (`packages/catalogue/src/vocab.ts`). Each set is generous: it lists every
 * muscle an exercise filed there could plausibly have as a primary (a deadlift
 * under Back or Legs, a shrug under Shoulders), because a wrong contradiction
 * hides a right suggestion.
 */

const DELTS = ['front_delts', 'side_delts', 'rear_delts'] as const;
const BACK = ['lats', 'upper_back', 'traps', 'spinal_erectors', 'rear_delts'] as const;
const CHEST = ['chest', 'upper_chest'] as const;
const LEGS = ['quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves'] as const;
const CORE = ['abs', 'obliques', 'core'] as const;
const BICEPS = ['biceps', 'brachialis', 'forearms', 'grip'] as const;
const FOREARMS = ['forearms', 'grip', 'brachialis'] as const;
const LOWER_BACK = ['spinal_erectors', 'glutes', 'hamstrings'] as const;
const UPPER_BACK = ['upper_back', 'lats', 'traps', 'rear_delts'] as const;

/** Normalised category → the primary muscles an exercise filed there may have. */
const CATEGORY_MUSCLES: Readonly<Record<string, readonly string[]>> = {
  // FitNotes (Android) defaults.
  abs: CORE,
  back: BACK,
  bicep: BICEPS,
  chest: CHEST,
  leg: LEGS,
  shoulder: [...DELTS, 'traps'],
  tricep: ['triceps'],
  // FitNotes 2 (iPhone) and other muscle-level names.
  abdominal: CORE,
  core: CORE,
  oblique: CORE,
  pectoral: CHEST,
  pec: CHEST,
  delt: DELTS,
  deltoid: DELTS,
  'front delt': ['front_delts'],
  'side delt': ['side_delts'],
  'rear delt': ['rear_delts', 'upper_back'],
  lat: ['lats', 'upper_back'],
  latissimus: ['lats', 'upper_back'],
  'latissimus dorsi': ['lats', 'upper_back'],
  trap: ['traps', 'upper_back'],
  trapezius: ['traps', 'upper_back'],
  'upper trap': ['traps', 'upper_back'],
  'lower back': LOWER_BACK,
  'back lower': LOWER_BACK,
  'upper back': UPPER_BACK,
  'back upper': UPPER_BACK,
  'middle back': UPPER_BACK,
  'back middle': UPPER_BACK,
  quadricep: ['quads'],
  quad: ['quads'],
  hamstring: ['hamstrings'],
  glute: ['glutes', 'adductors', 'abductors'],
  gluteus: ['glutes', 'adductors', 'abductors'],
  calf: ['calves'],
  calve: ['calves'],
  adductor: ['adductors'],
  abductor: ['abductors'],
  forearm: FOREARMS,
  arm: [...BICEPS, 'triceps'],
  'upper leg': LEGS,
  'lower leg': ['calves'],
};

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
}

/** `Back (Lower)` → `back lower`; `Biceps` → `bicep`; `Pectorals` → `pectoral`. */
function categoryWords(category: string): string {
  return category
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '')
    .map(singular)
    .join(' ');
}

/**
 * The primary muscles an exercise filed under this category may have, or
 * null when the category gives no hint. A qualified category the table
 * doesn't list falls back to its first word (`Shoulders (Front)` → `shoulder`
 * only when not listed itself).
 */
export function categoryMuscles(category: string): ReadonlySet<string> | null {
  const words = categoryWords(category);
  if (words === '') return null;
  const exact = CATEGORY_MUSCLES[words];
  if (exact) return new Set(exact);
  const head = words.split(' ')[0] ?? '';
  const base = /\(/.test(category) ? CATEGORY_MUSCLES[head] : undefined;
  return base ? new Set(base) : null;
}

/**
 * The hint for a name from every category it was filed under in the file.
 * Null (no hint) when there is none, or when any of them is one this table
 * doesn't know: the hint never narrows on a guess.
 */
export function categoryHint(categories: readonly string[]): ReadonlySet<string> | null {
  const filled = categories.map((c) => c.trim()).filter((c) => c !== '');
  if (filled.length === 0) return null;
  const out = new Set<string>();
  for (const c of filled) {
    const muscles = categoryMuscles(c);
    if (muscles === null) return null;
    for (const m of muscles) out.add(m);
  }
  return out;
}

/** How an exercise's primary muscles compare with a category hint. `unknown`: no hint, or no muscles recorded. */
export function muscleFit(hint: ReadonlySet<string> | null, primaryMuscles: readonly string[] | undefined): 'agrees' | 'contradicts' | 'unknown' {
  if (hint === null || primaryMuscles === undefined || primaryMuscles.length === 0) return 'unknown';
  return primaryMuscles.some((m) => hint.has(m)) ? 'agrees' : 'contradicts';
}
