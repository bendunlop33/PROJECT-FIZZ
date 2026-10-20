import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextInput } from 'react-native';

import { formatDuration, NBSP, targetLineLabel, targetLineText, type FocusView, type LoadField, type StepTarget, type RestView, type SupersetCard, type TableBlock, type TableCard, type TableColumns, type TableRow, type WorkoutTableView } from '@fizz/domain';
import type { SetSide } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Icon, LinkLine, NumberStepper, StatusLine, StepperTileRow, TextButton, TEXT_PRESSED_OPACITY, type SymbolName } from '../../ui';
import { CARDIO_TIME_FORMAT } from '../../ui/number-text';
import { anchorTargetY, bottomSpacerHeight, chipsFor, keypadTileY, loadCellA11y, openRowLabel, runRowTap, showsFolded, tileReportFor, valueCellA11y, type AnchorRequest, type CellField, type ChipState, type Expansions, type RowPart, type RowTap, type TileId, type TileReport } from '../../workout/table';
import { workTimerText } from '../../workout/cues';
import { cardioPairTiles, openRowWidth } from '../../workout/tile-fit';
import { WORKOUT_KEYBOARD } from '../../workout/keyboard';
import { GymPartDivider, SnapNote } from './GymSwitch';
import { TargetWhyLink } from './TargetWhyPanel';

/**
 * The workout Table view (active-workout §2A; design-system §9.74–§9.80): the
 * whole session as one list, anchored on the open row. Every value comes
 * from `buildWorkoutTableView` and `buildActiveSetView` (domain). This file
 * only lays them out, measures where the anchor is, and reports taps; the
 * screen owns every command (one Log path, `WorkoutScreen.log`).
 */

const plainSpaces = (s: string) => s.replaceAll(NBSP, ' ');

export interface WorkoutTableHandle {
  /** `↑ N done`: to the top of the list. Changes no data. */
  scrollToTop: (animated: boolean) => void;
}

interface Layout {
  y: number;
  h: number;
}

/** `OpenSetRow` reports where its tiles are, so the keypad and rest anchors know where they end (review r2 B1, S2). */
const TileLayoutContext = createContext<((t: TileReport) => void) | null>(null);

export interface WorkoutTableProps {
  table: WorkoutTableView;
  ax: boolean;
  reduceMotion: boolean;
  /** The open row (`OpenSetRow`), rendered in place of the active set's row. */
  openRow: ReactNode;
  /** The after-set block (effort, record, pain check, coach slot), directly above the open row; null when empty. */
  afterSet: ReactNode;
  /** Changes when the after-set block's content is for another set, so its position is measured fresh. */
  afterSetKey: string | null;
  /** `Adjust` on the current exercise's header (52 pt hit). */
  adjust: ReactNode;
  /** The inline `AdjustRow` under the current header. */
  adjustRow: ReactNode;
  /** The warm-up ramp suggestion with `Hide` (§2A.3), in the current card's header; null when none. */
  warmUp: ReactNode;
  /** The open row's header, where VoiceOver focus goes once an anchor with `focus` is applied (§2A.7). */
  focusRef: RefObject<View | null>;
  /** After the cards: `All planned sets done.`, `+ Add exercise`, `TimeLeftLine`. */
  footer: ReactNode;
  /** The pending scroll to the anchor, if any; `onAnchorApplied` clears it. */
  anchorRequest: AnchorRequest | null;
  /** The keypad's height (`keyboardWillShow` `endCoordinates.height`, its Done bar included); 0 while it's closed. */
  keyboardHeight: number;
  /** Room under the list for a floating toast while it shows (0.6). */
  bottomInset?: number;
  onAnchorApplied: () => void;
  onUserScroll: () => void;
  onChips: (c: ChipState) => void;
  onEditSet: (setId: string) => void;
  /** `onScreen`: the row was visible when tapped (no scroll follows). */
  onSelectSet: (setId: string) => void;
  /** A KG / REPS cell of a pending or done row: edited in place, never on another screen (18 Oct). */
  onCellTap: (tap: Extract<RowTap, { kind: 'select_edit' | 'correct' }>) => void;
  /** A done row's in-place correction, drawn under its row; null when none is open. */
  rowEditor: { setId: string; field: CellField; node: ReactNode } | null;
  /** A drag, or a tap on the list outside the rows: closes any cell editor (review S4). */
  onTapElsewhere: () => void;
  onAddSet: (sessionExerciseId: string) => void;
  onMenu: (sessionExerciseId: string) => void;
  onName: (card: { sessionExerciseId: string; exerciseId: string; name: string; isCurrent: boolean }) => void;
  onNote: (sessionExerciseId: string, name: string, note: string | null) => void;
  onPainBadge: (exerciseId: string) => void;
}

