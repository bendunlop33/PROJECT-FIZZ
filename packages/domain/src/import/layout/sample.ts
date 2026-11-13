import type { ImportSampleV1 } from '@fizz/schemas';
import type { Table } from './table';

/**
 * What a layout request sends (AI8, §9.6.1): the column names and up to 30
 * rows that code chooses, with free-text columns masked. Pure and
 * deterministic: the same file and hidden columns give the same text, so the
 * request is byte for byte the text Ben can see (`sampleJson`, check 36).
 * Nothing else from GymSmarter is in it (check 38).
 */

export type ColumnKind = 'number' | 'date' | 'short_text' | 'notes';

export const SAMPLE_ROWS_MAX = 30;
/** A value longer than this makes its column free text (§9.2.3). */
export const NOTES_VALUE_CHARS = 40;

const NUMBERISH = /^-?\d+([.,]\d+)?$/;
const DATEISH = /^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{4}( \d{1,2}:\d{2}(:\d{2})?)?|\d{1,2} [A-Za-z]{3,9}\.? \d{4},? \d{1,2}:\d{2}|\d{9,10})$/;

/**
 * A column's kind, from its values only (§9.2.3): free text when any value
 * is longer than 40 characters, or when more than half its filled values are
 * unique and contain spaces. Such a column is always masked.
 */
export function columnKind(values: readonly string[]): ColumnKind {
  const filled = values.map((v) => v.trim()).filter((v) => v !== '');
  if (filled.some((v) => v.length > NOTES_VALUE_CHARS)) return 'notes';
  if (filled.length === 0) return 'short_text';
  const counts = new Map<string, number>();
  for (const v of filled) counts.set(v, (counts.get(v) ?? 0) + 1);
  const uniqueWithSpaces = filled.filter((v) => counts.get(v) === 1 && /\s/.test(v)).length;
  if (uniqueWithSpaces > filled.length / 2) return 'notes';
  if (filled.every((v) => NUMBERISH.test(v))) return 'number';
  if (filled.every((v) => DATEISH.test(v))) return 'date';
  return 'short_text';
}

export function columnValues(table: Pick<Table, 'records'>, index: number): string[] {
  return table.records.map((r) => r.cells[index] ?? '');
}

export function columnKinds(table: Pick<Table, 'header' | 'records'>): ColumnKind[] {
  return table.header.map((_, i) => columnKind(columnValues(table, i)));
}

/**
 * The rows sent, by index into `table.records` (§9.6.1), in file order:
 * the first 10, the last 5, one row per distinct value of each column with
 * 20 or fewer (fewest first: markers and unit words), then rows with an
 * empty number cell. At most 30.
 */
export function sampleRowIndexes(table: Pick<Table, 'header' | 'records'>, kinds: readonly ColumnKind[] = columnKinds(table)): number[] {
  const n = table.records.length;
  const chosen: number[] = [];
  const add = (i: number): void => {
    if (i >= 0 && i < n && !chosen.includes(i) && chosen.length < SAMPLE_ROWS_MAX) chosen.push(i);
  };
  for (let i = 0; i < Math.min(10, n); i += 1) add(i);
  for (let i = Math.max(0, n - 5); i < n; i += 1) add(i);
  const byDistinct = table.header
    .map((_, c) => {
      const firstOf = new Map<string, number>();
      table.records.forEach((r, i) => {
        const v = (r.cells[c] ?? '').trim();
        if (v !== '' && !firstOf.has(v)) firstOf.set(v, i);
      });
      return { c, firstOf };
    })
    .filter((x) => x.firstOf.size > 0 && x.firstOf.size <= 20 && kinds[x.c] !== 'notes')
    .sort((a, b) => a.firstOf.size - b.firstOf.size || a.c - b.c);
  for (const { firstOf } of byDistinct) for (const i of firstOf.values()) add(i);
  const numberCols = kinds.flatMap((k, c) => (k === 'number' ? [c] : []));
  table.records.forEach((r, i) => {
    if (numberCols.some((c) => (r.cells[c] ?? '').trim() === '')) add(i);
  });
  return chosen.sort((a, b) => a - b);
}

export interface SampleOptions {
  /** Columns Ben switched off (`[hidden]`). Notes columns are masked whatever this says. */
  hidden: readonly number[];
}

export interface BuiltSample {
  sample: ImportSampleV1;
  /** `JSON.stringify(sample)`: the request's one user message, exactly. */
  json: string;
  chars: number;
  columns: { index: number; header: string; kind: ColumnKind; hidden: boolean; masked: boolean }[];
  /** Rows sent. */
  rows: number;
}

function mask(cell: string, kind: ColumnKind, hidden: boolean): string {
  if (hidden) return '[hidden]';
  if (kind === 'notes') return cell.trim() === '' ? '' : `[text, ${String(cell.length)} chars]`;
  return cell.slice(0, 200);
}

/** Build the sample text (§9.2.3 `Exactly as sent`). */
export function buildImportSample(table: Table, opts: SampleOptions): BuiltSample {
  const kinds = columnKinds(table);
  const hidden = new Set(opts.hidden.filter((i) => i >= 0 && i < table.header.length));
  const rows = sampleRowIndexes(table, kinds).map((i) => {
    const r = table.records[i];
    return { line: r?.line ?? 1, cells: table.header.map((_, c) => mask(r?.cells[c] ?? '', kinds[c] ?? 'short_text', hidden.has(c))) };
  });
  const sample: ImportSampleV1 = {
    kind: 'gymsmarter_import_sample',
    v: 1,
    delimiter: table.delimiter,
    sections: table.sections.map((s) => s.slice(0, 200)),
    header: table.header.map((h) => h.slice(0, 200)),
    rows,
  };
  const json = JSON.stringify(sample);
  return {
    sample,
    json,
    chars: json.length,
    columns: table.header.map((header, index) => ({ index, header, kind: kinds[index] ?? 'short_text', hidden: hidden.has(index), masked: hidden.has(index) || kinds[index] === 'notes' })),
    rows: rows.length,
  };
}
