import { buildLockScreenContent, lockScreenLogTarget, lockScreenTapBase, type LastComparableLookup, type LockScreenContent, type LockScreenLog, type LockScreenState } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { NativePause } from '../diagnostics/launch-guard';

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
 *   app suspended or force-closed.
 * - Rest end with the app suspended (Ben, 27 Oct): JS can't run then, so the
 *   deadline re-check below never fires and nothing can call `update`. The
 *   Resting props therefore carry the Ready content for after the rest
 *   (`after*`), with the stale date at the rest's end; iOS marks the activity
 *   stale at that moment without the app and the widget draws the `after*`
 *   content (`RestCountdownActivity.tsx`). The re-check and the foreground
 *   reconcile still write the real Ready state when the app does run.
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
  /** `Last 100 kg × 7` (Ben, 26 Oct); '' when none. */
  line3: string;
  /**
   * Lock Screen rest buttons (Ben, 26 Oct): the target base
   * `fizz.rest|<session>|<timer>|<version>` the widget appends `|minus15`,
   * `|plus15` or `|skip` to; '' = no buttons (not resting, or the build or iOS
   * can't deliver the tap: `buttons` off).
   */
  tap: string;
  startMs: number;
  endMs: number;
  side: string;
  a11y: string;
  /**
   * (Ben, 27 Oct) The Ready content for when the rest runs out, written with
   * the rest: the widget shows it once the activity is stale (its stale date
   * is the rest's end), so the Lock Screen turns to the next set with the app
   * suspended. '' (`afterTitle`) = nothing to switch to.
   */
  afterTitle: string;
  afterLine1: string;
  afterLine2: string;
  afterLine3: string;
  afterSide: string;
  afterA11y: string;
  /**
   * (Ben, 27 Oct) `Log` on the Ready state: the button's target
   * (`fizz.log|…`, `lock-screen-log.ts`), its text `Log 80 kg × 8` and its
   * VoiceOver label; '' = no Log (not Ready, a set that needs the app, or the
   * build can't deliver the tap). `afterLog*`: the same for the Ready content
   * drawn at the rest's end without the app.
   */
  log: string;
  logLabel: string;
  logA11y: string;
  afterLog: string;
  afterLogLabel: string;
  afterLogA11y: string;
}

function logProps(log: LockScreenLog | null | undefined, on: boolean): { target: string; label: string; a11y: string } {
  if (!on || log === null || log === undefined) return { target: '', label: '', a11y: '' };
  return { target: lockScreenLogTarget(log), label: log.label, a11y: log.a11y };
}

/** `buttons`: the rest buttons can be delivered; `log`: Log too (it uses the same tap queue, so it needs `buttons`). */
export function activityProps(c: LockScreenContent, buttons = false, log = false): WorkoutActivityProps {
  const now = logProps(c.log, buttons && log);
  const after = logProps(c.afterRest?.log, buttons && log);
  return {
    state: c.state,
    title: c.title,
    line1: c.line1,
    line2: c.line2,
    line3: c.line3,
    tap: buttons && c.rest !== null ? lockScreenTapBase(c.sessionId, c.rest) : '',
    startMs: c.countdown?.startMs ?? 0,
    endMs: c.countdown?.endMs ?? 0,
    side: c.side,
    a11y: c.a11y,
    afterTitle: c.afterRest?.title ?? '',
    afterLine1: c.afterRest?.line1 ?? '',
    afterLine2: c.afterRest?.line2 ?? '',
    afterLine3: c.afterRest?.line3 ?? '',
    afterSide: c.afterRest?.side ?? '',
    afterA11y: c.afterRest?.a11y ?? '',
    log: now.target,
    logLabel: now.label,
    logA11y: now.a11y,
    afterLog: after.target,
    afterLogLabel: after.label,
    afterLogA11y: after.a11y,
  };
}

export interface LiveActivityPort {
  /** The build has the widget extension (capability flag). */
  available(): boolean;
  /**
   * (Ben, 28 Oct) Why it is off this run on a build that has it (the launch guard: a safe start, or it closed the app
   * on this build). Absent or null: not paused.
   */
  paused?(): NativePause | null;
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

/** `paused`: off this run by the launch guard (Ben, 28 Oct), not missing from the build. */
export type LiveActivityStatus = 'not_in_build' | 'paused' | 'idle' | 'showing' | 'failed';

/** Re-check a little after a countdown ends, so a Resting activity left at 0:00 turns Ready while the app runs. */
export const DEADLINE_RECHECK_MS = 500;

export function createLiveActivityController(
  port: LiveActivityPort,
  opts: {
    tz: (state: SessionAggregate) => string;
    clock?: ActivityClock;
    painFlagged?: () => ReadonlySet<string> | undefined;
    /** Last time per workout row, as read so far (`last-time-cache.ts`). */
    lastComparable?: (state: SessionAggregate) => LastComparableLookup;
    /** The −15 s / +15 s / Skip buttons can be delivered on this phone and build (`lock-screen-taps.ts`). */
    buttons?: () => boolean;
    /** (Ben, 27 Oct) `Log` on the Ready state too (`FIZZ_LA_LOG`); only with `buttons`. */
    log?: () => boolean;
  },
) {
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

  const buttonsOn = (): boolean => {
    try {
      return opts.buttons?.() === true;
    } catch {
      return false;
    }
  };
  const logOn = (): boolean => {
    try {
      return opts.log?.() === true;
    } catch {
      return false;
    }
  };

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
    const lookup = state === null ? undefined : opts.lastComparable?.(state);
    const content = state === null ? null : buildLockScreenContent(state, nowMs, opts.tz(state), { painFlagged: opts.painFlagged?.(), ...(lookup === undefined ? {} : { lastComparable: lookup }) });
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
    const props = activityProps(content, buttonsOn(), logOn());
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
      if (!port.available()) return (port.paused?.() ?? null) !== null ? 'paused' : 'not_in_build';
      if (failed) return 'failed';
      return current === null ? 'idle' : 'showing';
    },
    get lastError(): string | null {
      return lastError;
    },
  };
}

export type LiveActivityController = ReturnType<typeof createLiveActivityController>;
