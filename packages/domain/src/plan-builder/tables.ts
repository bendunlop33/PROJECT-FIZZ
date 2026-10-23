import type { PlanEffort, PlanFocus, PlanGroup, PlanTarget } from '@fizz/schemas';

/**
 * The plan builder's tables (plan-builder.md §2; prototype `plan-builder.html`), with the prototype's exercise names
 * mapped to catalogue keys (`packages/catalogue/data/exercises/<key>.json`). Prototype exercises the catalogue has no
 * entry for are left out (Low-to-high cable fly, Incline machine/Smith press, T-bar row, Cable rear delt fly, Band
 * pull-apart, Smith shoulder press, Cable hip abduction, Wrist curl, Reverse curl); the order of the rest is kept.
 * Every number here is the prototype's default (Ben's open questions plan-builder §5 Q2, Q3, Q6 stand).
 */

/** Muscles as counted (D5): the detailed list, plus parts that are muscles of their own when targeted. */
export const PB_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Calves', 'Biceps', 'Triceps', 'Core'] as const;
export const PB_OWN = ['Glutes', 'Adductors', 'Abductors', 'Forearms'] as const;
export type PbMuscle = (typeof PB_MUSCLES)[number] | (typeof PB_OWN)[number];

/** Each picking group is exactly the sum of its detailed rows (D5). */
export const PB_GROUPS: Readonly<Record<PlanGroup, readonly PbMuscle[]>> = {
  Chest: ['Chest'],
  Back: ['Back'],
  Shoulders: ['Shoulders'],
  Legs: ['Quads', 'Hamstrings', 'Calves'],
  Arms: ['Biceps', 'Triceps'],
  Core: ['Core'],
};

/** Specific targets by group (the picker), and the muscle a part-target is trained through. */
export const PB_TARGETS: Readonly<Record<PlanGroup, readonly PlanTarget[]>> = {
  Chest: ['Upper chest'],
  Back: ['Lats', 'Upper back', 'Traps', 'Rear delts'],
  Shoulders: ['Side delts'],
  Legs: ['Glutes', 'Adductors', 'Abductors'],
  Arms: ['Forearms'],
  Core: ['Obliques'],
};
export const PB_TAG_OF: Readonly<Partial<Record<PlanTarget, PbMuscle>>> = { 'Upper chest': 'Chest', Lats: 'Back', 'Upper back': 'Back', Traps: 'Back', 'Side delts': 'Shoulders', 'Rear delts': 'Back' };

export type PbDayType = 'Push' | 'Pull' | 'Legs' | 'Upper' | 'Lower' | 'Full body' | 'Chest' | 'Back' | 'Shoulders' | 'Arms';

/** The muscles each day type can train. */
export const PB_ELIG: Readonly<Record<PbDayType, readonly PbMuscle[]>> = {
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Back', 'Biceps', 'Shoulders', 'Forearms'],
  Legs: ['Quads', 'Hamstrings', 'Calves', 'Glutes', 'Adductors', 'Abductors'],
  Lower: ['Quads', 'Hamstrings', 'Calves', 'Glutes', 'Adductors', 'Abductors'],
  Upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms'],
  'Full body': ['Quads', 'Chest', 'Back', 'Hamstrings', 'Shoulders', 'Biceps', 'Triceps', 'Calves', 'Glutes', 'Adductors', 'Abductors', 'Forearms'],
  Chest: ['Chest', 'Triceps'],
  Back: ['Back', 'Biceps', 'Forearms'],
  Shoulders: ['Shoulders', 'Biceps', 'Triceps'],
  Arms: ['Biceps', 'Triceps', 'Shoulders', 'Forearms'],
};

export const PB_LEG_MUSCLES: readonly PbMuscle[] = ['Quads', 'Hamstrings', 'Calves', 'Glutes', 'Adductors', 'Abductors'];
export const PB_LEGGY_DAYS: readonly PbDayType[] = ['Legs', 'Lower', 'Full body'];

