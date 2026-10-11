/**
 * Cooperative time slicing for long backup work (backup review B1).
 *
 * Serialising, hashing and comparing a multi-year history is seconds of CPU
 * on Hermes (no JIT). Run in one go it freezes the JS thread: Summary, Undo
 * and taps stop responding. Long loops call a `Slicer` often; it returns at
 * once until the current slice has used its budget, then waits one
 * macrotask so taps, timers and renders run in between.
 */
export type Slicer = () => Promise<void>;

/**
 * A monotonic clock for slicing only (never stored, never domain time).
 * Hermes and Node both provide `performance.now()`.
 */
export function monotonicMs(): number {
  return (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;
}

/** Never pauses: for small inputs and callers that are already off the hot path. */
export const noYield: Slicer = () => Promise.resolve();

const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Pause after `budgetMs` of uninterrupted work. 8 ms keeps a 60 Hz frame
 * mostly free; the pause itself costs well under a millisecond on the phone.
 */
export function timeSlicer(budgetMs = 8, pause: () => Promise<void> = macrotask, clock: () => number = monotonicMs): Slicer {
  let sliceStart = clock();
  return async () => {
    if (clock() - sliceStart < budgetMs) return;
    await pause();
    sliceStart = clock();
  };
}
