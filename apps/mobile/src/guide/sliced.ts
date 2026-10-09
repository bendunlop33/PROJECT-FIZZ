/**
 * Runs a list of small tasks without blocking the JS thread for more than a
 * budget at a time (ADR 0013: baking a guide's frames on Hermes takes a few
 * hundred milliseconds in total). Pure scheduling with an injected clock and
 * scheduler, so it is unit-tested in Node.
 *
 * A task that throws stops the run: no further task runs, `onDone` is never
 * called and `onError` gets the error. Slices run from timers, where an
 * uncaught error would be fatal in a release build (review S1), so nothing
 * escapes from here.
 */
export interface SlicedOptions {
  /** Longest stretch of work before yielding, in ms. */
  budgetMs: number;
  /** Tasks run at once, before the first yield (e.g. the poster frame). */
  firstSync: number;
  now: () => number;
  /** Run `fn` later (setTimeout 0 in the app). */
  schedule: (fn: () => void) => () => void;
  onDone: () => void;
  /** A task threw; the run has stopped. */
  onError: (error: unknown) => void;
}

export interface SlicedRun {
  /** Stop: no further task, `onDone` or `onError` runs. */
  cancel: () => void;
}

export function runSliced(tasks: readonly (() => void)[], opts: SlicedOptions): SlicedRun {
  let next = 0;
  let stopped = false;
  let unschedule: (() => void) | null = null;
  /** Runs the next task; false once the run has stopped (cancelled or failed). */
  const runNext = (): boolean => {
    const task = tasks[next];
    next += 1;
    try {
      task?.();
      return true;
    } catch (e) {
      stopped = true;
      opts.onError(e);
      return false;
    }
  };
  const finish = () => {
    if (!stopped) opts.onDone();
  };
  const slice = () => {
    unschedule = null;
    if (stopped) return;
    const start = opts.now();
    do {
      if (!runNext()) return;
    } while (next < tasks.length && opts.now() - start < opts.budgetMs);
    if (next < tasks.length) unschedule = opts.schedule(slice);
    else finish();
  };
  while (next < Math.min(opts.firstSync, tasks.length)) {
    if (!runNext()) return { cancel: () => undefined };
  }
  if (next < tasks.length) unschedule = opts.schedule(slice);
  else finish();
  return {
    cancel: () => {
      stopped = true;
      unschedule?.();
      unschedule = null;
    },
  };
}
