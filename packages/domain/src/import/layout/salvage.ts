import { ImportMappingSpecV1Schema, type ColumnRef, type ImportMappingSpecV1, type SpecCheckFailure } from '@fizz/schemas';
import { formatsReading, readDateCell } from './dates';
import { hasTargetWord, headerWords, namedColumns, unitWord, type RoleFamily } from './role-words';
import { columnValues } from './sample';
import type { Table } from './table';
import { validateImportSpec, type ValidateOptions } from './validate-spec';

/**
 * When the coach's layout still fails the checks after it was told why
 * (§9.2.4, ADR 0026 amendment 13 Oct 2026), code keeps what it can check and
 * drops what it can't, so Check the layout asks Ben the open question
 * instead of stopping. Pure and deterministic. Nothing here reads or writes a
 * value: it only removes or narrows the coach's **suggestions**, so every
 * role it keeps is still a `Check` unless a header word names it (AI3), and
 * every answer that changes a stored value is still Ben's.
 *
 * - A column reference whose index is wrong but whose header is exactly one
 *   header cell is moved to that cell (file text, never model text).
 * - A reference that names no header cell is dropped; a required one (date,
 *   exercise) falls back to the one column whose header names it, or the
 *   layout can't be kept (null).
 * - A column given two roles keeps the first in the order below.
 * - A unit the file doesn't show becomes `none`: `Weight unit` is asked.
 * - A marker not in the file is dropped: the file's own markers are asked.
 * - A date format that doesn't read the column is replaced by code's own
 *   reading of the cells, when one reads them all.
 * - A result role on a target column is dropped (AI4).
 * What still fails (too few rows read, its own row readings) is returned for
 * `Why?` and shows on the screen as rows not read.
 */

export interface SalvagedLayout {
  spec: ImportMappingSpecV1;
  /** The checks the coach's layout didn't pass (shown behind `Why?`). */
  failed: SpecCheckFailure[];
  /** What still fails after the salvage (dry run, self-check): the screen's rows not read. */
  remaining: SpecCheckFailure[];
}

