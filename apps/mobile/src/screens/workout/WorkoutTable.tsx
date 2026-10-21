import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { AccessibilityInfo, Animated, Keyboard, PanResponder, Pressable, ScrollView, useWindowDimensions, View, type TextInput } from 'react-native';

import { formatDuration, NBSP, type FocusView, type LoadField, type RestView, type StepTarget } from '@fizz/domain';
import type { SetSide } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Icon, LinkLine, NumberStepper, StatusLine, StepperTileRow, TextButton, TEXT_PRESSED_OPACITY, type SymbolName } from '../../ui';
import { CARDIO_TIME_FORMAT } from '../../ui/number-text';
import { cellInputA11y, editsInPlace, loadCellA11y, runRowTap, valueCellA11y, type CellField, type RowPart, type RowTap, type TileId } from '../../workout/table';
import { boxAnchor, boxFades, fitRoundBoxes, keepInView, pageOffsetFor, ROW_HEIGHT_DEFAULT, type Round, type RoundExercise, type RoundFit, type RoundRow } from '../../workout/rounds';
import { claimsDrag, swipeIntent } from '../../workout/set-pager';
import { workTimerText } from '../../workout/cues';
import { cardioPairTiles, openRowWidth } from '../../workout/tile-fit';
import { WORKOUT_KEYBOARD } from '../../workout/keyboard';
import { GymPartDivider, SnapNote } from './GymSwitch';
import { DragItem, DragList, useDragHandle } from '../../ui/drag-list';
import { dropIndex } from '../../ui/drag-logic';

/**
 * The active workout's round page (workout-table-v3.md §1–§3; prototype
 * `docs/design/prototypes/workout-active-v3.html`): one round per page, a
 * superset's `3a` / `3b` stacked without a box, each exercise's sets in a
 * per-set table (`# · KG · REPS · RPE · ✓`) whose rows scroll inside their
 * own box, sized so the round fits one screen (`fitRoundBoxes`). Every value
 * comes from `buildWorkoutTableView` / `buildActiveSetView` (domain) through
 * `buildRounds`; this file lays them out, measures, and reports taps. The
 * screen owns every command (one Log path, `WorkoutScreen.log`).
 */

const plainSpaces = (s: string) => s.replaceAll(NBSP, ' ');

/** Column widths shared by the header, every row and the open row, so the cells line up. */
const NUM_W = 52;
const RPE_W = 40;
const TICK_W = 44;
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
  /** `Adjust` on the current exercise's header, and its inline row under it. */
  adjust: ReactNode;
  adjustRow: ReactNode;
  /** The warm-up ramp suggestion with `Hide`, under the current exercise's header; null when none. */
  warmUp: ReactNode;
  /** The open row's set cell: VoiceOver focus lands here after a Log or a round change (§6). */
  focusRef: RefObject<View | null>;
  /** When the boxes re-position (`positionKey`): a log, an untick, a round change. */
  positionKey: string;
  /** A cell is being typed in (never re-position then), and the row it's in. */
  editingSetId: string | null;
  /** The keypad's height (0 closed): a cell being typed in stays in its box. */
  keyboardHeight: number;
  /** A set just added with `＋ Set`: its box scrolls to it and it flashes once. */
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
  onNote: (sessionExerciseId: string, name: string, note: string | null) => void;
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
}

interface Measures {
  available: number;
  content: number;
  upNext: number;
  boxFrames: Map<number, number>;
  rows: Map<number, Map<string, { y: number; h: number }>>;
}

const sameFit = (a: RoundFit | null, b: RoundFit): boolean => a !== null && JSON.stringify(a) === JSON.stringify(b);