export const WorkoutTable = forwardRef(function WorkoutTable(props: WorkoutTableProps, ref: Ref<WorkoutTableHandle>) {
  const theme = useTheme();
  const { table } = props;
  const scroll = useRef<ScrollView>(null);
  const [expansions, setExpansions] = useState<Expansions>({});
  const [spacer, setSpacer] = useState(0);

  // Measured positions (content space for direct children; relative to the body for rows).
  const headers = useRef(new Map<string, Layout>());
  const bodies = useRef(new Map<string, Layout>());
  const rows = useRef(new Map<string, { block: string; layout: Layout }>());
  const folded = useRef(new Map<string, Layout>());
  const open = useRef<{ setId: string; layout: Layout } | null>(null);
  const after = useRef<{ key: string; layout: Layout } | null>(null);
  const tiles = useRef<TileReport | null>(null);
  const spacerAt = useRef<number | null>(null);
  const viewport = useRef(0);
  /** The viewport with the keypad closed (the keypad lifts the bottom bars and shrinks it by its height). */
  const viewportClosed = useRef(0);
  const scrollY = useRef(0);
  const lastChips = useRef<ChipState>({ done: false, now: null });

  const anchorKey = table.anchor?.blockKey ?? null;
  const anchorSetId = table.anchor?.setId ?? null;

  useImperativeHandle(ref, () => ({
    scrollToTop: (animated) => {
      scroll.current?.scrollTo({ y: 0, animated });
    },
  }));

  /** The open row's top and bottom in content space, when it's laid out for the current anchor. */
  const openBox = useCallback((): { top: number; bottom: number } | null => {
    const o = open.current;
    if (o === null || anchorKey === null || o.setId !== anchorSetId) return null;
    const body = bodies.current.get(anchorKey);
    if (!body) return null;
    return { top: body.y + o.layout.y, bottom: body.y + o.layout.y + o.layout.h };
  }, [anchorKey, anchorSetId]);

  const reportChips = useCallback(() => {
    const box = openBox();
    let firstDone: number | null = null;
    for (const [key, l] of folded.current) if (table.blocks.some((b) => b.key === key)) firstDone = firstDone === null ? l.y : Math.min(firstDone, l.y);
    for (const r of rows.current.values()) {
      const body = bodies.current.get(r.block);
      if (body) firstDone = firstDone === null ? body.y + r.layout.y : Math.min(firstDone, body.y + r.layout.y);
    }
    const pinned = anchorKey === null ? 0 : (headers.current.get(anchorKey)?.h ?? 0);
    const c = chipsFor({ doneCount: table.doneCount, firstDoneTop: firstDone, openTop: box?.top ?? null, openBottom: box?.bottom ?? null, scrollY: scrollY.current, viewportHeight: viewport.current, pinnedHeight: pinned });
    if (c.done !== lastChips.current.done || c.now !== lastChips.current.now) {
      lastChips.current = c;
      props.onChips(c);
    }
  }, [openBox, table, anchorKey, props]);

  // Apply a pending anchor once the open row (and the after-set block, when there is one) is measured for this set.
  const frame = useRef<number | null>(null);
  const tryApply = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const req = props.anchorRequest;
      if (req === null) {
        reportChips();
        return;
      }
      if (anchorKey === null) {
        props.onAnchorApplied();
        return;
      }
      const header = headers.current.get(anchorKey);
      const body = bodies.current.get(anchorKey);
      const o = open.current;
      if (!header || !body || o?.setId !== anchorSetId) return;
      const openTop = body.y + o.layout.y;
      // Only tiles measured under the current keypad state: it hides the plate line above them (review r3 S1).
      const t = tileReportFor(tiles.current, { setId: anchorSetId, keypadOpen: props.keyboardHeight > 0 });
      const closed = viewportClosed.current > 0 ? viewportClosed.current : viewport.current;
      const geometry = { cardTop: header.y, headerHeight: header.h, viewportHeight: closed, openTop };
      let y: number;
      if (req.target.kind === 'tile') {
        // The focused tile clears the keypad: wait for its height and the tile's layout (review r2 B1).
        const ky = keypadTileY({ geometry, keyboardHeight: props.keyboardHeight, tile: req.target.tile, report: t });
        if (ky === null) return;
        y = ky;
      } else {
        // The after-set block leads, unless it and the open row's tiles can't both fit (review r2 S2).
        const a = props.afterSetKey !== null ? after.current : null;
        if (props.afterSetKey !== null && a?.key !== props.afterSetKey) return;
        if (t.kind === 'stale') return;
        let tilesBottom: number | null = null;
        if (t.kind === 'fresh') for (const b of t.boxes.values()) tilesBottom = Math.max(tilesBottom ?? 0, openTop + b.y + b.h);
        y = anchorTargetY({ ...geometry, viewportHeight: Math.max(0, closed - props.keyboardHeight), afterTop: a !== null ? body.y + a.layout.y : null, tilesBottom });
      }
      if (spacerAt.current !== null && closed > 0) {
        // The closed viewport: enough room whether or not the keypad has shrunk the list yet.
        const needed = bottomSpacerHeight({ viewportHeight: closed, contentEnd: spacerAt.current, anchorY: y });
        if (needed !== spacer) {
          // The spacer grows or shrinks first, then the scroll (it would clamp otherwise).
          setSpacer(needed);
          return;
        }
      }
      scroll.current?.scrollTo({ y, animated: req.animated });
      scrollY.current = y;
      props.onAnchorApplied();
      reportChips();
      if (req.focus) {
        // VoiceOver: the new open row after a Log or on open, not wherever focus was (review S5).
        const target = props.focusRef;
        setTimeout(
          () => {
            if (target.current !== null) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
          },
          req.animated ? 400 : 50,
        );
      }
    });
  }, [props, anchorKey, anchorSetId, spacer, reportChips]);

  useEffect(() => {
    if (props.anchorRequest !== null) tryApply();
  }, [props.anchorRequest, tryApply, spacer]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const layoutOf = (e: LayoutChangeEvent): Layout => ({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height });

  const latestApply = useRef(tryApply);
  latestApply.current = tryApply;
  const reportTiles = useCallback((t: TileReport) => {
    tiles.current = t;
    latestApply.current();
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    reportChips();
  };

  // Expanding remembers where the open row was; the block folds again once it moves to another block (§2A.3).
  const toggleFold = (key: string, expand: boolean) => {
    setExpansions((cur) => {
      if (expand) return { ...cur, [key]: anchorKey };
      return Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key));
    });
  };

  const children: ReactNode[] = [];
  const sticky: number[] = [];
  for (const block of table.blocks) {
    const isFolded = showsFolded(block, expansions, anchorKey);
    if (isFolded && block.folded !== null) {
      const f = block.folded;
      children.push(
        <View
          key={`fold:${block.key}`}
          onLayout={(e) => {
            folded.current.set(block.key, layoutOf(e));
            tryApply();
          }}
          style={{ paddingTop: theme.space['3'] }}
        >
          <FoldedExercise name={f.name} summary={f.summary} skipped={f.skipped} accessibilityLabel={f.accessibilityLabel} ax={props.ax} onPress={() => { toggleFold(block.key, true); }} />
        </View>,
      );
      for (const [id, r] of rows.current) if (r.block === block.key) rows.current.delete(id);
      continue;
    }
    folded.current.delete(block.key);
    const current = block.key === anchorKey;
    sticky.push(children.length);
    children.push(
      <View
        key={`head:${block.key}`}
        onLayout={(e) => {
          headers.current.set(block.key, layoutOf(e));
          tryApply();
        }}
        style={{ backgroundColor: theme.colors['bg.canvas'], paddingTop: theme.space['3'] }}
      >
        <View style={{ backgroundColor: theme.colors['bg.surface'], borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, paddingHorizontal: theme.space['3'], paddingTop: theme.space['2'] }}>
          {block.kind === 'exercise' ? (
            <CardHeader card={block.card} current={current} ax={props.ax} adjust={current ? props.adjust : null} onFold={block.folded !== null ? () => { toggleFold(block.key, false); } : null} onMenu={props.onMenu} onName={props.onName} onNote={props.onNote} onPainBadge={props.onPainBadge} />
          ) : (
            <SupersetHeader superset={block.superset} ax={props.ax} adjust={current ? props.adjust : null} onFold={block.folded !== null ? () => { toggleFold(block.key, false); } : null} onMenu={props.onMenu} />
          )}
        </View>
      </View>,
    );
    children.push(
      <View
        key={`body:${block.key}`}
        onLayout={(e) => {
          bodies.current.set(block.key, layoutOf(e));
          tryApply();
        }}
        style={{ backgroundColor: theme.colors['bg.surface'], borderBottomLeftRadius: theme.radius.lg, borderBottomRightRadius: theme.radius.lg, paddingHorizontal: theme.space['3'], paddingBottom: theme.space['1'] }}
      >
        {/* Scrolls with the body, never pinned: the pinned header is the group line and column labels only (review r2 S1). */}
        {block.kind === 'superset' ? <SupersetMembers superset={block.superset} ax={props.ax} onMenu={props.onMenu} onName={props.onName} onNote={props.onNote} onPainBadge={props.onPainBadge} /> : null}
        {current ? props.warmUp : null}
        {current ? props.adjustRow : null}
        {blockRows(block).flatMap((item) => {
          if (item.kind === 'round') {
            return [
              <View key={`round:${String(item.n)}`} style={{ paddingTop: theme.space['3'], paddingBottom: theme.space['1'] }} accessibilityRole="header">
                <AppText variant="label" color="text.tertiary">{`ROUND ${String(item.n)}`}</AppText>
              </View>,
            ];
          }
          const row = item.row;
          const parts: ReactNode[] = [];
          if (row.partStart !== null) parts.push(<GymPartDivider key={`part:${row.setId}`} label={row.partStart} />);
          if (row.state === 'open') {
            if (props.afterSet !== null && props.afterSetKey !== null) {
              parts.push(
                <View
                  key={`after:${props.afterSetKey}`}
                  onLayout={(e) => {
                    after.current = { key: props.afterSetKey ?? '', layout: layoutOf(e) };
                    tryApply();
                  }}
                >
                  {props.afterSet}
                </View>,
              );
            }
            parts.push(
              <View
                key={`open:${row.setId}`}
                onLayout={(e) => {
                  open.current = { setId: row.setId, layout: layoutOf(e) };
                  tryApply();
                }}
              >
                <OpenRowContext.Provider value={row}>{props.openRow}</OpenRowContext.Provider>
              </View>,
            );
          } else {
            parts.push(
              <View
                key={`row:${row.setId}`}
                onLayout={(e) => {
                  if (row.state === 'done') rows.current.set(row.setId, { block: block.key, layout: layoutOf(e) });
                  else rows.current.delete(row.setId);
                }}
              >
                <TableSetRow
                  row={row}
                  ax={props.ax}
                  editing={props.rowEditor?.setId === row.setId ? props.rowEditor.field : null}
                  onPress={(part) => {
                    runRowTap(row, {
                      dismissKeyboard: () => { Keyboard.dismiss(); },
                      edit: (setId) => {
                        props.onTapElsewhere();
                        props.onEditSet(setId);
                      },
                      select: (setId) => {
                        haptic('step');
                        props.onTapElsewhere();
                        props.onSelectSet(setId);
                      },
                      selectEdit: (setId, field) => {
                        haptic('step');
                        props.onCellTap({ kind: 'select_edit', setId, field });
                      },
                      correct: (setId, field) => {
                        haptic('step');
                        props.onCellTap({ kind: 'correct', setId, field });
                      },
                    }, part);
                  }}
                />
              </View>,
            );
            if (props.rowEditor?.setId === row.setId) parts.push(<View key={`edit:${row.setId}`}>{props.rowEditor.node}</View>);
          }
          // Rows are direct children of the body, so their measured y is body-relative.
          return parts;
        })}
        {block.kind === 'exercise' ? (
          <View style={{ alignItems: 'flex-start', minHeight: theme.target.workout.height, justifyContent: 'center' }}>
            <TextButton
              label="+ Add set"
              tone="secondary"
              accessibilityLabel={`Add set to ${block.card.name}`}
              onPress={() => {
                props.onAddSet(block.card.sessionExerciseId);
              }}
            />
          </View>
        ) : null}
      </View>,
    );
  }
  children.push(
    <Pressable key="footer" accessible={false} onPress={props.onTapElsewhere} style={{ paddingTop: theme.space['3'], gap: theme.space['3'] }}>
      {props.footer}
    </Pressable>,
  );
  children.push(
    <Pressable
      key="spacer"
      accessible={false}
      onPress={props.onTapElsewhere}
      onLayout={(e) => {
        spacerAt.current = e.nativeEvent.layout.y;
        tryApply();
      }}
      style={{ height: spacer }}
    />,
  );

  // Outside the ScrollView: its children must stay direct for `stickyHeaderIndices`.
  return (
    <TileLayoutContext.Provider value={reportTiles}>
      <ScrollView
        ref={scroll}
        stickyHeaderIndices={sticky}
        onLayout={(e) => {
          viewport.current = e.nativeEvent.layout.height;
          if (props.keyboardHeight <= 0) viewportClosed.current = e.nativeEvent.layout.height;
          tryApply();
        }}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => {
          props.onUserScroll();
          props.onTapElsewhere();
        }}
        {...WORKOUT_KEYBOARD}
        contentContainerStyle={{ paddingHorizontal: theme.space['4'], paddingBottom: theme.space['3'] + (props.bottomInset ?? 0) }}
      >
        {children}
      </ScrollView>
    </TileLayoutContext.Provider>
  );
});