export function salvageImportSpec(raw: unknown, table: Table, failed: readonly SpecCheckFailure[], opts: ValidateOptions): SalvagedLayout | null {
  const parsed = ImportMappingSpecV1Schema.safeParse(raw);
  if (!parsed.success || parsed.data.unsupported !== null) return null;
  const s = parsed.data;
  const header = table.header;
  const named = namedColumns(header);

  const fix = (ref: ColumnRef): ColumnRef | null => {
    if (header[ref.index] === ref.header) return ref;
    const at = header.flatMap((h, i) => (h === ref.header ? [i] : []));
    return at.length === 1 && at[0] !== undefined ? { header: ref.header, index: at[0] } : null;
  };
  const byName = (family: RoleFamily): ColumnRef | null => {
    const cols = named.get(family) ?? [];
    const i = cols.length === 1 ? cols[0] : undefined;
    return i === undefined ? null : { header: header[i] ?? '', index: i };
  };

  // Required columns.
  const dateCol = fix(s.date.column) ?? byName('date');
  const exercise = fix(s.exercise) ?? byName('exercise');
  if (dateCol === null || exercise === null || dateCol.index === exercise.index) return null;

  // Taken in this order: a later, different role on a column already used is dropped (`two_roles`).
  const used = new Map<number, string>([
    [dateCol.index, 'date'],
    [exercise.index, 'exercise'],
  ]);
  const take = (ref: ColumnRef | null, role: string, result: boolean): ColumnRef | null => {
    if (ref === null) return null;
    const r = fix(ref);
    if (r === null) return null;
    const had = used.get(r.index);
    if (had !== undefined && had !== role) return null;
    // A result role never sits on a target column (AI4).
    if (result && hasTargetWord(header[r.index] ?? '')) return null;
    used.set(r.index, role);
    return r;
  };

  let load: ImportMappingSpecV1['load'] = null;
  if (s.load) {
    const col = take(s.load.column, 'load', true);
    if (col !== null) {
      let unit = s.load.unit;
      if (unit.kind === 'header_token') {
        const tokenCol = fix(unit.column);
        unit = tokenCol !== null && tokenCol.index === col.index && headerWords(header[col.index] ?? '').includes(unit.token) ? { ...unit, column: tokenCol } : { kind: 'none' };
      } else if (unit.kind === 'unit_column') {
        const uc = take(unit.column, 'unit', true);
        const values = uc === null ? [] : columnValues(table, uc.index).map((v) => v.trim()).filter((v) => v !== '');
        unit = uc !== null && values.length > 0 && values.every((v) => unitWord(v) !== null) ? { kind: 'unit_column', column: uc } : { kind: 'none' };
      }
      load = { column: col, unit };
    }
  }
  const reps = take(s.reps, 'reps', true);

  let layout: ImportMappingSpecV1['layout'];
  switch (s.layout.kind) {
    case 'row_per_set':
      layout = { kind: 'row_per_set', setOrder: take(s.layout.setOrder, 'set_type', true) };
      break;
    case 'row_per_exercise_packed': {
      const sets = take(s.layout.sets, 'sets', true);
      if (sets === null) return null;
      layout = { ...s.layout, sets };
      break;
    }
    case 'wide_set_columns': {
      const cols = s.layout.setColumns.map((c) => take(c, 'one_set', true)).filter((c): c is ColumnRef => c !== null);
      if (cols.length === 0) return null;
      layout = { ...s.layout, setColumns: cols };
      break;
    }
  }

  let setType: ImportMappingSpecV1['setType'] = null;
  if (s.setType) {
    const col = take(s.setType.column, 'set_type', true);
    if (col !== null) {
      const present = new Set(columnValues(table, col.index).map((v) => v.trim()));
      setType = { column: col, values: s.setType.values.filter((v) => present.has(v.cell.trim())) };
    }
  }
  const rpe = take(s.rpe, 'rpe', true);
  const workoutKey = s.workoutKey.map((c) => take(c, 'workout', false)).filter((c): c is ColumnRef => c !== null);
  const notes = s.notes.map((c) => take(c, 'notes', false)).filter((c): c is ColumnRef => c !== null);
  const unmapped = s.unmapped.map((c) => take(c, 'not_imported', false)).filter((c): c is ColumnRef => c !== null);

  // The date format: the coach's when it reads every filled cell, else code's own reading of the cells.
  const cells = columnValues(table, dateCol.index)
    .map((c) => c.trim())
    .filter((c) => c !== '');
  const reads = (f: ImportMappingSpecV1['date']['format']) => cells.every((c) => readDateCell(c, f, { order: 'day_first', tz: opts.tz }) !== null || readDateCell(c, f, { order: 'month_first', tz: opts.tz }) !== null);
  const format = reads(s.date.format) ? s.date.format : (formatsReading(cells, opts.tz)[0] ?? s.date.format);

  const spec: ImportMappingSpecV1 = {
    ...s,
    file: { ...s.file, delimiter: table.delimiter, headerLine: 1 },
    layout,
    workoutKey,
    date: { column: dateCol, format },
    exercise,
    load,
    reps,
    setType,
    rpe,
    notes,
    unmapped,
  };
  // Still a valid spec (a dropped role leaves a column unassigned, never a broken reference).
  const again = ImportMappingSpecV1Schema.safeParse(spec);
  if (!again.success) return null;
  const v = validateImportSpec(again.data, table, opts);
  const remaining = v.ok ? [] : v.unsupported ? [] : v.failures;
  // Anything structural left means code couldn't make it checkable: not kept.
  if (remaining.some((f) => f.kind !== 'dry_run' && f.kind !== 'self_check' && f.kind !== 'date')) return null;
  return { spec: again.data, failed: [...failed], remaining };
}
