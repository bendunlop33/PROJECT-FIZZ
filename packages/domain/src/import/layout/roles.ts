import type { ColumnRef, DateFormat, ImportMappingSpecV1, LayoutAnswers, LayoutRole, MarkerMeaning } from '@fizz/schemas';
import { dateOrderEvidence, formatHasTime, formatsReading, isSlashFormat, type DateOrder } from './dates';
import { familyOf, hasTargetWord, headerNamesRole, isMultiRole, isResultRole, namedColumns } from './role-words';
import { columnValues } from './sample';
import type { Table } from './table';

/**
 * The layout in effect: each column's role and where it came from (AI3).
 * Pure. The coach's spec only **suggests** roles; a suggestion that no header
 * word names is a `Check`, and nothing reads through it until Ben confirms
 * it (`Use this`) or chooses another role. Ben's answers win over the spec.
 */

/**
 * - `named`: the header names the role (code's word list, one column, no target word).
 * - `check`: the coach's suggestion; waiting for Ben.
 * - `ben`: Ben chose or confirmed it in this import.
 * - `saved`: Ben's answer from the saved layout (`Your answer last time`).
 * - `plain`: `Notes` or `Not imported`, which change no stored value.
 */
export type ColumnState = 'named' | 'check' | 'ben' | 'saved' | 'plain';

export interface EffectiveColumn {
  index: number;
  header: string;
  /** The role in effect (for `check`: the suggestion, read only in the dry run). */
  role: LayoutRole;
  state: ColumnState;
  /** The coach's role for it, if any. */
  suggested: LayoutRole | null;
  /** The header has a target word (AI4): it can't take a result role. */
  target: boolean;
}

/** Roles the spec gives each column (§9.6.2 → the role list), with any column given two. */
export function specRoles(spec: ImportMappingSpecV1): { roles: Map<number, LayoutRole>; twice: ColumnRef[]; refs: ColumnRef[] } {
  const roles = new Map<number, LayoutRole>();
  const twice: ColumnRef[] = [];
  const refs: ColumnRef[] = [];
  const give = (ref: ColumnRef, role: LayoutRole): void => {
    refs.push(ref);
    const had = roles.get(ref.index);
    if (had !== undefined && had !== role) twice.push(ref);
    else roles.set(ref.index, role);
  };
  give(spec.date.column, formatHasTime(spec.date.format) ? 'start_time' : 'date');
  for (const c of spec.workoutKey) give(c, 'workout');
  give(spec.exercise, 'exercise');
  if (spec.load) {
    give(spec.load.column, 'load');
    if (spec.load.unit.kind === 'unit_column') give(spec.load.unit.column, 'unit');
    if (spec.load.unit.kind === 'header_token') refs.push(spec.load.unit.column);
  }
  if (spec.reps) give(spec.reps, 'reps');
  switch (spec.layout.kind) {
    case 'row_per_set':
      if (spec.layout.setOrder) give(spec.layout.setOrder, 'set_type');
      break;
    case 'row_per_exercise_packed':
      give(spec.layout.sets, spec.layout.notation === 'sets_x_reps' || spec.layout.notation === 'sets_x_reps_at_load' ? 'sets_reps' : 'all_sets');
      break;
    case 'wide_set_columns':
      for (const c of spec.layout.setColumns) give(c, 'one_set');
      break;
  }
  if (spec.setType) give(spec.setType.column, 'set_type');
  if (spec.rpe) give(spec.rpe, 'rpe');
  for (const c of spec.notes) give(c, 'notes');
  for (const c of spec.unmapped) give(c, 'not_imported');
  return { roles, twice, refs };
}

