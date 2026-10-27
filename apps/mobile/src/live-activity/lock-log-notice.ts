import { lockScreenLoggedNotice, type LockScreenLoggedNotice } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

/**
 * `Set 2 logged from Lock Screen · Undo` (Ben, 27 Oct 2026;
 * lock-screen-and-alerts §4.7): shown on the workout screen the next time
 * GymSmarter is open in the foreground after a Lock Screen `Log`, once per log
 * per app run. Which log, and its Undo, come from the stored workout
 * (`lockScreenLoggedNotice`: the latest commit, made by a Lock Screen tap), so
 * the toast still appears after the app was killed in between. Nothing shows
 * while the app is in the background (a toast there would time out unseen).
 */
export function createLockLogNotices() {
  const shown = new Set<string>();
  return {
    take(state: SessionAggregate | null, nowMs: number, appActive: boolean): LockScreenLoggedNotice | null {
      if (!appActive) return null;
      const n = lockScreenLoggedNotice(state, nowMs);
      if (n === null || shown.has(n.opId)) return null;
      shown.add(n.opId);
      return n;
    },
  };
}

/** One for the app run. */
export const lockLogNotices = createLockLogNotices();
