import type { LayoutQuestion, LayoutReview, NotReadableReason, RecordRead, ValueCheckQuestion, WorkedExample } from '@fizz/domain';
import type { LayoutRole, MarkerMeaning, NotationAnswer, SpecCheckFailure, WeightUnit } from '@fizz/schemas';

import { formatCount } from '../format/numbers';
import type { ImportCoachStatus, LayoutReviewView, PreviewImportResult, ProposeResult, SampleView, SavedLayoutRow } from './layout-service';
import { dayMonthYear, type IconName, type Line, type Tone } from './views';

/**
 * View-models for import from any app (data-import-export §9.2, copy §9.5).
 * Pure. **Every string is GymSmarter's fixed copy, the file's own text
 * (quoted) or a number code read** (AI11, check 49): nothing the model
 * wrote ever reaches a screen. Minimal copy: values and actions, no lead
 * text; explanations sit behind `Why?`.
 */

const NBSP = ' ';
const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;
const quote = (fileText: string): string => `“${fileText}”`;
const line = (icon: IconName, tone: Tone, text: string, detail?: string): Line => ({ icon, tone, text, ...(detail === undefined ? {} : { detail }) });

// ---------------------------------------------------------------------------
// Coach readiness (§9.3.2)

/** The coach line's reason words (§9.5 `Coach line`). */
const COACH_LINE: Record<ImportCoachStatus['state'], string> = {
  ready: 'Coach: ChatGPT plan',
  not_connected: 'Coach: not connected',
  offline: 'Coach: offline',
  signed_out: 'Coach: signed out',
  limit: 'Coach: usage limit',
  unavailable: 'Coach: unavailable',
  model_unavailable: 'Coach: model unavailable',
  not_eligible: 'Coach: this account can’t be used',
};

/** `Needs the coach · <reason>` (§9.5). */
const NEEDS_REASON: Record<Exclude<ImportCoachStatus['state'], 'ready'>, string> = {
  not_connected: 'not connected',
  offline: 'offline',
  signed_out: 'signed out',
  limit: 'usage limit reached',
  unavailable: 'try later',
  model_unavailable: 'model unavailable',
  not_eligible: 'this account can’t be used',
};

/** The fix for a reason, as a link (§9.3.2), or none. */
export type CoachFix = { label: 'Connect ›' | 'Connect the coach ›' | 'Sign in ›' | 'Manage usage ›' | 'Choose model ›'; target: 'coach_connection' } | null;

export function coachLine(c: ImportCoachStatus): { line: Line; fix: CoachFix } {
  if (c.state === 'ready') return { line: line('checkmark.circle.fill', 'done', COACH_LINE.ready), fix: null };
  const fix: CoachFix = c.state === 'not_connected' ? { label: 'Connect ›', target: 'coach_connection' } : c.state === 'signed_out' ? { label: 'Sign in ›', target: 'coach_connection' } : null;
  return { line: line('slash.circle', 'info', COACH_LINE[c.state]), fix };
}

export function needsCoachLine(c: ImportCoachStatus): { line: Line; fix: CoachFix } | null {
  if (c.state === 'ready') return null;
  const fixes: Partial<Record<ImportCoachStatus['state'], CoachFix>> = {
    not_connected: { label: 'Connect the coach ›', target: 'coach_connection' },
    signed_out: { label: 'Sign in ›', target: 'coach_connection' },
    limit: { label: 'Manage usage ›', target: 'coach_connection' },
    model_unavailable: { label: 'Choose model ›', target: 'coach_connection' },
    not_eligible: { label: 'Connect the coach ›', target: 'coach_connection' },
  };
  return { line: line('slash.circle', 'info', `Needs the coach · ${NEEDS_REASON[c.state]}`), fix: fixes[c.state] ?? null };
}

// ---------------------------------------------------------------------------
// Import history (§9.2.1)

export interface ImportHistoryView {
  offline: { text: string; tappable: 'saved_layouts' | null }[];
  needsCoach: string[];
  coach: { line: Line; fix: CoachFix };
  blockLine: string | null;
  primary: { label: 'Choose file'; enabled: boolean };
}

