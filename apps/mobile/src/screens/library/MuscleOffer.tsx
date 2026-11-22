import { useNavigation } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { PLAN_MUSCLES_COPY } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, TextButton } from '../../ui';

/**
 * (Ben, 1 Nov: "the coach should have caught" it) The coach's one muscle-gap offer: `Biceps only 2 sets a week ·
 * Rebalance?` with Rebalance (opens Plan › Muscles, where the proposal is applied or not) and Skip. Raised once per plan
 * state, after Apply or in the weekly review, never both (`services.planMuscles.offer`). Rule 3: an offer, nothing changes.
 */
export function MuscleOffer({ surface, weekMonday }: { surface: 'apply' | 'review'; weekMonday: string | null }) {
  const theme = useTheme();
  const services = useServices();
  const navigation = useNavigation();
  const op = useRef(newUuid());
  const [data] = useScreenData((s) => s.planMuscles.offer({ surface, weekMonday, opId: op.current }).catch(() => null));
  const [skipped, setSkipped] = useState(false);
  const offer = data.state === 'ready' ? data.value : null;
  if (offer === null || skipped) return null;
  return (
    <View style={{ gap: theme.space['1'] }}>
      <AppText variant="callout" numeric>
        {offer.text}
      </AppText>
      <View style={{ flexDirection: 'row', columnGap: theme.space['4'] }}>
        <TextButton
          label={PLAN_MUSCLES_COPY.rebalance}
          onPress={() => {
            navigation.navigate('Tabs', { screen: 'Library', params: { screen: 'LibraryPlanMuscles' } });
          }}
        />
        <TextButton
          label="Skip"
          tone="secondary"
          onPress={() => {
            setSkipped(true);
            void services.planMuscles.skipOffer({ key: offer.key, opId: newUuid() });
          }}
        />
      </View>
    </View>
  );
}
