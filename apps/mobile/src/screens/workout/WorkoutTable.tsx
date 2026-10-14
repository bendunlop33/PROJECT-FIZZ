import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextInput } from 'react-native';

import { formatDuration, NBSP, type FocusView, type RestView, type SupersetCard, type TableBlock, type TableCard, type TableColumns, type TableRow, type WorkoutTableView } from '@fizz/domain';
import type { SetSide } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Icon, LinkLine, NumberStepper, StatusLine, TextButton, TEXT_PRESSED_OPACITY, TimerNumeral, type SymbolName } from '../../ui';
import { anchorTargetY, bottomSpacerHeight, chipsFor, keypadMovesTiles, keypadTileY, runRowTap, showsFolded, tileReportFor, type AnchorRequest, type ChipState, type Expansions, type TileId, type TileReport } from '../../workout/table';
import { workTimerText } from '../../workout/cues';
import { WORKOUT_KEYBOARD } from '../../workout/keyboard';
import { openRowWidth, stepperTexts, tileFit, type TileSpec } from '../../workout/tile-fit';
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
  onAnchorApplied: () => void;
  onUserScroll: () => void;
  onChips: (c: ChipState) => void;
  onEditSet: (setId: string) => void;
  /** `onScreen`: the row was visible when tapped (no scroll follows). */
  onSelectSet: (setId: string) => void;
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
                {props.openRow}
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
                  onPress={() => {
                    runRowTap(row, {
                      dismissKeyboard: () => { Keyboard.dismiss(); },
                      edit: props.onEditSet,
                      select: (setId) => {
                        haptic('step');
                        props.onSelectSet(setId);
                      },
                    });
                  }}
                />
              </View>,
            );
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
    <View key="footer" style={{ paddingTop: theme.space['3'], gap: theme.space['3'] }}>
      {props.footer}
    </View>,
  );
  children.push(
    <View
      key="spacer"
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
        onScrollBeginDrag={props.onUserScroll}
        {...WORKOUT_KEYBOARD}
        contentContainerStyle={{ paddingHorizontal: theme.space['4'], paddingBottom: theme.space['3'] }}
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
 * per cell. Done: bright, filled green tick. Pending: dim, open ring (a tap
 * anywhere selects it, never logs). Skipped: `Skipped` with a slashed circle.
 */
export function TableSetRow({ row, ax, onPress }: { row: TableRow; ax: boolean; onPress: () => void }) {
  const theme = useTheme();
  const done = row.state === 'done';
  const skipped = row.state === 'skipped';
  const valueColor = done ? 'text.primary' : 'text.tertiary';
  const valueStyle = done ? { fontWeight: '500' as const } : undefined;
  const setLabel = row.memberTag ?? String(row.number);
  const second = done ? [row.notCounted, row.note, row.gymCaption, row.edited ? 'Edited' : null].filter((x): x is string => x !== null) : [];
  const marker = done ? (
    <Icon name="checkmark.circle.fill" color="status.done" size={26} />
  ) : skipped ? (
    <Icon name="slash.circle" color="text.tertiary" size={24} />
  ) : (
    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: theme.colors['border.control'] }} />
  );
  const tag = row.todayChange === null ? null : (
    <View style={{ marginLeft: theme.space['1'], paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: theme.colors['bg.raised'] }}>
      <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={2}>
        {row.todayChange === 'coach' ? 'Coach' : 'Rule'}
      </AppText>
    </View>
  );
  return (
    <Pressable
      accessibilityRole={skipped ? 'text' : 'button'}
      accessibilityLabel={row.accessibilityLabel}
      accessibilityHint={done ? 'Edit this set' : skipped ? undefined : 'Makes this the current set'}
      accessibilityActions={done ? [{ name: 'activate' }, { name: 'edit', label: 'Edit' }] : skipped ? [] : [{ name: 'activate' }, { name: 'select', label: 'Select' }]}
      onAccessibilityAction={() => {
        onPress();
      }}
      disabled={skipped}
      onPress={onPress}
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
            {second.map((s) => (
              <AppText key={s} variant="callout" color="text.secondary">
                {s}
              </AppText>
            ))}
          </View>
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 52, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: theme.space['1'] }}>
              {row.badges.length > 0 && row.memberTag === null ? (
                row.badges.map((b) => (
                  <View key={b} style={{ minWidth: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.colors['border.control'], alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                    <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={1.4}>
                      {b}
                    </AppText>
                  </View>
                ))
              ) : (
                <AppText variant="headline" color="text.secondary" numeric>
                  {`${setLabel}${row.memberTag !== null && row.badges.length > 0 ? row.badges.join('') : ''}`}
                </AppText>
              )}
            </View>
            {skipped ? (
              <AppText variant="callout" color="text.tertiary" style={{ flex: 1 }}>
                {row.cells.value}
              </AppText>
            ) : (
              <>
                {/* Each row's own columns (review B2): a mixed superset's loaded member keeps its load cell. */}
                {row.columns.loadLabel !== null ? (
                  <View style={{ flex: 1 }}>
                    <AppText variant="rowValue" color={valueColor} numeric style={valueStyle}>
                      {row.cells.load ?? '—'}
                    </AppText>
                  </View>
                ) : null}
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <AppText variant="rowValue" color={valueColor} numeric style={valueStyle}>
                    {plainSpaces(row.cells.value)}
                  </AppText>
                  {row.effort !== null ? (
                    <AppText variant="callout" color="text.secondary" numeric style={{ marginLeft: theme.space['2'] }}>
                      {plainSpaces(row.effort)}
                    </AppText>
                  ) : null}
                  {tag}
                </View>
              </>
            )}
            <View style={{ width: 52, alignItems: 'center', justifyContent: 'center' }}>{marker}</View>
          </View>
          {second.length > 0 ? (
            <AppText variant="callout" color="text.secondary" style={{ paddingLeft: 52, paddingBottom: theme.space['1'] }}>
              {second.join(' · ')}
            </AppText>
          ) : null}
        </View>
      )}
    </Pressable>
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
  /** `Last 1 Oct` caption pieces: `Copied from 1 Oct`, `Unsaved edit restored`, or null. */
  caption: string | null;
  /** A timed set before Start: `Log 0:45` (logs without the timer). */
  timedLogLabel: string | null;
  whyOpen: boolean;
  whyPanel: ReactNode;
  loadRef: Ref<TextInput>;
  repsRef: Ref<TextInput>;
  timeRef: Ref<TextInput>;
  distanceRef: Ref<TextInput>;
  /** The `Set 2 · NOW` header (VoiceOver focus after a Log). */
  headerRef?: Ref<View>;
  onCopyLast: () => void;
  onLoad: (v: number | null) => void;
  onReps: (v: number | null) => void;
  onTime: (v: number | null) => void;
  onDistance: (v: number | null) => void;
  onSide: (s: SetSide) => void;
  onWhy: () => void;
  onRestAfter: () => void;
  onPainFlag: () => void;
  onOffProfile: () => void;
  onTimedLog: () => void;
  /** A tile's field took focus (the keypad is opening on it): the Table anchors that tile (WT39, review r2 B1). */
  onTileFocus: (tile: TileId) => void;
}