/** Borrowing a day for a priority: the most compatible day type first (no bench on leg day). */
const UPPER_D: readonly PbDayType[] = ['Upper', 'Full body'];
export const PB_COMPAT: Readonly<Partial<Record<PbMuscle, readonly PbDayType[]>>> = {
  Chest: ['Shoulders', 'Push', ...UPPER_D, 'Arms', 'Back'],
  Back: ['Shoulders', 'Pull', ...UPPER_D, 'Arms', 'Chest'],
  Shoulders: ['Chest', 'Back', 'Push', ...UPPER_D, 'Arms'],
  Biceps: ['Back', 'Pull', 'Shoulders', ...UPPER_D, 'Arms', 'Chest'],
  Triceps: ['Chest', 'Push', 'Shoulders', ...UPPER_D, 'Arms', 'Back'],
  Forearms: ['Back', 'Pull', 'Arms', ...UPPER_D],
};

export type PbRole = 'c' | 'i';

/** One exercise in a muscle's list: catalogue key, compound or isolation, specific targets it covers, day types it skips. */
export interface PbExerciseDef {
  key: string;
  role: PbRole;
  tags?: readonly PlanTarget[];
  skip?: readonly PbDayType[];
}

const ex = (key: string, role: PbRole, tags: readonly PlanTarget[] = [], skip: readonly PbDayType[] = []): PbExerciseDef => ({ key, role, tags, skip });

/** Exercises per muscle, in the prototype's order (rear delts count as Back, D5). */
export const PB_EX: Readonly<Record<Exclude<PbMuscle, 'Core'>, readonly PbExerciseDef[]>> = {
  Chest: [
    ex('dumbbell-incline-bench-press', 'c', ['Upper chest']),
    ex('cable-fly', 'i'),
    ex('barbell-bench-press', 'c'),
    ex('barbell-incline-bench-press', 'c', ['Upper chest']),
    ex('dumbbell-bench-press', 'c'),
    ex('machine-chest-press', 'c'),
    ex('smith-machine-bench-press', 'c'),
    ex('bodyweight-push-up', 'c'),
  ],
  Back: [
    ex('cable-lat-pulldown', 'c', ['Lats']),
    ex('machine-chest-supported-row', 'c', ['Upper back']),
    ex('bodyweight-pull-up', 'c', ['Lats']),
    ex('barbell-bent-over-row', 'c', ['Upper back']),
    ex('dumbbell-shrug', 'i', ['Traps']),
    ex('machine-assisted-pull-up', 'c', ['Lats']),
    ex('bodyweight-chin-up', 'c', ['Lats']),
    ex('cable-single-arm-pulldown', 'c', ['Lats']),
    ex('cable-seated-row', 'c', ['Upper back']),
    ex('dumbbell-one-arm-row', 'c', ['Upper back']),
    ex('dumbbell-chest-supported-row', 'c', ['Upper back']),
    ex('cable-face-pull', 'i', ['Rear delts']),
    ex('dumbbell-rear-delt-fly', 'i', ['Rear delts']),
    ex('machine-reverse-pec-deck', 'i', ['Rear delts']),
  ],
  Shoulders: [
    ex('dumbbell-lateral-raise', 'i', ['Side delts']),
    ex('dumbbell-seated-shoulder-press', 'c', [], ['Pull']),
    ex('machine-shoulder-press', 'c', [], ['Pull']),
    ex('barbell-overhead-press', 'c', [], ['Pull']),
    ex('dumbbell-arnold-press', 'c', [], ['Pull']),
    ex('cable-lateral-raise', 'i', ['Side delts']),
  ],
  Quads: [
    ex('machine-leg-press', 'c'),
    ex('machine-leg-extension', 'i'),
    ex('barbell-front-squat', 'c'),
    ex('machine-hack-squat', 'c'),
    ex('dumbbell-bulgarian-split-squat', 'c'),
    ex('smith-machine-squat', 'c'),
    ex('dumbbell-walking-lunge', 'c'),
    ex('dumbbell-goblet-squat', 'c'),
    ex('dumbbell-step-up', 'c'),
  ],
  Hamstrings: [ex('barbell-romanian-deadlift', 'c'), ex('machine-lying-leg-curl', 'i'), ex('machine-seated-leg-curl', 'i'), ex('bodyweight-nordic-curl', 'i'), ex('barbell-good-morning', 'c')],
  Calves: [ex('machine-standing-calf-raise', 'i'), ex('machine-seated-calf-raise', 'i')],
  Biceps: [ex('barbell-curl', 'i'), ex('dumbbell-hammer-curl', 'i'), ex('dumbbell-incline-curl', 'i')],
  Triceps: [ex('cable-triceps-pushdown', 'i'), ex('cable-overhead-triceps-extension', 'i')],
  Glutes: [ex('barbell-hip-thrust', 'c'), ex('cable-glute-kickback', 'i'), ex('bodyweight-glute-bridge', 'c')],
  Adductors: [ex('machine-hip-adduction', 'i'), ex('bodyweight-copenhagen-plank', 'i')],
  Abductors: [ex('machine-hip-abduction', 'i')],
  // No wrist or reverse curl in the catalogue yet: Forearms can't be a specific target until one is added.
  Forearms: [],
};

