import { EMPTY_LAYOUT_ANSWERS, ImportMappingSpecV1Schema, type ImportMappingSpecV1, type SpecCheckFailure } from '@fizz/schemas';
import type { DateOrder } from './dates';
import { readDateCell, isSlashFormat, dateOrderEvidence } from './dates';
import { countsAsRead, decimalCommaAllowed, numberColumns, readRecord, type ReadContext, type RecordRead } from './read';
import { headerWords, isResultRole, hasTargetWord, unitWord } from './role-words';
import { effectiveColumns, markersOf, specRoles, structureOf } from './roles';
import { columnValues } from './sample';
import type { Table } from './table';

/**
 * `validateImportSpec` (§9.2.4, AI1, rule 8): the coach's answer is checked by
 * code against the **whole file** before anything is shown. Pure and
 * deterministic. Any failure refuses the whole spec; nothing is half-applied.
 * Reasons come from a fixed list and carry only file text and code's
 * numbers, never model text (AI11).
 *
 * 1. Schema. 2. Columns. 3. Unit evidence. 4. Markers. 5. Dates.
 * 6. Decimal comma (makes cells unreadable, never a refusal). 7. Self-check.
 * 8. Dry run (≥ 95% of rows read). 9. Result roles not on target columns.
 */

/** Share of data rows the dry run must read (§9.2.4 check 8). */
export const DRY_RUN_SHARE = 0.95;

export interface DryRun {
  read: number;
  total: number;
  /** Rows not read, in file order (index into `table.records`, with code's reason). */
  notRead: { index: number; row: number; line: number; problem: string }[];
}

export type SpecValidation =
  | { ok: true; spec: ImportMappingSpecV1; dryRun: DryRun }
  /** The coach said the file has no sets it can read (`No sets found in this file.`). */
  | { ok: false; unsupported: true; failures: [] }
  | { ok: false; unsupported: false; failures: SpecCheckFailure[] };

export interface ValidateOptions {
  today: string;
  tz: string;
}

function provisionalContext(table: Table, spec: ImportMappingSpecV1, opts: ValidateOptions): Omit<ReadContext, 'tryOrder' | 'tryNotation'> {
  const cols = effectiveColumns(table.header, spec, EMPTY_LAYOUT_ANSWERS, null);
  const structure = structureOf(table, cols, spec, opts.tz);
  const markers = markersOf(table, structure, spec, EMPTY_LAYOUT_ANSWERS, null);
  const ev = structure.date && structure.date.format !== null && isSlashFormat(structure.date.format) ? dateOrderEvidence(columnValues(table, structure.date.index)) : null;
  const dateOrder: DateOrder | null = ev?.order === 'day_first' || ev?.order === 'month_first' ? ev.order : null;
  return {
    table,
    cols,
    structure,
    answers: EMPTY_LAYOUT_ANSWERS,
    markers,
    dateOrder,
    decimalComma: decimalCommaAllowed(table, spec.file.decimal, numberColumns(structure)),
    today: opts.today,
    tz: opts.tz,
    provisional: true,
  };
}

