/**
 * (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") The app's foreground state as the
 * coach's turns see it, and timers that stop counting while the app is in the background. Pure TS: the shell
 * feeds it React Native's `AppState` (`setActive`); tests drive it with a fake clock.
 *
 * iOS suspends the app's JS soon after it leaves the foreground. A timer due while suspended fires as soon as the
 * app resumes, often before the `active` event arrives, so a timer that fires much later than it was due counts as
 * suspended too: it is armed again for the time it had left.
 */

import type { TurnLifecycle, TurnTimers } from '@fizz/coach';

import { nowMs } from '../clock';

/** The host's own timers and clock (the global ones on the phone; a fake clock in tests). */
export interface HostClock {
  nowMs(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const HOST_CLOCK: HostClock = {
  nowMs,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** A timer firing this much later than due was suspended with the app (JS jank is far shorter). */
export const SUSPENDED_SLACK_MS = 5_000;

export interface AppForeground extends TurnLifecycle {
  /** From `AppState`: `active` is the foreground; `inactive` and `background` aren't. */
  setActive(active: boolean): void;
  /** Called on each change (true: back in the foreground). Returns the unsubscribe. */
  subscribe(listener: (active: boolean) => void): () => void;
}

interface Pending {
  fn: () => void;
  /** Time left while paused; the time it had when last armed. */
  remainingMs: number;
  armedAtMs: number;
  raw: unknown;
  armed: boolean;
}

export function createAppForeground(clock: HostClock = HOST_CLOCK, initiallyActive = true): AppForeground {
  let active = initiallyActive;
  let away = 0;
  const pending = new Set<Pending>();
  const listeners = new Set<(active: boolean) => void>();

  const arm = (p: Pending): void => {
    p.armedAtMs = clock.nowMs();
    p.armed = true;
    p.raw = clock.setTimeout(() => {
      p.armed = false;
      if (!pending.has(p)) return;
      const late = clock.nowMs() - (p.armedAtMs + p.remainingMs);
      if (!active) return; // Paused: armed again on `active` with the time it had.
      if (late > SUSPENDED_SLACK_MS) {
        // Suspended with the app and woken on resume: the time away doesn't count.
        arm(p);
        return;
      }
      pending.delete(p);
      p.fn();
    }, p.remainingMs);
  };

  const pause = (p: Pending): void => {
    if (!p.armed) return;
    clock.clearTimeout(p.raw);
    p.armed = false;
    p.remainingMs = Math.max(0, p.remainingMs - (clock.nowMs() - p.armedAtMs));
  };

  const timers: TurnTimers = {
    set(fn, ms) {
      const p: Pending = { fn, remainingMs: Math.max(0, ms), armedAtMs: clock.nowMs(), raw: null, armed: false };
      pending.add(p);
      if (active) arm(p);
      return p;
    },
    clear(handle) {
      const p = handle as Pending | undefined;
      if (p === undefined || !pending.has(p)) return;
      pending.delete(p);
      if (p.armed) clock.clearTimeout(p.raw);
      p.armed = false;
    },
  };

  return {
    timers,
    backgroundCount: () => away,
    isActive: () => active,
    whenActive(signal) {
      if (active || signal.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = (): void => {
          off();
          signal.removeEventListener('abort', done);
          resolve();
        };
        const off = subscribe((now) => {
          if (now) done();
        });
        signal.addEventListener('abort', done, { once: true });
      });
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      if (!next) {
        away += 1;
        for (const p of pending) pause(p);
      } else {
        for (const p of pending) if (!p.armed) arm(p);
      }
      for (const l of [...listeners]) l(next);
    },
    subscribe,
  };

  function subscribe(listener: (active: boolean) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
}
