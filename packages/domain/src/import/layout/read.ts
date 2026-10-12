import type { LayoutAnswers, MarkerMeaning, NotationAnswer, WeightUnit } from '@fizz/schemas';
import type { CsvRecord } from '../csv';
import { deriveId } from '../../stable';
import { isSlashFormat, readDateCell, type DateOrder } from './dates';
import { hasXNotation, notationOptions, readNumber, readSetCell, type CellSet } from './notation';
import { headerUnitToken, unitOfToken, unitWord } from './role-words';
import { active, isSetNumber, type EffectiveColumn, type MarkerReading, type Structure } from './roles';
import { columnValues } from './sample';
import type { Table } from './table';

/**
 * Reading one row through the layout in effect (pure; the only reader of
 * file values for layout imports). Every number is the cell's, as written:
 * never converted between kg and lb, never snapped (rule 2). Anything the
 * row needs that Ben hasn't answered makes it **wait**, never guessed.
 *
 * `provisional` (the checks' dry run and self-check only): the coach's
 * suggestions count, and readings that wait for an answer use the given
 * alternatives, to see whether the layout *can* read the row. Nothing read
 * provisionally is ever stored.
 */

export type WaitReason = 'role' | 'unit' | 'date_order' | 'notation' | 'marker';

/** AI13 hard limits (§9.5 copy). Such a row counts as read but unreadable. */
export const HARD_LIMITS = { reps: 1000, kg: 1500, lb: 3000, earliest: '2000-01-01' } as const;
export type HardLimitReason = 'Over 1,000 reps' | 'Over 1,500 kg' | 'Over 3,000 lb' | 'Before 2000' | 'After today';

export interface ReadSet {
  load: number | null;
  reps: number | null;
}

export type RecordStatus = 'read' | 'pending' | 'unreadable' | 'not_a_set' | 'not_strength';

export interface RecordRead {
  /** Index into `table.records`. */
  index: number;
  row: number;
  line: number;
  cells: string[];
  status: RecordStatus;
  /** Unreadable by a hard limit (counts as read in the dry run). */
  hardLimit: boolean;
  problem: string | null;
  waiting: WaitReason[];
  date: string | null;
  time: string | null;
  timeFull: string | null;
  exercise: string;
  unit: WeightUnit | null;
  sets: ReadSet[];
  setType: MarkerMeaning | null;
  rpe: number | null;
  comment: string;
  workoutKey: string | null;
  decimalComma: boolean;
}

export interface ReadContext {
  table: Pick<Table, 'header' | 'records' | 'delimiter'>;
  cols: readonly EffectiveColumn[];
  structure: Structure;
  answers: LayoutAnswers;
  markers: readonly MarkerReading[];
  /** Day/month order in effect (Ben's or the file's), null when still asked. */
  dateOrder: DateOrder | null;
  /** The spec asked for decimal commas and check 6 allows them. */
  decimalComma: boolean;
  today: string;
  tz: string;
  provisional: boolean;
  /** Provisional alternatives: day/month order and notation to try when unanswered. */
  tryOrder?: DateOrder;
  tryNotation?: 'first' | 'second';
}

const RPE_OK = (v: number): boolean => v >= 1 && v <= 10 && Number.isInteger(v * 2);
const WHOLE = /^\d+(\.0+)?$/;

/** Whether decimal commas may be read (check 6): asked for, the delimiter isn't `,`, and no number cell has three digits after a comma. */
export function decimalCommaAllowed(table: Pick<Table, 'delimiter' | 'records'>, decimal: '.' | ',', numberColumns: readonly number[]): boolean {
  if (decimal !== ',' || table.delimiter === ',') return false;
  return !numberColumns.some((c) => columnValues(table, c).some((v) => /^-?\d+,\d{3}$/.test(v.trim())));
}

function hardLimit(date: string | null, today: string, sets: readonly ReadSet[], unit: WeightUnit | null): HardLimitReason | null {
  if (date !== null && date < HARD_LIMITS.earliest) return 'Before 2000';
  if (date !== null && date > today) return 'After today';
  for (const s of sets) {
    if (s.reps !== null && s.reps > HARD_LIMITS.reps) return 'Over 1,000 reps';
    if (s.load !== null) {
      if (unit === 'kg' && Math.abs(s.load) > HARD_LIMITS.kg) return 'Over 1,500 kg';
      if (unit !== 'kg' && Math.abs(s.load) > HARD_LIMITS.lb) return 'Over 3,000 lb';
    }
  }
  return null;
}

function colOf(ctx: ReadContext, index: number | null): EffectiveColumn | null {
  return index === null ? null : (ctx.cols[index] ?? null);
}

