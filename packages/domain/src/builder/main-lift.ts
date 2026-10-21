import type { BuilderPool } from './build';
import type { BuilderGroupName, BuilderInfoLookup } from './types';

/**
 * Set up's default main lift for a day with no main lift of its own (no
 * plan day, none saved in the training profile): the day's lead group's
 * main compound, never "none" silently (Ben, 21 Oct: Back → Barbell row).
 * Pure; the pool (this gym's exercises, not pain-flagged, Ben's history
 * first) and the catalogue keys are injected.
 */

/** The lead group's default main lifts, best first (catalogue keys). Arms and abs have none. */
export const BUILDER_DEFAULT_MAIN_LIFTS: Readonly<Partial<Record<BuilderGroupName, readonly string[]>>> = {
  Chest: ['barbell-bench-press', 'barbell-incline-bench-press', 'dumbbell-bench-press'],
  Back: ['barbell-bent-over-row', 'barbell-row', 'cable-lat-pulldown', 'cable-seated-row'],
  Legs: ['barbell-back-squat', 'barbell-front-squat', 'machine-leg-press'],
  Shoulders: ['barbell-overhead-press', 'dumbbell-seated-shoulder-press'],
};

export interface DefaultMainLiftInput {
  /** The day's groups in order; the first that isn't Abs leads. */
  groups: readonly BuilderGroupName[];
  pool: BuilderPool;
  info: BuilderInfoLookup;
  /** The catalogue key an exercise row came from (Ben's rows keep theirs); null = custom. */
  catalogueKeyOf: (exerciseId: string) => string | null;
}

/**
 * `defaultBuilderMainLift`: in the lead group's pool (here, not
 * pain-flagged), (1) the first default main lift from
 * `BUILDER_DEFAULT_MAIN_LIFTS`; else (2) the first heavy compound (Ben's
 * history first); else (3) the first compound. Null when the group has no
 * compound here (an arms day): honestly no main lift.
 */
export function defaultBuilderMainLift(input: DefaultMainLiftInput): string | null {
  const lead = input.groups.find((g) => g !== 'Abs');
  if (lead === undefined) return null;
  const pool = input.pool(lead).filter((id) => {
    const i = input.info(id);
    return i !== null && i.group === lead && i.role === 'compound';
  });
  for (const key of BUILDER_DEFAULT_MAIN_LIFTS[lead] ?? []) {
    const hit = pool.find((id) => input.catalogueKeyOf(id) === key);
    if (hit !== undefined) return hit;
  }
  return pool.find((id) => input.info(id)?.heavy === true) ?? pool[0] ?? null;
}
