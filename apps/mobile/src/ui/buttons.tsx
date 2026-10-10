import { ActivityIndicator, Pressable, View, type AccessibilityState } from 'react-native';

import { useTheme } from '../theme';
import { Icon, type SymbolName } from './Icon';
import { AppText } from './Text';

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
}

/**
 * design-system §9.2. The one accent-filled button on a screen; the label says
 * what will happen. 60pt tall, full width; corner from the look (D: pill).
 */
export function PrimaryButton({ label, onPress, disabled = false, busy = false, accessibilityHint }: ButtonProps & { busy?: boolean }) {
  const theme = useTheme();
  const inactive = disabled || busy;
  const state: AccessibilityState = { disabled: inactive, busy };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={state}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.target.primary.height,
        borderRadius: theme.radius[theme.components.primaryButtonRadius],
        backgroundColor: disabled ? theme.colors['bg.raised'] : pressed ? theme.colors['accent.pressed'] : theme.colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: theme.space['2'],
        paddingHorizontal: theme.space['4'],
        paddingVertical: theme.space['2'],
      })}
    >
      {busy ? <ActivityIndicator color={theme.colors['on.accent']} /> : null}
      <AppText variant="headline" color={disabled ? 'text.secondary' : 'on.accent'} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

/** design-system §9.2a: outlined, never accent-filled. D: a transparent outline pill (D-Rest). */
export function SecondaryButton({ label, onPress, disabled = false, icon, accessibilityHint }: ButtonProps & { icon?: SymbolName }) {
  const theme = useTheme();
  if (theme.components.secondaryButton === 'outline_pill') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        {...(accessibilityHint ? { accessibilityHint } : {})}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 48,
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.colors['border.control'],
          backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.space['2'],
          paddingHorizontal: theme.space['5'],
          paddingVertical: theme.space['2'],
          opacity: disabled ? 0.45 : 1,
        })}
      >
        {icon ? <Icon name={icon} color="text.primary" size={16} /> : null}
        <AppText variant="label" align="center">
          {label}
        </AppText>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.target.min.height,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: theme.space['2'],
        paddingHorizontal: theme.space['4'],
        paddingVertical: theme.space['2'],
      })}
    >
      {icon ? <Icon name={icon} color={disabled ? 'text.secondary' : 'accent'} size={18} /> : null}
      <AppText variant="headline" color={disabled ? 'text.secondary' : 'accent'} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * A text link or text button. In looks where the accent is close to body
 * text (D), it always carries a chevron so it reads as tappable (research
 * §6.3 risk 1); `icon` replaces the chevron when given.
 */
export function TextButton({ label, onPress, disabled = false, icon, tone = 'accent', accessibilityHint }: ButtonProps & { icon?: SymbolName; tone?: 'accent' | 'secondary' }) {
  const theme = useTheme();
  if (theme.components.linkAffordance === 'underline') {
    // D (D-Today): a 16pt underlined link; the underline, not colour, says it's tappable.
    const tint = disabled ? 'text.tertiary' : tone === 'accent' ? 'text.primary' : 'text.secondary';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        {...(accessibilityHint ? { accessibilityHint } : {})}
        disabled={disabled}
        onPress={onPress}
        hitSlop={4}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
          {icon ? <Icon name={icon} color={tint} size={16} /> : null}
          <AppText variant="callout" color={tint} style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
            {label}
          </AppText>
        </View>
      </Pressable>
    );
  }
  const color = disabled ? 'text.secondary' : tone === 'accent' ? 'accent' : 'text.secondary';
  const showChevron = icon === undefined && theme.components.linkAffordance === 'chevron';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        {icon ? <Icon name={icon} color={color} size={18} /> : null}
        <AppText variant="headline" color={color} style={showChevron ? { textDecorationLine: 'underline' } : undefined}>
          {label}
        </AppText>
        {showChevron ? <Icon name="chevron.right" color={color} size={14} /> : null}
      </View>
    </Pressable>
  );
}

/** design-system §9.2b. Always followed by a confirmation; the label names what goes. */
export function DangerTextButton({ label, onPress, disabled = false }: ButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <AppText variant="headline" color={disabled ? 'text.secondary' : 'status.danger'}>
        {label}
      </AppText>
    </Pressable>
  );
}
