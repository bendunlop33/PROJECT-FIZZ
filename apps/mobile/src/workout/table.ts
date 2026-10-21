/**
 * The workout table's row logic (active-workout §2A.7, workout-table-v3 §2),
 * pure so it's unit-tested: what a row tap does, in-place cell editing, the
 * keypad bar, selecting a row, and the top bar's `⋯` menu. The round page's
 * layout (rounds, boxes, the strip) is in `rounds.ts`. Nothing here computes
 * a target, a load or a label: those come from `buildWorkoutTableView` and
 * `buildActiveSetView` (domain).
 */
import type { StepTarget, TableColumns, TableRow } from '@fizz/domain';
import type { SessionCommand, SetValues, ZonedTimestamp } from '@fizz/schemas';

/** The open row's number cells (`OpenSetRow`); the keypad bar follows the one that has focus. */
export type TileId = 'load' | 'time' | 'distance' | 'reps';

// ---------------------------------------------------------------------------
// Rows

/** A value a table cell edits in place (18 Oct). */
export type CellField = 'load' | 'reps' | 'time' | 'distance';

export type RowTap =
  | { kind: 'edit'; setId: string }
  | { kind: 'select'; setId: string }
  /** A pending row's cell: it becomes the open row, then that cell's editor opens (`set_active_set`, no new command). */
  | { kind: 'select_edit'; setId: string; field: CellField }
  /** A done row's cell: its editor opens under the row; saved as one versioned correction on close (rule 2). */
  | { kind: 'correct'; setId: string; field: CellField }
  /** A done row's ✓ (v3 §3): unticks it (`undo_log`; the domain allows only the latest log). */
  | { kind: 'untick'; setId: string }
  | { kind: 'none' };

/** Where on a row the tap landed: the row itself (set number, long-press), its ring / tick, or a value cell. */
export type RowPart = 'row' | 'marker' | 'load' | 'value';

/** The field a row's value cell edits. */
export function valueFieldOf(columns: Pick<TableColumns, 'valueLabel'>): CellField {
  // Cardio's one `TIME · DIST` cell opens its time and distance together (19 Oct).
  return columns.valueLabel === 'TIME' || columns.valueLabel === 'TIME · DIST' ? 'time' : columns.valueLabel === 'DIST' ? 'distance' : 'reps';
}

/**
 * A row tap (§2A.7; 18 Oct, Ben: "the table stays a table"): a KG or REPS
 * cell edits in place, never on a separate screen. A pending row's cell
 * makes it the open row and opens that cell; a done row's cell opens a
 * correction in its row. The row's set number (or a long-press) opens Edit
 * set for type, side and notes. A pending row's ring only makes it current
 * (Ben's decision 3: never a log). The open and skipped rows do nothing here.
 */
export function rowTap(row: Pick<TableRow, 'state' | 'setId'> & { columns?: Pick<TableColumns, 'loadLabel' | 'valueLabel'> }, part: RowPart = 'row'): RowTap {
  const field: CellField | null = part === 'value' ? valueFieldOf(row.columns ?? { valueLabel: 'REPS' }) : part === 'load' && row.columns?.loadLabel != null ? 'load' : null;
  switch (row.state) {
    case 'done':
      if (part === 'marker') return { kind: 'untick', setId: row.setId };
      return field !== null ? { kind: 'correct', setId: row.setId, field } : { kind: 'edit', setId: row.setId };
    case 'pending':
      if (field !== null) return { kind: 'select_edit', setId: row.setId, field };
      return part === 'marker' ? { kind: 'select', setId: row.setId } : { kind: 'edit', setId: row.setId };
    case 'open':
    case 'skipped':
      return { kind: 'none' };
  }
}

export interface RowTapHandlers {
  dismissKeyboard: () => void;
  edit: (setId: string) => void;
  select: (setId: string) => void;
  selectEdit: (setId: string, field: CellField) => void;
  correct: (setId: string, field: CellField) => void;
  untick: (setId: string) => void;
}

