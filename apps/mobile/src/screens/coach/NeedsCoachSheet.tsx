import { View } from 'react-native';

import type { BuildBlock } from '../../coach/coach-service';
import { BUILD_COPY, needsCoachView } from '../../coach/build-view';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Icon, SecondaryButton, TextButton } from '../../ui';

/**
 * `Needs the coach` (workout-builder §5.4): a small sheet wherever a build
 * would start while the coach can't answer. The reason word, `Connect ›`
 * when connecting fixes it, then `Empty workout` and `Choose session`. No
 * chips, no Build button and no stand-in plan.
 */
export function NeedsCoachSheet({ block, onClose, onConnect, onEmptyWorkout, onChooseSession }: { block: BuildBlock | null; onClose: () => void; onConnect: () => void; onEmptyWorkout: () => void; onChooseSession: () => void }) {
  const theme = useTheme();
  const v = block === null ? null : needsCoachView(block);
  return (
    <BottomCard visible={v !== null} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="title2" accessibilityRole="header">
          {BUILD_COPY.link}
        </AppText>
        <TextButton label="Close" tone="secondary" onPress={onClose} />
      </View>
      {v !== null ? (
        <View accessible accessibilityLabel={v.accessibilityLabel} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="nosign" size={16} color="text.secondary" />
          <AppText variant="callout" style={{ flex: 1 }}>
            {v.line}
          </AppText>
          {v.connect ? <TextButton label={BUILD_COPY.connect} onPress={onConnect} /> : null}
        </View>
      ) : null}
      {/* Design pass nit: the two ways on are buttons, not links. */}
      <View style={{ gap: theme.space['2'] }}>
        <SecondaryButton label={BUILD_COPY.emptyWorkout} onPress={onEmptyWorkout} />
        <SecondaryButton label={BUILD_COPY.chooseSession} onPress={onChooseSession} />
      </View>
    </BottomCard>
  );
}
