import type { ResultUpdate } from './model';

/**
 * Locked-screen spoken cue experiment (pure verdict). Opt-in only: the build
 * must be made with FIZZ_BACKGROUND_AUDIO=1 (UIBackgroundModes audio), and the
 * audio-coach keep-alive loops silence so iOS keeps the app running while
 * locked (ios-platform-feasibility.md §2.5, recommendation 6).
 *
 * The delay is a JS timer. If iOS suspended the app anyway, the timer fires
 * late (when Ben unlocks), which this reports as a failure, not a pass.
 */

export const LOCKED_CUE_DELAY_S = 30;
/** Firing later than this means the app was suspended, not merely busy. */
export const LOCKED_CUE_MAX_LATENESS_MS = 5000;

export interface LockedCueObservation {
  /** AppState.currentState when the cue was due ("active" = not locked/backgrounded). */
  appStateAtCue: string;
  latenessMs: number;
  /** audio-coach speak() outcome. */
  outcome: 'finished' | 'cancelled' | 'timedOut';
  otherAudioWasPlaying: boolean;
  keepAliveCategory: string | null;
  /** Interruptions/route changes seen during the wait. */
  events: readonly string[];
}

export function judgeLockedCue(o: LockedCueObservation): ResultUpdate {
  const details = [
    `Cue due ${LOCKED_CUE_DELAY_S} s after Run; fired ${(o.latenessMs / 1000).toFixed(1)} s late`,
    `App state when due: ${o.appStateAtCue}`,
    `Cue outcome: ${o.outcome}`,
    `Other audio playing at cue time: ${o.otherAudioWasPlaying ? 'yes' : 'no'}`,
    `Keep-alive category: ${o.keepAliveCategory ?? 'unknown'} (mixes with music, no ducking while idle)`,
    ...o.events.map((e) => `Event: ${e}`),
  ];
  if (o.latenessMs > LOCKED_CUE_MAX_LATENESS_MS) {
    return {
      status: 'fail',
      summary: `iOS suspended the app: the cue fired ${Math.round(o.latenessMs / 1000)} s late, when the app came back`,
      details,
    };
  }
  if (o.appStateAtCue === 'active') {
    return {
      status: 'not_run',
      summary: 'The app was on screen when the cue played, so this did not test the locked case. Lock the phone and run again',
      details,
    };
  }
  if (o.outcome !== 'finished') {
    return { status: 'fail', summary: `The cue did not finish while locked (${o.outcome})`, details };
  }
  return { status: 'needs_check', summary: 'Cue played on time while the app was in the background', details };
}
