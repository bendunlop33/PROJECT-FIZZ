import { useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { sentView } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Group, Icon, Row, Screen, SectionHeader } from '../../ui';

/**
 * What's sent (data-import-export §9.2.3): the literal request text (AI8),
 * not a description of it. A switch per column; free-text columns are
 * always masked and can't be switched on. Switching a column off updates
 * the text and the count at once; the request sends exactly this text.
 */
export function ImportSentScreen() {
  const theme = useTheme();
  const services = useServices();
  const { layoutId } = useRoute<RouteProp<ProfileStackParams, 'ImportSent'>>().params;
  const [, setTick] = useState(0);
  const [showInstructions, setShowInstructions] = useState(false);
  const current = services.importLayouts.buildImportSample(layoutId);
  if (!current) return <Screen>{null}</Screen>;
  const v = sentView(current);
  const hidden = current.columns.filter((c) => c.hidden).map((c) => c.index);

  function toggle(index: number, on: boolean) {
    services.importLayouts.buildImportSample(layoutId, on ? hidden.filter((i) => i !== index) : [...hidden, index]);
    setTick((t) => t + 1);
  }

  return (
    <Screen>
      <SectionHeader title="Columns" />
      <Group>
        {v.columns.map((c) => (
          <View key={c.index} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: theme.space['4'], gap: theme.space['3'] }}>
            <AppText variant="body" style={{ flex: 1 }}>
              {c.header}
            </AppText>
            {c.state === 'notes' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
                <Icon name="slash.circle" color="text.secondary" size={16} />
                <AppText variant="callout" color="text.secondary">
                  Hidden
                </AppText>
              </View>
            ) : (
              <Switch
                accessibilityLabel={c.header}
                value={c.state === 'on'}
                onValueChange={(on) => {
                  toggle(c.index, on);
                }}
                trackColor={{ true: theme.colors.accent, false: theme.colors['bg.raised'] }}
              />
            )}
          </View>
        ))}
      </Group>

      <SectionHeader title="Exactly as sent" />
      <AppText
        variant="callout"
        selectable
        style={{ fontFamily: 'Menlo', backgroundColor: theme.colors['bg.raised'], borderWidth: 1, borderColor: theme.colors['border.control'], padding: theme.space['3'], borderRadius: theme.radius.sm }}
      >
        {v.text}
      </AppText>
      <AppText variant="label" color="text.secondary" numeric>
        {v.chars}
      </AppText>

      <Row
        title="Instructions"
        onPress={() => {
          setShowInstructions((x) => !x);
        }}
      />
      {showInstructions ? (
        <AppText variant="callout" color="text.secondary" selectable>
          {v.instructions}
        </AppText>
      ) : null}
    </Screen>
  );
}
