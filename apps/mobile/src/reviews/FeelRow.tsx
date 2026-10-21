import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { FEEL_COPY, feelOptions } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { newUuid } from '../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { useTheme } from '../theme';
import { AppText, Icon } from '../ui';

/**
 * Summary's one-tap `How did it feel?` (Ben, 21 Oct; workout-builder-v3 §6.2): Easy, Good or Hard, stored
 * with the workout through the versioned `set_feel` command (tap the chosen one again to clear it). A weekly
 * review fact; never inferred. Selected shows a checkmark as well as the fill (never colour alone).
 */
export function FeelRow({ sessionId }: { sessionId: string }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.reviews.feelOf(sessionId));
  const busy = useRef(false);
  if (data.state !== 'ready' || data.value === null) return null;
  const { feel, version } = data.value;
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="callout" color="text.secondary">
        {FEEL_COPY.question}
      </AppText>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {feelOptions(feel).map((o) => (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.selected }}
            accessibilityLabel={o.accessibilityLabel}
            onPress={() => {
              if (busy.current) return;
              busy.current = true;
              haptic('step');
              void services.workout
                .dispatch(sessionId, { type: 'set_feel', at: services.now(), opId: newUuid(), feel: o.next, expectedVersion: version })
                .finally(() => {
                  busy.current = false;
                  changed();
                  reload();
                });
            }}
            style={({ pressed }) => ({
              flexGrow: 1,
              minHeight: 44,
              minWidth: 88,
              paddingHorizontal: theme.space['3'],
              borderRadius: 999,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.space['1'],
              borderWidth: 1.5,
              borderColor: o.selected ? theme.colors.accent : theme.colors['border.control'],
              backgroundColor: o.selected ? theme.colors['accent.subtle'] : pressed ? theme.colors['bg.raised'] : 'transparent',
            })}
          >
            {o.selected ? <Icon name="checkmark" size={14} color="text.primary" /> : null}
            <AppText variant="label">{o.label}</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
