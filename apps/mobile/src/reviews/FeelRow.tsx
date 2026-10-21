import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { FEEL_COPY, feelOptions } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { newUuid } from '../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { FEEL_ROW_COPY, sendFeel } from './feel';
import { useTheme } from '../theme';
import { AppText, Icon } from '../ui';

/** The row's height while it loads, so the Summary doesn't jump when it appears (review b3-wave3-ux S7). */
const ROW_HEIGHT = 72;

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
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  if (data.state === 'loading') return <View style={{ minHeight: ROW_HEIGHT }} />;
  if (data.state !== 'ready' || data.value === null) return null;
  const { feel, version } = data.value;
  return (
    <View style={{ gap: theme.space['2'], minHeight: ROW_HEIGHT }}>
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
              void sendFeel(services, sessionId, o.next, version, newUuid)
                .then((ok) => {
                  setFailed(!ok);
                })
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
      {failed ? (
        <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite">
          {FEEL_ROW_COPY.failed}
        </AppText>
      ) : null}
    </View>
  );
}
