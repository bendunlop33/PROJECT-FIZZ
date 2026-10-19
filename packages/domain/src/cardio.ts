import type { Measurement, SetValues, WorkInterval } from '@fizz/schemas';
import { catalogueExerciseId } from './catalogue-id';
import { formatElapsed, NBSP } from './display';
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
  return (values.durationS !== null && values.durationS !== undefined) || (values.distanceM !== null && values.distanceM !== undefined);
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