/** The columns in effect. `saved`: the saved layout's answers (their roles show as `saved`). */
export function effectiveColumns(header: readonly string[], spec: ImportMappingSpecV1 | null, answers: LayoutAnswers, saved: LayoutAnswers | null): EffectiveColumn[] {
  const suggested = spec ? specRoles(spec).roles : new Map<number, LayoutRole>();
  const named = namedColumns(header);
  return header.map((h, index) => {
    const target = hasTargetWord(h);
    const mine = answers.roles[String(index)];
    const sugg = suggested.get(index) ?? null;
    if (mine !== undefined) {
      const fromSaved = saved !== null && saved.roles[String(index)] === mine;
      return { index, header: h, role: mine, state: mine === 'notes' || mine === 'not_imported' ? 'plain' : fromSaved ? 'saved' : 'ben', suggested: sugg, target };
    }
    if (sugg === null) return { index, header: h, role: 'not_imported', state: 'plain', suggested: null, target };
    if (sugg === 'notes' || sugg === 'not_imported') return { index, header: h, role: sugg, state: 'plain', suggested: sugg, target };
    const isNamed = !target && headerNamesRole(header, index, sugg, named);
    return { index, header: h, role: sugg, state: isNamed ? 'named' : 'check', suggested: sugg, target };
  });
}

/** Whether a role is in effect for reading: confirmed (named, Ben's, saved) or, in a dry run, a suggestion too. */
export function active(c: EffectiveColumn, provisional: boolean): boolean {
  return c.state !== 'check' || provisional;
}

export interface Structure {
  date: { index: number; format: DateFormat | null } | null;
  workout: number[];
  exercise: number | null;
  load: number | null;
  unit: number | null;
  reps: number | null;
  setsReps: number | null;
  allSets: number | null;
  oneSet: number[];
  setType: number[];
  rpe: number | null;
  notes: number[];
}

function firstOf(cols: readonly EffectiveColumn[], roles: readonly LayoutRole[]): number | null {
  return cols.find((c) => roles.includes(c.role))?.index ?? null;
}

/**
 * Where each value comes from, by role (every column with a value role
 * counts here, `check` ones included; reading decides what waits). The date
 * column's format: the spec's when the spec chose that column, else code's
 * own reading of the column's cells.
 */
export function structureOf(table: Pick<Table, 'header' | 'records'>, cols: readonly EffectiveColumn[], spec: ImportMappingSpecV1 | null, tz: string): Structure {
  const dateIndex = firstOf(cols, ['start_time', 'date']);
  let format: DateFormat | null = null;
  if (dateIndex !== null) {
    if (spec && spec.date.column.index === dateIndex) format = spec.date.format;
    else format = formatsReading(columnValues(table, dateIndex), tz)[0] ?? null;
  }
  const all = (role: LayoutRole) => cols.filter((c) => c.role === role).map((c) => c.index);
  return {
    date: dateIndex === null ? null : { index: dateIndex, format },
    workout: all('workout'),
    exercise: firstOf(cols, ['exercise']),
    load: firstOf(cols, ['load']),
    unit: firstOf(cols, ['unit']),
    reps: firstOf(cols, ['reps']),
    setsReps: firstOf(cols, ['sets_reps']),
    allSets: firstOf(cols, ['all_sets']),
    oneSet: all('one_set'),
    setType: all('set_type'),
    rpe: firstOf(cols, ['rpe']),
    notes: all('notes'),
  };
}

/** Day/month order for a slash date column: Ben's answer, else what the file settles, else null (asked). */
export function dateOrderOf(table: Pick<Table, 'records'>, s: Structure, answers: LayoutAnswers): { order: DateOrder | null; settledBy: string | null; conflict: boolean } {
  if (!s.date || s.date.format === null || !isSlashFormat(s.date.format)) return { order: null, settledBy: null, conflict: false };
  const ev = dateOrderEvidence(columnValues(table, s.date.index));
  if (ev.order === 'conflict') return { order: null, settledBy: null, conflict: true };
  // A cell in the file settles it (AI5); otherwise Ben's answer; otherwise it is asked.
  if (ev.order === 'day_first' || ev.order === 'month_first') return { order: ev.order, settledBy: ev.cell, conflict: false };
  if (answers.dateOrder !== null) return { order: answers.dateOrder, settledBy: null, conflict: false };
  return { order: null, settledBy: null, conflict: false };
}

