import { TIMING } from '../theme/tokens';

/**
 * In-app rest-end cue (rest-state.md §4.7): once per timer version, only at
 * the deadline while Fizz is on screen, and never late (a cue more than
 * `timing.lateCueDrop` late is dropped: the notification already covered it).
 * Pure, so it is tested on Linux.
 */
export function shouldCueRestEnd(timerKey: string, deadlineMs: number, nowMs: number, played: ReadonlySet<string>): boolean {
  if (played.has(timerKey)) return false;
  const late = nowMs - deadlineMs;
  return late >= 0 && late <= TIMING.lateCueDrop;
}

/** The work timer's countdown (active-workout §2.7): `0:38`, rounded up so it reads `0:01` until the end, never below `0:00`. */
export function workTimerText(remainingMs: number | null): string {
  const s = Math.max(0, Math.ceil((remainingMs ?? 0) / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}
