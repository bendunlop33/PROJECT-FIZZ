/**
 * Guide playback clock (ADR 0013). These run on the UI thread inside a
 * Reanimated frame callback, so each is a worklet; they are also plain pure
 * functions, unit-tested in Node (the directive is just a string there).
 */

/**
 * Autoplay stops after this many passes and holds the first frame with
 * `Replay` (research exercise-bank-and-visuals §5.7: WCAG 2.2.2 and battery
 * during rest). `Pause` is always available before that.
 */
export const MAX_AUTOPLAY_PASSES = 3;

export type GuideLoop = 'cycle' | 'pingpong';

/** One pass: a cycle plays once; a ping-pong plays forwards then back. */
export function passMs(durationMs: number, loop: GuideLoop): number {
  'worklet';
  return loop === 'pingpong' ? 2 * durationMs : durationMs;
}

/** Longest refresh the look-ahead trusts; a longer gap (a stall) looks ahead this far at most. */
const MAX_LOOKAHEAD_DT_MS = 50;

/**
 * Baked frame to show after `elapsedMs` of playback. `frameCount` is the
 * length of `playbackTimes`: frame i is t = i/n with n = frameCount for a
 * cycle and n = frameCount − 1 for a ping-pong.
 *
 * `dtMs` is the current refresh interval (the frame callback's
 * `timeSincePreviousFrame`). The clock samples half a refresh ahead and
 * rounds down (ADR 0017, V5): the picture chosen now is on screen for the
 * coming refresh, and every frame change falls half a refresh away from a
 * vsync. Rounding to the nearest frame put every change exactly on a vsync,
 * so timestamp noise of a few microseconds decided whether a frame was held
 * for 1, 2 or 3 refreshes (a visible skip-then-hold stutter). With
 * `dtMs = 0` this is "the frame whose interval contains elapsedMs".
 *
 * A ping-pong plays frames 0…n−1 forwards and n…1 backwards, each for one
 * frame interval, so the turn at either end is not held twice.
 */
export function frameIndexAt(elapsedMs: number, durationMs: number, frameCount: number, loop: GuideLoop, dtMs: number = 0): number {
  'worklet';
  if (frameCount <= 1 || durationMs <= 0 || !(elapsedMs > 0)) return 0;
  const ahead = dtMs > 0 ? Math.min(dtMs, MAX_LOOKAHEAD_DT_MS) / 2 : 0;
  const e = elapsedMs + ahead;
  if (loop === 'pingpong') {
    const n = frameCount - 1;
    const p = (e % (2 * durationMs)) / durationMs;
    const i = p < 1 ? Math.floor(p * n) : Math.ceil((2 - p) * n);
    return Math.min(n, Math.max(0, i));
  }
  const phase = (e % durationMs) / durationMs;
  return Math.min(frameCount - 1, Math.max(0, Math.floor(phase * frameCount)));
}

export interface ClockStep {
  elapsedMs: number;
  /** True on the frame that completes the last allowed pass (the clock is back at 0). */
  finished: boolean;
}

/**
 * Advance by one display frame. `dtMs` is the time since the previous frame
 * (null on the first frame after starting or resuming, so a pause never
 * jumps). Very long gaps (a dropped second) advance at most 100 ms.
 */
export function advanceClock(elapsedMs: number, dtMs: number | null, durationMs: number, loop: GuideLoop, maxPasses: number = MAX_AUTOPLAY_PASSES): ClockStep {
  'worklet';
  const dt = dtMs === null || !(dtMs > 0) ? 0 : Math.min(dtMs, 100);
  const next = elapsedMs + dt;
  if (next >= passMs(durationMs, loop) * maxPasses) return { elapsedMs: 0, finished: true };
  return { elapsedMs: next, finished: false };
}