/** Abs: alternating two exercises; the woodchop when Obliques is a specific target. */
export const PB_CORE = { crunch: 'cable-crunch', legRaise: 'bodyweight-hanging-leg-raise', woodchop: 'cable-woodchop' } as const;

/** Each day type's main lift (A), and the B variation's when the day repeats in the week. Null: no main lift (Arms). */
export const PB_MAIN_A: Readonly<Record<PbDayType, { key: string; muscle: PbMuscle } | null>> = {
  Push: { key: 'barbell-bench-press', muscle: 'Chest' },
  Pull: { key: 'barbell-bent-over-row', muscle: 'Back' },
  Legs: { key: 'barbell-back-squat', muscle: 'Quads' },
  Upper: { key: 'dumbbell-seated-shoulder-press', muscle: 'Shoulders' },
  Lower: { key: 'barbell-romanian-deadlift', muscle: 'Hamstrings' },
  'Full body': { key: 'barbell-back-squat', muscle: 'Quads' },
  Chest: { key: 'barbell-bench-press', muscle: 'Chest' },
  Back: { key: 'barbell-bent-over-row', muscle: 'Back' },
  Shoulders: { key: 'dumbbell-seated-shoulder-press', muscle: 'Shoulders' },
  Arms: null,
};
export const PB_MAIN_B: Readonly<Partial<Record<PbDayType, { key: string; muscle: PbMuscle }>>> = {
  Push: { key: 'dumbbell-seated-shoulder-press', muscle: 'Shoulders' },
  Pull: { key: 'bodyweight-pull-up', muscle: 'Back' },
  Legs: { key: 'barbell-romanian-deadlift', muscle: 'Hamstrings' },
  Upper: { key: 'barbell-bench-press', muscle: 'Chest' },
  Lower: { key: 'barbell-back-squat', muscle: 'Quads' },
  'Full body': { key: 'barbell-romanian-deadlift', muscle: 'Hamstrings' },
  Chest: { key: 'barbell-incline-bench-press', muscle: 'Chest' },
  Back: { key: 'bodyweight-pull-up', muscle: 'Back' },
};

/** A liked alternative replaces the main lift; a never (or not at this gym) moves it on to the first that fits. */
export const PB_MAIN_ALT: Readonly<Record<string, readonly string[]>> = {
  'barbell-bench-press': ['dumbbell-bench-press', 'machine-chest-press', 'smith-machine-bench-press', 'barbell-incline-bench-press'],
  'barbell-back-squat': ['machine-leg-press', 'machine-hack-squat', 'barbell-front-squat', 'smith-machine-squat'],
  'barbell-incline-bench-press': ['dumbbell-incline-bench-press'],
  'bodyweight-pull-up': ['cable-lat-pulldown', 'machine-assisted-pull-up', 'bodyweight-chin-up'],
  'dumbbell-seated-shoulder-press': ['machine-shoulder-press', 'barbell-overhead-press', 'dumbbell-arnold-press'],
  'barbell-bent-over-row': ['machine-chest-supported-row', 'cable-seated-row', 'dumbbell-one-arm-row'],
  // Not in the prototype: an RDL day at a gym with no barbell falls back to the dumbbell RDL.
  'barbell-romanian-deadlift': ['dumbbell-romanian-deadlift'],
};

