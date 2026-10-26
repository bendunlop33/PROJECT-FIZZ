import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { AccessibilityInfo, Animated, Keyboard, PanResponder, Pressable, ScrollView, useWindowDimensions, View, type TextInput } from 'react-native';

import { formatDuration, NBSP, type FocusView, type LoadField, type RestView, type SetLast, type StepTarget } from '@fizz/domain';
import type { SetSide } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Icon, LinkLine, NumberStepper, StatusLine, StepperTileRow, TextButton, TEXT_PRESSED_OPACITY, type SymbolName } from '../../ui';
import { CARDIO_TIME_FORMAT } from '../../ui/number-text';
import { cellInputA11y, editsInPlace, loadCellA11y, runRowTap, valueCellA11y, type CellField, type RowPart, type RowTap, type TileId } from '../../workout/table';
import { REVEAL_CONTEXT, REVEAL_MARGIN, revealOffset, revealSetId, type Round, type RoundExercise, type RoundRow } from '../../workout/rounds';
import { setColumns, widestText, type SetColumns } from '../../workout/set-columns';
import { claimsDrag, swipeIntent } from '../../workout/set-pager';
import { workTimerText } from '../../workout/cues';
import { cardioPairTiles, openRowWidth } from '../../workout/tile-fit';
import { ROUND_TABLE_KEYBOARD } from '../../workout/keyboard';
import { GymPartDivider, SnapNote } from './GymSwitch';
import { DragItem, DragList, useDragHandle } from '../../ui/drag-list';
import { dropIndex } from '../../ui/drag-logic';

/**
 * The active workout's round page (workout-table-v3.md §1–§3; prototype
 * `docs/design/prototypes/workout-active-v3.html`): one round per page, a
 * superset's `3a` / `3b` stacked without a box, each exercise's sets in a
 * per-set table `SET · PREVIOUS · KG · REPS · RIR · ✓` (Ben, 26 Oct). The
 * whole round is one scroll view (Ben, 26 Oct: smoother than the 20 Oct
 * per-exercise boxes); it moves on its own only to bring the current set into
 * view when it's off-screen. Every value comes from `buildWorkoutTableView` /
 * `buildActiveSetView` (domain) through `buildRounds`; the column widths from
 * `setColumns`. This file lays them out and reports taps; the screen owns
 * every command (one Log path, `WorkoutScreen.log`).
 */

const plainSpaces = (s: string) => s.replaceAll(NBSP, ' ');

/** Swipe this far left on a row to delete it (§2). */
const DELETE_DX = 96;

// ---------------------------------------------------------------------------
// The round page

export interface RoundPageProps {
  round: Round;
  ax: boolean;
  reduceMotion: boolean;
  /** The open row (`OpenSetRow`), drawn in place of the active set's row. */
  openRow: ReactNode;
  /** Effort chips, record, pain check, coach slot, gym card for the set just saved; under the card. Null when empty. */
  afterSet: ReactNode;
  /** `4 Lateral raise`; null when nothing is next. */
  upNext: string | null;
  /** The coach's inline `Adjust` row under the current exercise's header (opened from its `⋯`, Ben 26 Oct). */
  adjustRow: ReactNode;
  /** The warm-up ramp suggestion with `Hide`, under the current exercise's header; null when none. */
  warmUp: ReactNode;
  /** The open row's set cell: VoiceOver focus lands here after a Log or a round change (§6). */
  focusRef: RefObject<View | null>;
  /** When the page brings the current set into view: a log, an untick, a round change. */
  positionKey: string;
  /** A cell is being typed in (the page never moves on its own then, except to keep that row in view). */
  editingSetId: string | null;
  /** The keypad's height (0 closed): a cell being typed in stays in view. */
  keyboardHeight: number;
  /** A set just added with `＋ Set`: the page brings it into view and it flashes once. */
  highlightSetId: string | null;
  onHighlightShown: () => void;
  /** A done row's in-place correction; null when none is open. `inCell`: drawn in the cell, else under the row. */
  rowEditor: { setId: string; field: CellField; node: ReactNode; inCell: boolean } | null;
  canPrev: boolean;
  canNext: boolean;
  onRound: (direction: 'prev' | 'next') => void;
  onEditSet: (setId: string) => void;
  onSelectSet: (setId: string) => void;
  onCellTap: (tap: Extract<RowTap, { kind: 'select_edit' | 'correct' }>) => void;
  /** A done row's ✓: undo that log (the domain refuses anything but the latest). */
  onUntick: (setId: string) => void;
  /** Swipe left on a row (or VoiceOver's Delete): delete with Undo. */
  onDeleteSet: (setId: string, name: string) => void;
  /** A tap on the card outside the rows: closes any cell editor. */
  onTapElsewhere: () => void;
  onAddSet: (sessionExerciseId: string) => void;
  onWhy: (exerciseIndex: number) => void;
  onMenu: (sessionExerciseId: string) => void;
  onName: (card: { sessionExerciseId: string; exerciseId: string; name: string; isCurrent: boolean }) => void;
  /** `pinnedOpen`: the pinned line was tapped (the sheet opens on the pin; Ben, 26 Oct). */
  onNote: (sessionExerciseId: string, name: string, note: string | null, pinnedOpen?: boolean) => void;
  onPainBadge: (exerciseId: string) => void;
  /**
   * v3 §7 (same editing as the builder): press and hold a set row, then drag it among the sets not
   * done yet (done sets stay in logged order); a hold without a drag opens its menu; VoiceOver has
   * Move up / Move down and Change type. Absent: off.
   */
  setEdit?: {
    /** The exercise's sets a drag can move, in order. */
    movable: (sessionExerciseId: string) => readonly string[];
    moves: (setId: string) => { up: boolean; down: boolean };
    onDrop: (setId: string, to: number) => void;
    onMenu: (setId: string) => void;
    onMove: (setId: string, dir: 'up' | 'down') => void;
    onChangeType: (setId: string) => void;
  };
  /** v3 §6–§7: the exercise header's VoiceOver actions beyond next / previous (Swap, Move, Superset, Unlink, Remove). */
  exerciseActions?: (sessionExerciseId: string) => { name: string; label: string }[];
  onExerciseAction?: (sessionExerciseId: string, name: string) => void;
  /** `＋ Add exercise` under the last round (v3 §7, the builder's add flow); null on other rounds. */
  onAddExercise?: (() => void) | null;
  /** (Ben, 26 Oct) A tap on a set-not-done row's PREVIOUS: copy it into that row (the open row's draft). */
  onCopyLast?: (setId: string) => void;
  /** (Ben, 26 Oct) A tap on a row's RIR cell (or its menu / VoiceOver action): enter reps in reserve for that set. */
  onRir?: (setId: string) => void;
  /** (Ben, 26 Oct) Done sets that are a new best (Summary's `New best` definition): a small `PB` on the row. */
  pbSetIds?: ReadonlySet<string>;
}

/**
 * The row callbacks, stable for the page's life (they read the latest props), so a memoised row isn't redrawn
 * just because the screen re-rendered (a timer tick): only when what it shows changes (`RoundRow.renderKey`).
 */
interface RowActions {
  press: (r: RoundRow, part: RowPart) => void;
  del: (r: RoundRow) => void;
  copyLast: (setId: string) => void;
  rir: (setId: string) => void;
  move: (setId: string, dir: 'up' | 'down') => void;
  changeType: (setId: string) => void;
  menu: (setId: string) => void;
}