/** Set-type cells that are words for a meaning (evidence rule (c)): Hevy's `warmup`, `dropset`, `failure`, `normal`. */
const MARKER_WORDS: Readonly<Record<string, MarkerMeaning>> = {
  warmup: 'warmup',
  'warm-up': 'warmup',
  'warm up': 'warmup',
  warm_up: 'warmup',
  normal: 'working',
  working: 'working',
  'working set': 'working',
  dropset: 'drop',
  'drop set': 'drop',
  drop_set: 'drop',
  failure: 'failure',
  'to failure': 'failure',
};

export function namedMarker(token: string): MarkerMeaning | null {
  return MARKER_WORDS[token.trim().toLowerCase()] ?? null;
}

/** A set-type cell that is a set number (`1`, `2`), not a marker. */
export function isSetNumber(token: string): boolean {
  return /^\d{1,3}$/.test(token.trim());
}

export type MarkerState = 'named' | 'check' | 'ben' | 'saved' | 'question';

export interface MarkerReading {
  token: string;
  /** Rows with it. */
  rows: number;
  /** The meaning in effect: Ben's, the file's word, or (check only) the coach's suggestion; null while asked. */
  meaning: MarkerMeaning | null;
  suggested: MarkerMeaning | null;
  state: MarkerState;
  /** The column it was first seen in. */
  column: number;
}

/** Every marker in the set-type columns, in first-seen order (AI5: one question each, nothing selected). */
export function markersOf(table: Pick<Table, 'records'>, s: Structure, spec: ImportMappingSpecV1 | null, answers: LayoutAnswers, saved: LayoutAnswers | null): MarkerReading[] {
  const out = new Map<string, MarkerReading>();
  for (const col of s.setType) {
    for (const r of table.records) {
      const token = (r.cells[col] ?? '').trim();
      if (token === '' || isSetNumber(token)) continue;
      const m = out.get(token);
      if (m) {
        m.rows += 1;
        continue;
      }
      const suggested = spec?.setType?.values.find((v) => v.cell.trim() === token)?.meaning ?? null;
      const mine = answers.markers[token];
      const word = namedMarker(token);
      let reading: Omit<MarkerReading, 'token' | 'rows' | 'column'>;
      if (mine !== undefined) reading = { meaning: mine, suggested, state: saved?.markers[token] === mine ? 'saved' : 'ben' };
      else if (word !== null) reading = { meaning: word, suggested, state: 'named' };
      else if (suggested !== null) reading = { meaning: suggested, suggested, state: 'check' };
      else reading = { meaning: null, suggested: null, state: 'question' };
      out.set(token, { token, rows: 1, column: col, ...reading });
    }
  }
  return [...out.values()];
}

/** Why Ben can't give a column a role (§9.2.5 role sheet), or null when he can. */
export function roleRefusal(table: Pick<Table, 'header' | 'records'>, index: number, role: LayoutRole): 'not_unit_words' | 'target_column' | null {
  const header = table.header[index] ?? '';
  if (isResultRole(role) && hasTargetWord(header)) return 'target_column';
  if (role === 'unit') {
    const filled = columnValues(table, index)
      .map((v) => v.trim())
      .filter((v) => v !== '');
    if (filled.length === 0 || filled.some((v) => !['kg', 'kgs', 'lb', 'lbs'].includes(v.toLowerCase()))) return 'not_unit_words';
  }
  return null;
}

/** The columns that lose their role when `index` takes `role` (each role is one column's, except multi roles; date and start time are one family). */
export function displacedBy(cols: readonly EffectiveColumn[], index: number, role: LayoutRole): number[] {
  if (isMultiRole(role)) return [];
  const fam = familyOf(role);
  return cols.filter((c) => c.index !== index && familyOf(c.role) === fam).map((c) => c.index);
}
