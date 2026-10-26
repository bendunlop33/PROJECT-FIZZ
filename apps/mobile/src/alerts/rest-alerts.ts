import { blockSets, formatDuration, lastTimeOfSet, loadText, NBSP, repRangeText, toMs, valuesText, type LastComparableLookup } from '@fizz/domain';
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

/**
 * The rest-done body (§2.2; Ben, 26 Oct): the next set, its target and last
 * time, `Bench press · set 3 · target 100 kg × 6–8 · last 100 kg × 7`.
 * `target` and `last` stay distinct words (rule 6); `last` only when the
 * last comparable session has the same set (`lastTimeOfSet`), never a guess.
 */
export function nextSetLine(state: SessionAggregate, lastComparable?: LastComparableLookup): string {
  return nextSetParts(state, lastComparable).body;
}

function nextSetParts(state: SessionAggregate, lastComparable?: LastComparableLookup): { body: string; last: string | null } {
  const set = state.sets.find((s) => s.id === state.session.activeSetId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return { body: 'Next set', last: null };
  const eq = ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
  const perSide = ex.laterality === 'unilateral' ? `${NBSP}per side` : '';
  // Numbered across the whole block (warm-ups and every gym part), as the Lock Screen and the in-app header.
  const number = blockSets(state, ex.id).indexOf(set) + 1;
  const parts = [number > 0 ? `${ex.exerciseName} · set ${String(number)}` : ex.exerciseName];
  const p = set.planned;
  if (p.load !== null && p.reps !== null) parts.push(`target ${loadText(p.load, ex.loadConvention, eq)}${NBSP}×${NBSP}${repRangeText(p.reps)}${perSide}`);
  else if (p.reps !== null) {
    const noLoad = ex.loadConvention === 'bodyweight' ? '' : ' (no load target)';
    parts.push(`target ${repRangeText(p.reps)}${NBSP}reps${perSide}${noLoad}`);
  } else if (set.draft) {
    // No target (an exercise added to an empty workout): the saved draft, if any, as Ben's own values (no `target`).
    parts.push(valuesText(set.draft, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }));
  }
  const last = lastComparable === undefined ? null : lastTimeOfSet(state, set.id, lastComparable(ex.id));
  if (last !== null) parts.push(`last ${last.text}`);
  return { body: parts.join(' · '), last: last?.text ?? null };
}

/**
 * The alert that should be pending now, or null (nothing running, paused,
 * finished, deadline passed). A running work timer on a timed set (§2.7)
 * gets the same single alert at its 0 (`Time`), so a phone that locked
 * during a plank still says so (review gaps S3). Starting a work timer ends
 * any rest, so the two never compete; the identifier is the same, so one
 * replaces the other.
 */