/** Keyed by the round (`key={round.key}`), so a new round starts at its top (or its current set). */
export function RoundPage(props: RoundPageProps) {
  const theme = useTheme();
  const { round } = props;
  const latest = useRef(props);
  latest.current = props;
  const page = useRef<ScrollView>(null);
  /** The scroll content: rows are measured against it. */
  const content = useRef<View>(null);
  const outer = useRef<View>(null);
  const rowViews = useRef(new Map<string, View | null>());
  /** The scroll position and the visible height (it shrinks with the keypad: the screen pads for it). */
  const view = useRef({ y: 0, h: 0 });
  const placed = useRef(false);
  /** A row to bring into view once it's laid out (the current set on a round change, a set just added). */
  const pending = useRef<{ setId: string; context: boolean; jump: boolean } | null>(null);

  const reveal = useCallback(
    (setId: string, o: { context: boolean; jump: boolean }): boolean => {
      const row = rowViews.current.get(setId);
      const c = content.current;
      if (row == null || c === null || view.current.h <= 0) return false;
      row.measureLayout(
        c,
        (_x, y, _w, h) => {
          const v = view.current;
          const to = revealOffset({ offset: v.y, viewHeight: v.h, rowTop: y, rowHeight: h, context: o.context ? REVEAL_CONTEXT : 0, margin: REVEAL_MARGIN });
          if (Math.abs(to - v.y) < 1) return;
          page.current?.scrollTo({ y: to, animated: !o.jump && !latest.current.reduceMotion });
          v.y = to;
        },
        () => undefined,
      );
      return true;
    },
    [],
  );

  const flush = useCallback(() => {
    const p = pending.current;
    if (p === null) return;
    if (reveal(p.setId, p)) {
      pending.current = null;
      if (latest.current.highlightSetId === p.setId) latest.current.onHighlightShown();
    }
  }, [reveal]);

  // A log, an untick or a round change (`positionKey`), and only then: the current set comes into view if it's
  // off-screen; never while typing. Other re-renders (a draft, a timer, a minute's pain check) never move the page,
  // so a look at another exercise isn't pulled back.
  useEffect(() => {
    if (latest.current.editingSetId !== null) return;
    const id = revealSetId(latest.current.round);
    if (id === null) return;
    // The first placement in a round is a jump; later ones (a log, an untick) move gently, with the motion setting.
    pending.current = { setId: id, context: true, jump: !placed.current };
    placed.current = true;
    const t = requestAnimationFrame(flush);
    return () => {
      cancelAnimationFrame(t);
    };
  }, [props.positionKey, flush]);

  // `＋ Set` (Ben, 20 Oct): the new row comes into view and flashes once it's laid out.
  useEffect(() => {
    if (props.highlightSetId === null) return;
    pending.current = { setId: props.highlightSetId, context: false, jump: false };
    const t = requestAnimationFrame(flush);
    return () => {
      cancelAnimationFrame(t);
    };
  }, [props.highlightSetId, flush]);

  // The cell being typed in stays in view as the keypad (and the slim rest strip) take room (review B3).
  useEffect(() => {
    if (props.editingSetId === null) return;
    const id = props.editingSetId;
    const t = requestAnimationFrame(() => {
      reveal(id, { context: false, jump: false });
    });
    return () => {
      cancelAnimationFrame(t);
    };
  }, [props.editingSetId, props.keyboardHeight, reveal]);

  // VoiceOver: the open row after a Log or a round change (§6).
  useEffect(() => {
    const t = setTimeout(() => {
      if (props.focusRef.current !== null) AccessibilityInfo.sendAccessibilityEvent(props.focusRef.current, 'focus');
    }, 350);
    return () => {
      clearTimeout(t);
    };
  }, [props.positionKey]);

  const actions = useMemo<RowActions>(
    () => ({
      press: (r, part) => {
        const p = latest.current;
        runRowTap(
          r.row,
          {
            dismissKeyboard: () => {
              Keyboard.dismiss();
            },
            edit: (setId) => {
              p.onTapElsewhere();
              p.onEditSet(setId);
            },
            select: (setId) => {
              haptic('step');
              p.onTapElsewhere();
              p.onSelectSet(setId);
            },
            selectEdit: (setId, field) => {
              haptic('step');
              p.onCellTap({ kind: 'select_edit', setId, field });
            },
            correct: (setId, field) => {
              haptic('step');
              p.onCellTap({ kind: 'correct', setId, field });
            },
            untick: (setId) => {
              haptic('step');
              p.onTapElsewhere();
              p.onUntick(setId);
            },
          },
          part,
        );
      },
      del: (r) => {
        latest.current.onDeleteSet(r.setId, r.stepName);
      },
      copyLast: (setId) => {
        latest.current.onCopyLast?.(setId);
      },
      rir: (setId) => {
        latest.current.onRir?.(setId);
      },
      move: (setId, dir) => {
        latest.current.setEdit?.onMove(setId, dir);
      },
      changeType: (setId) => {
        latest.current.setEdit?.onChangeType(setId);
      },
      menu: (setId) => {
        latest.current.setEdit?.onMenu(setId);
      },
    }),
    [],
  );

  /** A set row is being dragged (§7): the page holds still. */
  const [dragging, setDragging] = useState(false);
  const swipe = useSwipe((d) => {
    if (d === 'next' ? props.canNext : props.canPrev) {
      haptic('step');
      props.onRound(d);
    }
  });

  return (
    <View
      ref={outer}
      style={{ flex: 1 }}
      onLayout={(e) => {
        view.current.h = e.nativeEvent.layout.height;
        flush();
        // The keypad took room: the row being typed in stays in view.
        const editing = latest.current.editingSetId;
        if (editing !== null) reveal(editing, { context: false, jump: false });
      }}
    >
      <ScrollView
        ref={page}
        scrollEnabled={!dragging}
        scrollEventThrottle={32}
        onScroll={(e) => {
          view.current.y = e.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={flush}
        {...ROUND_TABLE_KEYBOARD}
        contentContainerStyle={{ paddingHorizontal: theme.space['4'], paddingBottom: theme.space['4'], gap: theme.space['2'] }}
      >
        <View ref={content} collapsable={false} style={{ gap: theme.space['2'] }}>
          <View {...swipe.panHandlers}>
            <Pressable accessible={false} onPress={props.onTapElsewhere} style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['3'], gap: theme.space['3'] }}>
              {round.exercises.map((ex, i) => (
                <View key={ex.sessionExerciseId} style={i > 0 ? { borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingTop: theme.space['3'] } : undefined}>
                  <ExerciseBlock
                    ex={ex}
                    index={i}
                    superset={round.superset}
                    page={props}
                    actions={actions}
                    outer={outer}
                    onDragChange={setDragging}
                    rowRef={(setId, v) => {
                      rowViews.current.set(setId, v);
                    }}
                    onRowLaidOut={flush}
                  />
                </View>
              ))}
            </Pressable>
          </View>
          {props.onAddExercise != null ? (
            <View style={{ alignItems: 'flex-start' }}>
              <TextButton label="＋ Add exercise" onPress={props.onAddExercise} />
            </View>
          ) : null}
          {props.afterSet}
          {props.upNext !== null ? (
            <View style={{ paddingHorizontal: theme.space['1'] }}>
              <AppText variant="callout" color="text.secondary" numberOfLines={props.ax ? 3 : 1}>
                {'Up next: '}
                <AppText variant="callout" style={{ fontWeight: '600' }}>
                  {props.upNext}
                </AppText>
              </AppText>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/** Horizontal swipes on the card (§3): next / previous round. Set rows claim their own swipes first (Delete). */
function useSwipe(onSwipe: (d: 'prev' | 'next') => void) {
  const latest = useRef(onSwipe);
  latest.current = onSwipe;
  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => claimsDrag(g.dx, g.dy),
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_e, g) => {
          const d = swipeIntent(g.dx, g.dy);
          if (d !== null) latest.current(d);
        },
      }),
    [],
  );
}

// ---------------------------------------------------------------------------
// One exercise in the round

/** The column widths of one exercise's table, from its rows' texts, the window and Dynamic Type (`setColumns`). */
function useColumns(ex: RoundExercise): SetColumns {
  const { width, fontScale } = useWindowDimensions();
  const hasLoad = ex.loadHeader !== null;
  const hasRir = ex.valueHeader === 'REPS';
  // Only the longest text of each column matters, so a log that changes a value but not the longest redraws no rows.
  const previous = widestText(ex.rows.map((r) => (r.row.last === null ? '—' : r.row.last.text)));
  const load = hasLoad ? widestText(ex.rows.map((r) => r.row.cells.load ?? '—')) : '';
  const value = widestText(ex.rows.map((r) => r.row.cells.value));
  return useMemo(() => setColumns({ windowWidth: width, fontScale, hasLoad, hasRir, texts: { previous: [previous], load: hasLoad ? [load] : [], value: [value] } }), [width, fontScale, hasLoad, hasRir, previous, load, value]);
}

/** Lets the open row (drawn by the screen) line up with its exercise's columns. */
const ColumnsContext = createContext<SetColumns | null>(null);

function ExerciseBlock({
  ex,
  index,
  superset,
  page: p,
  actions,
  outer,
  onDragChange,
  rowRef,
  onRowLaidOut,
}: {
  ex: RoundExercise;
  index: number;
  superset: boolean;
  page: RoundPageProps;
  actions: RowActions;
  outer: RefObject<View | null>;
  onDragChange: (active: boolean) => void;
  rowRef: (setId: string, v: View | null) => void;
  onRowLaidOut: () => void;
}) {
  const edit = p.setEdit;
  const movable = edit?.movable(ex.sessionExerciseId) ?? [];
  const cols = useColumns(ex);
  const blockRows = p.ax || cols.blockRows;
  return (
    <View style={{ opacity: ex.dim ? 0.55 : 1 }}>
      <ExerciseHeader ex={ex} superset={superset} page={p} />
      {ex.isCurrent ? p.warmUp : null}
      {ex.isCurrent ? p.adjustRow : null}
      {blockRows ? null : <ColumnLabels cols={cols} loadHeader={ex.loadHeader} valueHeader={ex.valueHeader} />}
      <ColumnsContext.Provider value={cols}>
        {/* §7: press and hold a set not done yet, then drag it among those (done sets keep their logged order). */}
        <DragList
          enabled={edit !== undefined}
          canDrop={(_from, t) => movable.includes(t.key)}
          onDrop={(from, t) => {
            const to = dropIndex(movable, from, t);
            if (to !== null) edit?.onDrop(from, to);
          }}
          onMenu={actions.menu}
          onDragChange={onDragChange}
          viewport={outer}
        >
          {ex.rows.map((r) =>
            r.current ? (
              <View
                key={r.setId}
                ref={(v) => {
                  rowRef(r.setId, v);
                }}
                collapsable={false}
                onLayout={onRowLaidOut}
              >
                <DragItem dragKey={r.setId} draggable={movable.includes(r.setId)}>
                  {r.row.partStart !== null ? <GymPartDivider label={r.row.partStart} /> : null}
                  <SwipeRow enabled onDelete={() => { actions.del(r); }}>
                    <OpenRowContext.Provider value={{ row: r, loadHeader: ex.loadHeader, cols, onCopyLast: p.onCopyLast === undefined ? undefined : () => { actions.copyLast(r.setId); }, onRir: p.onRir === undefined ? undefined : () => { actions.rir(r.setId); } }}>{p.openRow}</OpenRowContext.Provider>
                  </SwipeRow>
                </DragItem>
              </View>
            ) : (
              <SetRowShell
                key={r.setId}
                r={r}
                cols={cols}
                hasLoad={ex.loadHeader !== null}
                blockRows={blockRows}
                draggable={movable.includes(r.setId)}
                editing={p.rowEditor?.setId === r.setId ? p.rowEditor.field : null}
                rowEditor={p.rowEditor?.setId === r.setId ? p.rowEditor : null}
                pb={p.pbSetIds?.has(r.setId) === true}
                canCopy={p.onCopyLast !== undefined && !r.done}
                canRir={p.onRir !== undefined}
                highlight={p.highlightSetId === r.setId}
                reduceMotion={p.reduceMotion}
                moves={edit === undefined ? null : edit.moves(r.setId)}
                actions={actions}
                rowRef={rowRef}
                onLaidOut={onRowLaidOut}
              />
            ),
          )}
        </DragList>
      </ColumnsContext.Provider>
      <CompactRow ex={ex} index={index} page={p} />
    </View>
  );
}

