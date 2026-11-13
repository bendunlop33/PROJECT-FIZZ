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

  it('every starter key is in the catalogue', () => {
    expect(starters.filter((s) => !catalogue.byKey(s.catalogueKey ?? '')).map((s) => s.catalogueKey)).toEqual([]);
  });

  it('every starter is the same exercise as its catalogue entry, field for field (no drift)', () => {
    let matched = 0;
    for (const s of starters) {
      const entry = catalogue.byKey(s.catalogueKey ?? '');
      if (!entry) throw new Error(`${s.catalogueKey ?? ''} isn't in the catalogue`);
      matched += 1;
      const row = toExerciseRow(entry, '2026-10-09T00:00:00.000Z');
      if (!row.ok) throw new Error(row.message);
      expect({ key: s.catalogueKey, id: s.id, name: s.name, laterality: s.laterality, equipment: s.compatibleEquipment, convention: s.defaultLoadConvention, mechanic: s.mechanic, family: s.family, pattern: s.movementPattern, muscles: s.primaryMuscles, measurement: s.measurement, rest: s.defaultRestS }).toEqual({
        key: entry.key,
        id: row.exercise.id,
        name: row.exercise.name,
        laterality: row.exercise.laterality,
        equipment: row.exercise.compatibleEquipment,
        convention: row.exercise.defaultLoadConvention,
        mechanic: row.exercise.mechanic,
        family: row.exercise.family,
        pattern: row.exercise.movementPattern,
        muscles: row.exercise.primaryMuscles,
        measurement: row.exercise.measurement,
        rest: row.exercise.defaultRestS,
      });
    }
    // The starter list is a subset of the catalogue, not all of it: the catalogue grows in batches.
    expect(matched).toBe(starters.length);
  });
});