type BodyItem = { kind: 'row'; row: TableRow } | { kind: 'round'; n: number };

function blockRows(block: TableBlock): BodyItem[] {
  if (block.kind === 'exercise') return block.card.rows.map((row) => ({ kind: 'row' as const, row }));
  return block.superset.rounds.flatMap((r) => [{ kind: 'round' as const, n: r.n }, ...r.rows.map((row) => ({ kind: 'row' as const, row }))]);
}

// ---------------------------------------------------------------------------
// Headers

function ColumnLabels({ columns }: { columns: TableColumns }) {
  const theme = useTheme();
  const label = (t: string, flex: number | null, align: 'left' | 'center' = 'left') => (
    <AppText variant="label" color="text.tertiary" style={flex === null ? { width: 52, textAlign: align } : { flex, textAlign: align }}>
      {t}
    </AppText>
  );
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.space['2'] }}>
      {label('SET', null)}
      {columns.loadLabel !== null ? label(columns.loadLabel, 1) : null}
      {label(columns.valueLabel, 1)}
      {label('✓', null, 'center')}
    </View>
  );
}

function PainBadge({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Pain flag" onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['2'], paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: theme.colors['status.warning.subtle'] }}>
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
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.workout.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
      <Icon name="ellipsis" color="text.primary" size={20} />
    </Pressable>
  );
}

function FoldButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Fold" onPress={onPress} style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.workout.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
      <Icon name="chevron.up" color="text.secondary" size={18} />
    </Pressable>
  );
}

function CardHeader({ card, current, ax, adjust, onFold, onMenu, onName, onNote, onPainBadge }: { card: TableCard; current: boolean; ax: boolean; adjust: ReactNode; onFold: (() => void) | null } & Pick<WorkoutTableProps, 'onMenu' | 'onName' | 'onNote' | 'onPainBadge'>) {
  const theme = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], minHeight: theme.target.workout.height }}>
        <Pressable
          accessibilityRole="header"
          accessibilityLabel={`${card.name}, ${card.progressAccessibility}${card.painBadge ? ', pain flag' : ''}`}
          accessibilityHint="Opens the exercise"
          onPress={() => {
            onName({ sessionExerciseId: card.sessionExerciseId, exerciseId: card.exerciseId, name: card.name, isCurrent: card.isCurrent });
          }}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], minHeight: theme.target.workout.height, opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <AppText variant="title2" numberOfLines={ax ? 3 : 2} style={{ flexShrink: 1 }}>
            {card.name}
          </AppText>
          <Icon name="chevron.right" size={13} color="text.tertiary" />
        </Pressable>
        {card.painBadge ? (
          <PainBadge
            onPress={() => {
              onPainBadge(card.exerciseId);
            }}
          />
        ) : null}
        {!ax ? (
          <AppText variant="callout" color="text.tertiary" numeric importantForAccessibility="no" accessibilityElementsHidden>
            {card.progressText}
          </AppText>
        ) : null}
        {current ? adjust : null}
        {onFold !== null ? <FoldButton onPress={onFold} /> : null}
        <MenuButton
          label={`${card.name} menu`}
          onPress={() => {
            onMenu(card.sessionExerciseId);
          }}
        />
      </View>
      <AppText variant="callout" color="text.secondary" numeric>
        {plainSpaces(card.subtitle)}
      </AppText>
      {card.note !== null ? (
        <LinkLine
          accessibilityLabel={`Note: ${card.note}. Tap to edit.`}
          onPress={() => {
            onNote(card.sessionExerciseId, card.name, card.note);
          }}
        >
          <AppText variant="callout" color="text.secondary" numberOfLines={3}>
            {card.note}
          </AppText>
        </LinkLine>
      ) : null}
      {!ax && card.columns !== null ? <ColumnLabels columns={card.columns} /> : <View style={{ height: theme.space['2'] }} />}
    </View>
  );
}

