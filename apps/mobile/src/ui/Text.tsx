import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme, type ColorToken, type InAppTypeTokenName } from '../theme';

export interface AppTextProps extends TextProps {
  variant?: InAppTypeTokenName;
  color?: ColorToken;
  /** The text is a number (load, count, time): use tabular numerals (design-system §3). */
  numeric?: boolean;
  align?: TextStyle['textAlign'];
}

/**
 * Every piece of text goes through here: type token, colour token, Dynamic
 * Type with the token's cap, tabular numerals where the token or `numeric`
 * says so. No font family is set, so iOS uses SF Pro.
 */
export function AppText({ variant = 'body', color = 'text.primary', numeric = false, align, style, ...rest }: AppTextProps) {
  const theme = useTheme();
  const t = theme.type[variant];
  const tabular = t.tabular === 'always' || (t.tabular === 'numeric' && numeric);
  const base: TextStyle = {
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    fontWeight: t.fontWeight,
    color: theme.colors[color],
    ...(tabular ? { fontVariant: ['tabular-nums'] } : {}),
    ...(t.uppercase ? { textTransform: 'uppercase' } : {}),
    ...(t.letterSpacing !== 0 ? { letterSpacing: t.letterSpacing } : {}),
    ...(align ? { textAlign: align } : {}),
  };
  return <Text allowFontScaling maxFontSizeMultiplier={t.maxFontSizeMultiplier} style={[base, style]} {...rest} />;
}
