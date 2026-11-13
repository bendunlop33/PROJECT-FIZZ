import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS, releaseBlockers, sqlMigration } from '../../packages/persistence/src/migration-list';
import { migrationReport } from '../check-migrations';

/**
 * Review coach-tools B1: a reserved or empty migration must never reach a
 * device or a backup. The release check fails while one is in the list, and
 * the iOS build workflow runs it before any macOS build.
 */
describe('releaseBlockers', () => {
  it('passes a list of real migrations', () => {
    expect(releaseBlockers([sqlMigration(1, 'initial', 'CREATE TABLE t (id TEXT);')])).toEqual([]);
  });

  it('names reserved placeholders and empty SQL', () => {
    const list = [sqlMigration(1, 'initial', 'CREATE TABLE t (id TEXT);'), sqlMigration(2, 'reserved-other-branch', ''), sqlMigration(3, 'oops', '  \n ')];
    expect(releaseBlockers(list)).toEqual([
      { version: 2, name: 'reserved-other-branch', why: 'reserved' },
      { version: 3, name: 'oops', why: 'empty' },
    ]);
    const r = migrationReport(releaseBlockers(list));
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/No \.ipa may ship a placeholder migration/);
  });

  it('a reserved name blocks even with SQL in it', () => {
    expect(releaseBlockers([sqlMigration(1, 'reserved-x', 'SELECT 1;')])).toHaveLength(1);
  });

  it('this list is consistent: every placeholder is caught, and real ones are not', () => {
    const blocked = new Set(releaseBlockers(MIGRATIONS).map((b) => b.version));
    for (const m of MIGRATIONS) {
      const placeholder = m.name.startsWith('reserved-') || (m.sql ?? 'x').trim() === '';
      expect(blocked.has(m.version)).toBe(placeholder);
    }
  });
});

describe('scripts/check-migrations.ts', () => {
  it('exits non-zero exactly when the list has a blocker', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './packages/catalogue/scripts/ts-hooks.ts', 'scripts/check-migrations.ts'], { encoding: 'utf8' });
    expect(r.status).toBe(releaseBlockers(MIGRATIONS).length === 0 ? 0 : 1);
  });

  it('runs in the iOS build workflow before the build job', () => {
    const wf = readFileSync('.github/workflows/ios-ipa.yml', 'utf8');
    expect(wf).toMatch(/run: npm run check:migrations/);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:migrations']).toContain('scripts/check-migrations.ts');
  });
});
