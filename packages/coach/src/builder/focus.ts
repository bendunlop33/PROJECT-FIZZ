import { infoOrDefault, workingCount, type BuilderContext, type BuilderExerciseInfo, type BuilderGroupName, type BuilderSlot } from '@fizz/domain';

/**
 * Muscle focus headings for the coach review (workout-builder-v3 §2.5,
 * §2.9). Pure. Counting rule (as the agreed prototype counts; SP3 asks Ben
 * to confirm): an exercise's working sets count in full for its own focus
 * (its angle, else its first muscle) and half for each other focus it
 * works, rounded once per focus.
 */

/** The core muscles a day's groups should cover (focus headings, §2.5). Rear delts count as Back (Q13). */
export const CORE_FOCI: Readonly<Record<BuilderGroupName, readonly string[]>> = {
  Chest: ['Upper chest', 'Mid chest'],
  Back: ['Lats', 'Mid-back', 'Rear delts'],
  Shoulders: ['Front delts', 'Side delts'],
  Legs: ['Quads', 'Hamstrings & glutes', 'Calves'],
  Arms: ['Biceps', 'Triceps'],
  Core: ['Abs'],
};

/** A muscle word (`BuilderExerciseInfo.muscles`) → its focus heading; words with none (grip, hip flexors) count nowhere. */
export const MUSCLE_FOCUS: Readonly<Record<string, string>> = {
  chest: 'Mid chest',
  'mid chest': 'Mid chest',
  'upper chest': 'Upper chest',
  'lower chest': 'Mid chest',
  lats: 'Lats',
  'mid-back': 'Mid-back',
  'upper back': 'Mid-back',
  traps: 'Mid-back',
  'rear delts': 'Rear delts',
  'front delts': 'Front delts',
  'side delts': 'Side delts',
  biceps: 'Biceps',
  brachialis: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings & glutes',
  glutes: 'Hamstrings & glutes',
  adductors: 'Hamstrings & glutes',
  calves: 'Calves',
  abs: 'Abs',
  obliques: 'Abs',
  core: 'Abs',
};

/** The focus an exercise leads with: its angle, else its first muscle's focus. */
export function ownFocusOf(i: Pick<BuilderExerciseInfo, 'angle' | 'muscles'>): string | null {
  return i.angle !== '' ? i.angle : (MUSCLE_FOCUS[i.muscles[0] ?? ''] ?? null);
}

/** Working sets per focus (full for its own, half for others), each rounded. */
export function focusSets(slots: readonly BuilderSlot[], ctx: Pick<BuilderContext, 'info'>): Map<string, number> {
  const raw = new Map<string, number>();
  for (const s of slots) {
    const i = infoOrDefault(ctx.info, s.exerciseId);
    const n = workingCount(s);
    const own = ownFocusOf(i);
    if (own !== null) raw.set(own, (raw.get(own) ?? 0) + n);
    const others = new Set(i.muscles.map((m) => MUSCLE_FOCUS[m]).filter((f): f is string => f !== undefined && f !== own));
    for (const f of others) raw.set(f, (raw.get(f) ?? 0) + n / 2);
  }
  return new Map([...raw].map(([k, v]) => [k, Math.round(v)]));
}
