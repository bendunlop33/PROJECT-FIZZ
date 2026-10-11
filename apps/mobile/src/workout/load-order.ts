import type { SessionAggregate } from '@fizz/schemas';

/**
 * Fields of a workout read that don't depend on the aggregate read with them
 * (pain flags, gym names, effort scale, recent pace). Everything else in the
 * read (gym name, previous sessions, title, check-in) is derived from that
 * read's aggregate and only makes sense next to it.
 */
const INDEPENDENT_FIELDS = ['painFlags', 'painFlagged', 'gymNames', 'effortScale', 'recentPace'] as const;

function independentOf<T extends object>(d: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of INDEPENDENT_FIELDS) if (k in d) out[k] = (d as Record<string, unknown>)[k];
  return out as Partial<T>;
}

export interface ReadOrder {
  /** No other read started after this one (the screen's load sequence). Defaults to true. */
  startedLast?: boolean;
}

/**
 * Which workout the screen shows when reads and writes resolve out of order
 * (a slow reload started on foreground, then a command saved first). Pure so
 * the screen can't put an older read back over a newer write.
 *
 * The workout, and the fields derived from it (gym name, previous, title,
 * check-in), come together from whichever is newer by `aggregate.revision`
 * (bumps on every persisted change, including pause, resume, work-interval
 * stop and tick, which don't bump the session version). The independent
 * fields (pain flags, gym names, effort scale, pace) come from the read that
 * started last, so a rejected stale workout never drops a fresher pain flag
 * and a slow older read never brings back older ones.
 */
export function newerWorkoutData<T extends { aggregate: SessionAggregate }>(current: T | null | 'loading', incoming: T | null, order: ReadOrder = {}): T | null | 'loading' {
  if (incoming === null || current === null || current === 'loading') return incoming;
  const a = current.aggregate;
  const b = incoming.aggregate;
  if (a.session.id !== b.session.id) return incoming;
  const startedLast = order.startedLast ?? true;
  if (b.revision < a.revision) return startedLast ? { ...current, ...independentOf(incoming) } : current;
  return startedLast ? incoming : { ...incoming, ...independentOf(current) };
}

/**
 * What the screen shows after a command commits: the committed workout merged
 * into what's on screen now (`current`), not into an older snapshot, unless
 * the screen already shows a newer revision. `fallback` is the data the
 * command was issued from, used only when nothing of that workout is shown.
 * When the screen shows no workout (`null`: a reload found it finished or
 * discarded) a late result for a workout that is no longer active stays
 * hidden.
 */
export function withCommandResult<T extends { aggregate: SessionAggregate }>(current: T | null | 'loading', fallback: T, aggregate: SessionAggregate): T | null | 'loading' {
  if (current === null && aggregate.session.status !== 'active') return null;
  const base = current !== null && current !== 'loading' && current.aggregate.session.id === aggregate.session.id ? current : fallback;
  return newerWorkoutData(current, { ...base, aggregate });
}