/**
 * `OpenSetRow` (§9.75): the Focus card's set, inline. Values are the
 * `FocusView` from `buildActiveSetView`, so Table and Focus can't disagree.
 * No tick or ring: Log is its only save (WT11).
 */
export function OpenSetRow(p: OpenSetRowProps) {
  const theme = useTheme();
  const f = p.focus;
  const step = p.ax ? 60 : theme.target.workout.height;
  const working = f.workTimer !== null && (f.workTimer.state === 'running' || f.workTimer.state === 'paused');
  // WT-D13 / WT40: numerals shrink to fit (≥ 28 pt), else the tiles stack; never clipped. Measured width, window estimate first.
  const window = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  const specs: TileSpec[] = [];
  if (f.loadField) specs.push({ flex: 1.35, texts: stepperTexts(f.loadField.value, f.loadField.down, f.loadField.up, 3), unit: null });
  if (working) specs.push({ flex: 1, texts: ['0:00'], unit: null });
  else if (f.duration) specs.push({ flex: 1, texts: stepperTexts(f.duration.value, f.duration.down, f.duration.up, 2), unit: 's' });
  if (f.distance) specs.push({ flex: 1, texts: stepperTexts(f.distance.value, f.distance.down, f.distance.up, 2), unit: null });
  if (f.reps) specs.push({ flex: 1, texts: stepperTexts(f.reps.value, f.reps.down, f.reps.up, 2), unit: null });
  const fit = tileFit({ rowWidth: measured ?? openRowWidth(window.width), tiles: specs, stepSize: step, fontScale: window.fontScale, ax: p.ax });
  // F11: LOAD and REPS on one row, − / + under each numeral (D tiles); the bordered theme stacks as before.
  const compact = fit.compact && theme.components.cardBorderWidth === 0;
  const stacked = fit.stacked || (fit.compact && !compact);
  const flexOf = (n: number): number | null => (stacked ? null : n);
  // Where each tile is, relative to the open row's own top (its wrapper in the list): row → tile container → tile.
  const report = useContext(TileLayoutContext);
  const rowY = useRef(0);
  const containerY = useRef(0);
  const tileLayouts = useRef(new Map<TileId, Layout>());
  // Each report carries the keypad state it was measured under; the Table ignores one from the other state (review r3 S1).
  const keypadOpen = useRef(p.keypadOpen);
  keypadOpen.current = p.keypadOpen;
  const sentUnder = useRef<boolean | null>(null);
  const send = () => {
    if (report === null) return;
    const boxes = new Map<TileId, Layout>();
    for (const [id, l] of tileLayouts.current) if (shown.has(id)) boxes.set(id, { y: rowY.current + containerY.current + l.y, h: l.h });
    sentUnder.current = keypadOpen.current;
    report({ setId: f.setId, keypadOpen: keypadOpen.current, boxes });
  };
  const latestSend = useRef(send);
  latestSend.current = send;
  const moves = keypadMovesTiles({ plateLine: f.plateLine !== null, last: f.previous !== null, ax: p.ax });
  useEffect(() => {
    if (sentUnder.current === null || sentUnder.current === p.keypadOpen) return;
    // Nothing above the tiles changes: no layout event follows, so the last positions hold for the new state.
    if (!moves) {
      latestSend.current();
      return;
    }
    // Something above them does: the next layout pass re-sends. If none comes (it didn't move after all), re-send.
    const t = setTimeout(() => {
      if (sentUnder.current !== keypadOpen.current) latestSend.current();
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [p.keypadOpen, moves]);
  const tileLayout = (id: TileId) => (e: LayoutChangeEvent) => {
    tileLayouts.current.set(id, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height });
    send();
  };
  const tileFocus = (id: TileId) => () => {
    p.onTileFocus(id);
  };
  const shown = new Set<TileId>([...(f.loadField ? ['load' as const] : []), ...(f.duration && !working ? ['time' as const] : []), ...(f.distance ? ['distance' as const] : []), ...(f.reps ? ['reps' as const] : [])]);
  const tiles: ReactNode[] = [];
  if (f.loadField) {
    tiles.push(
      <NumberStepper
        key="load"
        inputRef={p.loadRef}
        onFocus={tileFocus('load')}
        onLayout={tileLayout('load')}
        flex={flexOf(1.35)}
        stepSize={step}
        numeralSize={fit.numeralSize} compact={compact}
        label={`${f.loadField.label} ${f.loadField.unitText}`.toUpperCase()}
        unit={null}
        value={f.loadField.value}
        decimals
        down={f.loadField.down}
        up={f.loadField.up}
        warning={f.offProfileWarning !== null}
        hint={f.loadField.assisted ? 'More assistance is easier' : null}
        onChange={p.onLoad}
      />,
    );
  }
  if (working) {
    tiles.push(
      <View key="work" style={{ ...(stacked ? { alignSelf: 'stretch' as const } : { flex: 1 }), alignItems: 'flex-start', gap: theme.space['1'], padding: theme.space['3'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg }}>
        <AppText variant="label" color="text.tertiary">
          WORK
        </AppText>
        <TimerNumeral text={workTimerText(f.workTimer?.remainingMs ?? null)} accessibilityLabel={`Work time left ${workTimerText(f.workTimer?.remainingMs ?? null)}`} />
      </View>,
    );
  } else if (f.duration) {
    tiles.push(<NumberStepper key="time" inputRef={p.timeRef} onFocus={tileFocus('time')} onLayout={tileLayout('time')} flex={flexOf(1)} stepSize={step} numeralSize={fit.numeralSize} compact={compact} label="TIME" unit="s" value={f.duration.value} decimals={false} down={f.duration.down} up={f.duration.up} onChange={p.onTime} />);
  }
  if (f.distance) tiles.push(<NumberStepper key="dist" inputRef={p.distanceRef} onFocus={tileFocus('distance')} onLayout={tileLayout('distance')} flex={flexOf(1)} stepSize={step} numeralSize={fit.numeralSize} compact={compact} label="DIST M" unit={null} value={f.distance.value} decimals down={f.distance.down} up={f.distance.up} onChange={p.onDistance} />);
  if (f.reps) {
    tiles.push(
      <NumberStepper
        key="reps"
        inputRef={p.repsRef}
        onFocus={tileFocus('reps')}
        onLayout={tileLayout('reps')}
        flex={flexOf(1)}
        stepSize={step}
        numeralSize={fit.numeralSize} compact={compact}
        label="REPS"
        unit={null}
        value={f.reps.value}
        decimals={false}
        down={f.reps.down}
        up={f.reps.up}
        onChange={p.onReps}
      />,
    );
  }

  const lastText = f.previous ? plainSpaces(f.previous.text) : null;
  return (
    <View
      onLayout={(e) => {
        rowY.current = e.nativeEvent.layout.y;
        send();
      }}
      style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, marginHorizontal: -theme.space['1'], marginVertical: theme.space['1'], paddingVertical: theme.space['2'], paddingLeft: theme.space['3'] + 3, paddingRight: theme.space['3'], gap: theme.space['2'] }}
    >
      <View style={{ position: 'absolute', left: 0, top: theme.space['3'], bottom: theme.space['3'], width: 3, borderRadius: 2, backgroundColor: theme.colors.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: theme.space['2'] }}>
        <View ref={p.headerRef} accessible accessibilityRole="header" accessibilityLabel={`${f.exerciseName}, set ${String(f.setNumber)}, ${f.setTypeLabel}${f.side?.kind === 'fixed' ? (f.side.value === 'left' ? ', left side' : ', right side') : ''}, ${p.resting ? 'next' : 'current'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="headline" numeric>{`${String(f.setNumber)}${f.side?.kind === 'fixed' ? (f.side.value === 'left' ? ' L' : ' R') : ''}`}</AppText>
          <AppText variant="label" color="accent">
            {p.resting ? 'NEXT' : 'NOW'}
          </AppText>
          {/* F3: the set's type, Working too. */}
          <AppText variant="label" color="text.secondary">
            {f.setTypeLabel.toUpperCase()}
          </AppText>
        </View>
        <View style={{ flex: 1 }} />
        {lastText !== null && !p.keypadOpen && !p.ax ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Last time ${lastText}. Copies it.`} onPress={p.onCopyLast} style={({ pressed }) => ({ minHeight: theme.target.workout.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
            <AppText variant="callout" color="text.secondary" numeric>
              {'Last '}
              <AppText variant="callout" numeric style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
                {lastText}
              </AppText>
              {' ›'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {f.plateLine && !p.keypadOpen && !p.ax ? (
        <AppText variant="callout" color="text.tertiary" numeric accessibilityLabel={`Plates: ${f.plateLine}`}>
          {plainSpaces(f.plateLine)}
        </AppText>
      ) : null}
      <View
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (measured === null || Math.abs(w - measured) >= 1) setMeasured(w);
          containerY.current = e.nativeEvent.layout.y;
          send();
        }}
        style={{ flexDirection: stacked ? 'column' : 'row', gap: theme.space['2'] }}
      >
        {tiles}
      </View>
      {p.timedLogLabel !== null ? (
        <View style={{ alignItems: 'flex-start' }}>
          <TextButton label={plainSpaces(p.timedLogLabel)} onPress={p.onTimedLog} />
        </View>
      ) : null}
      {f.side ? (
        f.side.kind === 'fixed' ? (
          <AppText variant="callout">{`${f.side.value === 'left' ? 'Left' : 'Right'} side`}</AppText>
        ) : (
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
        )
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space['1'] }}>
          <AppText variant="callout" color="text.secondary" numeric>
            {plainSpaces(f.target ?? 'No target')}
          </AppText>
          {f.adjustedBy !== null ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: theme.colors['bg.surface'] }}>
              <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={2}>
                {f.adjustedBy === 'coach' ? 'Coach' : 'Rule'}
              </AppText>
            </View>
          ) : null}
        </View>
        {f.hasExplanation && !p.keypadOpen ? <TargetWhyLink open={p.whyOpen} onPress={p.onWhy} /> : null}
      </View>
      {f.planWas !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {plainSpaces(f.planWas)}
        </AppText>
      ) : null}
      {p.whyOpen && !p.keypadOpen ? p.whyPanel : null}
      <LinkLine accessibilityLabel={`Rest after this set: ${formatDuration(f.restAfterS)}. Changes it.`} onPress={p.onRestAfter}>
        <AppText variant="callout" color="text.secondary" numeric>
          {'Rest after '}
          <AppText variant="callout" numeric style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
            {formatDuration(f.restAfterS)}
          </AppText>
          {' ›'}
        </AppText>
      </LinkLine>
      {p.caption !== null ? (
        <AppText variant="callout" color="text.secondary">
          {p.caption}
        </AppText>
      ) : null}
      {f.painFlag ? (
        <NoteLink icon="exclamationmark.triangle" text={f.painFlag.text} accessibilityLabel={f.painFlag.accessibilityLabel} onPress={p.onPainFlag} />
      ) : null}
      {f.snapNote ? <SnapNote note={f.snapNote} /> : null}
      {f.offProfileWarning !== null ? (
        f.offProfileEquipment !== null ? (
          <NoteLink icon="exclamationmark.triangle" text={f.offProfileWarning} accessibilityLabel={`${f.offProfileWarning}. Opens this equipment.`} onPress={p.onOffProfile} />
        ) : (
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={f.offProfileWarning} />
        )
      ) : null}
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
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['3'], gap: theme.space['1'] }}>
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
              <AppText variant="label" color={paused ? 'status.warning' : 'text.tertiary'}>
                {paused ? 'REST · PAUSED' : 'REST'}
              </AppText>
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
        <AppText variant="label" color="text.secondary" style={{ fontSize: 13, lineHeight: 16 }} maxFontSizeMultiplier={1}>
          Chat
        </AppText>
      ) : null}
    </Pressable>
  );
}
