import type { SessionEvent } from '@fizz/domain';

import { TIMING } from '../theme/tokens';

/**
 * Whether a rest-end notification is shown while Fizz is in the foreground
 * (lock-screen-and-alerts §4.3, review S1). The in-app cue lives on the
 * workout screen, so the banner (and its sound) is suppressed only while that
 * screen is on screen; on Today or Profile with the workout minimised, the
 * notification is the alert. Pure, so it is tested on Linux.
 */
export function showRestAlertInForeground(input: { isWorkoutAlert: boolean; appActive: boolean; workoutOnScreen: boolean }): boolean {
  if (!input.isWorkoutAlert || !input.appActive) return true;
  return !input.workoutOnScreen;
}

let workoutOnScreen = false;

/** Set by the workout screen while it is focused (and cleared when it isn't). */
export function setWorkoutOnScreen(visible: boolean): void {
  workoutOnScreen = visible;
}

export function isWorkoutOnScreen(): boolean {
  return workoutOnScreen;
}

/**
 * A command that itself ended the rest at its deadline (`−30 s` to zero)
 * returns the timer already expired, so the deadline-watching cue never sees
 * it run out (review S6). Returns the timer key to cue (callers play each key
 * once), or null. A cue more than `timing.lateCueDrop` late is dropped.
 */
export function restEndCueKey(events: readonly SessionEvent[]): string | null {
  for (const e of events) {
    if (e.type === 'RestEnded' && e.reason === 'expired' && e.lateByMs <= TIMING.lateCueDrop) return `${e.timerId}:${String(e.timerVersion)}`;
  }
  return null;
}