interface ShellProps {
  r: RoundRow;
  cols: SetColumns;
  hasLoad: boolean;
  blockRows: boolean;
  draggable: boolean;
  editing: CellField | null;
  rowEditor: RoundPageProps['rowEditor'];
  pb: boolean;
  canCopy: boolean;
  canRir: boolean;
  highlight: boolean;
  reduceMotion: boolean;
  moves: { up: boolean; down: boolean } | null;
  actions: RowActions;
  rowRef: (setId: string, v: View | null) => void;
  onLaidOut: () => void;
}

/**
 * Whether a set row needs drawing again (Ben, 26 Oct: smoother scrolling): only when what it shows changed
 * (its `renderKey`, columns, editor, marks). Callbacks are stable (`RowActions`), so a timer tick redraws none.
 */
export function sameShell(a: Pick<ShellProps, 'r' | 'cols' | 'hasLoad' | 'blockRows' | 'draggable' | 'editing' | 'rowEditor' | 'pb' | 'canCopy' | 'canRir' | 'highlight' | 'reduceMotion' | 'moves'>, b: typeof a): boolean {
  return (
    a.r.renderKey === b.r.renderKey &&
    a.cols === b.cols &&
    a.hasLoad === b.hasLoad &&
    a.blockRows === b.blockRows &&
    a.draggable === b.draggable &&
    a.editing === b.editing &&
    a.rowEditor?.node === b.rowEditor?.node &&
    a.rowEditor?.inCell === b.rowEditor?.inCell &&
    a.pb === b.pb &&
    a.canCopy === b.canCopy &&
    a.canRir === b.canRir &&
    a.highlight === b.highlight &&
    a.reduceMotion === b.reduceMotion &&
    a.moves?.up === b.moves?.up &&
    a.moves?.down === b.moves?.down
  );
}

/** One set row with its drag, swipe-to-delete and `＋ Set` flash; drawn again only when `sameShell` says so. */
const SetRowShell = memo(function SetRowShell(s: ShellProps) {
  const { r, actions } = s;
  const inCell = s.rowEditor !== null && s.rowEditor.inCell && !s.blockRows;
  return (
    <View
      ref={(v) => {
        s.rowRef(r.setId, v);
      }}
      collapsable={false}
      onLayout={s.onLaidOut}
    >
      <DragItem dragKey={r.setId} draggable={s.draggable}>
        {r.row.partStart !== null ? <GymPartDivider label={r.row.partStart} /> : null}
        <SwipeRow
          enabled={!r.skipped}
          onDelete={() => {
            actions.del(r);
          }}
        >
          <Flash on={s.highlight} reduceMotion={s.reduceMotion}>
            <TableSetRow
              row={r}
              cols={s.cols}
              hasLoad={s.hasLoad}
              ax={s.blockRows}
              editing={s.editing}
              pb={s.pb}
              {...(s.canCopy ? { onCopyLast: () => { actions.copyLast(r.setId); } } : {})}
              {...(s.canRir && !r.warmup && !r.skipped && r.row.columns.valueLabel === 'REPS' ? { onRir: () => { actions.rir(r.setId); } } : {})}
              cellEditor={inCell ? (s.rowEditor?.node ?? null) : null}
              onDelete={() => {
                actions.del(r);
              }}
              {...(s.moves === null
                ? {}
                : {
                    moves: s.moves,
                    onMoveSet: (dir: 'up' | 'down') => {
                      actions.move(r.setId, dir);
                    },
                    onChangeType: () => {
                      actions.changeType(r.setId);
                    },
                  })}
              onPress={(part) => {
                actions.press(r, part);
              }}
            />
          </Flash>
        </SwipeRow>
        {/* At AX sizes (and cardio's pair) the correction sits under its row. */}
        {s.rowEditor !== null && !inCell ? <View>{s.rowEditor.node}</View> : null}
      </DragItem>
    </View>
  );
}, sameShell);

/**
 * (Ben, 26 Oct) The exercise header on its own full-width row: `1  Dumbbell shoulder press` (wraps), the works
 * line under it (`Front delts`), and on the right only `0/2` and `⋯` (Adjust is in `⋯`). The rep range is in the
 * REPS cells and the target in the RIR cells, so the header doesn't repeat them.
 */
function ExerciseHeader({ ex, superset, page: p }: { ex: RoundExercise; superset: boolean; page: RoundPageProps }) {
  const theme = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'], minHeight: theme.target.min.height }}>
        <Pressable
          accessibilityRole="header"
          accessibilityLabel={`${ex.label}, ${ex.name}${ex.subline !== null ? `, ${ex.subline}` : ''}, ${String(ex.progress.done)} of ${String(ex.progress.total)} sets done${ex.painBadge ? ', pain flag' : ''}`}
          accessibilityHint="Opens the exercise"
          accessibilityActions={[
            ...(p.canNext ? [{ name: 'next', label: 'Next exercise' }] : []),
            ...(p.canPrev ? [{ name: 'previous', label: 'Previous exercise' }] : []),
            ...(p.exerciseActions?.(ex.sessionExerciseId) ?? []),
          ]}
          onAccessibilityAction={(e) => {
            const name = e.nativeEvent.actionName;
            if (name === 'next') p.onRound('next');
            else if (name === 'previous') p.onRound('prev');
            else p.onExerciseAction?.(ex.sessionExerciseId, name);
          }}
          onPress={() => {
            p.onName({ sessionExerciseId: ex.sessionExerciseId, exerciseId: ex.exerciseId, name: ex.name, isCurrent: ex.isCurrent });
          }}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: theme.space['2'], paddingTop: theme.space['1'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <AppText variant="headline" numeric style={{ minWidth: 22 }} importantForAccessibility="no" accessibilityElementsHidden>
            {ex.label}
          </AppText>
          <View style={{ flex: 1 }}>
            <AppText variant="headline" numberOfLines={p.ax ? 4 : 3}>
              {ex.name}
            </AppText>
            {ex.subline !== null ? (
              <AppText variant="callout" color="text.secondary" numberOfLines={p.ax ? 3 : 1} style={{ fontSize: 13, lineHeight: 18 }}>
                {ex.subline}
              </AppText>
            ) : null}
          </View>
        </Pressable>
        {ex.painBadge ? (
          <PainBadge
            onPress={() => {
              p.onPainBadge(ex.exerciseId);
            }}
          />
        ) : null}
        <AppText variant="callout" color="text.secondary" numeric style={{ paddingTop: theme.space['1'] + 2 }} importantForAccessibility="no" accessibilityElementsHidden>
          {ex.progressText}
        </AppText>
        <MenuButton
          label={`${superset ? `${ex.label} ` : ''}${ex.name} menu`}
          onPress={() => {
            p.onMenu(ex.sessionExerciseId);
          }}
        />
      </View>
      {ex.pinned !== null ? (
        // (Ben, 26 Oct) A pinned note: every time this exercise is in a workout; his words as typed (rule 8).
        <LinkLine
          accessibilityLabel={`Pinned note${ex.pinned.gymOnly ? ', this gym' : ''}: ${ex.pinned.text}. Tap to edit.`}
          onPress={() => {
            p.onNote(ex.sessionExerciseId, ex.name, ex.note, true);
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['1'] }}>
            <View style={{ paddingTop: 3 }}>
              <Icon name="pin.fill" color="text.tertiary" size={12} />
            </View>
            <AppText variant="callout" color="text.secondary" numberOfLines={2} style={{ flex: 1 }}>
              {ex.pinned.text}
            </AppText>
          </View>
        </LinkLine>
      ) : null}
      {ex.note !== null ? (
        <LinkLine
          accessibilityLabel={`Note: ${ex.note}. Tap to edit.`}
          onPress={() => {
            p.onNote(ex.sessionExerciseId, ex.name, ex.note);
          }}
        >
          <AppText variant="callout" color="text.secondary" numberOfLines={2}>
            {ex.note}
          </AppText>
        </LinkLine>
      ) : null}
    </View>
  );
}

