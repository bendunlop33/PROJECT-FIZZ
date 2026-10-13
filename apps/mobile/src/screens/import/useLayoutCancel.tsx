import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useLayoutEffect } from 'react';

import { leaveLayoutScreen } from '../../import/layout-leave';
import type { ProfileStackParams } from '../../navigation/types';
import { useServices } from '../../shell/context';
import { TextButton } from '../../ui';

/**
 * `Cancel` in the nav bar of New file layout and Check the layout (§9.2.2,
 * §9.2.5; review r2 S2). Cancel, back and the swipe all drop the layout
 * session through `beforeRemove` (`leaveLayoutScreen`), so nothing is saved
 * and the layout isn't reused. Nothing has been imported, so no alert.
 */
export function useLayoutCancel(layoutId: string): void {
  const services = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        leaveLayoutScreen(services.importLayouts, layoutId, e.data.action).catch(() => undefined);
      }),
    [navigation, services, layoutId],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <TextButton
          label="Cancel"
          tone="secondary"
          onPress={() => {
            navigation.goBack();
          }}
        />
      ),
    });
  }, [navigation]);
}