/** Heavy barbell compounds: never paired in a superset (workout-builder-v3 §3.5). */
export const PB_HEAVY: ReadonlySet<string> = new Set([
  'barbell-bench-press',
  'barbell-back-squat',
  'barbell-bent-over-row',
  'barbell-romanian-deadlift',
  'barbell-front-squat',
  'barbell-incline-bench-press',
  'barbell-deadlift',
  'barbell-overhead-press',
]);

/** Floor lifts: no empty-bar warm-up (WU9). */
export const pbIsFloorLift = (key: string): boolean => /deadlift|row/.test(key);

/** Curated default score per exercise (how effective, popular and simple to set up); 0.5 when not listed. */
export const PB_PRIOR: Readonly<Record<string, number>> = {
  'dumbbell-incline-bench-press': 0.8,
  'cable-fly': 0.7,
  'barbell-bench-press': 0.9,
  'barbell-incline-bench-press': 0.7,
  'cable-lat-pulldown': 0.85,
  'machine-chest-supported-row': 0.75,
  'dumbbell-chest-supported-row': 0.75,
  'bodyweight-pull-up': 0.75,
  'barbell-bent-over-row': 0.7,
  'dumbbell-shrug': 0.5,
  'dumbbell-lateral-raise': 0.85,
  'cable-face-pull': 0.7,
  'dumbbell-seated-shoulder-press': 0.75,
  'dumbbell-rear-delt-fly': 0.6,
  'machine-leg-press': 0.8,
  'machine-leg-extension': 0.7,
  'barbell-front-squat': 0.5,
  'barbell-romanian-deadlift': 0.8,
  'machine-lying-leg-curl': 0.8,
  'machine-standing-calf-raise': 0.7,
  'machine-seated-calf-raise': 0.6,
  'barbell-curl': 0.7,
  'dumbbell-hammer-curl': 0.7,
  'dumbbell-incline-curl': 0.65,
  'cable-triceps-pushdown': 0.8,
  'cable-overhead-triceps-extension': 0.7,
  'barbell-hip-thrust': 0.75,
  'cable-glute-kickback': 0.5,
  'machine-hip-adduction': 0.7,
  'bodyweight-copenhagen-plank': 0.5,
  'machine-hip-abduction': 0.7,
  'dumbbell-bench-press': 0.8,
  'machine-hack-squat': 0.7,
  'dumbbell-bulgarian-split-squat': 0.6,
  'machine-assisted-pull-up': 0.6,
  'machine-shoulder-press': 0.7,
  'barbell-back-squat': 0.85,
};

/** Indirect sets count half (presses → triceps, rows and pulldowns → biceps, squats and hinges → glutes; Pelland et al. 2024). */
export const PB_SEC: Readonly<Record<string, Partial<Record<PbMuscle, number>>>> = {
  'barbell-bench-press': { Triceps: 0.5 },
  'barbell-incline-bench-press': { Triceps: 0.5 },
  'dumbbell-incline-bench-press': { Triceps: 0.5 },
  'dumbbell-seated-shoulder-press': { Triceps: 0.5 },
  'barbell-bent-over-row': { Biceps: 0.5 },
  'machine-chest-supported-row': { Biceps: 0.5 },
  'dumbbell-chest-supported-row': { Biceps: 0.5 },
  'cable-lat-pulldown': { Biceps: 0.5 },
  'bodyweight-pull-up': { Biceps: 0.5 },
  'barbell-back-squat': { Glutes: 0.5 },
  'machine-chest-press': { Triceps: 0.5 },
  'smith-machine-bench-press': { Triceps: 0.5 },
  'dumbbell-bench-press': { Triceps: 0.5 },
  'bodyweight-push-up': { Triceps: 0.5 },
  'barbell-overhead-press': { Triceps: 0.5 },
  'dumbbell-arnold-press': { Triceps: 0.5 },
  'machine-shoulder-press': { Triceps: 0.5 },
  'bodyweight-chin-up': { Biceps: 0.5 },
  'cable-seated-row': { Biceps: 0.5 },
  'dumbbell-one-arm-row': { Biceps: 0.5 },
  'machine-assisted-pull-up': { Biceps: 0.5 },
  'cable-single-arm-pulldown': { Biceps: 0.5 },
  'smith-machine-squat': { Glutes: 0.5 },
  'dumbbell-walking-lunge': { Glutes: 0.5 },
  'dumbbell-goblet-squat': { Glutes: 0.5 },
  'dumbbell-step-up': { Glutes: 0.5 },
  'barbell-front-squat': { Glutes: 0.5 },
  'machine-leg-press': { Glutes: 0.5 },
  'machine-hack-squat': { Glutes: 0.5 },
  'barbell-romanian-deadlift': { Glutes: 0.5 },
  'dumbbell-romanian-deadlift': { Glutes: 0.5 },
  'barbell-hip-thrust': { Hamstrings: 0.5 },
};

