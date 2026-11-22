import type { ImportRow } from '@fizz/schemas';

/**
 * `Save row-by-row results (CSV)` (data-import-export §4.3): one line per
 * source row, `row, date, exercise, result, detail`. Pure. Values are quoted
 * per RFC 4180, and a value that a spreadsheet would run as a formula
 * (starting with `=`, `+`, `-`, `@`) gets a leading `'`: imported text is
 * data, never instructions (rule 8).
 */
export const RESULTS_CSV_HEADER = ['row', 'date', 'exercise', 'result', 'detail'] as const;

function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function importResultsCsv(rows: readonly ImportRow[]): string {
  const lines = [RESULTS_CSV_HEADER.join(',')];
  for (const r of [...rows].sort((a, b) => a.row - b.row)) {
    lines.push([String(r.row), r.localDate ?? '', r.exerciseName, r.result, r.detail ?? ''].map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
