import { describe, expect, it } from 'vitest';

import { emptyMigrations, MIGRATIONS, sqlMigration } from '../src/index';

/**
 * Review gaps S5: placeholder migrations (empty SQL) must never ship. A
 * database migrated past one records the version without the real change,
 * and the real migration then never runs.
 */
describe('emptyMigrations', () => {
  it('finds empty and whitespace-only SQL, nothing else', () => {
    expect(emptyMigrations([sqlMigration(1, 'a', 'CREATE TABLE t (x INTEGER);'), sqlMigration(2, 'b', ''), sqlMigration(3, 'c', '  \n ')])).toEqual([2, 3]);
    expect(emptyMigrations([{ version: 1, name: 'code', up: () => Promise.resolve() }])).toEqual([]);
  });
});

/**
 * Runs in the everyday suite and in the iOS workflow's check job before any
 * `.ipa` is built. The reserved 8 and 9 were replaced by the real
 * deleted-workouts and progress migrations when main merged in.
 */
describe('release: no placeholder migrations', () => {
  it('every migration in the build has SQL', () => {
    expect(emptyMigrations(MIGRATIONS), 'Placeholder migrations would ship: replace them with the real ones before building').toEqual([]);
  });
});