/** Rough indirect share while placing (exact per exercise in Sets per week). */
export const PB_IND: Readonly<Partial<Record<PbMuscle, readonly (readonly [PbMuscle, number])[]>>> = {
  Triceps: [
    ['Chest', 0.25],
    ['Shoulders', 0.15],
  ],
  Biceps: [['Back', 0.4]],
  Glutes: [
    ['Quads', 0.4],
    ['Hamstrings', 0.4],
  ],
};

/** Weekly hard-set bands by effort [Proposal, plan-builder §5 Q3]; `pct`: weekly top-set gain share (placeholder, Q6). */
export const PB_EFFORT: Readonly<Record<PlanEffort, { pri: readonly [number, number]; oth: readonly [number, number]; sm: readonly [number, number]; pct: number }>> = {
  maintain: { pri: [8, 12], oth: [4, 8], sm: [3, 6], pct: 0 },
  standard: { pri: [12, 20], oth: [8, 14], sm: [4, 10], pct: 0.012 },
  push: { pri: [16, 22], oth: [10, 16], sm: [6, 12], pct: 0.018 },
};
/** With ★ sports, lifting drops to these bands unless already Maintain (GA6). */
export const PB_SPORT_BANDS = { pri: [10, 14], oth: [6, 10], sm: [4, 6] } as const;

/** Focus multiplier on the weekly rate (placeholders until his own trend). */
export const PB_FOCUS_GAIN: Readonly<Record<PlanFocus, number>> = { strength: 1.3, balanced: 1.0, muscle: 0.7, fitness: 0.5 };
/** What to expect: the focus's reference reps. */
export const PB_FOCUS_REPS: Readonly<Record<PlanFocus, number>> = { strength: 3, balanced: 6, muscle: 8, fitness: 10 };
/** D4 back-off band below the top, by focus (Fitness 2–15 %). */
export const PB_BACKOFF_BAND: Readonly<Record<PlanFocus, readonly [number, number]>> = { strength: [0.02, 0.08], balanced: [0.04, 0.1], muscle: [0.08, 0.15], fitness: [0.02, 0.15] };

/** Leg-heavy sports: no heavy legs the day before (GA11). Running's long run is handled on its own. */
export const PB_LEGGY_SPORTS: ReadonlySet<string> = new Set(['Cycling', 'Football', 'HIIT']);
export const PB_SPORTS = ['Running', 'Cycling', 'Swimming', 'Boxing', 'Football', 'HIIT', 'Climbing', 'Yoga'] as const;
export const PB_SPORT_DEFAULT_DAY: Readonly<Record<string, number>> = { Running: 6, Cycling: 5, Swimming: 2, Boxing: 3, Football: 6, HIIT: 4, Climbing: 3, Yoga: 6 };

/** Usual days for each number of sessions (Mon = 0): Any days, and Set days' first pick. */
export const PB_PREF_DAYS: Readonly<Record<number, readonly number[]>> = { 2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };

