/**
 * The workout Table view's screen logic (active-workout §2A.4, §2A.7), pure so
 * it's unit-tested: where the list scrolls to (the anchor), when it may
 * scroll by itself, the `↑ N done` and `Now ↓` chips, what a row tap does,
 * which block is folded, and the top bar's `⋯` menu. Nothing here computes a
 * target, a load or a label: those come from `buildWorkoutTableView` and
 * `buildActiveSetView` (domain).
 */
import type { TableBlock, TableColumns, TableRow } from '@fizz/domain';
import type { SessionCommand, SetValues, ZonedTimestamp } from '@fizz/schemas';

// ---------------------------------------------------------------------------
// Anchoring

/** Content-space positions (pt) the anchor needs, measured from the list's layout. */
export interface AnchorGeometry {
  /** Top of the anchor card's header (its natural place). */
  cardTop: number;
  /** Height of that header (it pins at the top while its card is in view). */
  headerHeight: number;
  /** Top of the anchor: the after-set block when there is one, else the open row. */
  anchorTop: number;
}

/**
 * The scroll offset that puts the anchor directly under its exercise's
 * pinned header, or the header in its natural place when the anchor is the
 * card's first row (§2A.4). Never negative.
 */
export function anchorScrollY(g: AnchorGeometry): number {
  return Math.max(0, Math.max(g.cardTop, g.anchorTop - g.headerHeight));
}

/** The open row's number tiles (`OpenSetRow`); the keypad anchors the one that has focus (WT39). */
export type TileId = 'load' | 'time' | 'distance' | 'reps';

/** Clearance (pt) kept between a tile's bottom and whatever edge it must clear (the keypad, the rest or Log bar). */
export const TILE_CLEARANCE = 8;

/**
 * Where the open row's tiles are (relative to the open row's top), for the
 * set and the keypad state they were measured under. The keypad hides the
 * plate line and `Last` above the tiles, so a report measured with the
 * keypad closed is ~28 pt off once it opens, until the next layout pass
 * (review r3 S1).
 */
export interface TileReport {
  setId: string;
  keypadOpen: boolean;
  boxes: ReadonlyMap<TileId, { y: number; h: number }>;
}

/**
 * The tile report an anchor may use: `fresh` when it's for this set and this
 * keypad state, `stale` when it's for this set but the other keypad state
 * (wait for the next layout, don't scroll), `none` when there's none yet.
 */
export type TileReportUse = { kind: 'fresh'; boxes: TileReport['boxes'] } | { kind: 'stale' } | { kind: 'none' };

export function tileReportFor(report: TileReport | null, want: { setId: string | null; keypadOpen: boolean }): TileReportUse {
  if (report === null || want.setId === null || report.setId !== want.setId) return { kind: 'none' };
  if (report.keypadOpen !== want.keypadOpen) return { kind: 'stale' };
  return { kind: 'fresh', boxes: report.boxes };
}

/**
 * The keypad anchor's scroll offset for the focused tile, or null to wait:
 * no keypad height yet, or no tile layout measured under the open keypad
 * (a stale report would scroll too far and clear the request; review r3 S1).
 */
export function keypadTileY(p: { geometry: OpenRowGeometry; keyboardHeight: number; tile: TileId; report: TileReportUse }): number | null {
  if (p.keyboardHeight <= 0 || p.report.kind !== 'fresh') return null;
  const box = p.report.boxes.get(p.tile);
  if (box === undefined) return null;
  return keypadScrollY({ ...p.geometry, keyboardHeight: p.keyboardHeight, tileBottom: p.geometry.openTop + box.y + box.h });
}

/** Content-space positions for the open row's anchor, measured from the list's layout. */
export interface OpenRowGeometry {
  /** Top of the anchor card's pinned header (its natural place) and its height. */
  cardTop: number;
  headerHeight: number;
  /**
   * The list's viewport with the keypad closed: the space between the top
   * bar and the rest / Log bars. The pinned header sits inside it.
   */
  viewportHeight: number;
  /** Top of the open row. */
  openTop: number;
}

