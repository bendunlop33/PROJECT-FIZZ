import type { ImportMappingSpecV1, LayoutAnswers } from '@fizz/schemas';
import type { SourceSetRow } from '../source-row';
import { decimalCommaAllowed, numberColumns, readRecord, type ReadContext, type RecordRead } from './read';
import { dateOrderOf, effectiveColumns, markersOf, structureOf } from './roles';
import type { Table } from './table';

/**
 * `applyImportSpec` (§9.6.3, AI2): the **only** producer of `SourceSetRow`
 * from a layout (check 42's architecture test holds this). Pure and
 * deterministic: the same file, spec and answers give the same rows. A role
 * or marker still on `Check`, or any answer still open, leaves its rows
 * `pending`: they are counted and never read.
 */

export interface LayoutOptions {
  today: string;
  /** Zone for `unix_seconds` dates (the phone's at import). */
  tz: string;
  /** The saved layout's answers, when this file uses one (its roles and markers show as `Your answer last time`). */
  saved?: LayoutAnswers | null;
}

/** The final-mode reading context: only named, Ben's and saved roles read; every unanswered question waits. */
export function layoutContext(table: Table, spec: ImportMappingSpecV1 | null, answers: LayoutAnswers, opts: LayoutOptions): ReadContext {
  const saved = opts.saved ?? null;
  const cols = effectiveColumns(table.header, spec, answers, saved);
  const structure = structureOf(table, cols, spec, opts.tz);
  const markers = markersOf(table, structure, spec, answers, saved);
  return {
    table,
    cols,
    structure,
    answers,
    markers,
    dateOrder: dateOrderOf(table, structure, answers).order,
    decimalComma: spec === null ? false : decimalCommaAllowed(table, spec.file.decimal, numberColumns(structure)),
    today: opts.today,
    tz: opts.tz,
    provisional: false,
  };
}

export function readAll(ctx: ReadContext, table: Table): RecordRead[] {
  return table.records.map((r, i) => readRecord(ctx, r, i));
}

/** One record's reading as source rows (one per set). Pending rows give none. */
export function sourceRowsOf(r: RecordRead): SourceSetRow[] {
  const base: SourceSetRow = {
    row: r.row,
    line: r.line,
    cells: r.cells,
    date: r.date,
    exercise: r.exercise,
    weight: null,
    bothColumns: null,
    reps: null,
    distance: '',
    distanceUnit: '',
    time: '',
    comment: r.comment,
    rowClass: 'unreadable',
    problem: r.problem,
    decimalComma: r.decimalComma,
    part: 0,
    workoutKey: r.workoutKey ?? r.date ?? '',
    startLocal: r.time,
    setType: r.setType,
    rpe: r.rpe,
  };
  switch (r.status) {
    case 'pending':
      return [];
    case 'unreadable':
      return [{ ...base, rowClass: 'unreadable', problem: r.problem ?? 'Couldn’t be read' }];
    case 'not_a_set':
      return [{ ...base, rowClass: 'unsupported', problem: 'Not a set' }];
    case 'not_strength':
      return [{ ...base, rowClass: 'unsupported', problem: r.problem ?? 'No weight or reps' }];
    case 'read':
      return r.sets.map((s, part) => ({
        ...base,
        part,
        weight: s.load === null || r.unit === null ? null : { value: s.load, unit: r.unit },
        reps: s.reps,
        rowClass: s.reps === null ? 'unsupported' : 'strength',
        problem: s.reps === null ? 'Weight with no reps' : null,
      }));
  }
}

export interface AppliedLayout {
  rows: SourceSetRow[];
  /** Records still waiting for an answer or a `Use this`. */
  pending: number;
  reads: RecordRead[];
}

export function applyImportSpec(spec: ImportMappingSpecV1 | null, answers: LayoutAnswers, table: Table, opts: LayoutOptions): AppliedLayout {
  const ctx = layoutContext(table, spec, answers, opts);
  const reads = readAll(ctx, table);
  return { rows: reads.flatMap(sourceRowsOf), pending: reads.filter((r) => r.status === 'pending').length, reads };
}