export function importHistoryView(input: { coach: ImportCoachStatus; savedLayouts: number; blocked: boolean }): ImportHistoryView {
  return {
    offline: [{ text: 'FitNotes CSV', tappable: null }, ...(input.savedLayouts > 0 ? [{ text: `Saved layouts (${formatCount(input.savedLayouts)})`, tappable: 'saved_layouts' as const }] : [])],
    needsCoach: ['Other apps and spreadsheets (CSV)'],
    coach: coachLine(input.coach),
    blockLine: input.blocked ? 'Finish or discard your workout first.' : null,
    primary: { label: 'Choose file', enabled: !input.blocked },
  };
}

/** Detection's one line for a file that can't be read (§9.3.1). */
export function notReadableLine(reason: NotReadableReason): string {
  switch (reason) {
    case 'spreadsheet_file':
      return 'Spreadsheet file. Export the sheet as CSV.';
    case 'pdf_or_image':
      return 'Can’t read PDFs or photos. Export a CSV or paste the text.';
    case 'empty':
    case 'no_numbers':
      return 'No numbers to import.';
    case 'app_backup':
      return 'This is an app backup, not an export. Export a CSV from the app.';
    case 'binary':
      return 'Not a text file. Export a CSV.';
    case 'sections':
      return 'Files with sections can’t be read yet.';
    case 'not_a_table':
      return 'Not a table. Export a CSV.';
  }
}

export function damagedLines(damaged: readonly (string | null)[]): string[] {
  return damaged.map((n) => (n === null ? '⚠ A saved layout is damaged' : `⚠ Layout ${quote(n)} is damaged`));
}

// ---------------------------------------------------------------------------
// New file layout (§9.2.2) and What's sent (§9.2.3)

export interface NewLayoutView {
  fileName: string;
  counts: string;
  /** The whole consent: one line (check 39). Null while the coach can't be used. */
  sendLine: string | null;
  sendWhy: string;
  needsCoach: { line: Line; fix: CoachFix } | null;
  firstLine: string | null;
  damaged: string[];
  notice: string | null;
  primary: { label: 'Read with the coach' | 'Choose another file' | 'Try again'; enabled: boolean };
}

export function sendLine(sample: Pick<SampleView, 'rows' | 'hiddenCount' | 'columns'>): string {
  const notes = sample.columns.some((c) => c.kind === 'notes');
  const hidden = sample.hiddenCount;
  const what = notes && hidden > 0 ? `, notes and ${plural(hidden, 'column', 'columns')} hidden` : notes ? ', notes hidden' : hidden > 0 ? `, ${plural(hidden, 'column', 'columns')} hidden` : '';
  return `↑ Sends column names and ${plural(sample.rows, 'sample row', 'sample rows')}${what}, to ChatGPT.`;
}

export function newLayoutView(r: Extract<PreviewImportResult, { kind: 'new_table' }>, sample: SampleView): NewLayoutView {
  const needs = needsCoachLine(r.coach);
  const ready = r.coach.state === 'ready';
  return {
    fileName: r.fileName,
    counts: `${plural(r.columns, 'column', 'columns')} · ${plural(r.rows, 'row', 'rows')}`,
    sendLine: ready ? sendLine(sample) : null,
    sendWhy: 'Only these rows go. Notes are replaced by their length. Nothing else from GymSmarter is sent.',
    needsCoach: needs,
    firstLine: ready ? null : r.firstLine,
    damaged: damagedLines(r.damaged),
    notice: r.interrupted ? 'Interrupted.' : null,
    primary: ready || r.reused
      ? { label: 'Read with the coach', enabled: true }
      : r.coach.state === 'offline'
        ? { label: 'Read with the coach', enabled: false }
        : r.coach.state === 'unavailable'
          ? { label: 'Try again', enabled: true }
          : { label: 'Choose another file', enabled: true },
  };
}

/**
 * How often New file layout reads the coach's state again while it can't
 * read (§9.3.2: `Read with the coach` is re-enabled when the connection
 * returns; review r3 N2). Null: no need. Offline is held for a minute after
 * a failed request, so a 15 s re-read finds the connection soon after it is back.
 */
