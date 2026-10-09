import type { FitNotesVariant, WeightUnit } from '@fizz/schemas';
import { firstLine, normaliseText, parseCsv, type CsvDelimiter } from './csv';

/**
 * FitNotes and FitNotes 2 workout CSVs (research `fitnotes-export-format.md`
 * §2–§5; data-import-export.md §2.5, §3.4). Pure: detection and row parsing
 * only. Nothing is guessed:
 * - an unrecognised header stops the import (DX5); there is no column mapping;
 * - units come from the header (A), the `Weight Unit` cell (B) or the filled
 *   weight column (C), per row, and are never converted between kg and lb;
 * - anything that doesn't parse exactly becomes an unreadable row that keeps
 *   its raw text.
 * Files are data, never instructions (rule 8).
 */

const A_BASE = ['Date', 'Exercise', 'Category'] as const;
const DTS = ['Distance', 'Distance Unit', 'Time'] as const;

/** Exact header cells per variant, in order (research §2). */
export const FITNOTES_HEADERS: Readonly<Record<FitNotesVariant, readonly string[]>> = {
  'A1-kg': [...A_BASE, 'Weight (kgs)', 'Reps', ...DTS],
  'A1-lb': [...A_BASE, 'Weight (lbs)', 'Reps', ...DTS],
  'A2-kg': [...A_BASE, 'Weight (kgs)', 'Reps', ...DTS, 'Comment'],
  'A2-lb': [...A_BASE, 'Weight (lbs)', 'Reps', ...DTS, 'Comment'],
  B1: [...A_BASE, 'Weight', 'Weight Unit', 'Reps', ...DTS],
  B2: [...A_BASE, 'Weight', 'Weight Unit', 'Reps', ...DTS, 'Comment'],
  C: [...A_BASE, 'Weight (kg)', 'Weight (lbs)', 'Reps', ...DTS, 'Notes', 'Kind'],
};

/** Which app wrote it, for the preview line (`FitNotes (Android) CSV`, `FitNotes 2 (iPhone) CSV`). */
export function fitNotesApp(variant: FitNotesVariant): 'android' | 'fitnotes2' {
  return variant === 'C' ? 'fitnotes2' : 'android';
}

export function variantHasComments(variant: FitNotesVariant): boolean {
  return variant === 'A2-kg' || variant === 'A2-lb' || variant === 'B2' || variant === 'C';
}

const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];
const MAX_FIRST_LINE = 2000;

/** What a chosen file is, decided from its content (never its name: FitNotes lets users rename exports). */
export type FileKind =
  | { kind: 'empty' }
  /** SQLite magic: a `.fitnotes` backup or a FitNotes 2 database. */
  | { kind: 'fitnotes_backup' }
  /** A zip (`PK\x03\x04`) or other binary file. */
  | { kind: 'not_csv' }
  /** `Date` but no `Exercise`: probably a Body Tracker export. */
  | { kind: 'body_tracker'; firstLine: string }
  | { kind: 'unknown_header'; firstLine: string }
  | { kind: 'fitnotes'; variant: FitNotesVariant; delimiter: CsvDelimiter; firstLine: string };

function clip(line: string): string {
  return line.length > MAX_FIRST_LINE ? `${line.slice(0, MAX_FIRST_LINE)}…` : line;
}

