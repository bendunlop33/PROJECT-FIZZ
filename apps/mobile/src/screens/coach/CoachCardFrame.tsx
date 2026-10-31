import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '../../theme';

/**
 * One frame for every card in the coach sheet (design pass, 20 Oct): action,
 * proposal, build, draft, question and plan cards. `bg.surface`, the theme's
 * card border (none in D), and the larger radius in D. With `label`, the card
 * reads as one VoiceOver element.
 */
export function CoachCardFrame({ children, label }: { children: ReactNode; label?: string }) {
  const theme = useTheme();
  const d = theme.components.cardBorderWidth === 0;
  return (
    <View
      accessible={label !== undefined}
      {...(label !== undefined ? { accessibilityLabel: label } : {})}
      style={{
        backgroundColor: theme.colors['bg.surface'],
        borderRadius: d ? theme.radius.lg : theme.radius.md,
        borderWidth: theme.components.cardBorderWidth,
        borderColor: theme.colors['border.control'],
        padding: theme.space['3'],
        gap: theme.space['2'],
      }}
    >
      {children}
    </View>
  );
}

/** A card's action row: wraps at large text, `Why?` (or the secondary action) left, the main action right. */
export function CardActions({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: theme.space['1'], columnGap: theme.space['3'] }}>{children}</View>;
}