export function coachRecheckMs(state: ImportCoachStatus['state']): number | null {
  return state === 'offline' || state === 'unavailable' ? 15_000 : null;
}

export interface SentView {
  columns: { index: number; header: string; state: 'on' | 'off' | 'notes' }[];
  text: string;
  chars: string;
  instructions: string;
}

export function sentView(sample: SampleView): SentView {
  return {
    columns: sample.columns.map((c) => ({ index: c.index, header: quote(c.header), state: c.kind === 'notes' ? 'notes' : c.hidden ? 'off' : 'on' })),
    text: sample.json,
    chars: plural(sample.chars, 'character', 'characters'),
    instructions: sample.instructions,
  };
}

// ---------------------------------------------------------------------------
// Reading the layout (§9.2.4, §9.3.3)

export function readingSteps(phase: 'waiting' | 'checking', chars: number): Line[] {
  return [
    line('checkmark.circle.fill', 'done', `Sent · ${plural(chars, 'character', 'characters')}`),
    phase === 'waiting' ? line('info.circle', 'info', 'Waiting for the coach') : line('checkmark.circle.fill', 'done', 'Waiting for the coach'),
    line('info.circle', 'info', 'Checking every row'),
  ];
}

/** A check reason, from the fixed list (§9.5). Only file text and code's numbers are filled in. */
export function checkReasonText(f: SpecCheckFailure): string {
  switch (f.kind) {
    case 'schema':
      return 'Its answer wasn’t in the expected form.';
    case 'unknown_column':
      return f.header === '' ? 'It names a column that isn’t in the file.' : `It names a column ${quote(f.header)} that isn’t in the file.`;
    case 'two_roles':
      return `It uses ${quote(f.header)} for two things.`;
    case 'unit_token':
      return `${quote(f.token)} isn’t in the column name.`;
    case 'unit_column':
      return `Not every value in ${quote(f.header)} is kg or lb.`;
    case 'marker':
      return f.token === '' ? 'Its marker isn’t in the file.' : `Its marker ${quote(f.token)} isn’t in the file.`;
    case 'date':
      return `Its dates don’t fit ${quote(f.cell)} (row ${formatCount(f.row)}).`;
    case 'self_check':
      return f.row === 0 ? 'Its reading of a row doesn’t match its layout.' : `Its reading of row ${formatCount(f.row)} doesn’t match its layout.`;
    case 'dry_run':
      return `${String(f.percent)}% of rows can be read. 95% is needed.`;
    case 'target_column':
      return `It puts results in a target column, ${quote(f.header)}.`;
  }
}

export interface ReadingResultView {
  status: Line | null;
  reasons: string[];
  primary: { label: 'Try again' | 'Choose another file' | 'Read with the coach'; action: 'retry' | 'choose' | 'read' } | null;
  /** The coach-state fix link (`Sign in ›`), when the failure is the route's. */
  fix: CoachFix;
  /** Proposed: go to Check the layout. `consent`: nothing was sent because the text shown changed; show New file layout again with the text as it is now. */
  next: 'check' | 'consent' | null;
}

