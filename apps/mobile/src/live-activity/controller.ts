import { buildLockScreenContent, type LockScreenContent, type LockScreenState } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

/**
 * Keeps the Lock Screen Live Activity in step with the workout
 * (lock-screen-and-alerts.md §2.1, §4.2; rest-state.md §4.7). Pure
 * orchestration over a port, so it is tested on Linux; the phone binding is
 * `expo-port.ts`.
 *
 * - One activity per workout. It is started on the first committed state
 *   with something to show (Ready after Start, Resting after a Log), then
 *   updated in place on every commit; never one per rest.
 * - Updates are local only (no push: free Apple ID, ADR 0004). The countdown
 *   is a pair of instants the system renders, so it keeps counting with the
 *   app suspended or force-closed; `Until hh:mm` keeps `0:00` honest.
 * - Finish, Discard, a restore, Delete my data, or a stale workout end it
 *   with immediate dismissal.
 * - After a relaunch nothing is known: the first reconcile adopts one running
 *   activity for the workout in progress (updated to its true state) and ends
 *   any others.
 * - Swiped away by Ben: not started again for that workout this run (§4.2).
 *   Refused by iOS: tried again on the next reconcile (a Log, or the return
 *   to the foreground), as the refusal may have been transient.
 * - Reconciles can be queued out of order (a coach turn's re-read lands after
 *   a Log). The last applied (workout, version) is kept and an older version
 *   of the same workout is ignored, so the Lock Screen never steps back from
 *   Resting to Ready. A null (restore, no workout) clears it.
 * - It is a capability: missing from the build, refused by iOS or failing,
 *   it is skipped silently and the rest-done notification (always scheduled)
 *   is the alert. Nothing here ever throws into logging (rule 1).
 */

/** Flat props for the widget (it is serialised alone and can't import helpers). `startMs`/`endMs` are 0 when nothing counts. */
export interface WorkoutActivityProps {
  state: LockScreenState;
  title: string;
  line1: string;
  line2: string;
  startMs: number;
  endMs: number;
  side: string;
  a11y: string;
}

export function activityProps(c: LockScreenContent): WorkoutActivityProps {
  return {
    state: c.state,
    title: c.title,
    line1: c.line1,
    line2: c.line2,
    startMs: c.countdown?.startMs ?? 0,
    endMs: c.countdown?.endMs ?? 0,
    side: c.side,
    a11y: c.a11y,
  };
}

export interface LiveActivityPort {
  /** The build has the widget extension (capability flag). */
  available(): boolean;
  /** IDs of this app's activities that are still running. */
  listIds(): string[];
  /** Starts one; returns its ID. Throws when iOS refuses (Live Activities off, not in build). */
  start(props: WorkoutActivityProps, staleAtMs: number | null): string;
  update(id: string, props: WorkoutActivityProps, staleAtMs: number | null): Promise<void>;
  end(id: string): Promise<void>;
}

export interface ActivityClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type LiveActivityStatus = 'not_in_build' | 'idle' | 'showing' | 'failed';

/** Re-check a little after a countdown ends, so a Resting activity left at 0:00 turns Ready while the app runs. */
export const DEADLINE_RECHECK_MS = 500;