/** The unit a row's weights are in, and whether it waits for Ben (`unit`). */
function unitFor(ctx: ReadContext, cells: readonly string[]): { unit: WeightUnit | null; wait: boolean; problem: string | null } {
  const s = ctx.structure;
  const unitCol = colOf(ctx, s.unit);
  if (unitCol !== null) {
    const raw = (cells[unitCol.index] ?? '').trim();
    if (raw !== '') {
      if (!active(unitCol, ctx.provisional)) return { unit: null, wait: true, problem: null };
      const u = unitWord(raw);
      return u === null ? { unit: null, wait: false, problem: `Weight unit isn’t kg or lb (${raw})` } : { unit: u, wait: false, problem: null };
    }
  }
  if (ctx.answers.unit !== null) return { unit: ctx.answers.unit, wait: false, problem: null };
  const loadCol = colOf(ctx, s.load);
  const token = loadCol === null ? null : headerUnitToken(loadCol.header);
  if (token !== null) return { unit: unitOfToken(token), wait: false, problem: null };
  return { unit: null, wait: !ctx.provisional, problem: null };
}

function notationFor(ctx: ReadContext, index: number, role: 'sets_reps' | 'one_set' | 'all_sets'): NotationAnswer | null {
  const own = ctx.answers.notation[String(index)];
  if (own !== undefined) return own;
  // Wide layouts: one answer for every `Set n` column.
  if (role === 'one_set') {
    for (const i of ctx.structure.oneSet) {
      const a = ctx.answers.notation[String(i)];
      if (a !== undefined) return a;
    }
  }
  if (!ctx.provisional) return null;
  const [first, second] = notationOptions(role);
  return ctx.tryNotation === 'second' ? second : first;
}