export function readingResultView(r: ProposeResult): ReadingResultView {
  const plain = (text: string, primary: ReadingResultView['primary'], tone: Tone = 'info'): ReadingResultView => ({ status: line(tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle', tone, text), reasons: [], primary, fix: null, next: null });
  switch (r.status) {
    case 'proposed':
      return { status: null, reasons: [], primary: null, fix: null, next: 'check' };
    case 'rejected':
      return { status: line('exclamationmark.triangle', 'warning', 'Layout didn’t pass the checks'), reasons: r.reasons.map(checkReasonText), primary: { label: 'Try again', action: 'retry' }, fix: null, next: null };
    case 'unsupported':
      return plain('No sets found in this file.', { label: 'Choose another file', action: 'choose' });
    case 'unavailable': {
      const needs = needsCoachLine({ route: 'chatgpt_plan', state: r.reason });
      return { status: needs?.line ?? null, reasons: [], primary: r.reason === 'unavailable' ? { label: 'Try again', action: 'retry' } : { label: 'Choose another file', action: 'choose' }, fix: needs?.fix ?? null, next: null };
    }
    case 'failed':
      switch (r.reason) {
        case 'stopped':
          return plain('Stopped.', { label: 'Read with the coach', action: 'read' });
        case 'interrupted':
          return plain('Interrupted.', { label: 'Read with the coach', action: 'read' });
        case 'timeout':
          return plain('No answer in time.', { label: 'Try again', action: 'retry' });
        case 'no_layout_returned':
        case 'provider_error':
          return plain('No layout returned.', { label: 'Try again', action: 'retry' });
      }
      break;
    case 'refused':
      // Nothing was sent in any of these: never `No layout returned.` (rule 1, review S2).
      switch (r.reason) {
        case 'workout_unfinished':
          return plain('Finish or discard your workout first.', null);
        case 'not_found':
          return plain('Choose the file again.', { label: 'Choose another file', action: 'choose' });
        case 'sample_changed':
          return { status: null, reasons: [], primary: null, fix: null, next: 'consent' };
      }
  }
  return plain('No layout returned.', { label: 'Try again', action: 'retry' });
}

// ---------------------------------------------------------------------------
// Check the layout (§9.2.5)

export const ROLE_LABEL: Record<LayoutRole, string> = {
  date: 'Workout date',
  start_time: 'Start time',
  workout: 'Which workout',
  exercise: 'Exercise',
  load: 'Load',
  unit: 'Weight unit',
  reps: 'Reps',
  sets_reps: 'Sets and reps (3x8)',
  one_set: 'One set (100x8)',
  all_sets: 'All sets (100x5, 100x5)',
  set_type: 'Set number or type',
  rpe: 'RPE',
  notes: 'Notes',
  not_imported: 'Not imported',
};
export const ROLE_ORDER: readonly LayoutRole[] = ['date', 'start_time', 'workout', 'exercise', 'load', 'unit', 'reps', 'sets_reps', 'one_set', 'all_sets', 'set_type', 'rpe', 'notes', 'not_imported'];

export const MARKER_LABEL: Record<MarkerMeaning, string> = { warmup: 'Warm-up', working: 'Working set', drop: 'Drop set', failure: 'To failure', not_a_set: 'Not a set' };
export const MARKER_ORDER: readonly MarkerMeaning[] = ['warmup', 'working', 'drop', 'failure', 'not_a_set'];

export interface ColumnRowView {
  index: number;
  header: string;
  role: string;
  /** `✓` named or yours; `Check` waiting for Use this; none for Notes / Not imported. */
  state: 'named' | 'check' | 'you' | 'last_time' | 'plain';
  /** A note under the role (`Day first`, `kg`). */
  detail: string | null;
}

export type QuestionRowKey =
  | { kind: 'record_kind' }
  | { kind: 'unit' }
  | { kind: 'date_order' }
  | { kind: 'notation'; column: number }
  | { kind: 'marker'; token: string }
  | { kind: 'new_column'; column: number };

export interface QuestionRowView {
  key: QuestionRowKey;
  title: string;
  answered: boolean;
  /** Ben's answer from the saved layout (`Your answer last time`). */
  lastTime: boolean;
  /** A coach suggestion still on `Check` (markers): `Use this` / `Change…`. */
  check: boolean;
  answer: string | null;
}

export interface ExampleView {
  label: string;
  source: string;
  reading: string;
}

export interface CheckLayoutView {
  fileName: string;
  readLine: Line;
  notReadLine: string | null;
  /** Rows waiting for something no question here asks (backstop; never silent). */
  stuckLine: Line | null;
  questionsTitle: string | null;
  questions: QuestionRowView[];
  columns: ColumnRowView[];
  examples: ExampleView[];
  plan: string | null;
  primary: { label: string; enabled: boolean };
  /** A coach layout: `Read with the coach again` (§9.3.4), a new request that never reuses this one. */
  readAgain: 'Read with the coach again' | null;
}

const NOTATION_LABEL: Record<NotationAnswer, (example: string) => string> = {
  sets_x_reps: (e) => {
    const [a, b] = e.split(/\s*[x×X*]\s*/);
    return `${a ?? ''} sets of ${(b ?? '').split(/\s*@/)[0] ?? ''}`;
  },
  reps_x_sets: (e) => {
    const [a, b] = e.split(/\s*[x×X*]\s*/);
    return `${(b ?? '').split(/\s*@/)[0] ?? ''} sets of ${a ?? ''}`;
  },
  load_x_reps: (e) => {
    const [a, b] = e.split(/\s*[x×X*]\s*/);
    return `${a ?? ''} × ${b ?? ''}`;
  },
  reps_x_load: (e) => {
    const [a, b] = e.split(/\s*[x×X*]\s*/);
    return `${b ?? ''} × ${a ?? ''}`;
  },
};

function questionTitle(q: LayoutQuestion): string {
  switch (q.kind) {
    case 'record_kind':
      return 'What is this file?';
    case 'unit':
      return 'Weight unit';
    case 'date_order':
      return `Dates like ${quote(q.cell)}`;
    case 'notation':
      return `What ${quote(q.example.cell)} means`;
    case 'marker':
      return `${quote(q.marker.token)} · ${plural(q.marker.rows, 'row', 'rows')}`;
    case 'new_column':
      return quote(q.header);
  }
}

function questionAnswer(q: LayoutQuestion): string | null {
  switch (q.kind) {
    case 'record_kind':
      return q.answer === null ? null : q.answer === 'done' ? 'Workouts I did' : 'A plan or template';
    case 'unit':
      return q.answer;
    case 'date_order':
      return q.answer === null ? null : q.answer === 'day_first' ? 'Day first' : 'Month first';
    case 'notation':
      return q.answer === null ? null : NOTATION_LABEL[q.answer](q.example.cell);
    case 'marker':
      return q.marker.state === 'question' ? null : q.marker.meaning === null ? null : `${MARKER_LABEL[q.marker.meaning]}${q.marker.state === 'check' ? '?' : ''}`;
    case 'new_column':
      return q.answer === null ? null : ROLE_LABEL[q.answer];
  }
}

function questionKey(q: LayoutQuestion): QuestionRowKey {
  switch (q.kind) {
    case 'notation':
      return { kind: 'notation', column: q.column };
    case 'marker':
      return { kind: 'marker', token: q.marker.token };
    case 'new_column':
      return { kind: 'new_column', column: q.column };
    case 'record_kind':
    case 'unit':
    case 'date_order':
      return { kind: q.kind };
  }
}

function isLastTime(q: LayoutQuestion, v: LayoutReviewView): boolean {
  const saved = v.saved;
  if (saved === null) return false;
  switch (q.kind) {
    case 'record_kind':
      return q.answer !== null && saved.recordKind === q.answer;
    case 'unit':
      return q.answer !== null && saved.unit === q.answer;
    case 'date_order':
      return q.answer !== null && saved.dateOrder === q.answer;
    case 'marker':
      return q.marker.state === 'saved';
    case 'notation':
    case 'new_column':
      return false;
  }
}

function num(n: number): string {
  return formatCount(n);
}

/** Code's reading of one row (`3 Nov 2025 · Bench · 3 sets × 8 reps at 100 kg`), `?` for what waits for an answer. */
export function readingText(r: RecordRead, unit: WeightUnit | null, locale?: string): string {
  if (r.status === 'unreadable' || r.status === 'not_strength') return r.problem ?? 'Can’t be read';
  if (r.status === 'not_a_set') return `${r.exercise} · Not a set`;
  const waits = new Set(r.waiting);
  const date = waits.has('date_order') || r.date === null ? '?' : dayMonthYear(r.date, locale);
  const time = r.time === null ? '' : ` ${r.time}`;
  const u = waits.has('unit') ? '?' : (r.unit ?? unit ?? '');
  const sets = r.sets;
  const first = sets[0];
  let setText: string;
  if (waits.has('notation') || first === undefined) setText = '?';
  else if (sets.length > 1 && sets.every((s) => s.load === first.load && s.reps === first.reps)) {
    setText = `${plural(sets.length, 'set', 'sets')} × ${first.reps === null ? '?' : plural(first.reps, 'rep', 'reps')}${first.load === null ? '' : ` at ${num(first.load)}${NBSP}${u}`}`;
  } else {
    setText = sets.map((s) => `${s.load === null ? '' : `${num(s.load)}${NBSP}${u} × `}${s.reps === null ? '?' : num(s.reps)}`).join(', ');
  }
  const marker = waits.has('marker') ? ' · ?' : r.setType === 'warmup' ? ' · Warm-up' : r.setType === 'drop' ? ' · Drop set' : r.setType === 'failure' ? ' · To failure' : '';
  const role = waits.has('role') ? ' ?' : '';
  return `${date}${time} · ${r.exercise} · ${setText}${marker}${role}`;
}

function exampleView(e: WorkedExample, unit: WeightUnit | null, locale?: string): ExampleView {
  return {
    label: `Row ${formatCount(e.row)}`,
    source: e.cells.map((c) => c.trim()).filter((c) => c !== '').map((c) => (c.length > 60 ? `${c.slice(0, 57)}…` : c)).join(' · '),
    reading: `→ ${readingText(e.read, unit, locale)}`,
  };
}

export function checkLayoutView(v: LayoutReviewView, locale?: string): CheckLayoutView {
  const r: LayoutReview = v.review;
  const questions = r.questions.map(
    (q): QuestionRowView => ({
      key: questionKey(q),
      title: questionTitle(q),
      answered: questionAnswer(q) !== null && !(q.kind === 'marker' && q.marker.state === 'check'),
      lastTime: isLastTime(q, v),
      check: q.kind === 'marker' && q.marker.state === 'check',
      answer: questionAnswer(q),
    }),
  );
  const dateCol = r.columns.find((c) => c.role === 'date' || c.role === 'start_time');
  const columns = r.columns.map(
    (c): ColumnRowView => ({
      index: c.index,
      header: quote(c.header),
      role: ROLE_LABEL[c.role],
      state: c.state === 'named' ? 'named' : c.state === 'check' ? 'check' : c.state === 'ben' ? 'you' : c.state === 'saved' ? 'last_time' : 'plain',
      detail:
        dateCol?.index === c.index && r.dateOrder.order !== null
          ? r.dateOrder.order === 'day_first'
            ? 'Day first'
            : 'Month first'
          : c.role === 'load' && r.unit.unit !== null && r.unit.source === 'header'
            ? r.unit.unit
            : null,
    }),
  );
  const open = r.open;
  const total = r.dryRun.total;
  const read = r.dryRun.read;
  const notRead = total - read;
  return {
    fileName: v.fileName,
    readLine: r.enough ? line('checkmark.circle.fill', 'done', `${num(read)} of ${num(total)} rows read`) : line('exclamationmark.triangle', 'warning', `${String(total === 0 ? 0 : Math.floor((100 * read) / total))}% of rows read. 95% needed.`),
    notReadLine: notRead > 0 ? plural(notRead, 'row not read', 'rows not read') : null,
    stuckLine: r.stuck > 0 ? line('exclamationmark.triangle', 'warning', `${plural(r.stuck, 'row', 'rows')} can’t be read with this layout.`) : null,
    questionsTitle: open > 0 ? `Needs your answer (${num(open)})` : null,
    questions,
    columns,
    examples: r.examples.map((e) => exampleView(e, r.unit.unit, locale)),
    plan: r.plan ? 'Plans aren’t imported.' : null,
    primary: r.plan
      ? { label: 'Choose another file', enabled: true }
      : open > 0
        ? { label: `Answer ${plural(open, 'question', 'questions')} to continue`, enabled: false }
        : { label: v.kind === 'saved' && v.newColumns.length > 0 ? 'Continue' : 'Use this layout', enabled: r.ready },
    readAgain: v.kind === 'coach' ? 'Read with the coach again' : null,
  };
}

// ---------------------------------------------------------------------------
// The role sheet and the layout questions (§9.2.5)

export interface RoleSheetView {
  header: string;
  values: string;
  rows: string;
  options: { role: LayoutRole; label: string; selected: boolean; suggested: boolean }[];
}

export function roleSheetView(v: LayoutReviewView, column: number, values: readonly string[]): RoleSheetView {
  const c = v.review.columns[column];
  const distinct = [...new Set(values.map((x) => x.trim()).filter((x) => x !== ''))];
  return {
    header: quote(c?.header ?? ''),
    values: `${distinct.slice(0, 4).join(', ')}${distinct.length > 4 ? ' …' : ''}`,
    rows: plural(values.filter((x) => x.trim() !== '').length, 'row', 'rows'),
    options: ROLE_ORDER.map((role) => ({
      role,
      label: ROLE_LABEL[role],
      // A `Check` column has nothing selected; a confirmed one has its role.
      selected: c !== undefined && c.state !== 'check' && c.role === role,
      suggested: c?.state === 'check' && c.suggested === role,
    })),
  };
}

export const ROLE_REFUSAL_TEXT = { not_unit_words: 'Not every value is kg or lb.', target_column: 'Target column. Not imported as results.' } as const;

export function roleMovedToast(header: string): string {
  return `${quote(header)} → Not imported`;
}

export interface QuestionScreenView {
  title: string;
  lines: string[];
  options: { value: string; label: string; detail: string | null; selected: boolean }[];
}

/** One layout question's screen: every option rendered from real rows, nothing selected until Ben answers. */
export function questionScreenView(q: LayoutQuestion, locale?: string): QuestionScreenView {
  switch (q.kind) {
    case 'record_kind':
      return {
        title: 'What is this file?',
        lines: q.targetColumns.length > 0 ? [`Target columns: ${q.targetColumns.map(quote).join(', ')}`] : [],
        options: [
          { value: 'done', label: 'Workouts I did', detail: null, selected: q.answer === 'done' },
          { value: 'plan', label: 'A plan or template', detail: null, selected: q.answer === 'plan' },
        ],
      };
    case 'unit':
      return {
        title: 'Weight unit',
        lines: q.range === null ? [] : [`Values: ${num(q.range.min)} to ${num(q.range.max)}`],
        options: (['kg', 'lb'] as const).map((u) => ({ value: u, label: u, detail: null, selected: q.answer === u })),
      };
    case 'date_order':
      return {
        title: `Dates like ${quote(q.cell)}`,
        lines: [],
        options: [
          { value: 'day_first', label: q.dayFirst ? `Day first: ${dayMonthYear(q.dayFirst.date, locale)}` : 'Day first', detail: q.dayFirst ? `${dayMonthYear(q.dayFirst.first, locale)} – ${dayMonthYear(q.dayFirst.last, locale)}` : null, selected: q.answer === 'day_first' },
          { value: 'month_first', label: q.monthFirst ? `Month first: ${dayMonthYear(q.monthFirst.date, locale)}` : 'Month first', detail: q.monthFirst ? `${dayMonthYear(q.monthFirst.first, locale)} – ${dayMonthYear(q.monthFirst.last, locale)}` : null, selected: q.answer === 'month_first' },
        ],
      };
    case 'notation':
      return {
        title: `What ${quote(q.example.cell)} means`,
        lines: [`Row ${formatCount(q.example.row)}: ${quote(q.example.cell)}${q.example.load === null ? '' : `, weight ${q.example.load}`}`],
        options: q.options.map((o) => {
          const load = q.example.load;
          const sets = o.sets ?? [];
          const first = sets[0];
          const detail =
            first === undefined
              ? null
              : sets.length <= 4
                ? `→ ${sets.map((s) => `${s.load !== null ? num(s.load) : (load ?? '?')} × ${num(s.reps)}`).join(', ')}`
                : `→ ${plural(sets.length, 'set', 'sets')} of ${first.load !== null ? num(first.load) : (load ?? '?')} × ${num(first.reps)}`;
          return { value: o.answer, label: NOTATION_LABEL[o.answer](q.example.cell), detail, selected: q.answer === o.answer };
        }),
      };
    case 'marker':
      return {
        title: `Markers in ${quote(q.header)}`,
        lines: [`${quote(q.marker.token)} · ${plural(q.marker.rows, 'row', 'rows')}`],
        options: MARKER_ORDER.map((m) => ({ value: m, label: MARKER_LABEL[m], detail: q.marker.state === 'check' && q.marker.suggested === m ? 'Suggested' : null, selected: q.marker.state !== 'check' && q.marker.state !== 'question' && q.marker.meaning === m })),
      };
    case 'new_column':
      return {
        title: quote(q.header),
        lines: [`${q.values.join(', ')}${q.values.length >= 4 ? ' …' : ''} · ${plural(q.rows, 'row', 'rows')}`],
        options: [
          { value: 'not_imported', label: 'Not imported', detail: null, selected: q.answer === 'not_imported' },
          { value: 'notes', label: 'Notes', detail: null, selected: q.answer === 'notes' },
          { value: 'other', label: 'Something else…', detail: null, selected: q.answer !== null && q.answer !== 'notes' && q.answer !== 'not_imported' },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Changed columns (§9.2.7)

export function changedColumnsView(v: LayoutReviewView): { title: string; lines: string[] } {
  return {
    title: `Layout ${quote(v.profileName ?? '')}${v.newColumns.length > 0 ? ` + ${plural(v.newColumns.length, 'new column', 'new columns')}` : ''}`,
    lines: v.missing.map((h) => `${quote(h)} isn’t in this file.`),
  };
}

// ---------------------------------------------------------------------------
// Values to check (§9.2.6, AI13)

export function valueCheckView(v: ValueCheckQuestion, locale?: string): { title: string; line: string; skip: string; answer: 'import' | 'skip' | null } {
  return {
    title: `${v.name} · ${dayMonthYear(v.date, locale)}`,
    line: `${num(v.value)} × ${num(v.reps)} · before: ${num(v.before.value)} × ${num(v.before.reps)}`,
    skip: `Skip these ${plural(v.sets, 'set', 'sets').replace(/^1 set$/, 'set')}`,
    answer: v.answer,
  };
}

export const VALUE_CHECK_COPY = { title: (n: number) => `Values to check (${formatCount(n)})`, importAsWritten: 'Import as written', importAll: 'Import all as written', why: 'A big jump is often a kg/lb mix-up.' } as const;

// ---------------------------------------------------------------------------
// Saved import layouts (§9.2.9)

export function savedLayoutRowView(r: SavedLayoutRow, locale?: string): { title: string; subtitle: string; state: Line | null } {
  const parts = [plural(r.columns, 'column', 'columns'), ...(r.unit === null ? [] : [r.unit]), plural(r.imports, 'import', 'imports')];
  if (r.lastUsed) parts.push(dayMonthYear(r.lastUsed.utc.slice(0, 10), locale).replace(/ \d{4}$/, ''));
  return {
    title: r.name,
    subtitle: parts.join(' · '),
    state: r.state === 'not_in_use' ? line('slash.circle', 'info', 'Not in use: its import was undone') : null,
  };
}

export const SAVED_LAYOUTS_COPY = {
  title: 'Saved import layouts',
  empty: 'No saved layouts.',
  damaged: '⚠ Damaged',
  delete: 'Delete layout',
  deleted: 'Layout deleted',
  deleteAlert: (name: string) => ({ title: `Delete ${quote(name)}?`, message: 'Imported workouts stay.' }),
} as const;

/** The Undo alert's extra line when the layout goes with the import (§9.2.10). */
export function layoutGoesLine(name: string | null): string | null {
  return name === null ? null : `The layout ${quote(name)} goes too.`;
}

/** Results' layout line (§9.2.10). */
export function resultsLayoutLine(layout: { kind: 'coach' | 'saved'; profileName: string | null; savedProfileId: string | null } | undefined): string | null {
  if (!layout) return null;
  if (layout.kind === 'coach' && layout.savedProfileId !== null && layout.profileName !== null) return `Layout saved: ${layout.profileName}`;
  if (layout.profileName !== null) return `Layout: ${layout.profileName}`;
  return null;
}