/** Keyed by the round (`key={round.key}`), so a new round measures and fits from scratch. */
export function RoundPage(props: RoundPageProps) {
  const theme = useTheme();
  const { round } = props;
  const page = useRef<ScrollView>(null);
  const boxes = useRef(new Map<number, ScrollView | null>());
  const m = useRef<Measures>({ available: 0, content: 0, upNext: 0, boxFrames: new Map(), rows: new Map() });
  const [fit, setFit] = useState<RoundFit | null>(null);
  const scrollY = useRef(new Map<number, number>());
  const [fades, setFades] = useState<Partial<Record<number, { top: boolean; bottom: boolean }>>>({});
  const applied = useRef(new Map<number, string>());
  const upNextShown = props.upNext !== null && (fit?.upNext ?? true);
  /** The page's own scroll (fallback only) and its visible frame in the window. */
  const pageY = useRef(0);
  const outer = useRef<View>(null);
  /**
   * `＋ Set` (review B2): the new row stays the box's anchor until the next
   * log, untick or round change, so the box never scrolls back off it when
   * the extra row makes it start scrolling.
   */
  const [pin, setPin] = useState<{ setId: string; key: string } | null>(null);
  if (props.highlightSetId !== null && pin?.setId !== props.highlightSetId) setPin({ setId: props.highlightSetId, key: props.positionKey });
  const pinned = pin !== null && pin.key === props.positionKey ? pin.setId : null;
  /** Bumped when the pinned row lays out, so the box positions on it once it's really there. */
  const [pinLaidOut, setPinLaidOut] = useState(0);
  const highlightShown = useRef(props.onHighlightShown);
  highlightShown.current = props.onHighlightShown;

  const heightsOf = useCallback(
    (i: number): number[] => {
      const ex = round.exercises[i];
      const rows = m.current.rows.get(i);
      return (ex?.rows ?? []).map((r) => rows?.get(r.setId)?.h ?? ROW_HEIGHT_DEFAULT);
    },
    [round],
  );

  const frame = useRef<number | null>(null);
  const recompute = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const x = m.current;
      if (x.available <= 0 || x.content <= 0) return;
      let boxTotal = 0;
      for (let i = 0; i < round.exercises.length; i += 1) boxTotal += x.boxFrames.get(i) ?? 0;
      const fixed = Math.max(0, x.content - boxTotal - (upNextShown ? x.upNext : 0));
      const next = fitRoundBoxes({ available: x.available, fixed, upNext: props.upNext === null ? 0 : x.upNext, boxes: round.exercises.map((e, i) => ({ heights: heightsOf(i), anchor: boxAnchor(e, pinned) })) });
      setFit((cur) => (sameFit(cur, next) ? cur : next));
    });
  }, [round, heightsOf, props.upNext, upNextShown, pinned]);
  useEffect(() => {
    recompute();
  }, [recompute, props.afterSet, props.keyboardHeight]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Position each box on its current set (§2), or on a set just added: on a log, untick or round change, and when its height changes; never while typing.
  useEffect(() => {
    if (fit === null || props.editingSetId !== null) return;
    fit.boxes.forEach((b, i) => {
      const hasPin = pinned !== null && (round.exercises[i]?.rows.some((r) => r.setId === pinned) ?? false);
      // The added row must be laid out (and in this fit) before the box can show it.
      const pinReady = hasPin && (m.current.rows.get(i)?.has(pinned) ?? false) && b.rows > 0;
      const key = `${props.positionKey}|${String(b.height)}|${hasPin ? `${pinned}:${String(pinReady)}:${String(pinLaidOut)}` : ''}`;
      if (applied.current.get(i) === key) return;
      // The first placement in a round is a jump; later ones (a log, an untick) move with the motion setting.
      const animated = !props.reduceMotion && applied.current.has(i);
      applied.current.set(i, key);
      if (b.height !== null) {
        boxes.current.get(i)?.scrollTo({ y: b.offset, animated });
        scrollY.current.set(i, b.offset);
      }
      // `＋ Set`: the flash runs once the box shows the new row.
      if (pinReady && props.highlightSetId === pinned) highlightShown.current();
    });
  }, [fit, props.positionKey, props.editingSetId, props.reduceMotion, pinned, pinLaidOut, round, props.highlightSetId]);

  // VoiceOver: the open row after a Log or a round change (§6).
  useEffect(() => {
    const t = setTimeout(() => {
      if (props.focusRef.current !== null) AccessibilityInfo.sendAccessibilityEvent(props.focusRef.current, 'focus');
    }, 350);
    return () => {
      clearTimeout(t);
    };
  }, [props.positionKey]);

  // The cell being typed in stays in its box as the keypad (and the slim rest strip) take room;
  // in the page-scroll fallback the page also scrolls so the row clears the keypad (review B3).
  useEffect(() => {
    if (props.editingSetId === null || fit === null) return;
    round.exercises.forEach((_ex, i) => {
      const r = m.current.rows.get(i)?.get(props.editingSetId ?? '');
      const b = fit.boxes[i];
      if (r === undefined || b === undefined) return;
      let offset = 0;
      if (b.height !== null) {
        const cur = scrollY.current.get(i) ?? b.offset;
        offset = keepInView(cur, b.height, r.y, r.h);
        if (offset !== cur) {
          boxes.current.get(i)?.scrollTo({ y: offset, animated: !props.reduceMotion });
          scrollY.current.set(i, offset);
        }
      }
      if (!fit.pageScroll) return;
      const box = boxes.current.get(i)?.getNativeScrollRef() ?? null;
      const view = outer.current;
      if (box === null || view === null) return;
      view.measureInWindow((_x, pageTop, _w, pageHeight) => {
        box.measureInWindow((_bx, boxTop) => {
          const to = pageOffsetFor({ pageOffset: pageY.current, pageTop, pageHeight, rowTop: boxTop + r.y - offset, rowHeight: r.h });
          if (to === pageY.current) return;
          page.current?.scrollTo({ y: to, animated: !props.reduceMotion });
          pageY.current = to;
        });
      });
    });
  }, [props.editingSetId, props.keyboardHeight, fit, round, props.reduceMotion]);

  const onBoxScroll = (i: number, y: number, viewHeight: number, contentHeight: number) => {
    scrollY.current.set(i, y);
    const f = boxFades({ offset: y, viewHeight, contentHeight });
    setFades((cur) => {
      const prev = cur[i];
      return prev !== undefined && prev.top === f.top && prev.bottom === f.bottom ? cur : { ...cur, [i]: f };
    });
  };

  /** A set row is being dragged (§7): the boxes and the page hold still. */
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
        m.current.available = e.nativeEvent.layout.height;
        recompute();
      }}
    >
      <ScrollView
        ref={page}
        scrollEnabled={(fit?.pageScroll ?? false) && !dragging}
        scrollEventThrottle={32}
        onScroll={(e) => {
          pageY.current = e.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={(_w, h) => {
          m.current.content = h;
          recompute();
        }}
        {...WORKOUT_KEYBOARD}
        contentContainerStyle={{ paddingHorizontal: theme.space['4'], paddingBottom: theme.space['2'], gap: theme.space['2'] }}
      >
        <View {...swipe.panHandlers}>
          <Pressable accessible={false} onPress={props.onTapElsewhere} style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['3'], gap: theme.space['3'] }}>
            {round.exercises.map((ex, i) => (
              <View key={ex.sessionExerciseId} style={i > 0 ? { borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingTop: theme.space['3'] } : undefined}>
                <ExerciseBlock
                  ex={ex}
                  index={i}
                  superset={round.superset}
                  page={props}
                  dragging={dragging}
                  onDragChange={setDragging}
                  fit={fit?.boxes[i] ?? null}
                  fades={fades[i] ?? { top: false, bottom: false }}
                  boxRef={(r) => {
                    boxes.current.set(i, r);
                  }}
                  onBoxFrame={(h) => {
                    m.current.boxFrames.set(i, h);
                    recompute();
                  }}
                  onRow={(setId, y, h) => {
                    const rows = m.current.rows.get(i) ?? new Map<string, { y: number; h: number }>();
                    const prev = rows.get(setId);
                    rows.set(setId, { y, h });
                    m.current.rows.set(i, rows);
                    if (prev?.h !== h) recompute();
                    // `＋ Set` (Ben, 20 Oct): once the new row is laid out its box positions on it (the effect above).
                    if (pinned === setId && prev === undefined) setPinLaidOut((n) => n + 1);
                  }}
                  onBoxScroll={(y, vh, ch) => {
                    onBoxScroll(i, y, vh, ch);
                  }}
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
        {props.upNext !== null && upNextShown ? (
          <View
            onLayout={(e) => {
              // With the container's gap before it: hiding Up next frees both (review S1: no flicker, no 8 pt clip).
              m.current.upNext = e.nativeEvent.layout.height + theme.space['2'];
              recompute();
            }}
            style={{ paddingHorizontal: theme.space['1'] }}
          >
            <AppText variant="callout" color="text.secondary" numberOfLines={props.ax ? 3 : 1}>
              {'Up next: '}
              <AppText variant="callout" style={{ fontWeight: '600' }}>
                {props.upNext}
              </AppText>
            </AppText>
          </View>
        ) : null}
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

function ExerciseBlock({
  ex,
  index,
  superset,
  page: p,
  dragging,
  onDragChange,
  fit,
  fades,
  boxRef,
  onBoxFrame,
  onRow,
  onBoxScroll,
}: {
  ex: RoundExercise;
  index: number;
  superset: boolean;
  page: RoundPageProps;
  dragging: boolean;
  onDragChange: (active: boolean) => void;
  fit: { height: number | null } | null;
  fades: { top: boolean; bottom: boolean };
  boxRef: (r: ScrollView | null) => void;
  onBoxFrame: (h: number) => void;
  onRow: (setId: string, y: number, h: number) => void;
  onBoxScroll: (y: number, viewHeight: number, contentHeight: number) => void;
}) {
  const height = fit?.height ?? null;
  const viewH = useRef(0);
  const contentH = useRef(0);
  /** The set box's visible window: rows scrolled out of it are no drop targets (review S2). */
  const boxView = useRef<View | null>(null);
  const edit = p.setEdit;
  const movable = edit?.movable(ex.sessionExerciseId) ?? [];
  return (
    <View style={{ opacity: ex.dim ? 0.55 : 1 }}>
      <ExerciseHeader ex={ex} superset={superset} page={p} />
      {ex.isCurrent ? p.warmUp : null}
      {ex.isCurrent ? p.adjustRow : null}
      {p.ax ? null : <ColumnLabels loadHeader={ex.loadHeader} valueHeader={ex.valueHeader} />}
      <View
        ref={boxView}
        onLayout={(e) => {
          viewH.current = e.nativeEvent.layout.height;
          onBoxFrame(e.nativeEvent.layout.height);
        }}
        style={height === null ? undefined : { height }}
      >
        <ScrollView
          ref={boxRef}
          scrollEnabled={height !== null && !dragging}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={(e) => {
            onBoxScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.layoutMeasurement.height, e.nativeEvent.contentSize.height);
          }}
          onContentSizeChange={(_w, h) => {
            contentH.current = h;
            onBoxScroll(0, viewH.current, h);
          }}
          onScrollBeginDrag={p.onTapElsewhere}
          {...WORKOUT_KEYBOARD}
        >
          {/* §7: press and hold a set not done yet, then drag it among those (done sets keep their logged order). */}
          <DragList
            enabled={edit !== undefined}
            canDrop={(_from, t) => movable.includes(t.key)}
            onDrop={(from, t) => {
              const to = dropIndex(movable, from, t);
              if (to !== null) edit?.onDrop(from, to);
            }}
            onMenu={(setId) => edit?.onMenu(setId)}
            onDragChange={onDragChange}
            viewport={boxView}
          >
          {ex.rows.map((r) => (
            <View
              key={r.setId}
              onLayout={(e) => {
                onRow(r.setId, e.nativeEvent.layout.y, e.nativeEvent.layout.height);
              }}
            >
              <DragItem dragKey={r.setId} draggable={movable.includes(r.setId)}>
              {r.row.partStart !== null ? <GymPartDivider label={r.row.partStart} /> : null}
              <SwipeRow
                enabled={!r.skipped}
                onDelete={() => {
                  p.onDeleteSet(r.setId, r.stepName);
                }}
              >
                <Flash on={p.highlightSetId === r.setId} reduceMotion={p.reduceMotion}>
                  {r.current ? (
                    <OpenRowContext.Provider value={{ row: r, loadHeader: ex.loadHeader }}>{p.openRow}</OpenRowContext.Provider>
                  ) : (
                    <TableSetRow
                      row={r}
                      hasLoad={ex.loadHeader !== null}
                      ax={p.ax}
                      editing={p.rowEditor?.setId === r.setId ? p.rowEditor.field : null}
                      cellEditor={p.rowEditor?.setId === r.setId && p.rowEditor.inCell && !p.ax ? p.rowEditor.node : null}
                      onDelete={() => {
                        p.onDeleteSet(r.setId, r.stepName);
                      }}
                      {...(edit === undefined
                        ? {}
                        : {
                            moves: edit.moves(r.setId),
                            onMoveSet: (dir: 'up' | 'down') => {
                              edit.onMove(r.setId, dir);
                            },
                            onChangeType: () => {
                              edit.onChangeType(r.setId);
                            },
                          })}
                      onPress={(part) => {
                        runRowTap(r.row, {
                          dismissKeyboard: () => { Keyboard.dismiss(); },
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
                        }, part);
                      }}
                    />
                  )}
                </Flash>
              </SwipeRow>
              {/* At AX sizes (and cardio's pair) the correction sits under its row. */}
              {p.rowEditor?.setId === r.setId && (!p.rowEditor.inCell || p.ax) ? <View>{p.rowEditor.node}</View> : null}
              </DragItem>
            </View>
          ))}
          </DragList>
        </ScrollView>
        {height !== null && fades.top ? <Fade edge="top" /> : null}
        {height !== null && fades.bottom ? <Fade edge="bottom" /> : null}
      </View>
      <CompactRow ex={ex} index={index} page={p} />
    </View>
  );
}

/** Label · name with `works · rep target` under it · progress, Adjust while current, `⋯` (§2). */
function ExerciseHeader({ ex, superset, page: p }: { ex: RoundExercise; superset: boolean; page: RoundPageProps }) {
  const theme = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'], minHeight: theme.target.min.height }}>
        <AppText variant="headline" numeric style={{ minWidth: 28, paddingTop: 2 }} importantForAccessibility="no" accessibilityElementsHidden>
          {ex.label}
        </AppText>
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
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <AppText variant="headline" numberOfLines={p.ax ? 3 : 2}>
            {ex.name}
          </AppText>
          {ex.subline !== null ? (
            <AppText variant="callout" color="text.secondary" numeric style={{ fontSize: 13, lineHeight: 18 }}>
              {ex.subline}
            </AppText>
          ) : null}
        </Pressable>
        {ex.painBadge ? (
          <PainBadge
            onPress={() => {
              p.onPainBadge(ex.exerciseId);
            }}
          />
        ) : null}
        <AppText variant="callout" color="text.secondary" numeric style={{ paddingTop: 2 }} importantForAccessibility="no" accessibilityElementsHidden>
          {ex.progressText}
        </AppText>
        {ex.isCurrent ? p.adjust : null}
        <MenuButton
          label={`${superset ? `${ex.label} ` : ''}${ex.name} menu`}
          onPress={() => {
            p.onMenu(ex.sessionExerciseId);
          }}
        />
      </View>
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

/** `# · KG · REPS · RPE · ✓`: the unit once, in the header (§2). */
function ColumnLabels({ loadHeader, valueHeader }: { loadHeader: string | null; valueHeader: string }) {
  const theme = useTheme();
  const label = (t: string, style: object) => (
    <AppText variant="label" color="text.tertiary" numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, letterSpacing: 1, textAlign: 'center', ...style }} maxFontSizeMultiplier={1.6}>
      {t}
    </AppText>
  );
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: theme.space['2'], paddingBottom: theme.space['1'] }}>
      {label('#', { width: NUM_W, textAlign: 'left', paddingLeft: theme.space['1'] })}
      {loadHeader !== null ? label(loadHeader, { flex: 1 }) : null}
      {label(valueHeader, { flex: 1 })}
      {label('RPE', { width: RPE_W })}
      {label('✓', { width: TICK_W })}
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

