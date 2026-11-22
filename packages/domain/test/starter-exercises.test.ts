import { describe, expect, it } from 'vitest';
import { ExerciseSchema } from '@fizz/schemas';

import { searchExercises, starterExerciseId, starterExercises } from '../src/index';

describe('starter exercise list (until the catalogue is wired)', () => {
  const list = starterExercises('2026-10-09T00:00:00.000Z');

  it('is valid Coaching knowledge with IDs derived from catalogue keys', () => {
    for (const e of list) expect(ExerciseSchema.safeParse(e).success).toBe(true);
    expect(list.every((e) => e.ownerId === null && e.source === 'catalogue')).toBe(true);
    expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
    expect(list.find((e) => e.name === 'Bench press')?.id).toBe(starterExerciseId('barbell-bench-press'));
    // Stable across builds: the same key always gives the same ID.
    expect(starterExerciseId('barbell-bench-press')).toBe(starterExerciseId('barbell-bench-press'));
  });

  it('searches by word starts, case-insensitively', () => {
    expect(searchExercises(list, 'bench').map((e) => e.name)).toEqual(['Bench press', 'Dumbbell bench press', 'Incline bench press']);
    expect(searchExercises(list, 'db ROW')).toEqual([]);
    expect(searchExercises(list, 'one arm').map((e) => e.name)).toEqual(['One-arm dumbbell row']);
    expect(searchExercises(list, '').length).toBe(list.length);
  });
});
