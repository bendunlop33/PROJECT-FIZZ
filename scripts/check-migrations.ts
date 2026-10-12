/**
 * Release gate for the database schema (review coach-tools B1).
 *
 * Fails (exit 1) while any migration is a placeholder: a `reserved-` name or
 * empty SQL. `migrate()` only checks `PRAGMA user_version`, so a build that
 * ran a placeholder would leave the phone (and any backup taken on it) past
 * the real migration for good. The iOS build workflow runs this before
 * spending macOS minutes.
 *
 *   node --experimental-transform-types --import ./packages/catalogue/scripts/ts-hooks.ts scripts/check-migrations.ts
 *
 * (`--experimental-transform-types`: migration 8 declares a class with
 * parameter properties, which plain type stripping refuses.)
 */
import { pathToFileURL } from 'node:url';

import { MIGRATIONS, releaseBlockers } from '../packages/persistence/src/migration-list.ts';

export function migrationReport(blockers: ReturnType<typeof releaseBlockers>): { ok: boolean; lines: string[] } {
  if (blockers.length === 0) return { ok: true, lines: [`Migrations OK: 1 to ${String(MIGRATIONS.length)}, none reserved or empty.`] };
  return {
    ok: false,
    lines: [
      ...blockers.map((b) => `Migration ${String(b.version)} (${b.name}) is ${b.why === 'reserved' ? 'a reserved placeholder' : 'empty'}.`),
      'Merge the branches that own these versions first. No .ipa may ship a placeholder migration.',
    ],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = migrationReport(releaseBlockers(MIGRATIONS));
  for (const line of r.lines) (r.ok ? console.log : console.error)(r.ok ? line : `::error::${line}`);
  process.exit(r.ok ? 0 : 1);
}
