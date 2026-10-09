import { describe, expect, it } from 'vitest';
import { LEGACY_STARTER_IDS, starterExercises } from '@fizz/domain';

import { bundledCatalogue, catalogueExerciseId, toExerciseRow } from '../src/index';

/**
 * Review workout-loop B2: the app's starter list and the catalogue use one ID
 * scheme (`catalogueExerciseId(key)`, UUIDv5) and the same keys, so wiring the
 * catalogue keeps every logged set's history, prefill and pain flag.
 */
describe('starter exercises match the catalogue', () => {
  const starters = starterExercises('2026-10-09T00:00:00.000Z');
  const { catalogue } = bundledCatalogue();

  it('every starter ID is catalogueExerciseId(its key)', () => {
    for (const s of starters) {
      expect(s.catalogueKey).toBeTruthy();
      expect(s.id).toBe(catalogueExerciseId(s.catalogueKey ?? ''));
      expect(LEGACY_STARTER_IDS).not.toContain(s.id);
    }
  });

  it('every starter key that the catalogue has is the same exercise there (ID, name, kind of load)', () => {
    let matched = 0;
    for (const s of starters) {
      const entry = catalogue.byKey(s.catalogueKey ?? '');
      if (!entry) continue;
      matched += 1;
      const row = toExerciseRow(entry, '2026-10-09T00:00:00.000Z');
      if (!row.ok) throw new Error(row.message);
      expect({ key: s.catalogueKey, id: s.id, name: s.name, laterality: s.laterality, equipment: s.compatibleEquipment, convention: s.defaultLoadConvention, mechanic: s.mechanic, family: s.family, pattern: s.movementPattern }).toEqual({
        key: entry.key,
        id: row.exercise.id,
        name: row.exercise.name,
        laterality: row.exercise.laterality,
        equipment: row.exercise.compatibleEquipment,
        convention: row.exercise.defaultLoadConvention,
        mechanic: row.exercise.mechanic,
        family: row.exercise.family,
        pattern: row.exercise.movementPattern,
      });
    }
    // All nine loggable catalogue entries are in the starter list (sled push is distance-based).
    expect(matched).toBe(catalogue.entries.filter((e) => e.measurement !== 'distance').length);
  });
});
