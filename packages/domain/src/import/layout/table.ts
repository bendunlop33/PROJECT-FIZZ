import type { ImportProfile, LayoutFingerprint, TableDelimiter } from '@fizz/schemas';
import { normaliseText, parseCsv, type CsvRecord } from '../csv';
import { detectFitNotesFile } from '../fitnotes';

/**
 * Detection for import from any app (data-import-export §9.3.1). Pure and
 * on the phone: nothing leaves it here. A file is decided from its content,
 * never its name. Files are data, never instructions (rule 8).
 */

export interface Table {
  delimiter: TableDelimiter;
  /** `### … ###` section markers (JEFIT). Not read in v1. */
  sections: string[];
  /** The header cells, exactly as written. */
  header: string[];
  /** Data records (the header is row 1). */
  records: CsvRecord[];
}

const DELIMITERS: readonly TableDelimiter[] = [',', ';', '\t'];
const SECTION = /^\s*###.*###\s*$/;
/** The share of records that must have the header's cell count (§9.3.1). */
export const TABLE_SHAPE_SHARE = 0.95;

/** Section marker lines (`### WORKOUT SESSIONS ###`), in order. */
export function sectionMarkers(text: string): string[] {
  return normaliseText(text)
    .split('\n')
    .filter((l) => SECTION.test(l))
    .map((l) => l.trim());
}

/**
 * Read the text as a table: the delimiter that gives the header's cell count
 * on at least 95% of records, with at least 2 columns and 2 data rows. When
 * several do, the one giving the most columns. Null when it isn't a table.
 */
export function readTable(text: string): Table | null {
  const sections = sectionMarkers(text);
  let best: Table | null = null;
  for (const delimiter of DELIMITERS) {
    const records = parseCsv(text, delimiter);
    const header = records[0];
    if (!header || header.problem !== null || header.cells.length < 2) continue;
    const data = records.slice(1);
    if (data.length < 2) continue;
    const same = data.filter((r) => r.cells.length === header.cells.length).length;
    if (same / data.length < TABLE_SHAPE_SHARE) continue;
    if (best === null || header.cells.length > best.header.length) best = { delimiter, sections, header: header.cells, records: data };
  }
  return best;
}

export type NotReadableReason = 'empty' | 'spreadsheet_file' | 'pdf_or_image' | 'app_backup' | 'no_numbers' | 'binary' | 'sections' | 'not_a_table';

/**
 * What a chosen file is (§9.3.1, §9.6.3 `previewImport`'s `detection`).
 * - `fitnotes`: one of the 7 known FitNotes headers (ADR 0016; unchanged).
 * - `saved_layout`: same header cells, delimiter and sections as a saved layout in use.
 * - `saved_layout_changed`: same delimiter, every column the layout reads
 *   values from is present under its exact name; others added or missing.
 * - `new_table`: any other table.
 * - `not_readable`: why, for one line of copy. `sections` (JEFIT) and
 *   `not_a_table` (notes) are later slices (ADR 0026).
 */
export type LayoutDetection =
  | { kind: 'fitnotes' }
  | { kind: 'saved_layout'; profileId: string; version: number; table: Table }
  | { kind: 'saved_layout_changed'; profileId: string; version: number; table: Table; added: number[]; missing: string[] }
  | { kind: 'new_table'; table: Table; firstLine: string }
  | { kind: 'not_readable'; reason: NotReadableReason; firstLine: string | null };

