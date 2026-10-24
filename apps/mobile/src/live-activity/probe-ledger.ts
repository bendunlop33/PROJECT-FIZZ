/**
 * The capability probe's own Live Activities, started this run. A new probe
 * run ends only these, never the workout's activity: ending that would look
 * like Ben swiped it away, and the workout would show no Lock Screen
 * countdown until relaunch (review ben-bugs N2). A probe activity left by an
 * earlier run is handled by the workout controller's first reconcile (it is
 * adopted or ended) and by its own stale date.
 */
export function createProbeActivityLedger() {
  const ids = new Set<string>();
  return {
    /** Of the running activities, the ones a new probe run should end. */
    toEnd(runningIds: readonly string[]): string[] {
      return runningIds.filter((id) => ids.has(id));
    },
    started(id: string): void {
      ids.add(id);
    },
    ended(id: string): void {
      ids.delete(id);
    },
  };
}

export type ProbeActivityLedger = ReturnType<typeof createProbeActivityLedger>;
