import type { StripItem } from '@fizz/domain';

import { progressPalette, withAlpha } from '../reviews/palette';
import type { ResolvedTheme } from '../theme';

/**
 * The 7-day strip's pills (workout-builder-v3 §2.0.2 region 3, Ben 21 Oct; prototypes/today-v2.html
 * `.pip`): a done session is a soft-green pill (the Progress chips' green, `progressPalette`), a planned
 * day or the chosen session today a dashed outline, cardio its own tint (dashed when planned), Rest text
 * only. No `✓`. Colour is never the only signal (fill vs dashed outline; VoiceOver says done / Planned).
 * Pure, so it is tested without a renderer.
 */

/** Cardio's tint: the prototype's `--run` / `--run-sub` (not a design-system token yet, like Progress's palette). */
export const RUN_TINT = { dark: { text: '#7FB2E5', fill: '#172636' }, light: { text: '#1F5F99', fill: '#E3EEF8' } } as const;

/** One line, centred, shrinking to fit rather than cut off (§2.0.2 region 3). */
export const STRIP_LABEL_FIT = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75 } as const;

export interface StripPillStyle {
  backgroundColor: string;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderColor: string;
  color: string;
}

export function stripPillStyle(item: Pick<StripItem, 'kind' | 'planned'>, theme: Pick<ResolvedTheme, 'colors' | 'scheme'>): StripPillStyle {
  const pal = progressPalette(theme);
  const run = RUN_TINT[theme.scheme];
  const none = 'transparent';
  switch (item.kind) {
    case 'workout':
      return { backgroundColor: pal.doneFill, borderWidth: 1, borderStyle: 'solid', borderColor: pal.doneEdge, color: theme.colors['text.primary'] };
    case 'activity':
      return item.planned
        ? { backgroundColor: none, borderWidth: 1, borderStyle: 'dashed', borderColor: run.text, color: run.text }
        : { backgroundColor: run.fill, borderWidth: 1, borderStyle: 'solid', borderColor: withAlpha(run.text, 0.4), color: run.text };
    case 'plan_day':
    case 'today':
      return { backgroundColor: none, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors['text.tertiary'], color: theme.colors['text.secondary'] };
    case 'rest':
      return { backgroundColor: none, borderWidth: 0, borderStyle: 'solid', borderColor: none, color: theme.colors['text.tertiary'] };
  }
}