function sameCells(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function fingerprintOf(t: Pick<Table, 'delimiter' | 'header' | 'sections'>): LayoutFingerprint {
  return { delimiter: t.delimiter, header: [...t.header], sections: [...t.sections] };
}

export function sameFingerprint(a: LayoutFingerprint, b: LayoutFingerprint): boolean {
  return a.delimiter === b.delimiter && sameCells(a.header, b.header) && sameCells(a.sections, b.sections);
}

/** The header cells the layout reads stored values from (date, exercise, load, reps and set columns): all must be present for a changed-columns match (§9.2.7). */
export function requiredHeaders(p: Pick<ImportProfile, 'spec' | 'fingerprint' | 'answers'>): string[] {
  const s = p.spec;
  const out = [s.date.column.header, s.exercise.header];
  if (s.load) out.push(s.load.column.header);
  if (s.reps) out.push(s.reps.header);
  if (s.layout.kind === 'row_per_exercise_packed') out.push(s.layout.sets.header);
  if (s.layout.kind === 'wide_set_columns') out.push(...s.layout.setColumns.map((c) => c.header));
  // Columns Ben gave a value role to (by index in the layout's own header).
  for (const [k, role] of Object.entries(p.answers.roles)) {
    if (role === 'notes' || role === 'not_imported') continue;
    const h = p.fingerprint.header[Number(k)];
    if (h !== undefined) out.push(h);
  }
  return [...new Set(out)];
}

/**
 * Detect the file. `profiles`: saved layouts still in use, already decoded
 * (a damaged one never reaches here; check 57).
 */
export function detectLayoutFile(text: string, profiles: readonly ImportProfile[]): LayoutDetection {
  const head = text.slice(0, 64);
  if (text.startsWith('SQLite format 3\u0000')) return { kind: 'not_readable', reason: 'app_backup', firstLine: null };
  if (text.startsWith('PK\u0003\u0004')) return { kind: 'not_readable', reason: 'spreadsheet_file', firstLine: null };
  if (text.startsWith('%PDF') || text.startsWith('\u0089PNG') || text.startsWith('ÿØÿ') || /^....ftyp(heic|heix|mif1|avif)/.test(head)) {
    return { kind: 'not_readable', reason: 'pdf_or_image', firstLine: null };
  }
  const fit = detectFitNotesFile(text);
  if (fit.kind === 'fitnotes') return { kind: 'fitnotes' };
  if (fit.kind === 'fitnotes_backup') return { kind: 'not_readable', reason: 'app_backup', firstLine: null };
  if (fit.kind === 'empty') return { kind: 'not_readable', reason: 'empty', firstLine: null };
  if (fit.kind === 'not_csv') return { kind: 'not_readable', reason: 'binary', firstLine: null };
  const t = normaliseText(text);
  const firstLine = (t.split('\n').find((l) => l.trim() !== '') ?? '').slice(0, 2000);
  if (!/\d/.test(t)) return { kind: 'not_readable', reason: 'no_numbers', firstLine };
  if (sectionMarkers(t).length > 0) return { kind: 'not_readable', reason: 'sections', firstLine };
  const table = readTable(t);
  if (table === null) return { kind: 'not_readable', reason: 'not_a_table', firstLine };
  const fp = fingerprintOf(table);
  const live = profiles.filter((p) => p.deletedAt === null);
  const exact = live.find((p) => sameFingerprint(p.fingerprint, fp));
  if (exact) return { kind: 'saved_layout', profileId: exact.id, version: exact.version, table };
  // Changed columns: same delimiter and sections, header names unique, every required column present by name.
  const unique = new Set(table.header).size === table.header.length;
  if (unique) {
    for (const p of live) {
      if (p.fingerprint.delimiter !== table.delimiter || !sameCells(p.fingerprint.sections, table.sections)) continue;
      if (new Set(p.fingerprint.header).size !== p.fingerprint.header.length) continue;
      if (!requiredHeaders(p).every((h) => table.header.includes(h))) continue;
      const added = table.header.flatMap((h, i) => (p.fingerprint.header.includes(h) ? [] : [i]));
      const missing = p.fingerprint.header.filter((h) => !table.header.includes(h));
      return { kind: 'saved_layout_changed', profileId: p.id, version: p.version, table, added, missing };
    }
  }
  return { kind: 'new_table', table, firstLine };
}
