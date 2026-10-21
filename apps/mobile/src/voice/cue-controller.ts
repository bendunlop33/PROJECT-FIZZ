import { cueText, spokenSetOf, toMs, type ComparableSet, type CueDetail, type CueEvent } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { TIMING } from '../theme/tokens';

/**
 * Spoken workout cues while GymSmarter is open (Ben, 19 Oct 2026): "10
 * seconds" before a rest or timed set ends, then "Rest done" (+ the next
 * set, at `timer_and_set`) or "Time". Driven by the persisted deadlines the
 * rest alerts use: the alert controller hands every committed state here
 * (after its version guard), so a Log, Skip, ±30 s, Undo, Pause or a relaunch
 * reschedules or drops the cues. Each cue speaks at most once, only at its
 * moment (never more than `timing.lateCueDrop` late, so nothing is spoken
 * for a deadline that passed while the app was closed), only while the app is
 * active, and only with cues on. In the background the notification is the
 * alert, as before. Pure: ports for the speaker, clock and app state.
 */

/** Rests and timed sets shorter than this get no "10 seconds" warning (it would land at the start). */
export const WARNING_LEAD_S = 10;
export const WARNING_MIN_DURATION_S = 20;

/** A "10 seconds" warning later than this would say the wrong time: dropped. */
export const WARNING_LATE_DROP_MS = 1500;

export type CueKind = 'warning' | 'rest_end' | 'work_end';

export interface PlannedCue {
  /** `rest:<timerId>:<deadline>:end`, `work:<setId>:<deadline>:warn`… Played keys never play again. */
  key: string;
  kind: CueKind;
  fireAtMs: number;
}

/**
 * The cues the committed state calls for. A rest that just ran out
 * (`expired`) and a timed set that reached its end (`completed` at or after
 * the deadline) keep their end cue, so the screen's tick saving the expiry a
 * moment before the cue's timer fires never cancels it.
 */
export function planCues(state: SessionAggregate | null): PlannedCue[] {
  if (state === null || state.session.status !== 'active' || state.session.pause !== null) return [];
  const out: PlannedCue[] = [];
  const wi = state.workInterval;
  if (wi && (wi.status === 'running' || (wi.status === 'completed' && wi.endedAtUtc !== null && toMs(wi.endedAtUtc) >= toMs(wi.deadlineUtc)))) {
    const deadline = toMs(wi.deadlineUtc);
    const base = `work:${wi.setId}:${wi.deadlineUtc}`;
    if (wi.status === 'running' && wi.durationS >= WARNING_MIN_DURATION_S) out.push({ key: `${base}:warn`, kind: 'warning', fireAtMs: deadline - WARNING_LEAD_S * 1000 });
    out.push({ key: `${base}:end`, kind: 'work_end', fireAtMs: deadline });
  }
  const t = state.restTimer;
  // A rest an undo put back already finished has no end to announce (workout-table-v3 §3).
  if (t && (t.status === 'running' || (t.status === 'expired' && t.restoredFinished !== true))) {
    const deadline = toMs(t.deadlineUtc);
    // Keyed by the deadline, not the version: the tick that saves the expiry bumps the version.
    const base = `rest:${t.id}:${t.deadlineUtc}`;
    if (t.status === 'running' && t.durationS >= WARNING_MIN_DURATION_S) out.push({ key: `${base}:warn`, kind: 'warning', fireAtMs: deadline - WARNING_LEAD_S * 1000 });
    out.push({ key: `${base}:end`, kind: 'rest_end', fireAtMs: deadline });
  }
  return out;
}

/**
 * The words for a cue at fire time, from the newest state (a corrected next
 * set, or a draft saved during the rest, is read as it is now). The set's
 * values are the card's (review B1); `lastComparable` is the history the
 * card fills open fields from.
 */
export function cueWords(kind: CueKind, state: SessionAggregate | null, detail: CueDetail, lastComparable: readonly ComparableSet[] = []): string {
  const event: CueEvent =
    kind === 'warning' ? { kind: 'warning', seconds: WARNING_LEAD_S } : kind === 'work_end' ? { kind: 'work_end' } : { kind: 'rest_end', next: state === null ? null : spokenSetOf(state, state.session.activeSetId, lastComparable) };
  return cueText(event, detail);
}

/** How late a cue may still speak: the rest end up to `timing.lateCueDrop`, the warning only just. */
export function lateLimitMs(kind: CueKind): number {
  return kind === 'warning' ? WARNING_LATE_DROP_MS : TIMING.lateCueDrop;
}