/** The dry run over every row, reading with the spec's suggestions (§9.2.4 check 8). */
export function dryRunOf(table: Table, ctx: Omit<ReadContext, 'tryOrder' | 'tryNotation'>): { dryRun: DryRun; reads: RecordRead[] } {
  const reads = table.records.map((r, i) => {
    const first = readRecord(ctx, r, i);
    if (countsAsRead(first)) return first;
    // An unanswered day/month order or notation can read either way: the row can be read if either does.
    for (const alt of [
      { tryOrder: 'month_first' as const },
      { tryNotation: 'second' as const },
      { tryOrder: 'month_first' as const, tryNotation: 'second' as const },
    ]) {
      const again = readRecord({ ...ctx, ...alt }, r, i);
      if (countsAsRead(again)) return again;
    }
    return first;
  });
  const notRead = reads.flatMap((r) => (countsAsRead(r) ? [] : [{ index: r.index, row: r.row, line: r.line, problem: r.problem ?? 'Couldn’t be read' }]));
  return { dryRun: { read: reads.length - notRead.length, total: reads.length, notRead }, reads };
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

/** Validate a spec (raw model arguments, already JSON-parsed) against the whole file. */
export function validateImportSpec(raw: unknown, table: Table, opts: ValidateOptions): SpecValidation {
  // 1. Schema.
  const parsed = ImportMappingSpecV1Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, unsupported: false, failures: [{ kind: 'schema' }] };
  const spec = parsed.data;
  if (spec.unsupported !== null) return { ok: false, unsupported: true, failures: [] };
  if (spec.file.delimiter !== table.delimiter || spec.file.headerLine !== 1) return { ok: false, unsupported: false, failures: [{ kind: 'schema' }] };

  const failures: SpecCheckFailure[] = [];
  const add = (f: SpecCheckFailure): void => {
    if (!failures.some((x) => JSON.stringify(x) === JSON.stringify(f))) failures.push(f);
  };

  // 2. Columns: every reference is the header cell at its index; no column has two roles.
  const { roles, twice, refs } = specRoles(spec);
  if (spec.setType) refs.push(spec.setType.column);
  // A name the model wrote that isn't a header cell is model text: never kept for the screen (AI11, check 49).
  for (const ref of refs) if (table.header[ref.index] !== ref.header) add({ kind: 'unknown_column', header: table.header.includes(ref.header) ? ref.header.slice(0, 200) : '' });
  if (failures.length > 0) return { ok: false, unsupported: false, failures };
  for (const ref of twice) add({ kind: 'two_roles', header: (table.header[ref.index] ?? '').slice(0, 200) });
  if (failures.length > 0) return { ok: false, unsupported: false, failures };

  // 3. Unit evidence: a header token is a whole word of the load column's header; a unit column holds only unit words in the whole file.
  if (spec.load) {
    const u = spec.load.unit;
    if (u.kind === 'header_token') {
      const h = table.header[u.column.index] ?? '';
      if (u.column.index !== spec.load.column.index || !headerWords(h).includes(u.token)) add({ kind: 'unit_token', token: u.token });
    } else if (u.kind === 'unit_column') {
      const values = columnValues(table, u.column.index)
        .map((v) => v.trim())
        .filter((v) => v !== '');
      if (values.length === 0 || values.some((v) => unitWord(v) === null)) add({ kind: 'unit_column', header: u.column.header.slice(0, 200) });
    }
  }

  // 4. Markers the spec names exist in that column.
  if (spec.setType) {
    const values = new Set(columnValues(table, spec.setType.column.index).map((v) => v.trim()));
    // The token isn't in the file, so it is model text: the reason carries none (AI11).
    for (const v of spec.setType.values) if (!values.has(v.cell.trim())) add({ kind: 'marker', token: '' });
  }

  // 5. Dates: the format reads every filled date cell (a slash date in either order while the file doesn't settle it).
  {
    const col = spec.date.column.index;
    const format = spec.date.format;
    const cells = columnValues(table, col);
    const ev = isSlashFormat(format) ? dateOrderEvidence(cells) : null;
    const orders: (DateOrder | null)[] =
      format === 'day_month_unknown' ? (ev?.order === 'day_first' || ev?.order === 'month_first' ? [ev.order] : ev?.order === 'conflict' ? [] : ['day_first', 'month_first']) : [null];
    for (let i = 0; i < cells.length; i += 1) {
      const c = (cells[i] ?? '').trim();
      if (c === '') continue;
      const fits = orders.some((o) => readDateCell(c, format, { order: o, tz: opts.tz }) !== null);
      if (!fits) {
        add({ kind: 'date', cell: c.slice(0, 200), row: table.records[i]?.row ?? 0 });
        break;
      }
    }
  }

  // 9. No result role on a target column (AI4).
  for (const [index, role] of roles) {
    const h = table.header[index] ?? '';
    if (isResultRole(role) && hasTargetWord(h)) add({ kind: 'target_column', header: h.slice(0, 200) });
  }
  if (failures.length > 0) return { ok: false, unsupported: false, failures };

  // 6 and 8: the dry run over every row (decimal commas only where check 6 allows them).
  const ctx = provisionalContext(table, spec, opts);
  const { dryRun } = dryRunOf(table, ctx);

  // 7. Self-check: the coach's own readings of 3–5 rows equal code's reading of them under its spec.
  for (const item of spec.selfCheck) {
    const index = table.records.findIndex((r) => r.line === item.line);
    const rec = table.records[index];
    let matches = false;
    if (rec) {
      for (const alt of [{}, { tryOrder: 'month_first' as const }, { tryNotation: 'second' as const }, { tryOrder: 'month_first' as const, tryNotation: 'second' as const }]) {
        const r = readRecord({ ...ctx, ...alt }, rec, index);
        const first = r.sets[0];
        if (r.status !== 'read' || !first) continue;
        if (r.date === item.date && r.exercise === item.exercise.trim() && sameNumber(first.load, item.load) && sameNumber(first.reps, item.reps)) {
          matches = true;
          break;
        }
      }
    }
    if (!matches) add({ kind: 'self_check', row: rec?.row ?? 0 });
  }

  // 8. At least 95% of rows read.
  if (dryRun.total > 0 && dryRun.read / dryRun.total < DRY_RUN_SHARE) add({ kind: 'dry_run', percent: Math.floor((100 * dryRun.read) / dryRun.total) });

  if (failures.length > 0) return { ok: false, unsupported: false, failures };
  return { ok: true, spec, dryRun };
}