function sameCells(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Detect the file kind and FitNotes variant from the first line. Header
 * cells are trimmed; the match is otherwise exact and case-sensitive (a case
 * difference is an unknown header). Comma, semicolon and tab are tried, and
 * accepted only when the header then matches a known layout (§4.3).
 */
export function detectFitNotesFile(text: string): FileKind {
  if (text.startsWith('SQLite format 3\u0000')) return { kind: 'fitnotes_backup' };
  if (text.startsWith('PK\u0003\u0004')) return { kind: 'not_csv' };
  const t = normaliseText(text);
  if (t.trim() === '') return { kind: 'empty' };
  if (t.slice(0, 4096).includes('\u0000')) return { kind: 'not_csv' };
  const line = firstLine(t);
  for (const delimiter of DELIMITERS) {
    const header = parseCsv(line, delimiter)[0];
    if (!header || header.problem !== null) continue;
    const cells = header.cells.map((c) => c.trim());
    for (const [variant, expected] of Object.entries(FITNOTES_HEADERS) as [FitNotesVariant, readonly string[]][]) {
      if (sameCells(cells, expected)) return { kind: 'fitnotes', variant, delimiter, firstLine: clip(line) };
    }
  }
  for (const delimiter of DELIMITERS) {
    const cells = (parseCsv(line, delimiter)[0]?.cells ?? []).map((c) => c.trim());
    if (cells.includes('Date') && !cells.includes('Exercise')) return { kind: 'body_tracker', firstLine: clip(line) };
  }
  return { kind: 'unknown_header', firstLine: clip(line) };
}

/**
 * - `strength`: weight and/or reps, no distance or time (imported).
 * - `cardio`: a distance, with or without time, and no weight or reps
 *   (skipped and listed, P-I4).
 * - `unsupported`: a timed set (time only: a plank, or a bike session; the
 *   columns can't tell them apart), a timed or distance set with weight or
 *   reps (a weighted carry), or weight with no reps. Not importable until
 *   spec change S3 is decided (skipped and listed).
 * - `unreadable`: the row couldn't be read exactly; `problem` says why.
 */
export type RowClass = 'strength' | 'cardio' | 'unsupported' | 'unreadable';

export interface FitNotesRow {
  /** Spreadsheet row number (header = 1). */
  row: number;
  /** Physical line the record starts on. */
  line: number;
  /** Raw cells as written (provenance). */
  cells: string[];
  /** Valid `YYYY-MM-DD`, else null. */
  date: string | null;
  /** Exercise name, trimmed. Data only. */
  exercise: string;
  /** The entered weight with its unit. Null when blank, or when a FitNotes 2 row has both columns (see `bothColumns`). */
  weight: { value: number; unit: WeightUnit } | null;
  /** FitNotes 2 only: both weight columns filled; which one was entered is asked once per file. */
  bothColumns: { kg: number; lb: number } | null;
  reps: number | null;
  /** Raw distance, distance unit and time (never imported; shown when listed). */
  distance: string;
  distanceUnit: string;
  time: string;
  /** Set comment (`Comment` / `Notes`), as written; '' when none or no such column. */
  comment: string;
  rowClass: RowClass;
  /** Why it is unreadable or unsupported, for the results list. */
  problem: string | null;
  /** The row uses a decimal comma (`22,5`), so it was unreadable: worth telling Ben (§5). */
  decimalComma: boolean;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const DECIMAL_COMMA = /^-?\d+,\d+$/;
const WHOLE = /^\d+(\.0+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KIND = /^[wrdt]{1,4}$/;
export const MAX_REPS = 1000;

/** Strict `YYYY-MM-DD` that is a real calendar date. */
export function isCalendarDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  return d <= days;
}

class Unreadable extends Error {
  constructor(
    message: string,
    readonly decimalComma = false,
  ) {
    super(message);
  }
}

function parseNumber(raw: string, label: string): number | null {
  const v = raw.trim();
  if (v === '') return null;
  if (NUMBER.test(v)) return Number(v);
  if (DECIMAL_COMMA.test(v)) throw new Unreadable(`${label} uses a decimal comma (${v})`, true);
  throw new Unreadable(`${label} isn’t a number (${v})`);
}

function parseReps(raw: string): number | null {
  const v = raw.trim();
  if (v === '') return null;
  if (DECIMAL_COMMA.test(v)) throw new Unreadable(`Reps uses a decimal comma (${v})`, true);
  if (!WHOLE.test(v)) throw new Unreadable(`Reps isn’t a whole number (${v})`);
  const reps = Number(v);
  if (reps > MAX_REPS) throw new Unreadable(`Reps is more than ${MAX_REPS} (${v})`);
  return reps;
}

/** `Weight Unit` (B files). Only these spellings are accepted (research recommendation 3). */
function parseUnitCell(raw: string): WeightUnit | null {
  const v = raw.trim().toLowerCase();
  if (v === 'kgs' || v === 'kg') return 'kg';
  if (v === 'lbs' || v === 'lb') return 'lb';
  return null;
}

interface Cols {
  date: string;
  exercise: string;
  reps: string;
  distance: string;
  distanceUnit: string;
  time: string;
  comment: string;
  kind: string | null;
}

/** Map a variant's cells to named columns (positions from `FITNOTES_HEADERS`). */
function columns(variant: FitNotesVariant, cells: readonly string[]): Cols {
  const header = FITNOTES_HEADERS[variant];
  const at = (name: string): string => {
    const i = header.indexOf(name);
    return i === -1 ? '' : (cells[i] ?? '');
  };
  return {
    date: at('Date'),
    exercise: at('Exercise'),
    reps: at('Reps'),
    distance: at('Distance'),
    distanceUnit: at('Distance Unit'),
    time: at('Time'),
    comment: variant === 'C' ? at('Notes') : at('Comment'),
    kind: variant === 'C' ? at('Kind') : null,
  };
}

function readWeight(variant: FitNotesVariant, cells: readonly string[]): { weight: FitNotesRow['weight']; bothColumns: FitNotesRow['bothColumns'] } {
  const header = FITNOTES_HEADERS[variant];
  const cell = (name: string) => cells[header.indexOf(name)] ?? '';
  switch (variant) {
    case 'A1-kg':
    case 'A2-kg': {
      const v = parseNumber(cell('Weight (kgs)'), 'Weight');
      return { weight: v === null ? null : { value: v, unit: 'kg' }, bothColumns: null };
    }
    case 'A1-lb':
    case 'A2-lb': {
      const v = parseNumber(cell('Weight (lbs)'), 'Weight');
      return { weight: v === null ? null : { value: v, unit: 'lb' }, bothColumns: null };
    }
    case 'B1':
    case 'B2': {
      const v = parseNumber(cell('Weight'), 'Weight');
      if (v === null) return { weight: null, bothColumns: null };
      const rawUnit = cell('Weight Unit');
      const unit = parseUnitCell(rawUnit);
      if (unit === null) throw new Unreadable(rawUnit.trim() === '' ? 'Weight has no unit' : `Weight unit isn’t kg or lb (${rawUnit.trim()})`);
      return { weight: { value: v, unit }, bothColumns: null };
    }
    case 'C': {
      const kg = parseNumber(cell('Weight (kg)'), 'Weight (kg)');
      const lb = parseNumber(cell('Weight (lbs)'), 'Weight (lbs)');
      // Both zero says nothing about the unit and adds no load: same as blank.
      if (kg === 0 && lb === 0) return { weight: null, bothColumns: null };
      if (kg !== null && lb !== null) return { weight: null, bothColumns: { kg, lb } };
      if (kg !== null) return { weight: { value: kg, unit: 'kg' }, bothColumns: null };
      if (lb !== null) return { weight: { value: lb, unit: 'lb' }, bothColumns: null };
      return { weight: null, bothColumns: null };
    }
  }
}

/**
 * Parse one data record. `today` (`YYYY-MM-DD` in the import's zone): a later
 * date is a planned workout, not history, so it isn’t imported.
 */
export function parseFitNotesRow(
  variant: FitNotesVariant,
  record: { row: number; line: number; cells: string[]; problem: string | null },
  today: string,
): FitNotesRow {
  const header = FITNOTES_HEADERS[variant];
  const c = columns(variant, record.cells);
  const base: FitNotesRow = {
    row: record.row,
    line: record.line,
    cells: record.cells,
    date: null,
    exercise: c.exercise.trim(),
    weight: null,
    bothColumns: null,
    reps: null,
    distance: c.distance.trim(),
    distanceUnit: c.distanceUnit.trim(),
    time: c.time.trim(),
    comment: c.comment,
    rowClass: 'unreadable',
    problem: null,
    decimalComma: false,
  };
  const unreadable = (problem: string, decimalComma = false): FitNotesRow => ({ ...base, rowClass: 'unreadable', problem, decimalComma });

  if (record.problem !== null) return unreadable(record.problem);
  if (record.cells.length !== header.length) {
    return unreadable(`This row has ${record.cells.length} values; the header has ${header.length}`);
  }
  const date = c.date.trim();
  if (!isCalendarDate(date)) return unreadable(`Date isn’t a YYYY-MM-DD date (${date === '' ? 'blank' : date})`);
  const dated = { ...base, date };
  if (date > today) return { ...dated, rowClass: 'unreadable', problem: 'Date is after today (a planned workout, not one done)' };
  if (dated.exercise === '') return { ...dated, rowClass: 'unreadable', problem: 'No exercise name' };
  if (c.kind !== null && c.kind.trim() !== '' && (!KIND.test(c.kind.trim()) || new Set(c.kind.trim()).size !== c.kind.trim().length)) {
    return { ...dated, rowClass: 'unreadable', problem: `Kind isn’t made of w, r, d and t (${c.kind.trim()})` };
  }

  let weight: FitNotesRow['weight'];
  let bothColumns: FitNotesRow['bothColumns'];
  let reps: number | null;
  try {
    ({ weight, bothColumns } = readWeight(variant, record.cells));
    reps = parseReps(c.reps);
    // Distance must at least be a number when present; time is kept as written (never imported).
    parseNumber(c.distance, 'Distance');
  } catch (e) {
    if (e instanceof Unreadable) return { ...dated, rowClass: 'unreadable', problem: e.message, decimalComma: e.decimalComma };
    throw e;
  }
  const parsed = { ...dated, weight, bothColumns, reps };
  const hasWeight = weight !== null || bothColumns !== null;
  const hasReps = reps !== null;
  const hasDistance = parsed.distance !== '';
  const hasTime = parsed.time !== '';
  if (!hasWeight && !hasReps && !hasDistance && !hasTime) return { ...parsed, rowClass: 'unreadable', problem: 'No weight, reps, distance or time' };
  if (hasDistance && !hasWeight && !hasReps) return { ...parsed, rowClass: 'cardio', problem: null };
  // Time only can be a plank or a bike session: the columns can't tell, so it isn't called cardio.
  if (hasTime && !hasDistance && !hasWeight && !hasReps) return { ...parsed, rowClass: 'unsupported', problem: 'Timed set' };
  if (hasDistance || hasTime) return { ...parsed, rowClass: 'unsupported', problem: 'Timed or distance set with weight or reps' };
  if (!hasReps) return { ...parsed, rowClass: 'unsupported', problem: 'Weight with no reps' };
  return { ...parsed, rowClass: 'strength', problem: null };
}

export type FitNotesParse =
  | { ok: false; file: Exclude<FileKind, { kind: 'fitnotes' }> }
  | {
      ok: true;
      variant: FitNotesVariant;
      delimiter: CsvDelimiter;
      firstLine: string;
      /** Data rows only (the header is row 1). */
      rows: FitNotesRow[];
    };

/** Detect, then parse every data row. `today` is `YYYY-MM-DD` in the import's zone. */
export function parseFitNotesCsv(text: string, today: string): FitNotesParse {
  const file = detectFitNotesFile(text);
  if (file.kind !== 'fitnotes') return { ok: false, file };
  const records = parseCsv(text, file.delimiter);
  const rows = records.slice(1).map((r) => parseFitNotesRow(file.variant, r, today));
  return { ok: true, variant: file.variant, delimiter: file.delimiter, firstLine: file.firstLine, rows };
}
