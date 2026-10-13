import type { ImportMappingSpecV1, LayoutAnswers, LayoutRole, NotationAnswer, WeightUnit } from '@fizz/schemas';
import { applyImportSpec, layoutContext, type LayoutOptions } from './apply-spec';
import { readDateCell, slashFields, type DateOrder } from './dates';
import { hasAtLoad, notationOptions, readNumber, readSetCell, type CellSet } from './notation';
import { columnHasX, type RecordRead, type WaitReason } from './read';
import { hasTargetWord, headerUnitToken, unitOfToken } from './role-words';
import { dateOrderOf, effectiveColumns, structureOf, type EffectiveColumn, type MarkerReading } from './roles';
import { columnValues } from './sample';
import type { Table } from './table';
import { DRY_RUN_SHARE, dryRunOf, type DryRun } from './validate-spec';
import { decimalCommaAllowed, numberColumns } from './read';
import { EMPTY_LAYOUT_ANSWERS } from '@fizz/schemas';

/**
 * Check the layout (§9.2.5) as data, pure. Questions appear only when the
 * file needs them and nothing is ever pre-selected (AI3–AI5). `open` counts
 * questions not answered plus columns and markers still on `Check`; the
 * primary waits for it to reach 0, for `Workouts I did`, and for the dry run.
 * Every string here is file text; copy is the view's.
 */

export type LayoutQuestion =
  | { kind: 'record_kind'; answer: 'done' | 'plan' | null; targetColumns: string[] }
  | { kind: 'unit'; answer: WeightUnit | null; range: { min: number; max: number } | null }
  | {
      kind: 'date_order';
      answer: DateOrder | null;
      cell: string;
      dayFirst: { date: string; first: string; last: string } | null;
      monthFirst: { date: string; first: string; last: string } | null;
    }
  | {
      kind: 'notation';
      column: number;
      header: string;
      role: 'sets_reps' | 'one_set' | 'all_sets';
      answer: NotationAnswer | null;
      example: { row: number; cell: string; load: string | null };
      options: { answer: NotationAnswer; sets: CellSet[] | null }[];
    }
  | { kind: 'marker'; marker: MarkerReading; header: string }
  | { kind: 'new_column'; column: number; header: string; values: string[]; rows: number; answer: LayoutRole | null };

export interface UnitReading {
  unit: WeightUnit | null;
  /** `header`: a whole-word token in the load column's name; `unit_column`: every value a unit word (per row); `answer`: Ben's. */
  source: 'header' | 'unit_column' | 'answer' | null;
  token: string | null;
}

export interface WorkedExample {
  index: number;
  row: number;
  line: number;
  cells: string[];
  read: RecordRead;
}

export interface LayoutReview {
  columns: EffectiveColumn[];
  unit: UnitReading;
  /** Day/month order settled by a cell in the file (shown under the date column). */
  dateOrder: { order: DateOrder | null; settledBy: string | null };
  dryRun: DryRun;
  examples: WorkedExample[];
  questions: LayoutQuestion[];
  /** Columns on `Check`. */
  checks: number;
  /** Questions not answered + columns and markers on `Check`. */
  open: number;
  /** The file is a plan (Ben's answer): nothing is imported. */
  plan: boolean;
  /** What the layout lacks to read sets at all. */
  missing: ('exercise' | 'date' | 'reps')[];
  /** The rows can be read by at least 95% under the layout in effect. */
  enough: boolean;
  /** Records waiting for an answer. */
  pending: number;
  /**
   * Records waiting for something no question on the screen asks (a backstop:
   * e.g. slash dates that no single day/month order reads). Never silent: the
   * view says how many rows can't be read, and the primary stays off.
   */
  stuck: number;
  ready: boolean;
}

function unitReading(ctx: ReturnType<typeof layoutContext>): UnitReading {
  const s = ctx.structure;
  if (ctx.answers.unit !== null) return { unit: ctx.answers.unit, source: 'answer', token: null };
  const unitCol = s.unit === null ? null : ctx.cols[s.unit];
  if (unitCol && unitCol.state !== 'check') return { unit: null, source: 'unit_column', token: null };
  const loadCol = s.load === null ? null : ctx.cols[s.load];
  const token = loadCol ? headerUnitToken(loadCol.header) : null;
  if (token !== null) return { unit: unitOfToken(token), source: 'header', token };
  return { unit: null, source: null, token: null };
}

