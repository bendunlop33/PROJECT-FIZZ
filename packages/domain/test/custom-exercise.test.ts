import { describe, expect, it } from 'vitest';

import { archivedCustomExercise, checkCustomExerciseFields, customExerciseIdOf, customExerciseLine, defaultConventionFor, editedCustomExercise, exerciseNameClash, exerciseNearDuplicate, exerciseNameKey, isArchivedExercise, newCustomExercise } from '../src/custom-exercise';

const F = { name: 'Meadows row', equipment: 'barbell' as const, loadConvention: 'total' as const, primaryMuscles: ['lats' as const, 'biceps' as const], measurement: 'reps' as const, laterality: 'bilateral' as const };

describe('custom exercises (pure)', () => {
  it('checks fields: a convention that fits the equipment, 1–3 muscles once each, a name', () => {
    expect(checkCustomExerciseFields(F)).toMatchObject({ ok: true });
    expect(checkCustomExerciseFields({ ...F, loadConvention: 'stack' })).toMatchObject({ ok: false });
    expect(checkCustomExerciseFields({ ...F, primaryMuscles: [] })).toEqual({ ok: false, problem: 'Pick 1 to 3 muscles.' });
    expect(checkCustomExerciseFields({ ...F, primaryMuscles: ['lats', 'lats'] })).toMatchObject({ ok: false });
    expect(checkCustomExerciseFields({ ...F, name: '  ' })).toEqual({ ok: false, problem: 'Name needed.' });
    expect(checkCustomExerciseFields({ ...F, name: '  Meadows   row ' })).toMatchObject({ ok: true, fields: { name: 'Meadows row' } });
    expect([defaultConventionFor('plate_loaded_machine'), defaultConventionFor('dumbbells'), defaultConventionFor('assisted_stack'), defaultConventionFor('weight_stack')]).toEqual(['added', 'per_hand', 'assistance', 'stack']);
  });

  it('name clash: plurals, case and other names; deleted and self ignored; catalogue first', () => {
    expect(exerciseNameKey('Seated Calf Raises')).toBe(exerciseNameKey('seated calf raise'));
    expect(exerciseNameKey('Presses')).toBe(exerciseNameKey('press'));
    const pool = [
      { id: 'a', name: 'Seated calf raise', aliases: ['Seated calf machine'], source: 'catalogue' as const, archived: false },
      { id: 'b', name: 'Meadows row', aliases: [], source: 'custom' as const, archived: true },
      { id: 'c', name: 'Landmine row', aliases: [], source: 'custom' as const, archived: false },
    ];
    expect(exerciseNameClash('seated calf raises', pool)?.id).toBe('a');
    expect(exerciseNameClash('Seated calf machine', pool)?.id).toBe('a');
    expect(exerciseNameClash('Meadows row', pool)).toBeNull();
    expect(exerciseNameClash('Landmine row', pool, 'c')).toBeNull();
    expect(exerciseNameClash('Landmine rows', pool)?.id).toBe('c');
  });

  it('near duplicates (review exlist S3): same words in any order, filler aside, or a less specific name', () => {
    const pool = [
      { id: 'a', name: 'Seated calf raise', aliases: ['Seated calf machine'], source: 'catalogue' as const, archived: false },
      { id: 'b', name: 'Barbell row', aliases: [], source: 'catalogue' as const, archived: false },
      { id: 'c', name: 'Old row', aliases: [], source: 'custom' as const, archived: true },
    ];
    expect(exerciseNearDuplicate('Seated calf raises', pool)).toMatchObject({ hit: { id: 'a' }, near: false });
    expect(exerciseNearDuplicate('Seated calf raise machine', pool)).toMatchObject({ hit: { id: 'a' }, near: true });
    expect(exerciseNearDuplicate('Calf raise (seated)', pool)).toMatchObject({ hit: { id: 'a' }, near: true });
    expect(exerciseNearDuplicate('Machine seated calf', pool)).toMatchObject({ hit: { id: 'a' }, near: true });
    expect(exerciseNearDuplicate('Row barbell', pool)).toMatchObject({ hit: { id: 'b' }, near: true });
    // More specific than an existing name: a different exercise.
    expect(exerciseNearDuplicate('Meadows barbell row', pool)).toBeNull();
    expect(exerciseNearDuplicate('Meadows row', pool)).toBeNull();
    // One word alone is never "near"; deleted ones and self are ignored.
    expect(exerciseNearDuplicate('Calf', pool)).toBeNull();
    expect(exerciseNearDuplicate('Row old', pool)).toBeNull();
    expect(exerciseNearDuplicate('Row barbell', pool, 'b')).toBeNull();
  });

  it('create, edit (shape locked once logged), delete keeps the row; IDs are stable per card and per form', () => {
    const id = customExerciseIdOf('owner', { proposalActionId: 'act-1' });
    expect(id).toBe(customExerciseIdOf('owner', { proposalActionId: 'act-1' }));
    expect(id).not.toBe(customExerciseIdOf('owner', { opId: 'act-1' }));
    const e = newCustomExercise(F, { id, ownerId: 'owner', atUtc: '2026-10-19T07:00:00.000Z', opId: 'op-1' });
    expect(e).toMatchObject({ source: 'custom', ownerId: 'owner', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', movementPattern: 'other', catalogueKey: null, version: 1 });
    expect(editedCustomExercise(e, { ...F, name: 'Meadows row (LM)' }, { atUtc: '2026-10-19T08:00:00.000Z', opId: 'op-2', inUse: true })).toMatchObject({ ok: true, exercise: { name: 'Meadows row (LM)', version: 2 } });
    expect(editedCustomExercise(e, { ...F, equipment: 'dumbbells', loadConvention: 'per_hand' }, { atUtc: '2026-10-19T08:00:00.000Z', opId: 'op-3', inUse: true })).toMatchObject({ ok: false, reason: 'locked' });
    expect(editedCustomExercise(e, { ...F, equipment: 'dumbbells', loadConvention: 'per_hand' }, { atUtc: '2026-10-19T08:00:00.000Z', opId: 'op-3', inUse: false })).toMatchObject({ ok: true, exercise: { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' } });
    const gone = archivedCustomExercise(e, { atUtc: '2026-10-19T09:00:00.000Z', opId: 'op-4' });
    expect([isArchivedExercise(e), isArchivedExercise(gone), gone.version, gone.name]).toEqual([false, true, 2, 'Meadows row']);
  });

  it('the card line', () => {
    expect(customExerciseLine(F)).toBe('Meadows row · Barbell · total load · Back, Biceps · reps');
    expect(customExerciseLine({ ...F, equipment: 'plate_loaded_machine', loadConvention: 'added', primaryMuscles: ['calves'], laterality: 'unilateral' })).toBe('Meadows row · Plate-loaded · plates added · Calves · reps · each side');
  });
});