/**
 * Runs a row tap (review S3, F5): any tap that does something closes the
 * number pad first, so tapping another row is a tap outside the open row's
 * fields (the Table keeps taps with `keyboardShouldPersistTaps: 'handled'`).
 */
export function runRowTap(row: Parameters<typeof rowTap>[0], h: RowTapHandlers, part: RowPart = 'row'): RowTap {
  const tap = rowTap(row, part);
  if (tap.kind === 'none') return tap;
  h.dismissKeyboard();
  if (tap.kind === 'edit') h.edit(tap.setId);
  else if (tap.kind === 'select') h.select(tap.setId);
  else if (tap.kind === 'select_edit') h.selectEdit(tap.setId, tap.field);
  else if (tap.kind === 'untick') h.untick(tap.setId);
  else h.correct(tap.setId, tap.field);
  return tap;
}

// ---------------------------------------------------------------------------
// In-place cell editing (18 Oct)

/** The cell being edited in place: on the open row (the draft path) or a done row (a correction). */
export interface CellEdit {
  setId: string;
  field: CellField;
  row: 'open' | 'done';
}

export type CellEditEvent =
  /** A cell tap: opens it, or closes it when it's the one already open. */
  | { kind: 'tap'; setId: string; field: CellField; row: 'open' | 'done' }
  /** `Enter load` (rest) or the keypad's next field: opens the open row's cell, never toggles it shut. */
  | { kind: 'enter'; setId: string; field: CellField }
  /** Done, a tap elsewhere, a scroll, another row's tap. */
  | { kind: 'close' }
  /** A Log or a select: the editor never comes back by itself (an Undo makes the set current again; review S3). */
  | { kind: 'logged' }
  | { kind: 'selected' };

export function cellEditReducer(cur: CellEdit | null, e: CellEditEvent): CellEdit | null {
  switch (e.kind) {
    case 'tap':
      return cur !== null && cur.setId === e.setId && cur.field === e.field && cur.row === e.row ? null : { setId: e.setId, field: e.field, row: e.row };
    case 'enter':
      return { setId: e.setId, field: e.field, row: 'open' };
    case 'close':
    case 'logged':
    case 'selected':
      return null;
  }
}

/** The open row's cell being edited, when the edit is for the set that's open now. */
export function openRowEditing(cur: CellEdit | null, activeSetId: string | null): CellField | null {
  return cur !== null && cur.row === 'open' && cur.setId === activeSetId ? cur.field : null;
}

/** The done row being corrected in place, if any. */
export function doneRowEditing(cur: CellEdit | null): CellEdit | null {
  return cur !== null && cur.row === 'done' ? cur : null;
}

const UNIT_WORD: Record<string, string> = { KG: 'kg', LB: 'lb' };

/**
 * VoiceOver for a load cell (review S7): `Load 100 kg`, `Assistance 20 kg`,
 * `Added load 10 kg`, `Load: bodyweight`, `Load: none`. A cell that already
 * carries its unit (`25 lb each`) is read as it is.
 */
export function loadCellA11y(loadLabel: string | null, cell: string | null): string {
  const label = loadLabel ?? 'KG';
  const word = label.startsWith('ASSIST') ? 'Assistance' : label.startsWith('+') ? 'Added load' : 'Load';
  const text = (cell ?? '').replace(/\u00a0/g, ' ').trim();
  if (text === 'BW') return `${word}: bodyweight`;
  if (text === '' || text === '—') return `${word}: none`;
  if (/[a-z]/i.test(text)) return `${word} ${text}`;
  const unit = UNIT_WORD[label.replace(/^(ASSIST |\+)/, '')] ?? '';
  return `${word} ${text}${unit === '' ? '' : ` ${unit}`}`;
}

/** VoiceOver for a value cell: `Reps 6 to 8`, `Time 0:45`, `Distance 20 m`, `Reps: none`. */
export function valueCellA11y(valueLabel: TableColumns['valueLabel'], cell: string): string {
  const word = valueLabel === 'TIME · DIST' ? 'Time and distance' : valueLabel === 'TIME' ? 'Time' : valueLabel === 'DIST' ? 'Distance' : 'Reps';
  const text = cell.replace(/\u00a0/g, ' ').trim();
  if (text === '' || text === '—') return `${word}: none`;
  return `${word} ${text.replace(/(\d)\s*–\s*(\d)/g, '$1 to $2')}`;
}

