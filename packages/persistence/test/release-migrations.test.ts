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
 * Run by the iOS workflow's check job (`FIZZ_RELEASE_CHECK=1`) before any
 * `.ipa` is built. Skipped in the everyday suite while this branch carries
 * the reserved 8 and 9 (MERGE NOTE in migrations.ts).
 */
describe.runIf(process.env.FIZZ_RELEASE_CHECK === '1')('release: no placeholder migrations', () => {
  it('every migration in the build has SQL', () => {
    expect(emptyMigrations(MIGRATIONS), 'Placeholder migrations would ship: replace them with the real ones before building').toEqual([]);
  });
});
