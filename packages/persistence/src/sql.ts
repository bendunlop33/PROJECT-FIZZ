import { validate, type ValidationIssue } from '@fizz/schemas';
import type { z } from 'zod';
import type { SqlExecutor, SqlRunResult, SqlValue } from './driver';
import { CorruptDataError, InvalidRecordError } from './errors';

/** Quote an identifier. Only ever used with names from this package or from `sqlite_master`. */
export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function insert(tx: SqlExecutor, table: string, row: Record<string, SqlValue>): Promise<SqlRunResult> {
  const cols = Object.keys(row);
  return tx.run(
    `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c] ?? null),
  );
}

/**
 * Insert, or update the row with the same key. `guard` is an SQL condition on
 * the existing row (e.g. it belongs to the same session); when it fails the
 * update is skipped and `changes` is 0, which callers treat as an error.
 */
export function upsert(
  tx: SqlExecutor,
  table: string,
  key: readonly string[],
  row: Record<string, SqlValue>,
  guard?: string,
): Promise<SqlRunResult> {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !key.includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`);
  return tx.run(
    `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT (${key.map(ident).join(', ')}) DO UPDATE SET ${updates.join(', ')}${guard ? ` WHERE ${guard}` : ''}`,
    cols.map((c) => row[c] ?? null),
  );
}

/** Parse a JSON column. Malformed text is corruption, never a default. */
export function parseJson(table: string, id: string, column: string, value: SqlValue): unknown {
  if (typeof value !== 'string') throw new CorruptDataError(table, id, [{ path: column, message: 'Expected JSON text' }]);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CorruptDataError(table, id, [{ path: column, message: 'Malformed JSON' }]);
  }
}

export function parseJsonOrNull(table: string, id: string, column: string, value: SqlValue): unknown {
  return value === null ? null : parseJson(table, id, column, value);
}

/** Validate a value read from storage; throw `CorruptDataError` on any issue. */
export function checkRead<S extends z.ZodType>(schema: S, value: unknown, table: string, id: string): z.infer<S> {
  const r = validate(schema, value);
  if (!r.ok) throw new CorruptDataError(table, id, r.issues);
  return r.value;
}

/** Validate a value before writing it; throw `InvalidRecordError` on any issue. */
export function checkWrite<S extends z.ZodType>(schema: S, value: unknown, table: string, id: string): z.infer<S> {
  const r = validate(schema, value);
  if (!r.ok) throw new InvalidRecordError(table, id, r.issues);
  return r.value;
}

/**
 * SQLite 0/1 to boolean. Anything else is passed through unchanged so the
 * schema rejects it, rather than being guessed into a boolean.
 */
export function bool(value: SqlValue): unknown {
  return value === 1 ? true : value === 0 ? false : value;
}

export const int = (b: boolean): number => (b ? 1 : 0);

export function mismatch(table: string, id: string, column: string, message: string): CorruptDataError {
  const issue: ValidationIssue = { path: column, message };
  return new CorruptDataError(table, id, [issue]);
}

/** Id of a row for error messages, without trusting its type. */
export function rowId(value: SqlValue | undefined): string {
  return typeof value === 'string' ? value : String(value);
}
