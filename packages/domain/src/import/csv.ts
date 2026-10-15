/**
 * A small RFC 4180 CSV reader for imports (research `fitnotes-export-format`
 * §5). Pure and strict: it never guesses. A record it can't read is returned
 * with a `problem` (and the importer lists it as unreadable) instead of being
 * repaired.
 *
 * - A UTF-8 byte order mark is removed; CRLF, CR and LF all end a line.
 * - Quoted fields may hold the delimiter, line breaks and doubled quotes.
 * - Blank lines (empty, or only spaces) are skipped (a trailing newline is normal).
 * - Every record keeps the physical line it starts on, because a quoted line
 *   break shifts line numbers away from record numbers.
 */

export type CsvDelimiter = ',' | ';' | '\t';

export interface CsvRecord {
  /** 1-based count of non-blank records; the header is record 1 (a spreadsheet's row number). */
  row: number;
  /** 1-based physical line the record starts on. */
  line: number;
  cells: string[];
  /** Why the record couldn't be read as CSV, if it couldn't. Its cells are then a best-effort split, kept only for display. */
  problem: string | null;
}

/** Remove a leading byte order mark and normalise line endings to `\n`. */
export function normaliseText(text: string): string {
  const noBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
  return noBom.replace(/\r\n?/g, '\n');
}

/** The first physical line of the (normalised) text, as written. */
export function firstLine(text: string): string {
  const t = normaliseText(text);
  const end = t.indexOf('\n');
  return end === -1 ? t : t.slice(0, end);
}

/**
 * Parse `text` into records. `text` is normalised first. Never throws.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const t = normaliseText(text);
  const out: CsvRecord[] = [];
  let i = 0;
  let line = 1;
  let row = 0;
  const n = t.length;

  while (i < n) {
    const startLine = line;
    // A completely blank line is not a record.
    if (t[i] === '\n') {
      i += 1;
      line += 1;
      continue;
    }
    const cells: string[] = [];
    let problem: string | null = null;
    let cell = '';
    let endOfRecord = false;
    while (!endOfRecord) {
      if (i >= n) {
        cells.push(cell);
        break;
      }
      if (t[i] === '"' && cell === '') {
        // Quoted field.
        i += 1;
        let closed = false;
        while (i < n) {
          const ch = t.charAt(i);
          if (ch === '"') {
            if (t[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            i += 1;
            closed = true;
            break;
          }
          if (ch === '\n') line += 1;
          cell += ch;
          i += 1;
        }
        if (!closed) {
          problem ??= `A quoted value starting on line ${startLine} never ends`;
          cells.push(cell);
          break;
        }
        // After a closing quote: delimiter, end of line or end of file.
        if (i >= n) {
          cells.push(cell);
          break;
        }
        if (t[i] === delimiter) {
          cells.push(cell);
          cell = '';
          i += 1;
          continue;
        }
        if (t[i] === '\n') {
          cells.push(cell);
          i += 1;
          line += 1;
          endOfRecord = true;
          continue;
        }
        problem ??= 'Text after a closing quote';
        // Keep reading this cell as plain text so the record still ends at the right place.
        continue;
      }
      const ch = t.charAt(i);
      if (ch === delimiter) {
        cells.push(cell);
        cell = '';
        i += 1;
        continue;
      }
      if (ch === '\n') {
        cells.push(cell);
        i += 1;
        line += 1;
        endOfRecord = true;
        continue;
      }
      if (ch === '"') problem ??= 'A quote inside an unquoted value';
      cell += ch;
      i += 1;
    }
    // A line of only spaces is blank too.
    if (problem === null && cells.length === 1 && (cells[0] ?? '').trim() === '') continue;
    row += 1;
    out.push({ row, line: startLine, cells, problem });
  }
  return out;
}
