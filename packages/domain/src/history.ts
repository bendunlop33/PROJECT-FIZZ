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
 * - `deload` marks a workout started in the plan's deload week (PM, 23 Oct).
 * - `identity: true` also keeps each set's ID and version and the session's
 *   zone and routine name, so a target made from this history can record its
 *   basis for `Why?` (active-workout §2.12) and spot later edits.
 */
export function toHistorySessions(aggregate: SessionAggregate, exerciseId: string, opts: { identity?: boolean } = {}): HistorySession[] {
  const { session } = aggregate;
  if (!isInHistory(session)) return [];
  const rows = aggregate.exercises.filter((e) => e.exerciseId === exerciseId).sort((a, b) => a.order - b.order);
  // (Review B2) Every copy of the exercise is history. A second copy on the same item is its own
  // entry, marked `copy` (after the main one), so its sets never merge into the main copy's and it
  // never plans next time or shows as `Last` (`matchesEquipment`); exercise history, Progress, e1RM
  // and the coach still see every completed set.
  const extra = extraCopies(aggregate, rows, true);
  const copyOf = (r: SessionExercise): string | null => (extra.has(r.id) ? r.id : r.continuesFromId !== undefined && extra.has(r.continuesFromId) ? r.continuesFromId : null);
  const buckets = new Map<string, { equipmentId: string | null; copy: boolean; sets: HistorySet[] }>();
  const numbers = opts.identity ? setDisplayNumbers(aggregate.exercises, aggregate.sets) : null;
  for (const ex of [...rows.filter((r) => copyOf(r) === null), ...rows.filter((r) => copyOf(r) !== null)]) {
    const copy = copyOf(ex);
    const key = `${copy ?? ''}|${ex.equipmentId ?? ''}`;
    const sets = aggregate.sets
      .filter((s) => s.sessionExerciseId === ex.id && s.status === 'completed' && s.actual !== null)
      .sort((a, b) => a.index - b.index);
    const bucket = buckets.get(key) ?? { equipmentId: ex.equipmentId, copy: copy !== null, sets: [] };
    for (const s of sets) {
      if (s.actual === null) continue;
      const number = numbers?.get(s.id);
      bucket.sets.push({
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
    buckets.set(key, bucket);
  }
  // After a mid-workout switch each item belongs to its own gym (gym-switch GS6), not the workout's last one.
  const switched = (session.gymChanges ?? []).length > 0;
  const gymOf = (equipmentId: string | null): string | null =>
    !switched || equipmentId === null ? session.gymId : (equipmentOfRow(session.equipmentSnapshot, { equipmentId })?.gymId ?? session.gymId);
  return [...buckets.values()]
    .filter((b) => !b.copy || b.sets.length > 0)
    .map(({ equipmentId, copy, sets }) => ({
      sessionId: session.id,
      performedAtUtc: session.startedAt.utc,
      equipmentId,
      gymId: gymOf(equipmentId),
      imported: session.source === 'import',
      sets,
      ...(copy ? { copy: true as const } : {}),
      ...(session.deload !== undefined ? { deload: true as const } : {}),
      ...(opts.identity ? { tz: session.startedAt.tz, routineName: session.routineName } : {}),
    }));
}

/** The rows added to the workout after it was planned (Library, picker, coach adds): `add_exercise` records. */
function addedRows(aggregate: Pick<SessionAggregate, 'processedOps'>): Set<string> {
  const out = new Set<string>();
  for (const op of Object.values(aggregate.processedOps)) if (op.commandType === 'add_exercise') for (const id of op.createdIds ?? []) out.add(id);
  return out;
}

/**
 * (Ben, 19 Oct: the same exercise twice in a workout, e.g. a superset with itself at 0) Rows of one
 * exercise that aren't parts of each other are separate copies. The copies other than the main one:
 * by item (`byItem`, how history groups sets) or across items. Main (review B2), from facts that
 * don't depend on how many sets were done: a copy with a done working set over one with none; the
 * planned slot (a row in the workout when it was planned) over a row added later; then the heaviest
 * done load; then the first in order. Parts after a gym switch (`continuesFromId`) aren't copies.
 */
export function extraCopies(aggregate: Pick<SessionAggregate, 'exercises' | 'sets'> & Partial<Pick<SessionAggregate, 'processedOps'>>, rows: readonly SessionExercise[], byItem: boolean): Set<string> {
  const done = (row: SessionExercise) => aggregate.sets.filter((s) => s.sessionExerciseId === row.id && s.status === 'completed' && s.actual !== null && s.setType !== 'warmup');
  const heaviest = (row: SessionExercise): number => {
    const loads = done(row).flatMap((s) => (s.actual?.load && s.actual.load.convention !== 'bodyweight' ? [s.actual.load.convention === 'assistance' ? -s.actual.load.value : s.actual.load.value] : []));
    return loads.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...loads);
  };
  const added = addedRows({ processedOps: aggregate.processedOps ?? {} });
  const groups = new Map<string, SessionExercise[]>();
  for (const row of rows) {
    if (row.continuesFromId !== undefined || row.removed !== undefined) continue;
    const key = `${row.exerciseId}|${byItem ? (row.equipmentId ?? '') : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const rank = (row: SessionExercise): [number, number, number] => [done(row).length > 0 ? 0 : 1, added.has(row.id) ? 1 : 0, -heaviest(row)];
  const extra = new Set<string>();
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    const main = [...copies].sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0] - y[0] || x[1] - y[1] || (x[2] === y[2] ? 0 : x[2] < y[2] ? -1 : 1) || a.order - b.order;
    })[0];
    for (const c of copies) if (c.id !== main?.id) extra.add(c.id);
  }
  return extra;
}
