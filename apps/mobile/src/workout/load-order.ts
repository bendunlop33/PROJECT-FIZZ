import type { SessionAggregate } from '@fizz/schemas';

/**
 * Which workout read the screen shows when reads and writes resolve out of
 * order (a slow reload started on foreground, then a log saved first). Pure
 * so the screen can't put an older read back over a newer write.
 *
 * Kept: what's shown, when the new read is of the same workout at an older
 * version, or the same version with an older read of the same rest timer
 * (the foreground tick persists a rest's end without a new workout version).
 * Otherwise the new read (it carries fresh history, pain flags and names).
 */
export function newerWorkoutData<T extends { aggregate: SessionAggregate }>(current: T | null | 'loading', incoming: T | null): T | null | 'loading' {
  if (incoming === null || current === null || current === 'loading') return incoming;
  const a = current.aggregate;
  const b = incoming.aggregate;
  if (a.session.id !== b.session.id) return incoming;
  if (b.session.version < a.session.version) return current;
  if (b.session.version === a.session.version && a.restTimer !== null && b.restTimer !== null && a.restTimer.id === b.restTimer.id && b.restTimer.version < a.restTimer.version) return current;
  return incoming;
}
