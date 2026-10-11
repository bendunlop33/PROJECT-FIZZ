import { loadText, NBSP, repRangeText, toMs, valuesText } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

/**
 * Rest-end alerts (lock-screen-and-alerts.md §2.2, §4.1; rest-state.md §4.7).
 * Pure: from committed state alone, decide which single local notification
 * should be pending, keyed by (timer ID, timer version). The phone binding
 * (`notifier.ts`) then cancels or replaces by identifier, so Skip, an early
 * Log, Undo, Pause, Finish, Discard and a force-close all reconcile to one
 * alert at the right time, or none. No Time Sensitive level (free Apple ID).
 */

export interface PlannedRestAlert {
  /** One per workout: scheduling again with it replaces the pending alert. */
  identifier: string;
  /** `timerId:version`: a new key means the deadline or the next set changed. */
  key: string;
  fireAtMs: number;
  title: string;
  body: string;
}

/** Every workout alert's identifier starts with this; GymSmarter schedules nothing else under it. */
export const REST_ALERT_PREFIX = 'fizz.rest.';
export const restAlertIdentifier = (sessionId: string) => `${REST_ALERT_PREFIX}${sessionId}`;

/** `Next: Bench press · 100 kg × 6–8 target` and its variants (§2.2). */
export function nextSetLine(state: SessionAggregate): string {
  const set = state.sets.find((s) => s.id === state.session.activeSetId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return 'Next set';
  const eq = ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
  const perSide = ex.laterality === 'unilateral' ? `${NBSP}per side` : '';
  const p = set.planned;
  if (p.load !== null && p.reps !== null) return `Next: ${ex.exerciseName} · ${loadText(p.load, ex.loadConvention, eq)}${NBSP}×${NBSP}${repRangeText(p.reps)}${perSide} target`;
  if (p.reps !== null) {
    const noLoad = ex.loadConvention === 'bodyweight' ? '' : ' (no load target)';
    return `Next: ${ex.exerciseName} · ${repRangeText(p.reps)}${NBSP}reps${perSide}${noLoad}`;
  }
  // No target (an exercise added to an empty workout): show the saved draft, if any, as a draft.
  if (set.draft) return `Next: ${ex.exerciseName} · ${valuesText(set.draft, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq })}`;
  return `Next: ${ex.exerciseName}`;
}

/** The alert that should be pending now, or null (no running rest, paused, finished, deadline passed). */
export function planRestAlert(state: SessionAggregate | null, nowMs: number): PlannedRestAlert | null {
  if (state === null || state.session.status !== 'active' || state.session.pause !== null) return null;
  const t = state.restTimer;
  if (t?.status !== 'running') return null;
  const fireAtMs = toMs(t.deadlineUtc);
  if (fireAtMs <= nowMs) return null;
  return {
    identifier: restAlertIdentifier(state.session.id),
    // The next set's text is part of the key so a correction or Undo that changes it reschedules.
    key: `${t.id}:${String(t.version)}:${state.session.activeSetId ?? ''}:${String(state.session.version)}`,
    fireAtMs,
    title: 'Rest done',
    body: nextSetLine(state),
  };
}

export type AlertAction = { kind: 'cancel'; identifier: string } | { kind: 'schedule'; alert: PlannedRestAlert };

export interface ScheduledAlert {
  identifier: string;
  key: string;
}

/** What to do to get from what is scheduled to what should be. Never two alerts for one rest. */
export function decideAlertActions(current: ScheduledAlert | null, planned: PlannedRestAlert | null): AlertAction[] {
  if (planned === null) return current === null ? [] : [{ kind: 'cancel', identifier: current.identifier }];
  if (current !== null && current.identifier === planned.identifier && current.key === planned.key) return [];
  const actions: AlertAction[] = [];
  if (current !== null && current.identifier !== planned.identifier) actions.push({ kind: 'cancel', identifier: current.identifier });
  actions.push({ kind: 'schedule', alert: planned });
  return actions;
}

export interface NotifierPort {
  schedule(alert: PlannedRestAlert): Promise<void>;
  cancel(identifier: string): Promise<void>;
  /**
   * Cancel every scheduled workout alert (any `fizz.rest.` identifier, known
   * to this run or not) and clear delivered ones. Throws if one is still
   * scheduled (Delete my data, review r2 S1).
   */
  cancelAllWorkoutAlerts(): Promise<void>;
}

/**
 * Keeps the phone's pending alert in step with the workout. Safe to call after
 * every command, on launch and on return to the foreground. A failing
 * notifier never throws into logging (rule 1): the error is kept for display.
 */
export function createRestAlertController(notifier: NotifierPort) {
  let current: ScheduledAlert | null = null;
  let lastError: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  return {
    reconcile(state: SessionAggregate | null, nowMs: number): Promise<void> {
      chain = chain.then(async () => {
        const planned = planRestAlert(state, nowMs);
        // After a relaunch nothing is known: cancel by identifier first so a stale alert can't survive.
        const known = current ?? (state ? { identifier: restAlertIdentifier(state.session.id), key: '' } : null);
        for (const a of decideAlertActions(known, planned)) {
          try {
            if (a.kind === 'cancel') {
              await notifier.cancel(a.identifier);
              current = null;
            } else {
              await notifier.schedule(a.alert);
              current = { identifier: a.alert.identifier, key: a.alert.key };
            }
            lastError = null;
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        if (planned === null) current = null;
      });
      return chain;
    },
    /**
     * Delete my data: every workout alert goes, including one scheduled
     * before a relaunch that this run knows nothing about. Unlike
     * `reconcile`, a failure is thrown so the caller can say so.
     */
    cancelAll(): Promise<void> {
      const run = chain.then(async () => {
        try {
          await notifier.cancelAllWorkoutAlerts();
          current = null;
          lastError = null;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          throw e;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
    get scheduled(): ScheduledAlert | null {
      return current;
    },
    get lastError(): string | null {
      return lastError;
    },
  };
}

export type RestAlertController = ReturnType<typeof createRestAlertController>;
