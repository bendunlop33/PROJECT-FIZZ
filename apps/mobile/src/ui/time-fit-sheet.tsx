import { View } from 'react-native';

import { useTheme } from '../theme';
import type { TimeFitSheetView } from '../workout/time-fit';
import { PrimaryButton, SecondaryButton, TextButton } from './buttons';
import { BottomCard } from './sheet';
import { AppText } from './Text';

/**
 * The workout's `+N min` offer (workout-table-v3 §5, review build-a SP-3):
 * each change before → after, the estimate, Apply / Not now, and `Time left ›`.
 * Shows `timeFitSheet`'s view and computes nothing.
 */
export function TimeFitSheet({ view, busy, onApply, onClose, onTimeLeft }: { view: TimeFitSheetView | null; busy: boolean; onApply: () => void; onClose: () => void; onTimeLeft: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard
      visible={view !== null}
      onClose={onClose}
      footer={
        view === null ? null : (
          <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
            <View style={{ flex: 1 }}>
              <SecondaryButton label={view.notNow} size="primary" grow onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={view.apply} busy={busy} onPress={onApply} />
            </View>
          </View>
        )
      }
    >
      {view === null ? null : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="title2" accessibilityRole="header">
              {view.title}
            </AppText>
            <TextButton label={view.timeLeft} tone="secondary" accessibilityLabel="Time left" onPress={onTimeLeft} />
          </View>
          <View style={{ gap: theme.space['2'] }}>
            {view.lines.map((l, i) => (
              <AppText key={`${String(i)}:${l}`} variant="body" numeric>
                {l}
              </AppText>
            ))}
          </View>
          <AppText variant="callout" color="text.secondary" numeric>
            {view.estimate}
          </AppText>
        </>
      )}
    </BottomCard>
  );
}
