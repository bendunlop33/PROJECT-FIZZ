import type { HistoryLike } from '../history-summary';
import type { SessionExercise, WorkoutSet } from '@fizz/schemas';
import { formatNumber, valuesText } from '../display';
import { isSetCountable } from '../exclusions';
import { toMs } from '../time';
import { isInHistory } from './deletion';

/**
 * Today's lift highlight (D-Today: `BENCH PRESS`, `100 kg × 8`,
 * `6 Oct · up from 97.5`, a sparkline). Pure; from logged sets only, never an
 * estimate (rule 6).
 *
 * - The lift is the first exercise, in order, of the newest workout (logged
 *   or imported from FitNotes, B7) that has a weighted working set measured
 *   in reps.
 *   Assisted and bodyweight-only movements are passed over: "up" would mean
 *   the opposite there, and there is no load to chart.
 * - The series is the top set (heaviest, then most reps) of each workout with
 *   that exercise on the same equipment, unit and load convention, oldest
 *   first, at most `maxPoints`. A FitNotes workout recorded no equipment, so
 *   it matches any (unit and convention still must match; B7), and the
 *   highlight says `FitNotes` when its newest point is one (`imported`).
 *   App workouts are still charted on one item only (review S3).
 * - `change` compares the newest top set with the one before it.
 * - Sets Ben marked as not counting (`Spotted`, `Pain`, …, active-workout
 *   §2.13) are never a top set, a change or a trend point (check 45).
 */
export interface LiftHighlight {
  exerciseId: string;
  exerciseName: string;
  /** `100 kg × 8` */
  text: string;
  performedAtUtc: string;
  tz: string;
  /** `up from 97.5`, `down from 100`, `+2 reps`, `same as last time`; null with one workout. */
  change: string | null;
  /** Top-set loads, oldest first. A sparkline needs 2 or more. */
  points: number[];
  /** The newest point is from a FitNotes import (shown `FitNotes · 6 Oct`). */
  imported: boolean;
}

export const LIFT_HIGHLIGHT_MAX_POINTS = 7;

const isWorking = (s: WorkoutSet) => s.setType !== 'warmup' && s.status === 'completed' && s.actual !== null && isSetCountable(s, 'record') && isSetCountable(s, 'comparison');

function weightedTop(a: HistoryLike, ex: SessionExercise): { load: number; reps: number; set: WorkoutSet } | null {
  let best: { load: number; reps: number; set: WorkoutSet } | null = null;
  for (const s of a.sets) {
    if (s.sessionExerciseId !== ex.id || !isWorking(s)) continue;
    const load = s.actual?.load ?? null;
    const reps = s.actual?.reps ?? null;
    if (load === null || reps === null || load.convention !== ex.loadConvention || load.unit !== ex.unit) continue;
    if (best === null || load.value > best.load || (load.value === best.load && reps > best.reps)) best = { load: load.value, reps, set: s };
  }
  return best;
}

function eligible(ex: SessionExercise): boolean {
  return ex.measurement === 'reps' && ex.loadConvention !== 'assistance' && ex.loadConvention !== 'bodyweight';
}

export function buildLiftHighlight(sessions: readonly HistoryLike[], maxPoints = LIFT_HIGHLIGHT_MAX_POINTS): LiftHighlight | null {
  const logged = sessions
    .filter((a) => isInHistory(a.session))
    .sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc));
  // The newest workout with a counted weighted set: one whose sets were all marked as not counting is passed over.
  const liftOf = (a: HistoryLike) => [...a.exercises].sort((x, y) => x.order - y.order).find((ex) => eligible(ex) && weightedTop(a, ex) !== null);
  const newest = logged.find((a) => liftOf(a) !== undefined);
  if (!newest) return null;
  const lift = liftOf(newest);
  if (!lift) return null;

  const series: { load: number; reps: number; set: WorkoutSet; session: HistoryLike }[] = [];
  /**
   * The item app workouts are charted on. Only the match against a FitNotes
   * workout is relaxed (review import-progress S3): app workouts still need
   * one item, the lift's own, or (newest point imported) the item of the
   * newest app workout in the series. `undefined`: not chosen yet.
   */
  let appItem: string | null | undefined = newest.session.source === 'import' ? undefined : lift.equipmentId;
  for (const a of logged) {
    if (series.length >= maxPoints) break;
    const imported = a.session.source === 'import';
    const same = a.exercises.filter((e) => e.exerciseId === lift.exerciseId && (imported || appItem === undefined || e.equipmentId === appItem) && e.unit === lift.unit && e.loadConvention === lift.loadConvention);
    let top: { load: number; reps: number; set: WorkoutSet; equipmentId: string | null } | null = null;
    for (const e of same) {
      const t = weightedTop(a, e);
      if (t && (top === null || t.load > top.load || (t.load === top.load && t.reps > top.reps))) top = { ...t, equipmentId: e.equipmentId };
    }
    if (!top) continue;
    if (!imported && appItem === undefined) appItem = top.equipmentId;
    series.push({ load: top.load, reps: top.reps, set: top.set, session: a });
  }
  const latest = series[0];
  if (!latest) return null;
  const before = series[1] ?? null;

  const equipment = lift.equipmentId === null ? null : (newest.session.equipmentSnapshot.find((e) => e.id === lift.equipmentId) ?? null);
  const text = valuesText({ load: latest.set.actual?.load ?? null, reps: latest.reps, durationS: null }, { convention: lift.loadConvention, measurement: 'reps', equipment });

  let change: string | null = null;
  if (before) {
    if (latest.load > before.load) change = `up from ${formatNumber(before.load)}`;
    else if (latest.load < before.load) change = `down from ${formatNumber(before.load)}`;
    else if (latest.reps !== before.reps) {
      const d = latest.reps - before.reps;
      change = `${d > 0 ? '+' : '−'}${String(Math.abs(d))} ${Math.abs(d) === 1 ? 'rep' : 'reps'}`;
    } else change = 'same as last time';
  }

  return {
    exerciseId: lift.exerciseId,
    exerciseName: lift.exerciseName,
    text,
    performedAtUtc: latest.session.session.startedAt.utc,
    tz: latest.session.session.startedAt.tz,
    change,
    points: series.map((p) => p.load).reverse(),
    imported: latest.session.session.source === 'import',
  };
}

/**
 * Sparkline geometry for a `width` × `height` box: one point per value,
 * evenly spaced, the lowest value at the bottom (`pad` from the edge). A flat
 * series sits in the middle. Pure, so the view only draws.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number, pad = 4): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  return values.map((v, i) => ({
    x: values.length === 1 ? width : i * step,
    y: span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad),
  }));
}