type CorrectableValues = Pick<SetValues, 'load' | 'reps' | 'durationS' | 'distanceM'>;

/**
 * A done row's in-place correction (rule 2): only the values that differ
 * from what was logged, or null when nothing changed (no write, no toast).
 * Sent once on close as `correctSet` with the set's version, never per step.
 */
export function correctionPatch(actual: CorrectableValues, edited: CorrectableValues): Partial<CorrectableValues> | null {
  const patch: Partial<CorrectableValues> = {};
  for (const k of ['load', 'reps', 'durationS', 'distanceM'] as const) {
    if (JSON.stringify(edited[k]) !== JSON.stringify(actual[k])) Object.assign(patch, { [k]: edited[k] });
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** The one command a select sends: `set_active_set`, versioned. Never `log_set`. */
export function selectCommand(setId: string, expectedVersion: number, at: ZonedTimestamp, opId: string): Extract<SessionCommand, { type: 'set_active_set' }> {
  return { type: 'set_active_set', at, opId, setId, expectedVersion };
}

/** The part of a command outcome a select needs. */
export type SelectOutcome = { ok: true; aggregate: { session: { version: number } } } | { ok: false; error: { code: string; message: string } };

export interface SelectRowInput {
  setId: string;
  /** The session version the screen holds. */
  version: number;
  /** The open row's unsaved edit as a `save_draft`, or null when there is none. */
  draft: Extract<SessionCommand, { type: 'save_draft' }> | null;
  at: ZonedTimestamp;
  opId: string;
  /** Saves the draft (a plain dispatch). */
  save: (cmd: SessionCommand) => Promise<SelectOutcome>;
  /** Sends the select (the screen's `run`, which updates the screen and reloads after a refusal). */
  select: (cmd: Extract<SessionCommand, { type: 'set_active_set' }>) => Promise<SelectOutcome>;
}

/**
 * Selecting a pending row (§2A.7, Ben decision 4): the open row's unsaved
 * edit is saved first (the 300 ms debounce would otherwise be cancelled by
 * the select), then `set_active_set` goes with the version that save
 * returned, so it isn't refused as stale. A failed save still selects on
 * the screen's version. Never logs. Returns what to tell Ben: nothing, or
 * the refusal (a stale version is quiet: the screen reloads and a double
 * tap needs no message).
 */
export async function selectRowFlow(i: SelectRowInput): Promise<{ ok: true } | { ok: false; quiet: boolean; code: string; message: string }> {
  let version = i.version;
  if (i.draft !== null) {
    const saved = await i.save(i.draft);
    if (saved.ok) version = saved.aggregate.session.version;
  }
  const r = await i.select(selectCommand(i.setId, version, i.at, i.opId));
  if (r.ok) return { ok: true };
  // Only a stale version is a double tap; `write_conflict` and the rest are real failures Ben must see (review r2 S4).
  return { ok: false, quiet: r.error.code === 'stale_version', code: r.error.code, message: r.error.message };
}

// ---------------------------------------------------------------------------
// Top bar menu

export type WorkoutView = 'table' | 'focus';

export type WorkoutMenuId = 'view' | 'pause' | 'rename' | 'gym' | 'cues' | 'coach' | 'finish' | 'edit_times' | 'discard';

/**
 * The top bar's `⋯` (§4.6), in order. `Finish workout` lives here (and in
 * the Log slot once all planned sets are done, never in the list or beside
 * Log). At AX1+ the gym chip moves in here.
 */
export function workoutMenu(o: {
  view: WorkoutView;
  paused: boolean;
  openEnded: boolean;
  ax: boolean;
  gymName: string | null;
  /** Spoken cues on or off (the quick toggle mirrors Settings › Voice); absent when this build can't speak. */
  cuesOn?: boolean | undefined;
}): { id: WorkoutMenuId; label: string }[] {
  return [
    { id: 'view' as const, label: o.view === 'table' ? 'Focus view' : 'Table view' },
    { id: 'pause' as const, label: o.paused ? 'Resume workout' : 'Pause workout' },
    ...(o.openEnded ? [] : [{ id: 'rename' as const, label: 'Rename workout' }]),
    ...(o.ax && o.gymName !== null ? [{ id: 'gym' as const, label: `Gym: ${o.gymName} ›` }] : []),
    ...(o.cuesOn === undefined ? [] : [{ id: 'cues' as const, label: o.cuesOn ? 'Turn off spoken cues' : 'Turn on spoken cues' }]),
    { id: 'coach' as const, label: 'Ask the coach' },
    { id: 'finish' as const, label: 'Finish workout' },
    { id: 'edit_times' as const, label: 'Edit workout times' },
    { id: 'discard' as const, label: 'Discard workout' },
  ];
}

/** Stored device setting (`workoutView`): Table unless Ben chose Focus. */
export function workoutViewOf(pref: unknown): WorkoutView {
  return pref === 'focus' ? 'focus' : 'table';
}

// ---------------------------------------------------------------------------
// The keypad's next field (design pass 1.4, Ben approved 20 Oct)

/**
 * The field `Next ›` moves to from the focused one: weight, then reps (a
 * cardio set's time, then its distance). Null: the accessory shows `Done`,
 * which closes the keypad and the editor together.
 */
export function keypadNext(p: { field: CellField | null; has: { reps: boolean; distance: boolean }; cardio: boolean }): CellField | null {
  if (p.field === 'load' && p.has.reps) return 'reps';
  if (p.field === 'time' && p.cardio && p.has.distance) return 'distance';
  return null;
}

/**
 * A value cell tapped in the open row (1.4): close it when it's the open
 * one, else open it with its field focused (`focus`), so typing starts at
 * once and, with the keypad already up, it stays up.
 */
export function openCellTap(editing: CellField | null, tapped: CellField): { kind: 'close' } | { kind: 'focus'; field: CellField } {
  return editing === tapped ? { kind: 'close' } : { kind: 'focus', field: tapped };
}

/** What `Next ›` does (review S3): focus the open row's next field, a done row's distance, or its next cell. */
export type KeypadNextAction = { kind: 'focus_open'; field: CellField } | { kind: 'focus_done_distance' } | { kind: 'done_cell'; setId: string; field: CellField };

/** The fields a row's editor has, for `keypadNext`. */
export interface KeypadFields {
  reps: boolean;
  distance: boolean;
  cardio: boolean;
}

/**
 * `Next ›` on the number keypad (design pass 1.4, review S3): from the focused
 * field to the next one, on the open row or a done row's correction. Null: the
 * accessory shows `Done`. A done row moves within the same correction, so its
 * draft and opId carry over and one `correctSet` is sent on close.
 */
export function keypadNextAction(p: { keypad: { row: 'open' | 'done'; field: CellField } | null; open: KeypadFields | null; done: (KeypadFields & { setId: string }) | null }): KeypadNextAction | null {
  if (p.keypad === null) return null;
  const fields = p.keypad.row === 'open' ? p.open : p.done;
  if (fields === null) return null;
  const next = keypadNext({ field: p.keypad.field, has: { reps: fields.reps, distance: fields.distance }, cardio: fields.cardio });
  if (next === null) return null;
  if (p.keypad.row === 'open') return { kind: 'focus_open', field: next };
  if (next === 'distance') return { kind: 'focus_done_distance' };
  return p.done === null ? null : { kind: 'done_cell', setId: p.done.setId, field: next };
}

/**
 * A done row's correction draft after one field changes (review S3): the
 * values shown plus the change, same set and opId, so `Next ›` from the
 * weight to the reps keeps the typed weight.
 */
export function mergeCorrection<V extends object>(c: { setId: string; values: V | null; opId: string } | null, shown: V, patch: Partial<V>): { setId: string; values: V; opId: string } | null {
  return c === null ? null : { ...c, values: { ...shown, ...patch } };
}

// ---------------------------------------------------------------------------
// In-place cell entry (Ben, 20 Oct)

/**
 * Whether a cell edits in place (Ben, 20 Oct: "it should just use the original
 * input and change there"): the tapped KG, REPS, TIME or DIST cell becomes the
 * field itself, with no second editor line. Cardio's one `TIME · DIST` cell
 * holds two values, so it keeps its time-and-distance pair under the row.
 */
export function editsInPlace(p: { field: CellField; cardio: boolean }): boolean {
  return !(p.cardio && (p.field === 'time' || p.field === 'distance'));
}

/** A field's value and its achievable steps (from `buildActiveSetView` / `buildSetEditView`). */
export interface CellStepField {
  value: number | null;
  down: StepTarget;
  up: StepTarget;
}

/** The fields a row's in-place entry can edit. */
export interface CellFields {
  load: (CellStepField & { assisted: boolean }) | null;
  reps: CellStepField | null;
  duration: CellStepField | null;
  distance: CellStepField | null;
}

/** The bar on the keypad while a cell is edited in place: − + (one achievable step), `Next ›` when there is a next field, `Done`. */
export interface CellKeypadBar {
  field: CellField;
  down: StepTarget;
  up: StepTarget;
  /** VoiceOver for − and +: `Decrease weight to 5 kg`, `More assistance (easier) to 25 kg`; the disabled reason as a hint. */
  decreaseLabel: string;
  increaseLabel: string;
  /** Why + is off at the equipment's max (`Max 40 kg`), shown on the bar as the stepper showed it; null otherwise. */
  limit: string | null;
  next: KeypadNextAction | null;
}

function stepFieldOf(fields: CellFields, field: CellField): CellStepField | null {
  return field === 'load' ? fields.load : field === 'reps' ? fields.reps : field === 'time' ? fields.duration : fields.distance;
}

/**
 * The keypad bar for the cell being edited, or null (no cell, or cardio's
 * pair, which keeps its own − / + tiles). The steps are the domain's own
 * (achievable loads on this gym's equipment, ±1 rep), never worked out here.
 */
export function cellKeypadBar(p: { field: CellField | null; fields: CellFields | null; cardio: boolean; next: KeypadNextAction | null }): CellKeypadBar | null {
  if (p.field === null || p.fields === null || !editsInPlace({ field: p.field, cardio: p.cardio })) return null;
  const f = stepFieldOf(p.fields, p.field);
  if (f === null) return null;
  const assisted = p.field === 'load' && p.fields.load?.assisted === true;
  const noun = p.field === 'load' ? 'weight' : p.field;
  const decrease = assisted ? 'Less assistance (harder)' : `Decrease ${noun}`;
  const increase = assisted ? 'More assistance (easier)' : `Increase ${noun}`;
  const label = (describe: string, t: StepTarget) => (t.enabled ? `${describe} to ${t.label}` : describe);
  const limit = !f.up.enabled && f.value !== null ? f.up.reason : null;
  return { field: p.field, down: f.down, up: f.up, decreaseLabel: label(decrease, f.down), increaseLabel: label(increase, f.up), limit, next: p.next };
}

/**
 * VoiceOver for a cell while it is the field (Ben, 20 Oct): `Set 3 weight,
 * 7.5 kg each`, `Set 3 reps, 12`, `Set 2 assistance, 20 kg`, `Set 1 time,
 * 45 seconds`, `Set 4 weight, none`.
 */
export function cellInputA11y(p: { setLabel: string; field: CellField; value: number | null; unitText?: string | null; assisted?: boolean }): string {
  const noun = p.field === 'load' ? (p.assisted === true ? 'assistance' : 'weight') : p.field;
  if (p.value === null) return `Set ${p.setLabel} ${noun}, none`;
  const unit = p.field === 'load' ? (p.unitText ?? '') : p.field === 'time' ? 'seconds' : p.field === 'distance' ? 'metres' : '';
  return `Set ${p.setLabel} ${noun}, ${String(p.value)}${unit === '' ? '' : ` ${unit}`}`;
}
