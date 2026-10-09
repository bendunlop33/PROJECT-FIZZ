/**
 * Run a navigation once a sheet has finished closing (review S8: presenting
 * or replacing a native-stack modal while an RN pageSheet `Modal` is still
 * dismissing can leave a stuck or blank presentation). `dismissed()` is wired
 * to the Modal's `onDismiss`; a fallback timer covers a dismissal that never
 * reports (e.g. the sheet wasn't on screen). Runs at most once per `arm`.
 */
export function createAfterDismiss(fallbackMs = 700, schedule: (fn: () => void, ms: number) => unknown = setTimeout) {
  let pending: (() => void) | null = null;
  const fire = () => {
    const fn = pending;
    pending = null;
    fn?.();
  };
  return {
    arm(fn: () => void) {
      pending = fn;
      schedule(fire, fallbackMs);
    },
    dismissed: fire,
  };
}