export function createLiveActivityController(port: LiveActivityPort, opts: { tz: (state: SessionAggregate) => string; clock?: ActivityClock }) {
  let current: { sessionId: string; id: string; key: string } | null = null;
  let adopted = false;
  /** Workouts whose activity Ben swiped away this run. */
  const skip = new Set<string>();
  let lastError: string | null = null;
  let failed = false;
  let chain: Promise<void> = Promise.resolve();
  let recheck: unknown = null;
  let lastState: SessionAggregate | null = null;
  /** The newest workout state applied, so an older one arriving late is ignored (review ben-bugs S2). */
  let applied: { sessionId: string; version: number } | null = null;

  const note = (e: unknown) => {
    lastError = e instanceof Error ? e.message : String(e);
  };

  async function endQuietly(id: string): Promise<void> {
    try {
      await port.end(id);
    } catch (e) {
      note(e);
    }
  }

  function listIds(): string[] {
    try {
      return port.listIds();
    } catch (e) {
      note(e);
      return [];
    }
  }

  function scheduleRecheck(content: LockScreenContent | null, nowMs: number): void {
    const clock = opts.clock;
    if (!clock) return;
    if (recheck !== null) clock.clearTimeout(recheck);
    recheck = null;
    if (content?.countdown == null || content.countdown.endMs <= nowMs) return;
    recheck = clock.setTimeout(
      () => {
        recheck = null;
        void reconcile(lastState, clock.now());
      },
      content.countdown.endMs - nowMs + DEADLINE_RECHECK_MS,
    );
  }

  async function apply(state: SessionAggregate | null, nowMs: number): Promise<void> {
    if (!port.available()) return;
    if (state !== null && applied !== null && applied.sessionId === state.session.id && state.session.version < applied.version) return;
    applied = state === null ? null : { sessionId: state.session.id, version: state.session.version };
    lastState = state;
    const content = state === null ? null : buildLockScreenContent(state, nowMs, opts.tz(state));
    const running = listIds();

    if (!adopted) {
      adopted = true;
      // Relaunch: adopt one for the workout in progress; end every other one (unknown or finished workouts).
      const [keep, ...rest] = content === null ? [] : running;
      for (const id of content === null ? running : rest) await endQuietly(id);
      if (keep !== undefined && content !== null) current = { sessionId: content.sessionId, id: keep, key: '' };
    }

    if (current !== null && (content === null || current.sessionId !== content.sessionId)) {
      await endQuietly(current.id);
      current = null;
    }
    if (content === null) {
      scheduleRecheck(null, nowMs);
      return;
    }
    if (current !== null && !running.includes(current.id) && current.key !== '') {
      // Swiped away (or ended by iOS): not started again for this workout this run.
      skip.add(current.sessionId);
      current = null;
    }
    if (skip.has(content.sessionId)) {
      scheduleRecheck(null, nowMs);
      return;
    }
    const props = activityProps(content);
    const key = `${JSON.stringify(props)}|${String(content.staleAtMs)}`;
    if (current === null) {
      try {
        const id = port.start(props, content.staleAtMs);
        current = { sessionId: content.sessionId, id, key };
        failed = false;
        lastError = null;
      } catch (e) {
        // Refused (Live Activities off in Settings, the app not in the foreground, or the extension can't run):
        // the notification is the alert. Tried again on the next reconcile, since a refusal can be
        // transient (review ben-bugs N3); only a swipe stops it for the workout.
        note(e);
        failed = true;
      }
    } else if (current.key !== key) {
      try {
        await port.update(current.id, props, content.staleAtMs);
        current = { ...current, key };
        lastError = null;
      } catch (e) {
        note(e);
      }
    }
    scheduleRecheck(content, nowMs);
  }

  function reconcile(state: SessionAggregate | null, nowMs: number): Promise<void> {
    chain = chain.then(() => apply(state, nowMs)).catch(note);
    return chain;
  }

  return {
    /** After every commit, on launch, on return to the foreground, after a restore (null). Safe to call any time. */
    reconcile,
    /** Delete my data: end every activity but the one for `keepSessionId` (the workout in progress, review r3 N2). */
    endAll(keepSessionId?: string): Promise<void> {
      chain = chain
        .then(async () => {
          if (!port.available()) return;
          for (const id of listIds()) {
            if (current !== null && current.id === id && current.sessionId === keepSessionId) continue;
            await endQuietly(id);
          }
          if (current !== null && current.sessionId !== keepSessionId) current = null;
        })
        .catch(note);
      return chain;
    },
    get status(): LiveActivityStatus {
      if (!port.available()) return 'not_in_build';
      if (failed) return 'failed';
      return current === null ? 'idle' : 'showing';
    },
    get lastError(): string | null {
      return lastError;
    },
  };
}

export type LiveActivityController = ReturnType<typeof createLiveActivityController>;
