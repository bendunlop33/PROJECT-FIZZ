/**
 * Runs a list of small tasks without blocking the JS thread for more than a
 * budget at a time (ADR 0013: baking a guide's frames on Hermes takes a few
 * hundred milliseconds in total). Pure scheduling with an injected clock and
 * scheduler, so it is unit-tested in Node.
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
}

export interface SlicedRun {
  /** Stop: no further task or `onDone` runs. */
  cancel: () => void;
}

export function runSliced(tasks: readonly (() => void)[], opts: SlicedOptions): SlicedRun {
  let next = 0;
  let cancelled = false;
  let unschedule: (() => void) | null = null;
  const finish = () => {
    if (!cancelled) opts.onDone();
  };
  const slice = () => {
    unschedule = null;
    if (cancelled) return;
    const start = opts.now();
    do {
      const task = tasks[next];
      next += 1;
      task?.();
    } while (next < tasks.length && opts.now() - start < opts.budgetMs);
    if (next < tasks.length) unschedule = opts.schedule(slice);
    else finish();
  };
  while (next < Math.min(opts.firstSync, tasks.length)) {
    const task = tasks[next];
    next += 1;
    task?.();
  }
  if (next < tasks.length) unschedule = opts.schedule(slice);
  else finish();
  return {
    cancel: () => {
      cancelled = true;
      unschedule?.();
      unschedule = null;
    },
  };
}
