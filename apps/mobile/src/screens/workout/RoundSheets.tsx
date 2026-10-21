import { useRef, useState } from 'react';
import { Pressable, ScrollView, View, type PressableProps } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, BottomCard, Icon, TextButton, TEXT_PRESSED_OPACITY } from '../../ui';
import type { OverviewRowView, WhyView } from '../../workout/rounds';
import type { WhyPanel } from '../../workout/target-why';
import { TargetWhyPanel } from './TargetWhyPanel';
import { DragItem, DragList, useDragHandle } from '../../ui/drag-list';
import type { DropTarget } from '../../ui/drag-logic';

/** A row's press with the drag's hold (`useDragHandle`, inside its `DragItem`). */
function HeldPressable(props: PressableProps) {
  const hold = useDragHandle();
  return <Pressable {...props} {...hold} />;
}

/**
 * The v3 round page's two sheets (workout-table-v3.md §2, §4). Every line
 * comes from `rounds.ts` (`overviewRows`, `whyView`) and `explainTarget`;
 * nothing is worked out here.
 */

/**
 * `Workout` (§4): the builder's table, `#` · Exercise + works · `Sets` ·
 * `Top set (kg)`, `3a` / `3b` rows without a box; done rounds dimmed with ✓,
 * the shown round bright. A row tap jumps to its round; its `⋯` opens that
 * exercise's menu (Swap, Superset, Remove…; §4, review S3) once the sheet
 * has closed. `＋ Add exercise` at the end (today only). Reorder comes with
 * the drag slice.
 */
export function WorkoutRoundsSheet(p: {
  visible: boolean;
  title: string;
  rows: readonly OverviewRowView[];
  onPick: (roundIndex: number) => void;
  onMenu: (sessionExerciseId: string) => void;
  onAddExercise: () => void;
  onClose: () => void;
  onDismissed: () => void;
  /**
   * v3 §7: press and hold an exercise, then drag: an edge moves its round (only rounds not started,
   * never past one), its middle makes a superset with that exercise. A hold without a drag opens
   * the exercise's menu. Absent: off.
   */
  drag?: { draggable: (sessionExerciseId: string) => boolean; canDrop: (from: string, t: DropTarget) => boolean; onDrop: (from: string, t: DropTarget) => void };
}) {
  const theme = useTheme();
  const [dragging, setDragging] = useState(false);
  /** The sheet's scrolling list: rows scrolled out of it are no drop targets (review S2). */
  const listView = useRef<View | null>(null);
  const head = (t: string, style: object) => (
    <AppText variant="label" color="text.tertiary" style={{ fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase', ...style }} maxFontSizeMultiplier={1.6}>
      {t}
    </AppText>
  );
  return (
    <BottomCard visible={p.visible} onClose={p.onClose} onDismissed={p.onDismissed} scroll={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
          {p.title}
        </AppText>
        <TextButton label="Close" tone="secondary" onPress={p.onClose} />
      </View>
      <View ref={listView} style={{ flexShrink: 1 }}>
      <ScrollView style={{ flexShrink: 1 }} scrollEnabled={!dragging}>
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: theme.space['2'], paddingBottom: theme.space['1'] }}>
          {head('', { width: 30 })}
          {head('Exercise', { flex: 1 })}
          {head('Sets', { width: 48, textAlign: 'right' })}
          {head('Top set (kg)', { width: 64, textAlign: 'right' })}
          {head('', { width: theme.target.min.width })}
        </View>
        <DragList enabled={p.drag !== undefined} allowOnto canDrop={(from, t) => p.drag?.canDrop(from, t) ?? false} onDrop={(from, t) => p.drag?.onDrop(from, t)} onMenu={p.onMenu} onDragChange={setDragging} viewport={listView}>
        {p.rows.map((r) => (
          <DragItem key={r.key} dragKey={r.key} draggable={p.drag?.draggable(r.key) ?? false}>
          <HeldPressable
            accessibilityRole="button"
            accessibilityLabel={r.accessibilityLabel}
            accessibilityHint="Shows this round"
            accessibilityActions={[{ name: 'activate' }, { name: 'menu', label: 'Exercise options' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'menu') p.onMenu(r.key);
              else p.onPick(r.roundIndex);
            }}
            onPress={() => {
              p.onPick(r.roundIndex);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: 50,
              paddingHorizontal: theme.space['2'],
              paddingVertical: theme.space['1'],
              borderTopWidth: theme.dividerWidth,
              borderTopColor: theme.colors['border.divider'],
              opacity: pressed ? TEXT_PRESSED_OPACITY : r.done && !r.current ? 0.6 : 1,
            })}
          >
            <View style={{ width: 30, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              {r.done ? <Icon name="checkmark" color="status.done" size={11} /> : null}
              <AppText variant="label" numeric color={r.current ? 'text.primary' : 'text.secondary'} style={{ fontSize: 13 }}>
                {r.label}
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="callout" color={r.current ? 'text.primary' : 'text.secondary'}>
                {r.name}
              </AppText>
              {r.works !== null ? (
                <AppText variant="callout" color="text.secondary" style={{ fontSize: 12, lineHeight: 16 }}>
                  {r.works}
                </AppText>
              ) : null}
            </View>
            <AppText variant="callout" numeric style={{ width: 48, textAlign: 'right' }}>
              {r.sets}
            </AppText>
            <AppText variant="callout" numeric style={{ width: 64, textAlign: 'right' }}>
              {r.top}
            </AppText>
            <Pressable
              accessible={false}
              onPress={() => {
                p.onMenu(r.key);
              }}
              style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
            >
              <Icon name="ellipsis" color="text.secondary" size={18} />
            </Pressable>
          </HeldPressable>
          </DragItem>
        ))}
        </DragList>
        <View style={{ alignItems: 'flex-start', paddingTop: theme.space['2'] }}>
          <TextButton label="＋ Add exercise" onPress={p.onAddExercise} />
        </View>
      </ScrollView>
      </View>
    </BottomCard>
  );
}

/**
 * `Why?` under an exercise (§2): its full target, the rest (after the round
 * in a superset) with `Change`, last time, and the coach's or the rule's
 * reason (`explainTarget`, as in the target's `Why?` panel).
 */
export function WhySheet(p: { visible: boolean; title: string; view: WhyView | null; panel: WhyPanel; onChangeRest: () => void; onPainFlag: (flagId: string) => void; onClose: () => void }) {
  const theme = useTheme();
  const v = p.view;
  const line = (label: string, value: string, action?: { label: string; a11y: string; onPress: () => void }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: theme.target.min.height, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <AppText variant="callout" color="text.secondary" style={{ width: 84 }}>
        {label}
      </AppText>
      <AppText variant="callout" numeric style={{ flex: 1, fontWeight: '600' }}>
        {value}
      </AppText>
      {action ? <TextButton label={action.label} tone="secondary" accessibilityLabel={action.a11y} onPress={action.onPress} /> : null}
    </View>
  );
  return (
    <BottomCard visible={p.visible} onClose={p.onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
          {p.title}
        </AppText>
        <TextButton label="Close" tone="secondary" onPress={p.onClose} />
      </View>
      {v !== null ? (
        <View>
          {line('Target', v.target)}
          {line('Rest', v.rest.replace(/^Rest /, ''), { label: 'Change', a11y: 'Change the rest', onPress: p.onChangeRest })}
          {v.last !== null ? line('Last time', v.last) : null}
        </View>
      ) : null}
      {p.panel !== null ? <TargetWhyPanel panel={p.panel} onPainFlag={p.onPainFlag} /> : null}
    </BottomCard>
  );
}