/** `＋ Set` (small outlined pill) on the left, the underlined `Why?` text on the right (§2); both 44 pt targets. */
function CompactRow({ ex, index, page: p }: { ex: RoundExercise; index: number; page: RoundPageProps }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: theme.space['1'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add set to ${ex.name}`}
        hitSlop={8}
        onPress={() => {
          haptic('step');
          p.onAddSet(ex.sessionExerciseId);
        }}
        style={({ pressed }) => ({ minHeight: 30, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.colors['border.divider'], justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <AppText variant="callout" color="text.secondary" style={{ fontSize: 13, lineHeight: 18 }}>
          ＋ Set
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Why this target"
        hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
        onPress={() => {
          p.onWhy(index);
        }}
        style={({ pressed }) => ({ minHeight: 30, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <AppText variant="callout" color="text.secondary" style={{ fontSize: 13, lineHeight: 18, textDecorationLine: 'underline', textDecorationColor: theme.colors['text.tertiary'] }}>
          Why?
        </AppText>
      </Pressable>
    </View>
  );
}

/** `SET · PREVIOUS · KG · REPS · RIR · ✓` (Ben, 26 Oct): the unit once, in the header (§2). */
function ColumnLabels({ cols, loadHeader, valueHeader }: { cols: SetColumns; loadHeader: string | null; valueHeader: string }) {
  const theme = useTheme();
  const label = (t: string, width: number, align: 'left' | 'center' = 'center') => (
    <AppText variant="label" color="text.tertiary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ width, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, textAlign: align }} maxFontSizeMultiplier={1.4}>
      {t}
    </AppText>
  );
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'center', gap: cols.gap, paddingTop: theme.space['2'], paddingBottom: theme.space['1'] }}>
      {label('SET', cols.set, 'left')}
      {cols.stackPrevious ? null : label('PREVIOUS', cols.previous, 'left')}
      {loadHeader !== null ? label(loadHeader, cols.load) : null}
      {label(valueHeader, cols.value)}
      {cols.rir > 0 ? label('RIR', cols.rir) : null}
      {label('✓', cols.tick)}
    </View>
  );
}

function PainBadge({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Pain flag" onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['2'], minHeight: 28, borderRadius: theme.radius.pill, backgroundColor: theme.colors['status.warning.subtle'] }}>
      <Icon name="exclamationmark.triangle" color="status.warning" size={14} />
      <AppText variant="label" color="status.warning">
        Pain
      </AppText>
    </Pressable>
  );
}

function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
      <Icon name="ellipsis" color="text.primary" size={20} />
    </Pressable>
  );
}

/**
 * (Ben, 26 Oct) The PREVIOUS cell: last time's comparable set (`100 × 8`, `22.5 × 10` per hand) in secondary
 * ink, or `—` (rule 6). On a set not done yet a tap copies it into that row (a draft, never a log).
 * `stacked`: a small line under the row instead, when the column can't fit it.
 */
function PreviousCell({ last, cols, stacked = false, onPress }: { last: SetLast | null; cols: SetColumns; stacked?: boolean; onPress?: (() => void) | undefined }) {
  const theme = useTheme();
  const tappable = onPress !== undefined && last !== null;
  const text = last === null ? '—' : plainSpaces(last.text);
  return (
    <Pressable
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={last === null ? 'No previous' : last.accessibilityLabel.replace(/^Last time/, 'Previous')}
      accessibilityHint={tappable ? 'Copies it into this set' : undefined}
      disabled={!tappable}
      hitSlop={stacked ? { top: 10, bottom: 10, left: 4, right: 4 } : { top: 4, bottom: 4 }}
      onPress={() => {
        if (!tappable) return;
        haptic('step');
        onPress();
      }}
      style={({ pressed }) => ({ width: stacked ? undefined : cols.previous, minHeight: stacked ? undefined : theme.target.min.height, justifyContent: 'center', paddingLeft: stacked ? cols.set + cols.gap : 0, opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <AppText variant="label" color="text.secondary" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} allowFontScaling={false} style={{ fontSize: cols.previousFont, lineHeight: Math.round(cols.previousFont * 1.3), fontWeight: '400' }}>
        {text}
      </AppText>
    </Pressable>
  );
}

/**
 * (Ben, 26 Oct: RIR replaces RPE in the UI) The narrow RIR box after REPS: the target RIR dimmed on a set not
 * done yet, what Ben entered in full ink; on a done row what he logged (green, no box). A tap enters it.
 * Warm-ups have none (an empty, inert cell).
 */
function RirCell({ text, target, done, cols, stepName, onPress }: { text: string | null; target: boolean; done: boolean; cols: SetColumns; stepName: string; onPress?: (() => void) | undefined }) {
  const theme = useTheme();
  if (cols.rir <= 0) return null;
  if (onPress === undefined) return <View style={{ width: cols.rir }} />;
  const label = text === null ? `${stepName}, reps in reserve, none` : `${stepName}, ${target ? 'target ' : ''}${text} ${text === '1' ? 'rep' : 'reps'} in reserve`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Enters reps in reserve"
      onPress={() => {
        haptic('step');
        onPress();
      }}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      style={({ pressed }) => ({ width: cols.rir, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      {done ? (
        <AppText variant="rowValue" color="status.done" numeric numberOfLines={1} allowFontScaling={false} style={{ fontSize: cols.rirFont, lineHeight: Math.round(cols.rirFont * 1.3), textAlign: 'center' }}>
          {text ?? ''}
        </AppText>
      ) : (
        <View style={{ minHeight: 32, borderRadius: 8, backgroundColor: theme.colors['bg.raised'], alignItems: 'center', justifyContent: 'center' }}>
          <AppText variant="rowValue" color={target || text === null ? 'text.tertiary' : 'text.primary'} numeric numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false} style={{ fontSize: cols.rirFont, lineHeight: Math.round(cols.rirFont * 1.3) }}>
            {text ?? ''}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

/** A row that just arrived with `＋ Set`: a brief highlight (none under Reduce Motion). */
function Flash({ on, reduceMotion, children }: { on: boolean; reduceMotion: boolean; children: ReactNode }) {
  const theme = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on || reduceMotion) return;
    v.setValue(1);
    Animated.timing(v, { toValue: 0, duration: 1200, useNativeDriver: true }).start();
  }, [on, reduceMotion, v]);
  return (
    <View>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.raised'], opacity: v }} />
      {children}
    </View>
  );
}

/**
 * Swipe left on a set row = Delete, with Undo (§2). The row claims every
 * sideways drag, so a swipe that starts on a row never changes the round.
 */
function SwipeRow({ enabled, onDelete, children }: { enabled: boolean; onDelete: () => void; children: ReactNode }) {
  const theme = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const latest = useRef(onDelete);
  latest.current = onDelete;
  const on = useRef(enabled);
  on.current = enabled;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => on.current && claimsDrag(g.dx, g.dy),
        onPanResponderMove: (_e, g) => {
          x.setValue(Math.min(0, g.dx));
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -DELETE_DX) {
            haptic('step');
            Animated.timing(x, { toValue: -400, duration: 160, useNativeDriver: true }).start(() => {
              latest.current();
              x.setValue(0);
            });
            return;
          }
          Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [x],
  );
  return (
    <View {...responder.panHandlers}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: theme.radius.sm, backgroundColor: theme.colors['status.danger'], alignItems: 'flex-end', justifyContent: 'center', paddingRight: theme.space['4'] }}>
        <AppText variant="label" color="on.accent">
          Delete
        </AppText>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: theme.colors['bg.surface'] }}>{children}</Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rows

/** The SET cell: bold on the current set, `W` on a warm-up, the set type (or today's change) under it, `PB` beside it. */
function NumberCell({ row, current, todayChange, pb = false, cols }: { row: RoundRow; current: boolean; todayChange: 'coach' | 'rule' | null; pb?: boolean; cols: SetColumns }) {
  const sub = [row.typeLabel, todayChange === 'coach' ? 'Coach' : todayChange === 'rule' ? 'Rule' : null].filter((x): x is string => x !== null);
  return (
    <View>
      {/* (Ben, 26 Oct) A new best (Summary's definition, rule 6): a small `PB` beside the number, never colour alone. */}
      <AppText variant="callout" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling={false} color={current ? 'text.primary' : row.warmup ? 'text.tertiary' : 'text.secondary'} style={{ fontSize: cols.setFont, lineHeight: Math.round(cols.setFont * 1.35), ...(current ? { fontWeight: '700' } : {}) }}>
        {row.label}
        {pb ? (
          <AppText variant="label" color="status.done" allowFontScaling={false} style={{ fontSize: Math.round(cols.setFont * 0.6), fontWeight: '700' }}>
            {' PB'}
          </AppText>
        ) : null}
      </AppText>
      {sub.map((s) => (
        // Mixed case like the prototype (`Back-off`): shrinks to fit the SET column, never truncated (spec S4).
        <AppText key={s} variant="label" color="text.tertiary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 10, lineHeight: 12 }} maxFontSizeMultiplier={1.3}>
          {s}
        </AppText>
      ))}
    </View>
  );
}

/** A value cell. `dim`: a set that isn't current shows its target in secondary ink (Ben, 23 Oct); the current set's cells are full ink. */
function CellBox({ text, done, warmup, on, dim = false, font }: { text: string; done: boolean; warmup: boolean; on: boolean; dim?: boolean; font: number }) {
  const theme = useTheme();
  const size = { fontSize: font, lineHeight: Math.round(font * 1.27) };
  if (done) {
    return (
      <AppText variant="rowValue" color="status.done" numeric numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false} style={{ textAlign: 'center', ...size }}>
        {text}
      </AppText>
    );
  }
  return (
    <View style={{ minHeight: 36, borderRadius: 9, backgroundColor: theme.colors['bg.raised'], opacity: warmup ? 0.75 : 1, borderWidth: 1.5, borderColor: on ? theme.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
      <AppText variant="rowValue" color={warmup || (dim && !on) ? 'text.secondary' : 'text.primary'} numeric numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false} style={size}>
        {text}
      </AppText>
    </View>
  );
}

/**
 * A set row (§2; Ben, 26 Oct): `SET · PREVIOUS · KG · REPS · RIR · ✓`. Done:
 * green values without boxes and a filled ✓ (tap = untick); a value tap
 * corrects it in place (versioned, Undo). Not done: boxed values (tap =
 * select and edit in place), an open ring (tap = make current, never a log).
 * PREVIOUS copies last time into a set not done yet. RIR enters reps in
 * reserve. The set number (or a long-press) opens Edit set. VoiceOver
 * actions mirror every tap and swipe.
 */
export function TableSetRow({
  row: r,
  cols,
  hasLoad,
  ax,
  editing,
  cellEditor = null,
  onPress,
  onDelete,
  moves,
  onMoveSet,
  onChangeType,
  pb = false,
  onCopyLast,
  onRir,
}: {
  row: RoundRow;
  cols: SetColumns;
  hasLoad: boolean;
  ax: boolean;
  editing: CellField | null;
  /** The edited cell's own field (Ben, 20 Oct), drawn in place of its value. */
  cellEditor?: ReactNode;
  onPress: (part: RowPart) => void;
  onDelete: () => void;
  /** v3 §7: VoiceOver Move up / Move down (sets not done yet) and Change type. */
  moves?: { up: boolean; down: boolean };
  onMoveSet?: (dir: 'up' | 'down') => void;
  onChangeType?: () => void;
  /** (Ben, 26 Oct) A new best by Summary's definition: `PB` beside the set number. */
  pb?: boolean;
  /** (Ben, 26 Oct) Copies last time's set into this row (sets not done yet only). */
  onCopyLast?: () => void;
  /** (Ben, 26 Oct) Enters reps in reserve for this set (rows with an RIR cell only). */
  onRir?: () => void;
}) {
  const theme = useTheme();
  // §7: a hold arms the row's drag (inside the round's `DragList`); elsewhere it opens Edit set, as before.
  const hold = useDragHandle(() => {
    onPress('row');
  });
  const row = r.row;
  const done = r.done;
  const skipped = r.skipped;
  const second = done ? [row.pace !== null ? plainSpaces(row.pace) : null, row.notCounted, row.note, row.gymCaption, row.edited ? 'Edited' : null].filter((x): x is string => x !== null) : [];
  const valueName = row.columns.valueLabel === 'REPS' ? 'reps' : row.columns.valueLabel === 'TIME' ? 'time' : row.columns.valueLabel === 'TIME · DIST' ? 'time and distance' : 'distance';
  const rowActions = [
    { name: 'activate' },
    { name: 'edit', label: 'Edit set' },
    // Only the latest log can be unticked; older done sets are corrected through their cells (spec S6).
    ...(done ? (r.canUntick ? [{ name: 'untick', label: 'Untick' }] : []) : [{ name: 'select', label: 'Make current' }]),
    ...(row.columns.loadLabel !== null ? [{ name: 'load', label: 'Edit load here' }] : []),
    { name: 'value', label: `Edit ${valueName} here` },
    ...(onRir !== undefined ? [{ name: 'rir', label: 'Reps in reserve' }] : []),
    ...(onChangeType !== undefined ? [{ name: 'type', label: 'Change type' }] : []),
    ...(moves?.up === true ? [{ name: 'move_up', label: 'Move up' }] : []),
    ...(moves?.down === true ? [{ name: 'move_down', label: 'Move down' }] : []),
    ...(onCopyLast !== undefined && row.last !== null ? [{ name: 'copy_last', label: 'Copy previous' }] : []),
    { name: 'delete', label: 'Delete set' },
  ];
  const onAction = (a: string) => {
    if (a === 'copy_last') onCopyLast?.();
    else if (a === 'rir') onRir?.();
    else if (a === 'delete') onDelete();
    else if (a === 'type') onChangeType?.();
    else if (a === 'move_up' || a === 'move_down') onMoveSet?.(a === 'move_up' ? 'up' : 'down');
    else onPress(a === 'select' || a === 'untick' ? 'marker' : a === 'load' ? 'load' : a === 'value' ? 'value' : 'row');
  };
  const marker = done ? (
    <Pressable
      accessibilityRole={r.canUntick ? 'button' : 'text'}
      accessibilityLabel={r.canUntick ? `Untick ${r.stepName.toLowerCase()}` : `${r.stepName} done`}
      hitSlop={6}
      onPress={() => {
        onPress('marker');
      }}
      style={{ width: cols.tick, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors['status.done'], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" color="on.accent" size={14} />
      </View>
    </Pressable>
  ) : skipped ? (
    <View style={{ width: cols.tick, alignItems: 'center' }}>
      <Icon name="slash.circle" color="text.tertiary" size={24} />
    </View>
  ) : (
    // The ring makes this the current set (Ben's decision 3); it never logs.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Make ${r.stepName.toLowerCase()} current`}
      hitSlop={6}
      onPress={() => {
        onPress('marker');
      }}
      style={{ width: cols.tick, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: theme.colors['text.tertiary'], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" color="text.tertiary" size={14} />
      </View>
    </Pressable>
  );

  const previousWords = skipped ? null : row.last === null ? 'no previous' : row.last.accessibilityLabel.replace(/^Last time/, 'previous');
  const a11y = [r.accessibilityLabel, pb ? 'personal best' : null, previousWords].filter((x): x is string => x !== null).join(', ');
  if (ax || skipped) {
    // AX sizes (block rows) and skipped rows: one element; the cells are VoiceOver actions. PREVIOUS stacks under.
    return (
      <Pressable
        accessibilityRole={skipped ? 'text' : 'button'}
        accessibilityLabel={a11y}
        accessibilityHint={skipped ? undefined : 'Edit this set'}
        accessibilityActions={skipped ? [] : rowActions}
        onAccessibilityAction={(e) => {
          onAction(e.nativeEvent.actionName);
        }}
        disabled={skipped}
        onPress={() => {
          onPress('row');
        }}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent', justifyContent: 'center', paddingVertical: theme.space['1'] })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['3'], paddingVertical: theme.space['2'] }}>
          <View style={{ flex: 1, gap: theme.space['1'] }}>
            <AppText variant="headline" color={done ? 'text.primary' : 'text.secondary'}>
              {[r.stepName, r.typeLabel, pb ? 'PB' : null].filter((x): x is string => x !== null).join(' · ')}
            </AppText>
            <AppText variant="body" color={done ? 'status.done' : 'text.secondary'} numeric>
              {[row.cells.load !== null && hasLoad ? plainSpaces(row.cells.load) : null, plainSpaces(row.cells.value), r.rir === null ? null : `RIR ${r.rir}`].filter((x): x is string => x !== null).join(' · ')}
            </AppText>
            {second.map((x) => (
              <AppText key={x} variant="callout" color="text.secondary">
                {x}
              </AppText>
            ))}
            {skipped ? null : (
              <AppText variant="callout" color="text.secondary" numeric>
                {`Previous ${row.last === null ? '—' : plainSpaces(row.last.text)}`}
              </AppText>
            )}
          </View>
          {marker}
        </View>
      </Pressable>
    );
  }

  const cell = (part: 'load' | 'value', width: number, text: string, cellA11y: string) => {
    const on = editing !== null && (part === 'load' ? editing === 'load' : editing !== 'load');
    if (on && cellEditor !== null) {
      // No second line (Ben, 20 Oct): the cell itself takes the typing.
      return <View style={{ width, minHeight: theme.target.min.height, justifyContent: 'center' }}>{cellEditor}</View>;
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${cellA11y}, ${r.stepName.toLowerCase()}`}
        accessibilityHint={on ? 'Closes the editor' : done ? 'Corrects it here' : 'Edits it here'}
        accessibilityState={{ expanded: on }}
        onPress={() => {
          onPress(part);
        }}
        {...hold}
        style={({ pressed }) => ({ width, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <CellBox text={text} done={done} warmup={r.warmup} on={on} dim font={cols.valueFont} />
      </Pressable>
    );
  };

  return (
    <View style={{ minHeight: theme.target.min.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: cols.gap }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11y}
          accessibilityHint="Edit this set"
          accessibilityActions={rowActions}
          onAccessibilityAction={(e) => {
            onAction(e.nativeEvent.actionName);
          }}
          onPress={() => {
            onPress('row');
          }}
          {...hold}
          style={({ pressed }) => ({ width: cols.set, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <NumberCell row={r} current={false} todayChange={row.todayChange} pb={pb} cols={cols} />
        </Pressable>
        {cols.stackPrevious ? null : <PreviousCell last={row.last} cols={cols} onPress={onCopyLast} />}
        {/* Each row's own columns (review B2): a mixed part keeps its load cell. */}
        {hasLoad ? (row.columns.loadLabel !== null ? cell('load', cols.load, plainSpaces(row.cells.load ?? '—'), loadCellA11y(row.columns.loadLabel, row.cells.load)) : <View style={{ width: cols.load }} />) : null}
        {cell('value', cols.value, plainSpaces(row.cells.value), valueCellA11y(row.columns.valueLabel, row.cells.value))}
        <RirCell text={r.rir} target={r.rirTarget} done={done} cols={cols} stepName={r.stepName} onPress={onRir} />
        {marker}
      </View>
      {cols.stackPrevious ? <PreviousCell last={row.last} cols={cols} stacked onPress={onCopyLast} /> : null}
      {second.length > 0 ? (
        <AppText variant="callout" color="text.secondary" style={{ paddingLeft: cols.set + cols.gap, paddingBottom: theme.space['1'], fontSize: 13 }}>
          {second.join(' · ')}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The open row (the current set)

export interface OpenSetRowProps {
  focus: FocusView;
  resting: boolean;
  ax: boolean;
  keypadOpen: boolean;
  /** `Copied from 1 Oct`, `Unsaved edit restored`, or null. */
  caption: string | null;
  /** A timed set before Start: logs without the timer. */
  timedLogLabel: string | null;
  /** Cardio's small timer button (review S6): `Stop` while the pill logs the time so far, `Resume` after Stop; null otherwise. */
  workAction?: { label: string; onPress: () => void } | null;
  /** The cell being edited in place, or null (18 Oct: the table stays a table). */
  editing: TileId | null;
  /** ✓ is live: the set has every value Log needs. */
  canLog: boolean;
  loadRef: Ref<TextInput>;
  repsRef: Ref<TextInput>;
  timeRef: Ref<TextInput>;
  distanceRef: Ref<TextInput>;
  /** The set-number cell (VoiceOver focus after a Log). */
  headerRef?: Ref<View>;
  onEditCell: (cell: TileId | null) => void;
  onLog: () => void;
  /** The set number / long-press: copy last, the full set editor, Focus. */
  onMore: () => void;
  onLoad: (v: number | null) => void;
  onReps: (v: number | null) => void;
  onTime: (v: number | null) => void;
  onDistance: (v: number | null) => void;
  onSide: (s: SetSide) => void;
  onPainFlag: () => void;
  onOffProfile: () => void;
  /** (ADR 0029; review S4) `Add 22 kg dumbbells here?`, offered once per idea; null when none. */
  gymLearnText?: string | null;
  onGymLearn?: (yes: boolean) => void;
  /** A cell's field took focus (the keypad is opening on it): the keypad bar follows it. */
  onTileFocus: (tile: TileId) => void;
  /** VoiceOver's Delete (the swipe's mirror, §6). */
  onDelete?: () => void;
  /** v3 §7: VoiceOver Move up / Move down and Change type, as on every set row. */
  moves?: { up: boolean; down: boolean };
  onMoveSet?: (dir: 'up' | 'down') => void;
  onChangeType?: () => void;
}

/** The open row's round row, its exercise's load header and columns, from the round page, so its cells line up with the header. */
const OpenRowContext = createContext<{ row: RoundRow; loadHeader: string | null; cols: SetColumns; onCopyLast?: (() => void) | undefined; onRir?: (() => void) | undefined } | null>(null);

/**
 * `OpenSetRow` (v3 §2): the current set reads like every pending row (the
 * same boxed cells, no row highlight), marked by its bold set number and an
 * accent-outlined ✓ that logs it on the one Log path. A tap on a value cell
 * makes that cell the field (Ben, 20 Oct); its − / +, `Next ›` and `Done`
 * are on the keypad bar (steps from `buildActiveSetView`). Cardio's
 * time-and-distance cell keeps its pair under the row. Only what matters
 * for this set right now sits under it (plates while typing the load, the
 * side, a pain flag, an off-profile load, a restored draft).
 */
export function OpenSetRow(p: OpenSetRowProps) {
  const theme = useTheme();
  // §7: a hold arms the drag (inside the round's `DragList`); its menu (or, elsewhere, the hold itself) is `onMore`.
  const hold = useDragHandle(p.onMore);
  const f = p.focus;
  const ctx = useContext(OpenRowContext);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  // Outside a round page (no context): its own columns from the window, so it still lines up sensibly.
  const ownCols = useMemo(() => setColumns({ windowWidth, fontScale, hasLoad: f.cells.load !== null, hasRir: f.reps !== null, texts: { previous: [], load: [f.cells.load ?? '—'], value: [f.cells.value] } }), [windowWidth, fontScale, f.cells.load, f.cells.value, f.reps]);
  const cols = ctx?.cols ?? ownCols;
  // At AX sizes (or when the column can't fit it) PREVIOUS sits under the row.
  const stackPrevious = cols.stackPrevious || p.ax;
  const step = p.ax ? 60 : theme.target.workout.height;
  const working = f.workTimer !== null && (f.workTimer.state === 'running' || f.workTimer.state === 'paused');
  // Cardio (19 Oct): the timer counts up in the cell (time so far · distance), and the distance stays editable while it runs.
  const cardio = f.measurement === 'cardio';
  const tileFocus = (id: TileId) => () => {
    p.onTileFocus(id);
  };

  const hasLoadColumn = ctx !== null ? ctx.loadHeader !== null : f.cells.load !== null;
  const valueField: TileId | null = f.reps ? 'reps' : f.duration ? 'time' : f.distance ? 'distance' : null;
  const valueText = working && !cardio ? workTimerText(f.workTimer?.remainingMs ?? null) : plainSpaces(f.cells.value);
  const sideTag = f.side?.kind === 'fixed' ? (f.side.value === 'left' ? 'L' : 'R') : null;
  const setLabel = ctx?.row.label ?? `${f.stepName === 'Warm-up' ? 'W' : f.stepName.replace(/^Set /, '')}${sideTag ?? ''}`;
  const stepName = ctx?.row.stepName ?? f.stepName;
  // Ben, 20 Oct: the tapped cell is the field itself (value selected, keypad up); − + Next Done ride the keypad bar.
  const inPlace = (id: TileId): ReactNode => {
    const common = { variant: 'cell' as const, autoFocus: p.keypadOpen, onFocus: tileFocus(id), flex: null, onSurface: false };
    if (id === 'load' && f.loadField) {
      const l = f.loadField;
      return <NumberStepper key="load" {...common} inputRef={p.loadRef} label={`${l.label} ${l.unitText}`} fieldLabel={cellInputA11y({ stepName, field: 'load', value: l.value, unitText: l.unitText, assisted: l.assisted })} unit={null} value={l.value} decimals down={l.down} up={l.up} warning={f.offProfileWarning !== null} hint={l.assisted ? 'More assistance is easier' : null} onChange={p.onLoad} />;
    }
    if (id === 'reps' && f.reps) return <NumberStepper key="reps" {...common} inputRef={p.repsRef} label="Reps" fieldLabel={cellInputA11y({ stepName, field: 'reps', value: f.reps.value })} unit={null} value={f.reps.value} decimals={false} down={f.reps.down} up={f.reps.up} onChange={p.onReps} />;
    if (id === 'time' && f.duration && !working) return <NumberStepper key="time" {...common} inputRef={p.timeRef} label="Time" fieldLabel={cellInputA11y({ stepName, field: 'time', value: f.duration.value })} unit="s" value={f.duration.value} decimals={false} down={f.duration.down} up={f.duration.up} onChange={p.onTime} />;
    if (id === 'distance' && f.distance) return <NumberStepper key="dist" {...common} inputRef={p.distanceRef} label="Distance, metres" fieldLabel={cellInputA11y({ stepName, field: 'distance', value: f.distance.value })} unit={null} value={f.distance.value} decimals down={f.distance.down} up={f.distance.up} onChange={p.onDistance} />;
    return null;
  };

  const cell = (id: TileId | null, width: number, text: string, a11y: string) => {
    const on = id !== null && p.editing === id;
    const field = on && editsInPlace({ field: id, cardio }) ? inPlace(id) : null;
    if (field !== null) {
      // No second line: the cell itself takes the typing (Ben, 20 Oct).
      return <View style={{ width, minHeight: theme.target.min.height, justifyContent: 'center' }}>{field}</View>;
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={id === null ? undefined : on ? 'Closes the editor' : 'Edits it here'}
        accessibilityState={{ expanded: on, disabled: id === null }}
        disabled={id === null}
        onPress={() => {
          if (id === null) return;
          haptic('step');
          p.onEditCell(on ? null : id);
        }}
        {...hold}
        style={({ pressed }) => ({ width, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <CellBox text={text} done={false} warmup={ctx?.row.warmup ?? false} on={on} font={cols.valueFont} />
      </Pressable>
    );
  };

  const loadA11y = loadCellA11y(ctx?.row.row.columns.loadLabel ?? null, f.cells.load);
  const valueA11y = valueField === 'time' && working && !cardio ? `Time ${valueText}` : valueCellA11y(ctx?.row.row.columns.valueLabel ?? (valueField === 'time' ? 'TIME' : valueField === 'distance' ? 'DIST' : 'REPS'), f.cells.value);
  let editor: ReactNode = null;
  // 1.3: a cardio set's time and distance stay together in one tile row (compact or stacked, never clipped).
  let stackDone = false;
  if (cardio && (p.editing === 'time' || p.editing === 'distance') && f.duration && f.distance) {
    stackDone = true;
    const distance = f.distance;
    const duration = f.duration;
    editor = working ? (
      <NumberStepper key="dist" variant="inline" inputRef={p.distanceRef} autoFocus={p.keypadOpen} onFocus={tileFocus('distance')} flex={null} stepSize={step} label="DIST M" unit={null} value={distance.value} decimals down={distance.down} up={distance.up} onChange={p.onDistance} />
    ) : (
      <StepperTileRow tiles={cardioPairTiles({ timeText: duration.value === null ? '—' : CARDIO_TIME_FORMAT.show(duration.value), distance })} estimate={openRowWidth(windowWidth)} step={step} gap={theme.space['2']}>
        {({ numeralSize, compact, flexOf }) => (
          <>
            <NumberStepper key="time" inputRef={p.timeRef} onFocus={tileFocus('time')} flex={flexOf(1)} stepSize={step} numeralSize={numeralSize} compact={compact} label="TIME" unit={null} decimals={false} time value={duration.value} down={duration.down} up={duration.up} onChange={p.onTime} />
            <NumberStepper key="dist" inputRef={p.distanceRef} onFocus={tileFocus('distance')} flex={flexOf(1)} stepSize={step} numeralSize={numeralSize} compact={compact} label="DIST M" unit={null} value={distance.value} decimals down={distance.down} up={distance.up} onChange={p.onDistance} />
          </>
        )}
      </StepperTileRow>
    );
  }

  // 1.5: links are 44 pt targets by padding and hitSlop, not by height.
  const link = (text: string, a11y: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} style={({ pressed }) => ({ paddingVertical: theme.space['1'], justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
      <AppText variant="callout" color="text.secondary" numeric numberOfLines={1}>
        {text}
      </AppText>
    </Pressable>
  );
  const plates = f.plateLine !== null && p.editing === 'load' ? (
    <AppText variant="callout" color="text.tertiary" numeric accessibilityLabel={`Plates: ${f.plateLine}`} style={{ paddingLeft: cols.set + cols.gap, paddingBottom: theme.space['1'], fontSize: 13 }}>
      {plainSpaces(f.plateLine)}
    </AppText>
  ) : null;
  const links = [p.workAction ? link(p.workAction.label, `${p.workAction.label} the timer`, p.workAction.onPress) : null, p.timedLogLabel !== null ? link(plainSpaces(p.timedLogLabel), `${stepName}, ${plainSpaces(p.timedLogLabel)}`, p.onLog) : null].filter((x) => x !== null);

  return (
    <View style={{ minHeight: theme.target.min.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: cols.gap }}>
        <Pressable
          ref={p.headerRef}
          accessibilityRole="button"
          accessibilityLabel={`${f.exerciseName}, ${ctx?.row.accessibilityLabel ?? `${stepName}, ${f.setTypeLabel}${sideTag === 'L' ? ', left side' : sideTag === 'R' ? ', right side' : ''}`}${p.resting ? ', next' : ''}`}
          accessibilityHint="More for this set"
          accessibilityActions={[
            { name: 'activate' },
            ...(ctx?.onRir !== undefined && f.reps !== null && ctx.row.rir !== null ? [{ name: 'rir', label: 'Reps in reserve' }] : []),
            ...(ctx?.onCopyLast !== undefined && ctx.row.row.last !== null ? [{ name: 'copy_last', label: 'Copy previous' }] : []),
            ...(p.onChangeType ? [{ name: 'type', label: 'Change type' }] : []),
            ...(p.moves?.up === true ? [{ name: 'move_up', label: 'Move up' }] : []),
            ...(p.moves?.down === true ? [{ name: 'move_down', label: 'Move down' }] : []),
            ...(p.onDelete ? [{ name: 'delete', label: 'Delete set' }] : []),
          ]}
          onAccessibilityAction={(e) => {
            const a = e.nativeEvent.actionName;
            if (a === 'delete') p.onDelete?.();
            else if (a === 'rir') ctx?.onRir?.();
            else if (a === 'copy_last') ctx?.onCopyLast?.();
            else if (a === 'type') p.onChangeType?.();
            else if (a === 'move_up' || a === 'move_down') p.onMoveSet?.(a === 'move_up' ? 'up' : 'down');
            else p.onMore();
          }}
          onPress={p.onMore}
          {...hold}
          style={{ width: cols.set, minHeight: theme.target.min.height, justifyContent: 'center' }}
        >
          {ctx !== null ? (
            <NumberCell row={ctx.row} current todayChange={f.adjustedBy} cols={cols} />
          ) : (
            <AppText variant="callout" numeric style={{ fontWeight: '700' }}>
              {setLabel}
            </AppText>
          )}
        </Pressable>
        {ctx !== null && !stackPrevious ? <PreviousCell last={ctx.row.row.last} cols={cols} onPress={ctx.onCopyLast} /> : null}
        {hasLoadColumn ? cell(f.loadField ? 'load' : null, cols.load, plainSpaces(f.cells.load ?? '—'), loadA11y) : null}
        {cell(working && !cardio ? null : valueField, cols.value, valueText, valueA11y)}
        {ctx !== null ? <RirCell text={ctx.row.rir} target={ctx.row.rirTarget} done={false} cols={cols} stepName={stepName} onPress={ctx.row.rir === null && ctx.row.warmup ? undefined : ctx.onRir} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${stepName}, ${plainSpaces(p.timedLogLabel ?? f.logLabel ?? 'Log')}`}
          accessibilityState={{ disabled: !p.canLog }}
          disabled={!p.canLog}
          onPress={p.onLog}
          hitSlop={6}
          style={({ pressed }) => ({ width: cols.tick, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: !p.canLog ? 0.4 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkmark" color="accent" size={14} />
          </View>
        </Pressable>
      </View>
      {ctx !== null && stackPrevious ? <PreviousCell last={ctx.row.row.last} cols={cols} stacked onPress={ctx.onCopyLast} /> : null}
      {editor !== null ? (
        <View>
          <InlineEditor
            ax={p.ax}
            stack={stackDone}
            onDone={() => {
              Keyboard.dismiss();
              p.onEditCell(null);
            }}
          >
            {editor}
          </InlineEditor>
        </View>
      ) : null}
      {plates}
      {links.length > 0 ? <View style={{ flexDirection: 'row', columnGap: theme.space['4'], paddingLeft: cols.set + cols.gap }}>{links}</View> : null}
      {f.targetEstimate ? (
        // Rule 6: an estimated target says so, in the shortest word.
        <AppText variant="callout" color="text.tertiary" style={{ paddingLeft: cols.set + cols.gap, fontSize: 13 }} accessibilityLabel="Target is an estimate">
          est.
        </AppText>
      ) : null}
      {f.planWas !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={{ paddingLeft: cols.set + cols.gap, fontSize: 13 }}>
          {plainSpaces(f.planWas)}
        </AppText>
      ) : null}
      {f.side && f.side.kind === 'choice' ? (
        <ChipRow>
          {(['both', 'left', 'right'] as const).map((s) => (
            <Chip
              key={s}
              label={s === 'both' ? 'Both sides' : s === 'left' ? 'Left' : 'Right'}
              selected={f.side?.kind === 'choice' && f.side.value === s}
              onPress={() => {
                p.onSide(s);
              }}
            />
          ))}
        </ChipRow>
      ) : null}
      {p.caption !== null ? (
        <AppText variant="callout" color="text.secondary" style={{ paddingLeft: cols.set + cols.gap, fontSize: 13 }}>
          {p.caption}
        </AppText>
      ) : null}
      {f.painFlag ? <NoteLink icon="exclamationmark.triangle" text={f.painFlag.text} accessibilityLabel={f.painFlag.accessibilityLabel} onPress={p.onPainFlag} /> : null}
      {f.snapNote ? <SnapNote note={f.snapNote} /> : null}
      {f.offProfileWarning !== null ? (
        f.offProfileEquipment !== null ? (
          <NoteLink icon="exclamationmark.triangle" text={f.offProfileWarning} accessibilityLabel={`${f.offProfileWarning}. Opens this equipment.`} onPress={p.onOffProfile} />
        ) : (
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={f.offProfileWarning} />
        )
      ) : null}
      {p.gymLearnText != null && p.onGymLearn ? (
        <ChipRow>
          <Chip
            label={p.gymLearnText}
            selected={false}
            onPress={() => {
              p.onGymLearn?.(true);
            }}
          />
          <Chip
            label="Not now"
            selected={false}
            onPress={() => {
              p.onGymLearn?.(false);
            }}
          />
        </ChipRow>
      ) : null}
    </View>
  );
}

/**
 * An in-place cell editor and its Done: side by side, stacked at AX sizes so
 * nothing clips (review S8). `stack`: Done on its own right-aligned row (the
 * cardio pair takes the full width; 1.3).
 */
function InlineEditor({ ax, stack = false, onDone, children }: { ax: boolean; stack?: boolean; onDone: () => void; children: ReactNode }) {
  const theme = useTheme();
  const column = ax || stack;
  return (
    <View style={{ flexDirection: column ? 'column' : 'row', alignItems: column ? 'stretch' : 'center', gap: theme.space['2'], paddingTop: theme.space['1'], paddingBottom: theme.space['1'] }}>
      {children}
      <View style={column ? { alignItems: 'flex-end' } : undefined}>
        <TextButton label="Done" onPress={onDone} />
      </View>
    </View>
  );
}

export interface CorrectionEditorProps {
  field: CellField;
  ax: boolean;
  /** The row's step name (`Set 3`, `Warm-up`), for VoiceOver's `Set 3 weight, 100 kg`. */
  stepName: string;
  loadField: LoadField | null;
  reps: StepField | null;
  duration: StepField | null;
  distance: StepField | null;
  onLoad: (v: number | null) => void;
  onReps: (v: number | null) => void;
  onTime: (v: number | null) => void;
  onDistance: (v: number | null) => void;
  /** A field took focus (the screen's keypad accessory offers `Next ›` from it; 1.4). */
  onFocusField?: (field: CellField) => void;
  /** The cardio pair's distance field, so `Next ›` from its time can focus it. */
  distanceRef?: Ref<TextInput>;
  /** Saves the correction (one versioned write, with Undo) and closes. */
  onDone: () => void;
}

type StepField = { value: number | null; down: StepTarget; up: StepTarget };

/**
 * A done row's KG or REPS corrected in its row (18 Oct): the cell itself is
 * the field (Ben, 20 Oct), with − / + (from `buildSetEditView`), `Next ›` and
 * `Done` on the keypad bar; cardio's time-and-distance pair stays under the
 * row. It opens with its field focused, so a correction is typed at once.
 * Nothing is written per step or keystroke; Done (or a tap elsewhere) sends
 * one versioned `correctSet` with Undo (rule 2).
 */
export function CorrectionEditor(p: CorrectionEditorProps) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const step = p.ax ? 60 : theme.target.workout.height;
  const focusOf = (field: CellField) => () => {
    p.onFocusField?.(field);
  };
  // Ben, 20 Oct: a single value is typed in its own cell; − + Next Done ride the keypad bar.
  const cellProps = { variant: 'cell' as const, autoFocus: true, flex: null, onSurface: false };
  let editor: ReactNode = null;
  let stack = false;
  if ((p.field === 'time' || p.field === 'distance') && p.duration && p.distance) {
    // Cardio (19 Oct): its time (minutes) and distance together, as in the open row (1.3).
    stack = true;
    const duration = p.duration;
    const distance = p.distance;
    editor = (
      <StepperTileRow tiles={cardioPairTiles({ timeText: duration.value === null ? '—' : CARDIO_TIME_FORMAT.show(duration.value), distance })} estimate={openRowWidth(windowWidth)} step={step} gap={theme.space['2']}>
        {({ numeralSize, compact, flexOf }) => (
          <>
            <NumberStepper key="time" autoFocus={p.field === 'time'} onFocus={focusOf('time')} flex={flexOf(1)} stepSize={step} numeralSize={numeralSize} compact={compact} label="TIME" unit={null} decimals={false} time value={duration.value} down={duration.down} up={duration.up} onChange={p.onTime} />
            <NumberStepper key="dist" {...(p.distanceRef ? { inputRef: p.distanceRef } : {})} autoFocus={p.field === 'distance'} onFocus={focusOf('distance')} flex={flexOf(1)} stepSize={step} numeralSize={numeralSize} compact={compact} label="DIST M" unit={null} value={distance.value} decimals down={distance.down} up={distance.up} onChange={p.onDistance} />
          </>
        )}
      </StepperTileRow>
    );
  } else if (p.field === 'load' && p.loadField) {
    const l = p.loadField;
    return <NumberStepper key="load" {...cellProps} onFocus={focusOf('load')} label={`${l.label} ${l.unitText}`} fieldLabel={cellInputA11y({ stepName: p.stepName, field: 'load', value: l.value, unitText: l.unitText, assisted: l.assisted })} unit={null} value={l.value} decimals down={l.down} up={l.up} hint={l.assisted ? 'More assistance is easier' : null} onChange={p.onLoad} />;
  } else if (p.field === 'reps' && p.reps) {
    return <NumberStepper key="reps" {...cellProps} onFocus={focusOf('reps')} label="Reps" fieldLabel={cellInputA11y({ stepName: p.stepName, field: 'reps', value: p.reps.value })} unit={null} value={p.reps.value} decimals={false} down={p.reps.down} up={p.reps.up} onChange={p.onReps} />;
  } else if (p.field === 'time' && p.duration) {
    return <NumberStepper key="time" {...cellProps} onFocus={focusOf('time')} label="Time" fieldLabel={cellInputA11y({ stepName: p.stepName, field: 'time', value: p.duration.value })} unit="s" value={p.duration.value} decimals={false} down={p.duration.down} up={p.duration.up} onChange={p.onTime} />;
  } else if (p.field === 'distance' && p.distance) {
    return <NumberStepper key="dist" {...cellProps} onFocus={focusOf('distance')} label="Distance, metres" fieldLabel={cellInputA11y({ stepName: p.stepName, field: 'distance', value: p.distance.value })} unit={null} value={p.distance.value} decimals down={p.distance.down} up={p.distance.up} onChange={p.onDistance} />;
  }
  if (editor === null) return null;
  return (
    <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, paddingHorizontal: theme.space['1'] }}>
      <InlineEditor ax={p.ax} stack={stack} onDone={p.onDone}>
        {editor}
      </InlineEditor>
    </View>
  );
}