/**
 * Where the list goes on open, a Log, `Now` or an off-screen select
 * (§2A.4): the after-set block directly under the pinned header, so the
 * effort chips and any offer read first. When the block and the open row's
 * tiles can't both fit (stacked tiles, an offer), the tiles win: the list
 * scrolls just far enough for the last tile to clear the bottom bars, up to
 * putting the open row itself under the header, and the block stays as much
 * as fits above it (review r2 S2). With no after-set block, the open row.
 */
export function anchorTargetY(g: OpenRowGeometry & { afterTop: number | null; tilesBottom: number | null }): number {
  const openY = anchorScrollY({ cardTop: g.cardTop, headerHeight: g.headerHeight, anchorTop: g.openTop });
  if (g.afterTop === null) return openY;
  const afterY = anchorScrollY({ cardTop: g.cardTop, headerHeight: g.headerHeight, anchorTop: g.afterTop });
  if (g.tilesBottom === null) return afterY;
  const needed = g.tilesBottom + TILE_CLEARANCE - g.viewportHeight;
  if (needed <= afterY) return afterY;
  return Math.max(afterY, Math.min(openY, needed));
}

/**
 * Where the list goes when one of the open row's tiles takes the keypad
 * (WT39, review r2 B1). The keypad (`keyboardWillShow`'s
 * `endCoordinates.height`, its Done bar included) lifts the rest and Log
 * bars with it, so the list's visible part shrinks by that much. The open
 * row goes under the pinned header when the focused tile then still clears
 * the bars above the keypad; otherwise the list scrolls further, until the
 * focused tile's bottom does. Its numeral and − / + are at that bottom edge,
 * so they're what stays in view when even the tile can't fit under the
 * header (a 375 × 667 phone during rest).
 */
export function keypadScrollY(g: OpenRowGeometry & { keyboardHeight: number; tileBottom: number }): number {
  const openY = anchorScrollY({ cardTop: g.cardTop, headerHeight: g.headerHeight, anchorTop: g.openTop });
  const visible = g.viewportHeight - Math.max(0, g.keyboardHeight);
  const needed = g.tileBottom + TILE_CLEARANCE - visible;
  return Math.max(0, openY, Math.ceil(needed));
}

/**
 * The bottom spacer (§2A.4): the list viewport minus the content below the
 * anchor's scroll position, floor 0, so the anchor can reach the top on the
 * last sets too. `contentEnd` is where the content ends without the spacer.
 */
export function bottomSpacerHeight(p: { viewportHeight: number; contentEnd: number; anchorY: number }): number {
  return Math.max(0, Math.ceil(p.viewportHeight - (p.contentEnd - p.anchorY)));
}

/**
 * What happened on screen. Only some events move the list (§2A.4 "When the
 * anchor is applied"); everything else leaves it where Ben put it, and Ben's
 * own scrolling cancels a move that hasn't happened yet.
 */
export type AnchorEvent =
  | { kind: 'opened' }
  | { kind: 'view_switched' }
  | { kind: 'logged' }
  | { kind: 'now_chip' }
  | { kind: 'selected'; onScreen: boolean }
  /** Sent by the tile's own `onFocus`: a note, rename or coach keyboard never moves the list (review r2 B1). */
  | { kind: 'keypad_opened'; tile: TileId }
  | { kind: 'user_scrolled' }
  | { kind: 'applied' }
  // Never move the list (WT7):
  | { kind: 'reloaded' }
  | { kind: 'rest_ended' }
  | { kind: 'effort' }
  | { kind: 'offer' }
  | { kind: 'toast' };

export interface AnchorRequest {
  /** False: a jump (on open, restore, or Reduce Motion). */
  animated: boolean;
  /**
   * `anchor`: the after-set block under the pinned header when it fits with
   * the open row's tiles, else the tiles (`anchorTargetY`). `tile`: the
   * focused tile clears the keypad (`keypadScrollY`, WT39); applied once the
   * keypad's height is known.
   */
  target: { kind: 'anchor' } | { kind: 'tile'; tile: TileId };
  /** Move VoiceOver focus to the anchor once it's applied (§2A.7): on open, a view switch and after a Log. */
  focus: boolean;
}

