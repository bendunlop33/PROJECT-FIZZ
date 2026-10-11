import { ScrollView, useWindowDimensions, View } from 'react-native';

import type { SwapSheet } from '../../services/workout-services';
import { useTheme } from '../../theme';
import { AppText, BottomCard, StatusLine, SubstituteRowView, TextButton } from '../../ui';
import { overviewLayout, OVERVIEW_COPY } from '../../workout/overview';
import { noSwapsText, swapPainLine, swapSubtitle } from '../../workout/overview-edits';

/**
 * The Swap sheet during a workout (exercise-library EL4, B3): the same rows
 * as before Start. A tap applies at once; the screen shows the toast with
 * Undo. No AI call, nothing computed here.
 */
export function MidSwapSheet(props: {
  visible: boolean;
  exerciseName: string;
  sheet: SwapSheet | null;
  loading: boolean;
  onPick: (row: SwapSheet['rows'][number]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const { stacked } = overviewLayout(fontScale);
  const { sheet } = props;
  return (
    <BottomCard visible={props.visible} onClose={props.onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="title2" accessibilityRole="header">
            {`Swap ${sheet?.plannedName ?? props.exerciseName}`}
          </AppText>
          {sheet ? (
            <AppText variant="callout" color="text.secondary">
              {swapSubtitle(sheet.gymName)}
            </AppText>
          ) : null}
        </View>
        <TextButton label={OVERVIEW_COPY.close} tone="secondary" onPress={props.onClose} />
      </View>
      {sheet && swapPainLine(sheet.painHeld) !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={swapPainLine(sheet.painHeld) ?? ''} /> : null}
      {sheet && sheet.rows.length > 0 ? (
        <ScrollView>
          <View style={{ alignItems: 'flex-end', paddingBottom: theme.space['1'] }}>
            <AppText variant="sectionLabel" color="text.tertiary">
              {OVERVIEW_COPY.target}
            </AppText>
          </View>
          {sheet.rows.map((row) => (
            <SubstituteRowView
              key={row.exerciseId}
              row={row}
              stacked={stacked}
              onPress={() => {
                props.onPick(row);
              }}
            />
          ))}
        </ScrollView>
      ) : sheet ? (
        <AppText variant="body" color="text.secondary">
          {noSwapsText(sheet.gymName)}
        </AppText>
      ) : !props.loading ? (
        <AppText variant="body" color="text.secondary">
          {OVERVIEW_COPY.loadFailed}
        </AppText>
      ) : null}
    </BottomCard>
  );
}
