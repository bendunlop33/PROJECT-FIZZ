import type { Measurement, SetValues, WorkInterval } from '@fizz/schemas';
import { catalogueExerciseId } from './catalogue-id';
import { cardioDistanceText, cardioTimeText, formatElapsed, NBSP } from './display';
import { toMs } from './time';

/**
 * Cardio sets (Ben, 19 Oct: "rowing machine or bike … with a timer and
 * distance"). Pure. A cardio set records a time and a distance, both
 * optional but at least one: `20:00 · 4,800 m`. Its timer counts up from a
 * stored start time (a work interval capped at `CARDIO_TIMER_CAP_S`), so it
 * survives a force-close. Pace is worked out from the two numbers, never
 * estimated: `/500 m` on the rower and ski erg (what their monitors show),
 * `/km` on everything else. No calories (no reliable data, rule 6).
 */

/** A cardio set's time when nothing says otherwise (an add, a new slot, a coach build without one): 10 minutes. */
export const CARDIO_DEFAULT_S = 600;

/** The longest a cardio timer runs: the most a set's time can hold (`DurationSecondsSchema`, 4 h). */
export const CARDIO_TIMER_CAP_S = 4 * 3600;

export function isCardio(m: Measurement): m is 'cardio' {
  return m === 'cardio';
}

export type PaceUnit = '500m' | 'km';

/** Catalogue entries whose machines show pace per 500 m. */
export const PER_500M_KEYS: readonly string[] = ['rowing-erg', 'ski-erg'];

let per500Ids: ReadonlySet<string> | null = null;

/** `500m` for the rower and ski erg (by catalogue key or its exercise ID), `km` for every other exercise. */
export function paceUnitFor(exerciseIdOrKey: string): PaceUnit {
  per500Ids ??= new Set(PER_500M_KEYS.flatMap((k) => [k, catalogueExerciseId(k)]));
  return per500Ids.has(exerciseIdOrKey) ? '500m' : 'km';
}

/** Seconds per 500 m or per km; null without both a time and a distance above 0. */
export function paceSeconds(durationS: number | null | undefined, distanceM: number | null | undefined, unit: PaceUnit): number | null {
  if (durationS == null || distanceM == null || durationS <= 0 || distanceM <= 0) return null;
  return durationS / (distanceM / (unit === '500m' ? 500 : 1000));
}

/** `2:05 /500 m`, `5:12 /km`; null without both a time and a distance. */
export function paceText(values: Pick<SetValues, 'durationS' | 'distanceM'>, exerciseIdOrKey: string): string | null {
  const unit = paceUnitFor(exerciseIdOrKey);
  const s = paceSeconds(values.durationS, values.distanceM, unit);
  if (s === null) return null;
  return `${formatElapsed(Math.round(s) * 1000)}${NBSP}/${unit === '500m' ? `500${NBSP}m` : 'km'}`;
}

/** A cardio set can be logged with a time, a distance, or both; never with neither. */
export function cardioHasValue(values: Pick<SetValues, 'durationS' | 'distanceM'>): boolean {
  return values.durationS !== null || (values.distanceM !== null && values.distanceM !== undefined);
}

/**
 * Time on a cardio timer, from its stored start (never a JS interval), paused
 * time left out, at most the cap. Running: up to now; paused: up to the
 * pause; ended: up to its end.
 */
export function cardioElapsedMs(wi: Pick<WorkInterval, 'durationS' | 'startedAtUtc' | 'status' | 'remainingMsAtPause' | 'pausedMs' | 'endedAtUtc'>, nowMs: number): number {
  const cap = wi.durationS * 1000;
  let ms: number;
  if (wi.status === 'paused') ms = cap - (wi.remainingMsAtPause ?? 0);
  else if (wi.status === 'running') ms = nowMs - toMs(wi.startedAtUtc) - wi.pausedMs;
  else ms = (wi.endedAtUtc === null ? nowMs : toMs(wi.endedAtUtc)) - toMs(wi.startedAtUtc) - wi.pausedMs;
  return Math.max(0, Math.min(cap, ms));
}

type Step = { enabled: true; value: number; label: string } | { enabled: false; reason: string };

/** Cardio time steps: a minute, up to 4 h (typed as minutes in the field). */
export function cardioDurationSteps(value: number | null): { down: Step; up: Step } {
  const v = value ?? 0;
  const up = Math.min(CARDIO_TIMER_CAP_S, v + 60);
  return {
    up: v >= CARDIO_TIMER_CAP_S ? { enabled: false, reason: 'Maximum 4:00:00' } : { enabled: true, value: up, label: cardioTimeText(up) },
    down: value === null || v - 60 < 0 ? { enabled: false, reason: 'Minimum 0:00' } : { enabled: true, value: v - 60, label: cardioTimeText(v - 60) },
  };
}

/** Cardio distance steps: 100 m, never below 0 (the machine's number is usually typed). */
export function cardioDistanceSteps(value: number | null): { down: Step; up: Step } {
  const v = value ?? 0;
  return {
    up: { enabled: true, value: v + 100, label: cardioDistanceText(v + 100) },
    down: value === null || v - 100 < 0 ? { enabled: false, reason: 'Minimum 0' } : { enabled: true, value: v - 100, label: cardioDistanceText(v - 100) },
  };
}

/** Seconds as the minutes field shows them: `20`, `20.5`; null stays null. */
export function cardioMinutes(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 60) * 100) / 100;
}

/** Minutes typed in the field as stored seconds, whole and between 0 and the cap; null stays null. */
export function cardioSecondsFromMinutes(minutes: number | null): number | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(CARDIO_TIMER_CAP_S, Math.round(minutes * 60)));
}

/**
 * A cardio time field (seconds, stepping a minute) as a minutes field: the
 * same steps and labels, values in minutes, so `20` is typed for 20:00.
 */
export function cardioMinutesField(field: { value: number | null; down: Step; up: Step }): { value: number | null; down: Step; up: Step } {
  const inMinutes = (s: Step): Step => (s.enabled ? { ...s, value: cardioMinutes(s.value) ?? 0 } : s);
  return { value: cardioMinutes(field.value), down: inMinutes(field.down), up: inMinutes(field.up) };
}
