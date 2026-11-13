/**
 * Loads an optional module once, turning a throw into a result (review S1).
 * The guide player pulls in Skia, whose module evaluation can throw if its
 * native side isn't installed; that must cost the guide, never the app.
 * Pure: the app passes a `require` thunk, tests pass any function.
 */
export type GuardedLoad<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * `load` runs on the first call only. A failure is remembered rather than
 * retried: Metro rethrows the same error for a module whose evaluation failed.
 */
export function createGuardedLoader<T>(load: () => T): () => GuardedLoad<T> {
  let result: GuardedLoad<T> | undefined;
  return () => {
    if (result === undefined) {
      try {
        result = { ok: true, value: load() };
      } catch (error) {
        result = { ok: false, error };
      }
    }
    return result;
  };
}