/** Read one record. */
export function readRecord(ctx: ReadContext, rec: CsvRecord, index: number): RecordRead {
  const s = ctx.structure;
  const base: RecordRead = {
    index,
    row: rec.row,
    line: rec.line,
    cells: rec.cells,
    status: 'unreadable',
    hardLimit: false,
    problem: null,
    waiting: [],
    date: null,
    time: null,
    timeFull: null,
    exercise: '',
    unit: null,
    sets: [],
    setType: null,
    rpe: null,
    comment: '',
    workoutKey: null,
    decimalComma: false,
  };
  const unreadable = (problem: string, extra: Partial<RecordRead> = {}): RecordRead => ({ ...base, ...extra, status: 'unreadable', problem });
  if (rec.problem !== null) return unreadable(rec.problem);
  if (rec.cells.length !== ctx.table.header.length) return unreadable(`This row has ${String(rec.cells.length)} values; the header has ${String(ctx.table.header.length)}`);
  const cell = (i: number | null): string => (i === null ? '' : (rec.cells[i] ?? ''));
  const waiting = new Set<WaitReason>();

  // A value role on a `Check` column waits for Ben wherever the row has a value in it.
  for (const c of ctx.cols) {
    if (c.state === 'check' && !ctx.provisional && cell(c.index).trim() !== '') waiting.add('role');
  }

  // Structure the layout needs.
  if (s.exercise === null) return unreadable('No exercise column');
  if (s.date === null) return unreadable('No date column');
  const hasSets = s.reps !== null || s.setsReps !== null || s.allSets !== null || s.oneSet.length > 0;
  if (!hasSets) return unreadable('No reps column');

  // Date.
  const dateRaw = cell(s.date.index).trim();
  if (dateRaw === '') return unreadable('No date');
  const format = s.date.format;
  if (format === null) return unreadable(`Date doesn’t fit the layout (${dateRaw})`);
  let order: DateOrder | null = ctx.dateOrder;
  if (order === null && isSlashFormat(format)) {
    if (ctx.provisional) order = ctx.tryOrder ?? 'day_first';
    else waiting.add('date_order');
  }
  // A slash date reads in the order in effect (the file's, or Ben's answer): the spec's DD/MM or MM/DD is only the coach's guess.
  const d = readDateCell(dateRaw, isSlashFormat(format) ? 'day_month_unknown' : format, { order: order ?? 'day_first', tz: ctx.tz });
  if (d === null) return unreadable(`Date doesn’t fit the layout (${dateRaw})`);
  const dated: Partial<RecordRead> = waiting.has('date_order') ? {} : { date: d.date, time: d.time, timeFull: d.timeFull };

  const exercise = cell(s.exercise).trim();
  if (exercise === '') return unreadable('No exercise name', dated);

  // Set type: a set number, or a marker whose meaning is Ben's, the file's word, or (dry run) the coach's suggestion.
  let setType: MarkerMeaning | null = null;
  for (const col of s.setType) {
    const c = colOf(ctx, col);
    const token = cell(col).trim();
    if (c === null || token === '' || isSetNumber(token)) continue;
    const m = ctx.markers.find((x) => x.token === token);
    const meaning = m?.state === 'check' && !ctx.provisional ? null : (m?.meaning ?? null);
    if (meaning === null) {
      if (ctx.provisional) continue;
      waiting.add('marker');
      continue;
    }
    if (setType === null) setType = meaning;
  }
  if (setType === 'not_a_set') return { ...base, ...dated, exercise, status: 'not_a_set', setType, waiting: [] };

  // Load column.
  const loadRaw = cell(s.load).trim();
  let load: number | null = null;
  if (loadRaw !== '') {
    load = readNumber(loadRaw, ctx.decimalComma);
    if (load === null) {
      const comma = /^-?\d+,\d+$/.test(loadRaw);
      return unreadable(comma ? `Weight uses a decimal comma (${loadRaw})` : `Weight isn’t a number (${loadRaw})`, { ...dated, exercise, decimalComma: comma });
    }
  }

  // Sets.
  let sets: ReadSet[] = [];
  const setCell = (col: number, role: 'sets_reps' | 'one_set' | 'all_sets'): CellSet[] | 'waiting' | 'unreadable' => {
    const raw = cell(col);
    const r = readSetCell(role, raw, notationFor(ctx, col, role), ctx.decimalComma);
    if (r.kind === 'empty') return [];
    if (r.kind === 'waiting') return 'waiting';
    if (r.kind === 'unreadable') return 'unreadable';
    return r.sets;
  };
  const packed = s.setsReps ?? s.allSets;
  if (s.oneSet.length > 0 || packed !== null) {
    const cols: [number, 'sets_reps' | 'one_set' | 'all_sets'][] =
      s.oneSet.length > 0 ? s.oneSet.map((c) => [c, 'one_set'] as [number, 'one_set']) : [[packed ?? 0, s.setsReps !== null ? 'sets_reps' : 'all_sets']];
    for (const [col, role] of cols) {
      const r = setCell(col, role);
      if (r === 'waiting') {
        waiting.add('notation');
        continue;
      }
      if (r === 'unreadable') return unreadable(`“${cell(col).trim()}” can’t be read`, { ...dated, exercise });
      for (const x of r) sets.push({ load: x.load ?? load, reps: x.reps });
    }
  } else {
    const repsRaw = cell(s.reps).trim();
    let reps: number | null = null;
    if (repsRaw !== '') {
      if (/^\d+,\d+$/.test(repsRaw)) return unreadable(`Reps uses a decimal comma (${repsRaw})`, { ...dated, exercise, decimalComma: true });
      if (!WHOLE.test(repsRaw)) return unreadable(`Reps isn’t a whole number (${repsRaw})`, { ...dated, exercise });
      reps = Number(repsRaw);
    }
    sets = [{ load, reps }];
  }

  // Unit, only when a weight is written.
  const anyLoad = sets.some((x) => x.load !== null);
  let unit: WeightUnit | null = null;
  if (anyLoad) {
    const u = unitFor(ctx, rec.cells);
    if (u.problem !== null) return unreadable(u.problem, { ...dated, exercise });
    if (u.wait) waiting.add('unit');
    unit = u.unit;
  }

  // RPE: only 1–10 in half steps; anything else stays in the original.
  const rpeCol = colOf(ctx, s.rpe);
  let rpe: number | null = null;
  if (rpeCol !== null && active(rpeCol, ctx.provisional)) {
    const v = readNumber(cell(s.rpe), ctx.decimalComma);
    rpe = v !== null && RPE_OK(v) ? v : null;
  }

  const comment = s.notes
    .map((i) => cell(i).trim())
    .filter((v) => v !== '')
    .join(' · ');

  // Which workout: the `Which workout` cells, else the start time, else the date.
  let workoutKey: string | null = null;
  if (!waiting.has('date_order')) {
    if (s.workout.length > 0) workoutKey = `${d.date}~${deriveId(`workout:${s.workout.map((i) => cell(i)).join('\u0000')}`)}`;
    else if (d.timeFull !== null) workoutKey = `${d.date}T${d.timeFull}`;
    else workoutKey = d.date;
  }

  const read: RecordRead = { ...base, ...dated, exercise, unit, sets, setType, rpe, comment, workoutKey, waiting: [...waiting] };
  const limit = hardLimit(read.date, ctx.today, sets, unit);
  if (limit !== null) return { ...read, status: 'unreadable', hardLimit: true, problem: limit, waiting: [] };
  if (waiting.size > 0) return { ...read, status: 'pending' };
  if (sets.length === 0 || sets.every((x) => x.reps === null)) return { ...read, status: 'not_strength', problem: sets.some((x) => x.load !== null) ? 'Weight with no reps' : 'No weight or reps' };
  return { ...read, status: 'read' };
}

/** Columns read as numbers (for check 6). */
export function numberColumns(s: Structure): number[] {
  return [s.load, s.reps, s.rpe, s.setsReps, s.allSets, ...s.oneSet].filter((x): x is number => x !== null);
}

/** Whether a column's cells use `x` notation (its question appears; AI5). */
export function columnHasX(table: Pick<Table, 'records'>, index: number): boolean {
  return columnValues(table, index).some((v) => hasXNotation(v));
}

/** Whether a row counts as read in the dry run (§9.2.4 check 8). */
export function countsAsRead(r: RecordRead): boolean {
  return r.status !== 'unreadable' || r.hardLimit;
}
