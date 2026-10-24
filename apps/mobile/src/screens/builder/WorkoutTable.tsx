import { ActionSheetIOS, Pressable, View } from 'react-native';

import { WORKOUT_COPY, type WorkoutRoundView, type WorkoutRowView } from '../../builder/builder-view';
import { useTheme } from '../../theme';
import { AppText } from '../../ui';
import { DragItem, DragList, useDragHandle } from '../../ui/drag-list';
import type { DropTarget } from '../../ui/drag-logic';
import { holdMenu } from '../../ui/exercise-popup-model';
import { SwipeRow } from './BuilderParts';

export type WorkoutRowAction = WorkoutRowView['actions'][number]['name'];

/**
 * Your workout's table (workout-builder-v3 §2.3), one component for the builder's Your workout and the one workout
 * editor (Ben, 23 Oct: a saved workout or plan day is edited on the same page): the column header `Exercise | Sets |
 * Top set (kg)`, numbered rounds with supersets as one box (3a/3b) and the a→b line, `MAIN`, `May hurt`, `Not at this
 * gym`; tap a row for the pop-up, swipe left to Delete, right to Swap, press and hold then drag (an edge = move, the
 * middle = superset; a hold without a drag is the row's menu), and the dashed `＋ Add exercise`. Values come from the
 * page's view; every change goes back to the page.
 */
export function WorkoutTable({
  rounds,
  topHeader,
  canAdd,
  dragging,
  onDragChange,
  canDrop,
  onDrop,
  onRowPress,
  onRowAction,
  onAdd,
}: {
  rounds: readonly WorkoutRoundView[];
  topHeader: string;
  canAdd: boolean;
  dragging: boolean;
  onDragChange: (active: boolean) => void;
  canDrop: (slotKey: string, target: DropTarget) => boolean;
  onDrop: (slotKey: string, target: DropTarget) => void;
  onRowPress: (row: WorkoutRowView) => void;
  onRowAction: (row: WorkoutRowView, action: WorkoutRowAction) => void;
  onAdd: () => void;
}) {
  const theme = useTheme();

  /** A hold released without a drag (§2.3's fallback): the row's own actions, as VoiceOver has them. */
  const rowMenu = (slotKey: string) => {
    const r = rounds.flatMap((x) => x.rows).find((x) => x.slotKey === slotKey);
    if (r === undefined) return;
    const m = holdMenu(r.actions);
    ActionSheetIOS.showActionSheetWithOptions({ title: r.name, options: m.options, cancelButtonIndex: m.cancelButtonIndex, destructiveButtonIndex: m.destructiveButtonIndex }, (i) => {
      const a = m.actionAt(i);
      if (a !== null) onRowAction(r, a);
    });
  };

  const row = (r: WorkoutRowView) => (
    <DragItem key={r.slotKey} dragKey={r.slotKey} draggable>
      <HeldSwipeRow
        onPress={() => {
          onRowPress(r);
        }}
        accessibilityLabel={r.accessibilityLabel}
        actions={r.actions}
        onAction={(name) => {
          const a = r.actions.find((x) => x.name === name);
          if (a !== undefined) onRowAction(r, a.name);
        }}
        leftAction={{ label: WORKOUT_COPY.delete, onPress: () => { onRowAction(r, 'delete'); } }}
        rightAction={{ label: WORKOUT_COPY.swap, onPress: () => { onRowAction(r, 'swap'); } }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], paddingVertical: theme.space['2'] }}>
          <View style={{ width: 28, alignItems: 'flex-start' }}>
            <AppText variant="callout" color={r.label.length > 1 ? 'text.primary' : 'text.secondary'} numeric>
              {r.label}
            </AppText>
            {r.linkedToNext ? <View style={{ position: 'absolute', left: 8, top: 24, height: 34, width: 2, borderRadius: 1, backgroundColor: theme.colors['text.tertiary'] }} /> : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="callout" numberOfLines={2}>
              {r.name}
              {r.main ? <AppText variant="label" color="text.secondary">{`  ${WORKOUT_COPY.main}`}</AppText> : null}
            </AppText>
            {r.works !== null ? (
              // Wraps (no ellipsis), like the Today strip: `Lower back, glutes, hamstrings` is never cut (Ben, 21 Oct).
              <AppText variant="label" color="text.secondary">
                {r.works}
              </AppText>
            ) : null}
            {r.mayHurt ? (
              <AppText variant="label" color="status.warning">
                {WORKOUT_COPY.mayHurt}
              </AppText>
            ) : null}
            {r.notHere ? (
              <AppText variant="label" color="status.warning">
                {WORKOUT_COPY.notHere}
              </AppText>
            ) : null}
            {r.issue != null ? (
              <AppText variant="label" color="status.warning">
                {r.issue}
              </AppText>
            ) : null}
          </View>
          <View style={{ width: 40, alignItems: 'flex-end' }}>
            <AppText variant="callout" numeric>
              {r.setsText}
            </AppText>
            {r.warmText !== null ? (
              <AppText variant="label" color="text.secondary" numeric>
                {r.warmText}
              </AppText>
            ) : null}
          </View>
          <AppText variant="callout" numeric align="right" style={{ width: 76 }}>
            {r.topText}
          </AppText>
        </View>
      </HeldSwipeRow>
    </DragItem>
  );

  return (
    <>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: theme.space['2'], paddingHorizontal: theme.space['3'] }}>
        <View style={{ width: 28 }} />
        <AppText variant="label" color="text.secondary" style={{ flex: 1 }}>
          {WORKOUT_COPY.exercise}
        </AppText>
        <AppText variant="label" color="text.secondary" align="right" style={{ width: 40 }}>
          {WORKOUT_COPY.sets}
        </AppText>
        <AppText variant="label" color="text.secondary" align="right" style={{ width: 76 }}>
          {topHeader}
        </AppText>
      </View>
      {/* Press and hold a row, then drag (§2.3, Q18): an edge = move there, the middle = superset. Built once, shared with the workout (workout-table-v3 §7). */}
      <DragList enabled allowOnto canDrop={canDrop} onDrop={onDrop} onMenu={rowMenu} onDragChange={onDragChange} style={{ gap: theme.space['3'] }}>
        {rounds.map((round) => (
          <View
            key={`${String(round.n)}:${round.rows[0]?.slotKey ?? ''}`}
            style={{ borderRadius: theme.radius.md, overflow: dragging ? 'visible' : 'hidden', backgroundColor: theme.colors['bg.surface'], borderWidth: round.superset ? 1.5 : 0, borderColor: theme.colors['text.tertiary'] }}
          >
            {round.rows.map(row)}
          </View>
        ))}
      </DragList>
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add exercise"
          onPress={onAdd}
          style={({ pressed }) => ({ minHeight: 50, borderRadius: theme.radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors['border.divider'], alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="callout">{WORKOUT_COPY.addExercise}</AppText>
        </Pressable>
      ) : null}
    </>
  );
}

/** A row's swipe and tap, with the drag's hold on its own press (`useDragHandle`, inside its `DragItem`). */
function HeldSwipeRow(p: Omit<Parameters<typeof SwipeRow>[0], 'holdProps'>) {
  const hold = useDragHandle();
  return <SwipeRow {...p} holdProps={hold} />;
}
