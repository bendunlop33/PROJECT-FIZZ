import { pbDeloadAtStart, toMs, type SessionServiceOptions } from '@fizz/domain';
import type { SqliteRepositories } from '@fizz/persistence';
import { planRefs } from './plan-day-links';

/** Finished workouts read for the block week (as Today's header and the builder read it). */
const BLOCK_REFS = 400;

/**
 * (PM, 23 Oct) The session service's `deloadAt`: whether a workout started now is in the applied builder plan's deload
 * week (`pbDeloadAtStart`, the derivation Today's header and the deload draft use). Read once per real start; any read
 * that fails returns null, so Start never waits on or fails for it (the workout is then unmarked).
 */
export function deloadAtOf(repos: () => Pick<SqliteRepositories, 'profiles' | 'planDrafts' | 'sessions' | 'routines' | 'exercises'>): NonNullable<SessionServiceOptions['deloadAt']> {
  return async (ownerId, at) => {
    try {
      const r = repos();
      const plan = await r.planDrafts.applied(ownerId);
      if (plan === null) return null;
      const tz = (await r.profiles.get(ownerId))?.timezone ?? at.tz;
      // (Ben, 28 Oct) Imported and past-logged workouts that count as plan days count for the block too.
      return pbDeloadAtStart(plan, await planRefs({ repos: r }, { ownerId, plan, nowMs: toMs(at.utc) }, BLOCK_REFS), toMs(at.utc), tz);
    } catch {
      return null;
    }
  };
}
