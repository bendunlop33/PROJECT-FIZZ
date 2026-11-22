import { Pressable } from 'react-native';

import { useTheme } from '../../theme';
import { Icon, TEXT_PRESSED_OPACITY } from '../../ui';

/** The coach sheet's header and send buttons, shared by the thread sheet and Your workout's builder sheet. */

export function HeaderButton({ icon, label, onPress, toggle }: { icon: 'list.bullet' | 'square.and.pencil' | 'xmark' | 'speaker.wave.2' | 'speaker.slash' | 'chevron.left'; label: string; onPress: () => void; /** A switch (the speaker): on is accent-tinted and read as on. */ toggle?: { on: boolean } }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={toggle === undefined ? 'button' : 'switch'}
      accessibilityLabel={label}
      {...(toggle === undefined ? {} : { accessibilityState: { checked: toggle.on } })}
      onPress={onPress}
      style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <Icon name={icon} color={toggle?.on === true ? 'accent' : 'text.primary'} size={20} />
    </Pressable>
  );
}

export function SendButton({ icon, label, enabled, onPress }: { icon: 'arrow.up' | 'stop.fill'; label: string; enabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: enabled ? theme.colors.accent : theme.colors['bg.raised'] }}
    >
      <Icon name={icon} color={enabled ? 'on.accent' : 'text.secondary'} size={20} />
    </Pressable>
  );
}