/** Speak now? Not before its moment (a timer firing a hair early is allowed), not too late, never twice. */
export function cueDue(cue: PlannedCue, nowMs: number, played: ReadonlySet<string>): boolean {
  if (played.has(cue.key)) return false;
  const late = nowMs - cue.fireAtMs;
  return late >= -50 && late <= lateLimitMs(cue.kind);
}

export interface CueSettings {
  cuesOn: boolean;
  cueDetail: CueDetail;
}

export interface CueSpeaker {
  /** False when the audio-coach module isn't in this build: nothing is spoken, nothing pretends to be. */
  available(): boolean;
  speak(text: string, purpose: 'cue' | 'reply'): Promise<unknown>;
}

export interface CueClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CuePorts {
  speaker: CueSpeaker;
  clock: CueClock;
  /** AppState is `active`. */
  appActive(): boolean;
  settings(): CueSettings;
  /** The card's history for an exercise row (the last comparable session's sets); read ahead, while the rest runs. */
  history?: (state: SessionAggregate, sessionExerciseId: string) => Promise<readonly ComparableSet[]>;
}

export function createSpokenCueController(ports: CuePorts) {
  const timers = new Map<string, { cue: PlannedCue; handle: unknown }>();
  const played = new Set<string>();
  let latest: SessionAggregate | null = null;
  let spoken = 0;
  let historyPort = ports.history ?? null;
  /** `<sessionId>:<sessionExerciseId>` → the last comparable sets, read once per workout row. */
  const history = new Map<string, readonly ComparableSet[]>();
  const historyKey = (state: SessionAggregate, exId: string) => `${state.session.id}:${exId}`;
  function activeRow(state: SessionAggregate | null): string | null {
    const id = state?.session.activeSetId ?? null;
    return id === null ? null : (state?.sets.find((x) => x.id === id)?.sessionExerciseId ?? null);
  }
  function readAhead(state: SessionAggregate | null): void {
    const exId = activeRow(state);
    if (state === null || exId === null || historyPort === null) return;
    const k = historyKey(state, exId);
    if (history.has(k)) return;
    history.set(k, []);
    void historyPort(state, exId)
      .then((sets) => {
        history.set(k, sets);
      })
      .catch(() => undefined);
  }

  function fire(cue: PlannedCue): void {
    timers.delete(cue.key);
    const now = ports.clock.now();
    if (!cueDue(cue, now, played)) return;
    played.add(cue.key);
    if (!ports.appActive() || !ports.speaker.available()) return;
    const s = ports.settings();
    if (!s.cuesOn) return;
    spoken += 1;
    // A failing speaker never throws into the workout (rule 1).
    const exId = activeRow(latest);
    const past = latest !== null && exId !== null ? (history.get(historyKey(latest, exId)) ?? []) : [];
    void ports.speaker.speak(cueWords(cue.kind, latest, s.cueDetail, past), 'cue').catch(() => undefined);
  }

  return {
    /** Every committed state (the alert controller calls this after its version guard), launch and foreground reads. */
    reconcile(state: SessionAggregate | null): void {
      // The phone's clock now, not the commit's: the alert chain may run this a moment later.
      const nowMs = ports.clock.now();
      latest = state;
      const planned = planCues(state);
      if (planned.some((c) => c.kind === 'rest_end')) readAhead(state);
      const keys = new Set(planned.map((c) => c.key));
      for (const [key, t] of timers) {
        if (!keys.has(key)) {
          ports.clock.clearTimeout(t.handle);
          timers.delete(key);
        }
      }
      for (const cue of planned) {
        if (played.has(cue.key) || timers.has(cue.key)) continue;
        // Long past (a deadline that went by while the app was closed): never scheduled at all.
        if (nowMs - cue.fireAtMs > lateLimitMs(cue.kind)) {
          played.add(cue.key);
          continue;
        }
        const handle = ports.clock.setTimeout(() => {
          fire(cue);
        }, Math.max(0, cue.fireAtMs - nowMs));
        timers.set(cue.key, { cue, handle });
      }
    },
    /** The history read for the spoken set detail (Root sets it once services are open). */
    setHistoryReader(port: CuePorts['history'] | null): void {
      historyPort = port ?? null;
      history.clear();
    },
    /** Cues waiting to speak (for tests and diagnostics). */
    get pending(): PlannedCue[] {
      return [...timers.values()].map((t) => t.cue);
    },
    /** How many cues were handed to the speaker this run. */
    get spokenCount(): number {
      return spoken;
    },
  };
}

export type SpokenCueController = ReturnType<typeof createSpokenCueController>;
