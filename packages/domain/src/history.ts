import type { SessionAggregate } from '@fizz/schemas';
import type { HistorySession, HistorySet } from './progression';

/**
 * Progression history for one exercise from a stored session (third-review
 * follow-up 5). One `HistorySession` per equipment instance the exercise used
 * in that session (normally one), so `calculateNextTargets` can compare like
 * for like.
 *
 * - Only `finished` sessions count. Active and discarded sessions return `[]`.
 * - Only completed sets with a result count. Pending, skipped and deleted
 *   (tombstoned) rows are absent, so an all-skipped session has no sets.
 * - `side` is carried as stored. Progression pairs sides by count (a `both` set
 *   is one prescribed set; a left and a right make one), not by
 *   `pairedWithSetId`. So the link isn't copied. An other-side row whose
 *   partner was deleted (`getSetPair` returns null) counts as a lone side, never
 *   as half of a pair.
 * - `performedAtUtc` is the session's (possibly corrected) start time.
 */
export function toHistorySessions(aggregate: SessionAggregate, exerciseId: string): HistorySession[] {
  const { session } = aggregate;
  if (session.status !== 'finished') return [];
  const exercises = aggregate.exercises
    .filter((e) => e.exerciseId === exerciseId)
    .sort((a, b) => a.order - b.order);
  const byEquipment = new Map<string | null, HistorySet[]>();
  for (const ex of exercises) {
    const sets = aggregate.sets
      .filter((s) => s.sessionExerciseId === ex.id && s.status === 'completed' && s.actual !== null)
      .sort((a, b) => a.index - b.index);
    const bucket = byEquipment.get(ex.equipmentId) ?? [];
    for (const s of sets) {
      if (s.actual === null) continue;
      bucket.push({
        setType: s.setType,
        side: s.side,
        load: s.actual.load,
        reps: s.actual.reps,
        rpe: s.actual.rpe,
        rir: s.actual.rir,
      });
    }
    byEquipment.set(ex.equipmentId, bucket);
  }
  return [...byEquipment.entries()].map(([equipmentId, sets]) => ({
    sessionId: session.id,
    performedAtUtc: session.startedAt.utc,
    equipmentId,
    sets,
  }));
}