const ANCHOR = { kind: 'anchor' } as const;

export function anchorReducer(cur: AnchorRequest | null, e: AnchorEvent, o: { reduceMotion: boolean }): AnchorRequest | null {
  switch (e.kind) {
    case 'opened':
    case 'view_switched':
      // Applied without animation on open, restore and a switch back from Focus.
      return { animated: false, target: ANCHOR, focus: true };
    case 'logged':
      return { animated: !o.reduceMotion, target: ANCHOR, focus: true };
    case 'now_chip':
      return { animated: !o.reduceMotion, target: ANCHOR, focus: false };
    case 'keypad_opened':
      // The tile Ben is typing into, not the after-set block or the open row's top (review r2 B1).
      return { animated: !o.reduceMotion, target: { kind: 'tile', tile: e.tile }, focus: false };
    case 'selected':
      // A row Ben tapped is on screen already: nothing moves under his thumb.
      return e.onScreen ? cur : { animated: !o.reduceMotion, target: ANCHOR, focus: false };
    case 'user_scrolled':
    case 'applied':
      return null;
    case 'reloaded':
    case 'rest_ended':
    case 'effort':
    case 'offer':
    case 'toast':
      return cur;
  }
}

// ---------------------------------------------------------------------------
// Chips

export interface ChipInput {
  doneCount: number;
  /** Top of the first done row or folded exercise (content space); null when none is laid out. */
  firstDoneTop: number | null;
  /** The open row's top and bottom (content space); null when there's no open row. */
  openTop: number | null;
  openBottom: number | null;
  scrollY: number;
  viewportHeight: number;
  /** What the pinned header covers at the top of the viewport. */
  pinnedHeight: number;
}

export interface ChipState {
  /** `↑ N done` replaces the title: done content above the viewport and the open row on screen. */
  done: boolean;
  /** `Now ↓` / `Now ↑`: the open row is entirely off-screen, and where it is. */
  now: 'below' | 'above' | null;
}

export function chipsFor(p: ChipInput): ChipState {
  const visibleTop = p.scrollY + p.pinnedHeight;
  const visibleBottom = p.scrollY + p.viewportHeight;
  let now: ChipState['now'] = null;
  if (p.openTop !== null && p.openBottom !== null && p.viewportHeight > 0) {
    if (p.openTop >= visibleBottom) now = 'below';
    else if (p.openBottom <= visibleTop) now = 'above';
  }
  const doneAbove = p.doneCount > 0 && p.firstDoneTop !== null && p.firstDoneTop < visibleTop - 0.5;
  return { done: doneAbove && now === null && p.openTop !== null, now };
}

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
  | { kind: 'none' };

/** Where on a row the tap landed: the row itself (set number, long-press), its ring / tick, or a value cell. */
export type RowPart = 'row' | 'marker' | 'load' | 'value';

/** The field a row's value cell edits. */
export function valueFieldOf(columns: Pick<TableColumns, 'valueLabel'>): CellField {
  return columns.valueLabel === 'TIME' ? 'time' : columns.valueLabel === 'DIST' ? 'distance' : 'reps';
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
  const word = valueLabel === 'TIME' ? 'Time' : valueLabel === 'DIST' ? 'Distance' : 'Reps';
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
// Folding

/** A folded block Ben expanded, and the block the open row was in when he did. */
export type Expansions = Readonly<Record<string, string | null>>;

/**
 * Whether a finished block shows as its one-line `FoldedExercise`. An
 * expanded one stays open until the open row moves to another block (§2A.3).
 */
export function showsFolded(block: Pick<TableBlock, 'key' | 'folded'>, expansions: Expansions, anchorBlockKey: string | null): boolean {
  if (block.folded === null) return false;
  if (!(block.key in expansions)) return true;
  return expansions[block.key] !== anchorBlockKey;
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