/** The four main lifts Check your lifts always lists, then the extras `＋ Add a lift` offers. */
export const PB_CHECK_LIFTS = ['barbell-bench-press', 'barbell-back-squat', 'barbell-bent-over-row', 'dumbbell-seated-shoulder-press'] as const;
export const PB_EXTRA_LIFTS = ['barbell-deadlift', 'barbell-front-squat', 'barbell-romanian-deadlift', 'barbell-overhead-press', 'barbell-incline-bench-press'] as const;

/** Strength balance: each lift's est. 1RM ÷ bench est. 1RM, usual band (rules of thumb, information only). */
export const PB_BALANCE: Readonly<Record<string, readonly [number, number]>> = {
  'barbell-back-squat': [1.2, 1.5],
  'barbell-bent-over-row': [0.7, 1.0],
  'dumbbell-seated-shoulder-press': [0.22, 0.3],
  'barbell-deadlift': [1.5, 1.9],
  'barbell-front-squat': [0.95, 1.2],
  'barbell-romanian-deadlift': [1.0, 1.3],
  'barbell-overhead-press': [0.6, 0.7],
  'barbell-incline-bench-press': [0.8, 0.9],
};

/**
 * Read-across (§1a): a main lift with no history is estimated from his closest similar lift first, then another main
 * lift. `f` turns the source's est. 1RM into this lift's est. 1RM (both in the lifts' own conventions: a dumbbell
 * lift is per hand). Practice-level rules of thumb, always est.; the bench ratios are the middles of `PB_BALANCE`.
 */
export const PB_SIMILAR: Readonly<Record<string, readonly { from: string; f: number }[]>> = {
  // Prototype: machine ÷ 2 ÷ 1.1; OHP ÷ 1.2 ÷ 2; bench × 0.6 ÷ 1.2 ÷ 2 (per hand).
  'dumbbell-seated-shoulder-press': [
    { from: 'machine-shoulder-press', f: 1 / 2 / 1.1 },
    { from: 'barbell-overhead-press', f: 1 / 1.2 / 2 },
    { from: 'barbell-bench-press', f: (0.6 / 1.2) / 2 },
  ],
  // Spec §1a: OHP from DB shoulder press (both dumbbells × 1.2), then machine shoulder press, then 0.6 × bench.
  'barbell-overhead-press': [
    { from: 'dumbbell-seated-shoulder-press', f: 2 * 1.2 },
    { from: 'machine-shoulder-press', f: 1.2 / 1.1 },
    { from: 'barbell-bench-press', f: 0.6 },
  ],
  'barbell-bench-press': [
    { from: 'dumbbell-bench-press', f: 2 * 1.2 },
    { from: 'barbell-incline-bench-press', f: 1 / 0.85 },
    { from: 'smith-machine-bench-press', f: 1 },
  ],
  'barbell-back-squat': [
    { from: 'barbell-front-squat', f: 1 / 0.8 },
    { from: 'smith-machine-squat', f: 1 },
    { from: 'barbell-bench-press', f: 1.35 },
  ],
  'barbell-bent-over-row': [
    { from: 'dumbbell-one-arm-row', f: 2 * 0.9 },
    { from: 'barbell-bench-press', f: 0.85 },
  ],
  'barbell-deadlift': [
    { from: 'barbell-romanian-deadlift', f: 1 / 0.7 },
    { from: 'barbell-back-squat', f: 1.2 },
    { from: 'barbell-bench-press', f: 1.7 },
  ],
  'barbell-romanian-deadlift': [
    { from: 'barbell-deadlift', f: 0.7 },
    { from: 'barbell-bench-press', f: 1.15 },
  ],
  'barbell-front-squat': [
    { from: 'barbell-back-squat', f: 0.8 },
    { from: 'barbell-bench-press', f: 1.07 },
  ],
  'barbell-incline-bench-press': [
    { from: 'dumbbell-incline-bench-press', f: 2 * 1.2 * 0.85 },
    { from: 'barbell-bench-press', f: 0.85 },
  ],
};

/** Any preferences (§2): grouped Chest, Legs, Back, Shoulders; Rear delts under Back (D5). */
export interface PbPrefQuestion {
  id: string;
  group: 'Chest' | 'Legs' | 'Back' | 'Shoulders';
  label: string;
  muscle: PbMuscle;
  opts: readonly [readonly string[], readonly string[]];
  labels: readonly [string, string];
  other: readonly string[];
  /** Shown only when glutes/adductors/abductors are targeted or Legs is a priority. */
  hips?: true;
}

