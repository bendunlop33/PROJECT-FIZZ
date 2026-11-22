import type { ResolvedTheme } from '../theme';

/**
 * Progress v3 colours (progress-goals.md "Progress v3 (agreed)", prototype `progress-simple.html`). The
 * dataviz categorical slots 1–3 and the data colour are the agreed design's values; they aren't
 * design-system tokens yet (§13: tokens on approval), so they live here, in one place. Everything else is
 * derived from theme tokens. Pure.
 */

/** Dataviz categorical slots 1–3 (dark), one per drawn lift. */
export const LIFT_COLOURS = ['#3987e5', '#d95926', '#199e70'] as const;

/** `#RRGGBB` at an alpha, as `rgba()`; anything else is returned as it is. */
export function withAlpha(colour: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (m === null) return colour;
  return `rgba(${String(parseInt(m[1] ?? '0', 16))}, ${String(parseInt(m[2] ?? '0', 16))}, ${String(parseInt(m[3] ?? '0', 16))}, ${String(alpha)})`;
}

export interface ProgressPalette {
  lines: readonly string[];
  /** Muscles bars at or over plan. */
  data: string;
  /** Muscles bars under plan. */
  dataUnder: string;
  /** Done chips: a soft green fill with a green edge. */
  doneFill: string;
  doneEdge: string;
  /** Missed chips: a faint grey fill. */
  missedFill: string;
  /** Month calendar: a rest day's faint square. */
  restFill: string;
}

export function progressPalette(theme: Pick<ResolvedTheme, 'colors' | 'scheme'>): ProgressPalette {
  const data = theme.scheme === 'dark' ? '#E8C9A0' : theme.colors['text.primary'];
  const done = theme.colors['status.done'];
  return {
    lines: LIFT_COLOURS,
    data,
    dataUnder: withAlpha(data, 0.45),
    doneFill: withAlpha(done, theme.scheme === 'dark' ? 0.2 : 0.14),
    doneEdge: withAlpha(done, 0.55),
    missedFill: withAlpha(theme.colors['text.primary'], 0.05),
    restFill: withAlpha(theme.colors['text.primary'], 0.025),
  };
}
