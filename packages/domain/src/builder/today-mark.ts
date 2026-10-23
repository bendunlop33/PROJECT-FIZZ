import type { BuilderSetup, DraftPlan } from '@fizz/schemas';
import { deriveId, stableStringify } from '../stable';

/**
 * The content a Today mark vouches for: the version's plan, set-up and gym. Any builder write changes it. Its own
 * module (no other domain imports) so the session's Start can tell Today's versions apart without an import cycle.
 */
export function todayContentHash(v: { plan: DraftPlan; setup: BuilderSetup | undefined | null; gymId: string | null }): string {
  return deriveId(`today-content:${stableStringify({ plan: v.plan, setup: v.setup ?? null, gymId: v.gymId })}`);
}
