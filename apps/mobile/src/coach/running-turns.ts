/**
 * (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") The coach turns running in this app
 * run, by thread, with what each has shown so far. The turn belongs to the service, not the sheet: closing the
 * sheet doesn't stop it, and a sheet opened on the same thread attaches to it and follows it to the end.
 * One turn per thread at a time. Pure TS, no React.
 */

import type { CoachTurnProgress } from '@fizz/coach';
import type { BenInput } from '@fizz/schemas';

/**
 * Which thread a turn will land in before the thread is known (a first message makes it): a workout's
 * (or its summary's) thread, or the general one.
 */
export type TurnScope = `session:${string}` | 'general';

export interface RunningTurn {
  turnId: string;
  /** Null until the turn's thread is saved (a first message starts a new one). */
  threadId: string | null;
  scope: TurnScope;
  input: BenInput;
  startedAtMs: number;
  /** Everything the turn has shown so far, in order (tool lines, cards, checked sentences). */
  progress: readonly CoachTurnProgress[];
}

export type RunningTurnEvent =
  | { kind: 'started' | 'thread' | 'progress'; turn: RunningTurn }
  /** `threadId`: where its reply is (null when it ended before a thread was saved). */
  | { kind: 'finished'; turn: RunningTurn };

/** A second start on a thread with a turn running (Send stays disabled until it ends; Stop ends it). */
export class CoachTurnBusyError extends Error {
  constructor(readonly runningTurnId: string) {
    super('A coach turn is already running on this thread.');
    this.name = 'CoachTurnBusyError';
  }
}

/** Whether `turn` is on the thread a sheet shows (`threadId`, or none yet in `scope`). */
export function onThread(turn: Pick<RunningTurn, 'threadId' | 'scope'>, threadId: string | null, scope: TurnScope): boolean {
  if (threadId !== null && turn.threadId !== null) return turn.threadId === threadId;
  return turn.scope === scope;
}

export function createRunningTurns() {
  const turns = new Map<string, RunningTurn>();
  const listeners = new Set<(e: RunningTurnEvent) => void>();
  const notify = (e: RunningTurnEvent): void => {
    for (const l of [...listeners]) {
      try {
        l(e);
      } catch {
        // A screen's listener failing never stops the turn.
      }
    }
  };
  const update = (turnId: string, kind: 'thread' | 'progress', patch: (t: RunningTurn) => RunningTurn): void => {
    const t = turns.get(turnId);
    if (t === undefined) return;
    const next = patch(t);
    turns.set(turnId, next);
    notify({ kind, turn: next });
  };

  /** The turn running on this thread (or, before it has one, in this scope), if any. */
  const runningOn = (threadId: string | null, scope: TurnScope): RunningTurn | null => {
    for (const t of turns.values()) if (onThread(t, threadId, scope)) return t;
    return null;
  };

  return {
    runningOn,
    get: (turnId: string): RunningTurn | null => turns.get(turnId) ?? null,
    isRunning: (turnId: string): boolean => turns.has(turnId),
    /**
     * Claims the thread for a turn, synchronously (two taps in the same tick can't both start).
     * Throws `CoachTurnBusyError` while another turn runs on it.
     */
    start: (turn: Omit<RunningTurn, 'progress'>): RunningTurn => {
      const busy = runningOn(turn.threadId, turn.scope);
      if (busy !== null && busy.turnId !== turn.turnId) throw new CoachTurnBusyError(busy.turnId);
      const t: RunningTurn = { ...turn, progress: [] };
      turns.set(t.turnId, t);
      notify({ kind: 'started', turn: t });
      return t;
    },
    /** The turn's thread is saved (its first message made it). */
    setThread: (turnId: string, threadId: string): void => {
      if (turns.get(turnId)?.threadId === threadId) return;
      update(turnId, 'thread', (t) => ({ ...t, threadId }));
    },
    progress: (turnId: string, p: CoachTurnProgress): void => {
      update(turnId, 'progress', (t) => ({ ...t, progress: [...t.progress, p] }));
    },
    finish: (turnId: string, threadId: string | null = null): void => {
      const t = turns.get(turnId);
      if (t === undefined) return;
      turns.delete(turnId);
      notify({ kind: 'finished', turn: threadId === null ? t : { ...t, threadId } });
    },
    subscribe: (listener: (e: RunningTurnEvent) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type RunningTurns = ReturnType<typeof createRunningTurns>;