function range(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

function dateRange(table: Table, col: number, order: DateOrder, tz: string): { first: string; last: string } | null {
  const dates = columnValues(table, col)
    .map((c) => readDateCell(c, 'day_month_unknown', { order, tz })?.date ?? null)
    .filter((d): d is string => d !== null)
    .sort();
  return dates.length === 0 ? null : { first: dates[0] ?? '', last: dates.at(-1) ?? '' };
}

/** 3–5 rows that cover different patterns (§9.2.5): the first row, a marker, an RPE value, a second workout on a date, a row that can't be read. */
function pickExamples(table: Table, reads: readonly RecordRead[], dry: DryRun, s: ReturnType<typeof layoutContext>['structure']): number[] {
  const out: number[] = [];
  const add = (i: number | undefined): void => {
    if (i !== undefined && i >= 0 && !out.includes(i) && out.length < 5) out.push(i);
  };
  add(reads.findIndex((r) => r.status === 'read' || r.status === 'pending'));
  for (const col of s.setType) add(table.records.findIndex((r) => /[^\d\s]/.test((r.cells[col] ?? '').trim())));
  if (s.rpe !== null) add(table.records.findIndex((r) => (r.cells[s.rpe ?? 0] ?? '').trim() !== ''));
  const keysByDate = new Map<string, Set<string>>();
  reads.forEach((r, i) => {
    if (r.date === null || r.workoutKey === null) return;
    const set = keysByDate.get(r.date) ?? new Set<string>();
    if (!set.has(r.workoutKey) && set.size === 1) add(i);
    set.add(r.workoutKey);
    keysByDate.set(r.date, set);
  });
  add(dry.notRead[0]?.index);
  if (out.length < 3) for (let i = 0; i < reads.length && out.length < 3; i += 1) add(i);
  return out.sort((a, b) => a - b);
}

export interface ReviewOptions extends LayoutOptions {
  /** Columns new since the saved layout (Changed columns): each is asked, with nothing selected. */
  newColumns?: readonly number[];
}

/**
 * Whether the set cells carry their own loads: `100x8` in a `One set` or
 * `All sets` column (either orientation gives a load), or `3x8 @ 100` in a
 * `Sets and reps` column. Known before the notation is answered.
 */
export function loadsInCells(table: Pick<Table, 'records'>, s: ReturnType<typeof layoutContext>['structure']): boolean {
  const xCols = [...s.oneSet, ...(s.allSets === null ? [] : [s.allSets])];
  if (xCols.some((c) => columnHasX(table, c))) return true;
  return s.setsReps !== null && columnValues(table, s.setsReps).some((v) => hasAtLoad(v));
}

/** Which question (or `Check`) a wait reason is answered by. */
function asks(reason: WaitReason, questions: readonly LayoutQuestion[], checks: number): boolean {
  switch (reason) {
    case 'role':
      return checks > 0;
    case 'unit':
      return questions.some((q) => q.kind === 'unit' && q.answer === null);
    case 'date_order':
      return questions.some((q) => q.kind === 'date_order' && q.answer === null);
    case 'notation':
      return questions.some((q) => q.kind === 'notation' && q.answer === null);
    case 'marker':
      return questions.some((q) => q.kind === 'marker' && (q.marker.state === 'check' || q.marker.state === 'question'));
  }
}

/** The review of a layout: the spec (or a saved layout's) plus Ben's answers. */
export function buildLayoutReview(table: Table, spec: ImportMappingSpecV1 | null, answers: LayoutAnswers, opts: ReviewOptions): LayoutReview {
  const ctx = layoutContext(table, spec, answers, opts);
  const s = ctx.structure;
  const applied = applyImportSpec(spec, answers, table, opts);
  const reads = applied.reads;

  // The dry run under the layout in effect (Ben's roles included; suggestions count, answers may go either way).
  const provisionalCols = effectiveColumns(table.header, spec, answers, opts.saved ?? null);
  const provisional = { ...ctx, cols: provisionalCols, structure: structureOf(table, provisionalCols, spec, opts.tz), provisional: true as const };
  const { dryRun } = dryRunOf(table, { ...provisional, decimalComma: spec === null ? false : decimalCommaAllowed(table, spec.file.decimal, numberColumns(provisional.structure)) });

  const questions: LayoutQuestion[] = [];
  // What is this file? Always asked, unless answered (a saved layout's answer included; AI4).
  questions.push({ kind: 'record_kind', answer: answers.recordKind, targetColumns: table.header.filter((h) => hasTargetWord(h)) });

  // Weight unit: no unit word in the file, or Ben's answer over one. Loads come from a load column or from the
  // set cells themselves (`100x8`, `3x8 @ 100`, `100x5,100x5`); either way they need a unit (check 44).
  const unit = unitReading(ctx);
  const cellLoads = loadsInCells(table, s);
  // A unit column (even one still on `Check`) says the unit row by row: no file-level question while it is there.
  if ((s.load !== null || cellLoads) && (unit.source === 'answer' || (unit.source === null && s.unit === null))) {
    const values = (s.load === null ? [] : columnValues(table, s.load))
      .map((v) => readNumber(v, ctx.decimalComma))
      .filter((v): v is number => v !== null);
    for (const r of reads) for (const x of r.sets) if (x.load !== null) values.push(x.load);
    questions.push({ kind: 'unit', answer: answers.unit, range: range(values) });
  }

  // Day/month order, unless a date in the file settles it.
  const order = dateOrderOf(table, s, answers);
  if (s.date !== null && s.date.format !== null && (s.date.format === 'DD/MM/YYYY' || s.date.format === 'MM/DD/YYYY' || s.date.format === 'day_month_unknown') && order.settledBy === null && !order.conflict) {
    const cell = columnValues(table, s.date.index).find((c) => slashFields(c) !== null)?.trim() ?? '';
    const one = (o: DateOrder) => {
      const d = readDateCell(cell, 'day_month_unknown', { order: o, tz: opts.tz });
      const r = dateRange(table, s.date?.index ?? 0, o, opts.tz);
      return d && r ? { date: d.date, ...r } : null;
    };
    questions.push({ kind: 'date_order', answer: answers.dateOrder, cell, dayFirst: one('day_first'), monthFirst: one('month_first') });
  }

  // Notation: one question per column of `x` cells (one for all `Set n` columns).
  const setCols: [number, 'sets_reps' | 'one_set' | 'all_sets'][] = [
    ...(s.setsReps !== null ? [[s.setsReps, 'sets_reps'] as [number, 'sets_reps']] : []),
    ...(s.allSets !== null ? [[s.allSets, 'all_sets'] as [number, 'all_sets']] : []),
    ...(s.oneSet.length > 0 ? [[s.oneSet.find((c) => columnHasX(table, c)) ?? s.oneSet[0] ?? 0, 'one_set'] as [number, 'one_set']] : []),
  ];
  for (const [col, role] of setCols) {
    const cols = role === 'one_set' ? s.oneSet : [col];
    if (!cols.some((c) => columnHasX(table, c))) continue;
    const exampleIndex = table.records.findIndex((r) => cols.some((c) => /[x×X*]/.test(r.cells[c] ?? '')));
    const rec = table.records[exampleIndex];
    const cellCol = cols.find((c) => /[x×X*]/.test(rec?.cells[c] ?? '')) ?? col;
    const cell = (rec?.cells[cellCol] ?? '').trim();
    const loadRaw = s.load === null ? null : (rec?.cells[s.load] ?? '').trim() || null;
    const answer = answers.notation[String(col)] ?? (role === 'one_set' ? (s.oneSet.map((c) => answers.notation[String(c)]).find((a) => a !== undefined) ?? null) : null);
    questions.push({
      kind: 'notation',
      column: col,
      header: table.header[col] ?? '',
      role,
      answer,
      example: { row: rec?.row ?? 0, cell, load: loadRaw },
      options: notationOptions(role).map((a) => {
        const r = readSetCell(role, cell, a, ctx.decimalComma);
        return { answer: a, sets: r.kind === 'sets' ? r.sets : null };
      }),
    });
  }

  // Markers: every one not named by the file's own word and not answered is a `Check` (coach's) or asked (none).
  for (const m of ctx.markers) {
    if (m.state === 'check' || m.state === 'question' || m.state === 'ben' || m.state === 'saved') questions.push({ kind: 'marker', marker: m, header: table.header[m.column] ?? '' });
  }

  // New columns (Changed columns): asked, offline, nothing selected.
  for (const col of opts.newColumns ?? []) {
    const values = [...new Set(columnValues(table, col).map((v) => v.trim()).filter((v) => v !== ''))].slice(0, 4);
    questions.push({
      kind: 'new_column',
      column: col,
      header: table.header[col] ?? '',
      values,
      rows: columnValues(table, col).filter((v) => v.trim() !== '').length,
      answer: answers.roles[String(col)] ?? null,
    });
  }

  const unanswered = questions.filter((q) => {
    switch (q.kind) {
      case 'record_kind':
      case 'unit':
      case 'date_order':
      case 'notation':
      case 'new_column':
        return q.answer === null;
      case 'marker':
        return q.marker.state === 'check' || q.marker.state === 'question';
    }
  }).length;
  const checks = ctx.cols.filter((c) => c.state === 'check').length;
  const open = unanswered + checks;
  const missing: LayoutReview['missing'] = [];
  if (s.exercise === null) missing.push('exercise');
  if (s.date === null) missing.push('date');
  if (s.reps === null && s.setsReps === null && s.allSets === null && s.oneSet.length === 0) missing.push('reps');
  const enough = dryRun.total > 0 && dryRun.read / dryRun.total >= DRY_RUN_SHARE;
  const examples = pickExamples(table, reads, dryRun, s).map((i) => {
    const read = reads[i] as RecordRead;
    return { index: i, row: read.row, line: read.line, cells: read.cells, read };
  });
  const plan = answers.recordKind === 'plan';
  const stuck = reads.filter((r) => r.status === 'pending' && r.waiting.some((w) => !asks(w, questions, checks))).length;
  return {
    columns: [...ctx.cols],
    unit,
    dateOrder: { order: order.order, settledBy: order.settledBy },
    dryRun,
    examples,
    questions,
    checks,
    open,
    plan,
    missing,
    enough,
    pending: applied.pending,
    stuck,
    ready: open === 0 && !plan && answers.recordKind === 'done' && missing.length === 0 && enough && applied.pending === 0 && applied.rows.some((r) => r.rowClass === 'strength'),
  };
}

/** Review with no answers yet (fresh from the coach). */
export function freshReview(table: Table, spec: ImportMappingSpecV1, opts: ReviewOptions): LayoutReview {
  return buildLayoutReview(table, spec, EMPTY_LAYOUT_ANSWERS, opts);
}
