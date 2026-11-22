import { learnPace, PACE_DEFAULT, PACE_RULES, toIso, type BuilderPace } from '@fizz/domain';
import type { Store } from '@fizz/persistence';

/**
 * (Ben, 28 Oct) Ben's own pace for the one time estimate (`learnPace` over his workouts logged live in the last 60
 * days; the read is kept per state of the database). A failed read is the defaults: the estimate never waits on it.
 */
export async function learnedPace(store: Store, ownerId: string, nowMs: number): Promise<BuilderPace> {
  const from = toIso(nowMs - PACE_RULES.windowDays * 86_400_000);
  const ws = await store.repos.sessions.listPaceWorkouts(ownerId, from, toIso(nowMs + 1)).catch(() => null);
  return ws === null ? PACE_DEFAULT : learnPace(ws, nowMs);
}

/** `pace` for a builder context: only when it was learned from something (absent: the defaults, as before). */
export const paceOpt = (pace: BuilderPace): { pace?: BuilderPace } => (pace.workouts > 0 ? { pace } : {});
