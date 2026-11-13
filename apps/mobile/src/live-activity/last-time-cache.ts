import type { ComparableSet, LastComparableLookup } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { LastTimeLayer } from '../alerts/rest-alerts';

/**
 * Last time's sets per workout row, for the Lock Screen's `Last 100 kg × 7`
 * and the rest-done notification's `last …` (Ben, 26 Oct 2026). Read from
 * history once per row (the same read as the card's `Last` line,
 * `workout.lastComparableSets`), ahead of need, then looked up synchronously
 * by the pure content builders. A failed or empty read is simply no `last`.
 *
 * Keyed by everything that decides "comparable" (row, exercise, equipment,
 * unit, convention), so a swap or a gym switch reads again.
 */

export type LastTimeReader = (state: SessionAggregate, sessionExerciseId: string) => Promise<readonly ComparableSet[]>;

function rowKey(state: SessionAggregate, exId: string): string | null {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return null;
  return [state.session.id, ex.id, ex.exerciseId, ex.equipmentId ?? '-', ex.unit, ex.loadConvention].join(':');
}

export function createLastTimeCache(now: () => number): LastTimeLayer & { setReader(reader: LastTimeReader | null): void; readonly size: number } {
  let reader: LastTimeReader | null = null;
  let generation = 0;
  const read = new Map<string, readonly ComparableSet[]>();
  const pending = new Set<string>();

  return {
    setReader(next) {
      reader = next;
      generation += 1;
      read.clear();
      pending.clear();
    },
    lookup(state): LastComparableLookup {
      return (exId) => {
        const k = rowKey(state, exId);
        return k === null ? undefined : read.get(k);
      };
    },
    async ensure(state) {
      const setId = state.session.activeSetId;
      const exId = setId === null ? undefined : state.sets.find((s) => s.id === setId)?.sessionExerciseId;
      const k = exId === undefined ? null : rowKey(state, exId);
      const r = reader;
      if (k === null || exId === undefined || r === null || read.has(k) || pending.has(k)) return false;
      pending.add(k);
      const gen = generation;
      try {
        const sets = await r(state, exId);
        if (gen !== generation) return false;
        read.set(k, sets);
        return sets.length > 0;
      } catch {
        if (gen === generation) read.set(k, []);
        return false;
      } finally {
        if (gen === generation) pending.delete(k);
      }
    },
    now,
    get size() {
      return read.size;
    },
  };
}
