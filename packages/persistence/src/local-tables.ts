import { isDerivedTable } from './history-summaries';

/**
 * (ADR 0035) Your-data tables local to this install: what was read from Apple Health and the Health switches.
 * Health is their source and iOS permission is per install, so they are read again rather than restored. Like the
 * derived tables they are left out of backups, exports, content comparisons and counts, so Delete my data (which
 * builds a new database from the backed-up tables) removes them.
 */
export const LOCAL_ONLY_TABLES = ['health_samples', 'health_settings'] as const;

/** A table a backup or export doesn't hold: derived (rebuilt on open) or local to this install (read again). */
export function isUnbackedTable(name: string): boolean {
  return isDerivedTable(name) || (LOCAL_ONLY_TABLES as readonly string[]).includes(name);
}
