import type { ScheduledCueLogEntry } from '../../modules/audio-coach';
import type { ResultUpdate } from './model';

/**
 * Background spoken cues (pure verdict; Ben, 1 Nov; ADR 0040). The probe runs
 * the product path: it hands audio-coach two cues, like a rest's "15 seconds"
 * and "Rest over", which the module schedules natively and speaks while the
 * app is in another app or locked, keeping the app running in between with a
 * silent, mixable player. Needs UIBackgroundModes audio (on by default; off
 * with FIZZ_BACKGROUND_AUDIO=0).
 *
 * The native log says when each cue fired and in which app state. A cue that
 * fired after its drop time means iOS suspended the app: a failure, not a pass.
 */

/** The first cue ("15 seconds …") this long after Run; the second ("Rest over") 15 s later. */
export const LOCKED_CUE_DELAY_S = 30;
export const LOCKED_CUE_GAP_S = 15;
/** Firing later than this means the app was suspended, not merely busy. */
export const LOCKED_CUE_MAX_LATENESS_MS = 5000;

export type LockedCueOutcome = 'spoken' | 'skippedActive' | 'late' | 'speakFailed';

export interface LockedCueFire {
  outcome: LockedCueOutcome;
  appState: string;
  latenessMs: number;
  holdRunning: boolean;
  speakOutcome: string | null;
  error: string | null;
}

/** One native log entry, checked field by field; null when it isn't one. */
export function parseCueLogEntry(raw: ScheduledCueLogEntry): (LockedCueFire & { id: string }) | null {
  const { id, outcome, fireAtMs, firedAtMs } = raw;
  if (typeof id !== 'string' || typeof fireAtMs !== 'number' || typeof firedAtMs !== 'number') return null;
  if (outcome !== 'spoken' && outcome !== 'skippedActive' && outcome !== 'late' && outcome !== 'speakFailed') return null;
  return {
    id,
    outcome,
    appState: typeof raw.appState === 'string' ? raw.appState : 'unknown',
    latenessMs: Math.max(0, firedAtMs - fireAtMs),
    holdRunning: raw.holdRunning === true,
    speakOutcome: typeof raw.speakOutcome === 'string' ? raw.speakOutcome : null,
    error: typeof raw.error === 'string' ? raw.error : null,
  };
}

export interface LockedCueObservation {
  /** scheduleRestCues' answer. */
  scheduled: boolean;
  reason: string | null;
  holdError: string | null;
  /** The two cues' native log entries, in order; null when one never fired. */
  fires: readonly (LockedCueFire | null)[];
  /** Interruptions/route changes seen during the wait. */
  events: readonly string[];
}

const LABELS = ['"15 seconds"', '"Rest over"'];

export function judgeLockedCue(o: LockedCueObservation): ResultUpdate {
  if (!o.scheduled) {
    if (o.reason === 'noBackgroundMode') {
      return {
        status: 'unavailable',
        summary: 'This build was made without background audio (FIZZ_BACKGROUND_AUDIO=0)',
        details: ['The rest-done notification is the background alert'],
      };
    }
    return { status: 'fail', summary: `Cues were not scheduled: ${o.reason ?? 'unknown'}`, details: [] };
  }
  const details = [
    `Cues due ${String(LOCKED_CUE_DELAY_S)} s and ${String(LOCKED_CUE_DELAY_S + LOCKED_CUE_GAP_S)} s after Run`,
    ...o.fires.map((f, i) => {
      const label = LABELS[i] ?? 'Cue';
      if (f === null) return `${label}: never fired`;
      const spoke = f.speakOutcome !== null ? ` (${f.speakOutcome})` : '';
      const err = f.error !== null ? `, ${f.error}` : '';
      return `${label}: ${f.outcome}${spoke}, app ${f.appState}, ${(f.latenessMs / 1000).toFixed(1)} s late, silent hold ${f.holdRunning ? 'running' : 'off'}${err}`;
    }),
    ...(o.holdError !== null ? [`Silent hold: ${o.holdError}`] : []),
    'Music should duck only while each cue speaks',
    ...o.events.map((e) => `Event: ${e}`),
  ];
  const done: LockedCueFire[] = [];
  for (const f of o.fires) {
    if (f === null) return { status: 'fail', summary: 'A cue never fired', details };
    done.push(f);
  }
  if (done.some((f) => f.outcome === 'skippedActive')) {
    return { status: 'not_run', summary: 'The app was on screen when a cue was due. Switch to another app or lock the phone and run again', details };
  }
  const late = done.find((f) => f.outcome === 'late' || f.latenessMs > LOCKED_CUE_MAX_LATENESS_MS);
  if (late) {
    return { status: 'fail', summary: `iOS suspended the app: a cue fired ${String(Math.round(late.latenessMs / 1000))} s late`, details };
  }
  const failed = done.find((f) => f.outcome === 'speakFailed' || f.speakOutcome !== 'finished');
  if (failed) {
    return { status: 'fail', summary: `A cue did not finish in the background (${failed.error ?? failed.speakOutcome ?? failed.outcome})`, details };
  }
  return { status: 'needs_check', summary: 'Both cues played on time with the app in the background', details };
}