/**
 * The superset header (§2A.8), the part that pins: `Superset A` ·
 * `Round 2 of 3`, `Adjust` while the group is current (acting on the open
 * member), `⋯` for the open member (else the one whose set is next), and the
 * shared column labels. The member lines scroll with the body
 * (`SupersetMembers`) so the pinned part stays short (review r2 S1).
 */
function SupersetHeader({ superset, ax, adjust, onFold, onMenu }: { superset: SupersetCard; ax: boolean; adjust: ReactNode; onFold: (() => void) | null } & Pick<WorkoutTableProps, 'onMenu'>) {
  const theme = useTheme();
  const target = superset.members.find((m) => m.sessionExerciseId === superset.menuTarget);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: theme.target.workout.height }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {superset.label}
        </AppText>
        <AppText variant="callout" color="text.tertiary" numeric style={{ flex: 1 }}>
          {superset.roundText}
        </AppText>
        {adjust}
        {onFold !== null ? <FoldButton onPress={onFold} /> : null}
        <MenuButton
          label={target !== undefined ? `${target.tag} ${target.name} menu` : `${superset.label} menu`}
          onPress={() => {
            onMenu(superset.menuTarget);
          }}
        />
      </View>
      {!ax && superset.columns !== null ? <ColumnLabels columns={superset.columns} /> : <View style={{ height: theme.space['2'] }} />}
    </View>
  );
}

/**
 * The superset's member lines (review B3), at the top of its body: each opens
 * that member's exercise sheet and has its own `⋯`, pain badge and note.
 */
