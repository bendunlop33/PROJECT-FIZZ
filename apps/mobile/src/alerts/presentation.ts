import type { SessionEvent } from '@fizz/domain';

import { TIMING } from '../theme/tokens';

/**
 * Whether a rest-end notification is shown while Fizz is in the foreground
 * (lock-screen-and-alerts §4.3, review S1). One alert, never two: the banner
 * (and its sound) is suppressed while the workout screen is on screen (its
 * own cue is the alert), and, anywhere in the app, whenever a spoken cue will
 * play (cues on, the audio-coach module in this build, app active — voice
 * review S2). Otherwise, on Today or Profile with the workout minimised, the
 * notification is the alert. Pure, so it is tested on Linux.
 */
export function showRestAlertInForeground(input: { isWorkoutAlert: boolean; appActive: boolean; workoutOnScreen: boolean; spokenCueWillPlay?: boolean }): boolean {
  if (!input.isWorkoutAlert || !input.appActive) return true;
  if (input.spokenCueWillPlay === true) return false;
  return !input.workoutOnScreen;
}

/**
 * A morning reminder in the foreground (review morning-20oct S1): never over
 * the workout screen (a backstop: starting a workout already takes today's
 * off). Anywhere else it shows as iOS would.
 */
export function showMorningReminderInForeground(input: { appActive: boolean; workoutOnScreen: boolean }): boolean {
  return !(input.appActive && input.workoutOnScreen);
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