export const PB_PREF_QUESTIONS: readonly PbPrefQuestion[] = [
  { id: 'flat', group: 'Chest', label: 'Flat press', muscle: 'Chest', opts: [['barbell-bench-press'], ['dumbbell-bench-press']], labels: ['Barbell', 'Dumbbell'], other: ['machine-chest-press', 'smith-machine-bench-press', 'bodyweight-push-up'] },
  { id: 'incline', group: 'Chest', label: 'Incline press', muscle: 'Chest', opts: [['barbell-incline-bench-press'], ['dumbbell-incline-bench-press']], labels: ['Barbell', 'Dumbbell'], other: ['cable-fly'] },
  { id: 'squat', group: 'Legs', label: 'Main leg lift', muscle: 'Quads', opts: [['barbell-back-squat'], ['machine-leg-press']], labels: ['Squat', 'Leg press'], other: ['machine-hack-squat', 'barbell-front-squat', 'smith-machine-squat'] },
  { id: 'quads', group: 'Legs', label: 'Quad extra', muscle: 'Quads', opts: [['machine-leg-extension'], ['dumbbell-bulgarian-split-squat']], labels: ['Leg extension', 'Split squat'], other: ['dumbbell-walking-lunge', 'dumbbell-goblet-squat', 'dumbbell-step-up'] },
  { id: 'ham', group: 'Legs', label: 'Hamstrings', muscle: 'Hamstrings', opts: [['barbell-romanian-deadlift'], ['machine-lying-leg-curl']], labels: ['RDL', 'Leg curl'], other: ['machine-seated-leg-curl', 'bodyweight-nordic-curl', 'barbell-good-morning'] },
  { id: 'hips', group: 'Legs', label: 'Hips', muscle: 'Glutes', opts: [['barbell-hip-thrust'], ['machine-hip-adduction', 'machine-hip-abduction']], labels: ['Hip thrust', 'In/out machines'], other: ['bodyweight-glute-bridge', 'cable-glute-kickback'], hips: true },
  { id: 'vpull', group: 'Back', label: 'Lats', muscle: 'Back', opts: [['bodyweight-pull-up'], ['cable-lat-pulldown']], labels: ['Pull-ups', 'Lat pulldown'], other: ['machine-assisted-pull-up', 'bodyweight-chin-up', 'cable-single-arm-pulldown'] },
  { id: 'row', group: 'Back', label: 'Row', muscle: 'Back', opts: [['barbell-bent-over-row'], ['machine-chest-supported-row']], labels: ['Barbell', 'Chest-supported'], other: ['cable-seated-row', 'dumbbell-one-arm-row', 'dumbbell-chest-supported-row'] },
  { id: 'rear', group: 'Back', label: 'Rear delts', muscle: 'Back', opts: [['cable-face-pull'], ['dumbbell-rear-delt-fly']], labels: ['Face pull', 'Rear-delt fly'], other: ['machine-reverse-pec-deck'] },
  { id: 'shp', group: 'Shoulders', label: 'Shoulder press', muscle: 'Shoulders', opts: [['dumbbell-seated-shoulder-press'], ['machine-shoulder-press']], labels: ['Dumbbell', 'Machine'], other: ['barbell-overhead-press', 'dumbbell-arnold-press'] },
];

/** Splits (Your week) and their cycles; Chest/Legs/Shoulders/Back needs 4 days, else full body. */
export const PB_CYCLES: Readonly<Record<'ul' | 'ppl' | 'body' | 'full', readonly PbDayType[]>> = {
  ul: ['Upper', 'Lower'],
  ppl: ['Push', 'Pull', 'Legs'],
  body: ['Chest', 'Legs', 'Shoulders', 'Back'],
  full: ['Full body'],
};
export const PB_SPLIT_MIN_DAYS: Readonly<Record<'ul' | 'ppl' | 'body' | 'full', number>> = { ppl: 3, body: 4, ul: 2, full: 1 };
