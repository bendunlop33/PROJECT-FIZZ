import type { ValidationIssue } from '@fizz/schemas';

/**
 * Stored data failed validation on read (or a row is structurally wrong).
 * Never repaired or guessed around: the caller sees the failure, and
 * `checkIntegrity` lists every such row.
 */
export class CorruptDataError extends Error {
  override readonly name = 'CorruptDataError';
  constructor(
    readonly table: string,
    readonly recordId: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(
      `Corrupt ${table} row ${recordId}: ${issues
        .slice(0, 3)
        .map((i) => `${i.path || '(root)'}: ${i.message}`)
        .join('; ')}`,
    );
  }
}

/** A record failed validation before being written. Nothing was written. */
export class InvalidRecordError extends Error {
  override readonly name = 'InvalidRecordError';
  constructor(
    readonly table: string,
    readonly recordId: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(`Refusing to write invalid ${table} record ${recordId}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
}

/**
 * A save would remove or rewrite history that is append-only (audit entries,
 * processed operations, pauses, sets, exercises). Nothing was written.
 */
export class HistoryRewriteError extends Error {
  override readonly name = 'HistoryRewriteError';
  constructor(
    readonly sessionId: string,
    detail: string,
  ) {
    super(`Session ${sessionId}: ${detail}`);
  }
}

/** The database was written by a newer build than this one. Left untouched. */
export class SchemaTooNewError extends Error {
  override readonly name = 'SchemaTooNewError';
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Database schema version ${found} is newer than this build supports (${supported}). Update the app.`);
  }
}
