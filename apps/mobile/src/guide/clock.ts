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

/**
 * Baked frame to show after `elapsedMs` of playback. `frameCount` is the
 * length of `playbackTimes`: frame i is t = i/n with n = frameCount for a
 * cycle and n = frameCount − 1 for a ping-pong. Picks the nearest frame.
 */
export function frameIndexAt(elapsedMs: number, durationMs: number, frameCount: number, loop: GuideLoop): number {
  'worklet';
  if (frameCount <= 1 || durationMs <= 0 || !(elapsedMs > 0)) return 0;
  if (loop === 'pingpong') {
    const n = frameCount - 1;
    const p = (elapsedMs % (2 * durationMs)) / durationMs;
    const t = p <= 1 ? p : 2 - p;
    return Math.min(n, Math.max(0, Math.round(t * n)));
  }
  const phase = (elapsedMs % durationMs) / durationMs;
  return Math.round(phase * frameCount) % frameCount;
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