/** A soft fade at a box's edge: more rows that way (§2). Drawn with steps of the card colour, no gradient module. */
function Fade({ edge }: { edge: 'top' | 'bottom' }) {
  const theme = useTheme();
  const steps = [0.85, 0.6, 0.35, 0.15];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, [edge]: 0, height: 16 }}>
      {(edge === 'top' ? steps : [...steps].reverse()).map((o, i) => (
        <View key={i} style={{ height: 4, backgroundColor: theme.colors['bg.surface'], opacity: o }} />
      ))}
    </View>
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

/** The number cell: bold on the current set, `W` on a warm-up, the set type (or today's change) under it. */
function NumberCell({ row, current, todayChange }: { row: RoundRow; current: boolean; todayChange: 'coach' | 'rule' | null }) {
  const theme = useTheme();
  const sub = [row.typeLabel, todayChange === 'coach' ? 'Coach' : todayChange === 'rule' ? 'Rule' : null].filter((x): x is string => x !== null);
  return (
    <View style={{ paddingLeft: theme.space['1'] }}>
      <AppText variant="callout" numeric color={current ? 'text.primary' : row.warmup ? 'text.tertiary' : 'text.secondary'} style={current ? { fontWeight: '700' } : undefined}>
        {row.label}
      </AppText>
      {sub.map((s) => (
        // Mixed case like the prototype (`Back-off`): fits the 52 pt column without truncating (spec S4).
        <AppText key={s} variant="label" color="text.tertiary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 10, lineHeight: 12 }} maxFontSizeMultiplier={1.4}>
          {s}
        </AppText>
      ))}
    </View>
  );
}

