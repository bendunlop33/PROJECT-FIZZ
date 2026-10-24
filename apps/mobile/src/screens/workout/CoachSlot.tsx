import type { ReactNode } from 'react';

import { listEnterMotion, useTheme } from '../../theme';
import { FadeIn } from '../../ui';

/**
 * The Rest screen's coach card place (premium-feel §3.4). The coach-card
 * work fills it; until then, and whenever there's nothing to say, it renders
 * nothing at all (no height, no margin). Never a canned card: with the
 * coach unavailable the slot stays empty. One card at a time, entering with
 * `motion.listEnter`. The parent's gap supplies the `space.5` above it.
 */
export function CoachSlot({ children = null }: { children?: ReactNode }) {
  const theme = useTheme();
  if (children === null || typeof children === 'boolean') return null;
  return (
    <FadeIn
      motion={listEnterMotion(0, theme.a11y.reduceMotion)}
      style={{
        backgroundColor: theme.colors['bg.surface'],
        borderRadius: theme.radius.lg,
        padding: theme.space['4'],
        gap: theme.space['3'],
      }}
    >
      {children}
    </FadeIn>
  );
}
