import type { Measurement, PlannedSet, SetType, SetValues, WorkInterval, ZonedTimestamp } from '@fizz/schemas';
import { catalogueExerciseId } from './catalogue-id';
import { cardioDistanceText, cardioTimeText, formatElapsed, NBSP } from './display';
import { isSetCountable } from './exclusions';
import type { HistorySession } from './progression';
import { toIso, toMs } from './time';

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

/**
 * A cardio set can be logged with a time, a distance, or both; never with
 * neither. A time or distance of 0 is no value (review S4: ✓ tapped right
 * after Start never logs a completed `0:00`).
 */
export function cardioHasValue(values: Pick<SetValues, 'durationS' | 'distanceM'>): boolean {
  return (values.durationS !== null && values.durationS > 0) || (values.distanceM !== null && values.distanceM !== undefined && values.distanceM > 0);
}

/**
 * Time on a cardio timer, from its stored start (never a JS interval), paused
 * and stopped time left out, at most the cap. Running: up to now; paused: up
 * to the pause; ended: up to its end. The cap is always `CARDIO_TIMER_CAP_S`,
 * whatever the interval stored (a timer started before migration 20 on the
 * air bike stored its 10-minute target; review S7).
 */
export function cardioElapsedMs(wi: Pick<WorkInterval, 'durationS' | 'startedAtUtc' | 'status' | 'remainingMsAtPause' | 'pausedMs' | 'endedAtUtc'>, nowMs: number): number {
  const cap = CARDIO_TIMER_CAP_S * 1000;
  let ms: number;
  if (wi.status === 'paused') ms = wi.durationS * 1000 - (wi.remainingMsAtPause ?? 0);
  else if (wi.status === 'running') ms = nowMs - toMs(wi.startedAtUtc) - wi.pausedMs;
  else ms = (wi.endedAtUtc === null ? nowMs : toMs(wi.endedAtUtc)) - toMs(wi.startedAtUtc) - wi.pausedMs;
  return Math.max(0, Math.min(cap, ms));
}

/**
 * A cardio set's timer as it runs now: one stored before migration 20 (the
 * air bike was a timed exercise, its interval ran to the 10-minute target)
 * runs on to the cardio cap instead, so it never auto-completes at its old
 * target (review S7). The deadline and the time left at a pause move by the
 * same amount; the start and the time so far don't change. Pure; unchanged
 * when it already runs to the cap.
 */
export function asCardioInterval<W extends WorkInterval>(wi: W): W {
  if (wi.durationS >= CARDIO_TIMER_CAP_S) return wi;
  const extraMs = (CARDIO_TIMER_CAP_S - wi.durationS) * 1000;
  return {
    ...wi,
    durationS: CARDIO_TIMER_CAP_S,
    deadlineUtc: toIso(toMs(wi.deadlineUtc) + extraMs),
    remainingMsAtPause: wi.remainingMsAtPause === null ? null : wi.remainingMsAtPause + extraMs,
  };
}

/**
 * `Resume` after `Stop` on a cardio set (review S6): the same timer carries
 * on from the time it showed, the stopped gap counted as paused time, so ✓
 * then logs both segments. Null when this interval can't be resumed (not
 * stopped, or already at the cap).
 */
export function resumeCardioInterval(wi: WorkInterval, nowMs: number): WorkInterval | null {
  if (wi.status !== 'stopped' || wi.endedAtUtc === null) return null;
  const sofar = cardioElapsedMs(wi, nowMs);
  const capMs = CARDIO_TIMER_CAP_S * 1000;
  if (sofar >= capMs) return null;
  const gap = Math.max(0, nowMs - toMs(wi.endedAtUtc));
  return {
    ...wi,
    durationS: CARDIO_TIMER_CAP_S,
    status: 'running',
    pausedMs: wi.pausedMs + gap,
    deadlineUtc: toIso(nowMs + capMs - sofar),
    remainingMsAtPause: null,
    endedAtUtc: null,
  };
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

/**
 * A cardio time as typed from the machine's display (review S5), in
 * seconds: `20:34` or `20.34` (minutes and seconds, as the monitor shows
 * them; the number pad has no colon), `1:05:00` (hours), `20` (whole
 * minutes). Seconds must be two digits under 60, so a half-typed `20.3`
 * is no value yet rather than 20:30 or 20:18. Null for anything else, and
 * above the cap.
 */
export function parseCardioTime(text: string): number | null {
  const t = text.trim().replace(/,/g, '.');
  if (t === '') return null;
  const parts = t.split(/[:.]/);
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let s: number;
  if (nums.length === 1) s = (nums[0] ?? 0) * 60;
  else if (nums.length === 2) {
    if ((parts[1] ?? '').length !== 2 || (nums[1] ?? 0) >= 60) return null;
    s = (nums[0] ?? 0) * 60 + (nums[1] ?? 0);
  } else if (nums.length === 3) {
    if ((parts[1] ?? '').length !== 2 || (parts[2] ?? '').length !== 2 || (nums[1] ?? 0) >= 60 || (nums[2] ?? 0) >= 60) return null;
    s = (nums[0] ?? 0) * 3600 + (nums[1] ?? 0) * 60 + (nums[2] ?? 0);
  } else return null;
  return s > CARDIO_TIMER_CAP_S ? null : s;
}

/** A cardio time field's text, as the machine shows it: `20:34`, `1:05:00`. */
export function cardioTimeFieldText(seconds: number): string {
  return cardioTimeText(seconds);
}

/**
 * Next time's cardio targets (Ben, 19 Oct: "next time shows last time's
 * time and distance"): the most recent workout with a counted cardio set of
 * this exercise, its sets' time and distance as they were (repeat, never
 * progressed). No load, no reps, no RPE. Each target says where it came
 * from (`Why?`: last time). Null with no such workout. Pure.
 */
export function cardioRepeatTargets(history: readonly HistorySession[], o: { at: ZonedTimestamp }): { setType: SetType; planned: PlannedSet }[] | null {
  const recent = [...history].sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc) || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));
  for (const h of recent) {
    const sets = h.sets.filter((x) => x.setType !== 'warmup' && isSetCountable(x, 'progression') && cardioHasValue({ durationS: x.durationS ?? null, distanceM: x.distanceM ?? null }));
    if (sets.length === 0) continue;
    return sets.map((x) => {
      const durationS = x.durationS !== undefined && x.durationS > 0 ? x.durationS : null;
      const distanceM = x.distanceM !== undefined && x.distanceM > 0 ? x.distanceM : null;
      const values: SetValues = { load: null, reps: null, durationS, rpe: null, rir: null, ...(distanceM !== null ? { distanceM } : {}) };
      return {
        setType: x.setType,
        planned: {
          load: null,
          reps: null,
          durationS,
          ...(distanceM !== null ? { distanceM } : {}),
          rpe: null,
          rir: null,
          source: 'repeat' as const,
          provenance: {
            source: 'repeat' as const,
            setAt: o.at,
            routineName: h.routineName ?? null,
            requestedLoad: null,
            basis: {
              sessionId: h.sessionId,
              performedAt: { utc: h.performedAtUtc, tz: h.tz ?? o.at.tz },
              routineName: h.routineName ?? null,
              gymId: h.gymId,
              equipmentId: h.equipmentId,
              sets: [{ ...(x.setId !== undefined ? { setId: x.setId } : {}), ...(x.version !== undefined ? { version: x.version } : {}), ...(x.number !== undefined ? { number: x.number } : {}), setType: x.setType, side: x.side, values }],
              ...(h.imported ? { imported: true as const } : {}),
            },
            guardNotes: [],
          },
        },
      };
    });
  }
  return null;
}
