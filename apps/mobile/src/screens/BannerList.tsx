import { useNavigation } from '@react-navigation/native';
import { View } from 'react-native';

import type { Banner as BannerModel } from '../status/system-status';
import { useTheme } from '../theme';
import { Banner, TextButton } from '../ui';

/** Renders `buildSystemStatus` output; the order and count are decided there. */
export function BannerList({ banners }: { banners: readonly BannerModel[] }) {
  const theme = useTheme();
  const navigation = useNavigation();
  if (banners.length === 0) return null;
  const open = (b: BannerModel) => {
    switch (b.action?.kind) {
      case 'add_gym':
        navigation.navigate('AddGym');
        return;
      case 'data_backup':
        navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'DataBackup', initial: false } });
        return;
      case 'how_to_refresh':
      case 'integrity_details':
        navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'AppStatus', initial: false } });
        return;
      case undefined:
        return;
    }
  };
  return (
    <View style={{ gap: theme.space['2'] }}>
      {banners.map((b) => (
        <Banner
          key={b.id}
          severity={b.severity}
          text={b.text}
          action={
            b.action ? (
              <TextButton
                label={b.action.label}
                onPress={() => {
                  open(b);
                }}
              />
            ) : undefined
          }
        />
      ))}
    </View>
  );
}
