import type { SessionAggregate, SessionExercise } from '@fizz/schemas';
import type { HistorySession, HistorySet } from './progression';
import { equipmentOfRow } from './session/equipment-snapshot';
import { setDisplayNumbers } from './session/order';
import { isInHistory } from './session/deletion';

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
 * - `gymId` is the session's gym (null: not recorded); `imported` marks a
 *   FitNotes workout, read through `comparableSetsOf` and matched on any
 *   item (B7).
 * - `identity: true` also keeps each set's ID and version and the session's
 *   zone and routine name, so a target made from this history can record its
 *   basis for `Why?` (active-workout §2.12) and spot later edits.
 */
export function toHistorySessions(aggregate: SessionAggregate, exerciseId: string, opts: { identity?: boolean } = {}): HistorySession[] {
  const { session } = aggregate;
  if (!isInHistory(session)) return [];
  const exercises = mainCopies(
    aggregate,
    aggregate.exercises.filter((e) => e.exerciseId === exerciseId).sort((a, b) => a.order - b.order),
  );
  const byEquipment = new Map<string | null, HistorySet[]>();
  const numbers = opts.identity ? setDisplayNumbers(aggregate.exercises, aggregate.sets) : null;
  for (const ex of exercises) {
    const sets = aggregate.sets
      .filter((s) => s.sessionExerciseId === ex.id && s.status === 'completed' && s.actual !== null)
      .sort((a, b) => a.index - b.index);
    const bucket = byEquipment.get(ex.equipmentId) ?? [];
    for (const s of sets) {
      if (s.actual === null) continue;
      const number = numbers?.get(s.id);
      bucket.push({
        setType: s.setType,
        side: s.side,
        load: s.actual.load,
        reps: s.actual.reps,
        rpe: s.actual.rpe,
        rir: s.actual.rir,
        // Timed and distance sets carry their time or metres (for `Last`); absent on others.
        ...(s.actual.durationS !== null ? { durationS: s.actual.durationS } : {}),
        ...(s.actual.distanceM !== null && s.actual.distanceM !== undefined ? { distanceM: s.actual.distanceM } : {}),
        // §2.13: flags travel with the set; consumers decide with `isSetCountable`.
        ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: s.exclusions } : {}),
        ...(opts.identity ? { setId: s.id, version: s.version } : {}),
        ...(number !== undefined ? { number } : {}),
      });
    }
    byEquipment.set(ex.equipmentId, bucket);
  }
  // After a mid-workout switch each item belongs to its own gym (gym-switch GS6), not the workout's last one.
  const switched = (session.gymChanges ?? []).length > 0;
  const gymOf = (equipmentId: string | null): string | null =>
    !switched || equipmentId === null ? session.gymId : (equipmentOfRow(session.equipmentSnapshot, { equipmentId })?.gymId ?? session.gymId);
  return [...byEquipment.entries()].map(([equipmentId, sets]) => ({
    sessionId: session.id,
    performedAtUtc: session.startedAt.utc,
    equipmentId,
    gymId: gymOf(equipmentId),
    imported: session.source === 'import',
    sets,
    ...(opts.identity ? { tz: session.startedAt.tz, routineName: session.routineName } : {}),
  }));
}

/**
 * (Ben, 19 Oct: the same exercise twice in a workout, e.g. a superset with itself at 0) Rows of one
 * exercise that aren't parts of each other are separate copies. The copies other than the main one:
 * by item (`byItem`, how history groups sets) or across items. Main: the most done working sets,
 * then the heaviest, then the first. Parts after a gym switch (`continuesFromId`) aren't copies.
 */
export function extraCopies(aggregate: Pick<SessionAggregate, 'exercises' | 'sets'>, rows: readonly SessionExercise[], byItem: boolean): Set<string> {
  const done = (row: SessionExercise) => aggregate.sets.filter((s) => s.sessionExerciseId === row.id && s.status === 'completed' && s.actual !== null && s.setType !== 'warmup');
  const heaviest = (row: SessionExercise): number => {
    const loads = done(row).flatMap((s) => (s.actual?.load && s.actual.load.convention !== 'bodyweight' ? [s.actual.load.convention === 'assistance' ? -s.actual.load.value : s.actual.load.value] : []));
    return loads.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...loads);
  };
  const groups = new Map<string, SessionExercise[]>();
  for (const row of rows) {
    if (row.continuesFromId !== undefined || row.removed !== undefined) continue;
    const key = `${row.exerciseId}|${byItem ? (row.equipmentId ?? '') : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const extra = new Set<string>();
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    const main = [...copies].sort((a, b) => done(b).length - done(a).length || heaviest(b) - heaviest(a) || a.order - b.order)[0];
    for (const c of copies) if (c.id !== main?.id) extra.add(c.id);
  }
  return extra;
}

/** Only the main copy of the exercise on each item is its history, so a lighter or bodyweight copy never merges into its sets. */
function mainCopies(aggregate: SessionAggregate, rows: readonly SessionExercise[]): SessionExercise[] {
  const extra = extraCopies(aggregate, rows, true);
  return rows.filter((r) => !extra.has(r.id) && !(r.continuesFromId !== undefined && extra.has(r.continuesFromId)));
}
