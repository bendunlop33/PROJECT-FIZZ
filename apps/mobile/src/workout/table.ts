/**
 * The workout Table view's screen logic (active-workout §2A.4, §2A.7), pure so
 * it's unit-tested: where the list scrolls to (the anchor), when it may
 * scroll by itself, the `↑ N done` and `Now ↓` chips, what a row tap does,
 * which block is folded, and the top bar's `⋯` menu. Nothing here computes a
 * target, a load or a label: those come from `buildWorkoutTableView` and
 * `buildActiveSetView` (domain).
 */
import type { TableBlock, TableRow } from '@fizz/domain';
import type { SessionCommand, ZonedTimestamp } from '@fizz/schemas';

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
  | { kind: 'keypad_opened' }
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
}

export function anchorReducer(cur: AnchorRequest | null, e: AnchorEvent, o: { reduceMotion: boolean }): AnchorRequest | null {
  switch (e.kind) {
    case 'opened':
    case 'view_switched':
      // Applied without animation on open, restore and a switch back from Focus.
      return { animated: false };
    case 'logged':
    case 'now_chip':
    case 'keypad_opened':
      return { animated: !o.reduceMotion };
    case 'selected':
      // A row Ben tapped is on screen already: nothing moves under his thumb.
      return e.onScreen ? cur : { animated: !o.reduceMotion };
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

export type RowTap = { kind: 'edit'; setId: string } | { kind: 'select'; setId: string } | { kind: 'none' };

/**
 * A row tap (§2A.7, Ben's decision 4): a done row opens the correction
 * sheet; a pending row (anywhere, its ring included) only becomes the open
 * row; the open and skipped rows do nothing. No tap here ever logs.
 */
export function rowTap(row: Pick<TableRow, 'state' | 'setId'>): RowTap {
  switch (row.state) {
    case 'done':
      return { kind: 'edit', setId: row.setId };
    case 'pending':
      return { kind: 'select', setId: row.setId };
    case 'open':
    case 'skipped':
      return { kind: 'none' };
  }
}

/** The one command a select sends: `set_active_set`, versioned. Never `log_set`. */
export function selectCommand(setId: string, expectedVersion: number, at: ZonedTimestamp, opId: string): Extract<SessionCommand, { type: 'set_active_set' }> {
  return { type: 'set_active_set', at, opId, setId, expectedVersion };
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

export type WorkoutMenuId = 'view' | 'pause' | 'rename' | 'gym' | 'coach' | 'finish' | 'edit_times' | 'discard';

/**
 * The top bar's `⋯` (§4.6), in order. `Finish workout` lives here (and in
 * the Log slot once all planned sets are done, never in the list or beside
 * Log). At AX1+ the gym chip moves in here.
 */
export function workoutMenu(o: { view: WorkoutView; paused: boolean; openEnded: boolean; ax: boolean; gymName: string | null }): { id: WorkoutMenuId; label: string }[] {
  return [
    { id: 'view' as const, label: o.view === 'table' ? 'Focus view' : 'Table view' },
    { id: 'pause' as const, label: o.paused ? 'Resume workout' : 'Pause workout' },
    ...(o.openEnded ? [] : [{ id: 'rename' as const, label: 'Rename workout' }]),
    ...(o.ax && o.gymName !== null ? [{ id: 'gym' as const, label: `Gym: ${o.gymName} ›` }] : []),
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
