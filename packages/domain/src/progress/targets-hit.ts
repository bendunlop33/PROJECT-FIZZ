/**
 * `Targets hit 5 of last 6` (Ben, 20 Oct: "Let's only show targets hit on
 * main lift if turned on in settings"): shown only with the setting on, and
 * only for a main lift. A main lift is a split day's main lift in Profile
 * (Ben's, else the recommended one) and nothing else (Ben, 20 Oct decision 5):
 * a workout's or plan day's `Main` flags don't make one. Pure.
 */

export interface MainLiftSources {
  /** Each split day's main lift in Profile (Ben's, else the recommended one); null: none. */
  dayMainLifts: readonly (string | null | undefined)[];
}

/** Every main lift: each split day's main lift. */
export function mainLiftIds(src: MainLiftSources): Set<string> {
  const out = new Set<string>();
  for (const id of src.dayMainLifts) if (id != null) out.add(id);
  return out;
}

/** Whether an exercise is one of the main lifts (`mainLiftIds`). */
export function isMainLift(exerciseId: string, mains: ReadonlySet<string>): boolean {
  return mains.has(exerciseId);
}

/** Whether `Targets hit` shows for an exercise: the setting on and a main lift. */
export function showsTargetsHit(opts: { on: boolean; main: boolean }): boolean {
  return opts.on && opts.main;
}

/** The `Targets hit` line to show (`showsTargetsHit`), else null. */
export function targetsHitShown(hitText: string | null, opts: { on: boolean; main: boolean }): string | null {
  return showsTargetsHit(opts) ? hitText : null;
}
