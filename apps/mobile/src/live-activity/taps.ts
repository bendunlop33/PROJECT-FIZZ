import { lockScreenTapCommand, parseLockScreenTap, type CommandOutcome, type LockScreenTapIgnored } from '@fizz/domain';
import type { SessionAggregate, SessionCommand, ZonedTimestamp } from '@fizz/schemas';

/**
 * Lock Screen rest buttons, app side (Ben, 26 Oct 2026; lock-screen-and-alerts
 * §4.2). Pure orchestration over ports, so it is tested on Linux.
 *
 * A tap on `−15 s`, `+15 s` or `Skip` runs an expo-widgets LiveActivityIntent
 * in the app's process. The patched intent queues the tap natively, posts an
 * event, and waits (up to 8 s) for the queue entry to go. Here, on that event
 * and on every launch and return to the foreground, the queue is drained:
 * each tap is decided against the workout as stored (`lockScreenTapCommand`),
 * sent through the same `dispatch` as the in-app buttons (operation ID,
 * expected timer version: rule 5), the Live Activity and the alert are
 * reconciled to the result and awaited, and only then is the entry removed.
 *
 * - Never logs a set: there is no Log button (rule 2; `Log as planned` is not built).
 * - A duplicate delivery is one write (deterministic operation ID).
 * - A tap for an older picture of the rest, another workout, a paused
 *   workout, an ended rest, or older than a minute is dropped, and the
 *   activity is redrawn from the true state.
 * - Nothing throws into the app: a failing read or write drops that tap.
 */

export interface RawLockScreenTap {
  id?: unknown;
  /** The activity's name (`RestCountdown`); not needed, the target says it all. */
  source?: unknown;
  target?: unknown;
  atMs?: unknown;
}

export interface TapQueuePort {
  /** The build can deliver taps (native queue present). */
  available(): boolean;
  list(): RawLockScreenTap[];
  ack(ids: string[]): void;
}

export interface LockScreenTapDeps {
  queue: TapQueuePort;
  /** The workout in progress, as stored (null: none). */
  readActive(): Promise<SessionAggregate | null>;
  /** The shared write path (`services.sessions.dispatch`): idempotent and versioned. */
  dispatch(sessionId: string, command: SessionCommand): Promise<CommandOutcome>;
  /** Reconcile the Live Activity and the rest alert to this state, and wait for it. */
  settle(state: SessionAggregate): Promise<void>;
  now(): ZonedTimestamp;
  /** A write happened: screens reload. */
  onChanged(): void;
}

export type TapResult =
  | { id: string; result: 'applied' | 'duplicate' }
  | { id: string; result: 'refused'; code: string }
  | { id: string; result: 'ignored'; reason: LockScreenTapIgnored | 'not_ours' }
  | { id: string; result: 'failed'; message: string };

export function createLockScreenTapHandler(deps: LockScreenTapDeps) {
  let chain: Promise<TapResult[]> = Promise.resolve([]);

  async function handleOne(id: string, raw: RawLockScreenTap): Promise<TapResult> {
    const tap = parseLockScreenTap(raw.target);
    if (tap === null) return { id, result: 'ignored', reason: 'not_ours' };
    const state = await deps.readActive();
    const tappedAtMs = typeof raw.atMs === 'number' && Number.isFinite(raw.atMs) ? raw.atMs : 0;
    const decision = lockScreenTapCommand(state, tap, deps.now(), tappedAtMs);
    if (decision.kind === 'ignore') {
      // Redraw from the truth (an older picture stays wrong otherwise); never with null, which would end it.
      if (state !== null) await deps.settle(state);
      return { id, result: 'ignored', reason: decision.reason };
    }
    const outcome = await deps.dispatch(tap.sessionId, decision.command);
    if (!outcome.ok) {
      if (state !== null) await deps.settle(state);
      return { id, result: 'refused', code: outcome.error.code };
    }
    await deps.settle(outcome.aggregate);
    if (!outcome.duplicate) deps.onChanged();
    return { id, result: outcome.duplicate ? 'duplicate' : 'applied' };
  }

  async function run(): Promise<TapResult[]> {
    if (!deps.queue.available()) return [];
    let entries: RawLockScreenTap[];
    try {
      entries = deps.queue.list();
    } catch {
      return [];
    }
    const sorted = [...entries].sort((a, b) => (typeof a.atMs === 'number' ? a.atMs : 0) - (typeof b.atMs === 'number' ? b.atMs : 0));
    const results: TapResult[] = [];
    for (const raw of sorted) {
      if (typeof raw.id !== 'string' || raw.id === '') continue;
      const id = raw.id;
      try {
        results.push(await handleOne(id, raw));
      } catch (e) {
        results.push({ id, result: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
      // Removed once handled (or dropped): the waiting intent returns and a bad entry can't loop.
      try {
        deps.queue.ack([id]);
      } catch {
        // The intent times out on its own; the next drain sees the entry again and the opId keeps it to one write.
      }
    }
    return results;
  }

  return {
    /** On a tap event, launch, and return to the foreground. Serialised; never rejects. */
    drain(): Promise<TapResult[]> {
      const next = chain.then(run, run).catch(() => [] as TapResult[]);
      chain = next;
      return next;
    },
  };
}

export type LockScreenTapHandler = ReturnType<typeof createLockScreenTapHandler>;
