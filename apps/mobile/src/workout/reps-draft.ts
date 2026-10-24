import { CARDIO_TIMER_CAP_S, cardioDistanceSteps, cardioDurationSteps, type StepTarget } from '@fizz/domain';

/**
 * The reps / work time / cardio sheet's draft and its steppers (first made
 * for the Workout overview's RepsSheet, overview-today-edits §11.4; the
 * overview was retired 22 Oct). Used by the set-shape controls (the editor,
 * Exercise detail's `Add to a workout`). Pure.
 */

export const REPS_LIMITS = { min: 1, max: 50, minWorkS: 5, maxWorkS: 600, workStepS: 5 } as const;

/** `cardio` (review cardio S1): a time up to 4 h, stepping a minute, and a distance in metres; either may be empty, not both. */
export type RepsDraft = { kind: 'reps'; exact: boolean; min: number; max: number } | { kind: 'time'; seconds: number } | { kind: 'cardio'; seconds: number | null; distanceM: number | null };

type Step = StepTarget;
const step = (to: number, lo: number, hi: number, label: (n: number) => string): Step => (to < lo || to > hi ? { enabled: false, reason: to < lo ? `Min ${label(lo)}` : `Max ${label(hi)}` } : { enabled: true, value: to, label: label(to) });

/** The sheet's steppers: ±1 rep within 1–50 (`To` never under `From`); ±5 s within 0:05–10:00. */
export function repsSteps(d: RepsDraft): { from?: { down: Step; up: Step }; to?: { down: Step; up: Step }; time?: { down: Step; up: Step }; distance?: { down: Step; up: Step } } {
  const n = (x: number) => String(x);
  if (d.kind === 'cardio') return { time: cardioDurationSteps(d.seconds), distance: cardioDistanceSteps(d.distanceM) };
  if (d.kind === 'time') {
    const s = (x: number) => `${String(x)} s`;
    return { time: { down: step(d.seconds - REPS_LIMITS.workStepS, REPS_LIMITS.minWorkS, REPS_LIMITS.maxWorkS, s), up: step(d.seconds + REPS_LIMITS.workStepS, REPS_LIMITS.minWorkS, REPS_LIMITS.maxWorkS, s) } };
  }
  const from = { down: step(d.min - 1, REPS_LIMITS.min, REPS_LIMITS.max, n), up: step(d.min + 1, REPS_LIMITS.min, d.exact ? REPS_LIMITS.max : d.max, n) };
  return d.exact ? { from } : { from, to: { down: step(d.max - 1, d.min, REPS_LIMITS.max, n), up: step(d.max + 1, d.min, REPS_LIMITS.max, n) } };
}

/** A typed or stepped value, kept inside the limits (and `To` ≥ `From`). */
export function repsDraftWith(d: RepsDraft, field: 'from' | 'to' | 'time' | 'exact' | 'range', value = 0): RepsDraft {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(x) ? x : lo)));
  if (d.kind === 'cardio') return field === 'time' ? cardioDraftWith(d, 'time', value) : d;
  if (d.kind === 'time') return field === 'time' ? { kind: 'time', seconds: clamp(value, REPS_LIMITS.minWorkS, REPS_LIMITS.maxWorkS) } : d;
  if (field === 'exact') return { ...d, exact: true, max: d.min };
  if (field === 'range') return { ...d, exact: false, max: Math.min(REPS_LIMITS.max, Math.max(d.max, d.min + 2)) };
  if (field === 'from') {
    const min = clamp(value, REPS_LIMITS.min, REPS_LIMITS.max);
    return { ...d, min, max: d.exact ? min : Math.max(min, d.max) };
  }
  if (field === 'to') return { ...d, max: clamp(value, d.min, REPS_LIMITS.max) };
  return d;
}

/**
 * A cardio draft's time or distance, typed or stepped (review cardio S1):
 * time in whole seconds between 0:05 and 4:00:00, distance in metres from 0
 * to 100 km; empty (null) or 0 is no value. Never clamped silently past the
 * cap: a time above it stays at the cap, which the field shows.
 */
export function cardioDraftWith(d: Extract<RepsDraft, { kind: 'cardio' }>, field: 'time' | 'distance', value: number | null): RepsDraft {
  const v = value === null || !Number.isFinite(value) || value <= 0 ? null : value;
  if (field === 'time') return { ...d, seconds: v === null ? null : Math.max(REPS_LIMITS.minWorkS, Math.min(CARDIO_TIMER_CAP_S, Math.round(v))) };
  return { ...d, distanceM: v === null ? null : Math.min(100_000, Math.round(v * 10) / 10) };
}

/** `Done` is offered: a cardio draft needs a time or a distance; every other draft is always whole. */
export function repsDraftValid(d: RepsDraft): boolean {
  return d.kind !== 'cardio' || d.seconds !== null || d.distanceM !== null;
}