export function planRestAlert(state: SessionAggregate | null, nowMs: number, lastComparable?: LastComparableLookup): PlannedRestAlert | null {
  if (state === null || state.session.status !== 'active' || state.session.pause !== null) return null;
  const wi = state.workInterval;
  if (wi?.status === 'running') {
    const fireAtMs = toMs(wi.deadlineUtc);
    if (fireAtMs <= nowMs) return null;
    const set = state.sets.find((x) => x.id === wi.setId);
    const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
    // A cardio timer counts up with no end to announce (19 Oct): no alert.
    if (ex?.measurement === 'cardio') return null;
    return {
      identifier: restAlertIdentifier(state.session.id),
      key: `work:${wi.setId}:${wi.deadlineUtc}`,
      fireAtMs,
      title: 'Time',
      body: ex ? `${ex.exerciseName} · ${formatDuration(wi.durationS)}` : formatDuration(wi.durationS),
    };
  }
  const t = state.restTimer;
  if (t?.status !== 'running') return null;
  const fireAtMs = toMs(t.deadlineUtc);
  if (fireAtMs <= nowMs) return null;
  const { body, last } = nextSetParts(state, lastComparable);
  return {
    identifier: restAlertIdentifier(state.session.id),
    // The next set's text is part of the key so a correction or Undo that changes it reschedules,
    // and so does last time arriving after the history read (Ben, 26 Oct).
    key: `${t.id}:${String(t.version)}:${state.session.activeSetId ?? ''}:${String(state.session.version)}${last === null ? '' : `:last ${last}`}`,
    fireAtMs,
    title: 'Rest done',
    body,
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
   * scheduled (Delete my data, review r2 S1). `keep`: one identifier left
   * alone (`Finish deleting` during a workout, review r3 N2).
   */
  cancelAllWorkoutAlerts(keep?: string): Promise<void>;
}

/**
 * Keeps the phone's pending alert in step with the workout. Safe to call after
 * every command, on launch and on return to the foreground. A failing
 * notifier never throws into logging (rule 1): the error is kept for display.
 */
export function createRestAlertController(notifier: NotifierPort, layers: { liveActivity?: LiveActivityLayer; spokenCues?: SpokenCueLayer; lastTime?: LastTimeLayer } = {}) {
  let current: ScheduledAlert | null = null;
  let lastError: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  /**
   * The newest workout state planned from. Reconciles can arrive out of order
   * (a coach turn's re-read, or the launch/foreground read, landing after a
   * Log); an older version of the same workout is ignored so it can't cancel
   * the rest that is running (review ben-bugs S2). A null (restore, no
   * workout) clears it.
   */
  let applied: { sessionId: string; version: number } | null = null;
  /**
   * Issue order of reconciles, for reads made outside any write (the
   * launch/foreground `active()` read, review ben-bugs r2 N1). A read takes a
   * ticket when it *starts*; if any reconcile was issued after that, the
   * read's result is no newer than what is already queued and is dropped. The
   * version guard can't do this for a late null or another workout's state.
   */
  let issued = 0;
  let newest = 0;
  /** The state last planned from (after the version guard), for a re-plan when last time arrives. */
  let latest: SessionAggregate | null = null;
  function reconcile(state: SessionAggregate | null, nowMs: number, readTicket?: number): Promise<void> {
    if (readTicket !== undefined && newest > readTicket) return chain.then(() => undefined);
    newest = readTicket ?? ++issued;
    chain = chain.then(async () => {
      if (state !== null && applied !== null && applied.sessionId === state.session.id && state.session.version < applied.version) return;
      applied = state === null ? null : { sessionId: state.session.id, version: state.session.version };
      latest = state;
      // In-app spoken cues follow the same committed state, behind the same version guard; never throws into logging.
      try {
        layers.spokenCues?.reconcile(state, nowMs);
      } catch {
        // A cue problem never affects the alert.
      }
      const planned = planRestAlert(state, nowMs, state === null ? undefined : layers.lastTime?.lookup(state));
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
    // The Lock Screen Live Activity follows the same committed state; it never blocks or fails the notification.
    const activity = layers.liveActivity?.reconcile(state, nowMs).catch(() => undefined) ?? Promise.resolve();
    readAhead(state);
    return Promise.all([chain, activity]).then(() => undefined);
  }
  /**
   * Last time for the next set (Ben, 26 Oct) is read from history once per
   * workout row, after the first reconcile that needs it; when it arrives the
   * newest state of that workout is reconciled again, so the notification
   * body and the Live Activity gain `last …`.
   */
  function readAhead(state: SessionAggregate | null): void {
    const lt = layers.lastTime;
    if (lt === undefined || state === null) return;
    lt.ensure(state)
      .then(async (fresh) => {
        if (!fresh) return;
        await chain;
        const now = latest;
        if (now?.session.id !== state.session.id) return;
        await reconcile(now, lt.now());
      })
      .catch(() => undefined);
  }
  return {
    /** After a commit, with the state it committed. */
    reconcile(state: SessionAggregate | null, nowMs: number): Promise<void> {
      return reconcile(state, nowMs);
    },
    /**
     * Launch and return to the foreground: read the workout in progress, then
     * reconcile, unless a commit's reconcile was issued while the read ran
     * (that state is at least as new). Never throws.
     */
    reconcileFromRead(read: () => Promise<SessionAggregate | null>, now: () => number): Promise<void> {
      const ticket = ++issued;
      return read()
        .then((state) => reconcile(state, now(), ticket))
        .catch(() => undefined);
    },
    /**
     * Delete my data: every workout alert goes, including one scheduled
     * before a relaunch that this run knows nothing about. Unlike
     * `reconcile`, a failure is thrown so the caller can say so. `keep`:
     * the alert of the workout in progress stays (review r3 N2).
     */
    cancelAll(keep?: string): Promise<void> {
      const run = chain.then(async () => {
        try {
          await notifier.cancelAllWorkoutAlerts(keep);
          if (current?.identifier !== keep) current = null;
          lastError = null;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          throw e;
        }
      });
      chain = run.catch(() => undefined);
      const activity = layers.liveActivity?.endAll(keep?.startsWith(REST_ALERT_PREFIX) ? keep.slice(REST_ALERT_PREFIX.length) : undefined).catch(() => undefined) ?? Promise.resolve();
      return Promise.all([run, activity]).then(() => undefined);
    },
    get scheduled(): ScheduledAlert | null {
      return current;
    },
    get lastError(): string | null {
      return lastError;
    },
  };
}

/** In-app spoken cues (`voice/cue-controller.ts`): schedules or drops its cues from each committed state. */
export interface SpokenCueLayer {
  reconcile(state: SessionAggregate | null, nowMs: number): void;
}

/** Last comparable sets per workout row, for `last …` (`live-activity/last-time-cache.ts`). */
export interface LastTimeLayer {
  /** What has been read so far for this workout (sync). */
  lookup(state: SessionAggregate): LastComparableLookup;
  /** Read ahead for the active set's row; true when something new arrived. Never rejects. */
  ensure(state: SessionAggregate): Promise<boolean>;
  now(): number;
}

/** The Live Activity layer as the alert controller drives it (`live-activity/controller.ts`). */
export interface LiveActivityLayer {
  reconcile(state: SessionAggregate | null, nowMs: number): Promise<void>;
  endAll(keepSessionId?: string): Promise<void>;
}

export type RestAlertController = ReturnType<typeof createRestAlertController>;
