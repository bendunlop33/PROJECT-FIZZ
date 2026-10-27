import type { SessionExercise, SetValues } from '@fizz/schemas';

import { cardioHasValue } from '../cardio';

/**
 * The values `Log` saves for a set, from what is shown (the prefill or Ben's
 * edits). One definition for the in-app card (`buildFocus`) and the Lock
 * Screen's `Log` (Ben, 27 Oct; `lock-screen-log.ts`), so the two can never
 * log different numbers for the same set. Pure.
 */

/**
 * The shown values with effort only Ben's own (never prefilled) and the load
 * normalised for the exercise's convention: bodyweight carries no load; an
 * `added` exercise after a bodyweight `Last` starts at nothing added.
 */
export function shownSetValues(ex: Pick<SessionExercise, 'loadConvention' | 'unit'>, base: SetValues, ownEffort: Pick<SetValues, 'rpe' | 'rir'> | null): SetValues {
  let values: SetValues = { ...base, rpe: ownEffort?.rpe ?? null, rir: ownEffort?.rir ?? null };
  if (ex.loadConvention === 'bodyweight') values = { ...values, load: { value: 0, unit: ex.unit, convention: 'bodyweight' } };
  if (ex.loadConvention === 'added' && values.load?.convention === 'bodyweight') values = { ...values, load: { value: 0, unit: ex.unit, convention: 'added' } };
  return values;
}

/** The field a set can't be logged without; null when nothing is missing. */
export function missingLogValue(values: SetValues, ex: Pick<SessionExercise, 'loadConvention' | 'measurement'>): 'load' | 'reps' | 'time' | 'distance' | null {
  if (ex.loadConvention !== 'bodyweight' && values.load === null && ex.loadConvention !== 'added') return 'load';
  if (ex.measurement === 'reps' && values.reps === null) return 'reps';
  if (ex.measurement === 'duration' && values.durationS === null) return 'time';
  if (ex.measurement === 'distance' && (values.distanceM === null || values.distanceM === undefined)) return 'distance';
  if (ex.measurement === 'cardio' && !cardioHasValue(values)) return 'time';
  return null;
}

/** What `log_set` saves: an `added` exercise with nothing entered logs nothing added; a running cardio timer's time wins. */
export function logSetValues(ex: Pick<SessionExercise, 'loadConvention' | 'unit'>, values: SetValues, timedCardioS: number | null = null): SetValues {
  return {
    ...values,
    ...(timedCardioS === null ? {} : { durationS: timedCardioS }),
    load: ex.loadConvention === 'added' && values.load === null ? { value: 0, unit: ex.unit, convention: 'added' } : values.load,
  };
}
