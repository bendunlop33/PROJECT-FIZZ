import type { ZonedTimestamp } from '@fizz/schemas';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { OverviewStartOf, SessionList, SessionPickerRow as Row } from '../../services/workout-services';
import { useTheme, TIMING } from '../../theme';
import { AppText, BottomCard, Eyebrow, Icon, Tag, TextButton } from '../../ui';
import { isShownRow, pickerRowDetail, pickerRowLabel, pickerSections, SESSION_PICKER_COPY } from '../../workout/session-picker';

/**
 * `SessionPickerSheet` (session-picker §2.2): which session to train today.
 * Rows come from `services.sessions.list` in picker order; this only
 * formats. No targets, loads or coach content: the overview answers "what".
 * From Today no row is checked; from the overview the shown row is.
 */
export function SessionPickerSheet({
  visible,
  list,
  now,
  shown,
  onPick,
  onClose,
  onRetry,
  onEmptyWorkout,
  onPastWorkouts,
  onEditWorkouts,
  onBuildWithCoach,
  onDismissed,
}: {
  visible: boolean;
  /** `loading` until the read lands; null when it couldn't be read. */
  list: SessionList | null | 'loading';
  now: ZonedTimestamp;
  /** What the overview is showing (its `✓`); null from Today. */
  shown: OverviewStartOf | null;
  onPick: (row: Row) => void;
  onClose: () => void;
  onRetry: () => void;
  onEmptyWorkout: () => void;
  onPastWorkouts: () => void;
  /** `Edit workouts` → the Workouts list (routines.md §A2.4). */
  onEditWorkouts?: () => void;
  /** `Build with coach` (workout-builder §3): a text link under `Empty workout`, never a filled pill. */
  onBuildWithCoach?: () => void;
  onDismissed?: () => void;
}) {
  const theme = useTheme();
  // Loading: nothing for 300 ms, then static rows (no shimmer). Local reads only, so it's rare.
  const [placeholder, setPlaceholder] = useState(false);
  useEffect(() => {
    if (!visible || list !== 'loading') {
      setPlaceholder(false);
      return;
    }
    const t = setTimeout(() => {
      setPlaceholder(true);
    }, TIMING.placeholderDelay);
    return () => {
      clearTimeout(t);
    };
  }, [visible, list]);

  const body = (() => {
    if (list === 'loading') {
      return placeholder ? (
        <View accessibilityElementsHidden style={{ gap: theme.space['3'] }}>
          {[0, 1, 2].map((i) => (
            <View key={String(i)} style={{ height: 52, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.raised'] }} />
          ))}
        </View>
      ) : null;
    }
    if (list === null) {
      return (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="body">{SESSION_PICKER_COPY.loadFailed}</AppText>
          <View style={{ alignSelf: 'flex-start' }}>
            <TextButton label={SESSION_PICKER_COPY.tryAgain} onPress={onRetry} />
          </View>
        </View>
      );
    }
    const render = (r: Row, i: number) => <SessionPickerRow key={r.key} row={r} now={now} selected={isShownRow(r, shown)} first={i === 0} onPress={() => { onPick(r); }} />;
    return (
      <View>
        {pickerSections(list).map((section, si) => (
          <View key={section.title ?? `up-${String(si)}`}>
            {section.title !== null ? (
              <View style={{ marginTop: theme.space['4'] }} accessibilityRole="header">
                <Eyebrow>{section.title}</Eyebrow>
              </View>
            ) : null}
            {section.rows.map(render)}
          </View>
        ))}
      </View>
    );
  })();

  return (
    <BottomCard visible={visible} onClose={onClose} {...(onDismissed ? { onDismissed } : {})} closeLabel={SESSION_PICKER_COPY.close} scroll={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
          {SESSION_PICKER_COPY.title}
        </AppText>
        <TextButton label={SESSION_PICKER_COPY.close} tone="secondary" onPress={onClose} />
      </View>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: theme.space['2'] }}>
        {body}
        <View style={{ marginTop: theme.space['4'], alignItems: 'flex-start' }}>
          <TextButton label={SESSION_PICKER_COPY.emptyWorkout} tone="secondary" onPress={onEmptyWorkout} />
          {onBuildWithCoach ? <TextButton label={SESSION_PICKER_COPY.buildWithCoach} tone="secondary" onPress={onBuildWithCoach} /> : null}
          <TextButton label={SESSION_PICKER_COPY.pastWorkouts} tone="secondary" onPress={onPastWorkouts} />
          {onEditWorkouts ? <TextButton label={SESSION_PICKER_COPY.editWorkouts} tone="secondary" onPress={onEditWorkouts} /> : null}
        </View>
      </ScrollView>
    </BottomCard>
  );
}

/**
 * `SessionPickerRow` (≥ 60 pt, one button): `✓` when shown, the name, the
 * `UP NEXT` tag (icon and word, never colour alone), then
 * `6 days ago · 5 exercises · Edited`. At AX sizes the tag wraps under the
 * name and nothing truncates.
 */
export function SessionPickerRow({ row, now, selected, first, onPress }: { row: Row; now: ZonedTimestamp; selected: boolean; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pickerRowLabel(row, now, selected)}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        paddingVertical: theme.space['2'],
        borderTopWidth: first ? 0 : theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
      })}
    >
      <View style={{ width: 20, alignItems: 'center' }}>{selected ? <Icon name="checkmark" color="text.primary" size={16} /> : null}</View>
      <View style={{ flex: 1, gap: theme.space['1'] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'], rowGap: theme.space['1'] }}>
          <AppText variant="body" style={{ fontWeight: '600' }}>
            {row.label}
          </AppText>
          {row.recommended ? <Tag icon="arrow.clockwise" text={SESSION_PICKER_COPY.upNext.toUpperCase()} /> : null}
          {row.coachDraft !== undefined ? <Tag icon="sparkles" text={SESSION_PICKER_COPY.coachTag} /> : null}
        </View>
        <AppText variant="callout" color="text.secondary" numeric>
          {pickerRowDetail(row, now)}
        </AppText>
      </View>
    </Pressable>
  );
}
