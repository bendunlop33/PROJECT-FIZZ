import type { AppServices } from '../services/app-services';

export const FEEL_ROW_COPY = { failed: 'Couldn’t save' } as const;

/**
 * One `How did it feel?` tap, sent at the workout's version as read; when something else on Summary
 * moved the version first (a rename, `Count it`), it re-reads the version and sends it once more: it is
 * Ben's own explicit tap, the value doesn't depend on the version, and no set changes (rule 2). Anything
 * else (or a second stale) is reported, never silent (review b3-wave3-ux S7, truth S7).
 */
export async function sendFeel(services: Pick<AppServices, 'workout' | 'reviews' | 'now'>, sessionId: string, feel: 'easy' | 'good' | 'hard' | null, version: number, newId: () => string): Promise<boolean> {
  const send = (v: number) => services.workout.dispatch(sessionId, { type: 'set_feel', at: services.now(), opId: newId(), feel, expectedVersion: v });
  const first = await send(version).catch(() => null);
  if (first?.ok === true) return true;
  if (first === null || first.error.code !== 'stale_version') return false;
  const now = await services.reviews.feelOf(sessionId).catch(() => null);
  if (now === null) return false;
  const second = await send(now.version).catch(() => null);
  return second?.ok === true;
}
