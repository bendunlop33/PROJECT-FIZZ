import type { NotationAnswer } from '@fizz/schemas';

/**
 * Set-cell readers (§9.6.2 `CellNotation`, AI5). Pure. Every number comes
 * from the cell as written; the orientation of an `x` (`3x8`, `100x8`) is
 * Ben's answer, never guessed. Nothing is converted or rounded.
 */

/** The most sets one cell may give (a cell that says more can't be read). */
export const MAX_SETS_PER_CELL = 30;

export interface CellSet {
  /** From the cell (`100x8`, `3x8 @ 100`); null: the load comes from the load column. */
  load: number | null;
  reps: number;
}

const NUM = '-?\\d+(?:[.,]\\d+)?';
const X = '\\s*[x×X*]\\s*';
const PAIR = new RegExp(`^(${NUM})${X}(${NUM})$`);
const PAIR_AT = new RegExp(`^(\\d+)${X}(\\d+)\\s*@\\s*(${NUM})$`);
const INT = /^\d+$/;

/** Parse a number as written; a comma decimal only when allowed (check 6). Null when it isn't one. */
export function readNumber(raw: string, decimalComma: boolean): number | null {
  const v = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (decimalComma && /^-?\d+,\d+$/.test(v)) return Number(v.replace(',', '.'));
  return null;
}

/** Whether a cell is written with an `x` (`3x8`, `100 x 8`, `3x8 @ 100`), so its orientation is a question. */
export function hasXNotation(cell: string): boolean {
  const v = cell.trim();
  return PAIR.test(v) || PAIR_AT.test(v) || v.split(/[,;]|\s{2,}/).some((p) => PAIR.test(p.trim()));
}

/** Whether a sets-and-reps cell carries its own load (`3x8 @ 100`). */
export function hasAtLoad(cell: string): boolean {
  return PAIR_AT.test(cell.trim());
}

function whole(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n >= 0;
}

/**
 * `Sets and reps` cell: `3x8` or `3x8 @ 100`. `answer` is `sets_x_reps` (3
 * sets of 8) or `reps_x_sets` (8 sets of 3). Null when unreadable.
 */
export function readSetsReps(cell: string, answer: 'sets_x_reps' | 'reps_x_sets', decimalComma: boolean): CellSet[] | null {
  const v = cell.trim();
  let a: number | null;
  let b: number | null;
  let load: number | null = null;
  const at = PAIR_AT.exec(v);
  if (at) {
    a = Number(at[1]);
    b = Number(at[2]);
    load = readNumber(at[3] ?? '', decimalComma);
    if (load === null) return null;
  } else {
    const m = PAIR.exec(v);
    if (!m) return null;
    a = INT.test(m[1] ?? '') ? Number(m[1]) : null;
    b = INT.test(m[2] ?? '') ? Number(m[2]) : null;
  }
  if (!whole(a) || !whole(b)) return null;
  const sets = answer === 'sets_x_reps' ? a : b;
  const reps = answer === 'sets_x_reps' ? b : a;
  if (sets < 1 || sets > MAX_SETS_PER_CELL) return null;
  return Array.from({ length: sets }, () => ({ load, reps }));
}

/** One set cell: `100x8` (`load_x_reps`) or `8x100` (`reps_x_load`), or a bare rep count. */
export function readOneSet(cell: string, answer: 'load_x_reps' | 'reps_x_load', decimalComma: boolean): CellSet | null {
  const v = cell.trim();
  if (INT.test(v)) return { load: null, reps: Number(v) };
  const m = PAIR.exec(v);
  if (!m) return null;
  const loadRaw = answer === 'load_x_reps' ? m[1] : m[2];
  const repsRaw = answer === 'load_x_reps' ? m[2] : m[1];
  const load = readNumber(loadRaw ?? '', decimalComma);
  if (load === null || !INT.test(repsRaw ?? '')) return null;
  return { load, reps: Number(repsRaw) };
}

/** `All sets` cell: `100x5,100x5,100x3` or a reps list `8,8,6` (load from the load column). */
export function readAllSets(cell: string, answer: 'load_x_reps' | 'reps_x_load' | null, decimalComma: boolean): CellSet[] | null {
  const v = cell.trim();
  if (v === '') return [];
  // A comma decimal can't be told from a list separator in a packed cell: lists split on commas only when decimals aren't commas.
  const parts = (decimalComma ? v.split(/;|\s{2,}|\s*\|\s*/) : v.split(/[,;|]/)).map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0 || parts.length > MAX_SETS_PER_CELL) return null;
  const out: CellSet[] = [];
  for (const p of parts) {
    if (INT.test(p)) {
      out.push({ load: null, reps: Number(p) });
      continue;
    }
    if (answer === null) return null;
    const s = readOneSet(p, answer, decimalComma);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/** Read a set cell for its role. `answer` null: an `x` cell can't be read until Ben answers (`readable: 'waiting'`). */
export function readSetCell(
  role: 'sets_reps' | 'one_set' | 'all_sets',
  cell: string,
  answer: NotationAnswer | null,
  decimalComma: boolean,
): { kind: 'sets'; sets: CellSet[] } | { kind: 'empty' } | { kind: 'waiting' } | { kind: 'unreadable' } {
  const v = cell.trim();
  if (v === '') return { kind: 'empty' };
  const x = hasXNotation(v);
  if (x && answer === null) return { kind: 'waiting' };
  if (role === 'sets_reps') {
    if (answer !== 'sets_x_reps' && answer !== 'reps_x_sets') return x ? { kind: 'waiting' } : { kind: 'unreadable' };
    const sets = readSetsReps(v, answer, decimalComma);
    return sets ? { kind: 'sets', sets } : { kind: 'unreadable' };
  }
  const orient = answer === 'load_x_reps' || answer === 'reps_x_load' ? answer : null;
  if (x && orient === null) return { kind: 'waiting' };
  if (role === 'one_set') {
    if (orient === null) return INT.test(v) ? { kind: 'sets', sets: [{ load: null, reps: Number(v) }] } : { kind: 'unreadable' };
    const s = readOneSet(v, orient, decimalComma);
    return s ? { kind: 'sets', sets: [s] } : { kind: 'unreadable' };
  }
  const sets = readAllSets(v, orient, decimalComma);
  return sets ? { kind: 'sets', sets } : { kind: 'unreadable' };
}

/** The answers a column's notation question offers: `3x8` cells ask sets/reps, `100x8` cells load/reps. */
export function notationOptions(role: 'sets_reps' | 'one_set' | 'all_sets'): readonly [NotationAnswer, NotationAnswer] {
  return role === 'sets_reps' ? ['sets_x_reps', 'reps_x_sets'] : ['load_x_reps', 'reps_x_load'];
}
