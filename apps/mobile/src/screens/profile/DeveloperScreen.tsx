import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Switch, View } from 'react-native';

import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { useLaunchInfo, useServices } from '../../shell/context';
import type { ProfileStackParams } from '../../navigation/types';
import { THEME_DIRECTIONS, useTheme, useThemeDirection } from '../../theme';
import { AppText, ChoiceCard, Group, Row, Screen, SectionHeader } from '../../ui';

/**
 * Developer settings: the capability probe (moved here from the old shell),
 * the look (D default, A selectable; provisional decision 2026-10-09), the
 * exercise-guide safe mode and database file names for debugging.
 */
export function DeveloperScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { directionId, setDirection } = useThemeDirection();
  const services = useServices();
  const launch = useLaunchInfo();
  const names = services.developer.databaseNames();
  const { prefs, update } = useDevicePrefs();
  return (
    <Screen>
      <Group>
        <Row
          title="Capability probe"
          icon="stethoscope"
          subtitle="Device checks for alerts, voice, storage and signing"
          onPress={() => {
            navigation.navigate('CapabilityProbe');
          }}
        />
        <Row
          title="ChatGPT sign-in test"
          icon="person.badge.key"
          subtitle="Spike S1: sign in, models, one test reply, refresh"
          onPress={() => {
            navigation.navigate('ChatGptSignInTest');
          }}
        />
      </Group>

      <SectionHeader title="Look" />
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        {(['D', 'A'] as const).map((id) => (
          <ChoiceCard
            key={id}
            title={`${THEME_DIRECTIONS[id].name} (${id})`}
            subtitle={id === 'D' ? 'Default (provisional). Warm near-black and porcelain.' : 'Navy and blue accent (design-system v0.1).'}
            selected={directionId === id}
            onPress={() => {
              setDirection(id);
            }}
          />
        ))}
        <AppText variant="callout" color="text.secondary">
          Saved on this phone only, not in backups. Light or dark follows the system setting.
        </AppText>
      </View>

      <SectionHeader title="Exercise guides" />
      <View style={{ gap: theme.space['2'] }}>
        <Group>
          <Row
            title="Exercise guide animations"
            subtitle={prefs.guideAnimations ? 'On: How to plays the animated guide' : 'Off: How to shows still key positions only'}
            trailing={
              <Switch
                accessibilityLabel="Exercise guide animations"
                value={prefs.guideAnimations}
                onValueChange={(on) => {
                  update({ guideAnimations: on });
                }}
              />
            }
          />
        </Group>
        <AppText variant="callout" color="text.secondary">
          A safe mode: with animations off, How to never starts the animation clock. Saved on this phone only, not in backups.
        </AppText>
      </View>

      <SectionHeader title="Database" />
      <Group>
        <Row title="Current file" subtitle={names.current} />
        <Row title="Previous file (for Undo restore)" subtitle={names.previous ?? 'None'} />
        <Row title="Schema version" subtitle={`${String(launch.migration.to)} · SQLite ${launch.sqliteVersion}`} />
      </Group>
    </Screen>
  );
}