function NoteLink({ icon, text, accessibilityLabel, onPress }: { icon: SymbolName; text: string; accessibilityLabel: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <LinkLine accessibilityLabel={accessibilityLabel} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: 44 }}>
        <Icon name={icon} color="status.warning" size={16} />
        <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
          {plainSpaces(text)}
        </AppText>
        <Icon name="chevron.right" size={14} color="text.tertiary" />
      </View>
    </LinkLine>
  );
}

// ---------------------------------------------------------------------------
// Round strip (§1.2)

export function RoundStrip({ chips, onPick, onWorkout }: { chips: readonly { key: string; index: number; text: string; done: boolean; shown: boolean; accessibilityLabel: string }[]; onPick: (index: number) => void; onWorkout: () => void }) {
  const theme = useTheme();
  const strip = useRef<ScrollView>(null);
  const x = useRef(new Map<number, number>());
  const shown = chips.find((c) => c.shown)?.index ?? 0;
  useEffect(() => {
    const at = x.current.get(shown);
    if (at !== undefined) strip.current?.scrollTo({ x: Math.max(0, at - 60), animated: true });
  }, [shown]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['4'], gap: theme.space['2'], paddingBottom: theme.space['2'] }}>
      <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, alignItems: 'center', paddingVertical: 2 }}>
        {chips.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={c.accessibilityLabel}
            accessibilityState={{ selected: c.shown }}
            onLayout={(e) => {
              x.current.set(c.index, e.nativeEvent.layout.x);
            }}
            onPress={() => {
              haptic('step');
              onPick(c.index);
            }}
            hitSlop={{ top: 7, bottom: 7 }}
            style={({ pressed }) => ({
              // 44 pt wide, 30 + 2 × 7 pt slop tall (spec S5).
              minWidth: 44,
              height: 30,
              paddingHorizontal: theme.space['2'],
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: c.done ? theme.colors['status.done.subtle'] : theme.colors['bg.surface'],
              borderWidth: 1.5,
              borderColor: c.shown ? theme.colors.accent : 'transparent',
              opacity: pressed ? TEXT_PRESSED_OPACITY : 1,
            })}
          >
            <AppText variant="label" numeric color={c.done ? 'status.done' : c.shown ? 'text.primary' : 'text.tertiary'} style={{ fontSize: 13, lineHeight: 16, fontWeight: '600' }} maxFontSizeMultiplier={1.6}>
              {c.text}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Workout overview" onPress={onWorkout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={({ pressed }) => ({ minHeight: 30, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
        <AppText variant="callout" style={{ fontSize: 14, textDecorationLine: 'underline', textDecorationColor: theme.colors['text.tertiary'] }}>
          Workout
        </AppText>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Timer bar (§1.5), Chat

/** Height of the keypad-open rest strip (Ben, 20 Oct): one line, no pills. */
export const SLIM_REST_HEIGHT = 32;

/**
 * `RestBar` (§9.80, v3 §1.5): `REST 1:29` (about 36 pt numerals) from the
 * stored deadline, `−30` `+30` `Skip`, and a 3 pt drain drawn at its current
 * length each second. Paused: frozen. Slim (keypad open): one line.
 */
export function RestBar({ rest, slim = false, onAdjust, onSkip, onOpen }: { rest: RestView; slim?: boolean; onAdjust: (deltaS: number) => void; onSkip: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const narrow = useWindowDimensions().width < 390;
  const paused = rest.kind === 'paused';
  const ended = rest.kind === 'ended';
  const rested = rest.kind === 'ended' && !rest.skipped ? formatDuration(rest.restedMs / 1000) : null;
  const remainingS = rest.kind === 'ended' ? 0 : Math.ceil(rest.remainingMs / 1000);
  const fraction = rest.kind === 'running' && rest.durationS > 0 ? Math.max(0, Math.min(1, rest.remainingMs / (rest.durationS * 1000))) : 0;
  if (slim) {
    // Keypad open (workout-table.md, Keypad open; Ben, 20 Oct): a one-line ~32 pt strip, no pills; the countdown keeps running.
    const text = ended ? (rested !== null ? `Ready · rested ${rested}` : 'Ready') : `Rest ${formatDuration(remainingS)}`;
    return (
      <View
        accessible
        accessibilityRole="timer"
        accessibilityLabel={ended ? `Rest done${rested !== null ? `, rested ${rested}` : ''}` : `Rest${paused ? ', paused' : ''}, ${formatDuration(remainingS)} left`}
        style={{ marginHorizontal: theme.space['3'], marginBottom: theme.space['1'], minHeight: SLIM_REST_HEIGHT, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'], overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['3'] }}
      >
        {ended ? <Icon name="checkmark.circle.fill" color="status.done" size={14} /> : paused ? <Icon name="pause.circle.fill" color="status.warning" size={14} /> : null}
        <AppText variant="label" numeric numberOfLines={1} color={paused ? 'text.tertiary' : 'text.primary'} maxFontSizeMultiplier={1.4}>
          {text}
        </AppText>
        {rest.kind === 'running' ? <View style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: `${Math.round(fraction * 1000) / 10}%`, backgroundColor: theme.colors.accent }} /> : null}
      </View>
    );
  }
  const pill = (label: string, a11y: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: paused || ended }}
      disabled={paused || ended}
      onPress={() => {
        haptic('step');
        onPress();
      }}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, minWidth: 48, justifyContent: 'center', alignItems: 'center', opacity: paused ? 0.4 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <View style={{ height: 40, minWidth: 48, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.colors['text.tertiary'], alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="label" numeric style={{ fontSize: 14 }}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
  return (
    <View style={{ marginHorizontal: theme.space['3'], marginBottom: theme.space['2'], minHeight: 64, borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.surface'], overflow: 'hidden', justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['3'], gap: theme.space['2'] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ended ? `Rest done${rested !== null ? `, rested ${rested}` : ''}` : `Rest${paused ? ', paused' : ''}, ${formatDuration(remainingS)} left. Opens the rest screen.`}
          onPress={onOpen}
          style={({ pressed }) => ({ flex: 1, minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          {paused ? <Icon name="pause.circle.fill" color="status.warning" size={16} /> : null}
          {/* Below 390 pt wide the eyebrow drops (the countdown and pills need the room); paused keeps its word. */}
          {!narrow || paused ? (
            <AppText variant="label" color={paused ? 'status.warning' : 'text.secondary'} numberOfLines={1} style={{ fontSize: 11, letterSpacing: 1.3 }}>
              {paused ? (narrow ? 'PAUSED' : 'REST · PAUSED') : 'REST'}
            </AppText>
          ) : null}
          <AppText variant="headline" numeric color={paused ? 'text.tertiary' : 'text.primary'} style={{ fontSize: 36, lineHeight: 42 }} maxFontSizeMultiplier={1.4}>
            {formatDuration(remainingS)}
          </AppText>
        </Pressable>
        {!ended ? pill('−30', 'Rest 30 seconds shorter', () => { onAdjust(-30); }) : null}
        {!ended ? pill('+30', 'Rest 30 seconds longer', () => { onAdjust(30); }) : null}
        {!ended ? pill('Skip', 'Skip rest', onSkip) : null}
      </View>
      {rest.kind === 'running' ? <View style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.round(fraction * 1000) / 10}%`, backgroundColor: theme.colors.accent }} /> : null}
    </View>
  );
}

/** The timer bar when not resting (v3 §1.5): `SET 0:25`, counting up since the rest ended or the last log, in secondary ink. */
export function SetClockBar({ text, paused, slim = false }: { text: string; paused: boolean; slim?: boolean }) {
  const theme = useTheme();
  const label = `${paused ? 'Paused, ' : ''}set time ${text}`;
  if (slim) {
    return (
      <View accessible accessibilityRole="timer" accessibilityLabel={label} style={{ marginHorizontal: theme.space['3'], marginBottom: theme.space['1'], minHeight: SLIM_REST_HEIGHT, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'], flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['3'] }}>
        <AppText variant="label" numeric color="text.secondary" maxFontSizeMultiplier={1.4}>{`Set ${text}`}</AppText>
      </View>
    );
  }
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={label} style={{ marginHorizontal: theme.space['3'], marginBottom: theme.space['2'], minHeight: 64, borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.surface'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'] }}>
      {paused ? <Icon name="pause.circle.fill" color="status.warning" size={16} /> : null}
      <AppText variant="label" color="text.secondary" style={{ fontSize: 11, letterSpacing: 1.3 }}>
        SET
      </AppText>
      <AppText variant="headline" numeric color="text.secondary" style={{ fontSize: 36, lineHeight: 42 }} maxFontSizeMultiplier={1.4}>
        {text}
      </AppText>
    </View>
  );
}