function SupersetMembers({ superset, ax, onMenu, onName, onNote, onPainBadge }: { superset: SupersetCard; ax: boolean } & Pick<WorkoutTableProps, 'onMenu' | 'onName' | 'onNote' | 'onPainBadge'>) {
  const theme = useTheme();
  return (
    <View style={{ borderLeftWidth: 2, marginBottom: theme.space['2'], borderLeftColor: theme.colors['border.control'], paddingLeft: theme.space['2'] }}>
      {superset.members.map((m) => (
        <View key={m.tag}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${m.tag}, ${m.name}, ${plainSpaces(m.unitCaption)}${m.painBadge ? ', pain flag' : ''}`}
              accessibilityHint="Opens the exercise"
              onPress={() => {
                onName({ sessionExerciseId: m.sessionExerciseId, exerciseId: m.exerciseId, name: m.name, isCurrent: m.isCurrent });
              }}
              style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], minHeight: theme.target.workout.height, opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
            >
              <AppText variant="callout" color={m.isCurrent ? 'text.primary' : 'text.secondary'} style={{ flexShrink: 1 }} numberOfLines={ax ? 3 : 2}>{`${m.tag} ${m.name} · ${plainSpaces(m.unitCaption)}`}</AppText>
              <Icon name="chevron.right" size={12} color="text.tertiary" />
            </Pressable>
            {m.painBadge ? (
              <PainBadge
                onPress={() => {
                  onPainBadge(m.exerciseId);
                }}
              />
            ) : null}
            <MenuButton
              label={`${m.tag} ${m.name} menu`}
              onPress={() => {
                onMenu(m.sessionExerciseId);
              }}
            />
          </View>
          {m.note !== null ? (
            <LinkLine
              accessibilityLabel={`${m.tag} note: ${m.note}. Tap to edit.`}
              onPress={() => {
                onNote(m.sessionExerciseId, m.name, m.note);
              }}
            >
              <AppText variant="callout" color="text.secondary" numberOfLines={3}>
                {m.note}
              </AppText>
            </LinkLine>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rows

/**
 * `TableSetRow` (design-system §9.3 Table variant): one state-styled value
 * per cell. Done: bright, filled green tick; a tap edits it. Pending: dim,
 * open ring; a tap on the row edits its plan, a tap on the ring makes it
 * the current set (never logs). Skipped: `Skipped` with a slashed circle.
 */
/**
 * A set row (§9.74; 18 Oct, Ben: "the table stays a table"). Each cell is its
 * own target: the set number opens Edit set (type, side, notes), the KG and
 * REPS cells edit in place (`rowTap`), a pending row's ring makes it current.
 * A long-press anywhere opens Edit set. Skipped rows do nothing.
 */
export function TableSetRow({ row, ax, editing, onPress }: { row: TableRow; ax: boolean; editing: CellField | null; onPress: (part: RowPart) => void }) {
  const theme = useTheme();
  const done = row.state === 'done';
  const skipped = row.state === 'skipped';
  const valueColor = done ? 'text.primary' : 'text.tertiary';
  const valueStyle = done ? { fontWeight: '500' as const } : undefined;
  const setLabel = row.memberTag ?? String(row.number);
  // A done row's value stays on one line: its effort and pace go to the second line (design pass nit).
  const second = done ? [row.effort !== null ? plainSpaces(row.effort) : null, row.pace !== null ? plainSpaces(row.pace) : null, row.notCounted, row.note, row.gymCaption, row.edited ? 'Edited' : null].filter((x): x is string => x !== null) : [];
  const marker = done ? (
    <Icon name="checkmark.circle.fill" color="status.done" size={26} />
  ) : skipped ? (
    <Icon name="slash.circle" color="text.tertiary" size={24} />
  ) : (
    // The ring is its own 52 pt target: it makes this the current set (Ben's decision 3).
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Make set ${setLabel} current`}
      hitSlop={8}
      onPress={() => {
        onPress('marker');
      }}
      style={{ width: 52, minHeight: theme.target.workout.height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: theme.colors['border.control'] }} />
    </Pressable>
  );
  const tag = row.todayChange === null ? null : (
    <View style={{ marginLeft: theme.space['1'], paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: theme.colors['bg.raised'] }}>
      <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={2}>
        {row.todayChange === 'coach' ? 'Coach' : 'Rule'}
      </AppText>
    </View>
  );
  const rowActions = (done ? [{ name: 'activate' }, { name: 'edit', label: 'Edit set' }] : [{ name: 'activate' }, { name: 'edit', label: 'Edit set' }, { name: 'select', label: 'Make current' }]).concat(
    row.columns.loadLabel !== null ? [{ name: 'load', label: 'Edit load here' }] : [],
    [{ name: 'value', label: `Edit ${row.columns.valueLabel === 'REPS' ? 'reps' : row.columns.valueLabel === 'TIME' ? 'time' : row.columns.valueLabel === 'TIME · DIST' ? 'time and distance' : 'distance'} here` }],
  );
  const longPress = () => {
    onPress('row');
  };

  if (ax || skipped) {
    // AX1+ block rows and skipped rows: one element; the cells are VoiceOver actions.
    return (
      <Pressable
        accessibilityRole={skipped ? 'text' : 'button'}
        accessibilityLabel={row.accessibilityLabel}
        accessibilityHint={skipped ? undefined : 'Edit this set'}
        accessibilityActions={skipped ? [] : rowActions}
        onAccessibilityAction={(e) => {
          const a = e.nativeEvent.actionName;
          onPress(a === 'select' ? 'marker' : a === 'load' ? 'load' : a === 'value' ? 'value' : 'row');
        }}
        disabled={skipped}
        onPress={() => {
          onPress('row');
        }}
        style={({ pressed }) => ({
          minHeight: theme.target.workout.height,
          borderTopWidth: theme.dividerWidth,
          borderTopColor: theme.colors['border.divider'],
          backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
          justifyContent: 'center',
          paddingVertical: theme.space['1'],
        })}
      >
        {ax ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['3'], paddingVertical: theme.space['2'] }}>
            <View style={{ paddingTop: 2 }}>{marker}</View>
            <View style={{ flex: 1, gap: theme.space['1'] }}>
              <AppText variant="headline" color={done ? 'text.primary' : 'text.secondary'}>
                {`${row.badges.length > 0 ? `${row.badges.join(' ')} · ` : ''}${row.blockTitle}`}
              </AppText>
              <AppText variant="body" color={valueColor} numeric>
                {plainSpaces(row.blockValue)}
              </AppText>
              {tag}
              {second.map((x) => (
                <AppText key={x} variant="callout" color="text.secondary">
                  {x}
                </AppText>
              ))}
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 52, paddingLeft: theme.space['1'] }}>
              <AppText variant="headline" color="text.secondary" numeric>
                {setLabel}
              </AppText>
            </View>
            <AppText variant="callout" color="text.tertiary" style={{ flex: 1 }}>
              {row.cells.value}
            </AppText>
            <View style={{ width: 52, alignItems: 'center', justifyContent: 'center' }}>{marker}</View>
          </View>
        )}
      </Pressable>
    );
  }

  const cell = (part: 'load' | 'value', text: string, a11y: string, extra: ReactNode) => {
    const on = editing !== null && (part === 'load' ? editing === 'load' : editing !== 'load');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${a11y}, set ${setLabel}`}
        accessibilityHint={on ? 'Closes the editor' : done ? 'Corrects it here' : 'Edits it here'}
        accessibilityState={{ expanded: on }}
        onPress={() => {
          onPress(part);
        }}
        onLongPress={longPress}
        style={({ pressed }) => ({ flex: 1, minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <View style={on ? { paddingHorizontal: theme.space['1'], marginLeft: -theme.space['1'], borderRadius: theme.radius.sm, borderWidth: 2, borderColor: theme.colors['border.control'] } : undefined}>
          <AppText variant="rowValue" color={valueColor} numeric style={valueStyle} numberOfLines={1}>
            {text}
          </AppText>
        </View>
        {extra}
      </Pressable>
    );
  };

  return (
    <View style={{ minHeight: theme.target.workout.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], justifyContent: 'center', paddingVertical: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={row.accessibilityLabel}
          accessibilityHint="Edit this set"
          accessibilityActions={rowActions}
          onAccessibilityAction={(e) => {
            const a = e.nativeEvent.actionName;
            onPress(a === 'select' ? 'marker' : a === 'load' ? 'load' : a === 'value' ? 'value' : 'row');
          }}
          onPress={() => {
            onPress('row');
          }}
          onLongPress={longPress}
          style={({ pressed }) => ({ width: 52, minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: theme.space['1'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          {/* A superset member's tag, then its badges as bordered badges (design pass nit), never `A1W` text. */}
          {row.badges.length === 0 || row.memberTag !== null ? (
            <AppText variant="headline" color="text.secondary" numeric>
              {setLabel}
            </AppText>
          ) : null}
          {row.badges.map((b) => (
            <View key={b} style={{ minWidth: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.colors['border.control'], alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={1.4}>
                {b}
              </AppText>
            </View>
          ))}
        </Pressable>
        {/* Each row's own columns (review B2): a mixed superset's loaded member keeps its load cell. */}
        {row.columns.loadLabel !== null ? cell('load', row.cells.load ?? '—', loadCellA11y(row.columns.loadLabel, row.cells.load), null) : null}
        {cell(
          'value',
          plainSpaces(row.cells.value),
          valueCellA11y(row.columns.valueLabel, row.cells.value),
          <>
            {row.effort !== null && !done ? (
              <AppText variant="callout" color="text.secondary" numeric style={{ marginLeft: theme.space['2'] }}>
                {plainSpaces(row.effort)}
              </AppText>
            ) : null}
            {row.pace !== null && !done ? (
              <AppText variant="callout" color="text.secondary" numeric style={{ marginLeft: theme.space['2'] }} accessibilityLabel={`Pace ${plainSpaces(row.pace)}`}>
                {plainSpaces(row.pace)}
              </AppText>
            ) : null}
            {tag}
          </>,
        )}
        <View style={{ width: 52, alignItems: 'center', justifyContent: 'center' }}>{marker}</View>
      </View>
      {second.length > 0 ? (
        <AppText variant="callout" color="text.secondary" style={{ paddingLeft: 52, paddingBottom: theme.space['1'] }}>
          {second.join(' · ')}
        </AppText>
      ) : null}
    </View>
  );
}

/** `FoldedExercise` (§9.77): one 52 pt line for a finished exercise; tap expands it in place. */
export function FoldedExercise({ name, summary, skipped, accessibilityLabel, ax, onPress }: { name: string; summary: string | null; skipped: boolean; accessibilityLabel: string; ax: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.target.workout.height,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors['bg.raised'] : theme.colors['bg.surface'],
        paddingHorizontal: theme.space['3'],
        paddingVertical: theme.space['2'],
        flexDirection: ax ? 'column' : 'row',
        alignItems: ax ? 'flex-start' : 'center',
        gap: theme.space['2'],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], flexShrink: 1 }}>
        <Icon name={skipped ? 'slash.circle' : 'checkmark.circle.fill'} color={skipped ? 'text.tertiary' : 'status.done'} size={24} />
        <AppText variant="headline" numberOfLines={ax ? 3 : 1} style={{ flexShrink: 1 }}>
          {skipped ? `${name} · Skipped` : name}
        </AppText>
      </View>
      {summary !== null ? (
        <AppText variant="callout" color="text.secondary" numeric numberOfLines={ax ? 3 : 1} ellipsizeMode="middle" style={ax ? undefined : { flex: 1, textAlign: 'right' }}>
          {plainSpaces(summary)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The open row

export interface OpenSetRowProps {
  focus: FocusView;
  resting: boolean;
  ax: boolean;
  keypadOpen: boolean;
  /** `Copied from 1 Oct`, `Unsaved edit restored`, or null. */
  caption: string | null;
  /** A timed set before Start: its ✓ logs without the timer. */
  timedLogLabel: string | null;
  /** Cardio's small timer button (review S6): `Stop` while the pill logs the time so far, `Resume` after Stop; null otherwise. */
  workAction?: { label: string; onPress: () => void } | null;
  /** The cell being edited in place, or null (18 Oct: the table stays a table). */
  editing: TileId | null;
  /** ✓ is live: the set has every value Log needs. */
  canLog: boolean;
  whyOpen: boolean;
  whyPanel: ReactNode;
  loadRef: Ref<TextInput>;
  repsRef: Ref<TextInput>;
  timeRef: Ref<TextInput>;
  distanceRef: Ref<TextInput>;
  /** The set-number cell (VoiceOver focus after a Log). */
  headerRef?: Ref<View>;
  onEditCell: (cell: TileId | null) => void;
  onLog: () => void;
  /** `⋯` / long-press: copy last, the full set editor, Focus. */
  onMore: () => void;
  onLoad: (v: number | null) => void;
  onReps: (v: number | null) => void;
  onTime: (v: number | null) => void;
  onDistance: (v: number | null) => void;
  onSide: (s: SetSide) => void;
  onWhy: () => void;
  onRestAfter: () => void;
  onPainFlag: () => void;
  onOffProfile: () => void;
  /** (ADR 0029; review S4) `Add 22 kg dumbbells here?`, offered once per idea, as on the Focus card; null when none. */
  gymLearnText?: string | null;
  onGymLearn?: (yes: boolean) => void;
  /** A cell's field took focus (the keypad is opening on it): the Table anchors that editor (WT39, review r2 B1). */
  onTileFocus: (tile: TileId) => void;
}

/** The open row's table row (its columns and target RPE cell), from the Table, so its cells line up with the header. */
const OpenRowContext = createContext<Pick<TableRow, 'columns' | 'effort' | 'memberTag'> | null>(null);

/**
 * `OpenSetRow` (18 Oct, Ben: "the table stays a table"): the current set is
 * one highlighted table row, set · load · value · ✓, like every other row.
 * A tap on a value cell edits it in place under the row (− value +, the
 * steps from `buildActiveSetView`); ✓ logs it on the one Log path. One short
 * line under it: target, plates, rest, `Why?`. Everything else (copy last,
 * the full set editor, Focus) is behind `⋯` or a long-press.
 */
export function OpenSetRow(p: OpenSetRowProps) {
  const theme = useTheme();
  const f = p.focus;
  const tableRow = useContext(OpenRowContext);
  const columns = tableRow?.columns ?? null;
  const { width: windowWidth } = useWindowDimensions();
  const step = p.ax ? 60 : theme.target.workout.height;
  const working = f.workTimer !== null && (f.workTimer.state === 'running' || f.workTimer.state === 'paused');
  // Cardio (19 Oct): the timer counts up in the cell (time so far · distance), and the distance stays editable while it runs.
  const cardio = f.measurement === 'cardio';
  // Where the editor is, relative to the open row's own top, so the keypad anchor knows where it ends.
  const report = useContext(TileLayoutContext);
  const rowY = useRef(0);
  const editorY = useRef(0);
  const box = useRef<{ id: TileId; layout: Layout } | null>(null);
  const keypadOpen = useRef(p.keypadOpen);
  keypadOpen.current = p.keypadOpen;
  const send = () => {
    if (report === null) return;
    const boxes = new Map<TileId, Layout>();
    const b = box.current;
    if (b !== null && b.id === p.editing) boxes.set(b.id, { y: rowY.current + editorY.current + b.layout.y, h: b.layout.h });
    report({ setId: f.setId, keypadOpen: keypadOpen.current, boxes });
  };
  const latestSend = useRef(send);
  latestSend.current = send;
  // Nothing above the editor changes with the keypad: no layout event follows, so re-send under the new state.
  useEffect(() => {
    latestSend.current();
  }, [p.keypadOpen]);
  const tileLayout = (id: TileId) => (e: LayoutChangeEvent) => {
    box.current = { id, layout: { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height } };
    send();
  };
  const tileFocus = (id: TileId) => () => {
    p.onTileFocus(id);
  };

  const badges = f.rows.find((r) => r.setId === f.setId)?.badges ?? [];
  const sideTag = f.side?.kind === 'fixed' ? (f.side.value === 'left' ? 'L' : 'R') : null;
  const memberTag = tableRow?.memberTag ?? null;
  const hasLoadColumn = columns !== null ? columns.loadLabel !== null : f.cells.load !== null;
  const valueField: TileId | null = f.reps ? 'reps' : f.duration ? 'time' : f.distance ? 'distance' : null;
  const valueText = working && !cardio ? workTimerText(f.workTimer?.remainingMs ?? null) : plainSpaces(f.cells.value);

  const cell = (id: TileId | null, text: string, a11y: string, flex: number) => {
    const on = id !== null && p.editing === id;
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
        onLongPress={p.onMore}
        style={({ pressed }) => ({ flex, minHeight: theme.target.workout.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <View style={{ alignSelf: 'flex-start', minWidth: 56, paddingHorizontal: theme.space['2'], paddingVertical: theme.space['1'], borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'], borderWidth: on ? 2 : 0, borderColor: theme.colors['border.control'] }}>
          <AppText variant="rowValue" numeric style={{ fontWeight: '600' }}>
            {text}
          </AppText>
        </View>
      </Pressable>
    );
  };

  const loadA11y = loadCellA11y(columns?.loadLabel ?? null, f.cells.load);
  const valueA11y = valueField === 'time' && working && !cardio ? `Time ${valueText}` : valueCellA11y(columns?.valueLabel ?? (valueField === 'time' ? 'TIME' : valueField === 'distance' ? 'DIST' : 'REPS'), f.cells.value);
  let editor: ReactNode = null;
  // 1.3: a cardio set's time and distance stay together in one tile row (compact or stacked, never clipped).
  let stackDone = false;
  if (cardio && (p.editing === 'time' || p.editing === 'distance') && f.duration && f.distance) {
    stackDone = true;
    const distance = f.distance;
    const duration = f.duration;
    editor = working ? (
      <NumberStepper key="dist" variant="inline" inputRef={p.distanceRef} autoFocus={p.keypadOpen} onFocus={tileFocus('distance')} onLayout={tileLayout('distance')} flex={null} stepSize={step} label="DIST M" unit={null} value={distance.value} decimals down={distance.down} up={distance.up} onChange={p.onDistance} />
    ) : (
      <StepperTileRow tiles={cardioPairTiles({ timeText: duration.value === null ? '—' : CARDIO_TIME_FORMAT.show(duration.value), distance })} estimate={openRowWidth(windowWidth)} step={step} gap={theme.space['2']}>
        {({ numeralSize, compact, flexOf }) => (
          <>
            <NumberStepper key="time" inputRef={p.timeRef} onFocus={tileFocus('time')} onLayout={tileLayout('time')} flex={flexOf(1)} stepSize={step} numeralSize={numeralSize} compact={compact} label="TIME" unit={null} decimals={false} time value={duration.value} down={duration.down} up={duration.up} onChange={p.onTime} />
            <NumberStepper key="dist" inputRef={p.distanceRef} onFocus={tileFocus('distance')} onLayout={tileLayout('distance')} flex={flexOf(1)} stepSize={step} numeralSize={numeralSize} compact={compact} label="DIST M" unit={null} value={distance.value} decimals down={distance.down} up={distance.up} onChange={p.onDistance} />
          </>
        )}
      </StepperTileRow>
    );
  } else if (p.editing === 'load' && f.loadField) {
    editor = <NumberStepper key="load" variant="inline" inputRef={p.loadRef} autoFocus={p.keypadOpen} onFocus={tileFocus('load')} onLayout={tileLayout('load')} flex={1} stepSize={step} label={`${f.loadField.label} ${f.loadField.unitText}`} unit={null} value={f.loadField.value} decimals down={f.loadField.down} up={f.loadField.up} warning={f.offProfileWarning !== null} hint={f.loadField.assisted ? 'More assistance is easier' : null} onChange={p.onLoad} />;
  } else if (p.editing === 'reps' && f.reps) {
    editor = <NumberStepper key="reps" variant="inline" inputRef={p.repsRef} autoFocus={p.keypadOpen} onFocus={tileFocus('reps')} onLayout={tileLayout('reps')} flex={1} stepSize={step} label="Reps" unit={null} value={f.reps.value} decimals={false} down={f.reps.down} up={f.reps.up} onChange={p.onReps} />;
  } else if (p.editing === 'time' && f.duration && !working) {
    editor = <NumberStepper key="time" variant="inline" inputRef={p.timeRef} autoFocus={p.keypadOpen} onFocus={tileFocus('time')} onLayout={tileLayout('time')} flex={1} stepSize={step} label="Time" unit="s" value={f.duration.value} decimals={false} down={f.duration.down} up={f.duration.up} onChange={p.onTime} />;
  } else if (p.editing === 'distance' && f.distance) {
    editor = <NumberStepper key="dist" variant="inline" inputRef={p.distanceRef} autoFocus={p.keypadOpen} onFocus={tileFocus('distance')} onLayout={tileLayout('distance')} flex={1} stepSize={step} label="Distance, metres" unit={null} value={f.distance.value} decimals down={f.distance.down} up={f.distance.up} onChange={p.onDistance} />;
  }

  const target = targetLineText(f.targetBrief, f.targetEstimate);
  // 1.5: no 44 pt minimum on the line itself; padding and hitSlop make each link a 44 pt target.
  const link = (text: string, a11y: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} style={({ pressed }) => ({ paddingVertical: theme.space['1'], justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
      <AppText variant="callout" color="text.secondary" numeric numberOfLines={1}>
        {text}
      </AppText>
    </Pressable>
  );
  // The target, what the plan was, and the pace share one shrinking text; the links keep their size.
  const lead = [target, f.planWas, f.pace].filter((x): x is string => x !== null).map(plainSpaces);
  const leadA11y = [target !== null ? `Target ${targetLineLabel(f.targetBrief, f.targetEstimate) ?? ''}` : null, f.planWas !== null ? plainSpaces(f.planWas) : null, f.pace !== null ? `Pace ${plainSpaces(f.pace)}` : null].filter((x): x is string => x !== null).join(', ');
  const plates = f.plateLine !== null && p.editing === 'load' ? (
    <AppText variant="callout" color="text.tertiary" numeric accessibilityLabel={`Plates: ${f.plateLine}`} style={{ paddingLeft: theme.space['2'], paddingBottom: theme.space['1'] }}>
      {plainSpaces(f.plateLine)}
    </AppText>
  ) : null;

  return (
    <View
      onLayout={(e) => {
        rowY.current = e.nativeEvent.layout.y;
        send();
      }}
      style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, marginHorizontal: -theme.space['1'], paddingLeft: theme.space['1'] + 3, paddingRight: theme.space['1'], paddingBottom: theme.space['1'] }}
    >
      <View style={{ position: 'absolute', left: 0, top: theme.space['2'], bottom: theme.space['2'], width: 3, borderRadius: 2, backgroundColor: theme.colors.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: theme.target.workout.height }}>
        <Pressable
          ref={p.headerRef}
          accessibilityRole="button"
          accessibilityLabel={`${f.exerciseName}, ${memberTag !== null ? `${memberTag}, ` : ''}set ${String(f.setNumber)}, ${f.setTypeLabel}${sideTag === 'L' ? ', left side' : sideTag === 'R' ? ', right side' : ''}, ${p.resting ? 'next' : 'current'}`}
          accessibilityHint="More for this set"
          onPress={p.onMore}
          onLongPress={p.onMore}
          style={{ width: 49, minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          {/* 1.6: a superset member reads `A2` (its badges after it); a plain set's badge stands for its number. */}
          {badges.length === 0 || memberTag !== null ? (
            <AppText variant="headline" color="accent" numeric>
              {openRowLabel({ memberTag, setNumber: f.setNumber, sideTag })}
            </AppText>
          ) : null}
          {badges.map((b) => (
            <View key={b} style={{ minWidth: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <AppText variant="label" color="accent" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={1.4}>
                {b}
              </AppText>
            </View>
          ))}
        </Pressable>
        {hasLoadColumn ? cell(f.loadField ? 'load' : null, f.cells.load ?? '—', loadA11y, 1) : null}
        {cell(working && !cardio ? null : valueField, valueText, valueA11y, 1)}
        {tableRow?.effort != null ? (
          <AppText variant="callout" color="text.secondary" numeric style={{ marginRight: theme.space['1'] }} accessibilityLabel={`Target RPE ${plainSpaces(tableRow.effort).replace(/^@\s*/, '')}`}>
            {plainSpaces(tableRow.effort)}
          </AppText>
        ) : null}
        {f.adjustedBy !== null ? (
          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: theme.colors['bg.surface'], marginRight: theme.space['1'] }}>
            <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={2}>
              {f.adjustedBy === 'coach' ? 'Coach' : 'Rule'}
            </AppText>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Set ${String(f.setNumber)}, ${plainSpaces(p.timedLogLabel ?? f.logLabel ?? 'Log')}`}
          accessibilityState={{ disabled: !p.canLog }}
          disabled={!p.canLog}
          onPress={p.onLog}
          hitSlop={8}
          style={({ pressed }) => ({ width: 52, minHeight: theme.target.workout.height, alignItems: 'center', justifyContent: 'center', opacity: !p.canLog ? 0.4 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkmark" color="accent" size={16} />
          </View>
        </Pressable>
      </View>
      {editor !== null ? (
        <View
          onLayout={(e) => {
            editorY.current = e.nativeEvent.layout.y;
            send();
          }}
        >
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
          {plates}
        </View>
      ) : null}
      {/* 1.5: one line under the row: target · Rest › · Why? (the set number already opens More). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: theme.space['3'], minHeight: theme.target.min.height, paddingLeft: 48 }}>
        <AppText variant="callout" color="text.secondary" numeric numberOfLines={1} style={{ flexShrink: 1, flexGrow: 1 }} {...(leadA11y !== '' ? { accessibilityLabel: leadA11y } : {})}>
          {lead.join(' · ')}
        </AppText>
        {p.workAction ? link(p.workAction.label, `${p.workAction.label} the timer`, p.workAction.onPress) : null}
        {link(`Rest ${formatDuration(f.restAfterS)} ›`, `Rest after this set: ${formatDuration(f.restAfterS)}. Changes it.`, p.onRestAfter)}
        {f.hasExplanation ? <TargetWhyLink slim open={p.whyOpen} onPress={p.onWhy} /> : null}
      </View>
      {p.whyOpen ? p.whyPanel : null}
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
        <AppText variant="callout" color="text.secondary" style={{ paddingLeft: 48 }}>
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
 * A done row's KG or REPS edited in its row (18 Oct): the same `− value +`
 * line as the open row (1.2), with the steps from `buildSetEditView`. It
 * opens with its field focused, so a correction is typed at once. Nothing is
 * written per step; Done (or a tap elsewhere) sends one `correctSet` (rule 2).
 */
export function CorrectionEditor(p: CorrectionEditorProps) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const step = p.ax ? 60 : theme.target.workout.height;
  const focusOf = (field: CellField) => () => {
    p.onFocusField?.(field);
  };
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
    editor = <NumberStepper key="load" variant="inline" autoFocus onFocus={focusOf('load')} flex={1} stepSize={step} label={`${p.loadField.label} ${p.loadField.unitText}`} unit={null} value={p.loadField.value} decimals down={p.loadField.down} up={p.loadField.up} hint={p.loadField.assisted ? 'More assistance is easier' : null} onChange={p.onLoad} />;
  } else if (p.field === 'reps' && p.reps) {
    editor = <NumberStepper key="reps" variant="inline" autoFocus onFocus={focusOf('reps')} flex={1} stepSize={step} label="Reps" unit={null} value={p.reps.value} decimals={false} down={p.reps.down} up={p.reps.up} onChange={p.onReps} />;
  } else if (p.field === 'time' && p.duration) {
    editor = <NumberStepper key="time" variant="inline" autoFocus onFocus={focusOf('time')} flex={1} stepSize={step} label="Time" unit="s" value={p.duration.value} decimals={false} down={p.duration.down} up={p.duration.up} onChange={p.onTime} />;
  } else if (p.field === 'distance' && p.distance) {
    editor = <NumberStepper key="dist" variant="inline" autoFocus onFocus={focusOf('distance')} flex={1} stepSize={step} label="Distance, metres" unit={null} value={p.distance.value} decimals down={p.distance.down} up={p.distance.up} onChange={p.onDistance} />;
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
// Chips, rest bar, Chat

/** `DoneChip` (§9.78): `↑ 7 done` in the top bar's title slot. */
export function DoneChip({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${String(count)} ${count === 1 ? 'set' : 'sets'} done above. Shows them.`}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ minHeight: theme.target.workout.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], height: 36, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, backgroundColor: theme.colors['bg.raised'], borderWidth: 1, borderColor: theme.colors['border.control'] }}>
        <Icon name="arrow.up" color="text.primary" size={14} />
        <AppText variant="label" numeric>{`${String(count)} done`}</AppText>
      </View>
    </Pressable>
  );
}

/** `NowChip` (§9.79): `Now ↓` / `Now ↑` while the open row is off-screen. */
export function NowChip({ direction, onPress }: { direction: 'below' | 'above'; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', paddingHorizontal: theme.space['4'], paddingBottom: theme.space['1'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Current set, ${direction}. Scrolls to it.`}
        onPress={onPress}
        style={({ pressed }) => ({ minHeight: theme.target.workout.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], height: 36, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, backgroundColor: theme.colors['bg.raised'], borderWidth: 1, borderColor: theme.colors['border.control'] }}>
          <AppText variant="label">Now</AppText>
          <Icon name={direction === 'below' ? 'arrow.down' : 'arrow.up'} color="text.primary" size={14} />
        </View>
      </Pressable>
    </View>
  );
}

/**
 * `RestBar` (§9.80): `REST 2:09` from the stored deadline, `−30` `+30`
 * `Skip`, and a 3 pt drain drawn at its current length each second (never
 * animated between seconds). Ended: `Ready · rested 3:12`; paused: frozen.
 */
export function RestBar({ rest, onAdjust, onSkip, onOpen }: { rest: RestView; onAdjust: (deltaS: number) => void; onSkip: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const narrow = useWindowDimensions().width < 390;
  const paused = rest.kind === 'paused';
  const ended = rest.kind === 'ended';
  const rested = rest.kind === 'ended' && !rest.skipped ? formatDuration(rest.restedMs / 1000) : null;
  const remainingS = rest.kind === 'ended' ? 0 : Math.ceil(rest.remainingMs / 1000);
  const fraction = rest.kind === 'running' && rest.durationS > 0 ? Math.max(0, Math.min(1, rest.remainingMs / (rest.durationS * 1000))) : 0;
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
      style={({ pressed }) => ({ minHeight: theme.target.workout.height, minWidth: theme.target.workout.width, justifyContent: 'center', alignItems: 'center', opacity: paused ? 0.4 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <View style={{ height: 36, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="label" numeric>
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
          style={({ pressed }) => ({ flex: 1, minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          {ended ? (
            <>
              <Icon name="checkmark.circle.fill" color="status.done" size={18} />
              <AppText variant="headline" numeric numberOfLines={1} style={{ flexShrink: 1 }}>
                {rested !== null ? `Ready · rested ${rested}` : 'Ready'}
              </AppText>
            </>
          ) : (
            <>
              {paused ? <Icon name="pause.circle.fill" color="status.warning" size={16} /> : null}
              {/* Below 390 pt wide the eyebrow drops (the countdown and pills need the room); paused keeps its word. */}
              {!narrow || paused ? (
                <AppText variant="label" color={paused ? 'status.warning' : 'text.tertiary'} numberOfLines={1}>
                  {paused ? (narrow ? 'PAUSED' : 'REST · PAUSED') : 'REST'}
                </AppText>
              ) : null}
              <AppText variant="headline" numeric color={paused ? 'text.tertiary' : 'text.primary'} style={{ fontSize: 26, lineHeight: 32 }} maxFontSizeMultiplier={1.6}>
                {formatDuration(remainingS)}
              </AppText>
            </>
          )}
        </Pressable>
        {!ended ? pill('−30', 'Rest 30 seconds shorter', () => { onAdjust(-30); }) : null}
        {!ended ? pill('+30', 'Rest 30 seconds longer', () => { onAdjust(30); }) : null}
        {!ended ? pill('Skip', 'Skip rest', onSkip) : null}
      </View>
      {rest.kind === 'running' ? <View style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.round(fraction * 1000) / 10}%`, backgroundColor: theme.colors.accent }} /> : null}
    </View>
  );
}

/** `Chat` (60 × 60 round, design-system §9.1) until voice ships: opens the coach sheet. At AX1+ the word drops. */
export function ChatButton({ ax, onPress }: { ax: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Chat"
      onPress={onPress}
      style={({ pressed }) => ({ width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent', alignItems: 'center', justifyContent: 'center' })}
    >
      <Icon name="text.bubble" color="text.primary" size={22} />
      {!ax ? (
        <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }}>
          Chat
        </AppText>
      ) : null}
    </Pressable>
  );
}
