import { builderFocusOf, builderGroupOf, type Exercise } from '@fizz/schemas';
import type { BuilderExerciseInfo } from '../builder/types';

/**
 * Today (v2) / builder v3: what the pure builder rules need to know about one
 * exercise, read from Ben's row or the catalogue (`BuilderInfoLookup`).
 *
 * MERGE NOTE: the builder stream needs the same adapter for Set up and Your
 * workout; keep one (this one, or theirs) when the streams merge.
 *
 * - group: `builderGroupOf` (rear delts → Back, §9 Q13); null (left out) for
 *   conditioning, cardio, carries and anything without a builder group;
 * - role: the catalogue's `mechanic` (abs are always isolations);
 * - heavy (§3.5): there is no `heavy` flag on catalogue entries yet (S1 did
 *   not add it), so the spec's fallback applies: a compound whose first item
 *   is a barbell, trap bar, Smith machine or plate-loaded machine;
 * - part: legs split into quads / hamstrings_glutes / calves for pairing and
 *   alternation; every other group is its own part;
 * - muscles: the primary muscles in words (`upper chest`); a shared one means
 *   no pair;
 * - angle: the focus heading (`Upper chest`, `Lats`), else the group.
 */

const HEAVY_KINDS: ReadonlySet<string> = new Set(['barbell', 'plate_loaded_machine', 'trap_bar', 'smith_machine']);

const LEG_PART: Readonly<Record<string, 'quads' | 'hamstrings_glutes' | 'calves'>> = {
  quads: 'quads',
  hamstrings: 'hamstrings_glutes',
  glutes: 'hamstrings_glutes',
  adductors: 'hamstrings_glutes',
  abductors: 'hamstrings_glutes',
  calves: 'calves',
};

export type BuilderInfoSource = Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'secondaryMuscles' | 'movementPattern' | 'measurement' | 'mechanic' | 'compatibleEquipment'>;

/** One exercise's builder facts; null when it has no builder group (it is never picked). */
export function builderInfoOfExercise(e: BuilderInfoSource): BuilderExerciseInfo | null {
  const group = builderGroupOf(e);
  if (group === null) return null;
  const role = group !== 'Abs' && e.mechanic === 'compound' ? 'compound' : 'isolation';
  const first = e.compatibleEquipment[0];
  const heavy = role === 'compound' && first !== undefined && HEAVY_KINDS.has(first);
  const legPart = e.primaryMuscles.map((m) => LEG_PART[m]).find((p) => p !== undefined);
  return {
    exerciseId: e.id,
    name: e.name,
    group,
    role,
    heavy,
    part: group === 'Legs' ? (legPart ?? 'quads') : group,
    muscles: e.primaryMuscles.map((m) => m.replaceAll('_', ' ')),
    angle: builderFocusOf(e) ?? group,
    barbell: first === 'barbell',
  };
}

/** Only rep-based strength work goes into a built workout (timed and cardio rows have no reps to target). */
export function builderUsable(e: Pick<Exercise, 'measurement' | 'archivedAtUtc'> & BuilderInfoSource): boolean {
  return e.measurement === 'reps' && e.archivedAtUtc === undefined && builderInfoOfExercise(e) !== null;
}
