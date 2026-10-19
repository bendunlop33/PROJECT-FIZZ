import { describe, expect, it } from 'vitest';
import type { Exercise } from '@fizz/schemas';

import { findExercises, type FindableExercise } from '../src/find-exercises';

const e = (catalogueId: string, name: string, over: Partial<Exercise> = {}, aliases: string[] = []): FindableExercise => ({
  catalogueId,
  aliases,
  exercise: { name, primaryMuscles: ['quads'], compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', measurement: 'reps', source: 'catalogue', ...over },
});

const POOL: FindableExercise[] = [
  e('machine-seated-calf-raise', 'Seated calf raise', { primaryMuscles: ['calves'], compatibleEquipment: ['plate_loaded_machine', 'weight_stack'], defaultLoadConvention: 'added' }, ['Seated calf machine']),
  e('standing-calf-raise', 'Standing calf raise', { primaryMuscles: ['calves'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' }),
  e('barbell-back-squat', 'Back squat'),
  e('romanian-deadlift', 'Romanian deadlift', { primaryMuscles: ['hamstrings'] }, ['RDL']),
  e('own-1', 'Meadows row', { primaryMuscles: ['lats'], source: 'custom' }),
  e('plank', 'Plank', { primaryMuscles: ['abs'], compatibleEquipment: [], defaultLoadConvention: 'bodyweight', measurement: 'duration' }),
];

describe('findExercises (pure)', () => {
  it('matches a name in Ben’s words, plural and all, best first', () => {
    const r = findExercises(POOL, { query: 'seated calf raises', muscle: null, equipment: null });
    expect(r[0]).toEqual({ catalogueId: 'machine-seated-calf-raise', name: 'Seated calf raise', equipment: 'plate loaded machine', measured: 'reps', muscles: ['calves'], yours: false });
  });
  it('aliases and typos', () => {
    expect(findExercises(POOL, { query: 'rdl', muscle: null, equipment: null }).map((x) => x.catalogueId)).toEqual(['romanian-deadlift']);
    expect(findExercises(POOL, { query: 'romanain deadlift', muscle: null, equipment: null }).map((x) => x.catalogueId)).toEqual(['romanian-deadlift']);
  });
  it('a muscle word as the query finds what trains it; muscle and equipment filters narrow', () => {
    expect(findExercises(POOL, { query: 'calves', muscle: null, equipment: null }).map((x) => x.name)).toEqual(['Seated calf raise', 'Standing calf raise']);
    expect(findExercises(POOL, { query: 'calf', muscle: 'calves', equipment: 'plate loaded' }).map((x) => x.name)).toEqual(['Seated calf raise']);
    expect(findExercises(POOL, { query: '', muscle: 'Core', equipment: null }).map((x) => [x.name, x.measured, x.equipment])).toEqual([['Plank', 'time', 'bodyweight']]);
  });
  it('Ben’s own exercises are marked; nothing matching is an empty list; capped', () => {
    expect(findExercises(POOL, { query: 'meadows', muscle: null, equipment: null })[0]?.yours).toBe(true);
    expect(findExercises(POOL, { query: 'zercher hover', muscle: null, equipment: null })).toEqual([]);
    expect(findExercises(POOL, { query: '', muscle: null, equipment: null }, 2)).toHaveLength(2);
  });
});
