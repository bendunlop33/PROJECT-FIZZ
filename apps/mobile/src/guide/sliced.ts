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
  /** After each slice that leaves tasks still to run: how many tasks have run so far. */
  onProgress?: (done: number) => void;
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
      try {
        opts.onError(e);
      } catch {
        // onError itself threw: nothing safe is left to tell.
      }
      return false;
    }
  };
  /** `onDone` and `onProgress` run from timers too: a throw there stops the run and goes to `onError`, never escapes. */
  const callback = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      stopped = true;
      unschedule?.();
      unschedule = null;
      try {
        opts.onError(e);
      } catch {
        // onError itself threw: nothing safe is left to tell.
      }
    }
  };
  const finish = () => {
    if (!stopped) callback(opts.onDone);
  };
  const slice = () => {
    unschedule = null;
    if (stopped) return;
    const start = opts.now();
    do {
      if (!runNext()) return;
    } while (next < tasks.length && opts.now() - start < opts.budgetMs);
    if (next < tasks.length) {
      unschedule = opts.schedule(slice);
      const progress = opts.onProgress;
      if (progress) {
        callback(() => {
          progress(next);
        });
      }
    } else finish();
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

/** Safety margin on the bake-rate projection: playback starts only if the bake would keep ahead with a quarter of the time to spare. */
export const PREFIX_MARGIN = 0.75;

/** While a playable animation is still baking, the player gets its longer prefix at most this often (each hand-over re-renders). */
export const PREFIX_PUBLISH_MS = 200;

/** Allowance for a hand-over to reach the UI thread: a React render plus a new derived-value mapper (not measured on device yet). */
export const PREFIX_RENDER_MS = 100;

export interface PrefixTiming {
  /** Frames the finished bake will have. */
  total: number;
  /** Playback time between frames. */
  frameIntervalMs: number;
  /** Slice budget of the bake (`runSliced`'s `budgetMs`). */
  budgetMs: number;
  publishMs?: number;
  renderMs?: number;
  margin?: number;
}

/**
 * Worst case from a frame being baked to the player having it (guides fix
 * review B1): the next hand-over is up to `publishMs` away, `onProgress` runs
 * only at the end of a slice (up to the budget plus one task overrun), and the
 * hand-over then needs a render.
 */
export function prefixLatencyMs(p: { msPerFrame: number; budgetMs: number; publishMs?: number; renderMs?: number }): number {
  return (p.publishMs ?? PREFIX_PUBLISH_MS) + p.budgetMs + p.msPerFrame + (p.renderMs ?? PREFIX_RENDER_MS);
}

/**
 * Whether playback can start on the frames baked so far (guides review B2,
 * fix review B1): true when, at the bake's measured rate, every later frame
 * reaches the player before playback shows it. Frame j (≥ `ready`) reaches the
 * player by (j − ready + 1) × msPerFrame + latency and is shown at
 * j × frameIntervalMs after playback starts (never before now); the condition
 * is linear in j, so checking the first and last frame covers all. A frame is
 * usable only once handed over, not when baked, hence the latency term.
 */
export function canPlayPrefix(p: PrefixTiming & { ready: number; msPerFrame: number }): boolean {
  const { ready, total, msPerFrame, frameIntervalMs } = p;
  const margin = p.margin ?? PREFIX_MARGIN;
  if (total <= 0 || ready >= total) return ready > 0 || total <= 0;
  if (ready < 1 || !(msPerFrame >= 0) || !(frameIntervalMs > 0)) return false;
  const latency = prefixLatencyMs(p);
  const first = msPerFrame + latency <= margin * ready * frameIntervalMs;
  const last = (total - ready) * msPerFrame + latency <= margin * (total - 1) * frameIntervalMs;
  return first && last;
}

export interface PrefixPublisher {
  /**
   * Called after a bake slice: whether to hand the player the `ready` frames
   * now. Until playback starts this is `canPlayPrefix` (re-checked at every
   * slice, so the start isn't delayed by the throttle); once it has started,
   * every longer prefix is handed over at the throttle, never re-checked, so
   * baked frames are never withheld.
   */
  offer: (now: number, ready: number) => boolean;
  readonly started: boolean;
}

export function createPrefixPublisher(timing: PrefixTiming & { startedAt: number }): PrefixPublisher {
  const publishMs = timing.publishMs ?? PREFIX_PUBLISH_MS;
  let started = false;
  let published = -Infinity;
  let handed = 0;
  return {
    offer: (now, ready) => {
      if (ready <= handed) return false;
      if (started) {
        if (now - published < publishMs) return false;
      } else {
        const msPerFrame = (now - timing.startedAt) / Math.max(1, ready);
        if (!canPlayPrefix({ ...timing, ready, msPerFrame })) return false;
        started = true;
      }
      published = now;
      handed = ready;
      return true;
    },
    get started() {
      return started;
    },
  };
}
