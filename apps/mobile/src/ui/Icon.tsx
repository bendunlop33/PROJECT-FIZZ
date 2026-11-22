import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useWindowDimensions } from 'react-native';

import { useTheme, type ColorToken } from '../theme';

export type SymbolName = Extract<SymbolViewProps['name'], string>;

interface Props {
  name: SymbolName;
  color?: ColorToken;
  /** Size at the default text size; scales with Dynamic Type up to 2×. */
  size?: number;
  weight?: SymbolViewProps['weight'];
}

/**
 * SF Symbols by the names design-system.md uses. Decorative by default:
 * every status also has words next to it (never colour or icon alone).
 */
export function Icon({ name, color = 'text.secondary', size = 20, weight = 'regular' }: Props) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const scaled = Math.round(size * Math.min(Math.max(fontScale, 1), 2));
  return (
    <SymbolView
      name={name}
      tintColor={theme.colors[color]}
      size={scaled}
      weight={weight}
      accessible={false}
      importantForAccessibility="no"
      style={{ width: scaled, height: scaled }}
    />
  );
}
