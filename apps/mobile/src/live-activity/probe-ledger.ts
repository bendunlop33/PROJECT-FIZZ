/**
 * The capability probe's own Live Activities, started this run. A new probe
 * run ends only these, never the workout's activity: ending that would look
 * like Ben swiped it away, and the workout would show no Lock Screen
 * countdown until relaunch (review ben-bugs N2). The workout controller's
 * sweep leaves the ones listed here alone (`ids`). A probe activity left by an
 * earlier run is ended by the workout controller's first reconcile (launch).
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
    /** The probe's countdowns still running this run. */
    ids(): string[] {
      return [...ids];
    },
  };
}

export type ProbeActivityLedger = ReturnType<typeof createProbeActivityLedger>;

/** The one ledger of this app run, shared by the probe (`runners.ts`) and the workout controller (`Root.tsx`). */
export const probeActivityLedger: ProbeActivityLedger = createProbeActivityLedger();
