import { describe, expect, it } from 'vitest';

import { restEndCueKey, showRestAlertInForeground } from '../src/alerts/presentation';

describe('rest-end alert in the foreground (review S1)', () => {
  it('is suppressed only while the workout screen is on screen', () => {
    expect(showRestAlertInForeground({ isWorkoutAlert: true, appActive: true, workoutOnScreen: true })).toBe(false);
    // Minimised to Today: the notification banner and sound are the alert.
    expect(showRestAlertInForeground({ isWorkoutAlert: true, appActive: true, workoutOnScreen: false })).toBe(true);
    expect(showRestAlertInForeground({ isWorkoutAlert: true, appActive: false, workoutOnScreen: true })).toBe(true);
    expect(showRestAlertInForeground({ isWorkoutAlert: false, appActive: true, workoutOnScreen: true })).toBe(true);
  });

  it('is suppressed anywhere in the app when a spoken cue will play: one alert, never two (voice review S2)', () => {
    // Today, or the coach sheet over the workout: the voice is the alert.
    expect(showRestAlertInForeground({ isWorkoutAlert: true, appActive: true, workoutOnScreen: false, spokenCueWillPlay: true })).toBe(false);
    // Cues off or no module: the banner, as before.
    expect(showRestAlertInForeground({ isWorkoutAlert: true, appActive: true, workoutOnScreen: false, spokenCueWillPlay: false })).toBe(true);
    // In the background the notification is always the alert.
    expect(showRestAlertInForeground({ isWorkoutAlert: true, appActive: false, workoutOnScreen: false, spokenCueWillPlay: true })).toBe(true);
    // Other notifications are never touched.
    expect(showRestAlertInForeground({ isWorkoutAlert: false, appActive: true, workoutOnScreen: false, spokenCueWillPlay: true })).toBe(true);
  });
});

describe('−30 s to zero plays the rest-end cue (review S6)', () => {
  it('finds the expiry in a command result, and drops a late one', () => {
    expect(restEndCueKey([{ type: 'RestAdjusted', timerId: 't', deadlineUtc: 'x', timerVersion: 3 }, { type: 'RestEnded', timerId: 't', reason: 'expired', timerVersion: 3, lateByMs: 0 }])).toBe('t:3');
    expect(restEndCueKey([{ type: 'RestEnded', timerId: 't', reason: 'skipped', timerVersion: 2, lateByMs: 0 }])).toBeNull();
    expect(restEndCueKey([{ type: 'RestEnded', timerId: 't', reason: 'expired', timerVersion: 2, lateByMs: 60_000 }])).toBeNull();
  });
});