/** A boxed value cell on a set not done yet; green text without a box on a done one (§2). */
function CellBox({ text, done, warmup, on }: { text: string; done: boolean; warmup: boolean; on: boolean }) {
  const theme = useTheme();
  if (done) {
    return (
      <AppText variant="rowValue" color="status.done" numeric numberOfLines={1} style={{ textAlign: 'center' }}>
        {text}
      </AppText>
    );
  }
  return (
    <View style={{ minHeight: 36, borderRadius: 9, backgroundColor: theme.colors['bg.raised'], opacity: warmup ? 0.75 : 1, borderWidth: 1.5, borderColor: on ? theme.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space['1'] }}>
      <AppText variant="rowValue" color={warmup ? 'text.secondary' : 'text.primary'} numeric numberOfLines={1} adjustsFontSizeToFit>
        {text}
      </AppText>
    </View>
  );
}

/**
 * A set row (§2): `# · KG · REPS · RPE · ✓`. Done: green values without
 * boxes and a filled ✓ (tap = untick); a value tap corrects it in place
 * (versioned, Undo). Not done: boxed values (tap = select and edit in place),
 * an open ring (tap = make current, never a log). The set number (or a
 * long-press) opens Edit set. VoiceOver actions mirror every tap and swipe.
 */
export function TableSetRow({
  row: r,
  hasLoad,
  ax,
  editing,
  cellEditor = null,
  onPress,
  onDelete,
  moves,
  onMoveSet,
  onChangeType,
}: {
  row: RoundRow;
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
    ...(onChangeType !== undefined ? [{ name: 'type', label: 'Change type' }] : []),
    ...(moves?.up === true ? [{ name: 'move_up', label: 'Move up' }] : []),
    ...(moves?.down === true ? [{ name: 'move_down', label: 'Move down' }] : []),
    { name: 'delete', label: 'Delete set' },
  ];
  const onAction = (a: string) => {
    if (a === 'delete') onDelete();
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
      style={{ width: TICK_W, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors['status.done'], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" color="on.accent" size={15} />
      </View>
    </Pressable>
  ) : skipped ? (
    <View style={{ width: TICK_W, alignItems: 'center' }}>
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
      style={{ width: TICK_W, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: theme.colors['text.tertiary'], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" color="text.tertiary" size={15} />
      </View>
    </Pressable>
  );

  if (ax || skipped) {
    // AX1+ block rows and skipped rows: one element; the cells are VoiceOver actions.
    return (
      <Pressable
        accessibilityRole={skipped ? 'text' : 'button'}
        accessibilityLabel={r.accessibilityLabel}
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
              {[r.stepName, r.typeLabel].filter((x): x is string => x !== null).join(' · ')}
            </AppText>
            <AppText variant="body" color={done ? 'status.done' : 'text.secondary'} numeric>
              {[row.cells.load !== null && hasLoad ? plainSpaces(row.cells.load) : null, plainSpaces(row.cells.value), r.rpe].filter((x): x is string => x !== null).join(' · ')}
            </AppText>
            {second.map((x) => (
              <AppText key={x} variant="callout" color="text.secondary">
                {x}
              </AppText>
            ))}
          </View>
          {marker}
        </View>
      </Pressable>
    );
  }

  const cell = (part: 'load' | 'value', text: string, a11y: string) => {
    const on = editing !== null && (part === 'load' ? editing === 'load' : editing !== 'load');
    if (on && cellEditor !== null) {
      // No second line (Ben, 20 Oct): the cell itself takes the typing.
      return <View style={{ flex: 1, minHeight: theme.target.min.height, justifyContent: 'center' }}>{cellEditor}</View>;
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${a11y}, ${r.stepName.toLowerCase()}`}
        accessibilityHint={on ? 'Closes the editor' : done ? 'Corrects it here' : 'Edits it here'}
        accessibilityState={{ expanded: on }}
        onPress={() => {
          onPress(part);
        }}
        {...hold}
        style={({ pressed }) => ({ flex: 1, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <CellBox text={text} done={done} warmup={r.warmup} on={on} />
      </Pressable>
    );
  };

  return (
    <View style={{ minHeight: theme.target.min.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], justifyContent: 'center', paddingVertical: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={r.accessibilityLabel}
          accessibilityHint="Edit this set"
          accessibilityActions={rowActions}
          onAccessibilityAction={(e) => {
            onAction(e.nativeEvent.actionName);
          }}
          onPress={() => {
            onPress('row');
          }}
          {...hold}
          style={({ pressed }) => ({ width: NUM_W, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <NumberCell row={r} current={false} todayChange={row.todayChange} />
        </Pressable>
        {/* Each row's own columns (review B2): a mixed part keeps its load cell. */}
        {hasLoad ? (row.columns.loadLabel !== null ? cell('load', plainSpaces(row.cells.load ?? '—'), loadCellA11y(row.columns.loadLabel, row.cells.load)) : <View style={{ flex: 1 }} />) : null}
        {cell('value', plainSpaces(row.cells.value), valueCellA11y(row.columns.valueLabel, row.cells.value))}
        <AppText variant="callout" color={done ? 'text.secondary' : 'text.tertiary'} numeric numberOfLines={1} adjustsFontSizeToFit style={{ width: RPE_W, textAlign: 'center', fontSize: 13 }} importantForAccessibility="no" accessibilityElementsHidden>
          {r.rpe ?? ''}
        </AppText>
        {marker}
      </View>
      {second.length > 0 ? (
        <AppText variant="callout" color="text.secondary" style={{ paddingLeft: NUM_W, paddingBottom: theme.space['1'], fontSize: 13 }}>
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

/** The open row's round row and its exercise's load header, from the round page, so its cells line up with the header. */
const OpenRowContext = createContext<{ row: RoundRow; loadHeader: string | null } | null>(null);

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
  const { width: windowWidth } = useWindowDimensions();
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

  const cell = (id: TileId | null, text: string, a11y: string) => {
    const on = id !== null && p.editing === id;
    const field = on && editsInPlace({ field: id, cardio }) ? inPlace(id) : null;
    if (field !== null) {
      // No second line: the cell itself takes the typing (Ben, 20 Oct).
      return <View style={{ flex: 1, minHeight: theme.target.min.height, justifyContent: 'center' }}>{field}</View>;
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
        style={({ pressed }) => ({ flex: 1, minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <CellBox text={text} done={false} warmup={ctx?.row.warmup ?? false} on={on} />
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
    <AppText variant="callout" color="text.tertiary" numeric accessibilityLabel={`Plates: ${f.plateLine}`} style={{ paddingLeft: NUM_W, paddingBottom: theme.space['1'], fontSize: 13 }}>
      {plainSpaces(f.plateLine)}
    </AppText>
  ) : null;
  const links = [p.workAction ? link(p.workAction.label, `${p.workAction.label} the timer`, p.workAction.onPress) : null, p.timedLogLabel !== null ? link(plainSpaces(p.timedLogLabel), `${stepName}, ${plainSpaces(p.timedLogLabel)}`, p.onLog) : null].filter((x) => x !== null);

  return (
    <View style={{ minHeight: theme.target.min.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingVertical: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable
          ref={p.headerRef}
          accessibilityRole="button"
          accessibilityLabel={`${f.exerciseName}, ${ctx?.row.accessibilityLabel ?? `${stepName}, ${f.setTypeLabel}${sideTag === 'L' ? ', left side' : sideTag === 'R' ? ', right side' : ''}`}${p.resting ? ', next' : ''}`}
          accessibilityHint="More for this set"
          accessibilityActions={[
            { name: 'activate' },
            ...(p.onChangeType ? [{ name: 'type', label: 'Change type' }] : []),
            ...(p.moves?.up === true ? [{ name: 'move_up', label: 'Move up' }] : []),
            ...(p.moves?.down === true ? [{ name: 'move_down', label: 'Move down' }] : []),
            ...(p.onDelete ? [{ name: 'delete', label: 'Delete set' }] : []),
          ]}
          onAccessibilityAction={(e) => {
            const a = e.nativeEvent.actionName;
            if (a === 'delete') p.onDelete?.();
            else if (a === 'type') p.onChangeType?.();
            else if (a === 'move_up' || a === 'move_down') p.onMoveSet?.(a === 'move_up' ? 'up' : 'down');
            else p.onMore();
          }}
          onPress={p.onMore}
          {...hold}
          style={{ width: NUM_W, minHeight: theme.target.min.height, justifyContent: 'center' }}
        >
          {ctx !== null ? (
            <NumberCell row={ctx.row} current todayChange={f.adjustedBy} />
          ) : (
            <AppText variant="callout" numeric style={{ fontWeight: '700', paddingLeft: theme.space['1'] }}>
              {setLabel}
            </AppText>
          )}
        </Pressable>
        {hasLoadColumn ? cell(f.loadField ? 'load' : null, plainSpaces(f.cells.load ?? '—'), loadA11y) : null}
        {cell(working && !cardio ? null : valueField, valueText, valueA11y)}
        <AppText variant="callout" color="text.tertiary" numeric numberOfLines={1} adjustsFontSizeToFit style={{ width: RPE_W, textAlign: 'center', fontSize: 13 }} accessibilityLabel={ctx?.row.rpe != null ? `Target RPE ${ctx.row.rpe.replace(/^@/, '')}` : undefined}>
          {ctx?.row.rpe ?? ''}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${stepName}, ${plainSpaces(p.timedLogLabel ?? f.logLabel ?? 'Log')}`}
          accessibilityState={{ disabled: !p.canLog }}
          disabled={!p.canLog}
          onPress={p.onLog}
          hitSlop={6}
          style={({ pressed }) => ({ width: TICK_W, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: !p.canLog ? 0.4 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkmark" color="accent" size={15} />
          </View>
        </Pressable>
      </View>
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
      {links.length > 0 ? <View style={{ flexDirection: 'row', columnGap: theme.space['4'], paddingLeft: NUM_W }}>{links}</View> : null}
      {f.targetEstimate ? (
        // Rule 6: an estimated target says so, in the shortest word.
        <AppText variant="callout" color="text.tertiary" style={{ paddingLeft: NUM_W, fontSize: 13 }} accessibilityLabel="Target is an estimate">
          est.
        </AppText>
      ) : null}
      {f.planWas !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={{ paddingLeft: NUM_W, fontSize: 13 }}>
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
        <AppText variant="callout" color="text.secondary" style={{ paddingLeft: NUM_W, fontSize: 13 }}>
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

