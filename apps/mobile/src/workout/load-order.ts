import type { SessionAggregate } from '@fizz/schemas';

/**
 * Which workout the screen shows when reads and writes resolve out of order
 * (a slow reload started on foreground, then a command saved first). Pure so
 * the screen can't put an older read back over a newer write.
 *
 * The workout comes from whichever is newer by `aggregate.revision` (bumps on
 * every persisted change, including pause, resume, work-interval stop and
 * tick, which don't bump the session version). The side data (history, pain
 * flags, gym names, check-in) always comes from the incoming read, so a
 * rejected stale workout never drops a fresher pain flag.
 */
export function newerWorkoutData<T extends { aggregate: SessionAggregate }>(current: T | null | 'loading', incoming: T | null): T | null | 'loading' {
  if (incoming === null || current === null || current === 'loading') return incoming;
  const a = current.aggregate;
  const b = incoming.aggregate;
  if (a.session.id !== b.session.id) return incoming;
  if (b.revision < a.revision) return { ...incoming, aggregate: a };
  return incoming;
}

/**
 * What the screen shows after a command commits: the committed workout merged
 * into what's on screen now (`current`), not into an older snapshot, unless
 * the screen already shows a newer revision. `fallback` is the data the
 * command was issued from, used only when nothing of that workout is shown.
 */
export function withCommandResult<T extends { aggregate: SessionAggregate }>(current: T | null | 'loading', fallback: T, aggregate: SessionAggregate): T | null | 'loading' {
  const base = current !== null && current !== 'loading' && current.aggregate.session.id === aggregate.session.id ? current : fallback;
  return newerWorkoutData(current, { ...base, aggregate });
}
