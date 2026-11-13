import type { SessionAggregate } from '@fizz/schemas';

export interface ExerciseVolume {
  sessionExerciseId: string;
  /** Completed non-warm-up sets. A unilateral left + right pair counts once. */
  sets: number;
  /**
   * Completed non-warm-up reps. For unilateral exercises this is reps per side:
   * `both` sets count their reps once, and separate left/right sets count the
   * busier side, so the two sides are never added together.
   */
  reps: number;
  /** Unilateral only: per-side tallies, for display ("L 18 · R 16"). */
  bySide: { left: { sets: number; reps: number }; right: { sets: number; reps: number } } | null;
}

/**
 * Per-exercise working volume for the summary and weekly counts (brief §4:
 * record unilateral work per side and avoid double-counting volume).
 * Deleted, skipped and pending sets are ignored.
 */
export function summariseVolume(state: SessionAggregate): ExerciseVolume[] {
  return [...state.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const done = state.sets.filter(
        (s) => s.sessionExerciseId === ex.id && s.status === 'completed' && s.actual !== null && s.setType !== 'warmup',
      );
      const repsOf = (xs: typeof done) => xs.reduce((sum, s) => sum + (s.actual?.reps ?? 0), 0);
      if (ex.laterality === 'bilateral') {
        return { sessionExerciseId: ex.id, sets: done.length, reps: repsOf(done), bySide: null };
      }
      const both = done.filter((s) => s.side === 'both' || s.side === null);
      const left = done.filter((s) => s.side === 'left');
      const right = done.filter((s) => s.side === 'right');
      const l = { sets: left.length, reps: repsOf(left) };
      const r = { sets: right.length, reps: repsOf(right) };
      return {
        sessionExerciseId: ex.id,
        sets: both.length + Math.max(l.sets, r.sets),
        reps: repsOf(both) + Math.max(l.reps, r.reps),
        bySide: { left: { sets: both.length + l.sets, reps: repsOf(both) + l.reps }, right: { sets: both.length + r.sets, reps: repsOf(both) + r.reps } },
      };
    });
}
